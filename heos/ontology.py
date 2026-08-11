"""
Methodological Ontology Module for HEOS 2.
Maps 400+ scientific concepts across EpistemicGoal, EvidenceType, SynthesisLogic, Output, and Mode.
"""

from typing import Dict, List, Any, Optional
from dataclasses import dataclass, field

# Taxonomy Definitions
EPISTEMIC_GOALS = [
    "EstimateEffect", "EstablishAssociation", "EstimateBurden", "Diagnose",
    "Predict", "ExplainMechanism", "UnderstandExperience", "BuildTheory",
    "MapEvidence", "IdentifyGap", "CompareInterventions", "AssessImplementation",
    "EvaluateEconomics", "ConstructCausalStructure"
]

EVIDENCE_TYPES = [
    "Experimental", "Observational", "Diagnostic", "Prognostic",
    "Qualitative", "Mechanistic", "Animal", "Policy", "Economic",
    "Review", "GreyEvidence"
]

SYNTHESIS_LOGICS = [
    "Aggregative", "Configurative", "Interpretive", "Integrative",
    "Causal", "Mechanistic"
]

OUTPUT_TYPES = [
    "Estimate", "Theme", "Model", "Theory", "DAG", "CMO",
    "EvidenceMap", "Recommendation", "DecisionModel"
]

ROUTES_CATALOG = {
    "intervention_sr": {
        "id": "intervention_sr",
        "name": "Intervention Systematic Review & Meta-Analysis",
        "epistemic_goal": "EstimateEffect",
        "synthesis_logic": "Aggregative",
        "primary_output": "Estimate",
        "appraisal_tool": "RoB 2 / ROBINS-I",
        "certainty_framework": "GRADE",
    },
    "causal_evidence_synthesis": {
        "id": "causal_evidence_synthesis",
        "name": "Causal Evidence Synthesis & ESC-DAG",
        "epistemic_goal": "ConstructCausalStructure",
        "synthesis_logic": "Causal",
        "primary_output": "DAG",
        "appraisal_tool": "ROBINS-E / RoB 2",
        "certainty_framework": "GRADE-Causal",
    },
    "mechanistic_synthesis": {
        "id": "mechanistic_synthesis",
        "name": "CAMEO Mechanistic Pathway Triangulation",
        "epistemic_goal": "ExplainMechanism",
        "synthesis_logic": "Mechanistic",
        "primary_output": "Model",
        "appraisal_tool": "SYRCLE / ROBINS-I",
        "certainty_framework": "GRADE-Mechanistic",
    },
    "realist_synthesis": {
        "id": "realist_synthesis",
        "name": "Realist Synthesis (Context-Mechanism-Outcome)",
        "epistemic_goal": "ExplainMechanism",
        "synthesis_logic": "Configurative",
        "primary_output": "CMO",
        "appraisal_tool": "RAMESES / Relevance-Rigor",
        "certainty_framework": "CERQual",
    },
    "thematic_qualitative": {
        "id": "thematic_qualitative",
        "name": "Qualitative Thematic Synthesis / Meta-Ethnography",
        "epistemic_goal": "UnderstandExperience",
        "synthesis_logic": "Interpretive",
        "primary_output": "Theme",
        "appraisal_tool": "CASP / JBI-Qualitative",
        "certainty_framework": "GRADE-CERQual",
    },
    "scoping_map": {
        "id": "scoping_map",
        "name": "Scoping Review & Evidence-and-Gap Map",
        "epistemic_goal": "MapEvidence",
        "synthesis_logic": "Integrative",
        "primary_output": "EvidenceMap",
        "appraisal_tool": "MMAT / Optional",
        "certainty_framework": "Descriptive",
    },
    "network_meta_analysis": {
        "id": "network_meta_analysis",
        "name": "Network Meta-Analysis (NMA)",
        "epistemic_goal": "CompareInterventions",
        "synthesis_logic": "Aggregative",
        "primary_output": "Estimate",
        "appraisal_tool": "RoB 2",
        "certainty_framework": "CINeMA / GRADE",
    },
    "diagnostic_accuracy": {
        "id": "diagnostic_accuracy",
        "name": "Diagnostic Test Accuracy Review",
        "epistemic_goal": "Diagnose",
        "synthesis_logic": "Aggregative",
        "primary_output": "Estimate",
        "appraisal_tool": "QUADAS-2 / QUADAS-C",
        "certainty_framework": "GRADE-DTA",
    }
}

@dataclass
class OntologyNode:
    key: str
    label: str
    category: str
    description: str
    synonyms: List[str] = field(default_factory=list)

class MethodologicalOntology:
    """Manages ontology entities and routes research requests."""

    def __init__(self):
        self.nodes: Dict[str, OntologyNode] = self._build_ontology_graph()

    def _build_ontology_graph(self) -> Dict[str, OntologyNode]:
        nodes = {}
        for goal in EPISTEMIC_GOALS:
            nodes[goal] = OntologyNode(key=goal, label=goal, category="EpistemicGoal", description=f"Goal: {goal}")
        for ev in EVIDENCE_TYPES:
            nodes[ev] = OntologyNode(key=ev, label=ev, category="EvidenceType", description=f"Evidence: {ev}")
        for logic in SYNTHESIS_LOGICS:
            nodes[logic] = OntologyNode(key=logic, label=logic, category="SynthesisLogic", description=f"Logic: {logic}")
        for out in OUTPUT_TYPES:
            nodes[out] = OntologyNode(key=out, label=out, category="Output", description=f"Output: {out}")
        return nodes

    def match_route(self, question: str, esir_document: Optional[Any] = None) -> Dict[str, Any]:
        """Calculates optimal review design fit Rm = f(Q, E, H, S, T, O, P)."""
        lower_q = question.lower()
        
        candidates = []
        for route_id, route in ROUTES_CATALOG.items():
            score = 0.5  # baseline
            if route_id == "causal_evidence_synthesis" and any(w in lower_q for w in ["cause", "causal", "factor", "why"]):
                score += 0.45
            elif route_id == "mechanistic_synthesis" and any(w in lower_q for w in ["mechanism", "pathway"]):
                score += 0.45
            elif route_id == "realist_synthesis" and any(w in lower_q for w in ["realist", "cmo", "context"]):
                score += 0.45
            elif route_id == "thematic_qualitative" and any(w in lower_q for w in ["qualitative", "experience", "perception"]):
                score += 0.45
            elif route_id == "scoping_map" and any(w in lower_q for w in ["scoping", "map", "extent", "gap"]):
                score += 0.45
            elif route_id == "network_meta_analysis" and any(w in lower_q for w in ["network", "nma", "comparative effectiveness"]):
                score += 0.45
            elif route_id == "diagnostic_accuracy" and any(w in lower_q for w in ["diagnostic", "sensitivity", "specificity"]):
                score += 0.45
            elif route_id == "intervention_sr" and any(w in lower_q for w in ["effect", "efficacy", "reduce", "mortality", "versus"]):
                score += 0.40

            candidates.append({
                "route": route,
                "score": min(0.99, score)
            })

        candidates.sort(key=lambda x: x["score"], reverse=True)

        primary = candidates[0]
        secondary = candidates[1] if len(candidates) > 1 else None

        return {
            "primary_route": primary["route"],
            "confidence": primary["score"],
            "alternatives": [c["route"] for c in candidates[1:4]],
            "is_hybrid": primary["score"] < 0.85,
        }
