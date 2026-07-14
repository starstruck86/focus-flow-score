from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
README = ROOT / "scripts" / "migration" / "README.md"
WORKFLOW_LABEL = b"LOVABLE EXPORT EVIDENCE WORKFLOW"
WORKFLOW_BEGIN = b"<!-- BEGIN " + WORKFLOW_LABEL + b" -->\n"
WORKFLOW_END = b"\n<!-- END " + WORKFLOW_LABEL + b" -->"
INSPECTION_TOOL_SHA = "c87a124602eb669b3ec5a3829610c6cb465d3e26"
PROCEDURE_ORIGIN_SHA = "e4eed4a21049d274738110710a468e265c2893d2"

DRIVER_SPEC = importlib.util.spec_from_file_location(
    "lovable_export_inspection_driver",
    ROOT / "scripts" / "migration" / "inspect-lovable-export.py",
)
assert DRIVER_SPEC and DRIVER_SPEC.loader
DRIVER = importlib.util.module_from_spec(DRIVER_SPEC)
sys.modules[DRIVER_SPEC.name] = DRIVER
DRIVER_SPEC.loader.exec_module(DRIVER)


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


def git_output(checkout: Path, *arguments: str) -> str:
    return subprocess.run(
        ["git", *arguments],
        cwd=checkout,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


class DocumentedExportEvidenceWorkflowTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        workflow = extract_workflow_body(README.read_bytes())
        syntax = subprocess.run(
            ["bash", "-n"],
            input=workflow,
            check=False,
            capture_output=True,
            text=True,
        )
        if syntax.returncode != 0:
            raise AssertionError(syntax.stderr)

        cls.class_directory = tempfile.TemporaryDirectory(
            prefix="documented-export-evidence-workflow."
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

        for relative in (
            "scripts/migration/README.md",
            "scripts/migration/inspect-lovable-export.py",
            "scripts/migration/normalize-lovable-export.py",
        ):
            destination = cls.base_checkout / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / relative, destination)
        subprocess.run(
            ["git", "add", "scripts/migration/README.md", "scripts/migration/inspect-lovable-export.py", "scripts/migration/normalize-lovable-export.py"],
            cwd=cls.base_checkout,
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
                "--allow-empty",
                "-m",
                "synthetic approved execution checkout",
            ],
            cwd=cls.base_checkout,
            check=True,
            capture_output=True,
            text=True,
        )
        cls.execution_checkout_sha = git_output(cls.base_checkout, "rev-parse", "HEAD")

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
        self.row_sentinel = "SYNTHETIC_ROW_PAYLOAD_MUST_NOT_APPEAR"
        self.inner_bytes = (
            b"PGDMP\x01\x0e\x00\x04\x08\x01" + self.row_sentinel.encode("ascii")
        )
        self.canonical = (
            self.case_root / "encrypted evidence store" / "Synthetic export envelope.zip"
        )
        self.canonical.parent.mkdir()
        with zipfile.ZipFile(
            self.canonical, "w", compression=zipfile.ZIP_DEFLATED
        ) as archive:
            member = zipfile.ZipInfo("synthetic-export.backup")
            member.compress_type = zipfile.ZIP_DEFLATED
            member.create_system = 3
            member.external_attr = (stat.S_IFREG | 0o600) << 16
            archive.writestr(member, self.inner_bytes)

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
    case "${FAKE_MODE:-ok}" in
      fail-list)
        printf 'synthetic list failure\\n' >&2
        exit 9
        ;;
      mutate-canonical)
        chmod u+w "$CANONICAL_EXPORT"
        printf 'X' >>"$CANONICAL_EXPORT"
        ;;
      mutate-procedure)
        printf '\n# planted mid-run mutation\n' >>"$MUTATE_PATH"
        ;;
      plant-evidence-collision)
        mkdir -p -- "$COLLISION_PATH"
        ;;
    esac
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
            "UI_EXPORT_OBJECT_NAME": "synthetic_ui_export_object",
            "OPERATOR_IDENTITY": "synthetic-test-operator",
            "EXPORT_EVIDENCE_PROFILE": "retained_rehearsal_missing_initiation",
            "CANONICAL_EXPORT": str(self.canonical),
            "APPROVED_EXECUTION_CHECKOUT_SHA": self.execution_checkout_sha,
            "PG_RESTORE_BIN": str(self.fake_pg_restore),
            "FAKE_LOG": str(self.fake_log),
            "FAKE_TOC": str(
                self.checkout
                / "scripts"
                / "migration"
                / "tests"
                / "fixtures"
                / "representative.toc"
            ),
            "EXPORT_INITIATED_BASIS": "not_observed",
            "EXPORT_INITIATED_REASON": "synthetic initiation was not observed",
            "EXPORT_COMPLETED_BASIS": "not_observed",
            "EXPORT_COMPLETED_REASON": "synthetic completion was not observed",
            "EXPORT_AVAILABLE_AT_UTC": "2030-01-02T03:04:05Z",
            "DOWNLOAD_COMPLETED_AT_UTC": "2030-01-02T03:05:06Z",
        }

    def run_root(
        self,
        *,
        canonical: Path | None = None,
        environment: dict[str, str] | None = None,
    ) -> Path:
        merged = self.environment | (environment or {})
        source = canonical or Path(merged["CANONICAL_EXPORT"])
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        available = merged["EXPORT_AVAILABLE_AT_UTC"].replace("-", "").replace(":", "")
        return (
            self.checkout
            / "local-migration-artifacts"
            / f"rehearsal-{available}-{digest[:12]}"
        )

    def run_workflow(
        self,
        *,
        environment: dict[str, str] | None = None,
        unset_environment: set[str] | None = None,
        timeout: int = 30,
    ) -> subprocess.CompletedProcess[str]:
        execution_environment = self.environment | (environment or {})
        for name in unset_environment or set():
            execution_environment.pop(name, None)
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
            timeout=timeout,
        )

    def assert_no_runs(self):
        workspace = self.checkout / "local-migration-artifacts"
        runs = list(workspace.glob("rehearsal-*")) if workspace.exists() else []
        self.assertEqual(runs, [])

    def assert_preflight_failure(
        self,
        expected: str,
        *,
        environment: dict[str, str] | None = None,
        unset_environment: set[str] | None = None,
    ):
        result = self.run_workflow(
            environment=environment, unset_environment=unset_environment
        )
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn(expected, result.stderr)
        self.assertEqual(self.fake_log.read_text(encoding="utf-8"), "")
        self.assert_no_runs()

    def assert_success(
        self, *, environment: dict[str, str] | None = None
    ) -> tuple[dict[str, object], subprocess.CompletedProcess[str], Path]:
        expected_root = self.run_root(environment=environment)
        result = self.run_workflow(environment=environment)
        self.assertEqual(result.returncode, 0, result.stderr)
        evidence = expected_root / "evidence"
        self.assertTrue((evidence / "EVIDENCE_COMPLETE").is_file())
        report = evidence / "inspection" / "rehearsal-metadata.txt"
        report_sha_file = evidence / "inspection" / "report.sha256"
        provenance_path = evidence / "provenance.json"
        provenance_sha_file = evidence / "provenance.sha256"
        before_file = evidence / "archive" / "outer.sha256.before"
        after_file = evidence / "archive" / "outer.sha256.after"
        for path in (
            report,
            report_sha_file,
            provenance_path,
            provenance_sha_file,
            before_file,
            after_file,
        ):
            self.assertTrue(path.is_file(), path)
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o400)

        provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
        outer_sha = hashlib.sha256(self.canonical.read_bytes()).hexdigest()
        inner_sha = hashlib.sha256(self.inner_bytes).hexdigest()
        report_sha = hashlib.sha256(report.read_bytes()).hexdigest()
        provenance_sha = hashlib.sha256(provenance_path.read_bytes()).hexdigest()
        zip_mode = self.canonical.suffix == ".zip"
        if zip_mode:
            self.assertNotEqual(outer_sha, inner_sha)
        else:
            self.assertEqual(outer_sha, inner_sha)
        self.assertEqual(before_file.read_text().strip(), outer_sha)
        self.assertEqual(after_file.read_text().strip(), outer_sha)
        self.assertEqual(report_sha_file.read_text().strip(), report_sha)
        self.assertEqual(provenance_sha_file.read_text().strip(), provenance_sha)
        self.assertEqual(
            set(provenance["outer_artifact"]["sha256_evidence"].values()),
            {outer_sha},
        )
        self.assertEqual(provenance["inner_pgdmp"]["sha256"], inner_sha)
        self.assertEqual(
            provenance["inner_pgdmp"]["inspector_reported_sha256"], inner_sha
        )
        self.assertEqual(provenance["report"]["sha256"], report_sha)
        if zip_mode:
            self.assertEqual(provenance["zip_envelope"]["entry_count"], 1)
            self.assertEqual(
                provenance["archive_member"]["name"], "synthetic-export.backup"
            )
        else:
            self.assertIsNone(provenance["zip_envelope"])
            self.assertIsNone(provenance["archive_member"])
        self.assertEqual(provenance["inspection_status"], "REVIEW_REQUIRED")
        self.assertEqual(provenance["export_timeline_status"], "INCOMPLETE")
        self.assertEqual(
            provenance["export_evidence_profile"],
            "retained_rehearsal_missing_initiation",
        )
        self.assertEqual(provenance["run_id"], expected_root.name)
        self.assertEqual(
            provenance["export_timeline"]["initiated_at_utc"],
            {
                "value": None,
                "basis": "not_observed",
                "reason": "synthetic initiation was not observed",
            },
        )
        self.assertEqual(
            provenance["export_timeline"]["completed_at_utc"]["value"], None
        )
        self.assertEqual(
            provenance["export_timeline"]["available_at_utc"]["value"],
            "2030-01-02T03:04:05Z",
        )
        self.assertFalse(provenance["export_timeline"]["time_inference_used"])
        self.assertEqual(
            provenance["approved_execution_checkout_sha"],
            provenance["execution_checkout_sha"],
        )
        self.assertEqual(provenance["procedure_origin_sha"], PROCEDURE_ORIGIN_SHA)
        self.assertEqual(provenance["inspection_tool_git_sha"], INSPECTION_TOOL_SHA)

        report_text = report.read_text(encoding="utf-8")
        self.assertIn(f"sha256: {inner_sha}", report_text)
        if zip_mode:
            self.assertNotIn(f"sha256: {outer_sha}", report_text)
        all_evidence_text = result.stdout + result.stderr
        for path in evidence.rglob("*"):
            if path.is_file():
                all_evidence_text += path.read_text(encoding="utf-8")
        self.assertNotIn(self.row_sentinel, all_evidence_text)
        self.assertFalse((evidence / ".working").exists())
        self.assertFalse((evidence / ".derived").exists())

        calls = self.fake_log.read_text(encoding="utf-8").splitlines()
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0], "--version")
        self.assertRegex(
            calls[1],
            r"^--list\|.*/lovable-dump-inspection\.[^/]+/archive\.snapshot$",
        )
        return provenance, result, expected_root

    def test_pre_copy_headroom_and_growing_outer_fail_before_publication(self):
        with self.assertRaisesRegex(
            DRIVER.WorkflowError, "insufficient workspace headroom"
        ):
            DRIVER.ensure_pre_copy_headroom(
                self.case_root,
                1024,
                free_bytes_probe=lambda _path: 0,
            )

        source = self.case_root / "growing synthetic outer"
        source.write_bytes(b"x" * (2 * 1024 * 1024))
        expected_size = source.stat().st_size
        expected_sha = hashlib.sha256(source.read_bytes()).hexdigest()
        destination = self.case_root / "capture" / "canonical-outer.artifact"
        real_read = os.read
        calls = 0

        def grow_after_first_read(descriptor: int, length: int) -> bytes:
            nonlocal calls
            data = real_read(descriptor, length)
            calls += 1
            if calls == 1:
                with source.open("ab") as output:
                    output.write(b"growth")
                    output.flush()
                    os.fsync(output.fileno())
            return data

        with mock.patch.object(DRIVER.os, "read", side_effect=grow_after_first_read):
            with self.assertRaisesRegex(DRIVER.WorkflowError, "grew|byte length"):
                DRIVER.copy_regular_snapshot(
                    source,
                    destination,
                    expected_sha,
                    expected_size,
                )
        self.assertFalse(destination.exists())
        self.assertFalse(destination.with_name(destination.name + ".partial").exists())

        incomplete = self.case_root / "incomplete evidence run"
        incomplete.mkdir()
        with self.assertRaisesRegex(
            DRIVER.WorkflowError, "failed to remove incomplete evidence run"
        ):
            DRIVER.remove_incomplete_run(incomplete, remover=lambda _path: None)
        self.assertTrue(incomplete.is_dir())
        shutil.rmtree(incomplete)

    def test_zip_workflow_separates_outer_inner_report_and_provenance_hashes(self):
        provenance, _, _ = self.assert_success()
        self.assertEqual(
            provenance["outer_artifact"]["original_filename"], self.canonical.name
        )
        self.assertEqual(
            provenance["outer_artifact"]["ui_observed_export_object_name"],
            "synthetic_ui_export_object",
        )
        self.assertFalse(provenance["outer_artifact"]["working_copy_retained_in_evidence"])
        self.assertFalse(provenance["inner_pgdmp"]["retained_in_evidence"])

    def test_direct_pgdmp_workflow_remains_supported(self):
        self.canonical.unlink()
        self.canonical = self.canonical.with_suffix(".backup")
        self.canonical.write_bytes(self.inner_bytes)
        self.environment["CANONICAL_EXPORT"] = str(self.canonical)
        provenance, _, _ = self.assert_success()
        digest = hashlib.sha256(self.inner_bytes).hexdigest()
        self.assertIsNone(provenance["zip_envelope"])
        self.assertIsNone(provenance["archive_member"])
        self.assertEqual(
            provenance["inner_pgdmp"]["relationship_to_outer"],
            "byte_copy_of_direct_pgdmp",
        )
        self.assertEqual(
            set(provenance["outer_artifact"]["sha256_evidence"].values()),
            {digest},
        )

    def test_missing_initiation_requires_explicit_basis_and_reason(self):
        self.assert_preflight_failure(
            "EXPORT_INITIATED_BASIS must be operator_observed or not_observed",
            environment={"EXPORT_INITIATED_BASIS": "unknown"},
        )
        self.assert_preflight_failure(
            "EXPORT_INITIATED_REASON is required",
            environment={"EXPORT_INITIATED_REASON": ""},
        )
        self.assert_preflight_failure(
            "EXPORT_INITIATED_AT_UTC must be empty",
            environment={"EXPORT_INITIATED_AT_UTC": "2030-01-02T03:00:00Z"},
        )
        self.assert_preflight_failure(
            "retained rehearsal profile requires unobserved initiation",
            environment={
                "EXPORT_INITIATED_BASIS": "operator_observed",
                "EXPORT_INITIATED_AT_UTC": "2030-01-02T03:00:00Z",
                "EXPORT_INITIATED_REASON": "",
            },
        )
        for profile in ("future_rehearsal", "final_cutover"):
            with self.subTest(profile=profile):
                self.assert_preflight_failure(
                    "future/final export profiles require operator-observed initiation",
                    environment={"EXPORT_EVIDENCE_PROFILE": profile},
                )

        observed_environment = {
            "EXPORT_INITIATED_BASIS": "operator_observed",
            "EXPORT_INITIATED_AT_UTC": "2030-01-02T03:00:00Z",
            "EXPORT_INITIATED_REASON": "",
            "EXPORT_COMPLETED_BASIS": "not_observed",
            "EXPORT_COMPLETED_AT_UTC": "",
            "EXPORT_COMPLETED_REASON": "synthetic completion was not observed",
            "EXPORT_AVAILABLE_AT_UTC": "2030-01-02T03:04:05Z",
            "DOWNLOAD_COMPLETED_AT_UTC": "2030-01-02T03:05:06Z",
        }
        with mock.patch.dict(os.environ, observed_environment, clear=False):
            timeline, _, status = DRIVER.build_timeline("future_rehearsal")
        self.assertEqual(
            timeline["initiated_at_utc"],
            {"value": "2030-01-02T03:00:00Z", "basis": "operator_observed"},
        )
        self.assertEqual(status, "INCOMPLETE")

    def test_availability_is_not_completion_and_order_is_enforced(self):
        provenance, _, _ = self.assert_success()
        self.assertIsNone(
            provenance["export_timeline"]["completed_at_utc"]["value"]
        )
        self.assertNotEqual(
            provenance["export_timeline"]["completed_at_utc"],
            provenance["export_timeline"]["available_at_utc"],
        )

        # Use a fresh checkout because the successful run is intentionally immutable.
        self.tearDown()
        self.setUp()
        self.assert_preflight_failure(
            "export availability must not follow download completion",
            environment={"DOWNLOAD_COMPLETED_AT_UTC": "2030-01-02T03:04:04Z"},
        )

    def test_inspector_failure_leaves_no_derived_report_or_provenance(self):
        expected_root = self.run_root()
        result = self.run_workflow(environment={"FAKE_MODE": "fail-list"})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("inner PGDMP metadata inspection failed closed", result.stderr)
        self.assertFalse(expected_root.exists())
        self.assertEqual(
            [line.split("|", 1)[0] for line in self.fake_log.read_text().splitlines()],
            ["--version", "--list"],
        )

    def test_partial_normalization_failure_publishes_no_evidence(self):
        corrupted = bytearray(self.canonical.read_bytes())
        central_offset = corrupted.index(b"PK\x01\x02")
        corrupted[14:18] = b"\x00\x00\x00\x00"
        corrupted[central_offset + 16 : central_offset + 20] = b"\x00\x00\x00\x00"
        self.canonical.write_bytes(corrupted)
        expected_root = self.run_root()
        result = self.run_workflow()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("normalization failed closed", result.stderr)
        self.assertFalse(expected_root.exists())
        self.assertEqual(self.fake_log.read_text(), "")

    def test_canonical_mutation_removes_every_pending_output(self):
        expected_root = self.run_root()
        result = self.run_workflow(environment={"FAKE_MODE": "mutate-canonical"})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("outer artifact", result.stderr)
        self.assertFalse(expected_root.exists())

    def test_mid_run_tool_mutation_fails_final_provenance_revalidation(self):
        expected_root = self.run_root()
        result = self.run_workflow(
            environment={
                "FAKE_MODE": "mutate-procedure",
                "MUTATE_PATH": str(
                    self.checkout / "scripts/migration/normalize-lovable-export.py"
                ),
            }
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("execution procedure differs", result.stderr)
        self.assertFalse(expected_root.exists())
        self.assertEqual(len(self.fake_log.read_text().splitlines()), 2)

    def test_symlink_input_is_rejected_before_run_creation_or_pg_restore(self):
        backing = self.canonical.with_name("backing envelope.zip")
        self.canonical.rename(backing)
        self.canonical.symlink_to(backing)
        result = self.run_workflow()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("non-symlink local file", result.stderr)
        self.assertEqual(self.fake_log.read_text(), "")
        self.assert_no_runs()

    def test_canonical_inside_worktree_is_rejected_before_run_creation(self):
        inside = self.checkout / "local-migration-artifacts" / "canonical.zip"
        inside.parent.mkdir(mode=0o700)
        inside.write_bytes(self.canonical.read_bytes())
        self.assert_preflight_failure(
            "must be retained outside the Git worktree",
            environment={"CANONICAL_EXPORT": str(inside)},
        )

    def test_existing_run_is_never_overwritten(self):
        _, _, run_root = self.assert_success()
        provenance_before = (run_root / "evidence" / "provenance.json").read_bytes()
        calls_before = self.fake_log.read_text()
        result = self.run_workflow()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("evidence run already exists", result.stderr)
        self.assertEqual(
            (run_root / "evidence" / "provenance.json").read_bytes(), provenance_before
        )
        self.assertEqual(self.fake_log.read_text(), calls_before)

    def test_mid_run_evidence_collision_is_never_overwritten(self):
        run_root = self.run_root()
        result = self.run_workflow(
            environment={
                "FAKE_MODE": "plant-evidence-collision",
                "COLLISION_PATH": str(run_root / "evidence"),
            }
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("evidence output already exists", result.stderr)
        self.assertFalse(run_root.exists())
        self.assertEqual(len(self.fake_log.read_text().splitlines()), 2)

    def test_checkout_and_migration_guards_fail_before_inspection(self):
        self.assert_preflight_failure(
            "required from external approval",
            unset_environment={"APPROVED_EXECUTION_CHECKOUT_SHA"},
        )

        normalizer = self.checkout / "scripts/migration/normalize-lovable-export.py"
        normalizer.write_text(normalizer.read_text() + "\n# planted modification\n")
        self.assert_preflight_failure("execution procedure differs")

        self.tearDown()
        self.setUp()
        inspector = self.checkout / "scripts/migration/inspect-lovable-dump.sh"
        inspector.write_text(inspector.read_text() + "\n# planted modification\n")
        self.assert_preflight_failure("inspection tool/input tree differs")

        self.tearDown()
        self.setUp()
        helper = self.checkout / "scripts/migration/lib/lovable_dump_report.py"
        helper.write_text(helper.read_text() + "\n# planted modification\n")
        self.assert_preflight_failure("inspection tool/input tree differs")

        self.tearDown()
        self.setUp()
        tracked_migration = next(
            (self.checkout / "supabase/migrations").glob("*.sql")
        )
        tracked_migration.write_text(
            tracked_migration.read_text() + "\n-- planted modification\n"
        )
        self.assert_preflight_failure("inspection tool/input tree differs")

        self.tearDown()
        self.setUp()
        untracked = self.checkout / "supabase/migrations/999999_untracked.sql"
        untracked.write_text("select 1;\n", encoding="utf-8")
        self.assert_preflight_failure("untracked files under supabase/migrations")

        self.tearDown()
        self.setUp()
        relative = "supabase/migrations/999998_ignored.sql"
        with (self.checkout / ".git/info/exclude").open("a", encoding="utf-8") as output:
            output.write(relative + "\n")
        (self.checkout / relative).write_text("select 1;\n", encoding="utf-8")
        self.assert_preflight_failure("ignored files under supabase/migrations")

    def test_wrong_tool_and_approval_pins_fail_before_inspection(self):
        self.assert_preflight_failure(
            "unexpected inspection tool Git SHA",
            environment={"INSPECTION_TOOL_GIT_SHA": PROCEDURE_ORIGIN_SHA},
        )
        self.assert_preflight_failure(
            "must be a full lowercase commit SHA",
            environment={"APPROVED_EXECUTION_CHECKOUT_SHA": "not-a-sha"},
        )
        self.assert_preflight_failure(
            "does not identify an available commit",
            environment={"APPROVED_EXECUTION_CHECKOUT_SHA": "0" * 40},
        )

    def test_committed_descendant_requires_exact_external_approval(self):
        prior_sha = git_output(self.checkout, "rev-parse", "HEAD")
        readme = self.checkout / "scripts/migration/README.md"
        original = readme.read_bytes()
        needle = b"```bash\nset -euo pipefail\n"
        self.assertEqual(original.count(needle), 1)
        readme.write_bytes(original.replace(needle, needle + b"# descendant\n", 1))
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
        descendant_sha = git_output(self.checkout, "rev-parse", "HEAD")
        self.assertNotEqual(prior_sha, descendant_sha)
        self.assert_preflight_failure("approved execution checkout SHA does not match HEAD")
        provenance, _, _ = self.assert_success(
            environment={"APPROVED_EXECUTION_CHECKOUT_SHA": descendant_sha}
        )
        readme_blob = git_output(
            self.checkout, "rev-parse", "HEAD:scripts/migration/README.md"
        )
        workflow_sha = hashlib.sha256(
            extract_fenced_workflow(readme.read_bytes())
        ).hexdigest()
        self.assertEqual(provenance["procedure_readme_blob_sha"], readme_blob)
        self.assertEqual(provenance["procedure_workflow_sha256"], workflow_sha)


if __name__ == "__main__":
    unittest.main()
