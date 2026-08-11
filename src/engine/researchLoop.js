// researchLoop.js — Closed-loop epidemiology orchestrator.
//
// From a single prompt, the system runs an autonomous research loop: search the
// literature, ground it in live epidemiological signal, synthesize a finding + the
// biggest gap, refine the question, and repeat — closing a research loop the way a
// human evidence team would, but in seconds. Each round is real: real papers
// (OpenAlex/EuropePMC/Crossref), real case data (disease.sh), real model synthesis.
//
// This is the thesis: "orchestrates and closes a research loop from a simple prompt."

import { searchAcademic } from "./academic.js";
import { diseaseSeries } from "./connectors.js";
import { ensembleRisk } from "./algorithms.js";
import { activeProvider, callProvider } from "./providers.js";
import { currentLocation } from "./session.js";
import { parseModelJson } from "./modelJson.js";

// One synthesis step: ask the model to read the retrieved papers + epi context and
// return a structured {finding, gap, nextQuery, confidence} object.
async function synthesize(question, papers, epiContext) {
  if (!activeProvider()) return null;
  const list = papers.slice(0, 8).map((p, i) => `[${i + 1}] ${p.title} (${p.year || "n.d."}, ${p.cites ?? 0} cites)`).join("\n");
  const msgs = [
    { role: "system", content: "You are a rigorous epidemiological evidence synthesiser running inside an autonomous research loop. Use ONLY the provided papers. Never invent citations. Output strict JSON." },
    {
      role: "user",
      content:
        `Research question: "${question}".\n${epiContext ? `Live epidemiological context: ${epiContext}.\n` : ""}` +
        `Retrieved papers:\n${list}\n\n` +
        `Return JSON {"finding": "1-2 sentence evidence statement with [n] citations", "gap": "the single most important unresolved gap", "nextQuery": "a sharper search query to close that gap", "confidence": number 0-1}.`,
    },
  ];
  try {
    const raw = await callProvider(activeProvider().id, msgs, { json: true });
    const parsed = parseModelJson(raw, { fields: { finding: "string", gap: "string", nextQuery: "string" } });
    return parsed.ok ? parsed.value : null;
  } catch {
    return null;
  }
}

// Live epidemiological grounding for the current scope (disease.sh daily new-cases
// → ensemble risk index) so the loop is anchored to reality, not only literature.
async function epiGrounding() {
  const loc = currentLocation();
  const d = await diseaseSeries({ country: loc.code === "GLOBAL" ? "GLOBAL" : loc.name, days: 30 });
  if (!d.ok || !d.series?.length) return null;
  const max = Math.max(1, ...d.series);
  const risk = d.series.map((v) => Math.round((v / max) * 100));
  const a = ensembleRisk(risk);
  return `${loc.name}: 30-day case-intensity risk ${a.consensus}/100 (${a.level}), model uncertainty ${(a.modelUncertainty * 100).toFixed(0)}%`;
}

// Run the closed loop. Emits each round via onRound for live UI.
export async function runResearchLoop(question, { rounds = 3, onRound } = {}) {
  if (!activeProvider()) return { ok: false, reason: "Enable an AI provider to run the closed loop.", rounds: [] };

  const trace = [];
  let query = question;
  const epi = await epiGrounding();

  for (let r = 0; r < rounds; r++) {
    onRound?.({ round: r + 1, total: rounds, phase: "searching", query });
    const papers = await searchAcademic(query, { n: 10 });
    onRound?.({ round: r + 1, total: rounds, phase: "synthesizing", query, papers: papers.length });

    const syn = await synthesize(question, papers, r === 0 ? epi : null);
    const step = {
      round: r + 1,
      query,
      papers: papers.length,
      topPaper: papers[0]?.title || null,
      finding: syn?.finding || "(no synthesis — model unavailable)",
      gap: syn?.gap || null,
      confidence: syn?.confidence ?? null,
    };
    trace.push(step);
    onRound?.({ ...step, total: rounds, phase: "done" });

    if (!syn?.nextQuery) break;
    query = syn.nextQuery; // close the loop: the gap drives the next search
  }

  return {
    ok: true,
    question,
    epiContext: epi,
    rounds: trace,
    finalGap: trace[trace.length - 1]?.gap,
    provider: activeProvider().label,
  };
}
