import test from 'node:test';
import assert from 'node:assert/strict';
import { SourceRichClinicalTrialsGovAdapter } from '../src/adapters/clinicaltrials-rich.js';
import type { TrialRegistryEvidenceRecord } from '../src/core/trial-registry-metadata.js';

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
}

test('ClinicalTrials.gov referencesModule preserves RESULT and BACKGROUND reference identity', async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => response({
    totalCount: 1,
    studies: [{
      hasResults: false,
      protocolSection: {
        identificationModule: { nctId: 'NCT01234567', briefTitle: 'Reference Trial' },
        statusModule: { overallStatus: 'COMPLETED' },
        conditionsModule: { conditions: [] },
        designModule: { phases: [] },
        eligibilityModule: { stdAges: [] },
        armsInterventionsModule: { armGroups: [], interventions: [] },
        outcomesModule: { primaryOutcomes: [{ measure: 'mortality' }], secondaryOutcomes: [] },
        referencesModule: {
          references: [
            { type: 'RESULT', pmid: '12345678', citation: 'Primary trial results.' },
            { type: 'BACKGROUND', pmid: '99999999', citation: 'Background evidence.' },
          ],
        },
      },
    }],
  });
  t.after(() => { globalThis.fetch = original; });

  const result = await new SourceRichClinicalTrialsGovAdapter({ baseUrl: 'https://example.test/api/v2' }).execute({
    database: 'ClinicalTrials.gov', platform: 'ClinicalTrials.gov API v2', query: 'NCT01234567', generatedAt: '2026-08-11T11:00:00.000Z',
  });
  const record = result.records[0] as TrialRegistryEvidenceRecord;
  assert.deepEqual(record.trialRegistry?.references, [
    { pmid: '12345678', type: 'RESULT', citation: 'Primary trial results.' },
    { pmid: '99999999', type: 'BACKGROUND', citation: 'Background evidence.' },
  ]);
  assert.equal(record.trialRegistry?.hasPostedResults, false, 'RESULT publication reference remains distinct from registry-posted summary results');
});
