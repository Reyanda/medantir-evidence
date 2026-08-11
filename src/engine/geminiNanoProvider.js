// geminiNanoProvider.js — Chrome's built-in Gemini Nano model via the
// Prompt API (ai.languageModel namespace). Zero-download, fully local,
// available in Chrome 137+ when the on-device model component is present.
//
// Supports: text generation, summarization, rewriting, translation,
// proofreading, and general chat.
//
// Falls back silently when the API is unavailable (non-Chrome, older
// versions, or model not yet downloaded).

let availability = null;

// --- availability detection ------------------------------------------------

/**
 * Check if Gemini Nano is available in this browser.
 * Returns: "unavailable" | "downloadable" | "downloading" | "ready"
 */
export async function checkAvailability() {
  if (availability !== null) return availability;

  if (typeof ai === "undefined" || !ai.languageModel) {
    availability = "unavailable";
    return availability;
  }

  try {
    availability = await ai.languageModel.availability();
    return availability;
  } catch {
    availability = "unavailable";
    return availability;
  }
}

/**
 * Returns true if Gemini Nano is ready to use right now.
 */
export async function isAvailable() {
  const status = await checkAvailability();
  return status === "ready";
}

// --- session management ----------------------------------------------------

let session = null;
let sessionPromise = null;

/**
 * Create or reuse a language model session.
 * Downloads the model on first use if needed.
 */
async function getSession({ systemPrompt, onProgress } = {}) {
  if (session) return session;

  if (sessionPromise) return sessionPromise;

  sessionPromise = (async () => {
    try {
      onProgress?.({ stage: "initializing" });

      const config = {};
      if (systemPrompt) config.systemPrompt = systemPrompt;

      // The Prompt API creates a session; if the model needs downloading,
      // it will download automatically and report progress.
      const newSession = await ai.languageModel.create({
        ...config,
        topK: 40,
        temperature: 0.7,
      });

      session = newSession;
      onProgress?.({ stage: "ready" });
      return session;
    } catch (err) {
      onProgress?.({ stage: "error", error: String(err.message || err) });
      throw err;
    } finally {
      sessionPromise = null;
    }
  })();

  return sessionPromise;
}

// --- text generation -------------------------------------------------------

/**
 * Generate text from a prompt. Returns { text: string }.
 */
export async function generate(prompt, { systemPrompt, maxTokens, temperature, onProgress } = {}) {
  const sess = await getSession({ systemPrompt, onProgress });
  const opts = {};
  if (maxTokens) opts.maxOutputTokens = maxTokens;
  if (temperature !== undefined) opts.temperature = temperature;
  const result = await sess.prompt(prompt, opts);
  return { text: result };
}

/**
 * Streaming generation. Calls onChunk(deltaText, fullText) for each token.
 * Returns the final { text: string }.
 */
export async function generateStreaming(prompt, { systemPrompt, maxTokens, temperature, onChunk, onProgress } = {}) {
  const sess = await getSession({ systemPrompt, onProgress });
  const opts = {};
  if (maxTokens) opts.maxOutputTokens = maxTokens;
  if (temperature !== undefined) opts.temperature = temperature;

  const stream = await sess.promptStreaming(prompt, opts);
  let fullText = "";

  for await (const chunk of stream) {
    fullText += chunk;
    onChunk?.(chunk, fullText);
  }

  return { text: fullText };
}

// --- specialized tasks (Chrome Prompt API built-in) ------------------------

/**
 * Summarize text using the built-in summarizer if available, otherwise
 * falls back to generate with a summarization prompt.
 */
export async function summarize(text, { maxTokens = 150, onProgress } = {}) {
  // Try the built-in Summarizer API first
  if (typeof ai !== "undefined" && ai.summarizer) {
    try {
      const summarizer = await ai.summarizer.create({ type: "tl;dr", format: "plain-text" });
      const result = await summarizer.summarize(text);
      summarizer.destroy();
      return { summary: result, method: "built-in" };
    } catch {
      // Fall through to prompt-based
    }
  }
  const result = await generate(`Summarize concisely:\n\n${text}\n\nSummary:`, { maxTokens, onProgress });
  return { summary: result.text, method: "prompt" };
}

/**
 * Rewrite text for a target audience/style.
 */
export async function rewrite(text, { style = "formal", maxTokens, onProgress } = {}) {
  const result = await generate(`Rewrite this text in a ${style} tone:\n\n${text}\n\nRewritten:`, { maxTokens, onProgress });
  return { text: result.text };
}

/**
 * Translate text to a target language.
 */
export async function translate(text, { targetLanguage = "English", maxTokens, onProgress } = {}) {
  const result = await generate(`Translate to ${targetLanguage}:\n\n${text}\n\nTranslation:`, { maxTokens, onProgress });
  return { text: result.text };
}

/**
 * Proofread and correct text.
 */
export async function proofread(text, { maxTokens, onProgress } = {}) {
  const result = await generate(`Proofread and correct this text. Fix grammar, spelling, and clarity. Return only the corrected text:\n\n${text}\n\nCorrected:`, { maxTokens, onProgress });
  return { text: result.text };
}

// --- chat ------------------------------------------------------------------

/**
 * Chat completion with conversation history. Returns { text: string }.
 */
export async function chat(messages, { systemPrompt, maxTokens, temperature, onProgress } = {}) {
  const sess = await getSession({ systemPrompt, onProgress });
  // Gemini Nano prompt API uses a single prompt string, not message arrays
  // Format messages as a conversation transcript
  const formatted = messages.map((m) => `${m.role}: ${m.content}`).join("\n") + "\nassistant:";
  const opts = {};
  if (maxTokens) opts.maxOutputTokens = maxTokens;
  if (temperature !== undefined) opts.temperature = temperature;
  const result = await sess.prompt(formatted, opts);
  return { text: result };
}

// --- cleanup ---------------------------------------------------------------

export function dispose() {
  if (session) {
    try { session.destroy(); } catch { /* ignore */ }
    session = null;
  }
}

// --- status ----------------------------------------------------------------

export function getStatus() {
  return {
    available: availability === "ready",
    availability,
    sessionActive: !!session,
  };
}
