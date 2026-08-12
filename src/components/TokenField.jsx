import React, { useRef, useState } from "react";

// A term is a discrete object, not a substring of a sentence: "children" and
// "adults" are two search terms that will be OR-ed, and typing them into one
// comma-separated box hides that. Each term is entered, seen and removed as
// itself. Enter, comma, semicolon or Tab commits; Backspace on an empty field
// takes back the last one; a pasted list splits on its own separators.

export const SPLIT = /[,;\n\t]+/;

export function toTokens(value) {
  if (Array.isArray(value)) return value.map((t) => String(t).trim()).filter(Boolean);
  return String(value || "").split(SPLIT).map((t) => t.trim()).filter(Boolean);
}

export default function TokenField({
  value = [],
  onChange,
  placeholder = "",
  tone = "neutral", // neutral | not
  disabled = false,
}) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef(null);
  const tokens = toTokens(value);

  const commit = (raw) => {
    const additions = toTokens(raw).filter((t) => !tokens.some((existing) => existing.toLowerCase() === t.toLowerCase()));
    if (additions.length) onChange?.([...tokens, ...additions]);
    setDraft("");
  };

  const removeAt = (index) => onChange?.(tokens.filter((_, i) => i !== index));

  // The first term is the one the question sentence reads, so it has to be
  // choosable: clicking a term promotes it to the front.
  const promote = (index) => {
    if (index === 0) return;
    const next = [...tokens];
    const [picked] = next.splice(index, 1);
    onChange?.([picked, ...next]);
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" || e.key === "," || e.key === ";" || (e.key === "Tab" && draft.trim())) {
      e.preventDefault();
      commit(draft);
      return;
    }
    if (e.key === "Backspace" && !draft && tokens.length) {
      e.preventDefault();
      // Take the last term back into the field so a typo is corrected, not lost.
      setDraft(tokens[tokens.length - 1]);
      onChange?.(tokens.slice(0, -1));
    }
  };

  return (
    <div
      className={`wb-tokens ${tone === "not" ? "not" : ""} ${disabled ? "disabled" : ""}`}
      onClick={() => inputRef.current?.focus()}
    >
      {tokens.map((token, index) => (
        <span
          className={`wb-token ${index === 0 ? "head" : ""}`}
          key={`${token}-${index}`}
          title={index === 0 ? `${token} — leads the question sentence` : `${token} — click to make it lead the question`}
          onClick={(e) => { e.stopPropagation(); promote(index); }}
        >
          {token}
          <button
            type="button"
            className="x"
            aria-label={`Remove ${token}`}
            onClick={(e) => { e.stopPropagation(); removeAt(index); }}
            disabled={disabled}
          >
            ×
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        value={draft}
        disabled={disabled}
        placeholder={tokens.length ? "" : placeholder}
        onChange={(e) => {
          // A paste that carries separators becomes tokens immediately.
          if (SPLIT.test(e.target.value)) commit(e.target.value);
          else setDraft(e.target.value);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => draft.trim() && commit(draft)}
      />
    </div>
  );
}
