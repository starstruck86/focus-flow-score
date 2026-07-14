from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import re
import shutil
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
PROCEDURE_ORIGIN_SHA = "e4eed4a21049d274738110710a468e265c2893d2"
INSPECTION_TOOL_SHA = "c87a124602eb669b3ec5a3829610c6cb465d3e26"
WORKFLOW_LABEL = b"LOVABLE EXPORT EVIDENCE WORKFLOW"
WORKFLOW_BEGIN = b"<!-- BEGIN " + WORKFLOW_LABEL + b" -->\n"
WORKFLOW_END = b"\n<!-- END " + WORKFLOW_LABEL + b" -->"


def extract_fenced_workflow(readme: bytes) -> bytes:
    if readme.count(WORKFLOW_BEGIN) != 1 or readme.count(WORKFLOW_END) != 1:
        raise AssertionError("workflow markers must each occur exactly once")
    start = readme.index(WORKFLOW_BEGIN) + len(WORKFLOW_BEGIN)
    end = readme.index(WORKFLOW_END, start)
    fenced = readme[start:end]
    if not fenced.startswith(b"```bash\n") or not fenced.endswith(b"\n```"):
        raise AssertionError("workflow markers must contain exactly one Bash fence")
    return fenced


def extract_workflow_body(readme: bytes) -> str:
    fenced = extract_fenced_workflow(readme)
    return fenced[len(b"```bash\n") : -len(b"\n```")].decode("utf-8")

SPEC = importlib.util.spec_from_file_location("strict_manifest", COMPARE_TOOL)
assert SPEC and SPEC.loader
MANIFEST_MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MANIFEST_MODULE
SPEC.loader.exec_module(MANIFEST_MODULE)


class DocumentedEvidenceWorkflowTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = extract_workflow_body(MIGRATION_TOOL_README.read_bytes())
        syntax = subprocess.run(
            ["bash", "-n"],
            input=cls.workflow,
            check=False,
            capture_output=True,
            text=True,
        )
        if syntax.returncode != 0:
            raise AssertionError(syntax.stderr)

        cls.class_directory = tempfile.TemporaryDirectory(
            prefix="documented-evidence-workflow."
        )
        cls.class_root = Path(cls.class_directory.name)
        cls.base_checkout = cls.class_root / "reviewed base checkout"
        clone = subprocess.run(
            ["git", "clone", "--quiet", "--shared", str(ROOT), str(cls.base_checkout)],
            check=False,
            capture_output=True,
            text=True,
        )
        if clone.returncode != 0:
            raise AssertionError(clone.stderr)
        shutil.copy2(
            MIGRATION_TOOL_README,
            cls.base_checkout / "scripts" / "migration" / "README.md",
        )
        for key, value in (
            ("user.name", "Synthetic Migration Test"),
            ("user.email", "migration-test@example.invalid"),
        ):
            subprocess.run(
                ["git", "config", key, value],
                cwd=cls.base_checkout,
                check=True,
                capture_output=True,
                text=True,
            )
        subprocess.run(
            ["git", "add", "scripts/migration/README.md"],
            cwd=cls.base_checkout,
            check=True,
            capture_output=True,
            text=True,
        )
        subprocess.run(
            ["git", "commit", "--quiet", "--allow-empty", "-m", "synthetic execution checkout"],
            cwd=cls.base_checkout,
            check=True,
            capture_output=True,
            text=True,
        )
        cls.execution_checkout_sha = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=cls.base_checkout,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()

    @classmethod
    def tearDownClass(cls):
        cls.class_directory.cleanup()

    def setUp(self):
        self.case_root = Path(
            tempfile.mkdtemp(prefix=f"{self._testMethodName}.", dir=self.class_root)
        )
        self.checkout = self.case_root / "checkout with spaces"
        subprocess.run(
            [
                "git",
                "clone",
                "--quiet",
                "--shared",
                str(self.base_checkout),
                str(self.checkout),
            ],
            check=True,
            capture_output=True,
            text=True,
        )

        self.canonical = (
            self.case_root / "encrypted evidence store" / "Lovable export.backup"
        )
        self.canonical.parent.mkdir()
        self.row_sentinel = "SYNTHETIC_ROW_PAYLOAD_MUST_NOT_APPEAR"
        self.canonical.write_bytes(
            b"PGDMP\x01\x0e\x00\x04\x08\x01" + self.row_sentinel.encode("ascii")
        )
        self.fake_log = self.case_root / "fake pg_restore calls.log"
        self.fake_log.write_text("", encoding="utf-8")
        self.fake_pg_restore = self.case_root / "fake pg_restore"
        self.fake_pg_restore.write_text(
            """#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  --version)
    [[ $# -eq 1 ]]
    printf '%s\\n' '--version' >>"$FAKE_LOG"
    printf 'pg_restore (PostgreSQL) 17.5 (synthetic)\\n'
    ;;
  --list)
    [[ $# -eq 2 ]]
    printf '%s|%s\\n' '--list' "$2" >>"$FAKE_LOG"
    cat -- "$FAKE_TOC"
    ;;
  *)
    printf 'unexpected pg_restore invocation: %s\\n' "$*" >&2
    exit 7
    ;;
esac
""",
            encoding="utf-8",
        )
        self.fake_pg_restore.chmod(0o700)
        self.environment = os.environ | {
            "SOURCE_PROJECT_NAME": "Synthetic Lovable rehearsal",
            "SOURCE_PROJECT_REF": "abcdefghijklmnopqrst",
            "EXPORT_INITIATED_AT_UTC": "2026-07-14T12:00:00Z",
            "EXPORT_COMPLETED_AT_UTC": "2026-07-14T12:05:00Z",
            "DOWNLOAD_COMPLETED_AT_UTC": "2026-07-14T12:06:00Z",
            "OPERATOR_IDENTITY": "synthetic-test-operator",
            "APPROVED_EXECUTION_CHECKOUT_SHA": self.execution_checkout_sha,
            "CANONICAL_EXPORT": str(self.canonical),
            "PG_RESTORE_BIN": str(self.fake_pg_restore),
            "PYTHON_BIN": sys.executable,
            "FAKE_LOG": str(self.fake_log),
            "FAKE_TOC": str(
                self.checkout
                / "scripts"
                / "migration"
                / "tests"
                / "fixtures"
                / "representative.toc"
            ),
        }

    @property
    def run_root(self) -> Path:
        return (
            self.checkout
            / "local-migration-artifacts"
            / "rehearsal-20260714T120000Z"
        )

    def run_workflow(
        self,
        *,
        environment: dict[str, str] | None = None,
        git_rev_parse_mode: str | None = None,
        unset_environment: set[str] | None = None,
    ) -> subprocess.CompletedProcess[str]:
        execution_environment = self.environment | (environment or {})
        for name in unset_environment or set():
            execution_environment.pop(name, None)
        if git_rev_parse_mode is not None:
            fake_bin = self.case_root / "fake git bin"
            fake_bin.mkdir()
            fake_git = fake_bin / "git"
            real_git = shutil.which("git")
            self.assertIsNotNone(real_git)
            fake_git.write_text(
                """#!/usr/bin/env bash
set -euo pipefail
if [[ $# -eq 2 && "$1" == 'rev-parse' && "$2" == 'HEAD' ]]; then
  case "$FAKE_GIT_REV_PARSE_MODE" in
    missing) exit 0 ;;
    malformed) printf 'not-a-commit-sha\\n'; exit 0 ;;
  esac
fi
exec "$REAL_GIT" "$@"
""",
                encoding="utf-8",
            )
            fake_git.chmod(0o700)
            execution_environment.update(
                {
                    "PATH": str(fake_bin) + os.pathsep + execution_environment["PATH"],
                    "REAL_GIT": str(real_git),
                    "FAKE_GIT_REV_PARSE_MODE": git_rev_parse_mode,
                }
            )
        workflow = extract_workflow_body(
            (self.checkout / "scripts" / "migration" / "README.md").read_bytes()
        )
        return subprocess.run(
            ["bash"],
            cwd=self.checkout,
            env=execution_environment,
            input=workflow,
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )

    def assert_guard_failure(
        self,
        expected: str,
        *,
        environment: dict[str, str] | None = None,
        git_rev_parse_mode: str | None = None,
        unset_environment: set[str] | None = None,
    ) -> None:
        canonical_sha = hashlib.sha256(self.canonical.read_bytes()).hexdigest()
        result = self.run_workflow(
            environment=environment,
            git_rev_parse_mode=git_rev_parse_mode,
            unset_environment=unset_environment,
        )
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn(expected, result.stderr)
        self.assertEqual(self.fake_log.read_text(encoding="utf-8"), "")
        self.assertFalse(self.run_root.exists())
        self.assertFalse((self.run_root / "provenance.json").exists())
        self.assertFalse(
            (self.run_root / "inspection" / "rehearsal-metadata.txt").exists()
        )
        self.assertEqual(
            hashlib.sha256(self.canonical.read_bytes()).hexdigest(), canonical_sha
        )

    def assert_workflow_success(
        self, *, environment: dict[str, str] | None = None
    ) -> dict[str, object]:
        result = self.run_workflow(environment=environment)
        self.assertEqual(result.returncode, 0, result.stderr)

        report = self.run_root / "inspection" / "rehearsal-metadata.txt"
        provenance_path = self.run_root / "provenance.json"
        before = self.run_root / "archive" / "archive.sha256.before"
        after = self.run_root / "archive" / "archive.sha256.after"
        report_sha_path = self.run_root / "inspection" / "report.sha256"
        for path in (report, provenance_path, before, after, report_sha_path):
            self.assertTrue(path.is_file(), path)

        archive_sha = hashlib.sha256(self.canonical.read_bytes()).hexdigest()
        report_sha = hashlib.sha256(report.read_bytes()).hexdigest()
        provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
        execution_sha = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=self.checkout,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        approved_sha = (self.environment | (environment or {}))[
            "APPROVED_EXECUTION_CHECKOUT_SHA"
        ]
        readme_blob_sha = subprocess.run(
            ["git", "rev-parse", f"{approved_sha}:scripts/migration/README.md"],
            cwd=self.checkout,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        approved_readme = subprocess.run(
            ["git", "show", f"{approved_sha}:scripts/migration/README.md"],
            cwd=self.checkout,
            check=True,
            capture_output=True,
        ).stdout
        workflow_sha256 = hashlib.sha256(
            extract_fenced_workflow(approved_readme)
        ).hexdigest()

        self.assertEqual(approved_sha, execution_sha)
        self.assertEqual(provenance["approved_execution_checkout_sha"], approved_sha)
        self.assertEqual(provenance["execution_checkout_sha"], execution_sha)
        self.assertEqual(provenance["procedure_origin_sha"], PROCEDURE_ORIGIN_SHA)
        self.assertEqual(provenance["procedure_readme_blob_sha"], readme_blob_sha)
        self.assertEqual(provenance["procedure_workflow_sha256"], workflow_sha256)
        self.assertEqual(
            hashlib.sha256(
                extract_fenced_workflow(
                    (
                        self.checkout
                        / "scripts"
                        / "migration"
                        / "README.md"
                    ).read_bytes()
                )
            ).hexdigest(),
            workflow_sha256,
        )
        self.assertEqual(provenance["inspection_tool_git_sha"], INSPECTION_TOOL_SHA)
        self.assertNotIn("evidence_procedure_git_sha", provenance)
        self.assertNotIn("reviewed_git_sha", provenance)
        self.assertEqual(provenance["inspection_tool"]["git_sha"], INSPECTION_TOOL_SHA)
        self.assertEqual(
            provenance["export"]["sha256_evidence"],
            {
                "external_after": archive_sha,
                "external_before": archive_sha,
                "inspector_report": archive_sha,
            },
        )
        self.assertEqual(before.read_text().strip(), archive_sha)
        self.assertEqual(after.read_text().strip(), archive_sha)
        self.assertEqual(report_sha_path.read_text().strip(), report_sha)
        self.assertEqual(provenance["report"]["sha256"], report_sha)
        self.assertNotIn(self.row_sentinel, report.read_text(encoding="utf-8"))

        calls = self.fake_log.read_text(encoding="utf-8").splitlines()
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0], "--version")
        self.assertRegex(
            calls[1],
            r"^--list\|.*/lovable-dump-inspection\.[^/]+/archive\.snapshot$",
        )
        self.assertNotIn(str(self.canonical), calls[1])
        self.assertNotIn(str(self.run_root / "archive" / self.canonical.name), calls[1])
        return provenance

    def test_complete_documented_workflow_runs_end_to_end(self):
        self.assert_workflow_success()

    def test_rejects_untracked_migration_before_inspection(self):
        untracked = self.checkout / "supabase" / "migrations" / "999999_untracked.sql"
        untracked.write_text("select 1;\n", encoding="utf-8")
        self.assert_guard_failure("untracked files under supabase/migrations")

    def test_rejects_ignored_untracked_migration_before_inspection(self):
        relative = "supabase/migrations/999998_ignored.sql"
        exclude = self.checkout / ".git" / "info" / "exclude"
        with exclude.open("a", encoding="utf-8") as destination:
            destination.write(relative + "\n")
        ignored = self.checkout / relative
        ignored.write_text("select 1;\n", encoding="utf-8")
        self.assert_guard_failure("ignored files under supabase/migrations")

    def test_rejects_modified_inspector_before_inspection(self):
        inspector = self.checkout / "scripts" / "migration" / "inspect-lovable-dump.sh"
        inspector.write_text(inspector.read_text() + "\n# planted modification\n")
        self.assert_guard_failure("inspection tool/input tree differs")

    def test_rejects_modified_helper_before_inspection(self):
        helper = (
            self.checkout / "scripts" / "migration" / "lib" / "lovable_dump_report.py"
        )
        helper.write_text(helper.read_text() + "\n# planted modification\n")
        self.assert_guard_failure("inspection tool/input tree differs")

    def test_rejects_modified_tracked_migration_before_inspection(self):
        migration = next((self.checkout / "supabase" / "migrations").glob("*.sql"))
        migration.write_text(migration.read_text() + "\n-- planted modification\n")
        self.assert_guard_failure("inspection tool/input tree differs")

    def test_rejects_modified_evidence_procedure_before_inspection(self):
        readme = self.checkout / "scripts" / "migration" / "README.md"
        readme.write_text(readme.read_text() + "\nplanted modification\n")
        self.assert_guard_failure("evidence procedure differs from the execution checkout")

    def test_requires_external_approved_checkout_before_inspection(self):
        self.assert_guard_failure(
            "APPROVED_EXECUTION_CHECKOUT_SHA is required from external approval",
            unset_environment={"APPROVED_EXECUTION_CHECKOUT_SHA"},
        )

    def test_rejects_empty_approved_checkout_before_inspection(self):
        self.assert_guard_failure(
            "APPROVED_EXECUTION_CHECKOUT_SHA is required from external approval",
            environment={"APPROVED_EXECUTION_CHECKOUT_SHA": ""},
        )

    def test_rejects_malformed_approved_checkout_before_inspection(self):
        self.assert_guard_failure(
            "APPROVED_EXECUTION_CHECKOUT_SHA must be a full lowercase commit SHA",
            environment={"APPROVED_EXECUTION_CHECKOUT_SHA": "not-a-commit"},
        )

    def test_rejects_unavailable_approved_checkout_before_inspection(self):
        self.assert_guard_failure(
            "APPROVED_EXECUTION_CHECKOUT_SHA does not identify an available commit",
            environment={"APPROVED_EXECUTION_CHECKOUT_SHA": "0" * 40},
        )

    def test_rejects_wrong_tool_sha_before_inspection(self):
        self.assert_guard_failure(
            "unexpected inspection tool Git SHA",
            environment={"INSPECTION_TOOL_GIT_SHA": PROCEDURE_ORIGIN_SHA},
        )

    def test_committed_descendant_requires_its_exact_external_approval(self):
        prior_checkout_sha = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=self.checkout,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        self.assertEqual(prior_checkout_sha, self.execution_checkout_sha)

        readme = self.checkout / "scripts" / "migration" / "README.md"
        original = readme.read_bytes()
        needle = b"```bash\nset -euo pipefail\numask 077\n"
        replacement = needle + b"# synthetic committed descendant\n"
        self.assertEqual(original.count(needle), 1)
        readme.write_bytes(original.replace(needle, replacement, 1))
        subprocess.run(
            ["git", "add", "scripts/migration/README.md"],
            cwd=self.checkout,
            check=True,
            capture_output=True,
            text=True,
        )
        subprocess.run(
            [
                "git",
                "-c",
                "user.name=Synthetic Migration Test",
                "-c",
                "user.email=migration-test@example.invalid",
                "commit",
                "--quiet",
                "-m",
                "synthetic committed descendant",
            ],
            cwd=self.checkout,
            check=True,
            capture_output=True,
            text=True,
        )
        descendant_sha = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=self.checkout,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        self.assertNotEqual(descendant_sha, prior_checkout_sha)
        subprocess.run(
            ["git", "merge-base", "--is-ancestor", prior_checkout_sha, descendant_sha],
            cwd=self.checkout,
            check=True,
            capture_output=True,
            text=True,
        )
        self.assertEqual(
            subprocess.run(
                ["git", "status", "--porcelain"],
                cwd=self.checkout,
                check=True,
                capture_output=True,
                text=True,
            ).stdout,
            "",
        )

        self.assert_guard_failure(
            "approved execution checkout SHA does not match HEAD",
            environment={"APPROVED_EXECUTION_CHECKOUT_SHA": prior_checkout_sha},
        )
        provenance = self.assert_workflow_success(
            environment={"APPROVED_EXECUTION_CHECKOUT_SHA": descendant_sha}
        )
        self.assertEqual(
            provenance["approved_execution_checkout_sha"], descendant_sha
        )
        self.assertEqual(provenance["execution_checkout_sha"], descendant_sha)

    def test_rejects_missing_execution_checkout_sha_before_inspection(self):
        self.assert_guard_failure(
            "EXECUTION_CHECKOUT_SHA must be a full lowercase commit SHA",
            git_rev_parse_mode="missing",
        )

    def test_rejects_malformed_execution_checkout_sha_before_inspection(self):
        self.assert_guard_failure(
            "EXECUTION_CHECKOUT_SHA must be a full lowercase commit SHA",
            git_rev_parse_mode="malformed",
        )


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
