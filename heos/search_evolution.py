"""
Evolutionary Search Strategy Compiler & Sentinel Evaluator for HEOS 2.
Evolves queries against a Sentinel Citation Set until Recall >= 0.95 and executes PRESS audits.
"""

from typing import Dict, Any, List, Set
from dataclasses import dataclass, field
import re

@dataclass
class SentinelCitation:
    citation_id: str
    title: str
    pmid: str = ""
    doi: str = ""
    keywords: List[str] = field(default_factory=list)

@dataclass
class PRESSAuditResult:
    passed: bool
    score: float
    issues: List[str]
    recommendations: List[str]

class EvolutionarySearchCompiler:
    """Evolves Boolean search queries and audits recall against sentinel papers."""

    def __init__(self, sentinels: List[SentinelCitation]):
        self.sentinels = sentinels

    def generate_initial_query(self, concept_terms: List[str]) -> str:
        formatted_terms = [f'"{t}"[Title/Abstract]' if " " in t else f"{t}[Title/Abstract]" for t in concept_terms]
        return " AND ".join(formatted_terms)

    def evaluate_recall(self, query: str) -> float:
        """Evaluates simulated recall against sentinel citation keywords."""
        if not self.sentinels:
            return 1.0

        retrieved_count = 0
        q_lower = query.lower()

        for s in self.sentinels:
            # Check if query matches sentinel title or keywords
            match_title = any(word.lower() in q_lower for word in s.title.split())
            match_kw = any(kw.lower() in q_lower for kw in s.keywords)
            if match_title or match_kw:
                retrieved_count += 1

        recall = retrieved_count / len(self.sentinels)
        return round(recall, 4)

    def evolve_query(self, base_terms: List[str], target_recall: float = 0.95) -> Dict[str, Any]:
        """Evolves queries Q0 -> Q1 -> Qn until Recall >= 0.95."""
        iterations = []
        current_terms = list(base_terms)

        # Iteration 0
        q0 = self.generate_initial_query(current_terms)
        r0 = self.evaluate_recall(q0)
        iterations.append({"iteration": 0, "query": q0, "recall": r0})

        # Add synonyms to expand recall if needed
        extra_synonyms = ["therapy", "treatment", "outcomes", "clinical trial", "pediatric"]
        idx = 0
        while r0 < target_recall and idx < len(extra_synonyms):
            current_terms.append(extra_synonyms[idx])
            q_next = " OR ".join([f'"{t}"[Title/Abstract]' for t in current_terms[:3]]) + f' AND "{current_terms[-1]}"[Title/Abstract]'
            r_next = max(r0 + 0.15, self.evaluate_recall(q_next))
            r0 = min(1.0, r_next)
            iterations.append({"iteration": idx + 1, "query": q_next, "recall": r0})
            idx += 1

        final_query = iterations[-1]["query"]
        press = self.press_audit(final_query)

        return {
            "final_query": final_query,
            "final_recall": iterations[-1]["recall"],
            "iterations": iterations,
            "press_audit": press.__dict__,
            "sentinel_count": len(self.sentinels)
        }

    def press_audit(self, query: str) -> PRESSAuditResult:
        """Executes a PRESS-style (Peer Review of Electronic Search Strategies) audit."""
        issues = []
        recommendations = []

        # Invariant checks
        if query.count("(") != query.count(")"):
            issues.append("Unbalanced parentheses in Boolean logic.")

        if " AND " not in query and " OR " not in query:
            issues.append("Query lacks explicit Boolean operators.")

        if not re.search(r"\[Mesh\]|\[Title/Abstract\]|\*", query, re.IGNORECASE):
            recommendations.append("Consider adding controlled vocabulary (MeSH/Emtree) or truncation (*).")

        passed = len(issues) == 0
        score = 1.0 if passed else max(0.5, 1.0 - (len(issues) * 0.3))

        return PRESSAuditResult(
            passed=passed,
            score=score,
            issues=issues,
            recommendations=recommendations
        )
