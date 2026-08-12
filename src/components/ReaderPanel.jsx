import React, { useState, useEffect, useRef, useMemo } from "react";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { extractPdf } from "../engine/documentReader.js";
import { loadReview, saveReview } from "../engine/reviewengine.js";
import { activeProject, putFile } from "../engine/projectstore.js";

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
  const renderTask = useRef(null);

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
    })();
    return () => { cancelled = true; };
  }, [doc, page, scale]);

  const attach = async () => {
    if (!file || !recordId || !pid) return;
    setStatus("extracting text");
    const extracted = await extractPdf(file);
    const current = loadReview(pid);
    if (!current) { setStatus("no review in this project"); return; }
    const records_ = (current.objects.records || []).map((r) =>
      r.id === recordId
        ? { ...r, fullText: extracted.text, fullTextPages: extracted.pages, fullTextSource: file.name, retrieval: "retrieved" }
        : r
    );
    const next = { ...current, objects: { ...current.objects, records: records_ } };
    saveReview(pid, next);
    putFile(pid, { path: `fulltext/${file.name}`, name: file.name, type: "fulltext", content: extracted.text, meta: { recordId, pages: extracted.pages } });
    setReview(next);
    setStatus(`attached ${extracted.pages} pages to the record — retrieval marked retrieved`);
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
        <div style={{ flex: 1, overflow: "auto", background: "var(--bg-app)", padding: 10, display: "flex", justifyContent: "center" }}>
          {doc ? <canvas ref={canvasRef} style={{ border: "1px solid var(--line)" }} /> : <div style={{ color: "var(--fg-faint)", fontSize: 11 }}>Open a PDF to read it.</div>}
        </div>
      </div>
    </div>
  );
}
