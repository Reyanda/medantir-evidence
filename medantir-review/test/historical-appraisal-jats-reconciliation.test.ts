import test from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryHistoricalObjectStore } from '../src/historical/object-archive.js';
import { extractHistoricalJatsTables } from '../src/historical/jats-table-extractor.js';
import { bindHistoricalAppraisalToJats } from '../src/historical/appraisal-jats-reconciliation.js';
import { createHistoricalAppraisalLedger, type HistoricalAppraisalRowInput } from '../src/historical/appraisal-ledger.js';

const xml = `<article><body>
<table-wrap><label>Table 3</label><caption><title>Jadad</title></caption><table><tbody>
<tr><th>Study</th><th>Random</th><th>Concealment</th><th>Blinding</th><th>Withdrawals</th><th>Total</th><th>Interpretation</th></tr>
<tr><td>Cantini F et al. 2020 (a)</td><td>0</td><td>0</td><td>0</td><td>1</td><td>1</td><td>Low quality</td></tr>
</tbody></table></table-wrap>
<table-wrap><label>Table 4</label><caption><title>NOS</title></caption><table><tbody>
<tr><th>Study</th><th>Design</th><th>Selection</th><th>Comparability</th><th>Outcome</th><th>Total</th><th>Result</th></tr>
<tr><td>Bronte V et al. 2020</td><td>Cohort</td><td>***</td><td>**</td><td>***</td><td>8</td><td>Good quality</td></tr>
</tbody></table></table-wrap>
</body></article>`;

const rows: HistoricalAppraisalRowInput[] = [
  {
    lineageId: 'JAKCOVID-002', tool: 'modified-jadad-7', randomAllocation: 0, concealment: 0, blinding: 0, withdrawalsDropouts: 1, totalScore: 1, interpretation: 'low',
    source: { sourceType: 'published-table', sourceReference: 'PMC', tableOrFigure: 'Table 3', rowLabel: 'Cantini F 2020 (a)', verbatimEvidence: 'citation-only transcription' },
  },
  {
    lineageId: 'JAKCOVID-001', tool: 'newcastle-ottawa-cohort-9', selection: 3, comparability: 2, outcome: 3, totalScore: 8, interpretation: 'good',
    source: { sourceType: 'published-table', sourceReference: 'PMC', tableOrFigure: 'Table 4', rowLabel: 'Bronte V 2020', verbatimEvidence: 'citation-only transcription' },
  },
];

test('appraisal transcription becomes exact-source-bound only after JATS cell reconciliation', async () => {
  const store = new InMemoryHistoricalObjectStore();
  const publicationObject = await store.put(new TextEncoder().encode(xml), {
    role: 'fulltext-source', mediaType: 'application/xml', recordId: 'PMC', accessClass: 'public',
  });
  const bound = bindHistoricalAppraisalToJats({ rows, tables: extractHistoricalJatsTables(xml), publicationObject });
  const ledger = createHistoricalAppraisalLedger(bound, new Set(['JAKCOVID-001', 'JAKCOVID-002']));
  assert.equal(ledger.exactSourceBoundRows, 2);
  assert.equal(ledger.reconstructionOnlyRows, 0);
  assert.ok(ledger.rows.every((row) => row.source.bindingFidelity === 'structured-row'));
  assert.ok(ledger.rows.every((row) => /^[a-f0-9]{64}$/.test(row.source.rowFragmentSha256 ?? '')));
  assert.ok(ledger.rows.every((row) => row.source.objectId === publicationObject.objectId));
});

test('JATS reconciliation fails on component or interpretation drift instead of blessing the transcription', async () => {
  const store = new InMemoryHistoricalObjectStore();
  const publicationObject = await store.put(new TextEncoder().encode(xml), {
    role: 'fulltext-source', mediaType: 'application/xml', recordId: 'PMC', accessClass: 'public',
  });
  assert.throws(() => bindHistoricalAppraisalToJats({
    rows: [{ ...rows[0]!, totalScore: 2 } as HistoricalAppraisalRowInput],
    tables: extractHistoricalJatsTables(xml),
    publicationObject,
  }), /totalScore mismatch|component sum/i);
});

test('merely attaching an immutable publication object without row fidelity does not create exact appraisal evidence', () => {
  const attachedOnly: HistoricalAppraisalRowInput = {
    ...rows[0]!,
    source: {
      ...rows[0]!.source,
      objectId: `HOBJ-${'a'.repeat(64)}`,
      sha256: 'a'.repeat(64),
      bindingFidelity: 'citation-only',
    },
  } as HistoricalAppraisalRowInput;
  const ledger = createHistoricalAppraisalLedger([attachedOnly], new Set(['JAKCOVID-002']));
  assert.equal(ledger.exactSourceBoundRows, 0);
});
