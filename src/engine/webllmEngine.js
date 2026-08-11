// webllmEngine.js — WebLLM (MLC AI) engine for high-quality chat, generation,
// and tool-calling in the browser. Provides an OpenAI-compatible interface
// using WebGPU-compiled model artifacts.
//
// Supports Phi-4-mini (3.8B), Llama 3.2 3B, Qwen 2.5 3B, Gemma 3 4B,
// and Llama 3.1 8B via precompiled WebGPU artifacts.
//
// Models download once and cache in the browser's Cache API / IndexedDB.

import MODEL_CATALOG from "../data/localModels.json";

let engineModule = null;
let chatModule = null;
let loadedModelId = null;
let loadProgress = null;
let loadPromise = null;

// --- engine availability ---------------------------------------------------

export async function isWebLLMAvailable() {
  if (typeof navigator === "undefined") return false;
  if (!navigator.gpu) return false;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    return !!adapter;
  } catch {
    return false;
  }
}

// --- model catalog ---------------------------------------------------------

export function getWebLLMModels() {
  return MODEL_CATALOG.models.webllm || [];
}

export function getWebLLMModel(id) {
  return getWebLLMModels().find((m) => m.id === id);
}

const STORAGE_KEY = "medantir.webllm.model.v1";

export function selectedWebLLMModel() {
  try {
    return localStorage.getItem(STORAGE_KEY) || "Phi-4-mini";
  } catch {
    return "Phi-4-mini";
  }
}

export function setSelectedWebLLMModel(id) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* storage unavailable */
  }
}

// --- progress tracking -----------------------------------------------------

export function getLoadProgress() {
  return loadProgress;
}

export function isModelLoaded(modelId) {
  return chatModule !== null && loadedModelId === (modelId || selectedWebLLMModel());
}

// --- model loading ---------------------------------------------------------

export async function loadModel(modelId, { onProgress } = {}) {
  const id = modelId || selectedWebLLMModel();
  if (chatModule && loadedModelId === id) return chatModule;
  if (loadPromise) return loadPromise;

  const info = getWebLLMModel(id);
  if (!info) throw new Error(`Unknown WebLLM model: ${id}`);

  loadProgress = { stage: "loading", progress: 0 };
  onProgress?.(loadProgress);

  loadPromise = (async () => {
    try {
      if (!engineModule) {
        engineModule = await import("@mlc-ai/web-llm");
      }

      onProgress?.({ stage: "downloading", progress: 0 });

      const newChatModule = new engineModule.ChatModule();

      // Progress callback during model loading
      const progressCallback = (report) => {
        if (report.progress !== undefined) {
          onProgress?.({ stage: "downloading", progress: Math.round(report.progress * 100) });
        }
      };

      await newChatModule.reload(info.engineId, undefined, {
        log_level: "WARN",
        progress_callback: progressCallback,
      });

      // Unload previous model
      if (chatModule && loadedModelId !== id) {
        try { await chatModule.unload(); } catch { /* ignore */ }
      }

      chatModule = newChatModule;
      loadedModelId = id;
      loadProgress = { stage: "ready", progress: 100 };
      onProgress?.(loadProgress);
      return chatModule;
    } catch (err) {
      loadProgress = { stage: "error", error: String(err.message || err) };
      onProgress?.(loadProgress);
      throw err;
    } finally {
      loadPromise = null;
    }
  })();

  return loadPromise;
}

// --- chat completion (OpenAI-compatible) -----------------------------------

/**
 * Generate a chat completion. Returns { text: string, finishReason: string }.
 * Supports streaming via the callback.
 */
export async function chatCompletion(messages, { modelId, temperature = 0.7, maxTokens = 1024, stream, onChunk } = {}) {
  const mod = await loadModel(modelId);

  if (stream && onChunk) {
    // Streaming mode
    let fullText = "";
    const stream = await mod.chat.completions.create({
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: true,
    });
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content || "";
      if (delta) {
        fullText += delta;
        onChunk(delta, fullText);
      }
    }
    return { text: fullText, finishReason: "stop" };
  }

  // Non-streaming
  const response = await mod.chat.completions.create({
    messages,
    temperature,
    max_tokens: maxTokens,
  });

  const choice = response.choices?.[0];
  return {
    text: choice?.message?.content || "",
    finishReason: choice?.finish_reason || "stop",
    usage: response.usage,
  };
}

/**
 * Simple prompt completion — wraps a single user prompt in chat messages.
 */
export async function complete(prompt, { modelId, systemPrompt, temperature, maxTokens, stream, onChunk } = {}) {
  const messages = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
  messages.push({ role: "user", content: prompt });
  return chatCompletion(messages, { modelId, temperature, maxTokens, stream, onChunk });
}

// --- structured JSON generation -------------------------------------------

/**
 * Generate structured JSON from a prompt. Parses the response and returns
 * the parsed object. Returns null on parse failure.
 */
export async function generateJSON(prompt, { modelId, systemPrompt, temperature } = {}) {
  const sys = (systemPrompt || "") + "\nRespond ONLY with valid JSON. No markdown, no explanation.";
  const result = await complete(prompt, { modelId, systemPrompt: sys, temperature: temperature || 0.2 });
  try {
    const match = result.text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

// --- tool/function calling ------------------------------------------------

/**
 * Chat completion with tool definitions. Returns { text, toolCalls }.
 */
export async function chatWithTools(messages, tools, { modelId, temperature = 0.2 } = {}) {
  const mod = await loadModel(modelId);
  const response = await mod.chat.completions.create({
    messages,
    tools,
    temperature,
  });

  const choice = response.choices?.[0];
  return {
    text: choice?.message?.content || "",
    toolCalls: choice?.message?.tool_calls || [],
    finishReason: choice?.finish_reason || "stop",
  };
}

// --- cleanup ---------------------------------------------------------------

export async function dispose() {
  if (chatModule) {
    try { await chatModule.unload(); } catch { /* ignore */ }
    chatModule = null;
    loadedModelId = null;
  }
}
