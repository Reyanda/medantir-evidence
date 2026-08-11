import React, { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, Bot, Briefcase, Calendar, CalendarDays, ChevronRight, Download, Inbox, Loader2, Lock, Mail, RefreshCw, Send, Shield, Sparkles, Trash2 } from "lucide-react";
import usePersistedState from "../hooks/usePersistedState.js";
import { listInbox, getThread, sendEmail, connectGmailToken, disconnectGmail, mailStatus, decodeHeader } from "../engine/officeMail.js";
import { listEvents, upsertEvent, deleteEvent, exportICS, downloadICS, calendarStats } from "../engine/officeCalendar.js";
import { hermesAvailable, officeBrainProvider, officeThink, triageInbox, draftReply, dailyBriefing } from "../engine/officeBrain.js";
import { coingeckoMarketChart } from "../engine/connectors.js";
import { vaultStatus } from "../engine/secureVault.js";
import { listProjects, createProject, addTask, toggleTask, updateProject, STATUSES } from "../engine/projectstore.js";
import { MODULES, callModule } from "../engine/modules.js";

// OfficeTool — the office surface in the right pane.
// Sub-modules: Mail (real Gmail), Calendar (local-first + ICS), Finance
// (live markets), Projects (full-stack PM over projectstore), Security
// (vault + connector health), Brain (Hermes sub-agent).

const MODULES_VIEW = [
  { id: "mail", label: "Mail", Icon: Mail },
  { id: "calendar", label: "Calendar", Icon: Calendar },
  { id: "finance", label: "Finance", Icon: BarChart3 },
  { id: "projects", label: "Projects", Icon: Briefcase },
  { id: "security", label: "Security", Icon: Shield },
  { id: "brain", label: "Brain", Icon: Sparkles },
];

export default function OfficeTool() {
  const [module, setModule] = useState("mail");
  const [status, setStatus] = useState(() => mailStatus());
  useEffect(() => { const t = setInterval(() => setStatus(mailStatus()), 4000); return () => clearInterval(t); }, []);

  return (
    <div className="h-full min-h-0 flex flex-col">
      <div className="px-2 py-1.5 border-b flex items-center gap-1 flex-wrap" style={{ borderColor: "var(--color-border-subtle)" }}>
        {MODULES_VIEW.map(({ id, label, Icon }) => (
          <button key={id} onClick={() => setModule(id)} className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded"
            style={module === id ? { background: "color-mix(in srgb, var(--color-brand-primary) 12%, transparent)", color: "var(--color-brand-primary)" } : { color: "var(--color-text-secondary)" }}>
            <Icon className="h-3 w-3" /> {label}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {module === "mail" && <MailModule status={status} />}
        {module === "calendar" && <CalendarModule />}
        {module === "finance" && <FinanceModule />}
        {module === "projects" && <ProjectsModule />}
        {module === "security" && <SecurityModule />}
        {module === "brain" && <BrainModule />}
      </div>
    </div>
  );
}

function Empty({ text }) {
  return <div className="h-full flex flex-col items-center justify-center gap-1.5 p-4 text-center">
    <span className="text-[10px]" style={{ color: "var(--color-text-secondary)" }}>{text}</span>
  </div>;
}

function Section({ title, children, right }) {
  return <div className="px-2 py-1.5 border-b space-y-1.5" style={{ borderColor: "var(--color-border-subtle)" }}>
    <div className="flex items-center justify-between gap-2"><span className="text-[9px] font-mono font-bold uppercase" style={{ color: "var(--color-text-secondary)" }}>{title}</span>{right}</div>
    {children}
  </div>;
}

// ────────────────────────────── MAIL ──────────────────────────────

function MailModule({ status }) {
  const [token, setToken] = useState("");
  const [messages, setMessages] = useState(null);
  const [thread, setThread] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [compose, setCompose] = useState(null);
  const [triage, setTriage] = useState(null);
  const [sending, setSending] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const result = await listInbox({ max: 20 });
      if (result.ok) { setMessages(result.messages); setThread(null); }
      else setError(result.error || "Could not load inbox.");
    } catch (e) { setError(String(e.message || e)); }
    finally { setBusy(false); }
  }, []);

  const openThread = async (msg) => {
    setBusy(true);
    try { setThread(await getThread(msg.threadId)); } catch (e) { setError(String(e.message || e)); }
    finally { setBusy(false); }
  };

  const runTriage = async () => {
    if (!messages?.length) return;
    setTriage({ state: "working" });
    const result = await triageInbox(messages);
    setTriage(result.ok ? { state: "done", items: result.items, brain: result.brain } : { state: "error", error: result.error });
  };

  const doSend = async () => {
    if (!compose?.to?.trim()) return;
    setSending(true);
    const result = await sendEmail(compose);
    setSending(false);
    if (result.ok) { setCompose(null); refresh(); } else setError(result.error || "Send failed.");
  };

  if (!status.unlocked) return <Empty text="Unlock your vault first (Security module / Vault) — the Gmail token is stored encrypted." />;

  if (thread) return (
    <div className="h-full flex flex-col">
      <div className="px-2 py-1.5 border-b flex items-center gap-1" style={{ borderColor: "var(--color-border-subtle)" }}>
        <button onClick={() => setThread(null)} className="text-[10px] px-1.5 py-0.5 rounded border" style={{ borderColor: "var(--color-border-subtle)" }}>← Inbox</button>
        <span className="text-[10px] font-semibold truncate flex-1">{thread.messages[0]?.subject}</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2">
        {thread.messages.map((m) => (
          <div key={m.id} className="rounded border p-2 space-y-1" style={{ borderColor: "var(--color-border-subtle)" }}>
            <div className="flex items-center justify-between gap-2"><span className="text-[10px] font-semibold truncate">{m.from}</span><span className="text-[9px] font-mono" style={{ color: "var(--color-text-secondary)" }}>{m.date}</span></div>
            <div className="text-[10px] whitespace-pre-wrap break-words" style={{ color: "var(--color-text-secondary)" }}>{m.body || m.snippet}</div>
          </div>
        ))}
        {compose?.replyTo && (
          <div className="rounded border p-2 space-y-1.5" style={{ borderColor: "var(--color-brand-primary)" }}>
            <textarea value={compose.replyTo} onChange={(e) => setCompose({ ...compose, replyTo: e.target.value })} rows={5} placeholder="Write your reply…" className="w-full text-[10px] p-1.5 rounded border outline-none" style={{ background: "var(--color-bg-elevated)", borderColor: "var(--color-border-subtle)" }} />
            <button onClick={() => setCompose(null)} className="text-[10px] px-1.5 py-0.5 rounded border" style={{ borderColor: "var(--color-border-subtle)" }}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  );

  if (compose) return (
    <div className="p-2 space-y-2">
      <input value={compose.to} onChange={(e) => setCompose({ ...compose, to: e.target.value })} placeholder="To (email)" className="w-full text-[10px] p-1.5 rounded border outline-none" style={{ background: "var(--color-bg-elevated)", borderColor: "var(--color-border-subtle)" }} />
      <input value={compose.subject} onChange={(e) => setCompose({ ...compose, subject: e.target.value })} placeholder="Subject" className="w-full text-[10px] p-1.5 rounded border outline-none" style={{ background: "var(--color-bg-elevated)", borderColor: "var(--color-border-subtle)" }} />
      <textarea value={compose.body} onChange={(e) => setCompose({ ...compose, body: e.target.value })} rows={8} placeholder="Message…" className="w-full text-[10px] p-1.5 rounded border outline-none" style={{ background: "var(--color-bg-elevated)", borderColor: "var(--color-border-subtle)" }} />
      <div className="flex items-center gap-1.5">
        <button onClick={doSend} disabled={sending} className="flex items-center gap-1 text-[10px] px-2 py-1 rounded" style={{ background: "var(--color-brand-primary)", color: "#fff" }}>
          {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} Send
        </button>
        <button onClick={() => setCompose(null)} className="text-[10px] px-2 py-1 rounded border" style={{ borderColor: "var(--color-border-subtle)" }}>Cancel</button>
      </div>
    </div>
  );

  return (
    <div className="h-full flex flex-col">
      <Section title="Gmail" right={<span className="text-[9px] font-mono" style={{ color: status.connected ? "#10b981" : "var(--color-text-secondary)" }}>{status.connected ? "connected" : "not connected"}</span>}>
        {status.connected ? (
          <div className="flex items-center gap-1.5">
            <button onClick={refresh} disabled={busy} className="flex items-center gap-1 text-[10px] px-2 py-1 rounded" style={{ background: "var(--color-brand-primary)", color: "#fff" }}>
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Refresh inbox
            </button>
            <button onClick={() => setCompose({ to: "", subject: "", body: "" })} className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border" style={{ borderColor: "var(--color-border-subtle)" }}><Send className="h-3 w-3" /> Compose</button>
            <button onClick={runTriage} className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border" style={{ borderColor: "var(--color-border-subtle)" }}><Sparkles className="h-3 w-3" /> Triage</button>
            <button onClick={() => { disconnectGmail(); setMessages(null); }} className="text-[9px] px-1.5 py-0.5 rounded" style={{ color: "var(--color-text-secondary)" }}>Disconnect</button>
          </div>
        ) : (
          <div className="space-y-1.5">
            <p className="text-[10px]" style={{ color: "var(--color-text-secondary)" }}>Paste a Gmail OAuth access token (scopes: gmail.readonly + gmail.send). Tokens are stored encrypted in your vault.</p>
            <textarea value={token} onChange={(e) => setToken(e.target.value)} rows={2} placeholder="ya29.…" className="w-full text-[10px] p-1.5 rounded border outline-none font-mono" style={{ background: "var(--color-bg-elevated)", borderColor: "var(--color-border-subtle)" }} />
            <button onClick={async () => { setBusy(true); const r = await connectGmailToken(token); setBusy(false); if (r.ok) { setToken(""); refresh(); } else setError(r.error || "Connect failed."); }} disabled={busy} className="flex items-center gap-1 text-[10px] px-2 py-1 rounded" style={{ background: "var(--color-brand-primary)", color: "#fff" }}>
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Lock className="h-3 w-3" />} Connect Gmail
            </button>
          </div>
        )}
        {error && <div className="text-[9px] break-words" style={{ color: "#f87171" }}>{error}</div>}
      </Section>

      {triage?.state === "working" && <div className="px-2 py-2 text-[10px]" style={{ color: "var(--color-text-secondary)" }}>Triage via sub-agent…</div>}
      {triage?.state === "done" && (
        <Section title={`Triage · ${triage.brain?.label || ""}`}>
          {triage.items.map((item, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[10px]">
              <span className="font-mono" style={{ color: "#f59e0b" }}>{item.priority}</span>
              <span className="truncate flex-1">{item.category}</span>
              <span className="truncate text-[9px]" style={{ color: "var(--color-text-secondary)" }}>{item.action}</span>
            </div>
          ))}
        </Section>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-1">
        {!messages && !busy && <Empty text={status.connected ? "Refresh to load your inbox." : "Connect Gmail to manage real email."} />}
        {busy && !messages && <Empty text="Loading inbox…" />}
        {messages?.map((m) => (
          <button key={m.id} onClick={() => openThread(m)} className="w-full text-left rounded border px-2 py-1.5 space-y-0.5" style={{ borderColor: "var(--color-border-subtle)", background: m.unread ? "color-mix(in srgb, var(--color-brand-primary) 6%, transparent)" : "transparent" }}>
            <div className="flex items-center justify-between gap-2"><span className="text-[10px] font-semibold truncate">{m.from}</span><span className="text-[9px] font-mono shrink-0" style={{ color: "var(--color-text-secondary)" }}>{m.date}</span></div>
            <div className="text-[10px] truncate">{m.subject}</div>
            <div className="text-[9px] truncate" style={{ color: "var(--color-text-secondary)" }}>{m.snippet}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ──────────────────────────── CALENDAR ────────────────────────────

function CalendarModule() {
  const [events, setEvents] = useState(() => listEvents());
  const [editing, setEditing] = useState(null);
  const [stats, setStats] = useState(() => calendarStats());
  const refresh = useCallback(() => { setEvents(listEvents()); setStats(calendarStats()); }, []);

  const save = (patch) => {
    const event = upsertEvent({ ...editing, ...patch });
    setEditing(null);
    refresh();
    return event;
  };

  return (
    <div className="h-full flex flex-col">
      <Section title="Calendar" right={<span className="text-[9px] font-mono" style={{ color: "var(--color-text-secondary)" }}>{stats.upcoming} upcoming · {stats.total} total</span>}>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setEditing({ title: "", start: Date.now(), end: Date.now() + 3600_000 })} className="flex items-center gap-1 text-[10px] px-2 py-1 rounded" style={{ background: "var(--color-brand-primary)", color: "#fff" }}><CalendarDays className="h-3 w-3" /> New event</button>
          <button onClick={() => downloadICS(events)} className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border" style={{ borderColor: "var(--color-border-subtle)" }}><Download className="h-3 w-3" /> Export .ics</button>
        </div>
      </Section>

      {editing && (
        <Section title={editing.id ? "Edit event" : "New event"}>
          <input value={editing.title || ""} onChange={(e) => setEditing({ ...editing, title: e.target.value })} placeholder="Title" className="w-full text-[10px] p-1.5 rounded border outline-none" style={{ background: "var(--color-bg-elevated)", borderColor: "var(--color-border-subtle)" }} />
          <div className="grid grid-cols-2 gap-1.5">
            <label className="text-[9px]" style={{ color: "var(--color-text-secondary)" }}>Start<input type="datetime-local" value={toLocalInput(editing.start)} onChange={(e) => setEditing({ ...editing, start: new Date(e.target.value).getTime() })} className="w-full text-[10px] p-1 rounded border outline-none" style={{ background: "var(--color-bg-elevated)", borderColor: "var(--color-border-subtle)" }} /></label>
            <label className="text-[9px]" style={{ color: "var(--color-text-secondary)" }}>End<input type="datetime-local" value={toLocalInput(editing.end)} onChange={(e) => setEditing({ ...editing, end: new Date(e.target.value).getTime() })} className="w-full text-[10px] p-1 rounded border outline-none" style={{ background: "var(--color-bg-elevated)", borderColor: "var(--color-border-subtle)" }} /></label>
          </div>
          <textarea value={editing.notes || ""} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} rows={2} placeholder="Notes (optional)" className="w-full text-[10px] p-1.5 rounded border outline-none" style={{ background: "var(--color-bg-elevated)", borderColor: "var(--color-border-subtle)" }} />
          <div className="flex items-center gap-1.5">
            <button onClick={() => save({})} className="text-[10px] px-2 py-1 rounded" style={{ background: "var(--color-brand-primary)", color: "#fff" }}>Save</button>
            <button onClick={() => setEditing(null)} className="text-[10px] px-2 py-1 rounded border" style={{ borderColor: "var(--color-border-subtle)" }}>Cancel</button>
            {editing.id && <button onClick={() => { deleteEvent(editing.id); setEditing(null); refresh(); }} className="ml-auto flex items-center gap-1 text-[10px] px-2 py-1 rounded" style={{ color: "#f87171" }}><Trash2 className="h-3 w-3" /> Delete</button>}
          </div>
        </Section>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-1">
        {!events.length && <Empty text="No events yet — add one or import an .ics." />}
        {events.map((e) => (
          <button key={e.id} onClick={() => setEditing(e)} className="w-full text-left rounded border px-2 py-1.5" style={{ borderColor: "var(--color-border-subtle)" }}>
            <div className="flex items-center justify-between gap-2"><span className="text-[10px] font-semibold truncate">{e.title}</span><span className="text-[9px] font-mono shrink-0" style={{ color: "var(--color-text-secondary)" }}>{new Date(e.start).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span></div>
            {e.notes && <div className="text-[9px] truncate" style={{ color: "var(--color-text-secondary)" }}>{e.notes}</div>}
          </button>
        ))}
      </div>
    </div>
  );
}

function toLocalInput(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ──────────────────────────── FINANCE ────────────────────────────

function FinanceModule() {
  const [asset, setAsset] = usePersistedState("office", "asset", "bitcoin");
  const [data, setData] = usePersistedState("office", "mkt", null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const chart = await coingeckoMarketChart({ coin: asset, days: 30 });
      setData(chart);
    } catch (e) { setError(String(e.message || e)); }
    finally { setBusy(false); }
  }, [asset]);

  useEffect(() => { if (!data) refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const last = data?.prices?.length ? data.prices[data.prices.length - 1][1] : null;
  const first = data?.prices?.length ? data.prices[0][1] : null;
  const change = last != null && first ? ((last - first) / first) * 100 : null;

  return (
    <div className="h-full flex flex-col">
      <Section title="Markets" right={<button onClick={refresh} className="p-1" style={{ color: "var(--color-text-secondary)" }}>{busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}</button>}>
        <select value={asset} onChange={(e) => { setAsset(e.target.value); setData(null); }} className="text-[10px] px-1.5 py-0.5 rounded border" style={{ background: "var(--color-bg-elevated)", borderColor: "var(--color-border-subtle)" }}>
          {["bitcoin", "ethereum", "solana", "binancecoin"].map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        {last != null && <div className="text-[10px]"><span className="font-mono">${Number(last).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span> {change != null && <span style={{ color: change >= 0 ? "#10b981" : "#f87171" }}>{change >= 0 ? "▲" : "▼"} {change.toFixed(1)}% (30d)</span>}</div>}
        {error && <div className="text-[9px]" style={{ color: "#f87171" }}>{error}</div>}
      </Section>
      <div className="flex-1 min-h-0 p-2">
        {data?.prices?.length ? <Sparkline prices={data.prices} /> : <Empty text="Load a market series to see the 30-day trend." />}
      </div>
    </div>
  );
}

function Sparkline({ prices }) {
  const pts = prices.map(([t, v]) => [new Date(t).getTime(), v]);
  const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs); const maxX = Math.max(...xs);
  const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1; const spanY = maxY - minY || 1;
  const path = pts.map(([x, y], i) => `${i ? "L" : "M"}${40 + ((x - minX) / spanX) * 220},${92 - ((y - minY) / spanY) * 80}`).join(" ");
  const up = ys[ys.length - 1] >= ys[0];
  return (
    <svg viewBox="0 0 280 100" className="w-full h-full" aria-label="30-day price trend">
      <path d={path} fill="none" stroke={up ? "#10b981" : "#f87171"} strokeWidth="1.5" />
    </svg>
  );
}

// ─────────────────────────── PROJECTS ────────────────────────────

const STATUS_COLORS = {
  backlog: "#94a3b8",
  scoping: "#60a5fa",
  active: "#34d399",
  blocked: "#f87171",
  done: "#a78bfa",
};

function ProjectsModule() {
  const [projects, setProjects] = useState(() => listProjects());
  const [name, setName] = useState("");
  const [taskInput, setTaskInput] = useState({});
  const refresh = useCallback(() => setProjects(listProjects()), []);

  const make = () => {
    if (!name.trim()) return;
    createProject(name.trim(), {});
    setName("");
    refresh();
  };

  return (
    <div className="h-full min-h-0 flex flex-col">
      <Section title="Projects" right={<span className="text-[9px] font-mono" style={{ color: "var(--color-text-secondary)" }}>{projects.length} open</span>}>
        <div className="flex items-center gap-1.5">
          <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && make()} placeholder="New project name…" className="flex-1 min-w-0 text-[10px] p-1 rounded border outline-none" style={{ background: "var(--color-bg-elevated)", borderColor: "var(--color-border-subtle)" }} />
          <button onClick={make} className="shrink-0 text-[10px] px-2 py-1 rounded" style={{ background: "var(--color-brand-primary)", color: "#fff" }}>Create</button>
        </div>
      </Section>
      <div className="flex-1 min-h-0 overflow-y-auto p-1 space-y-1">
        {!projects.length && <Empty text="Create a project to manage tasks and status end to end." />}
        {projects.map((p) => {
          const tasks = p.tasks || [];
          const done = tasks.filter((t) => t.done).length;
          const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
          const color = STATUS_COLORS[p.status] || "#94a3b8";
          return (
            <div key={p.id} className="rounded border" style={{ borderColor: "var(--color-border-subtle)" }}>
              <div className="flex items-center justify-between gap-2 px-1.5 pt-1">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: color }} title={p.status} />
                  <span className="text-[10px] font-semibold truncate">{p.name}</span>
                </span>
                <span className="shrink-0 text-[9px] font-mono" style={{ color: "var(--color-text-secondary)" }}>{tasks.length ? `${done}/${tasks.length} done` : "no tasks"}</span>
              </div>
              {tasks.length > 0 && (
                <div className="px-1.5 pt-1">
                  <div className="h-1 rounded-full" style={{ background: "color-mix(in srgb, var(--color-text-secondary) 15%, transparent)" }}>
                    <div className="h-1 rounded-full" style={{ width: `${pct}%`, background: color }} />
                  </div>
                </div>
              )}
              <div className="px-1.5 py-1 space-y-0.5">
                {tasks.map((t) => (
                  <label key={t.id} className="flex items-center gap-1.5 text-[10px]">
                    <input type="checkbox" checked={t.done} onChange={() => { toggleTask(p.id, t.id); refresh(); }} className="h-3 w-3" />
                    <span className="truncate" style={{ textDecoration: t.done ? "line-through" : "none", color: t.done ? "var(--color-text-secondary)" : "inherit" }}>{t.text}</span>
                  </label>
                ))}
              </div>
              <div className="flex items-center gap-1 px-1.5 pb-1.5">
                <input value={taskInput[p.id] || ""} onChange={(e) => setTaskInput({ ...taskInput, [p.id]: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") { addTask(p.id, taskInput[p.id]); setTaskInput({ ...taskInput, [p.id]: "" }); refresh(); } }} placeholder="Add a task…" className="flex-1 min-w-0 text-[9px] p-1 rounded border outline-none" style={{ background: "var(--color-bg-elevated)", borderColor: "var(--color-border-subtle)" }} />
                <select value={p.status} onChange={(e) => { updateProject(p.id, { status: e.target.value }); refresh(); }} title="Status" className="shrink-0 text-[9px] px-1 py-0.5 rounded border" style={{ background: "var(--color-bg-elevated)", borderColor: "var(--color-border-subtle)" }}>
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────── SECURITY ────────────────────────────

function SecurityModule() {
  const [vault, setVault] = useState(() => vaultStatus());
  const [health, setHealth] = useState(null);
  useEffect(() => { setVault(vaultStatus()); }, []);

  const probe = async () => {
    const results = {};
    for (const m of MODULES.filter((x) => x.status === "connector" && x.probe)) {
      const r = await callModule(m.id, xprobePath(m)).catch(() => ({ ok: false, error: "unreachable" }));
      results[m.id] = r;
    }
    setHealth(results);
  };

  return (
    <div className="h-full flex flex-col">
      <Section title="Vault" right={<span className="text-[9px] font-mono" style={{ color: vault.unlocked ? "#10b981" : "var(--color-text-secondary)" }}>{vault.unlocked ? "unlocked" : vault.exists ? "locked" : "not created"}</span>}>
        <div className="text-[10px]" style={{ color: "var(--color-text-secondary)" }}>{vault.count} encrypted secret purpose{vault.count === 1 ? "" : "s"} · encrypted at rest in your browser.</div>
      </Section>
      <Section title="Module health" right={<button onClick={probe} className="p-1" style={{ color: "var(--color-text-secondary)" }}><RefreshCw className="h-3 w-3" /></button>}>
        {!health && <div className="text-[10px]" style={{ color: "var(--color-text-secondary)" }}>Probe the registered connectors (redteam, openscience, shrimp…).</div>}
        {health && <div className="space-y-0.5">
          {Object.entries(health).map(([id, r]) => (
            <div key={id} className="flex items-center gap-1.5 text-[10px]">
              <span className={`h-1.5 w-1.5 rounded-full ${r.ok ? "" : ""}`} style={{ background: r.ok ? "#10b981" : "#f87171" }} />
              <span className="font-mono">{id}</span>
              <span className="text-[9px] truncate flex-1" style={{ color: "var(--color-text-secondary)" }}>{r.ok ? "reachable" : (r.error || "unreachable")}</span>
            </div>
          ))}
        </div>}
      </Section>
      <Section title="Hermes brain">
        <div className="text-[10px]" style={{ color: "var(--color-text-secondary)" }}>Hermes 4.3 is offered through OpenRouter (same key as the AI Providers tab). When no provider key exists, office tasks fall back to the platform orchestrator.</div>
      </Section>
    </div>
  );
}

function xprobePath(m) { return m.probe?.path || "/health"; }

// ──────────────────────────── BRAIN ────────────────────────────

function BrainModule() {
  const [state, setState] = useState({ brain: null, checking: true });
  const [briefing, setBriefing] = useState(null);
  const [prompt, setPrompt] = useState("");
  const [answer, setAnswer] = useState(null);

  useEffect(() => {
    (async () => {
      const available = await hermesAvailable();
      const brain = await officeBrainProvider();
      setState({ brain, available, checking: false });
    })();
  }, []);

  const runBriefing = async () => {
    setBriefing({ state: "working" });
    const projects = listProjects().slice(0, 12);
    const events = listEvents({ from: Date.now() }).slice(0, 8);
    const result = await dailyBriefing({ projects, events });
    setBriefing(result.ok ? { state: "done", content: result.content, brain: result.brain } : { state: "error", error: result.error });
  };

  const ask = async () => {
    if (!prompt.trim()) return;
    setAnswer({ state: "working" });
    const result = await officeThink(prompt);
    setAnswer(result.ok ? { state: "done", content: result.content, brain: result.brain } : { state: "error", error: result.error });
  };

  return (
    <div className="h-full flex flex-col">
      <Section title="Sub-agent brain" right={state.checking ? <Loader2 className="h-3 w-3 animate-spin" /> : <span className="text-[9px] font-mono" style={{ color: state.brain ? "#10b981" : "#f59e0b" }}>{state.brain ? state.brain.label : "none configured"}</span>}>
        <div className="text-[10px]" style={{ color: "var(--color-text-secondary)" }}>
          {state.available ? "Hermes 4.3 is reachable — office tasks will use it for triage, drafting and briefings." : "No Hermes/OpenRouter key yet — office tasks use the current orchestrator. Add a key in System → AI Providers."}
        </div>
      </Section>
      <Section title="Daily briefing">
        <button onClick={runBriefing} className="flex items-center gap-1 text-[10px] px-2 py-1 rounded" style={{ background: "var(--color-brand-primary)", color: "#fff" }}><Sparkles className="h-3 w-3" /> Brief me</button>
        {briefing?.state === "working" && <div className="text-[10px]" style={{ color: "var(--color-text-secondary)" }}>Working…</div>}
        {briefing?.state === "done" && <pre className="text-[10px] whitespace-pre-wrap break-words" style={{ color: "var(--color-text-secondary)" }}>{briefing.content}</pre>}
        {briefing?.state === "error" && <div className="text-[9px]" style={{ color: "#f87171" }}>{briefing.error}</div>}
      </Section>
      <Section title="Ask the office brain">
        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} placeholder="Draft a grant query, summarise a contract clause, plan the week…" className="w-full text-[10px] p-1.5 rounded border outline-none" style={{ background: "var(--color-bg-elevated)", borderColor: "var(--color-border-subtle)" }} />
        <button onClick={ask} className="flex items-center gap-1 text-[10px] px-2 py-1 rounded" style={{ background: "var(--color-brand-primary)", color: "#fff" }}><Bot className="h-3 w-3" /> Ask</button>
        {answer?.state === "working" && <div className="text-[10px]" style={{ color: "var(--color-text-secondary)" }}>Working…</div>}
        {answer?.state === "done" && <div className="text-[10px] whitespace-pre-wrap break-words" style={{ color: "var(--color-text-secondary)" }}>{answer.content}</div>}
        {answer?.state === "error" && <div className="text-[9px]" style={{ color: "#f87171" }}>{answer.error}</div>}
      </Section>
    </div>
  );
}
