// institutional.ts — authenticated evidence-source adapters for subscription
// databases (Ovid MEDLINE/Embase, Scopus, Web of Science, CINAHL) reached through
// the user's institutional entitlements (QMUL, Research4Life).
//
// The AWS bridge server holds no institutional identity of its own. Instead the
// user logs into each database once via the platform Browser tab; the bridge
// captures that authenticated browser session (cookies + storage) under a named
// reference. These adapters replay that session server-side to run the compiled
// search strategy and export records — no credential ever reaches this process.
//
// A database with no configured session resolves to a clearly-labelled empty
// result with a warning, rather than silently degrading to an open-access index.

import type { EvidenceSourceAdapter } from '../core/ports.js';
import type { EvidenceRecord, SearchProvenance, SearchStrategy } from '../core/types.js';
import { BrowserEvidenceSourceAdapter, type BrowserAutomationPort } from './browser-port.js';

/** Per-database recipe: how the bridge drives the authenticated session. The
 *  bridge executes these generically; selectors are tunable after the first
 *  authenticated dry-run without a code change here. */
export interface DatabaseRecipe {
  database: string;
  platform: string;
  /** Provider whose session cookies authenticate this database. */
  entitlement: 'qmul' | 'research4life';
  /** Vault/session reference the bridge loads storage-state from. */
  sessionRef: string;
  /** Search page the bridge navigates to; `{{QUERY}}` is URL-encoded and injected. */
  searchUrlTemplate: string;
  /** Native export format to request from the database UI. */
  exportFormat: 'RIS' | 'NBIB' | 'BIBTEX' | 'JSON';
  /** Optional CSS hooks the bridge uses to submit and export (generic fallbacks apply). */
  selectors?: { queryInput?: string; submit?: string; exportButton?: string; exportFormatOption?: string; exportConfirm?: string; resultRow?: string };
}

// QMUL entitlements cover Ovid (MEDLINE, Embase), Scopus, and Web of Science;
// Research4Life covers CINAHL (EBSCOhost) and mirrors much of the same corpus.
export const DATABASE_RECIPES: Record<string, DatabaseRecipe> = {
  'ovid-medline': {
    database: 'ovid-medline', platform: 'Ovid MEDLINE', entitlement: 'qmul',
    sessionRef: 'db/ovid/qmul',
    searchUrlTemplate: 'https://ovidsp.ovid.com/ovidweb.cgi?T=JS&NEWS=n&CSC=Y&PAGE=main&D=medl',
    exportFormat: 'RIS',
    selectors: { queryInput: '#easy_focus', submit: 'input[name="submit:Perform Search|1"]', resultRow: '.titles-row' },
  },
  'ovid-embase': {
    database: 'ovid-embase', platform: 'Ovid Embase', entitlement: 'qmul',
    sessionRef: 'db/ovid/qmul',
    searchUrlTemplate: 'https://ovidsp.ovid.com/ovidweb.cgi?T=JS&NEWS=n&CSC=Y&PAGE=main&D=emez',
    exportFormat: 'RIS',
    selectors: { queryInput: '#easy_focus', submit: 'input[name="submit:Perform Search|1"]', resultRow: '.titles-row' },
  },
  'scopus': {
    database: 'scopus', platform: 'Scopus', entitlement: 'qmul',
    sessionRef: 'db/scopus/qmul',
    searchUrlTemplate: 'https://www.scopus.com/search/form.uri?display=advanced&query={{QUERY}}',
    exportFormat: 'RIS',
    selectors: { exportButton: 'button[data-testid="export-button"]', resultRow: '.result-item' },
  },
  'wos': {
    database: 'wos', platform: 'Web of Science', entitlement: 'qmul',
    sessionRef: 'db/wos/qmul',
    searchUrlTemplate: 'https://www.webofscience.com/wos/woscc/basic-search',
    exportFormat: 'RIS',
    selectors: { exportButton: 'button[aria-label="Export"]', resultRow: 'app-record' },
  },
  'cinahl': {
    database: 'cinahl', platform: 'CINAHL (EBSCOhost)', entitlement: 'research4life',
    sessionRef: 'db/cinahl/research4life',
    searchUrlTemplate: 'https://research.ebsco.com/c/search?q={{QUERY}}',
    exportFormat: 'RIS',
    selectors: { exportButton: 'button[aria-label="Export"]', resultRow: '.result-list-item' },
  },
};

export const INSTITUTIONAL_DATABASES = new Set(Object.keys(DATABASE_RECIPES));

/** Minimal RIS → EvidenceRecord parser. Databases export RIS reliably; this maps
 *  the common tags. Records missing a title are dropped. */
export function parseRis(ris: string, database: string): EvidenceRecord[] {
  const out: EvidenceRecord[] = [];
  const entries = ris.split(/^ER\s+-.*$/m);
  for (const entry of entries) {
    const tag = (t: string): string[] =>
      [...entry.matchAll(new RegExp(`^${t}\\s+-\\s+(.*)$`, 'gm'))].map((m) => m[1]!.trim()).filter(Boolean);
    const first = (t: string) => tag(t)[0];
    const title = first('TI') ?? first('T1') ?? '';
    if (!title) continue;
    const doi = (first('DO') ?? '').replace(/^https?:\/\/doi\.org\//i, '').toLowerCase() || undefined;
    const yr = first('PY') ?? first('Y1') ?? '';
    const journal = first('JO') ?? first('JF') ?? first('T2');
    const an = first('AN');
    const rec: EvidenceRecord = {
      id: doi ?? `${database}:${title.slice(0, 60).toLowerCase().replace(/\s+/g, '-')}`,
      title,
      abstract: first('AB') ?? first('N2') ?? '',
      authors: [...tag('AU'), ...tag('A1')].slice(0, 10),
      year: yr ? Number(yr.slice(0, 4)) || 0 : 0,
      sourceDatabases: [database],
    };
    if (journal) rec.journal = journal;
    if (doi) rec.doi = doi;
    if (an && /^\d+$/.test(an)) rec.pmid = an;
    out.push(rec);
  }
  return out;
}

/** Verified caller identity forwarded to the bridge. The bridge authenticates the
 *  same Cognito bearer + project header as the platform API, so session replay is
 *  scoped to exactly the user/project that saved the session in the Browser tab. */
export interface BridgeAuth {
  token: string;
  projectId: string;
}

/** Talks to the AWS bridge server's browser-automation endpoint, replaying a
 *  saved authenticated session to run one database search. */
export class BridgeBrowserAutomationPort implements BrowserAutomationPort {
  constructor(
    private readonly bridgeUrl: string,
    private readonly recipes: Record<string, DatabaseRecipe> = DATABASE_RECIPES,
    private readonly auth?: BridgeAuth,
  ) {}

  async runDatabaseSearch(input: {
    database: string; platform: string; query: string; allowedExportFormats: string[];
  }) {
    const recipe = this.recipes[input.database];
    if (!recipe) {
      return { executedQuery: input.query, resultCount: 0, records: [], exportFormat: 'RIS' as const,
        warnings: [`No institutional recipe for ${input.database}`] };
    }
    if (!this.auth?.token) {
      return { executedQuery: input.query, resultCount: 0, records: [], exportFormat: recipe.exportFormat,
        warnings: [`AUTH REQUIRED: no verified caller identity for ${recipe.platform} — sign in to the platform and rerun.`] };
    }
    const res = await fetch(`${this.bridgeUrl.replace(/\/$/, '')}/command`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.auth.token}`,
        'x-actiora-project': this.auth.projectId,
      },
      body: JSON.stringify({
        action: 'db_search',
        // sessionRef is both the bridge session name and the saved-state name;
        // the bridge auto-seeds the context from that saved state, replaying the
        // login the user captured in the Browser tab under the same name.
        session: recipe.sessionRef,
        args: {
          database: recipe.database,
          platform: recipe.platform,
          searchUrl: recipe.searchUrlTemplate.replace('{{QUERY}}', encodeURIComponent(input.query)),
          query: input.query,
          exportFormat: recipe.exportFormat,
          selectors: recipe.selectors ?? {},
        },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // 401/403 from the bridge means the caller's platform token failed
      // verification (expired mid-run) — the operator must sign in again.
      const needsAuth = res.status === 401 || res.status === 403 || /session|auth|login/i.test(body);
      return { executedQuery: input.query, resultCount: 0, records: [], exportFormat: recipe.exportFormat,
        warnings: [needsAuth
          ? `AUTH REQUIRED: platform sign-in expired during ${recipe.platform} search — sign in again and rerun.`
          : `${recipe.platform} bridge search failed (HTTP ${res.status})`] };
    }
    const data: any = await res.json().catch(() => ({}));
    // The bridge reports an institutional login wall as a structured signal.
    if (data.needsAuth === true) {
      return { executedQuery: data.executedQuery ?? input.query, resultCount: 0, records: [], exportFormat: recipe.exportFormat,
        warnings: Array.isArray(data.warnings) && data.warnings.length ? data.warnings
          : [`AUTH REQUIRED: ${recipe.platform} session "${recipe.sessionRef}" missing/expired — log in via the Browser tab and Save session as "${recipe.sessionRef}".`] };
    }
    // Prefer native RIS export (full metadata) over scraped result rows.
    const records: EvidenceRecord[] = typeof data.ris === 'string' && data.ris.trim()
      ? parseRis(data.ris, recipe.database)
      : Array.isArray(data.records) ? data.records : [];
    return {
      executedQuery: data.executedQuery ?? input.query,
      resultCount: typeof data.resultCount === 'number' && data.resultCount > records.length ? data.resultCount : records.length,
      records,
      exportFormat: (data.exportFormat ?? recipe.exportFormat) as 'RIS' | 'NBIB' | 'BIBTEX' | 'JSON',
      warnings: Array.isArray(data.warnings) ? data.warnings : [],
    };
  }
}

/** An adapter that reports "session not configured" without hitting the network —
 *  used when no bridge is wired, so the pipeline records an explicit gap rather
 *  than silently substituting an open-access index. */
class UnconfiguredInstitutionalAdapter implements EvidenceSourceAdapter {
  constructor(public readonly database: string) {}
  async execute(strategy: SearchStrategy): Promise<{ records: EvidenceRecord[]; provenance: SearchProvenance }> {
    const recipe = DATABASE_RECIPES[this.database];
    return {
      records: [],
      provenance: {
        database: this.database,
        platform: recipe?.platform ?? this.database,
        executedQuery: strategy.query,
        executedAt: new Date().toISOString(),
        resultCount: 0,
        exportFormat: recipe?.exportFormat ?? 'RIS',
        warnings: [`AUTH REQUIRED: no institutional bridge configured for ${recipe?.platform ?? this.database}. ` +
          `Set REVIEW_BRIDGE_URL and save a browser session for "${recipe?.sessionRef ?? this.database}".`],
      },
    };
  }
}

/** Factory: returns an authenticated institutional adapter for a subscription
 *  database, or null if the database is not institutional (caller uses the OA path). */
export function institutionalAdapterFor(
  database: string,
  config: { bridgeUrl?: string | undefined; auth?: BridgeAuth | undefined } = {},
): EvidenceSourceAdapter | null {
  const db = database.toLowerCase();
  if (!INSTITUTIONAL_DATABASES.has(db)) return null;
  const bridgeUrl = config.bridgeUrl ?? process.env.REVIEW_BRIDGE_URL;
  if (!bridgeUrl) return new UnconfiguredInstitutionalAdapter(db);
  return new BrowserEvidenceSourceAdapter(db, new BridgeBrowserAutomationPort(bridgeUrl, DATABASE_RECIPES, config.auth));
}
