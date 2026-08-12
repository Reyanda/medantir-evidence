// termIndex.js — the tokeniser and matcher that sit on top of the retrieved
// corpus. Three jobs, all of them downstream of the question:
//
//   1. tokenise every record's title and abstract into terms;
//   2. compile the question's blocks into a regex that can be run over those
//      records, so a strategy can be TESTED before it is trusted;
//   3. use the difference between what the regex hits and what it misses to
//      propose synonyms to add and noise to exclude.
//
// Everything here is pure: no storage, no DOM, no network.

// Function words carry no discriminative signal and would dominate any
// frequency count. This is the standard closed-class list plus the sentence
// furniture that abstracts are made of.
export const STOPWORDS = new Set(`a an the and or not but if then than that this these those
of in on at by for with without from to into over under between among during before after
is are was were be been being has have had do does did can could may might will would shall should must
we our us they their them it its he she his her you your i me my
study studies trial trials patient patients participants group groups result results method methods
conclusion conclusions background objective objectives aim aims purpose design setting
significant significantly associated association compared comparison versus vs also however therefore
using used use show shows shown found find reported report data analysis analyses
as no yes other others there here which who whom whose what when where why how
all any both each few more most some such only own same so too very just
one two three four five first second new both either neither per via within across
review reviews evidence outcome outcomes clinical care risk rate rates level levels
included included excluded eligible primary secondary total overall follow
h1 h2 h3 h4 h5 p br em strong sup sub li ul ol div span`
  .split(/\s+/).filter(Boolean));

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;

/** Lowercased word tokens, stopwords and 1-character noise removed. */
export function tokenise(text, { keepStopwords = false, minLength = 3, keepNumbers = false } = {}) {
  const out = [];
  for (const match of String(text || "").toLowerCase().matchAll(WORD)) {
    const token = match[0].replace(/^[-'’]+|[-'’]+$/g, "");
    if (token.length < minLength) continue;
    // Bare numbers and the fragments of a confidence interval are not terms.
    if (!keepNumbers && /^[\d.,%-]+$/.test(token)) continue;
    if (!keepStopwords && STOPWORDS.has(token)) continue;
    out.push(token);
  }
  return out;
}

/** Adjacent token pairs — the cheapest way to surface multi-word concepts. */
export function bigrams(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length - 1; i++) out.push(`${tokens[i]} ${tokens[i + 1]}`);
  return out;
}

// Abstracts from Europe PMC and Crossref arrive with markup in them. Left in,
// the tag names become the most frequent "terms" in the corpus.
export function stripMarkup(text) {
  return String(text || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;|&#\d+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function recordText(record) {
  return stripMarkup([record?.title, record?.abstract].filter(Boolean).join(" "));
}

// --- corpus index ----------------------------------------------------------

/** term -> { df, tf } over the corpus, for unigrams and bigrams. */
export function buildTermIndex(records = [], { withBigrams = true } = {}) {
  const unigram = new Map();
  const bigram = new Map();
  const bump = (map, term, seen) => {
    const entry = map.get(term) || { term, df: 0, tf: 0 };
    entry.tf += 1;
    if (!seen.has(term)) { entry.df += 1; seen.add(term); }
    map.set(term, entry);
  };
  for (const record of records) {
    const tokens = tokenise(recordText(record));
    const seen = new Set();
    for (const token of tokens) bump(unigram, token, seen);
    if (withBigrams) {
      const seenPairs = new Set();
      for (const pair of bigrams(tokens)) bump(bigram, pair, seenPairs);
    }
  }
  return { unigram, bigram, size: records.length };
}

export function topTerms(index, { limit = 40, minDf = 2, source = "unigram" } = {}) {
  return [...(index?.[source]?.values() || [])]
    .filter((entry) => entry.df >= minDf)
    .sort((a, b) => b.df - a.df || a.term.localeCompare(b.term))
    .slice(0, limit);
}

// --- regex compilation -----------------------------------------------------

const escape = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * One term -> one regex fragment.
 *  - `*` is the search-syntax truncation operator, so it becomes \w* rather
 *    than being escaped into a literal asterisk;
 *  - a quoted or multi-word term matches with flexible internal whitespace;
 *  - boundaries are word boundaries, so "arm" never matches "harm".
 */
export function termPattern(term, { truncation = true } = {}) {
  const raw = String(term || "").trim().replace(/^["']|["']$/g, "");
  if (!raw) return null;
  const parts = raw.split(/\s+/).map((part) => {
    const hasTrail = truncation && part.endsWith("*");
    const core = escape(hasTrail ? part.slice(0, -1) : part);
    return hasTrail ? `${core}\\w*` : core;
  });
  return `\\b${parts.join("[\\s-]+")}\\b`;
}

/** A block (OR group) -> one alternation regex. */
export function blockPattern(terms, options) {
  const parts = (terms || []).map((t) => termPattern(t, options)).filter(Boolean);
  if (!parts.length) return null;
  return `(?:${parts.join("|")})`;
}

/**
 * Compile ISR concepts into something runnable. AND blocks must all hit, OR
 * blocks widen the last AND group, and a NOT block disqualifies the record.
 * Returns the per-block regexes as sources too, because the operator has to be
 * able to read what is about to be run.
 */
export function compileMatcher(concepts = [], { flags = "giu", truncation = true } = {}) {
  const blocks = [];
  for (const concept of concepts) {
    const source = blockPattern(concept.terms, { truncation });
    if (!source) continue;
    blocks.push({
      label: concept.label || "Block",
      op: concept.op === "NOT" ? "NOT" : concept.op === "OR" ? "OR" : "AND",
      source,
      terms: concept.terms || [],
    });
  }
  const required = blocks.filter((b) => b.op === "AND" || b.op === "OR");
  const excluded = blocks.filter((b) => b.op === "NOT");
  return {
    blocks,
    flags,
    // A single readable expression for the whole strategy, lookahead per block —
    // this is what gets copied into a tool that only takes one pattern.
    combined: required.length
      ? `${required.map((b) => `(?=[\\s\\S]*${b.source})`).join("")}${excluded.map((b) => `(?![\\s\\S]*${b.source})`).join("")}[\\s\\S]+`
      : null,
    test(text) {
      const haystack = String(text || "");
      const hits = [];
      for (const block of blocks) {
        const re = new RegExp(block.source, flags.replace("g", ""));
        const hit = re.test(haystack);
        hits.push({ label: block.label, op: block.op, hit });
      }
      const allRequired = required.length === 0
        ? false
        : required.every((b) => hits.find((h) => h.label === b.label && h.op === b.op)?.hit);
      const anyExcluded = excluded.some((b) => hits.find((h) => h.label === b.label && h.op === "NOT")?.hit);
      return { match: allRequired && !anyExcluded, hits, excludedBy: anyExcluded ? excluded.map((b) => b.label) : [] };
    },
  };
}

/** Every match span in a text, so the reader can see WHY a record hit. */
export function highlightSpans(text, matcher) {
  const haystack = String(text || "");
  const spans = [];
  for (const block of matcher?.blocks || []) {
    const re = new RegExp(block.source, "giu");
    let m;
    while ((m = re.exec(haystack)) !== null) {
      if (m[0].length === 0) { re.lastIndex += 1; continue; }
      spans.push({ start: m.index, end: m.index + m[0].length, label: block.label, op: block.op });
    }
  }
  // Overlapping spans would produce nested marks; the earliest, longest wins.
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.start < last.end) continue;
    merged.push(span);
  }
  return merged;
}

// --- running the strategy over the corpus ----------------------------------

export function screenCorpus(records = [], matcher) {
  const matched = [];
  const missed = [];
  const perBlock = new Map();
  for (const record of records) {
    const result = matcher.test(recordText(record));
    for (const hit of result.hits) {
      const entry = perBlock.get(hit.label) || { label: hit.label, op: hit.op, hits: 0 };
      if (hit.hit) entry.hits += 1;
      perBlock.set(hit.label, entry);
    }
    (result.match ? matched : missed).push(record);
  }
  return {
    total: records.length,
    matched,
    missed,
    matchedCount: matched.length,
    missedCount: missed.length,
    blocks: [...perBlock.values()],
    // Sensitivity against the operator's own decisions, where they exist: a
    // strategy that misses records already screened in is losing evidence.
    lostIncluded: matched.length + missed.length
      ? missed.filter((r) => r.tiab === "include" || r.fulltext?.decision === "include").length
      : 0,
  };
}

/**
 * Terms that travel with a seed term: frequent in records the seed hits, rare
 * elsewhere. A cheap, corpus-grounded synonym proposal — not a thesaurus, and
 * labelled as such wherever it is shown.
 */
export function synonymCandidates(records = [], seedTerms = [], { limit = 12, minDf = 2 } = {}) {
  const source = blockPattern(seedTerms);
  if (!source) return [];
  const re = new RegExp(source, "iu");
  const inside = new Map();
  const outside = new Map();
  let insideDocs = 0;
  for (const record of records) {
    const text = recordText(record);
    const target = re.test(text) ? inside : outside;
    if (target === inside) insideDocs += 1;
    for (const token of new Set(tokenise(text))) target.set(token, (target.get(token) || 0) + 1);
  }
  if (!insideDocs) return [];
  const seedSet = new Set(seedTerms.flatMap((t) => tokenise(t)));
  const outsideDocs = records.length - insideDocs || 1;
  return [...inside.entries()]
    .filter(([term, df]) => df >= minDf && !seedSet.has(term))
    .map(([term, df]) => {
      const inRate = df / insideDocs;
      const outRate = (outside.get(term) || 0) / outsideDocs;
      return { term, df, lift: inRate / (outRate + 1 / outsideDocs) };
    })
    // Lift alone promotes terms that appear twice; weighting by document count
    // keeps the ranking honest on a small corpus.
    .filter((c) => c.lift >= 2)
    .sort((a, b) => b.lift * Math.log(1 + b.df) - a.lift * Math.log(1 + a.df))
    .slice(0, limit);
}

/**
 * Noise: terms common in records the strategy MATCHED but the operator
 * EXCLUDED. That is the only honest source for a NOT block — it is earned from
 * screening decisions, never guessed.
 */
export function noiseCandidates(records = [], matcher, { limit = 12, minDf = 2 } = {}) {
  const excluded = [];
  const kept = [];
  for (const record of records) {
    if (!matcher.test(recordText(record)).match) continue;
    const decision = record.fulltext?.decision || record.tiab;
    if (decision === "exclude") excluded.push(record);
    else if (decision === "include") kept.push(record);
  }
  if (excluded.length < 3) return { ready: false, reason: `only ${excluded.length} screened-out record(s) match the strategy — decide more before mining noise`, candidates: [] };

  const inExcluded = new Map();
  const inKept = new Map();
  for (const record of excluded) for (const t of new Set(tokenise(recordText(record)))) inExcluded.set(t, (inExcluded.get(t) || 0) + 1);
  for (const record of kept) for (const t of new Set(tokenise(recordText(record)))) inKept.set(t, (inKept.get(t) || 0) + 1);

  const candidates = [...inExcluded.entries()]
    .filter(([term, df]) => df >= minDf && !inKept.has(term))
    .map(([term, df]) => ({ term, df, share: df / excluded.length }))
    .sort((a, b) => b.df - a.df || a.term.localeCompare(b.term))
    .slice(0, limit);

  return { ready: true, excludedMatched: excluded.length, keptMatched: kept.length, candidates };
}
