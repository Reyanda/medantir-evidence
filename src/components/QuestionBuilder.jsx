import React, { useState, useEffect, useMemo, useCallback } from "react";
import { createReview, saveReview, loadReview } from "../engine/reviewengine.js";
import { putFile, getFile } from "../engine/projectstore.js";
import { buildStrategy, STRATEGY_DBS, databaseName } from "../engine/searchStrategy.js";
import TokenField, { toTokens } from "./TokenField.jsx";
import { compileMatcher, screenCorpus, synonymCandidates, noiseCandidates, buildTermIndex, topTerms, highlightSpans, recordText } from "../engine/termIndex.js";
import { expandConcept, NATIVE_VOCABULARIES } from "../engine/medvocab.js";
import { assessPress, PRESS_CITATION } from "../engine/pressReview.js";

// The question is the first surface, not a field on a later one. It is built in
// the PRISM structure — eight facets, of which only some belong in the Boolean —
// and everything downstream is written from here: review.question, the PICO the
// protocol stage reads, and search/isr.json, which is the strategy the Search
// Strategy builder and the automated search stage both compile from.

export const PRISM_FACETS = [
  { key: "population", code: "P", label: "Population / phenomenon", block: true,
    hint: "children, adults, inpatients" },
  { key: "realm", code: "R", label: "Realm / domain", block: false,
    hint: "clinical medicine, public health" },
  { key: "intervention", code: "I", label: "Intervention / input", block: true,
    hint: "baricitinib, JAK inhibitor" },
  { key: "standard", code: "S", label: "Standard / comparator", block: true,
    hint: "standard care, placebo" },
  { key: "measure", code: "M", label: "Measure / outcome", block: "optional",
    hint: "mortality, death" },
  { key: "time", code: "T", label: "Time / temporal", block: false,
    hint: "2020-2026, 28-day follow-up" },
  { key: "geography", code: "G", label: "Geography / setting", block: "optional",
    hint: "sub-Saharan Africa, LMIC" },
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

// A facet holds tokens. Strings are still accepted, so reviews saved before the
// tokenised builder — and any caller passing a comma list — still decompose.
const splitTerms = toTokens;

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
const emptyVocab = () => ({ mesh: [], emtree: [], cinahl: [], apa: [], decs: [] });

// Merge the headings collected for one or more facets into a single vocab block.
function vocabFor(headings, keys) {
  const out = emptyVocab();
  for (const key of keys) {
    const facet = headings?.[key];
    if (!facet) continue;
    for (const vocabulary of Object.keys(out)) {
      for (const label of facet[vocabulary] || []) if (!out[vocabulary].includes(label)) out[vocabulary].push(label);
    }
  }
  return out;
}

export function buildIsrConcepts(facets, { includeMeasure = false, includeDesign = false, noise = "", headings = {} } = {}) {
  const concepts = [];
  const notes = [];
  const push = (label, terms, op = "AND", vocab = emptyVocab()) => {
    if (terms.length) concepts.push({ label, op, terms, vocab, mesh: vocab.mesh || [] });
  };

  push("Population", splitTerms(facets.population), "AND", vocabFor(headings, ["population"]));
  const intervention = [...new Set([...splitTerms(facets.intervention), ...splitTerms(facets.standard)])];
  push(
    splitTerms(facets.standard).length ? "Intervention or comparator" : "Intervention",
    intervention, "AND", vocabFor(headings, ["intervention", "standard"])
  );
  if (splitTerms(facets.standard).length) {
    notes.push("Comparator terms are OR-ed into the intervention block, not AND-ed: that is how a two-arm comparison is searched.");
  }

  if (includeMeasure) {
    push("Measure", splitTerms(facets.measure), "AND", vocabFor(headings, ["measure"]));
    notes.push("The outcome block is AND-ed in. Outcomes are inconsistently reported in titles and abstracts, so check recall against known eligible records before reporting this strategy.");
  } else if (splitTerms(facets.measure).length) {
    notes.push("Outcome terms are recorded but kept out of the Boolean, which protects recall.");
  }

  if (includeDesign) push("Design", splitTerms(facets.design), "AND", vocabFor(headings, ["design"]));
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
  const headingCount = concepts.reduce((n, c) => n + Object.values(c.vocab || {}).reduce((m, list) => m + list.length, 0), 0);
  if (headingCount) {
    notes.push(`${headingCount} controlled-vocabulary heading(s) attached. Each is emitted only into the databases that index with that thesaurus; a MeSH term is never sent to Embase as Emtree.`);
  } else {
    notes.push("Free-text terms only. Add controlled-vocabulary headings from the THESAURUS tab before this is a reportable systematic search.");
  }
  return { concepts, notes };
}

// Shows the reader exactly which words made a record hit.
export function Highlighted({ text, matcher }) {
  const spans = highlightSpans(text, matcher);
  if (!spans.length) return <span>{text}</span>;
  const out = [];
  let cursor = 0;
  spans.forEach((span, i) => {
    if (span.start > cursor) out.push(<span key={`t${i}`}>{text.slice(cursor, span.start)}</span>);
    out.push(
      <mark key={`m${i}`} className={span.op === "NOT" ? "wb-mark not" : "wb-mark"} title={`${span.op} · ${span.label}`}>
        {text.slice(span.start, span.end)}
      </mark>
    );
    cursor = span.end;
  });
  if (cursor < text.length) out.push(<span key="tail">{text.slice(cursor)}</span>);
  return <>{out}</>;
}

export default function QuestionBuilder({ projectId, review, onReviewChange, onNote, onOpenStrategy }) {
  const [facets, setFacets] = useState({});
  const [includeMeasure, setIncludeMeasure] = useState(false);
  const [includeDesign, setIncludeDesign] = useState(false);
  const [noise, setNoise] = useState([]);
  const [saved, setSaved] = useState(null);
  const [rightTab, setRightTab] = useState("BLOCKS");
  // Controlled-vocabulary headings per facet. These are NOT free-text terms:
  // they compile into "[Mesh]" / "exp Emtree/" clauses per database, and they
  // are the difference between a keyword search and an indexed one.
  const [headings, setHeadings] = useState({});
  const [expansion, setExpansion] = useState(null); // { facet, seed, busy, result }

  // Seed from whatever the review already holds, so the tab reflects the
  // project rather than starting blank over the top of real work.
  useEffect(() => {
    const prism = review?.protocol?.prism;
    const pico = review?.protocol?.pico;
    const normalise = (source) => Object.fromEntries(Object.entries(source || {}).map(([k, v]) => [k, toTokens(v)]));
    if (prism) {
      setFacets(normalise(prism.facets));
      setIncludeMeasure(!!prism.includeMeasure);
      setIncludeDesign(!!prism.includeDesign);
      setNoise(toTokens(prism.noise));
      setHeadings(prism.headings || {});
      return;
    }
    if (pico) {
      setFacets(normalise({
        population: pico.population,
        intervention: pico.intervention,
        standard: pico.comparator,
        measure: pico.outcomes,
        design: pico.studyDesign,
        geography: pico.setting,
        time: pico.timeframe,
      }));
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
    () => buildIsrConcepts(facets, { includeMeasure, includeDesign, noise, headings }),
    [facets, includeMeasure, includeDesign, noise, headings]
  );
  const databases = useMemo(() => routeDatabases(facets.realm), [facets.realm]);
  const preview = useMemo(() => {
    if (!concepts.length || !databases.length) return [];
    try { return buildStrategy(concepts, databases.slice(0, 3)); } catch { return []; }
  }, [concepts, databases]);

  const set = (key, value) => setFacets((f) => ({ ...f, [key]: value }));

  // The strategy compiled into something runnable, then actually run over the
  // records this project has retrieved. A strategy nobody has tested against a
  // corpus is a guess.
  const records = useMemo(() => (review?.objects?.records || []).filter((r) => !r.isDuplicate), [review]);
  const matcher = useMemo(() => compileMatcher(concepts), [concepts]);
  const corpus = useMemo(
    () => (records.length && matcher.blocks.length ? screenCorpus(records, matcher) : null),
    [records, matcher]
  );
  const synonyms = useMemo(() => {
    const seed = splitTerms(facets.intervention);
    return records.length >= 10 && seed.length ? synonymCandidates(records, seed) : [];
  }, [records, facets.intervention]);
  const noiseFound = useMemo(
    () => (records.length && matcher.blocks.length ? noiseCandidates(records, matcher) : null),
    [records, matcher]
  );
  const corpusTerms = useMemo(() => (records.length ? topTerms(buildTermIndex(records), { limit: 24 }) : []), [records]);
  const sample = corpus?.matched?.[0] || records[0] || null;

  // PRESS 2015 is the standard for peer review of an electronic search
  // strategy. Running it here — against the compiled strategies, not against a
  // description of them — is what separates a strategy that looks finished from
  // one that is defensible.
  const press = useMemo(() => {
    if (!concepts.length) return null;
    const sentinelEvidence = corpus?.ok
      ? [{ id: "corpus-recall", status: corpus.lostIncluded === 0 ? "pass" : "fail",
           note: corpus.lostIncluded === 0
             ? `every record screened in is retrieved by this strategy (${corpus.matchedCount}/${corpus.total} matched)`
             : `${corpus.lostIncluded} record(s) screened in are NOT retrieved by this strategy` }]
      : [];
    try {
      return assessPress({ question, concepts, strategies: preview, sentinelEvidence });
    } catch {
      return null;
    }
  }, [question, concepts, preview, corpus]);

  const addTerm = (key, term) => setFacets((f) => {
    const current = toTokens(f[key]);
    return current.some((t) => t.toLowerCase() === String(term).toLowerCase()) ? f : { ...f, [key]: [...current, term] };
  });

  const addHeading = (facetKey, vocabulary, label) => setHeadings((h) => {
    const facet = { ...emptyVocab(), ...(h[facetKey] || {}) };
    if (facet[vocabulary]?.includes(label)) return h;
    return { ...h, [facetKey]: { ...facet, [vocabulary]: [...(facet[vocabulary] || []), label] } };
  });

  const removeHeading = (facetKey, vocabulary, label) => setHeadings((h) => ({
    ...h,
    [facetKey]: { ...emptyVocab(), ...(h[facetKey] || {}), [vocabulary]: (h[facetKey]?.[vocabulary] || []).filter((l) => l !== label) },
  }));

  // Ask the thesaurus services what this term is called elsewhere. MeSH is
  // keyless; UMLS and BioPortal answer only when their keys are in the vault.
  const expand = async (facetKey) => {
    const seed = toTokens(facets[facetKey])[0];
    if (!seed) { onNote?.(`Add a term to ${facetKey} before expanding it.`, "warn"); return; }
    setExpansion({ facet: facetKey, seed, busy: true, result: null });
    try {
      const result = await expandConcept(seed);
      setExpansion({ facet: facetKey, seed, busy: false, result });
    } catch (e) {
      setExpansion({ facet: facetKey, seed, busy: false, result: null, error: String(e.message || e) });
    }
  };

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
        prism: { facets, includeMeasure, includeDesign, noise, headings, routedDatabases: databases, tokenised: true },
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
  }, [projectId, question, facets, concepts, notes, databases, includeMeasure, includeDesign, noise, headings, onReviewChange, onNote, onOpenStrategy]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(360px, 1fr) minmax(340px, 1fr)", height: "100%", minHeight: 0 }}>
      {/* facets */}
      <div style={{ borderRight: "1px solid var(--line)", overflow: "auto" }}>
        <div className="wb-insp-title">PRISM decomposition</div>
        <table className="wb-grid wb-grid-soft">
          <thead>
            <tr>
              <th style={{ width: 30 }} />
              <th style={{ width: 170 }}>Facet</th>
              <th>Terms — Enter or comma makes a term</th>
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
                  <td style={{ padding: "1px 4px", whiteSpace: "normal" }}>
                    <TokenField
                      value={facets[f.key] || []}
                      placeholder={f.hint}
                      onChange={(tokens) => set(f.key, tokens)}
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
              <td style={{ padding: "1px 4px", whiteSpace: "normal" }}>
                <TokenField
                  value={noise} tone="not"
                  placeholder="empty until a screening pass shows recurring noise"
                  onChange={setNoise}
                />
              </td>
              <td style={{ color: noise.length ? "var(--err)" : "var(--fg-faint)", fontFamily: "var(--mono)", fontSize: 10.5 }}>
                {noise.length ? `NOT ${noise.length}` : "empty"}
              </td>
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

      {/* compiled blocks, the runnable regex, and the corpus it was tested on */}
      <div style={{ display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
        <div className="wb-tabs">
          {["BLOCKS", "THESAURUS", "REGEX", "CORPUS"].map((t) => (
            <div key={t} className={`pt ${rightTab === t ? "active" : ""}`} onClick={() => setRightTab(t)}>{t}</div>
          ))}
          <span className="wb-spacer" />
          <div className="pt" style={{ borderRight: "none", color: "var(--fg-faint)" }}>
            {corpus ? `${corpus.matchedCount}/${corpus.total} records match` : `${records.length} records`}
          </div>
        </div>
        <div style={{ flex: 1, overflow: "auto", minHeight: 0, display: rightTab === "BLOCKS" ? "block" : "none" }}>
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

        <div className="wb-insp-title">
          PRESS 2015 peer review
          {press && <span className="wb-count" style={{ color: press.rows.some((r) => r.status === "fail") ? "var(--err)" : "var(--ok)" }}>
            {press.rows.filter((r) => r.status === "pass").length}/{press.rows.length} pass
          </span>}
        </div>
        {!press ? (
          <div style={{ padding: "4px 8px", fontSize: 11, color: "var(--fg-faint)" }}>Build at least one block to assess the strategy.</div>
        ) : (
          <>
            <table className="wb-grid">
              <thead><tr><th style={{ width: 150 }}>PRESS item</th><th style={{ width: 56 }}>State</th><th>Evidence</th></tr></thead>
              <tbody>
                {press.rows.map((row) => (
                  <tr key={row.id}>
                    <td title={row.label}>{row.label}</td>
                    <td style={{ color: row.status === "pass" ? "var(--ok)" : row.status === "fail" ? "var(--err)" : "var(--warn)" }}>{row.status}</td>
                    <td title={row.evidence}>{row.evidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ padding: "4px 8px", fontSize: 10.5, color: "var(--fg-faint)", lineHeight: 1.6 }}>
              {PRESS_CITATION?.text || "PRESS 2015 (McGowan et al., J Clin Epidemiol)"}
            </div>
          </>
        )}

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

        {/* THESAURUS: what the controlled vocabularies call this concept */}
        <div style={{ flex: 1, overflow: "auto", minHeight: 0, display: rightTab === "THESAURUS" ? "block" : "none" }}>
          <div className="wb-insp-title">Expand a facet against the vocabularies</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: "4px 8px" }}>
            {PRISM_FACETS.filter((f) => f.block).map((f) => (
              <button
                key={f.key} className={`wb-tag ${expansion?.facet === f.key ? "on" : ""}`}
                disabled={expansion?.busy}
                onClick={() => expand(f.key)}
                title={`Look up "${toTokens(facets[f.key])[0] || "—"}" in MeSH, and in UMLS or BioPortal when their keys are unlocked`}
              >
                {f.code} · {f.label.split(" /")[0]}
              </button>
            ))}
          </div>

          {expansion?.busy && <div style={{ padding: "4px 8px", fontSize: 11, color: "var(--fg-dim)" }}>Looking up “{expansion.seed}”…</div>}
          {expansion?.error && <div style={{ padding: "4px 8px", fontSize: 11, color: "var(--err)" }}>{expansion.error}</div>}

          {expansion?.result && (
            <>
              <div style={{ padding: "2px 8px", fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--fg-faint)" }}>
                seed “{expansion.result.seed}” → {expansion.facet} ·{" "}
                {Object.entries(expansion.result.services).map(([id, st]) => `${id}:${st.available ? "ok" : st.configured ? "no answer" : "no key"}`).join("  ")}
              </div>
              {(expansion.result.warnings || []).map((w, i) => (
                <div key={i} style={{ padding: "2px 8px", fontSize: 10.5, color: "var(--warn)" }}>{w}</div>
              ))}

              {[
                ["descriptors", "Descriptors — the indexed heading", "heading"],
                ["entryTerms", "Entry terms — the free text the heading covers", "term"],
                ["narrower", "Narrower descriptors — what an explode picks up", "heading"],
                ["mapped", "Mapped concepts — UMLS / BioPortal", "term"],
                ["ai", "Model suggestions — unverified, check before use", "term"],
              ].map(([key, title, kind]) => {
                const list = expansion.result[key] || [];
                if (!list.length) return null;
                return (
                  <React.Fragment key={key}>
                    <div className="wb-insp-title">{title} <span className="wb-count">{list.length}</span></div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: "4px 8px" }}>
                      {list.slice(0, 40).map((c, i) => (
                        <button
                          key={`${c.label}-${i}`}
                          className="wb-tag"
                          style={c.verification === "unverified" ? { borderStyle: "dashed" } : undefined}
                          title={`${c.sourceLabel || c.source} · ${c.relation} · ${c.verification}${c.id ? ` · ${c.id}` : ""} — click to add as a ${kind === "heading" ? "controlled heading" : "free-text term"}`}
                          onClick={() => {
                            if (kind === "heading") {
                              addHeading(expansion.facet, c.vocabulary === "free-text" ? "mesh" : (c.vocabulary || "mesh"), c.label);
                              onNote?.(`${c.label} attached as a ${(c.vocabulary || "mesh").toUpperCase()} heading on ${expansion.facet}.`);
                            } else {
                              addTerm(expansion.facet, c.label);
                            }
                          }}
                        >
                          {c.label}
                          {c.exact && <span style={{ color: "var(--ok)" }}> ✓</span>}
                        </button>
                      ))}
                    </div>
                  </React.Fragment>
                );
              })}
            </>
          )}

          <div className="wb-insp-title">Attached headings</div>
          {Object.keys(headings).length === 0 ? (
            <div style={{ padding: "4px 8px", fontSize: 11, color: "var(--fg-faint)" }}>
              None yet. A strategy without headings retrieves only what the authors happened to write in the title or abstract.
            </div>
          ) : (
            <table className="wb-grid">
              <thead><tr><th style={{ width: 110 }}>Facet</th><th style={{ width: 90 }}>Vocabulary</th><th>Heading</th><th style={{ width: 40 }} /></tr></thead>
              <tbody>
                {Object.entries(headings).flatMap(([facetKey, vocab]) =>
                  Object.entries(vocab || {}).flatMap(([vocabulary, labels]) =>
                    (labels || []).map((label) => (
                      <tr key={`${facetKey}-${vocabulary}-${label}`}>
                        <td>{facetKey}</td>
                        <td style={{ fontFamily: "var(--mono)", fontSize: 10.5 }}>
                          {NATIVE_VOCABULARIES.find((v) => v.id === vocabulary)?.label || vocabulary}
                        </td>
                        <td title={label}>{label}</td>
                        <td><button className="wb-btn danger" style={{ height: 16, padding: "0 5px", fontSize: 10 }} onClick={() => removeHeading(facetKey, vocabulary, label)}>×</button></td>
                      </tr>
                    ))
                  )
                )}
              </tbody>
            </table>
          )}
          <div style={{ padding: "4px 8px", fontSize: 10.5, color: "var(--fg-faint)", lineHeight: 1.6 }}>
            Headings compile only into the databases that use that thesaurus — MeSH into PubMed, MEDLINE and CENTRAL;
            Emtree into Embase; CINAHL Headings into CINAHL. The local regex still runs on free text, so a heading
            added here widens the database search, not the corpus match.
          </div>
        </div>

        {/* REGEX: the same blocks as a pattern that can be run anywhere */}
        <div style={{ flex: 1, overflow: "auto", minHeight: 0, display: rightTab === "REGEX" ? "block" : "none" }}>
          <div className="wb-insp-title">Per block</div>
          {matcher.blocks.length === 0 && <div style={{ padding: "4px 8px", color: "var(--fg-faint)", fontSize: 11 }}>No block to compile.</div>}
          {matcher.blocks.map((b, i) => (
            <div key={i} style={{ padding: "4px 8px", borderBottom: "1px solid var(--line)" }}>
              <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".4px", color: b.op === "NOT" ? "var(--err)" : "var(--fg-dim)" }}>
                {b.op} · {b.label}
                {corpus && <span className="wb-count" style={{ marginLeft: 6 }}>{corpus.blocks.find((x) => x.label === b.label)?.hits ?? 0} hits</span>}
              </div>
              <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, userSelect: "text", wordBreak: "break-all", lineHeight: 1.5 }}>{b.source}</div>
            </div>
          ))}
          {matcher.combined && (
            <>
              <div className="wb-insp-title">Whole strategy — one pattern</div>
              <div style={{ padding: "4px 8px", fontFamily: "var(--mono)", fontSize: 10.5, userSelect: "text", wordBreak: "break-all", lineHeight: 1.5 }}>
                /{matcher.combined}/{matcher.flags}
              </div>
              <div style={{ padding: "0 8px 6px" }}>
                <button className="wb-btn" onClick={() => navigator.clipboard?.writeText(`/${matcher.combined}/${matcher.flags}`)}>Copy pattern</button>
              </div>
            </>
          )}
          <div className="wb-insp-title">Why a term hits</div>
          <div style={{ padding: "4px 8px", fontSize: 11, color: "var(--fg-dim)", lineHeight: 1.6 }}>
            — Terms match on word boundaries, so <span className="wb-mono">arm</span> never matches <span className="wb-mono">harm</span>.<br />
            — A trailing <span className="wb-mono">*</span> truncates: <span className="wb-mono">random*</span> matches randomised, randomisation.<br />
            — A multi-word term tolerates a hyphen or extra space between its words.
          </div>
          {sample && (
            <>
              <div className="wb-insp-title">Matched text — first hit in the corpus</div>
              <div style={{ padding: "4px 8px", fontSize: 11.5, lineHeight: 1.55, userSelect: "text" }}>
                <Highlighted text={recordText(sample).slice(0, 600)} matcher={matcher} />
              </div>
            </>
          )}
        </div>

        {/* CORPUS: what the strategy does to the records already retrieved */}
        <div style={{ flex: 1, overflow: "auto", minHeight: 0, display: rightTab === "CORPUS" ? "block" : "none" }}>
          {!records.length ? (
            <div style={{ padding: "6px 8px", color: "var(--fg-faint)", fontSize: 11 }}>
              No records retrieved yet. Run the search stage, then the strategy can be tested against what it returns.
            </div>
          ) : (
            <>
              <div className="wb-insp-title">Strategy against this corpus</div>
              <div className="wb-prop"><span className="k">Records</span><span className="v mono">{corpus?.total ?? records.length}</span></div>
              <div className="wb-prop"><span className="k">Matched</span><span className="v mono" style={{ color: "var(--ok)" }}>{corpus?.matchedCount ?? 0}</span></div>
              <div className="wb-prop"><span className="k">Missed</span><span className="v mono">{corpus?.missedCount ?? 0}</span></div>
              {corpus?.lostIncluded > 0 && (
                <div className="wb-prop">
                  <span className="k">Lost</span>
                  <span className="v" style={{ color: "var(--err)" }}>
                    {corpus.lostIncluded} record(s) you screened IN do not match this strategy — it is losing evidence
                  </span>
                </div>
              )}

              <div className="wb-insp-title">Synonym candidates — travel with the intervention terms</div>
              {synonyms.length === 0 ? (
                <div style={{ padding: "4px 8px", color: "var(--fg-faint)", fontSize: 11 }}>
                  {records.length < 10 ? "Too few records to propose terms." : "Nothing rises above the corpus baseline."}
                </div>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: "4px 8px" }}>
                  {synonyms.map((c) => (
                    <button key={c.term} className="wb-tag" title={`in ${c.df} records, ${c.lift.toFixed(1)}x the corpus rate — click to add to the intervention block`}
                      onClick={() => addTerm("intervention", c.term)}>
                      {c.term} <span style={{ color: "var(--fg-faint)" }}>{c.df}</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="wb-insp-title">Noise candidates — earned from your exclusions</div>
              {!noiseFound?.ready ? (
                <div style={{ padding: "4px 8px", color: "var(--fg-faint)", fontSize: 11 }}>{noiseFound?.reason || "Screen some records first."}</div>
              ) : (
                <>
                  <div style={{ padding: "2px 8px", fontSize: 10.5, color: "var(--fg-faint)", fontFamily: "var(--mono)" }}>
                    from {noiseFound.excludedMatched} matched-and-excluded, absent from {noiseFound.keptMatched} matched-and-included
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: "4px 8px" }}>
                    {noiseFound.candidates.map((c) => (
                      <button key={c.term} className="wb-tag" title={`in ${c.df} excluded records — click to add to the NOT block`}
                        onClick={() => setNoise((n) => [...toTokens(n), c.term])}>
                        {c.term} <span style={{ color: "var(--fg-faint)" }}>{c.df}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}

              <div className="wb-insp-title">Most frequent terms in the corpus</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: "4px 8px" }}>
                {corpusTerms.map((t) => (
                  <button key={t.term} className="wb-tag" title={`in ${t.df} records — click to add to the population block`}
                    onClick={() => addTerm("population", t.term)}>
                    {t.term} <span style={{ color: "var(--fg-faint)" }}>{t.df}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
