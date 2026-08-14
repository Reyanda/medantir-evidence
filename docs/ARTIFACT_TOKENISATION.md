# MEDANTIR scientific artifact tokenisation

## Purpose

The tokenisation engine gives every review artifact a deterministic, inspectable representation before it is used for retrieval, model prompting, extraction, appraisal, synthesis, or report generation.

It solves two different problems without conflating them:

1. **Scientific token identity**: stable structural and lexical tokens used for provenance, comparison, validation, audit, replay, and evidence addressing.
2. **Model context accounting**: an explicit estimate or provider-specific exact count used to pack artifacts into a model context window.

Scientific token IDs do not depend on an LLM provider or a model vocabulary. Changing from one model family to another therefore does not change the scientific identity of an artifact. Provider-specific token counts remain an operational property, not evidence identity.

## Coverage

A run tokenisation manifest covers:

```text
@request
@stages
@audit
every key in PipelineState.artifacts
```

This includes, when present:

```text
question and ReviewSpec artifacts
researcher identity and protocol artifacts
search strategies, execution receipts, and retrieved records
deduplication reports
screening decisions and exclusion reasons
lawful full-text references
parsed documents, pages, sections, tables, and spatial locators
included-document packages
extracted studies and quantitative extraction ledgers
risk-of-bias signalling, decisions, and overrides
synthesis inputs, estimands, estimates, covariance, and results
GRADE policies, evidence, and certainty decisions
PRISMA counts, manuscript sections, supplements, and final reports
human-verification packages and decisions
scientific manifests, seals, audit records, and cost receipts
living-review update artifacts
```

The engine is generic over JSON-like scientific artifacts. It does not require a separate hand-written tokenizer for each artifact class. Field contracts add domain constraints where generic tokenisation alone is insufficient.

## Token document

Each artifact produces an immutable token document with:

```text
artifact key
artifact scientific-content hash
token-document hash
generation timestamp
ordered tokens
counts by token kind
counts by IMRAD role
structural and lexical totals
explicit model-token estimate metadata
```

The token-document hash excludes the operational generation time. Tokenising identical scientific content on different dates therefore produces the same document hash and token IDs.

## Token anatomy

Each token records:

```text
tokenId
sequence
artifactKey
jsonPointer
parentTokenId
kind
IMRAD role
semantic roles
text and normalized text, when applicable
start and end offsets within a source string
character length
value hash
```

### Structural tokens

```text
object-start
object-end
array-start
array-end
field
array-item
string
number
boolean
null
```

These preserve the source artifact's hierarchy. A model or verifier can distinguish a value stored under `/outcomes/0/effect` from an identical number stored under `/funding/grantNumber`.

### Lexical tokens

```text
word
identifier
citation
number
operator
punctuation
```

The lexical layer is Unicode-aware. It preserves scientific numbers, operators, identifiers, citations, punctuation, and offsets instead of reducing an artifact to whitespace-separated words.

## IMRAD roles

Every token carries one of the following roles:

```text
title
abstract
introduction
methods
results
discussion
conclusion
limitations
references
supplement
front-matter
other
not-applicable
```

The role is inferred from the typed artifact path and inherited through nested values. For example:

```text
/design                         -> methods
/population                     -> methods
/outcomes/0/name                -> methods or results contract
/outcomes/0/effect              -> results contract
/rationale                      -> introduction
/resultsSummary                 -> results
/discussionSummary              -> discussion
/limitations                    -> limitations
author, funding, grant fields   -> front-matter
studyId and reportIds           -> not-applicable
```

This is not merely a reporting label. Extraction-field validation uses the role to determine whether the cited source region is scientifically admissible.

## Extraction-field contracts

The registry is versioned and hash-addressed. Each field contract declares:

```text
field identity
JSON path pattern
value type
cardinality
evidence-binding mode
allowed IMRAD roles
semantic role
scientific rationale
```

Initial contracts include:

| Field | Binding | Allowed source region |
|---|---|---|
| `studyId` | none | not applicable |
| `reportIds` | none | not applicable |
| `design` | field | methods |
| `population` | field | methods |
| `interventionOrExposure` | field | methods |
| `comparator` | field | methods |
| `outcomes.*.name` | field | methods or results |
| `outcomes.*.effect` | field | results |
| `outcomes.*.standardError` | field | results |
| `mechanisms` | field | introduction, methods, results, or discussion, with the source role retained |
| `funding` | field | front matter, methods, or other explicit funding statement |
| `rationale` | section | introduction |
| `objectives` | section | introduction |
| `resultsSummary` | section | results |
| `discussionSummary` | section | discussion |
| `limitations` | section | limitations or discussion |

### Why this matters

Without field contracts, a plausible model can populate an effect estimate from a methods example, a limitation from an introduction, or an intervention definition from a discussion paragraph. The values can look credible while being scientifically misplaced.

The contract validator therefore checks:

```text
registered field identity
expected value type
required source binding
source excerpt identity
positive page locator
non-empty exact quote
section-bucket consistency
allowed IMRAD role
unknown extraction fields
duplicate source quotes
```

## Extraction-stage enforcement

The extraction stage now applies the contract validator before it can pass.

The transition policy is deliberately fail-closed for material contradictions while preserving visibility of migration debt:

### Hard errors

```text
an excerpt comes from an IMRAD region forbidden for the field
an evidence bucket declares one section but contains another
an extracted value violates its field type
```

These prevent the extraction stage from passing.

### Visible migration debt

```text
an existing field has no source-bound evidence yet
an extension field has not yet received a registry contract
an evidence locator is incomplete
a source quote is duplicated
```

These are emitted as warnings in the stage protocol so older extraction adapters remain inspectable while they are upgraded. The explicit strict validator treats all error-class contract issues as failures and is available to certification workflows.

This distinction avoids both unsafe permissiveness and a false claim that every legacy adapter already provides complete source binding.

## Context planning

`buildArtifactContextPlan()` converts token documents into context chunks without crossing:

```text
artifact boundaries
IMRAD-role boundaries
top-level field boundaries
```

A chunk therefore cannot silently merge a methods definition with a results estimate simply because the combined text fits into a context window.

Inputs include:

```text
maximum context tokens
reserved output tokens
optional exact model-token counter adapter
```

When no exact adapter is supplied, the engine uses a clearly labelled UTF-8 four-byte estimate. It never presents this estimate as the tokenizer output of a named model.

An exact adapter implements:

```ts
interface ModelTokenCounterPort {
  readonly counterId: string;
  readonly exact: true;
  count(text: string): number;
}
```

This permits model-specific counters to be added without changing scientific token IDs or token-document hashes.

## Secret handling

Tokenisation begins from MEDANTIR's secret-safe canonical scientific projection. Raw values under credential-like fields are replaced by `[REDACTED]` before tokens or hashes are generated.

The token document may represent:

```text
credential reference IDs
provider names
routing metadata
non-secret model identifiers
```

It must not contain:

```text
access tokens
refresh tokens
passwords
API keys
client secrets
cookies
bearer credentials
```

## API

Public contract discovery:

```http
GET /evidence-os/extraction-field-contracts
```

Authenticated and owner-and-project-scoped run projections:

```http
GET /runs/:runId/tokenisation-manifest
GET /runs/:runId/artifact-tokens/:artifactKey
GET /runs/:runId/extraction-validation
```

The existing run lookup remains authoritative. The tokenisation API does not maintain a separate ownership index or bypass the review service's authorization boundary.

The reproducibility bundle now includes the run tokenisation manifest alongside the workflow DAG, evidence graph, cost ledger, scientific manifest, and scientific seal.

## Reproducibility invariants

The implementation verifies:

```text
token sequence is contiguous
token IDs reconcile to token content
parent tokens exist and precede their children
all tokens belong to the declared artifact
token counts reconcile to the token list
document hashes reconcile after reload
secret values do not enter token documents
extraction validation hashes reconcile to the report
manifest hashes remain stable across generation times
```

## Current boundaries

The engine does not claim that its deterministic scientific tokens are identical to OpenAI, Anthropic, Google, Meta, Mistral, or any other provider's subword vocabulary.

It also does not create source evidence that does not exist. Tokenisation can expose missing provenance, but it cannot repair an extraction that lacks a lawful full text or exact source excerpt.

The initial extraction contract registry is centred on the existing `ExtractedStudy` model. Diagnostic accuracy, prognosis, prediction models, qualitative themes, economics, implementation, mechanistic evidence, animal evidence, and environmental exposure fields require review-family-specific contract extensions before certification.

Binary bodies should remain in immutable object storage and be represented by content hashes, media metadata, and derived text or spatial artifacts. Tokenisation is not a substitute for PDF parsing, OCR, table reconstruction, image interpretation, or source acquisition.

## Extension rule

A new extraction field is not production-complete merely because it is added to a TypeScript interface. It must also define:

```text
value type and cardinality
allowed source regions
evidence-binding requirements
source locator schema
semantic role
validation fixtures
positive and negative conformance cases
context-packing behaviour
reporting destination
```

This keeps extraction ontology, source provenance, tokenisation, and manuscript structure synchronized.
