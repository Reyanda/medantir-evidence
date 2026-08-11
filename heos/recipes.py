"""
Compositional Review Recipe Engine for HEOS 2.
Encapsulates review methodologies as composable primitive specifications.
"""

from typing import Dict, Any, List
from dataclasses import dataclass, field

@dataclass
class SearchConfig:
    exhaustive: bool = True
    iterative: bool = False
    theoretical_sampling: bool = False
    min_databases: int = 3

@dataclass
class AppraisalConfig:
    design_specific_rob: bool = True
    relevance_and_rigor: bool = False
    tool_list: List[str] = field(default_factory=lambda: ["RoB 2", "ROBINS-I"])

@dataclass
class SynthesisConfig:
    orientation: str = "aggregative"  # aggregative, configurative, interpretive, causal, mechanistic
    structure: str = "meta_analysis"  # meta_analysis, CMO, DAG, thematic_matrix, evidence_map
    model_competition: bool = True

@dataclass
class CompositionalRecipe:
    name: str
    search: SearchConfig
    unit_of_analysis: List[str]
    appraisal: AppraisalConfig
    synthesis: SynthesisConfig
    certainty_framework: str
    stop_rule: str

BUILTIN_RECIPES = {
    "systematic_effectiveness": CompositionalRecipe(
        name="Systematic Effectiveness Review",
        search=SearchConfig(exhaustive=True, min_databases=4),
        unit_of_analysis=["study_family", "report"],
        appraisal=AppraisalConfig(design_specific_rob=True, tool_list=["RoB 2", "ROBINS-I"]),
        synthesis=SynthesisConfig(orientation="aggregative", structure="meta_analysis", model_competition=True),
        certainty_framework="GRADE",
        stop_rule="exhaustive_search_complete"
    ),
    "realist_review": CompositionalRecipe(
        name="Realist Synthesis",
        search=SearchConfig(exhaustive=False, iterative=True, theoretical_sampling=True, min_databases=2),
        unit_of_analysis=["context", "mechanism", "outcome"],
        appraisal=AppraisalConfig(design_specific_rob=False, relevance_and_rigor=True, tool_list=["RAMESES"]),
        synthesis=SynthesisConfig(orientation="configurative", structure="CMO", model_competition=False),
        certainty_framework="CERQual",
        stop_rule="theoretical_saturation"
    ),
    "causal_esc_dag": CompositionalRecipe(
        name="Causal ESC-DAG & Triangulation",
        search=SearchConfig(exhaustive=True, min_databases=3),
        unit_of_analysis=["causal_edge", "mediator", "confounder"],
        appraisal=AppraisalConfig(design_specific_rob=True, tool_list=["ROBINS-E", "RoB 2"]),
        synthesis=SynthesisConfig(orientation="causal", structure="DAG", model_competition=True),
        certainty_framework="GRADE-Causal",
        stop_rule="causal_pathway_identified"
    )
}

class RecipeEngine:
    """Manages and composes review recipes."""

    @staticmethod
    def get_recipe(recipe_name: str) -> CompositionalRecipe:
        return BUILTIN_RECIPES.get(recipe_name, BUILTIN_RECIPES["systematic_effectiveness"])
