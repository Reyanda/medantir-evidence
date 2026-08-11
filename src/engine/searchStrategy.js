// searchStrategy.js — Systematic-review search-strategy compiler.
//
// ISR = ordered CONCEPTS. Each concept: free-text synonyms (OR-ed) + native,
// vocabulary-specific headings, and an OPERATOR (AND/OR/NOT) joining it to
// the running combination.
//
// THE TWO AXES. Syntax belongs to the PLATFORM; controlled vocabulary belongs to
// the DATABASE. MEDLINE on Ovid is `.ti,ab,kf.` + `exp X/`; the same MEDLINE on
// EBSCOhost is `TI (…) OR AB (…)` + `(MH "X+")`; on PubMed it is `[tiab]` +
// `[Mesh]` — one database, three syntaxes. Conversely Embase always uses Emtree
// whether reached through Ovid or Embase.com.
//
// Keeping those axes fused (an `ovid_embase` identifier that means both) is why
// every newly discovered database used to need a code change. A compile target is
// now { platform, vocabulary, fields }, so a database detected behind a gateway is
// immediately searchable with correct platform syntax; only its thesaurus may be
// unknown, and that degrades to a free-text line with headingStatus "none" rather
// than to a wrong one.

const isPhrase = (t) => /\s/.test((t || "").trim());
const q = (t) => (isPhrase(t) ? `"${t.trim()}"` : t.trim());
const qOvid = (t) => (isPhrase(t) ? `"${t.trim()}"` : t.trim());

// --- axis 1: platforms (syntax) ---------------------------------------------
// `concept(terms, fields)` renders the free-text group; `heading(term)` renders
// ONE controlled term in this platform's form. The term itself comes from the
// database's vocabulary, which is the other axis.
export const PLATFORMS = {
  pubmed: { name: "PubMed", vendor: "NLM", auto: false,
    concept: (ts, fields = "tiab") => `(${ts.map((t) => `${q(t)}[${fields}]`).join(" OR ")})`,
    heading: (m) => `${q(m)}[Mesh]`, hint: "[Mesh] auto-explodes; [tiab]=title/abstract." },
  ovid: { name: "Ovid", vendor: "Wolters Kluwer", auto: false, lowercaseOperators: true,
    concept: (ts, fields = "ti,ab") => `(${ts.map(qOvid).join(" or ")}).${fields}.`,
    heading: (m) => `exp ${m}/`, hint: "exp X/ = exploded heading; lowercase or/and, * truncation." },
  ebscohost: { name: "EBSCOhost", vendor: "EBSCO", auto: false,
    concept: (ts) => `(TI (${ts.map(q).join(" OR ")}) OR AB (${ts.map(q).join(" OR ")}))`,
    heading: (m) => `(MH "${m}+")`, hint: "(MH \"X+\") = exploded subject heading." },
  embase_com: { name: "Embase.com", vendor: "Elsevier", auto: false,
    concept: (ts, fields = "ti,ab,kw") => `(${ts.map((t) => `${q(t)}:${fields}`).join(" OR ")})`,
    heading: (m) => `'${m}'/exp`, hint: "'term'/exp = exploded Emtree." },
  cochrane: { name: "Cochrane Library", vendor: "Wiley", auto: false,
    concept: (ts, fields = "ti,ab,kw") => `(${ts.map(q).join(" OR ")}):${fields}`,
    heading: (m) => `[mh "${m}"]`, hint: "[mh \"X\"] = MeSH descriptor (exploded)." },
  scopus: { name: "Scopus", vendor: "Elsevier", auto: false,
    concept: (ts) => `TITLE-ABS-KEY(${ts.map(q).join(" OR ")})`,
    heading: null, hint: "No controlled vocab; TITLE-ABS-KEY covers title/abstract/keywords." },
  wos: { name: "Web of Science", vendor: "Clarivate", auto: false,
    concept: (ts) => `TS=(${ts.map(q).join(" OR ")})`,
    heading: null, hint: "TS= topic field; no controlled vocab." },
  vhl: { name: "BVS / VHL", vendor: "BIREME", auto: false,
    concept: (ts) => `tw:(${ts.map(q).join(" OR ")})`,
    heading: (m) => `(mh:"${m}")`, hint: "DeCS via mh:." },
  livivo: { name: "LIVIVO", vendor: "ZB MED", auto: false,
    // Quoting requests an exact phrase and disables LIVIVO's own semantic
    // expansion, so ordinary concepts stay unquoted.
    concept: (ts) => `(${ts.map((t) => t.trim()).join(" OR ")})`,
    heading: (m) => m.trim(),
    hint: "Semantic search expands life-science concepts; reserve quotation marks for exact phrases. Browser-assisted execution." },
  registry: { name: "Trial registry", vendor: "—", auto: false,
    concept: (ts) => `(${ts.map(q).join(" OR ")})`, heading: null, hint: "Essie expression." },
  europepmc: { name: "Europe PMC", vendor: "EMBL-EBI", auto: true, fidelity: "full",
    concept: (ts) => `(${ts.map((t) => `TITLE_ABS:${q(t)}`).join(" OR ")})`,
    heading: (m) => `MESH:"${m}"`, hint: "TITLE_ABS: restricts to title/abstract; MESH:\"X\" descriptor. Boolean, live API." },
  openalex: { name: "OpenAlex", vendor: "OurResearch", auto: true, fidelity: "flat",
    concept: (ts) => `(${ts.map(q).join(" OR ")})`, heading: null,
    hint: "title_and_abstract.search honours AND/OR/NOT but not nested parentheses, so a multi-concept strategy is executed as stacked filter clauses." },
  crossref: { name: "Crossref", vendor: "Crossref", auto: true, fidelity: "none",
    concept: (ts) => ts.join(" "), heading: null,
    hint: "Relevance-ranked free text; no Boolean query language. Supplementary to the database searches." },
};

// --- axis 2: vocabularies (controlled terms) --------------------------------
export const VOCABULARIES = {
  mesh: "MeSH",
  emtree: "Emtree",
  cinahl: "CINAHL Headings",
  apa: "APA Thesaurus",
  decs: "DeCS",
};

// Which thesaurus a database indexes with, and the field tags it uses on
// platforms whose tags vary by database. Data, not code: a newly discovered
// database resolves through `match`, and an unrecognised one simply has no
// vocabulary — its line compiles free-text only and says so.
export const DATABASE_PROFILES = [
  { id: "medline", label: "MEDLINE", match: /\bmedline\b/i, vocabulary: "mesh", fields: { ovid: "ti,ab,kf" } },
  { id: "pubmed", label: "PubMed", match: /\bpubmed\b/i, vocabulary: "mesh" },
  { id: "embase", label: "Embase", match: /\bembase\b/i, vocabulary: "emtree", fields: { ovid: "ti,ab,kw" } },
  { id: "cinahl", label: "CINAHL", match: /\bcinahl\b/i, vocabulary: "cinahl" },
  { id: "psycinfo", label: "PsycINFO", match: /\bpsyc(info|articles)\b/i, vocabulary: "apa", fields: { ovid: "ti,ab,id" } },
  { id: "central", label: "Cochrane CENTRAL", match: /\bcentral\b|\bcochrane\b/i, vocabulary: "mesh" },
  { id: "lilacs", label: "LILACS", match: /\blilacs\b/i, vocabulary: "decs" },
  { id: "global_health", label: "Global Health", match: /\bglobal health\b/i, vocabulary: null, fields: { ovid: "ti,ab" } },
  { id: "amed", label: "AMED", match: /\bamed\b/i, vocabulary: null, fields: { ovid: "ti,ab" } },
  { id: "hmic", label: "HMIC", match: /\bhmic\b/i, vocabulary: null, fields: { ovid: "ti,ab" } },
  { id: "maternity", label: "Maternity & Infant Care", match: /\bmaternity\b/i, vocabulary: null, fields: { ovid: "ti,ab" } },
];

/** Resolve a database NAME to its thesaurus and field tags. An unknown database
 *  is not an error: it compiles free-text on its platform's syntax. */
export function profileForDatabase(name) {
  const found = DATABASE_PROFILES.find((profile) => profile.match.test(String(name || "")));
  return found || { id: null, label: String(name || "").trim() || "Unknown database", vocabulary: null, fields: {} };
}

/** Build a compile target from the two axes. `platform` comes from the gateway
 *  the operator authenticated against; `databaseName` from discovery. */
export function resolveTarget({ platform, databaseName, vocabulary, fields } = {}) {
  const profile = profileForDatabase(databaseName);
  const platformId = PLATFORMS[platform] ? platform : null;
  return {
    platform: platformId,
    name: databaseName || profile.label,
    vocabulary: vocabulary !== undefined ? vocabulary : profile.vocabulary,
    fields: fields || profile.fields?.[platformId] || null,
    databaseProfile: profile.id,
  };
}

// The historic flat identifiers, each expressed as a point on the two axes. They
// remain the stable ids used by search recipes, PRISMA-S rows and saved reviews;
// what changed is that they are now DERIVED rather than being the only way to
// name a target. Anything discovered at runtime builds a target directly.
export const TARGETS = {
  pubmed: { platform: "pubmed", database: "PubMed", label: "PubMed" },
  ovid_medline: { platform: "ovid", database: "MEDLINE", label: "Ovid MEDLINE" },
  ovid_embase: { platform: "ovid", database: "Embase", label: "Embase (Ovid)" },
  embase_com: { platform: "embase_com", database: "Embase", label: "Embase.com" },
  cochrane: { platform: "cochrane", database: "Cochrane CENTRAL", label: "Cochrane CENTRAL" },
  cinahl: { platform: "ebscohost", database: "CINAHL", label: "CINAHL (EBSCO)" },
  psycinfo: { platform: "ovid", database: "PsycINFO", label: "PsycINFO" },
  scopus: { platform: "scopus", database: "Scopus", label: "Scopus" },
  wos: { platform: "wos", database: "Web of Science", label: "Web of Science" },
  europepmc: { platform: "europepmc", database: "Europe PMC", label: "Europe PMC", vocabulary: "mesh" },
  lilacs: { platform: "vhl", database: "LILACS", label: "LILACS (VHL)" },
  livivo: { platform: "livivo", database: "LIVIVO", label: "LIVIVO", vocabulary: "mesh", controlled: "MeSH · UMTHES · AGROVOC" },
  clinicaltrials: { platform: "registry", database: "ClinicalTrials.gov", label: "ClinicalTrials.gov" },
  openalex: { platform: "openalex", database: "OpenAlex", label: "OpenAlex", controlled: "Concepts" },
  crossref: { platform: "crossref", database: "Crossref", label: "Crossref" },
};

/** A legacy id, or a runtime-discovered { platform, database }, as one target. */
export function targetFor(idOrTarget) {
  const spec = typeof idOrTarget === "string" ? TARGETS[idOrTarget] : idOrTarget;
  if (!spec || !PLATFORMS[spec.platform]) return null;
  const resolved = resolveTarget({ platform: spec.platform, databaseName: spec.database, vocabulary: spec.vocabulary, fields: spec.fields });
  const platform = PLATFORMS[spec.platform];
  return {
    ...resolved,
    id: typeof idOrTarget === "string" ? idOrTarget : `${spec.platform}:${resolved.databaseProfile || resolved.name}`,
    name: spec.label || resolved.name,
    platformName: platform.name,
    vendor: platform.vendor,
    controlled: spec.controlled || (resolved.vocabulary ? VOCABULARIES[resolved.vocabulary] : "—"),
    auto: !!platform.auto,
    hint: platform.hint,
    fidelity: platform.fidelity || (platform.auto ? "full" : "manual"),
  };
}

// Legacy per-database view, derived from the axes above so the old call sites and
// their tests keep working unchanged.
const DB = Object.fromEntries(Object.keys(TARGETS).map((id) => {
  const target = targetFor(id);
  const platform = PLATFORMS[target.platform];
  return [id, {
    name: target.name,
    controlled: target.controlled,
    vocabulary: target.vocabulary,
    auto: target.auto,
    fidelity: platform.fidelity,
    lowercaseOperators: platform.lowercaseOperators,
    hint: target.hint,
    concept: (ts) => platform.concept(ts, target.fields || undefined),
    mesh: platform.heading,
  }];
}));


// How faithfully a source can execute a compiled Boolean strategy:
//   full — operators, nesting and field tags all honoured as written
//   flat — operators honoured, nesting not; executed as a union of flat queries
//   none — no Boolean language; runs as relevance free text
//   manual — no API; executed through an authenticated browser session
export function booleanFidelity(dbId) {
  return DB[dbId]?.fidelity || (DB[dbId]?.auto ? "full" : "manual");
}

export const STRATEGY_DBS = Object.keys(DB);
export const OPERATORS = ["AND", "OR", "NOT"];

function headingsForDatabase(db, concept) {
  if (!db.mesh || !db.vocabulary) return [];
  const native = concept.vocab?.[db.vocabulary];
  if (Array.isArray(native)) return native.map((term) => (term || "").trim()).filter(Boolean);
  // Backward compatibility is intentionally limited to MeSH-backed targets.
  // A legacy MeSH array must never be relabelled as another native thesaurus.
  if (db.vocabulary === "mesh") return (concept.mesh || []).map((term) => (term || "").trim()).filter(Boolean);
  return [];
}

// Render one concept (free-text group + native controlled-vocab group, OR-ed).
function renderConcept(db, c) {
  const ft = (c.terms || []).map((t) => (t || "").trim()).filter(Boolean);
  const parts = [];
  if (ft.length) parts.push(db.concept(ft));
  if (db.mesh) for (const heading of headingsForDatabase(db, c)) parts.push(db.mesh(heading));
  if (!parts.length) return "";
  return parts.length > 1 ? `(${parts.join(" OR ")})` : parts[0];
}

// Render + left-to-right combine. Kept separate from renderForDatabase so the API
// execution planner can reuse it without the two calling each other.
function renderCombined(db, dbId, concepts) {
  // Crossref has no operators, so an excluded concept would be space-joined into
  // the query as a POSITIVE term. Drop it from the displayed line too, so what the
  // reviewer reads is what actually runs.
  const usable = dbId === "crossref" ? concepts.filter((concept, index) => index === 0 || concept.op !== "NOT") : concepts;
  const valid = usable.filter((concept) => (concept.terms || []).some((term) => (term || "").trim()) || headingsForDatabase(db, concept).length);
  const lines = valid.map((c, i) => ({ n: i + 1, label: c.label || `concept ${i + 1}`, op: c.op || "AND", text: renderConcept(db, c) })).filter((l) => l.text);
  let combined = lines.length ? lines[0].text : "";
  for (let i = 1; i < lines.length; i++) {
    // Ovid-family platforms use lowercase operators; Crossref has none at all.
    const operator = db.lowercaseOperators ? lines[i].op.toLowerCase() : lines[i].op;
    const op = dbId === "crossref" ? " " : ` ${operator} `;
    combined = `(${combined}${op}${lines[i].text})`;
  }
  return { valid, lines, combined };
}

/** Build the renderer descriptor for a discovered { platform, database } pair,
 *  so a database nobody hardcoded compiles on its gateway's syntax. */
function descriptorForTarget(spec) {
  const target = targetFor(spec);
  if (!target) return null;
  const platform = PLATFORMS[target.platform];
  return {
    id: target.id,
    name: target.name,
    controlled: target.controlled,
    vocabulary: target.vocabulary,
    auto: target.auto,
    fidelity: platform.fidelity,
    lowercaseOperators: platform.lowercaseOperators,
    hint: target.hint,
    concept: (ts) => platform.concept(ts, target.fields || undefined),
    mesh: platform.heading,
  };
}

/** Accepts a legacy identifier OR a discovered { platform, database } pair. */
export function renderForDatabase(dbId, concepts) {
  const isTarget = dbId && typeof dbId === "object";
  const db = isTarget ? descriptorForTarget(dbId) : DB[dbId];
  if (!db) return null;
  const key = isTarget ? db.id : dbId;
  const { valid, lines, combined } = renderCombined(db, key, concepts);

  if (lines.length > 1) lines.push({ n: lines.length + 1, label: "combine", text: lines.map((l, i) => (i === 0 ? `#${l.n}` : `${l.op} #${l.n}`)).join(" ") });
  const headingConceptCount = valid.filter((concept) => headingsForDatabase(db, concept).length).length;
  const headingStatus = !db.vocabulary
    ? "not-applicable"
    : headingConceptCount === valid.length && valid.length
      ? "complete"
      : headingConceptCount
        ? "partial"
        : "none";
  return {
    id: key,
    name: db.name,
    platform: isTarget ? dbId.platform : TARGETS[dbId]?.platform || null,
    vendor: PLATFORMS[isTarget ? dbId.platform : TARGETS[dbId]?.platform]?.vendor || null,
    controlled: db.controlled,
    vocabulary: db.vocabulary || null,
    auto: db.auto,
    hint: db.hint,
    lines,
    combined,
    headingStatus,
    headingConceptCount,
    // A discovered database with no known thesaurus is searchable but not
    // thesaurus-grounded; saying so is what keeps the search log honest.
    freeTextOnly: !db.vocabulary,
    fidelity: db.fidelity || (db.auto ? "full" : "manual"),
    execution: apiExecutionPlan(isTarget ? dbId : dbId, concepts, db),
  };
}

// --- API execution ----------------------------------------------------------
// The rendered `combined` string is what a reviewer reads and pastes into a
// database. It is NOT always what an API can execute. This layer turns the same
// ISR into the shape each API actually honours, and states the fidelity cost.

// OpenAlex parses commas as the AND separator between filters, so a comma can
// never appear inside a filter value.
const openAlexTerm = (term) => {
  const clean = String(term).replace(/,/g, " ").replace(/\s+/g, " ").trim();
  return /\s/.test(clean) ? `"${clean}"` : clean;
};

/** Per-source API execution plan, or null for sources with no API connector.
 *  { fidelity, query, filter?, notes[] } — `notes` are surfaced as provenance
 *  warnings so a fidelity cost is always visible in the search log. */
export function apiExecutionPlan(dbId, concepts, descriptor = null) {
  const db = descriptor || DB[dbId];
  if (!db?.auto) return null;
  const rendered = renderCombined(db, dbId, concepts || []);
  const fidelity = booleanFidelity(dbId);
  const notes = [];

  if (dbId === "openalex") {
    // One filter clause per AND-ed concept: `title_and_abstract.search` honours
    // OR inside a clause, and stacked clauses are AND-ed. That reproduces
    // (a OR b) AND (c OR d) exactly, without the parentheses OpenAlex rejects
    // and without exploding the strategy into a cartesian product of queries.
    const usable = (concepts || []).filter((concept) => (concept.terms || []).some((term) => (term || "").trim()));
    const clauses = [];
    for (const [index, concept] of usable.entries()) {
      const group = (concept.terms || []).map((term) => (term || "").trim()).filter(Boolean).map(openAlexTerm).join(" OR ");
      if (!group) continue;
      const operator = index === 0 ? "AND" : concept.op || "AND";
      if (operator === "OR" && clauses.length) clauses[clauses.length - 1] = `${clauses[clauses.length - 1]} OR ${group}`;
      else if (operator === "NOT") {
        // Dropping a NOT broadens recall, which screening can correct; forcing it
        // into a syntax OpenAlex may misparse could silently narrow the search.
        notes.push(`OpenAlex: the NOT concept "${concept.label || `concept ${index + 1}`}" is not expressible in a filter clause and was omitted, so this line is broader than the written strategy.`);
      } else clauses.push(group);
    }
    if (!clauses.length) return { fidelity, query: rendered?.combined || "", filter: null, notes };
    if (clauses.length > 1) notes.push("OpenAlex: executed as stacked title/abstract filter clauses because the API does not accept nested parentheses.");
    return { fidelity, query: rendered?.combined || "", filter: clauses.map((clause) => `title_and_abstract.search:${clause}`).join(","), notes };
  }

  if (dbId === "crossref") {
    // Crossref has no operators, so a NOT concept's terms would be folded in as
    // POSITIVE relevance terms — actively corrupting the query. Excluded concepts
    // are dropped from the bibliographic query instead.
    const included = [];
    for (const [index, concept] of (concepts || []).entries()) {
      const terms = (concept.terms || []).map((term) => (term || "").trim()).filter(Boolean);
      if (!terms.length) continue;
      if (index > 0 && concept.op === "NOT") {
        notes.push(`Crossref: the NOT concept "${concept.label || `concept ${index + 1}`}" was dropped — Crossref has no operators, so including its terms would search FOR them.`);
        continue;
      }
      included.push(...terms);
    }
    notes.push("Crossref: executed as relevance-ranked free text — it has no Boolean query language and cannot reproduce the strategy.");
    return { fidelity, query: included.join(" "), notes };
  }

  return { fidelity, query: rendered?.combined || "", notes };
}

export function buildStrategy(concepts, dbIds) {
  return dbIds.map((id) => renderForDatabase(id, concepts)).filter(Boolean);
}

// --- ISR from PICO ----------------------------------------------------------
// A minimum viable ISR so the pipeline can run a COMPILED strategy rather than
// pushing the raw review question at every API as free text. It is a starting
// point for term expansion and peer review (PRESS), never a substitute for them.

const splitConceptTerms = (value) => String(value || "")
  .split(/[;,]|\bor\b|\/|\||\n/i)
  .map((part) => part.replace(/^\s*(?:in|among|for|with|patients?|adults?|children)\s+(?=\S)/i, "").trim())
  .map((part) => part.replace(/[.\s]+$/, "").trim())
  .filter((part) => part.length > 2);

/** Derive an ISR from extracted PICO.
 *
 *  Population AND Intervention only. Outcomes are deliberately NOT AND-ed in:
 *  they are inconsistently reported in titles/abstracts and poorly indexed, so
 *  an outcome concept silently loses eligible records — the single most common
 *  way a search strategy under-retrieves. The comparator is OR-ed into the
 *  intervention concept, which is correct when both arms are active treatments
 *  and harmless when the comparator is not searchable. */
export function conceptsFromPico(pico) {
  const concepts = [];
  const notes = [];

  const population = splitConceptTerms(pico?.population);
  if (population.length) concepts.push({ label: "Population", op: "AND", terms: population, mesh: [] });

  const intervention = splitConceptTerms(pico?.intervention);
  const comparator = splitConceptTerms(pico?.comparator);
  const interventionTerms = [...new Set([...intervention, ...comparator])];
  if (interventionTerms.length) {
    concepts.push({ label: comparator.length ? "Intervention or comparator" : "Intervention", op: "AND", terms: interventionTerms, mesh: [] });
    if (comparator.length) notes.push("Comparator terms are OR-ed into the intervention concept rather than AND-ed, which is how a two-arm comparison is searched.");
  }

  const outcomes = (pico?.outcomes || []).flatMap(splitConceptTerms);
  if (outcomes.length) notes.push("Outcome terms were extracted but deliberately left out of the Boolean: outcomes are inconsistently reported in titles and abstracts, so AND-ing them loses eligible records. Add an outcome concept only if recall has been checked.");
  if (concepts.length < 2) notes.push("Fewer than two searchable concepts could be derived from PICO, so this strategy is very broad. Build the concepts explicitly in the Search Strategy builder.");
  notes.push("Auto-derived from PICO: free-text terms only, with no synonym expansion or controlled-vocabulary headings. It requires term expansion and PRESS peer review before it can be reported as a systematic search.");

  return { concepts, suggestedOutcomeTerms: outcomes, notes, derivedFrom: "pico" };
}

export function databaseName(id) {
  return DB[id]?.name || id;
}
