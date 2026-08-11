"""
Provenance Tuples & SHA-256 Cryptographic Ledger for HEOS 2.
Implements D=(v, s, l, a, c, t), numeric invariant enforcement, and adversarial calculations.
"""

from typing import Dict, Any, List, Optional
from dataclasses import dataclass, asdict
import hashlib
import json

@dataclass
class ProvenanceTuple:
    field_name: str
    value: Any
    source_record_id: str
    locator: str  # e.g., "Page 7, Table 2, Row 3"
    agent_id: str
    confidence: float
    transformation: str = "reported"  # reported vs computed_from_events

@dataclass
class LedgerEvent:
    event_id: str
    stage: str
    action: str
    actor: str
    data: Dict[str, Any]
    previous_hash: str
    current_hash: str

class ProvenanceLedger:
    """Append-only cryptographic SHA-256 hash ledger for review decisions."""

    def __init__(self):
        self.events: List[LedgerEvent] = []

    def append_event(self, stage: str, action: str, actor: str, data: Dict[str, Any]) -> LedgerEvent:
        prev_hash = self.events[-1].current_hash if self.events else "0" * 64
        event_id = f"EVT-{len(self.events)+1:05d}"
        
        payload = json.dumps({"id": event_id, "stage": stage, "action": action, "actor": actor, "data": data, "prev": prev_hash}, sort_keys=True)
        curr_hash = hashlib.sha256(payload.encode("utf-8")).hexdigest()

        event = LedgerEvent(
            event_id=event_id,
            stage=stage,
            action=action,
            actor=actor,
            data=data,
            previous_hash=prev_hash,
            current_hash=curr_hash
        )
        self.events.append(event)
        return event

    def verify_ledger_integrity(self) -> bool:
        """Verifies tamper-evidence of the entire hash chain."""
        for i, event in enumerate(self.events):
            prev = self.events[i-1].current_hash if i > 0 else "0" * 64
            if event.previous_hash != prev:
                return False

            payload = json.dumps({"id": event.event_id, "stage": event.stage, "action": event.action, "actor": event.actor, "data": event.data, "prev": event.previous_hash}, sort_keys=True)
            expected_hash = hashlib.sha256(payload.encode("utf-8")).hexdigest()
            if event.current_hash != expected_hash:
                return False

        return True


class AdversarialCalculator:
    """Deterministically verifies LLM extractions against mathematical invariants."""

    @staticmethod
    def verify_2x2_invariants(events_e: int, total_e: int, events_c: int, total_c: int, reported_rr: Optional[float] = None) -> Dict[str, Any]:
        issues = []
        if events_e > total_e:
            issues.append(f"Intervention events ({events_e}) exceed total sample size ({total_e}).")
        if events_c > total_c:
            issues.append(f"Control events ({events_c}) exceed total sample size ({total_c}).")
        if total_e <= 0 or total_c <= 0:
            issues.append("Sample sizes must be strictly positive.")

        computed_rr = None
        if not issues:
            r_e = events_e / total_e
            r_c = events_c / total_c
            computed_rr = round(r_e / r_c, 4) if r_c > 0 else None

            if reported_rr is not None and computed_rr is not None:
                if abs(reported_rr - computed_rr) > 0.05:
                    issues.append(f"Reported RR ({reported_rr}) conflicts with computed RR ({computed_rr}).")

        return {
            "valid": len(issues) == 0,
            "issues": issues,
            "computed_rr": computed_rr
        }
