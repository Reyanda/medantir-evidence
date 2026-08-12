import React, { useState, useEffect, useRef, useMemo } from "react";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { extractPdf } from "../engine/documentReader.js";
import { loadReview, saveReview } from "../engine/reviewengine.js";
import { activeProject, putFile } from "../engine/projectstore.js";
import { blockPattern } from "../engine/termIndex.js";
import { linkDocument, sha256Hex } from "../engine/reviewSandbox.js";

// The full-text reader. Screening, extraction and risk of bias all consume
// `record.fullText`; until a PDF is attached to a record that field is empty and
// those stages have nothing to read. Attaching here is what fills it, and it
// also sets the retrieval status the PRISMA counts are built from.
export default function ReaderPanel({ projectId = null }) {
  const [file, setFile] = useState(null);
  const [doc, setDoc] = useState(null);
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1.2);
  const [status, setStatus] = useState("");
  const [query, setQuery] = useState("");
  const [recordId, setRecordId] = useState("");
  const canvasRef = useRef(null);
  const overlayRef = useRef(null);
  const renderTask = useRef(null);
  const [hits, setHits] = useState([]);
  const [autoTag, setAutoTag] = useState(true);

  // Each PRISM/PICO facet gets its own colour, and the field patterns come from
  // the question itself — so the highlighting is the strategy, applied to the
  // page, rather than a separate set of rules that can drift from it.
  const facets = useMemo(() => {
    const prism = review?.protocol?.prism?.facets || {};
    const pico = review?.protocol?.pico || {};
    const spec = [
      { key: "population", label: "P · population", colour: "#4ea1ff", terms: prism.population || pico.population },
      { key: "intervention", label: "I · intervention", colour: "#3fb950", terms: prism.intervention || pico.intervention },
      { key: "standard", label: "S · comparator", colour: "#d29922", terms: prism.standard || pico.comparator },
      { key: "measure", label: "M · outcome", colour: "#b58bd6", terms: prism.measure || pico.outcomes },
      { key: "time", label: "T · timing", colour: "#3dc9b0", terms: prism.time || pico.timeframe },
      { key: "geography", label: "G · setting", colour: "#c9803a", terms: prism.geography || pico.setting },
      { key: "design", label: "D · design", colour: "#f0796a", terms: prism.design || pico.studyDesign },
    ];
    return spec
      .map((f) => {
        const terms = Array.isArray(f.terms) ? f.terms : String(f.terms || "").split(/[,;]/).map((t) => t.trim()).filter(Boolean);
        const source = blockPattern(terms);
        return source ? { ...f, terms, re: new RegExp(source, "giu") } : null;
      })
      .filter(Boolean);
  }, [review?.protocol?.prism, review?.protocol?.pico]);

  const pid = projectId || activeProject();
  const [review, setReview] = useState(() => (pid ? loadReview(pid) : null));
  useEffect(() => { setReview(pid ? loadReview(pid) : null); }, [pid]);
  const records = useMemo(() => (review?.objects?.records || []).filter((r) => !r.isDuplicate), [review]);
  const shortlist = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pool = q ? records.filter((r) => String(r.title || "").toLowerCase().includes(q)) : records;
    return pool.slice(0, 200);
  }, [records, query]);

  const open = async (f) => {
    setFile(f); setStatus("opening");
    const pdfjs = await import("pdfjs-dist/build/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    const bytes = new Uint8Array(await f.arrayBuffer());
    const d = await pdfjs.getDocument({ data: bytes }).promise;
    setDoc(d); setPage(1); setStatus(`${d.numPages} pages`);
  };

  useEffect(() => {
    if (!doc || !canvasRef.current) return;
    let cancelled = false;
    (async () => {
      const p = await doc.getPage(page);
      if (cancelled) return;
      const viewport = p.getViewport({ scale });
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      renderTask.current?.cancel?.();
      renderTask.current = p.render({ canvasContext: ctx, viewport });
      try { await renderTask.current.promise; } catch { /* superseded by a newer page */ }

      // Field highlighting from the pdf.js text layer: every item carries its own
      // transform, so a match can be boxed where it actually sits on the page.
      // This is text-layer matching, not computer vision — a scanned page with no
      // text layer yields no highlights, and says so rather than guessing.
      if (cancelled || !facets.length) { setHits([]); return; }
      const content = await p.getTextContent();
      const found = [];
      for (const item of content.items) {
        const text = item.str || "";
        if (!text.trim()) continue;
        for (const facet of facets) {
          facet.re.lastIndex = 0;
          let m;
          while ((m = facet.re.exec(text)) !== null) {
            if (!m[0].length) { facet.re.lastIndex += 1; continue; }
            const tx = window.pdfjsLib?.Util
              ? window.pdfjsLib.Util.transform(viewport.transform, item.transform)
              : null;
            const [, , , , x, y] = tx || item.transform.map((v, i) => (i === 4 ? item.transform[4] * scale : i === 5 ? viewport.height - item.transform[5] * scale : v));
            const width = (item.width || text.length * 4) * scale * (m[0].length / Math.max(1, text.length));
            const height = (item.height || 10) * scale || 12;
            const offset = (m.index / Math.max(1, text.length)) * (item.width || 0) * scale;
            found.push({
              facet: facet.key, label: facet.label, colour: facet.colour, match: m[0],
              x: (x || 0) + offset, y: (y || 0) - height, w: Math.max(6, width), h: height,
            });
          }
        }
      }
      if (!cancelled) setHits(found);
    })();
    return () => { cancelled = true; };
  }, [doc, page, scale]);

  const attach = async () => {
    if (!file || !recordId || !pid) return;
    setStatus("hashing and extracting");
    const extracted = await extractPdf(file);
    const hash = await sha256Hex(await file.arrayBuffer());

    // The document is linked into the sandbox layout, not copied into it: the
    // record gains a path, a size and a hash alongside the text.
    const linked = await linkDocument(pid, recordId, {
      path: file.webkitRelativePath || file.name,
      bytes: file.size,
      hash,
      text: extracted.text,
      pages: extracted.pages,
    });
    if (!linked.ok) { setStatus(linked.reason); return; }

    let next = linked.review;
    // Auto-tagging: a facet whose terms appear in the document is a tag the
    // document earned. Facets that do not appear are not tagged — an absent tag
    // is information too.
    if (autoTag && facets.length) {
      const text = extracted.text;
      const earned = facets.filter((f) => { f.re.lastIndex = 0; return f.re.test(text); }).map((f) => f.key);
      const records_ = (next.objects.records || []).map((r) => (
        r.id === recordId ? { ...r, tags: [...new Set([...(r.tags || []), ...earned])], autoTags: earned } : r
      ));
      next = { ...next, objects: { ...next.objects, records: records_ } };
      saveReview(pid, next);
      setStatus(`linked ${extracted.pages} pages · sha256 ${String(hash).slice(0, 10)}… · tagged ${earned.length ? earned.join(", ") : "nothing — no facet term appears in the text"}`);
    } else {
      setStatus(`linked ${extracted.pages} pages · sha256 ${String(hash).slice(0, 10)}…`);
    }
    setReview(next);
  };

  const attached = records.find((r) => r.id === recordId);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", height: "100%", minHeight: 0 }}>
      <div style={{ borderRight: "1px solid var(--line)", overflow: "auto", display: "flex", flexDirection: "column" }}>
        <div className="wb-insp-title">Document</div>
        <div style={{ padding: "4px 8px" }}>
          <input type="file" accept="application/pdf" onChange={(e) => e.target.files?.[0] && open(e.target.files[0])} style={{ fontSize: 11, color: "var(--fg-dim)" }} />
        </div>
        {file && <div className="wb-prop"><span className="k">File</span><span className="v mono">{file.name}</span></div>}
        {doc && <div className="wb-prop"><span className="k">Pages</span><span className="v mono">{doc.numPages}</span></div>}

        <div className="wb-insp-title">Attach to record</div>
        <div style={{ padding: "4px 8px" }}>
          <input className="wb-input" style={{ width: "100%" }} placeholder="Filter records" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div style={{ flex: 1, minHeight: 80, overflow: "auto" }}>
          {shortlist.map((r) => (
            <div key={r.id} className={`wb-row ${recordId === r.id ? "sel" : ""}`} onClick={() => setRecordId(r.id)} title={r.title}>
              <span className="lbl">{r.title}</span>
              {r.fullText && <span className="n">txt</span>}
            </div>
          ))}
          {records.length === 0 && <div style={{ padding: "4px 8px", color: "var(--fg-faint)", fontSize: 11 }}>No records in this review yet.</div>}
        </div>
        <div style={{ padding: "6px 8px", borderTop: "1px solid var(--line)" }}>
          <button className="wb-btn on" onClick={attach} disabled={!file || !recordId}>Attach full text</button>
          {attached?.fullText && <div style={{ fontSize: 10.5, color: "var(--fg-faint)", marginTop: 4, fontFamily: "var(--mono)" }}>record already carries {attached.fullText.length} chars</div>}
          {status && <div style={{ fontSize: 10.5, color: "var(--fg-dim)", marginTop: 4, fontFamily: "var(--mono)" }}>{status}</div>}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div className="wb-tabs" style={{ alignItems: "center", padding: "0 6px", gap: 4 }}>
          <button className="wb-btn" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={!doc || page <= 1}>Prev</button>
          <span className="wb-count">{doc ? `${page} / ${doc.numPages}` : "—"}</span>
          <button className="wb-btn" onClick={() => setPage((p) => Math.min(doc?.numPages || 1, p + 1))} disabled={!doc || page >= (doc?.numPages || 1)}>Next</button>
          <span className="wb-sep" />
          <button className="wb-btn" onClick={() => setScale((s) => Math.max(0.5, s - 0.2))} disabled={!doc}>-</button>
          <span className="wb-count">{Math.round(scale * 100)}%</span>
          <button className="wb-btn" onClick={() => setScale((s) => Math.min(3, s + 0.2))} disabled={!doc}>+</button>
        </div>
        {doc && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "3px 8px", borderBottom: "1px solid var(--line)", fontSize: 10.5 }}>
            {facets.length === 0 ? (
              <span style={{ color: "var(--fg-faint)" }}>No question facets to highlight — build the question first.</span>
            ) : facets.map((f) => {
              const n = hits.filter((h) => h.facet === f.key).length;
              return (
                <span key={f.key} style={{ color: n ? "var(--fg)" : "var(--fg-faint)" }} title={f.terms.join(" OR ")}>
                  <span style={{ display: "inline-block", width: 8, height: 8, background: f.colour, marginRight: 4, opacity: n ? 1 : 0.3 }} />
                  {f.label} <span className="wb-mono">{n}</span>
                </span>
              );
            })}
            <span className="wb-spacer" style={{ flex: 1 }} />
            <label style={{ color: "var(--fg-dim)" }}>
              <input type="checkbox" checked={autoTag} onChange={(e) => setAutoTag(e.target.checked)} /> auto-tag on attach
            </label>
          </div>
        )}
        <div style={{ flex: 1, overflow: "auto", background: "var(--bg-app)", padding: 10, display: "flex", justifyContent: "center" }}>
          {doc ? (
            <div style={{ position: "relative" }} ref={overlayRef}>
              <canvas ref={canvasRef} style={{ border: "1px solid var(--line)", display: "block" }} />
              {hits.map((h, i) => (
                <div
                  key={i}
                  title={`${h.label}: ${h.match}`}
                  style={{
                    position: "absolute", left: h.x, top: h.y, width: h.w, height: h.h,
                    background: h.colour, opacity: 0.28, pointerEvents: "none",
                    borderBottom: `1px solid ${h.colour}`,
                  }}
                />
              ))}
            </div>
          ) : <div style={{ color: "var(--fg-faint)", fontSize: 11 }}>Open a PDF to read it.</div>}
        </div>
      </div>
    </div>
  );
}
