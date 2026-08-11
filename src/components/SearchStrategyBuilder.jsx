import React, { useState } from "react";
import { Plus, X, Copy, Check, ClipboardList, ChevronDown, ChevronRight, Sparkles, Loader2, Atom, FileDown, AlertCircle, ExternalLink, ShieldCheck, Play, Database, LogIn } from "lucide-react";
import { buildStrategy, STRATEGY_DBS, OPERATORS, VOCABULARIES, databaseName } from "../engine/searchStrategy.js";
import { allKnownDatabases, loadSelection, toggleSelection } from "../engine/accessPoints.js";
import {
  expandConcept,
  NATIVE_VOCABULARIES,
  saveTerminologyApiKey,
  terminologyCredentialStatus,
  terminologySourceUrl,
  THESAURUS_SOURCES,
} from "../engine/medvocab.js";
import {
  domainSupportsExpansion,
  expandResearchConcept,
  researchVocabularyUrl,
  RESOURCE_TYPE_POLICY,
  sourcesForDomain,
  VOCABULARY_DOMAINS,
} from "../engine/researchVocabularies.js";
import { DATA_SOURCES, sourceEnabled } from "../engine/academic.js";
import { activeProvider, callProvider } from "../engine/providers.js";
import { openInApp } from "../engine/openBus.js";
import { assessPress } from "../engine/pressReview.js";
import { executeCompiledStrategies, toCsv, toRis } from "../engine/reviewsearch.js";
import { activeProject, putFile } from "../engine/projectstore.js";

const CORE_DBS = ["pubmed", "ovid_embase", "cochrane", "europepmc", "cinahl"];
const OP_COLOR = { AND: "text-[var(--color-brand-primary)]", OR: "text-emerald-500", NOT: "text-rose-500" };

const emptyVocab = () => ({ mesh: [], emtree: [], cinahl: [], apa: [], decs: [] });
const newConcept = (label, terms = "") => ({
  label,
  terms,
  op: "AND",
  vocab: emptyVocab(),
  headingRecords: [],
  vocabularyRecords: [],
  expansion: null,
  researchExpansion: null,
});
const splitTerms = (value) => String(value || "").split(",").map((term) => term.trim()).filter(Boolean);
const uniqueTerms = (values) => [...new Map(values.map((value) => [String(value).trim().toLocaleLowerCase(), String(value).trim()])).values()].filter(Boolean);
const activeVocabularyRecords = (concept) => {
  const active = new Set(splitTerms(concept.terms).map((term) => term.toLocaleLowerCase()));
  return (concept.vocabularyRecords || []).filter((record) => active.has(String(record.label || "").trim().toLocaleLowerCase()));
};
const groupCandidatesBySource = (items = []) => [...items.reduce((groups, item) => {
  if (!groups.has(item.source)) groups.set(item.source, []);
  groups.get(item.source).push(item);
  return groups;
}, new Map()).entries()];

function CandidateGroup({ label, items = [], selected = [], onAdd, onAddAll, onOpen, addLabel = "Add" }) {
  if (!items.length) return null;
  const selectedKeys = new Set(selected.map((value) => String(value).toLocaleLowerCase()));
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[9px] font-mono font-bold uppercase tracking-wide text-zinc-400">{label}</div>
        {onAddAll && items.some((item) => !selectedKeys.has(String(item.label).toLocaleLowerCase())) && <button type="button" onClick={() => onAddAll(items)} className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-emerald-500/40 text-emerald-600 dark:text-emerald-500 hover:bg-emerald-500/10">Add all</button>}
      </div>
      <div className="flex flex-wrap gap-1">
        {items.slice(0, 16).map((item, index) => {
          const key = `${item.source || "source"}-${item.id || item.label}-${index}`;
          const added = selectedKeys.has(String(item.label).toLocaleLowerCase());
          return (
            <span key={key} className="inline-flex items-center rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900">
              <button
                type="button"
                disabled={added}
                onClick={() => onAdd(item)}
                aria-label={`${addLabel} ${item.label}`}
                title={`${item.sourceLabel || item.source || "candidate"} · ${item.verification || "review required"}${item.id ? ` · ${item.id}` : ""}`}
                className="text-[9px] font-mono px-1.5 py-1 text-zinc-600 dark:text-zinc-300 hover:text-emerald-600 disabled:text-emerald-600 disabled:cursor-default"
              >
                {added ? "✓" : "+"} {item.label}
              </button>
              {(item.uri || (item.source && item.source !== "ai")) && (
                <button type="button" onClick={() => onOpen(item)} aria-label={`Open source for ${item.label}`} className="px-1 py-1 text-zinc-400 hover:text-indigo-500 border-l border-zinc-200 dark:border-zinc-700">
                  <ExternalLink className="h-2.5 w-2.5" />
                </button>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export default function SearchStrategyBuilder({ initialQuestion = "" }) {
  const [concepts, setConcepts] = useState([
    newConcept("Population"),
    newConcept("Intervention"),
  ]);
  const enabledDbs = STRATEGY_DBS.filter((id) => DATA_SOURCES.some((source) => source.id === id && sourceEnabled(id)));
  const [dbs, setDbs] = useState(enabledDbs.length ? enabledDbs : CORE_DBS);
  // Databases discovered behind the operator's gateways. These are not in the
  // built-in list by definition — that is the point of detecting them — so the
  // ticked ones are compiled as { platform, database } targets alongside it.
  const [detected] = useState(() => allKnownDatabases());
  const [detectedSelection, setDetectedSelection] = useState(() => loadSelection());
  const [copied, setCopied] = useState(null);
  const [openLines, setOpenLines] = useState({});
  const [busy, setBusy] = useState(null);
  const [question, setQuestion] = useState(initialQuestion);
  const [building, setBuilding] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState("");
  const [runRows, setRunRows] = useState([]);
  const [runSummary, setRunSummary] = useState(null);
  const [credentialDrafts, setCredentialDrafts] = useState({ umls: "", bioportal: "" });
  const [credentialNotice, setCredentialNotice] = useState("");
  const [vocabularyDomain, setVocabularyDomain] = useState("medical");
  const provider = activeProvider();

  const setC = (index, patch) => setConcepts((current) => current.map((concept, conceptIndex) => (conceptIndex === index ? { ...concept, ...patch } : concept)));
  const updateC = (index, updater) => setConcepts((current) => current.map((concept, conceptIndex) => (conceptIndex === index ? updater(concept) : concept)));
  const addConcept = () => setConcepts((current) => [...current, newConcept(`Concept ${current.length + 1}`)]);
  const removeConcept = (index) => setConcepts((current) => current.filter((_, conceptIndex) => conceptIndex !== index));
  const toggleDb = (id) => setDbs((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));

  const addFreeText = (index, candidate) => updateC(index, (concept) => ({
    ...concept,
    terms: uniqueTerms([...splitTerms(concept.terms), candidate.label]).join(", "),
  }));
  const addManyFreeText = (index, candidates) => updateC(index, (concept) => ({
    ...concept,
    terms: uniqueTerms([...splitTerms(concept.terms), ...candidates.map((candidate) => candidate.label)]).join(", "),
  }));

  const addManyHeadings = (index, candidates, vocabulary = "mesh") => candidates.forEach((candidate) => addHeading(index, candidate, vocabulary));

  const setFreeTextTerms = (index, value) => updateC(index, (concept) => {
    const terms = splitTerms(value);
    const active = new Set(terms.map((term) => term.toLocaleLowerCase()));
    return {
      ...concept,
      terms: value,
      vocabularyRecords: (concept.vocabularyRecords || []).filter((record) => active.has(record.label.toLocaleLowerCase())),
    };
  });

  const addResearchCandidate = (index, candidate) => updateC(index, (concept) => {
    const label = String(candidate.label || "").trim();
    if (!label) return concept;
    const record = {
      label,
      source: candidate.source,
      sourceLabel: candidate.sourceLabel,
      sourceId: candidate.id || "",
      uri: candidate.uri || "",
      relation: candidate.relation,
      resourceType: candidate.resourceType,
      domain: candidate.domain,
      verification: candidate.verification || "source-asserted",
      appliedAs: "free-text",
    };
    const key = `${record.source}|${record.sourceId}|${label.toLocaleLowerCase()}`;
    return {
      ...concept,
      terms: uniqueTerms([...splitTerms(concept.terms), label]).join(", "),
      vocabularyRecords: [
        ...(concept.vocabularyRecords || []).filter((item) => `${item.source}|${item.sourceId || ""}|${item.label.toLocaleLowerCase()}` !== key),
        record,
      ],
    };
  });

  const addHeading = (index, candidate, vocabulary = candidate.vocabulary) => updateC(index, (concept) => {
    const label = String(candidate.label || "").trim();
    if (!label || !NATIVE_VOCABULARIES.some((item) => item.id === vocabulary)) return concept;
    const vocab = { ...emptyVocab(), ...(concept.vocab || {}) };
    vocab[vocabulary] = uniqueTerms([...(vocab[vocabulary] || []), label]);
    const headingRecords = [
      ...(concept.headingRecords || []).filter((record) => !(record.vocabulary === vocabulary && record.label.toLocaleLowerCase() === label.toLocaleLowerCase())),
      {
        label,
        vocabulary,
        source: candidate.source || "manual",
        sourceLabel: candidate.sourceLabel || "Operator-entered",
        sourceId: candidate.id || "",
        uri: candidate.uri || "",
        relation: candidate.relation || "native-heading",
        verification: candidate.verification || "operator-entered",
      },
    ];
    return { ...concept, vocab, headingRecords };
  });

  const setNativeHeadings = (index, vocabulary, value) => updateC(index, (concept) => {
    const headings = uniqueTerms(splitTerms(value));
    const vocab = { ...emptyVocab(), ...(concept.vocab || {}), [vocabulary]: headings };
    const retained = (concept.headingRecords || []).filter((record) => record.vocabulary !== vocabulary || headings.some((heading) => heading.toLocaleLowerCase() === record.label.toLocaleLowerCase()));
    const known = new Set(retained.filter((record) => record.vocabulary === vocabulary).map((record) => record.label.toLocaleLowerCase()));
    const manual = headings.filter((heading) => !known.has(heading.toLocaleLowerCase())).map((heading) => ({
      label: heading,
      vocabulary,
      source: "manual",
      sourceLabel: "Operator-entered",
      sourceId: "",
      uri: "",
      relation: "native-heading",
      verification: "requires-native-check",
    }));
    return { ...concept, vocab, headingRecords: [...retained, ...manual] };
  });

  const explode = async (index) => {
    const concept = concepts[index];
    const seed = (splitTerms(concept.terms)[0] || "").trim();
    if (!seed) return;
    setBusy(index);
    try {
      if (vocabularyDomain === "medical") {
        const expansion = await expandConcept(seed);
        setC(index, { expansion });
      } else {
        const researchExpansion = await expandResearchConcept(seed, { domain: vocabularyDomain });
        setC(index, { researchExpansion });
      }
    } catch {
      if (vocabularyDomain === "medical") {
        setC(index, { expansion: { descriptors: [], entryTerms: [], narrower: [], mapped: [], ai: [], warnings: ["Terminology expansion failed. Existing terms were not changed."] } });
      } else {
        setC(index, { researchExpansion: { domain: vocabularyDomain, candidates: [], warnings: ["Vocabulary expansion failed. Existing terms were not changed."] } });
      }
    } finally {
      setBusy(null);
    }
  };

  const addAllExploded = (index) => updateC(index, (concept) => {
    const candidates = concept.expansion?.narrower || [];
    const vocab = { ...emptyVocab(), ...(concept.vocab || {}) };
    vocab.mesh = uniqueTerms([...(vocab.mesh || []), ...candidates.map((candidate) => candidate.label)]);
    const records = candidates.map((candidate) => ({
      label: candidate.label,
      vocabulary: "mesh",
      source: candidate.source,
      sourceLabel: candidate.sourceLabel,
      sourceId: candidate.id || "",
      uri: candidate.uri || "",
      relation: candidate.relation,
      verification: candidate.verification,
    }));
    const recordKeys = new Set(records.map((record) => `${record.vocabulary}|${record.label.toLocaleLowerCase()}`));
    return {
      ...concept,
      vocab,
      headingRecords: [...(concept.headingRecords || []).filter((record) => !recordKeys.has(`${record.vocabulary}|${record.label.toLocaleLowerCase()}`)), ...records],
      expansion: { ...concept.expansion, narrower: [] },
    };
  });

  const buildFromQuestion = async () => {
    if (!question.trim() || !provider) return;
    setBuilding(true);
    try {
      const raw = await callProvider(provider.id, [
        { role: "system", content: `You are a research information specialist working in the ${VOCABULARY_DOMAINS.find((item) => item.id === vocabularyDomain)?.label || vocabularyDomain} domain. Decompose a review question into concept blocks. Return candidate free-text terms only and output strict JSON.` },
        { role: "user", content: `Question: "${question}". Return JSON: {"concepts":[{"label":"Domain-appropriate concept label","terms":["candidate term 1","candidate term 2"]}]}. Use 2-4 concepts with 3-8 candidate free-text terms each.` },
      ], { json: true });
      const match = raw.match(/\{[\s\S]*\}/);
      const parsed = match ? JSON.parse(match[0]) : {};
      if (Array.isArray(parsed.concepts)) setConcepts(parsed.concepts.map((concept) => newConcept(concept.label, (concept.terms || []).join(", "))));
    } catch {
      // Keep the operator's existing strategy unchanged.
    } finally {
      setBuilding(false);
    }
  };

  const storeTerminologyKey = async (sourceId) => {
    const key = credentialDrafts[sourceId].trim();
    if (!key) return;
    const result = await saveTerminologyApiKey(sourceId, key);
    if (result.ok) {
      setCredentialDrafts((current) => ({ ...current, [sourceId]: "" }));
      setCredentialNotice(`${sourceId === "umls" ? "UMLS" : "BioPortal"} key stored in the encrypted user vault.`);
    } else {
      setCredentialNotice(result.error || "Unlock Security & Vault before storing a terminology API key.");
    }
  };

  const isr = concepts.map((concept) => ({
    label: concept.label,
    op: concept.op,
    terms: splitTerms(concept.terms),
    vocab: { ...emptyVocab(), ...(concept.vocab || {}) },
    mesh: concept.vocab?.mesh || [],
    headingRecords: concept.headingRecords || [],
    vocabularyRecords: activeVocabularyRecords(concept),
  }));
  const detectedTargets = detected
    .filter((database) => detectedSelection.includes(database.id))
    .map((database) => ({ platform: database.platform, database: database.name }));
  const compileTargets = [...dbs, ...detectedTargets];
  const strategies = isr.some((concept) => concept.terms.length || Object.values(concept.vocab).some((values) => values.length)) ? buildStrategy(isr, compileTargets) : [];
  const copy = (key, text) => {
    navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1200);
  };
  const openSource = (sourceId, term = "", recordUrl = "") => {
    if (term) navigator.clipboard?.writeText(term);
    const isMedicalSource = THESAURUS_SOURCES.some((source) => source.id === sourceId);
    const url = isMedicalSource ? terminologySourceUrl(sourceId, term, recordUrl) : researchVocabularyUrl(sourceId, term, recordUrl);
    if (url) openInApp(url, { real: true });
  };
  const openCandidateSource = (candidate) => openSource(candidate.source === "ai" ? "mesh" : candidate.source, candidate.label, candidate.uri);
  const openBrowserStrategy = (strategy) => {
    copy(strategy.id, strategy.combined);
    openInApp("https://www.livivo.de/app", { real: true });
  };
  const exportWord = async () => {
    if (!strategies.length || exporting) return;
    setExporting(true);
    setExportError("");
    try {
      const { downloadSearchStrategiesDocx } = await import("../engine/searchStrategyDocx.js");
      const pressAssessment = assessPress({ question, concepts: isr, strategies });
      await downloadSearchStrategiesDocx({ question, concepts: isr, strategies, pressAssessment, generatedAt: new Date() });
    } catch {
      setExportError("Word export failed. Your strategies are unchanged; use Copy all strategies while retrying.");
    } finally {
      setExporting(false);
    }
  };

  const runSearches = async () => {
    if (!strategies.length || running) return;
    const pressAssessment = assessPress({ question, concepts: isr, strategies });
    setRunError("");
    setRunRows(strategies.map((strategy) => ({ db: strategy.id, name: strategy.name, status: "queued", count: 0 })));
    setRunSummary(null);
    if (!pressAssessment.readyForExecution) {
      setRunError(`PRESS preflight blocked execution: ${pressAssessment.blockers.join("; ")}`);
      return;
    }
    setRunning(true);
    try {
      const result = await executeCompiledStrategies(strategies, {
        onProgress: (row) => setRunRows((current) => current.map((item) => item.db === row.db ? { ...item, ...row } : item)),
      });
      setRunRows(result.searches);
      setRunSummary(result.summary);
      const projectId = activeProject();
      if (projectId) {
        const stamp = new Date().toISOString();
        // Persist the ISR itself: the review pipeline reads this to compile the
        // same per-database strategy, so the builder and the automated run cannot
        // drift into searching two different things.
        putFile(projectId, { path: "search/isr.json", type: "provenance", content: JSON.stringify({ question, concepts: isr, databases: dbs, savedAt: stamp }, null, 2) });
        putFile(projectId, { path: "search/press-2015-assessment.json", type: "audit", content: JSON.stringify(pressAssessment, null, 2) });
        putFile(projectId, { path: "search/execution-manifest.json", type: "provenance", content: JSON.stringify({ question, executedAt: stamp, strategies, searches: result.searches, summary: result.summary }, null, 2) });
        putFile(projectId, { path: "search/prisma-s-search-log.csv", type: "csv", content: toCsv(result.prismaS) });
        putFile(projectId, { path: "search/results.ris", type: "ris", content: toRis(result.records) });
        if (result.nativeRis) putFile(projectId, { path: "search/results-native.ris", type: "ris", content: `${result.nativeRis}\n` });
      }
    } catch (error) {
      setRunError(String(error?.message || error));
    } finally {
      setRunning(false);
    }
  };

  const sourceSeed = splitTerms(concepts[0]?.terms)[0] || "";
  const terminologyStatuses = {
    umls: terminologyCredentialStatus("umls"),
    bioportal: terminologyCredentialStatus("bioportal"),
  };
  const domainInfo = VOCABULARY_DOMAINS.find((item) => item.id === vocabularyDomain);
  const visibleSources = vocabularyDomain === "medical" ? THESAURUS_SOURCES : sourcesForDomain(vocabularyDomain);
  const expansionAvailable = domainSupportsExpansion(vocabularyDomain);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/[0.03] p-3">
        <div className="flex items-center gap-2">
          <input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask AI to build a strategy from a review question…" aria-label="Review question for AI strategy" className="flex-1 text-sm px-3 py-2 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none focus:border-indigo-500" />
          <button type="button" onClick={buildFromQuestion} disabled={building || !provider} className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium px-3 py-2 rounded-lg">
            {building ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Build
          </button>
        </div>
        <div className="text-[10px] mt-1 text-zinc-500 dark:text-zinc-400">AI terms remain unverified free-text candidates. Controlled headings come only from the matching thesaurus.</div>
      </div>

      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] p-3 space-y-2">
        <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400">Vocabulary domain</div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Vocabulary domain">
          {VOCABULARY_DOMAINS.map((domain) => (
            <button type="button" key={domain.id} onClick={() => setVocabularyDomain(domain.id)} aria-pressed={vocabularyDomain === domain.id} className={`text-[10px] font-medium px-2.5 py-1.5 rounded-lg border ${vocabularyDomain === domain.id ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-500" : "border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"}`}>
              {domain.label}
            </button>
          ))}
        </div>
        <div className="text-[10px] text-zinc-500 dark:text-zinc-400">{domainInfo?.description} {expansionAvailable ? "Live results remain reviewable free-text candidates." : "These sources support supervised discovery rather than direct term expansion."}</div>
      </div>

      <details className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] p-4">
        <summary className="cursor-pointer text-xs font-semibold flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-500" /> Vocabulary services and reference sources</summary>
        <div className="mt-3 space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {visibleSources.map((source) => (
              <button key={source.id} type="button" onClick={() => openSource(source.id, sourceSeed)} className="text-left rounded-lg border border-zinc-200 dark:border-zinc-800 p-2.5 hover:border-indigo-500/50 focus:outline-none focus:ring-2 focus:ring-indigo-500/40">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold">{source.name}<ExternalLink className="h-3 w-3 text-zinc-400" /></div>
                <div className="text-[9px] font-mono text-indigo-500 mt-0.5">{source.kind || source.resourceType} · {source.integration}</div>
                <div className="text-[10px] text-zinc-500 dark:text-zinc-400 mt-1">{source.use}</div>
              </button>
            ))}
          </div>
          {vocabularyDomain === "medical" && <div className="grid gap-2 md:grid-cols-2">
            {["umls", "bioportal"].map((sourceId) => {
              const label = sourceId === "umls" ? "UMLS" : "BioPortal";
              const status = terminologyStatuses[sourceId];
              return (
                <div key={sourceId} className="rounded-lg bg-zinc-50 dark:bg-zinc-900 p-2.5">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-[10px] font-semibold">Optional {label} API</span>
                    <span className={`text-[9px] font-mono ${status.available ? "text-emerald-500" : status.locked ? "text-amber-500" : "text-zinc-400"}`}>{status.available ? "ready" : status.locked ? "vault locked" : status.stored ? "stored" : "not configured"}</span>
                  </div>
                  <div className="flex gap-1.5">
                    <input type="password" value={credentialDrafts[sourceId]} onChange={(event) => setCredentialDrafts((current) => ({ ...current, [sourceId]: event.target.value }))} aria-label={`${label} API key`} placeholder={`${label} API key`} className="min-w-0 flex-1 text-xs px-2 py-1.5 rounded bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-700 outline-none focus:border-indigo-500" />
                    <button type="button" onClick={() => storeTerminologyKey(sourceId)} className="text-[10px] font-medium px-2 py-1.5 rounded border border-zinc-200 dark:border-zinc-700 hover:border-indigo-500">Store</button>
                  </div>
                </div>
              );
            })}
          </div>}
          {vocabularyDomain === "medical" && credentialNotice && <div role="status" className="text-[10px] text-zinc-500 dark:text-zinc-400">{credentialNotice}</div>}
          {vocabularyDomain === "medical" ? (
            <div className="text-[9px] leading-relaxed text-amber-600 dark:text-amber-400">UMLS requires an active individual licence and a rotated API key. Keys stay in the encrypted user vault; deployed UMLS requests are relayed server-side so the key is not placed in a browser-visible NLM request URL. Source-vocabulary licence restrictions still apply.</div>
          ) : (
            <div className="text-[9px] leading-relaxed text-amber-600 dark:text-amber-400">{[...new Set(visibleSources.map((source) => RESOURCE_TYPE_POLICY[source.resourceType]?.guidance).filter(Boolean))].join(" ")}</div>
          )}
        </div>
      </details>

      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400">Concepts · synonyms OR-ed · rows joined by AND/OR/NOT</span>
          <button type="button" onClick={addConcept} className="flex items-center gap-1 text-[11px] text-indigo-500 hover:underline"><Plus className="h-3.5 w-3.5" /> concept</button>
        </div>
        <div className="text-[10px] text-zinc-500 dark:text-zinc-400"><span className="font-mono font-bold text-indigo-500">1 Expand</span> a seed in {domainInfo?.label} → review provenance → <span className="font-mono font-bold text-emerald-600 dark:text-emerald-500">2 add explicitly</span> as free text or, only where applicable, the correct native heading.</div>

        {concepts.map((concept, index) => {
          const vocab = { ...emptyVocab(), ...(concept.vocab || {}) };
          const expansion = vocabularyDomain === "medical" ? concept.expansion : null;
          const researchExpansion = concept.researchExpansion?.domain === vocabularyDomain ? concept.researchExpansion : null;
          const vocabularyRecords = activeVocabularyRecords(concept);
          return (
            <div key={index} className="rounded-lg border border-zinc-100 dark:border-zinc-800 p-2.5 space-y-2">
              <div className="flex flex-wrap items-start gap-2">
                {index === 0 ? <span className="text-[10px] font-mono text-zinc-400 mt-2 w-12 text-center">base</span> : (
                  <select value={concept.op} onChange={(event) => setC(index, { op: event.target.value })} className={`mt-1.5 text-xs font-mono font-bold bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded px-1 py-1 outline-none ${OP_COLOR[concept.op]}`}>
                    {OPERATORS.map((operator) => <option key={operator} value={operator}>{operator}</option>)}
                  </select>
                )}
                <input value={concept.label} onChange={(event) => setC(index, { label: event.target.value })} aria-label={`Label for concept ${index + 1}`} className="w-36 text-xs font-medium px-2.5 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none focus:border-indigo-500" />
                <input value={concept.terms} onChange={(event) => setFreeTextTerms(index, event.target.value)} placeholder="synonym1, synonym2, term*…" aria-label={`Synonyms for concept ${index + 1}`} className="min-w-60 flex-1 text-xs px-2.5 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none focus:border-indigo-500" />
                <button type="button" onClick={() => explode(index)} disabled={busy === index || !concept.terms.trim() || !expansionAvailable} title={expansionAvailable ? `Retrieve reviewable ${domainInfo?.label} vocabulary candidates` : "This domain contains supervised discovery sources only"} className="mt-0.5 flex items-center gap-1 text-[11px] font-medium px-2 py-2 rounded-lg border border-indigo-500/40 text-indigo-500 hover:bg-indigo-500/10 disabled:opacity-50">
                  {busy === index ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Atom className="h-3.5 w-3.5" />} Expand
                </button>
                <button type="button" onClick={() => removeConcept(index)} aria-label={`Remove concept ${index + 1}`} className="mt-2 text-zinc-400 hover:text-rose-500"><X className="h-4 w-4" /></button>
              </div>

              <details className="pl-0 sm:pl-14">
                <summary className="cursor-pointer text-[10px] font-mono text-zinc-500">Native headings · enter only after checking the named thesaurus</summary>
                <div className="grid gap-1.5 mt-2 md:grid-cols-2">
                  {NATIVE_VOCABULARIES.map((native) => (
                    <div key={native.id} className="flex items-center gap-1.5">
                      <label htmlFor={`heading-${index}-${native.id}`} className="w-24 text-[9px] font-mono text-zinc-500">{native.label}</label>
                      <input id={`heading-${index}-${native.id}`} value={(vocab[native.id] || []).join(", ")} onChange={(event) => setNativeHeadings(index, native.id, event.target.value)} placeholder={`${native.label} headings`} className="min-w-0 flex-1 text-[10px] px-2 py-1.5 rounded bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none focus:border-indigo-500" />
                      <button type="button" onClick={() => openInApp(native.url, { real: true })} aria-label={`Open ${native.label}`} className="p-1 text-zinc-400 hover:text-indigo-500"><ExternalLink className="h-3 w-3" /></button>
                    </div>
                  ))}
                </div>
              </details>

              {NATIVE_VOCABULARIES.some((native) => vocab[native.id]?.length) && (
                <div className="flex flex-wrap gap-1 pl-0 sm:pl-14">
                  {NATIVE_VOCABULARIES.flatMap((native) => (vocab[native.id] || []).map((heading) => <span key={`${native.id}-${heading}`} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-500">{native.label}: {heading}</span>))}
                </div>
              )}

              {vocabularyRecords.length > 0 && (
                <div className="flex flex-wrap gap-1 pl-0 sm:pl-14">
                  {vocabularyRecords.map((record) => <span key={`${record.source}-${record.sourceId}-${record.relation}-${record.label}`} title={`${record.resourceType} · ${record.relation} · ${record.verification}`} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">{record.sourceLabel}: {record.label}</span>)}
                </div>
              )}

              {expansion && (
                <div className="pl-0 sm:pl-14 space-y-2 pt-1">
                  <CandidateGroup label="MeSH descriptors · controlled headings" items={expansion.descriptors} selected={vocab.mesh} onAdd={(candidate) => addHeading(index, candidate, "mesh")} onAddAll={(items) => addManyHeadings(index, items, "mesh")} onOpen={openCandidateSource} addLabel="Add MeSH heading" />
                  <CandidateGroup label="MeSH entry terms · free text" items={expansion.entryTerms} selected={splitTerms(concept.terms)} onAdd={(candidate) => addFreeText(index, candidate)} onAddAll={(items) => addManyFreeText(index, items)} onOpen={openCandidateSource} addLabel="Add free-text term" />
                  {expansion.narrower?.length > 0 && (
                    <div className="space-y-1">
                      <CandidateGroup label="Narrower MeSH descriptors · review before adding" items={expansion.narrower} selected={vocab.mesh} onAdd={(candidate) => addHeading(index, candidate, "mesh")} onOpen={openCandidateSource} addLabel="Add MeSH heading" />
                      <button type="button" onClick={() => addAllExploded(index)} className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-emerald-500/40 text-emerald-600 dark:text-emerald-500 hover:bg-emerald-500/10">Add all exploded MeSH</button>
                    </div>
                  )}
                  <CandidateGroup label="UMLS / BioPortal mappings · source-specific" items={expansion.mapped} selected={[...vocab.mesh, ...splitTerms(concept.terms)]} onAdd={(candidate) => candidate.vocabulary === "mesh" ? addHeading(index, candidate, "mesh") : addFreeText(index, candidate)} onAddAll={(items) => { addManyHeadings(index, items.filter((candidate) => candidate.vocabulary === "mesh"), "mesh"); addManyFreeText(index, items.filter((candidate) => candidate.vocabulary !== "mesh")); }} onOpen={openCandidateSource} addLabel="Add reviewed candidate" />
                  <CandidateGroup label="AI lexical suggestions · unverified free text" items={expansion.ai} selected={splitTerms(concept.terms)} onAdd={(candidate) => addFreeText(index, candidate)} onAddAll={(items) => addManyFreeText(index, items)} onOpen={openCandidateSource} addLabel="Add unverified free-text term" />
                  {expansion.warnings?.map((warning) => <div key={warning} role="status" className="flex items-start gap-1 text-[9px] text-amber-600 dark:text-amber-400"><AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />{warning}</div>)}
                </div>
              )}

              {researchExpansion && (
                <div className="pl-0 sm:pl-14 space-y-2 pt-1">
                  {groupCandidatesBySource(researchExpansion.candidates).map(([sourceId, items]) => {
                    const source = sourcesForDomain(vocabularyDomain).find((item) => item.id === sourceId);
                    return <CandidateGroup key={sourceId} label={`${source?.name || sourceId} · ${source?.resourceType || "source"} · free-text candidates`} items={items} selected={splitTerms(concept.terms)} onAdd={(candidate) => addResearchCandidate(index, candidate)} onAddAll={(candidates) => candidates.forEach((candidate) => addResearchCandidate(index, candidate))} onOpen={openCandidateSource} addLabel="Add reviewed free-text term" />;
                  })}
                  {researchExpansion.warnings?.map((warning) => <div key={warning} role="status" className="flex items-start gap-1 text-[9px] text-amber-600 dark:text-amber-400"><AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />{warning}</div>)}
                </div>
              )}
            </div>
          );
        })}
        <div className="flex items-start gap-1.5 text-[9px] leading-relaxed text-emerald-700 dark:text-emerald-400"><ShieldCheck className="h-3 w-3 mt-0.5 shrink-0" /><span>The compiler now uses only the heading field for the target vocabulary. A MeSH term is never emitted as Emtree, a CINAHL Heading, an APA index term, or DeCS.</span></div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400">Target databases (syntax auto-fitted)</span>
          <div className="flex gap-2"><button type="button" onClick={() => setDbs([...STRATEGY_DBS])} className="text-[10px] font-mono text-indigo-500 hover:underline">all</button><button type="button" onClick={() => setDbs(CORE_DBS)} className="text-[10px] font-mono text-zinc-400 hover:underline">SR core</button></div>
        </div>
        <div className="flex flex-wrap gap-2">{STRATEGY_DBS.map((id) => <button type="button" key={id} onClick={() => toggleDb(id)} className={`text-[11px] px-2.5 py-1.5 rounded-lg border font-medium ${dbs.includes(id) ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-500" : "border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"}`}>{databaseName(id)}</button>)}</div>

        {detected.length > 0 && (
          <div className="mt-3 space-y-1.5">
            <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400">Detected behind your gateways</div>
            <div className="flex flex-wrap gap-2">
              {detected.map((database) => (
                <button type="button" key={database.id} onClick={() => setDetectedSelection(toggleSelection(database.id))}
                  title={`${database.platformName} syntax · ${database.freeTextOnly ? "no thesaurus mapped — free-text only" : VOCABULARIES[database.vocabulary]}`}
                  className={`text-[11px] px-2.5 py-1.5 rounded-lg border font-medium ${detectedSelection.includes(database.id) ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-500" : "border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"}`}>
                  {database.name}
                  <span className="ml-1.5 font-mono text-[9px] opacity-70">{database.freeTextOnly ? "free-text" : VOCABULARIES[database.vocabulary]}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-3">
        {strategies.map((strategy) => (
          <div key={strategy.id} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] p-4">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="text-sm font-semibold">{strategy.name}</span>
              <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500">{strategy.controlled}</span>
              {strategy.headingStatus !== "not-applicable" && <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${strategy.headingStatus === "complete" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-500" : "bg-amber-500/10 text-amber-600 dark:text-amber-400"}`}>native headings: {strategy.headingStatus}</span>}
              {strategy.auto && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500">live API</span>}
              {strategy.id === "livivo" && <button type="button" onClick={() => openBrowserStrategy(strategy)} className="ml-auto flex items-center gap-1 text-[11px] text-teal-600 hover:text-teal-500"><ExternalLink className="h-3.5 w-3.5" /> copy + open LIVIVO</button>}
              <button type="button" onClick={() => copy(strategy.id, strategy.combined)} className={`${strategy.id === "livivo" ? "" : "ml-auto"} flex items-center gap-1 text-[11px] text-zinc-500 hover:text-indigo-500`}>{copied === strategy.id ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />} copy</button>
            </div>
            <pre className="text-[11px] font-mono text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap break-words bg-zinc-50 dark:bg-zinc-900 rounded-lg p-3 border border-zinc-100 dark:border-zinc-800">{strategy.combined}</pre>
            {strategy.headingStatus === "none" && <div className="mt-2 text-[10px] font-mono text-amber-600 dark:text-amber-400">No verified {strategy.controlled} heading is stored; this output is free-text only.</div>}
            {strategy.headingStatus === "partial" && <div className="mt-2 text-[10px] font-mono text-amber-600 dark:text-amber-400">Only {strategy.headingConceptCount} concept block(s) contain a {strategy.controlled} heading.</div>}
            <div className="mt-2 text-[10px] font-mono text-zinc-500 dark:text-zinc-400">▲ {strategy.hint}</div>
            <button type="button" onClick={() => setOpenLines((current) => ({ ...current, [strategy.id]: !current[strategy.id] }))} className="mt-2 flex items-center gap-1 text-[10px] font-mono text-zinc-400 hover:text-zinc-600">{openLines[strategy.id] ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />} search-history lines ({strategy.lines.length})</button>
            {openLines[strategy.id] && <div className="mt-1 space-y-0.5">{strategy.lines.map((line) => <div key={line.n} className="text-[10px] font-mono text-zinc-500"><span className="text-zinc-400">#{line.n}</span> {line.text}</div>)}</div>}
          </div>
        ))}
      </div>

      {strategies.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => copy("all", strategies.map((strategy) => `### ${strategy.name} (${strategy.controlled})\n${strategy.combined}\n`).join("\n"))} className="flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800">{copied === "all" ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <ClipboardList className="h-3.5 w-3.5" />} Copy all strategies</button>
            <button type="button" onClick={exportWord} disabled={exporting} className="flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white">{exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}{exporting ? "Preparing Word…" : "Export Word (.docx)"}</button>
            <button type="button" onClick={runSearches} disabled={running} className="flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white">{running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}{running ? "Running searches…" : "Run searches"}</button>
          </div>
          <div className="text-[10px] text-zinc-500">Word includes the PRESS 2015 checklist. Run searches performs the PRESS preflight, executes every exact strategy through its API or isolated specialist browser, and saves PRISMA-S, RIS, PRESS, and execution artifacts to the active project.</div>
          {exportError && <div role="alert" className="flex items-center gap-1.5 text-[10px] text-rose-500"><AlertCircle className="h-3 w-3" /> {exportError}</div>}
          {runError && <div role="alert" className="flex items-center gap-1.5 text-[10px] text-rose-500"><AlertCircle className="h-3 w-3" /> {runError}</div>}
          {runRows.length > 0 && <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            <div className="px-3 py-2 bg-zinc-50 dark:bg-zinc-900 text-[10px] font-mono font-bold uppercase tracking-wide text-zinc-500 flex items-center gap-1.5"><Database className="h-3.5 w-3.5" /> Search execution</div>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {runRows.map((row) => <div key={row.db} className="px-3 py-2 flex flex-wrap items-center gap-2 text-[10px]">
                <span className="font-semibold min-w-32">{row.name || databaseName(row.db)}</span>
                <span className={`font-mono ${row.status === "ok" ? "text-emerald-600" : ["error", "needs-auth", "attention"].includes(row.status) ? "text-amber-600" : "text-zinc-500"}`}>{row.status}</span>
                {Number.isFinite(row.count) && <span className="font-mono text-zinc-500">{row.count} records</span>}
                {row.needsAuth && row.url && <button type="button" onClick={() => openInApp(row.url, { real: true })} className="ml-auto inline-flex items-center gap-1 text-indigo-500 hover:underline"><LogIn className="h-3 w-3" /> Sign in in app browser, then rerun</button>}
                {(row.error || row.warnings?.length) && <span className="basis-full text-amber-600 dark:text-amber-400">{row.error || row.warnings.join(" ")}</span>}
              </div>)}
            </div>
          </div>}
          {runSummary && <div role="status" className="text-[10px] font-mono text-emerald-600">{runSummary.completed}/{runSummary.sources} sources completed · {runSummary.totalHits} hits · {runSummary.uniqueRecords} unique records · {runSummary.flagged.length} require attention</div>}
        </div>
      )}
    </div>
  );
}
