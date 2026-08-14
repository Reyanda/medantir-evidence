import { scientificContentHash } from '../core/canonical-hash.js';
import type {
  CapabilityStatus,
  EvidenceOsArchitectureManifest,
  EvidenceOsCapability,
  EvidenceOsModule,
} from './types.js';
import { EVIDENCE_OS_SCHEMA_VERSION } from './types.js';

function capability(
  id: string,
  label: string,
  status: CapabilityStatus,
  implementation: string[],
  proof: string[],
  limitations: string[],
  apiRoutes?: string[],
): EvidenceOsCapability {
  return {
    id,
    label,
    status,
    implementation,
    proof,
    limitations,
    ...(apiRoutes?.length ? { apiRoutes } : {}),
  };
}

const modules: EvidenceOsModule[] = [
  {
    id: 'question-formulation',
    label: 'Question Formulation',
    purpose: 'Compile an answerable, review-type-specific question and freeze material decisions before definitive review work.',
    capabilities: [
      capability('question.pico', 'PICO / PECO / PICOTS', 'operational', ['Typed question frameworks and ReviewSpec compiler'], ['medantir-review/src/core/types.ts', 'medantir-review/src/question/review-spec.ts'], ['PEO is represented through PECO rather than a separate named schema.']),
      capability('question.spider', 'SPIDER', 'operational', ['Review-type methodology selector'], ['medantir-review/src/protocols/methodology.ts'], []),
      capability('question.cosmin', 'COSMIN question model', 'planned', [], ['MEDANTIR capability registry'], ['No certified COSMIN measurement-property compiler is wired to the production graph.']),
      capability('question.review-type-selector', 'Review Type Selector', 'operational', ['Twenty-one typed review families'], ['medantir-review/src/core/types.ts', 'medantir-review/src/protocols/methodology.ts'], []),
      capability('question.material-clarification', 'Material clarification and replay', 'operational-human-gated', ['One material clarification at a time, attributable answer ledger, deterministic replay'], ['medantir-review/src/question/clarification-controller.ts', 'medantir-review/src/question/autonomous-question-agent.ts'], []),
    ],
  },
  {
    id: 'search-engine',
    label: 'Search Engine',
    purpose: 'Create, peer-review, execute, and replay source-specific searches without mislabelling partial retrieval as complete.',
    capabilities: [
      capability('search.database-adapters', 'Database adapters', 'partial', ['Open official APIs, ClinicalTrials.gov, institutional browser bridge adapters'], ['medantir-review/src/adapters/official-search.ts', 'medantir-review/src/adapters/institutional.ts'], ['Licensed database completeness requires live institutional certification.']),
      capability('search.press', 'PRESS optimisation', 'operational-human-gated', ['Search test report and required attributable peer-review gate'], ['medantir-review/src/agents/protocol-registration-agents.ts'], ['The engine records PRESS attestation; it does not impersonate an independent information specialist.']),
      capability('search.expansion', 'Search expansion and citation chaining', 'partial', ['Review-landscape surveillance and source query compilation'], ['medantir-review/src/adapters/source-query-compiler.ts'], ['Full bidirectional citation graph automation is not yet a production-certified stage.']),
      capability('search.living', 'Living search', 'partial', ['Living review type, update policy, counterfactual canary infrastructure'], ['medantir-review/src/core/types.ts', 'medantir-review/src/benchmark/sr-drift-sentinel.ts'], ['Distributed schedules and operational alerting remain future infrastructure.']),
      capability('search.deduplication', 'Deduplication', 'operational', ['Deterministic deduplication stage with report artifact'], ['medantir-review/src/protocols/review-protocol.ts'], []),
    ],
  },
  {
    id: 'screening-engine',
    label: 'Screening Engine',
    purpose: 'Record title/abstract and full-text eligibility decisions with reasons, evidence, audit events, and replay boundaries.',
    capabilities: [
      capability('screening.tiab', 'Title and abstract screening', 'operational', ['Deterministic pipeline stage with optional shadow-model proposal'], ['medantir-review/src/inference/shadow-screening-agent.ts'], []),
      capability('screening.fulltext', 'Full-text screening', 'operational-human-gated', ['Section-aware eligibility with mandatory methodological gate'], ['medantir-review/src/agents/section-aware-eligibility.ts'], []),
      capability('screening.active-learning', 'Active learning', 'partial', ['Shadow model routing and benchmark harness'], ['medantir-review/src/inference/shadow-screening-agent.ts', 'medantir-review/src/benchmark/sr-reproduction-benchmark.ts'], ['No autonomous stopping rule is authorized for production exclusions.']),
      capability('screening.prisma', 'PRISMA decision logging', 'operational', ['Immutable screening decisions, audit ledger, report counts'], ['medantir-review/src/core/types.ts', 'medantir-review/src/agents/live-pipeline-agents.ts'], ['Formal checklist completion remains report-template dependent.']),
    ],
  },
  {
    id: 'pdf-intelligence',
    label: 'PDF Intelligence',
    purpose: 'Turn lawful full text into source-located text, sections, tables, figures, and supplements with quality-aware fallbacks.',
    capabilities: [
      capability('pdf.liteparse', 'LiteParse', 'operational', ['LiteParse-first delegated parser with quality threshold'], ['medantir-review/src/document/document-intelligence.ts'], ['Availability depends on the configured parsing service.']),
      capability('pdf.grobid', 'GROBID', 'planned', [], ['MEDANTIR capability registry'], ['No GROBID adapter is wired to the production service.']),
      capability('pdf.ocr', 'OCR fallback', 'partial', ['Recorded lower-tier parsing path'], ['medantir-review/src/document/document-intelligence.ts'], ['OCR is a downgrade path and cannot claim coordinate fidelity without boxes.']),
      capability('pdf.figures', 'Figure extraction', 'planned', [], ['MEDANTIR capability registry'], ['Figure semantics and panel provenance are not yet production certified.']),
      capability('pdf.tables', 'Table extraction', 'partial', ['Structured parser output may preserve table coordinates'], ['medantir-review/src/document/document-intelligence.ts'], ['Dedicated table reconstruction and cell-level validation remain incomplete.']),
      capability('pdf.supplements', 'Supplement parsing', 'partial', ['Supplement source class supported by provenance model'], ['medantir-review/src/evidence-os/types.ts'], ['Automated supplement discovery and completeness checks are not yet universal.']),
    ],
  },
  {
    id: 'information-extraction',
    label: 'Information Extraction',
    purpose: 'Create source-bound study, outcome, estimand, adjustment, mechanism, and effect objects rather than free-floating summaries.',
    capabilities: [
      capability('extract.study-characteristics', 'Study characteristics', 'operational', ['Provenance-first extraction and study-family linkage'], ['medantir-review/src/agents/provenance-first-extraction.ts', 'medantir-review/src/agents/study-family-linkage.ts'], []),
      capability('extract.population-intervention-outcomes', 'Population, intervention/exposure, comparator, outcomes', 'operational', ['Typed ExtractedStudy and evidence excerpts'], ['medantir-review/src/core/types.ts'], []),
      capability('extract.effect-estimates', 'Effect estimates', 'operational', ['Typed measure/scale metadata and deterministic derivation'], ['medantir-review/src/agents/provenance-first-extraction.ts'], []),
      capability('extract.covariates', 'Covariates and adjustment identity', 'operational', ['Hash-bound crude/adjusted identity and synthesis compatibility guard'], ['medantir-review/src/synthesis/adjustment-identity-agent.ts', 'medantir-review/src/synthesis/adjustment-guard-agent.ts'], []),
      capability('extract.mechanisms', 'Mechanisms', 'partial', ['Mechanism fields and HEOS mechanistic ontology'], ['medantir-review/src/core/types.ts', 'heos/ontology.py'], ['Mechanistic causal adjudication remains research-only.']),
    ],
  },
  {
    id: 'artifact-tokenisation',
    label: 'Artifact Tokenisation',
    purpose: 'Represent every review artifact as stable structural and lexical tokens, preserve field and IMRAD boundaries, and separate scientific identity from model-specific context accounting.',
    capabilities: [
      capability('tokenisation.universal-artifacts', 'Universal scientific artifact tokenisation', 'operational', ['Deterministic structural and Unicode-aware lexical tokens for request, stage, audit, and every run artifact'], ['medantir-review/src/tokenisation/tokeniser.ts', 'medantir-review/src/tokenisation/manifest.ts'], [], ['/runs/{runId}/tokenisation-manifest', '/runs/{runId}/artifact-tokens/{artifactKey}']),
      capability('tokenisation.imrad-contracts', 'IMRAD-bound extraction field contracts', 'operational', ['Versioned field registry, exact evidence-section checks, strict validator, and extraction-stage gate'], ['medantir-review/src/tokenisation/extraction-registry.ts', 'medantir-review/src/tokenisation/extraction-validator.ts', 'medantir-review/src/protocols/review-protocol.ts'], ['The initial registry is centred on the current ExtractedStudy model; specialist review families require their own certified field extensions.'], ['/evidence-os/extraction-field-contracts', '/runs/{runId}/extraction-validation']),
      capability('tokenisation.context-planning', 'Boundary-preserving context planning', 'operational', ['Context chunks cannot cross artifact, IMRAD-role, or top-level field boundaries'], ['medantir-review/src/tokenisation/context-planner.ts'], ['Oversized indivisible source tokens remain visible operational debt rather than being silently reinterpreted.']),
      capability('tokenisation.model-subwords', 'Model-specific subword token counts', 'partial', ['Exact ModelTokenCounterPort seam plus an explicitly labelled UTF-8 estimate'], ['medantir-review/src/tokenisation/types.ts', 'medantir-review/src/tokenisation/tokeniser.ts'], ['No provider vocabulary is claimed unless its exact counter adapter is supplied and certified.']),
    ],
  },
  {
    id: 'critical-appraisal',
    label: 'Critical Appraisal',
    purpose: 'Route each design to the correct appraisal tool, compute only supported judgements, and expose unsupported evidence as explicit debt.',
    capabilities: [
      capability('appraisal.rob2', 'RoB 2', 'operational-human-gated', ['Result-level signalling, source evidence catalogue, deterministic judgement, attributable override'], ['medantir-review/src/appraisal/rob2.ts', 'medantir-review/src/appraisal/rob2-controller.ts'], ['Exact official Excel algorithm parity remains an explicit certification gate.']),
      capability('appraisal.rob2-parity', 'Official RoB 2 parity certification', 'external-certification-required', ['Conformance harness'], ['medantir-review/src/appraisal/rob2-conformance.ts'], ['Requires captured official provenance and parity cases.']),
      capability('appraisal.robins-i', 'ROBINS-I', 'planned', [], ['medantir-review/src/appraisal/intervention-appraisal-router.ts'], ['Production deliberately blocks non-randomized evidence rather than substituting generic labels.']),
      capability('appraisal.robins-e', 'ROBINS-E', 'planned', [], ['MEDANTIR capability registry'], ['No certified engine is wired.']),
      capability('appraisal.quadas', 'QUADAS-2 / QUADAS-C', 'planned', [], ['MEDANTIR capability registry'], ['No certified diagnostic appraisal engine is wired.']),
      capability('appraisal.quips', 'QUIPS', 'planned', [], ['MEDANTIR capability registry'], ['No certified prognostic-factor engine is wired.']),
      capability('appraisal.amstar2', 'AMSTAR 2 / ROBIS', 'partial', ['Review-landscape trustworthiness fields'], ['medantir-review/src/core/types.ts'], ['Full signalling and algorithm parity are not production certified.']),
      capability('appraisal.casp-cosmin-custom', 'CASP, COSMIN, and custom tools', 'planned', [], ['MEDANTIR capability registry'], ['Tool schemas and validation engines remain to be implemented.']),
    ],
  },
  {
    id: 'evidence-synthesis',
    label: 'Evidence Synthesis',
    purpose: 'Select a review-appropriate synthesis while preserving estimand identity, dependence, scale, adjustment, and uncertainty.',
    capabilities: [
      capability('synthesis.meta-analysis', 'Intervention meta-analysis', 'operational', ['REML primary, DL/PM and Wald/HKSJ sensitivity, prediction intervals, dependence guards'], ['medantir-review/src/synthesis/random-effects.ts', 'medantir-review/src/synthesis/intervention-random-effects-agent.ts'], []),
      capability('synthesis.bayesian', 'Bayesian synthesis', 'planned', [], ['MEDANTIR capability registry'], ['No production posterior engine or prior-governance contract is wired.']),
      capability('synthesis.network', 'Network meta-analysis', 'partial', ['Typed review family and deferred-specialist route'], ['medantir-review/src/core/types.ts'], ['Consistency, transitivity, multi-arm covariance, ranking, and diagnostics need a certified engine.']),
      capability('synthesis.diagnostic', 'Diagnostic reviews', 'partial', ['Typed review family and protocol templates'], ['medantir-review/src/protocols/methodology.ts'], ['Bivariate/HSROC production engine is not yet wired.']),
      capability('synthesis.prognostic', 'Prognostic reviews', 'partial', ['Typed prognosis families and methodology profiles'], ['medantir-review/src/protocols/methodology.ts'], ['Specialist pooling and calibration synthesis remain incomplete.']),
      capability('synthesis.umbrella', 'Umbrella reviews', 'partial', ['Typed review family, protocol and reporting pipeline'], ['medantir-review/src/core/types.ts'], ['Overlap and second-order certainty algorithms remain incomplete.']),
      capability('synthesis.realist-scoping-qualitative', 'Realist, scoping, qualitative, mixed-methods synthesis', 'partial', ['Typed review families and narrative/mapping modes'], ['medantir-review/src/protocols/methodology.ts'], ['Advanced synthesis engines remain review-family specific and are not all certified.']),
    ],
  },
  {
    id: 'causal-evidence-engine',
    label: 'Causal Evidence Engine',
    purpose: 'Adjudicate causal claims by combining epidemiologic, mechanistic, transportability, and triangulation evidence without collapsing distinct assumptions.',
    capabilities: [
      capability('causal.bradford-hill', 'Bradford Hill', 'research-only', ['HEOS causal and evidence graph components'], ['heos/evidence_graph.py', 'heos/refutation.py'], ['Not wired to the production decision graph.']),
      capability('causal.dag', 'DAG reasoning', 'research-only', ['Causal DAG module'], ['heos/causal_dag.py'], ['Identification and adjustment-set outputs require production validation.']),
      capability('causal.mechanistic', 'Mechanistic evidence', 'research-only', ['Ontology and appraisal counterfactual modules'], ['heos/ontology.py', 'heos/appraisal_counterfactual.py'], ['No production-certified MECAST implementation.']),
      capability('causal.transportability', 'Transportability', 'research-only', ['Source transport module'], ['heos/source_transport.py'], ['No frozen transport estimand contract in the production pipeline.']),
      capability('causal.target-trial', 'Target trial emulation', 'planned', [], ['MEDANTIR capability registry'], ['Requires longitudinal data contracts and causal identification checks.']),
      capability('causal.triangulation', 'Triangulation', 'research-only', ['Evidence graph and refutation modules'], ['heos/evidence_graph.py', 'heos/refutation.py'], ['Bias-correlation and conclusion rules remain research-stage.']),
      capability('causal.qwoe', 'QWoE scoring', 'research-only', ['HEOS ontology and evidence graph'], ['heos/ontology.py'], ['No production-frozen scoring policy.']),
    ],
  },
  {
    id: 'report-generator',
    label: 'Report Generator',
    purpose: 'Regenerate manuscripts, checklists, figures, supplements, and reproducibility material from the same graph and frozen protocol.',
    capabilities: [
      capability('report.prisma2020', 'PRISMA 2020', 'operational', ['Structured flow counts and auditable decisions'], ['medantir-review/src/core/types.ts'], ['Checklist item-level conformance still depends on report template coverage.']),
      capability('report.prisma-s', 'PRISMA-S', 'partial', ['Complete database strategies and search execution provenance'], ['medantir-review/src/agents/protocol-registration-agents.ts'], ['Checklist rendering is not yet a dedicated artifact.']),
      capability('report.prisma-p', 'PRISMA-P', 'operational', ['Typed protocol library and registration package'], ['medantir-review/src/protocols/protocol-template-library.ts'], []),
      capability('report.journal-targets', 'Nature Medicine, Lancet, and BMJ targets', 'partial', ['Target report field and journal compiler research module'], ['medantir-review/src/core/types.ts', 'heos/journal_compiler.py'], ['Journal-specific production renderers and validation rules remain incomplete.']),
      capability('report.supplement', 'Supplementary material', 'partial', ['Protocol files, search artifacts, verification appendices'], ['medantir-review/src/agents/protocol-registration-agents.ts'], ['Single-click complete supplement compiler is not yet certified.']),
      capability('report.reproducibility', 'Reproducibility report', 'operational', ['Evidence graph, workflow plan, tokenisation manifest, cost ledger, scientific manifest and seal'], ['medantir-review/src/evidence-os/api.ts'], [], ['/runs/{runId}/reproducibility-bundle']),
    ],
  },
  {
    id: 'verification-api',
    label: 'Verification and API',
    purpose: 'Make every decision attributable, every object addressable, every run replayable, and every unsupported claim visible.',
    capabilities: [
      capability('verification.audit', 'Audit trail', 'operational', ['Append-only stage audit and hash-chained checkpoints'], ['medantir-review/src/core/orchestrator.ts', 'medantir-review/src/durability/file-checkpoint-store.ts'], []),
      capability('verification.human-review', 'Human review', 'operational-human-gated', ['Clarification, PRESS, RoB 2, GRADE, registry universe, final verification'], ['medantir-review/src/server.ts'], []),
      capability('verification.versioning', 'Version control', 'operational', ['Content-addressed immutable evidence objects and supersession edges'], ['medantir-review/src/evidence-os/object-store.ts'], []),
      capability('verification.provenance', 'Evidence provenance', 'operational', ['Exact excerpts, source classes, object and edge hashes'], ['medantir-review/src/evidence-os/projector.ts'], []),
      capability('verification.replay', 'Full reproducibility', 'operational', ['Workflow DAG, graph snapshot, tokenisation manifest, scientific manifest, seal and cost ledger'], ['medantir-review/src/evidence-os/api.ts'], ['External licensed sources remain reproducible only when lawful source exports are archived.']),
      capability('api.rest', 'REST API', 'operational', ['Authenticated review API plus Evidence OS graph and tokenisation routes'], ['medantir-review/src/server.ts', 'medantir-review/src/evidence-os-server.ts'], [], ['/evidence-os/architecture', '/evidence-os/extraction-field-contracts', '/runs/{runId}/evidence-graph', '/runs/{runId}/tokenisation-manifest']),
      capability('api.graphql', 'GraphQL API', 'planned', [], ['MEDANTIR capability registry'], ['REST is the current supported API.']),
      capability('api.auth-permissions', 'Authentication and permissions', 'operational', ['Cognito access tokens and owner/project scoping'], ['medantir-review/src/production.ts', 'medantir-review/src/server.ts'], []),
      capability('api.collaboration', 'Multi-user collaboration', 'partial', ['Attributable reviewers and project scoping'], ['medantir-review/src/core/types.ts'], ['Concurrent edit resolution and role matrices remain incomplete.']),
      capability('api.background-jobs', 'Background jobs', 'partial', ['Copy-on-write in-process scheduler and durable checkpoints'], ['medantir-review/src/server.ts', 'medantir-review/src/evidence-os/runtime.ts'], ['Single replica only; no distributed queue or lease service.']),
      capability('api.cost-monitoring', 'Cost monitoring', 'operational', ['Model-routing receipt discovery and aggregate cost ledger'], ['medantir-review/src/evidence-os/cost-ledger.ts'], []),
      capability('api.llm-routing', 'LLM routing and fallbacks', 'partial', ['OmniRoute model port, shadow models, deterministic authority boundaries'], ['medantir-review/src/inference/omniroute-inference.ts'], ['Fallback policy and provider-wide certification are deployment specific.']),
      capability('api.kubernetes', 'Kubernetes deployment', 'operational', ['Single-replica hardened manifests with persistent volume'], ['deploy/kubernetes'], ['Horizontal scaling is explicitly prohibited until transactional coordination exists.']),
    ],
  },
];

export function buildEvidenceOsArchitectureManifest(
  generatedAt = new Date().toISOString(),
): EvidenceOsArchitectureManifest {
  if (!Number.isFinite(Date.parse(generatedAt))) throw new Error('Evidence OS architecture generatedAt must be a valid timestamp.');
  const coverage = {
    operational: 0,
    'operational-human-gated': 0,
    partial: 0,
    'research-only': 0,
    'external-certification-required': 0,
    planned: 0,
  } satisfies Record<CapabilityStatus, number>;
  for (const module of modules) {
    for (const item of module.capabilities) coverage[item.status] += 1;
  }
  const content = {
    schemaVersion: EVIDENCE_OS_SCHEMA_VERSION,
    product: 'MEDANTIR Evidence OS' as const,
    version: '0.7.0',
    generatedAt,
    modules,
    runtime: {
      workflowBackend: 'in-process-durable' as const,
      queueModel: 'single-replica-copy-on-write' as const,
      persistence: 'hash-chained-file-checkpoints' as const,
      objectModel: 'immutable-content-addressed' as const,
      api: 'REST' as const,
      authentication: 'Cognito-access-token' as const,
      authorization: 'owner-and-project-scoped' as const,
      deployment: 'container-and-single-replica-kubernetes' as const,
      horizontalScaleReady: false as const,
    },
    coverage,
    boundaries: [
      'No unsupported appraisal or synthesis family is silently routed through a generic substitute.',
      'Licensed database completeness requires lawful institutional access and live certification.',
      'The included runtime is production-safe for one service replica only.',
      'Research-only causal and SRBench modules cannot authorize production conclusions.',
      'Model output may propose evidence classifications; deterministic software and attributable human gates retain authority.',
      'Deterministic scientific tokens are model-independent; exact provider subword counts require a certified ModelTokenCounterPort adapter.',
    ],
  };
  return {
    ...content,
    manifestHash: scientificContentHash(content),
  };
}
