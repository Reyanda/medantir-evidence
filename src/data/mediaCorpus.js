// mediaCorpus.js — Realistic fallback media corpus across all threat domains.
//
// Used when the live GDELT connector is unavailable (offline / CORS). Structure
// mirrors what GDELT returns (headline, outlet, country, date, url) so the same
// ingest path handles both. Content is representative synthetic reporting — the
// sentiment/domain is computed by the engine, not baked in.

export const MEDIA_CORPUS = [
  // Health
  { headline: "Cholera outbreak spreads rapidly across three northern provinces, hospitals overwhelmed", outlet: "Reuters Health", country: "Sudan", publishedAt: "2026-07-09" },
  { headline: "New malaria vaccine rollout shows breakthrough results, cases fall sharply in pilot districts", outlet: "The Lancet Brief", country: "Kenya", publishedAt: "2026-07-08" },
  { headline: "WHO warns of possible mpox spillover as surveillance gaps widen in border regions", outlet: "AP", country: "DR Congo", publishedAt: "2026-07-10" },
  { headline: "Measles cases surge amid vaccine shortage and cold-chain disruption", outlet: "Al Jazeera", country: "Nigeria", publishedAt: "2026-07-07" },
  { headline: "Health ministry contains suspected Ebola cluster, no new infections in two weeks", outlet: "BBC Africa", country: "Uganda", publishedAt: "2026-07-06" },

  // Defence
  { headline: "Cross-border shelling intensifies as ceasefire talks collapse", outlet: "AFP", country: "Ethiopia", publishedAt: "2026-07-10" },
  { headline: "Militia offensive displaces thousands near contested oil fields", outlet: "Reuters", country: "South Sudan", publishedAt: "2026-07-09" },
  { headline: "Regional bloc brokers fragile ceasefire, troops begin partial withdrawal", outlet: "Al Jazeera", country: "Mali", publishedAt: "2026-07-08" },
  { headline: "Airstrike on market kills dozens, aid corridors blocked", outlet: "The Guardian", country: "Yemen", publishedAt: "2026-07-10" },

  // Climate
  { headline: "Catastrophic flooding submerges farmland, famine risk rises across the Sahel", outlet: "Reuters", country: "Niger", publishedAt: "2026-07-09" },
  { headline: "Record heatwave and prolonged drought devastate pastoral communities", outlet: "BBC", country: "Somalia", publishedAt: "2026-07-08" },
  { headline: "Reforestation project restores watershed, communities report improved harvests", outlet: "Mongabay", country: "Ethiopia", publishedAt: "2026-07-05" },
  { headline: "Cyclone makes landfall, mass evacuations underway along the coast", outlet: "AFP", country: "Mozambique", publishedAt: "2026-07-10" },

  // Energy
  { headline: "National grid collapse triggers nationwide blackout, hospitals on backup power", outlet: "Bloomberg", country: "Nigeria", publishedAt: "2026-07-09" },
  { headline: "Oil pipeline sabotage disrupts exports, prices spike on regional markets", outlet: "Reuters", country: "Libya", publishedAt: "2026-07-08" },
  { headline: "New solar mini-grids restore power to rural clinics, outages fall", outlet: "ESI Africa", country: "Kenya", publishedAt: "2026-07-06" },
  { headline: "Fuel shortage deepens as refinery shutdown enters second week", outlet: "AP", country: "Zimbabwe", publishedAt: "2026-07-10" },

  // Economy
  { headline: "Inflation surges to record high, currency collapse fuels unrest", outlet: "Bloomberg", country: "Zimbabwe", publishedAt: "2026-07-09" },
  { headline: "IMF approves relief package, markets stabilise after debt agreement", outlet: "Financial Times", country: "Ghana", publishedAt: "2026-07-07" },
  { headline: "New sanctions and trade embargo threaten essential medicine imports", outlet: "Reuters", country: "Sudan", publishedAt: "2026-07-10" },

  // Cyber
  { headline: "Ransomware attack cripples national health records system", outlet: "The Record", country: "South Africa", publishedAt: "2026-07-09" },
  { headline: "Major data breach exposes millions of patient files, investigation launched", outlet: "Wired", country: "Kenya", publishedAt: "2026-07-08" },
  { headline: "Coordinated cyberattack targets power grid control systems", outlet: "Reuters", country: "Nigeria", publishedAt: "2026-07-10" },

  // Food & Water
  { headline: "Famine declared as harvest fails and food supply chains break down", outlet: "WFP Newsroom", country: "South Sudan", publishedAt: "2026-07-10" },
  { headline: "Severe malnutrition cases double among children under five", outlet: "UNICEF", country: "Somalia", publishedAt: "2026-07-09" },
  { headline: "Flour fortification programme expands, nutrition indicators improve", outlet: "GAIN", country: "Tanzania", publishedAt: "2026-07-05" },
  { headline: "Water shortage forces rationing as reservoirs hit critical lows", outlet: "AFP", country: "Malawi", publishedAt: "2026-07-08" },

  // Migration
  { headline: "Refugee numbers swell as conflict drives mass displacement across border", outlet: "UNHCR", country: "Chad", publishedAt: "2026-07-10" },
  { headline: "Thousands stranded at border crossing amid humanitarian access denial", outlet: "MSF", country: "Sudan", publishedAt: "2026-07-09" },
  { headline: "Voluntary return programme helps displaced families rebuild homes", outlet: "IOM", country: "Ethiopia", publishedAt: "2026-07-06" },
];
