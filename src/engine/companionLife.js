// companionLife.js — the pure behaviour rules that make the companion read as
// alive rather than as a static badge.
//
// Everything here is deterministic given a random source, so the creature's
// timing, moods, gestures and tips are unit-testable without a DOM or a clock.
// The component owns the timers; this file owns the decisions.

// Blinks are irregular. A fixed interval reads as a machine ticking, so the delay
// is drawn from a range with an occasional double-blink, which is what eyes do.
export const BLINK_MIN_MS = 2200;
export const BLINK_MAX_MS = 7000;
export const BLINK_DURATION_MS = 170;
export const DOUBLE_BLINK_CHANCE = 0.22;

export function nextBlinkDelay(random = Math.random) {
  return Math.round(BLINK_MIN_MS + random() * (BLINK_MAX_MS - BLINK_MIN_MS));
}
export function isDoubleBlink(random = Math.random) {
  return random() < DOUBLE_BLINK_CHANCE;
}

// Idle behaviour escalates: small glances first, then a stretch, then sleep. The
// pet must never doze while it is actually working on something.
export const IDLE_GESTURE_MIN_MS = 9000;
export const IDLE_GESTURE_MAX_MS = 20000;
export const SLEEP_AFTER_MS = 90_000;
export const GESTURES = ["glance", "tilt", "stretch", "hop"];

export function nextGestureDelay(random = Math.random) {
  return Math.round(IDLE_GESTURE_MIN_MS + random() * (IDLE_GESTURE_MAX_MS - IDLE_GESTURE_MIN_MS));
}
export function pickGesture(random = Math.random) {
  return GESTURES[Math.min(GESTURES.length - 1, Math.floor(random() * GESTURES.length))];
}

/** The creature's expression. Operator status wins over idleness — a working pet
 *  that looks asleep is worse than no pet at all. */
export function moodFor({ status = "idle", dragging = false, asleep = false, talking = false } = {}) {
  if (dragging) return "held";
  if (status === "working") return "thinking";
  if (status === "error") return "concerned";
  if (status === "done") return "pleased";
  if (talking) return "talking";
  if (asleep) return "asleep";
  return "idle";
}

/** Map companion mood to Petdex 72-frame spritesheet animation states
 *  (states: idle, wave, run, failed, review, jump) */
export const PETDEX_ANIMATION_MAP = {
  idle: "idle",
  thinking: "review",
  concerned: "failed",
  pleased: "jump",
  talking: "wave",
  asleep: "idle",
  held: "run",
};

export function petdexAnimationStateForMood(mood) {
  return PETDEX_ANIMATION_MAP[mood] || "idle";
}

/** Whether the creature may raise an unprompted tip right now. Quiet mode, an
 *  open panel, active work, and a cooldown all veto it — the assistant speaks
 *  when the operator is idle and receptive, never over the top of them. */
export const TIP_COOLDOWN_MS = 4 * 60_000;
export const TIP_IDLE_BEFORE_MS = 25_000;

export function canOfferTip({ quiet, open, status, idleForMs, sinceLastTipMs, asleep } = {}) {
  if (quiet || open || asleep) return false;
  if (status === "working") return false;
  if (!(idleForMs >= TIP_IDLE_BEFORE_MS)) return false;
  return sinceLastTipMs >= TIP_COOLDOWN_MS;
}

// Tips point at capabilities that genuinely exist in this app. A tip that is
// merely chatty is noise; these each name a real surface the operator can open.
export const TIPS = [
  { id: "db-connections", text: "Sign in to Embase or Ovid once in the Browser tab — review searches reuse that session." },
  { id: "compiled-strategy", text: "Build concepts in the Search Strategy builder and the pipeline will run the compiled Boolean, not your raw question." },
  { id: "hit-counts", text: "The PRISMA-S log records what each database matched, separately from what was retrieved." },
  { id: "terminal", text: "The Terminal tab runs a real Bash session scoped to the active project." },
  { id: "dedup", text: "Deduplication flags duplicates instead of deleting them, so any merge can be undone." },
  { id: "dock", text: "Drag me anywhere, or dock me into the right rail to get me out of the way." },
  { id: "quiet", text: "Tell me to stay quiet from my panel and I will stop volunteering tips." },
];

/** Rotate rather than repeat: a tip already seen this session is skipped until
 *  the list is exhausted. */
export function pickTip(seenIds = [], random = Math.random) {
  const unseen = TIPS.filter((tip) => !seenIds.includes(tip.id));
  const pool = unseen.length ? unseen : TIPS;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

// Pupils track the pointer, but only a little: a full-range follow looks unhinged
// rather than attentive. Offsets are clamped to a small radius around centre.
export const PUPIL_RANGE_PX = 2.4;

export function pupilOffset({ pointerX, pointerY, centreX, centreY, range = PUPIL_RANGE_PX }) {
  const dx = pointerX - centreX;
  const dy = pointerY - centreY;
  const distance = Math.hypot(dx, dy);
  if (!distance) return { x: 0, y: 0 };
  // Saturate with distance so nearby pointers still produce a readable glance.
  const strength = Math.min(1, distance / 320);
  return { x: (dx / distance) * range * strength, y: (dy / distance) * range * strength };
}
