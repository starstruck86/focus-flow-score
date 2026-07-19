from __future__ import annotations

import datetime
import hashlib
import importlib.util
import json
import os
import shutil
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
PROBE_PATH = ROOT / "scripts/migration/probe-lovable-toc-capture-metadata.py"


def load_probe():
    spec = importlib.util.spec_from_file_location("toc_metadata_probe", PROBE_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("synthetic probe load failed")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


PROBE = load_probe()


def canonical(value) -> bytes:
    return (
        json.dumps(
            value,
            ensure_ascii=True,
            allow_nan=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("ascii")
        + b"\n"
    )


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def tree_snapshot(root: Path) -> dict[str, tuple[int, bytes | None]]:
    result: dict[str, tuple[int, bytes | None]] = {}
    for path in sorted(root.rglob("*"), key=lambda item: item.as_posix()):
        relative = path.relative_to(root).as_posix()
        metadata = path.lstat()
        data = path.read_bytes() if stat.S_ISREG(metadata.st_mode) else None
        result[relative] = (stat.S_IMODE(metadata.st_mode), data)
    return result


class MetadataProbeFixture:
    def __init__(self, root: Path):
        self.root = root
        self.root.mkdir(parents=True, mode=0o700, exist_ok=True)
        self.capture_root = root / "capture-root"
        self.package = self.capture_root / "toc-capture-synthetic"
        self.capture_root.mkdir(mode=0o700)
        self.package.mkdir(mode=0o700)
        self.raw = b"1; 1 1 TABLE synthetic private row payload sentinel\n"
        self.index = canonical(
            {
                "artifact_kind": "lovable_toc_opaque_index",
                "entries": [
                    {
                        "entry_id": "te1_" + "1" * 64,
                        "is_data_reference": False,
                        "object_class": "TABLE",
                        "ordinal": 0,
                    }
                ],
                "format_version": 1,
            }
        )
        self.key = b"K" * 32
        self.inspection_evidence = "a" * 64
        self.inspection_checkout = "b" * 40
        self.inspection_procedure = "c" * 64
        self.capture_checkout = "d" * 40
        self.outer = "e" * 64
        self.inner = "f" * 64
        self.run_id = "synthetic-run"
        self.execution_python_identity = {
            "approved_identity": "sha256:" + "1" * 64,
            "device": 101,
            "executable_path": "/synthetic/reviewed/python",
            "gid": 102,
            "inode": 103,
            "mode": "0755",
            "reported_version": "cpython:3.12.9",
            "sha256": "1" * 64,
            "size_bytes": 104,
            "uid": 105,
        }
        self.pg_identity = {
            "approved_identity": "sha256:" + "2" * 64,
            "device": 201,
            "executable_path": "/synthetic/reviewed/pg_restore",
            "gid": 202,
            "inode": 203,
            "mode": "0755",
            "reported_version": "pg_restore (PostgreSQL) 17.10",
            "sha256": "2" * 64,
            "size_bytes": 204,
            "uid": 205,
        }
        self.procedure = {}
        for key in PROBE.CAPTURE_PROCEDURE_IDENTITY_KEYS:
            self.procedure[key] = (
                "3" * 40
                if key.endswith("_blob_sha")
                or key in {"execution_checkout_sha", "inspection_checkout_sha"}
                else "4" * 64
            )
        self.procedure["execution_checkout_sha"] = self.capture_checkout
        self.procedure["inspection_checkout_sha"] = self.inspection_checkout
        self.procedure["inspection_procedure_sha256"] = self.inspection_procedure
        self.procedure["evidence_manifest_sha256"] = self.inspection_evidence
        self.procedure["execution_python_approved_sha256"] = "1" * 64
        self.procedure["execution_python_identity_sha256"] = digest(
            canonical(self.execution_python_identity)
        )
        self.capture_procedure = digest(canonical(self.procedure))
        self.capture: dict = {}
        self.manifest: dict = {}
        self._publish_metadata()
        metadata = self.capture_root.stat()
        self.procedure_identity = {
            "execution_checkout_sha": "5" * 40,
            "files": {
                label: {
                    "blob_sha": "6" * 40,
                    "path": relative,
                    "sha256": "7" * 64,
                }
                for label, relative in PROBE.PROCEDURE_PATH_KEYS
            },
            "format_version": 1,
        }
        expiry = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(
            hours=1
        )
        self.environment = {
            "CANDIDATE_DISCLOSURE": "RECORDED_OPAQUE_INDEX_SHA256_ONLY",
            "CEILINGS_ACCEPTED": (
                "TERMINAL_PARTIAL_WRITE_SAME_USER_PATH_SWAP_ATIME_AND_READ_ONLY_NONCE"
            ),
            "LANG": "C",
            "LC_ALL": "C",
            "NO_RETRY_AFTER_PRIVATE_ACCESS": "ACKNOWLEDGED",
            "TOC_INTERNAL_COMPONENT_BLOB": "8" * 40,
            "TOC_INTERNAL_COMPONENT_FD": "3",
            "TOC_INTERNAL_COMPONENT_PATH": os.fspath(PROBE_PATH),
            "TOC_INTERNAL_DIAGNOSTIC_FD": "4",
            "TOC_INTERNAL_PROCEDURE_IDENTITY_JSON": canonical(
                self.procedure_identity
            ).decode("ascii").rstrip("\n"),
            "TOC_INTERNAL_REPOSITORY_ROOT": os.fspath(ROOT),
            "TOC_REATTEST_APPROVED_EXECUTION_CHECKOUT_SHA": "5" * 40,
            "TOC_REATTEST_APPROVED_EXECUTION_PYTHON_DEVICE": "1",
            "TOC_REATTEST_APPROVED_EXECUTION_PYTHON_GID": "1",
            "TOC_REATTEST_APPROVED_EXECUTION_PYTHON_INODE": "1",
            "TOC_REATTEST_APPROVED_EXECUTION_PYTHON_MODE": "0755",
            "TOC_REATTEST_APPROVED_EXECUTION_PYTHON_SHA256": "9" * 64,
            "TOC_REATTEST_APPROVED_EXECUTION_PYTHON_SIZE_BYTES": "1",
            "TOC_REATTEST_APPROVED_EXECUTION_PYTHON_UID": "1",
            "TOC_REATTEST_APPROVED_EXECUTION_PYTHON_VERSION": "cpython:3.12.9",
            "TOC_REATTEST_APPROVED_PROCEDURE_IDENTITY_SHA256": digest(
                canonical(self.procedure_identity)
            ),
            "TOC_REATTEST_AUTHORIZER_IDENTITY": "SyntheticAuthorizer",
            "TOC_REATTEST_CAPTURE_PACKAGE_NAME": self.package.name,
            "TOC_REATTEST_CAPTURE_ROOT": os.fspath(self.capture_root),
            "TOC_REATTEST_ENCRYPTION_ATTESTATION": "APPROVED_ENCRYPTED_LOCAL_VOLUME",
            "TOC_REATTEST_EXECUTION_PYTHON": "/synthetic/python",
            "TOC_REATTEST_EXPECTED_CAPTURE_EVIDENCE_FILES_SHA256": digest(
                (self.package / "evidence-files.json").read_bytes()
            ),
            "TOC_REATTEST_EXPECTED_CAPTURE_EXECUTION_CHECKOUT_SHA": self.capture_checkout,
            "TOC_REATTEST_EXPECTED_CAPTURE_PROCEDURE_IDENTITY_SHA256": self.capture_procedure,
            "TOC_REATTEST_EXPECTED_DATA_REFERENCE_COUNT": "0",
            "TOC_REATTEST_EXPECTED_DEVICE": str(metadata.st_dev),
            "TOC_REATTEST_EXPECTED_ENTRY_COUNT": "1",
            "TOC_REATTEST_EXPECTED_GID": str(metadata.st_gid),
            "TOC_REATTEST_EXPECTED_HOST_ID": os.uname().nodename,
            "TOC_REATTEST_EXPECTED_INNER_ARCHIVE_SHA256": self.inner,
            "TOC_REATTEST_EXPECTED_INSPECTION_CHECKOUT_SHA": self.inspection_checkout,
            "TOC_REATTEST_EXPECTED_INSPECTION_EVIDENCE_MANIFEST_SHA256": self.inspection_evidence,
            "TOC_REATTEST_EXPECTED_INSPECTION_PROCEDURE_SHA256": self.inspection_procedure,
            "TOC_REATTEST_EXPECTED_OUTER_ARCHIVE_SHA256": self.outer,
            "TOC_REATTEST_EXPECTED_OUTPUT_DEVICE": "AUTO",
            "TOC_REATTEST_EXPECTED_OUTPUT_INODE": "AUTO",
            "TOC_REATTEST_EXPECTED_PG_RESTORE_DEVICE": "201",
            "TOC_REATTEST_EXPECTED_PG_RESTORE_GID": "202",
            "TOC_REATTEST_EXPECTED_PG_RESTORE_IDENTITY_SHA256": digest(
                canonical(self.pg_identity)
            ),
            "TOC_REATTEST_EXPECTED_PG_RESTORE_INODE": "203",
            "TOC_REATTEST_EXPECTED_PG_RESTORE_MODE": "0755",
            "TOC_REATTEST_EXPECTED_PG_RESTORE_PATH": self.pg_identity[
                "executable_path"
            ],
            "TOC_REATTEST_EXPECTED_PG_RESTORE_SHA256": "2" * 64,
            "TOC_REATTEST_EXPECTED_PG_RESTORE_SIZE_BYTES": "204",
            "TOC_REATTEST_EXPECTED_PG_RESTORE_UID": "205",
            "TOC_REATTEST_EXPECTED_PG_RESTORE_VERSION": self.pg_identity[
                "reported_version"
            ],
            "TOC_REATTEST_EXPECTED_RAW_TOC_SHA256": digest(self.raw),
            "TOC_REATTEST_EXPECTED_RUN_ID": self.run_id,
            "TOC_REATTEST_EXPECTED_UID": str(metadata.st_uid),
            "TOC_REATTEST_EXECUTING_OPERATOR_IDENTITY": "SyntheticOperator",
            "TOC_REATTEST_INDEPENDENT_REVIEWER_IDENTITY": "SyntheticReviewer",
            "TOC_REATTEST_METADATA_SESSION_EXPIRES_AT_UTC": expiry.strftime(
                "%Y-%m-%dT%H:%M:%SZ"
            ),
            "TOC_REATTEST_METADATA_SESSION_ID": "synthetic-metadata-session",
            "TOC_REATTEST_METADATA_SESSION_NONCE": "a" * 64,
            "TOC_REATTEST_OUTPUT_DESTINATION_ATTESTATION": "LOCAL_FOREGROUND_STDOUT_NO_RECORDING",
        }

    def _publish_metadata(self, *, rebuild_capture: bool = True) -> None:
        if rebuild_capture:
            self.capture = {
            "artifact_kind": "lovable_toc_private_capture",
            "binding": {
                "evidence_manifest_sha256": self.inspection_evidence,
                "evidence_run_id": self.run_id,
                "execution_checkout_sha": self.capture_checkout,
                "inner_archive_sha256": self.inner,
                "inspection_checkout_sha": self.inspection_checkout,
                "inspection_procedure_sha256": self.inspection_procedure,
                "outer_archive_sha256": self.outer,
                "procedure_identity_sha256": self.capture_procedure,
            },
            "capture_status": "CAPTURE_COMPLETE",
            "data_reference_count": 0,
            "entry_count": 1,
            "execution_python_identity": self.execution_python_identity,
            "format_version": 1,
            "opaque_index_sha256": digest(self.index),
            "opaque_key_sha256": digest(self.key),
            "overall_status": "REVIEW_REQUIRED",
            "pg_restore_identity": self.pg_identity,
            "procedure_identity": self.procedure,
            "raw_toc_sha256": digest(self.raw),
            "raw_toc_size_bytes": len(self.raw),
            "review_gate": "ANNOTATION_REQUIRED",
            "restore_command_gate": "BLOCKED",
            "restore_planning_gate": "BLOCKED",
            }
        payloads = {
            "capture.json": canonical(self.capture),
            "opaque-id.key": self.key,
            "opaque-index.json": self.index,
            "raw-pg-restore-list.toc": self.raw,
        }
        for name, data in payloads.items():
            path = self.package / name
            if path.exists():
                path.chmod(0o600)
            path.write_bytes(data)
            path.chmod(0o400)
        self.manifest = {
            "artifact_kind": "lovable_toc_capture_evidence",
            "files": [
                {"name": name, "sha256": digest(data), "size_bytes": len(data)}
                for name, data in sorted(payloads.items())
            ],
            "format_version": 1,
        }
        manifest_bytes = canonical(self.manifest)
        manifest_path = self.package / "evidence-files.json"
        if manifest_path.exists():
            manifest_path.chmod(0o600)
        manifest_path.write_bytes(manifest_bytes)
        manifest_path.chmod(0o400)
        marker_path = self.package / "EVIDENCE_COMPLETE"
        if marker_path.exists():
            marker_path.chmod(0o600)
        marker_path.write_bytes(
            canonical(
                {
                    "artifact_kind": "lovable_toc_capture_complete",
                    "evidence_files_sha256": digest(manifest_bytes),
                    "format_version": 1,
                }
            )
        )
        marker_path.chmod(0o400)

    def republish_capture(self) -> None:
        self._publish_metadata()
        self.environment["TOC_REATTEST_EXPECTED_CAPTURE_EVIDENCE_FILES_SHA256"] = digest(
            (self.package / "evidence-files.json").read_bytes()
        )


class LovableTocMetadataReattestationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="toc-metadata-probe.")
        self.root = Path(self.temporary.name).resolve()
        self.fixture = MetadataProbeFixture(self.root)

    def tearDown(self) -> None:
        PROBE._TEST_HOOK = None
        self.temporary.cleanup()

    def run_probe(self, environment: dict[str, str] | None = None) -> tuple[int, bytes]:
        read_fd, write_fd = os.pipe()
        selected = dict(self.fixture.environment if environment is None else environment)
        selected["TOC_INTERNAL_DIAGNOSTIC_FD"] = str(write_fd)
        output_identity = os.fstat(write_fd)
        if selected.get("TOC_REATTEST_EXPECTED_OUTPUT_DEVICE") == "AUTO":
            selected["TOC_REATTEST_EXPECTED_OUTPUT_DEVICE"] = str(
                output_identity.st_dev
            )
        if selected.get("TOC_REATTEST_EXPECTED_OUTPUT_INODE") == "AUTO":
            selected["TOC_REATTEST_EXPECTED_OUTPUT_INODE"] = str(
                output_identity.st_ino
            )
        try:
            with mock.patch.dict(os.environ, selected, clear=True):
                status = PROBE.main()
        finally:
            os.close(write_fd)
        output = b""
        while True:
            chunk = os.read(read_fd, 65536)
            if not chunk:
                break
            output += chunk
        os.close(read_fd)
        return status, output

    def assert_fixed_failure(self, output: bytes, reason: str) -> None:
        self.assertEqual(
            output,
            canonical(
                {
                    "diagnostic_version": 1,
                    "metadata_session_id": "synthetic-metadata-session",
                    "reason": reason,
                    "stage": "toc_capture_metadata_reattestation",
                    "status": "failed",
                }
            ),
        )
        self.assertNotIn(b"recorded_opaque_index_sha256", output)

    def test_exact_package_succeeds_with_exact_canonical_output(self) -> None:
        status, output = self.run_probe()
        self.assertEqual(status, 0)
        self.assertEqual(
            output,
            canonical(
                {
                    "archive_binding_match": True,
                    "capture_procedure_identity_match": True,
                    "checkout_binding_match": True,
                    "count_binding_match": True,
                    "diagnostic_version": 1,
                    "evidence_binding_match": True,
                    "manifest_binding_match": True,
                    "metadata_session_id": "synthetic-metadata-session",
                    "recorded_opaque_index_sha256": digest(self.fixture.index),
                    "run_binding_match": True,
                    "stage": "toc_capture_metadata_reattestation",
                    "status": "pass",
                    "tool_binding_match": True,
                }
            ),
        )

    def test_content_open_ledger_excludes_all_forbidden_files(self) -> None:
        opened: list[str] = []
        real_open = os.open

        def observed_open(path, flags, *args, **kwargs):
            opened.append(os.fspath(path))
            self.assertEqual(flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT), 0)
            return real_open(path, flags, *args, **kwargs)

        with mock.patch.object(PROBE.os, "open", side_effect=observed_open):
            status, _ = self.run_probe()
        self.assertEqual(status, 0)
        for forbidden in PROBE.FORBIDDEN_CONTENT_FILES:
            self.assertNotIn(forbidden, opened)
        for permitted in PROBE.PERMITTED_CONTENT_FILES:
            self.assertEqual(opened.count(permitted), 1)

    def test_same_length_forbidden_byte_changes_are_intentionally_unread(self) -> None:
        baseline_status, baseline = self.run_probe()
        self.assertEqual(baseline_status, 0)
        for name, replacement in (
            ("raw-pg-restore-list.toc", b"R" * len(self.fixture.raw)),
            ("opaque-index.json", b"I" * len(self.fixture.index)),
            ("opaque-id.key", b"Z" * 32),
        ):
            with self.subTest(name=name):
                path = self.fixture.package / name
                original = path.read_bytes()
                path.chmod(0o600)
                path.write_bytes(replacement)
                path.chmod(0o400)
                status, output = self.run_probe()
                self.assertEqual((status, output), (baseline_status, baseline))
                path.chmod(0o600)
                path.write_bytes(original)
                path.chmod(0o400)

    def test_forbidden_size_change_fails_without_opening_file(self) -> None:
        path = self.fixture.package / "opaque-index.json"
        path.chmod(0o600)
        path.write_bytes(self.fixture.index + b"x")
        path.chmod(0o400)
        status, output = self.run_probe()
        self.assertEqual(status, 1)
        self.assert_fixed_failure(output, "binding_mismatch")

    def test_package_shape_link_mode_owner_group_and_device_fail_closed(self) -> None:
        mutations = (
            "extra",
            "missing",
            "case_collision",
            "package_symlink",
            "file_symlink",
            "file_hardlink",
            "file_mode",
            "package_mode",
            "root_mode",
            "wrong_uid",
            "wrong_gid",
            "wrong_device",
        )
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                with tempfile.TemporaryDirectory(prefix="toc-probe-case.") as temporary:
                    fixture = MetadataProbeFixture(Path(temporary).resolve())
                    env = fixture.environment
                    if mutation == "extra":
                        extra = fixture.package / "unexpected-private-sentinel"
                        extra.write_bytes(b"x")
                        extra.chmod(0o400)
                    elif mutation == "missing":
                        (fixture.package / "EVIDENCE_COMPLETE").unlink()
                    elif mutation == "case_collision":
                        # Case-insensitive hosts cannot materialize both names;
                        # exercise the decisive name-list check directly.
                        pass
                    elif mutation == "package_symlink":
                        original = fixture.package
                        held = fixture.capture_root / "held-package"
                        original.rename(held)
                        original.symlink_to(held, target_is_directory=True)
                    elif mutation == "file_symlink":
                        path = fixture.package / "capture.json"
                        path.unlink()
                        path.symlink_to(fixture.package / "evidence-files.json")
                    elif mutation == "file_hardlink":
                        source = fixture.package / "capture.json"
                        target = fixture.root / "hardlink"
                        os.link(source, target)
                    elif mutation == "file_mode":
                        (fixture.package / "capture.json").chmod(0o600)
                    elif mutation == "package_mode":
                        fixture.package.chmod(0o750)
                    elif mutation == "root_mode":
                        fixture.capture_root.chmod(0o750)
                    elif mutation == "wrong_uid":
                        env["TOC_REATTEST_EXPECTED_UID"] = str(os.geteuid() + 1)
                    elif mutation == "wrong_gid":
                        env["TOC_REATTEST_EXPECTED_GID"] = str(os.getegid() + 1)
                    elif mutation == "wrong_device":
                        env["TOC_REATTEST_EXPECTED_DEVICE"] = str(
                            fixture.capture_root.stat().st_dev + 1
                        )
                    if mutation == "case_collision":
                        real_listdir = PROBE.os.listdir

                        def collision_listdir(descriptor):
                            names = real_listdir(descriptor)
                            return [*names, "Capture.json"]

                        with mock.patch.object(
                            PROBE.os, "listdir", side_effect=collision_listdir
                        ):
                            status, output = self.run_probe(env)
                    else:
                        status, output = self.run_probe(env)
                    self.assertEqual(status, 1)
                    self.assert_fixed_failure(output, "package_invalid")

    def test_completion_and_manifest_content_substitutions_fail_closed(self) -> None:
        marker = self.fixture.package / "EVIDENCE_COMPLETE"
        marker.chmod(0o600)
        marker.write_bytes(
            canonical(
                {
                    "artifact_kind": "lovable_toc_capture_incomplete",
                    "evidence_files_sha256": self.fixture.environment[
                        "TOC_REATTEST_EXPECTED_CAPTURE_EVIDENCE_FILES_SHA256"
                    ],
                    "format_version": 1,
                }
            )
        )
        marker.chmod(0o400)
        status, output = self.run_probe()
        self.assertEqual(status, 1)
        self.assert_fixed_failure(output, "binding_mismatch")

        self.setUp_fixture_again()
        manifest = dict(self.fixture.manifest)
        manifest["format_version"] = 2
        manifest_bytes = canonical(manifest)
        manifest_path = self.fixture.package / "evidence-files.json"
        manifest_path.chmod(0o600)
        manifest_path.write_bytes(manifest_bytes)
        manifest_path.chmod(0o400)
        marker = self.fixture.package / "EVIDENCE_COMPLETE"
        marker.chmod(0o600)
        marker.write_bytes(
            canonical(
                {
                    "artifact_kind": "lovable_toc_capture_complete",
                    "evidence_files_sha256": digest(manifest_bytes),
                    "format_version": 1,
                }
            )
        )
        marker.chmod(0o400)
        self.fixture.environment[
            "TOC_REATTEST_EXPECTED_CAPTURE_EVIDENCE_FILES_SHA256"
        ] = digest(manifest_bytes)
        status, output = self.run_probe()
        self.assertEqual(status, 1)
        self.assert_fixed_failure(output, "metadata_invalid")

    def test_root_symlink_alias_and_in_worktree_paths_fail_before_package_open(self) -> None:
        alias = self.root / "capture-alias"
        alias.symlink_to(self.fixture.capture_root, target_is_directory=True)
        for path in (os.fspath(alias), os.fspath(ROOT)):
            with self.subTest(path=path):
                environment = dict(self.fixture.environment)
                environment["TOC_REATTEST_CAPTURE_ROOT"] = path
                status, output = self.run_probe(environment)
                self.assertEqual(status, 1)
                self.assert_fixed_failure(output, "input_invalid")

    def test_noncanonical_malformed_duplicate_nonfinite_deep_and_oversized_json_fail(self) -> None:
        cases = {
            "malformed_utf8": b"\xff\n",
            "duplicate": b'{"artifact_kind":"x","artifact_kind":"y"}\n',
            "nonfinite": b'{"value":NaN}\n',
            "noncanonical": b'{ "artifact_kind": "x" }\n',
            "deep": (b'{"x":' * 40) + b"0" + (b"}" * 40) + b"\n",
            "oversized": b"{" + (b"x" * (PROBE.MAX_METADATA_BYTES + 1)) + b"}\n",
        }
        for label, raw in cases.items():
            with self.subTest(label=label):
                path = self.fixture.package / "capture.json"
                path.chmod(0o600)
                path.write_bytes(raw)
                path.chmod(0o400)
                self.fixture.manifest["files"] = [
                    {
                        "name": record["name"],
                        "sha256": digest(raw)
                        if record["name"] == "capture.json"
                        else record["sha256"],
                        "size_bytes": len(raw)
                        if record["name"] == "capture.json"
                        else record["size_bytes"],
                    }
                    for record in self.fixture.manifest["files"]
                ]
                manifest = canonical(self.fixture.manifest)
                manifest_path = self.fixture.package / "evidence-files.json"
                manifest_path.chmod(0o600)
                manifest_path.write_bytes(manifest)
                manifest_path.chmod(0o400)
                marker_path = self.fixture.package / "EVIDENCE_COMPLETE"
                marker_path.chmod(0o600)
                marker_path.write_bytes(
                    canonical(
                        {
                            "artifact_kind": "lovable_toc_capture_complete",
                            "evidence_files_sha256": digest(manifest),
                            "format_version": 1,
                        }
                    )
                )
                marker_path.chmod(0o400)
                self.fixture.environment[
                    "TOC_REATTEST_EXPECTED_CAPTURE_EVIDENCE_FILES_SHA256"
                ] = digest(manifest)
                status, output = self.run_probe()
                self.assertEqual(status, 1)
                self.assert_fixed_failure(
                    output,
                    "package_invalid" if label == "oversized" else "metadata_invalid",
                )
                self.setUp_fixture_again()

    def setUp_fixture_again(self) -> None:
        self.temporary.cleanup()
        self.temporary = tempfile.TemporaryDirectory(prefix="toc-metadata-probe.")
        self.root = Path(self.temporary.name).resolve()
        self.fixture = MetadataProbeFixture(self.root)

    def test_manifest_completion_and_all_capture_bindings_are_externally_pinned(self) -> None:
        environment_keys = (
            "TOC_REATTEST_EXPECTED_CAPTURE_EVIDENCE_FILES_SHA256",
            "TOC_REATTEST_EXPECTED_RUN_ID",
            "TOC_REATTEST_EXPECTED_OUTER_ARCHIVE_SHA256",
            "TOC_REATTEST_EXPECTED_INNER_ARCHIVE_SHA256",
            "TOC_REATTEST_EXPECTED_INSPECTION_EVIDENCE_MANIFEST_SHA256",
            "TOC_REATTEST_EXPECTED_INSPECTION_CHECKOUT_SHA",
            "TOC_REATTEST_EXPECTED_INSPECTION_PROCEDURE_SHA256",
            "TOC_REATTEST_EXPECTED_CAPTURE_EXECUTION_CHECKOUT_SHA",
            "TOC_REATTEST_EXPECTED_CAPTURE_PROCEDURE_IDENTITY_SHA256",
            "TOC_REATTEST_EXPECTED_PG_RESTORE_IDENTITY_SHA256",
            "TOC_REATTEST_EXPECTED_RAW_TOC_SHA256",
            "TOC_REATTEST_EXPECTED_ENTRY_COUNT",
            "TOC_REATTEST_EXPECTED_DATA_REFERENCE_COUNT",
        )
        for key in environment_keys:
            with self.subTest(key=key):
                environment = dict(self.fixture.environment)
                current = environment[key]
                if current.isdigit() and len(current) < 20:
                    environment[key] = str(int(current) + 1)
                elif len(current) == 40:
                    environment[key] = "9" * 40
                elif len(current) == 64:
                    environment[key] = "9" * 64
                else:
                    environment[key] = "different-approved-value"
                status, output = self.run_probe(environment)
                self.assertEqual(status, 1)
                self.assert_fixed_failure(output, "binding_mismatch")

    def test_capture_provenance_substitutions_fail_after_internal_rehash(self) -> None:
        substitutions = (
            ("binding", "evidence_manifest_sha256", "9" * 64),
            ("binding", "evidence_run_id", "substituted-run"),
            ("binding", "execution_checkout_sha", "9" * 40),
            ("binding", "inner_archive_sha256", "9" * 64),
            ("binding", "outer_archive_sha256", "9" * 64),
            ("binding", "inspection_checkout_sha", "9" * 40),
            ("binding", "inspection_procedure_sha256", "9" * 64),
            ("binding", "procedure_identity_sha256", "9" * 64),
            (None, "entry_count", 2),
            (None, "data_reference_count", 1),
            (None, "raw_toc_sha256", "9" * 64),
        )
        for parent, name, value in substitutions:
            with self.subTest(field=name):
                with tempfile.TemporaryDirectory(prefix="toc-probe-substitute.") as temporary:
                    fixture = MetadataProbeFixture(Path(temporary).resolve())
                    target = fixture.capture if parent is None else fixture.capture[parent]
                    target[name] = value
                    fixture._publish_metadata(rebuild_capture=False)
                    fixture.environment[
                        "TOC_REATTEST_EXPECTED_CAPTURE_EVIDENCE_FILES_SHA256"
                    ] = digest((fixture.package / "evidence-files.json").read_bytes())
                    status, output = self.run_probe(fixture.environment)
                    self.assertEqual(status, 1)
                    self.assertNotIn(b"recorded_opaque_index_sha256", output)
                    reason = json.loads(output)["reason"]
                    self.assertIn(reason, {"binding_mismatch", "metadata_invalid"})

    def test_coherent_metadata_substitutions_cannot_replace_external_truth(self) -> None:
        cases = (
            ("inner_binding", "9" * 64),
            ("inspection_evidence", "8" * 64),
            ("capture_checkout", "7" * 40),
            ("pg_path", "/synthetic/substituted/pg_restore"),
            ("pg_inode", 999),
            ("capture_procedure", "6" * 64),
            ("execution_python_inode", 888),
        )
        for label, value in cases:
            with self.subTest(label=label), tempfile.TemporaryDirectory(
                prefix="toc-probe-coherent."
            ) as temporary:
                fixture = MetadataProbeFixture(Path(temporary).resolve())
                if label == "inner_binding":
                    fixture.capture["binding"]["inner_archive_sha256"] = value
                elif label == "inspection_evidence":
                    fixture.capture["binding"]["evidence_manifest_sha256"] = value
                    fixture.capture["procedure_identity"][
                        "evidence_manifest_sha256"
                    ] = value
                elif label == "capture_checkout":
                    fixture.capture["binding"]["execution_checkout_sha"] = value
                    fixture.capture["procedure_identity"]["execution_checkout_sha"] = value
                elif label == "pg_path":
                    fixture.capture["pg_restore_identity"]["executable_path"] = value
                elif label == "pg_inode":
                    fixture.capture["pg_restore_identity"]["inode"] = value
                elif label == "capture_procedure":
                    fixture.capture["procedure_identity"]["README_md_sha256"] = value
                elif label == "execution_python_inode":
                    fixture.capture["execution_python_identity"]["inode"] = value
                    fixture.capture["procedure_identity"][
                        "execution_python_identity_sha256"
                    ] = digest(canonical(fixture.capture["execution_python_identity"]))
                if label in {
                    "inspection_evidence",
                    "capture_checkout",
                    "capture_procedure",
                    "execution_python_inode",
                }:
                    fixture.capture["binding"]["procedure_identity_sha256"] = digest(
                        canonical(fixture.capture["procedure_identity"])
                    )
                fixture._publish_metadata(rebuild_capture=False)
                fixture.environment[
                    "TOC_REATTEST_EXPECTED_CAPTURE_EVIDENCE_FILES_SHA256"
                ] = digest((fixture.package / "evidence-files.json").read_bytes())
                status, output = self.run_probe(fixture.environment)
                self.assertEqual(status, 1)
                self.assertNotIn(b"recorded_opaque_index_sha256", output)
                self.assertIn(
                    json.loads(output)["reason"],
                    {"binding_mismatch", "metadata_invalid"},
                )

    def test_every_nested_procedure_and_runtime_identity_substitution_fails(self) -> None:
        groups = (
            ("procedure_identity", sorted(PROBE.CAPTURE_PROCEDURE_IDENTITY_KEYS)),
            ("execution_python_identity", sorted(self.fixture.execution_python_identity)),
            ("pg_restore_identity", sorted(self.fixture.pg_identity)),
        )
        for group, keys in groups:
            for key in keys:
                with self.subTest(group=group, key=key), tempfile.TemporaryDirectory(
                    prefix="toc-probe-every-provenance."
                ) as temporary:
                    fixture = MetadataProbeFixture(Path(temporary).resolve())
                    target = fixture.capture[group]
                    current = target[key]
                    if type(current) is int:
                        replacement = current + 1
                    elif key == "approved_identity":
                        replacement = "sha256:" + "9" * 64
                    elif key == "executable_path":
                        replacement = "/synthetic/substituted/executable"
                    elif key == "mode":
                        replacement = "0700"
                    elif key == "reported_version":
                        replacement = (
                            "cpython:3.13.1"
                            if group == "execution_python_identity"
                            else "pg_restore (PostgreSQL) 18.4"
                        )
                    elif len(current) == 40:
                        replacement = "9" * 40
                    else:
                        replacement = "9" * 64
                    target[key] = replacement
                    if group == "procedure_identity":
                        fixture.capture["binding"]["procedure_identity_sha256"] = digest(
                            canonical(target)
                        )
                    fixture._publish_metadata(rebuild_capture=False)
                    fixture.environment[
                        "TOC_REATTEST_EXPECTED_CAPTURE_EVIDENCE_FILES_SHA256"
                    ] = digest((fixture.package / "evidence-files.json").read_bytes())
                    status, output = self.run_probe(fixture.environment)
                    self.assertEqual(status, 1)
                    self.assertNotIn(b"recorded_opaque_index_sha256", output)
                    self.assertIn(
                        json.loads(output)["reason"],
                        {"binding_mismatch", "metadata_invalid"},
                    )

    def test_concurrent_mutation_and_path_replacement_fail(self) -> None:
        def mutate(stage: str) -> None:
            if stage == "before_revalidation":
                marker = self.fixture.package / "EVIDENCE_COMPLETE"
                marker.chmod(0o600)
                os.utime(marker, None)
                marker.chmod(0o400)

        PROBE._TEST_HOOK = mutate
        status, output = self.run_probe()
        self.assertEqual(status, 1)
        self.assert_fixed_failure(output, "input_mutated")

        self.setUp_fixture_again()
        original_root = self.fixture.capture_root
        replacement_root = self.root / "replacement-root"
        shutil.copytree(original_root, replacement_root)
        replacement_root.chmod(0o700)

        def replace_root(stage: str) -> None:
            if stage == "before_revalidation":
                original_root.rename(self.root / "held-root")
                replacement_root.rename(original_root)

        PROBE._TEST_HOOK = replace_root
        status, output = self.run_probe()
        self.assertEqual(status, 1)
        self.assert_fixed_failure(output, "input_mutated")

        self.setUp_fixture_again()
        original = self.fixture.package
        replacement = self.fixture.capture_root / "replacement"
        shutil.copytree(original, replacement)
        replacement.chmod(0o700)

        def replace(stage: str) -> None:
            if stage == "before_revalidation":
                original.rename(self.fixture.capture_root / "old-package")
                replacement.rename(original)

        PROBE._TEST_HOOK = replace
        status, output = self.run_probe()
        self.assertEqual(status, 1)
        self.assert_fixed_failure(output, "input_mutated")

    def test_poisoned_private_values_never_escape_failure_output(self) -> None:
        sentinels = (
            b"PRIVATE_PATH_SENTINEL",
            b"RAW_TOC_SENTINEL",
            b"OBJECT_NAME_SENTINEL",
            b"SELECT_SECRET_SQL_SENTINEL",
            b"OPAQUE_KEY_SENTINEL",
            b"BUSINESS_PAYLOAD_SENTINEL",
        )
        capture = self.fixture.package / "capture.json"
        capture.chmod(0o600)
        capture.write_bytes(b"|".join(sentinels))
        capture.chmod(0o400)
        status, output = self.run_probe()
        self.assertEqual(status, 1)
        for sentinel in sentinels:
            self.assertNotIn(sentinel, output)

    def test_invalid_session_nonce_expiry_environment_and_reviewer_fail_before_open(self) -> None:
        cases = (
            ("TOC_REATTEST_METADATA_SESSION_NONCE", "bad", "input_invalid"),
            (
                "TOC_REATTEST_METADATA_SESSION_EXPIRES_AT_UTC",
                "2000-01-01T00:00:00Z",
                "session_invalid",
            ),
            (
                "TOC_REATTEST_INDEPENDENT_REVIEWER_IDENTITY",
                "syntheticoperator",
                "binding_mismatch",
            ),
        )
        for key, value, reason in cases:
            with self.subTest(key=key):
                environment = dict(self.fixture.environment)
                environment[key] = value
                with mock.patch.object(
                    PROBE, "_open_directory", side_effect=AssertionError("private open")
                ):
                    status, output = self.run_probe(environment)
                self.assertEqual(status, 1)
                self.assert_fixed_failure(output, reason)
        environment = dict(self.fixture.environment)
        environment["UNREVIEWED_ENV_SENTINEL"] = "PRIVATE_VALUE"
        with mock.patch.object(
            PROBE, "_open_directory", side_effect=AssertionError("private open")
        ):
            status, output = self.run_probe(environment)
        self.assertEqual(status, 1)
        self.assert_fixed_failure(output, "input_invalid")

    def test_output_identity_and_authorization_acknowledgements_fail_before_open(self) -> None:
        cases = (
            ("TOC_REATTEST_EXPECTED_OUTPUT_DEVICE", "999999999", "binding_mismatch"),
            ("TOC_REATTEST_EXPECTED_OUTPUT_INODE", "999999999", "binding_mismatch"),
            ("NO_RETRY_AFTER_PRIVATE_ACCESS", "NOT_ACKNOWLEDGED", "binding_mismatch"),
            ("CANDIDATE_DISCLOSURE", "TOO_BROAD", "binding_mismatch"),
            ("CEILINGS_ACCEPTED", "NOT_ACCEPTED", "binding_mismatch"),
        )
        for key, value, reason in cases:
            with self.subTest(key=key):
                environment = dict(self.fixture.environment)
                environment[key] = value
                with mock.patch.object(
                    PROBE, "_open_directory", side_effect=AssertionError("private open")
                ):
                    status, output = self.run_probe(environment)
                self.assertEqual(status, 1)
                self.assert_fixed_failure(output, reason)

    def test_signed_terminal_device_identity_is_supported(self) -> None:
        environment = dict(self.fixture.environment)
        environment["TOC_REATTEST_EXPECTED_OUTPUT_DEVICE"] = "-1872095033"
        environment["TOC_REATTEST_EXPECTED_OUTPUT_INODE"] = "18446744073709551615"
        metadata = mock.Mock(
            st_mode=stat.S_IFCHR | 0o600,
            st_dev=-1872095033,
            st_ino=18446744073709551615,
        )
        with mock.patch.dict(os.environ, environment, clear=True), mock.patch.object(
            PROBE.os, "fstat", return_value=metadata
        ):
            PROBE._validate_output_destination(4)

    def test_probe_writes_nothing_and_invokes_no_child_or_network(self) -> None:
        before = tree_snapshot(self.root)
        real_open = os.open

        def no_write_open(path, flags, *args, **kwargs):
            self.assertEqual(flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC), 0)
            return real_open(path, flags, *args, **kwargs)

        with mock.patch.object(PROBE.os, "open", side_effect=no_write_open):
            status, _ = self.run_probe()
        self.assertEqual(status, 0)
        self.assertEqual(before, tree_snapshot(self.root))
        self.assertNotIn("subprocess", PROBE.__dict__)
        self.assertNotIn("socket", PROBE.__dict__)
        self.assertNotIn("tempfile", PROBE.__dict__)
        self.assertNotIn("mmap", PROBE.__dict__)

    def test_closed_broken_and_wrong_type_output_never_raise_or_fallback(self) -> None:
        self.assertFalse(PROBE._write_output(-1, b"private"))
        read_fd, write_fd = os.pipe()
        os.close(read_fd)
        with mock.patch.object(PROBE.os, "write", side_effect=BrokenPipeError):
            self.assertFalse(PROBE._write_output(write_fd, b"private"))
        os.close(write_fd)
        with tempfile.NamedTemporaryFile() as stream:
            self.assertFalse(PROBE._write_output(stream.fileno(), b"private"))
        read_fd, write_fd = os.pipe()
        with mock.patch.object(PROBE.os, "write", return_value=1) as partial_write:
            self.assertFalse(PROBE._write_output(write_fd, b"private"))
        partial_write.assert_called_once()
        os.close(read_fd)
        os.close(write_fd)

    def test_every_closed_failure_diagnostic_is_exact_and_candidate_free(self) -> None:
        for reason in PROBE.FAILURE_REASONS:
            with self.subTest(reason=reason):
                payload = PROBE._failure_payload("synthetic-metadata-session", reason)
                self.assert_fixed_failure(payload, reason)
        payload = PROBE._failure_payload("synthetic-metadata-session", "not-reviewed")
        self.assert_fixed_failure(payload, "internal_failure")


if __name__ == "__main__":
    unittest.main()
