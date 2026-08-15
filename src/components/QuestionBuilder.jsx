import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Plus, Trash2, CheckCircle, HelpCircle, FileText, Sparkles, BookOpen, Layers, ArrowRight } from "lucide-react";
import { createReview, saveReview, loadReview } from "../engine/reviewengine.js";
import { putFile, getFile } from "../engine/projectstore.js";
import { buildStrategy, STRATEGY_DBS, databaseName } from "../engine/searchStrategy.js";
import TokenField, { toTokens } from "./TokenField.jsx";
import { compileMatcher, screenCorpus, synonymCandidates, noiseCandidates, buildTermIndex, topTerms, highlightSpans, recordText } from "../engine/termIndex.js";
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
  // Multi-Question State
  const initialQuestions = useMemo(() => {
    if (review?.questions && Array.isArray(review.questions) && review.questions.length > 0) {
      return review.questions;
    }
    const defaultQ = review?.question || "In hospitalized adults with COVID-19, do Janus kinase (JAK) inhibitors compared to standard of care reduce 28-day mortality in randomized controlled trials?";
    return [
      {
        id: "q1",
        name: "Primary: Efficacy & Mortality",
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
        name: "Secondary: Mechanical Ventilation",
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
        name: "Secondary: Serious Adverse Events",
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
    onNote?.(`Multi-question review updated (${questions.length} questions). Search strategy compiled to search/isr.json.`, "ok");
    if (thenOpen) onOpenStrategy?.(currentQuestionText);
  }, [projectId, currentQuestionText, questions, facets, concepts, notes, databases, includeMeasure, includeDesign, noise, headings, onReviewChange, onNote, onOpenStrategy]);

  return (
    <div className="flex flex-col h-full bg-[#090D15] text-slate-200 overflow-hidden font-mono select-none">
      {/* Top Banner & Multi-Question Bar */}
      <div className="bg-[#0D131F] border-b border-slate-800 px-4 py-2 shrink-0 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase font-bold text-cyan-400">
              STEP 2: RESEARCH QUESTIONS ({questions.length})
            </span>
            <span className="text-[9px] text-slate-500 font-mono">
              PRISM / PICO Framing & Syntax Compilation
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => applyAndBuild(false)}
              className="px-3 py-1 bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold rounded-sm shadow-sm transition-colors flex items-center gap-1.5"
            >
              <CheckCircle className="w-3 h-3" /> Save Questions & Build ISR
            </button>
            {onNavigateNext && (
              <button
                onClick={onNavigateNext}
                className="px-3 py-1 bg-[#162236] hover:bg-[#1E2E48] text-cyan-300 border border-cyan-500/30 text-xs font-semibold rounded-sm transition-colors flex items-center gap-1.5"
              >
                Next: Protocols <ArrowRight className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Question Selector Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {questions.map((q, idx) => {
            const isSel = q.id === activeQuestionId;
            return (
              <div
                key={q.id}
                onClick={() => setActiveQuestionId(q.id)}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-sm text-xs cursor-pointer border transition-colors shrink-0 ${
                  isSel
                    ? "bg-[#18283E] text-cyan-300 border-cyan-500/60 font-bold"
                    : "bg-[#090D14] text-slate-400 border-slate-800 hover:text-slate-200"
                }`}
              >
                <span>{q.name || `Question ${idx + 1}`}</span>
                {q.primary && (
                  <span className="text-[8px] px-1 py-0.2 bg-cyan-950 text-cyan-400 border border-cyan-800 rounded-sm">
                    PRIMARY
                  </span>
                )}
                {questions.length > 1 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); removeQuestion(q.id); }}
                    className="hover:text-rose-400 ml-1 text-[10px]"
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}

          <button
            onClick={addQuestion}
            className="flex items-center gap-1 px-2.5 py-1 bg-[#090D14] hover:bg-slate-800 border border-dashed border-slate-700 text-slate-400 hover:text-slate-200 text-xs rounded-sm shrink-0"
          >
            <Plus className="w-3 h-3" /> Add Question
          </button>
        </div>
      </div>

      {/* Main 2-Column Decomposition and Compiler */}
      <div className="flex-1 grid grid-cols-12 min-h-0 overflow-hidden">
        {/* Left Column: PRISM Facet Matrix */}
        <div className="col-span-7 border-r border-slate-800 overflow-y-auto p-4 space-y-4 bg-[#0C121D]">
          <div className="space-y-1.5 bg-[#090D14] border border-slate-800 rounded-sm p-3">
            <div className="flex items-center justify-between text-[10px] text-slate-500 font-bold uppercase">
              <span>Question Label & Primary Status</span>
              <label className="flex items-center gap-1.5 cursor-pointer text-slate-400">
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
                  className="accent-cyan-400"
                />
                Primary Question
              </label>
            </div>
            <input
              type="text"
              value={activeQuestion.name}
              onChange={(e) => {
                const val = e.target.value;
                setQuestions((prev) =>
                  prev.map((q) => (q.id === activeQuestionId ? { ...q, name: val } : q))
                );
              }}
              className="w-full bg-[#131B2B] border border-slate-800 rounded-sm px-2.5 py-1 text-xs text-white font-mono focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="bg-[#090D14] border border-slate-800 rounded-sm p-3 space-y-1">
            <div className="text-[10px] uppercase font-bold text-slate-500">Synthesised Question Text</div>
            <div className="text-xs text-slate-100 font-sans italic leading-relaxed">
              "{currentQuestionText || "Add terms to population and intervention to synthesise question..."}"
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-[10px] font-bold uppercase text-slate-400">
              PRISM 8-Facet Block Decomposition
            </div>
            <div className="space-y-2">
              {PRISM_FACETS.map((f) => (
                <div key={f.key} className="bg-[#090D14] border border-slate-800/80 rounded-sm p-2.5 space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-sm bg-cyan-950 text-cyan-400 font-mono font-bold flex items-center justify-center text-[10px] border border-cyan-800">
                        {f.code}
                      </span>
                      <span className="font-semibold text-slate-200">{f.label}</span>
                    </div>
                    <span className="text-[10px] text-slate-500 font-mono">{f.hint}</span>
                  </div>

                  <div className="pt-1">
                    <TokenField
                      value={facets[f.key] || []}
                      onChange={(tokens) => updateActiveFacets(f.key, tokens)}
                      placeholder={`Type term and press Enter (e.g. ${f.hint})`}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Compiled Search ISR & PRESS Peer Review */}
        <div className="col-span-5 flex flex-col bg-[#090D15] overflow-y-auto p-4 space-y-4">
          <div className="flex border-b border-slate-800 pb-1 gap-2 text-xs">
            {["BLOCKS", "STRATEGIES", "PRESS 2015", "THEMES"].map((t) => (
              <button
                key={t}
                onClick={() => setRightTab(t)}
                className={`px-3 py-1 font-bold text-[10px] transition-colors rounded-sm ${
                  rightTab === t
                    ? "bg-[#18283E] text-cyan-300 border border-cyan-500/40"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {rightTab === "BLOCKS" && (
            <div className="space-y-3 text-xs">
              <div className="text-[10px] font-bold uppercase text-slate-400">
                Boolean Search Concepts ({concepts.length} Blocks)
              </div>
              <div className="space-y-2">
                {concepts.map((c, i) => (
                  <div key={i} className="bg-[#0C121D] border border-slate-800 rounded-sm p-3 space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-bold">
                      <span className="text-cyan-400">{c.label}</span>
                      <span className="text-[10px] px-1.5 py-0.2 bg-slate-800 text-slate-300 rounded-sm">
                        {c.op}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {c.terms.map((t, ti) => (
                        <span key={ti} className="text-[10px] bg-[#131B2B] text-slate-200 border border-slate-700 px-1.5 py-0.5 rounded-sm">
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {rightTab === "PRESS 2015" && press && (
            <div className="space-y-3 text-xs">
              <div className="text-[10px] font-bold uppercase text-slate-400">
                PRESS 2015 Evidence Assessment
              </div>
              <div className="space-y-2">
                {(press.elements || []).map((el, ei) => (
                  <div key={ei} className="bg-[#0C121D] border border-slate-800 rounded-sm p-2.5 space-y-1">
                    <div className="flex items-center justify-between text-[11px] font-bold">
                      <span className="text-slate-200">{el.name}</span>
                      <span className={`text-[9px] px-1.5 py-0.2 rounded-sm ${el.status === "pass" ? "bg-emerald-950 text-emerald-400" : "bg-amber-950 text-amber-400"}`}>
                        {el.status?.toUpperCase()}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-400 leading-relaxed font-sans">{el.note}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {rightTab === "STRATEGIES" && (
            <div className="space-y-3 text-xs">
              <div className="text-[10px] font-bold uppercase text-slate-400">
                Native Database Search Syntax Preview
              </div>
              <div className="space-y-2">
                {preview.map((s, idx) => (
                  <div key={idx} className="bg-[#0C121D] border border-slate-800 rounded-sm p-2.5 space-y-1">
                    <div className="text-xs font-bold text-cyan-300 uppercase">{s.database}</div>
                    <pre className="text-[10px] text-slate-300 bg-[#070B12] p-2 border border-slate-800 rounded-sm overflow-x-auto whitespace-pre-wrap font-mono">
                      {s.query}
                    </pre>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
