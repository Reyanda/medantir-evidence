// taskRouter.js — Smart routing layer: decides whether a task runs locally
// (embedded LLM across Gemini Nano / Transformers.js / WebLLM) or via an
// API provider. Returns structured results with `source` metadata.
//
// Cascade: local engines → cheap API (GLM/Ollama) → premium API (Claude/GPT)
// User can override per-task: "local" | "api" | "auto" (default).

import { infer, engineStatus, classifyBatch } from "./localInference.js";
import { callProvider, enabledProviders, PROVIDER_BY_ID } from "./providers.js";

// --- task definitions ------------------------------------------------------

const TASKS = {
  sentiment:       { category: "local-preferred", description: "Score media/news sentiment" },
  "tiab-screening":{ category: "local-preferred", description: "Title/abstract include/exclude screening" },
  "document-classify": { category: "local-preferred", description: "Classify document domain/topic" },
  summarize:       { category: "local-preferred", description: "Compress text summary" },
  rank:            { category: "local-preferred", description: "Semantic similarity ranking" },
  "extract-entities": { category: "local-preferred", description: "Quick named entity extraction" },
  "query-route":    { category: "local-preferred", description: "Route query to handler" },
  chat:            { category: "local-preferred", description: "General-purpose chat" },
  generate:        { category: "local-preferred", description: "General text generation" },
  code:            { category: "local-preferred", description: "Code generation and debugging" },
  // Systematic review tasks — routed to local engines by default
  "extract-pico":    { category: "local-preferred", description: "Extract PICO from review question" },
  "generate-eligibility": { category: "local-preferred", description: "Generate eligibility criteria from PICO" },
  "fulltext-screening": { category: "local-preferred", description: "Full-text eligibility screening" },
  "extract-data":    { category: "local-preferred", description: "Extract structured study data" },
  "assess-rob":      { category: "local-preferred", description: "Risk of bias assessment (RoB 2 / ROBINS-I)" },
  "synthesize":      { category: "local-preferred", description: "Narrative evidence synthesis" },
  "grade-assessment": { category: "local-preferred", description: "GRADE certainty assessment" },
  "generate-prisma": { category: "local-preferred", description: "PRISMA flow diagram numbers" },
  // API-only tasks
  "deep-reasoning": { category: "api-only", description: "Multi-step reasoning, causal inference, GRADE" },
  architecture:    { category: "api-only", description: "System design decisions" },
  security:        { category: "api-only", description: "Security analysis and threat modeling" },
};

// --- user preferences ------------------------------------------------------

const PREF_KEY = "medantir.taskRouter.prefs.v1";

function loadPrefs() { try { return JSON.parse(localStorage.getItem(PREF_KEY) || "{}"); } catch { return {}; } }
function savePrefs(p) { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* */ } }

export function getTaskPreference(taskId) { return loadPrefs()[taskId] || null; }
export function setTaskPreference(taskId, pref) {
  const p = loadPrefs();
  if (pref) p[taskId] = pref; else delete p[taskId];
  savePrefs(p);
}
export function getAllTaskPreferences() { return loadPrefs(); }

// --- routing ---------------------------------------------------------------

export function routeTask(taskId) {
  const task = TASKS[taskId];
  if (!task) return { route: "api", reason: "unknown-task" };
  const pref = getTaskPreference(taskId);
  if (pref === "local") return { route: "local", reason: "user-preference" };
  if (pref === "api") return { route: "api", reason: "user-preference" };
  if (task.category === "api-only") return { route: "api", reason: "api-only-task" };
  return { route: "local", reason: "auto-local" };
}

// --- execution -------------------------------------------------------------

/**
 * Execute a task through the optimal route.
 * Returns { result, source: "local"|"api", engine: string, latencyMs: number }
 */
export async function executeTask(taskId, input, opts = {}) {
  const route = routeTask(taskId);
  const task = TASKS[taskId];
  const start = performance.now();

  if (route.route === "local") {
    try {
      const { result, engine, error } = await infer(taskId, input, opts);
      if (result !== null) {
        return { result, source: "local", engine, latencyMs: performance.now() - start };
      }
      // Local engine returned null — fall through to API
      if (task?.category === "local-preferred") {
        const apiResult = await runAPI(taskId, input, opts);
        return { result: apiResult, source: "api", engine: "local-fallback-api", latencyMs: performance.now() - start };
      }
      throw new Error(error || "Local inference returned null");
    } catch (err) {
      // Local failed — try API fallback for local-preferred tasks
      if (task?.category === "local-preferred") {
        try {
          const apiResult = await runAPI(taskId, input, opts);
          return { result: apiResult, source: "api", engine: `local-failed:${err.message}`, latencyMs: performance.now() - start };
        } catch { /* both failed */ }
      }
      throw err;
    }
  }

  // API route
  const result = await runAPI(taskId, input, opts);
  return { result, source: "api", engine: "api", latencyMs: performance.now() - start };
}

/**
 * Batch classify texts (TIAB screening). Uses Transformers.js directly
 * for efficiency — no per-item API overhead.
 */
export async function executeBatchClassify(texts, opts = {}) {
  const start = performance.now();
  try {
    const results = await classifyBatch(texts, opts);
    return { results, source: "local", engine: "transformers", latencyMs: performance.now() - start };
  } catch (err) {
    // Fall back to API
    const apiResults = await Promise.all(texts.map((t) => runAPI("classify", t, opts)));
    return { results: apiResults, source: "api", engine: "api", latencyMs: performance.now() - start };
  }
}

async function runAPI(taskId, input, opts) {
  const text = typeof input === "string" ? input : JSON.stringify(input);
  const task = TASKS[taskId];
  const messages = [
    { role: "system", content: task?.description || `Execute task: ${taskId}` },
    { role: "user", content: text },
  ];
  const candidates = opts.providerId ? [opts.providerId] : enabledProviders().map((p) => p.id);
  const providers = candidates.filter((id) => PROVIDER_BY_ID[id]?.shape !== "local");
  if (providers.length === 0) throw new Error("No API provider available");
  let lastError;
  for (const id of providers) {
    try {
      return await callProvider(id, messages, { json: opts.json });
    } catch (e) { lastError = e; }
  }
  throw lastError || new Error("All API providers failed");
}

// --- status & registry -----------------------------------------------------

export async function getLocalStatus() {
  return engineStatus();
}

export function listTasks() {
  return Object.entries(TASKS).map(([id, task]) => ({
    id, ...task, route: routeTask(id), pref: getTaskPreference(id),
  }));
}

export function getTask(id) { return TASKS[id] || null; }
