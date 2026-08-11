// Automated PRESS preflight for electronic search strategies.
// This catches structural/syntax problems before execution. It deliberately does
// not impersonate the independent information specialist required for formal
// PRESS peer review; that sign-off remains an explicit, auditable checklist item.

export const PRESS_CITATION = {
  title: "PRESS 2015 Evidence-Based Checklist",
  publisher: "CADTH",
  url: "https://www.cadth.ca/sites/default/files/PRESS_Peer_Review_Electronic_Search_Strate/Table_9-PRESS.pdf",
};

export const PRESS_ITEMS = [
  { id: "question", domain: "Question translation", label: "Concept structure matches the review question and eligibility framework." },
  { id: "operators", domain: "Boolean and proximity operators", label: "Boolean, adjacency, nesting, and concept joins are logically valid." },
  { id: "headings", domain: "Subject headings", label: "Database-native controlled vocabulary is used and exploded where appropriate." },
  { id: "textwords", domain: "Text words", label: "Synonyms, variants, abbreviations, phrases, and relevant free-text fields are represented." },
  { id: "syntax", domain: "Spelling, syntax, and line structure", label: "Field tags, quotes, parentheses, truncation, spelling, and line references are internally consistent." },
  { id: "limits", domain: "Limits and filters", label: "Limits and filters are justified, reproducible, and not silently embedded." },
  { id: "sentinels", domain: "Known-item validation", label: "Sentinel studies have been tested and retrieved by the primary strategy." },
  { id: "peer", domain: "Independent peer review", label: "A qualified search specialist has independently reviewed the primary strategy." },
];

const balanced = (value, open, close) => {
  let depth = 0;
  for (const char of String(value || "")) {
    if (char === open) depth += 1;
    if (char === close) depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
};

export function assessPress({ question = "", concepts = [], strategies = [], limits = [], sentinelEvidence = [], peerReview = null } = {}) {
  const populated = concepts.filter((concept) => (concept.terms || []).length || Object.values(concept.vocab || {}).some((values) => values?.length));
  const nativeCoverage = strategies.filter((strategy) => strategy.headingStatus === "complete").length;
  const syntaxProblems = strategies.flatMap((strategy) => {
    const issues = [];
    if (!strategy.combined?.trim()) issues.push(`${strategy.name}: empty strategy`);
    if (!balanced(strategy.combined, "(", ")")) issues.push(`${strategy.name}: unbalanced parentheses`);
    if (/\b(AND|OR|NOT)\s*(?:\)|$)/i.test(strategy.combined || "")) issues.push(`${strategy.name}: dangling Boolean operator`);
    return issues;
  });
  const rows = PRESS_ITEMS.map((item) => {
    if (item.id === "question") return { ...item, status: question.trim() && populated.length >= 2 ? "pass" : "fail", evidence: question.trim() ? `${populated.length} populated concept block(s)` : "Review question is missing" };
    if (item.id === "operators") return { ...item, status: syntaxProblems.length ? "fail" : populated.length >= 2 ? "pass" : "warn", evidence: syntaxProblems.join("; ") || `${populated.length} concept block(s); explicit joins compiled` };
    if (item.id === "headings") return { ...item, status: nativeCoverage === strategies.filter((s) => s.headingStatus !== "not-applicable").length ? "pass" : nativeCoverage ? "warn" : "warn", evidence: `${nativeCoverage}/${strategies.filter((s) => s.headingStatus !== "not-applicable").length} applicable strategies have complete native-heading coverage` };
    if (item.id === "textwords") return { ...item, status: populated.every((c) => (c.terms || []).length) ? "pass" : "warn", evidence: `${populated.filter((c) => (c.terms || []).length).length}/${populated.length} populated blocks contain free-text terms` };
    if (item.id === "syntax") return { ...item, status: syntaxProblems.length ? "fail" : strategies.length ? "pass" : "fail", evidence: syntaxProblems.join("; ") || `${strategies.length} database-native strategies passed structural checks` };
    if (item.id === "limits") return { ...item, status: limits.length ? "warn" : "pass", evidence: limits.length ? `Review justification for: ${limits.join(", ")}` : "No implicit limits supplied" };
    if (item.id === "sentinels") return { ...item, status: sentinelEvidence.length ? "pass" : "pending", evidence: sentinelEvidence.length ? `${sentinelEvidence.length} sentinel record(s) documented` : "No sentinel validation evidence recorded" };
    return { ...item, status: peerReview?.reviewer ? "pass" : "pending", evidence: peerReview?.reviewer ? `Reviewed by ${peerReview.reviewer}${peerReview.date ? ` on ${peerReview.date}` : ""}` : "Independent PRESS reviewer sign-off not yet recorded" };
  });
  const blockers = rows.filter((row) => row.status === "fail");
  return {
    standard: "PRESS 2015",
    assessedAt: new Date().toISOString(),
    readyForExecution: blockers.length === 0 && strategies.length > 0,
    automatedPreflight: true,
    independentPeerReviewComplete: rows.find((row) => row.id === "peer")?.status === "pass",
    sentinelValidationComplete: rows.find((row) => row.id === "sentinels")?.status === "pass",
    rows,
    blockers: blockers.map((row) => row.evidence),
    citation: PRESS_CITATION,
  };
}

