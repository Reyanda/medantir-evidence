import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { runAgent, toolFilterForProject } from "../engine/agent.js";
import { activeToolProvider } from "../engine/providers.js";
import { getProject } from "../engine/projectstore.js";
import { appendProjectTranscript, getProjectTranscript } from "../engine/agentTranscript.js";
import { createReview, saveReview, loadReview } from "../engine/reviewengine.js";
import TracePanel from "./TracePanel.jsx";
import { stageProgress, stageDetails, reviewSummary } from "../engine/srOrchestrator.js";

// The permanent bottom dock: where the operator states the question and where
// they talk to the platform. Both halves write into the same review the canvas
// and the pipeline read, so nothing said here is decorative.

const FRAMEWORKS = {
  PICO: [
    ["population", "Population", "adults hospitalised with COVID-19"],
    ["intervention", "Intervention", "JAK inhibitor"],
    ["comparator", "Comparator", "standard care or placebo"],
    ["outcome", "Outcome", "28-day all-cause mortality"],
  ],
  PECO: [
    ["population", "Population", "children under five"],
    ["exposure", "Exposure", "household air pollution"],
    ["comparator", "Comparator", "clean fuel households"],
    ["outcome", "Outcome", "acute lower respiratory infection"],
  ],
  PICOTS: [
    ["population", "Population", ""],
    ["intervention", "Intervention", ""],
    ["comparator", "Comparator", ""],
    ["outcome", "Outcome", ""],
    ["timing", "Timing", "within 28 days"],
    ["setting", "Setting", "tertiary hospitals, LMICs"],
  ],
  SPIDER: [
    ["sample", "Sample", ""],
    ["phenomenon", "Phenomenon of interest", ""],
    ["design", "Design", "semi-structured interviews"],
    ["evaluation", "Evaluation", ""],
    ["research", "Research type", "qualitative"],
  ],
};

const DESIGNS = ["randomised trials", "non-randomised studies", "cohort studies", "case-control studies", "diagnostic accuracy studies", "qualitative studies", "any design"];

// Assembling the sentence in one place keeps the stated question and the stored
// PICO from disagreeing with each other.
export function composeQuestion(framework, fields, design) {
  const f = (k) => String(fields[k] || "").trim();
  const designClause = design && design !== "any design" ? `, in ${design}` : "";
  if (framework === "SPIDER") {
    const parts = [f("sample"), f("phenomenon")].filter(Boolean);
    if (!parts.length) return "";
    return `How do ${parts[0] || "participants"} experience ${f("phenomenon")}${f("evaluation") ? `, and how does that shape ${f("evaluation")}` : ""}?`;
  }
  const exposure = f("intervention") || f("exposure");
  if (!f("population") || !exposure) return "";
  const comparator = f("comparator") ? ` compared with ${f("comparator")}` : "";
  const outcome = f("outcome") ? ` affect ${f("outcome")}` : " affect the outcomes of interest";
  const timing = f("timing") ? ` ${f("timing")}` : "";
  const setting = f("setting") ? ` in ${f("setting")}` : "";
  return `In ${f("population")}${setting}, does ${exposure}${comparator}${outcome}${timing}${designClause}?`;
}

// Slash commands answer from the review itself: no provider, no latency, no
// chance of a model paraphrasing the state incorrectly. Anything that is not a
// command falls through to the agent.
export const SLASH = [
  { name: "/progress", help: "stage-by-stage progress and what is blocking" },
  { name: "/trace", help: "who decided what, and on what grounds" },
  { name: "/records", help: "corpus counts by screening decision" },
  { name: "/question", help: "the review question and its PRISM blocks" },
  { name: "/concordance", help: "agreement between the models in the roster" },
  { name: "/help", help: "this list" },
];

export function runSlash(input, review) {
  const [cmd] = input.trim().split(/\s+/);
  if (!review && cmd !== "/help") return "No review is loaded, so there is nothing to report.";
  switch (cmd) {
    case "/help":
      return SLASH.map((c) => `${c.name.padEnd(14)} ${c.help}`).join("\n");
    case "/progress": {
      const p = stageProgress(review);
      const stages = stageDetails(review);
      const next = stages.find((s) => s.status !== "complete");
      const lines = stages.map((s) => `${s.status === "complete" ? "done   " : s.blocked ? "blocked" : "ready  "} ${s.name}${s.pendingCount ? ` (${s.pendingCount} pending)` : ""}`);
      return [
        `${p.done}/${p.total} stages complete (${p.pct}%).`,
        next ? `Next: ${next.name}${next.blocked ? ` — blocked: ${next.blockReason}` : ""}` : "Every stage is complete.",
        "",
        ...lines,
      ].join("\n");
    }
    case "/records": {
      const s = reviewSummary(review);
      const recs = review.objects?.records || [];
      const by = recs.reduce((acc, r) => { const k = r.tiab || "pending"; acc[k] = (acc[k] || 0) + 1; return acc; }, {});
      return [
        `${s.records} records, ${s.included} screened in, ${s.extracted} extracted.`,
        Object.entries(by).map(([k, n]) => `${k}: ${n}`).join(" · ") || "no decisions yet",
      ].join("\n");
    }
    case "/question": {
      const concepts = review.protocol?.concepts || [];
      return [
        review.question || "No question recorded.",
        concepts.length
          ? concepts.map((c) => `${c.op} ${c.label}: ${(c.terms || []).join(" OR ")}`).join("\n")
          : "No search blocks compiled yet — build them in the Question tab.",
      ].join("\n\n");
    }
    case "/trace": {
      const recs = (review.objects?.records || []).filter((r) => r.tiab);
      if (!recs.length) return "Nothing has been decided yet.";
      const byEngine = recs.reduce((acc, r) => {
        const e = r.tiabEngine || (r.tiabBy === "operator" ? "operator" : "unrecorded");
        acc[e] = (acc[e] || 0) + 1; return acc;
      }, {});
      const withReason = recs.filter((r) => r.tiabReason).length;
      return [
        `${recs.length} decisions: ${Object.entries(byEngine).map(([e, n]) => `${e} ${n}`).join(", ")}.`,
        `${withReason} carry a recorded reason. Open the TRACE tab for the per-record grounds.`,
      ].join("\n");
    }
    case "/concordance": {
      const sandboxes = review.objects?.sandboxes || {};
      const ids = Object.keys(sandboxes);
      if (ids.length < 2) return `${ids.length} sandbox(es) recorded. Run two or more models in the Concordance tab to compare them.`;
      return ids.map((id) => {
        const s = sandboxes[id];
        return `${s.runner?.label || id}: ${s.decided} decided, ${s.failed} failed`;
      }).join("\n");
    }
    default:
      return null;
  }
}

export default function CommandDock({ projectId, review, onReviewChange, onNote, onOpenQuestion, height = 200 }) {
  const [tab, setTab] = useState("COMPOSER");
  const [framework, setFramework] = useState("PICO");
  const [fields, setFields] = useState({});
  const [design, setDesign] = useState("randomised trials");
  const [prompt, setPrompt] = useState("");
  const [thread, setThread] = useState([]);
  const [busy, setBusy] = useState(false);
  const promptRef = useRef(null);
  const threadRef = useRef(null);

  const provider = activeToolProvider();
  const question = useMemo(() => composeQuestion(framework, fields, design), [framework, fields, design]);

  // Seed the builder from the review's own PICO so the two never diverge.
  useEffect(() => {
    const pico = review?.protocol?.pico;
    if (!pico) return;
    setFields((f) => ({
      population: f.population || pico.population || "",
      intervention: f.intervention || pico.intervention || "",
      comparator: f.comparator || pico.comparator || "",
      outcome: f.outcome || (pico.outcomes || [])[0] || "",
    }));
  }, [review?.protocol?.pico]);

  useEffect(() => {
    if (!projectId) { setThread([]); return; }
    setThread(getProjectTranscript(projectId).slice(-60));
  }, [projectId]);

  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [thread, busy]);

  // "/" focuses the composer from anywhere that is not already a text field.
  useEffect(() => {
    const onKey = (e) => {
      const el = e.target;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key === "/") { e.preventDefault(); setTab("COMPOSER"); promptRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const applyQuestion = useCallback(() => {
    if (!projectId || !question) return;
    const current = loadReview(projectId) || createReview(question);
    const pico = {
      population: fields.population || null,
      intervention: fields.intervention || fields.exposure || null,
      comparator: fields.comparator || null,
      outcomes: fields.outcome ? [fields.outcome] : (current.protocol?.pico?.outcomes || []),
      ...(fields.timing ? { timing: fields.timing } : {}),
      ...(fields.setting ? { setting: fields.setting } : {}),
      studyDesign: design,
      framework,
    };
    const next = {
      ...current,
      question,
      createdAt: current.createdAt || Date.now(),
      protocol: { ...current.protocol, pico, picoSource: "question builder" },
    };
    saveReview(projectId, next);
    onReviewChange?.(next);
    onNote?.(`Question applied to the review, PICO stored from the ${framework} builder.`, "ok");
  }, [projectId, question, fields, design, framework, onReviewChange, onNote]);

  const send = async () => {
    const text = prompt.trim();
    if (!text || busy) return;

    // A command is answered from the review, not by a model.
    if (text.startsWith("/")) {
      const answer = runSlash(text, review);
      if (answer !== null) {
        setPrompt("");
        setThread((t) => [
          ...t,
          { role: "user", content: text, at: Date.now() },
          { role: "assistant", content: answer, provider: "workbench", at: Date.now() },
        ]);
        return;
      }
    }
    if (!provider) { onNote?.("No tool-capable provider is enabled — open Settings and enable one.", "warn"); return; }
    setPrompt("");
    const userEntry = { role: "user", content: text, at: Date.now() };
    setThread((t) => [...t, userEntry]);
    if (projectId) appendProjectTranscript(projectId, userEntry);
    setBusy(true);

    const history = thread.filter((m) => m.role === "user" || m.role === "assistant").slice(-12).map((m) => ({ role: m.role, content: m.content }));
    const result = await runAgent(text, {
      history,
      toolFilter: toolFilterForProject(projectId ? getProject(projectId) : null),
      onStep: (step) => setThread((t) => [...t, { role: "tool", tool: step.tool, at: Date.now() }]),
    });
    setBusy(false);

    const entry = result.ok
      ? { role: "assistant", content: result.answer || "(no answer)", provider: result.provider, at: Date.now() }
      : { role: "assistant", content: result.reason || "The run failed.", error: true, at: Date.now() };
    setThread((t) => [...t, entry]);
    if (projectId) appendProjectTranscript(projectId, entry);
    // A tool run can rewrite review.json underneath us; re-read rather than
    // leave the canvas showing a stale review.
    if (projectId && result.trace?.length) {
      const fresh = loadReview(projectId);
      if (fresh) onReviewChange?.(fresh);
    }
  };

  const rows = FRAMEWORKS[framework] || FRAMEWORKS.PICO;

  return (
    <div className="wb-dock" style={{ height }}>
      <div className="wb-tabs">
        {["COMPOSER", "QUESTION", "TRACE"].map((t) => (
          <div key={t} className={`pt ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>{t}</div>
        ))}
        <span className="wb-spacer" />
        <div className="pt" style={{ borderRight: "none", color: "var(--fg-faint)" }}>
          {tab === "COMPOSER"
            ? provider ? `${provider.label} · ${provider.model || provider.defaultModel}` : "no tool-capable provider"
            : `${framework} · ${question ? "question ready" : "incomplete"}`}
        </div>
      </div>

      {tab === "TRACE" ? (
        <TracePanel review={review} />
      ) : tab === "QUESTION" ? (
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
          <div className="wb-qb" style={{ flex: 1 }}>
            <div className="wb-prop">
              <span className="k">Framework</span>
              <select className="wb-select" value={framework} onChange={(e) => setFramework(e.target.value)}>
                {Object.keys(FRAMEWORKS).map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="wb-prop">
              <span className="k">Design</span>
              <select className="wb-select" value={design} onChange={(e) => setDesign(e.target.value)}>
                {DESIGNS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            {rows.map(([key, label, hint]) => (
              <div className="wb-prop" key={key}>
                <span className="k">{label}</span>
                <input
                  className="wb-input" value={fields[key] || ""} placeholder={hint}
                  onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value }))}
                />
              </div>
            ))}
          </div>

          <div className="wb-prompt" style={{ alignItems: "center" }}>
            <div style={{ flex: 1, fontSize: 11.5, color: question ? "var(--fg-bright)" : "var(--fg-faint)", userSelect: "text", lineHeight: 1.45 }}>
              {question || "Fill population and intervention to compose the question."}
            </div>
            <button className="wb-btn on" onClick={applyQuestion} disabled={!question || !projectId}>Apply to review</button>
            <button className="wb-btn" onClick={() => onOpenQuestion?.()}>Open PRISM builder</button>
            <button
              className="wb-btn"
              disabled={!question}
              onClick={() => { setTab("COMPOSER"); setPrompt(`Build a search strategy for this question: ${question}`); promptRef.current?.focus(); }}
            >
              Send to composer
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
          <div className="wb-thread" ref={threadRef}>
            {thread.length === 0 && (
              <div style={{ color: "var(--fg-faint)", lineHeight: 1.7 }}>
                Ask the platform. The composer holds the project&apos;s tools, so it can search, screen,
                read the review and write files — every tool call is listed as it runs.
                <div style={{ marginTop: 6, fontFamily: "var(--mono)", fontSize: 10.5 }}>
                  {SLASH.map((c) => `${c.name} — ${c.help}`).map((line, i) => <div key={i}>{line}</div>)}
                </div>
              </div>
            )}
            {thread.map((m, i) => (
              m.role === "tool" ? (
                <div key={i} className="wb-msg"><span className="tool">tool · {m.tool}</span></div>
              ) : (
                <div key={i} className={`wb-msg ${m.role}`}>
                  <span className="who">{m.role === "user" ? "you" : m.provider || "platform"}</span>
                  <span style={{ color: m.error ? "var(--err)" : undefined }}>{m.content}</span>
                </div>
              )
            ))}
            {busy && <div className="wb-msg"><span className="tool">working…</span></div>}
          </div>

          <div className="wb-prompt">
            <textarea
              ref={promptRef} rows={2} value={prompt} placeholder="Ask, or instruct. Enter sends, Shift-Enter breaks the line."
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            />
            <button className="wb-btn on" onClick={send} disabled={busy || !prompt.trim()}>Send</button>
          </div>
        </div>
      )}
    </div>
  );
}
