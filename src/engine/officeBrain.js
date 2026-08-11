// officeBrain.js — The Office sub-agent.
//
// "Is Hermes a better brain?" — the short answer we ship: for office work
// (structured email triage, drafting, calendar extraction) Hermes 4.3 is
// genuinely stronger than the platform default on function-calling and schema
// adherence (it is trained for exactly that, with <tool_call> parsing and JSON
// repair built in). It cannot run in-browser (36B > WebLLM's practical 3-8B
// ceiling), so it rides OpenRouter as a normal provider.
//
// This module routes office tasks to Hermes when it is configured, and falls
// back to the current orchestrator (the first ready OpenAI-tool provider)
// otherwise — so the office brain is never a dead end.

import { PROVIDER_BY_ID, callOpenAIRaw, providerStatus, activeToolProvider, providerKey } from "./providers.js";

export const HERMES_MODEL = "nousresearch/hermes-4.3-36b";

/** True when Hermes is reachable (direct key or via the OpenRouter key). */
export async function hermesAvailable() {
  const direct = providerStatus("hermes")?.ready;
  if (direct) return true;
  try {
    const orKey = await providerKey("openrouter");
    return Boolean(orKey);
  } catch { return false; }
}

/** Resolve the brain provider: Hermes first, then the platform orchestrator. */
export async function officeBrainProvider() {
  if (await hermesAvailable()) {
    const direct = providerStatus("hermes")?.ready;
    return { id: "hermes", model: HERMES_MODEL, label: "Hermes 4.3 (Nous)", direct: !!direct };
  }
  const fallback = activeToolProvider();
  if (fallback) return { id: fallback.id, model: fallback.model, label: fallback.label, direct: true };
  return null;
}

/**
 * Run one office task through the best available brain.
 * @param {string} prompt
 * @param {{ system?: string, json?: boolean, maxTokens?: number }} opts
 */
export async function officeThink(prompt, { system = "You are the Medantir Office sub-agent. Be concise, precise, and never invent data.", json = false, maxTokens = 900 } = {}) {
  const brain = await officeBrainProvider();
  if (!brain) return { ok: false, error: "No AI provider configured. Add a provider key in System → AI Providers.", brain: null };

  const messages = [{ role: "system", content: system }, { role: "user", content: prompt }];
  const useHermes = brain.id === "hermes";
  const providerId = useHermes ? (providerStatus("hermes")?.ready ? "hermes" : "openrouter") : brain.id;

  try {
    const data = await callOpenAIRaw(providerId, {
      messages,
      temperature: 0.3,
      // Hermes answers schema-faithful JSON natively; for other brains ask plainly.
      ...(json ? { tools: undefined, toolChoice: undefined } : {}),
    });
    let content = data.choices?.[0]?.message?.content ?? "";
    if (json) {
      const match = content.match(/\{[\s\S]*\}/);
      if (match) {
        try { content = JSON.parse(match[0]); }
        catch { content = { raw: content }; }
      }
    }
    return { ok: true, brain, content, model: useHermes ? HERMES_MODEL : (data.model || brain.model) };
  } catch (error) {
    return { ok: false, error: String(error?.message || error), brain };
  }
}

/** Triage an inbox: classify + priority + suggested action per message. */
export async function triageInbox(messages, { limit = 10 } = {}) {
  const slice = (messages || []).slice(0, limit);
  if (!slice.length) return { ok: true, brain: null, items: [], note: "Inbox is empty." };
  const prompt = [
    "Classify these email headers for an evidence-and-policy research office.",
    "Return JSON: { items: [ { id, category, priority (1-5), action, needsReply } ] }",
    "Categories: client, collaborator, funding, vendor, newsletter, internal, spam.",
    "",
    ...slice.map((m, i) => `${i + 1}. [${m.id}] from=${m.from} subject=${m.subject} date=${m.date} snippet=${(m.snippet || "").slice(0, 120)}`),
  ].join("\n");
  const result = await officeThink(prompt, { json: true, system: "You are an executive assistant triaging email. Never invent senders or subjects; work only from the list." });
  if (!result.ok) return result;
  const items = Array.isArray(result.content?.items) ? result.content.items : [];
  return { ok: true, brain: result.brain, items, note: items.length ? "" : "Could not parse triage output." };
}

/** Draft a reply to one message. */
export async function draftReply(message, { instructions = "" } = {}) {
  const prompt = [
    `Draft a professional reply to this email from ${message?.from || "the sender"}.`,
    `Subject: ${message?.subject || "(none)"}`,
    `Original: ${(message?.body || message?.snippet || "").slice(0, 1500)}`,
    instructions ? `Additional instructions: ${instructions}` : "",
    "Write the reply body only (no subject line, no salutation noise beyond a first line).",
  ].filter(Boolean).join("\n");
  return officeThink(prompt, { system: "You draft clear, warm, professional email replies for a research consultancy. Keep it under 180 words unless asked otherwise." });
}

/** Pull next actions from a set of projects + calendar into a short briefing. */
export async function dailyBriefing({ projects = [], events = [] } = {}) {
  const prompt = [
    "Produce a 6-line daily briefing for a research-office lead.",
    `Open projects: ${projects.slice(0, 12).map((p) => `${p.name} (${p.status})`).join("; ") || "none"}`,
    `Upcoming calendar: ${events.slice(0, 8).map((e) => `${e.title} @ ${new Date(e.start).toISOString()}`).join("; ") || "none"}`,
    "Format as plain text bullets. Flag anything time-critical.",
  ].join("\n");
  return officeThink(prompt, { system: "You are a precise operations assistant. Only use the data given." });
}

export { PROVIDER_BY_ID };
