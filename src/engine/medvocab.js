// Medical terminology expansion for systematic-review search strategies.
//
// Controlled headings, entry terms, hierarchy children, cross-terminology
// concepts, and AI suggestions remain separate. A source can suggest useful
// language without becoming a native database heading.

import { activeProvider, callProvider } from "./providers.js";
import { getSecret, hasSecret, putSecret, vaultStatus } from "./secureVault.js";
import { cloudAuthEnabled } from "./cloudAuth.js";
import { bridgeCommand } from "./browserBridge.js";

const OLS = "https://www.ebi.ac.uk/ols4/api";
const UMLS = "https://uts-ws.nlm.nih.gov/rest";
const BIOPORTAL = "https://data.bioontology.org";

export const NATIVE_VOCABULARIES = [
  { id: "mesh", label: "MeSH", databases: "PubMed · MEDLINE · CENTRAL", url: "https://meshb.nlm.nih.gov/" },
  { id: "emtree", label: "Emtree", databases: "Embase", url: "https://www.elsevier.com/products/embase" },
  { id: "cinahl", label: "CINAHL Headings", databases: "CINAHL", url: "https://about.ebsco.com/products/research-databases/cinahl-ultimate" },
  { id: "apa", label: "APA Thesaurus", databases: "PsycINFO", url: "https://www.apa.org/pubs/databases/training/thesaurus" },
  { id: "decs", label: "DeCS", databases: "LILACS · VHL", url: "https://decs.bvsalud.org/" },
];

export const THESAURUS_SOURCES = [
  { id: "mesh", name: "MeSH", kind: "controlled vocabulary", use: "Native MEDLINE heading, entry terms, and hierarchy", url: "https://www.nlm.nih.gov/mesh/meshhome.html", integration: "keyless" },
  { id: "umls", name: "UMLS", kind: "terminology mapping", use: "Licensed cross-vocabulary identifiers and concepts", url: "https://uts.nlm.nih.gov/uts/umls/home", integration: "api-key" },
  { id: "bioportal", name: "BioPortal", kind: "ontology repository", use: "Ontology-specific labels, synonyms, mappings, and hierarchy", url: "https://bioportal.bioontology.org/", integration: "api-key" },
  { id: "snomed", name: "SNOMED CT", kind: "clinical terminology", use: "Clinical-language discovery; not a bibliographic heading", url: "https://browser.ihtsdotools.org/", integration: "supervised" },
  { id: "emerse", name: "EMERSE", kind: "synonym discovery", use: "Clinical phrases, abbreviations, variants, and misspellings", url: "https://project-emerse.org/synonyms.html", integration: "supervised" },
  { id: "medsynonyms", name: "MedSynonyms", kind: "synonym discovery", use: "Candidate terms for manual review", url: "https://www.medsynonyms.com/#about", integration: "supervised" },
  { id: "openmd", name: "OpenMD", kind: "reference dictionary", use: "Definitions and candidate language", url: "https://openmd.com/dictionary/", integration: "supervised" },
  { id: "medical-wordlist", name: "Medical wordlist", kind: "lexical wordlist", use: "Spelling support only; not a synonym graph", url: "https://github.com/glutanimate/wordlist-medicalterms-en", integration: "reference" },
  { id: "protege", name: "Protégé", kind: "ontology editor", use: "Author a local ontology; not a terminology source", url: "https://protege.stanford.edu/", integration: "reference" },
  { id: "freedictionary", name: "Medical Dictionary", kind: "reference dictionary", use: "Definitions and candidate language", url: "https://medical-dictionary.thefreedictionary.com/", integration: "supervised" },
];

const clean = (value) => String(value ?? "").trim();
const fold = (value) => clean(value).toLocaleLowerCase();
const keyPurpose = (sourceId) => `terminology/${sourceId}/api-key`;

function uniqueStrings(values) {
  const seen = new Set();
  return values.map(clean).filter((value) => {
    const key = fold(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueCandidates(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = [value.vocabulary, value.id, fold(value.label), value.relation].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sourceAcronym(uri = "") {
  const match = String(uri).match(/\/ontologies\/([^/?#]+)/i);
  return match?.[1]?.toUpperCase() || "";
}

function vocabularyForSource(source) {
  const id = String(source || "").toUpperCase();
  if (["MSH", "MESH"].includes(id)) return "mesh";
  if (id.startsWith("SNOMEDCT")) return "snomed";
  return id ? id.toLocaleLowerCase() : "umls";
}

export function terminologyCredentialStatus(sourceId) {
  const stored = hasSecret(keyPurpose(sourceId));
  const unlocked = vaultStatus().unlocked;
  return { stored, unlocked, available: stored && unlocked, locked: stored && !unlocked };
}

export async function saveTerminologyApiKey(sourceId, apiKey) {
  if (!["umls", "bioportal"].includes(sourceId)) return { ok: false, error: "Unsupported terminology service." };
  return putSecret(keyPurpose(sourceId), clean(apiKey) || null);
}

export function terminologySourceUrl(sourceId, term = "", recordUrl = "") {
  if (recordUrl) return recordUrl.replace(/^http:/, "https:");
  const source = THESAURUS_SOURCES.find((item) => item.id === sourceId);
  if (!source) return "";
  if (sourceId === "bioportal" && clean(term)) return `https://bioportal.bioontology.org/search?q=${encodeURIComponent(clean(term))}`;
  if (sourceId === "freedictionary" && clean(term)) return `https://medical-dictionary.thefreedictionary.com/${encodeURIComponent(clean(term))}`;
  return source.url;
}

// EBI OLS4 provides keyless, CORS-enabled access to the current MeSH ontology
// representation while preserving official NLM descriptor IRIs and identifiers.
// Vocabulary source abbreviations for UMLS searches
export const UMLS_SOURCES = {
  MSH: "MeSH", SNOMEDCT_US: "SNOMED CT US", SNOMEDCT: "SNOMED CT Intl",
  LNC: "LOINC", RXNORM: "RxNorm", CPT: "CPT", CDT: "CDT",
  HCPCS: "HCPCS", ICD10CM: "ICD-10-CM", ICD10: "ICD-10", NCI: "NCI Thesaurus",
  OMIM: "OMIM", GO: "Gene Ontology", HGNC: "HGNC", FMA: "FMA",
};

// --- EBI OLS4 (keyless MeSH + ontology access) ---

export async function olsSearch(term, ontology = "mesh", rows = 8, { throwOnError = false } = {}) {
  try {
    const params = new URLSearchParams({
      q: clean(term),
      ontology,
      rows: String(rows),
      fieldList: "label,synonym,iri,obo_id,is_obsolete",
    });
    const res = await fetch(`${OLS}/search?${params}`);
    if (!res.ok) {
      if (throwOnError) throw new Error(`OLS request failed (${res.status})`);
      return [];
    }
    const data = await res.json();
    return (data.response?.docs || [])
      .filter((item) => item.is_obsolete !== true && item.is_obsolete !== "true")
      .map((item) => ({
        label: clean(item.label),
        synonyms: uniqueStrings(item.synonym || []),
        iri: clean(item.iri).replace(/^http:/, "https:"),
        id: clean(item.obo_id).replace(/^mesh:/i, "MESH:"),
        vocabulary: ontology,
        exact: fold(item.label) === fold(term) || (item.synonym || []).some((synonym) => fold(synonym) === fold(term)),
      }))
      .filter((item) => item.label);
  } catch (error) {
    if (throwOnError) throw error;
    return [];
  }
}

export async function olsChildren(iri, ontology = "mesh", size = 25) {
  try {
    const encoded = encodeURIComponent(encodeURIComponent(String(iri).replace(/^https:/, "http:")));
    const res = await fetch(`${OLS}/ontologies/${ontology}/terms/${encoded}/hierarchicalChildren?size=${size}`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data._embedded?.terms || []).map((term) => ({
      label: clean(term.label),
      iri: clean(term.iri).replace(/^http:/, "https:"),
      id: clean(term.obo_id).replace(/^mesh:/i, "MESH:"),
      vocabulary: ontology,
    })).filter((term) => term.label);
  } catch {
    return [];
  }
}

export async function umlsSearch(term, { apiKey, sources = ["MSH", "SNOMEDCT_US"], pageSize = 25 } = {}) {
  if (!clean(apiKey)) return [];
  let results;
  if (cloudAuthEnabled()) {
    const response = await bridgeCommand("terminology_umls_search", { term: clean(term), apiKey: clean(apiKey), sources, pageSize });
    if (!response.ok || response.error) throw new Error(response.error || "UMLS server lookup failed");
    results = response.results || [];
  } else {
    const params = new URLSearchParams({
      string: clean(term), apiKey: clean(apiKey), sabs: sources.join(","), returnIdType: "sourceUi",
      searchType: "words", includeObsolete: "false", includeSuppressible: "false",
      pageSize: String(Math.min(200, Math.max(1, pageSize))),
    });
    const res = await fetch(`${UMLS}/search/current?${params}`);
    if (!res.ok) throw new Error(`UMLS request failed (${res.status})`);
    results = (await res.json()).result?.results || [];
  }
  return uniqueCandidates(results.filter((item) => item.ui && item.name && item.ui !== "NONE").map((item) => ({
    label: clean(item.name),
    id: clean(item.ui),
    uri: clean(item.uri),
    source: "umls",
    sourceLabel: clean(item.rootSource) || "UMLS",
    vocabulary: vocabularyForSource(item.rootSource),
    relation: "mapped-concept",
    semanticTypes: item.semanticTypes || [],
    verification: "source-asserted",
  })));
}

export async function bioPortalSearch(term, { apiKey, ontologies = ["MESH", "SNOMEDCT"], pageSize = 25 } = {}) {
  if (!clean(apiKey)) return [];
  const params = new URLSearchParams({
    q: clean(term),
    ontologies: ontologies.join(","),
    require_exact_match: "false",
    also_search_obsolete: "false",
    include: "prefLabel,synonym,notation,cui,semanticType,obsolete",
    pagesize: String(pageSize),
    display_context: "false",
  });
  const res = await fetch(`${BIOPORTAL}/search?${params}`, {
    headers: { Authorization: `apikey token=${clean(apiKey)}` },
  });
  if (!res.ok) throw new Error(`BioPortal request failed (${res.status})`);
  const data = await res.json();
  return uniqueCandidates((data.collection || []).filter((item) => item.obsolete !== true && item.prefLabel).map((item) => {
    const acronym = sourceAcronym(item.links?.ontology || item["@id"]);
    return {
      label: clean(item.prefLabel),
      synonyms: uniqueStrings(item.synonym || []),
      id: clean(item.notation?.[0] || item.notation || item.cui?.[0] || item.cui || item["@id"]),
      uri: clean(item.links?.ui || item["@id"]),
      source: "bioportal",
      sourceLabel: acronym || "BioPortal",
      vocabulary: vocabularyForSource(acronym),
      relation: "ontology-concept",
      semanticTypes: item.semanticType || [],
      verification: "source-asserted",
    };
  }));
}

export async function aiSynonyms(term) {
  const provider = activeProvider();
  if (!provider) return [];
  try {
    const raw = await callProvider(provider.id, [
      { role: "system", content: "You are a medical librarian proposing candidate free-text terms. Never call a term a controlled heading. Output strict JSON only." },
      { role: "user", content: `List candidate free-text synonyms, spelling variants (US/UK), abbreviations, and lay terms for: "${clean(term)}". Return JSON: {"terms": ["...", "..."]} with 6-14 items.` },
    ], { json: true });
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) : {};
    return Array.isArray(parsed.terms) ? uniqueStrings(parsed.terms) : [];
  } catch {
    return [];
  }
}

export async function expandConcept(term, { explode = true, includeAi = true } = {}) {
  const seed = clean(term);
  const [meshMatches, ai, umlsKey, bioPortalKey] = await Promise.all([
    olsSearch(seed, "mesh"),
    includeAi ? aiSynonyms(seed) : [],
    getSecret(keyPurpose("umls")),
    getSecret(keyPurpose("bioportal")),
  ]);

  const primary = meshMatches.find((match) => match.exact) || meshMatches[0];
  const narrower = explode && primary?.iri ? await olsChildren(primary.iri, "mesh") : [];
  const serviceCalls = await Promise.allSettled([
    umlsKey ? umlsSearch(seed, { apiKey: umlsKey }) : Promise.resolve([]),
    bioPortalKey ? bioPortalSearch(seed, { apiKey: bioPortalKey }) : Promise.resolve([]),
  ]);

  const descriptors = meshMatches.map((match) => ({
    label: match.label,
    id: match.id,
    uri: match.iri,
    source: "mesh",
    sourceLabel: "MeSH",
    vocabulary: "mesh",
    relation: "descriptor",
    verification: "source-asserted",
    exact: match.exact,
  }));
  const entryTerms = uniqueCandidates(meshMatches.flatMap((match) => match.synonyms.map((label) => ({
    label,
    id: match.id,
    uri: match.iri,
    source: "mesh",
    sourceLabel: "MeSH entry term",
    vocabulary: "free-text",
    relation: "entry-term",
    verification: "source-asserted",
  }))));
  const narrowerCandidates = uniqueCandidates(narrower.map((item) => ({
    ...item,
    uri: item.iri,
    source: "mesh",
    sourceLabel: "MeSH",
    relation: "narrower-descriptor",
    verification: "source-asserted",
  })));
  const aiCandidates = ai.map((label) => ({
    label,
    source: "ai",
    sourceLabel: "AI suggestion",
    vocabulary: "free-text",
    relation: "lexical-suggestion",
    verification: "unverified",
  }));
  const warnings = [];
  if (!meshMatches.length) warnings.push("No MeSH match was returned. Use the supervised sources or enter a verified native heading manually.");
  if (terminologyCredentialStatus("umls").locked) warnings.push("The UMLS key is stored, but the user vault is locked.");
  if (terminologyCredentialStatus("bioportal").locked) warnings.push("The BioPortal key is stored, but the user vault is locked.");
  if (serviceCalls[0].status === "rejected") warnings.push("UMLS was unavailable; no UMLS candidates were added.");
  if (serviceCalls[1].status === "rejected") warnings.push("BioPortal was unavailable; no BioPortal candidates were added.");

  return {
    seed,
    descriptors,
    entryTerms,
    narrower: narrowerCandidates,
    mapped: uniqueCandidates([
      ...(serviceCalls[0].status === "fulfilled" ? serviceCalls[0].value : []),
      ...(serviceCalls[1].status === "fulfilled" ? serviceCalls[1].value : []),
    ]),
    ai: aiCandidates,
    warnings,
    services: {
      mesh: { available: meshMatches.length > 0, configured: true },
      umls: { available: !!umlsKey && serviceCalls[0].status === "fulfilled", configured: hasSecret(keyPurpose("umls")) },
      bioportal: { available: !!bioPortalKey && serviceCalls[1].status === "fulfilled", configured: hasSecret(keyPurpose("bioportal")) },
    },
    // Compatibility fields for older callers. Nothing is silently promoted.
    freetext: [seed].filter(Boolean),
    mesh: [],
    exploded: narrowerCandidates.map((candidate) => candidate.label),
  };
}
