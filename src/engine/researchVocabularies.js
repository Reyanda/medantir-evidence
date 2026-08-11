// Cross-domain vocabulary registry and keyless lookup adapters.
//
// These sources do not share one semantic contract. Thesauri can provide
// preferred/alternative labels, ontologies provide concept labels and
// relations, classifications provide codes, and registries discover other
// vocabularies. Results from this module are reviewable free-text candidates;
// they are never database-native headings by implication.

import { olsSearch } from "./medvocab.js";

export const VOCABULARY_DOMAINS = [
  { id: "medical", label: "Medical", description: "MeSH plus optional licensed medical terminology services." },
  { id: "social-sciences", label: "Social sciences", description: "Multilingual thesauri, subject headings, and social-data vocabularies." },
  { id: "finance-economics", label: "Finance & economics", description: "Economic thesauri, finance ontologies, classifications, and reporting repositories." },
  { id: "stem", label: "STEM", description: "Life, chemical, environmental, earth, nuclear, and astronomy vocabularies." },
  { id: "registries", label: "Vocabulary registries", description: "Services for discovering vocabularies; not direct semantic authorities." },
];

export const RESOURCE_TYPE_POLICY = {
  thesaurus: {
    candidateLabels: true,
    discoveryOnly: false,
    nativeHeading: false,
    guidance: "Preferred and alternative labels may be reviewed for free-text expansion.",
  },
  "subject headings": {
    candidateLabels: true,
    discoveryOnly: false,
    nativeHeading: false,
    guidance: "A subject heading is native only in a catalogue or database that explicitly uses it.",
  },
  ontology: {
    candidateLabels: true,
    discoveryOnly: false,
    nativeHeading: false,
    guidance: "Ontology labels and identifiers support semantic annotation, not automatic bibliographic headings.",
  },
  "database and ontology": {
    candidateLabels: true,
    discoveryOnly: false,
    nativeHeading: false,
    guidance: "Database labels and ontology relations are source-specific candidate terminology.",
  },
  classification: {
    candidateLabels: false,
    discoveryOnly: false,
    nativeHeading: false,
    guidance: "Classification codes are recorded as codes/facets, not expanded as synonyms.",
  },
  "reporting taxonomy registry": {
    candidateLabels: false,
    discoveryOnly: true,
    nativeHeading: false,
    guidance: "Reporting taxonomies define filing concepts for specific reporting environments.",
  },
  "message repository": {
    candidateLabels: false,
    discoveryOnly: true,
    nativeHeading: false,
    guidance: "Repository concepts define financial messages and data fields, not literature-search synonyms.",
  },
  "linked database view": {
    candidateLabels: false,
    discoveryOnly: true,
    nativeHeading: false,
    guidance: "The view links database records around an entity; it is not a general thesaurus.",
  },
  "metadata registry": {
    candidateLabels: false,
    discoveryOnly: true,
    nativeHeading: false,
    guidance: "The registry discovers knowledge-organization systems; validate terms in the source vocabulary.",
  },
  "vocabulary registry": {
    candidateLabels: false,
    discoveryOnly: true,
    nativeHeading: false,
    guidance: "The registry indexes linked-data vocabularies; it does not validate search terms for every database.",
  },
  "ontology repository": {
    candidateLabels: false,
    discoveryOnly: true,
    nativeHeading: false,
    guidance: "The repository hosts ontologies with independent scopes and licences.",
  },
};

export const RESEARCH_VOCABULARY_SOURCES = [
  // Social sciences
  { id: "elsst", name: "ELSST", domain: "social-sciences", resourceType: "thesaurus", integration: "live keyless", use: "Multilingual social-science preferred terms, entry terms, and concept URIs.", url: "https://elsst.cessda.eu/" },
  { id: "thesoz", name: "TheSoz", domain: "social-sciences", resourceType: "thesaurus", integration: "live keyless", use: "GESIS social-science descriptors with multilingual labels and linked-data mappings.", url: "https://data.gesis.org/cvbrowser/thesoz/en/" },
  { id: "sage-social", name: "SAGE Social Science Thesaurus", domain: "social-sciences", resourceType: "thesaurus", integration: "live keyless", use: "Broad social-science concepts and relationships; non-commercial reuse conditions apply.", url: "https://concepts.sagepub.com/vocabularies/social-science/en/" },
  { id: "icpsr", name: "ICPSR Thesaurus", domain: "social-sciences", resourceType: "thesaurus", integration: "supervised", use: "Subject and geographic terms used for ICPSR social-science data discovery.", url: "https://www.icpsr.umich.edu/web/ICPSR/thesaurus/index" },
  { id: "hasset", name: "HASSET", domain: "social-sciences", resourceType: "thesaurus", integration: "legacy reference", use: "UK Data Service thesaurus historically linked to ELSST; the current public route redirects to ELSST.", url: "https://hasset.ukdataservice.ac.uk/hasset/en/" },
  { id: "unesco", name: "UNESCO Thesaurus", domain: "social-sciences", resourceType: "thesaurus", integration: "live keyless", use: "Multilingual concepts across education, culture, sciences, communication, and social sciences.", url: "https://vocabularies.unesco.org/" },
  { id: "apa-thesaurus", name: "APA Thesaurus", domain: "social-sciences", resourceType: "thesaurus", integration: "native platform", use: "Controlled index terms for APA databases; verify through the subscribed database thesaurus.", url: "https://www.apa.org/pubs/databases/training/thesaurus" },
  { id: "lcsh", name: "Library of Congress Subject Headings", domain: "social-sciences", resourceType: "subject headings", integration: "live keyless", use: "Library authority headings with persistent identifiers; not automatically native to literature databases.", url: "https://id.loc.gov/authorities/subjects.html" },
  { id: "eurovoc", name: "EuroVoc", domain: "social-sciences", resourceType: "thesaurus", integration: "supervised", use: "EU multilingual, multidisciplinary concepts spanning policy, law, economics, trade, and society.", url: "https://op.europa.eu/en/web/eu-vocabularies/eurovoc" },

  // Finance and economics
  { id: "fibo", name: "FIBO", domain: "finance-economics", resourceType: "ontology", integration: "supervised", use: "OWL definitions and relationships for financial entities, instruments, contracts, and processes.", url: "https://spec.edmcouncil.org/fibo/" },
  { id: "stw", name: "STW Thesaurus for Economics", domain: "finance-economics", resourceType: "thesaurus", integration: "live keyless", use: "Bilingual economics descriptors, synonyms, persistent URIs, and cross-vocabulary mappings.", url: "https://www.zbw.eu/en/about-us/information-organisation/stw-thesaurus-for-economics" },
  { id: "xbrl-taxonomies", name: "XBRL Taxonomy Registry", domain: "finance-economics", resourceType: "reporting taxonomy registry", integration: "supervised", use: "Find reporting-environment-specific digital taxonomies; there is no single global XBRL thesaurus.", url: "https://taxonomies.xbrl.org/" },
  { id: "jel", name: "JEL Classification", domain: "finance-economics", resourceType: "classification", integration: "supervised", use: "Codes for classifying economics literature; record codes as facets rather than synonyms.", url: "https://www.aeaweb.org/econlit/jelCodes.php" },
  { id: "iso20022", name: "ISO 20022 Repository", domain: "finance-economics", resourceType: "message repository", integration: "supervised", use: "Industry-agreed financial-services business concepts, data dictionary, and message definitions.", url: "https://www.iso20022.org/iso20022-repository" },

  // Pure and applied sciences
  { id: "go", name: "Gene Ontology", domain: "stem", resourceType: "ontology", integration: "live keyless", use: "Species-independent biological process, molecular function, and cellular component concepts.", url: "https://geneontology.org/" },
  { id: "envo", name: "Environment Ontology", domain: "stem", resourceType: "ontology", integration: "live keyless", use: "Controlled descriptions of environmental entities and settings.", url: "https://environmentontology.org/" },
  { id: "chebi", name: "ChEBI", domain: "stem", resourceType: "database and ontology", integration: "live keyless", use: "Curated chemical entities, identifiers, synonyms, structures, and ontological classification.", url: "https://www.ebi.ac.uk/chebi/" },
  { id: "sweet", name: "SWEET", domain: "stem", resourceType: "ontology", integration: "supervised", use: "Earth and environmental terminology originally developed at NASA and maintained by the ESIP community.", url: "https://github.com/ESIPFed/sweet" },
  { id: "agrovoc", name: "AGROVOC", domain: "stem", resourceType: "thesaurus", integration: "live keyless", use: "FAO multilingual concepts for food, agriculture, environment, biology, and forestry.", url: "https://agrovoc.fao.org/" },
  { id: "inis-thesaurus", name: "INIS Multilingual Thesaurus", domain: "stem", resourceType: "thesaurus", integration: "supervised", use: "IAEA descriptors for nuclear science and technology, used in the INIS repository.", url: "https://www.iaea.org/resources/databases/inis" },
  { id: "uat", name: "Unified Astronomy Thesaurus", domain: "stem", resourceType: "thesaurus", integration: "supervised", use: "Open, community-supported SKOS concepts for astronomy and astrophysics.", url: "https://astrothesaurus.org/" },
  { id: "pubchem-taxonomy", name: "PubChem Taxonomy", domain: "stem", resourceType: "linked database view", integration: "supervised", use: "PubChem records associated with an organism/taxon; not a chemical synonym authority.", url: "https://pubchem.ncbi.nlm.nih.gov/docs/taxonomies" },

  // Metaregistries and repositories
  { id: "bartoc", name: "BARTOC", domain: "registries", resourceType: "metadata registry", integration: "discovery", use: "Discover and compare thesauri, ontologies, classifications, and terminology services.", url: "https://bartoc.org/" },
  { id: "lov", name: "Linked Open Vocabularies", domain: "registries", resourceType: "vocabulary registry", integration: "discovery", use: "Discover RDF/OWL vocabularies and inspect their metadata, use, and evolution.", url: "https://lov.linkeddata.es/dataset/lov/" },
  { id: "bioportal-registry", name: "BioPortal", domain: "registries", resourceType: "ontology repository", integration: "API key", use: "Biomedical ontology search, mappings, annotation, and recommendations; each ontology retains its own licence.", url: "https://bioportal.bioontology.org/" },
  { id: "agroportal", name: "AgroPortal", domain: "registries", resourceType: "ontology repository", integration: "discovery", use: "Repository and terminology services for agronomy, food, plant, and biodiversity ontologies.", url: "https://agroportal.lirmm.fr/" },
];

const LOOKUPS = {
  elsst: { kind: "skosmos", base: "https://thesauri.cessda.eu/rest/v1", vocab: "elsst-6" },
  thesoz: { kind: "skosmos", base: "https://data.gesis.org/cvbrowser/rest/v1", vocab: "thesoz" },
  "sage-social": { kind: "skosmos", base: "https://concepts.sagepub.com/vocabularies/rest/v1", vocab: "social-science" },
  unesco: { kind: "skosmos", base: "https://vocabularies.unesco.org/rest/v1/unesco" },
  agrovoc: { kind: "skosmos", base: "https://agrovoc.fao.org/browse/rest/v1" },
  lcsh: { kind: "lcsh" },
  stw: { kind: "stw" },
  go: { kind: "ols", ontology: "go" },
  envo: { kind: "ols", ontology: "envo" },
  chebi: { kind: "ols", ontology: "chebi" },
};

const clean = (value) => String(value ?? "").trim();
const fold = (value) => clean(value).toLocaleLowerCase();

function sourceById(sourceId) {
  return RESEARCH_VOCABULARY_SOURCES.find((source) => source.id === sourceId);
}

function sourceIdentifier(uri = "", fallback = "") {
  const value = clean(uri).replace(/\/$/, "");
  return clean(fallback) || value.split(/[/#]/).filter(Boolean).at(-1) || value;
}

function uniqueCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = `${candidate.source}|${candidate.id || candidate.uri}|${fold(candidate.label)}|${candidate.relation}`;
    if (!candidate.label || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function candidate(source, { label, uri = "", id = "", relation, conceptLabel = "" }) {
  return {
    label: clean(label),
    id: sourceIdentifier(uri, id),
    uri: clean(uri),
    source: source.id,
    sourceLabel: source.name,
    vocabulary: "free-text",
    relation,
    conceptLabel: clean(conceptLabel),
    domain: source.domain,
    resourceType: source.resourceType,
    verification: "source-asserted",
    appliedAs: "free-text",
  };
}

async function jsonResponse(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`Vocabulary request failed (${response.status})`);
  return response.json();
}

export function sourcesForDomain(domain) {
  return RESEARCH_VOCABULARY_SOURCES.filter((source) => source.domain === domain);
}

export function canSourceExpand(sourceId) {
  const source = sourceById(sourceId);
  const policy = source ? RESOURCE_TYPE_POLICY[source.resourceType] : null;
  return Boolean(source && policy?.candidateLabels && LOOKUPS[sourceId]);
}

export function domainSupportsExpansion(domain) {
  if (domain === "medical") return true;
  return sourcesForDomain(domain).some((source) => canSourceExpand(source.id));
}

export function researchVocabularyUrl(sourceId, term = "", recordUrl = "") {
  if (clean(recordUrl)) return clean(recordUrl);
  const source = sourceById(sourceId);
  if (!source) return "";
  if (sourceId === "bioportal-registry" && clean(term)) return `https://bioportal.bioontology.org/search?q=${encodeURIComponent(clean(term))}`;
  if (sourceId === "pubchem-taxonomy" && clean(term)) return `https://pubchem.ncbi.nlm.nih.gov/taxonomy/${encodeURIComponent(clean(term))}`;
  return source.url;
}

export async function skosmosSearch(term, sourceId, rows = 6) {
  const source = sourceById(sourceId);
  const lookup = LOOKUPS[sourceId];
  if (!source || lookup?.kind !== "skosmos" || !clean(term)) return [];
  const params = new URLSearchParams({ query: `*${clean(term)}*`, lang: "en", maxhits: String(rows) });
  if (lookup.vocab) params.set("vocab", lookup.vocab);
  const data = await jsonResponse(`${lookup.base}/search?${params}`);
  const matches = (data.results || []).slice(0, rows);
  const details = await Promise.allSettled(matches.map((match) => {
    const labelParams = new URLSearchParams({ uri: clean(match.uri), lang: "en" });
    return jsonResponse(`${lookup.base}/label?${labelParams}`);
  }));
  return uniqueCandidates(matches.flatMap((match, index) => {
    const detail = details[index].status === "fulfilled" ? details[index].value : {};
    const preferred = clean(detail.prefLabel || match.prefLabel);
    const uri = clean(match.uri || detail.uri);
    const id = clean(match.localname);
    return [
      candidate(source, { label: preferred, uri, id, relation: "preferred-label" }),
      ...((detail.altLabel || []).map((label) => candidate(source, {
        label,
        uri,
        id,
        relation: "alternative-label",
        conceptLabel: preferred,
      }))),
    ];
  }));
}

export async function stwSearch(term, rows = 8) {
  const source = sourceById("stw");
  if (!clean(term)) return [];
  const params = new URLSearchParams({ query: clean(term), dataset: "stw", lang: "en" });
  const data = await jsonResponse(`https://zbw.eu/beta/econ-ws/suggest?${params}`, {
    headers: { Accept: "application/sparql-results+json" },
  });
  return uniqueCandidates((data.results?.bindings || []).slice(0, rows).flatMap((binding) => {
    const preferred = clean(binding.prefLabel?.value || binding.term?.value);
    const matched = clean(binding.term?.value);
    const uri = clean(binding.concept?.value);
    return [
      candidate(source, { label: preferred, uri, relation: "preferred-label" }),
      ...(matched && fold(matched) !== fold(preferred)
        ? [candidate(source, { label: matched, uri, relation: "alternative-label", conceptLabel: preferred })]
        : []),
    ];
  }));
}

export async function lcshSearch(term, rows = 8) {
  const source = sourceById("lcsh");
  if (!clean(term)) return [];
  const data = await jsonResponse(`https://id.loc.gov/authorities/subjects/suggest/?q=${encodeURIComponent(clean(term))}`);
  const labels = Array.isArray(data?.[1]) ? data[1] : [];
  const uris = Array.isArray(data?.[3]) ? data[3] : [];
  return uniqueCandidates(labels.slice(0, rows).map((label, index) => candidate(source, {
    label,
    uri: uris[index] || "",
    relation: "subject-heading",
  })));
}

export async function olsVocabularySearch(term, sourceId, rows = 6) {
  const source = sourceById(sourceId);
  const lookup = LOOKUPS[sourceId];
  if (!source || lookup?.kind !== "ols" || !clean(term)) return [];
  const matches = await olsSearch(clean(term), lookup.ontology, rows, { throwOnError: true });
  return uniqueCandidates(matches.flatMap((match) => [
    candidate(source, { label: match.label, uri: match.iri, id: match.id, relation: "ontology-label" }),
    ...(match.synonyms || []).map((label) => candidate(source, {
      label,
      uri: match.iri,
      id: match.id,
      relation: "ontology-synonym",
      conceptLabel: match.label,
    })),
  ]));
}

export async function searchResearchSource(term, sourceId, rows = 6) {
  const lookup = LOOKUPS[sourceId];
  if (!lookup) return [];
  if (lookup.kind === "skosmos") return skosmosSearch(term, sourceId, rows);
  if (lookup.kind === "stw") return stwSearch(term, rows);
  if (lookup.kind === "lcsh") return lcshSearch(term, rows);
  if (lookup.kind === "ols") return olsVocabularySearch(term, sourceId, rows);
  return [];
}

export async function expandResearchConcept(term, { domain, sourceIds, rows = 6 } = {}) {
  const seed = clean(term);
  const selected = (sourceIds?.length
    ? sourceIds.map(sourceById).filter(Boolean)
    : sourcesForDomain(domain)).filter((source) => canSourceExpand(source.id));
  const settled = await Promise.allSettled(selected.map((source) => searchResearchSource(seed, source.id, rows)));
  const warnings = [];
  const services = {};
  const candidates = [];
  settled.forEach((result, index) => {
    const source = selected[index];
    if (result.status === "fulfilled") {
      candidates.push(...result.value);
      services[source.id] = { status: result.value.length ? "available" : "no-match", count: result.value.length };
    } else {
      services[source.id] = { status: "unavailable", count: 0 };
      warnings.push(`${source.name} was unavailable; no candidates from that source were added.`);
    }
  });
  if (!selected.length) warnings.push("This domain contains reference, classification, repository, or registry sources only; use the supervised source links.");
  return {
    seed,
    domain,
    candidates: uniqueCandidates(candidates),
    services,
    warnings,
  };
}
