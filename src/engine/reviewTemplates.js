// reviewTemplates.js — what a review template is allowed to contain.
//
// A template supplies METHOD STRUCTURE ONLY: which review type from
// reviewtypes.js, which sandbox kind from reviewSandboxModel.js, which PRISM
// facets matter, the headings an eligibility scaffold needs, which pipeline
// stages apply, and which realm routes the databases.
//
// A template never supplies a question, facet terms, a population, an
// intervention, an outcome, a record, a study, an effect estimate, or any real
// person, institution, product or trial name. Shipping content as a starting
// point makes somebody else's review look like the operator's own; the unit
// test in tests/unit/reviewTemplates.test.js holds that line.
//
// Pure by design: no storage import, so it stays node-testable.

import { FRAMEWORKS, ROB_TOOLS, SYNTHESIS, getReviewType } from "./reviewtypes.js";
import { REVIEW_KINDS } from "./reviewSandboxModel.js";

// The pipeline stages a template may declare applicability against. These are
// the stage ids of the review state machine in reviewengine.js, repeated here
// rather than imported because reviewengine binds to the project store and this
// module must stay pure.
export const TEMPLATE_STAGE_IDS = [
  "protocol", "search", "dedup", "tiab", "retrieval", "fulltext",
  "extraction", "rob", "synthesis", "grade", "etd", "report",
];

// PRISM facet keys (QuestionBuilder owns the labels and the routing). A
// template names the facets that matter for its design; it never names a term.
export const TEMPLATE_FACET_KEYS = [
  "population", "realm", "intervention", "standard", "measure", "time", "geography", "design",
];

export const STAGE_APPLICABILITY = ["applicable", "n/a"];

// Criteria headings only — the reviewer writes what goes after the colon.
const CORE_CRITERIA = ["Population", "Intervention", "Comparator", "Outcome", "Study design", "Setting", "Publication type"];

export const TEMPLATES = [
  {
    id: "fresh",
    label: "Start fresh",
    typeId: "systematic",
    kind: "systematic",
    realm: "clinical medicine",
    facets: ["population", "intervention", "standard"],
    criteria: CORE_CRITERIA,
    notApplicable: [],
    note: "Nothing is pre-filled beyond the stage machine. Every methodological choice stays open.",
  },
  {
    id: "intervention",
    label: "Intervention effectiveness",
    typeId: "systematic",
    kind: "systematic",
    realm: "clinical medicine",
    facets: ["population", "intervention", "standard", "measure", "design"],
    criteria: CORE_CRITERIA,
    notApplicable: [],
    note: "Effect of an intervention against a comparator. Risk of bias is judged per outcome, not per study alone.",
  },
  {
    id: "prevalence",
    label: "Prevalence / burden",
    typeId: "prevalence",
    kind: "systematic",
    realm: "public health",
    facets: ["population", "realm", "measure", "geography", "time"],
    criteria: ["Population", "Condition or event", "Case definition", "Sampling frame", "Study design", "Setting", "Publication type"],
    notApplicable: [],
    note: "No comparator arm. Pooling prevalence is a decision to justify, not a default — heterogeneity between settings is usually the finding.",
  },
  {
    id: "dta",
    label: "Diagnostic accuracy",
    typeId: "dta",
    kind: "systematic",
    realm: "clinical medicine",
    facets: ["population", "intervention", "standard", "measure"],
    criteria: ["Population", "Index test", "Reference standard", "Target condition", "Study design", "Setting", "Publication type"],
    notApplicable: [],
    note: "The intervention facet holds the index test and the comparator facet holds the reference standard; accuracy is meaningless without both.",
  },
  {
    id: "umbrella",
    label: "Umbrella of reviews",
    typeId: "umbrella",
    kind: "umbrella",
    realm: "clinical medicine",
    facets: ["population", "intervention", "standard", "measure"],
    criteria: ["Population", "Intervention", "Comparator", "Outcome", "Review type", "Setting", "Publication type"],
    notApplicable: [],
    note: "The unit of analysis is a review, each carrying its own primaries, so overlap (corrected covered area) can be computed.",
  },
  {
    id: "scoping",
    label: "Scoping",
    typeId: "scoping",
    kind: "scoping",
    realm: "clinical medicine",
    facets: ["population", "realm", "intervention", "measure", "geography"],
    criteria: ["Population", "Concept", "Context", "Evidence source type", "Study design", "Setting", "Publication type"],
    notApplicable: ["rob", "grade"],
    note: "Evidence is charted, not pooled: no effect estimate, and critical appraisal is not a requirement of PRISMA-ScR.",
  },
  {
    id: "rapid",
    label: "Rapid (restricted)",
    typeId: "rapid",
    kind: "rapid",
    realm: "clinical medicine",
    facets: ["population", "intervention", "standard", "measure"],
    criteria: CORE_CRITERIA,
    notApplicable: [],
    // Headings only. A restriction is a deviation from a full review and has to
    // be recorded as one, so the surface asks for it rather than assuming it.
    deviations: ["Databases restricted to", "Date limit", "Language limit", "Single-reviewer screening", "Grey literature omitted"],
    note: "A restricted search traded against time. Each restriction is recorded as a deviation and reported as a limitation.",
  },
];

export function getTemplate(id) {
  return TEMPLATES.find((t) => t.id === id) || TEMPLATES[0];
}

/** The sandbox kind's own declaration of whether this design carries children. */
export function templateChildren(template) {
  return !!REVIEW_KINDS.find((k) => k.id === template?.kind)?.children;
}

/** The full methodology stack a template inherits from reviewtypes.js. */
export function templateMethodology(template) {
  const type = getReviewType(template?.typeId);
  return {
    typeId: type.id,
    typeName: type.name,
    framework: FRAMEWORKS[type.framework],
    robTool: ROB_TOOLS[type.rob],
    synthesis: SYNTHESIS[type.synthesis],
  };
}

/** Every stage, with the ones this design does not run marked n/a. */
export function stageApplicability(template) {
  const na = new Set(template?.notApplicable || []);
  return Object.fromEntries(TEMPLATE_STAGE_IDS.map((id) => [id, na.has(id) ? "n/a" : "applicable"]));
}

/**
 * The eligibility scaffold: headings with nothing after the colon. It is kept
 * out of review.objects.eligibility on purpose — that field gates the protocol
 * stage, and a scaffold nobody has filled in must not satisfy a gate.
 */
export function eligibilityScaffold(template) {
  const criteria = template?.criteria || [];
  return ["INCLUDE", ...criteria.map((c) => `${c}:`), "", "EXCLUDE", ...criteria.map((c) => `${c}:`)].join("\n");
}

/** Empty term lists for the facets this design cares about. Structure, not content. */
export function templateFacets(template) {
  return Object.fromEntries((template?.facets || []).filter((k) => TEMPLATE_FACET_KEYS.includes(k)).map((k) => [k, []]));
}

/**
 * What creating from a template writes. Returns shapes only: the caller owns
 * the project store and the review state machine, so this stays pure.
 *
 * `databases` is passed in (routed from the realm by QuestionBuilder's
 * routeDatabases) rather than routed here, because that router lives with the
 * question surface and there must not be a second copy of it.
 */
export function applyTemplate(template, { name = "", databases = [] } = {}) {
  const t = template && template.id ? template : TEMPLATES[0];
  const methodology = templateMethodology(t);
  return {
    project: {
      name: String(name || "").trim() || `Untitled ${t.label.toLowerCase()} review`,
      projectType: "systematic-review",
      mode: "academic",
    },
    review: {
      // No question: the operator writes it on the Question tab, and everything
      // downstream compiles from what they write.
      question: "",
      sandboxKind: t.kind,
      template: { id: t.id, label: t.label, appliedFrom: "review template" },
      methodology,
      stageApplicability: stageApplicability(t),
      protocol: {
        prism: {
          facets: templateFacets(t),
          includeMeasure: false,
          includeDesign: false,
          noise: [],
          headings: {},
          routedDatabases: [...databases],
          tokenised: true,
        },
        eligibilityScaffold: [...(t.criteria || [])],
        ...(t.deviations ? { deviationHeadings: [...t.deviations] } : {}),
      },
      selectedSources: [...databases],
    },
  };
}
