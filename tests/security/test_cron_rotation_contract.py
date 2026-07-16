from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]
ROTATION_DESIGN = ROOT / "docs" / "security" / "cron-secret-rotation.md"


class CronRotationContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.text = ROTATION_DESIGN.read_text(encoding="utf-8")

    def test_gateway_api_key_and_jwt_are_independent(self) -> None:
        self.assertIn("'apikey', v_api_key", self.text)
        self.assertIn("'authorization', 'Bearer ' || v_gateway_jwt", self.text)
        self.assertIn("v_gateway_jwt = v_api_key", self.text)
        self.assertNotIn("'authorization', 'Bearer ' || v_api_key", self.text)

    def test_all_caller_branches_are_explicit(self) -> None:
        for branch in (
            "Confirmed no caller/job",
            "Verified pg_cron + Vault caller",
            "Other external caller",
        ):
            self.assertIn(branch, self.text)
        self.assertIn("scheduler as a side effect of credential containment", self.text)

    def test_sanitized_database_evidence_contract_is_present(self) -> None:
        for marker in (
            "security_definer_enabled",
            "proconfig_is_only_empty_search_path",
            "acl_is_owner_plus_job_role_only",
            "definition_fingerprint_matches_reviewed",
            "cron.job_run_details",
            "response_matches_exact_request",
        ):
            self.assertIn(marker, self.text)

    def test_three_layer_gate_and_inferred_run_link_are_explicit(self) -> None:
        self.assertIn("The three required proof", self.text)
        self.assertIn("label that link `INFERRED`", self.text)
        self.assertIn("Ambiguity is a stop", self.text)


if __name__ == "__main__":
    unittest.main()
