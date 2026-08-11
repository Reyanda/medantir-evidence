import type {
  ProtocolAuthor,
  ProtocolCitation,
  ProtocolDraft,
  ProtocolSection,
  ResearcherIdentity,
  ReviewPlan,
  ReviewRequest,
  ReviewType,
  SearchStrategy,
  SearchStrategyTestReport,
} from '../core/types.js';
import { id } from '../core/utils.js';

const accessedAt = '2026-07-13';

export const protocolCitationLibrary: Record<string, ProtocolCitation> = {
  'PRISMA-P': {
    id: 'PRISMA-P',
    title: 'Preferred reporting items for systematic review and meta-analysis protocols (PRISMA-P)',
    organisation: 'PRISMA Statement',
    year: 2015,
    url: 'https://www.prisma-statement.org/protocols',
    doi: '10.1136/bmj.g7647',
    accessedAt,
  },
  'PRISMA-2020': {
    id: 'PRISMA-2020',
    title: 'PRISMA 2020 statement',
    organisation: 'PRISMA Statement',
    year: 2021,
    url: 'https://www.prisma-statement.org/prisma-2020',
    accessedAt,
  },
  'PRISMA-S': {
    id: 'PRISMA-S',
    title: 'PRISMA-S: an extension to the PRISMA Statement for reporting literature searches',
    organisation: 'Systematic Reviews',
    year: 2021,
    url: 'https://systematicreviewsjournal.biomedcentral.com/articles/10.1186/s13643-020-01542-z',
    doi: '10.1186/s13643-020-01542-z',
    accessedAt,
  },
  PRESS: {
    id: 'PRESS',
    title: 'PRESS Peer Review of Electronic Search Strategies: 2015 Guideline Statement',
    organisation: 'CADTH',
    year: 2016,
    url: 'https://www.cadth.ca/press-peer-review-electronic-search-strategies-2015-guideline-explanation-and-elaboration',
    accessedAt,
  },
  COCHRANE: {
    id: 'COCHRANE',
    title: 'Cochrane Handbook for Systematic Reviews of Interventions',
    organisation: 'Cochrane',
    url: 'https://training.cochrane.org/handbook/current',
    accessedAt,
  },
  JBI: {
    id: 'JBI',
    title: 'JBI Manual for Evidence Synthesis',
    organisation: 'JBI',
    url: 'https://jbi-global-wiki.refined.site/space/MANUAL',
    accessedAt,
  },
  PROSPERO: {
    id: 'PROSPERO',
    title: 'PROSPERO International prospective register of systematic reviews',
    organisation: 'Centre for Reviews and Dissemination, University of York',
    url: 'https://www.crd.york.ac.uk/prospero/',
    accessedAt,
  },
  OSF: {
    id: 'OSF',
    title: 'OSF Registrations and Preregistrations',
    organisation: 'Center for Open Science',
    url: 'https://help.osf.io/article/330-welcome-to-registrations',
    accessedAt,
  },
  ZENODO: {
    id: 'ZENODO',
    title: 'Zenodo REST API and research-output deposits',
    organisation: 'Zenodo/CERN',
    url: 'https://developers.zenodo.org/',
    accessedAt,
  },
  ORCID: {
    id: 'ORCID',
    title: 'ORCID OAuth sign-in guidelines',
    organisation: 'ORCID',
    url: 'https://info.orcid.org/documentation/integration-guide/orcid-oauth-sign-in-guidelines/',
    accessedAt,
  },
  GITHUB: {
    id: 'GITHUB',
    title: 'Referencing and citing content in GitHub repositories',
    organisation: 'GitHub',
    url: 'https://docs.github.com/repositories/archiving-a-github-repository/referencing-and-citing-content',
    accessedAt,
  },
  'PRISMA-SCR': {
    id: 'PRISMA-SCR',
    title: 'PRISMA extension for scoping reviews',
    organisation: 'PRISMA Statement',
    year: 2018,
    url: 'https://www.prisma-statement.org/scoping',
    accessedAt,
  },
  'PRISMA-DTA': {
    id: 'PRISMA-DTA',
    title: 'PRISMA extension for diagnostic test accuracy reviews',
    organisation: 'PRISMA Statement',
    url: 'https://www.prisma-statement.org/diagnostic-test-accuracy',
    accessedAt,
  },
  'PRISMA-NMA': {
    id: 'PRISMA-NMA',
    title: 'PRISMA extension for network meta-analysis',
    organisation: 'PRISMA Statement',
    url: 'https://www.prisma-statement.org/network-meta-analyses',
    accessedAt,
  },
  ARRIVE: {
    id: 'ARRIVE',
    title: 'ARRIVE guidelines 2.0',
    organisation: 'NC3Rs',
    year: 2020,
    url: 'https://arriveguidelines.org/arrive-guidelines',
    accessedAt,
  },
  OHAT: {
    id: 'OHAT',
    title: 'OHAT Handbook for conducting a literature-based health assessment',
    organisation: 'National Toxicology Program',
    url: 'https://ntp.niehs.nih.gov/whatwestudy/assessments/noncancer/handbook',
    accessedAt,
  },
  CAMPBELL: {
    id: 'CAMPBELL',
    title: 'Campbell systematic reviews and evidence and gap maps guidance',
    organisation: 'Campbell Collaboration',
    url: 'https://www.campbellcollaboration.org/research-resources.html',
    accessedAt,
  },
};

interface SectionBlueprint {
  id: string;
  heading: string;
  purpose: string;
  required?: boolean;
  citations?: string[];
  rules?: string[];
  content(request: ReviewRequest, plan: ReviewPlan): string;
}

const q = (value: string | undefined, fallback: string): string => value?.trim() || fallback;
const list = (items: string[] | undefined, fallback: string): string => items && items.length > 0 ? items.join('; ') : fallback;

const commonBlueprints: SectionBlueprint[] = [
  {
    id: 'administrative-information',
    heading: 'Administrative information, registration and version control',
    purpose: 'Identify the protocol, version, status, registry plan and amendment policy.',
    citations: ['PRISMA-P', 'PROSPERO', 'OSF'],
    rules: ['State protocol version and date', 'Name intended registries', 'Describe how amendments will be dated, justified and preserved'],
    content: (request) => `Protocol version: ${request.protocolDevelopment?.protocolVersion ?? '1.0'}. The protocol will be prospectively registered before formal screening or extraction where the selected registry permits. Every amendment will receive a version number, date, rationale, affected methods, approver and immutable checksum.`,
  },
  {
    id: 'authors-contributions',
    heading: 'Authors, affiliations, ORCID iDs and contributions',
    purpose: 'Establish accountable authorship, persistent identities and role separation.',
    citations: ['PRISMA-P', 'ORCID'],
    rules: ['Identify the guarantor', 'Identify the corresponding author', 'Record authenticated ORCID iDs', 'Assign CRediT-style roles'],
    content: () => 'List every author, affiliation, authenticated ORCID iD, email, contribution, conflicts and approval status. At least two methodologically independent reviewers should be identified when dual processes are planned.',
  },
  {
    id: 'support-conflicts',
    heading: 'Support, funding, sponsor role and competing interests',
    purpose: 'Make financial and intellectual influences transparent.',
    citations: ['PRISMA-P'],
    rules: ['Name funder and grant', 'State sponsor role', 'Declare financial and non-financial conflicts'],
    content: (request) => `Funder: ${q(request.protocolDevelopment?.funder, '[Specify funder or state no external funding]')}. Grant: ${q(request.protocolDevelopment?.grantNumber, '[Specify grant number]')}. Competing interests: ${q(request.protocolDevelopment?.conflictsOfInterest, '[Declare all interests]')}.`,
  },
  {
    id: 'rationale',
    heading: 'Rationale and existing-review landscape',
    purpose: 'Explain the problem, why the review is needed and how it differs from existing syntheses.',
    citations: ['PRISMA-P', 'COCHRANE', 'JBI'],
    rules: ['Describe burden and uncertainty', 'Summarise existing reviews', 'Justify de novo, update, adaptation or overview route'],
    content: (request) => `${request.question.objective} The protocol will document the existing-review search, currency assessment, directness assessment and trustworthiness appraisal before commissioning a de novo primary-study search.`,
  },
  {
    id: 'objectives',
    heading: 'Objectives and review questions',
    purpose: 'State the primary and secondary objectives in an answerable framework.',
    citations: ['PRISMA-P'],
    rules: ['State one primary objective', 'Define any secondary, subgroup, equity, harms or mechanistic objectives'],
    content: (request, plan) => `Primary objective: ${request.question.objective}\nQuestion framework: ${plan.questionFramework}.\nPopulation/context: ${q(request.question.population, '[Specify]')}.\nIntervention, exposure, test, factor or phenomenon: ${q(request.question.interventionOrExposure, '[Specify]')}.\nComparator: ${q(request.question.comparator, '[Specify or justify absence]')}.\nOutcomes/concepts: ${list(request.question.outcomes ?? request.question.concepts, '[Specify]')}.`,
  },
  {
    id: 'eligibility',
    heading: 'Eligibility criteria',
    purpose: 'Predefine inclusion and exclusion criteria without relying on post hoc judgement.',
    citations: ['PRISMA-P', 'COCHRANE', 'JBI'],
    rules: ['Specify population, interventions/exposures, comparators, outcomes and designs', 'Specify report status, language, date and setting restrictions', 'Justify every restriction'],
    content: (_request, plan) => `Include: ${plan.eligibility.include.join('; ')}.\nExclude: ${plan.eligibility.exclude.join('; ')}.\nRestrictions will not be introduced after results are known without a documented amendment.`,
  },
  {
    id: 'information-sources',
    heading: 'Information sources and discovery routes',
    purpose: 'Define all bibliographic, grey-literature, registry and citation sources.',
    citations: ['PRISMA-P', 'PRISMA-S'],
    rules: ['List database and platform separately', 'State coverage dates', 'Include registries and grey literature when relevant', 'Plan backward and forward citation searching'],
    content: (request) => `Planned bibliographic databases and platforms: ${request.databases.join(', ')}. Additional routes will include reference-list checking, forward citation searching, trial or study registries, relevant organisational websites, preprints and author contact when justified.`,
  },
  {
    id: 'search-strategy',
    heading: 'Search strategy development, testing and peer review',
    purpose: 'Create reproducible, database-specific searches and test them before registration.',
    citations: ['PRISMA-S', 'PRESS'],
    rules: ['Provide complete line-by-line strategy for at least one database', 'Translate syntax independently for every platform', 'Test known-item recall and concept coverage', 'Reconcile result and export counts', 'Record PRESS review'],
    content: (request, plan) => `Searches will follow ${plan.searchStandards.join(', ')}. Each database will have a native syntax strategy, lint report, concept-coverage report, known-item test where benchmark studies are available, pilot result count, export test and change log. Search peer review required: ${request.protocolDevelopment?.searchPeerReviewRequired === false ? 'no, with justification required' : 'yes'}.`,
  },
  {
    id: 'records-management',
    heading: 'Study records, deduplication and data management',
    purpose: 'Define provenance-preserving record management.',
    citations: ['PRISMA-P', 'PRISMA-S'],
    rules: ['Preserve raw exports', 'Describe deterministic and probabilistic deduplication', 'Link multiple reports of one study', 'Define backup, access and retention'],
    content: (request) => `Raw exports, transformed records, duplicate clusters, screening decisions, PDFs, extracted text and analysis objects will be versioned. ${q(request.protocolDevelopment?.dataManagementPlan, 'The default plan preserves source files, hashes, provenance, role-based access and reversible decisions.')}`,
  },
  {
    id: 'selection-process',
    heading: 'Selection process and conflict resolution',
    purpose: 'Predefine title/abstract and full-text screening procedures.',
    citations: ['PRISMA-P', 'PRISMA-2020'],
    rules: ['State number of reviewers', 'State blinding options', 'State conflict resolution', 'State automation role and confidence thresholds'],
    content: (request) => `${request.dualScreening === false ? 'Single screening is planned and requires an explicit justification plus verification sample.' : 'Two independent reviewers will screen records.'} Automated decisions must expose rationale and cited evidence. Human reviewers may work blinded or unblinded, and all overrides will be versioned.`,
  },
  {
    id: 'data-collection',
    heading: 'Full-text retrieval, extraction and study-family linkage',
    purpose: 'Define lawful retrieval, section-aware extraction and reconciliation.',
    citations: ['PRISMA-P', 'PRISMA-2020'],
    rules: ['Specify duplicate extraction', 'Define source hierarchy', 'Extract page-level evidence', 'Link reports to underlying studies'],
    content: () => 'The extraction form will be piloted. Every substantive field will be linked to page-level evidence from rationale, objectives, methods, results, discussion and limitations. Conflicting values across reports, registries, tables and supplements will be retained and adjudicated rather than silently overwritten.',
  },
  {
    id: 'data-items-outcomes',
    heading: 'Data items, outcomes and prioritisation',
    purpose: 'Define all variables and prevent selective outcome handling.',
    citations: ['PRISMA-P'],
    rules: ['Define primary and secondary outcomes', 'Define time points and effect measures', 'Define equity and context variables', 'Define missing-data handling'],
    content: (request) => `Priority outcomes/concepts: ${list(request.question.outcomes ?? request.question.concepts, '[Specify]')}. The protocol will define outcome hierarchy, measurement instrument, time origin, follow-up window, effect measure, minimally important difference where available and rules for multiple eligible measures.`,
  },
  {
    id: 'risk-of-bias',
    heading: 'Risk of bias, methodological limitations and applicability',
    purpose: 'Use design-appropriate appraisal with evidence-bound judgements.',
    citations: ['PRISMA-P', 'COCHRANE', 'JBI'],
    rules: ['Name the tool and version', 'Define domain-level decision rules', 'Use two reviewers when feasible', 'Separate reported facts from judgement'],
    content: (_request, plan) => `Planned tools: ${plan.appraisalTools.length > 0 ? plan.appraisalTools.join(', ') : 'No mandatory critical appraisal; any optional appraisal will be justified'}. Every signalling-question answer and judgement will cite source text.`,
  },
  {
    id: 'synthesis',
    heading: 'Synthesis and analysis plan',
    purpose: 'Prespecify when and how evidence will be combined.',
    citations: ['PRISMA-P', 'COCHRANE', 'JBI'],
    rules: ['Define synthesis eligibility', 'Define effect transformations', 'Define heterogeneity and dependency handling', 'Define sensitivity and subgroup analyses', 'Name software and reproducibility controls'],
    content: (_request, plan) => `Primary synthesis mode: ${plan.synthesisMode}. Quantitative pooling will occur only when clinical, methodological and statistical compatibility are defensible. Model assumptions, estimators, priors where applicable, dependency structures, missing data, heterogeneity, robustness analyses and software versions will be frozen before final analysis.`,
  },
  {
    id: 'meta-bias-certainty',
    heading: 'Reporting biases, certainty and confidence in findings',
    purpose: 'Define assessment of missing evidence and confidence in conclusions.',
    citations: ['PRISMA-P', 'COCHRANE', 'JBI'],
    rules: ['Define publication-bias methods', 'Name certainty framework', 'Define outcome-level judgement procedure'],
    content: (_request, plan) => `Certainty framework: ${plan.certaintyFramework}. Selective reporting, unavailable results, small-study effects and dissemination bias will be assessed using methods appropriate to the evidence stream and number of studies.`,
  },
  {
    id: 'equity-context-mechanisms',
    heading: 'Equity, context, mechanisms and transferability',
    purpose: 'Avoid average-only conclusions and document contextual heterogeneity.',
    citations: ['PRISMA-2020'],
    rules: ['Define prespecified equity dimensions', 'Define context and implementation variables', 'Separate effect modification from mechanism claims'],
    content: () => 'Where relevant, extraction and synthesis will consider place of residence, race/ethnicity/culture/language, occupation, gender/sex, religion, education, socioeconomic status, social capital, disability and other vulnerability dimensions, together with setting, system capacity, implementation fidelity and causal mechanisms.',
  },
  {
    id: 'ethics-involvement-dissemination',
    heading: 'Ethics, stakeholder involvement and dissemination',
    purpose: 'Describe ethics status, involvement and dissemination routes.',
    citations: ['PRISMA-P', 'OSF', 'ZENODO', 'GITHUB'],
    rules: ['State ethics requirement', 'Describe stakeholder or public involvement', 'Describe publication and open-science plan'],
    content: (request) => `Ethics: secondary synthesis normally uses published or lawfully accessed data, but institutional requirements will be checked. Stakeholder involvement: ${q(request.protocolDevelopment?.patientPublicInvolvement, '[Specify]')}. Dissemination: ${q(request.protocolDevelopment?.disseminationPlan, 'Peer-reviewed publication, conference or policy outputs, an OSF registration, versioned GitHub materials and a Zenodo archival release where appropriate.')}`,
  },
  {
    id: 'timeline-governance',
    heading: 'Timeline, governance, stopping rules and amendments',
    purpose: 'Make operational decisions inspectable before work begins.',
    citations: ['PRISMA-P'],
    rules: ['State start and completion dates', 'Define approval gates', 'Define protocol-deviation process'],
    content: (request) => `Anticipated start: ${q(request.protocolDevelopment?.anticipatedStartDate, '[Specify]')}. Anticipated completion: ${q(request.protocolDevelopment?.anticipatedCompletionDate, '[Specify]')}. The guarantor will approve search changes, eligibility changes, synthesis changes and final conclusions. Deviations will be logged before downstream outputs are regenerated.`,
  },
];

const typeSpecific: Record<ReviewType, SectionBlueprint[]> = {
  systematic: [{ id: 'generic-systematic-specifics', heading: 'Systematic-review design specification', purpose: 'Resolve the exact evidence family before execution.', citations: ['COCHRANE', 'JBI'], content: (_r, p) => `Evidence streams: ${p.evidenceStreams.join(', ')}. A narrower review-family protocol must replace generic methods whenever diagnostic, prognosis, prediction, prevalence, qualitative, economic or network methods are needed.` }],
  intervention: [{ id: 'intervention-specifics', heading: 'Intervention and comparator specification', purpose: 'Define intervention components and causal contrast.', citations: ['COCHRANE'], content: (r) => `Intervention: ${q(r.question.interventionOrExposure, '[Specify components, dose, timing, delivery and co-interventions]')}. Comparator: ${q(r.question.comparator, '[Specify]')}. Define estimand, treatment versions, adherence, contamination, cluster effects and harms.` }],
  'diagnostic-accuracy': [{ id: 'dta-specifics', heading: 'Diagnostic accuracy specification', purpose: 'Define PIRD elements and paired accuracy synthesis.', citations: ['PRISMA-DTA', 'COCHRANE'], content: () => 'Specify participants, index test, target condition, reference standard, thresholds, test role and clinical pathway. Extract 2×2 data or equivalent and use bivariate/HSROC methods rather than separate univariate pooling.' }],
  'overall-prognosis': [{ id: 'overall-prognosis-specifics', heading: 'Overall prognosis specification', purpose: 'Define absolute risk over time.', citations: ['COCHRANE'], content: () => 'Prespecify time origin, prognostic horizon, outcome-state definition, competing events, censoring, loss to follow-up, absolute-risk scale and acceptable baseline-risk populations.' }],
  'prognostic-factor': [{ id: 'prognostic-factor-specifics', heading: 'Prognostic factor specification', purpose: 'Define factor measurement and adjusted association.', citations: ['COCHRANE'], content: () => 'Define index factor, measurement timing, dose or categories, minimally sufficient adjustment set, confounder hierarchy, compatible adjusted estimates, time-to-event scale and handling of non-linearity.' }],
  'prediction-model': [{ id: 'prediction-model-specifics', heading: 'Prediction model specification', purpose: 'Separate model development, validation and updating.', citations: ['COCHRANE'], content: () => 'Classify model purpose and stage; define intended use, prediction horizon, predictors, outcome, target population, validation type, discrimination, calibration, overall performance and clinical utility. Do not pool incompatible model versions.' }],
  'prevalence-incidence': [{ id: 'prevalence-specifics', heading: 'Prevalence and incidence specification', purpose: 'Define numerator, denominator and observation window.', citations: ['JBI'], content: () => 'Specify condition definition, sampling frame, denominator, prevalence period or incidence person-time, survey design, age standardisation, geography, season, transformations, zero cells and population weighting.' }],
  qualitative: [{ id: 'qualitative-specifics', heading: 'Qualitative evidence synthesis specification', purpose: 'Define epistemology and interpretive synthesis.', citations: ['JBI'], content: () => 'State epistemological position, phenomenon of interest, eligible qualitative designs, participant voice, reflexivity, coding approach and selected synthesis method. Define how review-author interpretations will be distinguished from primary-study findings and how CERQual will be applied.' }],
  'mixed-methods': [{ id: 'mixed-specifics', heading: 'Mixed-methods integration specification', purpose: 'Define how evidence streams meet.', citations: ['JBI'], content: () => 'State whether the design is convergent integrated or convergent segregated, when transformation occurs, how qualitative and quantitative findings are linked, how discordance is preserved and how integrated conclusions are appraised.' }],
  scoping: [{ id: 'scoping-specifics', heading: 'Scoping review mapping specification', purpose: 'Define PCC boundaries and charting outputs.', citations: ['PRISMA-SCR', 'JBI'], content: () => 'Specify population, concept and context; reasons for mapping rather than effect estimation; charting framework; evidence-source types; consultation process if used; and whether appraisal is omitted, optional or purpose-specific.' }],
  rapid: [{ id: 'rapid-specifics', heading: 'Rapid-review abbreviations and safeguards', purpose: 'Make every shortcut explicit and test its likely bias.', citations: ['COCHRANE', 'JBI'], content: () => 'List all abbreviations to standard methods, such as database limits, date/language restrictions, single-reviewer steps or restricted grey literature. For each, state rationale, risk, mitigation, verification sample and trigger for expanding the method.' }],
  umbrella: [{ id: 'umbrella-specifics', heading: 'Overview and overlap specification', purpose: 'Prevent double counting across reviews.', citations: ['JBI'], content: () => 'Define eligible review types, recency and methodological thresholds, handling of discordant reviews, corrected covered area or another overlap measure, preferred-review selection rules and whether primary-study data will be re-extracted.' }],
  living: [{ id: 'living-specifics', heading: 'Living surveillance and update specification', purpose: 'Define continuous evidence maintenance.', citations: ['COCHRANE'], content: () => 'Define surveillance frequency, automation boundaries, update triggers, statistical monitoring, version release policy, stakeholder notification, transition to conventional review and retirement criteria.' }],
  'network-meta-analysis': [{ id: 'nma-specifics', heading: 'Network meta-analysis specification', purpose: 'Define treatment network and identifying assumptions.', citations: ['PRISMA-NMA', 'COCHRANE'], content: () => 'Define treatment-node construction, common comparators, network geometry, transitivity variables, multi-arm correlation, inconsistency assessment, ranking measures, disconnected networks and certainty assessment for pairwise and network estimates.' }],
  'adverse-effects': [{ id: 'harms-specifics', heading: 'Harms and rare-events specification', purpose: 'Capture incompletely and inconsistently reported adverse outcomes.', citations: ['COCHRANE'], content: () => 'Define harms taxonomy, seriousness, expectedness, exposure window, spontaneous and observational sources, denominator hierarchy, duplicate safety reports, rare-event estimators and rules for zero-event studies.' }],
  economic: [{ id: 'economic-specifics', heading: 'Economic evidence specification', purpose: 'Make economic evaluations comparable.', citations: ['JBI'], content: () => 'Define perspective, currency, price year, discounting, time horizon, model type, cost categories, outcome metric, willingness-to-pay thresholds, transferability, inflation and purchasing-power adjustments, and handling of partial versus full economic evaluations.' }],
  implementation: [{ id: 'implementation-specifics', heading: 'Implementation evidence specification', purpose: 'Separate strategies, determinants, mechanisms and outcomes.', citations: ['JBI'], content: () => 'Name implementation framework or theory; define implementation strategy, actor, action, target, temporality and dose; define implementation outcomes, determinants, context, fidelity, adaptation and mechanism; and prespecify integration of qualitative and quantitative evidence.' }],
  mechanistic: [{ id: 'mechanistic-specifics', heading: 'Mechanistic causal-chain specification', purpose: 'Test explicit causal steps rather than collect loosely related biomarkers.', citations: ['PRISMA-2020'], content: () => 'Draw the hypothesised mechanism as ordered causal steps. For each step define predicted observations, competing explanations, evidence streams, perturbations, temporality, dose-response, mediation, negative controls and triangulation rules. Keep evidence of mechanism separate from evidence of net effect.' }],
  animal: [{ id: 'animal-specifics', heading: 'Animal and preclinical specification', purpose: 'Address unit, species and translational bias.', citations: ['ARRIVE'], content: () => 'Define species, strain, sex, age, disease model, intervention timing, unit of allocation, cage/litter clustering, randomisation, blinding, attrition, outcome timing, standardisation, dose conversion and translational indirectness.' }],
  environmental: [{ id: 'environmental-specifics', heading: 'Environmental evidence-stream integration', purpose: 'Integrate human, animal and mechanistic evidence transparently.', citations: ['OHAT'], content: () => 'Define exposure source, route, matrix, timing, dose, biomarker validity and co-exposures. Appraise human, animal and mechanistic streams separately, then apply prespecified integration rules without erasing their different bias structures.' }],
  'evidence-map': [{ id: 'evidence-map-specifics', heading: 'Evidence and gap map coding specification', purpose: 'Freeze map ontology and visual dimensions.', citations: ['CAMPBELL', 'PRISMA-SCR'], content: () => 'Define intervention/exposure and outcome dimensions, population and context filters, study-design categories, coding ontology, map cells, gap taxonomy, appraisal overlays, stakeholder prioritisation and rules for updating the map.' }],
};

function authorFromIdentity(identity: ResearcherIdentity): ProtocolAuthor {
  const parts = identity.displayName.trim().split(/\s+/);
  const familyName = parts.pop() ?? 'Researcher';
  const givenName = parts.join(' ') || 'Unnamed';
  const base: ProtocolAuthor = { givenName, familyName, roles: ['Guarantor', 'Protocol development'] };
  if (identity.orcid) base.orcid = identity.orcid;
  return base;
}

function sectionFromBlueprint(blueprint: SectionBlueprint, request: ReviewRequest, plan: ReviewPlan): ProtocolSection {
  return {
    id: blueprint.id,
    heading: blueprint.heading,
    purpose: blueprint.purpose,
    content: blueprint.content(request, plan),
    required: blueprint.required ?? true,
    citations: [...(blueprint.citations ?? [])],
    validationRules: [...(blueprint.rules ?? ['Complete this section before registration'])],
  };
}

export function createProtocolDraft(
  request: ReviewRequest,
  plan: ReviewPlan,
  identity: ResearcherIdentity,
  now: string,
): ProtocolDraft {
  const authors = request.protocolDevelopment?.authors && request.protocolDevelopment.authors.length > 0
    ? request.protocolDevelopment.authors.map((author) => ({ ...author, roles: [...(author.roles ?? [])] }))
    : [authorFromIdentity(identity)];
  const sections = [...commonBlueprints, ...typeSpecific[request.reviewType]]
    .map((blueprint) => sectionFromBlueprint(blueprint, request, plan));
  const citationIds = new Set(sections.flatMap((section) => section.citations));
  const citations = [...citationIds]
    .map((citationId) => protocolCitationLibrary[citationId])
    .filter((citation): citation is ProtocolCitation => Boolean(citation));

  return {
    id: id(),
    reviewType: request.reviewType,
    title: `Protocol: ${request.question.title}`,
    version: request.protocolDevelopment?.protocolVersion ?? '1.0',
    status: 'draft',
    createdAt: now,
    authors,
    sections,
    citations,
    checklist: sections.map((section) => ({
      item: section.heading,
      status: section.content.includes('[Specify') || section.content.includes('[Declare') ? 'partial' : 'complete',
      evidence: section.id,
    })),
  };
}

function renderAuthor(author: ProtocolAuthor): string {
  const identity = author.orcid ? `, ORCID: ${author.orcid}` : '';
  const affiliation = author.affiliation ? `, ${author.affiliation}` : '';
  const roles = author.roles && author.roles.length > 0 ? ` — ${author.roles.join(', ')}` : '';
  return `- ${author.givenName} ${author.familyName}${identity}${affiliation}${roles}`;
}

export function renderProtocolMarkdown(
  draft: ProtocolDraft,
  strategies: SearchStrategy[],
  tests: SearchStrategyTestReport,
): string {
  const body = draft.sections.map((section) => {
    const refs = section.citations.length > 0 ? `\n\nGuidance: ${section.citations.map((citation) => `[${citation}]`).join(', ')}` : '';
    return `## ${section.heading}\n\n${section.content}${refs}`;
  }).join('\n\n');
  const searchAppendix = strategies.map((strategy) => `### ${strategy.database} (${strategy.platform})\n\n\`\`\`text\n${strategy.query}\n\`\`\``).join('\n\n');
  const testAppendix = tests.results.map((result) => `- ${result.database}: ${result.syntaxValid ? 'syntax valid' : 'syntax invalid'}; missing concepts: ${result.conceptsMissing.join(', ') || 'none'}; errors: ${result.errors.join('; ') || 'none'}; warnings: ${result.warnings.join('; ') || 'none'}`).join('\n');
  const references = draft.citations.map((citation) => {
    const doi = citation.doi ? ` DOI: ${citation.doi}.` : '';
    return `- [${citation.id}] ${citation.title}. ${citation.organisation ?? ''}${citation.year ? ` (${citation.year})` : ''}. ${citation.url}.${doi} Accessed ${citation.accessedAt}.`;
  }).join('\n');

  return `# ${draft.title}\n\nVersion ${draft.version}\n\n## Authors\n\n${draft.authors.map(renderAuthor).join('\n')}\n\n${body}\n\n## Appendix A. Database-specific search strategies\n\n${searchAppendix}\n\n## Appendix B. Search testing report\n\nStatus: ${tests.status}. Peer review: ${tests.peerReviewStatus}.\n\n${testAppendix}\n\n## References and methodological sources\n\n${references}\n`;
}
