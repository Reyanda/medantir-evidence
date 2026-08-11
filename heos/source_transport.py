"""
Decoupled Transport Bridge for HEOS 2.
Separates institutional authentication plumbing (managed centrally in Settings) from review engine logic.
"""

from typing import Dict, Any, Optional
import os

class InstitutionalTransportBridge:
    """Decoupled transport connector fetching sessions from the global Settings vault."""

    def __init__(self, vault_dir: str = "~/.medantir/vault"):
        self.vault_dir = os.path.expanduser(vault_dir)

    def check_auth_status(self, source_id: str) -> Dict[str, Any]:
        """Checks if a valid authenticated session exists in Settings without loading raw passwords."""
        public_sources = ["pubmed", "europe_pmc", "openalex", "crossref", "clinicaltrials_gov", "arxiv"]
        if source_id.lower() in public_sources:
            return {"ok": True, "auth_type": "public_api", "status": "READY"}

        # For licensed/institutional databases, check central session vault
        vault_file = os.path.join(self.vault_dir, f"{source_id}.json")
        if not os.path.exists(vault_file):
            return {
                "ok": False,
                "status": "AUTH_REQUIRED",
                "message": f"Authentication required for '{source_id}'. Please log in via Settings -> Integrations Hub.",
                "deep_link": f"medantir://settings/integrations?source={source_id}",
                "action_item": {
                    "inbox_code": f"AUTH_REQ_{source_id.upper()}",
                    "title": f"Log in to {source_id}",
                    "description": "Click to open Settings -> Database & Institutional Access Hub to authenticate once."
                }
            }

        return {"ok": True, "auth_type": "institutional_vault", "status": "READY"}

    def execute_search_query(self, source_id: str, compiled_query: str) -> Dict[str, Any]:
        """Executes a search using the centralized session handle."""
        auth = self.check_auth_status(source_id)
        if not auth["ok"]:
            return auth

        # Simulate clean decoupled execution
        return {
            "ok": True,
            "source_id": source_id,
            "compiled_query": compiled_query,
            "records_retrieved": 42,
            "provenance": {
                "access_route": "central_settings_vault",
                "auth_status": "verified"
            }
        }
