from __future__ import annotations

import contextlib
import hashlib
import importlib.util
import io
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "scripts" / "migration"
sys.path.insert(0, str(MIGRATION))

from lib import lovable_toc_contract as contract  # noqa: E402


def load_script(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


capture_tool = load_script("capture_lovable_toc", MIGRATION / "capture-lovable-toc.py")
ledger_tool = load_script(
    "validate_lovable_toc_ledger", MIGRATION / "validate-lovable-toc-ledger.py"
)


SHA_A = "a" * 64
SHA_B = "b" * 64
SHA_C = "c" * 64
GIT_A = "a" * 40
GIT_B = "b" * 40
POISON = "ROW_PAYLOAD SECRET_TOKEN /private/path object-name.sql"


def fake_repository_identity():
    return {
        "execution_checkout_sha": GIT_A,
        "README_md_blob_sha": GIT_B,
        "README_md_sha256": SHA_A,
        "run_lovable_toc_capture_sh_blob_sha": GIT_B,
        "run_lovable_toc_capture_sh_sha256": SHA_A,
        "capture_lovable_toc_envelope_py_blob_sha": GIT_B,
        "capture_lovable_toc_envelope_py_sha256": SHA_A,
        "capture_lovable_toc_py_blob_sha": GIT_B,
        "capture_lovable_toc_py_sha256": SHA_A,
        "bounded_pg_restore_py_blob_sha": GIT_B,
        "bounded_pg_restore_py_sha256": SHA_A,
        "inspect_lovable_export_py_blob_sha": GIT_B,
        "inspect_lovable_export_py_sha256": SHA_A,
        "lovable_toc_contract_py_blob_sha": GIT_B,
        "lovable_toc_contract_py_sha256": SHA_A,
        "lovable_dump_report_py_blob_sha": GIT_B,
        "lovable_dump_report_py_sha256": SHA_A,
        "normalize_lovable_export_py_blob_sha": GIT_B,
        "normalize_lovable_export_py_sha256": SHA_A,
    }


def fake_ledger_procedure_identity():
    return {
        "execution_checkout_sha": GIT_A,
        "README_md_blob_sha": GIT_B,
        "README_md_sha256": SHA_A,
        "validate_lovable_toc_ledger_py_blob_sha": GIT_B,
        "validate_lovable_toc_ledger_py_sha256": SHA_A,
        "lovable_toc_contract_py_blob_sha": GIT_B,
        "lovable_toc_contract_py_sha256": SHA_A,
        "lovable_toc_annotation_ledger_schema_json_blob_sha": GIT_B,
        "lovable_toc_annotation_ledger_schema_json_sha256": SHA_A,
    }


def write_fake_pg_restore(path: Path, ledger: Path, *, fail_list: bool = False):
    raw = (
        b"; Dumped from database version: 17.6\n"
        b"; Dumped by pg_dump version: 18.4\n"
        + f"1; 0 0 TABLE {POISON} owner\n".encode()
        + b"2; 0 0 TABLE DATA synthetic row-owner\n"
    )
    list_branch = (
        f"printf '%s' '{POISON}' >&2\nprintf '%s' '{POISON}'\nexit 7"
        if fail_list
        else "python3 - <<'PY'\nimport sys\nsys.stdout.buffer.write(" + repr(raw) + ")\nPY"
    )
    path.write_text(
        "#!/bin/sh\n"
        f"printf '%s\\n' \"$*\" >> '{ledger}'\n"
        "if [ \"$1\" = '--version' ]; then\n"
        "  printf '%s\\n' 'pg_restore (PostgreSQL) 18.4'\n"
        "  exit 0\n"
        "fi\n"
        "if [ \"$1\" = '--list' ]; then\n"
        f"  {list_branch}\n"
        "  exit $?\n"
        "fi\n"
        "exit 9\n",
        encoding="utf-8",
    )
    path.chmod(0o500)


def capture_environment(root: Path, archive: Path, pg_restore: Path):
    return {
        "TOC_REVIEW_INNER_ARCHIVE": str(archive),
        "TOC_REVIEW_OUTPUT_ROOT": str(root),
        "TOC_REVIEW_BOUNDED_TEMP_PARENT": str(root),
        "TOC_REVIEW_EVIDENCE_RUN_ID": "synthetic-run",
        "TOC_REVIEW_OUTER_SHA256": SHA_A,
        "TOC_REVIEW_INNER_SHA256": hashlib.sha256(archive.read_bytes()).hexdigest(),
        "TOC_REVIEW_EVIDENCE_MANIFEST_SHA256": SHA_B,
        "TOC_REVIEW_INSPECTION_CHECKOUT_SHA": GIT_B,
        "TOC_REVIEW_INSPECTION_PROCEDURE_SHA256": SHA_C,
        "TOC_REVIEW_APPROVED_EXECUTION_CHECKOUT_SHA": GIT_A,
        "TOC_REVIEW_EXECUTION_PYTHON": str(
            Path(sys.executable).resolve(strict=True)
        ),
        "TOC_REVIEW_APPROVED_EXECUTION_PYTHON_SHA256": hashlib.sha256(
            Path(sys.executable).resolve(strict=True).read_bytes()
        ).hexdigest(),
        "TOC_REVIEW_APPROVED_EXECUTION_PYTHON_VERSION": (
            f"{sys.implementation.name}:{sys.version_info.major}."
            f"{sys.version_info.minor}.{sys.version_info.micro}"
        ),
        "TOC_REVIEW_PG_RESTORE_BIN": str(pg_restore),
        "TOC_REVIEW_APPROVED_PG_RESTORE_SHA256": hashlib.sha256(pg_restore.read_bytes()).hexdigest(),
        "TOC_REVIEW_EXPECTED_ENTRY_COUNT": "2",
        "TOC_REVIEW_EXPECTED_DATA_REFERENCE_COUNT": "1",
    }


def ledger_for(entries, capture, capture_manifest_sha):
    metadata_id = next(entry.entry_id for entry in entries if not entry.is_data_reference)
    binding = capture["binding"]
    annotations = []
    for entry in entries:
        annotations.append(
            {
                "classification": "restore",
                "dependency_entry_ids": [],
                "dependency_review_complete": True,
                "entry_id": entry.entry_id,
                "managed_domain": "none",
                "manual_conflict_disposition": None,
                "metadata_parent_entry_id": metadata_id if entry.is_data_reference else None,
                "parent_entry_ids": [],
            }
        )
    return {
        "annotations": annotations,
        "artifact_kind": "lovable_toc_annotation_ledger",
        "capture_binding": {
            "capture_manifest_sha256": capture_manifest_sha,
            "evidence_manifest_sha256": binding["evidence_manifest_sha256"],
            "evidence_run_id": binding["evidence_run_id"],
            "execution_checkout_sha": binding["execution_checkout_sha"],
            "inner_archive_sha256": binding["inner_archive_sha256"],
            "inspection_checkout_sha": binding["inspection_checkout_sha"],
            "inspection_procedure_sha256": binding["inspection_procedure_sha256"],
            "outer_archive_sha256": binding["outer_archive_sha256"],
            "pg_restore_identity_sha256": contract.sha256_bytes(
                contract.canonical_json_bytes(capture["pg_restore_identity"])
            ),
            "procedure_identity_sha256": binding["procedure_identity_sha256"],
            "raw_toc_sha256": capture["raw_toc_sha256"],
            "raw_toc_size_bytes": capture["raw_toc_size_bytes"],
        },
        "format_version": 1,
        "global_handling": {
            "extension": "target_supported_only",
            "owner": "strip_and_rebind",
            "role": "exclude_source_roles",
            "schema": "selective_restore",
        },
        "managed_domain_handling": {
            domain: "not_present" for domain in contract.MANAGED_DOMAINS
        },
    }


class TocToolsIntegrationTest(unittest.TestCase):
    def test_capture_manifests_reject_boolean_versions_and_sizes(self):
        files = {"capture.json": b"x"}
        for value in (
            {
                "artifact_kind": "lovable_toc_capture_evidence",
                "files": [
                    {
                        "name": "capture.json",
                        "sha256": hashlib.sha256(b"x").hexdigest(),
                        "size_bytes": 1,
                    }
                ],
                "format_version": True,
            },
            {
                "artifact_kind": "lovable_toc_capture_evidence",
                "files": [
                    {
                        "name": "capture.json",
                        "sha256": hashlib.sha256(b"x").hexdigest(),
                        "size_bytes": True,
                    }
                ],
                "format_version": 1,
            },
        ):
            raw = contract.canonical_json_bytes(value)
            with self.subTest(value=value), self.assertRaisesRegex(
                contract.ContractError, "ledger_schema_invalid"
            ):
                ledger_tool._validate_evidence_manifest(
                    raw,
                    files,
                    expected_sha=hashlib.sha256(raw).hexdigest(),
                )

    def test_complete_private_package_shapes_are_git_ignored(self):
        generated_paths = (
            (
                "copied-private/toc-capture-synthetic/capture.json",
                "**/toc-capture-*/",
            ),
            (
                "copied-private/toc-capture-synthetic/evidence-files.json",
                "**/toc-capture-*/",
            ),
            (
                "copied-private/toc-ledger-synthetic/classification-result.json",
                "**/toc-ledger-*/",
            ),
            (
                "copied-private/toc-ledger-synthetic/evidence-files.json",
                "**/toc-ledger-*/",
            ),
            (
                "copied-private/.pending-capture-synthetic/capture.json",
                "**/.pending-capture-*/",
            ),
            (
                "copied-private/.pending-ledger-synthetic/classification-result.json",
                "**/.pending-ledger-*/",
            ),
            (
                "copied-private/.indeterminate-capture-synthetic/evidence-files.json",
                "**/.indeterminate-capture-*/",
            ),
            (
                "copied-private/.indeterminate-ledger-synthetic/evidence-files.json",
                "**/.indeterminate-ledger-*/",
            ),
        )
        for generated_path, expected_pattern in generated_paths:
            with self.subTest(generated_path=generated_path):
                result = subprocess.run(
                    (
                        "git",
                        "check-ignore",
                        "--no-index",
                        "--verbose",
                        "--",
                        generated_path,
                    ),
                    cwd=ROOT,
                    check=False,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL,
                )
                self.assertEqual(result.returncode, 0)
                if expected_pattern.encode("ascii") not in result.stdout:
                    self.fail("private package ignore rule mismatch")

    def make_fixture(self, temporary: str, *, fail_list: bool = False):
        parent = Path(temporary)
        root = parent / "evidence"
        root.mkdir(mode=0o700)
        root = root.resolve()
        archive = parent / "inner.backup"
        archive.write_bytes(b"PGDMP\x01synthetic")
        archive.chmod(0o400)
        child_ledger = parent / "child-ledger"
        pg_restore = parent / "pg_restore"
        write_fake_pg_restore(pg_restore, child_ledger, fail_list=fail_list)
        return root, archive, pg_restore, child_ledger

    def test_capture_invokes_only_version_and_list_and_publishes_private_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root, archive, pg_restore, child_ledger = self.make_fixture(temporary)
            environment = capture_environment(root, archive, pg_restore)
            with mock.patch.object(
                capture_tool, "_repository_binding", return_value=fake_repository_identity()
            ):
                counts, hashes = capture_tool.execute(environment)
            self.assertEqual(counts, {"data_reference_count": 1, "entry_count": 2})
            self.assertRegex(hashes["raw_toc_sha256"], r"^[0-9a-f]{64}$")
            invocations = child_ledger.read_text(encoding="utf-8").splitlines()
            self.assertEqual(invocations[0], "--version")
            self.assertEqual(invocations[1].split()[0], "--list")
            self.assertEqual(len(invocations), 2)
            package = next(path for path in root.iterdir() if path.name.startswith("toc-capture-"))
            self.assertEqual(stat.S_IMODE(package.stat().st_mode), 0o700)
            if POISON not in (package / "raw-pg-restore-list.toc").read_text():
                self.fail("private raw TOC sentinel missing")
            for path in package.iterdir():
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o400)
            capture = json.loads((package / "capture.json").read_bytes())
            self.assertEqual(capture["overall_status"], "REVIEW_REQUIRED")
            self.assertEqual(capture["review_gate"], "ANNOTATION_REQUIRED")
            self.assertEqual(capture["restore_planning_gate"], "BLOCKED")
            self.assertEqual(capture["restore_command_gate"], "BLOCKED")
            execution_python_identity = capture["execution_python_identity"]
            self.assertEqual(
                execution_python_identity["sha256"],
                environment["TOC_REVIEW_APPROVED_EXECUTION_PYTHON_SHA256"],
            )
            self.assertEqual(
                execution_python_identity["reported_version"],
                environment["TOC_REVIEW_APPROVED_EXECUTION_PYTHON_VERSION"],
            )
            identity_digest = contract.sha256_bytes(
                contract.canonical_json_bytes(execution_python_identity)
            )
            self.assertEqual(
                capture["procedure_identity"]["execution_python_identity_sha256"],
                identity_digest,
            )

    def test_low_level_capture_rejects_execution_python_identity_before_tool_use(self):
        cases = ("wrong_sha", "wrong_version", "wrong_owner", "permissive_mode")
        for label in cases:
            with self.subTest(label=label), tempfile.TemporaryDirectory() as temporary:
                root, archive, pg_restore, child_ledger = self.make_fixture(temporary)
                environment = capture_environment(root, archive, pg_restore)
                if label == "wrong_sha":
                    environment["TOC_REVIEW_APPROVED_EXECUTION_PYTHON_SHA256"] = (
                        "0" * 64
                    )
                elif label == "wrong_version":
                    environment["TOC_REVIEW_APPROVED_EXECUTION_PYTHON_VERSION"] = (
                        "cpython:1.2.3"
                    )

                context = contextlib.nullcontext()
                if label in {"wrong_owner", "permissive_mode"}:
                    approved = capture_tool.stable_regular_digest(
                        Path(sys.executable).resolve(strict=True),
                        max_bytes=capture_tool.MAX_TOOL_BYTES,
                        require_executable=True,
                    )
                    values = dict(approved.__dict__)
                    if label == "wrong_owner":
                        values["owner_uid"] = max(1, os.geteuid() + 1)
                    else:
                        values["mode"] = 0o775
                    context = mock.patch.object(
                        capture_tool,
                        "stable_regular_digest",
                        return_value=type(approved)(**values),
                    )
                with context, self.assertRaisesRegex(
                    contract.ContractError, "binding_mismatch"
                ):
                    capture_tool.execute(environment)
                self.assertFalse(child_ledger.exists())
                self.assertEqual(list(root.iterdir()), [])

    def test_capture_internal_mode_is_fixed_name_and_descriptor_bound(self):
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary).resolve()
            stage = parent / "stage"
            stage.mkdir(mode=0o700)
            archive = stage / "verified-inner.pgdmp"
            archive.write_bytes(b"PGDMP\x01synthetic")
            archive.chmod(0o400)
            pg_restore = parent / "pg_restore"
            child_ledger = parent / "child-ledger"
            write_fake_pg_restore(pg_restore, child_ledger)
            environment = capture_environment(stage, archive, pg_restore)
            environment.update(
                {
                    "TOC_REVIEW_INNER_ARCHIVE": "verified-inner.pgdmp",
                    "TOC_REVIEW_OUTPUT_ROOT": ".",
                }
            )
            descriptor = os.open(
                stage,
                os.O_RDONLY
                | os.O_DIRECTORY
                | getattr(os, "O_NOFOLLOW", 0)
                | getattr(os, "O_CLOEXEC", 0),
            )
            environment["TOC_REVIEW_DESCRIPTOR_BOUND_WORKDIR_FD"] = str(descriptor)
            environment.pop("TOC_REVIEW_BOUNDED_TEMP_PARENT")
            environment["TOC_REVIEW_BOUNDED_TEMP_PARENT_FD"] = str(descriptor)
            previous = Path.cwd()
            try:
                os.chdir(stage)
                with mock.patch.object(
                    capture_tool,
                    "_repository_binding",
                    return_value=fake_repository_identity(),
                ):
                    counts, _ = capture_tool.execute(environment)
            finally:
                os.chdir(previous)
                os.close(descriptor)
            self.assertEqual(counts, {"data_reference_count": 1, "entry_count": 2})
            package = next(
                path for path in stage.iterdir() if path.name.startswith("toc-capture-")
            )
            self.assertTrue((package / "EVIDENCE_COMPLETE").is_file())
            self.assertEqual(len(child_ledger.read_text().splitlines()), 2)

    def test_capture_internal_mode_rejects_nonfixed_paths_before_tool_use(self):
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary).resolve()
            stage = parent / "stage"
            stage.mkdir(mode=0o700)
            archive = stage / "verified-inner.pgdmp"
            archive.write_bytes(b"PGDMP\x01synthetic")
            archive.chmod(0o400)
            pg_restore = parent / "pg_restore"
            child_ledger = parent / "child-ledger"
            write_fake_pg_restore(pg_restore, child_ledger)
            descriptor = os.open(
                stage,
                os.O_RDONLY
                | os.O_DIRECTORY
                | getattr(os, "O_NOFOLLOW", 0)
                | getattr(os, "O_CLOEXEC", 0),
            )
            environment = capture_environment(stage, archive, pg_restore)
            environment["TOC_REVIEW_DESCRIPTOR_BOUND_WORKDIR_FD"] = str(descriptor)
            environment.pop("TOC_REVIEW_BOUNDED_TEMP_PARENT")
            environment["TOC_REVIEW_BOUNDED_TEMP_PARENT_FD"] = str(descriptor)
            environment["TOC_REVIEW_OUTPUT_ROOT"] = str(stage)
            previous = Path.cwd()
            try:
                os.chdir(stage)
                with mock.patch.object(
                    capture_tool,
                    "_repository_binding",
                    return_value=fake_repository_identity(),
                ), self.assertRaisesRegex(contract.ContractError, "input_invalid"):
                    capture_tool.execute(environment)
            finally:
                os.chdir(previous)
                os.close(descriptor)
            self.assertFalse(child_ledger.exists())
            self.assertFalse(
                any(path.name.startswith("toc-capture-") for path in stage.iterdir())
            )

    def test_poisoned_child_failure_leaks_nothing_and_publishes_nothing(self):
        with tempfile.TemporaryDirectory() as temporary:
            root, archive, pg_restore, child_ledger = self.make_fixture(
                temporary, fail_list=True
            )
            environment = capture_environment(root, archive, pg_restore)
            error = io.BytesIO()
            captured_stderr = type("CapturedStderr", (), {"buffer": error})()
            with mock.patch.object(
                capture_tool, "_repository_binding", return_value=fake_repository_identity()
            ), mock.patch.dict(os.environ, environment, clear=True), mock.patch.object(sys, "stderr", captured_stderr):
                status = capture_tool.main()
            output = error.getvalue()
            self.assertEqual(status, 1)
            if POISON.encode() in output:
                self.fail("poisoned child output escaped")
            expected = {
                "diagnostic_version": 1,
                "reason": "tool_failed",
                "stage": "capture",
                "status": "failed",
            }
            try:
                observed = json.loads(output)
            except (UnicodeDecodeError, json.JSONDecodeError):
                self.fail("capture diagnostic was not canonical JSON")
            if observed != expected:
                self.fail("capture diagnostic contract mismatch")
            if any(root.iterdir()):
                self.fail("failed capture published output")
            self.assertEqual(len(child_ledger.read_text().splitlines()), 2)

    def test_poisoned_filename_is_not_relayed_by_fixed_failure(self):
        with tempfile.TemporaryDirectory() as temporary:
            root, archive, pg_restore, _ = self.make_fixture(temporary)
            poisoned_archive = archive.with_name("SENSITIVE_FILENAME_SENTINEL.backup")
            archive.rename(poisoned_archive)
            poisoned_archive.chmod(0o400)
            environment = capture_environment(root, poisoned_archive, pg_restore)
            environment["TOC_REVIEW_INNER_SHA256"] = "f" * 64
            error = io.BytesIO()
            captured_stderr = type("CapturedStderr", (), {"buffer": error})()
            with mock.patch.object(
                capture_tool, "_repository_binding", return_value=fake_repository_identity()
            ), mock.patch.dict(os.environ, environment, clear=True), mock.patch.object(sys, "stderr", captured_stderr):
                status = capture_tool.main()
            self.assertEqual(status, 1)
            if b"SENSITIVE_FILENAME_SENTINEL" in error.getvalue():
                self.fail("poisoned filename escaped")
            if any(root.iterdir()):
                self.fail("failed filename check published output")

    def test_full_capture_to_ledger_keeps_poison_only_in_private_raw_toc(self):
        with tempfile.TemporaryDirectory() as temporary:
            root, archive, pg_restore, _ = self.make_fixture(temporary)
            capture_env = capture_environment(root, archive, pg_restore)
            with mock.patch.object(
                capture_tool, "_repository_binding", return_value=fake_repository_identity()
            ):
                _, capture_hashes = capture_tool.execute(capture_env)
            capture_package = next(path for path in root.iterdir() if path.name.startswith("toc-capture-"))
            capture = json.loads((capture_package / "capture.json").read_text())
            raw = (capture_package / "raw-pg-restore-list.toc").read_bytes()
            key = (capture_package / "opaque-id.key").read_bytes()
            entries = contract.parse_raw_toc(raw, key)
            ledger_value = ledger_for(
                entries, capture, capture_hashes["capture_manifest_sha256"]
            )
            ledger_path = root / "annotations.json"
            ledger_path.write_bytes(contract.canonical_json_bytes(ledger_value))
            ledger_path.chmod(0o400)
            environment = {
                "TOC_REVIEW_CAPTURE_ROOT": str(root),
                "TOC_REVIEW_CAPTURE_NAME": capture_package.name,
                "TOC_REVIEW_LEDGER": str(ledger_path),
                "TOC_REVIEW_OUTPUT_ROOT": str(root),
                "TOC_REVIEW_EXPECTED_CAPTURE_MANIFEST_SHA256": capture_hashes["capture_manifest_sha256"],
                "TOC_REVIEW_EXPECTED_RAW_TOC_SHA256": capture["raw_toc_sha256"],
                "TOC_REVIEW_EXPECTED_PROCEDURE_IDENTITY_SHA256": capture["binding"]["procedure_identity_sha256"],
                "TOC_REVIEW_EVIDENCE_RUN_ID": capture["binding"]["evidence_run_id"],
                "TOC_REVIEW_OUTER_SHA256": capture["binding"]["outer_archive_sha256"],
                "TOC_REVIEW_INNER_SHA256": capture["binding"]["inner_archive_sha256"],
                "TOC_REVIEW_EVIDENCE_MANIFEST_SHA256": capture["binding"]["evidence_manifest_sha256"],
                "TOC_REVIEW_INSPECTION_CHECKOUT_SHA": capture["binding"]["inspection_checkout_sha"],
                "TOC_REVIEW_INSPECTION_PROCEDURE_SHA256": capture["binding"]["inspection_procedure_sha256"],
                "TOC_REVIEW_APPROVED_EXECUTION_CHECKOUT_SHA": capture["binding"]["execution_checkout_sha"],
                "TOC_REVIEW_APPROVED_PG_RESTORE_SHA256": capture["pg_restore_identity"]["sha256"],
            }
            root_stop = root / ".indeterminate-toc-envelope-capture-synthetic"
            root_stop.write_bytes(b"synthetic stop marker\n")
            root_stop.chmod(0o400)
            with mock.patch.object(
                ledger_tool,
                "_verify_checkout",
                return_value=fake_ledger_procedure_identity(),
            ), self.assertRaisesRegex(contract.ContractError, "input_invalid"):
                ledger_tool.execute(environment)
            self.assertFalse(
                any(path.name.startswith("toc-ledger-") for path in root.iterdir())
            )
            root_stop.unlink()
            with mock.patch.object(
                ledger_tool,
                "_verify_checkout",
                return_value=fake_ledger_procedure_identity(),
            ):
                counts, hashes = ledger_tool.execute(environment)
            self.assertEqual(counts, {"data_reference_count": 1, "entry_count": 2, "unresolved_count": 0})
            self.assertRegex(hashes["ledger_sha256"], r"^[0-9a-f]{64}$")
            ledger_package = next(path for path in root.iterdir() if path.name.startswith("toc-ledger-"))
            retained = b"".join(path.read_bytes() for path in ledger_package.iterdir())
            if POISON.encode() in retained:
                self.fail("poisoned TOC content escaped private raw capture")
            result = json.loads((ledger_package / "classification-result.json").read_text())
            self.assertEqual(
                result["ledger_procedure_identity"],
                fake_ledger_procedure_identity(),
            )
            self.assertEqual(
                result["ledger_procedure_identity_sha256"],
                hashes["ledger_procedure_identity_sha256"],
            )
            self.assertEqual(result["restore_planning_gate"], "ELIGIBLE_FOR_HUMAN_REVIEW")
            self.assertEqual(result["restore_command_gate"], "BLOCKED")
            self.assertEqual(result["migration_readiness"], "RED")

    def test_ledger_must_be_descriptor_read_directly_beneath_private_output_root(self):
        with tempfile.TemporaryDirectory() as temporary:
            root, archive, pg_restore, _ = self.make_fixture(temporary)
            capture_env = capture_environment(root, archive, pg_restore)
            with mock.patch.object(
                capture_tool, "_repository_binding", return_value=fake_repository_identity()
            ):
                _, capture_hashes = capture_tool.execute(capture_env)
            capture_package = next(
                path for path in root.iterdir() if path.name.startswith("toc-capture-")
            )
            capture = json.loads((capture_package / "capture.json").read_text())
            entries = contract.parse_raw_toc(
                (capture_package / "raw-pg-restore-list.toc").read_bytes(),
                (capture_package / "opaque-id.key").read_bytes(),
            )
            ledger_bytes = contract.canonical_json_bytes(
                ledger_for(entries, capture, capture_hashes["capture_manifest_sha256"])
            )
            outside = Path(temporary) / "outside-ledger.json"
            outside.write_bytes(ledger_bytes)
            outside.chmod(0o400)
            environment = {
                "TOC_REVIEW_CAPTURE_ROOT": str(root),
                "TOC_REVIEW_CAPTURE_NAME": capture_package.name,
                "TOC_REVIEW_LEDGER": str(outside),
                "TOC_REVIEW_OUTPUT_ROOT": str(root),
                "TOC_REVIEW_EXPECTED_CAPTURE_MANIFEST_SHA256": capture_hashes["capture_manifest_sha256"],
                "TOC_REVIEW_EXPECTED_RAW_TOC_SHA256": capture["raw_toc_sha256"],
                "TOC_REVIEW_EXPECTED_PROCEDURE_IDENTITY_SHA256": capture["binding"]["procedure_identity_sha256"],
                "TOC_REVIEW_EVIDENCE_RUN_ID": capture["binding"]["evidence_run_id"],
                "TOC_REVIEW_OUTER_SHA256": capture["binding"]["outer_archive_sha256"],
                "TOC_REVIEW_INNER_SHA256": capture["binding"]["inner_archive_sha256"],
                "TOC_REVIEW_EVIDENCE_MANIFEST_SHA256": capture["binding"]["evidence_manifest_sha256"],
                "TOC_REVIEW_INSPECTION_CHECKOUT_SHA": capture["binding"]["inspection_checkout_sha"],
                "TOC_REVIEW_INSPECTION_PROCEDURE_SHA256": capture["binding"]["inspection_procedure_sha256"],
                "TOC_REVIEW_APPROVED_EXECUTION_CHECKOUT_SHA": capture["binding"]["execution_checkout_sha"],
                "TOC_REVIEW_APPROVED_PG_RESTORE_SHA256": capture["pg_restore_identity"]["sha256"],
            }
            with mock.patch.object(
                ledger_tool,
                "_verify_checkout",
                return_value=fake_ledger_procedure_identity(),
            ):
                with self.assertRaisesRegex(contract.ContractError, "input_invalid"):
                    ledger_tool.execute(environment)

                symlink = root / "annotations-symlink.json"
                symlink.symlink_to(outside)
                environment["TOC_REVIEW_LEDGER"] = str(symlink)
                with self.assertRaisesRegex(contract.ContractError, "input_invalid"):
                    ledger_tool.execute(environment)
                symlink.unlink()

                hardlink = root / "annotations-hardlink.json"
                os.link(outside, hardlink)
                environment["TOC_REVIEW_LEDGER"] = str(hardlink)
                with self.assertRaisesRegex(contract.ContractError, "input_invalid"):
                    ledger_tool.execute(environment)
                hardlink.unlink()

            self.assertFalse(
                any(path.name.startswith("toc-ledger-") for path in root.iterdir())
            )

    def test_wrong_hash_and_existing_output_fail_before_publication(self):
        with tempfile.TemporaryDirectory() as temporary:
            root, archive, pg_restore, child_ledger = self.make_fixture(temporary)
            environment = capture_environment(root, archive, pg_restore)
            environment["TOC_REVIEW_INNER_SHA256"] = "f" * 64
            with mock.patch.object(
                capture_tool, "_repository_binding", return_value=fake_repository_identity()
            ), self.assertRaisesRegex(contract.ContractError, "binding_mismatch"):
                capture_tool.execute(environment)
            self.assertFalse(child_ledger.exists())
            if any(root.iterdir()):
                self.fail("failed binding check published output")

    def test_archive_mutation_during_high_level_capture_publishes_nothing(self):
        with tempfile.TemporaryDirectory() as temporary:
            root, archive, pg_restore, _ = self.make_fixture(temporary)
            environment = capture_environment(root, archive, pg_restore)
            original_run = capture_tool._run_bounded

            def mutate_after_list(
                wrapper,
                executable,
                arguments,
                execution_python,
                *,
                temporary_parent_fd,
                temporary_parent,
            ):
                output = original_run(
                    wrapper,
                    executable,
                    arguments,
                    execution_python,
                    temporary_parent_fd=temporary_parent_fd,
                    temporary_parent=temporary_parent,
                )
                if arguments[0] == "--list":
                    archive.chmod(0o600)
                    archive.write_bytes(b"PGDMP\x02synthetic")
                    archive.chmod(0o400)
                return output

            with mock.patch.object(
                capture_tool,
                "_repository_binding",
                return_value=fake_repository_identity(),
            ), mock.patch.object(
                capture_tool, "_run_bounded", side_effect=mutate_after_list
            ):
                with self.assertRaisesRegex(
                    contract.ContractError, "input_mutated"
                ):
                    capture_tool.execute(environment)
            if any(root.iterdir()):
                self.fail("mutated capture published output")

    def test_blocked_published_ledger_is_not_cli_complete(self):
        output = io.BytesIO()
        captured_stdout = type("CapturedStdout", (), {"buffer": output})()
        with mock.patch.object(
            ledger_tool,
            "execute",
            return_value=(
                {
                    "data_reference_count": 1,
                    "entry_count": 2,
                    "unresolved_count": 1,
                },
                {
                    "ledger_sha256": SHA_A,
                    "ledger_procedure_identity_sha256": SHA_B,
                    "publication_manifest_sha256": SHA_C,
                },
            ),
        ), mock.patch.object(sys, "stdout", captured_stdout):
            status = ledger_tool.main()
        self.assertEqual(status, 2)
        self.assertEqual(
            json.loads(output.getvalue()),
            {
                "counts": {
                    "data_reference_count": 1,
                    "entry_count": 2,
                    "unresolved_count": 1,
                },
                "diagnostic_version": 1,
                "hashes": {
                    "ledger_procedure_identity_sha256": SHA_B,
                    "ledger_sha256": SHA_A,
                    "publication_manifest_sha256": SHA_C,
                },
                "reason": "blocked",
                "review_gate": "REVIEW_REQUIRED",
                "restore_planning_gate": "BLOCKED",
                "stage": "ledger",
                "status": "review_required",
            },
        )


if __name__ == "__main__":
    unittest.main()
