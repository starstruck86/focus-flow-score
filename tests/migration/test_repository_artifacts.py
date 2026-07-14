from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
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
MIGRATION_TOOL_README = ROOT / "scripts" / "migration" / "README.md"
LEDGER_LINE = re.compile(r"^([0-9a-f]{64})  (supabase/migrations/[^\n]+\.sql)$")
REVIEWED_INSPECTION_SHA = "c87a124602eb669b3ec5a3829610c6cb465d3e26"

SPEC = importlib.util.spec_from_file_location("strict_manifest", COMPARE_TOOL)
assert SPEC and SPEC.loader
MANIFEST_MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MANIFEST_MODULE
SPEC.loader.exec_module(MANIFEST_MODULE)


class RepositoryArtifactTest(unittest.TestCase):
    def test_documented_export_evidence_template_is_executable_and_fail_closed(self):
        readme = MIGRATION_TOOL_README.read_text(encoding="utf-8")
        bash_block = re.search(r"```bash\n(.*?)\n```", readme, re.DOTALL)
        self.assertIsNotNone(bash_block)
        assert bash_block is not None
        syntax = subprocess.run(
            ["bash", "-n"],
            input=bash_block.group(1),
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(syntax.returncode, 0, syntax.stderr)
        snippets = re.findall(r"<<'PY'\n(.*?)\nPY", bash_block.group(1), re.DOTALL)
        self.assertEqual(len(snippets), 2)

        environment = os.environ | {
            "SOURCE_PROJECT_NAME": "Synthetic Lovable rehearsal",
            "SOURCE_PROJECT_REF": "abcdefghijklmnopqrst",
            "EXPORT_INITIATED_AT_UTC": "2026-07-14T12:00:00Z",
            "EXPORT_COMPLETED_AT_UTC": "2026-07-14T12:05:00Z",
            "DOWNLOAD_COMPLETED_AT_UTC": "2026-07-14T12:06:00Z",
            "OPERATOR_IDENTITY": "synthetic-test-operator",
            "REVIEWED_GIT_SHA": REVIEWED_INSPECTION_SHA,
            "RUN_ID": "rehearsal-synthetic",
        }

        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            run_root = temporary / "local-migration-artifacts" / "rehearsal-synthetic"
            archive_dir = run_root / "archive"
            inspection_dir = run_root / "inspection"
            archive_dir.mkdir(parents=True)
            inspection_dir.mkdir()
            canonical = temporary / "encrypted-evidence-store" / "Lovable export.backup"
            canonical.parent.mkdir()
            canonical.write_bytes(b"PGDMP synthetic metadata-only fixture")
            working = archive_dir / canonical.name
            working.write_bytes(canonical.read_bytes())
            before = archive_dir / "archive.sha256.before"

            initial = subprocess.run(
                [sys.executable, "-", str(canonical), str(working), str(before)],
                input=snippets[0],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(initial.returncode, 0, initial.stderr)
            archive_sha = hashlib.sha256(working.read_bytes()).hexdigest()
            report = inspection_dir / "rehearsal-metadata.txt"
            report.write_text(
                "inspection_status: REVIEW_REQUIRED\n"
                "restore_attempted: no\n"
                "database_connection_attempted: no\n"
                "row_payload_inspected: no\n"
                f"input_file: {working.name}\n"
                f"size_bytes: {working.stat().st_size}\n"
                f"sha256: {archive_sha}\n"
                "archive_snapshot_binding: PASS (synthetic bound snapshot)\n",
                encoding="utf-8",
            )
            after = archive_dir / "archive.sha256.after"
            report_sha = inspection_dir / "report.sha256"
            provenance = run_root / "provenance.json"
            arguments = [
                canonical,
                working,
                before,
                after,
                report,
                report_sha,
                provenance,
                run_root,
            ]
            packaged = subprocess.run(
                [sys.executable, "-", *map(str, arguments)],
                input=snippets[1],
                check=False,
                capture_output=True,
                text=True,
                env=environment,
            )
            self.assertEqual(packaged.returncode, 0, packaged.stderr)
            manifest = json.loads(provenance.read_text(encoding="utf-8"))
            self.assertEqual(manifest["lovable_source_project"]["ref"], "abcdefghijklmnopqrst")
            self.assertEqual(manifest["export"]["sha256"], archive_sha)
            self.assertEqual(
                manifest["export"]["sha256_evidence"],
                {
                    "external_after": archive_sha,
                    "external_before": archive_sha,
                    "inspector_report": archive_sha,
                },
            )
            self.assertEqual(
                manifest["export"]["initiated_at_utc"]["basis"],
                "operator_observed",
            )
            self.assertEqual(manifest["reviewed_git_sha"], REVIEWED_INSPECTION_SHA)
            self.assertEqual(
                manifest["inspection_tool"]["git_sha"], REVIEWED_INSPECTION_SHA
            )
            self.assertEqual(
                manifest["report"]["sha256"], hashlib.sha256(report.read_bytes()).hexdigest()
            )
            self.assertEqual(before.read_text().strip(), archive_sha)
            self.assertEqual(after.read_text().strip(), archive_sha)

        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            canonical = temporary / "Lovable export.backup"
            working = temporary / canonical.name
            canonical.write_bytes(b"PGDMP synthetic planted mismatch")
            working.write_bytes(canonical.read_bytes())
            before = temporary / "before.sha256"
            before.write_text("0" * 64 + "\n", encoding="ascii")
            report = temporary / "report.txt"
            archive_sha = hashlib.sha256(working.read_bytes()).hexdigest()
            report.write_text(
                "inspection_status: REVIEW_REQUIRED\n"
                "restore_attempted: no\n"
                "database_connection_attempted: no\n"
                "row_payload_inspected: no\n"
                f"input_file: {working.name}\n"
                f"size_bytes: {working.stat().st_size}\n"
                f"sha256: {archive_sha}\n"
                "archive_snapshot_binding: PASS (synthetic bound snapshot)\n",
                encoding="utf-8",
            )
            arguments = [
                canonical,
                working,
                before,
                temporary / "after.sha256",
                report,
                temporary / "report.sha256",
                temporary / "provenance.json",
                temporary,
            ]
            mismatch = subprocess.run(
                [sys.executable, "-", *map(str, arguments)],
                input=snippets[1],
                check=False,
                capture_output=True,
                text=True,
                env=environment,
            )
            self.assertNotEqual(mismatch.returncode, 0)
            self.assertIn("SHA-256 differ", mismatch.stderr)

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
