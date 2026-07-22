from __future__ import annotations

from contextlib import ExitStack
import errno
import hashlib
import importlib.util
import json
import os
import pty
import select
import stat
import subprocess
import sys
import tempfile
import time
import types
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "scripts" / "migration"
sys.path.insert(0, str(MIGRATION))

from lib import lovable_toc_contract as capture_contract  # noqa: E402
from test_lovable_toc_annotation_authoring import (  # noqa: E402
    GIT_A,
    SHA_A,
    SHA_B,
    SHA_C,
    SHA_D,
    immutable_tree_snapshot,
    make_capture_package,
)


def load_session():
    path = MIGRATION / "author-lovable-toc-operator-session.py"
    spec = importlib.util.spec_from_file_location("toc_operator_session_test", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("synthetic operator session load failed")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


SESSION = load_session()
AUTHOR = SESSION.AUTHOR
ZERO64 = "0" * 64
LAUNCHER = MIGRATION / "run-lovable-toc-annotation-operator-session.sh"

LAUNCHER_POISON_VARIABLES = (
    "LD_PRELOAD",
    "LD_LIBRARY_PATH",
    "LD_AUDIT",
    "LD_DEBUG",
    "LD_DEBUG_OUTPUT",
    "LD_PROFILE",
    "LD_PROFILE_OUTPUT",
    "LD_ORIGIN_PATH",
    "LD_ASSUME_KERNEL",
    "LD_TRACE_LOADED_OBJECTS",
    "LD_BIND_NOW",
    "LD_BIND_NOT",
    "LD_SHOW_AUXV",
    "LD_VERBOSE",
    "LD_WARN",
    "LD_DYNAMIC_WEAK",
    "LD_HWCAP_MASK",
    "LD_POINTER_GUARD",
    "GLIBC_TUNABLES",
    "DYLD_INSERT_LIBRARIES",
    "DYLD_LIBRARY_PATH",
    "DYLD_FRAMEWORK_PATH",
    "DYLD_FALLBACK_LIBRARY_PATH",
    "DYLD_FALLBACK_FRAMEWORK_PATH",
    "DYLD_IMAGE_SUFFIX",
    "DYLD_ROOT_PATH",
    "DYLD_FORCE_FLAT_NAMESPACE",
    "DYLD_SHARED_REGION",
    "DYLD_PRINT_LIBRARIES",
    "DYLD_PRINT_LIBRARIES_POST_LAUNCH",
    "DYLD_PRINT_APIS",
    "DYLD_PRINT_BINDINGS",
    "DYLD_PRINT_TO_FILE",
    "DYLD_PRINT_RPATHS",
    "DYLD_PRINT_ENV",
    "DYLD_PRINT_OPTS",
    "DYLD_PRINT_WARNINGS",
    "DYLD_PRINT_INITIALIZERS",
    "DYLD_PRINT_SEGMENTS",
    "DYLD_PRINT_STATISTICS",
    "DYLD_PRINT_STATISTICS_DETAILS",
    "DYLD_PRINT_INTERPOSING",
    "DYLD_PRINT_SEARCHING",
    "DYLD_PRINT_UUIDS",
    "DYLD_PRINT_DOFS",
    "DYLD_PRINT_LINKS_WITH",
    "DYLD_PRINT_FIXUPS",
    "DYLD_USE_CLOSURES",
    "DYLD_DISABLE_CLOSURES",
    "DYLD_SHARED_CACHE_DIR",
    "PYTHONHOME",
    "PYTHONPATH",
    "PYTHONUSERBASE",
    "PYTHONSTARTUP",
    "PYTHONINSPECT",
    "PYTHONBREAKPOINT",
    "PYTHONWARNINGS",
    "PYTHONMALLOC",
    "PYTHONTRACEMALLOC",
    "PYTHONPROFILEIMPORTTIME",
    "ENV",
    "BASH_ENV",
)
LOADER_EAGER_VARIABLES = {
    "LD_TRACE_LOADED_OBJECTS",
    "LD_SHOW_AUXV",
}


class TocOperatorSessionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="toc-operator-session.")
        self.root = Path(self.temporary.name).resolve()
        self.root.chmod(0o700)
        self.capture_root = self.root / "capture-root"
        self.package, self.expectations, _capture, _entries = make_capture_package(
            self.capture_root, ["TABLE", "TABLE DATA"], run_id="synthetic-run"
        )
        self.session_root = self.root / "operator-session-root"
        self.annotation_root = self.root / "annotation-root"
        self.python = Path(sys.executable).resolve(strict=True)
        self.python_sha = hashlib.sha256(self.python.read_bytes()).hexdigest()
        self.python_version = (
            f"{sys.implementation.name}:{sys.version_info.major}."
            f"{sys.version_info.minor}.{sys.version_info.micro}"
        )
        self.bootstrap = {
            "approved_checkout": GIT_A,
            "python_path": os.fspath(self.python),
            "python_sha256": self.python_sha,
            "python_version": self.python_version,
        }

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def responses(
        self,
        *,
        primary: str = "Primary Reviewer",
        operator: str = "Primary Reviewer",
        session_id: str = "operator-session-1",
        authoring_session: str = "authoring-session-1",
        authorization_ack: str = "authorization_digest_recorded",
    ) -> list[str]:
        return [
            session_id,
            primary,
            operator,
            authoring_session,
            os.fspath(self.session_root),
            os.fspath(self.annotation_root),
            os.fspath(self.capture_root),
            self.package.name,
            self.expectations.approved_pg_restore_sha256,
            self.expectations.capture_execution_checkout_sha,
            self.expectations.capture_manifest_sha256,
            self.expectations.capture_procedure_identity_sha256,
            str(self.expectations.data_reference_count),
            str(self.expectations.entry_count),
            self.expectations.evidence_manifest_sha256,
            self.expectations.evidence_run_id,
            self.expectations.inner_archive_sha256,
            self.expectations.inspection_checkout_sha,
            self.expectations.inspection_procedure_sha256,
            self.expectations.opaque_index_sha256,
            self.expectations.outer_archive_sha256,
            self.expectations.raw_toc_sha256,
            SHA_D,
            SHA_C,
            SESSION.TTY_ATTESTATION,
            authorization_ack,
        ]

    def run_with_responses(self, responses: list[str], *, execute_authoring_side_effect=None):
        seen_prompts: list[bytes] = []
        iterator = iter(responses)

        def fake_read(_tty_fd: int, prompt: bytes, *, echo: bool = False) -> str:
            seen_prompts.append(prompt)
            try:
                return next(iterator)
            except StopIteration as exc:
                raise AssertionError("operator prompt requested an unexpected value") from exc

        tty_writes: list[bytes] = []

        def fake_tty_write(_tty_fd: int, payload: bytes) -> None:
            tty_writes.append(payload)

        with ExitStack() as stack:
            stack.enter_context(mock.patch.object(SESSION, "_read_line", side_effect=fake_read))
            stack.enter_context(mock.patch.object(SESSION, "_tty_write", side_effect=fake_tty_write))
            stack.enter_context(
                mock.patch.object(
                    SESSION, "_operator_session_procedure_identity", return_value=SHA_D
                )
            )
            stack.enter_context(mock.patch.object(SESSION, "_procedure_identity", return_value=SHA_C))
            stack.enter_context(mock.patch.object(AUTHOR, "_authoring_procedure_identity", return_value=SHA_C))
            stack.enter_context(mock.patch.object(AUTHOR, "_write_tty", return_value=None))
            stack.enter_context(mock.patch.object(AUTHOR, "_require_resume_acknowledgement", return_value=None))
            if execute_authoring_side_effect is not None:
                stack.enter_context(
                    mock.patch.object(
                        AUTHOR,
                        "execute_authoring",
                        side_effect=execute_authoring_side_effect,
                    )
                )
            result = SESSION.run_session(9, self.bootstrap)
        return result, seen_prompts, tty_writes

    def test_initialize_creates_private_authorization_and_resume_records(self):
        status, diagnostic = self.run_with_responses(self.responses())[0]
        self.assertEqual(status, 2)
        visible = json.loads(diagnostic)
        self.assertEqual(visible["review_gate"], "REVIEW_REQUIRED")
        self.assertEqual(visible["authoring_state"], "PRIMARY_REVIEW_REQUIRED")

        self.assertTrue(self.session_root.is_dir())
        self.assertTrue(self.annotation_root.is_dir())
        self.assertEqual(stat.S_IMODE(self.session_root.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(self.annotation_root.stat().st_mode), 0o700)

        session_names = sorted(path.name for path in self.session_root.iterdir())
        authorization_names = [name for name in session_names if name.startswith("authorization-")]
        resume_names = [name for name in session_names if name.startswith("resume-g")]
        self.assertEqual(len(authorization_names), 1)
        self.assertEqual(len(resume_names), 1)
        for name in authorization_names + resume_names:
            path = self.session_root / name
            metadata = path.stat()
            self.assertEqual(stat.S_IMODE(metadata.st_mode), 0o400)
            self.assertEqual(metadata.st_nlink, 1)

        authorization = capture_contract.strict_json_loads(
            (self.session_root / authorization_names[0]).read_bytes()
        )
        resume = capture_contract.strict_json_loads(
            (self.session_root / resume_names[0]).read_bytes()
        )
        authorization_sha = hashlib.sha256(
            capture_contract.canonical_json_bytes(authorization)
        ).hexdigest()
        self.assertEqual(resume["authorization_sha256"], authorization_sha)
        self.assertEqual(resume["resume_generation"], 1)
        self.assertRegex(resume["resume_checkpoint_sha256"], r"^[0-9a-f]{64}$")
        self.assertRegex(resume["resume_release_token"], r"^[0-9a-f]{64}$")

        checkpoint_names = list((self.annotation_root / AUTHOR.CHECKPOINTS_NAME).iterdir())
        self.assertEqual(len(checkpoint_names), 1)
        self.assertIn(resume["resume_checkpoint_sha256"], checkpoint_names[0].name)
        self.assertFalse((self.annotation_root / AUTHOR.LOCK_NAME).exists())
        self.assertTrue((self.annotation_root / AUTHOR.RELEASED_NAME).exists())

        combined_output = diagnostic + b"".join(
            path.read_bytes() for path in self.session_root.iterdir()
        )
        for sentinel in (b"synthetic-private-object", b"opaque-id.key", b"raw-pg-restore-list"):
            self.assertNotIn(sentinel, diagnostic)
        self.assertNotIn(b"synthetic-private-object", combined_output)

    def test_operator_mismatch_rejects_before_private_roots_exist(self):
        capture_before = immutable_tree_snapshot(self.capture_root)
        with self.assertRaises(SESSION.OperatorSessionError) as raised:
            self.run_with_responses(
                self.responses(operator="primary reviewer")
            )
        self.assertEqual(raised.exception.reason, "binding_mismatch")
        self.assertFalse(self.session_root.exists())
        self.assertFalse(self.annotation_root.exists())
        self.assertEqual(immutable_tree_snapshot(self.capture_root), capture_before)

    def test_ack_failure_marks_session_indeterminate_and_never_initializes(self):
        with self.assertRaises(SESSION.OperatorSessionError) as raised:
            self.run_with_responses(self.responses(authorization_ack="wrong"))
        self.assertEqual(raised.exception.reason, "input_invalid")
        self.assertTrue((self.session_root / "OPERATOR_SESSION_INDETERMINATE").exists())
        self.assertFalse(self.annotation_root.exists())
        self.assertFalse(any(path.name.startswith("resume-g") for path in self.session_root.iterdir()))

    def test_no_replace_rejects_preexisting_session_or_annotation_root(self):
        self.session_root.mkdir(mode=0o700)
        with self.assertRaises(SESSION.OperatorSessionError) as raised:
            self.run_with_responses(self.responses())
        self.assertEqual(raised.exception.reason, "history_conflict")
        self.assertFalse(self.annotation_root.exists())

        self.session_root.rmdir()
        self.annotation_root.mkdir(mode=0o700)
        with self.assertRaises(SESSION.OperatorSessionError) as raised:
            self.run_with_responses(self.responses())
        self.assertEqual(raised.exception.reason, "history_conflict")

    def test_resume_record_consumption_rejects_duplicate_json_keys(self):
        self.session_root.mkdir(mode=0o700)
        record = self.session_root / ("resume-g0000000000000001-" + ("a" * 64) + ".json")
        record.write_bytes(
            b'{"artifact_kind":"lovable_toc_operator_resume",'
            b'"artifact_kind":"lovable_toc_operator_resume"}\n'
        )
        record.chmod(0o400)
        root_fd = os.open(
            self.session_root,
            os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0),
        )
        try:
            with self.assertRaises(SESSION.OperatorSessionError) as raised:
                SESSION.validate_resume_record_at(
                    root_fd,
                    record.name,
                    authorization_sha256=SHA_A,
                    expected_generation=1,
                    expected_checkpoint_sha256="a" * 64,
                    expected_operator_identity="Primary Reviewer",
                    expected_session_id="operator-session-1",
                )
        finally:
            os.close(root_fd)
        self.assertEqual(raised.exception.reason, "history_conflict")

    def test_resume_record_consumption_returns_token_only_on_exact_match(self):
        status, _diagnostic = self.run_with_responses(self.responses())[0]
        self.assertEqual(status, 2)
        resume_path = next(path for path in self.session_root.iterdir() if path.name.startswith("resume-g"))
        authorization_path = next(path for path in self.session_root.iterdir() if path.name.startswith("authorization-"))
        authorization = capture_contract.strict_json_loads(authorization_path.read_bytes())
        authorization_sha = hashlib.sha256(
            capture_contract.canonical_json_bytes(authorization)
        ).hexdigest()
        resume = capture_contract.strict_json_loads(resume_path.read_bytes())
        root_fd = os.open(
            self.session_root,
            os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0),
        )
        try:
            token = SESSION.validate_resume_record_at(
                root_fd,
                resume_path.name,
                authorization_sha256=authorization_sha,
                expected_generation=1,
                expected_checkpoint_sha256=resume["resume_checkpoint_sha256"],
                expected_operator_identity="Primary Reviewer",
                expected_session_id="operator-session-1",
            )
            self.assertEqual(token, resume["resume_release_token"])
            with self.assertRaises(SESSION.OperatorSessionError):
                SESSION.validate_resume_record_at(
                    root_fd,
                    resume_path.name,
                    authorization_sha256=authorization_sha,
                    expected_generation=1,
                    expected_checkpoint_sha256="b" * 64,
                    expected_operator_identity="Primary Reviewer",
                    expected_session_id="operator-session-1",
                )
        finally:
            os.close(root_fd)

    def test_launcher_does_not_export_toc_author_binding_block(self):
        launcher = LAUNCHER.read_text(encoding="utf-8")
        self.assertNotIn("TOC_AUTHOR_CAPTURE_ROOT", launcher)
        self.assertNotIn("TOC_AUTHOR_EXPECTED_OPAQUE_INDEX_SHA256", launcher)
        self.assertIn("printf '%s\\0%s\\0%s\\0%s\\0'", launcher)
        self.assertIn('/usr/bin/env -i', launcher)
        for forbidden in ("pbcopy", "pbpaste", "osascript", "open ", "mktemp", "tee "):
            self.assertNotIn(forbidden, launcher)

    def test_fixed_failure_diagnostic_suppresses_private_values(self):
        diagnostic = SESSION._fixed("failed", "binding_mismatch")
        for value in (
            os.fspath(self.capture_root).encode(),
            self.expectations.opaque_index_sha256.encode(),
            b"synthetic-private-object",
        ):
            self.assertNotIn(value, diagnostic)
        self.assertEqual(
            json.loads(diagnostic),
            {
                "diagnostic_version": 1,
                "reason": "binding_mismatch",
                "stage": "annotation_operator_session",
                "status": "failed",
            },
        )

    def _char_stat(self, *, inode: int = 20, mode: int | None = None):
        return types.SimpleNamespace(
            st_dev=10,
            st_ino=inode,
            st_mode=(stat.S_IFCHR | 0o600) if mode is None else mode,
            st_rdev=30,
        )

    def test_validate_tty_fd_checks_controlling_foreground_termios_and_stability(self):
        tty = self._char_stat()
        controlling = self._char_stat(inode=21)
        with ExitStack() as stack:
            stack.enter_context(mock.patch.dict(SESSION.os.environ, {"TOC_OPERATOR_TTY_FD": "3"}))
            stack.enter_context(
                mock.patch.object(SESSION.os, "fstat", side_effect=[tty, controlling, tty])
            )
            stack.enter_context(mock.patch.object(SESSION.os, "isatty", return_value=True))
            stack.enter_context(mock.patch.object(SESSION.os, "open", return_value=4))
            close_mock = stack.enter_context(mock.patch.object(SESSION.os, "close", return_value=None))
            stack.enter_context(mock.patch.object(SESSION.os, "getpgrp", return_value=123))
            stack.enter_context(mock.patch.object(SESSION.os, "tcgetpgrp", return_value=123))
            stack.enter_context(
                mock.patch.object(SESSION.termios, "tcgetattr", return_value=[0, 0, 0, 0, 0, 0, []])
            )
            self.assertEqual(SESSION._validate_tty_fd(), 3)
            close_mock.assert_called_once_with(4)

    def test_validate_tty_fd_rejects_background_process_group(self):
        tty = self._char_stat()
        controlling = self._char_stat(inode=21)
        with ExitStack() as stack:
            stack.enter_context(mock.patch.dict(SESSION.os.environ, {"TOC_OPERATOR_TTY_FD": "3"}))
            stack.enter_context(
                mock.patch.object(SESSION.os, "fstat", side_effect=[tty, controlling])
            )
            stack.enter_context(mock.patch.object(SESSION.os, "isatty", return_value=True))
            stack.enter_context(mock.patch.object(SESSION.os, "open", return_value=4))
            stack.enter_context(mock.patch.object(SESSION.os, "close", return_value=None))
            stack.enter_context(mock.patch.object(SESSION.os, "getpgrp", return_value=123))
            stack.enter_context(mock.patch.object(SESSION.os, "tcgetpgrp", return_value=456))
            with self.assertRaises(SESSION.OperatorSessionError) as raised:
                SESSION._validate_tty_fd()
        self.assertEqual(raised.exception.reason, "tty_invalid")

    def test_validate_tty_fd_rejects_controlling_terminal_device_mismatch(self):
        fixture_before = immutable_tree_snapshot(self.root)
        tty = self._char_stat()
        controlling = self._char_stat(inode=21)
        controlling.st_rdev = 31
        with ExitStack() as stack:
            stack.enter_context(mock.patch.dict(SESSION.os.environ, {"TOC_OPERATOR_TTY_FD": "3"}))
            stack.enter_context(
                mock.patch.object(SESSION.os, "fstat", side_effect=[tty, controlling])
            )
            stack.enter_context(mock.patch.object(SESSION.os, "isatty", return_value=True))
            stack.enter_context(mock.patch.object(SESSION.os, "open", return_value=4))
            stack.enter_context(mock.patch.object(SESSION.os, "close", return_value=None))
            tcgetpgrp_mock = stack.enter_context(mock.patch.object(SESSION.os, "tcgetpgrp"))
            getpgrp_mock = stack.enter_context(mock.patch.object(SESSION.os, "getpgrp"))
            termios_mock = stack.enter_context(mock.patch.object(SESSION.termios, "tcgetattr"))
            tty_write_mock = stack.enter_context(mock.patch.object(SESSION, "_tty_write"))
            read_line_mock = stack.enter_context(mock.patch.object(SESSION, "_read_line"))
            with self.assertRaises(SESSION.OperatorSessionError) as raised:
                SESSION._validate_tty_fd()
        self.assertEqual(raised.exception.reason, "tty_invalid")
        tcgetpgrp_mock.assert_not_called()
        getpgrp_mock.assert_not_called()
        termios_mock.assert_not_called()
        tty_write_mock.assert_not_called()
        read_line_mock.assert_not_called()
        self.assertEqual(immutable_tree_snapshot(self.root), fixture_before)

    def test_validate_tty_fd_rejects_termios_failure(self):
        tty = self._char_stat()
        controlling = self._char_stat(inode=21)
        with ExitStack() as stack:
            stack.enter_context(mock.patch.dict(SESSION.os.environ, {"TOC_OPERATOR_TTY_FD": "3"}))
            stack.enter_context(
                mock.patch.object(SESSION.os, "fstat", side_effect=[tty, controlling])
            )
            stack.enter_context(mock.patch.object(SESSION.os, "isatty", return_value=True))
            stack.enter_context(mock.patch.object(SESSION.os, "open", return_value=4))
            stack.enter_context(mock.patch.object(SESSION.os, "close", return_value=None))
            stack.enter_context(mock.patch.object(SESSION.os, "getpgrp", return_value=123))
            stack.enter_context(mock.patch.object(SESSION.os, "tcgetpgrp", return_value=123))
            stack.enter_context(mock.patch.object(SESSION.termios, "tcgetattr", side_effect=OSError("termios")))
            with self.assertRaises(SESSION.OperatorSessionError) as raised:
                SESSION._validate_tty_fd()
        self.assertEqual(raised.exception.reason, "tty_invalid")

    def test_validate_tty_fd_rejects_descriptor_replacement(self):
        tty_before = self._char_stat(inode=20)
        controlling = self._char_stat(inode=21)
        tty_after = self._char_stat(inode=22)
        with ExitStack() as stack:
            stack.enter_context(mock.patch.dict(SESSION.os.environ, {"TOC_OPERATOR_TTY_FD": "3"}))
            stack.enter_context(
                mock.patch.object(
                    SESSION.os, "fstat", side_effect=[tty_before, controlling, tty_after]
                )
            )
            stack.enter_context(mock.patch.object(SESSION.os, "isatty", return_value=True))
            stack.enter_context(mock.patch.object(SESSION.os, "open", return_value=4))
            stack.enter_context(mock.patch.object(SESSION.os, "close", return_value=None))
            stack.enter_context(mock.patch.object(SESSION.os, "getpgrp", return_value=123))
            stack.enter_context(mock.patch.object(SESSION.os, "tcgetpgrp", return_value=123))
            stack.enter_context(
                mock.patch.object(SESSION.termios, "tcgetattr", return_value=[0, 0, 0, 0, 0, 0, []])
            )
            with self.assertRaises(SESSION.OperatorSessionError) as raised:
                SESSION._validate_tty_fd()
        self.assertEqual(raised.exception.reason, "tty_invalid")

    def test_publication_fsync_failure_leaves_indeterminate_no_resume(self):
        with mock.patch.object(SESSION.os, "fsync", side_effect=OSError("planted")):
            with self.assertRaises(SESSION.OperatorSessionError) as raised:
                self.run_with_responses(self.responses())
        self.assertIn(raised.exception.reason, {"cleanup_indeterminate", "publication_failed"})
        if self.session_root.exists():
            self.assertFalse(any(path.name.startswith("resume-g") for path in self.session_root.iterdir()))

    def test_resume_recorder_rejects_non_generation_one(self):
        def fake_execute(_environment, _tty_fd, *, resume_recorder):
            resume_recorder(2, SHA_A, SHA_B)
            return 2, b"{}"

        with self.assertRaises(SESSION.OperatorSessionError) as raised:
            self.run_with_responses(
                self.responses(), execute_authoring_side_effect=fake_execute
            )
        self.assertEqual(raised.exception.reason, "internal_failure")
        self.assertTrue((self.session_root / "OPERATOR_SESSION_INDETERMINATE").exists())
        self.assertFalse(any(path.name.startswith("resume-g") for path in self.session_root.iterdir()))

    def test_contract_publication_failure_removes_pending_record(self):
        self.session_root.mkdir(mode=0o700)
        root_fd = os.open(
            self.session_root,
            os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0),
        )
        try:
            with mock.patch.object(
                SESSION, "_rename_no_replace", side_effect=capture_contract.ContractError("publication_exists")
            ):
                with self.assertRaises(SESSION.OperatorSessionError) as raised:
                    SESSION._publish_private_json_at(
                        root_fd,
                        "authorization-synthetic.json",
                        {"artifact_kind": "synthetic"},
                    )
            self.assertEqual(raised.exception.reason, "publication_failed")
            self.assertEqual(list(self.session_root.iterdir()), [])
        finally:
            os.close(root_fd)

    def test_tty_write_failure_before_authorization_creates_no_private_roots(self):
        capture_before = immutable_tree_snapshot(self.capture_root)
        with mock.patch.object(SESSION, "_tty_write", side_effect=SESSION.OperatorSessionError("tty_invalid")):
            with self.assertRaises(SESSION.OperatorSessionError) as raised:
                SESSION.run_session(9, self.bootstrap)
        self.assertEqual(raised.exception.reason, "tty_invalid")
        self.assertFalse(self.session_root.exists())
        self.assertFalse(self.annotation_root.exists())
        self.assertEqual(immutable_tree_snapshot(self.capture_root), capture_before)

    def test_malformed_count_input_rejects_before_private_roots_exist(self):
        responses = self.responses()
        responses[12] = "not-a-count"
        capture_before = immutable_tree_snapshot(self.capture_root)
        with self.assertRaises(SESSION.OperatorSessionError) as raised:
            self.run_with_responses(responses)
        self.assertEqual(raised.exception.reason, "input_invalid")
        self.assertFalse(self.session_root.exists())
        self.assertFalse(self.annotation_root.exists())
        self.assertEqual(immutable_tree_snapshot(self.capture_root), capture_before)

    def test_private_parent_mode_and_symlink_roots_reject(self):
        self.root.chmod(0o755)
        try:
            with self.assertRaises(SESSION.OperatorSessionError) as raised:
                self.run_with_responses(self.responses())
            self.assertEqual(raised.exception.reason, "input_invalid")
        finally:
            self.root.chmod(0o700)

        self.session_root.symlink_to(self.root)
        with self.assertRaises(SESSION.OperatorSessionError) as raised:
            self.run_with_responses(self.responses())
        self.assertIn(raised.exception.reason, {"history_conflict", "input_invalid"})

    def test_operator_launcher_uses_private_prompts_and_minimal_child_environment(self):
        fake = self.root / "fake-python"
        argument_ledger = self.root / "arguments.json"
        environment_ledger = self.root / "environment.json"
        stdin_ledger = self.root / "stdin.bin"
        fake.write_text(
            "#!/usr/bin/env python3\n"
            "import json, os, sys\n"
            f"open({str(argument_ledger)!r}, 'w', encoding='ascii').write(json.dumps(sys.argv))\n"
            f"open({str(environment_ledger)!r}, 'w', encoding='ascii').write(json.dumps(dict(os.environ), sort_keys=True))\n"
            f"open({str(stdin_ledger)!r}, 'wb').write(sys.stdin.buffer.read())\n"
            "sys.stderr.write('{\"diagnostic_version\":1,\"reason\":\"internal_failure\",\"stage\":\"annotation_operator_session\",\"status\":\"failed\"}\\n')\n"
            "raise SystemExit(1)\n",
            encoding="ascii",
        )
        fake.chmod(0o500)
        fake_sha = hashlib.sha256(fake.read_bytes()).hexdigest()
        replies = [
            os.fspath(fake),
            fake_sha,
            "cpython:3.12.9",
            GIT_A,
        ]
        exit_status, transcript = run_pty_command(
            LAUNCHER,
            replies,
            environment={
                "LANG": "C",
                "LC_ALL": "C",
                "TERM": "xterm-256color",
                "TOC_AUTHOR_CAPTURE_ROOT": os.fspath(self.capture_root),
                "TOC_AUTHOR_EXPECTED_OPAQUE_INDEX_SHA256": self.expectations.opaque_index_sha256,
            },
        )
        if b"/dev/tty: Operation not permitted" in transcript:
            self.skipTest("local sandbox denies /dev/tty for PTY launcher regression")
        self.assertEqual(exit_status, 1)
        self.assertIn(b"execution_python_absolute_path", transcript)
        arguments = json.loads(argument_ledger.read_text(encoding="ascii"))
        child_environment = json.loads(environment_ledger.read_text(encoding="ascii"))
        bootstrap = stdin_ledger.read_bytes()
        self.assertEqual(arguments[1:4], ["-I", "-S", "-B"])
        self.assertEqual(arguments[4], os.fspath(MIGRATION / "author-lovable-toc-operator-session.py"))
        self.assertIn(b"\0", bootstrap)
        for name in child_environment:
            self.assertFalse(name.startswith("TOC_AUTHOR_"), name)
        self.assertNotIn("PYTHONPATH", child_environment)
        self.assertNotIn("PYTHONSTARTUP", child_environment)
        for value in (
            os.fspath(self.capture_root),
            self.expectations.opaque_index_sha256,
            "synthetic-private-object",
        ):
            self.assertNotIn(value, json.dumps(arguments))
            self.assertNotIn(value, json.dumps(child_environment))
            self.assertNotIn(value.encode(), transcript)

    def test_launcher_rejects_asciinema_marker_for_all_terminal_identities(self):
        for term_program in ("Apple_Terminal", "iTerm.app"):
            with self.subTest(term_program=term_program):
                exit_status, transcript = run_pty_command(
                    LAUNCHER,
                    [],
                    environment={
                        "LANG": "C",
                        "LC_ALL": "C",
                        "TERM": "xterm-256color",
                        "TERM_PROGRAM": term_program,
                        "ASCIINEMA_REC": "1",
                    },
                )
                self.assertEqual(exit_status, 1)
                self.assertIn(b'"reason":"tty_invalid"', transcript)
                self.assertNotIn(b"execution_python_absolute_path", transcript)

    def test_launcher_rejects_every_startup_poison_variable_before_prompt(self):
        launcher_source = LAUNCHER.read_text(encoding="utf-8")
        for variable in LAUNCHER_POISON_VARIABLES:
            with self.subTest(variable=variable):
                self.assertIn(variable, launcher_source)
                environment = {
                    "LANG": "C",
                    "LC_ALL": "C",
                    "TERM": "xterm-256color",
                    variable: "",
                }
                if variable in {"BASH_ENV", "ENV"}:
                    marker = self.root / f"{variable}-sourced"
                    poison = self.root / f"{variable}-poison"
                    poison.write_text(
                        f"echo sourced > {str(marker)!r}\n",
                        encoding="ascii",
                    )
                    environment[variable] = os.fspath(poison)
                if variable in LOADER_EAGER_VARIABLES:
                    # glibc can consume these before the script interpreter
                    # starts.  Start a clean shell first, clear positional
                    # parameters, and prove the no-poison path reaches the TTY
                    # guard while the poison path reaches the launcher's
                    # pre-child rejection loop.
                    baseline = subprocess.run(
                        [
                            "/bin/sh",
                            "-c",
                            "launcher_path=$1; set --; . \"$launcher_path\"",
                            "sh",
                            os.fspath(LAUNCHER),
                        ],
                        env={
                            "LANG": "C",
                            "LC_ALL": "C",
                            "TERM": "xterm-256color",
                        },
                        check=False,
                        stdin=subprocess.DEVNULL,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        timeout=10,
                    )
                    self.assertEqual(baseline.returncode, 1)
                    self.assertEqual(baseline.stdout, b"")
                    self.assertEqual(json.loads(baseline.stderr)["reason"], "tty_invalid")
                    result = subprocess.run(
                        [
                            "/bin/sh",
                            "-c",
                            f"launcher_path=$1; set --; {variable}=x; export {variable}; . \"$launcher_path\"",
                            "sh",
                            os.fspath(LAUNCHER),
                        ],
                        env={
                            "LANG": "C",
                            "LC_ALL": "C",
                            "TERM": "xterm-256color",
                        },
                        check=False,
                        stdin=subprocess.DEVNULL,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        timeout=10,
                    )
                else:
                    result = subprocess.run(
                        [os.fspath(LAUNCHER)],
                        env=environment,
                        check=False,
                        stdin=subprocess.DEVNULL,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        timeout=10,
                    )
                self.assertEqual(result.returncode, 1)
                self.assertEqual(result.stdout, b"")
                if variable.startswith("DYLD_") and result.stderr == b"":
                    # Some macOS execution contexts consume or strip DYLD_PRINT_*
                    # before the POSIX shell can emit the launcher's diagnostic.
                    # The source-list assertion above still pins the checked-in
                    # rejection loop; observable DYLD_* values must take the
                    # startup rejection branch below.
                    continue
                try:
                    diagnostic = json.loads(result.stderr)
                except json.JSONDecodeError:
                    if variable.startswith("DYLD_"):
                        # Other macOS execution contexts let dyld consume the
                        # value and emit non-JSON loader diagnostics before the
                        # launcher can run.  This remains a platform-stripped
                        # source-list pin rather than a launcher-runtime proof.
                        continue
                    raise
                if variable.startswith("DYLD_") and diagnostic["reason"] == "tty_invalid":
                    # macOS SIP can strip DYLD_* variables before /bin/sh starts.
                    # The source-list assertion above still pins the reviewed
                    # rejection for hosts where the variable is observable.
                    pass
                else:
                    self.assertEqual(diagnostic["reason"], "startup_environment_invalid")
                self.assertNotIn(variable.encode("ascii"), result.stderr)
                if variable in {"BASH_ENV", "ENV"}:
                    self.assertFalse(marker.exists())

    def test_launcher_rejects_pythonpath_poison_before_private_prompt(self):
        exit_status, transcript = run_pty_command(
            LAUNCHER,
            [],
            environment={
                "LANG": "C",
                "LC_ALL": "C",
                "TERM": "xterm-256color",
                "PYTHONPATH": "SYNTHETIC_PYTHONPATH_POISON",
            },
        )
        self.assertEqual(exit_status, 1)
        self.assertIn(b'"reason":"startup_environment_invalid"', transcript)
        self.assertNotIn(b"execution_python_absolute_path", transcript)
        self.assertNotIn(b"SYNTHETIC_PYTHONPATH_POISON", transcript)

    def test_operator_component_rejects_direct_nonisolated_python(self):
        result = subprocess.run(
            [sys.executable, os.fspath(MIGRATION / "author-lovable-toc-operator-session.py")],
            check=False,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=10,
        )
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, b"")
        self.assertEqual(
            json.loads(result.stderr),
            {
                "diagnostic_version": 1,
                "reason": "startup_environment_invalid",
                "stage": "annotation_operator_session",
                "status": "failed",
            },
        )
        self.assertNotIn(b"Traceback", result.stderr)


def _wait_status(status: int) -> int:
    if os.WIFEXITED(status):
        return os.WEXITSTATUS(status)
    if os.WIFSIGNALED(status):
        return 128 + os.WTERMSIG(status)
    return 255


def run_pty_command(
    executable: Path, replies: list[str], *, environment: dict[str, str]
) -> tuple[int, bytes]:
    pid, master_fd = pty.fork()
    if pid == 0:
        try:
            os.execve(os.fspath(executable), [os.fspath(executable)], environment)
        except BaseException:
            os._exit(127)
    transcript = bytearray()
    reply_index = 0
    deadline = time.monotonic() + 15
    child_status: int | None = None
    try:
        while time.monotonic() < deadline:
            waited, status = os.waitpid(pid, os.WNOHANG)
            if waited == pid:
                child_status = status
            readable, _, _ = select.select([master_fd], [], [], 0.05)
            if readable:
                try:
                    chunk = os.read(master_fd, 8192)
                except OSError as exc:
                    if exc.errno == errno.EIO:
                        chunk = b""
                    else:
                        raise
                if chunk:
                    transcript.extend(chunk)
                    while reply_index < len(replies) and transcript.endswith(b": "):
                        os.write(master_fd, replies[reply_index].encode("utf-8") + b"\n")
                        reply_index += 1
                elif child_status is not None:
                    break
            elif child_status is not None:
                break
        if child_status is None:
            os.kill(pid, 9)
            _, child_status = os.waitpid(pid, 0)
            raise AssertionError("operator launcher synthetic PTY timed out")
        return _wait_status(child_status), bytes(transcript)
    finally:
        os.close(master_fd)


if __name__ == "__main__":
    unittest.main()
