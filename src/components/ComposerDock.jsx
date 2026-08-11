import React, { useState, useRef, useEffect } from "react";
import { Check, Copy, CornerDownRight, FilePlus, Send, Wrench, Loader2, Terminal, GitBranch, Minimize2, Maximize2, Expand, Shrink, Code2, PenLine, MessageSquare, RotateCcw } from "lucide-react";
import MarkdownIt from "markdown-it";
import { runAgent, toolFilterForProject } from "../engine/agent.js";
import { getAIMode } from "../engine/providers.js";
import { onAskComposer } from "../engine/composerBus.js";
import { activeProject, getProject, onActiveProject, putFile, retrieve } from "../engine/projectstore.js";
import { proposeOrchestration } from "../engine/orchestration.js";
import { appendProjectTranscript, getProjectTranscript, pushAgentStep } from "../engine/agentTranscript.js";
import { selectRightPaneTab } from "../engine/browserBus.js";
import PromptAttachments from "./PromptAttachments.jsx";
import { attachmentTranscriptMetadata } from "../engine/promptAttachments.js";

// Bottom dock: the agentic Composer (answers real questions and TOOL-CALLS the
// platform's live engines) + the Schema engine (the ontology's typed shape). This
// is the operator's command line into the whole system.

const EmbeddedIde = React.lazy(() => import("./IdeTab.jsx"));
const transcriptMarkdown = new MarkdownIt({ html: false, linkify: false, breaks: true, typographer: true });

export function MarkdownMessage({ content }) {
  return <div className="composer-markdown" dangerouslySetInnerHTML={{ __html: transcriptMarkdown.render(content || "") }} />;
}

export function transcriptToThread(entries = []) {
  const thread = [];
  let pendingTools = [];
  for (const entry of entries.slice(-240)) {
    if (entry.role === "tool") {
      pendingTools.push({ tool: entry.tool || "tool", args: {} });
      continue;
    }
    if (entry.role !== "user" && entry.role !== "assistant") continue;
    thread.push({
      ...(entry.id ? { id: entry.id } : {}),
      role: entry.role,
      content: entry.content || "",
      ...(entry.attachments?.length ? { attachments: entry.attachments } : {}),
      provider: entry.provider || null,
      trace: entry.role === "assistant" && pendingTools.length ? pendingTools : undefined,
    });
    pendingTools = [];
  }
  return thread.slice(-80);
}

function ToolTrace({ trace }) {
  if (!trace?.length) return null;
  return (
    <details className="composer-trace">
      <summary><Wrench className="h-3 w-3" /> {trace.length} tool {trace.length === 1 ? "call" : "calls"}</summary>
      <div className="composer-trace__steps">
        {trace.map((step, index) => {
          const argumentNames = Object.keys(step.args || {});
          return (
            <div key={`${step.tool}:${index}`} className="composer-trace__step">
              <span>{step.tool}</span>
              {argumentNames.length > 0 && <small>{argumentNames.join(" · ")}</small>}
            </div>
          );
        })}
      </div>
    </details>
  );
}

function ComposerPanel({ intent = "chat", fixedProjectId, externalRequest }) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [thread, setThread] = useState(() => transcriptToThread(getProjectTranscript(fixedProjectId || activeProject()))); // {role, content, trace?}
  const [live, setLive] = useState([]); // live tool steps for the in-flight turn
  const [planNote, setPlanNote] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [copied, setCopied] = useState("");
  const [artifactNote, setArtifactNote] = useState("");
  const scroller = useRef(null);
  const handledExternalRequest = useRef(null);
  const projectId = fixedProjectId || activeProject();
  const project = projectId ? getProject(projectId) : null;

  useEffect(() => {
    setThread(transcriptToThread(getProjectTranscript(projectId)));
  }, [projectId]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [thread, live]);

  const send = async (override) => {
    const q = (typeof override === "string" ? override : input).trim() || (attachments.length ? "Analyse the attached material." : "");
    if (!q || busy) return;
    const sentAttachments = attachments;
    const transcriptAttachments = attachmentTranscriptMetadata(sentAttachments);
    setInput("");
    setAttachments([]);
    setBusy(true);
    setLive([]);
    const history = thread.flatMap((m) => (m.role === "user" ? [{ role: "user", content: m.content }] : m.role === "assistant" ? [{ role: "assistant", content: m.content }] : []));
    setThread((t) => [...t, { role: "user", content: q, attachments: transcriptAttachments }]);
    if (projectId) appendProjectTranscript(projectId, { role: "user", content: q, attachments: transcriptAttachments });
    const context = projectId ? retrieve(projectId, q, 3).map((hit) => `[${hit.name}] ${hit.snippet}`).join("\n") : "";
    const intentFrame = intent === "author" ? "AUTHORING MODE: create, revise, or structure publication-quality project artifacts. Preserve provenance and write into the active project when asked.\n\n" : "";
    const framed = project ? `${intentFrame}${q}\n\nACTIVE PROJECT: ${project.name} (${project.mode} mode).${context ? `\nRELEVANT PROJECT CONTEXT:\n${context}` : ""}` : `${intentFrame}${q}`;
    const res = await runAgent(framed, { history, attachments: sentAttachments, toolFilter: toolFilterForProject(project), onStep: (s) => { setLive((l) => [...l, s]); pushAgentStep(s, projectId); } });
    setThread((t) => [
      ...t,
      res.ok
        ? { role: "assistant", content: res.answer, trace: res.trace, provider: res.provider }
        : { role: "assistant", content: `⚠ ${res.reason}`, error: true },
    ]);
    if (projectId) appendProjectTranscript(projectId, { role: "assistant", content: res.ok ? res.answer : `Error: ${res.reason}`, provider: res.provider || null });
    setLive([]);
    setBusy(false);
  };

  const plan = () => {
    const q = input.trim();
    if (!q || !projectId) return;
    const run = proposeOrchestration(projectId, q);
    setPlanNote(`Planned as ${run.harnessId} run in ${project.name}. Review and approve it under Projects → Orchestration.`);
    setInput("");
  };

  const copyText = async (key, content) => {
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      const area = document.createElement("textarea");
      area.value = content; area.style.position = "fixed"; area.style.opacity = "0";
      document.body.appendChild(area); area.select(); document.execCommand("copy"); area.remove();
    }
    setCopied(key);
    window.setTimeout(() => setCopied((current) => current === key ? "" : current), 1600);
  };

  const replay = (message) => {
    if (message.attachments?.length) setPlanNote("The text was replayed. Reattach the original files if the new answer must inspect them again.");
    send(message.content);
  };

  const continueFrom = (message) => {
    setInput(`Continue from this response:\n\n${message.content}`);
    window.setTimeout(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight }), 0);
  };

  const saveArtifact = (message) => {
    if (!projectId || !message?.content) return;
    const heading = String(message.content).match(/^#{1,3}\s+(.+)$/m)?.[1] || "chat-artifact";
    const slug = heading.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 56) || "chat-artifact";
    const path = `artifacts/${new Date().toISOString().replace(/[:.]/g, "-")}-${slug}.md`;
    putFile(projectId, { path, name: path.split("/").pop(), type: "artifact", content: message.content, meta: { source: "composer", provider: message.provider || null, createdAt: Date.now() } });
    setArtifactNote(`Saved ${path}`);
    window.setTimeout(() => setArtifactNote(""), 2500);
  };

  const transcriptText = thread.map((message) => `${message.role === "user" ? "You" : "Actiora"}:\n${message.content}`).join("\n\n");

  useEffect(() => {
    if (!externalRequest || handledExternalRequest.current === externalRequest.id) return;
    handledExternalRequest.current = externalRequest.id;
    setInput(externalRequest.prompt);
    if (!externalRequest.autofill) return;
    const timer = window.setTimeout(() => send(externalRequest.prompt), 0);
    return () => window.clearTimeout(timer);
  }, [externalRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col h-full">
      {thread.length > 0 && <div className="flex justify-end border-b px-2 py-1" style={{ borderColor: "var(--color-border-subtle)" }}><button onClick={() => copyText("thread", transcriptText)} className="composer-turn-action">{copied === "thread" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} Copy chat</button></div>}
      <div ref={scroller} className="composer-transcript flex-1 overflow-y-auto" aria-live="polite">
        {thread.map((m, i) => (
          <section key={i} className={`composer-turn composer-turn--${m.role}${m.error ? " composer-turn--error" : ""}`}>
            <div className="composer-turn__meta">
              <span>{m.role === "user" ? "You" : "Actiora"}</span>
              <div className="flex items-center gap-1.5">
                {m.provider && <span>{m.provider}</span>}
                <button onClick={() => copyText(m.id || `turn-${i}`, m.content)} className="composer-turn-action" aria-label={`Copy ${m.role} message`}>{copied === (m.id || `turn-${i}`) ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} Copy</button>
                {m.role === "user" ? <button onClick={() => replay(m)} disabled={busy} className="composer-turn-action" aria-label="Replay message"><RotateCcw className="h-3 w-3" /> Replay</button> : <><button onClick={() => saveArtifact(m)} disabled={!projectId} className="composer-turn-action" aria-label="Save response as project artifact"><FilePlus className="h-3 w-3" /> Artifact</button><button onClick={() => continueFrom(m)} disabled={busy} className="composer-turn-action" aria-label="Continue from response"><CornerDownRight className="h-3 w-3" /> Continue</button></>}
              </div>
            </div>
            <div className="composer-turn__body">
              {m.role === "assistant" ? <MarkdownMessage content={m.content} /> : <div className="whitespace-pre-wrap break-words">{m.content}</div>}
              {!!m.attachments?.length && <div className="composer-message-attachments">{m.attachments.map((item, index) => <span key={`${item.path || item.name}:${index}`}>{item.kind === "image" ? "Image" : "File"} · {item.path || item.name}</span>)}</div>}
              <ToolTrace trace={m.trace} />
            </div>
          </section>
        ))}
        {busy && (
          <div className="composer-live" role="status">
            {live.map((s, i) => (
              <div key={i}><Wrench className="h-3 w-3" /> <span>{s.tool}</span><small>complete</small></div>
            ))}
            <div><Loader2 className="h-3 w-3 animate-spin" /> Working…</div>
          </div>
        )}
      </div>
      <div className="border-t p-2 space-y-2" style={{ borderColor: "var(--color-border-subtle)" }}>
        <PromptAttachments attachments={attachments} onChange={setAttachments} projectId={projectId} disabled={busy} />
        <div className="flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={intent === "author" ? `Author or revise in this project (${getAIMode()})…` : `Ask the agent (${getAIMode()}) — it can call tools…`}
          aria-label="Ask the agent"
          rows={2}
          className="flex-1 resize-none text-xs px-3 py-2 rounded-lg focus:outline-none" style={{ background: "var(--color-bg-elevated)", borderColor: "var(--color-border-subtle)", borderWidth: "var(--surface-border-width)" }}
        />
        <button onClick={plan} disabled={busy || !projectId || !input.trim()} title={project ? `Create a gated run in ${project.name}` : "Select an active project first"} className="flex items-center gap-1.5 border border-violet-500/40 text-violet-500 disabled:opacity-40 text-xs font-medium px-3 py-2 rounded-lg"><GitBranch className="h-3.5 w-3.5" /> Plan</button>
        <button onClick={send} disabled={busy || (!input.trim() && !attachments.length)} className="flex items-center gap-1.5 bg-[var(--color-brand-primary)] hover:opacity-90 disabled:opacity-60 text-white text-xs font-medium px-3 py-2 rounded-lg">
          <Send className="h-3.5 w-3.5" /> Send
        </button>
        </div>
      </div>
      {planNote && <div className="px-3 pb-2 text-[10px] font-mono text-violet-500">{planNote}</div>}
      {artifactNote && <div role="status" className="px-3 pb-2 text-[10px] font-mono text-emerald-600">{artifactNote}</div>}
    </div>
  );
}

export default function ComposerDock() {
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState(false);
  const [mode, setMode] = useState("chat");
  const [externalRequest, setExternalRequest] = useState(null);
  const [projectId, setProjectId] = useState(activeProject);
  useEffect(() => onActiveProject(setProjectId), []);

  // open the dock to the Composer whenever a surface asks the agent something
  useEffect(() => onAskComposer((prompt, options = {}) => { setMode(options.mode || "chat"); setExternalRequest({ id: `${Date.now()}:${Math.random()}`, prompt, autofill: options.autofill !== false }); setOpen(true); }), []);

  // Escape always exits full screen (and never touches the underlying app).
  useEffect(() => {
    if (!full) return;
    const onKey = (event) => { if (event.key === "Escape") setFull(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [full]);

  const choose = (next) => { setMode(next); setOpen(true); };
  const toggleFull = () => setFull((current) => { const next = !current; if (next) setOpen(true); return next; });
  const toggleOpen = () => setOpen((current) => { if (current) setFull(false); return !current; });
  const tabStyle = (id) => id === mode ? { background: "color-mix(in srgb, var(--color-brand-primary) 12%, transparent)", color: "var(--color-brand-primary)" } : { color: "var(--color-text-secondary)" };

  return (
    <div className={`chrome-surface ${full ? "fixed inset-0 z-40 flex flex-col" : "border-t"}`} style={full ? { borderRadius: 0, boxShadow: "none" } : { borderTopWidth: "var(--surface-border-width)", borderStyle: "solid", borderRadius: 0, boxShadow: "none" }}>
      <div className="flex items-center gap-1 px-3 py-1.5 border-b" style={{ borderColor: "var(--color-border-subtle)" }}>
        <button onClick={() => choose("chat")} className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md" style={tabStyle("chat")}>
          <MessageSquare className="h-3.5 w-3.5" /> Chat
        </button>
        <button onClick={() => choose("author")} className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md" style={tabStyle("author")}>
          <PenLine className="h-3.5 w-3.5" /> Author
        </button>
        <button onClick={() => choose("code")} className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md" style={tabStyle("code")}>
          <Code2 className="h-3.5 w-3.5" /> Code
        </button>
        <button onClick={() => selectRightPaneTab("terminal")} className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md" style={{ color: "var(--color-text-secondary)" }}>
          <Terminal className="h-3.5 w-3.5" /> Terminal
        </button>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={toggleFull} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300" title={full ? "Exit full screen (Esc)" : "Full screen"} aria-label={full ? "Exit full screen" : "Full screen"}>
            {full ? <Shrink className="h-3.5 w-3.5" /> : <Expand className="h-3.5 w-3.5" />}
          </button>
          <button onClick={toggleOpen} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300" title={open ? "Minimize" : "Expand"} aria-label={open ? "Minimize composer" : "Expand composer"}>
            {open ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
      <div className={`${open && mode !== "code" ? (full ? "flex-1 min-h-0" : "h-72") : "hidden"}`}><ComposerPanel intent={mode === "author" ? "author" : "chat"} fixedProjectId={projectId} externalRequest={externalRequest} /></div>
      {open && mode === "code" && <div className={full ? "flex-1 min-h-0" : "h-[min(72vh,760px)]"}><React.Suspense fallback={<div className="p-4 text-xs text-zinc-500">Loading project editor…</div>}><EmbeddedIde embedded projectId={projectId} /></React.Suspense></div>}
    </div>
  );
}
