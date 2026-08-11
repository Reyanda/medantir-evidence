// harness.js — the harness abstraction + meta-orchestrator.
//
// A HARNESS is a reusable capability bundle over the agent: a domain system
// prompt, a scoped tool set, relevant skills, an output kind, and a renderer.
// The orchestrator routes a task to the best harness and runs it — so the same
// shell becomes a scientific, coding, or social instrument depending on intent.
// (This is the layer inferno becomes: pluggable harnesses, orchestrated.)

export const HARNESSES = [
  {
    id: "scientific",
    name: "Scientific",
    color: "#14b8a6",
    icon: "flask",
    description: "Evidence synthesis, systematic review, meta-analysis, causal mapping.",
    systemPrompt:
      "You are a SCIENTIFIC evidence-synthesis harness. Search the literature, screen, extract effect estimates, run meta-analysis, and map causal evidence. Cite sources, calibrate every claim to the evidence, quantify uncertainty, and never fabricate. Prefer producing structured results (tables, effect estimates, visualisation specs).",
    tools: ["query_ontology", "find_skill", "use_skill", "web_fetch", "read_file", "project_files", "project_read", "project_write", "project_retrieve"],
    skills: ["systematic-review", "meta-analysis", "academic-writing-integrity"],
    output: "viz+report",
    match: "review|meta-?analysis|evidence|stud(y|ies)|trial|prisma|systematic|cohort|rct|literature|causal|epidemiolog|effect|forest|grade|qwoe",
  },
  {
    id: "coding",
    name: "Coding",
    color: "#3b82f6",
    icon: "code",
    description: "Read/write code, refactor, debug, build — the IDE harness.",
    systemPrompt:
      "You are a CODING harness. Read and reason about files, produce correct, minimal changes, and explain your assumptions. Prefer concrete diffs and runnable code over prose.",
    tools: ["browse_files", "read_file", "find_skill", "use_skill", "web_fetch", "project_files", "project_read", "project_write", "project_retrieve"],
    skills: ["spec-driven-implementation", "fix-errors"],
    output: "code",
    match: "code|refactor|debug|function|bug|implement|typescript|javascript|python|api|compile|test|repo|file|module",
  },
  {
    id: "social",
    name: "Social",
    color: "#ec4899",
    icon: "users",
    description: "Sentiment, media, power networks, influence — social intelligence.",
    systemPrompt:
      "You are a SOCIAL-INTELLIGENCE harness. Analyse media sentiment, narratives, power/ownership networks and influence. Ground every claim in the retrieved data and surface the network structure.",
    tools: ["threat_sentiment", "search_power_network", "query_ontology", "web_fetch"],
    skills: ["research-general"],
    output: "viz+text",
    match: "sentiment|media|social|power|influence|network|ownership|actor|opinion|narrative|propaganda|stakeholder",
  },
  {
    id: "general",
    name: "General",
    color: "#8b5cf6",
    icon: "sparkles",
    description: "Cross-domain orchestration — all tools, routes the rest.",
    systemPrompt:
      "You are a GENERAL orchestration harness with access to all tools. Decompose the task, pick the right tools, and delegate to the appropriate domain when helpful.",
    tools: null, // all tools
    skills: [],
    output: "text",
    match: ".*",
  },
];

export function getHarness(id) {
  return HARNESSES.find((h) => h.id === id) || HARNESSES.find((h) => h.id === "general");
}

// Route a prompt to the best harness by keyword density (deterministic first
// pass). Returns the chosen harness + score + ranked alternatives. The general
// harness is the fallback when nothing domain-specific matches.
export function routeHarness(prompt) {
  const text = String(prompt || "");
  const scored = HARNESSES.filter((h) => h.id !== "general")
    .map((h) => ({ harness: h, score: (text.match(new RegExp(h.match, "gi")) || []).length }))
    .sort((a, b) => b.score - a.score);
  const top = scored[0];
  const chosen = top && top.score > 0 ? top.harness : getHarness("general");
  return { harness: chosen, score: top?.score || 0, alternatives: scored.filter((s) => s.score > 0).map((s) => ({ id: s.harness.id, name: s.harness.name, score: s.score })) };
}

// Run a harness on a task: scopes the agent to the harness's tools + prepends its
// domain system prompt, then runs the tool-calling loop. AI-gated.
export async function runHarness(harnessId, task, opts = {}) {
  const { activeProvider } = await import("./providers.js");
  if (!activeProvider()) return { ok: false, reason: "Enable a provider to run a harness." };
  const h = getHarness(harnessId);
  const { runAgent } = await import("./agent.js");
  // Default to enough steps for multi-tool reasoning (found live: 4 was too few).
  const r = await runAgent(task, { maxSteps: 8, system: h.systemPrompt, toolFilter: h.tools || undefined, ...opts });
  return { ...r, harness: h };
}
