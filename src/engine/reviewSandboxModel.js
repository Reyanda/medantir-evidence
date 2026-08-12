// reviewSandboxModel.js — the shape of a review sandbox, kept pure.
//
// A review is a sandbox with a declared file layout, not a blob in a store. The
// layout is the contract: anyone opening the folder can see what was searched,
// what was retrieved, which PDF backs which record, and what was extracted from
// it. An umbrella review's unit of analysis is a review, so it carries children
// each with their own primaries — flattening them would destroy exactly the
// structure an overlap check needs.

export const REVIEW_KINDS = [
  { id: "systematic", label: "Systematic review", children: false, note: "primary studies only" },
  { id: "umbrella", label: "Umbrella review", children: true, note: "reviews as units, each with its own primaries" },
  { id: "scoping", label: "Scoping review", children: false, note: "primary studies, charted rather than pooled" },
  { id: "rapid", label: "Rapid review", children: false, note: "primary studies, restricted search" },
];

export const isUmbrella = (kind) => kind === "umbrella";

export const PATHS = {
  manifest: "review.yaml",
  question: "protocol/question.yaml",
  eligibility: "protocol/eligibility.md",
  isr: "search/isr.json",
  records: "records/records.json",
  strategy: (db) => `search/strategies/${slug(db)}.txt`,
  results: (db) => `search/results/${slug(db)}.ris`,
  fulltextText: (recordId) => `fulltext/text/${slug(recordId)}.txt`,
  fulltextLink: (recordId) => `fulltext/pdf/${slug(recordId)}.link`,
  study: (studyId) => `studies/${slug(studyId)}`,
  child: (childId) => `children/${slug(childId)}`,
};

export function slug(value) {
  return String(value || "item").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "item";
}

// --- a small YAML writer ---------------------------------------------------
// Only what a manifest needs: maps, lists, scalars. Quoting is conservative —
// anything that could be read as another type is quoted.

function yamlScalar(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const s = String(value);
  if (s === "") return '""';
  if (/^[\w./@+-]+$/.test(s) && !/^(?:true|false|null|yes|no|on|off|~)$/i.test(s) && !/^-?\d/.test(s)) return s;
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

export function toYaml(value, indent = 0) {
  const pad = "  ".repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return `${pad}[]`;
    return value.map((item) => {
      if (item && typeof item === "object") {
        const block = toYaml(item, indent + 1);
        return `${pad}-\n${block}`;
      }
      return `${pad}- ${yamlScalar(item)}`;
    }).join("\n");
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined);
    if (!keys.length) return `${pad}{}`;
    return keys.map((key) => {
      const v = value[key];
      if (Array.isArray(v) || (v && typeof v === "object")) {
        const block = toYaml(v, indent + 1);
        return `${pad}${key}:\n${block}`;
      }
      return `${pad}${key}: ${yamlScalar(v)}`;
    }).join("\n");
  }
  return `${pad}${yamlScalar(value)}`;
}

// --- the manifest ----------------------------------------------------------

/** Which records carry a linked PDF or extracted text, and where those live. */
export function fileLinks(review) {
  const records = review?.objects?.records || [];
  return records
    .filter((r) => r.files?.pdf || r.files?.text || r.fullText)
    .map((r) => ({
      record: r.id,
      title: String(r.title || "").slice(0, 120),
      pdf: r.files?.pdf || null,
      pdf_bytes: r.files?.pdfBytes ?? null,
      pdf_sha256: r.files?.pdfHash || null,
      text: r.files?.text || (r.fullText ? PATHS.fulltextText(r.id) : null),
      text_chars: r.fullText ? r.fullText.length : null,
      pages: r.fullTextPages ?? null,
    }));
}

export function buildManifest(review, { project, children = [] } = {}) {
  const kind = review?.methodology?.typeId === "umbrella" ? "umbrella" : (review?.sandboxKind || "systematic");
  const records = review?.objects?.records || [];
  const studies = review?.objects?.studies || [];
  const searches = review?.objects?.searches || [];
  const links = fileLinks(review);

  return {
    review: {
      title: project?.name || "Untitled review",
      question: review?.question || null,
      kind,
      unit_of_analysis: isUmbrella(kind) ? "reviews, each with its own primary studies" : "primary studies",
      created: review?.createdAt ? new Date(review.createdAt).toISOString() : null,
      methodology: review?.methodology?.typeName || null,
      rob_tool: review?.methodology?.robTool || null,
    },
    protocol: {
      framework: review?.protocol?.prism ? "PRISM" : (review?.protocol?.pico ? "PICO" : null),
      pico_source: review?.protocol?.picoSource || null,
      eligibility: review?.objects?.eligibility ? PATHS.eligibility : null,
      question_file: PATHS.question,
      search_blocks: (review?.protocol?.concepts || []).map((c) => ({
        label: c.label, op: c.op, terms: c.terms || [],
        headings: Object.fromEntries(Object.entries(c.vocab || {}).filter(([, v]) => v?.length)),
      })),
    },
    search: {
      strategy_file: PATHS.isr,
      databases: searches.map((s) => ({
        name: s.name || s.db,
        executed: s.date || null,
        records: s.count ?? 0,
        status: s.status || "ok",
        strategy_file: PATHS.strategy(s.name || s.db),
        results_file: PATHS.results(s.name || s.db),
      })),
      mode: review?.searchSummary?.mode || null,
    },
    corpus: {
      records_file: PATHS.records,
      records: records.length,
      duplicates: records.filter((r) => r.isDuplicate).length,
      screened_in: records.filter((r) => r.tiab === "include").length,
      full_text_retrieved: records.filter((r) => r.retrieval === "retrieved").length,
      with_pdf: links.filter((l) => l.pdf).length,
      with_text: links.filter((l) => l.text).length,
    },
    // The link table is the point of the manifest: a search result is only
    // usable evidence once it points at the document it was read from.
    documents: links,
    studies: studies.map((s) => ({
      id: s.id,
      label: s.title || s.id,
      folder: PATHS.study(s.id),
      extracted: !!s.extracted,
      rob: s.rob?.overallJudgement || null,
      from_record: s.id,
    })),
    ...(isUmbrella(kind)
      ? {
        included_reviews: children.map((c) => ({
          id: c.id,
          title: c.title,
          folder: PATHS.child(c.id),
          primaries: c.primaries ?? 0,
          overlap_checked: !!c.overlapChecked,
        })),
      }
      : {}),
    // The stage list comes from the review itself rather than from the engine:
    // a manifest must describe the review it was built from, including one
    // written by an older version with a different stage set.
    stages: Object.entries(review?.stages || {}).map(([id, state]) => ({
      id,
      status: state?.status || "pending",
      completed: state?.completedAt ? new Date(state.completedAt).toISOString() : null,
    })),
  };
}


/**
 * Corrected covered area — the standard overlap statistic for umbrella reviews.
 * CCA = (N - r) / (r*c - r), where N is the number of publications counted more
 * than once across reviews, r the distinct primaries, c the number of reviews.
 */
export function correctedCoveredArea(children = []) {
  const withIds = children.filter((c) => (c.primaryIds || []).length);
  if (withIds.length < 2) return { ok: false, reason: "at least two included reviews with listed primaries are needed" };
  const counts = new Map();
  for (const child of withIds) {
    for (const id of new Set(child.primaryIds)) counts.set(id, (counts.get(id) || 0) + 1);
  }
  const r = counts.size;
  const c = withIds.length;
  const N = [...counts.values()].reduce((sum, n) => sum + n, 0);
  const denominator = r * c - r;
  if (denominator <= 0) return { ok: false, reason: "not enough distinct primaries to compute overlap" };
  const cca = (N - r) / denominator;
  return {
    ok: true, cca, r, c, N,
    interpretation: cca < 0.05 ? "slight" : cca < 0.10 ? "moderate" : cca < 0.15 ? "high" : "very high",
  };
}

