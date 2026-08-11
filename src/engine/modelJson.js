// modelJson.js — robust structured-output parsing for LLM responses.
//
// Models routinely wrap JSON in prose, code fences, or trailing commentary.
// The old call sites regex-grabbed /\{[\s\S]*\}/ which breaks on nested
// braces, braces inside strings, and fence wrappers. This module extracts the
// first BALANCED JSON value (object or array) with a string-aware scanner and
// optionally validates a minimal shape. One shared path for every consumer.

// Find the end index (exclusive) of the balanced JSON value starting at `start`
// in `text`, honouring strings and escapes. Returns -1 when unbalanced.
function balancedEnd(text, start) {
  const open = text[start];
  const close = open === "{" ? "}" : open === "[" ? "]" : null;
  if (!close) return -1;
  const stack = [close];
  let inString = false;
  let escaped = false;
  for (let i = start + 1; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (inString) {
      if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") {
      if (stack.pop() !== ch) return -1;
      if (!stack.length) return i + 1;
    }
  }
  return -1;
}

// Extract and JSON.parse the first balanced object/array in `text`.
// Handles ```json fences and surrounding prose. Returns null on failure.
export function extractJson(text) {
  const source = String(text || "");
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = fenced ? [fenced[1], source] : [source];
  for (const candidate of candidates) {
    for (let i = 0; i < candidate.length; i += 1) {
      const ch = candidate[i];
      if (ch !== "{" && ch !== "[") continue;
      const end = balancedEnd(candidate, i);
      if (end < 0) continue;
      try { return JSON.parse(candidate.slice(i, end)); } catch { /* keep scanning */ }
    }
  }
  return null;
}

// Parse model output with an optional minimal shape contract:
//   { array: true }                    — value must be an array
//   { fields: { key: "string"|"number"|"boolean"|"object" } } — required keys
//   { itemFields: { key: type } }      — array entries missing a key are dropped
// Returns { ok, value, dropped } — never throws.
export function parseModelJson(text, contract = {}) {
  const value = extractJson(text);
  if (value == null) return { ok: false, value: null, dropped: 0 };
  if (contract.array) {
    if (!Array.isArray(value)) return { ok: false, value: null, dropped: 0 };
    if (!contract.itemFields) return { ok: true, value, dropped: 0 };
    const entries = value.filter((item) => item && typeof item === "object" && Object.entries(contract.itemFields).every(([key, type]) => typeof item[key] === type));
    return { ok: true, value: entries, dropped: value.length - entries.length };
  }
  if (contract.fields) {
    if (typeof value !== "object" || Array.isArray(value)) return { ok: false, value: null, dropped: 0 };
    const missing = Object.entries(contract.fields).some(([key, type]) => typeof value[key] !== type);
    if (missing) return { ok: false, value: null, dropped: 0 };
  }
  return { ok: true, value, dropped: 0 };
}
