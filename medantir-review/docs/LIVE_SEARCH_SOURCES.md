# Official live-source contracts

This implementation is based on the official source APIs current as of August 2026.

## PubMed / NCBI

Medantir uses NCBI E-utilities. `ESearch` executes the PubMed query and returns PMIDs; `EFetch` retrieves those PMIDs in MEDLINE text format. Long systematic-review queries are sent with HTTP POST. NCBI recommends identifying the tool and contact email and limits unauthenticated sites to low request rates unless an API key is supplied.

## Europe PMC

Medantir uses the Europe PMC REST search endpoint with `resultType=core`. Pagination uses `cursorMark`; each following request uses `nextCursorMark` until the reported `hitCount` is exhausted. Europe PMC allows up to 1000 articles per page.

## ClinicalTrials.gov

Medantir uses the modern ClinicalTrials.gov API v2 `/studies` endpoint. The review query is sent in `query.term`; result pages are traversed with `pageToken`, with up to 1000 studies per response. The API is the authoritative replacement for the classic query endpoints.

These services are treated as primary retrieval sources. OpenAlex and Crossref remain discovery/identifier-enrichment sources and must not impersonate PubMed, a trial registry, or another primary database.
