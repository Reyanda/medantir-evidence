import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  CheckCircle2,
  Database,
  Loader2,
  Network,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import { activeProject } from "../engine/projectstore.js";
import {
  getSemanticCapabilities,
  getSemanticIndexManifest,
  listSemanticClusters,
  listSemanticUnits,
  rebuildSemanticIndex,
  semanticSearch,
  storedProductionRun,
} from "../engine/semanticservice.js";
import "../styles/semantic-evidence.css";

const UNIT_TYPES = [
  "artifact", "section", "passage", "sentence", "claim", "extraction-field",
  "outcome", "estimand", "effect-estimate", "mechanism", "study", "table-row",
];
const IMRAD = [
  "title", "abstract", "introduction", "methods", "results", "discussion",
  "conclusion", "limitations", "references", "supplement", "front-matter", "other",
];

const shortHash = (value) => value ? `${String(value).slice(0, 10)}…${String(value).slice(-6)}` : "—";
const number = (value) => Number(value || 0).toLocaleString();

function ErrorNote({ children }) {
  if (!children) return null;
  return <div className="sei-note error"><AlertTriangle size={14} /> <span>{children}</span></div>;
}

function WarningList({ values = [] }) {
  if (!values.length) return null;
  return (
    <div className="sei-warnings">
      {values.map((value, index) => <div key={`${value}-${index}`}><AlertTriangle size={13} /> <span>{value}</span></div>)}
    </div>
  );
}

function Metric({ label, value, detail, icon: Icon }) {
  return (
    <div className="sei-metric">
      <div className="sei-metric-icon">{Icon ? <Icon size={15} /> : null}</div>
      <div>
        <div className="sei-metric-value">{value}</div>
        <div className="sei-metric-label">{label}</div>
        {detail ? <div className="sei-metric-detail">{detail}</div> : null}
      </div>
    </div>
  );
}

function Provenance({ unit }) {
  const studyId = typeof unit?.metadata?.studyId === "string" ? unit.metadata.studyId : null;
  return (
    <div className="sei-provenance">
      <span>{unit?.artifactKey || "artifact"}</span>
      <span>{unit?.imradRole || "other"}</span>
      {studyId ? <span>study {studyId}</span> : null}
      {(unit?.jsonPointers || []).slice(0, 2).map((pointer) => <code key={pointer}>{pointer}</code>)}
    </div>
  );
}

export default function SemanticEvidenceWorkbench({ onBack }) {
  const projectId = activeProject();
  const [runId, setRunId] = useState(() => storedProductionRun(projectId));
  const [runDraft, setRunDraft] = useState(() => storedProductionRun(projectId));
  const [capabilities, setCapabilities] = useState(null);
  const [manifest, setManifest] = useState(null);
  const [clusters, setClusters] = useState([]);
  const [unitPage, setUnitPage] = useState(null);
  const [query, setQuery] = useState("");
  const [unitType, setUnitType] = useState("");
  const [imradRole, setImradRole] = useState("");
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void getSemanticCapabilities(projectId).then((response) => {
      if (response.ok) setCapabilities(response.payload);
    });
  }, [projectId]);

  const loadIndex = useCallback(async (selectedRun = runId) => {
    const id = String(selectedRun || "").trim();
    if (!id) {
      setManifest(null); setClusters([]); setUnitPage(null);
      return;
    }
    setBusy(true); setError("");
    const [manifestResponse, clustersResponse, unitsResponse] = await Promise.all([
      getSemanticIndexManifest(id, projectId),
      listSemanticClusters(id, projectId),
      listSemanticUnits(id, { projectId, offset: 0, limit: 40 }),
    ]);
    setBusy(false);
    if (!manifestResponse.ok) {
      setError(manifestResponse.error || "The semantic index could not be loaded.");
      return;
    }
    setManifest(manifestResponse.payload);
    setClusters(clustersResponse.ok ? clustersResponse.payload?.clusters || [] : []);
    setUnitPage(unitsResponse.ok ? unitsResponse.payload : null);
  }, [projectId, runId]);

  useEffect(() => { void loadIndex(runId); }, [runId, loadIndex]);

  const attach = () => {
    const id = runDraft.trim();
    setResults(null);
    setRunId(id);
  };

  const rebuild = async () => {
    if (!runId) return;
    setBusy(true); setError(""); setResults(null);
    const response = await rebuildSemanticIndex(runId, projectId);
    setBusy(false);
    if (!response.ok) { setError(response.error || "Semantic index rebuild failed."); return; }
    await loadIndex(runId);
  };

  const search = async (event) => {
    event?.preventDefault?.();
    if (!runId || !query.trim()) return;
    setBusy(true); setError("");
    const filters = {
      ...(unitType ? { unitTypes: [unitType] } : {}),
      ...(imradRole ? { imradRoles: [imradRole] } : {}),
    };
    const response = await semanticSearch(runId, {
      query: query.trim(),
      topK: 30,
      ...(Object.keys(filters).length ? { filters } : {}),
    }, projectId);
    setBusy(false);
    if (!response.ok) { setError(response.error || "Semantic search failed."); return; }
    setResults(response.payload);
  };

  const embedding = manifest?.embedding;
  const isDeepSemantic = embedding?.embeddingClass === "provider-semantic";
  const visibleClusters = useMemo(() => clusters.slice(0, 24), [clusters]);

  return (
    <div className="sei-shell">
      <header className="sei-header">
        <button className="sei-icon-button" onClick={onBack} title="Return to the review workbench"><ArrowLeft size={16} /></button>
        <div className="sei-brand">
          <span className="sei-kicker">MEDANTIR EVIDENCE OS</span>
          <strong>Semantic Evidence Index</strong>
          <span>Hybrid retrieval, source-bound semantic units, embeddings, and navigational clusters</span>
        </div>
        <div className="sei-run-controls">
          <input value={runDraft} onChange={(event) => setRunDraft(event.target.value)} placeholder="Durable run ID" aria-label="Durable run ID" />
          <button onClick={attach}>Attach</button>
          <button onClick={rebuild} disabled={!runId || busy} title="Rebuild from the current token and artifact state"><RefreshCw size={14} /> Rebuild</button>
        </div>
      </header>

      <main className="sei-main">
        {!projectId ? <ErrorNote>Select a review project before opening its semantic index.</ErrorNote> : null}
        {!runId ? <ErrorNote>No durable run is attached. Start or attach a server review, then enter its run ID above.</ErrorNote> : null}
        <ErrorNote>{error}</ErrorNote>

        {busy && <div className="sei-loading"><Loader2 size={16} className="spin" /> Building or querying the source-bound index…</div>}

        {manifest ? (
          <>
            <section className="sei-metrics">
              <Metric icon={Database} label="Semantic units" value={number(manifest.counts?.units)} detail={`${number(manifest.counts?.unitsByType?.claim)} claims · ${number(manifest.counts?.unitsByType?.study)} studies`} />
              <Metric icon={Sparkles} label="Embeddings" value={number(manifest.counts?.embeddings)} detail={`${embedding?.provider || "—"} · ${embedding?.model || "—"}`} />
              <Metric icon={Boxes} label="Clusters" value={number(manifest.counts?.clusters)} detail="machine-proposed navigation" />
              <Metric icon={Network} label="Index identity" value={shortHash(manifest.indexHash)} detail={`tokens ${shortHash(manifest.tokenisationManifestHash)}`} />
            </section>

            <section className={`sei-trust ${isDeepSemantic ? "semantic" : "baseline"}`}>
              {isDeepSemantic ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
              <div>
                <strong>{isDeepSemantic ? "Provider semantic embeddings active" : "Deterministic lexical-dense baseline active"}</strong>
                <span>
                  {isDeepSemantic
                    ? "Dense similarity is supplied by a configured embedding provider and combined with BM25, exact phrases, IMRAD filters, and provenance."
                    : "The index is autonomous and reproducible, but its local vectors are feature-hashed lexical representations. Configure and validate a provider embedding model before claiming deep semantic equivalence."}
                </span>
              </div>
            </section>
            <WarningList values={manifest.warnings} />

            <div className="sei-grid">
              <section className="sei-search-panel">
                <form className="sei-search-form" onSubmit={search}>
                  <div className="sei-query-row">
                    <Search size={17} />
                    <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search claims, populations, mechanisms, outcomes, estimands, or methods…" />
                    <button type="submit" disabled={busy || !query.trim()}>Search evidence</button>
                  </div>
                  <div className="sei-filters">
                    <label>Unit type<select value={unitType} onChange={(event) => setUnitType(event.target.value)}><option value="">All semantic units</option>{UNIT_TYPES.map((value) => <option key={value}>{value}</option>)}</select></label>
                    <label>IMRAD region<select value={imradRole} onChange={(event) => setImradRole(event.target.value)}><option value="">All source regions</option>{IMRAD.map((value) => <option key={value}>{value}</option>)}</select></label>
                    <span>Dense cosine + BM25 + exact phrase, with source metadata applied before ranking.</span>
                  </div>
                </form>

                <div className="sei-results-head">
                  <strong>{results ? `${results.results?.length || 0} ranked results` : "Semantic units"}</strong>
                  <span>{results ? `search ${shortHash(results.searchHash)}` : `${unitPage?.total || 0} indexed units`}</span>
                </div>

                <div className="sei-results">
                  {(results?.results || unitPage?.units || []).map((entry, index) => {
                    const unit = entry.unit || entry;
                    return (
                      <article className="sei-result" key={unit.unitId}>
                        <div className="sei-result-rank">{entry.rank || index + 1}</div>
                        <div className="sei-result-body">
                          <div className="sei-result-meta">
                            <span className="sei-type">{unit.unitType}</span>
                            {entry.score !== undefined ? <span>score {entry.score.toFixed?.(4) || entry.score}</span> : null}
                            {entry.denseScore !== undefined ? <span>dense {entry.denseScore.toFixed?.(3) || entry.denseScore}</span> : null}
                            {entry.lexicalScore !== undefined ? <span>lexical {entry.lexicalScore.toFixed?.(3) || entry.lexicalScore}</span> : null}
                          </div>
                          <p>{unit.text}</p>
                          <Provenance unit={unit} />
                          {entry.clusterIds?.length ? <div className="sei-cluster-tags">{entry.clusterIds.map((id) => <span key={id}>{shortHash(id)}</span>)}</div> : null}
                        </div>
                      </article>
                    );
                  })}
                  {!busy && !(results?.results || unitPage?.units || []).length ? <div className="sei-empty">No semantic units match the current query or filters.</div> : null}
                </div>
              </section>

              <aside className="sei-clusters">
                <div className="sei-aside-head"><strong>Evidence clusters</strong><span>{clusters.length}</span></div>
                <p>Clusters reveal navigational structure. Labels remain machine-proposed until an attributable reviewer approves or amends them.</p>
                <div className="sei-cluster-list">
                  {visibleClusters.map((cluster) => (
                    <button key={cluster.clusterId} onClick={() => {
                      setQuery(cluster.machineLabel || "");
                      setUnitType(cluster.unitType || "");
                    }}>
                      <span>{cluster.machineLabel || "Unlabelled cluster"}</span>
                      <small>{cluster.unitType} · {cluster.memberSemanticUnitIds?.length || 0} units · stability {Number(cluster.stability || 0).toFixed(2)}</small>
                    </button>
                  ))}
                </div>
                <div className="sei-capability">
                  <strong>Authority boundary</strong>
                  <span>{capabilities?.boundaries?.[0] || "Embeddings and clusters are rebuildable projections. Tokens, field contracts, provenance, deterministic methods, and human gates retain scientific authority."}</span>
                </div>
              </aside>
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}
