import { createHash } from 'node:crypto';

const SECRET_KEYS = new Set([
  'authorization',
  'password',
  'secret',
  'apikey',
  'xapikey',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'bearer',
  'cookie',
  'setcookie',
  'sessionsecret',
  'clientsecret',
]);

const VOLATILE_KEYS = new Set([
  'runid',
  'packageid',
  'createdat',
  'updatedat',
  'startedat',
  'completedat',
  'observedat',
  'timestamp',
  'retrievedat',
  'executedat',
  'testedat',
  'decidedat',
  'verifiedat',
  'submittedat',
  'publishedat',
  'finalisedat',
  'accessedat',
  'generatedat',
  'recordedat',
  'registeredat',
  'reviewerid',
]);

const EMBEDDED_RUN_CONTROL_KEYS = new Set([
  'scientificrunmanifest',
  'scientificrunseal',
  'scientificartifactlineage',
  'scientificrunledger',
]);

function normalizedKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isSecretKey(key: string): boolean {
  return SECRET_KEYS.has(normalizedKey(key));
}

function isVolatileKey(key: string): boolean {
  return VOLATILE_KEYS.has(normalizedKey(key));
}

function isEmbeddedRunControlKey(key: string): boolean {
  return EMBEDDED_RUN_CONTROL_KEYS.has(normalizedKey(key));
}

function finiteNumber(value: number): number | string {
  if (Number.isNaN(value)) return '[NaN]';
  if (value === Number.POSITIVE_INFINITY) return '[Infinity]';
  if (value === Number.NEGATIVE_INFINITY) return '[-Infinity]';
  if (Object.is(value, -0)) return 0;
  return value;
}

function project(
  value: unknown,
  options: { omitVolatile: boolean },
  seen: WeakSet<object>,
): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return finiteNumber(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (value instanceof Date) return options.omitVolatile ? '[DATE]' : value.toISOString();

  if (Array.isArray(value)) {
    return value.map((item) => {
      const projected = project(item, options, seen);
      return projected === undefined ? null : projected;
    });
  }

  if (typeof value === 'object') {
    const object = value as Record<string, unknown>;
    if (seen.has(object)) throw new Error('Scientific canonicalization does not permit cyclic values.');
    seen.add(object);
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(object).sort()) {
      if (isSecretKey(key)) {
        output[key] = '[REDACTED]';
        continue;
      }
      if (options.omitVolatile && (isVolatileKey(key) || isEmbeddedRunControlKey(key))) continue;
      const projected = project(object[key], options, seen);
      if (projected !== undefined) output[key] = projected;
    }
    seen.delete(object);
    return output;
  }

  return String(value);
}

/** Stable, secret-safe projection that preserves operational metadata. */
export function canonicalScientificValue(value: unknown): unknown {
  return project(value, { omitVolatile: false }, new WeakSet<object>());
}

/**
 * Stable scientific-content projection. Operational timestamps, run/package IDs,
 * reviewer identity and embedded run-control appendices are omitted while
 * substantive evidence, decisions, credential references and target definitions
 * remain. Excluding embedded run controls prevents a report carrying its own
 * manifest/seal from recursively changing its scientific content hash.
 */
export function scientificContentValue(value: unknown): unknown {
  return project(value, { omitVolatile: true }, new WeakSet<object>());
}

export function canonicalScientificJson(value: unknown): string {
  return JSON.stringify(canonicalScientificValue(value));
}

export function scientificContentJson(value: unknown): string {
  return JSON.stringify(scientificContentValue(value));
}

export function scientificHash(value: unknown): string {
  return createHash('sha256').update(canonicalScientificJson(value)).digest('hex');
}

export function scientificContentHash(value: unknown): string {
  return createHash('sha256').update(scientificContentJson(value)).digest('hex');
}

export function containsRawSecretField(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsRawSecretField);
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => {
    if (isSecretKey(key)) return child !== '[REDACTED]' && child !== undefined && child !== null && child !== '';
    return containsRawSecretField(child);
  });
}
