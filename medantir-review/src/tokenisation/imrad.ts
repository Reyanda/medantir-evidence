import type { EvidenceSectionName } from '../core/types.js';
import type { ImradRole } from './types.js';

const IMRAD_KEYS: Array<{ role: ImradRole; pattern: RegExp }> = [
  { role: 'not-applicable', pattern: /(^|\.)(studyid|reportids|recordid|runid)$/ },
  { role: 'title', pattern: /(^|[^a-z])(title|runningtitle)([^a-z]|$)/ },
  { role: 'abstract', pattern: /abstract|structuredabstract/ },
  { role: 'introduction', pattern: /introduction|background|rationale|objective|aim|hypothesis/ },
  { role: 'methods', pattern: /method|design|population|participant|sample|intervention|exposure|comparator|eligibility|recruit|setting|analysis|adjust|covariate|protocol|randomi/ },
  { role: 'limitations', pattern: /limitation|constraint|weakness/ },
  { role: 'results', pattern: /result|outcome|effect|estimate|standarderror|event|mean|median|sd|variance|confidenceinterval|heterogeneity/ },
  { role: 'discussion', pattern: /discussion|interpretation|implication/ },
  { role: 'conclusion', pattern: /conclusion|recommendation/ },
  { role: 'references', pattern: /reference|bibliograph|citation|doi|pmid/ },
  { role: 'supplement', pattern: /supplement|appendix|annex/ },
  { role: 'front-matter', pattern: /author|affiliation|funding|funder|grant|acknowledg|conflict|correspond/ },
];

const SEMANTIC_KEY_RULES: Array<{ role: string; pattern: RegExp }> = [
  { role: 'identity', pattern: /(^|\.)(id|studyid|reportid|recordid|runid)$/ },
  { role: 'provenance', pattern: /evidence|source|quote|locator|page|uri|provenance/ },
  { role: 'estimand', pattern: /effect|estimate|standarderror|outcome|comparator|intervention|exposure/ },
  { role: 'population', pattern: /population|participant|sample/ },
  { role: 'methodology', pattern: /method|design|analysis|adjust|covariate|protocol/ },
  { role: 'appraisal', pattern: /riskofbias|judgement|certainty|grade|appraisal/ },
  { role: 'reporting', pattern: /report|section|abstract|prisma|appendix/ },
  { role: 'audit', pattern: /audit|event|attempt|status|stage/ },
  { role: 'cost', pattern: /cost|token|latency|model|provider/ },
];

export const SECTION_TO_IMRAD: Record<EvidenceSectionName, ImradRole> = {
  rationale: 'introduction',
  objectives: 'introduction',
  methods: 'methods',
  results: 'results',
  discussion: 'discussion',
  limitations: 'limitations',
  other: 'other',
};

export function escapeJsonPointer(value: string): string {
  return value.replace(/~/g, '~0').replace(/\//g, '~1');
}

export function jsonPointer(segments: Array<string | number>): string {
  return segments.length ? `/${segments.map((segment) => escapeJsonPointer(String(segment))).join('/')}` : '';
}

function normalizedPath(segments: Array<string | number>): string {
  return segments.map((segment) => String(segment).toLowerCase().replace(/[^a-z0-9]/g, '')).join('.');
}

export function semanticRolesForPath(segments: Array<string | number>): string[] {
  const normalized = normalizedPath(segments);
  return SEMANTIC_KEY_RULES.filter((rule) => rule.pattern.test(normalized)).map((rule) => rule.role).sort();
}

export function imradRoleForPath(segments: Array<string | number>, inherited: ImradRole = 'other'): ImradRole {
  const normalized = normalizedPath(segments);
  for (const rule of IMRAD_KEYS) if (rule.pattern.test(normalized)) return rule.role;
  return inherited;
}
