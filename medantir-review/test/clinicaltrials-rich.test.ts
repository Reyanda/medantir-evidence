import test from 'node:test';
import assert from 'node:assert/strict';
import { SourceRichClinicalTrialsGovAdapter } from '../src/adapters/clinicaltrials-rich.js';
import type { TrialRegistryEvidenceRecord } from '../src/core/trial-registry-metadata.js';

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
}

test('ClinicalTrials.gov adapter preserves protocol design eligibility interventions and posted-results structure', async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({
    totalCount: 1,
    studies: [{
      hasResults: true,
      protocolSection: {
        identificationModule: { nctId: 'NCT01234567', briefTitle: 'Mortality Trial' },
        statusModule: { overallStatus: 'COMPLETED', startDateStruct: { date: '2021-01' } },
        descriptionModule: { briefSummary: 'Randomized treatment trial.' },
        conditionsModule: { conditions: ['Severe acute malnutrition'], keywords: ['SAM', 'malnutrition'] },
        designModule: {
          studyType: 'INTERVENTIONAL', phases: ['PHASE3'],
          designInfo: { allocation: 'RANDOMIZED', interventionModel: 'PARALLEL', primaryPurpose: 'TREATMENT', maskingInfo: { masking: 'DOUBLE' } },
          enrollmentInfo: { count: 240, type: 'ACTUAL' },
        },
        eligibilityModule: {
          eligibilityCriteria: 'Children with severe acute malnutrition', healthyVolunteers: false,
          sex: 'ALL', minimumAge: '6 Months', maximumAge: '59 Months', stdAges: ['CHILD'],
        },
        armsInterventionsModule: {
          armGroups: [
            { label: 'Treatment', type: 'EXPERIMENTAL', interventionNames: ['Drug: Therapeutic food A'] },
            { label: 'Control', type: 'ACTIVE_COMPARATOR', interventionNames: ['Drug: Standard therapeutic food'] },
          ],
          interventions: [
            { type: 'DRUG', name: 'Therapeutic food A', otherNames: ['TFA'], armGroupLabels: ['Treatment'] },
            { type: 'DRUG', name: 'Standard therapeutic food', armGroupLabels: ['Control'] },
          ],
        },
        outcomesModule: {
          primaryOutcomes: [{ measure: 'All-cause mortality', description: 'Death from any cause', timeFrame: 'Day 28' }],
          secondaryOutcomes: [{ measure: 'Hospital stay', timeFrame: 'Day 28' }],
        },
      },
      resultsSection: {
        outcomeMeasuresModule: {
          outcomeMeasures: [
            {
              type: 'PRIMARY', title: 'All-cause mortality', timeFrame: 'Day 28', reportingStatus: 'POSTED',
              classes: [{ categories: [{ measurements: [{ groupId: 'OG000', value: '12' }] }] }],
            },
            {
              type: 'SECONDARY', title: 'Hospital stay', timeFrame: 'Day 28', reportingStatus: 'POSTED',
              classes: [], analyses: [{ paramType: 'MEAN_DIFFERENCE', paramValue: '-1.2' }],
            },
          ],
        },
      },
    }],
  });
  t.after(() => { globalThis.fetch = original; });

  const result = await new SourceRichClinicalTrialsGovAdapter({ baseUrl: 'https://example.test/api/v2' }).execute({
    database: 'ClinicalTrials.gov', platform: 'ClinicalTrials.gov API v2', query: 'malnutrition', generatedAt: '2026-08-11T09:00:00.000Z',
  });
  assert.equal(result.records.length, 1);
  assert.equal(result.provenance.resultCount, 1);
  const record = result.records[0] as TrialRegistryEvidenceRecord;
  assert.equal(record.id, 'nct:nct01234567');
  assert.equal(record.trialRegistry?.registryId, 'NCT01234567');
  assert.equal(record.trialRegistry?.overallStatus, 'COMPLETED');
  assert.equal(record.trialRegistry?.hasPostedResults, true);
  assert.deepEqual(record.trialRegistry?.conditions, ['Severe acute malnutrition']);
  assert.equal(record.trialRegistry?.design.studyType, 'INTERVENTIONAL');
  assert.equal(record.trialRegistry?.design.allocation, 'RANDOMIZED');
  assert.equal(record.trialRegistry?.design.interventionModel, 'PARALLEL');
  assert.equal(record.trialRegistry?.design.enrollmentCount, 240);
  assert.equal(record.trialRegistry?.eligibility.minimumAge, '6 Months');
  assert.equal(record.trialRegistry?.eligibility.maximumAge, '59 Months');
  assert.equal(record.trialRegistry?.arms[1]?.type, 'ACTIVE_COMPARATOR');
  assert.equal(record.trialRegistry?.interventions[0]?.name, 'Therapeutic food A');
  assert.deepEqual(record.trialRegistry?.interventions[0]?.otherNames, ['TFA']);
  assert.deepEqual(record.trialRegistry?.primaryOutcomes, [{
    measure: 'All-cause mortality', description: 'Death from any cause', timeFrame: 'Day 28',
  }]);
  assert.equal(record.trialRegistry?.reportedOutcomes[0]?.title, 'All-cause mortality');
  assert.equal(record.trialRegistry?.reportedOutcomes[0]?.hasOutcomeData, true);
  assert.equal(record.trialRegistry?.reportedOutcomes[1]?.hasOutcomeData, true, 'statistical analysis counts as posted outcome data');
});

test('ClinicalTrials.gov adapter preserves absence of posted results without claiming global result absence', async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({
    totalCount: 1,
    studies: [{
      hasResults: false,
      protocolSection: {
        identificationModule: { nctId: 'NCT07654321', officialTitle: 'Unreported Trial' },
        statusModule: { overallStatus: 'COMPLETED' },
        designModule: { studyType: 'INTERVENTIONAL', designInfo: { allocation: 'RANDOMIZED' }, phases: [] },
        eligibilityModule: { sex: 'ALL', stdAges: ['ADULT'] },
        armsInterventionsModule: { armGroups: [], interventions: [] },
        outcomesModule: { primaryOutcomes: [{ measure: 'Mortality', timeFrame: '6 months' }] },
      },
    }],
  });
  t.after(() => { globalThis.fetch = original; });

  const result = await new SourceRichClinicalTrialsGovAdapter({ baseUrl: 'https://example.test/api/v2' }).execute({
    database: 'ClinicalTrials.gov', platform: 'ClinicalTrials.gov API v2', query: 'q', generatedAt: '2026-08-11T09:00:00.000Z',
  });
  const record = result.records[0] as TrialRegistryEvidenceRecord;
  assert.equal(record.trialRegistry?.hasPostedResults, false);
  assert.equal(record.trialRegistry?.reportedOutcomes.length, 0);
  assert.equal(record.trialRegistry?.primaryOutcomes[0]?.measure, 'Mortality');
  assert.equal(record.trialRegistry?.design.allocation, 'RANDOMIZED');
});
