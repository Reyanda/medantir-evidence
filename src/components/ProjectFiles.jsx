import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Download, Eye, FilePlus, FileText, Folder, FolderOpen, Import, Languages, Loader2, Pencil, RefreshCw, Search, Sparkles, Upload } from "lucide-react";
import MarkdownIt from "markdown-it";
import { getFile, getProject, listFiles, putFile, retrieve } from "../engine/projectstore.js";
import { getFolderHandle, isReadableTextPath, listFolderContents, readFolderFile, readFolderFileObject, searchFolderContents } from "../engine/folderSource.js";
import { multiModelAsk } from "../engine/ensemble.js";
import { activeProvider } from "../engine/providers.js";
import { extractDocument } from "../engine/documentReader.js";

const button = "flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50";
const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });

export default function ProjectFiles({ projectId, onChange }) {
  const [files, setFiles] = useState(() => listFiles(projectId));
  const [source, setSource] = useState("project");
  const [open, setOpen] = useState(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState(null);
  const [answer, setAnswer] = useState(null);
  const [busy, setBusy] = useState("");
  const [folderEntries, setFolderEntries] = useState([]);
  const [folderError, setFolderError] = useState("");
  const [folderFilter, setFolderFilter] = useState("");
  const [collapsed, setCollapsed] = useState(new Set());
  const [fileMode, setFileMode] = useState("read");
  const [targetLanguage, setTargetLanguage] = useState("English");
  const fileInput = useRef(null);
  const project = getProject(projectId);

  const refresh = () => {
    setFiles(listFiles(projectId));
    onChange?.();
  };

  useEffect(() => {
    setFiles(listFiles(projectId));
    setOpen(null);
    setHits(null);
    setAnswer(null);
    setFolderEntries([]);
    setFolderError("");
    setSource("project");
    setFileMode("read");
  }, [projectId]);

  useEffect(() => () => { if (open?.previewUrl) URL.revokeObjectURL(open.previewUrl); }, [open]);

  const loadFolder = async () => {
    setBusy("reading folder tree…");
    setFolderError("");
    try {
      const handle = await getFolderHandle(projectId);
      if (!handle) throw new Error("Folder permission is unavailable. Re-attach the folder from Overview.");
      const entries = await listFolderContents(handle);
      setFolderEntries(entries);
      if (entries.truncated) setFolderError("The tree is capped at 2,000 entries. Filter or attach a narrower folder for complete browsing.");
    } catch (error) {
      setFolderError(String(error.message || error));
    } finally {
      setBusy("");
    }
  };

  const addNote = () => {
    const name = prompt("File name (for example notes.md)") || `note_${Date.now()}.md`;
    putFile(projectId, { path: name, name, type: "text", content: "" });
    refresh();
  };

  const onUpload = async (event) => {
    const selected = Array.from(event.target.files || []);
    for (const file of selected) {
      setBusy(`ingesting ${file.name}…`);
      try {
        const parsed = await extractDocument(file);
        let previewDataUrl = "";
        if (parsed.kind === "pdf" && file.size <= 1_500_000) previewDataUrl = await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || "")); reader.readAsDataURL(file); });
        putFile(projectId, { path: file.name, name: file.name, type: parsed.kind === "text" ? "text" : `${parsed.kind}-text`, content: parsed.text, meta: { source: file.name, parser: parsed.parser, pages: parsed.pages || null, warnings: parsed.warnings || [], previewDataUrl } });
      } catch (error) {
        setFolderError(String(error.message || error));
      }
    }
    setBusy("");
    if (fileInput.current) fileInput.current.value = "";
    refresh();
  };

  const openFolderFile = async (entry) => {
    const isImage = String(entry.type || "").startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/i.test(entry.path);
    const isPdf = entry.type === "application/pdf" || /\.pdf$/i.test(entry.path);
    if (isImage || isPdf) {
      setBusy(`opening ${entry.name}…`);
      try {
        const file = await readFolderFileObject(projectId, entry.path);
        setOpen({ ...entry, source: "attached-folder", content: "", previewUrl: URL.createObjectURL(file), previewKind: isImage ? "image" : "pdf" });
      } catch (error) {
        setFolderError(String(error.message || error));
      } finally {
        setBusy("");
      }
      return;
    }
    if (!isReadableTextPath(entry.path, entry.type)) {
      setOpen({ ...entry, source: "attached-folder", content: "Preview is available for text, source code, CSV, JSON, XML, RIS, images, and PDF. Import supported documents through Upload for extraction." });
      return;
    }
    setBusy(`opening ${entry.name}…`);
    try {
      setOpen({ ...entry, source: "attached-folder", content: await readFolderFile(projectId, entry.path) });
    } catch (error) {
      setFolderError(String(error.message || error));
    } finally {
      setBusy("");
    }
  };

  const importOpen = () => {
    if (!open || open.source !== "attached-folder" || !isReadableTextPath(open.path, open.type)) return;
    const path = `attached/${open.path}`;
    putFile(projectId, { path, name: open.name, type: "text", content: open.content, meta: { source: "attached-folder", originalPath: open.path, importedAt: Date.now() } });
    setBusy(`Imported as ${path}`);
    refresh();
    setTimeout(() => setBusy(""), 1800);
  };

  const askFiles = async () => {
    if (!query.trim()) return;
    setBusy("searching project files…");
    setAnswer(null);
    const internal = retrieve(projectId, query, 6).map((hit) => ({ ...hit, source: "project" }));
    const attached = folderEntries.length ? await searchFolderContents(projectId, folderEntries, query, 6) : [];
    const combined = [...internal, ...attached].sort((a, b) => b.score - a.score).slice(0, 8);
    setHits(combined);
    if (!combined.length) {
      setAnswer({ kind: "extractive", text: "No matching passage was found in the currently loaded project files." });
      setBusy("");
      return;
    }
    const excerpts = combined.map((hit, index) => `[${index + 1}] ${hit.path}\n${hit.snippet}`).join("\n\n");
    if (activeProvider()) {
      setBusy("asking the configured model over cited excerpts…");
      const result = await multiModelAsk(`Question: ${query}\n\nSource excerpts:\n${excerpts}\n\nAnswer only from these excerpts. Cite every factual statement with [n]. If the excerpts do not answer the question, say so.`, { system: "You answer questions over a private project corpus. Do not use outside knowledge or invent citations." });
      setAnswer(result.ok ? { kind: "ai", answers: result.answers } : { kind: "extractive", text: combined.map((hit, index) => `[${index + 1}] ${hit.snippet}`).join("\n\n") });
    } else {
      setAnswer({ kind: "extractive", text: combined.map((hit, index) => `[${index + 1}] ${hit.snippet}`).join("\n\n") });
    }
    setBusy("");
  };

  const download = (path) => {
    const file = getFile(projectId, path);
    if (!file) return;
    const url = URL.createObjectURL(new Blob([file.content], { type: "text/plain" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const saveOpen = (content) => {
    putFile(projectId, { ...open, content });
    setOpen({ ...open, content });
    refresh();
  };

  const translateOpen = async () => {
    if (!open?.content || !activeProvider()) return;
    setBusy(`translating to ${targetLanguage}…`);
    const result = await multiModelAsk(`Translate the following document into ${targetLanguage}. Preserve headings, lists, tables represented in Markdown, citations, numbers, and technical terminology. Return only the translated document.\n\n${String(open.content).slice(0, 120000)}`, { system: "You are a precise multilingual document translator. Do not summarise or add claims." });
    const translated = result.ok ? result.answers.find((item) => item.text)?.text : "";
    if (translated) {
      const path = `translations/${open.path.replace(/\.[^.]+$/, "")}.${targetLanguage.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md`;
      putFile(projectId, { path, name: path.split("/").pop(), type: "translation", content: translated, meta: { sourcePath: open.path, language: targetLanguage, translatedAt: Date.now() } });
      refresh();
      setBusy(`Saved ${path}`);
      setTimeout(() => setBusy(""), 1800);
    } else setBusy("");
  };

  const visibleFolderEntries = useMemo(() => {
    const needle = folderFilter.trim().toLowerCase();
    if (needle) return folderEntries.filter((entry) => entry.path.toLowerCase().includes(needle));
    return folderEntries.filter((entry) => {
      const parents = entry.path.split("/").slice(0, -1);
      return !parents.some((_, index) => collapsed.has(parents.slice(0, index + 1).join("/")));
    });
  }, [folderEntries, folderFilter, collapsed]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden text-xs" role="tablist" aria-label="Project file sources">
          <button role="tab" aria-selected={source === "project"} onClick={() => setSource("project")} className={`px-3 py-1.5 ${source === "project" ? "bg-amber-500/10 text-amber-600" : "text-zinc-500"}`}>Project files ({files.length})</button>
          <button role="tab" aria-selected={source === "folder"} onClick={() => setSource("folder")} className={`px-3 py-1.5 ${source === "folder" ? "bg-amber-500/10 text-amber-600" : "text-zinc-500"}`}>Attached folder ({project?.localFolder?.fileCount || 0})</button>
        </div>
        {busy && <span className="text-[11px] font-mono text-amber-500 flex items-center gap-1"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {busy}</span>}
      </div>

      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Sparkles className="h-4 w-4 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === "Enter" && askFiles()} placeholder="Ask across project files and the loaded attached folder…" aria-label="Ask project files" className="w-full text-xs pl-8 pr-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none focus:border-amber-500" />
          </div>
          <button onClick={askFiles} disabled={!query.trim() || !!busy} className={button}><Search className="h-3.5 w-3.5" /> Ask files</button>
        </div>
        <div className="text-[10px] text-zinc-500">Answers are grounded in cited project excerpts. If no AI provider is configured, Medantir returns the relevant cited passages directly.</div>
      </div>

      {(hits || answer) && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.03] p-3 space-y-2">
          {answer?.kind === "ai" ? answer.answers.map((item) => <div key={item.providerId}><div className="text-[10px] font-mono font-bold text-amber-600">{item.label}</div><div className="text-xs whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{item.text || item.error}</div></div>) : answer?.text && <div className="text-xs whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{answer.text}</div>}
          {!!hits?.length && <div className="pt-2 border-t border-amber-500/10 space-y-1">{hits.map((hit, index) => <button key={`${hit.source}:${hit.path}`} onClick={() => hit.source === "project" ? setOpen({ ...getFile(projectId, hit.path), source: "project" }) : openFolderFile(folderEntries.find((entry) => entry.path === hit.path) || hit)} className="block w-full text-left text-[11px] hover:text-amber-600"><span className="font-mono text-zinc-400">[{index + 1}]</span> <span className="font-medium">{hit.path}</span> <span className="text-zinc-400">· {hit.source === "project" ? "project" : "attached folder"}</span></button>)}</div>}
        </div>
      )}

      {source === "project" ? (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => fileInput.current?.click()} className={button}><Upload className="h-3.5 w-3.5" /> Upload</button>
            <input ref={fileInput} type="file" multiple onChange={onUpload} className="hidden" aria-label="Upload project files" />
            <button onClick={addNote} className={button}><FilePlus className="h-3.5 w-3.5" /> New file</button>
          </div>
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[var(--color-bg-surface)] divide-y divide-zinc-100 dark:divide-zinc-800">
            {files.length === 0 ? <div className="p-6 text-center text-[11px] text-zinc-400">No project-owned files yet. Upload, create, or explicitly import from the attached folder.</div> : files.map((file) => (
              <div key={file.path} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                <button onClick={() => { setOpen({ ...getFile(projectId, file.path), source: "project" }); setFileMode("read"); }} className="flex items-center gap-2 min-w-0 hover:text-amber-500"><FileText className="h-3.5 w-3.5 shrink-0 text-zinc-400" /><span className="truncate">{file.path}</span><span className="text-zinc-400 shrink-0">{(file.size / 1024).toFixed(1)}kb</span></button>
                <button onClick={() => download(file.path)} className="text-zinc-400 hover:text-amber-500 shrink-0" title="Download"><Download className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="space-y-3">
          {!project?.localFolder ? <div className="rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 p-6 text-center text-sm text-zinc-500">No local folder is attached. Attach one from the project Overview.</div> : (
            <>
              <div className="flex items-center gap-2 flex-wrap"><button onClick={loadFolder} disabled={!!busy} className={button}>{folderEntries.length ? <RefreshCw className="h-3.5 w-3.5" /> : <FolderOpen className="h-3.5 w-3.5" />} {folderEntries.length ? "Refresh tree" : "Load folder tree"}</button><span className="text-[11px] text-zinc-500">{project.localFolder.name} · read on demand</span></div>
              {folderEntries.length > 0 && <div className="relative"><Search className="h-3.5 w-3.5 text-zinc-400 absolute left-2.5 top-1/2 -translate-y-1/2" /><input value={folderFilter} onChange={(event) => setFolderFilter(event.target.value)} placeholder="Filter paths…" className="w-full text-xs pl-8 pr-3 py-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none" /></div>}
              {folderError && <div className="text-[11px] text-amber-600">{folderError}</div>}
              {folderEntries.length > 0 && <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 max-h-[42vh] overflow-auto py-1" role="tree">{visibleFolderEntries.map((entry) => {
                const depth = entry.path.split("/").length - 1;
                const isDirectory = entry.kind === "directory";
                const isCollapsed = collapsed.has(entry.path);
                const activate = () => {
                  if (!isDirectory) { openFolderFile(entry); return; }
                  setCollapsed((current) => {
                    const next = new Set(current);
                    if (next.has(entry.path)) next.delete(entry.path);
                    else next.add(entry.path);
                    return next;
                  });
                };
                return <button key={entry.path} role="treeitem" aria-expanded={isDirectory ? !isCollapsed : undefined} onClick={activate} className="w-full flex items-center gap-1.5 py-1 pr-3 text-left text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800/60" style={{ paddingLeft: `${12 + depth * 16}px` }}>{isDirectory ? (isCollapsed ? <ChevronRight className="h-3.5 w-3.5 text-zinc-400" /> : <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />) : <span className="w-3.5" />}{isDirectory ? <Folder className="h-3.5 w-3.5 text-amber-500" /> : <FileText className="h-3.5 w-3.5 text-zinc-400" />}<span className="truncate">{entry.name}</span>{entry.kind === "file" && Number.isFinite(entry.size) && <span className="ml-auto text-[9px] font-mono text-zinc-400">{entry.size < 1024 ? `${entry.size}b` : `${(entry.size / 1024).toFixed(1)}kb`}</span>}</button>;
              })}</div>}
            </>
          )}
        </div>
      )}

      {open && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[var(--color-bg-surface)] p-3 space-y-2">
          <div className="flex items-center justify-between gap-2"><div><div className="text-xs font-mono font-bold">{open.path}</div><div className="text-[9px] font-mono text-zinc-400">{open.source === "attached-folder" ? "Attached folder · local preview only" : `Project-owned file${open.meta?.parser ? ` · ${open.meta.parser}` : ""}`}</div></div><div className="flex items-center gap-2">{open.source === "project" && <div className="flex rounded-md border border-zinc-200 dark:border-zinc-700 overflow-hidden"><button onClick={() => setFileMode("read")} className={`flex items-center gap-1 px-2 py-1 text-[10px] ${fileMode === "read" ? "bg-amber-500/10 text-amber-600" : "text-zinc-500"}`}><Eye className="h-3 w-3" /> Read</button><button onClick={() => setFileMode("edit")} className={`flex items-center gap-1 px-2 py-1 text-[10px] ${fileMode === "edit" ? "bg-amber-500/10 text-amber-600" : "text-zinc-500"}`}><Pencil className="h-3 w-3" /> Edit</button></div>}{open.source === "attached-folder" && isReadableTextPath(open.path, open.type) && <button onClick={importOpen} className={button}><Import className="h-3.5 w-3.5" /> Import copy</button>}<button onClick={() => setOpen(null)} className="text-zinc-400 hover:text-zinc-600 text-xs">close</button></div></div>
          {open.source === "project" && <div className="flex items-center gap-1.5"><Languages className="h-3.5 w-3.5 text-zinc-400" /><input value={targetLanguage} onChange={(event) => setTargetLanguage(event.target.value)} aria-label="Translation language" className="text-[10px] px-2 py-1 rounded border border-zinc-200 dark:border-zinc-700 bg-transparent" /><button onClick={translateOpen} disabled={!activeProvider() || !!busy} className={button}>Translate copy</button><span className="text-[9px] text-zinc-400">Unicode/multilingual editing is native; translation creates a separate project artifact.</span></div>}
          {open.source === "project" ? (fileMode === "edit" ? <textarea value={open.content || ""} onChange={(event) => saveOpen(event.target.value)} rows={16} dir="auto" spellCheck aria-label={`Contents of ${open.path}`} className="w-full text-xs font-mono px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none focus:border-amber-500 resize-y" /> : open.meta?.previewDataUrl ? <iframe title={`Native PDF reader for ${open.name}`} src={open.meta.previewDataUrl} className="w-full h-[70vh] rounded border" style={{ borderColor: "var(--color-border-subtle)" }} /> : <article dir="auto" className="composer-markdown max-h-[64vh] overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800 p-4" dangerouslySetInnerHTML={{ __html: markdown.render(String(open.content || "")) }} />) : open.previewKind === "image" ? <img src={open.previewUrl} alt={open.name} className="max-h-[60vh] max-w-full mx-auto object-contain" /> : open.previewKind === "pdf" ? <iframe title={`Preview ${open.name}`} src={open.previewUrl} className="w-full h-[60vh] rounded border" style={{ borderColor: "var(--color-border-subtle)" }} /> : <pre dir="auto" className="max-h-[48vh] overflow-auto whitespace-pre-wrap text-xs font-mono px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">{String(open.content || "").slice(0, 200000)}</pre>}
        </div>
      )}
    </div>
  );
}
