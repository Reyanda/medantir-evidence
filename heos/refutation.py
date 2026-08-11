"""
Refutation Agent Module for HEOS 2.
Actively seeks disconfirming evidence and challenges emerging scientific conclusions.
"""

from typing import Dict, Any, List
from dataclasses import dataclass, field

@dataclass
class DisconfirmingCase:
    study_id: str
    case_type: str  # opposite_effect, subgroup_reversal, null_high_quality, failed_knockout
    description: str
    impact_level: str  # critical, major, minor

class RefutationAgent:
    """Dedicated agent that attempts to disprove emerging synthesis conclusions."""

    def attack_conclusion(self, claim_text: str, structured_evidence: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Attacks a synthesis claim by finding disconfirming cases."""
        disconfirming_cases = []

        for item in structured_evidence:
            effect = item.get("effect_size") or item.get("rr") or 1.0
            rob = item.get("rob", "Low")
            
            # Check opposite effect
            if effect > 1.0 and "reduces" in claim_text.lower():
                disconfirming_cases.append(DisconfirmingCase(
                    study_id=item.get("study_id", "STUDY-UNKNOWN"),
                    case_type="opposite_effect",
                    description=f"Study reports increased risk (RR={effect}) contradicting claim of risk reduction.",
                    impact_level="critical" if rob == "Low" else "major"
                ))
            elif effect == 1.0 or (0.95 <= effect <= 1.05):
                disconfirming_cases.append(DisconfirmingCase(
                    study_id=item.get("study_id", "STUDY-UNKNOWN"),
                    case_type="null_high_quality",
                    description=f"Study reports null effect (RR={effect}).",
                    impact_level="major" if rob == "Low" else "minor"
                ))

        survived = len([c for c in disconfirming_cases if c.impact_level == "critical"]) == 0

        return {
            "claim": claim_text,
            "refutation_passed": survived,
            "disconfirming_cases_found": len(disconfirming_cases),
            "cases": [c.__dict__ for c in disconfirming_cases],
            "recommendation": "Claim defensible" if survived else "Revise claim to reflect opposite/null evidence."
        }
