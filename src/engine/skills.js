// skills.js — Skill registry: makes the agent "skill-fluent".
//
// Ingests the operator's real skill catalogue (155 skills from ~/.codex/skills,
// name + description) so the agent KNOWS what capabilities exist and when to reach
// for them. The system prompt carries the skill names (compact); find_skill recalls
// matching descriptions on demand; use_skill loads a skill's guidance to apply.

import data from "../data/skills.json";

const clean = (s) => (s || "").replace(/^["']|["']$/g, "").trim();
export const SKILLS = (data.skills || []).map((s) => ({ name: clean(s.name), description: s.description || "" }));

export function searchSkills(query, limit = 12) {
  const q = (query || "").toLowerCase();
  if (!q) return SKILLS.slice(0, limit);
  return SKILLS.filter((s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)).slice(0, limit);
}

export function getSkill(name) {
  const n = (name || "").toLowerCase();
  return SKILLS.find((s) => s.name.toLowerCase() === n) || SKILLS.find((s) => s.name.toLowerCase().includes(n)) || null;
}

// Compact index (names only) for the system prompt — awareness without bloat.
export function skillNamesIndex() {
  return SKILLS.map((s) => s.name).join(", ");
}

export const SKILL_COUNT = SKILLS.length;

// --- authoring: skills authored/edited in the app (localStorage MD) ---------
import { activeProvider, callProvider } from "./providers.js";
const STORE = "medantir.skills.v1";

function loadAuthored() {
  try { return JSON.parse(localStorage.getItem(STORE) || "{}"); } catch { return {}; }
}
function saveAuthored(a) {
  try { localStorage.setItem(STORE, JSON.stringify(a)); } catch { /* ignore */ }
}

// A skill's full markdown body — authored version, else a scaffold from the index.
export function getSkillBody(name) {
  const a = loadAuthored()[name];
  if (a?.body) return a.body;
  const s = getSkill(name);
  return `---\nname: ${name}\ndescription: ${s?.description || ""}\n---\n\n# ${name}\n\n## When to use\n\n${s?.description || "(describe when to use this skill)"}\n\n## Steps\n\n1. …\n`;
}

export function authorSkill(name, body) {
  const a = loadAuthored();
  const descMatch = body.match(/^description:\s*(.+)$/m);
  a[name] = { name, body, description: descMatch ? descMatch[1].trim() : (a[name]?.description || ""), authored: true, ts: Date.now() };
  saveAuthored(a);
  return a[name];
}
export function deleteAuthored(name) {
  const a = loadAuthored(); delete a[name]; saveAuthored(a);
}
export function isAuthored(name) { return !!loadAuthored()[name]; }

// Catalog + authored, merged (authored overrides catalog by name).
export function allSkills() {
  const authored = loadAuthored();
  const map = new Map(SKILLS.map((s) => [s.name, { ...s }]));
  for (const [n, a] of Object.entries(authored)) map.set(n, { name: n, description: a.description, authored: true });
  return [...map.values()].sort((x, y) => x.name.localeCompare(y.name));
}

// AI: optimise/improve a skill's markdown (trigger scope, steps, gates, format).
export async function aiOptimizeSkill(name, body) {
  if (!activeProvider()) return { ok: false, error: "Enable a provider to optimise skills." };
  try {
    const out = await callProvider(activeProvider().id, [
      { role: "system", content: "You are a skill-authoring expert (progressive disclosure, clear triggers, strict gates, actionable steps). Improve the given SKILL.md and return ONLY the full improved markdown, with valid frontmatter (name, description)." },
      { role: "user", content: `Improve this skill "${name}". Keep it focused; add a precise trigger scope, ordered steps, any fail/validation gates, and an output format.\n\n${body}` },
    ]);
    return { ok: true, body: out.trim() };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
}
