// reviewtypes.js — the methodology intelligence of the Evidence Review Engine.
//
// Generalises "SR Builder" beyond systematic reviews: a registry of review
// methodologies, each mapped to its reporting standard, appropriate risk-of-bias
// tools (by study design), and default synthesis approach. recommendReviewType()
// interprets a research question and proposes the methodology + framework — the
// first stage of the closed-loop pipeline (interpret → recommend → protocol → …).

// Reporting standards / frameworks the engine recognises.
export const FRAMEWORKS = {
  prisma2020: "PRISMA 2020", prisma_scr: "PRISMA-ScR", prisma_s: "PRISMA-S",
  prisma_dta: "PRISMA-DTA", prisma_p: "PRISMA-P", moose: "MOOSE", strobe: "STROBE",
  arrive: "ARRIVE", consort: "CONSORT", cheers: "CHEERS", entreq: "ENTREQ",
  swim: "SWiM", roses: "ROSES", rameses: "RAMESES", probast: "PROBAST", tripod: "TRIPOD",
};

// Risk-of-bias / appraisal tools by study design or evidence type.
export const ROB_TOOLS = {
  rct: "RoB 2", nrsi: "ROBINS-I", exposure: "ROBINS-E", dta: "QUADAS-2",
  dta_comparative: "QUADAS-C", prediction: "PROBAST", sr: "ROBIS", sr_appraisal: "AMSTAR 2",
  animal: "SYRCLE", tox: "OHAT", environmental: "Navigation Guide", qualitative: "CASP",
  prognostic: "QUIPS", cross_sectional: "AXIS", cohort_nos: "Newcastle–Ottawa", mixed: "MMAT",
};

// Synthesis approaches.
export const SYNTHESIS = {
  pairwise: "Pairwise meta-analysis (random-effects default)",
  nma: "Network meta-analysis", dta: "Diagnostic accuracy meta-analysis",
  prevalence: "Prevalence meta-analysis", ipd: "Individual participant data",
  swim: "Synthesis without meta-analysis (SWiM)", thematic: "Thematic synthesis",
  framework: "Framework synthesis", realist: "Realist synthesis",
  mechanistic: "Mechanistic evidence synthesis", causal: "Causal triangulation",
  mapping: "Evidence mapping", narrative: "Structured narrative synthesis",
};

// Review-type registry. `match` = keyword regex for the recommender.
export const REVIEW_TYPES = [
  { id: "systematic", name: "Systematic Review", framework: "prisma2020", rob: "rct", synthesis: "pairwise",
    match: "systematic review|effectiveness|efficacy|intervention|treatment|does .* work", desc: "Comprehensive, protocol-driven review of intervention effects." },
  { id: "meta_analysis", name: "Meta-analysis", framework: "prisma2020", rob: "rct", synthesis: "pairwise",
    match: "meta-?analysis|pool|pooled effect|forest plot", desc: "Quantitative synthesis of comparable effect estimates." },
  { id: "scoping", name: "Scoping Review", framework: "prisma_scr", rob: "sr", synthesis: "mapping",
    match: "scoping|map the literature|breadth|what is known|extent of|research activity", desc: "Maps the breadth of evidence and gaps; no effect estimate." },
  { id: "rapid", name: "Rapid Review", framework: "prisma2020", rob: "rct", synthesis: "swim",
    match: "rapid review|urgent|quick|time-?constrained|decision brief", desc: "Streamlined SR for time-sensitive decisions." },
  { id: "umbrella", name: "Umbrella Review", framework: "prisma2020", rob: "sr_appraisal", synthesis: "narrative",
    match: "umbrella|overview of reviews|review of reviews", desc: "Synthesis of existing systematic reviews." },
  { id: "dta", name: "Diagnostic Test Accuracy", framework: "prisma_dta", rob: "dta", synthesis: "dta",
    match: "diagnostic|sensitivity|specificity|test accuracy|screening test", desc: "Accuracy of diagnostic or screening tests." },
  { id: "prognostic", name: "Prognostic Factor Review", framework: "prisma2020", rob: "prognostic", synthesis: "pairwise",
    match: "prognos|predictor|risk factor for outcome|prognostic factor", desc: "Association of factors with future outcomes." },
  { id: "prediction", name: "Prediction Model Review", framework: "tripod", rob: "prediction", synthesis: "narrative",
    match: "prediction model|risk score|prognostic model|clinical calculator|nomogram", desc: "Development/validation of prediction models." },
  { id: "prevalence", name: "Prevalence / Incidence Review", framework: "prisma2020", rob: "cross_sectional", synthesis: "prevalence",
    match: "prevalence|incidence|burden|how common|frequency of", desc: "Burden/frequency of a condition." },
  { id: "qualitative", name: "Qualitative Evidence Synthesis", framework: "entreq", rob: "qualitative", synthesis: "thematic",
    match: "qualitative|experience|perception|views|barriers and facilitators|lived", desc: "Synthesis of qualitative findings." },
  { id: "mixed", name: "Mixed-Methods Review", framework: "prisma2020", rob: "mixed", synthesis: "framework",
    match: "mixed-?methods|quantitative and qualitative", desc: "Integrates quantitative + qualitative evidence." },
  { id: "realist", name: "Realist Review", framework: "rameses", rob: "qualitative", synthesis: "realist",
    match: "realist|how and why|mechanism.*context|what works for whom", desc: "Theory-driven: what works, for whom, in what context." },
  { id: "mechanistic", name: "Mechanistic / Causal Synthesis", framework: "prisma2020", rob: "exposure", synthesis: "mechanistic",
    match: "mechanis|pathway|causal|mediator|biological plausibility|triangulation", desc: "Mechanism and causal-evidence synthesis." },
  { id: "adverse", name: "Adverse Effects Review", framework: "prisma2020", rob: "nrsi", synthesis: "pairwise",
    match: "adverse|safety|harm|side effect|toxicit", desc: "Harms/safety across designs." },
  { id: "economic", name: "Economic Evidence Review", framework: "cheers", rob: "sr", synthesis: "narrative",
    match: "cost-?effectiveness|economic|cost|budget impact|health technology assessment|hta", desc: "Economic/cost-effectiveness evidence." },
  { id: "animal", name: "Animal / Preclinical Review", framework: "arrive", rob: "animal", synthesis: "pairwise",
    match: "animal|preclinical|in vivo|rodent|murine|mouse|rat model", desc: "Preclinical/animal-study synthesis." },
  { id: "environmental", name: "Environmental Evidence Review", framework: "roses", rob: "environmental", synthesis: "mapping",
    match: "environmental|ecolog|exposure to|pollut|climate", desc: "Environmental/ecological evidence." },
  { id: "map", name: "Evidence-Gap Map", framework: "prisma_scr", rob: "sr", synthesis: "mapping",
    match: "evidence map|gap map|evidence gap|research gap", desc: "Systematic map of what evidence exists and where the gaps are." },
];

const NARRATIVE_FALLBACK = { id: "systematic", name: "Systematic Review", framework: "prisma2020", rob: "rct", synthesis: "pairwise", desc: "Default methodology." };

export function getReviewType(id) {
  return REVIEW_TYPES.find((r) => r.id === id) || NARRATIVE_FALLBACK;
}

// Interpret a research question → recommend a review type + full methodology stack
// (reporting standard, RoB tool, synthesis). Deterministic keyword scoring;
// falls back to Systematic Review. Returns ranked alternatives too.
export function recommendReviewType(question) {
  const text = String(question || "");
  const scored = REVIEW_TYPES
    .map((r) => ({ type: r, score: (text.match(new RegExp(r.match, "gi")) || []).length }))
    .sort((a, b) => b.score - a.score);
  const top = scored[0];
  const chosen = top && top.score > 0 ? top.type : NARRATIVE_FALLBACK;
  return {
    type: chosen,
    framework: FRAMEWORKS[chosen.framework],
    robTool: ROB_TOOLS[chosen.rob],
    synthesis: SYNTHESIS[chosen.synthesis],
    confident: (top?.score || 0) > 0,
    alternatives: scored.filter((s) => s.score > 0 && s.type.id !== chosen.id).slice(0, 3).map((s) => ({ id: s.type.id, name: s.type.name, score: s.score })),
  };
}
