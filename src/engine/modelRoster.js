// modelRoster.js — several models screening the same records at once, each in
// its own sandbox, so their agreement can be measured instead of assumed.
//
// The rule the whole file exists to keep: a sandbox NEVER writes a canonical
// decision. review.objects.records[].tiab stays the operator's (or the promoted
// run's); every model's opinion lives under review.objects.sandboxes[runnerId].
// Concordance is only meaningful while the runs are kept apart.
//
// The statistics are the standard ones for categorical agreement: observed
// agreement, Cohen's kappa for two raters, Fleiss' kappa for three or more, and
// — where a reference exists — sensitivity, specificity and accuracy against it.

import { callOpenAIRaw, PROVIDER_BY_ID, providerStatus } from "./providers.js";
import { DECISIONS } from "./concordanceStats.js";

export * from "./concordanceStats.js";

const ROSTER_KEY = "medantir.modelRoster.v1";

// --- roster ----------------------------------------------------------------

export function loadRoster() {
  try {
    const raw = JSON.parse(localStorage.getItem(ROSTER_KEY) || "[]");
    return Array.isArray(raw) ? raw.map(normaliseRunner).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function saveRoster(runners) {
  try { localStorage.setItem(ROSTER_KEY, JSON.stringify(runners.map(normaliseRunner).filter(Boolean))); } catch { /* storage disabled */ }
  return loadRoster();
}

function normaliseRunner(r) {
  if (!r?.providerId || !r?.model) return null;
  return {
    id: r.id || `${r.providerId}:${r.model}`,
    label: r.label || `${PROVIDER_BY_ID[r.providerId]?.label || r.providerId} · ${r.model}`,
    providerId: r.providerId,
    model: String(r.model),
    enabled: r.enabled !== false,
    temperature: Number.isFinite(r.temperature) ? r.temperature : 0,
  };
}

export function addRunner(runner) {
  const roster = loadRoster();
  const next = normaliseRunner(runner);
  if (!next) return roster;
  if (roster.some((r) => r.id === next.id)) return roster;
  return saveRoster([...roster, next]);
}

export function removeRunner(id) {
  return saveRoster(loadRoster().filter((r) => r.id !== id));
}

export function runnerReady(runner) {
  const status = providerStatus(runner.providerId);
  if (!status) return { ok: false, reason: "unknown provider" };
  if (status.shape === "local") return { ok: false, reason: "in-browser engine cannot be pinned to a named model" };
  if (!status.hasKey) return { ok: false, reason: "no key in the vault" };
  if (!status.enabled) return { ok: false, reason: "provider disabled" };
  return { ok: true };
}

// --- one runner screening one record ---------------------------------------

const PROMPT = (eligibility, record) =>
  `You are screening a record for a systematic review. Judge it against the eligibility criteria only.\n\n` +
  `Eligibility:\n${eligibility || "(none recorded)"}\n\n` +
  `Record:\nTitle: ${record.title || ""}\nAbstract: ${String(record.abstract || "").slice(0, 4000)}\n\n` +
  `Return ONLY valid JSON: {"decision":"include"|"exclude"|"uncertain","reason":"one sentence","confidence":0.0-1.0}`;

function parseDecision(text) {
  const raw = String(text || "");
  const match = raw.match(/\{[\s\S]*\}/);
  let parsed = {};
  try { parsed = match ? JSON.parse(match[0]) : {}; } catch { parsed = {}; }
  const decision = DECISIONS.includes(parsed.decision) ? parsed.decision : "uncertain";
  const confidence = Number.isFinite(Number(parsed.confidence)) ? Math.max(0, Math.min(1, Number(parsed.confidence))) : null;
  return { decision, reason: String(parsed.reason || "").slice(0, 400), confidence, parsed: !!match };
}

export async function screenWithRunner(runner, record, eligibility) {
  const started = Date.now();
  try {
    const response = await callOpenAIRaw(runner.providerId, {
      messages: [{ role: "user", content: PROMPT(eligibility, record) }],
      temperature: runner.temperature ?? 0,
      model: runner.model,
    });
    const text = response?.choices?.[0]?.message?.content ?? "";
    const out = parseDecision(text);
    return { ...out, runnerId: runner.id, recordId: record.id, ms: Date.now() - started, ok: true };
  } catch (e) {
    // A failed call is recorded as a failure, never as an "uncertain" vote — a
    // model that could not answer must not dilute the agreement statistics.
    return { runnerId: runner.id, recordId: record.id, ok: false, error: String(e.message || e), ms: Date.now() - started };
  }
}

// --- parallel sandboxes ----------------------------------------------------

async function mapLimited(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      out[index] = await worker(items[index], index);
    }
  });
  await Promise.all(lanes);
  return out;
}

/**
 * Every enabled runner screens every record. Runners go in parallel; records
 * within a runner are throttled so one lane cannot exhaust a rate limit for the
 * others. Results come back keyed by runner and are never merged.
 */
export async function runSandboxedScreening(records, eligibility, runners, { concurrency = 3, onProgress } = {}) {
  const active = runners.filter((r) => r.enabled !== false);
  if (!active.length) return { ok: false, reason: "No enabled runner in the roster", sandboxes: {} };
  if (!records.length) return { ok: false, reason: "No records to screen", sandboxes: {} };

  const total = active.length * records.length;
  let done = 0;
  const sandboxes = {};

  await Promise.all(active.map(async (runner) => {
    const results = await mapLimited(records, concurrency, async (record) => {
      const result = await screenWithRunner(runner, record, eligibility);
      done += 1;
      onProgress?.({ done, total, runner: runner.label, pct: Math.round((done / total) * 100) });
      return result;
    });
    sandboxes[runner.id] = {
      runner,
      at: Date.now(),
      results,
      failed: results.filter((r) => !r.ok).length,
      decided: results.filter((r) => r.ok).length,
    };
  }));

  return { ok: true, sandboxes, records: records.map((r) => r.id) };
}

