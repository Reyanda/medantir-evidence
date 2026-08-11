import type { EvidenceSourceAdapter } from '../core/ports.js';
import type { EvidenceRecord, SearchProvenance, SearchStrategy } from '../core/types.js';

export interface RetryPolicy {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function errorChain(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) {
      parts.push(current.message);
      const cause = (current as Error & { cause?: unknown }).cause;
      current = cause;
    } else {
      parts.push(String(current));
      break;
    }
  }
  return parts.join(' | ');
}

/**
 * Retry only failures that are plausibly transient. Logical search failures,
 * invalid-query 4xx responses, pagination reconciliation errors, and configured
 * export ceilings remain fail-closed and are never papered over with retries.
 */
export function isRetryableSourceError(error: unknown): boolean {
  const message = errorChain(error);
  if (/\bHTTP\s+(?:429|5\d\d)\b/i.test(message)) return true;
  return /terminated|UND_ERR_SOCKET|other side closed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|socket hang up|network error|fetch failed/i.test(message);
}

function resolvedPolicy(policy: RetryPolicy = {}) {
  const baseDelayMs = Math.max(0, policy.baseDelayMs ?? Number(process.env.REVIEW_SOURCE_RETRY_BASE_MS ?? 750));
  return {
    maxAttempts: Math.max(1, policy.maxAttempts ?? Number(process.env.REVIEW_SOURCE_MAX_ATTEMPTS ?? 5)),
    baseDelayMs,
    maxDelayMs: Math.max(baseDelayMs, policy.maxDelayMs ?? Number(process.env.REVIEW_SOURCE_RETRY_MAX_MS ?? 5000)),
    sleep: policy.sleep ?? defaultSleep,
  };
}

/**
 * Bounded retry for one idempotent external operation. The callback itself must
 * throw an error whose message identifies HTTP 429/5xx or a recognized network
 * failure; non-transient errors are returned immediately without another call.
 */
export async function retryTransientOperation<T>(
  operation: () => Promise<T>,
  policy: RetryPolicy = {},
): Promise<{ value: T; failures: string[]; attempts: number }> {
  const configured = resolvedPolicy(policy);
  const failures: string[] = [];
  for (let attempt = 1; attempt <= configured.maxAttempts; attempt += 1) {
    try {
      return { value: await operation(), failures, attempts: attempt };
    } catch (error) {
      const message = errorChain(error);
      if (!isRetryableSourceError(error) || attempt >= configured.maxAttempts) throw error;
      failures.push(`attempt ${attempt}: ${message}`);
      const delay = Math.min(configured.maxDelayMs, configured.baseDelayMs * (2 ** (attempt - 1)));
      if (delay > 0) await configured.sleep(delay);
    }
  }
  throw new Error('Unreachable transient retry state');
}

export class RetryingEvidenceSourceAdapter implements EvidenceSourceAdapter {
  readonly database: string;
  private readonly policy: RetryPolicy;

  constructor(
    private readonly inner: EvidenceSourceAdapter,
    policy: RetryPolicy = {},
  ) {
    this.database = inner.database;
    // Official research APIs do occasionally return brief bursts of 429/5xx.
    // Five bounded attempts are still fast enough for interactive use while
    // avoiding the previous ~1.2 s transient-failure window that was too short
    // for real source incidents. Logical/scientific-integrity errors never retry.
    this.policy = policy;
  }

  async execute(strategy: SearchStrategy): Promise<{ records: EvidenceRecord[]; provenance: SearchProvenance }> {
    const recovered = await retryTransientOperation(() => this.inner.execute(strategy), this.policy);
    if (recovered.failures.length === 0) return recovered.value;
    return {
      records: recovered.value.records,
      provenance: {
        ...recovered.value.provenance,
        warnings: [
          ...recovered.value.provenance.warnings,
          `Transient ${this.database} retrieval failure recovered after ${recovered.attempts} attempt(s): ${recovered.failures.join(' || ')}`,
        ],
      },
    };
  }
}
