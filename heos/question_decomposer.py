"""
Multi-Agent Question Decomposition & Ambiguity Engine for HEOS 2.
Decomposes questions using four independent sub-agents and calculates Ambiguity Index AQ.
"""

from typing import Dict, Any, List
from dataclasses import dataclass, field
import json

@dataclass
class AgentInterpretation:
    agent_name: str
    concepts: Dict[str, Any]
    confidence: float
    notes: List[str] = field(default_factory=list)

@dataclass
class AmbiguityScore:
    ambiguity_index: float
    component_ambiguities: Dict[str, float]
    recommendation: str  # autonomous, proceed_and_flag, agent_debate, human_clarification
    clarification_questions: List[str] = field(default_factory=list)

class QuestionDecomposer:
    """Decomposes research questions via simulated multi-agent society and computes AQ."""

    def __init__(self, weights: Dict[str, float] = None):
        self.weights = weights or {
            "population": 0.25,
            "exposure": 0.25,
            "comparator": 0.15,
            "outcome": 0.20,
            "time": 0.08,
            "setting": 0.07,
        }

    def decompose(self, question: str) -> Dict[str, Any]:
        """Runs multi-agent decomposition."""
        lower_q = question.lower()

        # 1. Epidemiologist Agent
        epi_agent = AgentInterpretation(
            agent_name="Epidemiologist",
            concepts={
                "population": "Target Population" if len(question) > 10 else None,
                "exposure": "Index Exposure" if "versus" in lower_q or "effect" in lower_q else None,
                "comparator": "Standard Care" if "versus" in lower_q else None,
                "outcome": "Primary Outcome" if any(o in lower_q for o in ["mortality", "death", "outcome", "effect"]) else None,
            },
            confidence=0.92 if len(question) > 20 else 0.60
        )

        # 2. Informatician Agent
        info_agent = AgentInterpretation(
            agent_name="Informatician",
            concepts={
                "search_keywords": question.replace("?", "").split(),
                "boolean_structure": "AND/OR Lattice Required",
            },
            confidence=0.95
        )

        # 3. Methodologist Agent
        method_agent = AgentInterpretation(
            agent_name="Methodologist",
            concepts={
                "design": "Intervention RCT / Cohort" if "effect" in lower_q else "Observational / Mechanistic",
                "appraisal": "RoB 2 / ROBINS-I",
            },
            confidence=0.88
        )

        # 4. Ontology Agent
        ont_agent = AgentInterpretation(
            agent_name="Ontology",
            concepts={
                "mesh_terms": ["Child", "Malnutrition", "Mortality"] if "malnutrition" in lower_q else ["Humans", "Treatment Outcome"],
                "snomed_codes": ["22943007", "410605003"],
            },
            confidence=0.90
        )

        # Calculate Ambiguity Index
        ambiguity = self.calculate_ambiguity(question, epi_agent)

        return {
            "question": question,
            "agents": {
                "epidemiologist": epi_agent.__dict__,
                "informatician": info_agent.__dict__,
                "methodologist": method_agent.__dict__,
                "ontology": ont_agent.__dict__,
            },
            "ambiguity": ambiguity.__dict__
        }

    def calculate_ambiguity(self, question: str, epi_interpretation: AgentInterpretation) -> AmbiguityScore:
        """Calculates AQ = w1 AP + w2 AE + w3 AC + w4 AO + w5 AT + w6 AS."""
        c = epi_interpretation.concepts
        
        ap = 0.05 if c.get("population") else 0.40
        ae = 0.05 if c.get("exposure") else 0.35
        ac = 0.05 if c.get("comparator") else 0.30
        ao = 0.05 if c.get("outcome") else 0.35
        at = 0.15  # default baseline timeframe uncertainty
        as_ = 0.10 # default baseline setting uncertainty

        aq = (
            self.weights["population"] * ap +
            self.weights["exposure"] * ae +
            self.weights["comparator"] * ac +
            self.weights["outcome"] * ao +
            self.weights["time"] * at +
            self.weights["setting"] * as_
        )

        # Determine decision boundary
        if aq < 0.10:
            rec = "autonomous"
            qs = []
        elif aq < 0.25:
            rec = "proceed_and_flag"
            qs = ["Population and outcome scope specified; proceed with default setting parameters."]
        elif aq < 0.50:
            rec = "agent_debate"
            qs = ["Sub-agents debate comparator eligibility criteria."]
        else:
            rec = "human_clarification"
            qs = ["Please clarify target population age bounds and specific outcome timepoints."]

        return AmbiguityScore(
            ambiguity_index=round(aq, 4),
            component_ambiguities={
                "population": ap, "exposure": ae, "comparator": ac,
                "outcome": ao, "time": at, "setting": as_
            },
            recommendation=rec,
            clarification_questions=qs
        )
