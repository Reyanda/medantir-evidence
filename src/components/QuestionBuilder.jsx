import React, { useState, useEffect, useMemo, useCallback } from "react";
import { createReview, saveReview, loadReview } from "../engine/reviewengine.js";
import { putFile, getFile } from "../engine/projectstore.js";
import { buildStrategy, STRATEGY_DBS, databaseName } from "../engine/searchStrategy.js";

// The question is the first surface, not a field on a later one. It is built in
// the PRISM structure — eight facets, of which only some belong in the Boolean —
// and everything downstream is written from here: review.question, the PICO the
// protocol stage reads, and search/isr.json, which is the strategy the Search
// Strategy builder and the automated search stage both compile from.

export const PRISM_FACETS = [
  { key: "population", code: "P", label: "Population / phenomenon", block: true,
    hint: "adults hospitalised with COVID-19, inpatients, hospitalised patients" },
  { key: "realm", code: "R", label: "Realm / domain", block: false,
    hint: "clinical medicine, public health, health economics" },
  { key: "intervention", code: "I", label: "Intervention / input", block: true,
    hint: "baricitinib, JAK inhibitor, janus kinase inhibitor" },
  { key: "standard", code: "S", label: "Standard / comparator", block: true,
    hint: "standard care, placebo, usual care" },
  { key: "measure", code: "M", label: "Measure / outcome", block: "optional",
    hint: "mortality, death, case fatality" },
  { key: "time", code: "T", label: "Time / temporal", block: false,
    hint: "2020-2026, 28-day follow-up" },
  { key: "geography", code: "G", label: "Geography / setting", block: "optional",
    hint: "sub-Saharan Africa, low-income settings" },
  { key: "design", code: "D", label: "Design / methodology", block: "optional",
    hint: "randomised controlled trial, RCT" },
];

// R routes which databases the strategy is compiled for. A public-health question
// searched only in PubMed is a known way to miss the regional literature.
const REALM_ROUTES = [
  { match: /public health|global health|epidemiolog/i, dbs: ["pubmed", "ovid_embase", "cochrane", "europepmc", "lilacs"] },
  { match: /nurs|allied|midwif|rehab/i, dbs: ["pubmed", "cinahl", "ovid_embase", "cochrane"] },
  { match: /psych|mental|behaviour|behavior/i, dbs: ["pubmed", "ovid_psycinfo", "ovid_embase", "cochrane"] },
  { match: /econom|policy|social|education/i, dbs: ["scopus", "wos", "pubmed", "europepmc"] },
  { match: /./, dbs: ["pubmed", "ovid_embase", "cochrane", "europepmc"] },
];

export function routeDatabases(realm) {
  const route = REALM_ROUTES.find((r) => r.match.test(String(realm || "clinical")));
  return (route?.dbs || []).filter((id) => STRATEGY_DBS.includes(id));
}

const splitTerms = (value) => String(value || "").split(/[,;]/).map((t) => t.trim()).filter(Boolean);

export function composeQuestion(facets) {
  const first = (k) => splitTerms(facets[k])[0] || "";
  const population = first("population");
  const intervention = first("intervention");
  if (!population || !intervention) return "";
  const comparator = first("standard") ? ` compared with ${first("standard")}` : "";
  const measure = first("measure") ? ` affect ${first("measure")}` : " affect the outcomes of interest";
  const geography = first("geography") ? ` in ${first("geography")}` : "";
  const time = first("time") ? ` over ${first("time")}` : "";
  const design = first("design") ? `, in ${first("design")}` : "";
  return `In ${population}${geography}, does ${intervention}${comparator}${measure}${time}${design}?`;
}

// The blocked approach: P AND (I OR S) AND [M] AND [D] NOT (noise). Outcome and
// design blocks are opt-in because AND-ing them costs recall, and the NOT block
// starts empty by design — noise terms are earned from a screening pass.
export function buildIsrConcepts(facets, { includeMeasure = false, includeDesign = false, noise = "" } = {}) {
  const concepts = [];
  const notes = [];
  const push = (label, terms, op = "AND") => {
    if (terms.length) concepts.push({ label, op, terms, vocab: { mesh: [], emtree: [], cinahl: [], apa: [], decs: [] }, mesh: [] });
  };

  push("Population", splitTerms(facets.population));
  const intervention = [...new Set([...splitTerms(facets.intervention), ...splitTerms(facets.standard)])];
  push(splitTerms(facets.standard).length ? "Intervention or comparator" : "Intervention", intervention);
  if (splitTerms(facets.standard).length) {
    notes.push("Comparator terms are OR-ed into the intervention block, not AND-ed: that is how a two-arm comparison is searched.");
  }

  if (includeMeasure) {
    push("Measure", splitTerms(facets.measure));
    notes.push("The outcome block is AND-ed in. Outcomes are inconsistently reported in titles and abstracts, so check recall against known eligible records before reporting this strategy.");
  } else if (splitTerms(facets.measure).length) {
    notes.push("Outcome terms are recorded but kept out of the Boolean, which protects recall.");
  }

  if (includeDesign) push("Design", splitTerms(facets.design));
  if (splitTerms(facets.geography).length && !includeMeasure) {
    notes.push("Geography is recorded as a limit, not a Boolean block; country terms are poorly indexed in titles and abstracts.");
  }
  const noiseTerms = splitTerms(noise);
  if (noiseTerms.length) {
    concepts.push({ label: "Excluded noise", op: "NOT", terms: noiseTerms, vocab: { mesh: [], emtree: [], cinahl: [], apa: [], decs: [] }, mesh: [] });
    notes.push("The NOT block removes terms observed as noise in screening. Re-check sensitivity after every addition.");
  }
  if (concepts.filter((c) => c.op === "AND").length < 2) {
    notes.push("Fewer than two searchable blocks: this strategy is very broad.");
  }
  notes.push("Free-text terms only. Controlled-vocabulary headings (MeSH, Emtree, CINAHL) still have to be added in the Search Strategy builder before this is a reportable systematic search.");
  return { concepts, notes };
}

export default function QuestionBuilder({ projectId, review, onReviewChange, onNote, onOpenStrategy }) {
  const [facets, setFacets] = useState({});
  const [includeMeasure, setIncludeMeasure] = useState(false);
  const [includeDesign, setIncludeDesign] = useState(false);
  const [noise, setNoise] = useState("");
  const [saved, setSaved] = useState(null);

  // Seed from whatever the review already holds, so the tab reflects the
  // project rather than starting blank over the top of real work.
  useEffect(() => {
    const prism = review?.protocol?.prism;
    const pico = review?.protocol?.pico;
    if (prism) { setFacets(prism.facets || {}); setIncludeMeasure(!!prism.includeMeasure); setIncludeDesign(!!prism.includeDesign); setNoise(prism.noise || ""); return; }
    if (pico) {
      setFacets({
        population: pico.population || "",
        intervention: pico.intervention || "",
        standard: pico.comparator || "",
        measure: (pico.outcomes || []).join(", "),
        design: pico.studyDesign || "",
      });
    }
  }, [review?.protocol?.prism, review?.protocol?.pico]);

  useEffect(() => {
    if (!projectId) { setSaved(null); return; }
    const file = getFile(projectId, "search/isr.json");
    if (!file) { setSaved(null); return; }
    try { setSaved(JSON.parse(file.content)); } catch { setSaved(null); }
  }, [projectId, review]);

  const question = useMemo(() => composeQuestion(facets), [facets]);
  const { concepts, notes } = useMemo(
    () => buildIsrConcepts(facets, { includeMeasure, includeDesign, noise }),
    [facets, includeMeasure, includeDesign, noise]
  );
  const databases = useMemo(() => routeDatabases(facets.realm), [facets.realm]);
  const preview = useMemo(() => {
    if (!concepts.length || !databases.length) return [];
    try { return buildStrategy(concepts, databases.slice(0, 3)); } catch { return []; }
  }, [concepts, databases]);

  const set = (key, value) => setFacets((f) => ({ ...f, [key]: value }));

  // One action writes the question, the PICO the protocol stage reads, the PRISM
  // record, and the ISR the Search Strategy tab and the search stage compile from.
  const applyAndBuild = useCallback((thenOpen) => {
    if (!projectId || !question) return;
    const current = loadReview(projectId) || createReview(question);
    const pico = {
      population: splitTerms(facets.population).join(", ") || null,
      intervention: splitTerms(facets.intervention).join(", ") || null,
      comparator: splitTerms(facets.standard).join(", ") || null,
      outcomes: splitTerms(facets.measure),
      studyDesign: splitTerms(facets.design).join(", ") || null,
      setting: splitTerms(facets.geography).join(", ") || null,
      timeframe: facets.time || null,
    };
    const next = {
      ...current,
      question,
      createdAt: current.createdAt || Date.now(),
      selectedSources: current.selectedSources?.length ? current.selectedSources : databases,
      protocol: {
        ...current.protocol,
        pico,
        picoSource: "PRISM question builder",
        prism: { facets, includeMeasure, includeDesign, noise, routedDatabases: databases },
        concepts,
        strategyNotes: notes,
        strategySource: "search/isr.json",
      },
    };
    saveReview(projectId, next);

    const stamp = new Date().toISOString();
    const isr = { question, concepts, databases, savedAt: stamp, source: "PRISM question builder", notes };
    putFile(projectId, { path: "search/isr.json", name: "isr.json", type: "provenance", content: JSON.stringify(isr, null, 2) });
    putFile(projectId, {
      path: "search/prism-decomposition.json", name: "prism-decomposition.json", type: "provenance",
      content: JSON.stringify({ question, facets, blocks: concepts.map((c) => ({ label: c.label, op: c.op, terms: c.terms })), databases, savedAt: stamp }, null, 2),
    });

    setSaved(isr);
    onReviewChange?.(next);
    onNote?.(`Question built. ${concepts.length} search block(s) written to search/isr.json for ${databases.length} database(s).`, "ok");
    if (thenOpen) onOpenStrategy?.(question);
  }, [projectId, question, facets, concepts, notes, databases, includeMeasure, includeDesign, noise, onReviewChange, onNote, onOpenStrategy]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(360px, 1fr) minmax(340px, 1fr)", height: "100%", minHeight: 0 }}>
      {/* facets */}
      <div style={{ borderRight: "1px solid var(--line)", overflow: "auto" }}>
        <div className="wb-insp-title">PRISM decomposition</div>
        <table className="wb-grid">
          <thead>
            <tr>
              <th style={{ width: 30 }} />
              <th style={{ width: 170 }}>Facet</th>
              <th>Terms, comma separated</th>
              <th style={{ width: 74 }}>In Boolean</th>
            </tr>
          </thead>
          <tbody>
            {PRISM_FACETS.map((f) => {
              const inBoolean = f.block === true
                ? "yes"
                : f.block === "optional"
                  ? (f.key === "measure" ? includeMeasure : f.key === "design" ? includeDesign : false) ? "yes" : "opt"
                  : "no";
              return (
                <tr key={f.key}>
                  <td style={{ fontFamily: "var(--mono)", color: "var(--accent)", textAlign: "center" }}>{f.code}</td>
                  <td title={f.label}>{f.label}</td>
                  <td>
                    <input
                      className="wb-cell-input" style={{ textAlign: "left" }}
                      value={facets[f.key] || ""} placeholder={f.hint}
                      onChange={(e) => set(f.key, e.target.value)}
                    />
                  </td>
                  <td>
                    {f.key === "measure" || f.key === "design" ? (
                      <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10.5 }}>
                        <input
                          type="checkbox"
                          checked={f.key === "measure" ? includeMeasure : includeDesign}
                          onChange={(e) => (f.key === "measure" ? setIncludeMeasure : setIncludeDesign)(e.target.checked)}
                        />
                        {inBoolean}
                      </label>
                    ) : (
                      <span style={{ color: inBoolean === "yes" ? "var(--ok)" : "var(--fg-faint)", fontFamily: "var(--mono)", fontSize: 10.5 }}>{inBoolean}</span>
                    )}
                  </td>
                </tr>
              );
            })}
            <tr>
              <td style={{ fontFamily: "var(--mono)", color: "var(--err)", textAlign: "center" }}>!</td>
              <td>Excluded noise (NOT)</td>
              <td>
                <input
                  className="wb-cell-input" style={{ textAlign: "left" }}
                  value={noise} placeholder="empty until a screening pass shows recurring noise"
                  onChange={(e) => setNoise(e.target.value)}
                />
              </td>
              <td style={{ color: noise ? "var(--err)" : "var(--fg-faint)", fontFamily: "var(--mono)", fontSize: 10.5 }}>{noise ? "NOT" : "empty"}</td>
            </tr>
          </tbody>
        </table>

        <div className="wb-insp-title">Question</div>
        <div style={{ padding: "6px 8px", fontSize: 12, color: question ? "var(--fg-bright)" : "var(--fg-faint)", userSelect: "text", lineHeight: 1.5 }}>
          {question || "Population and intervention are the minimum: fill both to compose the question."}
        </div>
        <div style={{ display: "flex", gap: 4, padding: "0 8px 8px" }}>
          <button className="wb-btn on" onClick={() => applyAndBuild(true)} disabled={!question || !projectId}>
            Build strategy and open Search
          </button>
          <button className="wb-btn" onClick={() => applyAndBuild(false)} disabled={!question || !projectId}>Apply only</button>
          <button className="wb-btn" onClick={() => navigator.clipboard?.writeText(question)} disabled={!question}>Copy question</button>
        </div>
      </div>

      {/* compiled blocks and routing */}
      <div style={{ overflow: "auto" }}>
        <div className="wb-insp-title">Search blocks</div>
        <table className="wb-grid">
          <thead><tr><th style={{ width: 54 }}>Op</th><th style={{ width: 160 }}>Block</th><th>Terms</th></tr></thead>
          <tbody>
            {concepts.map((c, i) => (
              <tr key={i}>
                <td style={{ fontFamily: "var(--mono)", color: c.op === "NOT" ? "var(--err)" : c.op === "OR" ? "var(--warn)" : "var(--ok)" }}>{c.op}</td>
                <td>{c.label}</td>
                <td title={c.terms.join(" OR ")}>{c.terms.join(" OR ")}</td>
              </tr>
            ))}
            {concepts.length === 0 && <tr><td colSpan={3} style={{ color: "var(--fg-faint)" }}>No searchable block yet.</td></tr>}
          </tbody>
        </table>

        <div className="wb-insp-title">Routed databases — from the realm facet</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: "4px 8px" }}>
          {databases.map((id) => <span key={id} className="wb-tag on">{databaseName(id)}</span>)}
        </div>

        <div className="wb-insp-title">Compiled preview</div>
        {preview.length === 0 ? (
          <div style={{ padding: "4px 8px", color: "var(--fg-faint)", fontSize: 11 }}>Nothing to compile yet.</div>
        ) : preview.map((s, i) => (
          <div key={i} style={{ padding: "4px 8px", borderBottom: "1px solid var(--line)" }}>
            <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--fg-dim)" }}>{s.name || s.db}</div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--fg)", userSelect: "text", wordBreak: "break-word", lineHeight: 1.5 }}>
              {s.combined || (s.lines || []).map((l) => l.text).join(" ")}
            </div>
            {s.freeTextOnly && (
              <div style={{ fontSize: 10, color: "var(--warn)" }}>free text only — no thesaurus for this database</div>
            )}
          </div>
        ))}

        <div className="wb-insp-title">Method notes</div>
        <div style={{ padding: "4px 8px", fontSize: 11, color: "var(--fg-dim)", lineHeight: 1.6 }}>
          {notes.map((n, i) => <div key={i}>— {n}</div>)}
        </div>

        {saved && (
          <div style={{ padding: "4px 8px", fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--ok)" }}>
            search/isr.json saved {new Date(saved.savedAt).toLocaleString()} · {saved.concepts?.length || 0} blocks · {saved.databases?.length || 0} databases
          </div>
        )}
      </div>
    </div>
  );
}
