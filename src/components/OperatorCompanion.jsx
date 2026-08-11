import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, BellOff, Check, MessageSquare, PanelRight, X } from "lucide-react";
import { askComposer } from "../engine/composerBus.js";
import { getOperatorState, onOperatorState } from "../engine/appOperator.js";
import { completeReminder, listReminders, markReminderNotified, onReminders } from "../engine/reminders.js";
import { getCompanionState, onCompanionState, setCompanionDocked, setCompanionOpen, setCompanionQuiet, toggleCompanionOpen } from "../engine/companionBus.js";
import {
  BLINK_DURATION_MS, SLEEP_AFTER_MS, canOfferTip, isDoubleBlink, moodFor,
  nextBlinkDelay, nextGestureDelay, pickGesture, pickTip, pupilOffset,
} from "../engine/companionLife.js";
import CompanionFace from "./CompanionFace.jsx";

const POSITION_KEY = "medantir.companion.position.v1";
const TIP_MEMORY = 6; // tips remembered before the rotation may repeat
const PET_SIZE = 56; // h-14 w-14 pet button
const EDGE_MARGIN = 8;
const DRAG_THRESHOLD = 6; // px before a press becomes a drag, not a click

function readPosition() {
  try {
    const parsed = JSON.parse(localStorage.getItem(POSITION_KEY) || "null");
    if (Number.isFinite(parsed?.x) && Number.isFinite(parsed?.y)) return parsed;
  } catch { /* corrupted or unavailable storage → default */ }
  return null;
}

function clampPosition(pos) {
  const maxX = Math.max(EDGE_MARGIN, window.innerWidth - PET_SIZE - EDGE_MARGIN);
  const maxY = Math.max(EDGE_MARGIN, window.innerHeight - PET_SIZE - EDGE_MARGIN);
  return { x: Math.min(Math.max(pos.x, EDGE_MARGIN), maxX), y: Math.min(Math.max(pos.y, EDGE_MARGIN), maxY) };
}

function defaultPosition() {
  return clampPosition({ x: window.innerWidth - PET_SIZE - 12, y: window.innerHeight - PET_SIZE - 48 });
}

// Motion is opt-out at the OS level and in the app's own design settings; the
// idle-life timers and pointer tracking both stand down when either says so.
function motionSuppressed() {
  if (typeof window === "undefined") return true;
  if (document.documentElement.dataset.motion === "reduced") return true;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
}

export default function OperatorCompanion() {
  const [prompt, setPrompt] = useState("");
  const [operator, setOperator] = useState(getOperatorState);
  const [reminders, setReminders] = useState(listReminders);
  const [placement, setPlacement] = useState(getCompanionState);
  const [pos, setPos] = useState(() => readPosition() || defaultPosition());
  const [blinking, setBlinking] = useState(false);
  const [gesture, setGesture] = useState("");
  const [asleep, setAsleep] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [tip, setTip] = useState(null);

  const dragRef = useRef(null);
  const ignoreClickRef = useRef(false);
  const faceRef = useRef(null);
  const petRef = useRef(null);
  const lastActivityRef = useRef(Date.now());
  const lastTipRef = useRef(Date.now());
  const seenTipsRef = useRef([]);

  const { docked, open, quiet } = placement;

  useEffect(() => onOperatorState(setOperator), []);
  useEffect(() => onReminders(setReminders), []);
  useEffect(() => onCompanionState(setPlacement), []);
  useEffect(() => {
    const onResize = () => setPos((current) => clampPosition(current));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const check = () => {
      const now = Date.now();
      for (const reminder of listReminders()) {
        if (!reminder.done && !reminder.notified && new Date(reminder.when).getTime() <= now) {
          setCompanionOpen(true);
          if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification("Actiora reminder", { body: reminder.title });
          markReminderNotified(reminder.id);
        }
      }
    };
    check();
    const timer = window.setInterval(check, 30000);
    return () => window.clearInterval(timer);
  }, []);

  // --- idle life ------------------------------------------------------------
  // Any real interaction anywhere in the app counts as activity: the pet should
  // wake because the operator is present, not only because it was touched.
  useEffect(() => {
    const wake = () => {
      lastActivityRef.current = Date.now();
      setAsleep(false);
    };
    const events = ["pointerdown", "keydown", "wheel"];
    for (const name of events) window.addEventListener(name, wake, { passive: true });
    return () => { for (const name of events) window.removeEventListener(name, wake); };
  }, []);

  // Blink loop. Self-rescheduling timeouts rather than one interval, so the
  // rhythm stays irregular and a hidden tab costs nothing.
  useEffect(() => {
    if (motionSuppressed()) return undefined;
    let timer = 0;
    let cancelled = false;
    const blink = () => {
      if (cancelled) return;
      if (document.hidden) { timer = window.setTimeout(blink, 4000); return; }
      setBlinking(true);
      window.setTimeout(() => {
        if (cancelled) return;
        setBlinking(false);
        if (isDoubleBlink()) {
          window.setTimeout(() => {
            if (cancelled) return;
            setBlinking(true);
            window.setTimeout(() => !cancelled && setBlinking(false), BLINK_DURATION_MS);
          }, 130);
        }
      }, BLINK_DURATION_MS);
      timer = window.setTimeout(blink, nextBlinkDelay());
    };
    timer = window.setTimeout(blink, nextBlinkDelay());
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, []);

  // Idle gestures, then sleep. Never while working — a pet dozing through a live
  // task misreports what the app is doing.
  useEffect(() => {
    if (motionSuppressed()) return undefined;
    let timer = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const idleFor = Date.now() - lastActivityRef.current;
      const busy = operator.status === "working";
      if (!document.hidden && !busy) {
        if (idleFor >= SLEEP_AFTER_MS) setAsleep(true);
        else {
          const next = pickGesture();
          setGesture(next);
          window.setTimeout(() => !cancelled && setGesture(""), 1600);
        }
      }
      timer = window.setTimeout(tick, nextGestureDelay());
    };
    timer = window.setTimeout(tick, nextGestureDelay());
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [operator.status]);

  // Pointer tracking writes CSS custom properties straight onto the SVG, so a
  // continuous glance never triggers a React render.
  useEffect(() => {
    if (motionSuppressed()) return undefined;
    let frame = 0;
    let latest = null;
    const apply = () => {
      frame = 0;
      const face = faceRef.current;
      const host = petRef.current;
      if (!face || !host || !latest) return;
      const box = host.getBoundingClientRect();
      const { x, y } = pupilOffset({ pointerX: latest.x, pointerY: latest.y, centreX: box.left + box.width / 2, centreY: box.top + box.height / 2 });
      face.style.setProperty("--pupil-x", `${x.toFixed(2)}px`);
      face.style.setProperty("--pupil-y", `${y.toFixed(2)}px`);
    };
    const onMove = (event) => {
      latest = { x: event.clientX, y: event.clientY };
      if (!frame) frame = window.requestAnimationFrame(apply);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [docked]);

  // Unprompted tips — gated hard by companionLife.canOfferTip.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      if (!canOfferTip({ quiet, open, status: operator.status, asleep, idleForMs: now - lastActivityRef.current, sinceLastTipMs: now - lastTipRef.current })) return;
      const chosen = pickTip(seenTipsRef.current);
      seenTipsRef.current = [...seenTipsRef.current, chosen.id].slice(-TIP_MEMORY);
      lastTipRef.current = now;
      setTip(chosen);
      window.setTimeout(() => setTip((current) => (current?.id === chosen.id ? null : current)), 13000);
    }, 15000);
    return () => window.clearInterval(timer);
  }, [quiet, open, operator.status, asleep]);

  const pending = useMemo(() => reminders.filter((item) => !item.done).sort((a, b) => new Date(a.when) - new Date(b.when)), [reminders]);
  const mood = moodFor({ status: operator.status, dragging, asleep, talking: open });

  const send = () => {
    const value = prompt.trim();
    if (!value) return;
    askComposer(value, { autofill: true });
    setPrompt("");
    setCompanionOpen(false);
  };

  const onPointerDown = (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { startX: event.clientX, startY: event.clientY, originX: pos.x, originY: pos.y, moved: false };
  };
  const onPointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!drag.moved) setDragging(true);
    drag.moved = true;
    setPos(clampPosition({ x: drag.originX + dx, y: drag.originY + dy }));
  };
  const endDrag = (event, cancelled = false) => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    if (!drag) return;
    if (drag.moved && !cancelled) {
      const next = clampPosition({ x: drag.originX + (event.clientX - drag.startX), y: drag.originY + (event.clientY - drag.startY) });
      setPos(next);
      try { localStorage.setItem(POSITION_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
      // Landing is an event worth acknowledging.
      setGesture("hop");
      window.setTimeout(() => setGesture(""), 1100);
    }
    if (drag.moved) ignoreClickRef.current = true;
  };
  const onClick = () => {
    if (ignoreClickRef.current) { ignoreClickRef.current = false; return; }
    setAsleep(false);
    lastActivityRef.current = Date.now();
    toggleCompanionOpen();
  };

  const askTip = useCallback((text) => {
    setTip(null);
    askComposer(text, { autofill: true });
  }, []);

  // Panel opens toward the centre of the screen from wherever the pet sits. When
  // docked it is pinned beside the rail instead.
  const openLeft = docked || pos.x + PET_SIZE / 2 > window.innerWidth / 2;
  const openUp = docked || pos.y + PET_SIZE / 2 > window.innerHeight / 2;

  const panel = open && (
    <section aria-label="Actiora companion" className={`pointer-events-auto ${docked ? "" : "absolute"} ${docked ? "" : openLeft ? "right-0" : "left-0"} ${docked ? "" : openUp ? "bottom-full mb-2" : "top-full mt-2"} w-[min(340px,calc(100vw-24px))] max-h-[70vh] overflow-y-auto rounded-2xl chrome-surface shadow-2xl`} style={docked ? { position: "fixed", right: 56, bottom: 24, zIndex: 71 } : undefined}>
      <div className="flex items-center gap-2 px-3 py-2 border-b" style={{ borderColor: "var(--color-border-subtle)" }}>
        <CompanionFace mood={mood} blinking={blinking} size={28} />
        <div className="min-w-0 flex-1"><div className="text-xs font-semibold">Actiora Operator</div><div className="text-[10px] truncate" style={{ color: "var(--color-text-secondary)" }}>{operator.message}</div></div>
        <button onClick={() => setCompanionQuiet(!quiet)} title={quiet ? "Allow unprompted tips" : "Stop volunteering tips"} aria-label={quiet ? "Allow unprompted tips" : "Stop volunteering tips"} style={{ color: quiet ? "var(--color-brand-primary)" : "var(--color-text-secondary)" }}>{quiet ? <BellOff className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}</button>
        <button onClick={() => setCompanionDocked(!docked)} title={docked ? "Release to the workspace" : "Dock into the right rail"} aria-label={docked ? "Release companion to the workspace" : "Dock companion into the right rail"} style={{ color: docked ? "var(--color-brand-primary)" : "var(--color-text-secondary)" }}><PanelRight className="h-3.5 w-3.5" /></button>
        <button onClick={() => setCompanionOpen(false)} aria-label="Close companion"><X className="h-4 w-4" /></button>
      </div>
      <div className="p-3 space-y-3">
        <div className="flex gap-2">
          <input value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => event.key === "Enter" && send()} placeholder="Navigate, change theme, browse, code…" aria-label="Ask Actiora Operator" className="min-w-0 flex-1 rounded-lg px-3 py-2 text-xs outline-none" style={{ background: "var(--color-bg-elevated)", border: "var(--surface-border-width) solid var(--color-border-subtle)" }} />
          <button onClick={send} className="rounded-lg px-2.5" style={{ color: "var(--color-brand-primary)" }} aria-label="Send to Operator"><MessageSquare className="h-4 w-4" /></button>
        </div>
        {pending.length > 0 && <div className="space-y-1.5"><div className="flex items-center gap-1 text-[9px] font-mono uppercase" style={{ color: "var(--color-text-secondary)" }}><Bell className="h-3 w-3" /> Reminders</div>{pending.slice(0, 4).map((item) => <div key={item.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[10px]" style={{ background: "var(--color-bg-elevated)" }}><div className="min-w-0 flex-1"><div className="truncate">{item.title}</div><div className="text-[9px]" style={{ color: "var(--color-text-secondary)" }}>{new Date(item.when).toLocaleString()}</div></div><button onClick={() => completeReminder(item.id)} aria-label={`Complete ${item.title}`}><Check className="h-3.5 w-3.5" /></button></div>)}</div>}
      </div>
    </section>
  );

  // Docked: the rail owns the pet's button (RightPane renders CompanionDockButton),
  // so this only keeps the panel and the behaviour timers alive.
  if (docked) {
    return (
      <div className="app-overlay fixed inset-0 z-[70] print:hidden pointer-events-none">
        {panel}
        <span ref={petRef} className="hidden" aria-hidden="true" />
      </div>
    );
  }

  return (
    // app-overlay keeps the shell's child rule from overriding `fixed`; without it
    // this floats out of the flex row on paper but still reserves width in it.
    <div className="app-overlay fixed z-[70] print:hidden pointer-events-none" style={{ left: pos.x, top: pos.y }}>
      {panel}

      {tip && !open && (
        <div role="status" className={`companion-bubble pointer-events-auto absolute ${openLeft ? "right-full mr-3" : "left-full ml-3"} ${openUp ? "bottom-0" : "top-0"} w-56 rounded-2xl chrome-surface shadow-xl p-2.5`}>
          <p className="text-[11px] leading-snug pr-4">{tip.text}</p>
          <button onClick={() => setTip(null)} aria-label="Dismiss tip" className="absolute top-1.5 right-1.5" style={{ color: "var(--color-text-secondary)" }}><X className="h-3 w-3" /></button>
          <div className="flex items-center gap-2 mt-1.5">
            <button onClick={() => askTip(tip.text)} className="text-[10px] font-medium" style={{ color: "var(--color-brand-primary)" }}>Show me</button>
            <button onClick={() => { setCompanionQuiet(true); setTip(null); }} className="text-[10px]" style={{ color: "var(--color-text-secondary)" }}>Stop tips</button>
          </div>
        </div>
      )}

      <button
        ref={petRef}
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => endDrag(event)}
        onPointerCancel={(event) => endDrag(event, true)}
        aria-label={open ? "Close Actiora companion" : "Open Actiora companion"}
        title="Actiora Operator — drag anywhere, click to talk"
        className="pointer-events-auto relative h-14 w-14 rounded-2xl chrome-surface shadow-xl flex items-center justify-center focus:outline-none focus:ring-2 cursor-grab active:cursor-grabbing transition-transform hover:scale-105 touch-none select-none"
        style={{ borderColor: "var(--color-brand-primary)" }}
      >
        <CompanionFace ref={faceRef} mood={mood} blinking={blinking} gesture={gesture} size={40} />
        {pending.length > 0 && <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full text-[9px] text-white flex items-center justify-center" style={{ background: "var(--color-brand-primary)" }}>{pending.length}</span>}
      </button>
    </div>
  );
}

/** The pet's presence in the right rail while docked. Rendered by RightPane so the
 *  creature sits inside the rail's own surface rather than floating beside it. */
export function CompanionDockButton({ compact = false }) {
  const [operator, setOperator] = useState(getOperatorState);
  const [placement, setPlacement] = useState(getCompanionState);
  const [blinking, setBlinking] = useState(false);
  const [reminders, setReminders] = useState(listReminders);
  const faceRef = useRef(null);

  useEffect(() => onOperatorState(setOperator), []);
  useEffect(() => onCompanionState(setPlacement), []);
  useEffect(() => onReminders(setReminders), []);
  useEffect(() => {
    if (motionSuppressed()) return undefined;
    let timer = 0;
    let cancelled = false;
    const blink = () => {
      if (cancelled) return;
      if (!document.hidden) {
        setBlinking(true);
        window.setTimeout(() => !cancelled && setBlinking(false), BLINK_DURATION_MS);
      }
      timer = window.setTimeout(blink, nextBlinkDelay());
    };
    timer = window.setTimeout(blink, nextBlinkDelay());
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, []);

  if (!placement.docked) return null;
  const pendingCount = reminders.filter((item) => !item.done).length;
  const mood = moodFor({ status: operator.status, talking: placement.open });

  return (
    <button
      onClick={toggleCompanionOpen}
      title={`Actiora Operator — ${operator.message}`}
      aria-label="Open Actiora companion"
      className={`relative ${compact ? "h-7 w-7" : "h-8 w-8"} rounded-lg flex items-center justify-center`}
      style={placement.open ? { background: "color-mix(in srgb, var(--color-brand-primary) 12%, transparent)" } : undefined}
    >
      <CompanionFace ref={faceRef} mood={mood} blinking={blinking} size={compact ? 20 : 24} />
      {pendingCount > 0 && <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full" style={{ background: "var(--color-brand-primary)" }} />}
    </button>
  );
}
