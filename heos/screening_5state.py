"""
5-State Screening Engine & False-Negative Audit for HEOS 2.
Implements 5-state screening plus ABSTAIN, active learning bounds, and exclusion audits.
"""

from typing import Dict, Any, List, Optional
from dataclasses import dataclass, field
import math

SCREENING_STATES = ["INCLUDE", "LIKELY_INCLUDE", "UNCERTAIN", "LIKELY_EXCLUDE", "EXCLUDE", "ABSTAIN"]

@dataclass
class ScreeningDecision:
    record_id: str
    reviewer_id: str
    state: str
    confidence: float
    rationale: str = ""
    exclusion_reason_code: Optional[str] = None

@dataclass
class ScreeningConsensus:
    record_id: str
    consensus_state: str
    consensus_probability: float
    needs_adjudication: bool
    decisions: List[ScreeningDecision]

class FiveStateScreeningEngine:
    """Manages 5-state screening, active learning bounds, and exclusion audits."""

    def reconcile_decisions(self, record_id: str, d1: ScreeningDecision, d2: ScreeningDecision) -> ScreeningConsensus:
        """Reconciles dual independent screening decisions."""
        states_map = {
            "INCLUDE": 1.0,
            "LIKELY_INCLUDE": 0.75,
            "UNCERTAIN": 0.50,
            "LIKELY_EXCLUDE": 0.25,
            "EXCLUDE": 0.0,
            "ABSTAIN": 0.50
        }

        s1_val = states_map.get(d1.state, 0.5)
        s2_val = states_map.get(d2.state, 0.5)
        avg_val = (s1_val + s2_val) / 2.0

        # Hard disagreement check
        needs_adj = (d1.state in ["INCLUDE", "LIKELY_INCLUDE"] and d2.state in ["EXCLUDE", "LIKELY_EXCLUDE"]) or \
                    (d2.state in ["INCLUDE", "LIKELY_INCLUDE"] and d1.state in ["EXCLUDE", "LIKELY_EXCLUDE"])

        if needs_adj or d1.state == "UNCERTAIN" or d2.state == "UNCERTAIN":
            consensus = "UNCERTAIN"
        elif avg_val >= 0.8:
            consensus = "INCLUDE"
        elif avg_val >= 0.6:
            consensus = "LIKELY_INCLUDE"
        elif avg_val <= 0.2:
            consensus = "EXCLUDE"
        else:
            consensus = "LIKELY_EXCLUDE"

        return ScreeningConsensus(
            record_id=record_id,
            consensus_state=consensus,
            consensus_probability=round(avg_val, 4),
            needs_adjudication=needs_adj,
            decisions=[d1, d2]
        )

    def calculate_exclusion_audit_sample_size(self, total_excluded: int, confidence_level: float = 0.95, margin_error: float = 0.03) -> int:
        """Calculates sample size for false-negative audit of excluded records."""
        if total_excluded <= 0:
            return 0

        z = 1.96 if confidence_level == 0.95 else 2.576
        p = 0.05  # Expected low false-negative rate
        n0 = (z**2 * p * (1 - p)) / (margin_error**2)
        n_adj = n0 / (1 + (n0 - 1) / total_excluded)
        return min(total_excluded, max(10, math.ceil(n_adj)))

    def evaluate_active_learning_stop_bound(self, consecutive_excluded: int, target_bound: int = 50) -> Dict[str, Any]:
        """Evaluates whether screening can safely stop based on statistical bounds."""
        can_stop = consecutive_excluded >= target_bound
        est_remaining_relevant = max(0.0, (1.0 - (consecutive_excluded / target_bound)) * 0.05)

        return {
            "consecutive_excluded": consecutive_excluded,
            "target_bound": target_bound,
            "can_stop_screening": can_stop,
            "estimated_remaining_relevant_prob": round(est_remaining_relevant, 4)
        }
