"""
Evidence Synthesis Intermediate Representation (ESIR) for HEOS 2.
Compiles natural language questions into machine-readable scientific representations.
"""

from dataclasses import dataclass, field, asdict
from typing import List, Dict, Any, Optional
import json

@dataclass
class PopulationSpec:
    concept: str
    min_age_months: Optional[float] = None
    max_age_months: Optional[float] = None
    setting: Optional[str] = None
    inclusion_criteria: List[str] = field(default_factory=list)
    exclusion_criteria: List[str] = field(default_factory=list)

@dataclass
class OutcomeSpec:
    name: str
    time_horizons: List[str] = field(default_factory=list)
    effect_measures: List[str] = field(default_factory=list)
    is_primary: bool = True

@dataclass
class EstimandSpec:
    target_population: str
    treatment: str
    comparator: str
    variable_of_interest: str
    population_level_summary: str  # e.g., "Risk Ratio", "Hazard Ratio", "Mean Difference"
    intercurrent_events_strategy: str = "treatment_policy"  # e.g., treatment_policy, per_protocol, hypothetical

@dataclass
class EpistemicGoalSpec:
    primary: str  # e.g. causal_explanation, effect_estimation, burden_estimation, diagnostic
    secondary: List[str] = field(default_factory=list)

@dataclass
class ESIRDocument:
    raw_question: str
    epistemic_goal: EpistemicGoalSpec
    population: PopulationSpec
    exposures_or_interventions: List[str]
    comparators: List[str]
    outcomes: List[OutcomeSpec]
    estimand: Optional[EstimandSpec] = None
    evidence_classes: List[str] = field(default_factory=lambda: ["randomized", "cohort", "case_control", "qualitative", "mechanistic"])
    synthesis_dimensions: Dict[str, bool] = field(default_factory=lambda: {
        "aggregative": True,
        "configurative": False,
        "causal": True,
        "mechanistic": True,
    })
    modes: Dict[str, bool] = field(default_factory=lambda: {
        "systematic": True,
        "living": False,
        "rapid": False,
        "equity": False,
    })
    products: List[str] = field(default_factory=lambda: [
        "causal_DAG", "meta_analysis", "evidence_map", "GRADE", "manuscript", "supplement"
    ])

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ESIRDocument":
        pop = PopulationSpec(**data["population"])
        goals = EpistemicGoalSpec(**data["epistemic_goal"])
        outcomes = [OutcomeSpec(**o) for o in data["outcomes"]]
        estimand = EstimandSpec(**data["estimand"]) if data.get("estimand") else None
        return cls(
            raw_question=data["raw_question"],
            epistemic_goal=goals,
            population=pop,
            exposures_or_interventions=data.get("exposures_or_interventions", []),
            comparators=data.get("comparators", []),
            outcomes=outcomes,
            estimand=estimand,
            evidence_classes=data.get("evidence_classes", []),
            synthesis_dimensions=data.get("synthesis_dimensions", {}),
            modes=data.get("modes", {}),
            products=data.get("products", []),
        )


class ESIRCompiler:
    """Compiles a natural language research question into an ESIRDocument."""

    @staticmethod
    def compile(question: str, context: Optional[Dict[str, Any]] = None) -> ESIRDocument:
        lower_q = question.lower()
        
        # Primary goal detection
        if any(w in lower_q for w in ["cause", "why", "factor", "risk factor", "mechanism"]):
            primary_goal = "causal_explanation"
            secondary = ["effect_estimation", "heterogeneity", "mechanism_identification"]
        elif any(w in lower_q for w in ["diagnos", "sensitivity", "specificity", "accuracy"]):
            primary_goal = "diagnose"
            secondary = ["burden_estimation", "heterogeneity"]
        elif any(w in lower_q for w in ["prevalence", "incidence", "burden", "how common"]):
            primary_goal = "burden_estimation"
            secondary = ["heterogeneity"]
        elif any(w in lower_q for w in ["experience", "perception", "feeling", "qualitative"]):
            primary_goal = "understand_experience"
            secondary = ["build_theory"]
        else:
            primary_goal = "effect_estimation"
            secondary = ["heterogeneity", "evidence_gap_mapping"]

        # Parse population
        pop_concept = "target_population"
        if "malnutrition" in lower_q or "sam" in lower_q:
            pop_concept = "severe_acute_malnutrition"
        elif "child" in lower_q or "pediatric" in lower_q:
            pop_concept = "pediatric_population"
        elif "adult" in lower_q:
            pop_concept = "adult_population"

        pop = PopulationSpec(
            concept=pop_concept,
            min_age_months=0 if "child" in lower_q or "infant" in lower_q else None,
            max_age_months=59 if "child" in lower_q or "infant" in lower_q else None,
            setting="inpatient_and_outpatient",
        )

        # Parse outcomes
        outcomes = []
        if "mortality" in lower_q or "death" in lower_q or "survival" in lower_q:
            outcomes.append(OutcomeSpec(
                name="mortality",
                time_horizons=["30_days", "90_days", "180_days", "365_days"],
                effect_measures=["risk_ratio", "odds_ratio", "hazard_ratio"],
                is_primary=True,
            ))
        if "readmission" in lower_q or "relapse" in lower_q:
            outcomes.append(OutcomeSpec(
                name="readmission",
                time_horizons=["30_days", "90_days"],
                effect_measures=["risk_ratio", "hazard_ratio"],
                is_primary=False,
            ))
        if not outcomes:
            outcomes.append(OutcomeSpec(
                name="primary_outcome",
                time_horizons=["end_of_followup"],
                effect_measures=["risk_ratio", "mean_difference"],
                is_primary=True,
            ))

        # Build estimand object for causal questions
        estimand = None
        if primary_goal in ["causal_explanation", "effect_estimation"]:
            estimand = EstimandSpec(
                target_population=pop_concept,
                treatment="index_exposure_or_intervention",
                comparator="control_or_standard_care",
                variable_of_interest=outcomes[0].name,
                population_level_summary="Risk Ratio",
                intercurrent_events_strategy="treatment_policy"
            )

        # Determine synthesis dimensions & modes
        is_living = "living" in lower_q
        is_rapid = "rapid" in lower_q
        is_causal = primary_goal == "causal_explanation" or "causal" in lower_q

        return ESIRDocument(
            raw_question=question,
            epistemic_goal=EpistemicGoalSpec(primary=primary_goal, secondary=secondary),
            population=pop,
            exposures_or_interventions=["index_intervention"],
            comparators=["standard_care_or_placebo"],
            outcomes=outcomes,
            estimand=estimand,
            evidence_classes=["randomized", "cohort", "case_control", "mechanistic_human", "qualitative"],
            synthesis_dimensions={
                "aggregative": True,
                "configurative": is_causal or primary_goal == "understand_experience",
                "causal": is_causal,
                "mechanistic": is_causal,
            },
            modes={
                "systematic": True,
                "living": is_living,
                "rapid": is_rapid,
                "equity": "equity" in lower_q or "disparity" in lower_q,
            },
            products=[
                "causal_DAG" if is_causal else "evidence_map",
                "meta_analysis",
                "evidence_map",
                "GRADE",
                "manuscript",
                "supplement"
            ]
        )
