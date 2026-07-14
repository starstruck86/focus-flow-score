from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
TOOL = ROOT / "scripts" / "migration" / "inventory-edge-functions.py"
COMPARE_TOOL = ROOT / "scripts" / "migration" / "compare-manifests.py"
COLLECTED_AT = "2026-07-14T12:00:00Z"


class EdgeInventoryTest(unittest.TestCase):
    def make_repo(self, config: str) -> tuple[tempfile.TemporaryDirectory[str], Path]:
        temporary = tempfile.TemporaryDirectory(prefix="edge inventory repo ")
        root = Path(temporary.name)
        (root / "supabase" / "functions" / "explicit").mkdir(parents=True)
        (root / "supabase" / "functions" / "unset").mkdir(parents=True)
        shared = root / "supabase" / "functions" / "_shared"
        shared.mkdir(parents=True)
        (root / "supabase" / "functions" / "explicit" / "index.ts").write_text(
            'import { value } from "../_shared/one.ts";\nexport { value };\n',
            encoding="utf-8",
        )
        (root / "supabase" / "functions" / "unset" / "index.ts").write_text(
            "export const value = 2;\n", encoding="utf-8"
        )
        (shared / "one.ts").write_text(
            'export { nested as value } from "./nested.ts";\n', encoding="utf-8"
        )
        (shared / "nested.ts").write_text("export const nested = 1;\n", encoding="utf-8")
        (shared / "unrelated.ts").write_text(
            "export const unrelated = 1;\n", encoding="utf-8"
        )
        (root / "supabase" / "config.toml").write_text(
            'project_id = "aaaaaaaaaaaaaaaaaaaa"\n\n' + config,
            encoding="utf-8",
        )
        return temporary, root

    def run_tool(
        self,
        root: Path,
        *,
        collected_at: str = COLLECTED_AT,
        role: str = "source",
        project_ref: str | None = None,
    ):
        command = [
            sys.executable,
            str(TOOL),
            "--repo-root",
            str(root),
            "--role",
            role,
            "--collected-at",
            collected_at,
        ]
        if project_ref is not None:
            command.extend(("--project-ref", project_ref))
        return subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
        )

    def test_resolved_shared_closure_and_effective_configuration(self):
        temporary, root = self.make_repo(
            '[functions.explicit]\nverify_jwt = false\n\n[functions.unset]\n'
        )
        with temporary:
            result = self.run_tool(root)
        self.assertEqual(result.returncode, 0, result.stderr)
        manifest = json.loads(result.stdout)
        self.assertEqual(manifest["format_version"], 2)
        self.assertEqual(manifest["role"], "source")
        self.assertEqual(manifest["project_ref"], "aaaaaaaaaaaaaaaaaaaa")
        self.assertEqual(manifest["collection"]["collected_at"], COLLECTED_AT)
        components = {item["key"]: item for item in manifest["components"]}

        explicit = components["explicit"]
        self.assertEqual(
            explicit["evidence"]["closure"],
            [
                "supabase/functions/_shared/nested.ts",
                "supabase/functions/_shared/one.ts",
                "supabase/functions/explicit/index.ts",
            ],
        )
        self.assertEqual(
            explicit["configuration"]["verify_jwt"],
            {"value": False, "source": "explicit_config"},
        )
        self.assertEqual(
            components["unset"]["configuration"]["verify_jwt"],
            {"value": True, "source": "documented_default"},
        )
        self.assertTrue(explicit["evidence"]["fingerprint"].startswith("sha256:"))
        self.assertEqual(
            manifest["collection"]["boundary"]["value"],
            manifest["collection"]["artifact"]["sha256"],
        )

    def test_shared_dependency_mutation_changes_only_its_resolved_consumers(self):
        temporary, root = self.make_repo(
            '[functions.explicit]\nverify_jwt = false\n\n[functions.unset]\n'
        )
        with temporary:
            first = json.loads(self.run_tool(root).stdout)
            (root / "supabase" / "functions" / "_shared" / "nested.ts").write_text(
                "export const nested = 2;\n", encoding="utf-8"
            )
            second = json.loads(self.run_tool(root).stdout)
        first_components = {item["key"]: item for item in first["components"]}
        second_components = {item["key"]: item for item in second["components"]}
        self.assertNotEqual(
            first_components["explicit"]["evidence"]["fingerprint"],
            second_components["explicit"]["evidence"]["fingerprint"],
        )
        self.assertEqual(
            first_components["unset"]["evidence"]["fingerprint"],
            second_components["unset"]["evidence"]["fingerprint"],
        )

    def test_unrelated_shared_file_is_not_silently_folded_into_closure(self):
        temporary, root = self.make_repo(
            '[functions.explicit]\nverify_jwt = false\n\n[functions.unset]\n'
        )
        with temporary:
            first = json.loads(self.run_tool(root).stdout)
            (root / "supabase" / "functions" / "_shared" / "unrelated.ts").write_text(
                "export const unrelated = 999;\n", encoding="utf-8"
            )
            second = json.loads(self.run_tool(root).stdout)
        self.assertEqual(first["components"], second["components"])

    def test_effective_verify_jwt_change_changes_deployment_fingerprint(self):
        temporary, root = self.make_repo(
            '[functions.explicit]\nverify_jwt = false\n\n[functions.unset]\n'
        )
        with temporary:
            first = json.loads(self.run_tool(root).stdout)
            config = root / "supabase" / "config.toml"
            config.write_text(
                'project_id = "aaaaaaaaaaaaaaaaaaaa"\n\n'
                '[functions.explicit]\nverify_jwt = true\n\n[functions.unset]\n',
                encoding="utf-8",
            )
            second = json.loads(self.run_tool(root).stdout)
        first_explicit = next(item for item in first["components"] if item["key"] == "explicit")
        second_explicit = next(item for item in second["components"] if item["key"] == "explicit")
        self.assertNotEqual(
            first_explicit["evidence"]["fingerprint"],
            second_explicit["evidence"]["fingerprint"],
        )
        self.assertFalse(first_explicit["configuration"]["verify_jwt"]["value"])
        self.assertTrue(second_explicit["configuration"]["verify_jwt"]["value"])

    def test_same_local_checkout_cannot_verify_target_deployment(self):
        temporary, root = self.make_repo(
            '[functions.explicit]\nverify_jwt = false\n\n[functions.unset]\n'
        )
        with temporary:
            source = self.run_tool(root, role="source")
            target = self.run_tool(
                root,
                role="target",
                project_ref="bbbbbbbbbbbbbbbbbbbb",
            )
            self.assertEqual(source.returncode, 0, source.stderr)
            self.assertEqual(target.returncode, 0, target.stderr)
            source_manifest = json.loads(source.stdout)
            target_manifest = json.loads(target.stdout)
            self.assertTrue(
                all(item["independently_verifiable"] for item in source_manifest["components"])
            )
            self.assertTrue(
                all(not item["independently_verifiable"] for item in target_manifest["components"])
            )
            self.assertNotEqual(
                source_manifest["collection"]["artifact"]["sha256"],
                target_manifest["collection"]["artifact"]["sha256"],
            )
            self.assertEqual(
                {
                    item["key"]: item["evidence"]["fingerprint"]
                    for item in source_manifest["components"]
                },
                {
                    item["key"]: item["evidence"]["fingerprint"]
                    for item in target_manifest["components"]
                },
            )
            self.assertNotEqual(
                source_manifest["collection"]["artifact"]["source"],
                target_manifest["collection"]["artifact"]["source"],
            )
            source_path = root / "source manifest.json"
            target_path = root / "target manifest.json"
            source_path.write_text(source.stdout, encoding="utf-8")
            target_path.write_text(target.stdout, encoding="utf-8")
            comparison = subprocess.run(
                [
                    sys.executable,
                    str(COMPARE_TOOL),
                    str(source_path),
                    str(target_path),
                    "--format",
                    "json",
                ],
                check=False,
                capture_output=True,
                text=True,
            )
        self.assertEqual(comparison.returncode, 2, comparison.stderr)
        outcomes = [
            outcome
            for row in json.loads(comparison.stdout)["results"]
            for outcome in row["outcomes"]
        ]
        self.assertTrue(outcomes)
        self.assertEqual(set(outcomes), {"Not independently verifiable"})

    def test_orphan_config_fails_closed(self):
        temporary, root = self.make_repo(
            '[functions.explicit]\nverify_jwt = true\n\n[functions.orphan]\nverify_jwt = false\n'
        )
        with temporary:
            result = self.run_tool(root)
        self.assertEqual(result.returncode, 1)
        self.assertIn("config names without matching function directory", result.stderr)
        self.assertEqual(result.stdout, "")

    def test_unresolved_local_import_fails_closed(self):
        temporary, root = self.make_repo('[functions.explicit]\nverify_jwt = true\n')
        with temporary:
            (root / "supabase" / "functions" / "explicit" / "index.ts").write_text(
                'import "../_shared/missing.ts";\n', encoding="utf-8"
            )
            result = self.run_tool(root)
        self.assertEqual(result.returncode, 1)
        self.assertIn("unresolved local import", result.stderr)

    def test_unknown_effective_config_setting_fails_closed(self):
        temporary, root = self.make_repo(
            '[functions.explicit]\nverify_jwt = true\nunsupported = "value"\n'
        )
        with temporary:
            result = self.run_tool(root)
        self.assertEqual(result.returncode, 1)
        self.assertIn("unsupported effective function setting", result.stderr)

    def test_collection_time_is_required_and_validated(self):
        temporary, root = self.make_repo('[functions.explicit]\nverify_jwt = true\n')
        with temporary:
            missing = subprocess.run(
                [
                    sys.executable,
                    str(TOOL),
                    "--repo-root",
                    str(root),
                    "--role",
                    "source",
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            invalid = self.run_tool(root, collected_at="2026-07-14")
        self.assertEqual(missing.returncode, 2)
        self.assertIn("--collected-at", missing.stderr)
        self.assertEqual(invalid.returncode, 1)
        self.assertIn("RFC3339 UTC", invalid.stderr)

    def test_target_role_requires_explicit_project_ref(self):
        temporary, root = self.make_repo('[functions.explicit]\nverify_jwt = true\n')
        with temporary:
            result = self.run_tool(root, role="target")
        self.assertEqual(result.returncode, 1)
        self.assertIn("--project-ref is required", result.stderr)


if __name__ == "__main__":
    unittest.main()
