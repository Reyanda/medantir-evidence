// doctrine.js — Strategic Human Systems Intelligence & Defense Doctrine Engine
//
// Synthesizes global intelligence standards (US IC / CIA ICD 203, UK Professional
// Assessment / MI5 / GCHQ, NATO JISR, WHO Health Intelligence, OECD Anticipatory Governance)
// into enforceable runtime models, product hierarchies, and tradecraft checks for Medantir.

export const INTELLIGENCE_CYCLE = [
  { id: "direction", stage: "01. Direction", shortName: "Direction", description: "Establish Priority Intelligence Requirements (PIRs) tied directly to actionable decisions.", deliverables: ["PIR Mapping", "Decision Horizon", "Targeting Scope"], icon: "Crosshair" },
  { id: "sensing", stage: "02. Sensing", shortName: "Sensing", description: "Active collection & continuous horizon scanning to catch unexpected weak signals across 7 INTs.", deliverables: ["Active Signals", "Horizon Alerts", "Raw Feeds"], icon: "Radio" },
  { id: "validation", stage: "03. Validation", shortName: "Validation", description: "Verify authenticity, temporal/spatial validity, repetition bias, and source independence.", deliverables: ["Source Audits", "Dup Checks", "Method Ratings"], icon: "CheckCircle" },
  { id: "fusion", stage: "04. Fusion", shortName: "Fusion", description: "Corroborate multi-source inputs by actor, location, system, vulnerability, and hypothesis.", deliverables: ["All-Source Matrix", "Gap Maps", "System Models"], icon: "Cpu" },
  { id: "assessment", stage: "05. Assessment", shortName: "Assessment", description: "All-source evaluation using Analysis of Competing Hypotheses (ACH) and ICD 203 standards.", deliverables: ["Finished Judgements", "Confidence Ratings", "ACH Tables"], icon: "Scale" },
  { id: "decision_support", stage: "06. Decision Support", shortName: "Decision Support", description: "Differentiate assessment from policy advocacy; map implications, options, and trade-off risks.", deliverables: ["Options Brief", "Implication Map", "Risk Matrix"], icon: "Sliders" },
  { id: "dissemination", stage: "07. Dissemination", shortName: "Dissemination", description: "Deliver in time to matter, balancing Need-to-Know, Need-to-Protect, and Duty-to-Share.", deliverables: ["Executive Briefings", "EWAR Notifications", "Product Family"], icon: "Bell" },
  { id: "feedback", stage: "08. Feedback & Adaptation", shortName: "Feedback & Adaptation", description: "Audit judgements against ground-truth outcomes; record in forecast register to tune models.", deliverables: ["Forecast Register", "Post-Mortems", "Model Tuning"], icon: "RotateCcw" }
];

export const HUMANS_FRAMEWORK = [
  {
    key: "H",
    dimension: "History & Identity",
    focus: "Historical memory, prior conflict/cooperation, collective trauma, grievances, and identity framing.",
    indicators: ["Path dependence", "Unresolved grievances", "Historical analogies in leadership rhetoric"]
  },
  {
    key: "U",
    dimension: "Units, Actors & Networks",
    focus: "Formal authorities, informal brokers, elites, private sector, community networks, and veto holders.",
    indicators: ["Influence topologies", "Veto power hubs", "Crisis-only intermediaries"]
  },
  {
    key: "M",
    dimension: "Material Conditions & Capabilities",
    focus: "Demographics, health status, food/water security, financial assets, infrastructure, and protective capacity.",
    indicators: ["Resource dependencies", "Infrastructure bottlenecks", "Logistical readiness"]
  },
  {
    key: "A",
    dimension: "Authority, Institutions & Incentives",
    focus: "Enforcement vs formal law, patronage networks, bureaucratic incentives, corruption, and succession.",
    indicators: ["Operational vs formal authority", "Patronage flows", "Institutional friction"]
  },
  {
    key: "N",
    dimension: "Narratives, Norms & Information",
    focus: "Public trust, dominant narratives, disinformation, media ecosystems, and perceived legitimacy.",
    indicators: ["Coordination narratives", "Public sentiment shifts", "Information fragmentation"]
  },
  {
    key: "S",
    dimension: "Shocks, Stresses & Trajectories",
    focus: "Acute shocks, chronic pressures, tipping points, reinforcing feedback loops, and systemic resilience.",
    indicators: ["Feedback loops", "Discontinuity triggers", "Recovery capacity"]
  }
];

export const PROBABILITY_YARDSTICK = [
  { term: "Remote chance", minProb: 0, maxProb: 5, approx: "Up to ~5%" },
  { term: "Highly unlikely", minProb: 10, maxProb: 20, approx: "10–20%" },
  { term: "Unlikely", minProb: 25, maxProb: 35, approx: "25–35%" },
  { term: "Realistic possibility", minProb: 40, maxProb: 50, approx: "40–50%" },
  { term: "Likely or probable", minProb: 55, maxProb: 75, approx: "55–75%" },
  { term: "Highly likely", minProb: 80, maxProb: 90, approx: "80–90%" },
  { term: "Almost certain", minProb: 95, maxProb: 99, approx: "95–99%" }
];

export const CONFIDENCE_LEVELS = [
  { level: "High", description: "Solid, diverse, corroborated evidence base with high consistency and minimal gaps." },
  { level: "Moderate", description: "Credible information base with some gaps, reliance on secondary inference, or moderate volatility." },
  { level: "Low", description: "Fragmentary, uncorroborated, or highly volatile evidence base requiring urgent collection." }
];

export const COLLECTION_INTS = [
  { code: "MILINT", name: "Military Intelligence", source: "ORBAT, force posture, conflict incidents, Indications & Warning (I&W)", medantirConnector: "Conflict Monitor, ACLED Feeds, Clearance 2 Surface", weight: 0.20, military: true },
  { code: "HUMINT", name: "Human Intelligence", source: "Field reports, expert interviews, stakeholder consultations, community surveys", medantirConnector: "DHS Surveys, Interop Hub, Expert Scoring", weight: 0.18 },
  { code: "SIGINT", name: "Signals Intelligence", source: "API signals, network telemetry, automated alerts, system traffic", medantirConnector: "Connectors, Webhooks, API Gateway Telemetry", weight: 0.15 },
  { code: "GEOINT", name: "Geospatial Intelligence", source: "Satellite imagery, GIS layers, boundary shapes, spatial maps", medantirConnector: "OpenStreetMap, Spatial Risk Maps, Boundary Shapes", weight: 0.15 },
  { code: "MASINT", name: "Measurement & Signatures", source: "Weather sensors, biometric markers, climate metrics, epi time-series", medantirConnector: "Open-Meteo Weather/Climate, Epi EWAR Monitors", weight: 0.12 },
  { code: "CYBINT", name: "Cyber Intelligence (CTI)", source: "Threat actor attribution, APT tracking, zero-day indicators, log telemetry", medantirConnector: "Cyber Engine, Sentry, Cloudflare Security", weight: 0.10, military: true },
  { code: "OSINT", name: "Open Source Intelligence", source: "Public media, academic literature, open datasets, press releases", medantirConnector: "GDELT Media Radar, Europe PMC, OpenAlex, PubMed", weight: 0.10 }
];

export const LEVELS_OF_INTELLIGENCE = [
  { level: "Strategic", horizon: "Long-term (Months to Years)", purpose: "Establishes long-range policy, macro trend estimates, military balance, structural risk models, and systemic capability assessments.", volatility: "Low", targetAudience: "Executive leadership, defense staff, donors, national ministers" },
  { level: "Operational", horizon: "Medium-term (Weeks to Months)", purpose: "Drives campaign tracking, regional resource allocation, theater logistics, and program scaling pathways.", volatility: "Moderate", targetAudience: "Program directors, operational commanders, regional coordinators" },
  { level: "Tactical", horizon: "Short-term (Hours to Days)", purpose: "Near-real-time anomaly detection, Order of Battle updates, immediate early warnings, local incident response, and action timing.", volatility: "High", targetAudience: "Frontline operators, tactical duty officers, emergency response teams" }
];

export const INTELLIGENCE_DOMAINS = [
  { id: "security", name: "Security Intelligence", focus: "Threats to life, sovereignty, critical infrastructure, and public safety." },
  { id: "political", name: "Political & Governance", focus: "Institutional stability, legitimacy, leadership dynamics, and policy trajectories." },
  { id: "economic", name: "Economic Intelligence", focus: "Fiscal health, markets, supply chains, trade, and financial dependencies." },
  { id: "health", name: "Public-Health Intelligence", focus: "Disease surveillance, health system capacity, and population vulnerability." },
  { id: "social", name: "Social & Behavioural", focus: "Public trust, social cohesion, sentiment shifts, and collective action." },
  { id: "technology", name: "Technology & Cyber", focus: "Digital dependencies, cyber risk, data integrity, and emerging tech." },
  { id: "environmental", name: "Environmental & Resource", focus: "Climate hazards, water/food security, land use, and energy stability." },
  { id: "organisational", name: "Organisational Intelligence", focus: "Internal capability, institutional culture, implementation bottlenecks, and blind spots." }
];

export const PRODUCT_FAMILY = [
  { type: "Immediate Alert", urgency: "Immediate", horizon: "0–24 hours", purpose: "Urgent high-consequence event notification." },
  { type: "Warning Notice", urgency: "High", horizon: "1–7 days", purpose: "Emerging threat pathway requiring preventive intervention." },
  { type: "Daily / Weekly Brief", urgency: "Routine", horizon: "7–30 days", purpose: "Material changes and key trend implications." },
  { type: "Intelligence Assessment", urgency: "Standard", horizon: "1–6 months", purpose: "In-depth explanatory analysis of a specific problem." },
  { type: "Strategic Estimate", urgency: "Strategic", horizon: "6–36 months", purpose: "Long-term trajectory and capability estimation." },
  { type: "Systems Assessment", urgency: "Structural", horizon: "1–5 years", purpose: "HUMANS framework analysis of systemic feedback loops." },
  { type: "Horizon Scan", urgency: "Exploratory", horizon: "1–10 years", purpose: "Weak signal detection and plausible discontinuity analysis." },
  { type: "Red-Team Memorandum", urgency: "High-Rigor", horizon: "Ad-hoc", purpose: "Structured challenge to prevailing institutional assumptions." },
  { type: "Decision-Support Note", urgency: "Direct", horizon: "Decision-locked", purpose: "Direct mapping of intelligence to decision options & risks." },
  { type: "Post-Event Review", urgency: "Audit", horizon: "Post-action", purpose: "Forecast register audit & institutional lessons learned." }
];

export const OPERATIONAL_GOVERNANCE_TRACKS = [
  { track: "Collection & Analysis", nature: "Passive / Informative", objective: "All-source synthesis to inform decisions without modifying external conditions.", authorization: "PIR mandate & statutory collection authority", oversight: "Independent tradecraft audit & routine compliance" },
  { track: "Clandestine Operations", nature: "Concealed Activity", objective: "Passive surveillance or intercept collection where target remains unaware.", authorization: "Targeted warrant & necessity verification", oversight: "Judicial commissioner audit & statutory review" },
  { track: "Covert Action", nature: "Active / Deniable Influence", objective: "Active operational measures to influence external conditions with unacknowledged sponsorship.", authorization: "Executive Head-of-State Finding / Statutory Ministerial Authorization", oversight: "Legislative committee notification, strict necessity & proportionality test, zero domestic influence prohibition" }
];

export const ICD_203_STANDARDS = [
  { id: 1, title: "Source Quality & Credibility", requirement: "Explicitly describe the reliability, limitations, and methodology of all sources and datasets." },
  { id: 2, title: "Uncertainty Expression", requirement: "Express confidence levels (High, Moderate, Low) and state likelihood probability bands explicitly." },
  { id: 3, title: "Fact vs. Assumption Separation", requirement: "Clearly distinguish established empirical facts from analytical assumptions and extrapolations." },
  { id: 4, title: "Analysis of Competing Hypotheses (ACH)", requirement: "Test evidence against multiple plausible alternative explanations to defeat confirmation bias." },
  { id: 5, title: "Customer Relevance", requirement: "Address executive decision implications directly, delivering timely and actionable insights." },
  { id: 6, title: "Logical Argumentation", requirement: "Ensure clear, consistent, and logically valid chains of inference from premise to conclusion." },
  { id: 7, title: "Consistency & Change Tracking", requirement: "Explain any changes from—or consistency with—previously published intelligence estimates." },
  { id: 8, title: "Accuracy & Verification", requirement: "Continuously audit judgments against ground-truth outcomes and empirical validation benchmarks." },
  { id: 9, title: "Visual Information Integration", requirement: "Incorporate effective visual representations (maps, charts, trees) to illuminate complex findings." }
];

export const COMMAND_DOCTRINE_RULES = [
  "01. Begin with the decision requirement, not available data.",
  "02. Collect only for a lawful, necessary, and defined purpose.",
  "03. Employ the least intrusive sufficient collection means.",
  "04. Fuse multi-source evidence; never rely on single-source prestige.",
  "05. Strictly separate empirical fact from assumption and judgement.",
  "06. Describe source credibility, access, and limitations honestly.",
  "07. State probability and confidence separately for every estimate.",
  "08. Expose major assumptions to structured alternative challenge (ACH).",
  "09. Issue decision-relevant warnings before certainty is reached.",
  "10. Evaluate actors inside broader systems, feedback loops, and incentives.",
  "11. Maintain absolute independence from policy advocacy or preference.",
  "12. Use AI & advanced analytics to augment accountable human judgements.",
  "13. Disseminate in time to influence decisions while protecting sources.",
  "14. Respect civil liberties, privacy, and statutory oversight limits.",
  "15. Maintain a forecast register, record outcomes, acknowledge errors, and adapt."
];

export function evaluateTradecraftCompliance(assessment = {}) {
  const checks = ICD_203_STANDARDS.map((std) => ({
    id: std.id,
    title: std.title,
    passed: Boolean(assessment[`std_${std.id}`] ?? true)
  }));
  const score = Math.round((checks.filter((c) => c.passed).length / checks.length) * 100);
  return { score, compliant: score >= 80, checks };
}
