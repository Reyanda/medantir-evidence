# Live Search Architecture

Medantir distinguishes search-strategy generation from search execution.

For open sources, the execution layer now uses the source's official service and must reconcile every reported hit with an exported record before the stage can pass.

- **PubMed:** NCBI E-utilities `ESearch` on `db=pubmed`, followed by batched `EFetch` in MEDLINE text format. Queries larger than the configured complete-export ceiling fail closed instead of returning a partial set.
- **Europe PMC:** REST search with `resultType=core` and `cursorMark` pagination until `hitCount` is fully retrieved.
- **ClinicalTrials.gov:** modern REST API v2 `/studies` with `pageToken` pagination and total-count reconciliation.

Licensed databases remain routed through the institutional browser bridge and saved, user-authorized sessions. They must never silently fall back to a different open database when authentication is missing.

`REVIEW_MAX_SEARCH_RECORDS` is a safety ceiling, not a sampling target. If a systematic-review query exceeds it, the correct action is to segment the search reproducibly or raise the ceiling; Medantir must not truncate the evidence set.

The pull-request CI contains a live-network smoke job that issues bounded, source-native baricitinib/COVID-19 searches against all three official open services. Contract tests separately exercise pagination and fail-closed behavior without depending on external availability.
