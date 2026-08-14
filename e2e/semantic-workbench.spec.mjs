import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const ready = JSON.parse(await readFile(join(process.cwd(), '.semantic-run.json'), 'utf8'));

function containsForbiddenVectorPayload(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(containsForbiddenVectorPayload);
  for (const [key, child] of Object.entries(value)) {
    if (key === 'vector' || key === 'centroid') return true;
    if (containsForbiddenVectorPayload(child)) return true;
  }
  return false;
}

test('browser workbench attaches, searches, filters, proves provenance, clusters, and rebuilds against the real API', async ({ page }) => {
  await page.addInitScript(({ projectId }) => {
    const now = Date.now();
    localStorage.setItem('medantir.currentUser.v1', JSON.stringify({
      email: 'e2e-owner@example.test',
      name: 'E2E Reviewer',
      role: 'sudo',
    }));
    localStorage.setItem('medantir.workspace.v2', JSON.stringify({
      version: 2,
      migration: null,
      projects: {
        [projectId]: {
          id: projectId,
          name: 'Semantic Evidence E2E',
          projectType: 'systematic-review',
          workingLanguage: 'en',
          domain: 'evidence',
          mode: 'research',
          status: 'active',
          note: '',
          capabilities: [],
          custom: true,
          detached: false,
          files: {},
          tasks: [],
          runs: [],
          review: null,
          provenance: { origin: 'user', importedFrom: [] },
          created: now,
          updated: now,
        },
      },
    }));
    localStorage.setItem('medantir.workspace.active', projectId);
  }, { projectId: ready.projectId });

  await page.goto('/medantir-evidence/#semantic-evidence');

  await expect(page.getByText('Semantic Evidence Index', { exact: true })).toBeVisible();
  const runInput = page.getByLabel('Durable run ID');
  await expect(runInput).toHaveValue('');
  await runInput.fill(ready.runId);
  await page.getByRole('button', { name: 'Attach' }).click();
  await expect(page.locator('.sei-metric-label', { hasText: 'Semantic units' })).toBeVisible();
  await expect(page.locator('.sei-metric-label', { hasText: 'Embeddings' })).toBeVisible();
  await expect(page.locator('.sei-metric-label', { hasText: 'Clusters' })).toBeVisible();
  await expect(page.getByText('Deterministic lexical-dense baseline active', { exact: true })).toBeVisible();
  await expect(page.locator('.sei-result').first()).toBeVisible();

  const publicPayloads = await page.evaluate(async ({ base, runId }) => {
    const [manifestResponse, clustersResponse, unitsResponse] = await Promise.all([
      fetch(`${base}/runs/${encodeURIComponent(runId)}/semantic-index-manifest`),
      fetch(`${base}/runs/${encodeURIComponent(runId)}/semantic-clusters`),
      fetch(`${base}/runs/${encodeURIComponent(runId)}/semantic-units?offset=0&limit=5`),
    ]);
    return Promise.all([
      manifestResponse.json(),
      clustersResponse.json(),
      unitsResponse.json(),
    ]);
  }, { base: ready.reviewApiBase, runId: ready.runId });
  expect(containsForbiddenVectorPayload(publicPayloads)).toBe(false);

  const queryInput = page.getByPlaceholder(/Search claims, populations, mechanisms/);
  await queryInput.fill('therapeutic food mortality severe acute malnutrition');
  await page.getByLabel('Unit type').selectOption('effect-estimate');
  await page.getByLabel('IMRAD region').selectOption('results');

  const searchResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith(`/runs/${encodeURIComponent(ready.runId)}/semantic-search`)
      && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Search evidence' }).click();
  const searchResponse = await searchResponsePromise;
  expect(searchResponse.status()).toBe(200);
  const searchPayload = await searchResponse.json();
  expect(containsForbiddenVectorPayload(searchPayload)).toBe(false);
  expect(searchPayload.results.length).toBeGreaterThan(0);
  expect(searchPayload.results.every((entry) =>
    entry.unit.unitType === 'effect-estimate' && entry.unit.imradRole === 'results',
  )).toBe(true);

  await expect(page.locator('.sei-result .sei-type').first()).toHaveText('effect-estimate');
  await expect(page.locator('.sei-provenance').first()).toContainText('results');
  await expect(page.locator('.sei-provenance code').first()).toContainText('/outcomes/');
  await expect(page.locator('.sei-result-body p').first()).toContainText(/mortality/i);

  const clusterButton = page.locator('.sei-cluster-list button').first();
  await expect(clusterButton).toBeVisible();
  const clusterLabel = (await clusterButton.locator('span').innerText()).trim();
  await clusterButton.click();
  await expect(queryInput).toHaveValue(clusterLabel);

  const rebuildResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith(`/runs/${encodeURIComponent(ready.runId)}/semantic-index/rebuild`)
      && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: /Rebuild/ }).click();
  const rebuildResponse = await rebuildResponsePromise;
  expect(rebuildResponse.status()).toBe(200);
  const rebuilt = await rebuildResponse.json();
  expect(containsForbiddenVectorPayload(rebuilt)).toBe(false);
  expect(rebuilt.indexHash).toMatch(/^[a-f0-9]{64}$/);
  expect(rebuilt.embeddingReuse.reused + rebuilt.embeddingReuse.generated).toBe(rebuilt.counts.units);
  await expect(page.getByText('Deterministic lexical-dense baseline active', { exact: true })).toBeVisible();

  await page.screenshot({
    path: 'test-results/semantic-evidence-workbench-success.png',
    fullPage: true,
  });
});
