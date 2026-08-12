import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { loadReview, saveReview } from "../engine/reviewengine.js";
import { compileMatcher, recordText, highlightSpans } from "../engine/termIndex.js";

// Title/abstract screening as a grid you operate, not a queue you scroll.
// Decisions, flags and tags are written straight into review.objects.records,
// which is what dedup, full-text retrieval and the PRISMA counts already read.
// The question's own strategy is compiled and run here too, so a record shows
// WHY it matched.

const DECISIONS = { include: "inc", exclude: "exc", uncertain: "maybe" };
const DEC_LABEL = { include: "INCL", exclude: "EXCL", uncertain: "MAYBE" };

export default function ScreeningGrid({ projectId, review, onReviewChange, onNote }) {
  const [selectedId, setSelectedId] = useState(null);
  const [sort, setSort] = useState({ key: "order", dir: 1 });
  const [filters, setFilters] = useState({ decision: new Set(), tag: new Set(), source: new Set(), year: new Set(), match: new Set() });
  const [query, setQuery] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [ctx, setCtx] = useState(null);
  const [toast, setToast] = useState("");
  const [collapsed, setCollapsed] = useState({});
  const bodyRef = useRef(null);
  const toastTimer = useRef(null);

  const records = useMemo(
    () => (review?.objects?.records || []).map((r, i) => ({ ...r, order: i + 1 })),
    [review]
  );
  const matcher = useMemo(() => compileMatcher(review?.protocol?.concepts || []), [review?.protocol?.concepts]);

  const matchById = useMemo(() => {
    const map = new Map();
    if (!matcher.blocks.length) return map;
    for (const r of records) map.set(r.id, matcher.test(recordText(r)).match);
    return map;
  }, [records, matcher]);

  const flash = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 1600);
  }, []);

  // --- write-through ------------------------------------------------------
  const patchRecord = useCallback((id, patch) => {
    const current = loadReview(projectId);
    if (!current) return;
    const next = {
      ...current,
      objects: {
        ...current.objects,
        records: (current.objects.records || []).map((r) => (r.id === id ? { ...r, ...patch } : r)),
      },
    };
    saveReview(projectId, next);
    onReviewChange?.(next);
  }, [projectId, onReviewChange]);

  // --- filtering ----------------------------------------------------------
  const counts = useMemo(() => {
    const decision = {}, tag = {}, source = {}, year = {}, match = { matched: 0, unmatched: 0 };
    for (const r of records) {
      const d = r.tiab || "pending";
      decision[d] = (decision[d] || 0) + 1;
      for (const t of r.tags || []) tag[t] = (tag[t] || 0) + 1;
      if (r.source) source[r.source] = (source[r.source] || 0) + 1;
      if (r.year) year[r.year] = (year[r.year] || 0) + 1;
      if (matchById.size) match[matchById.get(r.id) ? "matched" : "unmatched"] += 1;
    }
    return { decision, tag, source, year, match };
  }, [records, matchById]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = records.filter((r) => {
      if (filters.decision.size && !filters.decision.has(r.tiab || "pending")) return false;
      if (filters.tag.size && !(r.tags || []).some((t) => filters.tag.has(t))) return false;
      if (filters.source.size && !filters.source.has(r.source)) return false;
      if (filters.year.size && !filters.year.has(String(r.year))) return false;
      if (filters.match.size) {
        const state = matchById.get(r.id) ? "matched" : "unmatched";
        if (!filters.match.has(state)) return false;
      }
      if (q && !`${r.title} ${r.authors || ""} ${r.source || ""} ${(r.tags || []).join(" ")}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const { key, dir } = sort;
    return out.sort((a, b) => {
      const x = a[key] ?? "", y = b[key] ?? "";
      if (typeof x === "number" && typeof y === "number") return dir * (x - y);
      return dir * String(x).localeCompare(String(y));
    });
  }, [records, filters, query, sort, matchById]);

  useEffect(() => {
    if (!selectedId && filtered.length) setSelectedId(filtered[0].id);
  }, [filtered, selectedId]);

  const selected = records.find((r) => r.id === selectedId) || null;

  // --- decisions and keys -------------------------------------------------
  const decide = useCallback((id, decision) => {
    if (!id) return;
    patchRecord(id, { tiab: decision, tiabReason: null, tiabBy: "operator" });
    const pos = filtered.findIndex((r) => r.id === id);
    const next = filtered[pos + 1];
    flash(`${DEC_LABEL[decision]} · ${filtered[pos]?.title?.slice(0, 48) || id}`);
    if (next) setSelectedId(next.id);
  }, [filtered, patchRecord, flash]);

  const toggleFlag = useCallback((id) => {
    const r = records.find((x) => x.id === id);
    if (!r) return;
    patchRecord(id, { flag: !r.flag });
    flash(r.flag ? "flag cleared" : "flagged");
  }, [records, patchRecord, flash]);

  const toggleTag = useCallback((id, tag) => {
    const r = records.find((x) => x.id === id);
    if (!r || !tag) return;
    const tags = r.tags || [];
    patchRecord(id, { tags: tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag] });
  }, [records, patchRecord]);

  useEffect(() => {
    const onKey = (e) => {
      const el = e.target;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const pos = filtered.findIndex((r) => r.id === selectedId);
      switch (e.key) {
        case "j": case "ArrowDown": e.preventDefault(); if (filtered[pos + 1]) setSelectedId(filtered[pos + 1].id); break;
        case "k": case "ArrowUp": e.preventDefault(); if (filtered[pos - 1]) setSelectedId(filtered[pos - 1].id); break;
        case "i": decide(selectedId, "include"); break;
        case "e": decide(selectedId, "exclude"); break;
        case "m": decide(selectedId, "uncertain"); break;
        case "f": toggleFlag(selectedId); break;
        case "Escape": setCtx(null); break;
        default: break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filtered, selectedId, decide, toggleFlag]);

  useEffect(() => {
    const row = bodyRef.current?.querySelector(`tr[data-id="${CSS.escape(String(selectedId))}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  const toggleFilter = (group, value) => setFilters((f) => {
    const next = new Set(f[group]);
    if (next.has(value)) next.delete(value); else next.add(value);
    return { ...f, [group]: next };
  });

  const screened = records.filter((r) => r.tiab && r.tiab !== "uncertain").length;
  const allTags = Object.keys(counts.tag).sort((a, b) => counts.tag[b] - counts.tag[a]);

  const FilterBlock = ({ id, title, entries, group, swatches = {} }) => (
    <div style={{ borderBottom: "1px solid var(--line)" }}>
      <div
        className="wb-row"
        style={{ background: "var(--bg-panel)", cursor: "default" }}
        onClick={() => setCollapsed((c) => ({ ...c, [id]: !c[id] }))}
      >
        <span style={{ width: 10, color: "var(--fg-faint)", fontSize: 9 }}>{collapsed[id] ? "▸" : "▾"}</span>
        <span className="lbl" style={{ fontWeight: 600, textTransform: "uppercase", fontSize: 10, letterSpacing: ".4px", color: "var(--fg-dim)" }}>{title}</span>
        <span className="n">{entries.length}</span>
      </div>
      {!collapsed[id] && entries.map(([value, n]) => {
        const on = filters[group].has(String(value));
        return (
          <div key={value} className={`wb-row wb-sub ${on ? "soft" : ""}`} onClick={() => toggleFilter(group, String(value))}>
            <span style={{
              width: 11, height: 11, flexShrink: 0, borderRadius: 2, border: "1px solid var(--line-strong)",
              background: on ? "var(--accent)" : "var(--bg-input)",
            }} />
            {swatches[value] && <span className="dot" style={{ background: swatches[value] }} />}
            <span className="lbl">{value}</span>
            <span className="n">{n}</span>
          </div>
        );
      })}
    </div>
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "230px 1fr", height: "100%", minHeight: 0 }} onClick={() => setCtx(null)}>
      {/* filters */}
      <div style={{ borderRight: "1px solid var(--line)", overflow: "auto" }}>
        <div style={{ padding: "4px 6px", borderBottom: "1px solid var(--line)" }}>
          <input className="wb-input" style={{ width: "100%" }} placeholder="Filter records" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <FilterBlock
          id="dec" title="Decision" group="decision"
          entries={["include", "exclude", "uncertain", "pending"].map((k) => [k, counts.decision[k] || 0])}
          swatches={{ include: "var(--ok)", exclude: "var(--err)", uncertain: "var(--warn)", pending: "var(--fg-faint)" }}
        />
        {matcher.blocks.length > 0 && (
          <FilterBlock
            id="match" title="Strategy" group="match"
            entries={[["matched", counts.match.matched], ["unmatched", counts.match.unmatched]]}
            swatches={{ matched: "var(--accent)", unmatched: "var(--fg-faint)" }}
          />
        )}
        <FilterBlock id="tag" title="Tags" group="tag" entries={allTags.map((t) => [t, counts.tag[t]])} />
        <FilterBlock id="src" title="Source" group="source" entries={Object.entries(counts.source).sort((a, b) => b[1] - a[1])} />
        <FilterBlock id="yr" title="Year" group="year" entries={Object.entries(counts.year).sort((a, b) => Number(b[0]) - Number(a[0]))} />
      </div>

      {/* grid + record */}
      <div style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
        <div className="wb-panel-head">
          <span className="wb-count">{filtered.length} shown</span>
          <span className="wb-count" style={{ color: "var(--ok)" }}>{counts.decision.include || 0} incl</span>
          <span className="wb-count" style={{ color: "var(--err)" }}>{counts.decision.exclude || 0} excl</span>
          <span className="wb-count" style={{ color: "var(--warn)" }}>{counts.decision.uncertain || 0} maybe</span>
          <span className="wb-count">{records.length - screened} left</span>
          <span className="wb-spacer" />
          <span className="wb-count">J/K move · I/E/M decide · F flag</span>
        </div>

        <div style={{ flex: "1 1 55%", overflow: "auto", minHeight: 0 }} ref={bodyRef}>
          <table className="wb-grid">
            <thead>
              <tr>
                {[["order", "#", 40], ["title", "Title", null], ["year", "Year", 52], ["source", "Source", 96], ["tags", "Tags", 150], ["tiab", "Decision", 74], ["flag", "⚑", 28]].map(([key, label, width]) => (
                  <th
                    key={key} style={width ? { width } : undefined}
                    onClick={() => setSort((s) => ({ key, dir: s.key === key ? -s.dir : 1 }))}
                    title={`Sort by ${label}`}
                  >
                    {label}{sort.key === key ? (sort.dir > 0 ? " ▲" : " ▼") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const dec = DECISIONS[r.tiab] || "pend";
                const matched = matchById.get(r.id);
                return (
                  <tr
                    key={r.id} data-id={r.id}
                    className={selectedId === r.id ? "sel" : ""}
                    onClick={() => setSelectedId(r.id)}
                    onContextMenu={(e) => { e.preventDefault(); setSelectedId(r.id); setCtx({ x: e.clientX, y: e.clientY, id: r.id }); }}
                  >
                    <td className="wb-num" style={{ color: "var(--fg-faint)" }}>{r.order}</td>
                    <td title={r.title} style={{ color: matched ? "var(--fg-bright)" : undefined }}>
                      {matcher.blocks.length > 0 && (
                        <span title={matched ? "matches the strategy" : "does not match the strategy"} style={{
                          display: "inline-block", width: 6, height: 6, borderRadius: "50%", marginRight: 6,
                          background: matched ? "var(--accent)" : "transparent", border: matched ? "none" : "1px solid var(--line-strong)",
                        }} />
                      )}
                      {r.title}
                    </td>
                    <td className="wb-num">{r.year || ""}</td>
                    <td style={{ color: "var(--fg-faint)" }}>{r.source || ""}</td>
                    <td style={{ overflow: "hidden" }}>
                      {(r.tags || []).map((t) => <span key={t} className="wb-chip">{t}</span>)}
                    </td>
                    <td><span className={`wb-dec ${dec}`}>{DEC_LABEL[r.tiab] || "—"}</span></td>
                    <td style={{ textAlign: "center", color: r.flag ? "var(--warn)" : "var(--fg-faint)" }}>{r.flag ? "⚑" : ""}</td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={7} style={{ color: "var(--fg-faint)" }}>No record matches these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* the record itself */}
        <div style={{ flex: "1 1 45%", borderTop: "1px solid var(--line)", overflow: "auto", minHeight: 0 }}>
          {!selected ? (
            <div style={{ padding: 8, color: "var(--fg-faint)", fontSize: 11 }}>No record selected.</div>
          ) : (
            <>
              <div className="wb-insp-title">{selected.title}</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
                <div>
                  <div className="wb-prop"><span className="k">Authors</span><span className="v">{selected.authors || "—"}</span></div>
                  <div className="wb-prop"><span className="k">Year</span><span className="v mono">{selected.year || "—"}</span></div>
                  <div className="wb-prop"><span className="k">Source</span><span className="v">{selected.source || "—"}</span></div>
                </div>
                <div>
                  <div className="wb-prop"><span className="k">DOI</span><span className="v mono">{selected.doi || "—"}</span></div>
                  <div className="wb-prop"><span className="k">PMID</span><span className="v mono">{selected.pmid || "—"}</span></div>
                  <div className="wb-prop">
                    <span className="k">Strategy</span>
                    <span className="v" style={{ color: matchById.get(selected.id) ? "var(--accent)" : "var(--fg-faint)" }}>
                      {matcher.blocks.length ? (matchById.get(selected.id) ? "matches" : "does not match") : "no strategy compiled"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="wb-insp-title">Tags</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: "4px 8px", alignItems: "center" }}>
                {allTags.map((t) => (
                  <button key={t} className={`wb-tag ${(selected.tags || []).includes(t) ? "on" : ""}`} onClick={() => toggleTag(selected.id, t)}>
                    {t} <span style={{ color: "var(--fg-faint)" }}>{counts.tag[t]}</span>
                  </button>
                ))}
                <input
                  className="wb-input" style={{ width: 130 }} placeholder="new tag" value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    const tag = tagDraft.trim().toLowerCase();
                    if (!tag) return;
                    toggleTag(selected.id, tag);
                    setTagDraft("");
                    flash(`tag "${tag}" applied`);
                  }}
                />
              </div>

              <div className="wb-insp-title">Abstract — strategy hits highlighted</div>
              <div style={{ padding: "4px 8px", fontSize: 11.5, lineHeight: 1.55, userSelect: "text" }}>
                {selected.abstract
                  ? <Marked text={recordText(selected)} matcher={matcher} />
                  : <span style={{ color: "var(--fg-faint)" }}>No abstract was returned for this record.</span>}
              </div>

              <div className="wb-decide">
                <div className="db inc" onClick={() => decide(selected.id, "include")}>Include<kbd>I</kbd></div>
                <div className="db exc" onClick={() => decide(selected.id, "exclude")}>Exclude<kbd>E</kbd></div>
                <div className="db maybe" onClick={() => decide(selected.id, "uncertain")}>Maybe<kbd>M</kbd></div>
              </div>
            </>
          )}
        </div>
      </div>

      {ctx && (
        <div className="wb-ctx" style={{ left: Math.min(ctx.x, window.innerWidth - 190), top: Math.min(ctx.y, window.innerHeight - 170) }}>
          <div className="ci" onClick={() => decide(ctx.id, "include")}>Include <kbd>I</kbd></div>
          <div className="ci" onClick={() => decide(ctx.id, "exclude")}>Exclude <kbd>E</kbd></div>
          <div className="ci" onClick={() => decide(ctx.id, "uncertain")}>Maybe <kbd>M</kbd></div>
          <div className="sep" />
          <div className="ci" onClick={() => toggleFlag(ctx.id)}>Toggle flag <kbd>F</kbd></div>
          <div className="ci" onClick={() => { patchRecord(ctx.id, { retrieval: "retrieved" }); flash("marked retrieved"); }}>Mark full text retrieved</div>
          <div className="sep" />
          <div className="ci" onClick={() => { patchRecord(ctx.id, { tiab: null, tiabReason: null }); flash("decision cleared"); onNote?.("Screening decision cleared — the record returns to the pending queue."); }}>Clear decision</div>
        </div>
      )}

      {toast && <div className="wb-toast">{toast}</div>}
    </div>
  );
}

function Marked({ text, matcher }) {
  const spans = highlightSpans(text, matcher);
  if (!spans.length) return <span>{text}</span>;
  const out = [];
  let cursor = 0;
  spans.forEach((span, i) => {
    if (span.start > cursor) out.push(<span key={`t${i}`}>{text.slice(cursor, span.start)}</span>);
    out.push(<mark key={`m${i}`} className={span.op === "NOT" ? "wb-mark not" : "wb-mark"} title={`${span.op} · ${span.label}`}>{text.slice(span.start, span.end)}</mark>);
    cursor = span.end;
  });
  if (cursor < text.length) out.push(<span key="tail">{text.slice(cursor)}</span>);
  return <>{out}</>;
}
