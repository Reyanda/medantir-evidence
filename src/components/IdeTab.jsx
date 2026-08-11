import React, { useState, useEffect } from "react";
import Editor from "@monaco-editor/react";
import MarkdownIt from "markdown-it";
import { Code2, Eye, FilePlus, Languages, Loader2, Play, FolderGit2, Save, GitBranch, ExternalLink, Cpu, Server, RefreshCw } from "lucide-react";
import { PROJECT_LANGUAGES, listProjects, createProject, listFiles, getFile, putFile, getProject, setActiveProject } from "../engine/projectstore.js";
import { runHarness } from "../engine/harness.js";
import { activeProvider } from "../engine/providers.js";
import { multiModelAsk } from "../engine/ensemble.js";
import { callModule, moduleConnectors, probeModule } from "../engine/modules.js";
import { openProjectPreview } from "../engine/browserBus.js";
import { appendProjectTranscript, pushAgentStep } from "../engine/agentTranscript.js";
import { authorizeWorkspace, listWorkspaceFiles, projectRuntimeAvailable, readWorkspaceFile, workspaceInfo, writeWorkspaceFile } from "../engine/projectRuntime.js";
import { EmptyState } from "./Skeleton.jsx";
import PromptAttachments from "./PromptAttachments.jsx";
import { attachmentTranscriptMetadata } from "../engine/promptAttachments.js";

const LANG = { js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript", py: "python", json: "json", md: "markdown", css: "css", html: "html", sh: "shell", r: "r", sql: "sql", yml: "yaml", yaml: "yaml" };
const langOf = (path) => LANG[(path.split(".").pop() || "").toLowerCase()] || "plaintext";
const markdown = new MarkdownIt({ html: false, linkify: true, breaks: true });

export default function IdeTab({ projectId: fixedProjectId = null, embedded = false }) {
  const [projects, setProjects] = useState(listProjects());
  const [active, setActive] = useState(fixedProjectId || projects[0]?.id || null);
  const [files, setFiles] = useState([]);
  const [openPath, setOpenPath] = useState(null);
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [task, setTask] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState(null);
  const [infernoStatus, setInfernoStatus] = useState(null);
  const [editorMode, setEditorMode] = useState("edit");
  const [targetLanguage, setTargetLanguage] = useState("fr");
  const [customLanguage, setCustomLanguage] = useState("");
  const [translationNote, setTranslationNote] = useState("");
  const [workspace, setWorkspace] = useState(null);
  const [fileError, setFileError] = useState("");
  const [attachments, setAttachments] = useState([]);
  const provider = activeProvider();
  const project = active ? getProject(active) : null;
  const inferno = moduleConnectors().find((m) => m.id === "inferno-code");

  useEffect(() => { if (fixedProjectId) setActive(fixedProjectId); }, [fixedProjectId]);
  const refreshFiles = async () => {
    if (!active) return;
    setFileError("");
    if (projectRuntimeAvailable()) {
      try {
        const root = await workspaceInfo(active);
        setWorkspace(root);
        if (root?.authorized) {
          const listing = await listWorkspaceFiles(active);
          setFiles((listing?.entries || []).filter((entry) => entry.kind === "file"));
          return;
        }
      } catch (cause) {
        setFileError(String(cause.message || cause));
      }
    }
    setWorkspace(null);
    setFiles(listFiles(active));
  };

  useEffect(() => { if (active) { setActiveProject(active); refreshFiles(); } }, [active, projects]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!active || !openPath) return;
    if (workspace?.authorized) {
      readWorkspaceFile(active, openPath).then((file) => { setContent(file.content || ""); setDirty(false); }).catch((cause) => setFileError(String(cause.message || cause)));
    } else {
      const file = getFile(active, openPath);
      setContent(file?.content || ""); setDirty(false);
    }
  }, [active, openPath, workspace]);
  useEffect(() => {
    const listener = (event) => { if (event.detail?.projectId === active) refreshFiles(); };
    window.addEventListener("medantir:workspace-changed", listener);
    return () => window.removeEventListener("medantir:workspace-changed", listener);
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  // Auto-test the Inferno module so the IDE knows whether to route through it.
  useEffect(() => { probeModule("inferno-code").then(setInfernoStatus).catch(() => setInfernoStatus({ ok: false })); }, []);

  const newProject = () => { const p = createProject(prompt("Project name?") || "Code project"); setProjects(listProjects()); setActive(p.id); };
  const newFile = async () => { const name = prompt("File path (e.g. src/main.py)"); if (!name) return; const clean = name.replace(/^\/+/, ""); if (workspace?.authorized) await writeWorkspaceFile(active, clean, ""); else putFile(active, { path: clean, name: clean.split("/").pop(), type: "code", content: "" }); await refreshFiles(); setOpenPath(clean); };
  const save = async () => { if (!active || !openPath) return; if (workspace?.authorized) await writeWorkspaceFile(active, openPath, content); else putFile(active, { path: openPath, name: openPath.split("/").pop(), type: "code", content }); setDirty(false); await refreshFiles(); };

  const translate = async () => {
    if (!active || !openPath || !content.trim() || !provider) return;
    const language = targetLanguage === "custom" ? customLanguage.trim() : (PROJECT_LANGUAGES.find((item) => item.id === targetLanguage)?.name || targetLanguage);
    if (!language) { setTranslationNote("Enter a target language."); return; }
    setBusy(true); setTranslationNote(`Translating to ${language}…`);
    const result = await multiModelAsk(`Translate the following file into ${language}. Preserve Markdown, code fences, headings, tables, citations, numbers, and proper names. Return only the translated file content.\n\n${content.slice(0, 24000)}`, { system: "You are a precise multilingual editor. Never add facts or commentary." });
    const translated = result.ok ? result.answers.find((item) => item.text)?.text : "";
    if (!translated) {
      setTranslationNote(result.reason || "Translation failed."); setBusy(false); return;
    }
    const languagePath = (targetLanguage === "custom" ? customLanguage : targetLanguage).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "") || "translated";
    const path = `translations/${languagePath}/${openPath}`;
    if (workspace?.authorized) await writeWorkspaceFile(active, path, translated);
    else putFile(active, { path, name: openPath.split("/").pop(), type: "translation", content: translated, meta: { sourcePath: openPath, language, translatedAt: Date.now() } });
    appendProjectTranscript(active, { role: "assistant", content: `Created translated copy: ${path}`, provider: result.answers.find((item) => item.text)?.label || null });
    await refreshFiles(); setTranslationNote(`Saved ${path}`); setBusy(false);
  };

  const ask = async () => {
    setBusy(true); setAnswer(null);
    const sentAttachments = attachments;
    const transcriptAttachments = attachmentTranscriptMetadata(sentAttachments);
    const ctx = openPath ? `\n\nCurrent file \`${openPath}\`:\n\`\`\`\n${content.slice(0, 6000)}\n\`\`\`` : "";
    const language = PROJECT_LANGUAGES.find((item) => item.id === project?.workingLanguage)?.name || "Automatic / multilingual";
    const promptText = `${task}\n\nProject working language: ${language}. Preserve the source language unless the user requests translation.${ctx}`;
    appendProjectTranscript(active, { role: "user", content: task, attachments: transcriptAttachments });
    setAttachments([]);
    let r;

    // Route through Inferno if the module is reachable — it decomposes tasks,
    // runs multi-step execution, and returns structured results.
    if (infernoStatus?.ok && sentAttachments.length === 0) {
      const infernoResult = await callModule("inferno-code", "/execute", {
        method: "POST",
        body: {
          task: promptText,
          files: openPath ? [{ path: openPath, content, language: langOf(openPath) }] : [],
          projectId: active || undefined,
        },
      });
      if (infernoResult.ok) {
        setBusy(false);
        setAnswer({ ok: true, answer: infernoResult.data?.output || infernoResult.data?.result || JSON.stringify(infernoResult.data, null, 2), harness: { id: "inferno", name: "Inferno" }, provider: "inferno-code" });
        appendProjectTranscript(active, { role: "assistant", content: infernoResult.data?.output || infernoResult.data?.result || JSON.stringify(infernoResult.data, null, 2), provider: "inferno-code" });
        return;
      }
      // Inferno failed — fall through to AI harness.
    }

    // Fallback: AI provider coding harness.
    r = await runHarness("coding", promptText, { attachments: sentAttachments, maxSteps: 8, onStep: (step) => pushAgentStep(step, active) });
    appendProjectTranscript(active, { role: "assistant", content: r.ok ? (r.answer || r.reason) : `Error: ${r.reason}`, provider: r.provider || null });
    setAnswer(r); setBusy(false);
  };

  const btn = "flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800";

  return (
    <div className="space-y-4">
      {!embedded && <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><Code2 className="h-6 w-6 text-[var(--color-brand-primary)]" /> IDE
          <span className="text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded bg-[var(--color-brand-primary)]/10 text-[var(--color-brand-primary)] border border-[var(--color-brand-primary)]/30">coding harness</span>
        </h1>
      </div>}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* file tree */}
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] p-3 space-y-2">
          {!fixedProjectId && <div className="flex items-center gap-2">
            <select value={active || ""} onChange={(e) => setActive(e.target.value)} aria-label="Project" className="flex-1 text-xs px-2 py-1 rounded bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none">
              {projects.length === 0 && <option value="">no projects</option>}
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <button onClick={newProject} title="New project" className="text-[var(--color-brand-primary)]"><FolderGit2 className="h-4 w-4" /></button>
          </div>}
          <button onClick={newFile} disabled={!active} className={`${btn} w-full justify-center`}><FilePlus className="h-3.5 w-3.5" /> New file</button>
          {projectRuntimeAvailable() && <div className="rounded border p-2 text-[9px] font-mono" style={{ borderColor: "var(--color-border-subtle)" }}><div className="flex items-center gap-1"><span className={workspace?.authorized ? "text-emerald-500" : "text-amber-500"}>{workspace?.authorized ? "REAL FS" : "LOCAL FS LOCKED"}</span>{workspace?.authorized && <button onClick={refreshFiles} className="ml-auto text-zinc-400" title="Refresh project filesystem"><RefreshCw className="h-3 w-3" /></button>}</div>{workspace?.root && <div className="truncate mt-1 text-zinc-500" title={workspace.root}>{workspace.root}</div>}{!workspace?.authorized && <button onClick={async () => { try { await authorizeWorkspace(active, project?.name); } catch (cause) { setFileError(String(cause.message || cause)); } }} className="mt-1 rounded border px-1.5 py-1" style={{ borderColor: "var(--color-border-subtle)" }}>Enable project filesystem</button>}</div>}
          {fileError && <div role="alert" className="text-[9px] text-rose-500">{fileError}</div>}

          {/* GitHub repo link */}
          {project?.githubRepo && (
            <div className="rounded border border-zinc-200 dark:border-zinc-800 p-2 text-[10px] space-y-1">
              <div className="font-mono font-bold text-zinc-400 flex items-center gap-1"><GitBranch className="h-3 w-3" /> GitHub</div>
              <a href={project.githubRepo.url} target="_blank" rel="noreferrer" className="text-[var(--color-brand-primary)] hover:underline flex items-center gap-1 truncate">{project.githubRepo.owner}/{project.githubRepo.repo} <ExternalLink className="h-3 w-3" /></a>
              <button onClick={() => navigator.clipboard.writeText(`git clone ${project.githubRepo.url}.git`)} className="text-zinc-500 hover:text-zinc-700 text-[9px]">Copy clone command</button>
            </div>
          )}

          {/* Inferno module status + routing */}
          {inferno && (
            <div className="rounded border border-zinc-200 dark:border-zinc-800 p-2 text-[10px]">
              <div className="font-mono font-bold text-zinc-400 flex items-center gap-1 mb-1"><Cpu className="h-3 w-3" /> Inferno</div>
              <div className={`font-mono ${infernoStatus?.ok ? "text-emerald-500" : infernoStatus ? "text-amber-500" : "text-zinc-400"}`}>
                {infernoStatus ? (infernoStatus.ok ? "active — tasks route here" : "offline — AI fallback") : "probing…"}
              </div>
              <button
                onClick={async () => { setInfernoStatus({ testing: true }); const r = await probeModule("inferno-code"); setInfernoStatus(r); }}
                disabled={infernoStatus?.testing}
                className="text-[9px] mt-1 px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50"
              >
                <Server className="h-2.5 w-2.5 inline mr-0.5" />Re-test
              </button>
            </div>
          )}

          <div className="space-y-0.5 max-h-[40vh] overflow-auto">
            {files.length === 0 && <div className="text-[11px] text-zinc-400 px-1">No files.</div>}
            {files.map((f) => (
              <button key={f.path} onClick={() => setOpenPath(f.path)} className={`block w-full text-left text-[11px] font-mono px-2 py-1 rounded truncate ${openPath === f.path ? "bg-[var(--color-brand-primary)]/10 text-[var(--color-brand-primary)]" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/50 text-zinc-500"}`}>{f.path}</button>
            ))}
          </div>
        </div>

        {/* editor + agent */}
        <div className="lg:col-span-3 space-y-3">
          {!active ? <EmptyState icon={FolderGit2} title="No project" hint="Create a project to start editing." />
            : !openPath ? <EmptyState icon={Code2} title="No file open" hint="Create or select a file from the tree." />
            : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-zinc-500">{openPath} <span className="text-zinc-400">· {langOf(openPath)}</span> {dirty && <span className="text-amber-500">●</span>}</span>
                  <div className="flex items-center gap-1.5"><button onClick={() => setEditorMode((mode) => mode === "edit" ? "preview" : "edit")} className={btn}>{editorMode === "edit" ? <Eye className="h-3.5 w-3.5" /> : <Code2 className="h-3.5 w-3.5" />} {editorMode === "edit" ? "Preview" : "Edit"}</button>{langOf(openPath) === "html" && <button onClick={() => openProjectPreview(active, openPath, content)} className={btn}><ExternalLink className="h-3.5 w-3.5" /> Test in Browser</button>}<button onClick={save} disabled={!dirty} className={btn}><Save className="h-3.5 w-3.5" /> Save</button></div>
                </div>
                <div className="rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800">
                  {editorMode === "edit" ? <Editor height="52vh" theme="vs-dark" language={langOf(openPath)} value={content}
                    onChange={(v) => { setContent(v ?? ""); setDirty(true); }}
                    options={{ minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false, automaticLayout: true, wordWrap: "on", unicodeHighlight: { ambiguousCharacters: false } }} /> : <FilePreview path={openPath} content={content} />}
                </div>
                <div className="flex items-center gap-2 flex-wrap"><Languages className="h-3.5 w-3.5 text-zinc-400" /><select value={targetLanguage} onChange={(event) => setTargetLanguage(event.target.value)} aria-label="Translation target language" className="text-[11px] px-2 py-1 rounded border bg-transparent" style={{ borderColor: "var(--color-border-subtle)" }}>{PROJECT_LANGUAGES.filter((item) => item.id !== "auto").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}<option value="custom">Another language…</option></select>{targetLanguage === "custom" && <input value={customLanguage} onChange={(event) => setCustomLanguage(event.target.value)} placeholder="Language name or BCP 47 tag" aria-label="Custom translation language" className="text-[11px] px-2 py-1 rounded border bg-transparent" style={{ borderColor: "var(--color-border-subtle)" }} />}<button onClick={translate} disabled={busy || !provider || !content.trim() || (targetLanguage === "custom" && !customLanguage.trim())} className={btn}>Create translated copy</button>{translationNote && <span className="text-[10px] font-mono text-zinc-500">{translationNote}</span>}</div>
              </>
            )}

          {/* coding harness */}
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] p-3 space-y-2">
            <div className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5"><Code2 className="h-3 w-3" /> Coding harness</div>
            <PromptAttachments attachments={attachments} onChange={setAttachments} projectId={active} disabled={busy} />
            <div className="flex items-center gap-2">
              <textarea value={task} onChange={(e) => setTask(e.target.value)} rows={2} placeholder="Describe the coding task…" aria-label="Ask the coding harness" className="flex-1 resize-none text-xs px-2.5 py-1.5 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none focus:border-[var(--color-brand-primary)]" />
              <button onClick={ask} disabled={busy || (!provider && !infernoStatus?.ok) || (!task.trim() && !attachments.length)} className="flex items-center gap-1.5 bg-[var(--color-brand-primary)] hover:opacity-90 disabled:opacity-60 text-white text-xs font-medium px-3 py-1.5 rounded-lg">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Ask</button>
            </div>
            {!provider && <div className="text-[11px] font-mono text-amber-500">Enable a tool-capable provider to run the coding harness.</div>}
            {answer && <div className="text-xs text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap max-h-64 overflow-auto">{answer.ok ? (answer.answer || answer.reason) : answer.reason}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function FilePreview({ path, content }) {
  const language = langOf(path);
  if (language === "html") return <iframe title={`Preview ${path}`} srcDoc={content} sandbox="allow-scripts allow-forms allow-modals" className="w-full h-[52vh] bg-white" />;
  if (language === "markdown") return <article className="prose prose-sm dark:prose-invert max-w-none h-[52vh] overflow-auto p-5" dangerouslySetInnerHTML={{ __html: markdown.render(content || "") }} />;
  if (language === "json") {
    let rendered = content;
    try { rendered = JSON.stringify(JSON.parse(content), null, 2); } catch { /* show source when invalid */ }
    return <pre className="h-[52vh] overflow-auto p-4 text-xs font-mono whitespace-pre-wrap">{rendered}</pre>;
  }
  return <pre className="h-[52vh] overflow-auto p-4 text-xs font-mono whitespace-pre-wrap">{content}</pre>;
}
