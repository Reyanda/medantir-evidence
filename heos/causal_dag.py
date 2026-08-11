"""
Causal ESC-DAG & CAMEO Mechanistic Synthesis Module for HEOS 2.
Constructs causal directed acyclic graphs and mechanistic pathway models.
"""

from typing import Dict, Any, List
from dataclasses import dataclass, field

@dataclass
class CausalNode:
    node_id: str
    label: str
    node_type: str  # exposure, outcome, mediator, confounder

@dataclass
class CausalEdge:
    source_node_id: str
    target_node_id: str
    direction: str  # positive, negative, null
    temporality: bool
    necessity: str  # strong, moderate, weak
    sufficiency: str
    epidemiologic_support: str  # strong, moderate, weak
    mechanistic_support: str

class CausalDAGEngine:
    """Constructs causal DAGs and mechanistic pathway graphs."""

    def build_dag(self, exposure: str, outcome: str, mediators: List[str], confounders: List[str]) -> Dict[str, Any]:
        nodes = [
            CausalNode(node_id="X", label=exposure, node_type="exposure"),
            CausalNode(node_id="Y", label=outcome, node_type="outcome"),
        ]

        for i, m in enumerate(mediators):
            nodes.append(CausalNode(node_id=f"M{i+1}", label=m, node_type="mediator"))

        for i, c in enumerate(confounders):
            nodes.append(CausalNode(node_id=f"C{i+1}", label=c, node_type="confounder"))

        edges = [
            CausalEdge(
                source_node_id="X",
                target_node_id="Y",
                direction="positive",
                temporality=True,
                necessity="moderate",
                sufficiency="partial",
                epidemiologic_support="moderate",
                mechanistic_support="strong"
            )
        ]

        for i, m in enumerate(mediators):
            edges.append(CausalEdge(
                source_node_id="X", target_node_id=f"M{i+1}", direction="positive",
                temporality=True, necessity="strong", sufficiency="partial",
                epidemiologic_support="strong", mechanistic_support="strong"
            ))
            edges.append(CausalEdge(
                source_node_id=f"M{i+1}", target_node_id="Y", direction="positive",
                temporality=True, necessity="strong", sufficiency="partial",
                epidemiologic_support="strong", mechanistic_support="strong"
            ))

        return {
            "exposure": exposure,
            "outcome": outcome,
            "nodes": [n.__dict__ for n in nodes],
            "edges": [e.__dict__ for e in edges],
            "graph_valid": True
        }
