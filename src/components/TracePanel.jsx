import React, { useMemo } from "react";
import { STAGES } from "../engine/reviewengine.js";

// The trace: what each stage did, what decided it, and on what grounds.
//
// The pipeline already records this — `tiabReason` / `tiabConfidence` /
// `tiabEngine` per record, `extractionEngine` and `robEngine` per study,
// `fulltext.reason`, and a provenance stamp on each completed stage. None of it
// was visible, which made a run impossible to audit from the workbench. This
// reads those fields; it never infers a rationale that was not recorded.

const ENGINE_LABEL = {
  manual: "no engine — recorded as manual",
  unavailable: "engine unavailable, fallback value",
};

function attribution(items, engineKey, decisionKey) {
  const engines = new Map();
  let decided = 0;
  let withReason = 0;
  for (const item of items) {
    const decision = decisionKey ? item[decisionKey] : item;
    if (!decision) continue;
    decided += 1;
    const engine = item[engineKey] || (item.tiabBy === "operator" ? "operator" : "unrecorded");
    engines.set(engine, (engines.get(engine) || 0) + 1);
    if (item.tiabReason || item.fulltext?.reason) withReason += 1;
  }
  return { decided, withReason, engines: [...engines.entries()].sort((a, b) => b[1] - a[1]) };
}

export default function TracePanel({ review, onOpenRecord }) {
  const records = review?.objects?.records || [];
  const studies = review?.objects?.studies || [];

  const perStage = useMemo(() => {
    if (!review) return [];
    return STAGES.map((s) => {
      const state = review.stages?.[s.id] || {};
      const row = {
        id: s.id,
        name: s.name,
        status: state.status || "pending",
        completedAt: state.completedAt || null,
        provenance: state.provenance || [],
        detail: null,
      };
      if (s.id === "tiab") {
        const a = attribution(records.filter((r) => !r.isDuplicate), "tiabEngine", "tiab");
        row.detail = `${a.decided} decided · ${a.withReason} carry a recorded reason · ${a.engines.map(([e, n]) => `${e}:${n}`).join(" ") || "none"}`;
      }
      if (s.id === "fulltext") {
        const decided = records.filter((r) => r.fulltext?.decision).length;
        const reasons = records.filter((r) => r.fulltext?.reason).length;
        row.detail = `${decided} full-text decisions · ${reasons} with a reason`;
      }
      if (s.id === "extraction") {
        const a = attribution(studies, "extractionEngine", "extracted");
        row.detail = `${a.decided} extracted · ${a.engines.map(([e, n]) => `${e}:${n}`).join(" ") || "none"}`;
      }
      if (s.id === "rob") {
        const a = attribution(studies, "robEngine", "rob");
        row.detail = `${a.decided} assessed · ${a.engines.map(([e, n]) => `${e}:${n}`).join(" ") || "none"}`;
      }
      if (s.id === "search") {
        const searches = review.objects?.searches || [];
        row.detail = searches.length
          ? `${searches.length} database(s) · ${searches.reduce((n, x) => n + (x.count || 0), 0)} hits · mode ${review.searchSummary?.mode || "unrecorded"}`
          : null;
      }
      if (s.id === "dedup" && review.objects?.dedup) {
        row.detail = `${review.objects.dedup.unique} unique of ${review.objects.dedup.total}`;
      }
      if (s.id === "protocol" && review.protocol) {
        row.detail = `PICO from ${review.protocol.picoSource || "the pipeline"} · ${(review.protocol.concepts || []).length} search block(s) · strategy ${review.protocol.strategySource || "unrecorded"}`;
      }
      return row;
    });
  }, [review, records, studies]);

  // Item-level rationale, newest decisions first — the actual "why" behind a call.
  const decisions = useMemo(() => {
    const out = [];
    for (const r of records) {
      if (r.tiab) {
        out.push({
          id: r.id, title: r.title, stage: "tiab", decision: r.tiab,
          by: r.tiabEngine || (r.tiabBy === "operator" ? "operator" : "unrecorded"),
          confidence: r.tiabConfidence, reason: r.tiabReason,
        });
      }
      if (r.fulltext?.decision) {
        out.push({
          id: r.id, title: r.title, stage: "fulltext", decision: r.fulltext.decision,
          by: r.fulltext._engine || "unrecorded", reason: r.fulltext.reason,
        });
      }
    }
    for (const s of studies) {
      if (s.rob?.overallJudgement) {
        out.push({
          id: s.id, title: s.title, stage: "rob", decision: s.rob.overallJudgement,
          by: s.robEngine || s.rob._engine || "unrecorded", reason: s.rob.rationale,
          domains: s.rob.domains,
        });
      }
    }
    return out;
  }, [records, studies]);

  if (!review) {
    return <div style={{ padding: "6px 8px", color: "var(--fg-faint)", fontSize: 11 }}>No review loaded.</div>;
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(320px, 42%) 1fr", height: "100%", minHeight: 0 }}>
      <div style={{ borderRight: "1px solid var(--line)", overflow: "auto" }}>
        <div className="wb-insp-title">Stage trace</div>
        <table className="wb-grid">
          <thead><tr><th style={{ width: 150 }}>Stage</th><th style={{ width: 74 }}>Status</th><th>What it recorded</th></tr></thead>
          <tbody>
            {perStage.map((s) => (
              <tr key={s.id} className={s.status === "complete" ? "" : "muted"}>
                <td title={s.name}>{s.name}</td>
                <td style={{ color: s.status === "complete" ? "var(--ok)" : "var(--fg-faint)" }}>{s.status}</td>
                <td title={s.detail || ""}>
                  {s.detail || <span style={{ color: "var(--fg-faint)" }}>nothing recorded</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="wb-insp-title">Stage log</div>
        <div className="wb-log">
          {(review.log || []).length === 0 && <div style={{ color: "var(--fg-faint)" }}>No stage has completed yet.</div>}
          {(review.log || []).slice().reverse().map((entry, i) => (
            <div key={i}>
              <span className="t">{entry.at ? new Date(entry.at).toLocaleString() : "—"} </span>
              {entry.stage} · {entry.action}
            </div>
          ))}
        </div>
      </div>

      <div style={{ overflow: "auto" }}>
        <div className="wb-insp-title">
          Item decisions and their grounds <span className="wb-count">{decisions.length}</span>
        </div>
        {decisions.length === 0 ? (
          <div style={{ padding: "6px 8px", fontSize: 11, color: "var(--fg-dim)", lineHeight: 1.6 }}>
            Nothing has been decided yet. When a stage runs, each record's decision is stored with
            the engine that made it and the reason it gave; an operator decision is recorded as
            such, with no reason invented on its behalf.
          </div>
        ) : (
          <table className="wb-grid">
            <thead>
              <tr>
                <th style={{ width: 70 }}>Stage</th>
                <th style={{ width: 78 }}>Decision</th>
                <th style={{ width: 96 }}>Decided by</th>
                <th style={{ width: 54 }}>Conf.</th>
                <th>Recorded reason</th>
              </tr>
            </thead>
            <tbody>
              {decisions.map((d, i) => (
                <tr key={`${d.id}-${d.stage}-${i}`} onClick={() => onOpenRecord?.(d.id)} title={d.title}>
                  <td style={{ fontFamily: "var(--mono)", fontSize: 10.5 }}>{d.stage}</td>
                  <td>
                    <span className={`wb-dec ${d.decision === "include" ? "inc" : d.decision === "exclude" ? "exc" : "maybe"}`}>
                      {String(d.decision).toUpperCase().slice(0, 8)}
                    </span>
                  </td>
                  <td style={{ color: d.by === "operator" ? "var(--accent)" : d.by === "unrecorded" ? "var(--fg-faint)" : "var(--fg)" }} title={ENGINE_LABEL[d.by] || d.by}>
                    {d.by}
                  </td>
                  <td className="wb-num">{d.confidence != null ? Number(d.confidence).toFixed(2) : ""}</td>
                  <td title={d.reason || ""}>
                    {d.reason || <span style={{ color: "var(--fg-faint)" }}>{d.by === "operator" ? "operator decision, no reason entered" : "none recorded"}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div className="wb-insp-title">What this can and cannot show</div>
        <div style={{ padding: "4px 8px", fontSize: 11, color: "var(--fg-dim)", lineHeight: 1.7 }}>
          The pipeline stores a decision, the engine that produced it, a confidence where the
          engine gives one, and the reason it returned. It does not store the model&apos;s internal
          chain of thought, so none is shown here. Where a cell reads “none recorded”, the stage
          genuinely returned no rationale — most often because it fell back to a manual or
          unavailable engine, which is itself recorded in the “decided by” column.
        </div>
      </div>
    </div>
  );
}
