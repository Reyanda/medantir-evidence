// localInference.js — Multi-engine local LLM orchestrator.
//
// Routes tasks across three engines based on the July 2026 landscape:
//   1. Chrome Gemini Nano — zero-download, free, best for summarization/rewriting
//   2. Transformers.js (ONNX) — task pipelines: classification, embeddings, QA, sentiment
//   3. WebLLM (MLC) — high-quality chat, generation, code, tool-calling (3-8B models)
//
// The cascade tries engines in order: Gemini Nano → Transformers → WebLLM → API fallback.
// Each engine loads on demand and caches in browser storage.

import MODEL_CATALOG from "../data/localModels.json";
import * as geminiNano from "./geminiNanoProvider.js";

// --- device / capability state ---------------------------------------------

let device = null;
let transformersPipeline = null;
let transformersLoaded = null; // { modelId, pipelineType }

// --- device detection ------------------------------------------------------

export async function detectDevice() {
  if (device) return device;
  if (typeof navigator !== "undefined" && navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) { device = "webgpu"; return device; }
    } catch { /* not available */ }
  }
  device = "wasm";
  return device;
}

export function isWebGPUSupported() {
  return typeof navigator !== "undefined" && !!navigator.gpu;
}

// --- model selection -------------------------------------------------------

const TRANSFORMERS_KEY = "medantir.localModel.transformers.v1";
const WEBLLM_KEY = "medantir.localModel.webllm.v1";

export function selectedTransformersModel() {
  try { return localStorage.getItem(TRANSFORMERS_KEY) || MODEL_CATALOG.defaultModelId; }
  catch { return MODEL_CATALOG.defaultModelId; }
}

export function setSelectedTransformersModel(id) {
  try { localStorage.setItem(TRANSFORMERS_KEY, id); } catch { /* */ }
}

export function selectedWebLLMModel() {
  try { return localStorage.getItem(WEBLLM_KEY) || "Phi-4-mini"; }
  catch { return "Phi-4-mini"; }
}

export function setSelectedWebLLMModel(id) {
  try { localStorage.setItem(WEBLLM_KEY, id); } catch { /* */ }
}

// --- engine availability checks -------------------------------------------

export async function engineStatus() {
  const dev = await detectDevice();
  const geminiReady = await geminiNano.isAvailable();
  let webllmReady = false;
  try {
    const webllm = await import("./webllmEngine.js");
    webllmReady = await webllm.isWebLLMAvailable();
  } catch { /* not loaded */ }

  return {
    device: dev,
    geminiNano: geminiReady ? "ready" : "unavailable",
    webllm: webllmReady ? "ready" : "unavailable",
    transformers: "ready", // always available (WASM fallback)
    selectedTransformers: selectedTransformersModel(),
    selectedWebLLM: selectedWebLLMModel(),
  };
}

// --- Transformers.js engine ------------------------------------------------

async function loadTransformersPipeline(pipelineType, modelId, { onProgress } = {}) {
  const id = modelId || selectedTransformersModel();
  const dev = await detectDevice();

  // Already loaded
  if (transformersLoaded?.modelId === id && transformersLoaded?.pipelineType === pipelineType) {
    return transformersPipeline;
  }

  onProgress?.({ stage: "loading-transformers", progress: 0 });

  if (!transformersPipeline) {
    const mod = await import("@huggingface/transformers");
    transformersPipeline = mod.pipeline;
  }

  const info = MODEL_CATALOG.models.transformers?.find((m) => m.id === id);
  if (!info) throw new Error(`Unknown Transformers model: ${id}`);

  const pipe = await transformersPipeline(pipelineType, info.hfId, {
    device: dev,
    dtype: dev === "webgpu" ? "fp16" : "q8",
    progress_callback: (p) => {
      if (p.status === "progress") onProgress?.({ stage: "downloading", progress: p.progress || 0 });
      if (p.status === "done") onProgress?.({ stage: "ready", progress: 100 });
    },
  });

  // Dispose old pipeline if model changed
  if (transformersLoaded && (transformersLoaded.modelId !== id || transformersLoaded.pipelineType !== pipelineType)) {
    try { /* no dispose API for pipeline, just replace */ } catch { /* */ }
  }

  transformersPipeline = pipe;
  transformersLoaded = { modelId: id, pipelineType };
  return pipe;
}

// --- WebLLM engine ---------------------------------------------------------

async function webllmComplete(prompt, { modelId, systemPrompt, maxTokens, temperature, onProgress, stream, onChunk } = {}) {
  const webllm = await import("./webllmEngine.js");
  const messages = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push({ role: "user", content: prompt });

  const mod = await webllm.loadModel(modelId, { onProgress });
  if (stream && onChunk) {
    let fullText = "";
    const s = await mod.chat.completions.create({ messages, temperature: temperature || 0.7, max_tokens: maxTokens || 1024, stream: true });
    for await (const chunk of s) {
      const delta = chunk.choices?.[0]?.delta?.content || "";
      if (delta) { fullText += delta; onChunk(delta, fullText); }
    }
    return { text: fullText };
  }
  const result = await mod.chat.completions.create({ messages, temperature: temperature || 0.7, max_tokens: maxTokens || 1024 });
  return { text: result.choices?.[0]?.message?.content || "" };
}

// --- Gemini Nano engine ----------------------------------------------------

async function geminiComplete(prompt, { systemPrompt, maxTokens, onProgress, stream, onChunk } = {}) {
  if (stream && onChunk) {
    return geminiNano.generateStreaming(prompt, { systemPrompt, maxTokens, onChunk, onProgress });
  }
  return geminiNano.generate(prompt, { systemPrompt, maxTokens, onProgress });
}

// --- unified inference API -------------------------------------------------

/**
 * Detect which engine should handle a task, then run it.
 * Returns { result: any, engine: string, latencyMs: number }.
 */
export async function infer(taskType, input, opts = {}) {
  const start = performance.now();
  const onProgress = opts?.onProgress;
  const text = typeof input === "string" ? input : JSON.stringify(input);

  try {
    const result = await inferWithCascade(taskType, text, opts);
    return { result, engine: result._engine || "local", latencyMs: performance.now() - start };
  } catch (err) {
    return { result: null, engine: "failed", error: String(err.message), latencyMs: performance.now() - start };
  }
}

async function inferWithCascade(taskType, text, opts) {
  const onProgress = opts.onProgress;

  // --- sentiment / classification → Transformers.js ---
  if (taskType === "sentiment" || taskType === "classify" || taskType === "tiab-screening" || taskType === "query-route") {
    const pipe = await loadTransformersPipeline("text-classification", opts.modelId, { onProgress });
    const result = await pipe(text, { topk: 3 });
    const top = Array.isArray(result) ? result[0] : result;
    return { label: (top.label || "neutral").toLowerCase(), score: top.score || 0.5, all: Array.isArray(result) ? result : [top], _engine: "transformers" };
  }

  // --- embeddings / ranking → Transformers.js ---
  if (taskType === "rank" || taskType === "embed") {
    const pipe = await loadTransformersPipeline("feature-extraction", opts.modelId, { onProgress });
    const result = await pipe(text, { pooling: "cls", normalize: true });
    return { embeddings: result?.data || result, _engine: "transformers" };
  }

  // --- QA → Transformers.js ---
  if (taskType === "qa") {
    const { question, context } = typeof opts.input === "object" ? opts.input : { question: text, context: "" };
    const pipe = await loadTransformersPipeline("question-answering", opts.modelId, { onProgress });
    const result = await pipe(question, context);
    return { answer: result?.answer || "", score: result?.score || 0, _engine: "transformers" };
  }

  // --- summarization → Gemini Nano (free) → Transformers fallback ---
  if (taskType === "summarize") {
    // Try Gemini Nano first (free, zero-download)
    if (opts.forceEngine !== "transformers") {
      try {
        if (await geminiNano.isAvailable()) {
          const result = await geminiComplete(`Summarize concisely:\n\n${text}\n\nSummary:`, { maxTokens: opts.maxTokens || 200, onProgress });
          return { summary: result.text, _engine: "gemini-nano" };
        }
      } catch { /* fall through */ }
    }
    // Transformers fallback — use text generation with a summarization prompt
    try {
      const pipe = await loadTransformersPipeline("text-generation", opts.modelId, { onProgress });
      const result = await pipe(`Summarize concisely:\n\n${text}\n\nSummary:`, { max_new_tokens: opts.maxTokens || 200 });
      const text_ = Array.isArray(result) ? result[0]?.generated_text || "" : result?.generated_text || "";
      return { summary: text_, _engine: "transformers" };
    } catch { /* fall through to WebLLM */ }
  }

  // --- chat / generation / code → WebLLM (3-8B) → Gemini Nano fallback ---
  if (taskType === "chat" || taskType === "generate" || taskType === "code" || taskType === "reasoning") {
    // Try WebLLM first (best quality for generation)
    try {
      const webllmAvail = await import("./webllmEngine.js").then((m) => m.isWebLLMAvailable());
      if (webllmAvail) {
        const systemPrompt = taskType === "code" ? "You are a helpful coding assistant." : taskType === "reasoning" ? "You are a careful reasoning assistant. Think step by step." : "You are a helpful assistant.";
        const result = await webllmComplete(text, { systemPrompt, maxTokens: opts.maxTokens || 1024, onProgress, stream: !!opts.onChunk, onChunk: opts.onChunk });
        return { text: result.text, _engine: "webllm" };
      }
    } catch { /* fall through */ }

    // Gemini Nano fallback
    try {
      if (await geminiNano.isAvailable()) {
        const result = await geminiComplete(text, { maxTokens: opts.maxTokens || 512, onProgress, stream: !!opts.onChunk, onChunk: opts.onChunk });
        return { text: result.text, _engine: "gemini-nano" };
      }
    } catch { /* fall through */ }

    // Transformers.js fallback (smallest model)
    try {
      const pipe = await loadTransformersPipeline("text-generation", opts.modelId, { onProgress });
      const result = await pipe(text, { max_new_tokens: opts.maxTokens || 512 });
      const text_ = Array.isArray(result) ? result[0]?.generated_text || "" : result?.generated_text || "";
      return { text: text_, _engine: "transformers" };
    } catch { /* no engine available */ }
  }

  // --- entity extraction → Transformers.js ---
  if (taskType === "extract-entities") {
    const pipe = await loadTransformersPipeline("text-generation", opts.modelId, { onProgress });
    const prompt = `Extract named entities (people, organizations, locations, dates). Return JSON array with "text" and "type" fields.\n\nText: ${text}\n\nEntities:`;
    const result = await pipe(prompt, { max_new_tokens: opts.maxTokens || 150 });
    const text_ = Array.isArray(result) ? result[0]?.generated_text || "" : result?.generated_text || "";
    return { text: text_, _engine: "transformers" };
  }

  // --- unknown task: try text generation ---
  try {
    const pipe = await loadTransformersPipeline("text-generation", opts.modelId, { onProgress });
    const result = await pipe(text, { max_new_tokens: opts.maxTokens || 256 });
    const text_ = Array.isArray(result) ? result[0]?.generated_text || "" : result?.generated_text || "";
    return { text: text_, _engine: "transformers" };
  } catch (err) {
    throw new Error(`No engine available for task: ${taskType}`);
  }
}

// --- batch classification (for TIAB screening) ----------------------------

export async function classifyBatch(texts, { modelId, onProgress, batchSize = 8 } = {}) {
  const pipe = await loadTransformersPipeline("text-classification", modelId, { onProgress });
  const results = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map((t) => pipe(t, { topk: 3 })));
    for (const r of batchResults) {
      const top = Array.isArray(r) ? r[0] : r;
      results.push({ label: (top.label || "unknown").toLowerCase(), score: top.score || 0 });
    }
    onProgress?.({ processed: Math.min(i + batchSize, texts.length), total: texts.length });
  }
  return results;
}

// --- cleanup ---------------------------------------------------------------

export async function disposeAll() {
  if (transformersPipeline?.dispose) { try { await transformersPipeline.dispose(); } catch { /* */ } }
  transformersPipeline = null;
  transformersLoaded = null;
  try { const w = await import("./webllmEngine.js"); await w.dispose(); } catch { /* */ }
  geminiNano.dispose();
}
