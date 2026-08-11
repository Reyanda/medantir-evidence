import React, { forwardRef } from "react";

// CompanionFace — the creature itself.
//
// An SVG rather than stacked divs, because "alive" comes from parts that can move
// independently: pupils that track the pointer, eyelids that actually close over
// the eyes, a mouth that changes shape with mood, and an antenna with follow-through.
//
// Pointer tracking is driven through the CSS custom properties --pupil-x/--pupil-y
// written imperatively on the root by the parent. That keeps a 60fps glance off
// React's render path entirely — the component re-renders only when mood changes.

const MOUTHS = {
  idle: "M19 30 Q24 33.5 29 30",
  pleased: "M18 29.5 Q24 35 30 29.5",
  thinking: "M21.5 31 Q24 30 26.5 31",
  concerned: "M19 32.5 Q24 28.5 29 32.5",
  talking: "M21 30 Q24 34.5 27 30 Q24 32 21 30",
  asleep: "M21 31 Q24 32.5 27 31",
  held: "M20.5 30.5 Q24 34 27.5 30.5",
};

// A brow angle per mood does more for legibility than any other single detail.
const BROWS = {
  idle: { left: 0, right: 0, y: 0 },
  pleased: { left: -6, right: 6, y: -1 },
  thinking: { left: -12, right: 4, y: -1.5 },
  concerned: { left: 14, right: -14, y: 1 },
  talking: { left: -3, right: 3, y: -0.5 },
  // Relaxed and level. Slanted brows over closed lids read as irritation, not rest.
  asleep: { left: 0, right: 0, y: 1.5 },
  held: { left: -8, right: 8, y: -2 },
};

const CompanionFace = forwardRef(function CompanionFace({ mood = "idle", size = 40, blinking = false, gesture = "", className = "" }, ref) {
  const shut = blinking || mood === "asleep";
  const brow = BROWS[mood] || BROWS.idle;
  const mouth = MOUTHS[mood] || MOUTHS.idle;

  return (
    <svg
      ref={ref}
      viewBox="0 0 48 48"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={`companion-face ${gesture ? `companion-gesture-${gesture}` : ""} companion-mood-${mood} ${className}`}
    >
      <defs>
        <radialGradient id="companion-body" cx="35%" cy="28%" r="85%">
          <stop offset="0%" stopColor="color-mix(in srgb, var(--color-brand-primary) 42%, var(--color-bg-elevated))" />
          <stop offset="100%" stopColor="color-mix(in srgb, var(--color-brand-primary) 14%, var(--color-bg-elevated))" />
        </radialGradient>
      </defs>

      {/* Antenna — trails the body a beat behind on every gesture, which is what
          sells the movement as physical rather than as a sprite swap. */}
      <g className="companion-antenna">
        <path d="M24 9 Q24 5 25 3" fill="none" stroke="var(--color-brand-primary)" strokeWidth="1.4" strokeLinecap="round" opacity="0.85" />
        <circle cx="25.2" cy="2.4" r="2.1" fill="var(--color-brand-primary)" />
      </g>

      <g className="companion-body">
        <rect x="5.5" y="9" width="37" height="33" rx="12.5" fill="url(#companion-body)" stroke="var(--color-brand-primary)" strokeOpacity="0.5" strokeWidth="1.2" />

        {/* Eyes: sclera, tracking pupil, then a lid that scales down over both. */}
        <g className="companion-eyes">
          <circle cx="18" cy="23" r="4.4" fill="var(--color-bg-surface)" />
          <circle cx="30" cy="23" r="4.4" fill="var(--color-bg-surface)" />
          <g className="companion-pupils">
            <circle cx="18" cy="23" r="2.1" fill="var(--color-text-primary)" />
            <circle cx="30" cy="23" r="2.1" fill="var(--color-text-primary)" />
            <circle cx="18.9" cy="21.9" r="0.65" fill="var(--color-bg-surface)" opacity="0.9" />
            <circle cx="30.9" cy="21.9" r="0.65" fill="var(--color-bg-surface)" opacity="0.9" />
          </g>
          {/* Flat body tone, not the radial gradient: the gradient is resolved
              against each rect's own box, so on a 9px lid it rendered as a dark
              slanted slit and closed eyes read as a scowl instead of sleep. */}
          <g className="companion-lids" style={{ transform: shut ? "scaleY(1)" : "scaleY(0)" }}>
            <rect x="13.4" y="18.4" width="9.2" height="9.2" rx="4.6" fill="color-mix(in srgb, var(--color-brand-primary) 30%, var(--color-bg-elevated))" />
            <rect x="25.4" y="18.4" width="9.2" height="9.2" rx="4.6" fill="color-mix(in srgb, var(--color-brand-primary) 30%, var(--color-bg-elevated))" />
          </g>
        </g>

        <g className="companion-brows" style={{ transform: `translateY(${brow.y}px)` }}>
          <line x1="14.6" y1="16.4" x2="21.4" y2="16.4" stroke="var(--color-text-primary)" strokeWidth="1.5" strokeLinecap="round" opacity="0.75" style={{ transform: `rotate(${brow.left}deg)`, transformOrigin: "18px 16.4px" }} />
          <line x1="26.6" y1="16.4" x2="33.4" y2="16.4" stroke="var(--color-text-primary)" strokeWidth="1.5" strokeLinecap="round" opacity="0.75" style={{ transform: `rotate(${brow.right}deg)`, transformOrigin: "30px 16.4px" }} />
        </g>

        <path className="companion-mouth" d={mouth} fill="none" stroke="var(--color-text-primary)" strokeWidth="1.6" strokeLinecap="round" opacity="0.8" />
      </g>

      {/* Thinking dots and sleep marks are the only mood-specific extras: both are
          instantly readable at 24px, where a subtle expression change is not.
          Both sit ABOVE the body (which starts at y=9) — drawing them at y=6..13
          put them on top of the head instead of rising away from it. */}
      {mood === "thinking" && (
        <g className="companion-thinking">
          <circle cx="35.5" cy="6.5" r="1.5" fill="var(--color-brand-primary)" />
          <circle cx="39.5" cy="4" r="1.1" fill="var(--color-brand-primary)" />
          <circle cx="43" cy="2" r="0.8" fill="var(--color-brand-primary)" />
        </g>
      )}
      {mood === "asleep" && (
        <g className="companion-sleep" fill="var(--color-text-secondary)" fontSize="7" fontWeight="700">
          <text x="34" y="7.5">z</text>
          <text x="39.5" y="3.5">z</text>
        </g>
      )}
    </svg>
  );
});

export default CompanionFace;
