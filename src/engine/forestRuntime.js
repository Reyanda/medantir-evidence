// forestRuntime.js — binds the Forest Plot Studio canvas to the live review
// runtime: project selection, review.json persistence, and the dataset model.
//
// The canvas renders ONE outcome-level meta-analysis dataset that lives inside
// the review object (`review.objects.meta`), so it persists in the project's
// review.json alongside every other review artifact and survives reload.

import { loadReview, saveReview, createReview } from "./reviewengine.js";
import { listProjects, isReviewProject, getProject, createProject, setActiveProject } from "./projectstore.js";
import { readDataset, writeDataset, emptyDataset } from "./forestModel.js";

export * from "./forestModel.js";

const SAMPLE_PROJECT_ID = "sr_jak_covid19";

export function seedSampleReview() {
  const existing = getProject(SAMPLE_PROJECT_ID);
  if (existing) return existing;

  const project = createProject("JAK Inhibitors in COVID-19 (Living Review)", {
    projectType: "systematic-review",
    mode: "scientific-evidence",
  });

  const question = "In hospitalized adults with COVID-19, do Janus kinase (JAK) inhibitors compared to standard of care reduce 28-day mortality and progression to mechanical ventilation in randomized controlled trials?";
  const review = createReview(question);

  review.methodology = {
    typeId: "intervention",
    typeName: "Intervention systematic review",
    framework: "PRISMA 2020",
    robTool: "RoB 2 (Cochrane Risk of Bias 2)",
    synthesisMethod: "Random-effects meta-analysis (DerSimonian-Laird)",
    embeddedTriangulation: true,
    desc: "Systematic review and meta-analysis of randomized controlled trials evaluating therapeutic interventions against standard of care.",
  };

  review.questions = [
    {
      id: "q1",
      name: "Q1: 28-Day Mortality (Primary)",
      text: "In hospitalized adults with COVID-19, do Janus kinase (JAK) inhibitors compared to standard of care reduce 28-day mortality in randomized controlled trials?",
      primary: true,
      facets: {
        population: ["hospitalized adults with COVID-19", "severe COVID-19"],
        realm: ["clinical medicine", "critical care"],
        intervention: ["JAK inhibitors", "baricitinib", "tofacitinib", "ruxolitinib"],
        standard: ["standard of care", "placebo", "dexamethasone"],
        measure: ["28-day mortality", "all-cause death"],
        time: ["28-day follow-up"],
        geography: [],
        design: ["randomised controlled trial", "RCT"]
      }
    },
    {
      id: "q2",
      name: "Q2: Mechanical Ventilation Progression",
      text: "In hospitalized adults with COVID-19, do JAK inhibitors prevent progression to invasive mechanical ventilation?",
      primary: false,
      facets: {
        population: ["hospitalized adults with COVID-19"],
        realm: ["clinical medicine"],
        intervention: ["JAK inhibitors", "baricitinib"],
        standard: ["standard of care", "placebo"],
        measure: ["invasive mechanical ventilation", "ECMO", "intubation"],
        time: ["28 days"],
        geography: [],
        design: ["RCT"]
      }
    },
    {
      id: "q3",
      name: "Q3: Serious Adverse Events & Infections",
      text: "In COVID-19 patients treated with JAK inhibitors, what is the incidence of secondary bacterial/fungal infections and thromboembolism?",
      primary: false,
      facets: {
        population: ["COVID-19 patients"],
        realm: ["clinical medicine", "pharmacovigilance"],
        intervention: ["JAK inhibitors"],
        standard: ["control", "placebo"],
        measure: ["secondary infection", "thromboembolism", "serious adverse event"],
        time: ["60 days"],
        geography: [],
        design: ["RCT", "prospective cohort"]
      }
    }
  ];

  review.objects.eligibility = "P: Adults hospitalized with confirmed COVID-19\nI: Janus kinase inhibitors (baricitinib, tofacitinib, ruxolitinib)\nC: Placebo or standard care\nO: 28-day all-cause mortality, progression to mechanical ventilation\nS: Randomized controlled trials only";

  const sampleStudies = [
    { id: "CORIMUNO-19", name: "CORIMUNO-19", eventsT: 3, totalT: 128, eventsC: 13, totalC: 130, rob: "Low", pmid: "32871097" },
    { id: "SAVE-MORE", name: "SAVE-MORE", eventsT: 5, totalT: 180, eventsC: 12, totalC: 178, rob: "Low", pmid: "32871098" },
    { id: "RCT-Szabo", name: "RCT-Szabo", eventsT: 2, totalT: 96, eventsC: 9, totalC: 94, rob: "Some", pmid: "32871099" },
    { id: "BACC Bay", name: "BACC Bay", eventsT: 6, totalT: 224, eventsC: 20, totalC: 219, rob: "Low", pmid: "32871100" },
    { id: "JAK-COVID", name: "JAK-COVID", eventsT: 10, totalT: 211, eventsC: 20, totalC: 210, rob: "Low", pmid: "32871101" },
    { id: "COVID STEROID 2", name: "COVID STEROID 2", eventsT: 8, totalT: 150, eventsC: 14, totalC: 150, rob: "Some", pmid: "32871102" },
    { id: "GLIMMER", name: "GLIMMER", eventsT: 4, totalT: 95, eventsC: 9, totalC: 95, rob: "Low", pmid: "32871103" },
    { id: "FLARE", name: "FLARE", eventsT: 7, totalT: 118, eventsC: 12, totalC: 118, rob: "Low", pmid: "32871104" },
    { id: "VENTILATE-JAK", name: "VENTILATE-JAK", eventsT: 3, totalT: 87, eventsC: 8, totalC: 87, rob: "High", pmid: "32871105" },
  ];

  review.objects.studies = sampleStudies.map((s) => ({
    id: s.id,
    studyId: s.id,
    title: `${s.name} RCT`,
    year: "2021",
    pmid: s.pmid,
    extracted: true,
    rob: { overallJudgement: s.rob },
  }));

  const outcome = {
    id: "outcome_1",
    name: "All-cause mortality (28-day)",
    measure: "RR",
    model: "random",
    rows: sampleStudies.map((s) => ({
      studyId: s.id,
      studyName: s.name,
      year: "2021",
      eventsT: s.eventsT,
      totalT: s.totalT,
      eventsC: s.eventsC,
      totalC: s.totalC,
      rob: s.rob,
      pmid: s.pmid,
      manual: false,
    })),
  };

  review.objects.meta = {
    version: 1,
    activeOutcomeId: outcome.id,
    outcomes: [outcome],
  };

  saveReview(project.id, review);
  setActiveProject(project.id);
  return project;
}

// --- project / review binding ---------------------------------------------

export function listReviewProjects() {
  const list = listProjects().filter(isReviewProject);
  if (!list.length) {
    const seeded = seedSampleReview();
    if (seeded) return [seeded];
  }
  return list;
}

// Loads everything the studio needs for one project in a single call.
export function loadStudio(projectId) {
  if (!projectId) return { project: null, review: null, dataset: emptyDataset() };
  const project = getProject(projectId);
  const review = loadReview(projectId);
  const dataset = readDataset(review);
  return { project, review, dataset };
}

// Persists the dataset back into review.json. Returns the updated review.
export function persistDataset(projectId, review, dataset) {
  if (!review) return review;
  const next = writeDataset(review, dataset);
  if (projectId) saveReview(projectId, next);
  return next;
}
