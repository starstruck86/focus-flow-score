from __future__ import annotations

import hashlib
import importlib.util
import json
import re
import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
LEDGER = ROOT / "docs" / "migration" / "sql-migrations.sha256"
EDGE_INVENTORY = ROOT / "docs" / "migration" / "edge-functions.json"
EDGE_TOOL = ROOT / "scripts" / "migration" / "inventory-edge-functions.py"
COMPARE_TOOL = ROOT / "scripts" / "migration" / "compare-manifests.py"
MANIFEST_EXAMPLE = ROOT / "scripts" / "migration" / "verification" / "manifest.schema.example.json"
SQL_INVENTORY = ROOT / "docs" / "migration" / "sql-inventory.md"
RUNTIME_INVENTORY = ROOT / "docs" / "migration" / "runtime-inventory.md"
LEDGER_LINE = re.compile(r"^([0-9a-f]{64})  (supabase/migrations/[^\n]+\.sql)$")

SPEC = importlib.util.spec_from_file_location("strict_manifest", COMPARE_TOOL)
assert SPEC and SPEC.loader
MANIFEST_MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MANIFEST_MODULE
SPEC.loader.exec_module(MANIFEST_MODULE)


class RepositoryArtifactTest(unittest.TestCase):
    def test_manifest_schema_example_is_strictly_valid(self):
        parsed = MANIFEST_MODULE.load_manifest(MANIFEST_EXAMPLE)
        self.assertEqual(parsed.role, "source")
        self.assertEqual(parsed.project_ref, "synthetic-source")
        self.assertGreater(len(parsed.components), 0)

    def test_migration_checksum_ledger_is_complete_ordered_and_current(self):
        migrations = sorted((ROOT / "supabase" / "migrations").glob("*.sql"))
        lines = LEDGER.read_text(encoding="utf-8").splitlines()
        self.assertEqual(len(lines), len(migrations))

        recorded_paths: list[str] = []
        for line in lines:
            match = LEDGER_LINE.fullmatch(line)
            self.assertIsNotNone(match, line)
            assert match is not None
            expected_digest, relative = match.groups()
            path = ROOT / relative
            self.assertTrue(path.is_file(), relative)
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), expected_digest)
            recorded_paths.append(relative)

        expected_paths = [path.relative_to(ROOT).as_posix() for path in migrations]
        self.assertEqual(recorded_paths, expected_paths)

        detailed_inventory = SQL_INVENTORY.read_text(encoding="utf-8")
        for line in lines:
            digest, relative = LEDGER_LINE.fullmatch(line).groups()  # type: ignore[union-attr]
            self.assertIn(Path(relative).name, detailed_inventory)
            self.assertIn(digest, detailed_inventory)

    def test_edge_function_inventory_is_reproducible(self):
        recorded = json.loads(EDGE_INVENTORY.read_text())
        result = subprocess.run(
            [
                sys.executable,
                str(EDGE_TOOL),
                "--repo-root",
                str(ROOT),
                "--role",
                "source",
                "--collected-at",
                recorded["collection"]["collected_at"],
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        generated = json.loads(result.stdout)
        self.assertEqual(generated, recorded)
        components = generated["components"]
        self.assertEqual(len(components), 120)
        self.assertEqual(sum(item["configuration_known"] for item in components), 120)
        self.assertEqual(
            sum(
                item["configuration"]["verify_jwt"]
                == {"source": "explicit_config", "value": True}
                for item in components
            ),
            5,
        )
        self.assertEqual(
            sum(
                item["configuration"]["verify_jwt"]
                == {"source": "explicit_config", "value": False}
                for item in components
            ),
            37,
        )
        self.assertEqual(
            sum(
                item["configuration"]["verify_jwt"]["source"]
                == "documented_default"
                for item in components
            ),
            78,
        )
        self.assertGreater(
            sum(
                any("/_shared/" in path for path in item["evidence"]["closure"])
                for item in components
            ),
            0,
        )

        runtime_inventory = RUNTIME_INVENTORY.read_text(encoding="utf-8")
        function_rows = [
            line
            for line in runtime_inventory.splitlines()
            if line.startswith("| `")
        ]
        self.assertEqual(len(function_rows), 120)


if __name__ == "__main__":
    unittest.main()
