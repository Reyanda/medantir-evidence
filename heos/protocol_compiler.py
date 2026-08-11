"""
Protocol Compiler Engine for HEOS 2.
Compiles ESIR Document + Recipe into immutable protocol structures with explicit rule IDs.
"""

from typing import Dict, Any, List
import json
import os
from .esir import ESIRDocument
from .recipes import CompositionalRecipe

class ProtocolCompiler:
    """Compiles ESIR + Recipe into an immutable protocol directory."""

    @staticmethod
    def compile_protocol(esir: ESIRDocument, recipe: CompositionalRecipe, output_dir: str) -> Dict[str, Any]:
        os.makedirs(output_dir, exist_ok=True)

        # 1. Generate Eligibility Rules with Immutable IDs
        eligibility_rules = [
            {
                "id": "ELIG.POP.001",
                "domain": "population",
                "statement": f"Participants must belong to concept: {esir.population.concept}",
                "mandatory": True
            },
            {
                "id": "ELIG.EXP.002",
                "domain": "exposure",
                "statement": f"Exposures/interventions must cover: {', '.join(esir.exposures_or_interventions)}",
                "mandatory": True
            },
            {
                "id": "ELIG.OUT.003",
                "domain": "outcome",
                "statement": f"Reported outcomes must include at least one primary outcome: {', '.join([o.name for o in esir.outcomes if o.is_primary])}",
                "mandatory": True
            }
        ]

        protocol_data = {
            "protocol_id": "HEOS-PROT-001",
            "question": esir.raw_question,
            "recipe": recipe.name,
            "eligibility_rules": eligibility_rules,
            "search_strategy_plan": {
                "exhaustive": recipe.search.exhaustive,
                "target_databases": ["PubMed", "MEDLINE", "Embase", "Scopus", "CINAHL", "OpenAlex"],
                "press_audit_required": True,
            },
            "synthesis_plan": {
                "orientation": recipe.synthesis.orientation,
                "structure": recipe.synthesis.structure,
                "model_competition": recipe.synthesis.model_competition,
                "certainty_framework": recipe.certainty_framework
            },
            "locked": True,
            "deviations_allowed": False
        }

        # Write files
        with open(os.path.join(output_dir, "protocol.json"), "w") as f:
            json.dump(protocol_data, f, indent=2)

        with open(os.path.join(output_dir, "eligibility.json"), "w") as f:
            json.dump(eligibility_rules, f, indent=2)

        prospero_md = f"""# PROSPERO Protocol Registration

## Title
{esir.raw_question}

## Epistemic Goal
Primary: {esir.epistemic_goal.primary}

## Eligibility Criteria
- **ELIG.POP.001**: {esir.population.concept}
- **ELIG.EXP.002**: {', '.join(esir.exposures_or_interventions)}
- **ELIG.OUT.003**: {', '.join([o.name for o in esir.outcomes])}

## Synthesis Method
{recipe.name} ({recipe.synthesis.orientation} synthesis using {recipe.certainty_framework})
"""
        with open(os.path.join(output_dir, "PROSPERO.md"), "w") as f:
            f.write(prospero_md)

        return protocol_data
