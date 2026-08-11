"""
Design-Specific Appraisal & Counterfactual Reversal Testing for HEOS 2.
Routes study designs to official RoB domains and tests counterfactual reversal conditions.
"""

from typing import Dict, Any, List, Optional
from dataclasses import dataclass

@dataclass
class RiskOfBiasDomain:
    domain_name: str
    judgment: str  # Low, Moderate, Serious, Critical, High
    rationale: str
    evidence_locator: str

@dataclass
class CounterfactualReversalCondition:
    current_judgment: str
    reversal_condition: str
    target_evidence_to_search: str

class AppraisalEngine:
    """Manages risk-of-bias evaluation and counterfactual appraisal attacks."""

    @staticmethod
    def get_tool_for_design(design: str) -> str:
        d = design.lower()
        if "rct" in d or "randomized" in d:
            return "RoB 2"
        elif "non-randomized" in d or "cohort" in d:
            return "ROBINS-I"
        elif "exposure" in d or "observational" in d:
            return "ROBINS-E"
        elif "diagnostic" in d:
            return "QUADAS-2"
        elif "prediction" in d or "prognosis" in d:
            return "PROBAST / QUIPS"
        elif "qualitative" in d:
            return "CASP / JBI"
        elif "animal" in d:
            return "SYRCLE"
        else:
            return "MMAT"

    def evaluate_rct_rob2(self, report_id: str, randomization: str, deviations: str, missing_data: str, outcome_measurement: str, selective_reporting: str) -> Dict[str, Any]:
        domains = [
            RiskOfBiasDomain("D1: Randomisation process", "Low" if "concealed" in randomization.lower() else "Some concerns", randomization, "Methods p. 3"),
            RiskOfBiasDomain("D2: Deviations from intended interventions", "Low" if "blinded" in deviations.lower() else "Some concerns", deviations, "Methods p. 4"),
            RiskOfBiasDomain("D3: Missing outcome data", "Low" if "complete" in missing_data.lower() or "<5%" in missing_data else "High", missing_data, "Results p. 6"),
            RiskOfBiasDomain("D4: Measurement of the outcome", "Low" if "objective" in outcome_measurement.lower() else "Some concerns", outcome_measurement, "Methods p. 5"),
            RiskOfBiasDomain("D5: Selection of the reported result", "Low" if "prespecified" in selective_reporting.lower() else "Some concerns", selective_reporting, "Protocol matching"),
        ]

        # Overall judgment
        judgments = [d.judgment for d in domains]
        if "High" in judgments or "Serious" in judgments:
            overall = "High"
        elif "Some concerns" in judgments:
            overall = "Some concerns"
        else:
            overall = "Low"

        # Counterfactual Reversal Attack
        reversal = CounterfactualReversalCondition(
            current_judgment=overall,
            reversal_condition="If supplementary files contain prespecified statistical analysis plan detailing outcome reporting, D5 drops to Low.",
            target_evidence_to_search="Supplement_SAP.pdf"
        )

        return {
            "report_id": report_id,
            "tool": "RoB 2",
            "overall_judgment": overall,
            "domains": [d.__dict__ for d in domains],
            "counterfactual_reversal": reversal.__dict__
        }
