import type { EvidenceRecord } from './types.js';

export interface TrialRegistryProtocolOutcome {
  measure: string;
  description?: string;
  timeFrame?: string;
}

export interface TrialRegistryReportedOutcome {
  title: string;
  type?: string;
  description?: string;
  timeFrame?: string;
  reportingStatus?: string;
  hasOutcomeData: boolean;
}

export interface TrialRegistryReference {
  pmid?: string;
  type?: string;
  citation?: string;
}

export interface TrialRegistryArm {
  label: string;
  type?: string;
  description?: string;
  interventionNames: string[];
}

export interface TrialRegistryIntervention {
  type?: string;
  name: string;
  description?: string;
  otherNames: string[];
  armGroupLabels: string[];
}

export interface TrialRegistryEligibilityMetadata {
  criteria?: string;
  healthyVolunteers?: boolean;
  sex?: string;
  minimumAge?: string;
  maximumAge?: string;
  standardAges: string[];
  studyPopulation?: string;
}

export interface TrialRegistryDesignMetadata {
  studyType?: string;
  phases: string[];
  allocation?: string;
  interventionModel?: string;
  primaryPurpose?: string;
  masking?: string;
  enrollmentCount?: number;
  enrollmentType?: string;
}

export interface TrialRegistryMetadata {
  source: 'clinicaltrials.gov';
  registryId: string;
  overallStatus?: string;
  /** Source fact: whether summary results are posted in the registry itself. */
  hasPostedResults: boolean;
  conditions: string[];
  keywords: string[];
  design: TrialRegistryDesignMetadata;
  eligibility: TrialRegistryEligibilityMetadata;
  arms: TrialRegistryArm[];
  interventions: TrialRegistryIntervention[];
  primaryOutcomes: TrialRegistryProtocolOutcome[];
  secondaryOutcomes: TrialRegistryProtocolOutcome[];
  reportedOutcomes: TrialRegistryReportedOutcome[];
  /** Official registry-linked references. Absence means uncaptured/unknown, not proven none. */
  references?: TrialRegistryReference[];
  sourceSchema: 'clinicaltrials.gov-api-v2';
}

export type TrialRegistryEvidenceRecord = EvidenceRecord & {
  trialRegistry?: TrialRegistryMetadata;
};
