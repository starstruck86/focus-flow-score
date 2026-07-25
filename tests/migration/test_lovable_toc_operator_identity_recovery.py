from __future__ import annotations

from contextlib import ExitStack
import copy
import hashlib
import json
import os
import socket
import stat
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "scripts" / "migration"
sys.path.insert(0, str(MIGRATION))

from lib import lovable_toc_contract as CONTRACT  # noqa: E402
from lib import lovable_toc_operator_identity_recovery as RECOVERY  # noqa: E402
import test_lovable_toc_operator_session as OPERATOR_TESTS  # noqa: E402


SESSION = OPERATOR_TESTS.SESSION
AUTHOR = SESSION.AUTHOR
make_capture_package = OPERATOR_TESTS.make_capture_package
immutable_tree_snapshot = OPERATOR_TESTS.immutable_tree_snapshot
ZERO64 = "0" * 64
PRIVATE_IDENTITY = "Private Primary Sentinel"
PRIVATE_SENTINELS = (
    PRIVATE_IDENTITY.encode("ascii"),
    b"raw-pg-restore-list.toc",
    b"opaque-index.json",
    b"opaque-id.key",
    b"synthetic-private-object",
    b"synthetic-private-sql",
    b"synthetic-private-payload",
)


def canonical(value) -> bytes:
    return CONTRACT.canonical_json_bytes(value)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def write_private_json(path: Path, value) -> bytes:
    data = canonical(value)
    descriptor = os.open(
        path,
        os.O_WRONLY
        | os.O_CREAT
        | os.O_EXCL
        | getattr(os, "O_CLOEXEC", 0)
        | getattr(os, "O_NOFOLLOW", 0),
        0o400,
    )
    try:
        offset = 0
        while offset < len(data):
            offset += os.write(descriptor, data[offset:])
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    return data


class SyntheticGenerationOne:
    """A current-format, entirely synthetic pristine generation-one chain."""

    def __init__(self, object_classes: list[str] | None = None) -> None:
        self.temporary = tempfile.TemporaryDirectory(
            prefix="toc-identity-recovery."
        )
        self.base = Path(self.temporary.name).resolve()
        self.base.chmod(0o700)
        self.capture_root = self.base / "capture-root"
        selected_classes = object_classes or ["TABLE", "TABLE DATA"]
        self.package, self.expectations, _capture, _entries = (
            make_capture_package(
                self.capture_root,
                selected_classes,
                run_id="synthetic-recovery-run",
            )
        )
        self.operator_root = self.base / "operator-session-root"
        self.annotation_root = self.base / "annotation-root"
        self.audit_root = self.base / "recovery-audit-root"
        self.operator_root.mkdir(mode=0o700)
        self.annotation_root.mkdir(mode=0o700)
        self.audit_root.mkdir(mode=0o700)
        self.checkpoints = self.annotation_root / AUTHOR.CHECKPOINTS_NAME
        self.checkpoints.mkdir(mode=0o700)
        self.profile = json.loads(
            (
                MIGRATION
                / "verification"
                / "lovable-toc-operator-identity-recovery-profile.v1.json"
            ).read_text(encoding="ascii")
        )
        self.bridge = self.profile["recovery_contract"]["historical_binding"]
        self.historical_python_identity = "9" * 64
        self.release_token = "8" * 64

        package_fd = os.open(
            self.package,
            os.O_RDONLY
            | getattr(os, "O_DIRECTORY", 0)
            | getattr(os, "O_CLOEXEC", 0)
            | getattr(os, "O_NOFOLLOW", 0),
        )
        try:
            capture = AUTHOR.load_capture_for_authoring(
                package_fd, self.expectations
            )
        finally:
            os.close(package_fd)
        historical_binding = AUTHOR.AuthoringBinding(
            execution_checkout_sha=self.bridge["execution_checkout_sha"],
            procedure_identity_sha256=self.bridge[
                "authoring_procedure_identity_sha256"
            ],
            execution_python_identity_sha256=self.bridge["python"]["sha256"],
        )
        self.checkpoint = AUTHOR.initialize_checkpoint(
            capture,
            historical_binding,
            PRIVATE_IDENTITY,
            "synthetic-authoring-session",
        )
        self.root = {
            "action": "initialize",
            "annotation_root": os.fspath(self.annotation_root),
            "artifact_kind": SESSION.AUTHORIZATION_KIND,
            "authoring_session_identity": "synthetic-authoring-session",
            "capture": {
                "approved_pg_restore_sha256": self.expectations.approved_pg_restore_sha256,
                "capture_execution_checkout_sha": self.expectations.capture_execution_checkout_sha,
                "capture_manifest_sha256": self.expectations.capture_manifest_sha256,
                "capture_name": self.package.name,
                "capture_procedure_identity_sha256": self.expectations.capture_procedure_identity_sha256,
                "capture_root": os.fspath(self.capture_root),
                "data_reference_count": self.expectations.data_reference_count,
                "entry_count": self.expectations.entry_count,
                "evidence_manifest_sha256": self.expectations.evidence_manifest_sha256,
                "evidence_run_id": self.expectations.evidence_run_id,
                "inner_sha256": self.expectations.inner_archive_sha256,
                "inspection_checkout_sha": self.expectations.inspection_checkout_sha,
                "inspection_procedure_sha256": self.expectations.inspection_procedure_sha256,
                "opaque_index_sha256": self.expectations.opaque_index_sha256,
                "outer_sha256": self.expectations.outer_archive_sha256,
                "raw_toc_sha256": self.expectations.raw_toc_sha256,
            },
            "execution": {
                "approved_checkout_sha": self.bridge["execution_checkout_sha"],
                "approved_operator_session_procedure_identity_sha256": self.bridge[
                    "operator_session_procedure_identity_sha256"
                ],
                "approved_procedure_identity_sha256": self.bridge[
                    "authoring_procedure_identity_sha256"
                ],
                "python": {
                    "path": self.bridge["python"]["absolute_path"],
                    "sha256": self.bridge["python"]["sha256"],
                    "version": self.bridge["python"]["reported_version"],
                },
            },
            "finalization_authorization": "",
            "format_version": 1,
            "initial_head": {
                "checkpoint_sha256": ZERO64,
                "generation": 0,
                "release_token": ZERO64,
            },
            "operator_identity": PRIVATE_IDENTITY,
            "primary_operator_identity": PRIVATE_IDENTITY,
            "session_id": "synthetic-operator-session",
            "session_root": os.fspath(self.operator_root),
            "tty_attestation": RECOVERY.TTY_ATTESTATION,
        }
        self.resume = {
            "annotation_root": os.fspath(self.annotation_root),
            "artifact_kind": SESSION.RESUME_KIND,
            "authorization_sha256": ZERO64,
            "authoring_session_identity": "synthetic-authoring-session",
            "capture": {
                "capture_manifest_sha256": self.expectations.capture_manifest_sha256,
                "evidence_run_id": self.expectations.evidence_run_id,
                "opaque_index_sha256": self.expectations.opaque_index_sha256,
                "raw_toc_sha256": self.expectations.raw_toc_sha256,
            },
            "execution_checkout_sha": self.bridge["execution_checkout_sha"],
            "format_version": 2,
            "operator_session_procedure_identity_sha256": self.bridge[
                "operator_session_procedure_identity_sha256"
            ],
            "primary_operator_identity": PRIVATE_IDENTITY,
            "procedure_identity_sha256": self.bridge[
                "authoring_procedure_identity_sha256"
            ],
            "python_identity_sha256": self.historical_python_identity,
            "resume_checkpoint_sha256": ZERO64,
            "resume_generation": 1,
            "resume_release_token": self.release_token,
        }
        released = self.annotation_root / AUTHOR.RELEASED_NAME
        released.write_bytes(AUTHOR._lock_content(self.release_token))
        released.chmod(0o400)
        self.approval = {
            "accepted_ceilings": list(RECOVERY.ACCEPTED_CEILINGS),
            "allowed_disclosure": RECOVERY.ALLOWED_DISCLOSURE,
            "annotation_root_path": os.fspath(self.annotation_root),
            "approved_checkout_sha": "5" * 40,
            "artifact_kind": RECOVERY.RECOVERY_APPROVAL_KIND,
            "authorizer_identity": "Synthetic Authorizer",
            "capture_root_path": os.fspath(self.capture_root),
            "executing_operator_identity": "Synthetic Executor",
            "expected_chain": {},
            "format_version": 1,
            "independent_reviewer_identity": "Independent Human Reviewer",
            "local_tty_attestation": RECOVERY.TTY_ATTESTATION,
            "no_retry_acknowledgement": RECOVERY.NO_RETRY_ACKNOWLEDGEMENT,
            "operator_session_root_path": os.fspath(self.operator_root),
            "ordinary_execution_approval": {
                "approved_checkout_sha": "5" * 40,
                "filename": "synthetic-ordinary-approval.json",
                "sha256": "1" * 64,
            },
            "python_identity": {},
            "recovery_evidence_root_path": os.fspath(self.audit_root),
            "recovery_profile": {"format_version": 1, "sha256": "2" * 64},
            "recovery_procedure_identity_sha256": "3" * 64,
            "recovery_session": {
                "expires_at_utc": "2099-01-01T00:00:00Z",
                "metadata_session_id": "synthetic-recovery-session",
                "nonce": "4" * 64,
            },
            "repository": {
                "name": "focus-flow-score",
                "owner": "starstruck86",
            },
            "review_reference": "synthetic-reviewed-recovery",
            "reviewed_file_blobs": {},
            "trust_model_acknowledgement": RECOVERY.TRUST_ACKNOWLEDGEMENT,
            "tty_binding": {"device": 1, "inode": 1},
        }
        self.rewrite()

    def close(self) -> None:
        self.temporary.cleanup()

    def rewrite(self) -> None:
        for child in list(self.checkpoints.iterdir()):
            child.unlink()
        for child in list(self.operator_root.iterdir()):
            child.unlink()

        checkpoint_data = canonical(self.checkpoint)
        checkpoint_sha = sha(checkpoint_data)
        checkpoint_name = (
            "checkpoint-g0000000000000001-" + checkpoint_sha + ".json"
        )
        write_private_json(self.checkpoints / checkpoint_name, self.checkpoint)

        root_data = canonical(self.root)
        root_sha = sha(root_data)
        root_name = "authorization-root-" + root_sha[:16] + ".json"
        write_private_json(self.operator_root / root_name, self.root)

        self.resume["authorization_sha256"] = root_sha
        self.resume["resume_checkpoint_sha256"] = checkpoint_sha
        resume_data = canonical(self.resume)
        resume_sha = sha(resume_data)
        resume_name = (
            SESSION.CURRENT_RESUME_PREFIX
            + "0000000000000001-"
            + checkpoint_sha
            + ".json"
        )
        write_private_json(self.operator_root / resume_name, self.resume)
        self.root_name = root_name
        self.resume_name = resume_name
        self.checkpoint_name = checkpoint_name
        self.approval["expected_chain"] = {
            "checkpoint": {"format_version": 1, "sha256": checkpoint_sha},
            "generation": 1,
            "resume": {
                "format_version": 2,
                "predecessor": "absent",
                "sha256": resume_sha,
            },
            "root_authorization": {
                "format_version": 1,
                "sha256": root_sha,
            },
            "state": RECOVERY.EXPECTED_STATE,
        }
        self.verified = RECOVERY.RecoveryVerified(
            approval=self.approval,
            approval_name="synthetic-recovery-approval.json",
            approval_sha256="6" * 64,
            ordinary=types.SimpleNamespace(
                approved_checkout_sha="5" * 40,
                operator_session_root_path=os.fspath(self.operator_root),
            ),
            profile=self.profile,
            profile_sha256="2" * 64,
            procedure_identity_sha256="3" * 64,
            repository_root=os.fspath(ROOT),
            historical_python_identity_sha256=self.historical_python_identity,
        )

    def reset_audit(self) -> None:
        for child in list(self.audit_root.iterdir()):
            child.unlink()

    def ordinary_snapshot(self):
        return (
            immutable_tree_snapshot(self.operator_root),
            immutable_tree_snapshot(self.annotation_root),
            immutable_tree_snapshot(self.capture_root),
        )

    def audit_bytes(self) -> bytes:
        return b"".join(
            child.read_bytes()
            for child in sorted(self.audit_root.iterdir())
            if child.is_file()
        )


class RecoveryTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.fixture = SyntheticGenerationOne()

    def tearDown(self) -> None:
        self.fixture.close()

    def run_recovery(
        self,
        *,
        hidden: list[str] | None = None,
        extra_patches=(),
    ):
        writes: list[bytes] = []
        answers = iter(hidden or [PRIVATE_IDENTITY, "operator_identity_recorded"])

        def read_hidden(_fd: int, _prompt: bytes, **_kwargs) -> str:
            try:
                return next(answers)
            except StopIteration as exc:
                raise EOFError("planted-private-eof-sentinel") from exc

        with ExitStack() as stack:
            stack.enter_context(
                mock.patch.object(
                    RECOVERY, "_verify_approved_tty", return_value=None
                )
            )
            stack.enter_context(
                mock.patch.object(
                    RECOVERY, "_tty_write", side_effect=lambda _fd, data: writes.append(data)
                )
            )
            stack.enter_context(
                mock.patch.object(RECOVERY, "_read_hidden", side_effect=read_hidden)
            )
            stack.enter_context(
                mock.patch.object(
                    RECOVERY,
                    "_clear_private_tty",
                    side_effect=lambda _fd: writes.append(b"\x1b[2J\x1b[H"),
                )
            )
            for patcher in extra_patches:
                stack.enter_context(patcher)
            result = RECOVERY.run_recovery(9, self.fixture.verified, SESSION)
        return result, writes

    def assert_fixed_failure(self, callback, reason: str = "history_conflict"):
        with self.assertRaises(RECOVERY.RecoveryError) as raised:
            callback()
        self.assertEqual(raised.exception.reason, reason)
        return raised.exception


class SuccessfulRecoveryTest(RecoveryTestCase):
    def test_exact_generation_one_recovery_is_read_only_and_audited(self):
        before = self.fixture.ordinary_snapshot()
        original_open = os.open
        original_lstat = os.lstat
        original_stat = os.stat
        original_listdir = os.listdir
        capture_path = os.fspath(self.fixture.capture_root)

        def reject_capture_path(path) -> None:
            if isinstance(path, (str, bytes, os.PathLike)):
                decoded = os.fsdecode(path)
                if os.path.isabs(decoded) and (
                    decoded == capture_path
                    or decoded.startswith(capture_path + os.sep)
                ):
                    raise AssertionError("capture access attempted")

        def forbid_capture_open(path, *args, **kwargs):
            reject_capture_path(path)
            return original_open(path, *args, **kwargs)

        def forbid_capture_lstat(path, *args, **kwargs):
            reject_capture_path(path)
            return original_lstat(path, *args, **kwargs)

        def forbid_capture_stat(path, *args, **kwargs):
            reject_capture_path(path)
            return original_stat(path, *args, **kwargs)

        def forbid_capture_listdir(path):
            reject_capture_path(path)
            return original_listdir(path)

        forbidden = [
            mock.patch.object(RECOVERY.os, "open", side_effect=forbid_capture_open),
            mock.patch.object(
                RECOVERY.os, "lstat", side_effect=forbid_capture_lstat
            ),
            mock.patch.object(
                RECOVERY.os, "stat", side_effect=forbid_capture_stat
            ),
            mock.patch.object(
                RECOVERY.os, "listdir", side_effect=forbid_capture_listdir
            ),
            mock.patch.object(
                AUTHOR,
                "execute_authoring",
                side_effect=AssertionError("authoring dispatch attempted"),
            ),
            mock.patch.object(
                SESSION,
                "_run_resume_session",
                side_effect=AssertionError("ordinary action dispatch attempted"),
            ),
            mock.patch.object(
                socket,
                "socket",
                side_effect=AssertionError("network attempted"),
            ),
            mock.patch.object(
                subprocess,
                "run",
                side_effect=AssertionError("subprocess attempted"),
            ),
            mock.patch.object(
                os,
                "system",
                side_effect=AssertionError("runtime command attempted"),
            ),
        ]
        (status, diagnostic), tty_writes = self.run_recovery(
            extra_patches=forbidden
        )
        self.assertEqual(status, 0)
        self.assertEqual(
            diagnostic,
            RECOVERY._fixed("pass", "recovery_completed"),
        )
        self.assertEqual(self.fixture.ordinary_snapshot(), before)
        self.assertNotIn(RECOVERY.LOCK_NAME, os.listdir(self.fixture.operator_root))
        self.assertNotIn(
            "OPERATOR_SESSION_INDETERMINATE",
            os.listdir(self.fixture.operator_root),
        )
        audit_names = sorted(path.name for path in self.fixture.audit_root.iterdir())
        self.assertEqual(
            audit_names,
            [
                "0001-attempt_started-synthetic-recovery-session.json",
                "0002-identity_acknowledged-synthetic-recovery-session.json",
                "0003-recovery_completed-synthetic-recovery-session.json",
            ],
        )
        records = [
            json.loads((self.fixture.audit_root / name).read_text(encoding="ascii"))
            for name in audit_names
        ]
        self.assertIsNone(records[0]["previous_recovery_record_sha256"])
        self.assertEqual(
            records[1]["previous_recovery_record_sha256"],
            sha((self.fixture.audit_root / audit_names[0]).read_bytes()),
        )
        self.assertEqual(
            records[2]["previous_recovery_record_sha256"],
            sha((self.fixture.audit_root / audit_names[1]).read_bytes()),
        )
        self.assertEqual(
            [record["audit_event"] for record in records],
            ["attempt_started", "identity_acknowledged", "recovery_completed"],
        )
        self.assertEqual(
            [record["identity_sources_agree"] for record in records],
            [False, True, True],
        )
        self.assertTrue(
            all(
                record["human_roles"]
                == {
                    "authorizer": "bound_by_recovery_approval",
                    "executing_operator": "bound_by_recovery_approval",
                    "independent_reviewer": "bound_by_recovery_approval",
                    "independent_reviewer_distinct": True,
                }
                for record in records
            )
        )
        audit_data = self.fixture.audit_bytes()
        self.assertNotIn(PRIVATE_IDENTITY.encode("ascii"), audit_data)
        self.assertIn(
            b"stored_primary_operator_identity: " + PRIVATE_IDENTITY.encode("ascii"),
            b"".join(tty_writes),
        )
        for sentinel in PRIVATE_SENTINELS[1:]:
            self.assertNotIn(sentinel, audit_data)
            self.assertNotIn(sentinel, diagnostic)

    def test_recovery_never_puts_private_identity_in_public_channels(self):
        stdout = bytearray()
        stderr = bytearray()
        with mock.patch.object(
            RECOVERY.sys,
            "argv",
            ["recover-lovable-toc-operator-identity.py"],
        ), mock.patch.dict(
            os.environ,
            {"LANG": "C", "LC_ALL": "C"},
            clear=True,
        ):
            (status, diagnostic), tty_writes = self.run_recovery()
            stdout.extend(diagnostic)
        self.assertEqual(status, 0)
        public = bytes(stdout + stderr)
        self.assertNotIn(PRIVATE_IDENTITY.encode("ascii"), public)
        self.assertNotIn(PRIVATE_IDENTITY, repr(sys.argv))
        self.assertNotIn(PRIVATE_IDENTITY, repr(dict(os.environ)))
        self.assertIn(PRIVATE_IDENTITY.encode("ascii"), b"".join(tty_writes))
        self.assertNotIn(PRIVATE_IDENTITY.encode("ascii"), self.fixture.audit_bytes())

    def test_realistic_2354_entry_checkpoint_is_accepted_without_capture_reads(self):
        fixture = SyntheticGenerationOne(
            ["TABLE DATA"] * 214 + ["TABLE"] * (2354 - 214)
        )
        try:
            checkpoint_size = (
                fixture.checkpoints / fixture.checkpoint_name
            ).stat().st_size
            self.assertGreater(checkpoint_size, 1024 * 1024)
            before = fixture.ordinary_snapshot()
            writes: list[bytes] = []
            answers = iter([PRIVATE_IDENTITY, "operator_identity_recorded"])
            original_open = os.open
            capture_path = os.fspath(fixture.capture_root)

            def forbid_capture_open(path, *args, **kwargs):
                if isinstance(path, (str, bytes, os.PathLike)):
                    decoded = os.fsdecode(path)
                    if os.path.isabs(decoded) and (
                        decoded == capture_path
                        or decoded.startswith(capture_path + os.sep)
                    ):
                        raise AssertionError("capture access attempted")
                return original_open(path, *args, **kwargs)

            with mock.patch.object(
                RECOVERY, "_verify_approved_tty", return_value=None
            ), mock.patch.object(
                RECOVERY, "_tty_write", side_effect=lambda _fd, data: writes.append(data)
            ), mock.patch.object(
                RECOVERY,
                "_read_hidden",
                side_effect=lambda *_args, **_kwargs: next(answers),
            ), mock.patch.object(
                RECOVERY, "_clear_private_tty", return_value=None
            ), mock.patch.object(
                RECOVERY.os, "open", side_effect=forbid_capture_open
            ):
                status, diagnostic = RECOVERY.run_recovery(
                    9, fixture.verified, SESSION
                )
            self.assertEqual(status, 0)
            self.assertEqual(
                diagnostic, RECOVERY._fixed("pass", "recovery_completed")
            )
            self.assertEqual(fixture.ordinary_snapshot(), before)
            self.assertNotIn(
                PRIVATE_IDENTITY.encode("ascii"), fixture.audit_bytes()
            )
        finally:
            fixture.close()


class ChainMismatchTest(RecoveryTestCase):
    def test_every_identity_source_must_agree(self):
        cases = (
            ("root_operator", lambda f: f.root.__setitem__("operator_identity", "Different")),
            (
                "root_primary",
                lambda f: f.root.__setitem__(
                    "primary_operator_identity", "Different"
                ),
            ),
            (
                "resume_primary",
                lambda f: f.resume.__setitem__(
                    "primary_operator_identity", "Different"
                ),
            ),
            (
                "checkpoint_primary",
                lambda f: f.checkpoint.__setitem__(
                    "primary_operator_identity", "Different"
                ),
            ),
            (
                "event_operator",
                lambda f: f.checkpoint["event"].__setitem__(
                    "operator_identity", "Different"
                ),
            ),
        )
        for label, mutate in cases:
            with self.subTest(label=label):
                fixture = SyntheticGenerationOne()
                try:
                    mutate(fixture)
                    fixture.rewrite()
                    before = fixture.ordinary_snapshot()
                    with mock.patch.object(
                        RECOVERY, "_verify_approved_tty", return_value=None
                    ):
                        self.assert_fixed_failure(
                            lambda: RECOVERY.run_recovery(
                                9, fixture.verified, SESSION
                            )
                        )
                    self.assertEqual(fixture.ordinary_snapshot(), before)
                    self.assertNotIn(
                        PRIVATE_IDENTITY.encode("ascii"), fixture.audit_bytes()
                    )
                finally:
                    fixture.close()

    def test_wrong_generation_predecessor_and_execution_bindings_fail(self):
        cases = (
            (
                "generation",
                lambda f: f.resume.__setitem__("resume_generation", 2),
            ),
            (
                "predecessor",
                lambda f: f.resume.__setitem__(
                    "predecessor",
                    {
                        "action": "primary_review",
                        "action_authorization_sha256": "a" * 64,
                        "resume_name": f.resume_name,
                        "resume_sha256": "b" * 64,
                    },
                ),
            ),
            (
                "wrong_checkout",
                lambda f: f.resume.__setitem__("execution_checkout_sha", "a" * 40),
            ),
            (
                "wrong_authoring_procedure",
                lambda f: f.resume.__setitem__("procedure_identity_sha256", "a" * 64),
            ),
            (
                "wrong_session_procedure",
                lambda f: f.resume.__setitem__(
                    "operator_session_procedure_identity_sha256", "a" * 64
                ),
            ),
            (
                "wrong_python",
                lambda f: f.resume.__setitem__("python_identity_sha256", "a" * 64),
            ),
        )
        for label, mutate in cases:
            with self.subTest(label=label):
                fixture = SyntheticGenerationOne()
                try:
                    mutate(fixture)
                    fixture.rewrite()
                    before = fixture.ordinary_snapshot()
                    with mock.patch.object(
                        RECOVERY, "_verify_approved_tty", return_value=None
                    ):
                        self.assert_fixed_failure(
                            lambda: RECOVERY.run_recovery(
                                9, fixture.verified, SESSION
                            )
                        )
                    self.assertEqual(fixture.ordinary_snapshot(), before)
                finally:
                    fixture.close()

    def test_wrong_authoring_state_is_rejected(self):
        before = self.fixture.ordinary_snapshot()
        with mock.patch.object(
            RECOVERY.AUTHORING,
            "aggregate_status",
            return_value={"authoring_state": "RELATIONSHIP_REVIEW_REQUIRED"},
        ), mock.patch.object(
            RECOVERY, "_verify_approved_tty", return_value=None
        ):
            self.assert_fixed_failure(
                lambda: RECOVERY.run_recovery(
                    9, self.fixture.verified, SESSION
                ),
                "history_conflict",
            )
        self.assertEqual(self.fixture.ordinary_snapshot(), before)

    def test_duplicate_fork_unexpected_lock_and_indeterminate_fail_closed(self):
        mutations = (
            (
                "fork",
                lambda f: write_private_json(
                    f.operator_root
                    / (
                        SESSION.CURRENT_RESUME_PREFIX
                        + "0000000000000001-"
                        + "a" * 64
                        + ".json"
                    ),
                    f.resume,
                ),
            ),
            (
                "unexpected",
                lambda f: write_private_json(
                    f.operator_root / "unexpected-private-record.json",
                    {"synthetic": True},
                ),
            ),
            (
                "existing_lock",
                lambda f: (
                    f.operator_root / RECOVERY.LOCK_NAME
                ).write_bytes(b"OPERATOR_SESSION_LOCK_V1 " + b"a" * 64 + b"\n"),
            ),
            (
                "indeterminate",
                lambda f: (
                    f.operator_root / "OPERATOR_SESSION_INDETERMINATE"
                ).write_bytes(b"synthetic\n"),
            ),
        )
        for label, mutate in mutations:
            with self.subTest(label=label):
                fixture = SyntheticGenerationOne()
                try:
                    mutate(fixture)
                    for path in fixture.operator_root.iterdir():
                        if path.is_file():
                            path.chmod(0o400)
                    before = fixture.ordinary_snapshot()
                    with mock.patch.object(
                        RECOVERY, "_verify_approved_tty", return_value=None
                    ):
                        self.assert_fixed_failure(
                            lambda: RECOVERY.run_recovery(
                                9, fixture.verified, SESSION
                            )
                        )
                    self.assertEqual(fixture.ordinary_snapshot(), before)
                finally:
                    fixture.close()

    def test_symlink_and_path_replacement_are_rejected(self):
        resume = self.fixture.operator_root / self.fixture.resume_name
        target = self.fixture.base / "outside-resume"
        target.write_bytes(resume.read_bytes())
        target.chmod(0o400)
        resume.unlink()
        resume.symlink_to(target)
        before = self.fixture.ordinary_snapshot()
        with mock.patch.object(
            RECOVERY, "_verify_approved_tty", return_value=None
        ):
            self.assert_fixed_failure(
                lambda: RECOVERY.run_recovery(
                    9, self.fixture.verified, SESSION
                ),
                "history_conflict",
            )
        self.assertEqual(self.fixture.ordinary_snapshot(), before)

        self.fixture.close()
        self.fixture = SyntheticGenerationOne()
        original_load = RECOVERY._load_generation_one
        moved = self.fixture.base / "operator-session-replaced"

        def replace_after_load(*args, **kwargs):
            snapshot = original_load(*args, **kwargs)
            self.fixture.operator_root.rename(moved)
            self.fixture.operator_root.mkdir(mode=0o700)
            return snapshot

        with mock.patch.object(
            RECOVERY, "_verify_approved_tty", return_value=None
        ), mock.patch.object(
            RECOVERY, "_load_generation_one", side_effect=replace_after_load
        ):
            self.assert_fixed_failure(
                lambda: RECOVERY.run_recovery(
                    9, self.fixture.verified, SESSION
                ),
                "indeterminate",
            )

    def test_named_checkpoints_directory_replacement_blocks_disclosure(self):
        original_load = RECOVERY._load_generation_one
        moved = self.fixture.annotation_root / "checkpoints-replaced"
        tty_writes: list[bytes] = []

        def replace_named_checkpoints(*args, **kwargs):
            snapshot = original_load(*args, **kwargs)
            self.fixture.checkpoints.rename(moved)
            self.fixture.checkpoints.mkdir(mode=0o700)
            return snapshot

        with mock.patch.object(
            RECOVERY, "_verify_approved_tty", return_value=None
        ), mock.patch.object(
            RECOVERY, "_load_generation_one", side_effect=replace_named_checkpoints
        ), mock.patch.object(
            RECOVERY,
            "_tty_write",
            side_effect=lambda _fd, payload: tty_writes.append(payload),
        ), mock.patch.object(
            RECOVERY,
            "_read_hidden",
            side_effect=AssertionError("private prompt reached after directory swap"),
        ):
            self.assert_fixed_failure(
                lambda: RECOVERY.run_recovery(
                    9, self.fixture.verified, SESSION
                ),
                "indeterminate",
            )

        self.assertNotIn(PRIVATE_IDENTITY.encode("ascii"), b"".join(tty_writes))
        self.assertNotIn(PRIVATE_IDENTITY.encode("ascii"), self.fixture.audit_bytes())
        self.assertIn(RECOVERY.LOCK_NAME, os.listdir(self.fixture.operator_root))

    def test_wrong_modes_and_hardlinks_are_rejected_without_disclosure(self):
        cases = ("resume_mode", "resume_hardlink", "checkpoint_mode")
        for label in cases:
            with self.subTest(label=label):
                fixture = SyntheticGenerationOne()
                try:
                    if label == "resume_mode":
                        (
                            fixture.operator_root / fixture.resume_name
                        ).chmod(0o600)
                    elif label == "resume_hardlink":
                        os.link(
                            fixture.operator_root / fixture.resume_name,
                            fixture.base / "outside-resume-hardlink",
                        )
                    else:
                        (
                            fixture.checkpoints / fixture.checkpoint_name
                        ).chmod(0o600)
                    before = fixture.ordinary_snapshot()
                    with mock.patch.object(
                        RECOVERY, "_verify_approved_tty", return_value=None
                    ), mock.patch.object(
                        RECOVERY,
                        "_tty_write",
                        side_effect=AssertionError("identity disclosure attempted"),
                    ):
                        self.assert_fixed_failure(
                            lambda: RECOVERY.run_recovery(
                                9, fixture.verified, SESSION
                            )
                        )
                    self.assertEqual(fixture.ordinary_snapshot(), before)
                    self.assertNotIn(
                        PRIVATE_IDENTITY.encode("ascii"), fixture.audit_bytes()
                    )
                finally:
                    fixture.close()


class AuthorizationAndApprovalTest(RecoveryTestCase):
    def test_challenge_and_exact_phrase_are_invocation_bound(self):
        first_invocation_nonce = b"A" * RECOVERY.INVOCATION_NONCE_BYTES
        second_invocation_nonce = b"B" * RECOVERY.INVOCATION_NONCE_BYTES
        base_challenge = RECOVERY._challenge(
            self.fixture.verified, first_invocation_nonce
        )
        self.assertNotEqual(
            base_challenge,
            RECOVERY._challenge(
                self.fixture.verified, second_invocation_nonce
            ),
        )
        variants = []
        for field in ("approval", "nonce", "session"):
            approval = copy.deepcopy(self.fixture.approval)
            approval_sha = self.fixture.verified.approval_sha256
            if field == "approval":
                approval_sha = "f" * 64
            elif field == "nonce":
                approval["recovery_session"]["nonce"] = "e" * 64
            else:
                approval["recovery_session"][
                    "metadata_session_id"
                ] = "another-recovery-session"
            variants.append(
                RECOVERY._challenge(
                    RECOVERY.RecoveryVerified(
                        approval=approval,
                        approval_name=self.fixture.verified.approval_name,
                        approval_sha256=approval_sha,
                        ordinary=self.fixture.verified.ordinary,
                        profile=self.fixture.verified.profile,
                        profile_sha256=self.fixture.verified.profile_sha256,
                        procedure_identity_sha256=self.fixture.verified.procedure_identity_sha256,
                        repository_root=self.fixture.verified.repository_root,
                        historical_python_identity_sha256=self.fixture.verified.historical_python_identity_sha256,
                    ),
                    first_invocation_nonce,
                )
            )
        self.assertTrue(all(item != base_challenge for item in variants))
        phrase = "AUTHORIZE RECOVER_OPERATOR_IDENTITY " + base_challenge
        writes: list[bytes] = []
        with mock.patch.object(
            RECOVERY.PREFLIGHT, "verify_tty", return_value=None
        ), mock.patch.object(
            RECOVERY,
            "_tty_write",
            side_effect=lambda _fd, payload: writes.append(payload),
        ), mock.patch.object(
            RECOVERY, "_read_hidden", return_value=phrase
        ):
            RECOVERY.authorize_consequence(
                9,
                self.fixture.verified,
                invocation_nonce=first_invocation_nonce,
            )
        self.assertIn(phrase.encode("ascii"), b"".join(writes))
        self.assertEqual(os.listdir(self.fixture.audit_root), [])

    def test_stale_or_wrong_consequence_phrase_performs_zero_private_operations(self):
        calls: list[str] = []
        first_invocation_nonce = b"A" * RECOVERY.INVOCATION_NONCE_BYTES
        second_invocation_nonce = b"B" * RECOVERY.INVOCATION_NONCE_BYTES
        stale_phrase = (
            "AUTHORIZE RECOVER_OPERATOR_IDENTITY "
            + RECOVERY._challenge(
                self.fixture.verified, first_invocation_nonce
            )
        )
        before = self.fixture.ordinary_snapshot()
        audit_before = immutable_tree_snapshot(self.fixture.audit_root)

        def private_operation(label):
            def planted(*_args, **_kwargs):
                calls.append(label)
                raise AssertionError("private operation attempted")

            return planted

        private_patches = [
            mock.patch.object(
                RECOVERY,
                "_open_private_directory",
                side_effect=private_operation("open_private_directory"),
            ),
            *[
                mock.patch.object(
                    RECOVERY.os,
                    name,
                    side_effect=private_operation(name),
                )
                for name in (
                    "open",
                    "stat",
                    "lstat",
                    "listdir",
                    "read",
                    "write",
                    "rename",
                    "fsync",
                    "mkdir",
                    "unlink",
                )
            ],
        ]
        with ExitStack() as stack:
            stack.enter_context(
                mock.patch.object(
                    RECOVERY.PREFLIGHT, "verify_tty", return_value=None
                )
            )
            stack.enter_context(
                mock.patch.object(RECOVERY, "_tty_write", return_value=None)
            )
            stack.enter_context(
                mock.patch.object(
                    RECOVERY, "_read_hidden", return_value=stale_phrase
                )
            )
            for patcher in private_patches:
                stack.enter_context(patcher)
            self.assert_fixed_failure(
                lambda: RECOVERY.authorize_consequence(
                    9,
                    self.fixture.verified,
                    invocation_nonce=second_invocation_nonce,
                ),
                "authorization_failed",
            )
        self.assertEqual(calls, [])
        self.assertEqual(self.fixture.ordinary_snapshot(), before)
        self.assertEqual(
            immutable_tree_snapshot(self.fixture.audit_root), audit_before
        )

    def test_ordinary_approval_alone_cannot_pass_recovery_preflight(self):
        launcher = MIGRATION / "run-lovable-toc-operator-identity-recovery.sh"
        ordinary_launcher = (
            MIGRATION / "run-lovable-toc-annotation-operator-session.sh"
        )
        checkout = subprocess.run(
            ["/usr/bin/git", "rev-parse", "HEAD"],
            cwd=ROOT,
            check=True,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        ).stdout.strip()
        ordinary = types.SimpleNamespace(
            repository_root=os.fspath(ROOT),
            approved_checkout_sha=checkout,
            profile={"python_policy": self.fixture.profile["python_policy"]},
        )
        profile_data = canonical(self.fixture.profile)
        load_recovery = mock.Mock(
            side_effect=RECOVERY.RecoveryError("approval_missing")
        )
        with mock.patch.object(
            RECOVERY.PREFLIGHT,
            "verify_pre_private",
            return_value=ordinary,
        ), mock.patch.object(
            RECOVERY.PREFLIGHT,
            "repository_root_from_launcher",
            return_value=os.fspath(ROOT),
        ), mock.patch.object(
            RECOVERY,
            "_read_public_profile",
            return_value=(self.fixture.profile, profile_data, "a" * 40),
        ), mock.patch.object(
            RECOVERY,
            "_load_recovery_approval",
            load_recovery,
        ), mock.patch.object(
            RECOVERY.PREFLIGHT,
            "_git_ascii",
            return_value=checkout,
        ):
            # Recovery still requires its own bootstrap binding and profile
            # chain; the ordinary approval is never treated as sufficient.
            with self.assertRaises(RECOVERY.RecoveryError) as raised:
                RECOVERY.verify_pre_private(
                    launcher=launcher,
                    ordinary_launcher=ordinary_launcher,
                    ordinary_bootstrap=types.SimpleNamespace(),
                    recovery_bootstrap=types.SimpleNamespace(),
                    ordinary_module=SESSION,
                    tty_fd=9,
                )
        self.assertEqual(raised.exception.reason, "approval_missing")
        load_recovery.assert_called_once()

    def test_expired_mismatched_and_replayed_recovery_approval_fail(self):
        expired = copy.deepcopy(self.fixture.approval)
        expired["recovery_session"]["expires_at_utc"] = "2000-01-01T00:00:00Z"
        ordinary = types.SimpleNamespace(
            approved_checkout_sha=expired["approved_checkout_sha"],
            approval_name=expired["ordinary_execution_approval"]["filename"],
            approval_sha256=expired["ordinary_execution_approval"]["sha256"],
            approval={"python_identity": expired["python_identity"]},
            operator_session_root_path=os.fspath(self.fixture.operator_root),
        )
        profile_sha = expired["recovery_profile"]["sha256"]
        with mock.patch.object(
            RECOVERY.os,
            "fstat",
            return_value=types.SimpleNamespace(st_dev=1, st_ino=1),
        ):
            self.assert_fixed_failure(
                lambda: RECOVERY._validate_approval(
                    expired,
                    checkout=expired["approved_checkout_sha"],
                    profile=self.fixture.profile,
                    profile_sha256=profile_sha,
                    procedure_identity=expired[
                        "recovery_procedure_identity_sha256"
                    ],
                    blobs={},
                    ordinary=ordinary,
                    tty_fd=9,
                ),
                "approval_invalid",
            )

        self.fixture.approval["expected_chain"]["generation"] = 2
        with mock.patch.object(
            RECOVERY.os,
            "fstat",
            return_value=types.SimpleNamespace(st_dev=1, st_ino=1),
        ):
            with self.assertRaises(RECOVERY.RecoveryError) as raised:
                RECOVERY._validate_approval(
                    self.fixture.approval,
                    checkout=self.fixture.approval["approved_checkout_sha"],
                    profile=self.fixture.profile,
                    profile_sha256=self.fixture.approval[
                        "recovery_profile"
                    ]["sha256"],
                    procedure_identity=self.fixture.approval[
                        "recovery_procedure_identity_sha256"
                    ],
                    blobs={},
                    ordinary=ordinary,
                    tty_fd=9,
                )
        self.assertIn(
            raised.exception.reason, {"approval_invalid", "binding_mismatch"}
        )

        self.fixture.rewrite()
        (self.fixture.audit_root / "consumed").write_bytes(b"synthetic\n")
        before = self.fixture.ordinary_snapshot()
        self.assert_fixed_failure(
            lambda: self.run_recovery(),
            "publication_exists",
        )
        self.assertEqual(self.fixture.ordinary_snapshot(), before)

    def test_overlapping_private_paths_and_ai_roles_fail_before_private_access(self):
        ordinary = types.SimpleNamespace(
            approved_checkout_sha=self.fixture.approval["approved_checkout_sha"],
            approval_name=self.fixture.approval["ordinary_execution_approval"][
                "filename"
            ],
            approval_sha256=self.fixture.approval["ordinary_execution_approval"][
                "sha256"
            ],
            approval={"python_identity": self.fixture.approval["python_identity"]},
            operator_session_root_path=os.fspath(self.fixture.operator_root),
        )
        private_calls: list[str] = []
        for label, mutate in (
            (
                "overlap",
                lambda approval: approval.__setitem__(
                    "annotation_root_path",
                    os.fspath(self.fixture.operator_root / "nested"),
                ),
            ),
            (
                "ai_authorizer",
                lambda approval: approval.__setitem__(
                    "authorizer_identity", "Codex Agent"
                ),
            ),
            (
                "ai_executor",
                lambda approval: approval.__setitem__(
                    "executing_operator_identity", "Claude"
                ),
            ),
            (
                "ai_reviewer",
                lambda approval: approval.__setitem__(
                    "independent_reviewer_identity", "OpenAI reviewer"
                ),
            ),
        ):
            with self.subTest(label=label):
                approval = copy.deepcopy(self.fixture.approval)
                mutate(approval)
                with mock.patch.object(
                    RECOVERY.os,
                    "fstat",
                    return_value=types.SimpleNamespace(st_dev=1, st_ino=1),
                ), mock.patch.object(
                    RECOVERY,
                    "_open_private_directory",
                    side_effect=lambda *_args, **_kwargs: private_calls.append(
                        "private"
                    ),
                ):
                    self.assert_fixed_failure(
                        lambda: RECOVERY._validate_approval(
                            approval,
                            checkout=approval["approved_checkout_sha"],
                            profile=self.fixture.profile,
                            profile_sha256=approval["recovery_profile"]["sha256"],
                            procedure_identity=approval[
                                "recovery_procedure_identity_sha256"
                            ],
                            blobs={},
                            ordinary=ordinary,
                            tty_fd=9,
                        ),
                        "approval_invalid",
                    )
        self.assertEqual(private_calls, [])

    def test_expiry_is_rechecked_after_consequence_gate_before_private_access(self):
        verified = self.fixture.verified
        run_recovery = mock.Mock(
            side_effect=AssertionError("private recovery reached after expiry")
        )

        def expire_after_authorization(_tty_fd, selected):
            selected.approval["recovery_session"][
                "expires_at_utc"
            ] = "2000-01-01T00:00:00Z"

        with mock.patch.object(
            RECOVERY, "verify_pre_private", return_value=verified
        ), mock.patch.object(
            RECOVERY, "_tty_write", return_value=None
        ), mock.patch.object(
            RECOVERY, "authorize_consequence", side_effect=expire_after_authorization
        ), mock.patch.object(
            RECOVERY, "run_recovery", run_recovery
        ):
            self.assert_fixed_failure(
                lambda: RECOVERY.execute(
                    launcher=MIGRATION
                    / "run-lovable-toc-operator-identity-recovery.sh",
                    ordinary_launcher=MIGRATION
                    / "run-lovable-toc-annotation-operator-session.sh",
                    ordinary_module=SESSION,
                    tty_fd=9,
                    recovery_bootstrap=types.SimpleNamespace(),
                    ordinary_bootstrap=types.SimpleNamespace(),
                ),
                "approval_invalid",
            )
        run_recovery.assert_not_called()

    def test_exact_approved_tty_is_rechecked_after_authorization(self):
        verified = self.fixture.verified
        run_recovery = mock.Mock(
            side_effect=AssertionError("private recovery reached after TTY drift")
        )

        def drift_after_authorization(_tty_fd, selected):
            selected.approval["tty_binding"]["inode"] = 2

        with mock.patch.object(
            RECOVERY, "verify_pre_private", return_value=verified
        ), mock.patch.object(
            RECOVERY, "_tty_write", return_value=None
        ), mock.patch.object(
            RECOVERY,
            "authorize_consequence",
            side_effect=drift_after_authorization,
        ), mock.patch.object(
            RECOVERY.PREFLIGHT, "verify_tty", return_value=None
        ), mock.patch.object(
            RECOVERY.os,
            "fstat",
            return_value=types.SimpleNamespace(st_dev=1, st_ino=1),
        ), mock.patch.object(
            RECOVERY, "run_recovery", run_recovery
        ):
            self.assert_fixed_failure(
                lambda: RECOVERY.execute(
                    launcher=MIGRATION
                    / "run-lovable-toc-operator-identity-recovery.sh",
                    ordinary_launcher=MIGRATION
                    / "run-lovable-toc-annotation-operator-session.sh",
                    ordinary_module=SESSION,
                    tty_fd=9,
                    recovery_bootstrap=types.SimpleNamespace(),
                    ordinary_bootstrap=types.SimpleNamespace(),
                ),
                "tty_invalid",
            )
        run_recovery.assert_not_called()
        self.assertEqual(os.listdir(self.fixture.audit_root), [])

    def test_exact_approved_tty_is_rechecked_before_identity_disclosure(self):
        before = self.fixture.ordinary_snapshot()
        writes: list[bytes] = []
        exact_checks: list[bool] = []

        def reject_drift(
            _tty_fd,
            _tty_binding,
            *,
            private_access_started,
        ):
            exact_checks.append(private_access_started)
            raise RECOVERY.RecoveryError("indeterminate")

        with mock.patch.object(
            RECOVERY,
            "_verify_approved_tty",
            side_effect=reject_drift,
        ), mock.patch.object(
            RECOVERY,
            "_tty_write",
            side_effect=lambda _fd, payload: writes.append(payload),
        ):
            self.assert_fixed_failure(
                lambda: RECOVERY.run_recovery(
                    9, self.fixture.verified, SESSION
                ),
                "indeterminate",
            )
        self.assertEqual(exact_checks, [True])
        self.assertNotIn(PRIVATE_IDENTITY.encode("ascii"), b"".join(writes))
        self.assertEqual(self.fixture.ordinary_snapshot(), before)
        self.assertNotIn(
            PRIVATE_IDENTITY.encode("ascii"), self.fixture.audit_bytes()
        )


class FailureAndAmbiguityTest(RecoveryTestCase):
    def test_wrong_reentry_records_failure_without_identity(self):
        before = self.fixture.ordinary_snapshot()
        self.assert_fixed_failure(
            lambda: self.run_recovery(
                hidden=["Wrong Private Identity"],
            ),
            "authorization_failed",
        )
        self.assertEqual(self.fixture.ordinary_snapshot(), before)
        audit = self.fixture.audit_bytes()
        self.assertIn(b'"audit_event":"recovery_failed"', audit)
        self.assertNotIn(PRIVATE_IDENTITY.encode("ascii"), audit)
        self.assertNotIn(b"Wrong Private Identity", audit)

    def test_eof_and_tty_write_failure_are_nonleaking(self):
        for label in ("eof", "partial_write"):
            with self.subTest(label=label):
                fixture = SyntheticGenerationOne()
                try:
                    before = fixture.ordinary_snapshot()
                    if label == "eof":
                        answers = [PRIVATE_IDENTITY]
                        with mock.patch.object(
                            RECOVERY,
                            "_verify_approved_tty",
                            return_value=None,
                        ), mock.patch.object(
                            RECOVERY, "_tty_write", return_value=None
                        ), mock.patch.object(
                            RECOVERY,
                            "_read_hidden",
                            side_effect=answers + [EOFError("private-eof")],
                        ), mock.patch.object(
                            RECOVERY, "_clear_private_tty", return_value=None
                        ):
                            self.assert_fixed_failure(
                                lambda: RECOVERY.run_recovery(
                                    9, fixture.verified, SESSION
                                ),
                                "indeterminate",
                            )
                    else:
                        original_write = os.write
                        tty_write_calls = {"count": 0}

                        def partial_then_zero(descriptor, payload):
                            if descriptor != 9:
                                return original_write(descriptor, payload)
                            tty_write_calls["count"] += 1
                            return 1 if tty_write_calls["count"] == 1 else 0

                        with mock.patch.object(
                            RECOVERY,
                            "_verify_approved_tty",
                            return_value=None,
                        ), mock.patch.object(
                            RECOVERY.os, "write", side_effect=partial_then_zero
                        ):
                            self.assert_fixed_failure(
                                lambda: RECOVERY.run_recovery(
                                    9, fixture.verified, SESSION
                                ),
                                "indeterminate",
                            )
                        self.assertEqual(tty_write_calls["count"], 3)
                    if label == "eof":
                        self.assertEqual(fixture.ordinary_snapshot(), before)
                    else:
                        self.assertIn(
                            RECOVERY.LOCK_NAME,
                            os.listdir(fixture.operator_root),
                        )
                        self.assertNotIn(
                            "OPERATOR_SESSION_INDETERMINATE",
                            os.listdir(fixture.operator_root),
                        )
                        self.assertEqual(
                            immutable_tree_snapshot(fixture.annotation_root),
                            before[1],
                        )
                        self.assertEqual(
                            immutable_tree_snapshot(fixture.capture_root),
                            before[2],
                        )
                    audit = fixture.audit_bytes()
                    self.assertNotIn(PRIVATE_IDENTITY.encode("ascii"), audit)
                finally:
                    fixture.close()

    def test_audit_publication_failure_is_fixed_and_no_success_is_claimed(self):
        real_publish = RECOVERY._publish_audit
        calls = {"count": 0}

        def fail_second(*args, **kwargs):
            calls["count"] += 1
            if calls["count"] == 2:
                raise RECOVERY.RecoveryError("audit_failed")
            return real_publish(*args, **kwargs)

        before = self.fixture.ordinary_snapshot()
        with mock.patch.object(
            RECOVERY, "_publish_audit", side_effect=fail_second
        ):
            self.assert_fixed_failure(
                lambda: self.run_recovery(),
                "audit_failed",
            )
        self.assertEqual(self.fixture.ordinary_snapshot(), before)
        audit = self.fixture.audit_bytes()
        self.assertNotIn(b'"audit_event":"recovery_completed"', audit)
        self.assertNotIn(PRIVATE_IDENTITY.encode("ascii"), audit)

    def test_prior_audit_record_mutation_between_publications_is_indeterminate(self):
        real_publish = RECOVERY._publish_audit
        calls = {"count": 0}

        def mutate_prior_after_second(*args, **kwargs):
            publication = real_publish(*args, **kwargs)
            calls["count"] += 1
            if calls["count"] == 2:
                (
                    self.fixture.audit_root
                    / "0001-attempt_started-synthetic-recovery-session.json"
                ).chmod(0o600)
            return publication

        with mock.patch.object(
            RECOVERY, "_publish_audit", side_effect=mutate_prior_after_second
        ):
            self.assert_fixed_failure(
                lambda: self.run_recovery(),
                "indeterminate",
            )

        audit = self.fixture.audit_bytes()
        self.assertNotIn(b'"audit_event":"recovery_completed"', audit)
        self.assertNotIn(PRIVATE_IDENTITY.encode("ascii"), audit)
        self.assertNotIn(PRIVATE_IDENTITY.encode("ascii"), RECOVERY._fixed(
            "failed", "indeterminate"
        ))

    def test_audit_root_path_replacement_before_chain_access_is_indeterminate(self):
        real_publish = RECOVERY._publish_audit
        moved = self.fixture.base / "recovery-audit-root-replaced"
        calls = {"count": 0}

        def replace_path_after_attempt(*args, **kwargs):
            publication = real_publish(*args, **kwargs)
            calls["count"] += 1
            if calls["count"] == 1:
                self.fixture.audit_root.rename(moved)
                self.fixture.audit_root.mkdir(mode=0o700)
            return publication

        before = self.fixture.ordinary_snapshot()
        with mock.patch.object(
            RECOVERY, "_publish_audit", side_effect=replace_path_after_attempt
        ), mock.patch.object(
            RECOVERY,
            "_load_generation_one",
            side_effect=AssertionError("operator root reached after audit swap"),
        ), mock.patch.object(
            RECOVERY,
            "_tty_write",
            side_effect=AssertionError("identity disclosed after audit swap"),
        ):
            self.assert_fixed_failure(
                lambda: RECOVERY.run_recovery(
                    9, self.fixture.verified, SESSION
                ),
                "indeterminate",
            )

        self.assertEqual(self.fixture.ordinary_snapshot(), before)
        self.assertEqual(os.listdir(self.fixture.audit_root), [])
        detached_audit = b"".join(
            child.read_bytes() for child in sorted(moved.iterdir())
        )
        self.assertIn(b'"audit_event":"attempt_started"', detached_audit)
        self.assertNotIn(PRIVATE_IDENTITY.encode("ascii"), detached_audit)

    def test_failure_path_audit_descriptor_close_ambiguity_is_indeterminate(self):
        real_open = RECOVERY._open_private_directory
        real_close = os.close
        audit_descriptor = {"value": -1}

        def remember_audit_descriptor(path):
            descriptor, identity = real_open(path)
            if Path(path) == self.fixture.audit_root:
                audit_descriptor["value"] = descriptor
            return descriptor, identity

        def fail_audit_close(descriptor):
            if descriptor == audit_descriptor["value"]:
                raise OSError("planted-private-audit-close-sentinel")
            return real_close(descriptor)

        with mock.patch.object(
            RECOVERY,
            "_open_private_directory",
            side_effect=remember_audit_descriptor,
        ), mock.patch.object(
            RECOVERY.os, "close", side_effect=fail_audit_close
        ):
            self.assert_fixed_failure(
                lambda: self.run_recovery(hidden=["Wrong Private Identity"]),
                "indeterminate",
            )

        audit = self.fixture.audit_bytes()
        self.assertNotIn(PRIVATE_IDENTITY.encode("ascii"), audit)
        self.assertNotIn(
            b"planted-private-audit-close-sentinel",
            RECOVERY._fixed("failed", "indeterminate"),
        )

    def test_lock_release_ambiguity_leaves_only_blocking_operator_state(self):
        before_annotation = immutable_tree_snapshot(self.fixture.annotation_root)

        def fail_release(_root_fd, _token):
            raise RECOVERY.RecoveryError("indeterminate")

        with mock.patch.object(
            RECOVERY, "_release_recovery_lock", side_effect=fail_release
        ):
            self.assert_fixed_failure(
                lambda: self.run_recovery(),
                "indeterminate",
            )
        names = set(os.listdir(self.fixture.operator_root))
        self.assertIn(RECOVERY.LOCK_NAME, names)
        self.assertNotIn("OPERATOR_SESSION_INDETERMINATE", names)
        self.assertEqual(
            immutable_tree_snapshot(self.fixture.annotation_root),
            before_annotation,
        )
        audit = self.fixture.audit_bytes()
        self.assertIn(b'"audit_event":"recovery_indeterminate"', audit)
        self.assertNotIn(PRIVATE_IDENTITY.encode("ascii"), audit)

    def test_low_level_audit_fsync_failure_cleans_pending_or_is_indeterminate(self):
        root_fd = os.open(
            self.fixture.audit_root,
            os.O_RDONLY
            | getattr(os, "O_DIRECTORY", 0)
            | getattr(os, "O_CLOEXEC", 0)
            | getattr(os, "O_NOFOLLOW", 0),
        )
        record = RECOVERY._audit_record(
            self.fixture.verified,
            event="attempt_started",
            previous=None,
            identity_sources_agree=False,
            reason="private_access_started",
        )
        try:
            with mock.patch.object(
                RECOVERY.os,
                "fsync",
                side_effect=OSError("planted-private-fsync-sentinel"),
            ):
                self.assert_fixed_failure(
                    lambda: RECOVERY._publish_audit(
                        root_fd,
                        "0001-attempt_started-synthetic-recovery-session.json",
                        record,
                    ),
                    "indeterminate",
                )
        finally:
            os.close(root_fd)
        self.assertNotIn(PRIVATE_IDENTITY.encode("ascii"), self.fixture.audit_bytes())
        self.assertFalse(
            any(
                name.startswith(".pending-recovery-")
                for name in os.listdir(self.fixture.audit_root)
            )
        )

    def test_audit_final_collision_cleans_pending_or_is_indeterminate(self):
        record = RECOVERY._audit_record(
            self.fixture.verified,
            event="attempt_started",
            previous=None,
            identity_sources_agree=False,
            reason="private_access_started",
        )
        final_name = "0001-attempt_started-synthetic-recovery-session.json"

        for label, cleanup_fails in (
            ("clean_collision", False),
            ("cleanup_ambiguity", True),
        ):
            with self.subTest(label=label):
                fixture = SyntheticGenerationOne()
                root_fd = os.open(
                    fixture.audit_root,
                    os.O_RDONLY
                    | getattr(os, "O_DIRECTORY", 0)
                    | getattr(os, "O_CLOEXEC", 0)
                    | getattr(os, "O_NOFOLLOW", 0),
                )
                real_unlink = os.unlink

                def collide(directory_fd, source, destination):
                    os.link(
                        source,
                        destination,
                        src_dir_fd=directory_fd,
                        dst_dir_fd=directory_fd,
                        follow_symlinks=False,
                    )
                    raise FileExistsError

                def planted_unlink(path, *args, **kwargs):
                    if cleanup_fails and str(path).startswith(
                        ".pending-recovery-"
                    ):
                        raise OSError("planted-private-cleanup-sentinel")
                    return real_unlink(path, *args, **kwargs)

                try:
                    patches = [
                        mock.patch.object(
                            RECOVERY,
                            "_rename_no_replace",
                            side_effect=collide,
                        )
                    ]
                    if cleanup_fails:
                        patches.append(
                            mock.patch.object(
                                RECOVERY.os,
                                "unlink",
                                side_effect=planted_unlink,
                            )
                        )
                    with ExitStack() as stack:
                        for patcher in patches:
                            stack.enter_context(patcher)
                        self.assert_fixed_failure(
                            lambda: RECOVERY._publish_audit(
                                root_fd,
                                final_name,
                                record,
                            ),
                            (
                                "indeterminate"
                                if cleanup_fails
                                else "publication_exists"
                            ),
                        )
                finally:
                    os.close(root_fd)
                pending = [
                    name
                    for name in os.listdir(fixture.audit_root)
                    if name.startswith(".pending-recovery-")
                ]
                if cleanup_fails:
                    self.assertEqual(len(pending), 1)
                else:
                    self.assertEqual(pending, [])
                self.assertNotIn(
                    PRIVATE_IDENTITY.encode("ascii"), fixture.audit_bytes()
                )
                fixture.close()

        fixture = SyntheticGenerationOne()
        final = fixture.audit_root / final_name
        final.write_bytes(canonical(record))
        final.chmod(0o400)
        original = final.read_bytes()
        root_fd = os.open(
            fixture.audit_root,
            os.O_RDONLY
            | getattr(os, "O_DIRECTORY", 0)
            | getattr(os, "O_CLOEXEC", 0)
            | getattr(os, "O_NOFOLLOW", 0),
        )
        try:
            self.assert_fixed_failure(
                lambda: RECOVERY._publish_audit(
                    root_fd,
                    final_name,
                    record,
                ),
                "audit_failed",
            )
        finally:
            os.close(root_fd)
        self.assertEqual(final.read_bytes(), original)
        self.assertEqual(
            [
                name
                for name in os.listdir(fixture.audit_root)
                if name.startswith(".pending-recovery-")
            ],
            [],
        )
        self.assertNotIn(
            PRIVATE_IDENTITY.encode("ascii"), fixture.audit_bytes()
        )
        fixture.close()


class ContractAndScopeTest(unittest.TestCase):
    def test_recovery_is_not_an_ordinary_action_and_schemas_remain_unchanged(self):
        self.assertNotIn("recover", AUTHOR.ACTION_VALUES)
        self.assertNotIn("recover_operator_identity", AUTHOR.ACTION_VALUES)
        self.assertEqual(SESSION.FORMAT_VERSION, 1)
        self.assertEqual(SESSION.ACTION_AUTHORIZATION_FORMAT_VERSION, 2)
        self.assertEqual(SESSION.RESUME_FORMAT_VERSION, 2)
        profile = json.loads(
            (
                MIGRATION
                / "verification"
                / "lovable-toc-operator-identity-recovery-profile.v1.json"
            ).read_text(encoding="ascii")
        )
        self.assertEqual(profile["record_versions"]["checkpoint"], [1])
        source = (
            MIGRATION / "author-lovable-toc-operator-session.py"
        ).read_text(encoding="utf-8")
        self.assertNotIn("recover_operator_identity", source)

    def test_public_diagnostics_are_fixed_and_never_contain_private_values(self):
        for reason in RECOVERY.RecoveryError.ALLOWED:
            payload = RECOVERY._fixed("failed", reason)
            self.assertEqual(payload, RECOVERY._fixed("failed", reason))
            self.assertTrue(payload.endswith(b"\n"))
            for sentinel in PRIVATE_SENTINELS:
                self.assertNotIn(sentinel, payload)

    def test_audit_schema_has_no_identity_value_or_derivative_field(self):
        schema = json.loads(
            (
                MIGRATION
                / "verification"
                / "lovable-toc-operator-identity-recovery-audit-record.schema.json"
            ).read_text(encoding="ascii")
        )
        property_names = set(schema["properties"])
        for forbidden in (
            "stored_primary_operator_identity",
            "operator_identity",
            "operator_identity_sha256",
            "identity_fingerprint",
        ):
            self.assertNotIn(forbidden, property_names)
        self.assertEqual(
            schema["properties"]["identity_disclosure"]["const"],
            "stored_primary_operator_identity_only",
        )

    def test_profile_and_schemas_bind_the_exact_runtime_contract(self):
        verification = MIGRATION / "verification"
        profile = json.loads(
            (
                verification
                / "lovable-toc-operator-identity-recovery-profile.v1.json"
            ).read_text(encoding="ascii")
        )
        approval_schema = json.loads(
            (
                verification
                / "lovable-toc-operator-identity-recovery-approval.schema.json"
            ).read_text(encoding="ascii")
        )
        audit_schema = json.loads(
            (
                verification
                / "lovable-toc-operator-identity-recovery-audit-record.schema.json"
            ).read_text(encoding="ascii")
        )
        self.assertEqual(
            set(profile["recovery_contract"]["audit_events"]),
            RECOVERY.AUDIT_EVENTS,
        )
        self.assertEqual(
            approval_schema["properties"]["trust_model_acknowledgement"][
                "const"
            ],
            RECOVERY.TRUST_ACKNOWLEDGEMENT,
        )
        self.assertTrue(
            {
                "annotation_root_path",
                "capture_root_path",
                "operator_session_root_path",
                "recovery_evidence_root_path",
            }.issubset(approval_schema["required"])
        )
        self.assertEqual(
            approval_schema["properties"]["expected_chain"]["properties"][
                "resume"
            ]["properties"]["predecessor"]["const"],
            "absent",
        )
        self.assertEqual(
            audit_schema["properties"]["source_binding"]["properties"][
                "resume"
            ]["properties"]["predecessor"]["const"],
            "absent",
        )


if __name__ == "__main__":
    unittest.main()
