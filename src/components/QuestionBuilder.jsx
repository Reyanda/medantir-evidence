import React, { useState, useEffect, useMemo, useCallback } from "react";
import { createReview, saveReview, loadReview } from "../engine/reviewengine.js";
import { putFile, getFile } from "../engine/projectstore.js";
import { buildStrategy, STRATEGY_DBS, databaseName } from "../engine/searchStrategy.js";
import TokenField, { toTokens } from "./TokenField.jsx";
import { compileMatcher, screenCorpus, synonymCandidates, noiseCandidates, buildTermIndex, topTerms, highlightSpans } from "../engine/termIndex.js";
import { expandConcept, NATIVE_VOCABULARIES } from "../engine/medvocab.js";
import { assessPress, PRESS_CITATION } from "../engine/pressReview.js";

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

const emptyVocab = () => ({ mesh: [], emtree: [], cinahl: [], apa: [], decs: [] });

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

export function buildIsrConcepts(facets, { includeMeasure, includeDesign, noise = [], headings = {} } = {}) {
  const concepts = [];
  const notes = [];
  const push = (label, terms, op = "AND", vocab = emptyVocab()) => {
    if (!terms.length && !Object.values(vocab).some((v) => v.length)) return;
    concepts.push({ label, op, terms, vocab, mesh: vocab.mesh || [] });
  };

  push("Population", splitTerms(facets.population), "AND", vocabFor(headings, ["population"]));

  const intTerms = splitTerms(facets.intervention);
  const cmpTerms = splitTerms(facets.standard);
  const intVocab = vocabFor(headings, ["intervention"]);
  const cmpVocab = vocabFor(headings, ["standard"]);

  if (intTerms.length && cmpTerms.length) {
    const mergedVocab = emptyVocab();
    for (const k of Object.keys(mergedVocab)) {
      mergedVocab[k] = [...new Set([...(intVocab[k] || []), ...(cmpVocab[k] || [])])];
    }
    concepts.push({
      label: "Intervention or comparator", op: "AND",
      terms: [...new Set([...intTerms, ...cmpTerms])], vocab: mergedVocab, mesh: mergedVocab.mesh,
    });
    notes.push("Intervention and comparator are grouped with OR inside an AND block to maintain comprehensive recall.");
  } else if (intTerms.length) {
    push("Intervention", intTerms, "AND", intVocab);
  } else if (cmpTerms.length) {
    push("Comparator", cmpTerms, "AND", cmpVocab);
  }

  if (includeMeasure) {
    push("Measure", splitTerms(facets.measure), "AND", vocabFor(headings, ["measure"]));
    notes.push("The outcome block is AND-ed in. Outcomes are inconsistently reported in titles/abstracts.");
  } else if (splitTerms(facets.measure).length) {
    notes.push("Outcome terms are recorded but kept out of the Boolean to protect recall.");
  }

  if (includeDesign) push("Design", splitTerms(facets.design), "AND", vocabFor(headings, ["design"]));
  const noiseTerms = splitTerms(noise);
  if (noiseTerms.length) {
    concepts.push({ label: "Excluded noise", op: "NOT", terms: noiseTerms, vocab: emptyVocab(), mesh: [] });
    notes.push("The NOT block removes observed noise terms.");
  }
  return { concepts, notes };
}

export default function QuestionBuilder({ projectId, review, onReviewChange, onNote, onOpenStrategy, onNavigateNext }) {
  const initialQuestions = useMemo(() => {
    if (review?.questions && Array.isArray(review.questions) && review.questions.length > 0) {
      return review.questions;
    }
    const defaultQ = review?.question || "In hospitalized adults with COVID-19, do Janus kinase (JAK) inhibitors compared to standard of care reduce 28-day mortality in randomized controlled trials?";
    return [
      {
        id: "q1",
        name: "Q1: 28-Day Mortality (Primary)",
        text: defaultQ,
        primary: true,
        facets: {
          population: ["hospitalized adults with COVID-19", "severe COVID-19"],
          realm: ["clinical medicine", "critical care"],
          intervention: ["JAK inhibitors", "baricitinib", "tofacitinib", "ruxolitinib"],
          standard: ["standard of care", "placebo", "dexamethasone"],
          measure: ["28-day mortality", "all-cause death"],
          time: ["28-day follow-up"],
          geography: [],
          design: ["randomised controlled trial", "RCT"]
        }
      },
      {
        id: "q2",
        name: "Q2: Mechanical Ventilation Progression",
        text: "In hospitalized adults with COVID-19, do JAK inhibitors prevent progression to invasive mechanical ventilation?",
        primary: false,
        facets: {
          population: ["hospitalized adults with COVID-19"],
          realm: ["clinical medicine"],
          intervention: ["JAK inhibitors", "baricitinib"],
          standard: ["standard of care", "placebo"],
          measure: ["invasive mechanical ventilation", "ECMO", "intubation"],
          time: ["28 days"],
          geography: [],
          design: ["RCT"]
        }
      },
      {
        id: "q3",
        name: "Q3: Serious Adverse Events & Infections",
        text: "In COVID-19 patients treated with JAK inhibitors, what is the incidence of secondary bacterial/fungal infections and thromboembolism?",
        primary: false,
        facets: {
          population: ["COVID-19 patients"],
          realm: ["clinical medicine", "pharmacovigilance"],
          intervention: ["JAK inhibitors"],
          standard: ["control", "placebo"],
          measure: ["secondary infection", "thromboembolism", "serious adverse event"],
          time: ["60 days"],
          geography: [],
          design: ["RCT", "prospective cohort"]
        }
      }
    ];
  }, [review?.questions, review?.question]);

  const [questions, setQuestions] = useState(initialQuestions);
  const [activeQuestionId, setActiveQuestionId] = useState(initialQuestions[0]?.id || "q1");

  const activeQuestion = useMemo(
    () => questions.find((q) => q.id === activeQuestionId) || questions[0] || initialQuestions[0],
    [questions, activeQuestionId, initialQuestions]
  );

  const [facets, setFacets] = useState(activeQuestion.facets || {});
  const [includeMeasure, setIncludeMeasure] = useState(false);
  const [includeDesign, setIncludeDesign] = useState(false);
  const [noise, setNoise] = useState([]);
  const [rightTab, setRightTab] = useState("BLOCKS");
  const [headings, setHeadings] = useState({});

  useEffect(() => {
    setFacets(activeQuestion.facets || {});
  }, [activeQuestionId]);

  const updateActiveFacets = (key, value) => {
    const updated = { ...facets, [key]: value };
    setFacets(updated);
    setQuestions((prev) =>
      prev.map((q) =>
        q.id === activeQuestionId
          ? { ...q, facets: updated, text: composeQuestion(updated) || q.text }
          : q
      )
    );
  };

  const addQuestion = () => {
    const nextNum = questions.length + 1;
    const newQ = {
      id: `q${Date.now()}`,
      name: `Q${nextNum}: Sub-Question`,
      text: "",
      primary: false,
      facets: {
        population: [],
        realm: ["clinical medicine"],
        intervention: [],
        standard: [],
        measure: [],
        time: [],
        geography: [],
        design: []
      }
    };
    setQuestions((prev) => [...prev, newQ]);
    setActiveQuestionId(newQ.id);
  };

  const removeQuestion = (id) => {
    if (questions.length <= 1) return;
    const remaining = questions.filter((q) => q.id !== id);
    setQuestions(remaining);
    setActiveQuestionId(remaining[0].id);
  };

  const composedText = useMemo(() => composeQuestion(facets), [facets]);
  const currentQuestionText = composedText || activeQuestion.text;

  const { concepts, notes } = useMemo(
    () => buildIsrConcepts(facets, { includeMeasure, includeDesign, noise, headings }),
    [facets, includeMeasure, includeDesign, noise, headings]
  );

  const databases = useMemo(() => routeDatabases(facets.realm), [facets.realm]);

  const preview = useMemo(() => {
    if (!concepts.length || !databases.length) return [];
    try { return buildStrategy(concepts, databases.slice(0, 3)); } catch { return []; }
  }, [concepts, databases]);

  const records = useMemo(() => (review?.objects?.records || []).filter((r) => !r.isDuplicate), [review]);
  const matcher = useMemo(() => compileMatcher(concepts), [concepts]);
  const corpus = useMemo(
    () => (records.length && matcher.blocks.length ? screenCorpus(records, matcher) : null),
    [records, matcher]
  );

  const press = useMemo(() => {
    if (!concepts.length) return null;
    const sentinelEvidence = corpus?.ok
      ? [{ id: "corpus-recall", status: corpus.lostIncluded === 0 ? "pass" : "fail",
           note: corpus.lostIncluded === 0
             ? `every record screened in is retrieved by this strategy (${corpus.matchedCount}/${corpus.total} matched)`
             : `${corpus.lostIncluded} record(s) screened in are NOT retrieved by this strategy` }]
      : [];
    try {
      return assessPress({ question: currentQuestionText, concepts, strategies: preview, sentinelEvidence });
    } catch {
      return null;
    }
  }, [currentQuestionText, concepts, preview, corpus]);

  const applyAndBuild = useCallback((thenOpen) => {
    if (!projectId) return;
    const current = loadReview(projectId) || createReview(currentQuestionText);
    const primaryQ = questions.find((q) => q.primary) || questions[0];

    const next = {
      ...current,
      question: primaryQ.text || currentQuestionText,
      questions,
      selectedSources: current.selectedSources?.length ? current.selectedSources : databases,
      protocol: {
        ...current.protocol,
        pico: {
          population: splitTerms(facets.population).join(", ") || null,
          intervention: splitTerms(facets.intervention).join(", ") || null,
          comparator: splitTerms(facets.standard).join(", ") || null,
          outcomes: splitTerms(facets.measure),
          studyDesign: splitTerms(facets.design).join(", ") || null,
          setting: splitTerms(facets.geography).join(", ") || null,
          timeframe: facets.time || null,
        },
        prism: { facets, includeMeasure, includeDesign, noise, headings, routedDatabases: databases, tokenised: true },
        concepts,
        strategyNotes: notes,
        strategySource: "search/isr.json",
      },
    };
    saveReview(projectId, next);

    const stamp = new Date().toISOString();
    const isr = { question: currentQuestionText, questions, concepts, databases, savedAt: stamp, notes };
    putFile(projectId, { path: "search/isr.json", name: "isr.json", type: "provenance", content: JSON.stringify(isr, null, 2) });

    onReviewChange?.(next);
    onNote?.(`Multi-question review updated (${questions.length} questions). Search strategy written to search/isr.json.`, "ok");
    if (thenOpen) onOpenStrategy?.(currentQuestionText);
  }, [projectId, currentQuestionText, questions, facets, concepts, notes, databases, includeMeasure, includeDesign, noise, headings, onReviewChange, onNote, onOpenStrategy]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Multi-Question Selector Bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 8px", background: "var(--bg-header)", borderBottom: "1px solid var(--line)" }}>
        <span style={{ fontSize: 10, fontFamily: "var(--mono)", color: "var(--fg-dim)", textTransform: "uppercase", marginRight: 4 }}>
          Questions ({questions.length}):
        </span>
        {questions.map((q, idx) => {
          const isSel = q.id === activeQuestionId;
          return (
            <button
              key={q.id}
              className={`wb-btn ${isSel ? "on" : ""}`}
              onClick={() => setActiveQuestionId(q.id)}
            >
              <span>{q.name || `Question ${idx + 1}`}</span>
              {q.primary && <span style={{ fontSize: 9, color: "var(--ok)", marginLeft: 2 }}>[PRIMARY]</span>}
              {questions.length > 1 && (
                <span
                  onClick={(e) => { e.stopPropagation(); removeQuestion(q.id); }}
                  style={{ marginLeft: 4, opacity: 0.6, cursor: "pointer" }}
                >
                  ×
                </span>
              )}
            </button>
          );
        })}
        <button className="wb-btn" onClick={addQuestion} title="Add another research question">
          + Question
        </button>
        <span className="wb-spacer" />
        <button className="wb-btn on" onClick={() => applyAndBuild(false)}>
          Save Question & ISR
        </button>
        {onNavigateNext && (
          <button className="wb-btn" onClick={onNavigateNext}>
            Next: Protocols →
          </button>
        )}
      </div>

      {/* Main Grid: Facets (Left) & Compiled Boolean / PRESS (Right) */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(380px, 1.2fr) minmax(340px, 1fr)", flex: 1, minHeight: 0 }}>
        {/* Facets Column */}
        <div style={{ borderRight: "1px solid var(--line)", overflow: "auto", background: "var(--bg-panel)" }}>
          <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--line)", background: "var(--bg-panel-2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ fontSize: 10, fontFamily: "var(--mono)", color: "var(--fg-faint)", textTransform: "uppercase" }}>Question Label</span>
              <label style={{ fontSize: 10, color: "var(--fg-dim)", display: "flex", alignItems: "center", gap: 4, cursor: "default" }}>
                <input
                  type="checkbox"
                  checked={activeQuestion.primary}
                  onChange={(e) => {
                    setQuestions((prev) =>
                      prev.map((q) => ({
                        ...q,
                        primary: q.id === activeQuestionId ? e.target.checked : false
                      }))
                    );
                  }}
                />
                Primary Question
              </label>
            </div>
            <input
              type="text"
              className="wb-input"
              style={{ width: "100%", height: 22, fontWeight: 600 }}
              value={activeQuestion.name}
              onChange={(e) => {
                const val = e.target.value;
                setQuestions((prev) =>
                  prev.map((q) => (q.id === activeQuestionId ? { ...q, name: val } : q))
                );
              }}
            />
          </div>

          <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--line)", fontSize: 11.5, color: "var(--fg-bright)", lineHeight: 1.4, fontStyle: "italic", background: "var(--bg-input)" }}>
            "{currentQuestionText || "Add population and intervention terms to synthesise question text…"}"
          </div>

          <div className="wb-insp-title">PRISM 8-Facet Decomposition</div>
          <table className="wb-grid wb-grid-soft">
            <thead>
              <tr>
                <th style={{ width: 28 }} />
                <th style={{ width: 160 }}>Facet</th>
                <th>Terms (Enter makes a token)</th>
              </tr>
            </thead>
            <tbody>
              {PRISM_FACETS.map((f) => (
                <tr key={f.key}>
                  <td style={{ fontFamily: "var(--mono)", color: "var(--accent)", textAlign: "center", fontWeight: 700 }}>{f.code}</td>
                  <td title={f.hint} style={{ fontWeight: 500 }}>{f.label}</td>
                  <td style={{ padding: "2px 4px", whiteSpace: "normal" }}>
                    <TokenField
                      value={facets[f.key] || []}
                      onChange={(tokens) => updateActiveFacets(f.key, tokens)}
                      placeholder={`e.g. ${f.hint}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Compiled Strategy & PRESS Inspection */}
        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg-panel-2)" }}>
          <div className="wb-tabs">
            {["BLOCKS", "STRATEGIES", "PRESS 2015"].map((t) => (
              <div
                key={t}
                className={`pt ${rightTab === t ? "sel" : ""}`}
                onClick={() => setRightTab(t)}
              >
                {t}
              </div>
            ))}
          </div>

          <div style={{ flex: 1, overflow: "auto", padding: 10 }}>
            {rightTab === "BLOCKS" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div className="wb-insp-title">
                  Search Concepts ({concepts.length} Blocks)
                </div>
                {concepts.map((c, i) => (
                  <div key={i} style={{ background: "var(--bg-panel)", border: "1px solid var(--line)", borderRadius: 2, padding: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontWeight: 600, color: "var(--accent)" }}>{c.label}</span>
                      <span className="wb-count">{c.op}</span>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                      {c.terms.map((t, ti) => (
                        <span key={ti} className="wb-tag on">{t}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {rightTab === "PRESS 2015" && press && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div className="wb-insp-title">PRESS 2015 Evidence Assessment</div>
                {(press.elements || []).map((el, ei) => (
                  <div key={ei} style={{ background: "var(--bg-panel)", border: "1px solid var(--line)", borderRadius: 2, padding: "6px 8px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontWeight: 600, color: "var(--fg-bright)", fontSize: 11 }}>{el.name}</span>
                      <span className="wb-count" style={{ color: el.status === "pass" ? "var(--ok)" : "var(--warn)" }}>
                        {el.status?.toUpperCase()}
                      </span>
                    </div>
                    <div style={{ fontSize: 10.5, color: "var(--fg-dim)", marginTop: 2, lineHeight: 1.35 }}>
                      {el.note}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {rightTab === "STRATEGIES" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div className="wb-insp-title">Database Search Syntax Translation</div>
                {preview.map((s, idx) => (
                  <div key={idx} style={{ background: "var(--bg-panel)", border: "1px solid var(--line)", borderRadius: 2, padding: 8 }}>
                    <div style={{ fontWeight: 600, color: "var(--fg-bright)", textTransform: "uppercase", fontSize: 10, fontFamily: "var(--mono)", marginBottom: 4 }}>
                      {s.database}
                    </div>
                    <pre style={{ background: "var(--bg-input)", border: "1px solid var(--line)", borderRadius: 2, padding: 6, margin: 0, fontSize: 10.5, fontFamily: "var(--mono)", color: "var(--fg)", whiteSpace: "pre-wrap" }}>
                      {s.query}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
