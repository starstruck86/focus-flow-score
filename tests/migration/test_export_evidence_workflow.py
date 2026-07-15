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


def synthetic_object_analysis_report(
    *,
    unresolved_total: int,
    unresolved_class: str = "TABLE",
    object_status: str | None = None,
    duplicate_status: str | None = None,
    restore_gate: str = "BLOCKED",
) -> str:
    expected_status = "COMPLETE" if unresolved_total == 0 else "INCOMPLETE"
    counts = {
        object_class: 0
        for object_class in DRIVER.UNRESOLVED_OBJECT_CLASS_ALLOWLIST
    }
    if unresolved_total:
        counts[unresolved_class] = unresolved_total
    lines = [
        "LOVABLE CLOUD DUMP — METADATA-ONLY INSPECTION",
        "inspection_status: REVIEW_REQUIRED",
        f"object_reference_analysis: {object_status or expected_status}",
        f"migration_duplicate_analysis: {duplicate_status or expected_status}",
        f"restore_planning_gate: {restore_gate}",
        (
            "scope: archive header, SHA-256, pg_restore TOC metadata, "
            "aggregate unresolved-object counts"
        ),
        "restore_attempted: no",
        "database_connection_attempted: no",
        "row_payload_inspected: no",
        "size_bytes: 23",
        "sha256: " + ("a" * 64),
        "archive_format: PostgreSQL custom archive (PGDMP)",
        "archive_format_version: 1.14.0",
        "source_postgresql_version: 17.5",
        "source_pg_dump_version: 17.5",
        "pg_restore_version: 17.5",
        "pg_restore_list_compatibility: PASS",
        (
            "archive_snapshot_binding: PASS "
            "(TOC and SHA-256 use one private read-only capture)"
        ),
        f"toc_entries: {max(1, unresolved_total)}",
        f"toc_metadata_entries: {max(1, unresolved_total)}",
        "toc_data_references_not_extracted: 0",
        "unknown_toc_classes: none (inspection fails closed if encountered)",
        f"unresolved_known_toc_entries: {unresolved_total}",
        "",
        DRIVER.UNRESOLVED_CLASS_COUNT_HEADER,
    ]
    if unresolved_total == 0 and duplicate_status != "INCOMPLETE":
        lines.insert(9, "input_file: verified-inner.pgdmp")
    lines.extend(f"{object_class}: {counts[object_class]}" for object_class in counts)
    lines.extend(
        [
            "",
            "BOUNDARY",
            "This report is an inventory aid, not a restore plan or completeness proof.",
            (
                "Object-reference analysis is incomplete; restore planning remains blocked."
                if unresolved_total
                else "Migration-duplicate analysis is incomplete; restore planning remains blocked."
                if duplicate_status == "INCOMPLETE"
                else "Object-reference analysis is complete; restore planning remains blocked."
            ),
            "",
            "PGDMP HEADER CAPTURE",
            "archive_format_version_bytes: 1,14,0",
            "archive_integer_width_bytes: 4",
            "archive_offset_width_bytes: 8",
            "archive_format_code: 1",
            "archive_header_bound_sha256: " + ("a" * 64),
            "expected_sha256_binding: PASS",
            "",
        ]
    )
    return "\n".join(lines)


def synthetic_package_report_and_provenance(
    run_id: str,
    *,
    unresolved_total: int = 0,
) -> tuple[bytes, bytes]:
    report_text = synthetic_object_analysis_report(
        unresolved_total=unresolved_total
    )
    analysis = DRIVER.parse_report_object_analysis(report_text)
    provenance = {
        "format_version": DRIVER.PROVENANCE_FORMAT_VERSION,
        "artifact_kind": "lovable_cloud_export_inspection_provenance",
        "inspection_status": "REVIEW_REQUIRED",
        "export_timeline_status": "COMPLETE",
        "run_id": run_id,
        "run_kind": "rehearsal",
        "export_evidence_profile": "future_rehearsal",
        **analysis,
        "approved_execution_checkout_sha": "1" * 40,
        "execution_checkout_sha": "1" * 40,
        "procedure_origin_sha": DRIVER.PROCEDURE_ORIGIN_SHA,
        "inspection_tool_git_sha": "1" * 40,
        "inspection_baseline_git_sha": DRIVER.INSPECTION_BASELINE_GIT_SHA,
        "procedure_readme_blob_sha": "4" * 40,
        "execution_driver_blob_sha": "5" * 40,
        "normalizer_blob_sha": "6" * 40,
        "pg_restore_guard_blob_sha": "7" * 40,
        "pgdmp_inspector_blob_sha": "8" * 40,
        "report_helper_blob_sha": "9" * 40,
        "supabase_config_blob_sha": "a" * 40,
        "procedure_workflow_sha256": "b" * 64,
        "execution_driver_sha256": "c" * 64,
        "normalizer_sha256": "d" * 64,
        "pg_restore_guard_sha256": "e" * 64,
        "pgdmp_inspector_sha256": "f" * 64,
        "report_helper_sha256": "0" * 64,
        "supabase_config_sha256": "1" * 64,
        "execution_python_executable": "/synthetic/python3",
        "execution_python_sha256": "2" * 64,
        "execution_python_implementation": "cpython",
        "execution_python_version": "3.13.1",
        "procedure_identity_boundary": {
            "procedure_origin_sha_is_informational_only": True,
            "external_approval_proof": "approved checkout must exactly equal execution checkout",
            "inspector_identity": "approved execution checkout plus exact Git blob and file SHA-256",
            "historical_baseline_scope": "unchanged supabase/migrations only",
        },
        "execution_tools": {
            "driver": {
                "path": "scripts/migration/inspect-lovable-export.py",
                "git_blob_sha": "5" * 40,
                "sha256": "c" * 64,
            },
            "envelope_normalizer": {
                "path": "scripts/migration/normalize-lovable-export.py",
                "git_blob_sha": "6" * 40,
                "sha256": "d" * 64,
            },
            "bounded_pg_restore_guard": {
                "path": "scripts/migration/bounded-pg-restore.py",
                "git_blob_sha": "7" * 40,
                "sha256": "e" * 64,
                "invoked_with_execution_python_isolated_mode": True,
            },
            "pgdmp_inspector": {
                "path": "scripts/migration/inspect-lovable-dump.sh",
                "git_sha": "1" * 40,
                "git_blob_sha": "8" * 40,
                "sha256": "f" * 64,
                "failure_diagnostic_format_version": 1,
                "raw_failure_output_relayed": False,
            },
            "report_helper": {
                "path": "scripts/migration/lib/lovable_dump_report.py",
                "git_sha": "1" * 40,
                "git_blob_sha": "9" * 40,
                "sha256": "0" * 64,
                "failure_diagnostic_format_version": 1,
                "raw_failure_output_relayed": False,
            },
            "python_runtime": {
                "executable": "/synthetic/python3",
                "sha256": "2" * 64,
                "implementation": "cpython",
                "version": "3.13.1",
                "isolated_mode_for_child_tools": True,
                "inherited_python_or_shell_startup_environment": False,
            },
        },
        "lovable_source_project": {
            "name": "Synthetic Project",
            "ref": "abcdefghijklmnopqrst",
            "repository_binding": {
                "path": "supabase/config.toml",
                "declared_project_id": "abcdefghijklmnopqrst",
                "git_blob_sha": "a" * 40,
                "sha256": "1" * 64,
                "exact_match": True,
            },
            "identity_boundary": (
                "operator-observed UI identity plus exact approved-checkout config "
                "equality; Lovable's internal export mapping is not independently verifiable"
            ),
        },
        "export_timeline": {
            "initiated_at_utc": {
                "value": "2030-01-02T03:00:00Z",
                "basis": "operator_observed",
            },
            "completed_at_utc": {
                "value": "2030-01-02T03:03:00Z",
                "basis": "operator_observed",
            },
            "available_at_utc": {
                "value": "2030-01-02T03:04:05Z",
                "basis": "operator_observed",
            },
            "download_completed_at_utc": {
                "value": "2030-01-02T03:05:00Z",
                "basis": "operator_observed",
            },
            "time_inference_used": False,
        },
        "evidence_store": {
            "approved_root": "/synthetic/evidence",
            "root_owner_uid": 1000,
            "root_mode": "0700",
            "canonical_direct_child": True,
            "canonical_owner_uid": 1000,
            "canonical_mode": "0400",
            "volume_encryption": "not_independently_verified_by_this_workflow",
            "durable_package_relative_path": f"migration-inspection-evidence/{run_id}",
        },
        "outer_artifact": {
            "role": "canonical_download_envelope",
            "ui_observed_export_object_name": "synthetic.backup",
            "expected_identity": {
                "original_filename": "synthetic.backup",
                "size_bytes": 23,
                "sha256": "a" * 64,
                "basis": "mandatory externally supplied runtime approval inputs",
            },
            "workflow_observed_identity": {
                "original_filename": "synthetic.backup",
                "size_bytes_before": 23,
                "size_bytes_after": 23,
                "sha256_before": "a" * 64,
                "sha256_after": "a" * 64,
            },
            "format": "postgresql_custom_archive",
            "normalizer_sha256": {"before": "a" * 64, "after": "a" * 64},
            "checksum_files": {
                "expected": "archive/outer.expected.sha256",
                "workflow_observed_before": "archive/outer.workflow-observed.before.sha256",
                "workflow_observed_after": "archive/outer.workflow-observed.after.sha256",
            },
            "working_copy_retained_in_evidence": False,
        },
        "zip_envelope": None,
        "archive_member": None,
        "ui_member_binding": {
            "status": "not_applicable",
            "ui_observed_name": "synthetic.backup",
            "normalized_member_name": None,
        },
        "inner_pgdmp": {
            "role": "verified_inspector_input",
            "relationship_to_outer": "byte_copy_of_direct_pgdmp",
            "size_bytes": 23,
            "sha256": "a" * 64,
            "inspector_reported_sha256": "a" * 64,
            "pgdmp_header": {
                "archive_format_version_bytes": [1, 14, 0],
                "integer_width_bytes": 4,
                "offset_width_bytes": 8,
                "archive_format_code": 1,
                "bound_to_inner_sha256": "a" * 64,
                "captured_before_pg_restore": True,
            },
            "pg_restore_list": {
                "compatibility": "PASS",
                "failure_diagnostic": None,
                "raw_child_output_retained": False,
            },
            "retained_in_evidence": False,
            "all_bytes_consumed_by_pg_restore_list": "not_independently_verifiable",
        },
        "operator_identity": "Synthetic Operator",
        "report": {
            "filename": "rehearsal-metadata.txt",
            "relative_path": "inspection/rehearsal-metadata.txt",
            "sha256": hashlib.sha256(report_text.encode()).hexdigest(),
            "checksum_file": "inspection/report.sha256",
        },
        "durable_publication": {
            "relative_directory": f"migration-inspection-evidence/{run_id}",
            "file_manifest": "evidence-files.json",
            "file_manifest_checksum": "evidence-files.sha256",
            "completion_marker": "EVIDENCE_COMPLETE",
            "completion_marker_meaning": "evidence package bytes are complete; restore planning remains blocked",
            "publication_semantics": (
                "descriptor_bound_fsynced_payload_then_atomic_no_replace_"
                "postcommit_validation_then_completion_marker"
            ),
        },
        "support_reported_not_independently_verified": DRIVER.SUPPORT_REPORTED_BOUNDARY,
    }
    return (
        report_text.encode("utf-8"),
        (json.dumps(provenance, sort_keys=True) + "\n").encode("utf-8"),
    )


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
            "scripts/migration/lib/lovable_dump_report.py",
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
                "scripts/migration/lib/lovable_dump_report.py",
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

    def build_synthetic_pending_package(
        self,
        run_id: str,
        *,
        unresolved_total: int = 0,
    ) -> tuple[Path, Path, bytes, bytes]:
        run_root = self.checkout / "local-migration-artifacts" / run_id
        pending = run_root / ".pending"
        run_root.parent.mkdir(mode=0o700, exist_ok=True)
        run_root.mkdir(mode=0o700)
        pending.mkdir(mode=0o700)
        (pending / "archive").mkdir(mode=0o700)
        (pending / "inspection").mkdir(mode=0o700)
        report, provenance = synthetic_package_report_and_provenance(
            run_id,
            unresolved_total=unresolved_total,
        )
        payloads = {
            "archive/outer.expected.sha256": ("a" * 64 + "\n").encode(),
            "archive/outer.workflow-observed.before.sha256": (
                "a" * 64 + "\n"
            ).encode(),
            "archive/outer.workflow-observed.after.sha256": (
                "a" * 64 + "\n"
            ).encode(),
            "inspection/rehearsal-metadata.txt": report,
            "inspection/report.sha256": (
                hashlib.sha256(report).hexdigest() + "\n"
            ).encode(),
            "provenance.json": provenance,
            "provenance.sha256": (
                hashlib.sha256(provenance).hexdigest() + "\n"
            ).encode(),
        }
        for relative, data in payloads.items():
            DRIVER.write_exclusive(pending / relative, data)
        DRIVER.build_evidence_file_manifest(pending, run_id)
        return run_root, pending, report, provenance

    @staticmethod
    def replace_private_file(path: Path, data: bytes) -> None:
        path.chmod(0o600)
        path.write_bytes(data)
        path.chmod(0o400)

    def rebuild_manifest_after_provenance_change(
        self,
        pending: Path,
        provenance: bytes,
        run_id: str,
    ) -> None:
        self.replace_private_file(pending / "provenance.json", provenance)
        self.replace_private_file(
            pending / "provenance.sha256",
            (hashlib.sha256(provenance).hexdigest() + "\n").encode(),
        )
        (pending / "evidence-files.json").unlink()
        (pending / "evidence-files.sha256").unlink()
        DRIVER.build_evidence_file_manifest(
            pending,
            run_id,
        )

    def assert_both_evidence_validators_reject(
        self,
        pending: Path,
        run_id: str,
        *,
        run_root: Path | None = None,
        bound: DRIVER.BoundCanonical | None = None,
    ) -> None:
        with self.assertRaises(DRIVER.WorkflowError):
            DRIVER.validate_evidence_tree(pending, run_id)
        descriptor = os.open(pending, os.O_RDONLY)
        try:
            with self.assertRaises(DRIVER.WorkflowError):
                DRIVER.validate_evidence_tree_at(descriptor, run_id)
        finally:
            os.close(descriptor)
        if run_root is not None and bound is not None:
            with self.assertRaises(DRIVER.WorkflowError):
                DRIVER.publish_durable_evidence(
                    pending,
                    run_root,
                    bound,
                    run_id,
                )
        durable_parent = self.evidence_store / DRIVER.DURABLE_EVIDENCE_DIRECTORY
        self.assertFalse((pending / DRIVER.COMPLETION_MARKER).exists())
        self.assertFalse((pending / DRIVER.INDETERMINATE_MARKER).exists())
        self.assertFalse((durable_parent / run_id).exists())
        self.assertFalse((durable_parent / f".{run_id}.pending").exists())
        if durable_parent.exists():
            self.assertEqual(list(durable_parent.rglob(DRIVER.COMPLETION_MARKER)), [])

    def bind_synthetic_canonical(self) -> DRIVER.BoundCanonical:
        return DRIVER.open_bound_canonical(
            self.canonical,
            self.evidence_store,
            self.canonical.name,
            self.canonical.stat().st_size,
            hashlib.sha256(self.canonical.read_bytes()).hexdigest(),
            self.checkout,
        )

    @staticmethod
    def bash_octal_bytes(value: bytes) -> str:
        return "".join(f"\\{byte:03o}" for byte in value)

    def install_synthetic_failing_inspector(
        self,
        diagnostic: bytes,
        *,
        case_label: str,
    ) -> dict[str, str]:
        inspector = self.checkout / "scripts/migration/inspect-lovable-dump.sh"
        encoded_diagnostic = self.bash_octal_bytes(diagnostic)
        diagnostic_command = (
            f"printf '%b' '{encoded_diagnostic}' >&2"
            if diagnostic
            else ": # deliberately empty diagnostic"
        )
        inspector.write_text(
            "#!/bin/bash\n"
            "set -euo pipefail\n"
            f"# Synthetic helper-diagnostic case: {case_label}\n"
            "output=''\n"
            "while [[ $# -gt 0 ]]; do\n"
            "  case \"$1\" in\n"
            "    --output) output=$2; shift 2 ;;\n"
            "    *) shift ;;\n"
            "  esac\n"
            "done\n"
            "[[ -n \"$output\" ]]\n"
            "{\n"
            f"  printf '%s\\n' '{self.row_sentinel}'\n"
            f"  printf '%s\\n' '{self.child_secret_sentinel}'\n"
            "  printf '%s\\n' '/private/SYNTHETIC_HELPER_PATH_MUST_NOT_APPEAR'\n"
            "  printf '%s\\n' 'SYNTHETIC_HELPER_FILENAME_MUST_NOT_APPEAR.backup'\n"
            "  printf '%s\\n' 'SYNTHETIC_HELPER_OBJECT_MUST_NOT_APPEAR'\n"
            "  printf '%s\\n' 'SYNTHETIC_HELPER_TOC_MUST_NOT_APPEAR'\n"
            "  printf '%s\\n' 'SELECT SYNTHETIC_HELPER_SQL_MUST_NOT_APPEAR'\n"
            "} >\"$output\"\n"
            f"{diagnostic_command}\n"
            "exit 4\n",
            encoding="utf-8",
        )
        inspector.chmod(0o755)
        subprocess.run(
            ["git", "add", "scripts/migration/inspect-lovable-dump.sh"],
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
                f"synthetic helper diagnostic: {case_label}",
            ],
            cwd=self.checkout,
            check=True,
            capture_output=True,
            text=True,
        )
        checkout_sha = git_output(self.checkout, "rev-parse", "HEAD")
        return {
            "APPROVED_EXECUTION_CHECKOUT_SHA": checkout_sha,
            "INSPECTION_TOOL_GIT_SHA": checkout_sha,
        }

    def commit_helper_source_mutation(
        self,
        *,
        old: str,
        new: str,
        label: str,
        count: int = 1,
    ) -> dict[str, str]:
        helper = self.checkout / "scripts/migration/lib/lovable_dump_report.py"
        source = helper.read_text(encoding="utf-8")
        if source.count(old) < count:
            self.fail("synthetic helper mutation target is unavailable")
        helper.write_text(source.replace(old, new, count), encoding="utf-8")
        subprocess.run(
            ["git", "add", "scripts/migration/lib/lovable_dump_report.py"],
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
                f"synthetic report mutation: {label}",
            ],
            cwd=self.checkout,
            check=True,
            capture_output=True,
            text=True,
        )
        checkout_sha = git_output(self.checkout, "rev-parse", "HEAD")
        return {
            "APPROVED_EXECUTION_CHECKOUT_SHA": checkout_sha,
            "INSPECTION_TOOL_GIT_SHA": checkout_sha,
        }

    def assert_synthetic_helper_failure(
        self,
        *,
        diagnostic: bytes,
        expected_stage: str,
        expected_reason: str,
        case_label: str,
    ) -> None:
        environment = self.install_synthetic_failing_inspector(
            diagnostic,
            case_label=case_label,
        )
        expected_root = self.run_root(environment=environment)
        result = self.run_workflow(environment=environment)
        self.assertNotEqual(result.returncode, 0)
        if result.stdout:
            self.fail("helper failure exposed private stdout")
        expected_diagnostic = (
            '{"diagnostic_version":1,"stage":"'
            + expected_stage
            + '","reason":"'
            + expected_reason
            + '"}\n'
        )
        if result.stderr != expected_diagnostic:
            self.fail("helper failure did not emit the exact safe outer diagnostic")
        for sentinel in (
            self.row_sentinel,
            self.child_secret_sentinel,
            "/private/SYNTHETIC_HELPER_PATH_MUST_NOT_APPEAR",
            "SYNTHETIC_HELPER_FILENAME_MUST_NOT_APPEAR.backup",
            "SYNTHETIC_HELPER_OBJECT_MUST_NOT_APPEAR",
            "SYNTHETIC_HELPER_TOC_MUST_NOT_APPEAR",
            "SELECT SYNTHETIC_HELPER_SQL_MUST_NOT_APPEAR",
        ):
            if sentinel in result.stdout or sentinel in result.stderr:
                self.fail("private helper content reached user-visible output")
        self.assertFalse(expected_root.exists())
        self.assert_no_runs()
        for forbidden_name in (
            "rehearsal-metadata.txt",
            "report.sha256",
            "provenance.json",
            "provenance.sha256",
            "evidence-files.json",
            "evidence-files.sha256",
            "EVIDENCE_COMPLETE",
            "verified-inner.pgdmp",
            "canonical-outer.artifact",
        ):
            self.assertEqual(list(self.case_root.rglob(forbidden_name)), [])
        self.assertEqual(self.fake_log.read_text(encoding="utf-8"), "")

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
        self,
        *,
        environment: dict[str, str] | None = None,
        unresolved_counts: dict[str, int] | None = None,
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
                "restore_planning_gate": "BLOCKED",
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
            provenance["format_version"], DRIVER.PROVENANCE_FORMAT_VERSION
        )
        expected_counts = {
            object_class: 0
            for object_class in DRIVER.UNRESOLVED_OBJECT_CLASS_ALLOWLIST
        }
        expected_counts.update(unresolved_counts or {})
        expected_unresolved_total = sum(expected_counts.values())
        expected_analysis_status = (
            "INCOMPLETE" if expected_unresolved_total else "COMPLETE"
        )
        self.assertEqual(
            provenance["object_reference_analysis"], expected_analysis_status
        )
        self.assertEqual(
            provenance["migration_duplicate_analysis"], expected_analysis_status
        )
        self.assertEqual(provenance["restore_planning_gate"], "BLOCKED")
        self.assertEqual(
            provenance["unresolved_known_toc_entries"], expected_unresolved_total
        )
        self.assertEqual(
            provenance["unresolved_known_toc_class_counts"],
            expected_counts,
        )
        self.assertIn("restore_planning_gate=BLOCKED\n", result.stdout)
        self.assertEqual(
            provenance["durable_publication"]["completion_marker_meaning"],
            "evidence package bytes are complete; restore planning remains blocked",
        )
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
        helper_path = self.checkout / "scripts/migration/lib/lovable_dump_report.py"
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
        self.assertEqual(
            provenance["execution_tools"]["report_helper"],
            {
                "path": "scripts/migration/lib/lovable_dump_report.py",
                "git_sha": provenance["execution_checkout_sha"],
                "git_blob_sha": git_output(
                    self.checkout,
                    "rev-parse",
                    "HEAD:scripts/migration/lib/lovable_dump_report.py",
                ),
                "sha256": hashlib.sha256(helper_path.read_bytes()).hexdigest(),
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

    def test_unresolved_known_entry_publishes_only_blocked_aggregate_evidence(self):
        private_sentinels = (
            "SYNTHETIC_UNRESOLVED_OBJECT_MUST_NOT_APPEAR",
            "/private/SYNTHETIC_UNRESOLVED_PATH_MUST_NOT_APPEAR",
            "SELECT SYNTHETIC_UNRESOLVED_SQL_MUST_NOT_APPEAR",
        )
        self.fake_toc.write_text(
            "; Dumped from database version: 17.5\n"
            "; Dumped by pg_dump version: 17.5\n"
            "; "
            + private_sentinels[1]
            + "\n"
            "1; 1259 100 TABLE "
            + private_sentinels[0]
            + "\n"
            "; "
            + private_sentinels[2]
            + "\n",
            encoding="utf-8",
        )
        provenance, result, evidence = self.assert_success(
            unresolved_counts={"TABLE": 1}
        )
        report = (evidence / "inspection/rehearsal-metadata.txt").read_text(
            encoding="utf-8"
        )
        self.assertIn("object_reference_analysis: INCOMPLETE\n", report)
        self.assertIn("migration_duplicate_analysis: INCOMPLETE\n", report)
        self.assertIn("restore_planning_gate: BLOCKED\n", report)
        self.assertIn("unresolved_known_toc_entries: 1\n", report)
        self.assertNotIn("TOC CLASS COUNTS", report.splitlines())
        self.assertNotIn("input_file:", report)
        self.assertNotIn("POSSIBLE REPO MIGRATION DUPLICATES", report)
        self.assertEqual(provenance["restore_planning_gate"], "BLOCKED")
        self.assertIn("restore_planning_gate=BLOCKED\n", result.stdout)

        retained = result.stdout + result.stderr
        for path in evidence.rglob("*"):
            if path.is_file():
                retained += path.read_text(encoding="utf-8")
        for sentinel in private_sentinels:
            self.assertNotIn(sentinel, retained)
        self.assertTrue((evidence / "EVIDENCE_COMPLETE").is_file())
        self.assertFalse((evidence / "EVIDENCE_INDETERMINATE").exists())
        self.assertFalse((evidence / ".working").exists())
        self.assertFalse((evidence / ".derived").exists())
        self.assertEqual(
            [line.split("|", 1)[0] for line in self.fake_log.read_text().splitlines()],
            ["--version", "--list"],
        )

    def test_invalid_incomplete_gate_cleans_every_partial_evidence_file(self):
        self.fake_toc.write_text(
            "; Dumped from database version: 17.5\n"
            "; Dumped by pg_dump version: 17.5\n"
            "1; 1259 100 TABLE SYNTHETIC_PRIVATE_OBJECT_MUST_NOT_APPEAR\n",
            encoding="utf-8",
        )
        environment = self.commit_helper_source_mutation(
            old='"restore_planning_gate: BLOCKED",',
            new='"restore_planning_gate: READY",',
            label="false ready gate",
        )
        expected_root = self.run_root(environment=environment)
        result = self.run_workflow(environment=environment)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("SYNTHETIC_PRIVATE_OBJECT_MUST_NOT_APPEAR", result.stdout)
        self.assertNotIn("SYNTHETIC_PRIVATE_OBJECT_MUST_NOT_APPEAR", result.stderr)
        self.assertFalse(expected_root.exists())
        self.assert_no_runs()
        for forbidden_name in (
            "rehearsal-metadata.txt",
            "report.sha256",
            "provenance.json",
            "provenance.sha256",
            "evidence-files.json",
            "evidence-files.sha256",
            "EVIDENCE_COMPLETE",
            "EVIDENCE_INDETERMINATE",
            "verified-inner.pgdmp",
            "canonical-outer.artifact",
        ):
            self.assertEqual(list(self.case_root.rglob(forbidden_name)), [])
        self.assertEqual(
            [line.split("|", 1)[0] for line in self.fake_log.read_text().splitlines()],
            ["--version", "--list"],
        )

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
            report, provenance = synthetic_package_report_and_provenance(run_id)
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
            report, provenance = synthetic_package_report_and_provenance(run_id)
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
        report, provenance = synthetic_package_report_and_provenance(run_id)
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

    def test_every_reviewed_helper_reason_survives_the_high_level_boundary(self):
        for reason in sorted(DRIVER.REPORT_HELPER_FAILURE_REASONS):
            with self.subTest(reason=reason):
                diagnostic = (
                    '{"diagnostic_version":1,"stage":"report_helper_failed",'
                    '"reason":"' + reason + '"}\n'
                ).encode("ascii")
                self.assert_synthetic_helper_failure(
                    diagnostic=diagnostic,
                    expected_stage="report_helper_failed",
                    expected_reason=reason,
                    case_label=f"reviewed-{reason}",
                )

    def test_every_untrusted_helper_diagnostic_fallback_cleans_partial_evidence(self):
        # The raw inspector owns parsing untrusted helper bytes. These cases model
        # its required canonical reduction at the high-level process boundary.
        fallback = (
            '{"diagnostic_version":1,"stage":"report_helper_failed",'
            '"reason":"other_nonzero"}\n'
        ).encode("ascii")
        for case_label in (
            "empty",
            "malformed",
            "multiline",
            "oversize",
            "non_ascii",
            "extra_key",
            "wrong_version",
            "unknown_reason",
        ):
            with self.subTest(case_label=case_label):
                self.assert_synthetic_helper_failure(
                    diagnostic=fallback,
                    expected_stage="report_helper_failed",
                    expected_reason="other_nonzero",
                    case_label=f"reduced-{case_label}",
                )

    def test_unsanitized_helper_diagnostic_bytes_are_never_accepted(self):
        secret = self.child_secret_sentinel.encode("ascii")
        helper_prefix = (
            b'{"diagnostic_version":1,"stage":"report_helper_failed",'
        )
        cases = (
            b"",
            b"{malformed}\n",
            helper_prefix + b'"reason":"other_nonzero"}\n' + secret + b"\n",
            b"x" * (DRIVER.MAX_INSPECTOR_DIAGNOSTIC_BYTES + 1),
            helper_prefix + b'"reason":"other_nonzero"}\xff\n',
            helper_prefix
            + b'"reason":"other_nonzero","extra":"forbidden"}\n',
            b'{"diagnostic_version":2,"stage":"report_helper_failed",'
            b'"reason":"other_nonzero"}\n',
            helper_prefix + b'"reason":"unknown_reason"}\n',
        )
        for diagnostic in cases:
            with self.subTest(diagnostic=diagnostic[:60]):
                self.assertEqual(
                    DRIVER.parse_inspector_failure(b"", diagnostic),
                    ("inspector_diagnostic_invalid", "other_nonzero"),
                )

    def test_driver_accepts_only_allowlisted_inspector_stage_reason_pairs(self):
        self.assertEqual(
            frozenset(DRIVER.INSPECTOR_STAGE_REASON_CODES),
            DRIVER.INSPECTOR_STAGE_CODES,
        )
        for stage, reasons in sorted(DRIVER.INSPECTOR_STAGE_REASON_CODES.items()):
            self.assertTrue(reasons, stage)
            for reason in sorted(reasons):
                with self.subTest(stage=stage, reason=reason):
                    payload = (
                        '{"diagnostic_version":1,"stage":"'
                        + stage
                        + '","reason":"'
                        + reason
                        + '"}\n'
                    ).encode("ascii")
                    self.assertEqual(
                        DRIVER.parse_inspector_failure(b"", payload),
                        (stage, reason),
                    )

        invalid_pairs = (
            ("report_helper_failed", "not_applicable"),
            ("report_helper_failed", "unsupported_archive_version"),
            ("report_helper_failed", "invalid_output"),
            ("pg_restore_list_rejected", "unknown_toc_class"),
            ("pg_restore_version_failed", "migration_metadata_unreadable"),
            ("pg_restore_version_failed", "unsupported_archive_version"),
            ("pg_restore_version_failed", "invalid_archive"),
            ("pg_restore_version_failed", "truncated_archive"),
            ("snapshot_copy_failed", "other_nonzero"),
            ("pg_restore_list_empty", "timeout"),
        )
        for stage, reason in invalid_pairs:
            with self.subTest(invalid_stage=stage, invalid_reason=reason):
                payload = (
                    '{"diagnostic_version":1,"stage":"'
                    + stage
                    + '","reason":"'
                    + reason
                    + '"}\n'
                ).encode("ascii")
                self.assertEqual(
                    DRIVER.parse_inspector_failure(b"", payload),
                    ("inspector_diagnostic_invalid", "other_nonzero"),
                )
                error = DRIVER.InspectorStageError(stage, reason)
                self.assertEqual(
                    (error.stage, error.reason),
                    ("inspector_diagnostic_invalid", "other_nonzero"),
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

    def test_object_analysis_parser_binds_complete_and_incomplete_reports(self):
        complete = DRIVER.parse_report_object_analysis(
            synthetic_object_analysis_report(unresolved_total=0)
        )
        self.assertEqual(
            complete,
            {
                "object_reference_analysis": "COMPLETE",
                "migration_duplicate_analysis": "COMPLETE",
                "restore_planning_gate": "BLOCKED",
                "unresolved_known_toc_entries": 0,
                "unresolved_known_toc_class_counts": {
                    object_class: 0
                    for object_class in DRIVER.UNRESOLVED_OBJECT_CLASS_ALLOWLIST
                },
            },
        )

        incomplete = DRIVER.parse_report_object_analysis(
            synthetic_object_analysis_report(
                unresolved_total=2,
                unresolved_class="EXTENSION",
            )
        )
        self.assertEqual(incomplete["object_reference_analysis"], "INCOMPLETE")
        self.assertEqual(incomplete["migration_duplicate_analysis"], "INCOMPLETE")
        self.assertEqual(incomplete["restore_planning_gate"], "BLOCKED")
        self.assertEqual(incomplete["unresolved_known_toc_entries"], 2)
        self.assertEqual(
            incomplete["unresolved_known_toc_class_counts"]["EXTENSION"], 2
        )
        self.assertEqual(
            sum(incomplete["unresolved_known_toc_class_counts"].values()), 2
        )

    def test_object_analysis_parser_rejects_invalid_matrix_counts_and_keys(self):
        valid = synthetic_object_analysis_report(unresolved_total=1)
        invalid_reports = {
            "complete status with unresolved entries": valid.replace(
                "object_reference_analysis: INCOMPLETE",
                "object_reference_analysis: COMPLETE",
            ),
            "duplicate analysis falsely complete": valid.replace(
                "migration_duplicate_analysis: INCOMPLETE",
                "migration_duplicate_analysis: COMPLETE",
            ),
            "nonblocked restore gate": valid.replace(
                "restore_planning_gate: BLOCKED",
                "restore_planning_gate: READY",
            ),
            "class count differs from total": valid.replace("TABLE: 1", "TABLE: 0"),
            "unresolved total exceeds TOC": valid.replace(
                "unresolved_known_toc_entries: 1",
                "unresolved_known_toc_entries: 2",
            ),
            "unknown class key": valid.replace("TABLE: 1", "FUTURE OBJECT: 1"),
            "missing status": valid.replace(
                "object_reference_analysis: INCOMPLETE\n", ""
            ),
            "duplicate status": valid.replace(
                "object_reference_analysis: INCOMPLETE",
                "object_reference_analysis: INCOMPLETE\n"
                "object_reference_analysis: INCOMPLETE",
            ),
            "alternate ready status alongside blocked": valid.replace(
                "restore_planning_gate: BLOCKED",
                "restore_planning_gate: BLOCKED\nrestore_planning_gate: READY",
            ),
            "alternate inspection status alongside review required": valid.replace(
                "inspection_status: REVIEW_REQUIRED",
                "inspection_status: REVIEW_REQUIRED\ninspection_status: READY",
            ),
            "missing count block": valid.replace(
                DRIVER.UNRESOLVED_CLASS_COUNT_HEADER,
                "MISSING UNRESOLVED CLASS COUNTS",
            ),
            "duplicate count block": valid
            + DRIVER.UNRESOLVED_CLASS_COUNT_HEADER
            + "\n",
        }
        for label, report in invalid_reports.items():
            with self.subTest(label=label):
                with self.assertRaises(DRIVER.WorkflowError):
                    DRIVER.parse_report_object_analysis(report)

    def test_incomplete_report_rejects_every_unreviewed_or_leaking_line(self):
        valid = synthetic_object_analysis_report(unresolved_total=1)
        sentinels = (
            "SYNTHETIC_SECRET_MUST_NOT_APPEAR",
            "SYNTHETIC_ROW_PAYLOAD_MUST_NOT_APPEAR",
            "/private/SYNTHETIC_PATH_MUST_NOT_APPEAR",
            "SYNTHETIC_FILENAME_MUST_NOT_APPEAR.backup",
            "SYNTHETIC_OBJECT_NAME_MUST_NOT_APPEAR",
            "1; 1259 100 TABLE private secret owner",
            "SELECT SYNTHETIC_SQL_MUST_NOT_APPEAR",
        )
        for sentinel in sentinels:
            with self.subTest(sentinel=sentinel.split(" ", 1)[0]):
                with self.assertRaises(DRIVER.WorkflowError):
                    DRIVER.parse_report_object_analysis(valid + sentinel + "\n")

    def test_incomplete_report_grammar_rejects_duplicate_safe_fields_and_bad_arithmetic(self):
        valid = synthetic_object_analysis_report(unresolved_total=1)
        poisoned_reports = {
            "duplicate source version carrying secret": valid.replace(
                "source_postgresql_version: 17.5\n",
                "source_postgresql_version: 17.5\n"
                "source_postgresql_version: "
                "17.5SYNTHETIC_SECRET_MUST_NOT_APPEAR\n",
            ),
            "duplicate size": valid.replace(
                "size_bytes: 23\n",
                "size_bytes: 23\nsize_bytes: 999999\n",
            ),
            "duplicate pg_restore version": valid.replace(
                "pg_restore_version: 17.5\n",
                "pg_restore_version: 17.5\npg_restore_version: 17.999\n",
            ),
            "duplicate TOC metadata count": valid.replace(
                "toc_metadata_entries: 1\n",
                "toc_metadata_entries: 1\ntoc_metadata_entries: 999\n",
            ),
            "TOC aggregate arithmetic mismatch": valid.replace(
                "toc_metadata_entries: 1\n",
                "toc_metadata_entries: 0\n",
            ),
            "reviewed fields out of order": valid.replace(
                "source_postgresql_version: 17.5\n"
                "source_pg_dump_version: 17.5\n",
                "source_pg_dump_version: 17.5\n"
                "source_postgresql_version: 17.5\n",
            ),
            "missing canonical final LF": valid[:-1],
            "noncanonical CRLF framing": valid.replace("\n", "\r\n"),
        }
        for label, report in poisoned_reports.items():
            with self.subTest(label=label):
                with self.assertRaises(DRIVER.WorkflowError):
                    DRIVER.parse_report_object_analysis(report)

    def test_complete_and_incomplete_reports_reject_unsafe_source_version_payloads(self):
        unsafe_values = (
            "17.5SYNTHETIC_VERSION_SHAPED_PAYLOAD_MUST_NOT_APPEAR",
            "17.5VERSIONLEAK",
            "17.5+vendor",
        )
        for unresolved_total in (0, 1):
            valid = synthetic_object_analysis_report(
                unresolved_total=unresolved_total
            )
            for field in (
                "source_postgresql_version",
                "source_pg_dump_version",
            ):
                for unsafe in unsafe_values:
                    with self.subTest(
                        unresolved_total=unresolved_total,
                        field=field,
                        unsafe=unsafe,
                    ):
                        poisoned = valid.replace(
                            f"{field}: 17.5\n",
                            f"{field}: {unsafe}\n",
                        )
                        self.assertNotEqual(poisoned, valid)
                        with self.assertRaises(DRIVER.WorkflowError):
                            DRIVER.parse_report_object_analysis(poisoned)

            redacted = valid.replace(
                "source_postgresql_version: 17.5\n",
                "source_postgresql_version: REDACTED_UNSAFE_OR_UNRECOGNIZED\n",
            ).replace(
                "source_pg_dump_version: 17.5\n",
                "source_pg_dump_version: REDACTED_UNSAFE_OR_UNRECOGNIZED\n",
            )
            parsed = DRIVER.parse_report_object_analysis(redacted)
            self.assertEqual(parsed["restore_planning_gate"], "BLOCKED")
            for unsafe in unsafe_values:
                self.assertNotIn(unsafe, redacted)

    def test_provenance_and_completion_marker_never_encode_restore_ready(self):
        analysis = DRIVER.parse_report_object_analysis(
            synthetic_object_analysis_report(unresolved_total=1)
        )
        provenance = {
            "inspection_status": "REVIEW_REQUIRED",
            **analysis,
        }
        self.assertEqual(
            DRIVER.validate_provenance_object_analysis(provenance), analysis
        )
        marker = json.loads(DRIVER.completion_marker_bytes("synthetic-run", "a" * 64))
        self.assertEqual(marker["inspection_status"], "REVIEW_REQUIRED")
        self.assertEqual(marker["restore_planning_gate"], "BLOCKED")
        self.assertNotIn("READY", json.dumps(marker))
        self.assertNotIn("GREEN", json.dumps(marker))

        for mutation in (
            {"restore_planning_gate": "READY"},
            {"object_reference_analysis": "COMPLETE"},
            {"migration_duplicate_analysis": "COMPLETE"},
            {"unresolved_known_toc_entries": 0},
            {"unresolved_known_toc_class_counts": {"TABLE": 1}},
        ):
            with self.subTest(mutation=next(iter(mutation))):
                with self.assertRaises(DRIVER.WorkflowError):
                    DRIVER.validate_provenance_object_analysis(
                        provenance | mutation
                    )

    def test_fully_rehashed_ready_mutation_fails_both_evidence_tree_validators(self):
        run_id = "rehearsal-20300102T030405Z-rehashedready"
        run_root = self.checkout / "local-migration-artifacts" / run_id
        pending = run_root / ".pending"
        run_root.parent.mkdir(mode=0o700, exist_ok=True)
        run_root.mkdir(mode=0o700)
        pending.mkdir(mode=0o700)
        (pending / "archive").mkdir(mode=0o700)
        (pending / "inspection").mkdir(mode=0o700)
        report, provenance = synthetic_package_report_and_provenance(run_id)
        payloads = {
            "archive/outer.expected.sha256": ("a" * 64 + "\n").encode(),
            "archive/outer.workflow-observed.before.sha256": (
                "a" * 64 + "\n"
            ).encode(),
            "archive/outer.workflow-observed.after.sha256": (
                "a" * 64 + "\n"
            ).encode(),
            "inspection/rehearsal-metadata.txt": report,
            "inspection/report.sha256": (
                hashlib.sha256(report).hexdigest() + "\n"
            ).encode(),
            "provenance.json": provenance,
            "provenance.sha256": (
                hashlib.sha256(provenance).hexdigest() + "\n"
            ).encode(),
        }
        for relative, data in payloads.items():
            DRIVER.write_exclusive(pending / relative, data)
        DRIVER.build_evidence_file_manifest(pending, run_id)
        DRIVER.validate_evidence_tree(pending, run_id)
        descriptor = os.open(pending, os.O_RDONLY)
        try:
            DRIVER.validate_evidence_tree_at(descriptor, run_id)
        finally:
            os.close(descriptor)

        ready_report = report.replace(
            b"restore_planning_gate: BLOCKED",
            b"restore_planning_gate: READY",
        )
        ready_provenance = json.loads(provenance)
        ready_provenance["restore_planning_gate"] = "READY"
        ready_provenance_bytes = (
            json.dumps(ready_provenance, sort_keys=True) + "\n"
        ).encode("utf-8")
        replacements = {
            pending / "inspection/rehearsal-metadata.txt": ready_report,
            pending / "inspection/report.sha256": (
                hashlib.sha256(ready_report).hexdigest() + "\n"
            ).encode(),
            pending / "provenance.json": ready_provenance_bytes,
            pending / "provenance.sha256": (
                hashlib.sha256(ready_provenance_bytes).hexdigest() + "\n"
            ).encode(),
        }
        for path, data in replacements.items():
            path.chmod(0o600)
            path.write_bytes(data)
            path.chmod(0o400)
        (pending / "evidence-files.json").unlink()
        (pending / "evidence-files.sha256").unlink()
        DRIVER.build_evidence_file_manifest(pending, run_id)

        with self.assertRaises(DRIVER.WorkflowError):
            DRIVER.validate_evidence_tree(pending, run_id)
        descriptor = os.open(pending, os.O_RDONLY)
        try:
            with self.assertRaises(DRIVER.WorkflowError):
                DRIVER.validate_evidence_tree_at(descriptor, run_id)
        finally:
            os.close(descriptor)

        durable_parent = self.evidence_store / DRIVER.DURABLE_EVIDENCE_DIRECTORY
        self.assertFalse((durable_parent / run_id).exists())
        self.assertFalse((durable_parent / f".{run_id}.pending").exists())
        DRIVER.remove_incomplete_run(run_root)

    def test_fully_rehashed_duplicate_and_unknown_provenance_fields_fail_both_validators(self):
        poisoners = {
            "ready-then-blocked-duplicate": lambda provenance: provenance.replace(
                b'"restore_planning_gate": "BLOCKED"',
                b'"restore_planning_gate": "READY", '
                b'"restore_planning_gate": "BLOCKED"',
                1,
            ),
            "blocked-then-ready-duplicate": lambda provenance: provenance.replace(
                b'"restore_planning_gate": "BLOCKED"',
                b'"restore_planning_gate": "BLOCKED", '
                b'"restore_planning_gate": "READY"',
                1,
            ),
            "nested-duplicate": lambda provenance: provenance.replace(
                b'"compatibility": "PASS"',
                b'"compatibility": "FAIL", "compatibility": "PASS"',
                1,
            ),
            "unknown-green-readiness": lambda provenance: provenance.replace(
                b'{',
                b'{"migration_readiness": "GREEN", ',
                1,
            ),
            "unknown-nested-green-readiness": lambda provenance: provenance.replace(
                b'"durable_publication": {',
                b'"durable_publication": {"migration_readiness": "GREEN", ',
                1,
            ),
            "nested-green-in-scalar-field": lambda provenance: provenance.replace(
                b'"operator_identity": "Synthetic Operator"',
                b'"operator_identity": {"migration_readiness": "GREEN"}',
                1,
            ),
            "nonfinite-number": lambda provenance: provenance.replace(
                b'"root_owner_uid": 1000',
                b'"root_owner_uid": NaN',
                1,
            ),
        }
        workspace = self.checkout / "local-migration-artifacts"
        workspace.mkdir(mode=0o700, exist_ok=True)

        for index, (label, poison) in enumerate(poisoners.items(), start=1):
            with self.subTest(label=label):
                run_id = f"rehearsal-20300102T030405Z-jsonpoison{index}"
                run_root, pending, _, provenance = (
                    self.build_synthetic_pending_package(run_id)
                )
                DRIVER.validate_evidence_tree(pending, run_id)
                descriptor = os.open(pending, os.O_RDONLY)
                try:
                    DRIVER.validate_evidence_tree_at(descriptor, run_id)
                finally:
                    os.close(descriptor)

                poisoned = poison(provenance)
                self.assertNotEqual(poisoned, provenance)
                self.rebuild_manifest_after_provenance_change(
                    pending,
                    poisoned,
                    run_id,
                )
                bound = self.bind_synthetic_canonical()
                try:
                    self.assert_both_evidence_validators_reject(
                        pending,
                        run_id,
                        run_root=run_root,
                        bound=bound,
                    )
                finally:
                    bound.close()
                DRIVER.remove_incomplete_run(run_root)

    def test_fully_rehashed_contradictory_identity_fields_cannot_publish(self):
        mutations = {
            "approved-checkout-disagrees": (
                ("approved_execution_checkout_sha",),
                "b" * 40,
            ),
            "driver-path-disagrees": (
                ("execution_tools", "driver", "path"),
                "scripts/migration/unreviewed-driver.py",
            ),
            "driver-hash-disagrees": (
                ("execution_tools", "driver", "sha256"),
                "b" * 64,
            ),
            "source-ref-disagrees": (
                ("lovable_source_project", "repository_binding", "declared_project_id"),
                "zyxwvutsrqponmlkjihg",
            ),
            "outer-filename-disagrees": (
                ("outer_artifact", "workflow_observed_identity", "original_filename"),
                "substituted.backup",
            ),
            "outer-size-disagrees": (
                ("outer_artifact", "workflow_observed_identity", "size_bytes_after"),
                24,
            ),
            "outer-hash-disagrees": (
                ("outer_artifact", "workflow_observed_identity", "sha256_after"),
                "b" * 64,
            ),
            "normalizer-hash-disagrees": (
                ("outer_artifact", "normalizer_sha256", "after"),
                "b" * 64,
            ),
            "checksum-path-disagrees": (
                ("outer_artifact", "checksum_files", "expected"),
                "archive/substituted.sha256",
            ),
            "inner-hash-disagrees": (
                ("inner_pgdmp", "inspector_reported_sha256"),
                "b" * 64,
            ),
            "header-hash-disagrees": (
                ("inner_pgdmp", "pgdmp_header", "bound_to_inner_sha256"),
                "b" * 64,
            ),
            "report-hash-disagrees": (
                ("report", "sha256"),
                "b" * 64,
            ),
            "canonical-mode-is-list": (
                ("evidence_store", "canonical_mode"),
                ["0400"],
            ),
            "operator-is-green-object": (
                ("operator_identity",),
                {"migration_readiness": "GREEN"},
            ),
            "durable-path-disagrees": (
                ("durable_publication", "relative_directory"),
                "migration-inspection-evidence/other-run",
            ),
        }
        for index, (label, (path, replacement)) in enumerate(
            mutations.items(), start=1
        ):
            with self.subTest(label=label):
                run_id = f"rehearsal-20300102T030405Z-bindingpoison{index}"
                run_root, pending, _, provenance_bytes = (
                    self.build_synthetic_pending_package(run_id)
                )
                DRIVER.validate_evidence_tree(pending, run_id)
                provenance = json.loads(provenance_bytes)
                target = provenance
                for member in path[:-1]:
                    target = target[member]
                target[path[-1]] = replacement
                poisoned = (json.dumps(provenance, sort_keys=True) + "\n").encode()
                self.rebuild_manifest_after_provenance_change(
                    pending,
                    poisoned,
                    run_id,
                )
                bound = self.bind_synthetic_canonical()
                try:
                    self.assert_both_evidence_validators_reject(
                        pending,
                        run_id,
                        run_root=run_root,
                        bound=bound,
                    )
                finally:
                    bound.close()
                DRIVER.remove_incomplete_run(run_root)

    def test_fully_rehashed_outer_checksum_bytes_cannot_disagree_or_publish(self):
        for index, relative in enumerate(
            (
                "archive/outer.expected.sha256",
                "archive/outer.workflow-observed.before.sha256",
                "archive/outer.workflow-observed.after.sha256",
            ),
            start=1,
        ):
            with self.subTest(relative=relative):
                run_id = f"rehearsal-20300102T030405Z-checksumpoison{index}"
                run_root, pending, _, _ = self.build_synthetic_pending_package(
                    run_id
                )
                self.replace_private_file(
                    pending / relative,
                    ("b" * 64 + "\n").encode(),
                )
                (pending / "evidence-files.json").unlink()
                (pending / "evidence-files.sha256").unlink()
                DRIVER.build_evidence_file_manifest(pending, run_id)
                bound = self.bind_synthetic_canonical()
                try:
                    self.assert_both_evidence_validators_reject(
                        pending,
                        run_id,
                        run_root=run_root,
                        bound=bound,
                    )
                finally:
                    bound.close()
                DRIVER.remove_incomplete_run(run_root)

    def test_fully_rehashed_manifest_contract_poison_fails_both_validators(self):
        poisoners = {
            "nested-bad-first-good-last-duplicate": lambda manifest: manifest.replace(
                b'"mode": "0400",',
                b'"mode": "0777",\n      "mode": "0400",',
                1,
            ),
            "boolean-format-version": lambda manifest: manifest.replace(
                b'"format_version": 1',
                b'"format_version": true',
                1,
            ),
            "nonfinite-size": lambda manifest: re.sub(
                rb'"size_bytes": [0-9]+',
                b'"size_bytes": Infinity',
                manifest,
                count=1,
            ),
            "wrong-self-hash-boundary": lambda manifest: manifest.replace(
                DRIVER.EVIDENCE_MANIFEST_SELF_HASH_BOUNDARY.encode(),
                b"migration readiness is GREEN",
                1,
            ),
        }
        for index, (label, poison) in enumerate(poisoners.items(), start=1):
            with self.subTest(label=label):
                run_id = f"rehearsal-20300102T030405Z-manifestpoison{index}"
                run_root, pending, _, _ = self.build_synthetic_pending_package(
                    run_id
                )
                manifest_path = pending / "evidence-files.json"
                manifest = manifest_path.read_bytes()
                poisoned = poison(manifest)
                self.assertNotEqual(poisoned, manifest)
                self.replace_private_file(manifest_path, poisoned)
                self.replace_private_file(
                    pending / "evidence-files.sha256",
                    (hashlib.sha256(poisoned).hexdigest() + "\n").encode(),
                )

                self.assert_both_evidence_validators_reject(pending, run_id)
                DRIVER.remove_incomplete_run(run_root)

    def test_complete_object_analysis_may_retain_incomplete_duplicate_analysis_only(self):
        report = synthetic_object_analysis_report(
            unresolved_total=0,
            duplicate_status="INCOMPLETE",
        )
        analysis = DRIVER.parse_report_object_analysis(report)
        self.assertEqual(analysis["object_reference_analysis"], "COMPLETE")
        self.assertEqual(analysis["migration_duplicate_analysis"], "INCOMPLETE")
        self.assertEqual(analysis["restore_planning_gate"], "BLOCKED")
        provenance = {"inspection_status": "REVIEW_REQUIRED", **analysis}
        self.assertEqual(
            DRIVER.validate_provenance_object_analysis(provenance),
            analysis,
        )

        invalid = synthetic_object_analysis_report(
            unresolved_total=1,
            duplicate_status="COMPLETE",
        )
        with self.assertRaises(DRIVER.WorkflowError):
            DRIVER.parse_report_object_analysis(invalid)

    def test_fully_rehashed_incomplete_report_poison_fails_both_tree_validators(self):
        poisoners = {
            "duplicate-source-secret": lambda report: report.replace(
                b"source_postgresql_version: 17.5\n",
                b"source_postgresql_version: 17.5\n"
                b"source_postgresql_version: "
                b"17.5SYNTHETIC_SECRET_MUST_NOT_APPEAR\n",
            ),
            "duplicate-size": lambda report: report.replace(
                b"size_bytes: 23\n",
                b"size_bytes: 23\nsize_bytes: 999999\n",
            ),
            "duplicate-pg-version": lambda report: report.replace(
                b"pg_restore_version: 17.5\n",
                b"pg_restore_version: 17.5\npg_restore_version: 17.999\n",
            ),
            "duplicate-toc-metadata": lambda report: report.replace(
                b"toc_metadata_entries: 1\n",
                b"toc_metadata_entries: 1\ntoc_metadata_entries: 999\n",
            ),
            "bad-toc-arithmetic": lambda report: report.replace(
                b"toc_metadata_entries: 1\n",
                b"toc_metadata_entries: 0\n",
            ),
            "reordered-source-fields": lambda report: report.replace(
                b"source_postgresql_version: 17.5\n"
                b"source_pg_dump_version: 17.5\n",
                b"source_pg_dump_version: 17.5\n"
                b"source_postgresql_version: 17.5\n",
            ),
        }
        workspace = self.checkout / "local-migration-artifacts"
        workspace.mkdir(mode=0o700, exist_ok=True)

        for index, (label, poison) in enumerate(poisoners.items(), start=1):
            with self.subTest(label=label):
                run_id = f"rehearsal-20300102T030405Z-reportpoison{index}"
                run_root = workspace / run_id
                pending = run_root / ".pending"
                run_root.mkdir(mode=0o700)
                pending.mkdir(mode=0o700)
                (pending / "archive").mkdir(mode=0o700)
                (pending / "inspection").mkdir(mode=0o700)
                report, provenance = synthetic_package_report_and_provenance(
                    run_id,
                    unresolved_total=1,
                )
                poisoned_report = poison(report)
                self.assertNotEqual(poisoned_report, report)
                payloads = {
                    "archive/outer.expected.sha256": ("a" * 64 + "\n").encode(),
                    "archive/outer.workflow-observed.before.sha256": (
                        "a" * 64 + "\n"
                    ).encode(),
                    "archive/outer.workflow-observed.after.sha256": (
                        "a" * 64 + "\n"
                    ).encode(),
                    "inspection/rehearsal-metadata.txt": report,
                    "inspection/report.sha256": (
                        hashlib.sha256(report).hexdigest() + "\n"
                    ).encode(),
                    "provenance.json": provenance,
                    "provenance.sha256": (
                        hashlib.sha256(provenance).hexdigest() + "\n"
                    ).encode(),
                }
                for relative, data in payloads.items():
                    DRIVER.write_exclusive(pending / relative, data)
                DRIVER.build_evidence_file_manifest(pending, run_id)
                DRIVER.validate_evidence_tree(pending, run_id)
                descriptor = os.open(pending, os.O_RDONLY)
                try:
                    DRIVER.validate_evidence_tree_at(descriptor, run_id)
                finally:
                    os.close(descriptor)

                report_path = pending / "inspection/rehearsal-metadata.txt"
                report_sha_path = pending / "inspection/report.sha256"
                report_path.chmod(0o600)
                report_path.write_bytes(poisoned_report)
                report_path.chmod(0o400)
                report_sha_path.chmod(0o600)
                report_sha_path.write_bytes(
                    (hashlib.sha256(poisoned_report).hexdigest() + "\n").encode()
                )
                report_sha_path.chmod(0o400)
                (pending / "evidence-files.json").unlink()
                (pending / "evidence-files.sha256").unlink()
                DRIVER.build_evidence_file_manifest(pending, run_id)

                with self.assertRaises(DRIVER.WorkflowError):
                    DRIVER.validate_evidence_tree(pending, run_id)
                descriptor = os.open(pending, os.O_RDONLY)
                try:
                    with self.assertRaises(DRIVER.WorkflowError):
                        DRIVER.validate_evidence_tree_at(descriptor, run_id)
                finally:
                    os.close(descriptor)
                DRIVER.remove_incomplete_run(run_root)

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
        self.assert_preflight_failure("execution procedure differs")

        self.tearDown()
        self.setUp()
        tracked_migration = next(
            (self.checkout / "supabase/migrations").glob("*.sql")
        )
        tracked_migration.write_text(
            tracked_migration.read_text() + "\n-- planted modification\n"
        )
        self.assert_preflight_failure("migration inputs differ")

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
