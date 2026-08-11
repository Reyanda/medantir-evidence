# Registry and Repository Field Crosswalk

This crosswalk distinguishes prospective registration, general registration, archival DOI deposit, and version control. The live form remains the final authority because registry fields and eligibility rules can change.

| Protocol concept | PROSPERO | OSF | Zenodo | GitHub |
|---|---|---|---|---|
| Primary role | Prospective systematic-review registry | General preregistration or registration | Archival deposit and DOI | Version control and release history |
| Title | Review title | Registration title | Deposit title | Repository and release title |
| Review question | Review question or objective fields | Registration responses | Description | `PROTOCOL.md` and structured JSON |
| Review type | Review type or domain | Schema responses and metadata | Keywords and description | Repository metadata |
| Population | Condition, participants, population | Registration responses | Description | Structured protocol JSON |
| Intervention, exposure, test, factor, phenomenon | Dedicated review fields where present | Registration responses | Description and keywords | Structured protocol JSON |
| Comparator | Dedicated field where relevant | Registration responses | Description | Structured protocol JSON |
| Outcomes or concepts | Main and additional outcomes | Registration responses | Description | Structured protocol JSON |
| Eligibility criteria | Inclusion and exclusion fields | Registration responses | Attached protocol | Protocol and JSON |
| Information sources | Databases and other sources | Registration responses and attachments | Attached search package | Versioned search files |
| Full search strategies | Registry text or attachment as permitted | Attachment and response fields | Uploaded files | Versioned files |
| Search testing | Supporting note or attachment | Attachment | Uploaded test report | Versioned test report |
| Search peer review | Method note | Registration response | Uploaded report | Versioned report |
| Screening methods | Methods fields | Registration responses | Attached protocol | Structured protocol |
| Extraction methods | Methods fields | Registration responses | Attached protocol | Structured protocol |
| Risk of bias | Methods fields | Registration responses | Attached protocol | Structured protocol |
| Synthesis | Methods fields | Registration responses | Attached protocol | Structured protocol and code |
| Certainty | Methods fields | Registration responses | Attached protocol | Structured protocol |
| Authors | Named review team | Contributors | Creators | Contributors and `CITATION.cff` |
| ORCID | Login and/or author identity where supported | Contributor profile linkage | Creator ORCID metadata | `CITATION.cff` and profile metadata |
| Funding | Funding fields | Registration metadata | Related metadata | Protocol and metadata files |
| Conflicts | Conflict fields | Registration responses | Attached protocol | Protocol |
| Start and completion dates | Review-stage fields | Registration responses | Description or dates | Milestones and releases |
| Amendments | Update registry record under current rules | Registration update or linked new registration | New version or related record | Commit and release history |
| Persistent identifier | CRD identifier | Persistent URL and DOI for public registrations where applicable | DOI on publication | Commit hash, release URL, optional Zenodo DOI |
| Approval requirement | Registry checks and named-author approval may apply | Contributor approval and archiving workflow | Deposit owner publishes | Repository permissions and protected branch rules |

## Target-selection rules

### PROSPERO

Use when the current eligibility criteria accept the review and the review remains prospective. The engine must recheck the live rules before submission. A browser adapter is used because the public workflow is form-based and may require ORCID login, author approval, or human interaction.

### OSF

Use as the cross-review registration route when PROSPERO is ineligible, incomplete for the review design, or when a richer immutable protocol package is needed. The engine supports authenticated browser or API integration behind a common adapter.

### Zenodo

Use for a citable archival copy and DOI. It is not treated as a substitute for prospective registration. The API adapter can create a draft, upload the complete package, set metadata, and publish after approval.

### GitHub

Use for source-controlled methods, search strategies, code, machine-readable data dictionaries, amendments, issues, and releases. GitHub is not treated as a prospective registry. A GitHub App or least-privilege token should be used.

## Generated machine-readable mappings

Every final protocol package contains:

```text
registration/registry-submission-documents.json
registration/prospero-field-map.json
registration/osf-field-map.json
registration/zenodo-field-map.json
registration/github-field-map.json
```

Each map includes unresolved fields and mandatory human confirmations so that the agent cannot invent values merely to complete a form.
