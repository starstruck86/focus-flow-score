from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import os
import socket
import stat
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "migration"))

from lib import lovable_toc_authoring_contract as authoring  # noqa: E402
from lib import lovable_toc_contract as capture_contract  # noqa: E402


def load_entrypoint():
    path = ROOT / "scripts/migration/author-lovable-toc-annotations.py"
    spec = importlib.util.spec_from_file_location("toc_author_entrypoint_test", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("synthetic author entrypoint load failed")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


AUTHOR = load_entrypoint()


SHA_A = "a" * 64
SHA_B = "b" * 64
SHA_C = "c" * 64
SHA_D = "d" * 64
GIT_A = "a" * 40
GIT_B = "b" * 40


def raw_toc(classes: list[str], poison: str = "synthetic-private-object") -> bytes:
    lines = [
        b"; Dumped from database version: 17.6",
        b"; Dumped by pg_dump version: 18.4",
    ]
    for ordinal, object_class in enumerate(classes, 1):
        lines.append(
            f'{ordinal}; 0 {1000 + ordinal} {object_class} "{poison}-{ordinal}" owner'.encode(
                "utf-8"
            )
        )
    return b"\n".join(lines) + b"\n"


def execution_python_identity() -> dict[str, object]:
    return {
        "approved_identity": f"sha256:{SHA_B}",
        "device": 3,
        "executable_path": "/synthetic/python3",
        "gid": os.getegid(),
        "inode": 4,
        "mode": "0755",
        "reported_version": "cpython:3.9.6",
        "sha256": SHA_B,
        "size_bytes": 456,
        "uid": os.geteuid(),
    }


def pg_identity(pg_sha: str = SHA_A) -> dict[str, object]:
    return {
        "approved_identity": f"sha256:{pg_sha}",
        "device": 1,
        "executable_path": "/synthetic/pg_restore",
        "gid": os.getegid(),
        "inode": 2,
        "mode": "0755",
        "reported_version": "pg_restore (PostgreSQL) 18.4",
        "sha256": pg_sha,
        "size_bytes": 123,
        "uid": os.geteuid(),
    }


def procedure_identity(
    *,
    execution_checkout: str = GIT_A,
    evidence_sha: str = SHA_A,
    inspection_checkout: str = GIT_B,
    inspection_procedure: str = SHA_C,
) -> dict[str, str]:
    return {
        "execution_checkout_sha": execution_checkout,
        "execution_python_approved_sha256": SHA_B,
        "execution_python_identity_sha256": capture_contract.sha256_bytes(
            capture_contract.canonical_json_bytes(execution_python_identity())
        ),
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
        "evidence_manifest_sha256": evidence_sha,
        "inspection_checkout_sha": inspection_checkout,
        "inspection_procedure_sha256": inspection_procedure,
    }


def make_capture_package(
    root: Path,
    classes: list[str],
    *,
    run_id: str = "synthetic-run",
    outer_sha: str = SHA_D,
    inner_sha: str = SHA_B,
    evidence_sha: str = SHA_A,
    inspection_checkout: str = GIT_B,
    inspection_procedure: str = SHA_C,
    execution_checkout: str = GIT_A,
    pg_sha: str = SHA_A,
    poison: str = "synthetic-private-object",
):
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    root.chmod(0o700)
    raw = raw_toc(classes, poison)
    procedure = procedure_identity(
        execution_checkout=execution_checkout,
        evidence_sha=evidence_sha,
        inspection_checkout=inspection_checkout,
        inspection_procedure=inspection_procedure,
    )
    procedure_sha = capture_contract.sha256_bytes(
        capture_contract.canonical_json_bytes(procedure)
    )
    binding = {
        "evidence_manifest_sha256": evidence_sha,
        "evidence_run_id": run_id,
        "execution_checkout_sha": execution_checkout,
        "inner_archive_sha256": inner_sha,
        "inspection_checkout_sha": inspection_checkout,
        "inspection_procedure_sha256": inspection_procedure,
        "outer_archive_sha256": outer_sha,
        "procedure_identity_sha256": procedure_sha,
    }
    files, entries, capture = capture_contract.build_capture_payloads(
        raw_toc=raw,
        key=b"k" * 32,
        binding=binding,
        execution_python_identity=execution_python_identity(),
        pg_restore_identity=pg_identity(pg_sha),
        procedure_identity=procedure,
        expected_entry_count=len(classes),
        expected_data_reference_count=sum(
            item in capture_contract.DATA_TOC_CLASSES for item in classes
        ),
    )
    evidence = {
        "artifact_kind": "lovable_toc_capture_evidence",
        "files": [
            {
                "name": name,
                "sha256": capture_contract.sha256_bytes(files[name]),
                "size_bytes": len(files[name]),
            }
            for name in sorted(files)
        ],
        "format_version": 1,
    }
    evidence_bytes = capture_contract.canonical_json_bytes(evidence)
    evidence_sha256 = capture_contract.sha256_bytes(evidence_bytes)
    marker = capture_contract.canonical_json_bytes(
        {
            "artifact_kind": "lovable_toc_capture_complete",
            "evidence_files_sha256": evidence_sha256,
            "format_version": 1,
        }
    )
    package = root / "synthetic-capture"
    package.mkdir(mode=0o700)
    for name, data in {
        **files,
        "evidence-files.json": evidence_bytes,
        "EVIDENCE_COMPLETE": marker,
    }.items():
        path = package / name
        path.write_bytes(data)
        path.chmod(0o400)
    expectations = authoring.CaptureExpectations(
        capture_manifest_sha256=evidence_sha256,
        raw_toc_sha256=capture["raw_toc_sha256"],
        opaque_index_sha256=capture["opaque_index_sha256"],
        entry_count=len(classes),
        data_reference_count=sum(
            item in capture_contract.DATA_TOC_CLASSES for item in classes
        ),
        evidence_run_id=run_id,
        outer_archive_sha256=outer_sha,
        inner_archive_sha256=inner_sha,
        evidence_manifest_sha256=evidence_sha,
        inspection_checkout_sha=inspection_checkout,
        inspection_procedure_sha256=inspection_procedure,
        capture_execution_checkout_sha=execution_checkout,
        capture_procedure_identity_sha256=procedure_sha,
        approved_pg_restore_sha256=pg_sha,
    )
    return package, expectations, capture, entries


def open_directory(path: Path) -> int:
    return os.open(
        path,
        os.O_RDONLY
        | getattr(os, "O_DIRECTORY", 0)
        | getattr(os, "O_NOFOLLOW", 0),
    )


def mark_authoring_released(private_root: Path, token: str = "d" * 64) -> None:
    marker = private_root / AUTHOR.RELEASED_NAME
    marker.write_bytes(AUTHOR._lock_content(token))
    marker.chmod(0o400)


def released_token(private_root: Path) -> str:
    marker = private_root / AUTHOR.RELEASED_NAME
    raw = marker.read_bytes()
    if not raw.startswith(AUTHOR.LOCK_PREFIX) or not raw.endswith(b"\n"):
        raise AssertionError("synthetic release marker is malformed")
    token = raw[len(AUTHOR.LOCK_PREFIX) : -1].decode("ascii")
    if len(token) != 64:
        raise AssertionError("synthetic release token is malformed")
    return token


class AuthoringContractTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.root.chmod(0o700)
        self.binding = authoring.AuthoringBinding(GIT_A, SHA_B, SHA_C)
        self.capture_counter = 0

    def tearDown(self):
        self.temporary.cleanup()

    def load_capture(self, classes=None):
        self.capture_counter += 1
        capture_root = self.root / ("capture-case-%d" % self.capture_counter)
        package, expectations, _capture, _entries = make_capture_package(
            capture_root, classes or ["TABLE"]
        )
        descriptor = open_directory(package)
        try:
            loaded = authoring.load_capture_for_authoring(descriptor, expectations)
        finally:
            os.close(descriptor)
        return loaded, package, expectations

    def author_environment(
        self,
        package: Path,
        expectations: authoring.CaptureExpectations,
        private_root: Path,
        *,
        action: str,
        generation: int,
        head_sha256: str,
    ) -> dict[str, str]:
        python = Path(sys.executable).resolve(strict=True)
        return {
            "TOC_AUTHOR_ACTION": action,
            "TOC_AUTHOR_EXECUTION_PYTHON": os.fspath(python),
            "TOC_AUTHOR_APPROVED_EXECUTION_PYTHON_SHA256": hashlib.sha256(
                python.read_bytes()
            ).hexdigest(),
            "TOC_AUTHOR_APPROVED_EXECUTION_PYTHON_VERSION": (
                f"{sys.implementation.name}:{sys.version_info.major}."
                f"{sys.version_info.minor}.{sys.version_info.micro}"
            ),
            "TOC_AUTHOR_APPROVED_EXECUTION_CHECKOUT_SHA": GIT_A,
            "TOC_AUTHOR_CAPTURE_ROOT": os.fspath(package.parent),
            "TOC_AUTHOR_CAPTURE_NAME": package.name,
            "TOC_AUTHOR_PRIVATE_ROOT": os.fspath(private_root),
            "TOC_AUTHOR_EXPECTED_CAPTURE_MANIFEST_SHA256": expectations.capture_manifest_sha256,
            "TOC_AUTHOR_EXPECTED_RAW_TOC_SHA256": expectations.raw_toc_sha256,
            "TOC_AUTHOR_EXPECTED_OPAQUE_INDEX_SHA256": expectations.opaque_index_sha256,
            "TOC_AUTHOR_EXPECTED_ENTRY_COUNT": str(expectations.entry_count),
            "TOC_AUTHOR_EXPECTED_DATA_REFERENCE_COUNT": str(
                expectations.data_reference_count
            ),
            "TOC_AUTHOR_EVIDENCE_RUN_ID": expectations.evidence_run_id,
            "TOC_AUTHOR_OUTER_SHA256": expectations.outer_archive_sha256,
            "TOC_AUTHOR_INNER_SHA256": expectations.inner_archive_sha256,
            "TOC_AUTHOR_EVIDENCE_MANIFEST_SHA256": expectations.evidence_manifest_sha256,
            "TOC_AUTHOR_INSPECTION_CHECKOUT_SHA": expectations.inspection_checkout_sha,
            "TOC_AUTHOR_INSPECTION_PROCEDURE_SHA256": expectations.inspection_procedure_sha256,
            "TOC_AUTHOR_CAPTURE_EXECUTION_CHECKOUT_SHA": expectations.capture_execution_checkout_sha,
            "TOC_AUTHOR_EXPECTED_CAPTURE_PROCEDURE_IDENTITY_SHA256": expectations.capture_procedure_identity_sha256,
            "TOC_AUTHOR_APPROVED_PG_RESTORE_SHA256": expectations.approved_pg_restore_sha256,
            "TOC_AUTHOR_PRIMARY_OPERATOR_IDENTITY": "Primary Reviewer",
            "TOC_AUTHOR_OPERATOR_IDENTITY": "Primary Reviewer",
            "TOC_AUTHOR_SESSION_IDENTITY": "synthetic-session",
            "TOC_AUTHOR_EXPECTED_HEAD_GENERATION": str(generation),
            "TOC_AUTHOR_EXPECTED_HEAD_SHA256": head_sha256,
            "TOC_AUTHOR_EXPECTED_RELEASE_TOKEN": (
                released_token(private_root)
                if (private_root / AUTHOR.RELEASED_NAME).is_file()
                else AUTHOR.INITIAL_RELEASE_TOKEN
            ),
            "TOC_AUTHOR_FINALIZATION_AUTHORIZATION": "",
        }

    def test_structure_parser_matches_existing_parser_without_key(self):
        raw = raw_toc(["TABLE", "TABLE DATA", "SEQUENCE OWNED BY"])
        structural = capture_contract.parse_raw_toc_structure(raw)
        keyed = capture_contract.parse_raw_toc(raw, b"q" * 32)
        self.assertEqual(
            [
                (item.ordinal, item.dump_id, item.object_class, item.is_data_reference, item.raw_line)
                for item in structural
            ],
            [
                (item.ordinal, item.dump_id, item.object_class, item.is_data_reference, item.raw_line)
                for item in keyed
            ],
        )

    def test_entrypoint_initializes_and_resumes_exact_immutable_head(self):
        capture_root = self.root / "entrypoint-capture"
        package, expectations, _capture, _entries = make_capture_package(
            capture_root, ["TABLE"]
        )
        private_root = self.root / "authoring-private"
        private_root.mkdir(mode=0o700)
        environment = self.author_environment(
            package,
            expectations,
            private_root,
            action="initialize",
            generation=0,
            head_sha256="0" * 64,
        )
        with mock.patch.object(AUTHOR, "_authoring_procedure_identity", return_value=SHA_C):
            exit_status, diagnostic = AUTHOR.execute_authoring(environment, -1)
        self.assertEqual(exit_status, 2)
        if b"synthetic-private-object" in diagnostic:
            self.fail("private synthetic object escaped into diagnostic")
        self.assertFalse((private_root / AUTHOR.LOCK_NAME).exists())
        checkpoints = private_root / AUTHOR.CHECKPOINTS_NAME
        names = list(checkpoints.iterdir())
        self.assertEqual(len(names), 1)
        self.assertEqual(stat.S_IMODE(names[0].stat().st_mode), 0o400)
        head_sha = hashlib.sha256(names[0].read_bytes()).hexdigest()

        status_environment = self.author_environment(
            package,
            expectations,
            private_root,
            action="status",
            generation=1,
            head_sha256=head_sha,
        )
        wrong_release = dict(status_environment)
        wrong_release["TOC_AUTHOR_EXPECTED_RELEASE_TOKEN"] = "0" * 64
        with mock.patch.object(
            AUTHOR, "load_capture_for_authoring"
        ) as private_capture_read, mock.patch.object(
            AUTHOR, "_authoring_procedure_identity", return_value=SHA_C
        ):
            with self.assertRaisesRegex(
                AUTHOR.AuthoringEntrypointError, "history_conflict"
            ):
                AUTHOR.execute_authoring(wrong_release, -1)
        private_capture_read.assert_not_called()
        with mock.patch.object(AUTHOR, "_authoring_procedure_identity", return_value=SHA_C):
            exit_status, diagnostic = AUTHOR.execute_authoring(status_environment, -1)
        self.assertEqual(exit_status, 2)
        visible = json.loads(diagnostic)
        self.assertEqual(visible["review_gate"], "REVIEW_REQUIRED")
        self.assertEqual(visible["authoring_state"], "PRIMARY_REVIEW_REQUIRED")
        self.assertNotIn("entry_id", visible)
        self.assertEqual(len(list(checkpoints.iterdir())), 1)

        skipped = dict(status_environment)
        skipped["TOC_AUTHOR_ACTION"] = "peer_review"
        skipped["TOC_AUTHOR_EXPECTED_RELEASE_TOKEN"] = released_token(private_root)
        with mock.patch.object(AUTHOR, "_authoring_procedure_identity", return_value=SHA_C):
            with self.assertRaisesRegex(
                AUTHOR.AuthoringEntrypointError, "review_transition_invalid"
            ):
                AUTHOR.execute_authoring(skipped, -1)
        self.assertEqual(len(list(checkpoints.iterdir())), 1)

    def test_checkpoint_head_is_returned_only_through_private_tty(self):
        capture_root = self.root / "head-display-capture"
        package, expectations, _capture, _entries = make_capture_package(
            capture_root, ["TABLE"]
        )
        private_root = self.root / "head-display-private"
        private_root.mkdir(mode=0o700)
        environment = self.author_environment(
            package,
            expectations,
            private_root,
            action="initialize",
            generation=0,
            head_sha256="0" * 64,
        )
        private_writes: list[bytes] = []
        with mock.patch.object(
            AUTHOR, "_authoring_procedure_identity", return_value=SHA_C
        ), mock.patch.object(
            AUTHOR,
            "_write_tty",
            side_effect=lambda _descriptor, payload: private_writes.append(payload),
        ), mock.patch.object(
            AUTHOR, "_require_resume_acknowledgement", return_value=None
        ):
            exit_status, diagnostic = AUTHOR.execute_authoring(environment, 9)
        self.assertEqual(exit_status, 2)
        combined = b"".join(private_writes)
        if b"resume_generation=1\n" not in combined:
            self.fail("private TTY did not receive exact resume generation")
        head = hashlib.sha256(
            next((private_root / AUTHOR.CHECKPOINTS_NAME).iterdir()).read_bytes()
        ).hexdigest().encode("ascii")
        if b"resume_checkpoint_sha256=" + head not in combined:
            self.fail("private TTY did not receive exact checkpoint head")
        release_token = released_token(private_root).encode("ascii")
        if b"resume_release_token=" + release_token not in combined:
            self.fail("private TTY did not receive exact release token")
        if head in diagnostic:
            self.fail("checkpoint head escaped into aggregate ordinary output")
        if release_token in diagnostic:
            self.fail("release token escaped into aggregate ordinary output")

    def test_status_path_detects_concurrent_checkpoint_insertion(self):
        capture_root = self.root / "status-race-capture"
        package, expectations, _capture, _entries = make_capture_package(
            capture_root, ["TABLE"]
        )
        private_root = self.root / "status-race-private"
        private_root.mkdir(mode=0o700)
        initialize_environment = self.author_environment(
            package,
            expectations,
            private_root,
            action="initialize",
            generation=0,
            head_sha256="0" * 64,
        )
        with mock.patch.object(AUTHOR, "_authoring_procedure_identity", return_value=SHA_C):
            AUTHOR.execute_authoring(initialize_environment, -1)
        checkpoints = private_root / AUTHOR.CHECKPOINTS_NAME
        head_path = next(checkpoints.iterdir())
        head_sha = hashlib.sha256(head_path.read_bytes()).hexdigest()
        status_environment = self.author_environment(
            package,
            expectations,
            private_root,
            action="status",
            generation=1,
            head_sha256=head_sha,
        )
        original_revalidate = AUTHOR._revalidate_child_directory

        def mutate_after_revalidation(*args, **kwargs):
            original_revalidate(*args, **kwargs)
            injected = checkpoints / ".concurrent-insertion"
            injected.write_bytes(b"synthetic\n")
            injected.chmod(0o400)

        with mock.patch.object(AUTHOR, "_authoring_procedure_identity", return_value=SHA_C):
            with mock.patch.object(
                AUTHOR,
                "_revalidate_child_directory",
                side_effect=mutate_after_revalidation,
            ):
                with self.assertRaisesRegex(
                    AUTHOR.AuthoringEntrypointError, "history_conflict"
                ):
                    AUTHOR.execute_authoring(status_environment, -1)
        self.assertTrue((checkpoints / ".concurrent-insertion").exists())
        self.assertFalse((private_root / AUTHOR.LOCK_NAME).exists())

    def test_entrypoint_rejects_stale_lock_and_permissive_root(self):
        capture_root = self.root / "blocked-capture"
        package, expectations, _capture, _entries = make_capture_package(
            capture_root, ["TABLE"]
        )
        private_root = self.root / "blocked-private"
        private_root.mkdir(mode=0o700)
        lock = private_root / AUTHOR.LOCK_NAME
        lock.write_bytes(b"")
        lock.chmod(0o400)
        environment = self.author_environment(
            package,
            expectations,
            private_root,
            action="initialize",
            generation=0,
            head_sha256="0" * 64,
        )
        with mock.patch.object(AUTHOR, "_authoring_procedure_identity", return_value=SHA_C):
            with self.assertRaisesRegex(AUTHOR.AuthoringEntrypointError, "history_conflict"):
                AUTHOR.execute_authoring(environment, -1)
        self.assertTrue(lock.exists())

        lock.unlink()
        private_root.chmod(0o755)
        with mock.patch.object(AUTHOR, "_authoring_procedure_identity", return_value=SHA_C):
            with self.assertRaisesRegex(AUTHOR.AuthoringEntrypointError, "input_invalid"):
                AUTHOR.execute_authoring(environment, -1)
        self.assertEqual(list(private_root.iterdir()), [])

    def test_entrypoint_rejects_unsafe_identity_before_private_input(self):
        capture_root = self.root / "identity-capture"
        package, expectations, _capture, _entries = make_capture_package(
            capture_root, ["TABLE"]
        )
        private_root = self.root / "identity-private"
        private_root.mkdir(mode=0o700)
        environment = self.author_environment(
            package,
            expectations,
            private_root,
            action="initialize",
            generation=0,
            head_sha256="0" * 64,
        )
        for field in (
            "TOC_AUTHOR_PRIMARY_OPERATOR_IDENTITY",
            "TOC_AUTHOR_OPERATOR_IDENTITY",
            "TOC_AUTHOR_SESSION_IDENTITY",
        ):
            with self.subTest(field=field):
                poisoned = dict(environment)
                poisoned[field] = "invalid\nidentity"
                with mock.patch.object(
                    AUTHOR, "_open_private_directory_path"
                ) as private_open:
                    with self.assertRaisesRegex(
                        AUTHOR.AuthoringEntrypointError, "input_invalid"
                    ):
                        AUTHOR.execute_authoring(poisoned, -1)
                private_open.assert_not_called()
        self.assertEqual(list(private_root.iterdir()), [])

    def test_entrypoint_lock_allows_only_one_concurrent_author(self):
        private_root = self.root / "concurrent-private"
        private_root.mkdir(mode=0o700)
        descriptor = open_directory(private_root)
        barrier = threading.Barrier(2)
        release = threading.Event()
        acquired = threading.Event()
        results: list[str] = []
        active_tokens: list[str] = []

        def contender() -> None:
            barrier.wait(timeout=5)
            try:
                token = AUTHOR._acquire_lock(
                    descriptor, AUTHOR.INITIAL_RELEASE_TOKEN
                )
            except AUTHOR.AuthoringEntrypointError as exc:
                results.append(exc.reason)
                return
            results.append("acquired")
            active_tokens.append(token)
            acquired.set()
            release.wait(timeout=5)

        threads = [threading.Thread(target=contender) for _ in range(2)]
        for thread in threads:
            thread.start()
        self.assertTrue(acquired.wait(timeout=5))
        release.set()
        for thread in threads:
            thread.join(timeout=5)
        self.assertEqual(sorted(results), ["acquired", "history_conflict"])
        self.assertEqual(len(active_tokens), 1)
        AUTHOR._release_lock(descriptor, active_tokens[0])
        os.close(descriptor)
        self.assertEqual(
            {path.name for path in private_root.iterdir()},
            {AUTHOR.RELEASED_NAME},
        )

    def test_lock_release_durability_failure_cannot_look_unlocked(self):
        private_root = self.root / "release-failure-private"
        private_root.mkdir(mode=0o700)
        checkpoints = private_root / AUTHOR.CHECKPOINTS_NAME
        checkpoints.mkdir(mode=0o700)
        descriptor = open_directory(private_root)
        active_token = AUTHOR._acquire_lock(
            descriptor, AUTHOR.INITIAL_RELEASE_TOKEN
        )
        real_open = AUTHOR.os.open

        def reject_indeterminate(path, *args, **kwargs):
            if path == AUTHOR.INDETERMINATE_NAME:
                raise OSError("synthetic marker failure")
            return real_open(path, *args, **kwargs)

        try:
            fsync_calls = 0

            def fail_after_release_link(_descriptor):
                nonlocal fsync_calls
                fsync_calls += 1
                if fsync_calls >= 2:
                    raise OSError("synthetic second fsync failure")

            with mock.patch.object(
                AUTHOR.os, "fsync", side_effect=fail_after_release_link
            ), mock.patch.object(AUTHOR.os, "open", side_effect=reject_indeterminate):
                with self.assertRaisesRegex(
                    AUTHOR.AuthoringEntrypointError, "cleanup_indeterminate"
                ):
                    AUTHOR._release_lock(descriptor, active_token)
            names = set(os.listdir(descriptor))
            self.assertIn(AUTHOR.LOCK_NAME, names)
            self.assertIn(AUTHOR.RELEASED_NAME, names)
            with self.assertRaisesRegex(
                AUTHOR.AuthoringEntrypointError, "history_conflict"
            ):
                AUTHOR._acquire_lock(descriptor, active_token)
        finally:
            os.close(descriptor)

    def test_resume_rejects_unsafe_checkpoint_child_before_capture_read(self):
        capture_root = self.root / "ordering-capture"
        package, expectations, _capture, _entries = make_capture_package(
            capture_root, ["TABLE"]
        )
        for case in ("symlink", "permissive"):
            with self.subTest(case=case):
                private_root = self.root / ("ordering-private-" + case)
                private_root.mkdir(mode=0o700)
                target = private_root / "checkpoint-target"
                target.mkdir(mode=0o700)
                checkpoints = private_root / AUTHOR.CHECKPOINTS_NAME
                if case == "symlink":
                    checkpoints.symlink_to(target.name)
                else:
                    target.rename(checkpoints)
                    checkpoints.chmod(0o755)
                mark_authoring_released(private_root)
                environment = self.author_environment(
                    package,
                    expectations,
                    private_root,
                    action="status",
                    generation=1,
                    head_sha256="1" * 64,
                )
                with mock.patch.object(
                    AUTHOR, "load_capture_for_authoring"
                ) as capture_reader, mock.patch.object(
                    AUTHOR, "_authoring_procedure_identity", return_value=SHA_C
                ):
                    with self.assertRaises(AUTHOR.AuthoringEntrypointError):
                        AUTHOR.execute_authoring(environment, -1)
                capture_reader.assert_not_called()

    def test_existing_final_package_shape_blocks_before_capture_read(self):
        capture_root = self.root / "terminal-capture"
        package, expectations, _capture, _entries = make_capture_package(
            capture_root, ["TABLE"]
        )
        for case in ("directory", "symlink", "regular"):
            with self.subTest(case=case):
                private_root = self.root / ("terminal-private-" + case)
                private_root.mkdir(mode=0o700)
                (private_root / AUTHOR.CHECKPOINTS_NAME).mkdir(mode=0o700)
                mark_authoring_released(private_root)
                terminal = private_root / ("final-ledger-" + "a" * 12)
                if case == "directory":
                    terminal.mkdir(mode=0o700)
                elif case == "symlink":
                    terminal.symlink_to(AUTHOR.CHECKPOINTS_NAME)
                else:
                    terminal.write_bytes(b"synthetic")
                    terminal.chmod(0o400)
                environment = self.author_environment(
                    package,
                    expectations,
                    private_root,
                    action="status",
                    generation=1,
                    head_sha256="1" * 64,
                )
                with mock.patch.object(
                    AUTHOR, "load_capture_for_authoring"
                ) as capture_reader, mock.patch.object(
                    AUTHOR, "_authoring_procedure_identity", return_value=SHA_C
                ):
                    with self.assertRaisesRegex(
                        AUTHOR.AuthoringEntrypointError, "publication_exists"
                    ):
                        AUTHOR.execute_authoring(environment, -1)
                capture_reader.assert_not_called()

    def test_named_root_replacement_is_detected(self):
        original = self.root / "replaceable-private"
        original.mkdir(mode=0o700)
        descriptor, path, metadata = AUTHOR._open_private_directory_path(
            os.fspath(original)
        )
        moved = self.root / "moved-private"
        original.rename(moved)
        original.mkdir(mode=0o700)
        try:
            with self.assertRaisesRegex(
                AUTHOR.AuthoringEntrypointError, "input_mutated"
            ):
                AUTHOR._revalidate_named_directory(path, metadata)
        finally:
            os.close(descriptor)

    def test_private_directory_wrong_owner_simulation_fails_closed(self):
        private_root = self.root / "wrong-owner-private"
        private_root.mkdir(mode=0o700)
        descriptor = open_directory(private_root)
        observed = os.fstat(descriptor)
        values = list(observed)
        values[4] = os.geteuid() + 1
        try:
            with mock.patch.object(
                authoring.os,
                "fstat",
                return_value=os.stat_result(values),
            ):
                with self.assertRaisesRegex(
                    authoring.AuthoringContractError, "input_invalid"
                ):
                    authoring._private_directory_metadata(descriptor)
        finally:
            os.close(descriptor)

    def test_capture_loader_never_opens_opaque_key(self):
        package, expectations, _capture, _entries = make_capture_package(
            self.root, ["TABLE", "SEQUENCE OWNED BY"]
        )
        descriptor = open_directory(package)
        opened = []
        original_open = os.open

        def guarded_open(path, *args, **kwargs):
            opened.append(os.fspath(path))
            if os.fspath(path) == "opaque-id.key":
                raise AssertionError("opaque key open attempted")
            return original_open(path, *args, **kwargs)

        try:
            with mock.patch.object(capture_contract.os, "open", side_effect=guarded_open):
                loaded = authoring.load_capture_for_authoring(descriptor, expectations)
        finally:
            os.close(descriptor)
        self.assertEqual(len(loaded.entries_by_ordinal), 2)
        self.assertNotIn("opaque-id.key", opened)

    def test_opaque_key_replacement_changes_binding_without_opening_key(self):
        package, expectations, _capture, _entries = make_capture_package(
            self.root, ["TABLE"]
        )
        descriptor = open_directory(package)
        try:
            before = authoring.load_capture_for_authoring(descriptor, expectations)
            replacement = package / ".replacement-key"
            replacement.write_bytes(b"z" * 32)
            replacement.chmod(0o400)
            os.replace(replacement, package / "opaque-id.key")
            after = authoring.load_capture_for_authoring(descriptor, expectations)
        finally:
            os.close(descriptor)
        self.assertNotEqual(
            before.capture_binding["opaque_key_inode"],
            after.capture_binding["opaque_key_inode"],
        )
        self.assertNotEqual(before.capture_binding, after.capture_binding)

    def test_capture_loader_rejects_links_modes_counts_and_concurrent_mutation(self):
        cases = ("permissive", "hardlink", "symlink")
        for case in cases:
            with self.subTest(case=case):
                package, expectations, _capture, _entries = make_capture_package(
                    self.root / case, ["TABLE"]
                )
                target = package / "opaque-index.json"
                if case == "permissive":
                    target.chmod(0o600)
                elif case == "hardlink":
                    os.link(target, self.root / "outside-index-hardlink")
                else:
                    original = package / ".opaque-index-original"
                    target.rename(original)
                    target.symlink_to(original.name)
                descriptor = open_directory(package)
                try:
                    with self.assertRaises(authoring.AuthoringContractError):
                        authoring.load_capture_for_authoring(descriptor, expectations)
                finally:
                    os.close(descriptor)

        package, expectations, _capture, _entries = make_capture_package(
            self.root / "mutation", ["TABLE"]
        )
        descriptor = open_directory(package)
        original_reader = authoring._read_capture_file
        mutated = False

        def mutating_reader(package_fd, name, maximum):
            nonlocal mutated
            result = original_reader(package_fd, name, maximum)
            if name == "raw-pg-restore-list.toc" and not mutated:
                mutated = True
                os.utime(package, None)
            return result

        try:
            with mock.patch.object(
                authoring, "_read_capture_file", side_effect=mutating_reader
            ):
                with self.assertRaisesRegex(
                    authoring.AuthoringContractError, "input_mutated"
                ):
                    authoring.load_capture_for_authoring(descriptor, expectations)
        finally:
            os.close(descriptor)

    def test_external_binding_rejects_coherent_capture_substitution(self):
        package, expectations, _capture, _entries = make_capture_package(
            self.root / "approved", ["TABLE"]
        )
        substitute_root = self.root / "substitute"
        substitute_root.mkdir(mode=0o700)
        substitute, _sub_expectations, _capture, _entries = make_capture_package(
            substitute_root,
            ["TABLE"],
            run_id="coherent-substitution",
            outer_sha="1" * 64,
            inner_sha="2" * 64,
            evidence_sha="3" * 64,
            inspection_checkout="4" * 40,
            inspection_procedure="5" * 64,
            execution_checkout="6" * 40,
            pg_sha="7" * 64,
        )
        approved_fd = open_directory(package)
        substitute_fd = open_directory(substitute)
        try:
            authoring.load_capture_for_authoring(approved_fd, expectations)
            with self.assertRaisesRegex(
                authoring.AuthoringContractError, "binding_mismatch"
            ):
                authoring.load_capture_for_authoring(substitute_fd, expectations)
        finally:
            os.close(approved_fd)
            os.close(substitute_fd)

    def test_independent_capture_hash_count_and_manifest_mismatches_reject(self):
        package, expectations, _capture, _entries = make_capture_package(
            self.root, ["TABLE"]
        )
        cases = {
            "raw_toc_sha256": "0" * 64,
            "opaque_index_sha256": "1" * 64,
            "capture_manifest_sha256": "2" * 64,
            "entry_count": 2,
            "data_reference_count": 1,
        }
        for field, value in cases.items():
            with self.subTest(field=field):
                supplied = dict(expectations.__dict__)
                supplied[field] = value
                mismatch = authoring.CaptureExpectations(**supplied)
                descriptor = open_directory(package)
                try:
                    with self.assertRaises(authoring.AuthoringContractError):
                        authoring.load_capture_for_authoring(descriptor, mismatch)
                finally:
                    os.close(descriptor)

    def test_initialize_keeps_proposals_distinct_and_draft_dependency_false(self):
        capture, _package, _expectations = self.load_capture(
            ["TABLE", "SEQUENCE OWNED BY", "SEQUENCE SET"]
        )
        checkpoint = authoring.initialize_checkpoint(
            capture, self.binding, "Primary Operator", "session-1"
        )
        self.assertTrue(
            all(item["dependency_review_complete"] is False for item in checkpoint["entries"])
        )
        self.assertTrue(
            all(item["mechanical_proposal"]["classification"] == "unresolved" for item in checkpoint["entries"])
        )
        self.assertTrue(
            all(item["primary_decision"]["classification"] is None for item in checkpoint["entries"])
        )
        self.assertEqual(
            checkpoint["entries"][1]["primary_decision"]["sequence_review_state"],
            "pending",
        )
        self.assertEqual(
            checkpoint["entries"][2]["primary_decision"]["sequence_review_state"],
            "pending",
        )

    def test_authoring_action_invokes_no_child_process_or_network(self):
        capture_root = self.root / "isolated-capture"
        sentinel = "RAW_NAME_SQL_OWNER_PATH_SECRET_PAYLOAD_SENTINEL"
        package, expectations, _capture, _entries = make_capture_package(
            capture_root, ["TABLE"], poison=sentinel
        )
        private_root = self.root / "isolated-private"
        private_root.mkdir(mode=0o700)
        environment = self.author_environment(
            package,
            expectations,
            private_root,
            action="initialize",
            generation=0,
            head_sha256="0" * 64,
        )
        with mock.patch.object(
            AUTHOR, "_authoring_procedure_identity", return_value=SHA_C
        ), mock.patch.object(
            AUTHOR._startup_subprocess,
            "run",
            side_effect=AssertionError("unexpected child process"),
        ), mock.patch.object(
            socket,
            "socket",
            side_effect=AssertionError("unexpected network operation"),
        ):
            exit_status, diagnostic = AUTHOR.execute_authoring(environment, -1)
        self.assertEqual(exit_status, 2)
        if sentinel.encode("ascii") in diagnostic:
            self.fail("private sentinel escaped into an ordinary diagnostic")
        checkpoint = next((private_root / AUTHOR.CHECKPOINTS_NAME).iterdir())
        if sentinel.encode("ascii") in checkpoint.read_bytes():
            self.fail("raw private context escaped into a checkpoint")

    def test_every_classification_is_explicit_and_unknown_is_rejected(self):
        for classification in sorted(capture_contract.CLASSIFICATIONS):
            with self.subTest(classification=classification):
                capture, _package, _expectations = self.load_capture(["TABLE"])
                checkpoint = authoring.initialize_checkpoint(
                    capture, self.binding, "Primary", "session-1"
                )
                decision = copy.deepcopy(
                    checkpoint["entries"][0]["primary_decision"]
                )
                decision["classification"] = classification
                decision["classification_reviewed"] = True
                decision["manual_conflict_review_state"] = (
                    "pending" if classification == "manual_conflict" else "not_applicable"
                )
                reviewed = authoring.apply_transition(
                    checkpoint,
                    capture,
                    self.binding,
                    action="primary_review",
                    operator_identity="Primary",
                    session_identity="session-2",
                    reviewed_ordinal_ranges=[{"start": 0, "end_exclusive": 1}],
                    entry_updates=[{"ordinal": 0, "primary_decision": decision}],
                )
                self.assertEqual(
                    reviewed["entries"][0]["primary_decision"]["classification"],
                    classification,
                )

        capture, _package, _expectations = self.load_capture(["TABLE"])
        checkpoint = authoring.initialize_checkpoint(
            capture, self.binding, "Primary", "session-1"
        )
        decision = copy.deepcopy(checkpoint["entries"][0]["primary_decision"])
        decision["classification"] = "synthetic_unknown"
        decision["classification_reviewed"] = True
        with self.assertRaisesRegex(
            authoring.AuthoringContractError, "checkpoint_invalid"
        ):
            authoring.apply_transition(
                checkpoint,
                capture,
                self.binding,
                action="primary_review",
                operator_identity="Primary",
                session_identity="session-2",
                reviewed_ordinal_ranges=[{"start": 0, "end_exclusive": 1}],
                entry_updates=[{"ordinal": 0, "primary_decision": decision}],
            )

    def test_same_operator_peer_rejected_before_transition(self):
        capture, _package, _expectations = self.load_capture()
        checkpoint = authoring.initialize_checkpoint(
            capture, self.binding, "Primary", "session-1"
        )
        with self.assertRaisesRegex(
            authoring.AuthoringContractError, "peer_identity_conflict"
        ):
            authoring.apply_transition(
                checkpoint,
                capture,
                self.binding,
                action="peer_review",
                operator_identity="Primary",
                session_identity="session-2",
                reviewed_ordinal_ranges=[{"start": 0, "end_exclusive": 1}],
                entry_updates=[
                    {
                        "ordinal": 0,
                        "peer_status": "approved",
                        "primary_decision_sha256": checkpoint["entries"][0][
                            "primary_decision_sha256"
                        ],
                    }
                ],
            )
        with self.assertRaisesRegex(
            authoring.AuthoringContractError, "peer_identity_conflict"
        ):
            authoring.apply_transition(
                checkpoint,
                capture,
                self.binding,
                action="peer_review",
                operator_identity="primary",
                session_identity="session-3",
                reviewed_ordinal_ranges=[{"start": 0, "end_exclusive": 1}],
                entry_updates=[
                    {
                        "ordinal": 0,
                        "peer_status": "approved",
                        "primary_decision_sha256": checkpoint["entries"][0][
                            "primary_decision_sha256"
                        ],
                    }
                ],
            )

    def test_forged_peer_operator_and_session_claims_fail_closed(self):
        capture, complete = self.fully_reviewed_checkpoint()
        for section, name in (
            ("global_decisions", "schema"),
            ("managed_domain_decisions", "auth"),
        ):
            with self.subTest(section=section):
                forged_operator = copy.deepcopy(complete)
                forged_operator[section][name]["peer_review"][
                    "operator_identity"
                ] = forged_operator["primary_operator_identity"]
                with self.assertRaisesRegex(
                    authoring.AuthoringContractError, "peer_identity_conflict"
                ):
                    authoring.validate_checkpoint(
                        forged_operator, capture, self.binding
                    )

        history = self.fully_reviewed_history(capture)
        previous, current = history[-2:]
        mutations = (
            lambda value: value["entries"][0]["peer_review"].__setitem__(
                "session_identity", "forged-session"
            ),
            lambda value: value["global_decisions"]["schema"][
                "peer_review"
            ].__setitem__("session_identity", "forged-session"),
            lambda value: value["managed_domain_decisions"]["auth"][
                "peer_review"
            ].__setitem__("session_identity", "forged-session"),
        )
        for mutate in mutations:
            forged_session = copy.deepcopy(current)
            mutate(forged_session)
            forged_session = authoring.validate_checkpoint(
                forged_session, capture, self.binding
            )
            with self.assertRaises(authoring.AuthoringContractError):
                authoring._validate_transition(previous, forged_session)

    def test_unknown_checkpoint_references_fail_structural_validation(self):
        capture, _package, _expectations = self.load_capture(["TABLE"])
        checkpoint = authoring.initialize_checkpoint(
            capture, self.binding, "Primary", "session-1"
        )
        unknown = "te1_" + "f" * 64
        for field, value in (
            ("parent_entry_ids", [unknown]),
            ("dependency_entry_ids", [unknown]),
            ("metadata_parent_entry_id", unknown),
        ):
            with self.subTest(field=field):
                forged = copy.deepcopy(checkpoint)
                forged["entries"][0]["primary_decision"][field] = value
                forged["entries"][0]["primary_decision_sha256"] = (
                    authoring._decision_sha256(
                        forged["entries"][0]["primary_decision"]
                    )
                )
                with self.assertRaisesRegex(
                    authoring.AuthoringContractError, "checkpoint_invalid"
                ):
                    authoring.validate_checkpoint(forged, capture, self.binding)

    def test_iterative_cycle_check_handles_deep_graph_and_detects_cycle(self):
        graph = {
            str(index): ({str(index + 1)} if index < 2499 else set())
            for index in range(2500)
        }
        authoring._detect_cycles(graph)
        graph["2499"] = {"0"}
        with self.assertRaisesRegex(
            authoring.AuthoringContractError, "finalization_incomplete"
        ):
            authoring._detect_cycles(graph)

    def test_peer_changes_requested_invalidates_every_approval(self):
        capture, complete = self.fully_reviewed_checkpoint()
        record = complete["entries"][0]
        corrected = authoring.apply_transition(
            complete,
            capture,
            self.binding,
            action="peer_review",
            operator_identity="Peer",
            session_identity="peer-correction",
            reviewed_ordinal_ranges=[{"start": 0, "end_exclusive": 1}],
            entry_updates=[
                {
                    "ordinal": 0,
                    "peer_status": "changes_requested",
                    "primary_decision_sha256": record["primary_decision_sha256"],
                }
            ],
        )
        decision = corrected["entries"][0]["primary_decision"]
        self.assertFalse(decision["classification_reviewed"])
        self.assertFalse(decision["dependency_reviewed"])
        self.assertFalse(decision["managed_domain_reviewed"])
        self.assertEqual(
            authoring.aggregate_status(corrected, capture)["authoring_state"],
            "PRIMARY_REVIEW_REQUIRED",
        )

    def test_global_only_primary_and_peer_checkpoints_allow_empty_ranges(self):
        capture, _package, _expectations = self.load_capture()
        checkpoint = authoring.initialize_checkpoint(
            capture, self.binding, "Primary", "session-1"
        )
        globals_selected = {
            "extension": "target_supported_only",
            "owner": "strip_and_rebind",
            "role": "exclude_source_roles",
            "schema": "selective_restore",
        }
        managed_selected = {
            name: "not_present" for name in capture_contract.MANAGED_DOMAINS
        }
        reviewed = authoring.apply_transition(
            checkpoint,
            capture,
            self.binding,
            action="managed_review",
            operator_identity="Primary",
            session_identity="session-2",
            reviewed_ordinal_ranges=[],
            global_updates=globals_selected,
            managed_updates=managed_selected,
        )
        peer = authoring.apply_transition(
            reviewed,
            capture,
            self.binding,
            action="peer_review",
            operator_identity="Peer",
            session_identity="session-3",
            reviewed_ordinal_ranges=[],
            global_updates={name: "approved" for name in globals_selected},
            managed_updates={name: "approved" for name in managed_selected},
        )
        self.assertEqual(peer["peer_operator_identity"], "Peer")

    def fully_reviewed_history(
        self,
        capture,
        *,
        binding=None,
        classification="restore",
        managed_domain="none",
        primary_operator="Primary",
        peer_operator="Peer",
    ):
        binding = self.binding if binding is None else binding
        history = []
        checkpoint = authoring.initialize_checkpoint(
            capture, binding, primary_operator, "session-1"
        )
        history.append(checkpoint)
        decision = copy.deepcopy(checkpoint["entries"][0]["primary_decision"])
        decision["classification"] = classification
        decision["classification_reviewed"] = True
        checkpoint = authoring.apply_transition(
            checkpoint,
            capture,
            binding,
            action="primary_review",
            operator_identity=primary_operator,
            session_identity="session-2",
            reviewed_ordinal_ranges=[{"start": 0, "end_exclusive": 1}],
            entry_updates=[{"ordinal": 0, "primary_decision": decision}],
        )
        history.append(checkpoint)
        decision = copy.deepcopy(checkpoint["entries"][0]["primary_decision"])
        decision["dependency_reviewed"] = True
        checkpoint = authoring.apply_transition(
            checkpoint,
            capture,
            binding,
            action="relationship_review",
            operator_identity=primary_operator,
            session_identity="session-3",
            reviewed_ordinal_ranges=[{"start": 0, "end_exclusive": 1}],
            entry_updates=[{"ordinal": 0, "primary_decision": decision}],
        )
        history.append(checkpoint)
        decision = copy.deepcopy(checkpoint["entries"][0]["primary_decision"])
        decision["managed_domain"] = managed_domain
        decision["managed_domain_reviewed"] = True
        globals_selected = {
            "extension": "target_supported_only",
            "owner": "strip_and_rebind",
            "role": "exclude_source_roles",
            "schema": "selective_restore",
        }
        managed_selected = {
            name: "not_present" for name in capture_contract.MANAGED_DOMAINS
        }
        checkpoint = authoring.apply_transition(
            checkpoint,
            capture,
            binding,
            action="managed_review",
            operator_identity=primary_operator,
            session_identity="session-4",
            reviewed_ordinal_ranges=[{"start": 0, "end_exclusive": 1}],
            entry_updates=[{"ordinal": 0, "primary_decision": decision}],
            global_updates=globals_selected,
            managed_updates=managed_selected,
        )
        history.append(checkpoint)
        checkpoint = authoring.apply_transition(
            checkpoint,
            capture,
            binding,
            action="peer_review",
            operator_identity=peer_operator,
            session_identity="session-5",
            reviewed_ordinal_ranges=[{"start": 0, "end_exclusive": 1}],
            entry_updates=[
                {
                    "ordinal": 0,
                    "peer_status": "approved",
                    "primary_decision_sha256": checkpoint["entries"][0][
                        "primary_decision_sha256"
                    ],
                }
            ],
            global_updates={name: "approved" for name in globals_selected},
            managed_updates={name: "approved" for name in managed_selected},
        )
        history.append(checkpoint)
        return history

    def fully_reviewed_checkpoint(self):
        capture, _package, _expectations = self.load_capture(["TABLE"])
        return capture, self.fully_reviewed_history(capture)[-1]

    def structurally_reviewed_checkpoint(self, capture):
        checkpoint = authoring.initialize_checkpoint(
            capture, self.binding, "Primary", "session-1"
        )
        checkpoint["generation"] = 2
        checkpoint["previous_checkpoint_sha256"] = "f" * 64
        checkpoint["peer_operator_identity"] = "Peer"
        checkpoint["event"] = {
            "action": "peer_review",
            "operator_identity": "Peer",
            "operator_role": "peer",
            "operator_session_identity": "peer-session",
            "reviewed_ordinal_ranges": [],
        }
        for record in checkpoint["entries"]:
            decision = record["primary_decision"]
            decision["classification"] = "restore"
            decision["classification_reviewed"] = True
            decision["dependency_reviewed"] = True
            decision["managed_domain"] = "none"
            decision["managed_domain_reviewed"] = True
            if decision["relationship_review_state"] == "pending":
                decision["relationship_review_state"] = "reviewed"
            if decision["data_reference_review_state"] == "pending":
                decision["data_reference_review_state"] = "reviewed"
            if decision["sequence_review_state"] == "pending":
                decision["sequence_review_state"] = "reviewed"
            digest = authoring._decision_sha256(decision)
            record["primary_decision_sha256"] = digest
            record["peer_review"] = {
                "operator_identity": "Peer",
                "primary_decision_sha256": digest,
                "session_identity": "peer-session",
                "status": "approved",
            }
        global_values = {
            "extension": "target_supported_only",
            "owner": "strip_and_rebind",
            "role": "exclude_source_roles",
            "schema": "selective_restore",
        }
        for name, value in global_values.items():
            digest = capture_contract.sha256_bytes(
                capture_contract.canonical_json_bytes({"value": value})
            )
            checkpoint["global_decisions"][name] = {
                "peer_review": {
                    "operator_identity": "Peer",
                    "primary_decision_sha256": digest,
                    "session_identity": "peer-session",
                    "status": "approved",
                },
                "primary_decision_sha256": digest,
                "primary_reviewed": True,
                "value": value,
            }
        for name in capture_contract.MANAGED_DOMAINS:
            value = "not_present"
            digest = capture_contract.sha256_bytes(
                capture_contract.canonical_json_bytes({"value": value})
            )
            checkpoint["managed_domain_decisions"][name] = {
                "peer_review": {
                    "operator_identity": "Peer",
                    "primary_decision_sha256": digest,
                    "session_identity": "peer-session",
                    "status": "approved",
                },
                "primary_decision_sha256": digest,
                "primary_reviewed": True,
                "value": value,
            }
        return checkpoint

    def test_each_review_phase_remains_independently_blocking(self):
        capture, _package, _expectations = self.load_capture(
            ["TABLE", "TABLE DATA", "SEQUENCE", "SEQUENCE SET"]
        )
        baseline = self.structurally_reviewed_checkpoint(capture)
        cases = []

        dependency = copy.deepcopy(baseline)
        dependency["entries"][0]["primary_decision"]["dependency_reviewed"] = False
        cases.append(("dependency", dependency, "RELATIONSHIP_REVIEW_REQUIRED"))

        data_reference = copy.deepcopy(baseline)
        data_reference["entries"][1]["primary_decision"][
            "data_reference_review_state"
        ] = "pending"
        cases.append(("data", data_reference, "DATA_REFERENCE_REVIEW_REQUIRED"))

        sequence = copy.deepcopy(baseline)
        sequence["entries"][3]["primary_decision"]["sequence_review_state"] = "pending"
        cases.append(("sequence", sequence, "SEQUENCE_REVIEW_REQUIRED"))

        managed = copy.deepcopy(baseline)
        managed["entries"][0]["primary_decision"]["managed_domain_reviewed"] = False
        cases.append(("managed", managed, "MANAGED_GLOBAL_REVIEW_REQUIRED"))

        global_review = copy.deepcopy(baseline)
        global_review["global_decisions"]["schema"] = authoring._initial_decision_record()
        cases.append(("global", global_review, "MANAGED_GLOBAL_REVIEW_REQUIRED"))

        manual = copy.deepcopy(baseline)
        manual_decision = manual["entries"][0]["primary_decision"]
        manual_decision["classification"] = "manual_conflict"
        manual_decision["manual_conflict_review_state"] = "pending"
        manual["entries"][0]["peer_review"] = authoring._pending_peer()
        cases.append(("manual", manual, "MANUAL_CONFLICT_REVIEW_REQUIRED"))

        peer = copy.deepcopy(baseline)
        peer["entries"][0]["peer_review"] = authoring._pending_peer()
        cases.append(("peer", peer, "PEER_REVIEW_REQUIRED"))

        for name, checkpoint, expected_state in cases:
            with self.subTest(name=name):
                for record in checkpoint["entries"]:
                    digest = authoring._decision_sha256(record["primary_decision"])
                    record["primary_decision_sha256"] = digest
                    if record["peer_review"]["status"] != "pending":
                        record["peer_review"]["primary_decision_sha256"] = digest
                self.assertEqual(
                    authoring.aggregate_status(checkpoint, capture)["authoring_state"],
                    expected_state,
                )

    def test_final_ledger_only_after_separate_complete_state(self):
        capture, _package, _expectations = self.load_capture(["TABLE"])
        incomplete = authoring.initialize_checkpoint(
            capture, self.binding, "Primary", "session-1"
        )
        with self.assertRaisesRegex(
            authoring.AuthoringContractError, "finalization_incomplete"
        ):
            authoring.build_final_ledger(incomplete, capture, self.binding)

        capture, complete = self.fully_reviewed_checkpoint()
        ledger_bytes = authoring.build_final_ledger(complete, capture, self.binding)
        ledger = json.loads(ledger_bytes)
        self.assertTrue(ledger["annotations"][0]["dependency_review_complete"])
        self.assertEqual(
            ledger["capture_binding"]["execution_checkout_sha"], GIT_A
        )
        self.assertEqual(
            authoring.aggregate_status(complete, capture)["authoring_state"],
            "FINALIZATION_ELIGIBLE",
        )

    def test_status_never_claims_eligible_when_semantic_finalization_fails(self):
        capture, complete = self.fully_reviewed_checkpoint()
        invalid = copy.deepcopy(complete)
        decision = invalid["entries"][0]["primary_decision"]
        decision["classification"] = "exclude_supabase_managed"
        decision_sha = authoring._decision_sha256(decision)
        invalid["entries"][0]["primary_decision_sha256"] = decision_sha
        invalid["entries"][0]["peer_review"]["primary_decision_sha256"] = decision_sha
        status = authoring.aggregate_status(invalid, capture)
        self.assertEqual(status["authoring_state"], "FINALIZATION_REVIEW_REQUIRED")
        self.assertEqual(status["restore_planning_gate"], "BLOCKED")
        with self.assertRaisesRegex(
            authoring.AuthoringContractError, "finalization_incomplete"
        ):
            authoring.build_final_ledger(invalid, capture, self.binding)

    def test_semantic_failure_can_be_corrected_then_peer_reapproved(self):
        capture, complete = self.fully_reviewed_checkpoint()
        invalid = copy.deepcopy(complete)
        decision = invalid["entries"][0]["primary_decision"]
        decision["classification"] = "exclude_supabase_managed"
        decision_sha = authoring._decision_sha256(decision)
        invalid["entries"][0]["primary_decision_sha256"] = decision_sha
        invalid["entries"][0]["peer_review"]["primary_decision_sha256"] = decision_sha
        self.assertEqual(
            authoring.aggregate_status(invalid, capture)["authoring_state"],
            "FINALIZATION_REVIEW_REQUIRED",
        )

        corrected_decision = copy.deepcopy(decision)
        corrected_decision["classification"] = "restore"
        corrected = authoring.apply_transition(
            invalid,
            capture,
            self.binding,
            action="primary_review",
            operator_identity="Primary",
            session_identity="correction-session",
            reviewed_ordinal_ranges=[{"start": 0, "end_exclusive": 1}],
            entry_updates=[
                {"ordinal": 0, "primary_decision": corrected_decision}
            ],
        )
        self.assertEqual(corrected["entries"][0]["peer_review"]["status"], "pending")
        reapproved = authoring.apply_transition(
            corrected,
            capture,
            self.binding,
            action="peer_review",
            operator_identity="Peer",
            session_identity="peer-reapproval",
            reviewed_ordinal_ranges=[{"start": 0, "end_exclusive": 1}],
            entry_updates=[
                {
                    "ordinal": 0,
                    "peer_status": "approved",
                    "primary_decision_sha256": corrected["entries"][0][
                        "primary_decision_sha256"
                    ],
                }
            ],
        )
        self.assertEqual(
            authoring.aggregate_status(reapproved, capture)["authoring_state"],
            "FINALIZATION_ELIGIBLE",
        )
        self.assertTrue(authoring.build_final_ledger(reapproved, capture, self.binding))

    def test_entrypoint_semantic_correction_is_tty_selected_and_checkpointed(self):
        capture_root = self.root / "correction-capture"
        package, expectations, _capture, _entries = make_capture_package(
            capture_root, ["TABLE"]
        )
        package_fd = open_directory(package)
        try:
            loaded = authoring.load_capture_for_authoring(package_fd, expectations)
        finally:
            os.close(package_fd)
        private_root = self.root / "correction-private"
        private_root.mkdir(mode=0o700)
        binding_environment = self.author_environment(
            package,
            expectations,
            private_root,
            action="status",
            generation=0,
            head_sha256="0" * 64,
        )
        runtime_binding = authoring.AuthoringBinding(
            GIT_A,
            SHA_C,
            binding_environment[
                "TOC_AUTHOR_APPROVED_EXECUTION_PYTHON_SHA256"
            ],
        )
        history = self.fully_reviewed_history(
            loaded,
            binding=runtime_binding,
            classification="exclude_supabase_managed",
            managed_domain="none",
            primary_operator="Primary Reviewer",
        )
        self.assertEqual(
            authoring.aggregate_status(history[-1], loaded)["authoring_state"],
            "FINALIZATION_REVIEW_REQUIRED",
        )
        checkpoints = private_root / AUTHOR.CHECKPOINTS_NAME
        checkpoints.mkdir(mode=0o700)
        checkpoints_fd = open_directory(checkpoints)
        try:
            for checkpoint in history:
                authoring.publish_checkpoint_at(checkpoints_fd, checkpoint)
        finally:
            os.close(checkpoints_fd)
        mark_authoring_released(private_root)
        head = authoring.checkpoint_sha256(history[-1])
        environment = self.author_environment(
            package,
            expectations,
            private_root,
            action="correction_review",
            generation=history[-1]["generation"],
            head_sha256=head,
        )
        with mock.patch.object(AUTHOR, "_authoring_procedure_identity", return_value=SHA_C):
            with mock.patch.object(
                AUTHOR, "_prompt_choice", side_effect=["primary_review", "restore"]
            ):
                with mock.patch.object(
                    AUTHOR, "_prompt_correction_ordinals", return_value=(0,)
                ):
                    with mock.patch.object(AUTHOR, "_write_tty"):
                        exit_status, diagnostic = AUTHOR.execute_authoring(
                            environment, -1
                        )
        self.assertEqual(exit_status, 2)
        if b"synthetic-private-object" in diagnostic:
            self.fail("private synthetic object escaped into diagnostic")
        checkpoints_fd = open_directory(checkpoints)
        try:
            chain = authoring.load_checkpoint_chain(
                checkpoints_fd, loaded, runtime_binding
            )
        finally:
            os.close(checkpoints_fd)
        self.assertEqual(len(chain.checkpoints), len(history) + 1)
        self.assertEqual(
            chain.head["entries"][0]["primary_decision"]["classification"],
            "restore",
        )
        self.assertEqual(chain.head["entries"][0]["peer_review"]["status"], "pending")
        self.assertEqual(
            authoring.aggregate_status(chain.head, loaded)["authoring_state"],
            "PEER_REVIEW_REQUIRED",
        )

    def test_execute_finalize_requires_exact_authorization_and_no_replace(self):
        capture_root = self.root / "finalize-capture"
        package, expectations, _capture, _entries = make_capture_package(
            capture_root, ["TABLE"]
        )
        package_fd = open_directory(package)
        try:
            loaded = authoring.load_capture_for_authoring(package_fd, expectations)
        finally:
            os.close(package_fd)
        private_root = self.root / "finalize-private"
        private_root.mkdir(mode=0o700)
        binding_environment = self.author_environment(
            package,
            expectations,
            private_root,
            action="status",
            generation=0,
            head_sha256="0" * 64,
        )
        runtime_binding = authoring.AuthoringBinding(
            GIT_A,
            SHA_C,
            binding_environment[
                "TOC_AUTHOR_APPROVED_EXECUTION_PYTHON_SHA256"
            ],
        )
        history = self.fully_reviewed_history(
            loaded,
            binding=runtime_binding,
            primary_operator="Primary Reviewer",
        )
        checkpoints = private_root / AUTHOR.CHECKPOINTS_NAME
        checkpoints.mkdir(mode=0o700)
        checkpoints_fd = open_directory(checkpoints)
        try:
            for checkpoint in history:
                authoring.publish_checkpoint_at(checkpoints_fd, checkpoint)
        finally:
            os.close(checkpoints_fd)
        mark_authoring_released(private_root)
        head = authoring.checkpoint_sha256(history[-1])
        environment = self.author_environment(
            package,
            expectations,
            private_root,
            action="finalize",
            generation=history[-1]["generation"],
            head_sha256=head,
        )
        before_names = sorted(path.name for path in checkpoints.iterdir())
        for authorization in (None, "WRONG_AUTHORIZATION"):
            with self.subTest(authorization=authorization):
                rejected = dict(environment)
                if authorization is None:
                    rejected.pop("TOC_AUTHOR_FINALIZATION_AUTHORIZATION")
                else:
                    rejected["TOC_AUTHOR_FINALIZATION_AUTHORIZATION"] = authorization
                with mock.patch.object(
                    AUTHOR, "_authoring_procedure_identity", return_value=SHA_C
                ):
                    with self.assertRaises(AUTHOR.AuthoringEntrypointError):
                        AUTHOR.execute_authoring(rejected, -1)
                self.assertEqual(
                    sorted(path.name for path in checkpoints.iterdir()), before_names
                )
                self.assertEqual(
                    set(path.name for path in private_root.iterdir()),
                    {AUTHOR.CHECKPOINTS_NAME, AUTHOR.RELEASED_NAME},
                )
                environment["TOC_AUTHOR_EXPECTED_RELEASE_TOKEN"] = released_token(
                    private_root
                )

        approved = dict(environment)
        approved["TOC_AUTHOR_FINALIZATION_AUTHORIZATION"] = (
            AUTHOR.FINALIZATION_AUTHORIZATION
        )
        with mock.patch.object(
            AUTHOR, "_authoring_procedure_identity", return_value=SHA_C
        ):
            exit_status, diagnostic = AUTHOR.execute_authoring(approved, -1)
        self.assertEqual(exit_status, 2)
        if b"synthetic-private-object" in diagnostic:
            self.fail("private synthetic object escaped into diagnostic")
        self.assertEqual(sorted(path.name for path in checkpoints.iterdir()), before_names)
        final_names = [
            path
            for path in private_root.iterdir()
            if path.name.startswith("final-ledger-")
        ]
        self.assertEqual(len(final_names), 1)
        receipt = json.loads(
            (final_names[0] / "authoring-finalization.json").read_bytes()
        )
        self.assertEqual(receipt["ledger_validation_status"], "NOT_INVOKED")
        self.assertEqual(receipt["restore_planning_gate"], "BLOCKED")
        self.assertEqual(receipt["migration_readiness"], "RED")
        with mock.patch.object(
            AUTHOR, "_authoring_procedure_identity", return_value=SHA_C
        ):
            with self.assertRaisesRegex(
                AUTHOR.AuthoringEntrypointError, "publication_exists"
            ):
                AUTHOR.execute_authoring(approved, -1)
        self.assertEqual(len(final_names), 1)

    def test_checkpoint_publication_resume_and_fork_fail_closed(self):
        capture, _package, _expectations = self.load_capture()
        initial = authoring.initialize_checkpoint(
            capture, self.binding, "Primary", "session-1"
        )
        checkpoints = self.root / "checkpoints"
        checkpoints.mkdir(mode=0o700)
        descriptor = open_directory(checkpoints)
        try:
            name = authoring.publish_checkpoint_at(descriptor, initial)
            chain = authoring.load_checkpoint_chain(descriptor, capture, self.binding)
            self.assertEqual(chain.head_sha256, authoring.checkpoint_sha256(initial))
            self.assertEqual(name, authoring.checkpoint_filename(initial))
            with self.assertRaisesRegex(
                authoring.AuthoringContractError, "publication_exists"
            ):
                authoring.publish_checkpoint_at(descriptor, initial)
        finally:
            os.close(descriptor)
        conflicting = copy.deepcopy(initial)
        conflicting["event"]["operator_session_identity"] = "other-session"
        conflicting_name = authoring.checkpoint_filename(conflicting)
        (checkpoints / conflicting_name).write_bytes(
            authoring.checkpoint_bytes(conflicting)
        )
        (checkpoints / conflicting_name).chmod(0o400)
        descriptor = open_directory(checkpoints)
        try:
            with self.assertRaisesRegex(
                authoring.AuthoringContractError, "history_conflict"
            ):
                authoring.load_checkpoint_chain(descriptor, capture, self.binding)
        finally:
            os.close(descriptor)

    def test_missing_generation_and_hash_substitution_fail_closed(self):
        capture, _package, _expectations = self.load_capture()
        initial = authoring.initialize_checkpoint(
            capture, self.binding, "Primary", "session-1"
        )

        missing_root = self.root / "missing-generation"
        missing_root.mkdir(mode=0o700)
        data = authoring.checkpoint_bytes(initial)
        missing_name = "checkpoint-g%016d-%s.json" % (
            2,
            hashlib.sha256(data).hexdigest(),
        )
        (missing_root / missing_name).write_bytes(data)
        (missing_root / missing_name).chmod(0o400)
        descriptor = open_directory(missing_root)
        try:
            with self.assertRaisesRegex(
                authoring.AuthoringContractError, "history_conflict"
            ):
                authoring.load_checkpoint_chain(descriptor, capture, self.binding)
        finally:
            os.close(descriptor)

        substitution_root = self.root / "hash-substitution"
        substitution_root.mkdir(mode=0o700)
        descriptor = open_directory(substitution_root)
        try:
            published = authoring.publish_checkpoint_at(descriptor, initial)
        finally:
            os.close(descriptor)
        path = substitution_root / published
        path.chmod(0o600)
        path.write_bytes(data[:-2] + b"X\n")
        path.chmod(0o400)
        descriptor = open_directory(substitution_root)
        try:
            with self.assertRaisesRegex(
                authoring.AuthoringContractError, "history_invalid"
            ):
                authoring.load_checkpoint_chain(descriptor, capture, self.binding)
        finally:
            os.close(descriptor)

    def test_real_fsync_and_rename_errors_roll_back_pending_checkpoint(self):
        capture, _package, _expectations = self.load_capture()
        checkpoint = authoring.initialize_checkpoint(
            capture, self.binding, "Primary", "session-1"
        )
        for case in ("fsync", "rename"):
            with self.subTest(case=case):
                root = self.root / ("checkpoint-system-error-" + case)
                root.mkdir(mode=0o700)
                descriptor = open_directory(root)
                try:
                    if case == "fsync":
                        real_fsync = authoring.os.fsync
                        calls = 0

                        def fail_once(target):
                            nonlocal calls
                            calls += 1
                            if calls == 1:
                                raise OSError("synthetic fsync failure")
                            return real_fsync(target)

                        context = mock.patch.object(
                            authoring.os, "fsync", side_effect=fail_once
                        )
                    else:
                        context = mock.patch.object(
                            authoring,
                            "_rename_no_replace",
                            side_effect=capture_contract.ContractError(
                                "publication_failed"
                            ),
                        )
                    with context:
                        with self.assertRaisesRegex(
                            authoring.AuthoringContractError, "publication_failed"
                        ):
                            authoring.publish_checkpoint_at(descriptor, checkpoint)
                    self.assertEqual(os.listdir(descriptor), [])
                finally:
                    os.close(descriptor)

    def test_partial_checkpoint_write_is_removed_and_never_looks_complete(self):
        capture, _package, _expectations = self.load_capture()
        checkpoint = authoring.initialize_checkpoint(
            capture, self.binding, "Primary", "session-1"
        )
        checkpoints = self.root / "partial-checkpoints"
        checkpoints.mkdir(mode=0o700)
        descriptor = open_directory(checkpoints)
        try:
            with self.assertRaisesRegex(
                authoring.AuthoringContractError, "publication_failed"
            ):
                authoring.publish_checkpoint_at(
                    descriptor, checkpoint, fail_stage="partial_write"
                )
            self.assertEqual(os.listdir(descriptor), [])
        finally:
            os.close(descriptor)

    def test_checkpoint_publication_failure_matrix_leaves_no_valid_generation(self):
        capture, _package, _expectations = self.load_capture()
        checkpoint = authoring.initialize_checkpoint(
            capture, self.binding, "Primary", "session-1"
        )
        for stage in (
            "partial_write",
            "before_rename",
            "after_rename",
            "post_rename_mode",
            "post_rename_substitute",
            "after_readback",
            "after_fsync",
        ):
            with self.subTest(stage=stage):
                checkpoints = self.root / ("checkpoint-failure-" + stage)
                checkpoints.mkdir(mode=0o700)
                descriptor = open_directory(checkpoints)
                try:
                    with self.assertRaises(authoring.AuthoringContractError):
                        authoring.publish_checkpoint_at(
                            descriptor, checkpoint, fail_stage=stage
                        )
                    self.assertEqual(os.listdir(descriptor), [])
                finally:
                    os.close(descriptor)

    def test_checkpoint_cleanup_failure_quarantines_generation(self):
        capture, _package, _expectations = self.load_capture()
        checkpoint = authoring.initialize_checkpoint(
            capture, self.binding, "Primary", "session-1"
        )
        checkpoints = self.root / "checkpoint-cleanup-failure"
        checkpoints.mkdir(mode=0o700)
        descriptor = open_directory(checkpoints)
        final_name = authoring.checkpoint_filename(checkpoint)
        real_unlink = authoring.os.unlink

        def planted_unlink(path, *args, **kwargs):
            if path == final_name:
                raise OSError("synthetic cleanup failure")
            return real_unlink(path, *args, **kwargs)

        try:
            with mock.patch.object(authoring.os, "unlink", side_effect=planted_unlink):
                with self.assertRaisesRegex(
                    authoring.AuthoringContractError, "cleanup_indeterminate"
                ):
                    authoring.publish_checkpoint_at(
                        descriptor, checkpoint, fail_stage="after_rename"
                    )
            names = os.listdir(descriptor)
            self.assertEqual(len(names), 1)
            self.assertTrue(names[0].startswith(".indeterminate-checkpoint-"))
            self.assertNotIn(final_name, names)
        finally:
            os.close(descriptor)

    def test_final_candidate_package_is_atomic_private_and_no_replace(self):
        final_root = self.root / "final-candidate-root"
        final_root.mkdir(mode=0o700)
        ledger = capture_contract.canonical_json_bytes(
            {"artifact_kind": "synthetic-unvalidated-ledger", "format_version": 1}
        )
        receipt = capture_contract.canonical_json_bytes(
            {"artifact_kind": "synthetic-finalization", "format_version": 1}
        )
        head = "8" * 64
        descriptor = open_directory(final_root)
        try:
            name = authoring.publish_final_candidate_at(
                descriptor, ledger, receipt, head
            )
            self.assertEqual(name, "final-ledger-" + head[:12])
            with self.assertRaisesRegex(
                authoring.AuthoringContractError, "publication_exists"
            ):
                authoring.publish_final_candidate_at(
                    descriptor, ledger, receipt, head
                )
        finally:
            os.close(descriptor)
        package = final_root / name
        self.assertEqual(stat.S_IMODE(package.stat().st_mode), 0o700)
        self.assertEqual(
            set(path.name for path in package.iterdir()),
            {
                "annotation-ledger.json",
                "authoring-finalization.json",
                "evidence-files.json",
                "EVIDENCE_COMPLETE",
            },
        )
        evidence = json.loads((package / "evidence-files.json").read_bytes())
        self.assertEqual(
            {
                record["name"]: record["sha256"]
                for record in evidence["files"]
            },
            {
                "annotation-ledger.json": hashlib.sha256(ledger).hexdigest(),
                "authoring-finalization.json": hashlib.sha256(receipt).hexdigest(),
            },
        )
        complete = json.loads((package / "EVIDENCE_COMPLETE").read_bytes())
        self.assertEqual(
            complete["evidence_files_sha256"],
            hashlib.sha256((package / "evidence-files.json").read_bytes()).hexdigest(),
        )
        for path in package.iterdir():
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o400)
            self.assertEqual(path.stat().st_nlink, 1)

    def test_final_candidate_failure_matrix_never_leaves_completion_marker(self):
        ledger = capture_contract.canonical_json_bytes(
            {"artifact_kind": "synthetic-unvalidated-ledger", "format_version": 1}
        )
        receipt = capture_contract.canonical_json_bytes(
            {"artifact_kind": "synthetic-finalization", "format_version": 1}
        )
        stages = (
            "partial_write",
            "before_rename",
            "after_rename",
            "after_rename_fsync",
            "before_complete",
            "after_complete",
            "after_package_fsync",
            "after_final_fsync",
        )
        for index, stage in enumerate(stages):
            with self.subTest(stage=stage):
                final_root = self.root / ("final-failure-" + stage)
                final_root.mkdir(mode=0o700)
                descriptor = open_directory(final_root)
                try:
                    with self.assertRaisesRegex(
                        authoring.AuthoringContractError, "publication_failed"
                    ):
                        authoring.publish_final_candidate_at(
                            descriptor,
                            ledger,
                            receipt,
                            ("%x" % (index + 1)) * 64,
                            fail_stage=stage,
                        )
                    self.assertEqual(os.listdir(descriptor), [])
                finally:
                    os.close(descriptor)

    def test_final_candidate_cleanup_failure_is_private_indeterminate(self):
        final_root = self.root / "final-cleanup-failure"
        final_root.mkdir(mode=0o700)
        ledger = capture_contract.canonical_json_bytes(
            {"artifact_kind": "synthetic-unvalidated-ledger", "format_version": 1}
        )
        receipt = capture_contract.canonical_json_bytes(
            {"artifact_kind": "synthetic-finalization", "format_version": 1}
        )
        descriptor = open_directory(final_root)
        real_unlink = authoring.os.unlink

        def planted_unlink(path, *args, **kwargs):
            if path == "annotation-ledger.json":
                raise OSError("synthetic cleanup failure")
            return real_unlink(path, *args, **kwargs)

        try:
            with mock.patch.object(authoring.os, "unlink", side_effect=planted_unlink):
                with self.assertRaisesRegex(
                    authoring.AuthoringContractError, "cleanup_indeterminate"
                ):
                    authoring.publish_final_candidate_at(
                        descriptor,
                        ledger,
                        receipt,
                        "e" * 64,
                        fail_stage="after_complete",
                    )
            names = os.listdir(descriptor)
            self.assertEqual(len(names), 1)
            self.assertTrue(names[0].startswith(".indeterminate-final-ledger-"))
            quarantine_fd = open_directory(final_root / names[0])
            try:
                self.assertNotIn("EVIDENCE_COMPLETE", os.listdir(quarantine_fd))
            finally:
                os.close(quarantine_fd)
        finally:
            os.close(descriptor)

    def test_outer_entrypoint_marks_indeterminate_on_ambiguous_publication(self):
        capture_root = self.root / "ambiguous-capture"
        package, expectations, _capture, _entries = make_capture_package(
            capture_root, ["TABLE"]
        )
        private_root = self.root / "ambiguous-private"
        private_root.mkdir(mode=0o700)
        environment = self.author_environment(
            package,
            expectations,
            private_root,
            action="initialize",
            generation=0,
            head_sha256="0" * 64,
        )
        with mock.patch.object(AUTHOR, "_authoring_procedure_identity", return_value=SHA_C):
            with mock.patch.object(
                AUTHOR,
                "publish_checkpoint_at",
                side_effect=authoring.AuthoringContractError("cleanup_indeterminate"),
            ):
                with self.assertRaisesRegex(
                    AUTHOR.AuthoringEntrypointError, "cleanup_indeterminate"
                ):
                    AUTHOR.execute_authoring(environment, -1)
        self.assertTrue((private_root / AUTHOR.INDETERMINATE_NAME).exists())
        self.assertTrue((private_root / AUTHOR.LOCK_NAME).exists())

    def test_checkpoint_directory_replacement_is_detected(self):
        private_root = self.root / "child-root"
        private_root.mkdir(mode=0o700)
        child = private_root / "checkpoints"
        child.mkdir(mode=0o700)
        root_fd = open_directory(private_root)
        child_fd, metadata = AUTHOR._open_private_child_directory(
            root_fd, "checkpoints"
        )
        moved = private_root / "moved-checkpoints"
        child.rename(moved)
        child.mkdir(mode=0o700)
        try:
            with self.assertRaisesRegex(
                AUTHOR.AuthoringEntrypointError, "input_mutated"
            ):
                AUTHOR._revalidate_child_directory(
                    root_fd, "checkpoints", child_fd, metadata
                )
        finally:
            os.close(child_fd)
            os.close(root_fd)

    def test_strict_checkpoint_json_rejects_duplicate_and_nonfinite_values(self):
        checkpoint_schema = capture_contract.strict_json_loads(
            (
                ROOT
                / "scripts"
                / "migration"
                / "verification"
                / "lovable-toc-annotation-checkpoint.schema.json"
            ).read_bytes()
        )
        self.assertEqual(
            checkpoint_schema["properties"]["artifact_kind"]["const"],
            authoring.CHECKPOINT_ARTIFACT_KIND,
        )
        self.assertFalse(
            checkpoint_schema["$defs"]["entry"]["properties"][
                "dependency_review_complete"
            ]["const"]
        )
        for raw in (
            b'{"generation":1,"generation":2}\n',
            b'{"generation":NaN}\n',
            b'{"generation":"\x01"}\n',
            b"\xff",
        ):
            with self.assertRaises(capture_contract.ContractError):
                capture_contract.strict_json_loads(raw)
        with self.assertRaises(capture_contract.ContractError):
            capture_contract.strict_json_loads(b'{"generation":1}\n', max_bytes=4)

        capture, _package, _expectations = self.load_capture()
        checkpoint = authoring.initialize_checkpoint(
            capture, self.binding, "Primary", "session-1"
        )
        unknown = copy.deepcopy(checkpoint)
        unknown["unexpected_readiness"] = "GREEN"
        with self.assertRaisesRegex(
            authoring.AuthoringContractError, "checkpoint_invalid"
        ):
            authoring.validate_checkpoint(unknown, capture, self.binding)
        with self.assertRaisesRegex(authoring.AuthoringContractError, "input_invalid"):
            authoring.initialize_checkpoint(
                capture, self.binding, "Primary\x00sentinel", "session-1"
            )
        for ambiguous in ("Primary ", "Primary  Reviewer"):
            with self.subTest(identity=ambiguous):
                with self.assertRaisesRegex(
                    authoring.AuthoringContractError, "input_invalid"
                ):
                    authoring.initialize_checkpoint(
                        capture, self.binding, ambiguous, "session-1"
                    )


if __name__ == "__main__":
    unittest.main()
