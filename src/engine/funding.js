// funding.js — real research-funding intelligence from OpenAlex (keyless,
// CORS-open). Backs the Resources tab: live funders and funded research for a
// topic/disease, replacing the previous mock grants dataset.

const OA = "https://api.openalex.org";
const MAILTO = "mailto=medantir@medantir.local";

async function getJSON(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

// WHO R&D Blueprint priority pathogens + high-burden diseases — a real taxonomy,
// used to scope the funding view (not fabricated data).
export const PRIORITY_TOPICS = [
  "COVID-19", "Ebola", "Marburg", "Lassa fever", "Nipah virus", "Rift Valley fever",
  "Zika", "Dengue", "Cholera", "Tuberculosis", "Malaria", "HIV", "Influenza",
  "Antimicrobial resistance", "Disease X",
];

// Top funders active on a topic — real entities with output/impact figures.
export async function topFunders(topic, n = 12) {
  const d = await getJSON(`${OA}/funders?search=${encodeURIComponent(topic)}&per_page=${n}&${MAILTO}`);
  if (!d?.results) return [];
  return d.results.map((f) => ({
    id: f.id,
    name: f.display_name,
    country: f.country_code || null,
    works: f.works_count || 0,
    cited: f.cited_by_count || 0,
    description: f.description || "",
    homepage: f.homepage_url || null,
    url: f.id, // OpenAlex entity URL
  }));
}

// Recent/high-impact funded research on a topic — real works with any grant
// attribution OpenAlex holds.
export async function topicWorks(topic, { n = 20, sort = "cited_by_count:desc", funderId } = {}) {
  const filters = [`title.search:${topic}`];
  if (funderId) filters.push(`grants.funder:${funderId.replace("https://openalex.org/", "")}`);
  const d = await getJSON(`${OA}/works?filter=${encodeURIComponent(filters.join(","))}&sort=${sort}&per_page=${n}&${MAILTO}`);
  if (!d?.results) return [];
  return d.results.map((w) => ({
    title: w.title || "(untitled)",
    year: w.publication_year || null,
    cites: w.cited_by_count || 0,
    doi: w.doi ? w.doi.replace(/^https?:\/\/doi\.org\//i, "") : null,
    url: w.doi || w.id,
    type: w.type || "article",
    oa: !!w.open_access?.is_oa,
    funders: (w.grants || []).map((g) => g.funder_display_name).filter(Boolean),
    authors: (w.authorships || []).slice(0, 3).map((a) => a.author?.display_name).filter(Boolean),
  }));
}

// One call for the tab: funders + works + a funding-share breakdown by funder.
export async function fundingIntel(topic) {
  const [funders, works] = await Promise.all([topFunders(topic, 12), topicWorks(topic, { n: 25 })]);
  const total = funders.reduce((s, f) => s + f.works, 0) || 1;
  const shares = funders.slice(0, 8).map((f) => ({ name: f.name, works: f.works, share: Math.round((f.works / total) * 1000) / 10 }));
  return { topic, funders, works, shares };
}
