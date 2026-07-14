from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
TOOL = ROOT / "scripts" / "migration" / "compare-manifests.py"


def digest(value: str) -> str:
    return "sha256:" + hashlib.sha256(value.encode("utf-8")).hexdigest()


def edge_configuration(verify_jwt: bool = True) -> dict[str, object]:
    return {
        "verify_jwt": {"value": verify_jwt, "source": "synthetic_fixture"},
        "entrypoint": {
            "value": "supabase/functions/example/index.ts",
            "source": "synthetic_fixture",
        },
        "import_map": {"value": None, "source": "documented_default"},
    }


def component(
    key: str,
    *,
    kind: str = "table",
    count: int | None = 1,
    fingerprint: str | None = None,
    evidence_kind: str = "synthetic_fixture",
    configuration: dict[str, object] | None = None,
    configuration_known: bool = True,
    independently_verifiable: bool = True,
    closure: list[str] | None = None,
) -> dict[str, object]:
    if fingerprint is None and evidence_kind != "unavailable":
        fingerprint = digest(f"{kind}:{key}")
    if configuration is None:
        configuration = edge_configuration() if kind == "edge_function" else {}
    return {
        "key": key,
        "kind": kind,
        "count": count,
        "evidence": {
            "kind": evidence_kind,
            "fingerprint": fingerprint,
            "closure": closure,
        },
        "configuration": configuration,
        "configuration_known": configuration_known,
        "independently_verifiable": independently_verifiable,
    }


def manifest(
    role: str,
    components: list[dict[str, object]],
    *,
    project_ref: str | None = None,
    artifact_seed: str | None = None,
) -> dict[str, object]:
    project_ref = project_ref or f"synthetic-{role}"
    artifact_seed = artifact_seed or f"{role}-artifact"
    return {
        "format_version": 2,
        "label": f"{role}-fixture",
        "role": role,
        "project_ref": project_ref,
        "collection": {
            "boundary": {
                "kind": "synthetic_fixture",
                "value": f"{role}-boundary-{artifact_seed}",
            },
            "collected_at": "2026-07-14T12:00:00Z",
            "collector": {"name": "manifest-test", "version": "2.0.0"},
            "artifact": {
                "kind": "synthetic_fixture",
                "source": f"local {role} fixture {artifact_seed}",
                "sha256": digest(artifact_seed),
            },
        },
        "components": components,
    }


class CompareManifestCliTest(unittest.TestCase):
    def run_tool(self, source: dict[str, object], target: dict[str, object]):
        with tempfile.TemporaryDirectory(prefix="manifest comparison ") as directory:
            root = Path(directory)
            source_path = root / "source manifest.json"
            target_path = root / "target manifest.json"
            source_path.write_text(json.dumps(source), encoding="utf-8")
            target_path.write_text(json.dumps(target), encoding="utf-8")
            return subprocess.run(
                [sys.executable, str(TOOL), str(source_path), str(target_path), "--format", "json"],
                check=False,
                capture_output=True,
                text=True,
            )

    def test_match_with_distinct_provenance(self):
        source = manifest("source", [component("public.accounts")])
        target = manifest("target", [component("public.accounts")])
        result = self.run_tool(source, target)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["results"][0]["outcomes"], ["Match"])

    def test_all_required_non_match_outcomes(self):
        source = manifest(
            "source",
            [
                component("public.missing"),
                component("public.counted", count=2),
                component(
                    "dashboard.oauth",
                    kind="auth",
                    count=None,
                    fingerprint=None,
                    evidence_kind="unavailable",
                    configuration_known=False,
                    independently_verifiable=False,
                ),
            ],
        )
        target = manifest(
            "target",
            [
                component("public.unexpected"),
                component("public.counted", count=3),
                component(
                    "dashboard.oauth",
                    kind="auth",
                    count=None,
                    fingerprint=None,
                    evidence_kind="unavailable",
                    configuration_known=False,
                    independently_verifiable=False,
                ),
            ],
        )
        result = self.run_tool(source, target)
        self.assertEqual(result.returncode, 2, result.stderr)
        outcomes = {row["key"]: row["outcomes"] for row in json.loads(result.stdout)["results"]}
        self.assertEqual(outcomes["public.missing"], ["Missing on target"])
        self.assertEqual(outcomes["public.unexpected"], ["Unexpected on target"])
        self.assertEqual(outcomes["public.counted"], ["Count mismatch"])
        self.assertEqual(
            outcomes["dashboard.oauth"],
            ["Not independently verifiable", "Configuration unknown"],
        )

    def test_structured_verify_jwt_mismatch_is_not_a_match(self):
        source_component = component(
            "example",
            kind="edge_function",
            count=None,
            evidence_kind="edge_function_deployment_closure",
            closure=["supabase/functions/example/index.ts"],
            configuration=edge_configuration(True),
        )
        target_component = component(
            "example",
            kind="edge_function",
            count=None,
            evidence_kind="edge_function_deployment_closure",
            closure=["supabase/functions/example/index.ts"],
            configuration=edge_configuration(False),
        )
        result = self.run_tool(
            manifest("source", [source_component]), manifest("target", [target_component])
        )
        self.assertEqual(result.returncode, 2, result.stderr)
        row = json.loads(result.stdout)["results"][0]
        self.assertEqual(row["outcomes"], ["Configuration mismatch"])
        self.assertEqual(row["configuration_differences"], ["verify_jwt"])

    def test_effective_config_matches_across_different_evidence_sources(self):
        source_config = edge_configuration(True)
        target_config = edge_configuration(True)
        for setting in target_config.values():
            setting["source"] = "runtime_observation"  # type: ignore[index]
        source_component = component(
            "example",
            kind="edge_function",
            count=None,
            evidence_kind="edge_function_deployment_closure",
            closure=["supabase/functions/example/index.ts"],
            configuration=source_config,
        )
        target_component = component(
            "example",
            kind="edge_function",
            count=None,
            evidence_kind="edge_function_deployment_closure",
            closure=["supabase/functions/example/index.ts"],
            configuration=target_config,
        )
        result = self.run_tool(
            manifest("source", [source_component]), manifest("target", [target_component])
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_fingerprint_mismatch_is_not_a_match(self):
        source = manifest("source", [component("public.accounts", fingerprint=digest("a"))])
        target = manifest("target", [component("public.accounts", fingerprint=digest("b"))])
        result = self.run_tool(source, target)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(
            json.loads(result.stdout)["results"][0]["outcomes"],
            ["Configuration mismatch"],
        )

    def test_empty_manifest_fails_closed(self):
        result = self.run_tool(manifest("source", []), manifest("target", [component("x")]))
        self.assertEqual(result.returncode, 1)
        self.assertIn("non-empty array", result.stderr)

    def test_same_file_input_fails_closed(self):
        value = manifest("source", [component("public.accounts")])
        with tempfile.TemporaryDirectory(prefix="same manifest ") as directory:
            path = Path(directory) / "same.json"
            path.write_text(json.dumps(value), encoding="utf-8")
            result = subprocess.run(
                [sys.executable, str(TOOL), str(path), str(path)],
                check=False,
                capture_output=True,
                text=True,
            )
        self.assertEqual(result.returncode, 1)
        self.assertIn("same manifest input", result.stderr)

    def test_source_vs_source_comparison_fails_closed(self):
        result = self.run_tool(
            manifest("source", [component("a")], project_ref="synthetic-a"),
            manifest("source", [component("a")], project_ref="synthetic-b"),
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("requires source role then target role", result.stderr)

    def test_same_project_ref_fails_closed(self):
        source = manifest("source", [component("a")], project_ref="synthetic-same")
        target = manifest("target", [component("a")], project_ref="synthetic-same")
        result = self.run_tool(source, target)
        self.assertEqual(result.returncode, 1)
        self.assertIn("project_ref must be different", result.stderr)

    def test_same_collection_provenance_fails_closed(self):
        source = manifest("source", [component("a")], artifact_seed="same")
        target = manifest("target", [component("a")], artifact_seed="same")
        target["collection"] = json.loads(json.dumps(source["collection"]))
        result = self.run_tool(source, target)
        self.assertEqual(result.returncode, 1)
        self.assertIn("same collection/artifact provenance", result.stderr)

    def test_local_target_repository_inventory_cannot_self_attest(self):
        source = manifest("source", [component("public.accounts")])
        target = manifest(
            "target",
            [
                component(
                    "example",
                    kind="edge_function",
                    count=None,
                    evidence_kind="edge_function_deployment_closure",
                    closure=["supabase/functions/example/index.ts"],
                )
            ],
            project_ref="bcdefghijklmnopqrstu",
        )
        target_collection = target["collection"]
        assert isinstance(target_collection, dict)
        target_collection["collector"] = {
            "name": "inventory-edge-functions",
            "version": "2.0.0",
        }
        target_collection["artifact"] = {
            "kind": "repository_deployment_inventory",
            "source": "local target repository checkout",
            "sha256": digest("target-repository-artifact"),
        }
        target_collection["boundary"] = {
            "kind": "repository_content_sha256",
            "value": digest("target-repository-artifact"),
        }
        result = self.run_tool(source, target)
        self.assertEqual(result.returncode, 1)
        self.assertIn("cannot be independently verifiable", result.stderr)

    def test_real_source_catalog_manifest_cannot_self_attest(self):
        source = manifest(
            "source",
            [
                component(
                    "public.accounts",
                    evidence_kind="database_catalog",
                    independently_verifiable=True,
                )
            ],
            project_ref="abcdefghijklmnopqrst",
        )
        source_collection = source["collection"]
        assert isinstance(source_collection, dict)
        source_collection["collector"] = {
            "name": "postgresql-jsonl-to-manifest",
            "version": "3.0.0",
        }
        source_collection["artifact"] = {
            "kind": "postgresql_catalog_jsonl",
            "source": "captured Lovable source catalog",
            "sha256": digest("source-catalog-artifact"),
        }
        source_collection["boundary"] = {
            "kind": "database_read_only_transaction",
            "value": "100:200:",
        }
        result = self.run_tool(source, manifest("target", [component("public.accounts")]))
        self.assertEqual(result.returncode, 1)
        self.assertIn("Lovable source catalog evidence cannot be marked", result.stderr)

    def test_placeholder_component_fingerprint_fails_closed(self):
        unsafe = component("public.accounts", fingerprint="sha256:" + "0" * 64)
        result = self.run_tool(manifest("source", [unsafe]), manifest("target", [component("x")]))
        self.assertEqual(result.returncode, 1)
        self.assertIn("placeholder or low-entropy", result.stderr)

    def test_placeholder_artifact_fingerprint_fails_closed(self):
        unsafe = manifest("source", [component("public.accounts")])
        unsafe["collection"]["artifact"]["sha256"] = "sha256:" + "f" * 64  # type: ignore[index]
        result = self.run_tool(unsafe, manifest("target", [component("x")]))
        self.assertEqual(result.returncode, 1)
        self.assertIn("placeholder or low-entropy", result.stderr)

    def test_kind_insufficient_evidence_fails_closed(self):
        unsafe = component(
            "example",
            kind="edge_function",
            count=None,
            evidence_kind="database_catalog",
            configuration=edge_configuration(),
        )
        result = self.run_tool(manifest("source", [unsafe]), manifest("target", [component("x")]))
        self.assertEqual(result.returncode, 1)
        self.assertIn("insufficient for component kind", result.stderr)

    def test_different_evidence_kinds_cannot_match_on_equal_fingerprint(self):
        fingerprint = digest("same-payload")
        source = component(
            "public.accounts",
            fingerprint=fingerprint,
            evidence_kind="synthetic_fixture",
        )
        target = component(
            "public.accounts",
            fingerprint=fingerprint,
            evidence_kind="database_catalog",
        )
        result = self.run_tool(manifest("source", [source]), manifest("target", [target]))
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertEqual(
            json.loads(result.stdout)["results"][0]["outcomes"],
            ["Configuration mismatch"],
        )

    def test_table_without_exact_count_fails_closed(self):
        unsafe = component("public.accounts", count=None)
        result = self.run_tool(manifest("source", [unsafe]), manifest("target", [component("x")]))
        self.assertEqual(result.returncode, 1)
        self.assertIn("table evidence requires an exact count", result.stderr)

    def test_missing_provenance_field_fails_closed(self):
        unsafe = manifest("source", [component("public.accounts")])
        del unsafe["collection"]["artifact"]["source"]  # type: ignore[index]
        result = self.run_tool(unsafe, manifest("target", [component("x")]))
        self.assertEqual(result.returncode, 1)
        self.assertIn("missing field", result.stderr)

    def test_repository_boundary_must_bind_artifact_sha(self):
        unsafe = manifest("source", [component("public.accounts")])
        artifact_sha = unsafe["collection"]["artifact"]["sha256"]  # type: ignore[index]
        unsafe["collection"]["boundary"] = {  # type: ignore[index]
            "kind": "repository_content_sha256",
            "value": digest("different repository content"),
        }
        self.assertNotEqual(unsafe["collection"]["boundary"]["value"], artifact_sha)  # type: ignore[index]
        result = self.run_tool(unsafe, manifest("target", [component("x")]))
        self.assertEqual(result.returncode, 1)
        self.assertIn("boundary must equal artifact SHA-256", result.stderr)

    def test_unknown_fields_fail_closed(self):
        source = manifest("source", [component("public.accounts")])
        source["surprise"] = "ignored only by unsafe parsers"
        result = self.run_tool(source, manifest("target", [component("x")]))
        self.assertEqual(result.returncode, 1)
        self.assertIn("unknown field", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_duplicate_json_key_fails_closed(self):
        source = manifest("source", [component("public.accounts")])
        target = manifest("target", [component("public.accounts")])
        with tempfile.TemporaryDirectory(prefix="duplicate manifest key ") as directory:
            root = Path(directory)
            source_path = root / "source.json"
            target_path = root / "target.json"
            source_text = json.dumps(source)
            source_path.write_text(
                '{"label":"shadowed",' + source_text[1:], encoding="utf-8"
            )
            target_path.write_text(json.dumps(target), encoding="utf-8")
            result = subprocess.run(
                [sys.executable, str(TOOL), str(source_path), str(target_path)],
                check=False,
                capture_output=True,
                text=True,
            )
        self.assertEqual(result.returncode, 1)
        self.assertIn("duplicate JSON object key", result.stderr)

    def test_duplicate_identity_fails_closed(self):
        duplicate = manifest(
            "source", [component("public.accounts"), component("public.accounts")]
        )
        result = self.run_tool(duplicate, manifest("target", [component("x")]))
        self.assertEqual(result.returncode, 1)
        self.assertIn("duplicate component identity", result.stderr)


if __name__ == "__main__":
    unittest.main()
