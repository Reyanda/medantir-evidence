import React, { useState, useMemo, useCallback } from "react";
import {
  materializeSandbox, sandboxTree, buildManifest, toYaml, fileLinks,
  listChildReviews, addChildReview, removeChildReview, correctedCoveredArea,
  linkDocument, sha256Hex, REVIEW_KINDS, isUmbrella, PATHS,
} from "../engine/reviewSandbox.js";
import { getProject } from "../engine/projectstore.js";
import { extractPdf } from "../engine/documentReader.js";

// The sandbox: one review, one declared layout, and a manifest that says which
// document backs which record. PDFs are linked rather than copied — a browser
// store cannot hold hundreds of megabytes, and a silently truncated trial report
// would be worse than none, so what is recorded is the path, size, hash and the
// text the pipeline actually reads.

export default function SandboxPanel({ projectId, review, onReviewChange, onNote }) {
  const [written, setWritten] = useState(null);
  const [child, setChild] = useState({ title: "", year: "", doi: "", primaries: "" });
  const [children, setChildren] = useState(() => (projectId ? listChildReviews(projectId) : []));
  const [linking, setLinking] = useState("");
  const [selectedRecord, setSelectedRecord] = useState("");

  const project = projectId ? getProject(projectId) : null;
  const kind = review?.methodology?.typeId === "umbrella" ? "umbrella" : (review?.sandboxKind || "systematic");
  const kindMeta = REVIEW_KINDS.find((k) => k.id === kind) || REVIEW_KINDS[0];

  const manifest = useMemo(
    () => (review ? buildManifest(review, { project, children }) : null),
    [review, project, children]
  );
  const links = useMemo(() => (review ? fileLinks(review) : []), [review]);
  const tree = useMemo(() => (projectId ? sandboxTree(projectId) : {}), [projectId, written]);
  const overlap = useMemo(() => correctedCoveredArea(children), [children]);
  const records = review?.objects?.records || [];
  const unlinked = records.filter((r) => r.tiab === "include" && !r.files?.pdf);

  const materialize = useCallback(() => {
    const result = materializeSandbox(projectId, { children });
    if (!result.ok) { onNote?.(result.reason, "err"); return; }
    setWritten(result.written);
    onNote?.(`Sandbox written: ${result.written.length} files, including the manifest at ${PATHS.manifest}.`, "ok");
  }, [projectId, children, onNote]);

  // Linking a document: hash it, read its text, record where it lives. The bytes
  // stay on disk where the operator put them.
  const attach = async (event) => {
    const file = event.target.files?.[0];
    if (!file || !selectedRecord) return;
    setLinking(file.name);
    try {
      const buffer = await file.arrayBuffer();
      const hash = await sha256Hex(buffer);
      const extracted = await extractPdf(file);
      const result = await linkDocument(projectId, selectedRecord, {
        path: file.webkitRelativePath || file.name,
        bytes: file.size,
        hash,
        text: extracted.text,
        pages: extracted.pages,
      });
      setLinking("");
      if (!result.ok) { onNote?.(result.reason, "err"); return; }
      onReviewChange?.(result.review);
      onNote?.(`${file.name} linked to ${selectedRecord}: ${extracted.pages} pages, ${extracted.text.length} characters of text, sha256 ${String(hash).slice(0, 12)}…`, "ok");
    } catch (e) {
      setLinking("");
      onNote?.(`Could not read ${file.name}: ${String(e.message || e)}`, "err");
    }
  };

  const renderTree = (node, depth = 0, prefix = "") =>
    Object.entries(node)
      .filter(([key]) => key !== "__dir" && key !== "__file")
      .sort(([a, x], [b, y]) => (!!y.__file - !!x.__file) || a.localeCompare(b))
      .map(([key, value]) => (
        value.__file ? (
          <div className="wb-row" key={`${prefix}${key}`} style={{ paddingLeft: 8 + depth * 12 }} title={value.path}>
            <span className="lbl">{key}</span>
            <span className="n">{value.size > 1024 ? `${(value.size / 1024).toFixed(1)}k` : value.size}</span>
          </div>
        ) : (
          <React.Fragment key={`${prefix}${key}`}>
            <div className="wb-row" style={{ paddingLeft: 8 + depth * 12, color: "var(--fg-dim)" }}>
              <span className="lbl">{key}/</span>
            </div>
            {renderTree(value, depth + 1, `${prefix}${key}/`)}
          </React.Fragment>
        )
      ));

  if (!review) {
    return <div style={{ padding: "6px 8px", color: "var(--fg-faint)", fontSize: 11 }}>No review is bound to this project yet.</div>;
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 32%) 1fr", height: "100%", minHeight: 0 }}>
      <div style={{ borderRight: "1px solid var(--line)", overflow: "auto" }}>
        <div className="wb-insp-title">Sandbox</div>
        <div className="wb-prop"><span className="k">Project</span><span className="v">{project?.name || "—"}</span></div>
        <div className="wb-prop"><span className="k">Kind</span><span className="v">{kindMeta.label}</span></div>
        <div className="wb-prop"><span className="k">Unit</span><span className="v" style={{ fontSize: 10.5 }}>{kindMeta.note}</span></div>
        <div style={{ padding: "4px 8px", display: "flex", gap: 4 }}>
          <button className="wb-btn on" onClick={materialize}>Write sandbox files</button>
          <button
            className="wb-btn"
            onClick={() => {
              const blob = new Blob([toYaml(manifest)], { type: "text/yaml" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob); a.download = "review.yaml"; a.click(); URL.revokeObjectURL(a.href);
            }}
          >
            Download review.yaml
          </button>
        </div>

        <div className="wb-insp-title">Files <span className="wb-count">{written?.length ?? Object.keys(tree).length}</span></div>
        <div style={{ fontFamily: "var(--mono)", fontSize: 10.5 }}>
          {Object.keys(tree).length === 0
            ? <div style={{ padding: "4px 8px", color: "var(--fg-faint)" }}>Nothing written yet.</div>
            : renderTree(tree)}
        </div>
      </div>

      <div style={{ overflow: "auto" }}>
        <div className="wb-insp-title">
          Documents linked to records <span className="wb-count">{links.length} of {records.length}</span>
        </div>
        <div style={{ padding: "2px 8px", fontSize: 10.5, color: "var(--fg-faint)", lineHeight: 1.6 }}>
          A search result becomes usable evidence only when it points at the document it was read
          from. The PDF stays where you put it; the sandbox records its path, size and SHA-256, and
          keeps the extracted text that the pipeline reads.
        </div>
        <table className="wb-grid">
          <thead><tr><th>Record</th><th style={{ width: 200 }}>Document</th><th style={{ width: 70 }}>Size</th><th style={{ width: 60 }}>Pages</th><th style={{ width: 92 }}>sha256</th></tr></thead>
          <tbody>
            {links.map((l) => (
              <tr key={l.record}>
                <td title={l.title}>{l.title}</td>
                <td style={{ fontFamily: "var(--mono)", fontSize: 10.5 }} title={l.pdf || ""}>{l.pdf || <span style={{ color: "var(--fg-faint)" }}>text only</span>}</td>
                <td className="wb-num">{l.pdf_bytes ? `${(l.pdf_bytes / 1024 / 1024).toFixed(2)}M` : "—"}</td>
                <td className="wb-num">{l.pages ?? "—"}</td>
                <td style={{ fontFamily: "var(--mono)", fontSize: 10 }}>{l.pdf_sha256 ? l.pdf_sha256.slice(0, 10) : "—"}</td>
              </tr>
            ))}
            {links.length === 0 && <tr><td colSpan={5} style={{ color: "var(--fg-faint)" }}>No document is linked yet.</td></tr>}
          </tbody>
        </table>

        <div className="wb-insp-title">Link a document {unlinked.length > 0 && <span className="wb-count" style={{ color: "var(--warn)" }}>{unlinked.length} included record(s) without one</span>}</div>
        <div className="wb-prop">
          <span className="k">Record</span>
          <select className="wb-select" value={selectedRecord} onChange={(e) => setSelectedRecord(e.target.value)}>
            <option value="">select a record…</option>
            {records.filter((r) => r.tiab === "include" || r.retrieval).map((r) => (
              <option key={r.id} value={r.id}>{r.files?.pdf ? "✓ " : ""}{String(r.title || r.id).slice(0, 70)}</option>
            ))}
          </select>
        </div>
        <div style={{ padding: "4px 8px" }}>
          <input type="file" accept="application/pdf" disabled={!selectedRecord} onChange={attach} style={{ fontSize: 11, color: "var(--fg-dim)" }} />
          {linking && <span style={{ marginLeft: 8, fontSize: 10.5, color: "var(--fg-dim)" }}>reading {linking}…</span>}
        </div>

        {isUmbrella(kind) && (
          <>
            <div className="wb-insp-title">Included reviews <span className="wb-count">{children.length}</span></div>
            <div style={{ padding: "2px 8px", fontSize: 10.5, color: "var(--fg-faint)" }}>
              An umbrella review's unit is a review. Each brings its own primaries, and they are kept
              apart so the overlap between them can be measured.
            </div>
            <table className="wb-grid">
              <thead><tr><th>Review</th><th style={{ width: 56 }}>Year</th><th style={{ width: 74 }}>Primaries</th><th style={{ width: 34 }} /></tr></thead>
              <tbody>
                {children.map((c) => (
                  <tr key={c.id}>
                    <td title={c.doi || ""}>{c.title}</td>
                    <td className="wb-num">{c.year || "—"}</td>
                    <td className="wb-num">{c.primaries}</td>
                    <td><button className="wb-btn danger" style={{ height: 16, padding: "0 5px", fontSize: 10 }} onClick={() => setChildren(removeChildReview(projectId, c.id))}>×</button></td>
                  </tr>
                ))}
                {children.length === 0 && <tr><td colSpan={4} style={{ color: "var(--fg-faint)" }}>None included yet.</td></tr>}
              </tbody>
            </table>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 120px", gap: 4, padding: "4px 8px" }}>
              <input className="wb-input" placeholder="Review title" value={child.title} onChange={(e) => setChild({ ...child, title: e.target.value })} />
              <input className="wb-input" placeholder="Year" value={child.year} onChange={(e) => setChild({ ...child, year: e.target.value })} />
              <input className="wb-input" placeholder="DOI" value={child.doi} onChange={(e) => setChild({ ...child, doi: e.target.value })} />
            </div>
            <div className="wb-prop">
              <span className="k">Primaries</span>
              <input
                className="wb-input" placeholder="primary study ids or PMIDs, comma separated"
                value={child.primaries} onChange={(e) => setChild({ ...child, primaries: e.target.value })}
              />
            </div>
            <div style={{ padding: "4px 8px" }}>
              <button
                className="wb-btn" disabled={!child.title.trim()}
                onClick={() => {
                  const primaries = child.primaries.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
                  const res = addChildReview(projectId, { title: child.title.trim(), year: child.year.trim(), doi: child.doi.trim(), primaries });
                  if (!res.ok) { onNote?.(res.reason, "warn"); return; }
                  setChildren(res.children);
                  setChild({ title: "", year: "", doi: "", primaries: "" });
                  onNote?.(`"${res.child.title}" included with ${res.child.primaries} primary study id(s).`, "ok");
                }}
              >
                Include review
              </button>
            </div>

            <div className="wb-insp-title">Overlap between included reviews</div>
            {!overlap.ok ? (
              <div style={{ padding: "4px 8px", fontSize: 11, color: "var(--fg-faint)" }}>{overlap.reason}</div>
            ) : (
              <>
                <div className="wb-prop"><span className="k">CCA</span><span className="v mono" style={{ color: overlap.cca > 0.15 ? "var(--err)" : overlap.cca > 0.05 ? "var(--warn)" : "var(--ok)" }}>{(overlap.cca * 100).toFixed(1)}% — {overlap.interpretation}</span></div>
                <div className="wb-prop"><span className="k">Primaries</span><span className="v mono">{overlap.r} distinct across {overlap.c} reviews ({overlap.N} occurrences)</span></div>
                <div style={{ padding: "2px 8px", fontSize: 10.5, color: "var(--fg-faint)", lineHeight: 1.6 }}>
                  Corrected covered area (Pieper et al.). High overlap means the same primary studies
                  are being counted several times, which inflates any pooled result across reviews.
                </div>
              </>
            )}
          </>
        )}

        <div className="wb-insp-title">review.yaml</div>
        <pre style={{ margin: 0, padding: "6px 8px", fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--fg)", whiteSpace: "pre-wrap", userSelect: "text", lineHeight: 1.5 }}>
          {manifest ? toYaml(manifest).slice(0, 6000) : ""}
        </pre>
      </div>
    </div>
  );
}
