from __future__ import annotations

import copy
from contextlib import ExitStack
import hashlib
import importlib.util
import json
import os
import socket
import stat
import sys
import tempfile
import threading
import unicodedata
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


class ReviewedGitEnvironmentTest(unittest.TestCase):
    def test_private_path_key_normalizes_case_and_unicode(self):
        composed = Path("/private/tmp/Authoring-Caf\u00e9")
        decomposed = Path(
            unicodedata.normalize("NFD", os.fspath(composed))
        )
        self.assertEqual(
            AUTHOR._portable_private_path_key(composed),
            AUTHOR._portable_private_path_key(decomposed),
        )
        self.assertEqual(
            AUTHOR._portable_private_path_key(composed),
            AUTHOR._portable_private_path_key(
                Path(os.fspath(composed).swapcase())
            ),
        )
        self.assertEqual(
            AUTHOR._portable_private_path_key(
                Path("//private/tmp/Authoring-Caf\u00e9")
            ),
            AUTHOR._portable_private_path_key(composed),
        )

    def test_double_slash_private_root_is_rejected_before_open(self):
        with tempfile.TemporaryDirectory(
            prefix="authoring-double-slash."
        ) as temporary:
            private_root = Path(temporary).resolve()
            double_slash = "/" + os.fspath(private_root)
            with mock.patch.object(
                Path,
                "resolve",
                side_effect=AssertionError(
                    "double-slash private root was resolved"
                ),
            ) as resolve, mock.patch.object(
                AUTHOR.os,
                "open",
                side_effect=AssertionError(
                    "double-slash private root was opened"
                ),
            ):
                with self.assertRaisesRegex(
                    AUTHOR.AuthoringEntrypointError, "input_invalid"
                ):
                    AUTHOR._open_private_directory_path(double_slash)
            resolve.assert_not_called()

    @unittest.skipUnless(
        sys.platform == "darwin",
        "requires a Unicode-normalization-insensitive macOS fixture volume",
    )
    def test_macos_repository_unicode_alias_is_rejected(self):
        with tempfile.TemporaryDirectory(
            prefix="authoring-repository-alias."
        ) as temporary:
            repository = Path(temporary) / "Repository-Caf\u00e9"
            repository.mkdir(mode=0o700)
            private_root = repository / "private-root"
            private_root.mkdir(mode=0o700)
            alias = Path(
                unicodedata.normalize("NFD", os.fspath(private_root))
            )
            if not alias.exists() or not os.path.samefile(
                alias, private_root
            ):
                self.skipTest(
                    "fixture volume is not Unicode-normalization-insensitive"
                )
            with mock.patch.object(AUTHOR, "REPO", repository):
                with self.assertRaisesRegex(
                    AUTHOR.AuthoringEntrypointError, "input_invalid"
                ):
                    AUTHOR._assert_disjoint_outside_repository((alias,))

    def test_every_git_helper_call_disables_lazy_fetch(self):
        calls: list[tuple[list[str], dict[str, object]]] = []

        def reviewed_run(command, **kwargs):
            calls.append((command, kwargs))
            return mock.Mock(returncode=0, stdout=(GIT_A + "\n").encode("ascii"))

        executable = mock.Mock(st_mode=stat.S_IFREG | 0o755)
        with mock.patch.object(
            AUTHOR.os, "lstat", return_value=executable
        ), mock.patch.object(
            AUTHOR.os, "access", return_value=True
        ), mock.patch.object(
            AUTHOR._startup_subprocess, "run", side_effect=reviewed_run
        ):
            AUTHOR._reviewed_git_bytes(
                os.fspath(ROOT),
                ["rev-parse", "HEAD"],
                timeout_seconds=20,
            )
            AUTHOR._authoring_procedure_identity(GIT_A)

        self.assertGreater(len(calls), 1)
        for command, kwargs in calls:
            self.assertEqual(command[0], AUTHOR._REVIEWED_GIT)
            self.assertEqual(
                kwargs["env"]["GIT_NO_LAZY_FETCH"],
                "1",
            )
            self.assertEqual(
                kwargs["env"],
                AUTHOR._REVIEWED_GIT_ENVIRONMENT,
            )


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


def immutable_tree_snapshot(root: Path) -> tuple[tuple[object, ...], ...]:
    """Capture synthetic fixture names, metadata, and regular-file bytes."""

    records: list[tuple[object, ...]] = []
    paths = [root, *sorted(root.rglob("*"), key=lambda item: item.as_posix())]
    for path in paths:
        metadata = path.lstat()
        relative = "." if path == root else path.relative_to(root).as_posix()
        digest = None
        if stat.S_ISREG(metadata.st_mode):
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
        records.append(
            (
                relative,
                stat.S_IFMT(metadata.st_mode),
                stat.S_IMODE(metadata.st_mode),
                metadata.st_uid,
                metadata.st_gid,
                metadata.st_nlink,
                metadata.st_size,
                digest,
            )
        )
    return tuple(records)


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

    def execute_with_private_ack(
        self, environment: dict[str, str]
    ) -> tuple[int, bytes]:
        """Exercise the internal component with a synthetic private handoff."""

        with mock.patch.object(AUTHOR, "_write_tty", return_value=None), mock.patch.object(
            AUTHOR, "_require_resume_acknowledgement", return_value=None
        ):
            return AUTHOR.execute_authoring(environment, 9)

    def assert_preaccess_rejection(
        self,
        environment: dict[str, object],
        *,
        capture_root: Path,
        private_root: Path,
        reason: str,
    ) -> None:
        capture_before = immutable_tree_snapshot(capture_root)
        private_before = immutable_tree_snapshot(private_root)
        guarded_names = (
            "_open_private_directory_path",
            "_open_private_child_directory",
            "_acquire_lock",
            "load_capture_for_authoring",
            "load_checkpoint_chain",
            "initialize_checkpoint",
            "publish_checkpoint_at",
            "publish_final_candidate_at",
            "_write_tty",
            "_require_resume_acknowledgement",
            "_validate_execution_python",
            "_authoring_procedure_identity",
        )
        guarded: dict[str, mock.Mock] = {}
        with ExitStack() as stack:
            for name in guarded_names:
                guarded[name] = stack.enter_context(mock.patch.object(AUTHOR, name))
            with self.assertRaises(AUTHOR.AuthoringEntrypointError) as raised:
                AUTHOR.execute_authoring(environment, 9)
        self.assertEqual(raised.exception.reason, reason)
        for name, operation in guarded.items():
            self.assertEqual(operation.call_count, 0, name)

        self.assertEqual(immutable_tree_snapshot(capture_root), capture_before)
        self.assertEqual(immutable_tree_snapshot(private_root), private_before)
        self.assertEqual(list(private_root.iterdir()), [])
        for forbidden in (
            AUTHOR.LOCK_NAME,
            AUTHOR.CHECKPOINTS_NAME,
            AUTHOR.INDETERMINATE_NAME,
            AUTHOR.RELEASED_NAME,
        ):
            self.assertFalse((private_root / forbidden).exists())
        self.assertFalse(
            any(item.name.startswith("final-ledger-") for item in private_root.iterdir())
        )

        diagnostic = AUTHOR._fixed_diagnostic(status="failed", reason=reason)
        parsed = json.loads(diagnostic)
        self.assertEqual(
            set(parsed), {"diagnostic_version", "reason", "stage", "status"}
        )
        self.assertEqual(parsed["reason"], reason)
        for value in environment.values():
            if type(value) is str and value and len(value) >= 8:
                self.assertNotIn(value.encode("utf-8"), diagnostic)

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
            exit_status, diagnostic = self.execute_with_private_ack(environment)
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
                AUTHOR.AuthoringEntrypointError, "input_invalid"
            ):
                self.execute_with_private_ack(wrong_release)
        private_capture_read.assert_not_called()
        with mock.patch.object(AUTHOR, "_authoring_procedure_identity", return_value=SHA_C):
            exit_status, diagnostic = self.execute_with_private_ack(status_environment)
        self.assertEqual(exit_status, 2)
        visible = json.loads(diagnostic)
        self.assertEqual(visible["review_gate"], "REVIEW_REQUIRED")
        self.assertEqual(visible["authoring_state"], "PRIMARY_REVIEW_REQUIRED")
        self.assertNotIn("entry_id", visible)
        self.assertEqual(len(list(checkpoints.iterdir())), 1)

        skipped = dict(status_environment)
        skipped["TOC_AUTHOR_ACTION"] = "peer_review"
        skipped["TOC_AUTHOR_OPERATOR_IDENTITY"] = "Distinct Peer"
        skipped["TOC_AUTHOR_EXPECTED_RELEASE_TOKEN"] = released_token(private_root)
        with mock.patch.object(AUTHOR, "_authoring_procedure_identity", return_value=SHA_C):
            with self.assertRaisesRegex(
                AUTHOR.AuthoringEntrypointError, "review_transition_invalid"
            ):
                self.execute_with_private_ack(skipped)
        self.assertEqual(len(list(checkpoints.iterdir())), 1)

    def test_static_action_tuple_rejects_before_every_private_operation(self):
        poison = "PREACCESS_PRIVATE_PATH_OBJECT_SQL_SECRET_PAYLOAD_SENTINEL"
        capture_root = self.root / "preaccess-capture"
        package, expectations, _capture, _entries = make_capture_package(
            capture_root, ["TABLE"], poison=poison
        )
        private_root = self.root / "preaccess-private"
        private_root.mkdir(mode=0o700)
        base_initialize = self.author_environment(
            package,
            expectations,
            private_root,
            action="initialize",
            generation=0,
            head_sha256="0" * 64,
        )

        def resume(action: str = "status") -> dict[str, object]:
            environment: dict[str, object] = dict(base_initialize)
            environment.update(
                {
                    "TOC_AUTHOR_ACTION": action,
                    "TOC_AUTHOR_EXPECTED_HEAD_GENERATION": "1",
                    "TOC_AUTHOR_EXPECTED_HEAD_SHA256": "e" * 64,
                    "TOC_AUTHOR_EXPECTED_RELEASE_TOKEN": "d" * 64,
                }
            )
            if action == "peer_review":
                environment["TOC_AUTHOR_OPERATOR_IDENTITY"] = "Distinct Peer"
            if action == "finalize":
                environment["TOC_AUTHOR_FINALIZATION_AUTHORIZATION"] = (
                    AUTHOR.FINALIZATION_AUTHORIZATION
                )
            return environment

        cases: list[tuple[str, dict[str, object], str]] = []

        invalid = dict(base_initialize)
        invalid["TOC_AUTHOR_EXPECTED_HEAD_GENERATION"] = "1"
        invalid["TOC_AUTHOR_EXPECTED_HEAD_SHA256"] = "e" * 64
        cases.append(("initialize_nonzero_generation", invalid, "input_invalid"))

        invalid = resume()
        invalid["TOC_AUTHOR_EXPECTED_HEAD_SHA256"] = "0" * 64
        cases.append(("resume_zero_head", invalid, "input_invalid"))

        invalid = resume()
        invalid["TOC_AUTHOR_EXPECTED_HEAD_GENERATION"] = "0"
        invalid["TOC_AUTHOR_EXPECTED_HEAD_SHA256"] = "e" * 64
        cases.append(("zero_generation_nonzero_head", invalid, "input_invalid"))

        invalid = dict(base_initialize)
        invalid["TOC_AUTHOR_EXPECTED_RELEASE_TOKEN"] = "d" * 64
        cases.append(("initialize_nonzero_release", invalid, "input_invalid"))

        for operator in ("Different Reviewer", "primary reviewer"):
            invalid = dict(base_initialize)
            invalid["TOC_AUTHOR_OPERATOR_IDENTITY"] = operator
            cases.append(("initialize_operator_mismatch", invalid, "binding_mismatch"))

        for action in sorted(AUTHOR.ACTION_VALUES - {"initialize"}):
            invalid = resume(action)
            invalid["TOC_AUTHOR_EXPECTED_HEAD_GENERATION"] = "0"
            invalid["TOC_AUTHOR_EXPECTED_HEAD_SHA256"] = "0" * 64
            invalid["TOC_AUTHOR_EXPECTED_RELEASE_TOKEN"] = "0" * 64
            cases.append(("zero_resume_tuple_" + action, invalid, "input_invalid"))

        invalid = resume()
        invalid["TOC_AUTHOR_FINALIZATION_AUTHORIZATION"] = "NOT_FOR_STATUS"
        cases.append(("ordinary_action_authorization", invalid, "input_invalid"))

        invalid = resume()
        invalid["TOC_AUTHOR_OPERATOR_IDENTITY"] = "Different Reviewer"
        cases.append(("status_operator_mismatch", invalid, "binding_mismatch"))

        invalid = resume("finalize")
        invalid["TOC_AUTHOR_OPERATOR_IDENTITY"] = "Different Reviewer"
        cases.append(("finalize_operator_mismatch", invalid, "binding_mismatch"))

        for operator in ("Primary Reviewer", "primary reviewer"):
            invalid = resume("peer_review")
            invalid["TOC_AUTHOR_OPERATOR_IDENTITY"] = operator
            cases.append(("peer_operator_collision", invalid, "binding_mismatch"))

        for field in (
            "TOC_AUTHOR_INSPECTION_CHECKOUT_SHA",
            "TOC_AUTHOR_CAPTURE_EXECUTION_CHECKOUT_SHA",
        ):
            for malformed in ("a" * 39, "g" * 40, "A" * 40):
                invalid = dict(base_initialize)
                invalid[field] = malformed
                cases.append(
                    ("malformed_checkout_" + field, invalid, "input_invalid")
                )

        for authorization in (None, "", "WRONG_AUTHORIZATION"):
            invalid = resume("finalize")
            if authorization is None:
                invalid.pop("TOC_AUTHOR_FINALIZATION_AUTHORIZATION")
            else:
                invalid["TOC_AUTHOR_FINALIZATION_AUTHORIZATION"] = authorization
            cases.append(("finalize_authorization", invalid, "finalization_incomplete"))

        for name, environment, reason in cases:
            with self.subTest(case=name):
                self.assert_preaccess_rejection(
                    environment,
                    capture_root=capture_root,
                    private_root=private_root,
                    reason=reason,
                )

    def test_static_action_tuple_rejects_nonprimitive_and_alias_inputs(self):
        capture_root = self.root / "preaccess-types-capture"
        package, expectations, _capture, _entries = make_capture_package(
            capture_root, ["TABLE"]
        )
        private_root = self.root / "preaccess-types-private"
        private_root.mkdir(mode=0o700)
        base = self.author_environment(
            package,
            expectations,
            private_root,
            action="initialize",
            generation=0,
            head_sha256="0" * 64,
        )

        class BoxedString(str):
            pass

        cases: tuple[tuple[str, object], ...] = (
            ("TOC_AUTHOR_ACTION", BoxedString("initialize")),
            ("TOC_AUTHOR_EXPECTED_HEAD_GENERATION", 0),
            ("TOC_AUTHOR_EXPECTED_HEAD_GENERATION", True),
            ("TOC_AUTHOR_EXPECTED_HEAD_GENERATION", "00"),
            ("TOC_AUTHOR_EXPECTED_HEAD_GENERATION", "+0"),
            ("TOC_AUTHOR_EXPECTED_HEAD_SHA256", BoxedString("0" * 64)),
            ("TOC_AUTHOR_EXPECTED_HEAD_SHA256", 0),
            ("TOC_AUTHOR_EXPECTED_RELEASE_TOKEN", ["0" * 64]),
            ("TOC_AUTHOR_OPERATOR_IDENTITY", BoxedString("Primary Reviewer")),
            ("TOC_AUTHOR_OPERATOR_IDENTITY", 123),
            ("TOC_AUTHOR_FINALIZATION_AUTHORIZATION", BoxedString("")),
            ("TOC_AUTHOR_FINALIZATION_AUTHORIZATION", 0),
            ("TOC_AUTHOR_INSPECTION_CHECKOUT_SHA", {"sha": "b" * 40}),
            ("TOC_AUTHOR_CAPTURE_EXECUTION_CHECKOUT_SHA", b"a" * 40),
        )
        for field, value in cases:
            with self.subTest(field=field, kind=type(value).__name__):
                invalid: dict[str, object] = dict(base)
                invalid[field] = value
                self.assert_preaccess_rejection(
                    invalid,
                    capture_root=capture_root,
                    private_root=private_root,
                    reason="input_invalid",
                )

    def test_status_descriptor_close_failure_overrides_review_boundary(self):
        poison = "STATUS_CLOSE_RAW_NAME_OWNER_SQL_PATH_SECRET_PAYLOAD_SENTINEL"
        capture_root = self.root / "status-close-capture"
        package, expectations, _capture, _entries = make_capture_package(
            capture_root, ["TABLE"], poison=poison
        )
        private_root = self.root / "status-close-private"
        private_root.mkdir(mode=0o700)
        initialize = self.author_environment(
            package,
            expectations,
            private_root,
            action="initialize",
            generation=0,
            head_sha256="0" * 64,
        )
        with mock.patch.object(
            AUTHOR, "_authoring_procedure_identity", return_value=SHA_C
        ):
            self.execute_with_private_ack(initialize)
        checkpoints = private_root / AUTHOR.CHECKPOINTS_NAME
        checkpoint = next(checkpoints.iterdir())
        checkpoint_bytes = checkpoint.read_bytes()
        checkpoint_head = hashlib.sha256(checkpoint_bytes).hexdigest()
        prior_release_token = released_token(private_root)
        status_environment = self.author_environment(
            package,
            expectations,
            private_root,
            action="status",
            generation=1,
            head_sha256=checkpoint_head,
        )

        real_open_child = AUTHOR._open_private_child_directory
        real_close = AUTHOR.os.close
        close_target = {"fd": -1, "failed": False}

        def record_child(parent_fd, name):
            result = real_open_child(parent_fd, name)
            if name == AUTHOR.CHECKPOINTS_NAME:
                close_target["fd"] = result[0]
            return result

        def fail_checkpoint_close(descriptor):
            if descriptor == close_target["fd"] and not close_target["failed"]:
                close_target["failed"] = True
                real_close(descriptor)
                raise OSError("synthetic close-only failure")
            return real_close(descriptor)

        diagnostics: list[bytes] = []
        tty_writes: list[bytes] = []
        with mock.patch.object(AUTHOR.os, "environ", status_environment), mock.patch.object(
            AUTHOR, "_validate_tty", return_value=9
        ), mock.patch.object(
            AUTHOR, "_authoring_procedure_identity", return_value=SHA_C
        ), mock.patch.object(
            AUTHOR,
            "_open_private_child_directory",
            side_effect=record_child,
        ), mock.patch.object(
            AUTHOR.os, "close", side_effect=fail_checkpoint_close
        ), mock.patch.object(
            AUTHOR,
            "_write_tty",
            side_effect=lambda _descriptor, payload: tty_writes.append(payload),
        ), mock.patch.object(
            AUTHOR, "_require_resume_acknowledgement"
        ) as acknowledge, mock.patch.object(
            AUTHOR, "_release_lock"
        ) as release, mock.patch.object(
            AUTHOR,
            "_emit_operator_diagnostic",
            side_effect=lambda _name, _stream, payload: diagnostics.append(payload),
        ), mock.patch.object(
            AUTHOR, "_clear_tty_best_effort", return_value=None
        ):
            exit_status = AUTHOR.main()

        self.assertEqual(exit_status, 1)
        self.assertTrue(close_target["failed"])
        acknowledge.assert_not_called()
        release.assert_not_called()
        self.assertEqual(len(tty_writes), 1)
        self.assertEqual(tty_writes[0], AUTHOR.ENTER_ALTERNATE_SCREEN + AUTHOR.CLEAR_SCREEN)
        self.assertEqual(
            diagnostics,
            [AUTHOR._fixed_diagnostic(status="failed", reason="cleanup_indeterminate")],
        )
        self.assertEqual(checkpoint.read_bytes(), checkpoint_bytes)
        self.assertEqual(
            {path.name for path in private_root.iterdir()},
            {
                AUTHOR.CHECKPOINTS_NAME,
                AUTHOR.INDETERMINATE_NAME,
                AUTHOR.LOCK_NAME,
            },
        )
        for private_value in (
            poison,
            os.fspath(package),
            os.fspath(private_root),
            checkpoint_head,
            prior_release_token,
        ):
            self.assertNotIn(private_value.encode("utf-8"), b"".join(diagnostics))
        self.assertFalse(
            any(
                AUTHOR.FINAL_PACKAGE_RE.fullmatch(path.name)
                for path in private_root.iterdir()
            )
        )

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
        handoff_events: list[str] = []
        real_release = AUTHOR._release_lock

        def record_write(_descriptor: int, payload: bytes) -> None:
            self.assertTrue((private_root / AUTHOR.LOCK_NAME).is_file())
            self.assertFalse((private_root / AUTHOR.RELEASED_NAME).exists())
            handoff_events.append("write")
            private_writes.append(payload)

        def record_ack(_descriptor: int) -> None:
            self.assertTrue((private_root / AUTHOR.LOCK_NAME).is_file())
            self.assertFalse((private_root / AUTHOR.RELEASED_NAME).exists())
            handoff_events.append("ack")

        def record_release(descriptor: int, token: str) -> str:
            self.assertTrue((private_root / AUTHOR.LOCK_NAME).is_file())
            self.assertFalse((private_root / AUTHOR.RELEASED_NAME).exists())
            handoff_events.append("release")
            return real_release(descriptor, token)

        with mock.patch.object(
            AUTHOR, "_authoring_procedure_identity", return_value=SHA_C
        ), mock.patch.object(
            AUTHOR,
            "_write_tty",
            side_effect=record_write,
        ), mock.patch.object(
            AUTHOR,
            "_require_resume_acknowledgement",
            side_effect=record_ack,
        ), mock.patch.object(
            AUTHOR, "_release_lock", side_effect=record_release
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
        self.assertEqual(handoff_events, ["write", "ack", "release"])

    def test_review_prompt_restore_failure_blocks_before_publication_and_release(self):
        capture_root = self.root / "prompt-restore-capture"
        package, expectations, _capture, _entries = make_capture_package(
            capture_root, ["TABLE"], poison="PRIVATE_PROMPT_RESTORE_SENTINEL"
        )
        private_root = self.root / "prompt-restore-private"
        private_root.mkdir(mode=0o700)
        initialize = self.author_environment(
            package,
            expectations,
            private_root,
            action="initialize",
            generation=0,
            head_sha256="0" * 64,
        )
        with mock.patch.object(
            AUTHOR, "_authoring_procedure_identity", return_value=SHA_C
        ):
            self.execute_with_private_ack(initialize)
        checkpoints = private_root / AUTHOR.CHECKPOINTS_NAME
        head = next(checkpoints.iterdir())
        primary = self.author_environment(
            package,
            expectations,
            private_root,
            action="primary_review",
            generation=1,
            head_sha256=hashlib.sha256(head.read_bytes()).hexdigest(),
        )
        original_prompt = AUTHOR._prompt_choice

        def restoration_failure(descriptor: int, label: bytes, allowed) -> str:
            self.assertEqual(label, b"classification")
            with mock.patch.object(
                AUTHOR.termios, "tcgetattr", return_value=[0, 0, 0, 0, 0, 0, []]
            ), mock.patch.object(
                AUTHOR.termios,
                "tcsetattr",
                side_effect=(None, OSError("synthetic prompt restore failure")),
            ), mock.patch.object(
                AUTHOR.os, "read", side_effect=iter(bytes((value,)) for value in b"restore\n")
            ):
                return original_prompt(descriptor, label, allowed)

        with mock.patch.object(
            AUTHOR, "_authoring_procedure_identity", return_value=SHA_C
        ), mock.patch.object(
            AUTHOR, "_write_tty", return_value=None
        ), mock.patch.object(
            AUTHOR, "_prompt_choice", side_effect=restoration_failure
        ):
            with self.assertRaisesRegex(
                AUTHOR.AuthoringEntrypointError, "tty_invalid"
            ):
                AUTHOR.execute_authoring(primary, 9)
        self.assertEqual(len(list(checkpoints.iterdir())), 1)
        self.assertTrue((private_root / AUTHOR.LOCK_NAME).is_file())
        self.assertTrue((private_root / AUTHOR.INDETERMINATE_NAME).is_file())
        self.assertFalse((private_root / AUTHOR.RELEASED_NAME).exists())
        ordinary = AUTHOR._fixed_diagnostic(status="failed", reason="tty_invalid")
        self.assertNotIn(b"PRIVATE_PROMPT_RESTORE_SENTINEL", ordinary)

        for reader, value in (
            (AUTHOR._read_tty_choice, b"restore\n"),
            (AUTHOR._read_tty_line, b"2\n"),
        ):
            with self.subTest(reader=reader.__name__), mock.patch.object(
                AUTHOR.termios, "tcgetattr", return_value=[0, 0, 0, 0, 0, 0, []]
            ), mock.patch.object(
                AUTHOR.termios,
                "tcsetattr",
                side_effect=(None, OSError("synthetic prompt restore failure")),
            ), mock.patch.object(
                AUTHOR.os, "read", side_effect=iter(bytes((item,)) for item in value)
            ):
                with self.assertRaisesRegex(
                    AUTHOR.AuthoringEntrypointError, "tty_invalid"
                ):
                    if reader is AUTHOR._read_tty_choice:
                        reader(9, allowed=frozenset({"restore"}))
                    else:
                        reader(9)

    def test_private_primary_review_eof_leaves_no_successor_or_release(self):
        capture_root = self.root / "prompt-eof-capture"
        package, expectations, _capture, _entries = make_capture_package(
            capture_root, ["TABLE"], poison="PRIVATE_PROMPT_EOF_SENTINEL"
        )
        private_root = self.root / "prompt-eof-private"
        private_root.mkdir(mode=0o700)
        initialize = self.author_environment(
            package,
            expectations,
            private_root,
            action="initialize",
            generation=0,
            head_sha256="0" * 64,
        )
        with mock.patch.object(
            AUTHOR, "_authoring_procedure_identity", return_value=SHA_C
        ):
            self.execute_with_private_ack(initialize)
        checkpoints = private_root / AUTHOR.CHECKPOINTS_NAME
        head = next(checkpoints.iterdir())
        primary = self.author_environment(
            package,
            expectations,
            private_root,
            action="primary_review",
            generation=1,
            head_sha256=hashlib.sha256(head.read_bytes()).hexdigest(),
        )
        original_prompt = AUTHOR._prompt_choice

        def eof_at_classification(descriptor: int, label: bytes, allowed) -> str:
            self.assertEqual(label, b"classification")
            with mock.patch.object(
                AUTHOR.termios,
                "tcgetattr",
                return_value=[0, 0, 0, 0, 0, 0, []],
            ), mock.patch.object(
                AUTHOR.termios, "tcsetattr", return_value=None
            ), mock.patch.object(
                AUTHOR.os, "read", return_value=b""
            ):
                return original_prompt(descriptor, label, allowed)

        with mock.patch.object(
            AUTHOR, "_authoring_procedure_identity", return_value=SHA_C
        ), mock.patch.object(
            AUTHOR, "_write_tty", return_value=None
        ), mock.patch.object(
            AUTHOR, "_prompt_choice", side_effect=eof_at_classification
        ):
            with self.assertRaisesRegex(
                AUTHOR.AuthoringEntrypointError, "tty_invalid"
            ):
                AUTHOR.execute_authoring(primary, 9)
        self.assertEqual(len(list(checkpoints.iterdir())), 1)
        self.assertTrue((private_root / AUTHOR.LOCK_NAME).is_file())
        self.assertTrue((private_root / AUTHOR.INDETERMINATE_NAME).is_file())
        self.assertFalse((private_root / AUTHOR.RELEASED_NAME).exists())
        ordinary = AUTHOR._fixed_diagnostic(
            status="failed", reason="tty_invalid"
        )
        self.assertNotIn(b"PRIVATE_PROMPT_EOF_SENTINEL", ordinary)

    def test_resume_handoff_failures_remain_persistently_blocked(self):
        original_ack = AUTHOR._require_resume_acknowledgement

        def synthetic_read(values: bytes):
            iterator = iter(bytes((value,)) for value in values)

            def read_one(_descriptor: int, _size: int) -> bytes:
                return next(iterator, b"")

            return read_one

        def ack_eof(descriptor: int) -> None:
            with mock.patch.object(
                AUTHOR.termios, "tcgetattr", return_value=[0, 0, 0, 0, 0, 0, []]
            ), mock.patch.object(
                AUTHOR.termios, "tcsetattr", return_value=None
            ), mock.patch.object(AUTHOR.os, "read", return_value=b""):
                original_ack(descriptor)

        def ack_wrong(descriptor: int) -> None:
            with mock.patch.object(
                AUTHOR.termios, "tcgetattr", return_value=[0, 0, 0, 0, 0, 0, []]
            ), mock.patch.object(
                AUTHOR.termios, "tcsetattr", return_value=None
            ), mock.patch.object(
                AUTHOR.os, "read", side_effect=synthetic_read(b"wrong\n")
            ):
                original_ack(descriptor)

        def ack_attribute_read_failure(descriptor: int) -> None:
            with mock.patch.object(
                AUTHOR.termios,
                "tcgetattr",
                side_effect=OSError("synthetic terminal attribute failure"),
            ):
                original_ack(descriptor)

        def ack_initial_attribute_write_failure(descriptor: int) -> None:
            with mock.patch.object(
                AUTHOR.termios, "tcgetattr", return_value=[0, 0, 0, 0, 0, 0, []]
            ), mock.patch.object(
                AUTHOR.termios,
                "tcsetattr",
                side_effect=(OSError("synthetic terminal adjustment failure"), None),
            ):
                original_ack(descriptor)

        def ack_restore_failure(descriptor: int) -> None:
            with mock.patch.object(
                AUTHOR.termios, "tcgetattr", return_value=[0, 0, 0, 0, 0, 0, []]
            ), mock.patch.object(
                AUTHOR.termios,
                "tcsetattr",
                side_effect=(None, OSError("synthetic terminal restore failure")),
            ), mock.patch.object(
                AUTHOR.os,
                "read",
                side_effect=synthetic_read(b"resume_values_recorded\n"),
            ):
                original_ack(descriptor)

        def ack_read_failure(descriptor: int) -> None:
            with mock.patch.object(
                AUTHOR.termios, "tcgetattr", return_value=[0, 0, 0, 0, 0, 0, []]
            ), mock.patch.object(
                AUTHOR.termios, "tcsetattr", return_value=None
            ), mock.patch.object(
                AUTHOR.os,
                "read",
                side_effect=OSError("synthetic terminal read failure"),
            ):
                original_ack(descriptor)

        cases = {
            "tty_write": None,
            "ack_eof": ack_eof,
            "ack_wrong": ack_wrong,
            "attribute_read": ack_attribute_read_failure,
            "attribute_adjust": ack_initial_attribute_write_failure,
            "attribute_restore": ack_restore_failure,
            "terminal_read": ack_read_failure,
        }
        for case, acknowledgement in cases.items():
            with self.subTest(case=case):
                capture_root = self.root / ("handoff-capture-" + case)
                package, expectations, _capture, _entries = make_capture_package(
                    capture_root, ["TABLE"], poison="PRIVATE_HANDOFF_SENTINEL"
                )
                private_root = self.root / ("handoff-private-" + case)
                private_root.mkdir(mode=0o700)
                environment = self.author_environment(
                    package,
                    expectations,
                    private_root,
                    action="initialize",
                    generation=0,
                    head_sha256="0" * 64,
                )
                write_effect = (
                    AUTHOR.AuthoringEntrypointError("tty_invalid")
                    if acknowledgement is None
                    else None
                )
                acknowledgement_effect = (
                    (lambda _descriptor: None)
                    if acknowledgement is None
                    else acknowledgement
                )
                with mock.patch.object(
                    AUTHOR, "_authoring_procedure_identity", return_value=SHA_C
                ), mock.patch.object(
                    AUTHOR, "_write_tty", side_effect=write_effect
                ), mock.patch.object(
                    AUTHOR,
                    "_require_resume_acknowledgement",
                    side_effect=acknowledgement_effect,
                ):
                    with self.assertRaisesRegex(
                        AUTHOR.AuthoringEntrypointError, "tty_invalid"
                    ) as raised:
                        AUTHOR.execute_authoring(environment, 9)
                self.assertEqual(str(raised.exception), "tty_invalid")
                names = {path.name for path in private_root.iterdir()}
                self.assertIn(AUTHOR.LOCK_NAME, names)
                self.assertIn(AUTHOR.INDETERMINATE_NAME, names)
                self.assertNotIn(AUTHOR.RELEASED_NAME, names)
                lock_metadata = (private_root / AUTHOR.LOCK_NAME).stat()
                self.assertEqual(stat.S_IMODE(lock_metadata.st_mode), 0o400)
                self.assertEqual(lock_metadata.st_nlink, 1)
                checkpoints = list((private_root / AUTHOR.CHECKPOINTS_NAME).iterdir())
                self.assertEqual(len(checkpoints), 1)
                ordinary = AUTHOR._fixed_diagnostic(
                    status="failed", reason="tty_invalid"
                )
                self.assertNotIn(b"PRIVATE_HANDOFF_SENTINEL", ordinary)
                self.assertNotIn(checkpoints[0].name.encode("ascii"), ordinary)
                with mock.patch.object(
                    AUTHOR, "load_capture_for_authoring"
                ) as capture_reader, mock.patch.object(
                    AUTHOR, "_authoring_procedure_identity", return_value=SHA_C
                ):
                    with self.assertRaisesRegex(
                        AUTHOR.AuthoringEntrypointError, "history_conflict"
                    ):
                        self.execute_with_private_ack(environment)
                capture_reader.assert_not_called()

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
            self.execute_with_private_ack(initialize_environment)
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
                    self.execute_with_private_ack(status_environment)
        self.assertTrue((checkpoints / ".concurrent-insertion").exists())
        self.assertTrue((private_root / AUTHOR.LOCK_NAME).exists())
        self.assertTrue((private_root / AUTHOR.INDETERMINATE_NAME).exists())
        self.assertFalse((private_root / AUTHOR.RELEASED_NAME).exists())

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
                self.execute_with_private_ack(environment)
        self.assertTrue(lock.exists())

        lock.unlink()
        private_root.chmod(0o755)
        with mock.patch.object(AUTHOR, "_authoring_procedure_identity", return_value=SHA_C):
            with self.assertRaisesRegex(AUTHOR.AuthoringEntrypointError, "input_invalid"):
                self.execute_with_private_ack(environment)
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
                        self.execute_with_private_ack(poisoned)
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
                        self.execute_with_private_ack(environment)
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
                        self.execute_with_private_ack(environment)
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

    def test_capture_json_versions_reject_boolean_integer_aliases(self):
        package, _expectations, capture, _entries = make_capture_package(
            self.root, ["TABLE"]
        )
        raw_toc = (package / "raw-pg-restore-list.toc").read_bytes()
        structures = capture_contract.parse_raw_toc_structure(raw_toc)

        index = json.loads((package / "opaque-index.json").read_bytes())
        index["format_version"] = True
        index_data = capture_contract.canonical_json_bytes(index)
        with self.assertRaisesRegex(
            authoring.AuthoringContractError, "capture_invalid"
        ):
            authoring._parse_opaque_index(index_data, structures)

        evidence = json.loads((package / "evidence-files.json").read_bytes())
        evidence["format_version"] = True
        evidence_data = capture_contract.canonical_json_bytes(evidence)
        with self.assertRaisesRegex(
            authoring.AuthoringContractError, "capture_invalid"
        ):
            authoring._validate_capture_evidence_manifest(
                evidence_data,
                expected_manifest_sha256=(
                    capture_contract.sha256_bytes(evidence_data)
                ),
                capture_bytes=(package / "capture.json").read_bytes(),
                raw_toc=raw_toc,
                index_bytes=(package / "opaque-index.json").read_bytes(),
                capture=capture,
            )

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

    def test_primary_review_batch_is_deterministic_and_never_exceeds_one_hundred(self):
        capture, _package, _expectations = self.load_capture(
            ["TABLE"] * 101
        )
        checkpoint = authoring.initialize_checkpoint(
            capture, self.binding, "Primary Operator", "batch-session"
        )
        first = authoring.next_review_ordinals(
            checkpoint, "primary_review", batch_size=100
        )
        repeated = authoring.next_review_ordinals(
            checkpoint, "primary_review", batch_size=100
        )
        self.assertEqual(first, tuple(range(100)))
        self.assertEqual(repeated, first)
        self.assertEqual(len(first), 100)
        self.assertNotIn(100, first)

    def test_primary_relationship_prompts_are_role_specific_and_role_exact(self):
        capture, _package, _expectations = self.load_capture(
            ["TRIGGER", "TABLE", "VIEW"]
        )
        checkpoint = authoring.initialize_checkpoint(
            capture, self.binding, "Primary", "session-1"
        )
        writes: list[bytes] = []
        with mock.patch.object(
            AUTHOR,
            "_read_tty_line",
            side_effect=("show:2", "2", "show:3", "3"),
        ), mock.patch.object(
            AUTHOR,
            "_write_tty",
            side_effect=lambda _descriptor, payload: writes.append(payload),
        ):
            update = AUTHOR._entry_updates(
                "relationship_review", checkpoint, capture, (0,), 9
            )[0]["primary_decision"]
        transcript = b"".join(writes)
        self.assertIn(b"dependency_ordinals_csv_or_none", transcript)
        self.assertIn(b"structural_parent_ordinals_csv_or_none", transcript)
        self.assertIn(b"reference_role=dependency\nordinal=2", transcript)
        self.assertIn(b"reference_role=structural_parent\nordinal=3", transcript)
        self.assertEqual(
            update["dependency_entry_ids"],
            [capture.entries_by_ordinal[1].entry_id],
        )
        self.assertEqual(
            update["parent_entry_ids"],
            [capture.entries_by_ordinal[2].entry_id],
        )

        data_capture, _package, _expectations = self.load_capture(
            ["TABLE DATA", "TABLE"]
        )
        data_checkpoint = authoring.initialize_checkpoint(
            data_capture, self.binding, "Primary", "session-1"
        )
        writes = []
        with mock.patch.object(
            AUTHOR, "_read_tty_line", side_effect=("show:2", "2")
        ), mock.patch.object(
            AUTHOR,
            "_write_tty",
            side_effect=lambda _descriptor, payload: writes.append(payload),
        ):
            data_update = AUTHOR._entry_updates(
                "data_reference_review", data_checkpoint, data_capture, (0,), 9
            )[0]["primary_decision"]
        self.assertIn(b"metadata_parent_ordinal", b"".join(writes))
        self.assertEqual(
            data_update["metadata_parent_entry_id"],
            data_capture.entries_by_ordinal[1].entry_id,
        )

        sequence_capture, _package, _expectations = self.load_capture(
            ["SEQUENCE SET", "SEQUENCE"]
        )
        sequence_checkpoint = authoring.initialize_checkpoint(
            sequence_capture, self.binding, "Primary", "session-1"
        )
        writes = []
        with mock.patch.object(
            AUTHOR, "_read_tty_line", side_effect=("show:2", "2")
        ), mock.patch.object(
            AUTHOR,
            "_write_tty",
            side_effect=lambda _descriptor, payload: writes.append(payload),
        ):
            sequence_update = AUTHOR._entry_updates(
                "sequence_review", sequence_checkpoint, sequence_capture, (0,), 9
            )[0]["primary_decision"]
        self.assertIn(b"sequence_metadata_parent_ordinal", b"".join(writes))
        self.assertEqual(
            sequence_update["metadata_parent_entry_id"],
            sequence_capture.entries_by_ordinal[1].entry_id,
        )

    def test_peer_transcript_binds_swapped_and_multi_role_assignments(self):
        poison = "PRIVATE_ROLE_SQL_OWNER_PATH_SECRET_PAYLOAD_SENTINEL"
        capture_root = self.root / "role-peer-capture"
        package, expectations, _capture, _entries = make_capture_package(
            capture_root, ["TRIGGER", "TABLE", "VIEW"], poison=poison
        )
        descriptor = open_directory(package)
        try:
            capture = authoring.load_capture_for_authoring(descriptor, expectations)
        finally:
            os.close(descriptor)
        checkpoint = authoring.initialize_checkpoint(
            capture, self.binding, "Primary", "session-1"
        )
        first = copy.deepcopy(checkpoint["entries"][0])
        first_decision = first["primary_decision"]
        first_decision["dependency_entry_ids"] = [capture.entries_by_ordinal[1].entry_id]
        first_decision["parent_entry_ids"] = [capture.entries_by_ordinal[2].entry_id]
        first["primary_decision_sha256"] = authoring._decision_sha256(first_decision)
        second = copy.deepcopy(first)
        second_decision = second["primary_decision"]
        second_decision["dependency_entry_ids"] = [capture.entries_by_ordinal[2].entry_id]
        second_decision["parent_entry_ids"] = [capture.entries_by_ordinal[1].entry_id]
        second["primary_decision_sha256"] = authoring._decision_sha256(second_decision)
        self.assertEqual(
            len(first_decision["dependency_entry_ids"]),
            len(second_decision["dependency_entry_ids"]),
        )
        self.assertEqual(
            set(
                first_decision["dependency_entry_ids"]
                + first_decision["parent_entry_ids"]
            ),
            set(
                second_decision["dependency_entry_ids"]
                + second_decision["parent_entry_ids"]
            ),
        )
        self.assertNotEqual(
            first["primary_decision_sha256"], second["primary_decision_sha256"]
        )

        transcripts: list[bytes] = []

        def peer_read_choice(_descriptor, *, allowed):
            if "summary_reviewed" in allowed:
                return "summary_reviewed"
            return "context_reviewed"

        for record in (first, second):
            writes: list[bytes] = []
            with mock.patch.object(
                AUTHOR,
                "_write_tty",
                side_effect=lambda _descriptor, payload: writes.append(payload),
            ), mock.patch.object(
                AUTHOR, "_read_tty_choice", side_effect=peer_read_choice
            ):
                AUTHOR._show_peer_decision(9, capture, record)
            transcripts.append(b"".join(writes))
        self.assertNotEqual(transcripts[0], transcripts[1])
        self.assertIn(b"reference_role=dependency\nordinal=2", transcripts[0])
        self.assertIn(b"reference_role=structural_parent\nordinal=3", transcripts[0])
        self.assertIn(b"reference_role=dependency\nordinal=3", transcripts[1])
        self.assertIn(b"reference_role=structural_parent\nordinal=2", transcripts[1])
        self.assertIn(poison.encode("ascii"), transcripts[0])
        self.assertLess(
            transcripts[0].index(b"PRIMARY_DECISION_FOR_PEER_REVIEW"),
            transcripts[0].index(b"confirm_primary_decision_summary_reviewed"),
        )
        self.assertLess(
            transcripts[0].index(b"confirm_primary_decision_summary_reviewed"),
            transcripts[0].index(b"reference_role=dependency\nordinal=2"),
        )
        self.assertLess(
            transcripts[0].index(b"reference_role=dependency\nordinal=2"),
            transcripts[0].index(b"confirm_dependency_context_reviewed"),
        )
        self.assertLess(
            transcripts[0].index(b"confirm_dependency_context_reviewed"),
            transcripts[0].index(b"reference_role=structural_parent\nordinal=3"),
        )
        self.assertLess(
            transcripts[0].index(b"reference_role=structural_parent\nordinal=3"),
            transcripts[0].index(b"confirm_structural_parent_context_reviewed"),
        )
        for transcript in transcripts:
            for entry in capture.entries_by_ordinal:
                self.assertNotIn(entry.entry_id.encode("ascii"), transcript)

        data_capture, _package, _expectations = self.load_capture(
            ["TABLE DATA", "TABLE"]
        )
        data_checkpoint = authoring.initialize_checkpoint(
            data_capture, self.binding, "Primary", "session-1"
        )
        multi = copy.deepcopy(data_checkpoint["entries"][0])
        shared = data_capture.entries_by_ordinal[1].entry_id
        multi["primary_decision"]["dependency_entry_ids"] = [shared]
        multi["primary_decision"]["metadata_parent_entry_id"] = shared
        writes = []
        with mock.patch.object(
            AUTHOR,
            "_write_tty",
            side_effect=lambda _descriptor, payload: writes.append(payload),
        ), mock.patch.object(
            AUTHOR, "_read_tty_choice", side_effect=peer_read_choice
        ):
            AUTHOR._show_peer_decision(9, data_capture, multi)
        multi_transcript = b"".join(writes)
        self.assertIn(b"reference_role=dependency\nordinal=2", multi_transcript)
        self.assertIn(b"reference_role=metadata_parent\nordinal=2", multi_transcript)

        sequence_capture, _package, _expectations = self.load_capture(
            ["SEQUENCE SET", "SEQUENCE"]
        )
        sequence_checkpoint = authoring.initialize_checkpoint(
            sequence_capture, self.binding, "Primary", "session-1"
        )
        sequence_record = copy.deepcopy(sequence_checkpoint["entries"][0])
        sequence_record["primary_decision"]["metadata_parent_entry_id"] = (
            sequence_capture.entries_by_ordinal[1].entry_id
        )
        writes = []
        with mock.patch.object(
            AUTHOR,
            "_write_tty",
            side_effect=lambda _descriptor, payload: writes.append(payload),
        ), mock.patch.object(
            AUTHOR, "_read_tty_choice", side_effect=peer_read_choice
        ):
            AUTHOR._show_peer_decision(9, sequence_capture, sequence_record)
        sequence_transcript = b"".join(writes)
        self.assertIn(b"reference_role=metadata_parent\nordinal=2", sequence_transcript)
        self.assertIn(
            b"reference_role=sequence_metadata_parent\nordinal=2",
            sequence_transcript,
        )

        owned_capture, _package, _expectations = self.load_capture(
            ["SEQUENCE OWNED BY", "SEQUENCE", "TABLE"]
        )
        owned_checkpoint = authoring.initialize_checkpoint(
            owned_capture, self.binding, "Primary", "session-1"
        )
        owned_record = copy.deepcopy(owned_checkpoint["entries"][0])
        owned_record["primary_decision"]["parent_entry_ids"] = [
            owned_capture.entries_by_ordinal[1].entry_id,
            owned_capture.entries_by_ordinal[2].entry_id,
        ]
        owned_record["primary_decision"]["relationship_review_state"] = "reviewed"
        writes = []

        def owned_choice(_descriptor, *, allowed):
            if "summary_reviewed" in allowed:
                return "summary_reviewed"
            if "context_reviewed" in allowed:
                return "context_reviewed"
            return "confirmed"

        with mock.patch.object(
            AUTHOR,
            "_write_tty",
            side_effect=lambda _descriptor, payload: writes.append(payload),
        ), mock.patch.object(AUTHOR, "_read_tty_choice", side_effect=owned_choice):
            AUTHOR._entry_updates(
                "sequence_review",
                {"entries": [owned_record]},
                owned_capture,
                (0,),
                9,
            )
            AUTHOR._show_peer_decision(9, owned_capture, owned_record)
        owned_transcript = b"".join(writes)
        self.assertIn(
            b"reference_role=sequence_structural_parent\nordinal=2",
            owned_transcript,
        )
        self.assertIn(
            b"reference_role=sequence_structural_parent\nordinal=3",
            owned_transcript,
        )
        ordinary = AUTHOR._fixed_diagnostic(status="failed", reason="tty_invalid")
        self.assertNotIn(poison.encode("ascii"), ordinary)
        for entry in capture.entries_by_ordinal:
            self.assertNotIn(entry.entry_id.encode("ascii"), ordinary)

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
            exit_status, diagnostic = self.execute_with_private_ack(environment)
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
        manual_conflict_disposition="restore",
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
        decision["manual_conflict_review_state"] = (
            "pending" if classification == "manual_conflict" else "not_applicable"
        )
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
        if classification == "manual_conflict":
            decision = copy.deepcopy(checkpoint["entries"][0]["primary_decision"])
            decision["manual_conflict_disposition"] = manual_conflict_disposition
            decision["manual_conflict_review_state"] = "reviewed"
            checkpoint = authoring.apply_transition(
                checkpoint,
                capture,
                binding,
                action="manual_conflict_review",
                operator_identity=primary_operator,
                session_identity="session-manual-conflict",
                reviewed_ordinal_ranges=[{"start": 0, "end_exclusive": 1}],
                entry_updates=[{"ordinal": 0, "primary_decision": decision}],
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

    def fully_reviewed_capture_history(
        self,
        capture,
        *,
        binding=None,
        dependencies=None,
        structural_parents=None,
        metadata_parents=None,
        primary_operator="Primary",
        peer_operator="Peer",
    ):
        """Build a valid synthetic chain for every entry in a capture."""

        binding = self.binding if binding is None else binding
        dependencies = dict(dependencies or {})
        structural_parents = dict(structural_parents or {})
        metadata_parents = dict(metadata_parents or {})
        entry_count = len(capture.entries_by_ordinal)
        all_ranges = [{"start": 0, "end_exclusive": entry_count}]
        history = []

        checkpoint = authoring.initialize_checkpoint(
            capture, binding, primary_operator, "bulk-session-1"
        )
        history.append(checkpoint)

        primary_updates = []
        for ordinal, record in enumerate(checkpoint["entries"]):
            decision = copy.deepcopy(record["primary_decision"])
            decision["classification"] = "restore"
            decision["classification_reviewed"] = True
            primary_updates.append({"ordinal": ordinal, "primary_decision": decision})
        checkpoint = authoring.apply_transition(
            checkpoint,
            capture,
            binding,
            action="primary_review",
            operator_identity=primary_operator,
            session_identity="bulk-session-2",
            reviewed_ordinal_ranges=all_ranges,
            entry_updates=primary_updates,
        )
        history.append(checkpoint)

        relationship_updates = []
        for ordinal, record in enumerate(checkpoint["entries"]):
            decision = copy.deepcopy(record["primary_decision"])
            decision["dependency_entry_ids"] = [
                capture.entries_by_ordinal[target].entry_id
                for target in dependencies.get(ordinal, ())
            ]
            decision["dependency_reviewed"] = True
            if decision["relationship_review_state"] == "pending":
                decision["parent_entry_ids"] = [
                    capture.entries_by_ordinal[target].entry_id
                    for target in structural_parents.get(ordinal, ())
                ]
                decision["relationship_review_state"] = "reviewed"
            relationship_updates.append(
                {"ordinal": ordinal, "primary_decision": decision}
            )
        checkpoint = authoring.apply_transition(
            checkpoint,
            capture,
            binding,
            action="relationship_review",
            operator_identity=primary_operator,
            session_identity="bulk-session-3",
            reviewed_ordinal_ranges=all_ranges,
            entry_updates=relationship_updates,
        )
        history.append(checkpoint)

        data_ordinals = tuple(
            entry.ordinal for entry in capture.entries_by_ordinal if entry.is_data_reference
        )
        if data_ordinals:
            data_updates = []
            for ordinal in data_ordinals:
                decision = copy.deepcopy(
                    checkpoint["entries"][ordinal]["primary_decision"]
                )
                decision["metadata_parent_entry_id"] = capture.entries_by_ordinal[
                    metadata_parents[ordinal]
                ].entry_id
                decision["data_reference_review_state"] = "reviewed"
                data_updates.append({"ordinal": ordinal, "primary_decision": decision})
            checkpoint = authoring.apply_transition(
                checkpoint,
                capture,
                binding,
                action="data_reference_review",
                operator_identity=primary_operator,
                session_identity="bulk-session-4",
                reviewed_ordinal_ranges=AUTHOR._ranges(data_ordinals),
                entry_updates=data_updates,
            )
            history.append(checkpoint)

        sequence_ordinals = tuple(
            entry.ordinal
            for entry in capture.entries_by_ordinal
            if entry.object_class in authoring.STATE_BEARING_REVIEW_CLASSES
        )
        if sequence_ordinals:
            sequence_updates = []
            for ordinal in sequence_ordinals:
                decision = copy.deepcopy(
                    checkpoint["entries"][ordinal]["primary_decision"]
                )
                if capture.entries_by_ordinal[ordinal].object_class == "SEQUENCE SET":
                    decision["metadata_parent_entry_id"] = capture.entries_by_ordinal[
                        metadata_parents[ordinal]
                    ].entry_id
                decision["sequence_review_state"] = "reviewed"
                sequence_updates.append(
                    {"ordinal": ordinal, "primary_decision": decision}
                )
            checkpoint = authoring.apply_transition(
                checkpoint,
                capture,
                binding,
                action="sequence_review",
                operator_identity=primary_operator,
                session_identity="bulk-session-5",
                reviewed_ordinal_ranges=AUTHOR._ranges(sequence_ordinals),
                entry_updates=sequence_updates,
            )
            history.append(checkpoint)

        managed_updates = []
        for ordinal, record in enumerate(checkpoint["entries"]):
            decision = copy.deepcopy(record["primary_decision"])
            decision["managed_domain"] = "none"
            decision["managed_domain_reviewed"] = True
            managed_updates.append({"ordinal": ordinal, "primary_decision": decision})
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
            session_identity="bulk-session-6",
            reviewed_ordinal_ranges=all_ranges,
            entry_updates=managed_updates,
            global_updates=globals_selected,
            managed_updates=managed_selected,
        )
        history.append(checkpoint)

        peer_updates = [
            {
                "ordinal": ordinal,
                "peer_status": "approved",
                "primary_decision_sha256": record["primary_decision_sha256"],
            }
            for ordinal, record in enumerate(checkpoint["entries"])
        ]
        checkpoint = authoring.apply_transition(
            checkpoint,
            capture,
            binding,
            action="peer_review",
            operator_identity=peer_operator,
            session_identity="bulk-session-7",
            reviewed_ordinal_ranges=all_ranges,
            entry_updates=peer_updates,
            global_updates={name: "approved" for name in globals_selected},
            managed_updates={name: "approved" for name in managed_selected},
        )
        history.append(checkpoint)
        return history

    def reclassify_primary_decision(
        self,
        checkpoint,
        capture,
        classification,
        *,
        session_identity,
    ):
        decision = copy.deepcopy(checkpoint["entries"][0]["primary_decision"])
        decision["classification"] = classification
        decision["classification_reviewed"] = True
        decision["manual_conflict_disposition"] = None
        decision["manual_conflict_review_state"] = (
            "pending" if classification == "manual_conflict" else "not_applicable"
        )
        return authoring.apply_transition(
            checkpoint,
            capture,
            self.binding,
            action="primary_review",
            operator_identity="Primary",
            session_identity=session_identity,
            reviewed_ordinal_ranges=[{"start": 0, "end_exclusive": 1}],
            entry_updates=[{"ordinal": 0, "primary_decision": decision}],
        )

    def approve_entry_peer(self, checkpoint, capture, *, session_identity):
        return authoring.apply_transition(
            checkpoint,
            capture,
            self.binding,
            action="peer_review",
            operator_identity="Peer",
            session_identity=session_identity,
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

    def complete_rejected_entry_primary_phases(
        self,
        checkpoint,
        capture,
        classification,
        *,
        session_prefix,
    ):
        states = []
        checkpoint = self.reclassify_primary_decision(
            checkpoint,
            capture,
            classification,
            session_identity=session_prefix + "-primary",
        )
        states.append(authoring.aggregate_status(checkpoint, capture)["authoring_state"])

        decision = copy.deepcopy(checkpoint["entries"][0]["primary_decision"])
        decision["dependency_reviewed"] = True
        checkpoint = authoring.apply_transition(
            checkpoint,
            capture,
            self.binding,
            action="relationship_review",
            operator_identity="Primary",
            session_identity=session_prefix + "-relationship",
            reviewed_ordinal_ranges=[{"start": 0, "end_exclusive": 1}],
            entry_updates=[{"ordinal": 0, "primary_decision": decision}],
        )
        states.append(authoring.aggregate_status(checkpoint, capture)["authoring_state"])

        decision = copy.deepcopy(checkpoint["entries"][0]["primary_decision"])
        decision["managed_domain_reviewed"] = True
        checkpoint = authoring.apply_transition(
            checkpoint,
            capture,
            self.binding,
            action="managed_review",
            operator_identity="Primary",
            session_identity=session_prefix + "-managed",
            reviewed_ordinal_ranges=[{"start": 0, "end_exclusive": 1}],
            entry_updates=[{"ordinal": 0, "primary_decision": decision}],
        )
        states.append(authoring.aggregate_status(checkpoint, capture)["authoring_state"])
        return checkpoint, states

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

    def test_finalization_eligible_manual_conflict_reclassifies_and_reapproves(self):
        capture, _package, _expectations = self.load_capture(["TABLE"])
        eligible = self.fully_reviewed_history(
            capture,
            classification="manual_conflict",
            manual_conflict_disposition="restore",
        )[-1]
        self.assertEqual(
            authoring.aggregate_status(eligible, capture)["authoring_state"],
            "FINALIZATION_ELIGIBLE",
        )
        before = eligible["entries"][0]
        corrected = self.reclassify_primary_decision(
            eligible,
            capture,
            "restore",
            session_identity="eligible-manual-to-restore",
        )
        decision = corrected["entries"][0]["primary_decision"]
        self.assertIsNone(decision["manual_conflict_disposition"])
        self.assertEqual(decision["manual_conflict_review_state"], "not_applicable")
        self.assertNotEqual(
            corrected["entries"][0]["primary_decision_sha256"],
            before["primary_decision_sha256"],
        )
        self.assertEqual(corrected["entries"][0]["peer_review"], authoring._pending_peer())
        self.assertEqual(
            authoring.aggregate_status(corrected, capture)["authoring_state"],
            "PEER_REVIEW_REQUIRED",
        )
        reapproved = self.approve_entry_peer(
            corrected, capture, session_identity="eligible-manual-peer-reapproval"
        )
        self.assertEqual(
            authoring.aggregate_status(reapproved, capture)["authoring_state"],
            "FINALIZATION_ELIGIBLE",
        )

    def test_finalization_review_required_manual_conflict_reclassifies(self):
        capture, _package, _expectations = self.load_capture(["TABLE"])
        semantic_failure = self.fully_reviewed_history(
            capture,
            classification="manual_conflict",
            manual_conflict_disposition="dependency_only",
        )[-1]
        self.assertEqual(
            authoring.aggregate_status(semantic_failure, capture)["authoring_state"],
            "FINALIZATION_REVIEW_REQUIRED",
        )
        corrected = self.reclassify_primary_decision(
            semantic_failure,
            capture,
            "exclude_duplicate",
            session_identity="semantic-manual-to-nonmanual",
        )
        decision = corrected["entries"][0]["primary_decision"]
        self.assertEqual(decision["classification"], "exclude_duplicate")
        self.assertIsNone(decision["manual_conflict_disposition"])
        self.assertEqual(decision["manual_conflict_review_state"], "not_applicable")
        self.assertEqual(corrected["entries"][0]["peer_review"], authoring._pending_peer())
        self.assertEqual(
            authoring.aggregate_status(corrected, capture)["authoring_state"],
            "PEER_REVIEW_REQUIRED",
        )

    def test_manual_conflict_reselection_requires_new_disposition_and_peer(self):
        capture, _package, _expectations = self.load_capture(["TABLE"])
        eligible = self.fully_reviewed_history(
            capture,
            classification="manual_conflict",
            manual_conflict_disposition="restore",
        )[-1]
        before_hash = eligible["entries"][0]["primary_decision_sha256"]
        corrected = self.reclassify_primary_decision(
            eligible,
            capture,
            "manual_conflict",
            session_identity="eligible-manual-reselection",
        )
        decision = corrected["entries"][0]["primary_decision"]
        self.assertIsNone(decision["manual_conflict_disposition"])
        self.assertEqual(decision["manual_conflict_review_state"], "pending")
        self.assertNotEqual(
            corrected["entries"][0]["primary_decision_sha256"], before_hash
        )
        self.assertEqual(corrected["entries"][0]["peer_review"], authoring._pending_peer())
        self.assertEqual(
            authoring.aggregate_status(corrected, capture)["authoring_state"],
            "MANUAL_CONFLICT_REVIEW_REQUIRED",
        )

        reviewed_decision = copy.deepcopy(decision)
        reviewed_decision["manual_conflict_disposition"] = "exclude_duplicate"
        reviewed_decision["manual_conflict_review_state"] = "reviewed"
        reviewed = authoring.apply_transition(
            corrected,
            capture,
            self.binding,
            action="manual_conflict_review",
            operator_identity="Primary",
            session_identity="fresh-manual-disposition",
            reviewed_ordinal_ranges=[{"start": 0, "end_exclusive": 1}],
            entry_updates=[{"ordinal": 0, "primary_decision": reviewed_decision}],
        )
        self.assertEqual(
            authoring.aggregate_status(reviewed, capture)["authoring_state"],
            "PEER_REVIEW_REQUIRED",
        )
        reapproved = self.approve_entry_peer(
            reviewed, capture, session_identity="fresh-manual-peer"
        )
        self.assertEqual(
            authoring.aggregate_status(reapproved, capture)["authoring_state"],
            "FINALIZATION_ELIGIBLE",
        )

    def test_peer_rejected_manual_conflict_can_be_reclassified(self):
        capture, _package, _expectations = self.load_capture(["TABLE"])
        eligible = self.fully_reviewed_history(
            capture,
            classification="manual_conflict",
            manual_conflict_disposition="restore",
        )[-1]
        rejected = authoring.apply_transition(
            eligible,
            capture,
            self.binding,
            action="peer_review",
            operator_identity="Peer",
            session_identity="reject-manual-for-reclassification",
            reviewed_ordinal_ranges=[{"start": 0, "end_exclusive": 1}],
            entry_updates=[
                {
                    "ordinal": 0,
                    "peer_status": "changes_requested",
                    "primary_decision_sha256": eligible["entries"][0][
                        "primary_decision_sha256"
                    ],
                }
            ],
        )
        retained = rejected["entries"][0]["primary_decision"]
        self.assertEqual(retained["manual_conflict_disposition"], "restore")
        self.assertEqual(
            authoring.aggregate_status(rejected, capture)["authoring_state"],
            "PRIMARY_REVIEW_REQUIRED",
        )
        reviewed, states = self.complete_rejected_entry_primary_phases(
            rejected,
            capture,
            "restore",
            session_prefix="rejected-manual-to-restore",
        )
        self.assertEqual(
            states,
            [
                "RELATIONSHIP_REVIEW_REQUIRED",
                "MANAGED_GLOBAL_REVIEW_REQUIRED",
                "PEER_REVIEW_REQUIRED",
            ],
        )
        self.assertIsNone(
            reviewed["entries"][0]["primary_decision"]["manual_conflict_disposition"]
        )
        reapproved = self.approve_entry_peer(
            reviewed, capture, session_identity="rejected-nonmanual-peer"
        )
        self.assertEqual(
            authoring.aggregate_status(reapproved, capture)["authoring_state"],
            "FINALIZATION_ELIGIBLE",
        )

    def test_peer_rejected_manual_conflict_requires_fresh_manual_review(self):
        capture, _package, _expectations = self.load_capture(["TABLE"])
        eligible = self.fully_reviewed_history(
            capture,
            classification="manual_conflict",
            manual_conflict_disposition="restore",
        )[-1]
        rejected = authoring.apply_transition(
            eligible,
            capture,
            self.binding,
            action="peer_review",
            operator_identity="Peer",
            session_identity="reject-manual-for-manual-rereview",
            reviewed_ordinal_ranges=[{"start": 0, "end_exclusive": 1}],
            entry_updates=[
                {
                    "ordinal": 0,
                    "peer_status": "changes_requested",
                    "primary_decision_sha256": eligible["entries"][0][
                        "primary_decision_sha256"
                    ],
                }
            ],
        )
        reviewed, states = self.complete_rejected_entry_primary_phases(
            rejected,
            capture,
            "manual_conflict",
            session_prefix="rejected-manual-rereview",
        )
        self.assertEqual(
            states,
            [
                "RELATIONSHIP_REVIEW_REQUIRED",
                "MANAGED_GLOBAL_REVIEW_REQUIRED",
                "MANUAL_CONFLICT_REVIEW_REQUIRED",
            ],
        )
        decision = reviewed["entries"][0]["primary_decision"]
        self.assertIsNone(decision["manual_conflict_disposition"])
        self.assertEqual(decision["manual_conflict_review_state"], "pending")
        self.assertEqual(
            authoring.aggregate_status(reviewed, capture)["authoring_state"],
            "MANUAL_CONFLICT_REVIEW_REQUIRED",
        )

        disposition = copy.deepcopy(decision)
        disposition["manual_conflict_disposition"] = "restore"
        disposition["manual_conflict_review_state"] = "reviewed"
        reviewed = authoring.apply_transition(
            reviewed,
            capture,
            self.binding,
            action="manual_conflict_review",
            operator_identity="Primary",
            session_identity="rejected-fresh-manual-disposition",
            reviewed_ordinal_ranges=[{"start": 0, "end_exclusive": 1}],
            entry_updates=[{"ordinal": 0, "primary_decision": disposition}],
        )
        reapproved = self.approve_entry_peer(
            reviewed, capture, session_identity="rejected-fresh-manual-peer"
        )
        self.assertEqual(
            authoring.aggregate_status(reapproved, capture)["authoring_state"],
            "FINALIZATION_ELIGIBLE",
        )

    def test_primary_review_rejects_stale_or_substituted_manual_disposition(self):
        capture, _package, _expectations = self.load_capture(["TABLE"])
        eligible = self.fully_reviewed_history(
            capture,
            classification="manual_conflict",
            manual_conflict_disposition="restore",
        )[-1]
        prior = eligible["entries"][0]["primary_decision"]

        retained = copy.deepcopy(prior)
        retained["classification"] = "exclude_duplicate"
        retained["manual_conflict_review_state"] = "not_applicable"
        substituted = copy.deepcopy(prior)
        substituted["manual_conflict_disposition"] = "exclude_duplicate"
        stale_review = copy.deepcopy(prior)
        stale_review["manual_conflict_disposition"] = None
        classification_unreviewed = copy.deepcopy(prior)
        classification_unreviewed["manual_conflict_disposition"] = None
        classification_unreviewed["manual_conflict_review_state"] = "pending"
        classification_unreviewed["classification_reviewed"] = False

        for name, forged, expected_code in (
            ("retained", retained, "checkpoint_invalid"),
            ("substituted", substituted, "review_transition_invalid"),
            ("stale_review", stale_review, "review_transition_invalid"),
            (
                "classification_unreviewed",
                classification_unreviewed,
                "review_transition_invalid",
            ),
        ):
            with self.subTest(case=name):
                with self.assertRaisesRegex(
                    authoring.AuthoringContractError, expected_code
                ):
                    authoring.apply_transition(
                        eligible,
                        capture,
                        self.binding,
                        action="primary_review",
                        operator_identity="Primary",
                        session_identity="forged-primary-" + name,
                        reviewed_ordinal_ranges=[{"start": 0, "end_exclusive": 1}],
                        entry_updates=[
                            {"ordinal": 0, "primary_decision": forged}
                        ],
                    )

        initial = authoring.initialize_checkpoint(
            capture, self.binding, "Primary", "unresolved-initialize"
        )
        unresolved_decision = copy.deepcopy(initial["entries"][0]["primary_decision"])
        unresolved_decision["classification"] = "unresolved"
        unresolved_decision["classification_reviewed"] = True
        unresolved = authoring.apply_transition(
            initial,
            capture,
            self.binding,
            action="primary_review",
            operator_identity="Primary",
            session_identity="unresolved-primary",
            reviewed_ordinal_ranges=[{"start": 0, "end_exclusive": 1}],
            entry_updates=[
                {"ordinal": 0, "primary_decision": unresolved_decision}
            ],
        )
        forged_revisit = copy.deepcopy(
            unresolved["entries"][0]["primary_decision"]
        )
        forged_revisit["classification"] = "manual_conflict"
        forged_revisit["manual_conflict_review_state"] = "reviewed"
        with self.assertRaisesRegex(
            authoring.AuthoringContractError, "review_transition_invalid"
        ):
            authoring.apply_transition(
                unresolved,
                capture,
                self.binding,
                action="revisit_unresolved",
                operator_identity="Primary",
                session_identity="forged-unresolved-manual-review",
                reviewed_ordinal_ranges=[{"start": 0, "end_exclusive": 1}],
                entry_updates=[
                    {"ordinal": 0, "primary_decision": forged_revisit}
                ],
            )

    def test_manual_conflict_correction_entrypoint_is_fixed_and_nonleaking(self):
        poison = "MANUAL_RAW_NAME_OWNER_SQL_PATH_SECRET_PAYLOAD_SENTINEL"
        capture_root = self.root / "manual-correction-capture"
        package, expectations, _capture, _entries = make_capture_package(
            capture_root, ["TABLE"], poison=poison
        )
        package_fd = open_directory(package)
        try:
            loaded = authoring.load_capture_for_authoring(package_fd, expectations)
        finally:
            os.close(package_fd)
        private_root = self.root / "manual-correction-private"
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
            classification="manual_conflict",
            manual_conflict_disposition="restore",
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
        old_head = authoring.checkpoint_sha256(history[-1])
        old_release_token = released_token(private_root)
        environment = self.author_environment(
            package,
            expectations,
            private_root,
            action="correction_review",
            generation=history[-1]["generation"],
            head_sha256=old_head,
        )
        writes: list[bytes] = []
        with mock.patch.object(
            AUTHOR, "_authoring_procedure_identity", return_value=SHA_C
        ), mock.patch.object(
            AUTHOR, "_prompt_choice", side_effect=("primary_review", "restore")
        ), mock.patch.object(
            AUTHOR, "_prompt_correction_ordinals", return_value=(0,)
        ), mock.patch.object(
            AUTHOR,
            "_write_tty",
            side_effect=lambda _descriptor, payload: writes.append(payload),
        ), mock.patch.object(
            AUTHOR, "_require_resume_acknowledgement", return_value=None
        ), mock.patch.object(
            AUTHOR._startup_subprocess,
            "run",
            side_effect=AssertionError("unexpected child process"),
        ), mock.patch.object(
            socket,
            "socket",
            side_effect=AssertionError("unexpected network operation"),
        ):
            exit_status, diagnostic = AUTHOR.execute_authoring(environment, 9)
        self.assertEqual(exit_status, 2)
        checkpoints_fd = open_directory(checkpoints)
        try:
            chain = authoring.load_checkpoint_chain(
                checkpoints_fd, loaded, runtime_binding
            )
        finally:
            os.close(checkpoints_fd)
        self.assertEqual(chain.head["entries"][0]["primary_decision"]["classification"], "restore")
        self.assertIsNone(
            chain.head["entries"][0]["primary_decision"][
                "manual_conflict_disposition"
            ]
        )
        self.assertEqual(chain.head["entries"][0]["peer_review"], authoring._pending_peer())
        self.assertNotEqual(
            chain.head["entries"][0]["primary_decision_sha256"],
            history[-1]["entries"][0]["primary_decision_sha256"],
        )
        for private_value in (
            poison,
            os.fspath(package),
            os.fspath(private_root),
            old_head,
            old_release_token,
        ):
            self.assertNotIn(private_value.encode("utf-8"), diagnostic)
        for entry in loaded.entries_by_ordinal:
            self.assertNotIn(entry.entry_id.encode("ascii"), diagnostic)
        self.assertFalse(
            any(
                AUTHOR.FINAL_PACKAGE_RE.fullmatch(path.name)
                for path in private_root.iterdir()
            )
        )
        self.assertTrue(writes)

    def test_relationship_correction_swaps_clears_and_reselects_parent(self):
        capture, _package, _expectations = self.load_capture(
            ["TRIGGER", "TABLE", "VIEW", "SEQUENCE"]
        )
        history = self.fully_reviewed_capture_history(
            capture,
            dependencies={0: (3,)},
            structural_parents={0: (1,)},
        )
        eligible = history[-1]
        self.assertEqual(
            authoring.aggregate_status(eligible, capture)["authoring_state"],
            "FINALIZATION_ELIGIBLE",
        )
        original = eligible["entries"][0]

        swapped_decision = copy.deepcopy(original["primary_decision"])
        swapped_decision["parent_entry_ids"] = [
            capture.entries_by_ordinal[2].entry_id
        ]
        swapped = authoring.apply_transition(
            eligible,
            capture,
            self.binding,
            action="relationship_correction",
            operator_identity="Primary",
            session_identity="swap-parent",
            reviewed_ordinal_ranges=[{"start": 0, "end_exclusive": 1}],
            entry_updates=[{"ordinal": 0, "primary_decision": swapped_decision}],
        )
        self.assertNotEqual(
            swapped["entries"][0]["primary_decision_sha256"],
            original["primary_decision_sha256"],
        )
        self.assertEqual(swapped["entries"][0]["peer_review"], authoring._pending_peer())
        self.assertEqual(
            swapped["entries"][0]["primary_decision"]["parent_entry_ids"],
            [capture.entries_by_ordinal[2].entry_id],
        )

        cleared_decision = copy.deepcopy(original["primary_decision"])
        cleared_decision["parent_entry_ids"] = []
        cleared_decision["relationship_review_state"] = "pending"
        cleared = authoring.apply_transition(
            eligible,
            capture,
            self.binding,
            action="relationship_correction",
            operator_identity="Primary",
            session_identity="clear-parent",
            reviewed_ordinal_ranges=[{"start": 0, "end_exclusive": 1}],
            entry_updates=[{"ordinal": 0, "primary_decision": cleared_decision}],
        )
        self.assertEqual(
            authoring.aggregate_status(cleared, capture)["authoring_state"],
            "RELATIONSHIP_REVIEW_REQUIRED",
        )
        reselected_decision = copy.deepcopy(
            cleared["entries"][0]["primary_decision"]
        )
        reselected_decision["parent_entry_ids"] = [
            capture.entries_by_ordinal[2].entry_id
        ]
        reselected_decision["relationship_review_state"] = "reviewed"
        reselected = authoring.apply_transition(
            cleared,
            capture,
            self.binding,
            action="relationship_review",
            operator_identity="Primary",
            session_identity="reselect-parent",
            reviewed_ordinal_ranges=[{"start": 0, "end_exclusive": 1}],
            entry_updates=[{"ordinal": 0, "primary_decision": reselected_decision}],
        )
        self.assertEqual(
            reselected["entries"][0]["primary_decision"]["parent_entry_ids"],
            [capture.entries_by_ordinal[2].entry_id],
        )
        self.assertEqual(
            reselected["entries"][0]["peer_review"], authoring._pending_peer()
        )
        self.assertNotEqual(
            reselected["entries"][0]["primary_decision_sha256"],
            cleared["entries"][0]["primary_decision_sha256"],
        )

        early = history[2]
        early_decision = copy.deepcopy(early["entries"][0]["primary_decision"])
        early_decision["parent_entry_ids"] = [capture.entries_by_ordinal[2].entry_id]
        with self.assertRaisesRegex(
            authoring.AuthoringContractError, "review_transition_invalid"
        ):
            authoring.apply_transition(
                early,
                capture,
                self.binding,
                action="relationship_correction",
                operator_identity="Primary",
                session_identity="too-early",
                reviewed_ordinal_ranges=[{"start": 0, "end_exclusive": 1}],
                entry_updates=[{"ordinal": 0, "primary_decision": early_decision}],
            )

        with self.assertRaisesRegex(
            authoring.AuthoringContractError, "review_transition_invalid"
        ):
            authoring.apply_transition(
                eligible,
                capture,
                self.binding,
                action="relationship_review",
                operator_identity="Primary",
                session_identity="ordinary-review-correction-bypass",
                reviewed_ordinal_ranges=[{"start": 0, "end_exclusive": 1}],
                entry_updates=[
                    {"ordinal": 0, "primary_decision": swapped_decision}
                ],
            )

        unrelated_decision = copy.deepcopy(swapped_decision)
        unrelated_decision["classification"] = "dependency_only"
        with self.assertRaisesRegex(
            authoring.AuthoringContractError, "review_transition_invalid"
        ):
            authoring.apply_transition(
                eligible,
                capture,
                self.binding,
                action="relationship_correction",
                operator_identity="Primary",
                session_identity="unrelated-field-correction",
                reviewed_ordinal_ranges=[{"start": 0, "end_exclusive": 1}],
                entry_updates=[
                    {"ordinal": 0, "primary_decision": unrelated_decision}
                ],
            )
        self.assertNotIn("relationship_correction", AUTHOR.ACTION_VALUES)

    def test_entrypoint_relationship_correction_handles_both_final_states(self):
        poison = "RAW_NAME_OWNER_SQL_PATH_SECRET_PAYLOAD_SENTINEL"
        for label, initial_parents, expected_state in (
            ("eligible", (1,), "FINALIZATION_ELIGIBLE"),
            ("semantic-blocked", (), "FINALIZATION_REVIEW_REQUIRED"),
        ):
            with self.subTest(state=label):
                capture_root = self.root / ("entrypoint-correction-" + label)
                package, expectations, _capture, _entries = make_capture_package(
                    capture_root,
                    ["TRIGGER", "TABLE", "VIEW", "SEQUENCE"],
                    poison=poison,
                )
                package_fd = open_directory(package)
                try:
                    loaded = authoring.load_capture_for_authoring(
                        package_fd, expectations
                    )
                finally:
                    os.close(package_fd)
                private_root = self.root / ("entrypoint-private-" + label)
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
                history = self.fully_reviewed_capture_history(
                    loaded,
                    binding=runtime_binding,
                    dependencies={0: (3,)},
                    structural_parents={0: initial_parents},
                    primary_operator="Primary Reviewer",
                )
                self.assertEqual(
                    authoring.aggregate_status(history[-1], loaded)[
                        "authoring_state"
                    ],
                    expected_state,
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
                old_release_token = released_token(private_root)
                head = authoring.checkpoint_sha256(history[-1])
                environment = self.author_environment(
                    package,
                    expectations,
                    private_root,
                    action="correction_review",
                    generation=history[-1]["generation"],
                    head_sha256=head,
                )
                writes: list[bytes] = []
                with mock.patch.object(
                    AUTHOR, "_authoring_procedure_identity", return_value=SHA_C
                ), mock.patch.object(
                    AUTHOR, "_prompt_choice", return_value="relationship_review"
                ), mock.patch.object(
                    AUTHOR, "_prompt_correction_ordinals", return_value=(0,)
                ), mock.patch.object(
                    AUTHOR,
                    "_read_tty_line",
                    side_effect=("show:4", "4", "show:3", "3"),
                ), mock.patch.object(
                    AUTHOR,
                    "_write_tty",
                    side_effect=lambda _descriptor, payload: writes.append(payload),
                ), mock.patch.object(
                    AUTHOR, "_require_resume_acknowledgement", return_value=None
                ), mock.patch.object(
                    AUTHOR._startup_subprocess,
                    "run",
                    side_effect=AssertionError("unexpected child process"),
                ), mock.patch.object(
                    socket,
                    "socket",
                    side_effect=AssertionError("unexpected network operation"),
                ):
                    exit_status, diagnostic = AUTHOR.execute_authoring(environment, 9)
                self.assertEqual(exit_status, 2)
                transcript = b"".join(writes)
                self.assertIn(b"dependency_ordinals_csv_or_none", transcript)
                self.assertIn(
                    b"reference_role=dependency\nordinal=4", transcript
                )
                self.assertIn(
                    b"structural_parent_ordinals_csv_or_none", transcript
                )
                self.assertIn(
                    b"reference_role=structural_parent\nordinal=3", transcript
                )
                for entry in loaded.entries_by_ordinal:
                    self.assertNotIn(entry.entry_id.encode("ascii"), transcript)
                    self.assertNotIn(entry.entry_id.encode("ascii"), diagnostic)
                for private_value in (
                    poison,
                    os.fspath(package),
                    os.fspath(private_root),
                    head,
                    old_release_token,
                ):
                    self.assertNotIn(private_value.encode("utf-8"), diagnostic)
                checkpoints_fd = open_directory(checkpoints)
                try:
                    chain = authoring.load_checkpoint_chain(
                        checkpoints_fd, loaded, runtime_binding
                    )
                finally:
                    os.close(checkpoints_fd)
                self.assertEqual(
                    chain.head["event"]["action"], "relationship_correction"
                )
                self.assertEqual(
                    chain.head["entries"][0]["primary_decision"][
                        "parent_entry_ids"
                    ],
                    [loaded.entries_by_ordinal[2].entry_id],
                )
                self.assertEqual(
                    chain.head["entries"][0]["peer_review"], authoring._pending_peer()
                )
                self.assertFalse(
                    any(
                        AUTHOR.FINAL_PACKAGE_RE.fullmatch(path.name)
                        for path in private_root.iterdir()
                    )
                )

    def test_sequence_owned_parent_correction_invalidates_sequence_and_peer(self):
        poison = "SEQUENCE_OWNER_SQL_PATH_SECRET_PAYLOAD_SENTINEL"
        capture_root = self.root / "sequence-owned-correction"
        package, expectations, _capture, _entries = make_capture_package(
            capture_root,
            ["SEQUENCE OWNED BY", "SEQUENCE", "TABLE", "SEQUENCE"],
            poison=poison,
        )
        descriptor = open_directory(package)
        try:
            capture = authoring.load_capture_for_authoring(descriptor, expectations)
        finally:
            os.close(descriptor)
        eligible = self.fully_reviewed_capture_history(
            capture, structural_parents={0: (1, 2)}
        )[-1]
        self.assertEqual(
            authoring.aggregate_status(eligible, capture)["authoring_state"],
            "FINALIZATION_ELIGIBLE",
        )
        stale = copy.deepcopy(eligible["entries"][0]["primary_decision"])
        stale["parent_entry_ids"] = [
            capture.entries_by_ordinal[3].entry_id,
            capture.entries_by_ordinal[2].entry_id,
        ]
        self.assertEqual(stale["sequence_review_state"], "reviewed")
        with self.assertRaisesRegex(
            authoring.AuthoringContractError, "review_transition_invalid"
        ):
            authoring.apply_transition(
                eligible,
                capture,
                self.binding,
                action="relationship_correction",
                operator_identity="Primary",
                session_identity="stale-sequence-review",
                reviewed_ordinal_ranges=[{"start": 0, "end_exclusive": 1}],
                entry_updates=[{"ordinal": 0, "primary_decision": stale}],
            )

        corrected_decision = copy.deepcopy(stale)
        corrected_decision["sequence_review_state"] = "pending"
        corrected = authoring.apply_transition(
            eligible,
            capture,
            self.binding,
            action="relationship_correction",
            operator_identity="Primary",
            session_identity="invalidate-sequence-review",
            reviewed_ordinal_ranges=[{"start": 0, "end_exclusive": 1}],
            entry_updates=[{"ordinal": 0, "primary_decision": corrected_decision}],
        )
        corrected_record = corrected["entries"][0]
        self.assertEqual(
            corrected_record["primary_decision"]["sequence_review_state"], "pending"
        )
        self.assertEqual(corrected_record["peer_review"], authoring._pending_peer())
        self.assertNotEqual(
            corrected_record["primary_decision_sha256"],
            eligible["entries"][0]["primary_decision_sha256"],
        )
        self.assertEqual(
            authoring.aggregate_status(corrected, capture)["authoring_state"],
            "SEQUENCE_REVIEW_REQUIRED",
        )

        writes: list[bytes] = []

        def sequence_choice(_descriptor, *, allowed):
            if "context_reviewed" in allowed:
                return "context_reviewed"
            return "confirmed"

        with mock.patch.object(
            AUTHOR,
            "_write_tty",
            side_effect=lambda _descriptor, payload: writes.append(payload),
        ), mock.patch.object(AUTHOR, "_read_tty_choice", side_effect=sequence_choice):
            update = AUTHOR._entry_updates(
                "sequence_review", corrected, capture, (0,), 9
            )[0]["primary_decision"]
        transcript = b"".join(writes)
        self.assertIn(
            b"reference_role=sequence_structural_parent\nordinal=4", transcript
        )
        self.assertIn(
            b"reference_role=sequence_structural_parent\nordinal=3", transcript
        )
        self.assertNotIn(
            b"reference_role=sequence_structural_parent\nordinal=2", transcript
        )
        for entry in capture.entries_by_ordinal:
            self.assertNotIn(entry.entry_id.encode("ascii"), transcript)
        reviewed = authoring.apply_transition(
            corrected,
            capture,
            self.binding,
            action="sequence_review",
            operator_identity="Primary",
            session_identity="fresh-sequence-review",
            reviewed_ordinal_ranges=[{"start": 0, "end_exclusive": 1}],
            entry_updates=[{"ordinal": 0, "primary_decision": update}],
        )
        self.assertEqual(
            authoring.aggregate_status(reviewed, capture)["authoring_state"],
            "PEER_REVIEW_REQUIRED",
        )
        reapproved = authoring.apply_transition(
            reviewed,
            capture,
            self.binding,
            action="peer_review",
            operator_identity="Peer",
            session_identity="fresh-sequence-peer",
            reviewed_ordinal_ranges=[{"start": 0, "end_exclusive": 1}],
            entry_updates=[
                {
                    "ordinal": 0,
                    "peer_status": "approved",
                    "primary_decision_sha256": reviewed["entries"][0][
                        "primary_decision_sha256"
                    ],
                }
            ],
        )
        self.assertEqual(
            authoring.aggregate_status(reapproved, capture)["authoring_state"],
            "FINALIZATION_ELIGIBLE",
        )
        ordinary = AUTHOR._fixed_diagnostic(status="failed", reason="input_invalid")
        self.assertNotIn(poison.encode("ascii"), ordinary)

    def test_sequence_set_and_data_reference_corrections_are_role_confined(self):
        sequence_capture, _package, _expectations = self.load_capture(
            ["SEQUENCE SET", "SEQUENCE", "SEQUENCE"]
        )
        sequence_eligible = self.fully_reviewed_capture_history(
            sequence_capture,
            dependencies={0: (1,)},
            metadata_parents={0: 2},
        )[-1]
        sequence_before = sequence_eligible["entries"][0]["primary_decision"]
        sequence_writes: list[bytes] = []
        with mock.patch.object(
            AUTHOR, "_read_tty_line", side_effect=("show:2", "2")
        ), mock.patch.object(
            AUTHOR,
            "_write_tty",
            side_effect=lambda _descriptor, payload: sequence_writes.append(payload),
        ):
            sequence_update = AUTHOR._entry_updates(
                "sequence_review", sequence_eligible, sequence_capture, (0,), 9
            )[0]["primary_decision"]
        sequence_transcript = b"".join(sequence_writes)
        self.assertIn(b"sequence_metadata_parent_ordinal", sequence_transcript)
        self.assertIn(
            b"reference_role=sequence_metadata_parent\nordinal=2",
            sequence_transcript,
        )
        self.assertNotIn(b"structural_parent_ordinals", sequence_transcript)
        self.assertEqual(
            authoring._changed_keys(sequence_before, sequence_update),
            {"metadata_parent_entry_id"},
        )
        sequence_corrected = authoring.apply_transition(
            sequence_eligible,
            sequence_capture,
            self.binding,
            action="sequence_review",
            operator_identity="Primary",
            session_identity="sequence-set-correction",
            reviewed_ordinal_ranges=[{"start": 0, "end_exclusive": 1}],
            entry_updates=[{"ordinal": 0, "primary_decision": sequence_update}],
        )
        self.assertEqual(
            sequence_corrected["entries"][0]["peer_review"],
            authoring._pending_peer(),
        )

        peer_writes: list[bytes] = []

        def peer_choice(_descriptor, *, allowed):
            if "summary_reviewed" in allowed:
                return "summary_reviewed"
            return "context_reviewed"

        with mock.patch.object(
            AUTHOR,
            "_write_tty",
            side_effect=lambda _descriptor, payload: peer_writes.append(payload),
        ), mock.patch.object(AUTHOR, "_read_tty_choice", side_effect=peer_choice):
            AUTHOR._show_peer_decision(
                9, sequence_capture, sequence_corrected["entries"][0]
            )
        peer_transcript = b"".join(peer_writes)
        for role in ("dependency", "metadata_parent", "sequence_metadata_parent"):
            self.assertIn(
                ("reference_role=%s\nordinal=2" % role).encode("ascii"),
                peer_transcript,
            )
        for entry in sequence_capture.entries_by_ordinal:
            self.assertNotIn(entry.entry_id.encode("ascii"), peer_transcript)

        forged_sequence = copy.deepcopy(sequence_update)
        forged_sequence["parent_entry_ids"] = [
            sequence_capture.entries_by_ordinal[2].entry_id
        ]
        with self.assertRaisesRegex(
            authoring.AuthoringContractError, "review_transition_invalid"
        ):
            authoring.apply_transition(
                sequence_eligible,
                sequence_capture,
                self.binding,
                action="sequence_review",
                operator_identity="Primary",
                session_identity="forged-sequence-set-parent",
                reviewed_ordinal_ranges=[{"start": 0, "end_exclusive": 1}],
                entry_updates=[{"ordinal": 0, "primary_decision": forged_sequence}],
            )

        data_capture, _package, _expectations = self.load_capture(
            ["TABLE DATA", "TABLE", "TABLE"]
        )
        data_eligible = self.fully_reviewed_capture_history(
            data_capture, metadata_parents={0: 1}
        )[-1]
        data_before = data_eligible["entries"][0]["primary_decision"]
        data_writes: list[bytes] = []
        with mock.patch.object(
            AUTHOR, "_read_tty_line", side_effect=("show:3", "3")
        ), mock.patch.object(
            AUTHOR,
            "_write_tty",
            side_effect=lambda _descriptor, payload: data_writes.append(payload),
        ):
            data_update = AUTHOR._entry_updates(
                "data_reference_review", data_eligible, data_capture, (0,), 9
            )[0]["primary_decision"]
        data_transcript = b"".join(data_writes)
        self.assertIn(b"metadata_parent_ordinal", data_transcript)
        self.assertIn(
            b"reference_role=metadata_parent\nordinal=3", data_transcript
        )
        self.assertNotIn(b"structural_parent_ordinals", data_transcript)
        self.assertNotIn(b"sequence_metadata_parent", data_transcript)
        self.assertEqual(
            authoring._changed_keys(data_before, data_update),
            {"metadata_parent_entry_id"},
        )
        data_corrected = authoring.apply_transition(
            data_eligible,
            data_capture,
            self.binding,
            action="data_reference_review",
            operator_identity="Primary",
            session_identity="data-reference-correction",
            reviewed_ordinal_ranges=[{"start": 0, "end_exclusive": 1}],
            entry_updates=[{"ordinal": 0, "primary_decision": data_update}],
        )
        self.assertEqual(
            data_corrected["entries"][0]["peer_review"], authoring._pending_peer()
        )
        forged_data = copy.deepcopy(data_update)
        forged_data["dependency_entry_ids"] = [
            data_capture.entries_by_ordinal[1].entry_id
        ]
        with self.assertRaisesRegex(
            authoring.AuthoringContractError, "review_transition_invalid"
        ):
            authoring.apply_transition(
                data_eligible,
                data_capture,
                self.binding,
                action="data_reference_review",
                operator_identity="Primary",
                session_identity="forged-data-dependency",
                reviewed_ordinal_ranges=[{"start": 0, "end_exclusive": 1}],
                entry_updates=[{"ordinal": 0, "primary_decision": forged_data}],
            )

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
                    with mock.patch.object(AUTHOR, "_write_tty"), mock.patch.object(
                        AUTHOR, "_require_resume_acknowledgement", return_value=None
                    ):
                        exit_status, diagnostic = AUTHOR.execute_authoring(
                            environment, 9
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
                        self.execute_with_private_ack(rejected)
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
            exit_status, diagnostic = self.execute_with_private_ack(approved)
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
                self.execute_with_private_ack(approved)
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

    def test_exact_generation_one_binding_bridge_is_single_and_self_closing(self):
        capture, _package, _expectations = self.load_capture(["TABLE"])
        historical = authoring.AuthoringBinding(
            "b1986e4079b52edbb4ef5cd4c56ed4d20af07195",
            "bc0b990d878db1e2c72bd4ac91314fe32261a454ac38505b7ea6df4af2b5f3d8",
            "4b42b1a117605cafc8607b67b0892a609c2cd125012dd56288abeed8c89cdfb1",
        )
        current = authoring.AuthoringBinding(GIT_B, SHA_C, SHA_D)
        initial = authoring.initialize_checkpoint(
            capture, historical, "Primary", "legacy-session"
        )
        original_bytes = authoring.checkpoint_bytes(initial)
        decision = copy.deepcopy(initial["entries"][0]["primary_decision"])
        decision["classification"] = "restore"
        decision["classification_reviewed"] = True
        decision["manual_conflict_review_state"] = "not_applicable"
        bridge = authoring.GenerationOneBindingPolicy(
            historical_binding=historical,
            current_binding=current,
            allow_successor_transition=True,
        )
        successor = authoring.apply_transition(
            initial,
            capture,
            current,
            action="primary_review",
            operator_identity="Primary",
            session_identity="current-session",
            reviewed_ordinal_ranges=[{"start": 0, "end_exclusive": 1}],
            entry_updates=[{"ordinal": 0, "primary_decision": decision}],
            binding_policy=bridge,
        )
        self.assertEqual(authoring.checkpoint_bytes(initial), original_bytes)
        self.assertEqual(initial["authoring_binding"], historical.as_dict())
        self.assertEqual(successor["generation"], 2)
        self.assertEqual(successor["authoring_binding"], current.as_dict())
        self.assertEqual(
            successor["previous_checkpoint_sha256"],
            authoring.checkpoint_sha256(initial),
        )

        checkpoints = self.root / "binding-bridge-checkpoints"
        checkpoints.mkdir(mode=0o700)
        descriptor = open_directory(checkpoints)
        try:
            authoring.publish_checkpoint_at(descriptor, initial)
            authoring.publish_checkpoint_at(descriptor, successor)
            validation_policy = authoring.GenerationOneBindingPolicy(
                historical_binding=historical,
                current_binding=current,
                allow_successor_transition=False,
            )
            chain = authoring.load_checkpoint_chain(
                descriptor,
                capture,
                current,
                binding_policy=validation_policy,
            )
            self.assertEqual(len(chain.checkpoints), 2)
            self.assertEqual(chain.checkpoints[0]["authoring_binding"], historical.as_dict())
            self.assertEqual(chain.checkpoints[1]["authoring_binding"], current.as_dict())
        finally:
            os.close(descriptor)

        with self.assertRaisesRegex(
            authoring.AuthoringContractError, "history_invalid"
        ):
            authoring.apply_transition(
                initial,
                capture,
                current,
                action="primary_review",
                operator_identity="Primary",
                session_identity="replayed-session",
                reviewed_ordinal_ranges=[{"start": 0, "end_exclusive": 1}],
                entry_updates=[{"ordinal": 0, "primary_decision": decision}],
                binding_policy=authoring.GenerationOneBindingPolicy(
                    historical_binding=historical,
                    current_binding=current,
                    allow_successor_transition=False,
                ),
            )

    def test_generation_one_bridge_rejects_wrong_action_and_old_bound_generation_two(self):
        capture, _package, _expectations = self.load_capture(["TABLE"])
        historical = authoring.AuthoringBinding(
            "b1986e4079b52edbb4ef5cd4c56ed4d20af07195",
            "bc0b990d878db1e2c72bd4ac91314fe32261a454ac38505b7ea6df4af2b5f3d8",
            "4b42b1a117605cafc8607b67b0892a609c2cd125012dd56288abeed8c89cdfb1",
        )
        current = authoring.AuthoringBinding(GIT_B, SHA_C, SHA_D)
        initial = authoring.initialize_checkpoint(
            capture, historical, "Primary", "legacy-session"
        )
        policy = authoring.GenerationOneBindingPolicy(
            historical_binding=historical,
            current_binding=current,
            allow_successor_transition=True,
        )
        with self.assertRaisesRegex(
            authoring.AuthoringContractError, "history_invalid"
        ):
            authoring.apply_transition(
                initial,
                capture,
                current,
                action="status",
                operator_identity="Primary",
                session_identity="invalid-action",
                reviewed_ordinal_ranges=[],
                binding_policy=policy,
            )

        decision = copy.deepcopy(initial["entries"][0]["primary_decision"])
        decision["classification"] = "restore"
        decision["classification_reviewed"] = True
        decision["manual_conflict_review_state"] = "not_applicable"
        successor = authoring.apply_transition(
            initial,
            capture,
            current,
            action="primary_review",
            operator_identity="Primary",
            session_identity="current-session",
            reviewed_ordinal_ranges=[{"start": 0, "end_exclusive": 1}],
            entry_updates=[{"ordinal": 0, "primary_decision": decision}],
            binding_policy=policy,
        )
        successor["authoring_binding"] = historical.as_dict()
        checkpoints = self.root / "old-bound-generation-two"
        checkpoints.mkdir(mode=0o700)
        descriptor = open_directory(checkpoints)
        try:
            authoring.publish_checkpoint_at(descriptor, initial)
            authoring.publish_checkpoint_at(descriptor, successor)
            with self.assertRaisesRegex(
                authoring.AuthoringContractError, "history_invalid"
            ):
                authoring.load_checkpoint_chain(
                    descriptor,
                    capture,
                    current,
                    binding_policy=authoring.GenerationOneBindingPolicy(
                        historical_binding=historical,
                        current_binding=current,
                        allow_successor_transition=False,
                    ),
                )
        finally:
            os.close(descriptor)

    def test_generation_one_policy_requires_the_exact_historical_binding(self):
        capture, _package, _expectations = self.load_capture(["TABLE"])
        historical = authoring.AuthoringBinding(
            "b1986e4079b52edbb4ef5cd4c56ed4d20af07195",
            "bc0b990d878db1e2c72bd4ac91314fe32261a454ac38505b7ea6df4af2b5f3d8",
            "4b42b1a117605cafc8607b67b0892a609c2cd125012dd56288abeed8c89cdfb1",
        )
        current = authoring.AuthoringBinding(GIT_B, SHA_C, SHA_D)
        current_bound_generation_one = authoring.initialize_checkpoint(
            capture, current, "Primary", "current-session"
        )
        checkpoints = self.root / "current-bound-generation-one"
        checkpoints.mkdir(mode=0o700)
        descriptor = open_directory(checkpoints)
        try:
            authoring.publish_checkpoint_at(
                descriptor, current_bound_generation_one
            )
            with self.assertRaisesRegex(
                authoring.AuthoringContractError, "history_invalid"
            ):
                authoring.load_checkpoint_chain(
                    descriptor,
                    capture,
                    current,
                    binding_policy=authoring.GenerationOneBindingPolicy(
                        historical_binding=historical,
                        current_binding=current,
                        allow_successor_transition=False,
                    ),
                )
        finally:
            os.close(descriptor)

    def test_generation_one_policy_rejects_arbitrary_historical_binding(self):
        with self.assertRaisesRegex(
            authoring.AuthoringContractError, "history_invalid"
        ):
            authoring.GenerationOneBindingPolicy(
                historical_binding=authoring.AuthoringBinding(
                    GIT_A, SHA_A, SHA_B
                ),
                current_binding=authoring.AuthoringBinding(
                    GIT_B, SHA_C, SHA_D
                ),
                allow_successor_transition=True,
            )

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
                    self.execute_with_private_ack(environment)
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

    def test_checkpoint_capture_binding_rejects_genuine_boolean_integer_aliases(self):
        capture, _package, _expectations = self.load_capture()
        checkpoint = authoring.initialize_checkpoint(
            capture, self.binding, "Primary", "session-1"
        )
        for field, alias in (
            ("data_reference_count", False),
            ("entry_count", True),
            ("opaque_key_nlink", True),
        ):
            with self.subTest(field=field):
                forged = copy.deepcopy(checkpoint)
                forged["capture_binding"][field] = alias
                self.assertEqual(
                    forged["capture_binding"],
                    dict(capture.capture_binding),
                    "the regression must exercise Python's bool/int equality alias",
                )
                with self.assertRaisesRegex(
                    authoring.AuthoringContractError, "checkpoint_invalid"
                ):
                    authoring.validate_checkpoint(forged, capture, self.binding)

    def test_all_checkpoint_capture_binding_integers_require_exact_int_type(self):
        capture, _package, _expectations = self.load_capture()
        checkpoint = authoring.initialize_checkpoint(
            capture, self.binding, "Primary", "session-1"
        )
        canonical_values = {
            "data_reference_count": 0,
            "entry_count": 1,
            "opaque_key_ctime_ns": 0,
            "opaque_key_device": 0,
            "opaque_key_gid": 0,
            "opaque_key_inode": 1,
            "opaque_key_mode": 0o400,
            "opaque_key_mtime_ns": 0,
            "opaque_key_nlink": 1,
            "opaque_key_size_bytes": 32,
            "opaque_key_uid": 0,
            "package_device": 0,
            "package_inode": 1,
            "raw_toc_size_bytes": 1,
        }
        self.assertEqual(len(canonical_values), 14)
        for field, canonical_value in canonical_values.items():
            with self.subTest(field=field):
                expected_binding = dict(capture.capture_binding)
                expected_binding[field] = canonical_value
                expected_capture = authoring.AuthoringCapture(
                    capture_binding=expected_binding,
                    entries_by_ordinal=capture.entries_by_ordinal,
                    package_device=capture.package_device,
                    package_inode=capture.package_inode,
                )
                forged = copy.deepcopy(checkpoint)
                alias = (
                    bool(canonical_value)
                    if canonical_value in {0, 1}
                    else float(canonical_value)
                )
                forged["capture_binding"][field] = alias
                self.assertEqual(
                    forged["capture_binding"],
                    dict(expected_capture.capture_binding),
                    "the regression must isolate exact numeric type validation",
                )
                self.assertIsNot(type(alias), int)
                with self.assertRaisesRegex(
                    authoring.AuthoringContractError, "checkpoint_invalid"
                ):
                    authoring.validate_checkpoint(
                        forged, expected_capture, self.binding
                    )

    def test_legacy_checkpoint_capture_binding_remains_closed_and_string_exact(self):
        legacy_binding = {
            "capture_manifest_sha256": "a" * 64,
            "evidence_run_id": "synthetic-run",
            "opaque_index_sha256": "b" * 64,
            "raw_toc_sha256": "c" * 64,
        }
        capture = authoring.AuthoringCapture(
            capture_binding=legacy_binding,
            entries_by_ordinal=(
                authoring.AuthoringEntry(
                    entry_id="d" * 64,
                    ordinal=0,
                    object_class="TABLE",
                    is_data_reference=False,
                    raw_line=b"SYNTHETIC",
                ),
            ),
            package_device=1,
            package_inode=2,
        )
        checkpoint = authoring.initialize_checkpoint(
            capture, self.binding, "Primary", "session-1"
        )
        self.assertEqual(
            set(checkpoint["capture_binding"]),
            set(authoring.LEGACY_CAPTURE_BINDING_KEYS),
        )
        for label, mutate in (
            (
                "missing",
                lambda binding: binding.pop("raw_toc_sha256"),
            ),
            (
                "unexpected",
                lambda binding: binding.__setitem__("unexpected", "value"),
            ),
            (
                "sha_type",
                lambda binding: binding.__setitem__(
                    "capture_manifest_sha256", True
                ),
            ),
            (
                "run_id_type",
                lambda binding: binding.__setitem__("evidence_run_id", True),
            ),
        ):
            with self.subTest(label=label):
                forged = copy.deepcopy(checkpoint)
                mutate(forged["capture_binding"])
                expected_capture = authoring.AuthoringCapture(
                    capture_binding=copy.deepcopy(forged["capture_binding"]),
                    entries_by_ordinal=capture.entries_by_ordinal,
                    package_device=capture.package_device,
                    package_inode=capture.package_inode,
                )
                self.assertEqual(
                    forged["capture_binding"],
                    dict(expected_capture.capture_binding),
                )
                with self.assertRaisesRegex(
                    authoring.AuthoringContractError, "checkpoint_invalid"
                ):
                    authoring.validate_checkpoint(
                        forged, expected_capture, self.binding
                    )

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
        self.assertIn(
            "relationship_correction",
            checkpoint_schema["properties"]["event"]["properties"]["action"][
                "enum"
            ],
        )
        self.assertEqual(
            set(
                checkpoint_schema["properties"]["capture_binding"]["required"]
            ),
            set(authoring.CAPTURE_BINDING_KEYS),
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
