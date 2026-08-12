import React, { useState, useMemo, useCallback } from "react";
import {
  loadRoster, saveRoster, addRunner, removeRunner, runnerReady,
  runSandboxedScreening, concordance, scoreAgainstReference, operatorReference,
  interpretKappa,
} from "../engine/modelRoster.js";
import { PROVIDERS, providerStatus, discoveredModels } from "../engine/providers.js";
import { loadReview, saveReview } from "../engine/reviewengine.js";

// Several models screening the same records at once, kept in separate sandboxes
// so their agreement can be measured. Nothing here writes a canonical decision:
// a sandbox is an opinion, and promoting one is a deliberate, separate act.

const pct = (v) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(1)}%`);
const k3 = (v) => (v === null || v === undefined || Number.isNaN(v) ? "—" : v.toFixed(3));

export default function ConcordancePanel({ projectId, review, onReviewChange, onNote }) {
  const [roster, setRoster] = useState(() => loadRoster());
  const [draft, setDraft] = useState({ providerId: "openrouter", model: "", label: "" });
  const [sampleSize, setSampleSize] = useState(25);
  const [running, setRunning] = useState(null);
  const [sandboxes, setSandboxes] = useState(() => review?.objects?.sandboxes || {});

  const records = useMemo(
    () => (review?.objects?.records || []).filter((r) => !r.isDuplicate),
    [review]
  );
  const recordsById = useMemo(() => new Map(records.map((r) => [r.id, r])), [records]);
  const reference = useMemo(() => operatorReference(records), [records]);

  const agreement = useMemo(
    () => (Object.keys(sandboxes).length >= 2 ? concordance(sandboxes, recordsById) : null),
    [sandboxes, recordsById]
  );
  const scores = useMemo(
    () => (Object.keys(sandboxes).length && reference.size ? scoreAgainstReference(sandboxes, reference) : []),
    [sandboxes, reference]
  );

  const add = () => {
    if (!draft.model.trim()) { onNote?.("Enter the model id exactly as the provider names it.", "warn"); return; }
    setRoster(addRunner({ providerId: draft.providerId, model: draft.model.trim(), label: draft.label.trim() || undefined }));
    setDraft({ ...draft, model: "", label: "" });
  };

  const toggle = (id) => setRoster(saveRoster(roster.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r))));

  const run = useCallback(async () => {
    const eligibility = review?.objects?.eligibility || "";
    if (!eligibility.trim()) { onNote?.("The eligibility criteria are empty — every model would be screening against nothing.", "warn"); return; }
    const enabled = roster.filter((r) => r.enabled !== false);
    const blocked = enabled.map((r) => ({ r, state: runnerReady(r) })).filter((x) => !x.state.ok);
    if (blocked.length) {
      onNote?.(`Cannot run: ${blocked.map((b) => `${b.r.label} (${b.state.reason})`).join("; ")}`, "err");
      return;
    }
    // A deliberate sample rather than the whole corpus: this costs one call per
    // model per record, and the operator should choose how much to spend.
    const sample = records.slice(0, Math.max(1, Number(sampleSize) || 1));
    setRunning({ pct: 0, msg: `0/${sample.length * enabled.length}` });
    onNote?.(`Screening ${sample.length} records with ${enabled.length} model(s) — ${sample.length * enabled.length} calls.`);

    const result = await runSandboxedScreening(sample, eligibility, enabled, {
      onProgress: (p) => setRunning({ pct: p.pct, msg: `${p.done}/${p.total} · ${p.runner}` }),
    });
    setRunning(null);

    if (!result.ok) { onNote?.(result.reason, "err"); return; }
    setSandboxes(result.sandboxes);

    // Sandboxes persist beside the review, never inside its decisions.
    const current = loadReview(projectId);
    if (current) {
      const next = { ...current, objects: { ...current.objects, sandboxes: result.sandboxes } };
      saveReview(projectId, next);
      onReviewChange?.(next);
    }
    const failed = Object.values(result.sandboxes).reduce((n, s) => n + s.failed, 0);
    onNote?.(`Sandboxed run complete${failed ? `, ${failed} call(s) failed` : ""}. Nothing was written to the review's own decisions.`, failed ? "warn" : "ok");
  }, [roster, records, sampleSize, review, projectId, onReviewChange, onNote]);

  const promote = (runnerId) => {
    const sandbox = sandboxes[runnerId];
    const current = loadReview(projectId);
    if (!sandbox || !current) return;
    const byRecord = new Map(sandbox.results.filter((r) => r.ok).map((r) => [r.recordId, r]));
    const next = {
      ...current,
      objects: {
        ...current.objects,
        records: (current.objects.records || []).map((r) => {
          const vote = byRecord.get(r.id);
          // An operator decision is never overwritten by a model.
          if (!vote || r.tiabBy === "operator") return r;
          return { ...r, tiab: vote.decision, tiabReason: vote.reason, tiabConfidence: vote.confidence, tiabEngine: sandbox.runner.label };
        }),
      },
    };
    saveReview(projectId, next);
    onReviewChange?.(next);
    onNote?.(`${sandbox.runner.label} promoted to the review's screening decisions. Operator decisions were left untouched.`, "ok");
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(340px, 38%) 1fr", height: "100%", minHeight: 0 }}>
      {/* roster */}
      <div style={{ borderRight: "1px solid var(--line)", overflow: "auto" }}>
        <div className="wb-insp-title">Model roster</div>
        <table className="wb-grid">
          <thead><tr><th style={{ width: 44 }}>On</th><th>Runner</th><th style={{ width: 96 }}>State</th><th style={{ width: 34 }} /></tr></thead>
          <tbody>
            {roster.map((r) => {
              const state = runnerReady(r);
              return (
                <tr key={r.id}>
                  <td><input type="checkbox" checked={r.enabled !== false} onChange={() => toggle(r.id)} /></td>
                  <td title={`${r.providerId} · ${r.model}`}>{r.label}</td>
                  <td style={{ color: state.ok ? "var(--ok)" : "var(--warn)" }} title={state.reason || "ready"}>{state.ok ? "ready" : state.reason}</td>
                  <td><button className="wb-btn danger" style={{ height: 16, padding: "0 5px", fontSize: 10 }} onClick={() => setRoster(removeRunner(r.id))}>×</button></td>
                </tr>
              );
            })}
            {roster.length === 0 && <tr><td colSpan={4} style={{ color: "var(--fg-faint)" }}>No model in the roster yet.</td></tr>}
          </tbody>
        </table>

        <div className="wb-insp-title">Add a model</div>
        <div className="wb-prop">
          <span className="k">Provider</span>
          <select className="wb-select" value={draft.providerId} onChange={(e) => setDraft({ ...draft, providerId: e.target.value })}>
            {PROVIDERS.filter((p) => p.shape !== "local").map((p) => {
              const s = providerStatus(p.id);
              return <option key={p.id} value={p.id}>{p.label}{s.hasKey ? "" : " — no key"}</option>;
            })}
          </select>
        </div>
        <div className="wb-prop">
          <span className="k">Model id</span>
          <input
            className="wb-input" value={draft.model} list="roster-models"
            placeholder="e.g. deepseek/deepseek-chat"
            onChange={(e) => setDraft({ ...draft, model: e.target.value })}
          />
        </div>
        <datalist id="roster-models">
          {(discoveredModels(draft.providerId) || []).map((m) => <option key={m} value={m} />)}
        </datalist>
        <div className="wb-prop">
          <span className="k">Label</span>
          <input className="wb-input" value={draft.label} placeholder="optional" onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
        </div>
        <div style={{ padding: "4px 8px", display: "flex", gap: 4 }}>
          <button className="wb-btn" onClick={add}>Add to roster</button>
        </div>

        <div className="wb-insp-title">Run</div>
        <div className="wb-prop">
          <span className="k">Records</span>
          <input className="wb-input" type="number" min={1} max={records.length || 1} value={sampleSize} onChange={(e) => setSampleSize(e.target.value)} />
        </div>
        <div className="wb-prop">
          <span className="k">Calls</span>
          <span className="v mono">{Math.min(sampleSize, records.length) * roster.filter((r) => r.enabled !== false).length} across {roster.filter((r) => r.enabled !== false).length} sandbox(es)</span>
        </div>
        <div className="wb-prop">
          <span className="k">Reference</span>
          <span className="v mono" style={{ color: reference.size ? "var(--ok)" : "var(--fg-faint)" }}>
            {reference.size ? `${reference.size} operator decision(s)` : "none — score cannot be computed"}
          </span>
        </div>
        <div style={{ padding: "6px 8px" }}>
          <button className="wb-btn on" onClick={run} disabled={!!running || roster.filter((r) => r.enabled !== false).length === 0 || !records.length}>
            {running ? `Running ${running.pct}% · ${running.msg}` : "Run parallel sandboxes"}
          </button>
        </div>
      </div>

      {/* results */}
      <div style={{ overflow: "auto" }}>
        <div className="wb-insp-title">Agreement between models</div>
        {!agreement?.ok ? (
          <div style={{ padding: "6px 8px", fontSize: 11, color: "var(--fg-dim)", lineHeight: 1.6 }}>
            {agreement?.reason || "Run two or more models over the same records to measure agreement."}
          </div>
        ) : (
          <>
            <div className="wb-prop"><span className="k">Compared</span><span className="v mono">{agreement.comparedCount} records</span></div>
            <div className="wb-prop"><span className="k">Unanimous</span><span className="v mono" style={{ color: "var(--ok)" }}>{agreement.unanimousCount}</span></div>
            <div className="wb-prop"><span className="k">Split</span><span className="v mono" style={{ color: agreement.disagreements.length ? "var(--warn)" : "var(--fg)" }}>{agreement.disagreements.length}</span></div>
            {agreement.fleiss && (
              <div className="wb-prop">
                <span className="k">Fleiss κ</span>
                <span className="v mono">{k3(agreement.fleiss.kappa)} — {interpretKappa(agreement.fleiss.kappa)}{agreement.fleiss.reason ? ` (${agreement.fleiss.reason})` : ""}</span>
              </div>
            )}

            <table className="wb-grid">
              <thead><tr><th>Pair</th><th style={{ width: 60 }}>n</th><th style={{ width: 78 }}>Observed</th><th style={{ width: 70 }}>Cohen κ</th><th style={{ width: 110 }}>Strength</th></tr></thead>
              <tbody>
                {agreement.pairwise.map((p, i) => (
                  <tr key={i}>
                    <td>{sandboxes[p.a]?.runner?.label || p.a} ~ {sandboxes[p.b]?.runner?.label || p.b}</td>
                    <td className="wb-num">{p.n}</td>
                    <td className="wb-num">{pct(p.observed)}</td>
                    <td className="wb-num">{k3(p.kappa)}</td>
                    <td>{interpretKappa(p.kappa)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <div className="wb-insp-title">Scored against your own decisions</div>
        {scores.length === 0 ? (
          <div style={{ padding: "6px 8px", fontSize: 11, color: "var(--fg-dim)", lineHeight: 1.6 }}>
            Screen some records yourself first. Those decisions become the reference every model is
            measured against — there is no benchmark without one.
          </div>
        ) : (
          <table className="wb-grid">
            <thead>
              <tr>
                <th>Model</th><th style={{ width: 46 }}>n</th>
                <th style={{ width: 76 }}>Sens.</th><th style={{ width: 76 }}>Spec.</th>
                <th style={{ width: 70 }}>Acc.</th><th style={{ width: 62 }}>κ</th>
                <th style={{ width: 52 }}>Missed</th><th style={{ width: 62 }}>ms</th>
                <th style={{ width: 66 }} />
              </tr>
            </thead>
            <tbody>
              {scores.map((s) => (
                <tr key={s.runnerId}>
                  <td title={s.label}>{s.label}</td>
                  <td className="wb-num">{s.compared}</td>
                  <td className="wb-num" style={{ color: s.sensitivity === 1 ? "var(--ok)" : s.sensitivity !== null && s.sensitivity < 0.9 ? "var(--err)" : undefined }}>{pct(s.sensitivity)}</td>
                  <td className="wb-num">{pct(s.specificity)}</td>
                  <td className="wb-num">{pct(s.accuracy)}</td>
                  <td className="wb-num">{k3(s.kappa)}</td>
                  <td className="wb-num" style={{ color: s.fn ? "var(--err)" : undefined }} title={s.missed.join(", ")}>{s.fn}</td>
                  <td className="wb-num">{s.meanMs ?? "—"}</td>
                  <td><button className="wb-btn" style={{ height: 16, padding: "0 5px", fontSize: 10 }} onClick={() => promote(s.runnerId)}>Promote</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {scores.length > 0 && (
          <div style={{ padding: "4px 8px", fontSize: 10.5, color: "var(--fg-faint)", lineHeight: 1.7 }}>
            Ranked by sensitivity, because a missed include is unrecoverable later while a false
            include only costs full-text reading. “Missed” lists records you included that the model
            excluded. Promote writes one sandbox into the review&apos;s decisions, leaving every
            record you decided yourself untouched.
          </div>
        )}

        {agreement?.ok && agreement.disagreements.length > 0 && (
          <>
            <div className="wb-insp-title">Where they disagree <span className="wb-count">{agreement.disagreements.length}</span></div>
            <table className="wb-grid">
              <thead>
                <tr>
                  <th>Record</th>
                  {agreement.runnerIds.map((id) => <th key={id} style={{ width: 92 }}>{sandboxes[id]?.runner?.label?.slice(0, 14) || id}</th>)}
                </tr>
              </thead>
              <tbody>
                {agreement.disagreements.slice(0, 60).map((item) => (
                  <tr key={item.recordId}>
                    <td title={item.title}>{item.title}</td>
                    {agreement.runnerIds.map((id) => {
                      const vote = item.votes[id];
                      return (
                        <td key={id} title={vote?.reason || ""}>
                          {vote ? <span className={`wb-dec ${vote.decision === "include" ? "inc" : vote.decision === "exclude" ? "exc" : "maybe"}`}>{vote.decision.slice(0, 4).toUpperCase()}</span> : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
