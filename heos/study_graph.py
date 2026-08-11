"""
Study Family Graph Builder & Entity Resolution Engine for HEOS 2.
Distinguishes reports from studies and links trial families to prevent double counting.
"""

from typing import Dict, Any, List, Optional
from dataclasses import dataclass, field
import difflib

@dataclass
class CitationReport:
    report_id: str
    title: str
    authors: List[str]
    year: int
    doi: str = ""
    pmid: str = ""
    trial_registration: str = ""
    sample_size: Optional[int] = None
    first_author: str = ""

@dataclass
class StudyFamily:
    family_id: str
    canonical_name: str
    primary_report_id: str
    related_report_ids: List[str]
    trial_registrations: List[str]
    total_sample_size: int

class StudyGraphBuilder:
    """Calculates study similarity P(Si = Sj) and constructs a Study Family Graph."""

    def calculate_linkage_probability(self, r1: CitationReport, r2: CitationReport) -> float:
        """Entity resolution score P(Si = Sj)."""
        # Exact trial registration match -> 1.0
        if r1.trial_registration and r2.trial_registration and r1.trial_registration == r2.trial_registration:
            return 1.0

        # Exact DOI match -> 1.0
        if r1.doi and r2.doi and r1.doi.lower() == r2.doi.lower():
            return 1.0

        score = 0.0
        weights_sum = 0.0

        # First author match
        if r1.first_author and r2.first_author:
            author_sim = difflib.SequenceMatcher(None, r1.first_author.lower(), r2.first_author.lower()).ratio()
            score += 0.30 * author_sim
            weights_sum += 0.30

        # Title similarity
        title_sim = difflib.SequenceMatcher(None, r1.title.lower(), r2.title.lower()).ratio()
        score += 0.40 * title_sim
        weights_sum += 0.40

        # Sample size match
        if r1.sample_size and r2.sample_size:
            if r1.sample_size == r2.sample_size:
                score += 0.20
            elif abs(r1.sample_size - r2.sample_size) / max(r1.sample_size, r2.sample_size) < 0.05:
                score += 0.15
            weights_sum += 0.20

        # Year match
        if r1.year and r2.year:
            if abs(r1.year - r2.year) <= 1:
                score += 0.10
            weights_sum += 0.10

        final_score = score / weights_sum if weights_sum > 0 else 0.0
        return round(final_score, 4)

    def build_study_families(self, reports: List[CitationReport]) -> Dict[str, Any]:
        """Groups reports into study families based on linkage probability."""
        families: List[StudyFamily] = []
        assigned_reports = set()

        for i, r1 in enumerate(reports):
            if r1.report_id in assigned_reports:
                continue

            related = []
            for j, r2 in enumerate(reports):
                if i == j or r2.report_id in assigned_reports:
                    continue

                p = self.calculate_linkage_probability(r1, r2)
                if p >= 0.70:
                    related.append((r2, p))

            family_id = f"FAM-{i+1:03d}"
            rel_ids = [r[0].report_id for r in related]
            for r_item in related:
                assigned_reports.add(r_item[0].report_id)

            assigned_reports.add(r1.report_id)

            sample_size = r1.sample_size or 0
            registrations = [r1.trial_registration] if r1.trial_registration else []
            for r_item, p in related:
                if r_item.trial_registration and r_item.trial_registration not in registrations:
                    registrations.append(r_item.trial_registration)

            fam = StudyFamily(
                family_id=family_id,
                canonical_name=f"{r1.first_author or 'Study'} ({r1.year})",
                primary_report_id=r1.report_id,
                related_report_ids=rel_ids,
                trial_registrations=registrations,
                total_sample_size=sample_size
            )
            families.append(fam)

        return {
            "total_reports": len(reports),
            "unique_study_families": len(families),
            "families": [f.__dict__ for f in families]
        }
