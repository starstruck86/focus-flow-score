from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import types
import unittest
import zipfile
from contextlib import redirect_stderr
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
README = ROOT / "scripts" / "migration" / "README.md"
WORKFLOW_LABEL = b"LOVABLE EXPORT EVIDENCE WORKFLOW"
WORKFLOW_BEGIN = b"<!-- BEGIN " + WORKFLOW_LABEL + b" -->\n"
WORKFLOW_END = b"\n<!-- END " + WORKFLOW_LABEL + b" -->"
INSPECTION_BASELINE_SHA = "c87a124602eb669b3ec5a3829610c6cb465d3e26"
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
            "scripts/migration/bounded-pg-restore.py",
            "scripts/migration/inspect-lovable-dump.sh",
            "scripts/migration/inspect-lovable-export.py",
            "scripts/migration/normalize-lovable-export.py",
        ):
            destination = cls.base_checkout / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / relative, destination)
        config = cls.base_checkout / "supabase/config.toml"
        config.write_text(
            re.sub(
                r'^project_id\s*=\s*"[a-z0-9]{20}"',
                'project_id = "abcdefghijklmnopqrst"',
                config.read_text(encoding="utf-8"),
                count=1,
                flags=re.MULTILINE,
            ),
            encoding="utf-8",
        )
        subprocess.run(
            [
                "git",
                "add",
                "scripts/migration/README.md",
                "scripts/migration/bounded-pg-restore.py",
                "scripts/migration/inspect-lovable-dump.sh",
                "scripts/migration/inspect-lovable-export.py",
                "scripts/migration/normalize-lovable-export.py",
                "supabase/config.toml",
            ],
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
        ).resolve()
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
        self.child_secret_sentinel = "SYNTHETIC_CHILD_SECRET_MUST_NOT_APPEAR"
        self.inner_bytes = (
            b"PGDMP\x01\x0e\x00\x04\x08\x01" + self.row_sentinel.encode("ascii")
        )
        self.evidence_store = self.case_root / "encrypted evidence store"
        self.evidence_store.mkdir(mode=0o700)
        self.canonical = self.evidence_store / "Synthetic export envelope.zip"
        with zipfile.ZipFile(
            self.canonical, "w", compression=zipfile.ZIP_DEFLATED
        ) as archive:
            member = zipfile.ZipInfo("synthetic-export.backup")
            member.compress_type = zipfile.ZIP_DEFLATED
            member.create_system = 3
            member.external_attr = (stat.S_IFREG | 0o600) << 16
            archive.writestr(member, self.inner_bytes)
        self.canonical.chmod(0o400)

        self.fake_log = self.case_root / "fake pg_restore calls.log"
        self.fake_log.write_text("", encoding="utf-8")
        self.fake_control = self.case_root / "fake pg_restore control.txt"
        self.fake_toc = self.case_root / "fake pg_restore toc.txt"
        shutil.copy2(
            self.checkout
            / "scripts"
            / "migration"
            / "tests"
            / "fixtures"
            / "representative.toc",
            self.fake_toc,
        )
        self.fake_pg_restore = self.case_root / "fake pg_restore"
        self.fake_pg_restore.write_text(
            """#!/usr/bin/env bash
set -euo pipefail
fake_root="$(cd -P -- "$(dirname -- "$0")" && pwd)"
fake_log="${fake_root}/fake pg_restore calls.log"
fake_toc="${fake_root}/fake pg_restore toc.txt"
fake_control="${fake_root}/fake pg_restore control.txt"
mode="$(sed -n '1p' "$fake_control")"
canonical_export="$(sed -n '2p' "$fake_control")"
mutate_path="$(sed -n '3p' "$fake_control")"
collision_path="$(sed -n '4p' "$fake_control")"
case "${1:-}" in
  --version)
    [[ $# -eq 1 ]]
    printf '%s\\n' '--version' >>"$fake_log"
    printf 'pg_restore (PostgreSQL) 17.5 (synthetic)\\n'
    ;;
  --list)
    [[ $# -eq 2 ]]
    printf '%s|%s\\n' '--list' "$2" >>"$fake_log"
    case "$mode" in
      fail-list)
        printf '%s\\n' 'SYNTHETIC_CHILD_SECRET_MUST_NOT_APPEAR'
        printf '%s\\n' 'SYNTHETIC_CHILD_SECRET_MUST_NOT_APPEAR' >&2
        exit 9
        ;;
      mutate-canonical)
        chmod u+w "$canonical_export"
        printf 'X' >>"$canonical_export"
        ;;
      mutate-procedure)
        printf '\n# planted mid-run mutation\n' >>"$mutate_path"
        ;;
      plant-evidence-collision)
        mkdir -p -- "$collision_path"
        ;;
    esac
    cat -- "$fake_toc"
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
            "UI_EXPORT_OBJECT_NAME": "synthetic-export.backup",
            "OPERATOR_IDENTITY": "synthetic-test-operator",
            "EXPORT_EVIDENCE_PROFILE": "retained_rehearsal_missing_initiation",
            "CANONICAL_EXPORT": str(self.canonical),
            "APPROVED_EVIDENCE_STORE_ROOT": str(self.evidence_store),
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
            "CHILD_SECRET_SENTINEL": self.child_secret_sentinel,
            "EXPORT_INITIATED_BASIS": "not_observed",
            "EXPORT_INITIATED_REASON": "synthetic initiation was not observed",
            "EXPORT_COMPLETED_BASIS": "not_observed",
            "EXPORT_COMPLETED_REASON": "synthetic completion was not observed",
            "EXPORT_AVAILABLE_AT_UTC": "2030-01-02T03:04:05Z",
            "DOWNLOAD_COMPLETED_AT_UTC": "2030-01-02T03:05:06Z",
        }
        self.refresh_expected_identity()

    def refresh_expected_identity(self):
        self.environment.update(
            {
                "EXPECTED_OUTER_SHA256": hashlib.sha256(
                    self.canonical.read_bytes()
                ).hexdigest(),
                "EXPECTED_OUTER_SIZE_BYTES": str(self.canonical.stat().st_size),
                "EXPECTED_ORIGINAL_FILENAME": self.canonical.name,
            }
        )

    def run_root(
        self,
        *,
        canonical: Path | None = None,
        environment: dict[str, str] | None = None,
    ) -> Path:
        merged = self.environment | (environment or {})
        digest = merged["EXPECTED_OUTER_SHA256"]
        available = merged["EXPORT_AVAILABLE_AT_UTC"].replace("-", "").replace(":", "")
        return (
            Path(merged["APPROVED_EVIDENCE_STORE_ROOT"])
            / "migration-inspection-evidence"
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
        self.fake_control.write_text(
            "\n".join(
                (
                    execution_environment.get("FAKE_MODE", "ok"),
                    execution_environment.get("CANONICAL_EXPORT", ""),
                    execution_environment.get("MUTATE_PATH", ""),
                    execution_environment.get("COLLISION_PATH", ""),
                    "",
                )
            ),
            encoding="utf-8",
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
            timeout=timeout,
        )

    def assert_no_runs(self):
        workspace = self.checkout / "local-migration-artifacts"
        runs = list(workspace.glob("rehearsal-*")) if workspace.exists() else []
        self.assertEqual(runs, [])
        durable_parent = self.evidence_store / "migration-inspection-evidence"
        durable_runs = list(durable_parent.iterdir()) if durable_parent.exists() else []
        self.assertEqual(durable_runs, [])

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
        evidence = expected_root
        self.assertTrue((evidence / "EVIDENCE_COMPLETE").is_file())
        report = evidence / "inspection" / "rehearsal-metadata.txt"
        report_sha_file = evidence / "inspection" / "report.sha256"
        provenance_path = evidence / "provenance.json"
        provenance_sha_file = evidence / "provenance.sha256"
        expected_file = evidence / "archive" / "outer.expected.sha256"
        before_file = (
            evidence / "archive" / "outer.workflow-observed.before.sha256"
        )
        after_file = evidence / "archive" / "outer.workflow-observed.after.sha256"
        for path in (
            report,
            report_sha_file,
            provenance_path,
            provenance_sha_file,
            expected_file,
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
        self.assertEqual(expected_file.read_text().strip(), outer_sha)
        self.assertEqual(before_file.read_text().strip(), outer_sha)
        self.assertEqual(after_file.read_text().strip(), outer_sha)
        self.assertEqual(report_sha_file.read_text().strip(), report_sha)
        self.assertEqual(provenance_sha_file.read_text().strip(), provenance_sha)
        evidence_manifest_sha = hashlib.sha256(
            (evidence / "evidence-files.json").read_bytes()
        ).hexdigest()
        self.assertEqual(
            json.loads((evidence / "EVIDENCE_COMPLETE").read_text(encoding="utf-8")),
            {
                "evidence_files_sha256": evidence_manifest_sha,
                "inspection_status": "REVIEW_REQUIRED",
                "run_id": expected_root.name,
            },
        )
        self.assertEqual(
            provenance["outer_artifact"]["expected_identity"],
            {
                "original_filename": self.canonical.name,
                "size_bytes": self.canonical.stat().st_size,
                "sha256": outer_sha,
                "basis": "mandatory externally supplied runtime approval inputs",
            },
        )
        self.assertEqual(
            set(
                value
                for key, value in provenance["outer_artifact"][
                    "workflow_observed_identity"
                ].items()
                if key.startswith("sha256_")
            ),
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
        self.assertEqual(
            provenance["durable_publication"]["publication_semantics"],
            "descriptor_bound_fsynced_payload_then_atomic_no_replace_"
            "postcommit_validation_then_completion_marker",
        )
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
        self.assertEqual(
            provenance["inspection_tool_git_sha"],
            provenance["execution_checkout_sha"],
        )
        self.assertEqual(
            provenance["inspection_baseline_git_sha"], INSPECTION_BASELINE_SHA
        )
        inspector_path = self.checkout / "scripts/migration/inspect-lovable-dump.sh"
        guard_path = self.checkout / "scripts/migration/bounded-pg-restore.py"
        self.assertEqual(
            provenance["execution_tools"]["bounded_pg_restore_guard"],
            {
                "path": "scripts/migration/bounded-pg-restore.py",
                "git_blob_sha": git_output(
                    self.checkout,
                    "rev-parse",
                    "HEAD:scripts/migration/bounded-pg-restore.py",
                ),
                "sha256": hashlib.sha256(guard_path.read_bytes()).hexdigest(),
                "invoked_with_execution_python_isolated_mode": True,
            },
        )
        self.assertEqual(
            provenance["execution_tools"]["pgdmp_inspector"],
            {
                "path": "scripts/migration/inspect-lovable-dump.sh",
                "git_sha": provenance["execution_checkout_sha"],
                "git_blob_sha": git_output(
                    self.checkout,
                    "rev-parse",
                    "HEAD:scripts/migration/inspect-lovable-dump.sh",
                ),
                "sha256": hashlib.sha256(inspector_path.read_bytes()).hexdigest(),
                "failure_diagnostic_format_version": 1,
                "raw_failure_output_relayed": False,
            },
        )
        python_runtime = provenance["execution_tools"]["python_runtime"]
        resolved_python = Path(sys.executable).resolve()
        self.assertEqual(python_runtime["executable"], str(resolved_python))
        self.assertEqual(
            python_runtime["sha256"],
            hashlib.sha256(resolved_python.read_bytes()).hexdigest(),
        )
        self.assertEqual(python_runtime["implementation"], sys.implementation.name)
        self.assertEqual(
            python_runtime["version"],
            ".".join(str(component) for component in sys.version_info[:3]),
        )
        self.assertTrue(python_runtime["isolated_mode_for_child_tools"])
        self.assertFalse(
            python_runtime["inherited_python_or_shell_startup_environment"]
        )
        self.assertTrue(
            provenance["lovable_source_project"]["repository_binding"]["exact_match"]
        )
        self.assertEqual(
            provenance["lovable_source_project"]["repository_binding"][
                "declared_project_id"
            ],
            "abcdefghijklmnopqrst",
        )

        report_text = report.read_text(encoding="utf-8")
        self.assertIn(f"sha256: {inner_sha}", report_text)
        expected_header = {
            "archive_format_version_bytes": [1, 14, 0],
            "integer_width_bytes": 4,
            "offset_width_bytes": 8,
            "archive_format_code": 1,
            "bound_to_inner_sha256": inner_sha,
            "captured_before_pg_restore": True,
        }
        self.assertEqual(provenance["inner_pgdmp"]["pgdmp_header"], expected_header)
        self.assertIn("archive_format_version_bytes: 1,14,0", report_text)
        self.assertIn("archive_integer_width_bytes: 4", report_text)
        self.assertIn("archive_offset_width_bytes: 8", report_text)
        self.assertIn("archive_format_code: 1", report_text)
        self.assertIn(f"archive_header_bound_sha256: {inner_sha}", report_text)
        if zip_mode:
            self.assertNotIn(f"sha256: {outer_sha}", report_text)
        all_evidence_text = result.stdout + result.stderr
        for path in evidence.rglob("*"):
            if path.is_file():
                all_evidence_text += path.read_text(encoding="utf-8")
        self.assertNotIn(self.row_sentinel, all_evidence_text)
        self.assertNotIn(self.child_secret_sentinel, all_evidence_text)
        self.assertFalse((evidence / ".working").exists())
        self.assertFalse((evidence / ".derived").exists())
        for path in evidence.rglob("*"):
            expected_mode = 0o700 if path.is_dir() else 0o400
            self.assertEqual(stat.S_IMODE(path.lstat().st_mode), expected_mode)
        workspace = self.checkout / "local-migration-artifacts"
        self.assertFalse(any(workspace.iterdir()) if workspace.exists() else False)

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

    def test_final_file_mode_is_applied_before_fsync(self):
        real_fchmod = DRIVER.os.fchmod
        real_fsync = DRIVER.os.fsync

        def exercise(operation):
            events: list[str] = []

            def tracked_fchmod(descriptor: int, mode: int):
                events.append("fchmod")
                return real_fchmod(descriptor, mode)

            def tracked_fsync(descriptor: int):
                events.append("fsync")
                return real_fsync(descriptor)

            with mock.patch.object(
                DRIVER.os, "fchmod", side_effect=tracked_fchmod
            ), mock.patch.object(DRIVER.os, "fsync", side_effect=tracked_fsync):
                operation()
            self.assertIn("fchmod", events)
            self.assertIn("fsync", events)
            self.assertLess(events.index("fchmod"), events.index("fsync"))

        exclusive = self.case_root / "exclusive evidence"
        exercise(lambda: DRIVER.write_exclusive(exclusive, b"evidence\n"))

        source = self.case_root / "private copy source"
        source.write_bytes(b"private evidence\n")
        source.chmod(0o400)
        destination_directory = self.case_root / "private copy destination"
        destination_directory.mkdir(mode=0o700)
        directory_fd = os.open(destination_directory, os.O_RDONLY)
        try:
            exercise(
                lambda: DRIVER.copy_private_file_at(
                    source,
                    directory_fd,
                    "copied-evidence",
                )
            )
        finally:
            os.close(directory_fd)

    def test_durable_copy_corruption_and_local_cleanup_failure_publish_nothing(self):
        def make_pending(label: str) -> tuple[Path, Path, str]:
            run_id = f"rehearsal-20300102T030405Z-{label}"
            run_root = self.checkout / "local-migration-artifacts" / run_id
            pending = run_root / ".pending"
            pending.mkdir(parents=True, mode=0o700)
            (pending / "archive").mkdir(mode=0o700)
            (pending / "inspection").mkdir(mode=0o700)
            report = b"synthetic metadata-only report\n"
            provenance = (
                json.dumps({"run_id": run_id}, sort_keys=True) + "\n"
            ).encode("utf-8")
            payloads = {
                "archive/outer.expected.sha256": ("a" * 64 + "\n").encode(),
                "archive/outer.workflow-observed.before.sha256": ("a" * 64 + "\n").encode(),
                "archive/outer.workflow-observed.after.sha256": ("a" * 64 + "\n").encode(),
                "inspection/rehearsal-metadata.txt": report,
                "inspection/report.sha256": (
                    hashlib.sha256(report).hexdigest() + "\n"
                ).encode(),
                "provenance.json": provenance,
                "provenance.sha256": (
                    hashlib.sha256(provenance).hexdigest() + "\n"
                ).encode(),
            }
            self.assertEqual(set(payloads), DRIVER.CORE_EVIDENCE_FILES)
            for relative, data in payloads.items():
                DRIVER.write_exclusive(pending / relative, data)
            DRIVER.build_evidence_file_manifest(pending, run_id)
            return run_root, pending, run_id

        bound = DRIVER.open_bound_canonical(
            self.canonical,
            self.evidence_store,
            self.environment["EXPECTED_ORIGINAL_FILENAME"],
            int(self.environment["EXPECTED_OUTER_SIZE_BYTES"]),
            self.environment["EXPECTED_OUTER_SHA256"],
            self.checkout,
        )
        try:
            run_root, pending, run_id = make_pending("copycorrupt")
            real_copy = DRIVER.copy_private_file_at
            corrupted = False

            def corrupt_one_copy(source: Path, directory_fd: int, name: str):
                nonlocal corrupted
                identity = real_copy(source, directory_fd, name)
                if not corrupted:
                    corrupted = True
                    os.chmod(name, 0o600, dir_fd=directory_fd)
                    descriptor = os.open(
                        name,
                        os.O_WRONLY | os.O_APPEND,
                        dir_fd=directory_fd,
                    )
                    try:
                        os.write(descriptor, b"planted corruption")
                    finally:
                        os.close(descriptor)
                    os.chmod(name, 0o400, dir_fd=directory_fd)
                return identity

            with mock.patch.object(
                DRIVER, "copy_private_file_at", side_effect=corrupt_one_copy
            ):
                with self.assertRaisesRegex(DRIVER.WorkflowError, "manifest|identity"):
                    DRIVER.publish_durable_evidence(
                        pending, run_root, bound, run_id
                    )
            durable_parent = self.evidence_store / "migration-inspection-evidence"
            self.assertFalse((durable_parent / run_id).exists())
            self.assertFalse((durable_parent / f".{run_id}.pending").exists())
            self.assertTrue(run_root.exists())
            DRIVER.remove_incomplete_run(run_root)

            run_root, pending, run_id = make_pending("cleanupfail")
            real_remove = DRIVER.remove_incomplete_run

            def fail_only_local(path: Path, **kwargs):
                if path == run_root:
                    raise DRIVER.WorkflowError("planted local cleanup failure")
                return real_remove(path, **kwargs)

            with mock.patch.object(
                DRIVER, "remove_incomplete_run", side_effect=fail_only_local
            ):
                with self.assertRaisesRegex(
                    DRIVER.WorkflowError, "planted local cleanup failure"
                ):
                    DRIVER.publish_durable_evidence(
                        pending, run_root, bound, run_id
                    )
            self.assertFalse((durable_parent / run_id).exists())
            self.assertFalse((durable_parent / f".{run_id}.pending").exists())
            self.assertTrue(run_root.exists())
            real_remove(run_root)

            run_root, pending, run_id = make_pending("preexisting")
            durable_parent.mkdir(mode=0o700, exist_ok=True)
            planted = durable_parent / f".{run_id}.pending"
            planted.mkdir(mode=0o700)
            sentinel = planted / "must-not-be-deleted"
            sentinel.write_text("preexisting\n", encoding="utf-8")
            with self.assertRaisesRegex(
                DRIVER.WorkflowError, "already exists"
            ):
                DRIVER.publish_durable_evidence(pending, run_root, bound, run_id)
            self.assertEqual(sentinel.read_text(encoding="utf-8"), "preexisting\n")
            shutil.rmtree(planted)
            real_remove(run_root)
        finally:
            bound.close()

    def test_late_root_and_canonical_mutations_block_atomic_publication(self):
        def make_pending(label: str) -> tuple[Path, Path, str]:
            run_id = f"rehearsal-20300102T030405Z-{label}"
            run_root = self.checkout / "local-migration-artifacts" / run_id
            pending = run_root / ".pending"
            pending.mkdir(parents=True, mode=0o700)
            (pending / "archive").mkdir(mode=0o700)
            (pending / "inspection").mkdir(mode=0o700)
            report = b"synthetic metadata-only report\n"
            provenance = (json.dumps({"run_id": run_id}) + "\n").encode()
            payloads = {
                "archive/outer.expected.sha256": ("a" * 64 + "\n").encode(),
                "archive/outer.workflow-observed.before.sha256": ("a" * 64 + "\n").encode(),
                "archive/outer.workflow-observed.after.sha256": ("a" * 64 + "\n").encode(),
                "inspection/rehearsal-metadata.txt": report,
                "inspection/report.sha256": (hashlib.sha256(report).hexdigest() + "\n").encode(),
                "provenance.json": provenance,
                "provenance.sha256": (hashlib.sha256(provenance).hexdigest() + "\n").encode(),
            }
            for relative, data in payloads.items():
                DRIVER.write_exclusive(pending / relative, data)
            DRIVER.build_evidence_file_manifest(pending, run_id)
            return run_root, pending, run_id

        def new_bound():
            return DRIVER.open_bound_canonical(
                self.canonical,
                self.evidence_store,
                self.environment["EXPECTED_ORIGINAL_FILENAME"],
                int(self.environment["EXPECTED_OUTER_SIZE_BYTES"]),
                self.environment["EXPECTED_OUTER_SHA256"],
                self.checkout,
            )

        bound = new_bound()
        try:
            run_root, pending, run_id = make_pending("late-root-mode")
            real_remove = DRIVER.remove_incomplete_run

            def mutate_root_after_local_cleanup(path: Path, **kwargs):
                real_remove(path, **kwargs)
                self.evidence_store.chmod(0o755)

            with mock.patch.object(
                DRIVER,
                "remove_incomplete_run",
                side_effect=mutate_root_after_local_cleanup,
            ):
                with self.assertRaisesRegex(
                    DRIVER.WorkflowError, "approved evidence store root changed"
                ):
                    DRIVER.publish_durable_evidence(pending, run_root, bound, run_id)
            durable_parent = self.evidence_store / "migration-inspection-evidence"
            self.assertFalse((durable_parent / run_id).exists())
            self.assertFalse((durable_parent / f".{run_id}.pending").exists())
        finally:
            self.evidence_store.chmod(0o700)
            bound.close()

        bound = new_bound()
        try:
            run_root, pending, run_id = make_pending("late-canonical-mode")
            real_remove = DRIVER.remove_incomplete_run

            def mutate_canonical_after_local_cleanup(path: Path, **kwargs):
                real_remove(path, **kwargs)
                self.canonical.chmod(0o600)

            with mock.patch.object(
                DRIVER,
                "remove_incomplete_run",
                side_effect=mutate_canonical_after_local_cleanup,
            ):
                with self.assertRaisesRegex(
                    DRIVER.WorkflowError, "canonical export"
                ):
                    DRIVER.publish_durable_evidence(pending, run_root, bound, run_id)
            durable_parent = self.evidence_store / "migration-inspection-evidence"
            self.assertFalse((durable_parent / run_id).exists())
            self.assertFalse((durable_parent / f".{run_id}.pending").exists())
        finally:
            self.canonical.chmod(0o400)
            bound.close()

        bound = new_bound()
        moved_store = self.case_root / "moved admitted evidence store"
        try:
            run_root, pending, run_id = make_pending("late-root-replacement")
            real_remove = DRIVER.remove_incomplete_run

            def replace_root_after_local_cleanup(path: Path, **kwargs):
                real_remove(path, **kwargs)
                self.evidence_store.rename(moved_store)
                self.evidence_store.mkdir(mode=0o700)

            with mock.patch.object(
                DRIVER,
                "remove_incomplete_run",
                side_effect=replace_root_after_local_cleanup,
            ):
                with self.assertRaisesRegex(
                    DRIVER.WorkflowError, "root path was replaced"
                ):
                    DRIVER.publish_durable_evidence(pending, run_root, bound, run_id)
            self.assertFalse(
                (
                    moved_store
                    / "migration-inspection-evidence"
                    / run_id
                ).exists()
            )
            self.assertFalse(
                (
                    self.evidence_store
                    / "migration-inspection-evidence"
                    / run_id
                ).exists()
            )
        finally:
            bound.close()
            if moved_store.exists():
                if self.evidence_store.exists():
                    self.evidence_store.rmdir()
                moved_store.rename(self.evidence_store)

    def test_fifo_canonical_rejects_without_blocking_or_running_pg_restore(self):
        self.canonical.unlink()
        os.mkfifo(self.canonical, 0o400)
        result = self.run_workflow(timeout=5)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("canonical export must be a regular file", result.stderr)
        self.assertEqual(self.fake_log.read_text(encoding="utf-8"), "")
        self.assert_no_runs()

    def test_post_commit_mutation_cannot_leave_a_complete_package(self):
        run_id = "rehearsal-20300102T030405Z-postcommit"
        run_root = self.checkout / "local-migration-artifacts" / run_id
        pending = run_root / ".pending"
        pending.mkdir(parents=True, mode=0o700)
        (pending / "archive").mkdir(mode=0o700)
        (pending / "inspection").mkdir(mode=0o700)
        report = b"synthetic metadata-only report\n"
        provenance = (json.dumps({"run_id": run_id}) + "\n").encode()
        payloads = {
            "archive/outer.expected.sha256": ("a" * 64 + "\n").encode(),
            "archive/outer.workflow-observed.before.sha256": ("a" * 64 + "\n").encode(),
            "archive/outer.workflow-observed.after.sha256": ("a" * 64 + "\n").encode(),
            "inspection/rehearsal-metadata.txt": report,
            "inspection/report.sha256": (hashlib.sha256(report).hexdigest() + "\n").encode(),
            "provenance.json": provenance,
            "provenance.sha256": (hashlib.sha256(provenance).hexdigest() + "\n").encode(),
        }
        for relative, data in payloads.items():
            DRIVER.write_exclusive(pending / relative, data)
        DRIVER.build_evidence_file_manifest(pending, run_id)
        bound = DRIVER.open_bound_canonical(
            self.canonical,
            self.evidence_store,
            self.environment["EXPECTED_ORIGINAL_FILENAME"],
            int(self.environment["EXPECTED_OUTER_SIZE_BYTES"]),
            self.environment["EXPECTED_OUTER_SHA256"],
            self.checkout,
        )
        real_rename = DRIVER.atomic_rename_no_replace_at

        def rename_then_mutate(
            directory_fd: int,
            source_name: str,
            destination_name: str,
        ):
            real_rename(directory_fd, source_name, destination_name)
            self.canonical.chmod(0o600)

        try:
            with mock.patch.object(
                DRIVER,
                "atomic_rename_no_replace_at",
                side_effect=rename_then_mutate,
            ), mock.patch.object(
                DRIVER,
                "remove_tree_at",
                side_effect=AssertionError("committed package must not be destructively cleaned"),
            ):
                with self.assertRaisesRegex(
                    DRIVER.WorkflowError,
                    "committed but final validation is indeterminate",
                ):
                    DRIVER.publish_durable_evidence(pending, run_root, bound, run_id)
        finally:
            self.canonical.chmod(0o400)
            bound.close()

        final = self.evidence_store / "migration-inspection-evidence" / run_id
        self.assertTrue(final.is_dir())
        self.assertFalse(run_root.exists())
        self.assertFalse((final / DRIVER.COMPLETION_MARKER).exists())
        self.assertEqual(
            json.loads(
                (final / DRIVER.INDETERMINATE_MARKER).read_text(encoding="utf-8")
            ),
            {
                "inspection_status": "INDETERMINATE",
                "reason": "post_commit_validation_failed",
                "run_id": run_id,
            },
        )
        shutil.rmtree(final)

    def test_zip_workflow_separates_outer_inner_report_and_provenance_hashes(self):
        provenance, _, _ = self.assert_success()
        self.assertEqual(
            provenance["outer_artifact"]["expected_identity"]["original_filename"],
            self.canonical.name,
        )
        self.assertEqual(
            provenance["outer_artifact"]["ui_observed_export_object_name"],
            "synthetic-export.backup",
        )
        self.assertFalse(provenance["outer_artifact"]["working_copy_retained_in_evidence"])
        self.assertFalse(provenance["inner_pgdmp"]["retained_in_evidence"])

    def test_direct_pgdmp_workflow_remains_supported(self):
        self.canonical.unlink()
        self.canonical = self.canonical.with_suffix(".backup")
        self.canonical.write_bytes(self.inner_bytes)
        self.canonical.chmod(0o400)
        self.environment["CANONICAL_EXPORT"] = str(self.canonical)
        self.environment["UI_EXPORT_OBJECT_NAME"] = self.canonical.name
        self.refresh_expected_identity()
        provenance, _, _ = self.assert_success()
        digest = hashlib.sha256(self.inner_bytes).hexdigest()
        self.assertIsNone(provenance["zip_envelope"])
        self.assertIsNone(provenance["archive_member"])
        self.assertEqual(
            provenance["inner_pgdmp"]["relationship_to_outer"],
            "byte_copy_of_direct_pgdmp",
        )
        self.assertEqual(
            {
                provenance["outer_artifact"]["expected_identity"]["sha256"],
                provenance["outer_artifact"]["workflow_observed_identity"][
                    "sha256_before"
                ],
                provenance["outer_artifact"]["workflow_observed_identity"][
                    "sha256_after"
                ],
            },
            {digest},
        )

    def test_mandatory_external_artifact_inputs_have_no_defaults(self):
        for name in (
            "EXPECTED_OUTER_SHA256",
            "EXPECTED_OUTER_SIZE_BYTES",
            "EXPECTED_ORIGINAL_FILENAME",
            "APPROVED_EVIDENCE_STORE_ROOT",
        ):
            with self.subTest(name=name):
                self.assert_preflight_failure(name, unset_environment={name})

    def test_wrong_expected_filename_size_and_sha_fail_before_run_or_pg_restore(self):
        self.assert_preflight_failure(
            "canonical basename does not equal EXPECTED_ORIGINAL_FILENAME",
            environment={"EXPECTED_ORIGINAL_FILENAME": "different-envelope.zip"},
        )
        self.assert_preflight_failure(
            "canonical byte size does not equal EXPECTED_OUTER_SIZE_BYTES",
            environment={
                "EXPECTED_OUTER_SIZE_BYTES": str(self.canonical.stat().st_size + 1)
            },
        )
        self.assert_preflight_failure(
            "canonical SHA-256 does not equal EXPECTED_OUTER_SHA256",
            environment={"EXPECTED_OUTER_SHA256": "0" * 64},
        )

    def test_same_size_substituted_bytes_fail_against_external_sha_before_run(self):
        original = self.canonical.read_bytes()
        substituted = bytearray(original)
        substituted[0] ^= 1
        self.canonical.chmod(0o600)
        self.canonical.write_bytes(substituted)
        self.canonical.chmod(0o400)
        self.assertEqual(len(substituted), len(original))
        self.assert_preflight_failure(
            "canonical SHA-256 does not equal EXPECTED_OUTER_SHA256"
        )

    def test_zip_member_must_equal_ui_object_name_before_pg_restore(self):
        self.assert_preflight_failure(
            "ZIP member name does not exactly equal UI_EXPORT_OBJECT_NAME",
            environment={"UI_EXPORT_OBJECT_NAME": "different-ui-object.backup"},
        )

    def test_source_project_ref_must_match_approved_config_before_artifact_access(self):
        self.assert_preflight_failure(
            "does not equal approved supabase/config.toml project_id",
            environment={
                "SOURCE_PROJECT_REF": "zyxwvutsrqponmlkjihg",
                "CANONICAL_EXPORT": str(self.evidence_store / "absent.zip"),
                "EXPECTED_ORIGINAL_FILENAME": "absent.zip",
            },
        )

    def test_repository_project_id_parser_rejects_missing_duplicate_and_nested(self):
        probe = self.case_root / "config probe"
        (probe / "supabase").mkdir(parents=True)
        config = probe / "supabase/config.toml"
        for content in (
            "[project]\nname = \"missing\"\n",
            'project_id = "abcdefghijklmnopqrst"\nproject_id = "zyxwvutsrqponmlkjihg"\n',
            '[project]\nproject_id = "abcdefghijklmnopqrst"\n',
        ):
            with self.subTest(content=content):
                config.write_text(content, encoding="utf-8")
                with self.assertRaisesRegex(
                    DRIVER.WorkflowError, "exactly one top-level project_id|top-level"
                ):
                    DRIVER.repository_project_id(probe)

    def test_evidence_store_root_and_canonical_privacy_fail_closed(self):
        self.assert_preflight_failure(
            "APPROVED_EVIDENCE_STORE_ROOT must be absolute",
            environment={"APPROVED_EVIDENCE_STORE_ROOT": "relative-store"},
        )

        wrong_root = self.case_root / "wrong private root"
        wrong_root.mkdir(mode=0o700)
        self.assert_preflight_failure(
            "must resolve directly beneath APPROVED_EVIDENCE_STORE_ROOT",
            environment={"APPROVED_EVIDENCE_STORE_ROOT": str(wrong_root)},
        )

        linked_root = self.case_root / "linked evidence root"
        linked_root.symlink_to(self.evidence_store, target_is_directory=True)
        self.assert_preflight_failure(
            "must not contain symlink components",
            environment={
                "APPROVED_EVIDENCE_STORE_ROOT": str(linked_root),
                "CANONICAL_EXPORT": str(linked_root / self.canonical.name),
            },
        )

        self.evidence_store.chmod(0o755)
        self.assert_preflight_failure("must have mode 0700")
        self.evidence_store.chmod(0o700)

        self.canonical.chmod(0o644)
        self.assert_preflight_failure("must not be group/world accessible")

    def test_wrong_owner_checks_are_exercised_without_chown(self):
        with self.assertRaisesRegex(DRIVER.WorkflowError, "owned by the executing user"):
            descriptor = DRIVER.validate_private_directory(
                self.evidence_store,
                expected_uid=os.geteuid() + 1,
            )
            os.close(descriptor)
        fake_metadata = types.SimpleNamespace(
            st_mode=stat.S_IFREG | 0o400,
            st_uid=os.geteuid() + 1,
            st_size=100,
        )
        with self.assertRaisesRegex(DRIVER.WorkflowError, "owned by the executing user"):
            DRIVER.validate_canonical_metadata(fake_metadata, os.geteuid())

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

    def test_timeline_rejects_invalid_completion_and_impossible_orderings(self):
        self.assert_preflight_failure(
            "EXPORT_COMPLETED_BASIS must be operator_observed or not_observed",
            environment={"EXPORT_COMPLETED_BASIS": "unsupported"},
        )
        self.assert_preflight_failure(
            "EXPORT_COMPLETED_REASON is required",
            environment={"EXPORT_COMPLETED_REASON": ""},
        )
        self.assert_preflight_failure(
            "EXPORT_COMPLETED_AT_UTC must be empty",
            environment={"EXPORT_COMPLETED_AT_UTC": "2030-01-02T03:03:00Z"},
        )
        self.assert_preflight_failure(
            "EXPORT_COMPLETED_REASON must be empty",
            environment={
                "EXPORT_COMPLETED_BASIS": "operator_observed",
                "EXPORT_COMPLETED_AT_UTC": "2030-01-02T03:03:00Z",
                "EXPORT_COMPLETED_REASON": "must not accompany observation",
            },
        )
        self.assert_preflight_failure(
            "observed export completion must not follow availability",
            environment={
                "EXPORT_COMPLETED_BASIS": "operator_observed",
                "EXPORT_COMPLETED_AT_UTC": "2030-01-02T03:04:06Z",
                "EXPORT_COMPLETED_REASON": "",
            },
        )
        self.assert_preflight_failure(
            "observed export initiation must not follow availability",
            environment={
                "EXPORT_EVIDENCE_PROFILE": "future_rehearsal",
                "EXPORT_INITIATED_BASIS": "operator_observed",
                "EXPORT_INITIATED_AT_UTC": "2030-01-02T03:04:06Z",
                "EXPORT_INITIATED_REASON": "",
            },
        )
        self.assert_preflight_failure(
            "observed export initiation must not follow completion",
            environment={
                "EXPORT_EVIDENCE_PROFILE": "future_rehearsal",
                "EXPORT_INITIATED_BASIS": "operator_observed",
                "EXPORT_INITIATED_AT_UTC": "2030-01-02T03:03:01Z",
                "EXPORT_INITIATED_REASON": "",
                "EXPORT_COMPLETED_BASIS": "operator_observed",
                "EXPORT_COMPLETED_AT_UTC": "2030-01-02T03:03:00Z",
                "EXPORT_COMPLETED_REASON": "",
            },
        )

    def test_fully_observed_ordered_timeline_is_complete(self):
        complete_environment = {
            "EXPORT_INITIATED_BASIS": "operator_observed",
            "EXPORT_INITIATED_AT_UTC": "2030-01-02T03:00:00Z",
            "EXPORT_INITIATED_REASON": "",
            "EXPORT_COMPLETED_BASIS": "operator_observed",
            "EXPORT_COMPLETED_AT_UTC": "2030-01-02T03:03:00Z",
            "EXPORT_COMPLETED_REASON": "",
            "EXPORT_AVAILABLE_AT_UTC": "2030-01-02T03:04:05Z",
            "DOWNLOAD_COMPLETED_AT_UTC": "2030-01-02T03:05:06Z",
        }
        with mock.patch.dict(os.environ, complete_environment, clear=False):
            timeline, _, status = DRIVER.build_timeline("future_rehearsal")
        self.assertEqual(status, "COMPLETE")
        self.assertEqual(
            timeline["completed_at_utc"],
            {"value": "2030-01-02T03:03:00Z", "basis": "operator_observed"},
        )

    def test_inspector_failure_leaves_no_derived_report_or_provenance(self):
        expected_root = self.run_root()
        result = self.run_workflow(environment={"FAKE_MODE": "fail-list"})
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(
            result.stderr,
            '{"diagnostic_version":1,"stage":"pg_restore_list_rejected",'
            '"reason":"other_nonzero"}\n',
        )
        self.assertEqual(result.stdout, "")
        self.assertNotIn(self.child_secret_sentinel, result.stderr)
        self.assertNotIn(self.child_secret_sentinel, result.stdout)
        self.assertNotIn(self.row_sentinel, result.stderr)
        self.assertNotIn(self.row_sentinel, result.stdout)
        self.assertFalse(expected_root.exists())
        self.assertEqual(
            [line.split("|", 1)[0] for line in self.fake_log.read_text().splitlines()],
            ["--version", "--list"],
        )
        self.assertNotIn(
            self.child_secret_sentinel,
            self.fake_log.read_text(encoding="utf-8"),
        )
        self.assert_no_runs()

    def test_driver_accepts_only_allowlisted_inspector_stage_diagnostics(self):
        for stage in sorted(DRIVER.INSPECTOR_STAGE_CODES):
            with self.subTest(stage=stage):
                payload = (
                    '{"diagnostic_version":1,"stage":"'
                    + stage
                    + '","reason":"not_applicable"}\n'
                ).encode("ascii")
                self.assertEqual(
                    DRIVER.parse_inspector_failure(b"", payload),
                    (stage, "not_applicable"),
                )

    def test_driver_does_not_inherit_shell_or_python_startup_overrides(self):
        marker = self.case_root / "unreviewed startup executed"
        bash_env = self.case_root / "malicious BASH_ENV"
        bash_env.write_text(
            "if [ \"$0\" != bash ]; then "
            f"printf poison > {str(marker)!r}; exit 91; fi\n",
            encoding="utf-8",
        )
        fake_python = self.case_root / "unreviewed python"
        fake_python.write_text(
            "#!/bin/sh\n"
            f"printf poison > {str(marker)!r}\n"
            "exit 92\n",
            encoding="utf-8",
        )
        fake_python.chmod(0o700)

        provenance, _, _ = self.assert_success(
            environment={
                "BASH_ENV": str(bash_env),
                "ENV": str(bash_env),
                "PYTHON_BIN": str(fake_python),
                "PYTHONPATH": str(self.case_root / "unreviewed-python-path"),
            }
        )
        self.assertFalse(marker.exists())
        runtime = provenance["execution_tools"]["python_runtime"]
        self.assertEqual(runtime["executable"], str(Path(sys.executable).resolve()))
        self.assertFalse(runtime["inherited_python_or_shell_startup_environment"])

    def test_driver_reduces_malformed_or_leaking_child_diagnostics_to_safe_code(self):
        sentinel = self.child_secret_sentinel.encode("ascii")
        malformed = (
            (sentinel, b""),
            (b"", sentinel + b"\n"),
            (
                b"",
                b'{"diagnostic_version":1,"stage":"unknown",'
                b'"reason":"other_nonzero"}\n',
            ),
            (
                b"",
                b'{"diagnostic_version":1,"stage":"pg_restore_list_rejected",'
                b'"reason":"other_nonzero"}\n' + sentinel + b"\n",
            ),
            (
                b"",
                b'{"diagnostic_version":1,"stage":"pg_restore_list_rejected",'
                b'"reason":"unknown_reason"}\n',
            ),
            (
                b"",
                b'{"diagnostic_version":2,"stage":"pg_restore_list_rejected",'
                b'"reason":"other_nonzero"}\n',
            ),
            (
                b"",
                b'{"diagnostic_version":1,"stage":"pg_restore_list_rejected",'
                b'"reason":"other_nonzero","extra":"forbidden"}\n',
            ),
            (
                b"",
                b'{"stage":"pg_restore_list_rejected","diagnostic_version":1,'
                b'"reason":"other_nonzero"}\n',
            ),
            (b"", b"\xff\xfe\n"),
            (b"", b"x" * (DRIVER.MAX_INSPECTOR_DIAGNOSTIC_BYTES + 1)),
        )
        for stdout, stderr in malformed:
            with self.subTest(stdout=stdout[:20], stderr=stderr[:20]):
                self.assertEqual(
                    DRIVER.parse_inspector_failure(stdout, stderr),
                    ("inspector_diagnostic_invalid", "other_nonzero"),
                )

        visible = io.StringIO()
        with mock.patch.object(
            DRIVER,
            "inspect",
            side_effect=DRIVER.InspectorStageError(
                "inspector_diagnostic_invalid", "other_nonzero"
            ),
        ), redirect_stderr(visible):
            self.assertEqual(DRIVER.main(), 4)
        self.assertEqual(
            visible.getvalue(),
            '{"diagnostic_version":1,"stage":"inspector_diagnostic_invalid",'
            '"reason":"other_nonzero"}\n',
        )
        self.assertNotIn(self.child_secret_sentinel, visible.getvalue())

        visible = io.StringIO()
        with mock.patch.object(
            DRIVER,
            "inspect",
            side_effect=OSError("/private/SYNTHETIC_PATH_MUST_NOT_APPEAR"),
        ), redirect_stderr(visible):
            self.assertEqual(DRIVER.main(), 4)
        self.assertEqual(
            visible.getvalue(),
            '{"diagnostic_version":1,"stage":"internal_failure",'
            '"reason":"other_nonzero"}\n',
        )
        self.assertNotIn("SYNTHETIC_PATH_MUST_NOT_APPEAR", visible.getvalue())

    def test_safe_header_report_parser_is_typed_unique_and_hash_bound(self):
        inner_sha = "a" * 64
        report = "\n".join(
            (
                "archive_format_version: 1.14.0",
                "archive_format_version_bytes: 1,14,0",
                "archive_integer_width_bytes: 4",
                "archive_offset_width_bytes: 8",
                "archive_format_code: 1",
                f"archive_header_bound_sha256: {inner_sha}",
                "",
            )
        )
        self.assertEqual(
            DRIVER.parse_report_header_metadata(report, inner_sha),
            {
                "archive_format_version_bytes": [1, 14, 0],
                "integer_width_bytes": 4,
                "offset_width_bytes": 8,
                "archive_format_code": 1,
                "bound_to_inner_sha256": inner_sha,
                "captured_before_pg_restore": True,
            },
        )
        for tampered in (
            report.replace("1,14,0", "1,13,0"),
            report.replace("integer_width_bytes: 4", "integer_width_bytes: 3"),
            report.replace("archive_format_code: 1", "archive_format_code: 0"),
            report.replace(inner_sha, "b" * 64),
            report + "archive_format_code: 1\n",
        ):
            with self.subTest(tampered=tampered[-100:]):
                with self.assertRaises(DRIVER.WorkflowError):
                    DRIVER.parse_report_header_metadata(tampered, inner_sha)

    def test_partial_normalization_failure_publishes_no_evidence(self):
        corrupted = bytearray(self.canonical.read_bytes())
        central_offset = corrupted.index(b"PK\x01\x02")
        corrupted[14:18] = b"\x00\x00\x00\x00"
        corrupted[central_offset + 16 : central_offset + 20] = b"\x00\x00\x00\x00"
        self.canonical.chmod(0o600)
        self.canonical.write_bytes(corrupted)
        self.canonical.chmod(0o400)
        self.refresh_expected_identity()
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
        self.assertRegex(result.stderr, r"outer artifact|canonical export")
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
        self.assertIn("non-symlink regular file", result.stderr)
        self.assertEqual(self.fake_log.read_text(), "")
        self.assert_no_runs()

    def test_canonical_inside_worktree_is_rejected_before_run_creation(self):
        inside = self.checkout / "local-migration-artifacts" / "canonical.zip"
        inside.parent.mkdir(mode=0o700)
        inside.write_bytes(self.canonical.read_bytes())
        inside.chmod(0o400)
        self.assert_preflight_failure(
            "APPROVED_EVIDENCE_STORE_ROOT must be outside the Git worktree",
            environment={
                "CANONICAL_EXPORT": str(inside),
                "APPROVED_EVIDENCE_STORE_ROOT": str(inside.parent),
                "EXPECTED_ORIGINAL_FILENAME": inside.name,
                "EXPECTED_OUTER_SIZE_BYTES": str(inside.stat().st_size),
                "EXPECTED_OUTER_SHA256": hashlib.sha256(inside.read_bytes()).hexdigest(),
            },
        )

    def test_existing_run_is_never_overwritten(self):
        _, _, run_root = self.assert_success()
        provenance_before = (run_root / "provenance.json").read_bytes()
        calls_before = self.fake_log.read_text()
        result = self.run_workflow()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("durable evidence output already exists", result.stderr)
        self.assertEqual(
            (run_root / "provenance.json").read_bytes(), provenance_before
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
        self.assertIn("durable evidence output already exists", result.stderr)
        self.assertTrue(run_root.is_dir())
        self.assertFalse((run_root / "EVIDENCE_COMPLETE").exists())
        self.assertFalse((run_root / "provenance.json").exists())
        workspace = self.checkout / "local-migration-artifacts"
        self.assertFalse(any(workspace.iterdir()) if workspace.exists() else False)
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
        self.assert_preflight_failure("execution procedure differs")

        self.tearDown()
        self.setUp()
        helper = self.checkout / "scripts/migration/lib/lovable_dump_report.py"
        helper.write_text(helper.read_text() + "\n# planted modification\n")
        self.assert_preflight_failure("helper/migration inputs differ")

        self.tearDown()
        self.setUp()
        tracked_migration = next(
            (self.checkout / "supabase/migrations").glob("*.sql")
        )
        tracked_migration.write_text(
            tracked_migration.read_text() + "\n-- planted modification\n"
        )
        self.assert_preflight_failure("helper/migration inputs differ")

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
