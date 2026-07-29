#!/usr/bin/env python3
"""Reviewed private operator-session wrapper for TOC annotation authoring.

This internal component is launched only by
``run-lovable-toc-annotation-operator-session.sh``.  It collects the approved
authoring bindings from the verified local controlling TTY, publishes immutable
private authorization records, creates the empty annotation root for the initial
operation, and then consumes private resume records for one later reviewed
authoring action per invocation.  It never invokes validation, generates restore
planning, connects to a database, or performs any network operation.

Ordinary stdout/stderr carry fixed diagnostics only.  Private values are read
from and displayed only to the held TTY descriptor.
"""

from __future__ import annotations

import sys


_STARTUP_FAILURE_DIAGNOSTIC = (
    b'{"diagnostic_version":1,"reason":"startup_environment_invalid",'
    b'"stage":"annotation_operator_session","status":"failed"}\n'
)
_STARTUP_BINDING_FAILURE_DIAGNOSTIC = (
    b'{"diagnostic_version":1,"reason":"binding_mismatch",'
    b'"stage":"annotation_operator_session","status":"failed"}\n'
)


def _runtime_isolation_enabled() -> bool:
    flags = sys.flags
    return (
        getattr(flags, "isolated", 0) == 1
        and getattr(flags, "ignore_environment", 0) == 1
        and getattr(flags, "no_user_site", 0) == 1
        and getattr(flags, "no_site", 0) == 1
        and getattr(flags, "dont_write_bytecode", 0) == 1
        and sys.dont_write_bytecode is True
    )


def _startup_write(payload: bytes) -> None:
    try:
        sys.stderr.buffer.write(payload)
        sys.stderr.buffer.flush()
    except BaseException:
        pass


if not _runtime_isolation_enabled():
    _startup_write(_STARTUP_FAILURE_DIAGNOSTIC)
    raise SystemExit(1)

import os


_DARWIN_RUNTIME_ADDED_ENVIRONMENT_NAME = "__CF_USER_TEXT_ENCODING"


class _DarwinRuntimeEnvironmentNormalizationError(RuntimeError):
    pass


def _darwin_runtime_environment_name_present(environment) -> bool:
    return any(
        name == _DARWIN_RUNTIME_ADDED_ENVIRONMENT_NAME for name in environment
    )


def _normalize_darwin_runtime_environment(environment=None) -> None:
    """Remove only the reviewed Darwin runtime-added environment name."""

    if sys.platform != "darwin":
        return
    selected_environment = os.environ if environment is None else environment
    try:
        if _darwin_runtime_environment_name_present(selected_environment):
            del selected_environment[_DARWIN_RUNTIME_ADDED_ENVIRONMENT_NAME]
        if _darwin_runtime_environment_name_present(selected_environment):
            raise _DarwinRuntimeEnvironmentNormalizationError
    except BaseException:
        raise _DarwinRuntimeEnvironmentNormalizationError from None


def _normalize_darwin_runtime_environment_or_exit(environment=None) -> None:
    try:
        _normalize_darwin_runtime_environment(environment)
    except BaseException:
        _startup_write(_STARTUP_FAILURE_DIAGNOSTIC)
        raise SystemExit(1) from None


_normalize_darwin_runtime_environment_or_exit()

import argparse
import base64
import ctypes
import errno
import hashlib
import hmac
import importlib.util
import json
import pwd
import re
import resource
import secrets
import stat
import subprocess
import struct
import termios
import unicodedata
from collections import Counter
from collections.abc import Mapping as AbcMapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping


_REVIEWED_GIT = "/usr/bin/git"
_REVIEWED_GIT_CONFIG = (
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "core.untrackedCache=false",
)
_REVIEWED_GIT_ENVIRONMENT = {
    "GIT_CONFIG_GLOBAL": "/dev/null",
    "GIT_CONFIG_NOSYSTEM": "1",
    "GIT_CONFIG_SYSTEM": "/dev/null",
    "GIT_NO_LAZY_FETCH": "1",
    "GIT_NO_REPLACE_OBJECTS": "1",
    "GIT_OPTIONAL_LOCKS": "0",
    "GIT_TERMINAL_PROMPT": "0",
    "LANG": "C",
    "LC_ALL": "C",
    "PATH": "/usr/bin:/bin",
}
_MAX_GIT_BYTES = 1024 * 1024
_MAX_APPROVAL_BYTES = 512 * 1024
_APPROVAL_RELATIVE_PARENT = (
    "Library/Application Support/focus-flow-score/migration-approvals/toc-operator"
)
_APPROVAL_NAME_RE = re.compile(
    r"^lovable-toc-operator-approval-([0-9a-f]{40})-[0-9a-f]{16}[.]json$",
    re.ASCII,
)
_BOOTSTRAP_REVIEWED_FILES = frozenset(
    {
        "docs/migration/migration-runbook.md",
        "scripts/migration/README.md",
        "scripts/migration/author-lovable-toc-annotations.py",
        "scripts/migration/author-lovable-toc-operator-session.py",
        "scripts/migration/lib/lovable_dump_report.py",
        "scripts/migration/lib/lovable_toc_authoring_contract.py",
        "scripts/migration/lib/lovable_toc_contract.py",
        "scripts/migration/lib/lovable_toc_operator_preflight.py",
        "scripts/migration/run-lovable-toc-annotation-authoring.sh",
        "scripts/migration/run-lovable-toc-annotation-operator-session.sh",
        "scripts/migration/verification/lovable-toc-annotation-checkpoint.schema.json",
        "scripts/migration/verification/lovable-toc-annotation-ledger.schema.json",
        "scripts/migration/verification/lovable-toc-operator-execution-profile-approval.schema.json",
        "scripts/migration/verification/lovable-toc-operator-execution-profile.schema.json",
        "scripts/migration/verification/lovable-toc-operator-execution-profile.v1.json",
        "scripts/migration/verification/lovable-toc-operator-session-authorization.schema.json",
        "scripts/migration/verification/lovable-toc-operator-session-resume.schema.json",
    }
)


class _StartupFailure(RuntimeError):
    pass


@dataclass(frozen=True)
class _BootstrapApprovalBinding:
    """Owner-private procedural approval snapshot bound before local imports."""

    approval_name: str
    approval_sha256: str
    file_identity: tuple[int, ...]
    parent_identity: tuple[int, ...]


def _startup_file_identity(metadata: os.stat_result) -> tuple[int, ...]:
    return (
        metadata.st_dev,
        metadata.st_ino,
        metadata.st_mode,
        metadata.st_nlink,
        metadata.st_uid,
        metadata.st_gid,
        metadata.st_size,
        metadata.st_mtime_ns,
        metadata.st_ctime_ns,
    )


def _startup_parent_identity(metadata: os.stat_result) -> tuple[int, ...]:
    return (
        metadata.st_dev,
        metadata.st_ino,
        metadata.st_mode,
        metadata.st_nlink,
        metadata.st_uid,
        metadata.st_gid,
        metadata.st_mtime_ns,
        metadata.st_ctime_ns,
    )


def _diagnostic_fd() -> int:
    raw = os.environ.get("TOC_INTERNAL_DIAGNOSTIC_STDERR_FD")
    try:
        descriptor = int(raw) if raw is not None else 2
    except ValueError:
        return 2
    return descriptor if descriptor >= 2 else 2


def _fixed(status: str, reason: str) -> bytes:
    record = {
        "diagnostic_version": 1,
        "reason": reason,
        "stage": "annotation_operator_session",
        "status": status,
    }
    return json.dumps(record, separators=(",", ":"), sort_keys=True).encode("ascii") + b"\n"


def _emit_failure(reason: str) -> None:
    try:
        os.write(_diagnostic_fd(), _fixed("failed", reason))
    except BaseException:
        pass


def _reviewed_git(repository: str, arguments: list[str]) -> bytes:
    try:
        metadata = os.lstat(_REVIEWED_GIT)
        if (
            stat.S_ISLNK(metadata.st_mode)
            or not stat.S_ISREG(metadata.st_mode)
            or not os.access(_REVIEWED_GIT, os.X_OK)
        ):
            raise _StartupFailure
        result = subprocess.run(
            [_REVIEWED_GIT, *_REVIEWED_GIT_CONFIG, *arguments],
            cwd=repository,
            check=False,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            env=dict(_REVIEWED_GIT_ENVIRONMENT),
            timeout=20,
            close_fds=True,
        )
    except BaseException as exc:
        raise _StartupFailure from exc
    if result.returncode != 0 or len(result.stdout) > _MAX_GIT_BYTES:
        raise _StartupFailure
    return result.stdout


def _is_git_sha(value: str | None) -> bool:
    return (
        type(value) is str
        and len(value) == 40
        and all(character in "0123456789abcdef" for character in value)
    )


def _startup_reject_duplicate_pairs(
    pairs: list[tuple[str, Any]],
) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise _StartupFailure
        result[key] = value
    return result


def _startup_reject_nonfinite(_value: str) -> None:
    raise _StartupFailure


def _startup_canonical_json(value: Any) -> bytes:
    try:
        return (
            json.dumps(
                value,
                allow_nan=False,
                ensure_ascii=True,
                separators=(",", ":"),
                sort_keys=True,
            ).encode("ascii")
            + b"\n"
        )
    except (TypeError, ValueError, UnicodeError) as exc:
        raise _StartupFailure from exc


def _startup_stable_approval(
    parent_fd: int,
    parent_metadata: os.stat_result,
    name: str,
) -> tuple[bytes, os.stat_result]:
    descriptor = -1
    try:
        descriptor = os.open(
            name,
            os.O_RDONLY
            | getattr(os, "O_CLOEXEC", 0)
            | getattr(os, "O_NOFOLLOW", 0),
            dir_fd=parent_fd,
        )
        before = os.fstat(descriptor)
        if (
            not stat.S_ISREG(before.st_mode)
            or before.st_uid != os.geteuid()
            or stat.S_IMODE(before.st_mode) != 0o400
            or before.st_nlink != 1
            or before.st_dev != parent_metadata.st_dev
            or before.st_size <= 0
            or before.st_size > _MAX_APPROVAL_BYTES
        ):
            raise _StartupFailure
        chunks: list[bytes] = []
        total = 0
        while True:
            chunk = os.read(
                descriptor,
                min(65536, _MAX_APPROVAL_BYTES + 1 - total),
            )
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
            if total > _MAX_APPROVAL_BYTES:
                raise _StartupFailure
        after = os.fstat(descriptor)
        if _startup_file_identity(before) != _startup_file_identity(after):
            raise _StartupFailure
        return b"".join(chunks), before
    except (OSError, ValueError) as exc:
        raise _StartupFailure from exc
    finally:
        if descriptor >= 0:
            try:
                os.close(descriptor)
            except OSError:
                pass


def _preimport_external_guard(
    *,
    repository: Path | None = None,
    account_home: Path | None = None,
) -> _BootstrapApprovalBinding:
    """Bind every reviewed startup input before repo-local imports.

    This is intentionally a narrow trust bootstrap, not a second public
    preflight or a cryptographic authentication layer. It binds the shared
    verifier and its complete reviewed import closure to the one owner-private
    procedural approval artifact. The imported shared verifier then performs
    the full, authoritative pre-private check. Malicious same-UID replacement
    before launch remains an accepted local trust ceiling.
    """

    try:
        script = Path(__file__).resolve(strict=True)
        selected_repository = script.parents[2] if repository is None else repository
        if not selected_repository.is_absolute():
            raise _StartupFailure
        selected_repository = selected_repository.resolve(strict=True)
        selected_home = (
            Path(pwd.getpwuid(os.geteuid()).pw_dir)
            if account_home is None
            else account_home
        )
        if not selected_home.is_absolute():
            raise _StartupFailure
        approval_parent = selected_home / _APPROVAL_RELATIVE_PARENT
        parent_lstat = os.lstat(approval_parent)
        parent_resolved = approval_parent.resolve(strict=True)
        if (
            stat.S_ISLNK(parent_lstat.st_mode)
            or not stat.S_ISDIR(parent_lstat.st_mode)
            or parent_lstat.st_uid != os.geteuid()
            or stat.S_IMODE(parent_lstat.st_mode) != 0o700
            or parent_resolved != approval_parent
        ):
            raise _StartupFailure
        parent_fd = os.open(
            approval_parent,
            os.O_RDONLY
            | getattr(os, "O_DIRECTORY", 0)
            | getattr(os, "O_CLOEXEC", 0)
            | getattr(os, "O_NOFOLLOW", 0),
        )
    except (OSError, RuntimeError) as exc:
        raise _StartupFailure from exc
    try:
        opened_parent = os.fstat(parent_fd)
        if (
            opened_parent.st_dev,
            opened_parent.st_ino,
            opened_parent.st_mode,
            opened_parent.st_uid,
            opened_parent.st_gid,
        ) != (
            parent_lstat.st_dev,
            parent_lstat.st_ino,
            parent_lstat.st_mode,
            parent_lstat.st_uid,
            parent_lstat.st_gid,
        ):
            raise _StartupFailure
        checkout = _reviewed_git(
            os.fspath(selected_repository), ["rev-parse", "HEAD"]
        ).strip().decode("ascii", errors="strict")
        if not _is_git_sha(checkout):
            raise _StartupFailure
        matches = []
        for name in os.listdir(parent_fd):
            if type(name) is not str:
                raise _StartupFailure
            matched = _APPROVAL_NAME_RE.fullmatch(name)
            if matched is not None and matched.group(1) == checkout:
                matches.append(name)
        if len(matches) != 1:
            raise _StartupFailure
        data, approval_metadata = _startup_stable_approval(
            parent_fd, opened_parent, matches[0]
        )
        after_parent = os.fstat(parent_fd)
        if _startup_parent_identity(opened_parent) != _startup_parent_identity(
            after_parent
        ):
            raise _StartupFailure
    except (OSError, UnicodeError, ValueError) as exc:
        raise _StartupFailure from exc
    finally:
        try:
            os.close(parent_fd)
        except OSError:
            pass
    try:
        approval = json.loads(
            data.decode("ascii", errors="strict"),
            object_pairs_hook=_startup_reject_duplicate_pairs,
            parse_constant=_startup_reject_nonfinite,
        )
        if _startup_canonical_json(approval) != data or type(approval) is not dict:
            raise _StartupFailure
        if (
            approval.get("artifact_kind")
            != "lovable_toc_operator_execution_approval"
            or type(approval.get("format_version")) is not int
            or approval.get("format_version") != 1
            or approval.get("approved_checkout_sha") != checkout
            or approval.get("repository")
            != {"name": "focus-flow-score", "owner": "starstruck86"}
        ):
            raise _StartupFailure
        reviewed_blobs = approval.get("reviewed_file_blobs")
        if (
            type(reviewed_blobs) is not dict
            or set(reviewed_blobs) != _BOOTSTRAP_REVIEWED_FILES
        ):
            raise _StartupFailure
        for blob in reviewed_blobs.values():
            if not _is_git_sha(blob):
                raise _StartupFailure
        for reference in ("HEAD", "refs/heads/main", "refs/remotes/origin/main"):
            if (
                _reviewed_git(
                    os.fspath(selected_repository), ["rev-parse", reference]
                ).strip()
                != checkout.encode("ascii")
            ):
                raise _StartupFailure
        if _reviewed_git(
            os.fspath(selected_repository),
            ["status", "--porcelain=v1", "--untracked-files=all"],
        ):
            raise _StartupFailure
        for relative_root in ("scripts/migration", "supabase/migrations"):
            for arguments in (
                [
                    "ls-files",
                    "--others",
                    "--exclude-standard",
                    "--",
                    relative_root,
                ],
                [
                    "ls-files",
                    "--others",
                    "--ignored",
                    "--exclude-standard",
                    "--",
                    relative_root,
                ],
            ):
                if _reviewed_git(os.fspath(selected_repository), arguments):
                    raise _StartupFailure
        for relative, approved_blob in reviewed_blobs.items():
            committed = _reviewed_git(
                os.fspath(selected_repository),
                ["rev-parse", f"{checkout}:{relative}"],
            ).strip()
            working = _reviewed_git(
                os.fspath(selected_repository),
                ["hash-object", "--", relative],
            ).strip()
            if (
                committed != approved_blob.encode("ascii")
                or working != committed
            ):
                raise _StartupFailure
        migration_directory = selected_repository / "scripts/migration"
        for relative in (
            "argparse.py",
            "author_lovable_toc_annotations.py",
            "base64.py",
            "collections.py",
            "ctypes.py",
            "dataclasses.py",
            "errno.py",
            "hashlib.py",
            "hmac.py",
            "importlib.py",
            "json.py",
            "lib.py",
            "lib/__init__.py",
            "pathlib.py",
            "pwd.py",
            "re.py",
            "resource.py",
            "secrets.py",
            "stat.py",
            "struct.py",
            "subprocess.py",
            "termios.py",
            "typing.py",
            "unicodedata.py",
        ):
            try:
                os.lstat(migration_directory / relative)
            except FileNotFoundError:
                continue
            raise _StartupFailure
        return _BootstrapApprovalBinding(
            approval_name=matches[0],
            approval_sha256=hashlib.sha256(data).hexdigest(),
            file_identity=_startup_file_identity(approval_metadata),
            parent_identity=_startup_parent_identity(opened_parent),
        )
    except (
        KeyError,
        OSError,
        TypeError,
        UnicodeError,
        ValueError,
        json.JSONDecodeError,
    ) as exc:
        raise _StartupFailure from exc


_BOOTSTRAP_APPROVAL_BINDING: _BootstrapApprovalBinding | None = None


if __name__ == "__main__":
    try:
        _BOOTSTRAP_APPROVAL_BINDING = _preimport_external_guard()
    except BaseException:
        _startup_write(_STARTUP_BINDING_FAILURE_DIAGNOSTIC)
        raise SystemExit(1)


try:
    SCRIPT = Path(__file__).resolve(strict=True)
    REPO = SCRIPT.parents[2]
    if str(SCRIPT.parent) not in sys.path:
        sys.path.insert(0, str(SCRIPT.parent))
    from lib import lovable_toc_operator_preflight as PREFLIGHT  # noqa: E402
    from lib.lovable_toc_contract import (  # noqa: E402
        ContractError,
        _rename_no_replace,
        canonical_json_bytes,
        emit_fixed_diagnostic,
        sha256_bytes,
        stable_private_file_at,
        strict_json_loads,
    )
    author_path = SCRIPT.with_name("author-lovable-toc-annotations.py")
    spec = importlib.util.spec_from_file_location(
        "lovable_toc_authoring_component_for_operator_session", author_path
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("component load failed")
    AUTHOR = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = AUTHOR
    spec.loader.exec_module(AUTHOR)
except BaseException:
    _emit_failure("binding_mismatch")
    raise SystemExit(1)


STAGE = "annotation_operator_session"
FORMAT_VERSION = 1
ACTION_AUTHORIZATION_FORMAT_VERSION = 2
RESUME_FORMAT_VERSION = 2
AUTHORIZATION_KIND = "lovable_toc_operator_authorization"
ACTION_AUTHORIZATION_KIND = "lovable_toc_operator_action_authorization"
RESUME_KIND = "lovable_toc_operator_resume"
TERMINAL_RESUME_KIND = "lovable_toc_operator_terminal"
OPERATOR_SESSION_LOCK_NAME = "operator-session-lock"
OPERATOR_SESSION_RELEASED_NAME = "operator-session-released"
CURRENT_RESUME_PREFIX = "resume-current-g"
RETIRED_RESUME_PREFIX = "resume-retired-g"
TERMINAL_RESUME_PREFIX = "resume-terminal-g"
TTY_ATTESTATION = "LOCAL_CONTROLLING_TTY_NO_RECORDING_NO_REMOTE_NO_CLIPBOARD"
INITIAL_RELEASE_TOKEN = "0" * 64
VERIFY_ONLY = "VERIFY_ONLY"
CONSEQUENCE_CHALLENGE_BYTES = 5
HEX64_RE = re.compile(r"^[0-9a-f]{64}$", re.ASCII)
GIT_SHA_RE = re.compile(r"^[0-9a-f]{40}$", re.ASCII)
SAFE_SESSION_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$", re.ASCII)
SAFE_CAPTURE_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$", re.ASCII)
SAFE_IDENTITY_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ._@()+:-]{0,127}$", re.ASCII)
PYTHON_VERSION_RE = re.compile(
    r"^cpython:(?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,2})\.(?:0|[1-9][0-9]{0,2})$",
    re.ASCII,
)
MAX_OPERATOR_INPUT_BYTES = 4096
MAX_RECORD_BYTES = 1024 * 1024
MAX_RESUME_HISTORY_DEPTH = 4096
AUTHORING_STATES = frozenset(
    {
        "PRIMARY_REVIEW_REQUIRED",
        "REVISIT_REQUIRED",
        "RELATIONSHIP_REVIEW_REQUIRED",
        "DATA_REFERENCE_REVIEW_REQUIRED",
        "SEQUENCE_REVIEW_REQUIRED",
        "MANAGED_GLOBAL_REVIEW_REQUIRED",
        "MANUAL_CONFLICT_REVIEW_REQUIRED",
        "PEER_REVIEW_REQUIRED",
        "FINALIZATION_REVIEW_REQUIRED",
        "FINALIZATION_ELIGIBLE",
    }
)
AI_PEER_RE = re.compile(r"(?:^|[ ._@()+:-])(?:ai|codex|claude|chatgpt|gpt|openai|agent)(?:$|[ ._@()+:-])", re.ASCII | re.IGNORECASE)


class OperatorSessionError(RuntimeError):
    ALLOWED = frozenset(
        {
            "binding_mismatch",
            "checkpoint_invalid",
            "cleanup_indeterminate",
            "finalization_incomplete",
            "history_conflict",
            "history_invalid",
            "input_invalid",
            "input_mutated",
            "publication_failed",
            "publication_exists",
            "review_transition_invalid",
            "tty_invalid",
            "internal_failure",
        }
    )

    def __init__(self, reason: str):
        self.reason = reason if reason in self.ALLOWED else "internal_failure"
        super().__init__(self.reason)


@dataclass(frozen=True)
class RecordPublication:
    name: str
    sha256: str


@dataclass(frozen=True)
class ResumeExecutionMode:
    name: str
    binding_policy: Any | None


@dataclass(frozen=True)
class ResumeHistoryEdge:
    successor: Mapping[str, Any]
    successor_name: str
    successor_sha256: str
    retired_resume: Mapping[str, Any]
    retired_name: str
    retired_sha256: str
    action_authorization: Mapping[str, Any]
    action_name: str
    action_sha256: str


@dataclass
class ResumeHistorySnapshot:
    """Private immutable-history observations retained for one invocation."""

    current_resume: Mapping[str, Any]
    current_name: str
    current_sha256: str
    root_authorization: Mapping[str, Any]
    root_name: str
    root_sha256: str
    edges: tuple[ResumeHistoryEdge, ...]
    record_observations: dict[str, Any]
    relevant_names: frozenset[str]
    pending_action_name: str
    pending_action: Mapping[str, Any]
    pending_action_sha256: str
    release_tokens: frozenset[str]
    checkpoint_observations: dict[str, Any] | None = None
    annotation_root_identity: tuple[int, int] | None = None
    checkpoints_identity: tuple[int, int] | None = None


@dataclass
class ConsequenceGate:
    consumed: bool = False


def _fail(reason: str) -> None:
    raise OperatorSessionError(reason)


def _sha(value: str) -> str:
    if type(value) is not str or HEX64_RE.fullmatch(value) is None:
        _fail("binding_mismatch")
    return value


def _git_sha(value: str) -> str:
    if type(value) is not str or GIT_SHA_RE.fullmatch(value) is None:
        _fail("binding_mismatch")
    return value


def _safe_identity(value: str) -> str:
    if type(value) is not str or SAFE_IDENTITY_RE.fullmatch(value) is None:
        _fail("input_invalid")
    return value


def _safe_session(value: str) -> str:
    if type(value) is not str or SAFE_SESSION_RE.fullmatch(value) is None:
        _fail("input_invalid")
    return value


def _safe_capture_name(value: str) -> str:
    if type(value) is not str or SAFE_CAPTURE_NAME_RE.fullmatch(value) is None:
        _fail("input_invalid")
    return value


def _count(value: str, *, allow_zero: bool = False) -> int:
    if type(value) is not str or not value.isdigit():
        _fail("input_invalid")
    result = int(value)
    if result < 0 or (result == 0 and not allow_zero):
        _fail("input_invalid")
    return result


def _validate_absolute_path(value: str, *, must_exist: bool) -> Path:
    if (
        type(value) is not str
        or not value
        or value.startswith("//")
        or "\x00" in value
    ):
        _fail("input_invalid")
    path = Path(value)
    if not path.is_absolute() or value != os.path.abspath(value):
        _fail("input_invalid")
    try:
        resolved = path.resolve(strict=must_exist)
    except (OSError, RuntimeError) as exc:
        raise OperatorSessionError("input_invalid") from exc
    if must_exist and resolved != path:
        _fail("input_invalid")
    if not must_exist:
        try:
            parent = path.parent.resolve(strict=True)
        except (OSError, RuntimeError) as exc:
            raise OperatorSessionError("input_invalid") from exc
        if parent / path.name != path:
            _fail("input_invalid")
    return path


def _validate_absolute_path_lexical(value: str) -> Path:
    if (
        type(value) is not str
        or not value
        or value.startswith("//")
        or "\x00" in value
    ):
        _fail("input_invalid")
    path = Path(value)
    if (
        not path.is_absolute()
        or value != os.path.abspath(value)
        or any(part in {"", ".", ".."} for part in path.parts)
    ):
        _fail("input_invalid")
    return path


def _portable_private_path_key(path: Path) -> str:
    raw = os.fspath(path)
    if raw.startswith("//"):
        raw = "/" + raw.lstrip("/")
    normalized = unicodedata.normalize(
        "NFC", os.path.normpath(raw)
    )
    return unicodedata.normalize("NFC", normalized.casefold())


def _assert_outside_repository(paths: tuple[Path, ...]) -> None:
    repository = REPO.resolve(strict=True)
    repository_keys = {
        _portable_private_path_key(REPO),
        _portable_private_path_key(repository),
    }
    path_keys = [_portable_private_path_key(path) for path in paths]
    for path_key in path_keys:
        for repository_key in repository_keys:
            try:
                if (
                    os.path.commonpath((repository_key, path_key))
                    == repository_key
                ):
                    _fail("input_invalid")
            except ValueError as exc:
                raise OperatorSessionError("input_invalid") from exc
    for index, left in enumerate(path_keys):
        for right in path_keys[index + 1 :]:
            try:
                common = os.path.commonpath((left, right))
            except ValueError as exc:
                raise OperatorSessionError("input_invalid") from exc
            if common in {left, right}:
                _fail("input_invalid")


def _open_existing_private_directory(path: Path) -> tuple[int, os.stat_result]:
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_NOFOLLOW", 0)
    descriptor = -1
    try:
        descriptor = os.open(os.fspath(path), flags)
        held = os.fstat(descriptor)
        named = os.stat(path, follow_symlinks=False)
    except (OSError, ContractError) as exc:
        if descriptor >= 0:
            try:
                os.close(descriptor)
            except OSError:
                pass
        raise OperatorSessionError("input_invalid") from exc
    if (
        not stat.S_ISDIR(held.st_mode)
        or stat.S_ISLNK(named.st_mode)
        or (held.st_dev, held.st_ino) != (named.st_dev, named.st_ino)
        or held.st_uid != os.geteuid()
        or stat.S_IMODE(held.st_mode) != 0o700
    ):
        os.close(descriptor)
        _fail("input_invalid")
    return descriptor, held


def _create_private_directory_no_replace(path: Path) -> tuple[int, os.stat_result]:
    parent = path.parent
    parent_fd, parent_metadata = _open_existing_private_directory(parent)
    try:
        try:
            os.mkdir(path.name, 0o700, dir_fd=parent_fd)
            os.fsync(parent_fd)
        except FileExistsError as exc:
            raise OperatorSessionError("history_conflict") from exc
        except OSError as exc:
            raise OperatorSessionError("publication_failed") from exc
        child_fd = -1
        try:
            child_fd, child_metadata = _open_existing_private_directory(path)
        except BaseException:
            try:
                os.rmdir(path.name, dir_fd=parent_fd)
                os.fsync(parent_fd)
            except OSError:
                pass
            raise
        if child_metadata.st_dev != parent_metadata.st_dev:
            os.close(child_fd)
            _fail("input_invalid")
        try:
            names = os.listdir(child_fd)
        except OSError as exc:
            os.close(child_fd)
            raise OperatorSessionError("input_invalid") from exc
        if names:
            os.close(child_fd)
            _fail("history_conflict")
        return child_fd, child_metadata
    finally:
        os.close(parent_fd)


def _publish_private_json_at(root_fd: int, final_name: str, payload: Mapping[str, Any]) -> RecordPublication:
    if not SAFE_CAPTURE_NAME_RE.fullmatch(final_name):
        _fail("input_invalid")
    data = canonical_json_bytes(payload)
    if len(data) > MAX_RECORD_BYTES:
        _fail("input_invalid")
    digest = sha256_bytes(data)
    pending = ".pending-" + final_name
    descriptor = -1
    renamed = False
    try:
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_CLOEXEC", 0)
        flags |= getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(pending, flags, 0o400, dir_fd=root_fd)
        if os.write(descriptor, data) != len(data):
            raise OSError("short private record write")
        os.fsync(descriptor)
        os.close(descriptor)
        descriptor = -1
        _rename_no_replace(root_fd, pending, final_name)
        renamed = True
        observed = stable_private_file_at(root_fd, final_name, max_bytes=MAX_RECORD_BYTES, exact_mode=0o400)
        if observed.data != data:
            _fail("input_mutated")
        os.fsync(root_fd)
    except OperatorSessionError:
        raise
    except (OSError, ContractError) as exc:
        try:
            if descriptor >= 0:
                os.close(descriptor)
        except OSError:
            pass
        if renamed:
            _mark_session_indeterminate(root_fd)
            raise OperatorSessionError("cleanup_indeterminate") from exc
        try:
            os.unlink(pending, dir_fd=root_fd)
            os.fsync(root_fd)
        except OSError:
            _mark_session_indeterminate(root_fd)
            raise OperatorSessionError("cleanup_indeterminate") from exc
        raise OperatorSessionError("publication_failed") from exc
    return RecordPublication(final_name, digest)


def _load_private_json_at(root_fd: int, name: str, *, maximum: int = MAX_RECORD_BYTES) -> Mapping[str, Any]:
    try:
        observed = stable_private_file_at(root_fd, name, max_bytes=maximum, exact_mode=0o400)
        value = strict_json_loads(observed.data, max_bytes=maximum)
    except ContractError as exc:
        raise OperatorSessionError("history_conflict") from exc
    if type(value) is not dict or observed.data != canonical_json_bytes(value):
        _fail("history_conflict")
    return value


def _assert_no_indeterminate(root_fd: int, *, allow_lock: bool = False) -> None:
    try:
        names = set(os.listdir(root_fd))
    except OSError as exc:
        raise OperatorSessionError("history_conflict") from exc
    if "OPERATOR_SESSION_INDETERMINATE" in names or (
        not allow_lock and OPERATOR_SESSION_LOCK_NAME in names
    ):
        _fail("history_conflict")


def _find_unique_name(root_fd: int, *, prefix: str, suffix: str = ".json") -> str:
    try:
        names = [
            name
            for name in os.listdir(root_fd)
            if type(name) is str and name.startswith(prefix) and name.endswith(suffix)
        ]
    except OSError as exc:
        raise OperatorSessionError("history_conflict") from exc
    if len(names) != 1:
        _fail("history_conflict")
    return names[0]


def _active_resume_name(root_fd: int, *, allow_lock: bool = False) -> str:
    _assert_no_indeterminate(root_fd, allow_lock=allow_lock)
    try:
        names = os.listdir(root_fd)
    except OSError as exc:
        raise OperatorSessionError("history_conflict") from exc
    if any(type(name) is not str for name in names):
        _fail("history_conflict")
    current = [
        name
        for name in names
        if name.startswith(CURRENT_RESUME_PREFIX) and name.endswith(".json")
    ]
    # Synthetic backwards-compatibility only: PR #28 never initialized a real
    # session, but older tests can still exercise one v1-style resume name.
    legacy = [
        name
        for name in names
        if name.startswith("resume-g") and name.endswith(".json")
    ]
    active = current + legacy
    if len(active) == 1:
        return active[0]
    _fail("history_conflict")


def _load_authorization_by_sha(root_fd: int, authorization_sha256: str) -> Mapping[str, Any]:
    _sha(authorization_sha256)
    matches: list[Mapping[str, Any]] = []
    for name in os.listdir(root_fd):
        if type(name) is not str or not name.startswith("authorization-root-") or not name.endswith(".json"):
            continue
        record = _load_private_json_at(root_fd, name)
        if sha256_bytes(canonical_json_bytes(record)) == authorization_sha256:
            matches.append(record)
    if len(matches) != 1:
        _fail("history_conflict")
    return matches[0]


def _validate_loaded_resume_record(
    record: Mapping[str, Any],
    *,
    authorization_sha256: str,
    expected_operator_identity: str | None = None,
) -> Mapping[str, Any]:
    _sha(authorization_sha256)
    if expected_operator_identity is not None:
        _safe_identity(expected_operator_identity)
    expected_keys = {
        "annotation_root",
        "artifact_kind",
        "authorization_sha256",
        "authoring_session_identity",
        "capture",
        "execution_checkout_sha",
        "format_version",
        "operator_session_procedure_identity_sha256",
        "primary_operator_identity",
        "procedure_identity_sha256",
        "python_identity_sha256",
        "resume_checkpoint_sha256",
        "resume_generation",
        "resume_release_token",
    }
    successor_keys = expected_keys | {"predecessor"}
    legacy_keys = expected_keys | {"operator_identity", "session_id"}
    record_keys = set(record)
    if record_keys != expected_keys and record_keys != successor_keys and record_keys != legacy_keys:
        _fail("history_conflict")
    if (
        record["artifact_kind"] != RESUME_KIND
        or type(record["format_version"]) is not int
        or record["format_version"] not in {FORMAT_VERSION, RESUME_FORMAT_VERSION}
    ):
        _fail("history_conflict")
    capture = record["capture"]
    if (
        type(capture) is not dict
        or set(capture)
        != {"capture_manifest_sha256", "evidence_run_id", "opaque_index_sha256", "raw_toc_sha256"}
        or record["authorization_sha256"] != authorization_sha256
        or type(record["resume_generation"]) is not int
        or record["resume_generation"] <= 0
        or type(record["resume_checkpoint_sha256"]) is not str
        or HEX64_RE.fullmatch(record["resume_checkpoint_sha256"]) is None
        or type(record["resume_release_token"]) is not str
        or HEX64_RE.fullmatch(record["resume_release_token"]) is None
        or type(record["primary_operator_identity"]) is not str
        or SAFE_IDENTITY_RE.fullmatch(record["primary_operator_identity"]) is None
        or type(record["authoring_session_identity"]) is not str
        or SAFE_SESSION_RE.fullmatch(record["authoring_session_identity"]) is None
    ):
        _fail("history_conflict")
    for value in (
        capture["capture_manifest_sha256"],
        capture["opaque_index_sha256"],
        capture["raw_toc_sha256"],
        record["procedure_identity_sha256"],
        record["operator_session_procedure_identity_sha256"],
        record["python_identity_sha256"],
    ):
        _sha(value)
    if "predecessor" in record:
        predecessor = record["predecessor"]
        if (
            type(predecessor) is not dict
            or set(predecessor) != {"action", "action_authorization_sha256", "resume_name", "resume_sha256"}
            or predecessor["action"] not in (AUTHOR.ACTION_VALUES - {"initialize"})
            or type(predecessor["resume_name"]) is not str
            or SAFE_CAPTURE_NAME_RE.fullmatch(predecessor["resume_name"]) is None
        ):
            _fail("history_conflict")
        _sha(predecessor["action_authorization_sha256"])
        _sha(predecessor["resume_sha256"])
    _safe_session(capture["evidence_run_id"])
    _git_sha(record["execution_checkout_sha"])
    if (
        expected_operator_identity is not None
        and record["primary_operator_identity"] != expected_operator_identity
    ):
        _fail("history_conflict")
    return record


def validate_resume_record_at(
    root_fd: int,
    name: str,
    *,
    authorization_sha256: str,
    expected_generation: int,
    expected_checkpoint_sha256: str,
    expected_operator_identity: str,
    expected_session_id: str | None = None,
) -> str:
    """Return the private release token for an exact descriptor-bound resume."""

    if type(expected_generation) is not int or expected_generation <= 0:
        _fail("input_invalid")
    _sha(expected_checkpoint_sha256)
    record = _validate_loaded_resume_record(
        _load_private_json_at(root_fd, name),
        authorization_sha256=authorization_sha256,
        expected_operator_identity=expected_operator_identity,
    )
    if (
        record["resume_generation"] != expected_generation
        or record["resume_checkpoint_sha256"] != expected_checkpoint_sha256
        or (
            expected_session_id is not None
            and record.get("session_id") != expected_session_id
        )
    ):
        _fail("history_conflict")
    return record["resume_release_token"]


def _acquire_session_lock(root_fd: int) -> str:
    _assert_no_indeterminate(root_fd)
    token = secrets.token_hex(32)
    payload = b"OPERATOR_SESSION_LOCK_V1 " + token.encode("ascii") + b"\n"
    descriptor = -1
    try:
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_CLOEXEC", 0)
        flags |= getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(OPERATOR_SESSION_LOCK_NAME, flags, 0o400, dir_fd=root_fd)
        if os.write(descriptor, payload) != len(payload):
            raise OSError("short operator lock write")
        os.fsync(descriptor)
        os.close(descriptor)
        descriptor = -1
        os.fsync(root_fd)
    except FileExistsError as exc:
        raise OperatorSessionError("history_conflict") from exc
    except OSError as exc:
        try:
            if descriptor >= 0:
                os.close(descriptor)
        except OSError:
            pass
        _mark_session_indeterminate(root_fd)
        raise OperatorSessionError("cleanup_indeterminate") from exc
    return token


def _release_session_lock(root_fd: int, token: str) -> None:
    expected = b"OPERATOR_SESSION_LOCK_V1 " + token.encode("ascii") + b"\n"
    descriptor = -1
    try:
        flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(OPERATOR_SESSION_LOCK_NAME, flags, dir_fd=root_fd)
        before = os.fstat(descriptor)
        content = os.read(descriptor, len(expected) + 1)
        after = os.fstat(descriptor)
        if (
            not stat.S_ISREG(before.st_mode)
            or before.st_uid != os.geteuid()
            or before.st_nlink != 1
            or stat.S_IMODE(before.st_mode) != 0o400
            or before.st_size != len(expected)
            or content != expected
            or (
                before.st_dev,
                before.st_ino,
                before.st_mode,
                before.st_nlink,
                before.st_uid,
                before.st_gid,
                before.st_size,
                before.st_mtime_ns,
                before.st_ctime_ns,
            )
            != (
                after.st_dev,
                after.st_ino,
                after.st_mode,
                after.st_nlink,
                after.st_uid,
                after.st_gid,
                after.st_size,
                after.st_mtime_ns,
                after.st_ctime_ns,
            )
        ):
            raise OSError("operator session lock changed")
        os.close(descriptor)
        descriptor = -1
        os.link(
            OPERATOR_SESSION_LOCK_NAME,
            OPERATOR_SESSION_RELEASED_NAME,
            src_dir_fd=root_fd,
            dst_dir_fd=root_fd,
            follow_symlinks=False,
        )
        os.fsync(root_fd)
        os.unlink(OPERATOR_SESSION_LOCK_NAME, dir_fd=root_fd)
        os.fsync(root_fd)
        os.unlink(OPERATOR_SESSION_RELEASED_NAME, dir_fd=root_fd)
        os.fsync(root_fd)
    except OSError as exc:
        if descriptor >= 0:
            try:
                os.close(descriptor)
            except OSError:
                pass
        _mark_session_indeterminate(root_fd)
        raise OperatorSessionError("cleanup_indeterminate") from exc


def _retire_resume_record(root_fd: int, current_name: str, successor_sha256: str) -> None:
    if not current_name.startswith((CURRENT_RESUME_PREFIX, "resume-g")):
        _fail("history_conflict")
    _sha(successor_sha256)
    generation_match = re.search(r"g([0-9]{16})-", current_name)
    if generation_match is None:
        _fail("history_conflict")
    retired = (
        RETIRED_RESUME_PREFIX
        + generation_match.group(1)
        + "-"
        + successor_sha256[:16]
        + ".json"
    )
    try:
        os.link(current_name, retired, src_dir_fd=root_fd, dst_dir_fd=root_fd, follow_symlinks=False)
        os.fsync(root_fd)
        os.unlink(current_name, dir_fd=root_fd)
        os.fsync(root_fd)
    except OSError as exc:
        _mark_session_indeterminate(root_fd)
        raise OperatorSessionError("cleanup_indeterminate") from exc


def _mark_session_indeterminate(root_fd: int) -> None:
    marker = "OPERATOR_SESSION_INDETERMINATE"
    descriptor = -1
    try:
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_CLOEXEC", 0)
        flags |= getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(marker, flags, 0o400, dir_fd=root_fd)
        payload = b"OPERATOR_SESSION_INDETERMINATE\n"
        os.write(descriptor, payload)
        os.fsync(descriptor)
        os.close(descriptor)
        descriptor = -1
        os.fsync(root_fd)
    except OSError:
        pass
    finally:
        if descriptor >= 0:
            try:
                os.close(descriptor)
            except OSError:
                pass


def _read_line(tty_fd: int, prompt: bytes, *, echo: bool = False) -> str:
    if not prompt.endswith(b": "):
        _fail("internal_failure")
    data = bytearray()
    old = None
    pending_error: BaseException | None = None
    try:
        _tty_write(tty_fd, prompt)
        old = termios.tcgetattr(tty_fd)
        if not echo:
            new = list(old)
            new[3] = new[3] & ~termios.ECHO
            termios.tcsetattr(tty_fd, termios.TCSADRAIN, new)
        while len(data) <= MAX_OPERATOR_INPUT_BYTES:
            chunk = os.read(tty_fd, 1)
            if chunk in {b"", b"\n", b"\r"}:
                break
            data.extend(chunk)
        else:
            _fail("input_invalid")
    except BaseException as exc:
        pending_error = exc
    finally:
        try:
            if old is not None:
                termios.tcsetattr(tty_fd, termios.TCSADRAIN, old)
            if not echo:
                _tty_write(tty_fd, b"\n")
        except BaseException as exc:
            if pending_error is None:
                pending_error = exc
    if pending_error is not None:
        if isinstance(pending_error, OperatorSessionError):
            raise pending_error
        raise OperatorSessionError("tty_invalid") from pending_error
    try:
        value = bytes(data).decode("utf-8", errors="strict")
    except UnicodeError as exc:
        raise OperatorSessionError("input_invalid") from exc
    if any(ord(character) < 0x20 or ord(character) == 0x7F for character in value):
        _fail("input_invalid")
    return value


def _tty_write(tty_fd: int, payload: bytes) -> None:
    if any(byte > 0x7F for byte in payload):
        _fail("internal_failure")
    remaining = memoryview(payload)
    try:
        while remaining:
            written = os.write(tty_fd, remaining)
            if (
                type(written) is not int
                or written <= 0
                or written > len(remaining)
            ):
                raise OSError("incomplete private TTY write")
            remaining = remaining[written:]
    except OSError as exc:
        raise OperatorSessionError("tty_invalid") from exc


def _prompt_choice(tty_fd: int, prompt: bytes, allowed: frozenset[str]) -> str:
    if not prompt.endswith(b": "):
        prompt = prompt + b": "
    value = _read_line(tty_fd, prompt, echo=False)
    if value not in allowed:
        _fail("input_invalid")
    return value


def _validated_python_identity(record: Mapping[str, Any]) -> dict[str, Any]:
    path = _validate_absolute_path(str(record["path"]), must_exist=True)
    expected_sha = _sha(str(record["sha256"]))
    expected_version = str(record["version"])
    if PYTHON_VERSION_RE.fullmatch(expected_version) is None:
        _fail("binding_mismatch")
    try:
        metadata = os.stat(path, follow_symlinks=False)
    except OSError as exc:
        raise OperatorSessionError("binding_mismatch") from exc
    if (
        not stat.S_ISREG(metadata.st_mode)
        or stat.S_ISLNK(metadata.st_mode)
        or metadata.st_nlink != 1
        or metadata.st_mode & 0o7022
        or metadata.st_mode & 0o100 == 0
    ):
        _fail("binding_mismatch")
    try:
        with open(path, "rb") as handle:
            digest = hashlib.sha256(handle.read()).hexdigest()
    except OSError as exc:
        raise OperatorSessionError("binding_mismatch") from exc
    if digest != expected_sha:
        _fail("binding_mismatch")
    reported = f"{sys.implementation.name}:{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    if os.path.realpath(path) != os.path.realpath(sys.executable) or reported != expected_version:
        _fail("binding_mismatch")
    identity = {
        "device": metadata.st_dev,
        "executable_path": os.fspath(path),
        "gid": metadata.st_gid,
        "inode": metadata.st_ino,
        "mode": format(stat.S_IMODE(metadata.st_mode), "04o"),
        "reported_version": reported,
        "sha256": digest,
        "size_bytes": metadata.st_size,
        "uid": metadata.st_uid,
    }
    identity["identity_sha256"] = sha256_bytes(canonical_json_bytes(identity))
    return identity


def _reject_ai_peer_identity(identity: str) -> None:
    if AI_PEER_RE.search(identity) is not None:
        _fail("binding_mismatch")


def _new_session_identity(prefix: str) -> str:
    return _safe_session(prefix + "-" + secrets.token_hex(12))


def _execution_from_preflight(verified: Any) -> dict[str, Any]:
    python = verified.profile["python_policy"]
    return {
        "approved_checkout_sha": verified.approved_checkout_sha,
        "approved_operator_session_procedure_identity_sha256": (
            verified.operator_session_procedure_identity_sha256
        ),
        "approved_procedure_identity_sha256": (
            verified.authoring_procedure_identity_sha256
        ),
        "python": {
            "path": python["absolute_path"],
            "sha256": python["sha256"],
            "version": python["reported_version"],
        },
    }


def _consequence_challenge(record: Mapping[str, Any], nonce: bytes) -> str:
    if len(nonce) != 16:
        _fail("internal_failure")
    digest = hashlib.sha256(
        nonce + PREFLIGHT.canonical_json_bytes(record)
    ).digest()[:CONSEQUENCE_CHALLENGE_BYTES]
    encoded = base64.b32encode(digest).decode("ascii").rstrip("=")
    if len(encoded) != 8:
        _fail("internal_failure")
    return encoded[:4] + "-" + encoded[4:]


def _consequence_effects(action: str) -> tuple[str, ...]:
    if action == "initialize":
        return (
            "open approved capture metadata after authorization",
            "create one private operator-session root",
            "create one private annotation root",
            "publish one immutable root authorization",
            "publish generation-one checkpoint and resume records",
            "stop after initialization",
        )
    if action == "finalize":
        return (
            "open the approved private root",
            "consume one current resume record",
            "publish one immutable action authorization",
            "publish one unvalidated final-ledger candidate and terminal resume",
            "retire the predecessor only after a durable terminal successor",
            "stop after finalization without validation",
        )
    if action == "status":
        return (
            "open the approved private root",
            "consume one current resume record",
            "publish one immutable action authorization",
            "read aggregate checkpoint status without changing decisions",
            "publish one successor resume bound to the unchanged checkpoint",
            "retire the predecessor only after a durable successor",
            "stop after status",
        )
    return (
        "open the approved private root",
        "consume one current resume record",
        "publish one immutable action authorization",
        "publish at most one successor checkpoint and resume",
        "retire the predecessor only after a durable successor",
        "stop after exactly one action",
    )


def _consequence_record(
    authorization: Mapping[str, Any],
    verified: Any,
) -> dict[str, Any]:
    action = authorization["action"]
    expected_state = authorization.get(
        "expected_authoring_state", "UNINITIALIZED"
    )
    policy = verified.profile["action_state_matrix"][action]
    return {
        "action": action,
        "approval_sha256": verified.approval_sha256,
        "approved_checkout_sha": verified.approved_checkout_sha,
        "current_operator_identity": authorization["operator_identity"],
        "expected_authoring_state": expected_state,
        "failure_boundary": (
            "ambiguous_publication_cleanup_acknowledgement_or_lock_release_blocks"
        ),
        "invocation_session_identity": authorization["session_id"],
        "maximum_entry_decisions": policy["max_entry_decisions"],
        "one_action_boundary": True,
        "private_effects": list(_consequence_effects(action)),
        "profile_sha256": verified.profile_sha256,
    }


def _authorize_consequence(
    tty_fd: int,
    authorization: Mapping[str, Any],
    verified: Any,
    gate: ConsequenceGate,
) -> None:
    if gate.consumed:
        _fail("input_invalid")
    gate.consumed = True
    action = authorization["action"]
    record = _consequence_record(authorization, verified)
    expected_state = record["expected_authoring_state"]
    maximum = record["maximum_entry_decisions"]
    nonce = secrets.token_bytes(16)
    challenge = _consequence_challenge(record, nonce)
    phrase = (
        "AUTHORIZE "
        + action.upper()
        + " "
        + str(maximum)
        + " "
        + challenge
    )
    effect_lines = "".join(
        "- " + effect + "\n" for effect in record["private_effects"]
    )
    summary = (
        "ACTION: " + action + "\n"
        "EXPECTED STATE: " + expected_state + "\n"
        "MAX ENTRY DECISIONS: " + str(maximum) + "\n"
        "PRIVATE EFFECTS:\n"
        + effect_lines
        + "- ambiguous publication, cleanup, acknowledgement, or lock release blocks the session\n"
        + "NO OTHER ACTION AUTHORIZED\n"
        + "TYPE EXACTLY: "
        + phrase
        + "\n"
    ).encode("ascii")
    PREFLIGHT.verify_tty(tty_fd)
    _tty_write(tty_fd, summary)
    observed = _read_line(
        tty_fd,
        b"consequence_authorization: ",
        echo=False,
    )
    PREFLIGHT.verify_tty(tty_fd)
    if not secrets.compare_digest(observed, phrase):
        _fail("input_invalid")


def _verification_summary(tty_fd: int, verified: Any) -> None:
    labels = (
        ("repository_verified", b"Repository verified\n"),
        ("python_verified", b"Python verified\n"),
        ("procedure_identities_verified", b"Procedure identities verified\n"),
        ("checkout_verified", b"Checkout verified\n"),
        ("reviewed_files_verified", b"Reviewed files verified\n"),
        ("tty_verified", b"TTY verified\n"),
    )
    for key, line in labels:
        if verified.summary.get(key) is not True:
            _fail("binding_mismatch")
        _tty_write(tty_fd, line)


def _prompt_initialize_authorization(tty_fd: int, verified: Any) -> dict[str, Any]:
    _tty_write(
        tty_fd,
        b"toc_authoring_operator_session\n"
        b"type_private_capture_bindings_manually_no_clipboard_no_history_no_recording\n",
    )
    primary = _safe_identity(_read_line(tty_fd, b"primary_operator_identity: "))
    operator = _safe_identity(_read_line(tty_fd, b"current_operator_identity: "))
    if primary != operator:
        _fail("binding_mismatch")
    session_id = _new_session_identity("toc-operator")
    authoring_session = _new_session_identity("toc-authoring")
    session_root = verified.operator_session_root_path
    annotation_root = os.fspath(
        _validate_absolute_path_lexical(
            _read_line(tty_fd, b"annotation_root: ")
        )
    )
    capture_root = os.fspath(_validate_absolute_path_lexical(_read_line(tty_fd, b"capture_root: ")))
    capture_name = _safe_capture_name(_read_line(tty_fd, b"capture_name: "))
    authorization = {
        "action": "initialize",
        "annotation_root": annotation_root,
        "artifact_kind": AUTHORIZATION_KIND,
        "authoring_session_identity": authoring_session,
        "capture": {
            "approved_pg_restore_sha256": _sha(_read_line(tty_fd, b"approved_pg_restore_sha256: ")),
            "capture_execution_checkout_sha": _git_sha(_read_line(tty_fd, b"capture_execution_checkout_sha: ")),
            "capture_manifest_sha256": _sha(_read_line(tty_fd, b"capture_manifest_sha256: ")),
            "capture_name": capture_name,
            "capture_procedure_identity_sha256": _sha(_read_line(tty_fd, b"capture_procedure_identity_sha256: ")),
            "capture_root": capture_root,
            "data_reference_count": _count(_read_line(tty_fd, b"data_reference_count: "), allow_zero=True),
            "entry_count": _count(_read_line(tty_fd, b"entry_count: ")),
            "evidence_manifest_sha256": _sha(_read_line(tty_fd, b"evidence_manifest_sha256: ")),
            "evidence_run_id": _safe_session(_read_line(tty_fd, b"evidence_run_id: ")),
            "inner_sha256": _sha(_read_line(tty_fd, b"inner_sha256: ")),
            "inspection_checkout_sha": _git_sha(_read_line(tty_fd, b"inspection_checkout_sha: ")),
            "inspection_procedure_sha256": _sha(_read_line(tty_fd, b"inspection_procedure_sha256: ")),
            "opaque_index_sha256": _sha(_read_line(tty_fd, b"opaque_index_sha256: ")),
            "outer_sha256": _sha(_read_line(tty_fd, b"outer_sha256: ")),
            "raw_toc_sha256": _sha(_read_line(tty_fd, b"raw_toc_sha256: ")),
        },
        "execution": _execution_from_preflight(verified),
        "finalization_authorization": "",
        "format_version": FORMAT_VERSION,
        "initial_head": {
            "checkpoint_sha256": "0" * 64,
            "generation": 0,
            "release_token": INITIAL_RELEASE_TOKEN,
        },
        "operator_identity": operator,
        "primary_operator_identity": primary,
        "session_id": session_id,
        "session_root": session_root,
        "tty_attestation": TTY_ATTESTATION,
    }
    return authorization


def _environment_from_authorization(
    authorization: Mapping[str, Any],
    *,
    base_authorization: Mapping[str, Any] | None = None,
    resume: Mapping[str, Any] | None = None,
) -> dict[str, str]:
    source = authorization if base_authorization is None else base_authorization
    if resume is None:
        initial = authorization["initial_head"]
        expected_generation = str(initial["generation"])
        expected_head = initial["checkpoint_sha256"]
        expected_release = initial["release_token"]
    else:
        expected_generation = str(resume["resume_generation"])
        expected_head = resume["resume_checkpoint_sha256"]
        expected_release = resume["resume_release_token"]
    capture = source["capture"]
    execution = authorization["execution"]
    python = execution["python"]
    environment = {
        "TOC_AUTHOR_ACTION": authorization["action"],
        "TOC_AUTHOR_EXECUTION_PYTHON": python["path"],
        "TOC_AUTHOR_APPROVED_EXECUTION_PYTHON_SHA256": python["sha256"],
        "TOC_AUTHOR_APPROVED_EXECUTION_PYTHON_VERSION": python["version"],
        "TOC_AUTHOR_APPROVED_EXECUTION_CHECKOUT_SHA": execution["approved_checkout_sha"],
        "TOC_AUTHOR_CAPTURE_ROOT": capture["capture_root"],
        "TOC_AUTHOR_CAPTURE_NAME": capture["capture_name"],
        "TOC_AUTHOR_PRIVATE_ROOT": authorization["annotation_root"],
        "TOC_AUTHOR_EXPECTED_CAPTURE_MANIFEST_SHA256": capture["capture_manifest_sha256"],
        "TOC_AUTHOR_EXPECTED_RAW_TOC_SHA256": capture["raw_toc_sha256"],
        "TOC_AUTHOR_EXPECTED_OPAQUE_INDEX_SHA256": capture["opaque_index_sha256"],
        "TOC_AUTHOR_EXPECTED_ENTRY_COUNT": str(capture["entry_count"]),
        "TOC_AUTHOR_EXPECTED_DATA_REFERENCE_COUNT": str(capture["data_reference_count"]),
        "TOC_AUTHOR_EVIDENCE_RUN_ID": capture["evidence_run_id"],
        "TOC_AUTHOR_OUTER_SHA256": capture["outer_sha256"],
        "TOC_AUTHOR_INNER_SHA256": capture["inner_sha256"],
        "TOC_AUTHOR_EVIDENCE_MANIFEST_SHA256": capture["evidence_manifest_sha256"],
        "TOC_AUTHOR_INSPECTION_CHECKOUT_SHA": capture["inspection_checkout_sha"],
        "TOC_AUTHOR_INSPECTION_PROCEDURE_SHA256": capture["inspection_procedure_sha256"],
        "TOC_AUTHOR_CAPTURE_EXECUTION_CHECKOUT_SHA": capture["capture_execution_checkout_sha"],
        "TOC_AUTHOR_EXPECTED_CAPTURE_PROCEDURE_IDENTITY_SHA256": capture["capture_procedure_identity_sha256"],
        "TOC_AUTHOR_APPROVED_PG_RESTORE_SHA256": capture["approved_pg_restore_sha256"],
        "TOC_AUTHOR_PRIMARY_OPERATOR_IDENTITY": authorization["primary_operator_identity"],
        "TOC_AUTHOR_OPERATOR_IDENTITY": authorization["operator_identity"],
        "TOC_AUTHOR_SESSION_IDENTITY": authorization["authoring_session_identity"],
        "TOC_AUTHOR_EXPECTED_HEAD_GENERATION": expected_generation,
        "TOC_AUTHOR_EXPECTED_HEAD_SHA256": expected_head,
        "TOC_AUTHOR_EXPECTED_RELEASE_TOKEN": expected_release,
        "TOC_AUTHOR_LOCAL_TTY_ATTESTATION": authorization["tty_attestation"],
        "TOC_AUTHOR_FINALIZATION_AUTHORIZATION": authorization["finalization_authorization"],
    }
    if "expected_authoring_state" in authorization:
        environment["TOC_AUTHOR_EXPECTED_REVIEW_STATE"] = authorization["expected_authoring_state"]
    return environment


def _procedure_identity(approved_checkout: str) -> str:
    return AUTHOR._authoring_procedure_identity(approved_checkout)


def _operator_session_procedure_identity(approved_checkout: str) -> str:
    records: dict[str, str] = {"execution_checkout_sha": approved_checkout}
    for relative in (
        "scripts/migration/author-lovable-toc-annotations.py",
        "scripts/migration/author-lovable-toc-operator-session.py",
        "scripts/migration/lib/lovable_toc_authoring_contract.py",
        "scripts/migration/lib/lovable_toc_contract.py",
        "scripts/migration/lib/lovable_toc_operator_preflight.py",
        "scripts/migration/run-lovable-toc-annotation-authoring.sh",
        "scripts/migration/run-lovable-toc-annotation-operator-session.sh",
        "scripts/migration/verification/lovable-toc-operator-execution-profile-approval.schema.json",
        "scripts/migration/verification/lovable-toc-operator-execution-profile.schema.json",
        "scripts/migration/verification/lovable-toc-operator-execution-profile.v1.json",
        "scripts/migration/verification/lovable-toc-operator-session-authorization.schema.json",
        "scripts/migration/verification/lovable-toc-operator-session-resume.schema.json",
    ):
        try:
            blob = subprocess.run(
                [
                    _REVIEWED_GIT,
                    *_REVIEWED_GIT_CONFIG,
                    "rev-parse",
                    f"{approved_checkout}:{relative}",
                ],
                cwd=REPO,
                check=True,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                env=dict(_REVIEWED_GIT_ENVIRONMENT),
                timeout=20,
            ).stdout.strip().decode("ascii")
        except BaseException as exc:
            raise OperatorSessionError("binding_mismatch") from exc
        if not _is_git_sha(blob):
            _fail("binding_mismatch")
        records[relative] = blob
    return sha256_bytes(canonical_json_bytes(records))


def _legacy_root_matches(
    base_authorization: Mapping[str, Any],
    bridge: Mapping[str, Any],
) -> bool:
    try:
        execution = base_authorization["execution"]
        python = execution["python"]
        capture = base_authorization["capture"]
        exact_root_keys = {
            "action",
            "annotation_root",
            "artifact_kind",
            "authoring_session_identity",
            "capture",
            "execution",
            "finalization_authorization",
            "format_version",
            "initial_head",
            "operator_identity",
            "primary_operator_identity",
            "session_id",
            "session_root",
            "tty_attestation",
        }
        exact_capture_keys = {
            "approved_pg_restore_sha256",
            "capture_execution_checkout_sha",
            "capture_manifest_sha256",
            "capture_name",
            "capture_procedure_identity_sha256",
            "capture_root",
            "data_reference_count",
            "entry_count",
            "evidence_manifest_sha256",
            "evidence_run_id",
            "inner_sha256",
            "inspection_checkout_sha",
            "inspection_procedure_sha256",
            "opaque_index_sha256",
            "outer_sha256",
            "raw_toc_sha256",
        }
        capture_sha_keys = {
            "approved_pg_restore_sha256",
            "capture_manifest_sha256",
            "capture_procedure_identity_sha256",
            "evidence_manifest_sha256",
            "inner_sha256",
            "inspection_procedure_sha256",
            "opaque_index_sha256",
            "outer_sha256",
            "raw_toc_sha256",
        }
        return (
            set(base_authorization) == exact_root_keys
            and base_authorization["artifact_kind"] == AUTHORIZATION_KIND
            and type(base_authorization["format_version"]) is int
            and base_authorization["format_version"] == FORMAT_VERSION
            and base_authorization["action"] == "initialize"
            and base_authorization["finalization_authorization"] == ""
            and base_authorization["operator_identity"]
            == base_authorization["primary_operator_identity"]
            and base_authorization["tty_attestation"] == TTY_ATTESTATION
            and type(base_authorization["initial_head"]) is dict
            and type(base_authorization["initial_head"].get("generation")) is int
            and base_authorization["initial_head"]
            == {
                "checkpoint_sha256": INITIAL_RELEASE_TOKEN,
                "generation": 0,
                "release_token": INITIAL_RELEASE_TOKEN,
            }
            and set(execution)
            == {
                "approved_checkout_sha",
                "approved_operator_session_procedure_identity_sha256",
                "approved_procedure_identity_sha256",
                "python",
            }
            and set(python) == {"path", "sha256", "version"}
            and type(capture) is dict
            and set(capture) == exact_capture_keys
            and all(
                type(capture[key]) is str
                and HEX64_RE.fullmatch(capture[key]) is not None
                for key in capture_sha_keys
            )
            and type(capture["capture_execution_checkout_sha"]) is str
            and GIT_SHA_RE.fullmatch(
                capture["capture_execution_checkout_sha"]
            )
            is not None
            and type(capture["inspection_checkout_sha"]) is str
            and GIT_SHA_RE.fullmatch(capture["inspection_checkout_sha"])
            is not None
            and type(capture["capture_name"]) is str
            and SAFE_CAPTURE_NAME_RE.fullmatch(capture["capture_name"])
            is not None
            and type(capture["evidence_run_id"]) is str
            and SAFE_SESSION_RE.fullmatch(capture["evidence_run_id"])
            is not None
            and type(capture["entry_count"]) is int
            and capture["entry_count"] > 0
            and type(capture["data_reference_count"]) is int
            and 0
            <= capture["data_reference_count"]
            <= capture["entry_count"]
            and os.fspath(
                _validate_absolute_path_lexical(capture["capture_root"])
            )
            == capture["capture_root"]
            and os.fspath(
                _validate_absolute_path_lexical(
                    base_authorization["annotation_root"]
                )
            )
            == base_authorization["annotation_root"]
            and os.fspath(
                _validate_absolute_path_lexical(
                    base_authorization["session_root"]
                )
            )
            == base_authorization["session_root"]
            and SAFE_IDENTITY_RE.fullmatch(
                base_authorization["primary_operator_identity"]
            )
            is not None
            and SAFE_IDENTITY_RE.fullmatch(
                base_authorization["operator_identity"]
            )
            is not None
            and SAFE_SESSION_RE.fullmatch(
                base_authorization["authoring_session_identity"]
            )
            is not None
            and SAFE_SESSION_RE.fullmatch(base_authorization["session_id"])
            is not None
            and execution["approved_checkout_sha"]
            == bridge["execution_checkout_sha"]
            and execution["approved_procedure_identity_sha256"]
            == bridge["authoring_procedure_identity_sha256"]
            and execution["approved_operator_session_procedure_identity_sha256"]
            == bridge["operator_session_procedure_identity_sha256"]
            and python["path"] == bridge["python"]["absolute_path"]
            and python["sha256"] == bridge["python"]["sha256"]
            and python["version"] == bridge["python"]["reported_version"]
        )
    except (KeyError, TypeError, OperatorSessionError):
        return False


def _require_pristine_legacy_session_root(
    root_fd: int,
    *,
    root_authorization_sha256: str,
    resume_name: str,
) -> None:
    _sha(root_authorization_sha256)
    expected = {
        OPERATOR_SESSION_LOCK_NAME,
        "authorization-root-" + root_authorization_sha256[:16] + ".json",
        resume_name,
    }
    try:
        names = os.listdir(root_fd)
    except OSError as exc:
        raise OperatorSessionError("history_conflict") from exc
    if (
        any(type(name) is not str for name in names)
        or len(names) != len(set(names))
        or set(names) != expected
    ):
        _fail("history_conflict")


def _current_resume_shape_matches(
    resume: Mapping[str, Any], resume_name: str
) -> bool:
    base_keys = {
        "annotation_root",
        "artifact_kind",
        "authorization_sha256",
        "authoring_session_identity",
        "capture",
        "execution_checkout_sha",
        "format_version",
        "operator_session_procedure_identity_sha256",
        "primary_operator_identity",
        "procedure_identity_sha256",
        "python_identity_sha256",
        "resume_checkpoint_sha256",
        "resume_generation",
        "resume_release_token",
    }
    successor_keys = base_keys | {"predecessor"}
    if (
        type(resume.get("format_version")) is not int
        or resume.get("format_version") != RESUME_FORMAT_VERSION
        or type(resume.get("resume_generation")) is not int
        or type(resume.get("resume_checkpoint_sha256")) is not str
        or HEX64_RE.fullmatch(resume["resume_checkpoint_sha256"]) is None
    ):
        return False
    has_predecessor = "predecessor" in resume
    if set(resume) != (successor_keys if has_predecessor else base_keys):
        return False
    base_name = (
        CURRENT_RESUME_PREFIX
        + f"{resume['resume_generation']:016d}-"
        + resume["resume_checkpoint_sha256"]
    )
    if not has_predecessor:
        return resume_name == base_name + ".json"
    predecessor = resume["predecessor"]
    if (
        type(predecessor) is not dict
        or set(predecessor)
        != {
            "action",
            "action_authorization_sha256",
            "resume_name",
            "resume_sha256",
        }
    ):
        return False
    expected_sha256 = sha256_bytes(canonical_json_bytes(resume))
    return resume_name == base_name + "-" + expected_sha256[:16] + ".json"


def _root_resume_capture_binding(
    base_authorization: Mapping[str, Any],
) -> dict[str, str]:
    try:
        root_capture = base_authorization["capture"]
        expected = {
            "capture_manifest_sha256": root_capture["capture_manifest_sha256"],
            "evidence_run_id": root_capture["evidence_run_id"],
            "opaque_index_sha256": root_capture["opaque_index_sha256"],
            "raw_toc_sha256": root_capture["raw_toc_sha256"],
        }
    except (KeyError, TypeError) as exc:
        raise OperatorSessionError("history_conflict") from exc
    if (
        type(root_capture) is not dict
        or type(expected["evidence_run_id"]) is not str
        or SAFE_SESSION_RE.fullmatch(expected["evidence_run_id"]) is None
    ):
        _fail("history_conflict")
    for key in (
        "capture_manifest_sha256",
        "opaque_index_sha256",
        "raw_toc_sha256",
    ):
        if type(expected[key]) is not str or HEX64_RE.fullmatch(expected[key]) is None:
            _fail("history_conflict")
    return expected


def _stable_canonical_private_json_at(
    root_fd: int, name: str
) -> tuple[Mapping[str, Any], Any]:
    try:
        observed = stable_private_file_at(
            root_fd,
            name,
            max_bytes=MAX_RECORD_BYTES,
            exact_mode=0o400,
        )
        value = strict_json_loads(observed.data, max_bytes=MAX_RECORD_BYTES)
    except ContractError as exc:
        raise OperatorSessionError("history_conflict") from exc
    if type(value) is not dict or observed.data != canonical_json_bytes(value):
        _fail("history_conflict")
    return value, observed


def _stable_observation_identity(observed: Any) -> tuple[Any, ...]:
    return (
        observed.sha256,
        observed.size,
        observed.device,
        observed.inode,
        observed.owner_uid,
        observed.owner_gid,
        observed.mode,
        observed.data,
    )


def _revalidate_observed_private_json_at(
    root_fd: int,
    name: str,
    expected_value: Mapping[str, Any],
    expected_observed: Any,
) -> None:
    value, observed = _stable_canonical_private_json_at(root_fd, name)
    if (
        value != expected_value
        or _stable_observation_identity(observed)
        != _stable_observation_identity(expected_observed)
    ):
        _fail("history_conflict")


def _relevant_history_names(names: list[str]) -> frozenset[str]:
    return frozenset(
        name
        for name in names
        if name.startswith(
            (
                "authorization-root-",
                "authorization-action-",
                CURRENT_RESUME_PREFIX,
                "resume-g",
                RETIRED_RESUME_PREFIX,
                TERMINAL_RESUME_PREFIX,
            )
        )
        and name.endswith(".json")
    )


def _revalidate_resume_history_at(
    root_fd: int,
    snapshot: ResumeHistorySnapshot,
    *,
    require_pending_action: bool,
) -> None:
    """Re-read every consumed history record before durable publication."""

    try:
        names = os.listdir(root_fd)
    except OSError as exc:
        raise OperatorSessionError("history_conflict") from exc
    if any(type(name) is not str for name in names):
        _fail("history_conflict")
    relevant = _relevant_history_names(names)
    allowed = set(snapshot.relevant_names)
    pending_present = snapshot.pending_action_name in relevant
    if pending_present:
        allowed.add(snapshot.pending_action_name)
    if relevant != frozenset(allowed) or (
        require_pending_action and not pending_present
    ):
        _fail("history_conflict")
    for name, expected_observed in snapshot.record_observations.items():
        if name == snapshot.root_name:
            expected_value = snapshot.root_authorization
        elif name == snapshot.current_name:
            expected_value = snapshot.current_resume
        elif name == snapshot.pending_action_name:
            expected_value = snapshot.pending_action
        else:
            matching = [
                edge.retired_resume
                for edge in snapshot.edges
                if edge.retired_name == name
            ] + [
                edge.action_authorization
                for edge in snapshot.edges
                if edge.action_name == name
            ]
            if len(matching) != 1:
                _fail("history_conflict")
            expected_value = matching[0]
        _revalidate_observed_private_json_at(
            root_fd, name, expected_value, expected_observed
        )
    if pending_present:
        value, observed = _stable_canonical_private_json_at(
            root_fd, snapshot.pending_action_name
        )
        if (
            value != snapshot.pending_action
            or observed.sha256 != snapshot.pending_action_sha256
        ):
            _fail("history_conflict")
        existing = snapshot.record_observations.get(snapshot.pending_action_name)
        if existing is None:
            snapshot.record_observations[snapshot.pending_action_name] = observed
        elif _stable_observation_identity(existing) != _stable_observation_identity(
            observed
        ):
            _fail("history_conflict")


def _historical_evidence_matches(
    *,
    action_authorization: Mapping[str, Any],
    retired_resume: Mapping[str, Any],
    predecessor: Mapping[str, Any],
    successor_resume: Mapping[str, Any],
    base_authorization: Mapping[str, Any],
    expected_execution: Mapping[str, Any],
    expected_python_identity_sha256: str,
    action_state_matrix: Mapping[str, Any],
) -> bool:
    try:
        execution = action_authorization["execution"]
        python = execution["python"]
        resume_reference = action_authorization["resume"]
        expected_action_keys = {
            "action",
            "annotation_root",
            "artifact_kind",
            "authoring_session_identity",
            "capture_binding_sha256",
            "execution",
            "expected_authoring_state",
            "finalization_authorization",
            "format_version",
            "operator_identity",
            "primary_operator_identity",
            "resume",
            "root_authorization_sha256",
            "session_id",
            "session_root",
            "tty_attestation",
        }
        finalization = action_authorization["finalization_authorization"]
        action = action_authorization["action"]
        operator = action_authorization["operator_identity"]
        primary_operator = base_authorization["primary_operator_identity"]
        action_policy = action_state_matrix[action]
        operator_is_valid = (
            operator.casefold() != primary_operator.casefold()
            and AI_PEER_RE.search(operator) is None
            if action == "peer_review"
            else operator == primary_operator
        )
        return (
            set(action_authorization) == expected_action_keys
            and action_authorization["artifact_kind"]
            == ACTION_AUTHORIZATION_KIND
            and type(action_authorization["format_version"]) is int
            and action_authorization["format_version"]
            == ACTION_AUTHORIZATION_FORMAT_VERSION
            and action == predecessor["action"]
            and action in (AUTHOR.ACTION_VALUES - {"initialize", "finalize"})
            and finalization == ""
            and type(action_policy) is dict
            and set(action_policy)
            == {"allowed_expected_states", "max_entry_decisions"}
            and type(action_policy["allowed_expected_states"]) is list
            and action_authorization["expected_authoring_state"]
            in action_policy["allowed_expected_states"]
            and action_authorization["tty_attestation"] == TTY_ATTESTATION
            and action_authorization["annotation_root"]
            == base_authorization["annotation_root"]
            and action_authorization["session_root"]
            == base_authorization["session_root"]
            and action_authorization["primary_operator_identity"]
            == base_authorization["primary_operator_identity"]
            and action_authorization["root_authorization_sha256"]
            == retired_resume["authorization_sha256"]
            and retired_resume["authorization_sha256"]
            == sha256_bytes(canonical_json_bytes(base_authorization))
            and action_authorization["capture_binding_sha256"]
            == sha256_bytes(canonical_json_bytes(base_authorization["capture"]))
            and set(resume_reference)
            == {"checkpoint_sha256", "generation", "name", "sha256"}
            and type(resume_reference["generation"]) is int
            and resume_reference
            == {
                "checkpoint_sha256": retired_resume[
                    "resume_checkpoint_sha256"
                ],
                "generation": retired_resume["resume_generation"],
                "name": predecessor["resume_name"],
                "sha256": predecessor["resume_sha256"],
            }
            and execution == expected_execution
            and set(execution)
            == {
                "approved_checkout_sha",
                "approved_operator_session_procedure_identity_sha256",
                "approved_procedure_identity_sha256",
                "python",
            }
            and set(python) == {"path", "sha256", "version"}
            and successor_resume["execution_checkout_sha"]
            == execution["approved_checkout_sha"]
            and successor_resume["procedure_identity_sha256"]
            == execution["approved_procedure_identity_sha256"]
            and successor_resume[
                "operator_session_procedure_identity_sha256"
            ]
            == execution[
                "approved_operator_session_procedure_identity_sha256"
            ]
            and successor_resume["python_identity_sha256"]
            == expected_python_identity_sha256
            and successor_resume["authoring_session_identity"]
            == action_authorization["authoring_session_identity"]
            and type(operator) is str
            and SAFE_IDENTITY_RE.fullmatch(operator) is not None
            and operator_is_valid
            and type(action_authorization["authoring_session_identity"]) is str
            and SAFE_SESSION_RE.fullmatch(
                action_authorization["authoring_session_identity"]
            )
            is not None
            and type(action_authorization["session_id"]) is str
            and SAFE_SESSION_RE.fullmatch(action_authorization["session_id"])
            is not None
        )
    except (KeyError, TypeError, OperatorSessionError):
        return False


def _verify_predecessor_chain_at(
    root_fd: int,
    *,
    base_authorization: Mapping[str, Any],
    resume: Mapping[str, Any],
    resume_name: str,
    resume_sha256: str,
    expected_execution: Mapping[str, Any],
    expected_python_identity_sha256: str,
    action_state_matrix: Mapping[str, Any],
    execution_mode_name: str,
    compatibility_bridge: Mapping[str, Any] | None,
    pending_action_name: str = "",
    pending_action: Mapping[str, Any] | None = None,
    pending_action_sha256: str = "",
) -> ResumeHistorySnapshot:
    """Descriptor-bind the complete current-to-root immutable resume history."""

    expected_capture = _root_resume_capture_binding(base_authorization)
    _sha(expected_python_identity_sha256)
    if (
        pending_action_name == ""
        and pending_action is None
        and pending_action_sha256 == ""
    ):
        pending_action = {}
    elif (
        type(pending_action_name) is not str
        or not pending_action_name.startswith("authorization-action-")
        or not pending_action_name.endswith(".json")
        or type(pending_action) is not dict
        or _sha(pending_action_sha256)
        != sha256_bytes(canonical_json_bytes(pending_action))
        or pending_action_name
        != "authorization-action-" + pending_action_sha256[:16] + ".json"
    ):
        _fail("history_conflict")
    try:
        names = os.listdir(root_fd)
    except OSError as exc:
        raise OperatorSessionError("history_conflict") from exc
    if any(type(name) is not str for name in names):
        _fail("history_conflict")
    expected_root_sha256 = sha256_bytes(canonical_json_bytes(base_authorization))
    root_name = "authorization-root-" + expected_root_sha256[:16] + ".json"
    retired_names = {
        name for name in names if name.startswith(RETIRED_RESUME_PREFIX)
    }
    action_names = {
        name for name in names if name.startswith("authorization-action-")
    }
    retired_records: dict[str, tuple[Mapping[str, Any], Any]] = {}
    action_records: dict[str, tuple[Mapping[str, Any], Any]] = {}
    for name in names:
        if name.startswith(RETIRED_RESUME_PREFIX):
            retired_records[name] = _stable_canonical_private_json_at(
                root_fd, name
            )
        elif name.startswith("authorization-action-"):
            action_records[name] = _stable_canonical_private_json_at(
                root_fd, name
            )
    root_value, root_observed = _stable_canonical_private_json_at(
        root_fd, root_name
    )
    current_value, current_observed = _stable_canonical_private_json_at(
        root_fd, resume_name
    )
    if (
        root_value != base_authorization
        or root_observed.sha256 != expected_root_sha256
        or current_value != resume
        or current_observed.sha256 != resume_sha256
    ):
        _fail("history_conflict")
    relevant_names = _relevant_history_names(names)
    expected_relevant_names = frozenset(
        {root_name, resume_name, *retired_names, *action_names}
    )
    if relevant_names != expected_relevant_names:
        _fail("history_conflict")

    used_retired: set[str] = set()
    used_actions: set[str] = set()
    visited_resume_names: set[str] = set()
    visited_resume_hashes: set[str] = set()
    visited_release_tokens: set[str] = set()
    edges: list[ResumeHistoryEdge] = []
    successor = resume
    successor_name = resume_name
    successor_sha256 = resume_sha256
    edge_count = 0
    bridge_edge_seen = False

    while True:
        if (
            successor_name in visited_resume_names
            or successor_sha256 in visited_resume_hashes
            or not _current_resume_shape_matches(successor, successor_name)
            or successor_sha256
            != sha256_bytes(canonical_json_bytes(successor))
            or successor.get("capture") != expected_capture
            or successor.get("authorization_sha256") != expected_root_sha256
            or successor.get("annotation_root")
            != base_authorization["annotation_root"]
            or successor.get("primary_operator_identity")
            != base_authorization["primary_operator_identity"]
            or type(successor.get("resume_release_token")) is not str
            or HEX64_RE.fullmatch(successor["resume_release_token"]) is None
            or successor["resume_release_token"] in visited_release_tokens
        ):
            _fail("history_conflict")
        visited_resume_names.add(successor_name)
        visited_resume_hashes.add(successor_sha256)
        visited_release_tokens.add(successor["resume_release_token"])

        if "predecessor" not in successor:
            break
        edge_count += 1
        if (
            edge_count > MAX_RESUME_HISTORY_DEPTH
            or edge_count > len(retired_records)
            or edge_count > len(action_records)
        ):
            _fail("history_conflict")
        predecessor = successor["predecessor"]
        generation_match = re.search(
            r"g([0-9]{16})-", predecessor["resume_name"]
        )
        if generation_match is None:
            _fail("history_conflict")
        expected_retired_name = (
            RETIRED_RESUME_PREFIX
            + generation_match.group(1)
            + "-"
            + successor_sha256[:16]
            + ".json"
        )
        expected_action_name = (
            "authorization-action-"
            + predecessor["action_authorization_sha256"][:16]
            + ".json"
        )
        if (
            expected_retired_name not in retired_records
            or expected_action_name not in action_records
            or expected_retired_name in used_retired
            or expected_action_name in used_actions
        ):
            _fail("history_conflict")
        retired_resume, retired_observed = retired_records[
            expected_retired_name
        ]
        historical_action, action_observed = action_records[
            expected_action_name
        ]
        if (
            retired_observed.sha256 != predecessor["resume_sha256"]
            or action_observed.sha256
            != predecessor["action_authorization_sha256"]
        ):
            _fail("history_conflict")
        validated_retired = _validate_loaded_resume_record(
            retired_resume,
            authorization_sha256=expected_root_sha256,
            expected_operator_identity=base_authorization[
                "primary_operator_identity"
            ],
        )
        generation_delta = (
            successor["resume_generation"]
            - validated_retired["resume_generation"]
        )
        is_bridge_boundary = (
            execution_mode_name
            == "current_after_generation_one_bridge"
            and validated_retired["resume_generation"] == 1
            and "predecessor" not in validated_retired
        )
        if is_bridge_boundary:
            try:
                bridge_is_exact = (
                    compatibility_bridge is not None
                    and bridge_edge_seen is False
                    and successor["resume_generation"] == 2
                    and predecessor["action"]
                    == compatibility_bridge["allowed_action"]
                    and historical_action["expected_authoring_state"]
                    == compatibility_bridge["required_state"]
                )
            except (KeyError, TypeError):
                bridge_is_exact = False
            if not bridge_is_exact:
                _fail("history_conflict")
            bridge_edge_seen = True
        if (
            (
                predecessor["action"] == "status"
                and generation_delta != 0
            )
            or (
                predecessor["action"] != "status"
                and generation_delta != 1
            )
            or (
                generation_delta == 0
                and successor["resume_checkpoint_sha256"]
                != validated_retired["resume_checkpoint_sha256"]
            )
            or not _current_resume_shape_matches(
                validated_retired, predecessor["resume_name"]
            )
            or not _historical_evidence_matches(
                action_authorization=historical_action,
                retired_resume=validated_retired,
                predecessor=predecessor,
                successor_resume=successor,
                base_authorization=base_authorization,
                expected_execution=expected_execution,
                expected_python_identity_sha256=(
                    expected_python_identity_sha256
                ),
                action_state_matrix=action_state_matrix,
            )
        ):
            _fail("history_conflict")
        used_retired.add(expected_retired_name)
        used_actions.add(expected_action_name)
        edges.append(
            ResumeHistoryEdge(
                successor=successor,
                successor_name=successor_name,
                successor_sha256=successor_sha256,
                retired_resume=validated_retired,
                retired_name=expected_retired_name,
                retired_sha256=retired_observed.sha256,
                action_authorization=historical_action,
                action_name=expected_action_name,
                action_sha256=action_observed.sha256,
            )
        )
        successor = validated_retired
        successor_name = predecessor["resume_name"]
        successor_sha256 = predecessor["resume_sha256"]

    try:
        root_execution = base_authorization["execution"]
        root_python = root_execution["python"]
        terminal_is_exact = (
            successor["resume_generation"] == 1
            and successor["authoring_session_identity"]
            == base_authorization["authoring_session_identity"]
            and successor["execution_checkout_sha"]
            == root_execution["approved_checkout_sha"]
            and successor["procedure_identity_sha256"]
            == root_execution["approved_procedure_identity_sha256"]
            and successor["operator_session_procedure_identity_sha256"]
            == root_execution[
                "approved_operator_session_procedure_identity_sha256"
            ]
            and successor["python_identity_sha256"]
            == expected_python_identity_sha256
            and set(root_execution)
            == {
                "approved_checkout_sha",
                "approved_operator_session_procedure_identity_sha256",
                "approved_procedure_identity_sha256",
                "python",
            }
            and set(root_python) == {"path", "sha256", "version"}
        )
    except (KeyError, TypeError):
        terminal_is_exact = False
    if (
        not terminal_is_exact
        or (
            execution_mode_name == "legacy_generation_one"
            and edge_count != 0
        )
        or (
            execution_mode_name
            == "current_after_generation_one_bridge"
            and not bridge_edge_seen
        )
        or used_retired != retired_names
        or used_actions != action_names
    ):
        _fail("history_conflict")

    observations = {
        root_name: root_observed,
        resume_name: current_observed,
    }
    observations.update(
        {name: observed for name, (_value, observed) in retired_records.items()}
    )
    observations.update(
        {name: observed for name, (_value, observed) in action_records.items()}
    )
    snapshot = ResumeHistorySnapshot(
        current_resume=resume,
        current_name=resume_name,
        current_sha256=resume_sha256,
        root_authorization=base_authorization,
        root_name=root_name,
        root_sha256=expected_root_sha256,
        edges=tuple(edges),
        record_observations=observations,
        relevant_names=expected_relevant_names,
        pending_action_name=pending_action_name,
        pending_action=pending_action,
        pending_action_sha256=pending_action_sha256,
        release_tokens=frozenset(visited_release_tokens),
    )
    _revalidate_resume_history_at(
        root_fd, snapshot, require_pending_action=False
    )
    return snapshot


def _checkpoint_name(generation: int, checkpoint_sha256: str) -> str:
    return (
        f"checkpoint-g{generation:016d}-{checkpoint_sha256}.json"
    )


def _stable_canonical_checkpoint_at(
    checkpoints_fd: int, name: str
) -> tuple[Mapping[str, Any], Any]:
    try:
        observed = stable_private_file_at(
            checkpoints_fd,
            name,
            max_bytes=AUTHOR.MAX_CHECKPOINT_BYTES,
            exact_mode=0o400,
        )
        value = strict_json_loads(
            observed.data, max_bytes=AUTHOR.MAX_CHECKPOINT_BYTES
        )
    except ContractError as exc:
        raise OperatorSessionError("history_conflict") from exc
    if type(value) is not dict or observed.data != canonical_json_bytes(value):
        _fail("history_conflict")
    return value, observed


def _cross_bind_resume_checkpoint_history(
    snapshot: ResumeHistorySnapshot,
    chain: Any,
    capture: Any,
) -> None:
    """Require the resume/action walk and checkpoint/state walk to be identical."""

    checkpoints = chain.checkpoints
    hashes = chain.hashes
    if (
        type(checkpoints) is not tuple
        or type(hashes) is not tuple
        or not checkpoints
        or len(checkpoints) != len(hashes)
    ):
        _fail("history_conflict")

    def checkpoint_for_resume(record: Mapping[str, Any]) -> Mapping[str, Any]:
        generation = record["resume_generation"]
        if (
            type(generation) is not int
            or generation < 1
            or generation > len(checkpoints)
            or record["resume_checkpoint_sha256"] != hashes[generation - 1]
        ):
            _fail("history_conflict")
        return checkpoints[generation - 1]

    current_generation = snapshot.current_resume["resume_generation"]
    if (
        current_generation not in {len(checkpoints), len(checkpoints) - 1}
        or snapshot.current_resume["resume_checkpoint_sha256"]
        != hashes[current_generation - 1]
    ):
        _fail("history_conflict")
    terminal = (
        snapshot.edges[-1].retired_resume
        if snapshot.edges
        else snapshot.current_resume
    )
    terminal_checkpoint = checkpoint_for_resume(terminal)
    try:
        terminal_event = terminal_checkpoint["event"]
        if (
            terminal["resume_generation"] != 1
            or terminal_event["action"] != "initialize"
            or terminal_event["operator_identity"]
            != snapshot.root_authorization["primary_operator_identity"]
            or terminal_event["operator_session_identity"]
            != snapshot.root_authorization["authoring_session_identity"]
        ):
            _fail("history_conflict")
    except (KeyError, TypeError, IndexError):
        _fail("history_conflict")

    event_actions = {
        "correction_review": frozenset(
            {
                "primary_review",
                "relationship_correction",
                "data_reference_review",
                "sequence_review",
                "managed_review",
                "manual_conflict_review",
            }
        ),
    }
    accounted_generations: set[int] = set()
    for edge in snapshot.edges:
        predecessor_checkpoint = checkpoint_for_resume(edge.retired_resume)
        successor_checkpoint = checkpoint_for_resume(edge.successor)
        action_record = edge.action_authorization
        action = action_record["action"]
        try:
            observed_state = AUTHOR.aggregate_status(
                predecessor_checkpoint, capture
            )["authoring_state"]
        except BaseException as exc:
            raise OperatorSessionError("history_conflict") from exc
        if action_record["expected_authoring_state"] != observed_state:
            _fail("history_conflict")
        if action == "status":
            if (
                edge.successor["resume_generation"]
                != edge.retired_resume["resume_generation"]
                or edge.successor["resume_checkpoint_sha256"]
                != edge.retired_resume["resume_checkpoint_sha256"]
            ):
                _fail("history_conflict")
            continue
        generation = edge.successor["resume_generation"]
        if (
            generation != edge.retired_resume["resume_generation"] + 1
            or generation in accounted_generations
        ):
            _fail("history_conflict")
        event = successor_checkpoint["event"]
        allowed_event_actions = event_actions.get(action, frozenset({action}))
        if (
            event["action"] not in allowed_event_actions
            or event["operator_identity"]
            != action_record["operator_identity"]
            or event["operator_session_identity"]
            != action_record["authoring_session_identity"]
        ):
            _fail("history_conflict")
        accounted_generations.add(generation)
    if len(checkpoints) == current_generation + 1:
        action_record = snapshot.pending_action
        action = action_record.get("action")
        if action in {"status", "finalize", None}:
            _fail("history_conflict")
        try:
            observed_state = AUTHOR.aggregate_status(
                checkpoints[current_generation - 1], capture
            )["authoring_state"]
            event = checkpoints[current_generation]["event"]
        except BaseException as exc:
            raise OperatorSessionError("history_conflict") from exc
        allowed_event_actions = event_actions.get(
            action, frozenset({action})
        )
        if (
            action_record.get("expected_authoring_state") != observed_state
            or event["action"] not in allowed_event_actions
            or event["operator_identity"]
            != action_record.get("operator_identity")
            or event["operator_session_identity"]
            != action_record.get("authoring_session_identity")
        ):
            _fail("history_conflict")
        accounted_generations.add(current_generation + 1)
    if accounted_generations != set(range(2, len(checkpoints) + 1)):
        _fail("history_conflict")


def _verify_checkpoint_evidence_at(
    snapshot: ResumeHistorySnapshot,
    chain: Any,
    capture: Any,
    private_root_fd: int,
    checkpoints_fd: int,
) -> None:
    _cross_bind_resume_checkpoint_history(snapshot, chain, capture)
    root_metadata = os.fstat(private_root_fd)
    checkpoints_metadata = os.fstat(checkpoints_fd)
    root_identity = (root_metadata.st_dev, root_metadata.st_ino)
    checkpoints_identity = (
        checkpoints_metadata.st_dev,
        checkpoints_metadata.st_ino,
    )
    if snapshot.annotation_root_identity is None:
        snapshot.annotation_root_identity = root_identity
        snapshot.checkpoints_identity = checkpoints_identity
        snapshot.checkpoint_observations = {}
    elif (
        snapshot.annotation_root_identity != root_identity
        or snapshot.checkpoints_identity != checkpoints_identity
    ):
        _fail("history_conflict")
    if snapshot.checkpoint_observations is None:
        _fail("history_conflict")
    expected_names = {
        _checkpoint_name(checkpoint["generation"], checkpoint_sha256)
        for checkpoint, checkpoint_sha256 in zip(
            chain.checkpoints, chain.hashes
        )
    }
    try:
        observed_names = os.listdir(checkpoints_fd)
    except OSError as exc:
        raise OperatorSessionError("history_conflict") from exc
    if (
        any(type(name) is not str for name in observed_names)
        or set(observed_names) != expected_names
    ):
        _fail("history_conflict")
    previous_names = set(snapshot.checkpoint_observations)
    new_names = expected_names - previous_names
    if not previous_names:
        pass
    elif not previous_names.issubset(expected_names) or len(new_names) > 1:
        _fail("history_conflict")
    for checkpoint, checkpoint_sha256 in zip(
        chain.checkpoints, chain.hashes
    ):
        name = _checkpoint_name(checkpoint["generation"], checkpoint_sha256)
        value, observed = _stable_canonical_checkpoint_at(
            checkpoints_fd, name
        )
        if value != checkpoint or observed.sha256 != checkpoint_sha256:
            _fail("history_conflict")
        previous = snapshot.checkpoint_observations.get(name)
        if previous is None:
            snapshot.checkpoint_observations[name] = observed
        elif _stable_observation_identity(previous) != _stable_observation_identity(
            observed
        ):
            _fail("history_conflict")


def _open_private_child_directory_at(
    parent_fd: int, name: str
) -> tuple[int, os.stat_result]:
    if type(name) is not str or SAFE_CAPTURE_NAME_RE.fullmatch(name) is None:
        _fail("history_conflict")
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
    flags |= getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = -1
    try:
        descriptor = os.open(name, flags, dir_fd=parent_fd)
        held = os.fstat(descriptor)
        named = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
    except OSError as exc:
        if descriptor >= 0:
            os.close(descriptor)
        raise OperatorSessionError("history_conflict") from exc
    if (
        not stat.S_ISDIR(held.st_mode)
        or stat.S_ISLNK(named.st_mode)
        or (held.st_dev, held.st_ino) != (named.st_dev, named.st_ino)
        or held.st_uid != os.geteuid()
        or stat.S_IMODE(held.st_mode) != 0o700
    ):
        os.close(descriptor)
        _fail("history_conflict")
    return descriptor, held


def _revalidate_checkpoint_evidence_from_path(
    snapshot: ResumeHistorySnapshot,
    *,
    expected_generation: int,
    expected_checkpoint_sha256: str,
) -> None:
    if (
        snapshot.annotation_root_identity is None
        or snapshot.checkpoints_identity is None
        or snapshot.checkpoint_observations is None
        or type(expected_generation) is not int
        or expected_generation < 1
        or type(expected_checkpoint_sha256) is not str
        or HEX64_RE.fullmatch(expected_checkpoint_sha256) is None
        or _checkpoint_name(
            expected_generation, expected_checkpoint_sha256
        )
        not in snapshot.checkpoint_observations
    ):
        _fail("history_conflict")
    annotation_fd = checkpoints_fd = -1
    try:
        annotation_fd, metadata = _open_existing_private_directory(
            _validate_absolute_path(
                snapshot.root_authorization["annotation_root"],
                must_exist=True,
            )
        )
        if (
            metadata.st_dev,
            metadata.st_ino,
        ) != snapshot.annotation_root_identity:
            _fail("history_conflict")
        checkpoints_fd, checkpoints_metadata = _open_private_child_directory_at(
            annotation_fd, AUTHOR.CHECKPOINTS_NAME
        )
        if (
            checkpoints_metadata.st_dev,
            checkpoints_metadata.st_ino,
        ) != snapshot.checkpoints_identity:
            _fail("history_conflict")
        names = os.listdir(checkpoints_fd)
        if (
            any(type(name) is not str for name in names)
            or set(names) != set(snapshot.checkpoint_observations)
        ):
            _fail("history_conflict")
        for name, expected_observed in snapshot.checkpoint_observations.items():
            value, observed = _stable_canonical_checkpoint_at(
                checkpoints_fd, name
            )
            if (
                observed.data != expected_observed.data
                or value != strict_json_loads(
                    expected_observed.data,
                    max_bytes=AUTHOR.MAX_CHECKPOINT_BYTES,
                )
                or _stable_observation_identity(observed)
                != _stable_observation_identity(expected_observed)
            ):
                _fail("history_conflict")
    except (OSError, ContractError, OperatorSessionError) as exc:
        raise OperatorSessionError("history_conflict") from exc
    finally:
        for descriptor in (checkpoints_fd, annotation_fd):
            if descriptor >= 0:
                try:
                    os.close(descriptor)
                except OSError as exc:
                    raise OperatorSessionError("history_conflict") from exc


def _classify_resume_execution(
    action_authorization: Mapping[str, Any],
    base_authorization: Mapping[str, Any],
    resume: Mapping[str, Any],
    resume_name: str,
    *,
    observed_procedure: str,
    observed_session_procedure: str,
    python_identity: Mapping[str, Any],
    execution_profile: Mapping[str, Any] | None,
) -> ResumeExecutionMode:
    """Classify one current resume as exact-current or the one-hop bridge."""

    current_execution = action_authorization["execution"]
    current_checkout = current_execution["approved_checkout_sha"]
    current_python_sha = current_execution["python"]["sha256"]
    current_binding = AUTHOR.AuthoringBinding(
        execution_checkout_sha=current_checkout,
        procedure_identity_sha256=observed_procedure,
        execution_python_identity_sha256=current_python_sha,
    )
    resume_is_current = (
        _current_resume_shape_matches(resume, resume_name)
        and resume["execution_checkout_sha"] == current_checkout
        and resume["procedure_identity_sha256"] == observed_procedure
        and resume["operator_session_procedure_identity_sha256"]
        == observed_session_procedure
        and resume["python_identity_sha256"] == python_identity["identity_sha256"]
    )
    bridge: Mapping[str, Any] | None = None
    if execution_profile is not None:
        try:
            candidates = execution_profile["compatibility_bridges"]
            if type(candidates) is list and len(candidates) == 1:
                candidate = candidates[0]
                if type(candidate) is dict:
                    bridge = candidate
        except (KeyError, TypeError):
            bridge = None

    root_is_legacy = bridge is not None and _legacy_root_matches(
        base_authorization, bridge
    )
    if resume_is_current:
        if root_is_legacy:
            if (
                resume["resume_generation"] < 2
                or "predecessor" not in resume
            ):
                _fail("history_conflict")
            historical_binding = AUTHOR.AuthoringBinding(
                execution_checkout_sha=bridge["execution_checkout_sha"],
                procedure_identity_sha256=bridge[
                    "authoring_procedure_identity_sha256"
                ],
                execution_python_identity_sha256=bridge["python"]["sha256"],
            )
            return ResumeExecutionMode(
                "current_after_generation_one_bridge",
                AUTHOR.GenerationOneBindingPolicy(
                    historical_binding=historical_binding,
                    current_binding=current_binding,
                    allow_successor_transition=False,
                ),
            )
        try:
            root_execution = base_authorization["execution"]
            root_python = root_execution["python"]
            root_is_current = (
                root_execution["approved_checkout_sha"] == current_checkout
                and root_execution["approved_procedure_identity_sha256"]
                == observed_procedure
                and root_execution[
                    "approved_operator_session_procedure_identity_sha256"
                ]
                == observed_session_procedure
                and root_python["path"] == current_execution["python"]["path"]
                and root_python["sha256"] == current_python_sha
                and root_python["version"]
                == current_execution["python"]["version"]
            )
        except (KeyError, TypeError):
            root_is_current = False
        if not root_is_current:
            _fail("binding_mismatch")
        return ResumeExecutionMode("current", None)

    if bridge is None or not root_is_legacy:
        _fail("binding_mismatch")
    expected_name = (
        CURRENT_RESUME_PREFIX
        + "0000000000000001-"
        + resume["resume_checkpoint_sha256"]
        + ".json"
    )
    resume_capture = resume["capture"]
    root_capture = base_authorization["capture"]
    if (
        action_authorization["action"] != bridge["allowed_action"]
        or action_authorization.get("expected_authoring_state")
        != bridge["required_state"]
        or type(resume["format_version"]) is not int
        or resume["format_version"] != RESUME_FORMAT_VERSION
        or type(resume["resume_generation"]) is not int
        or resume["resume_generation"] != bridge["generation"]
        or "predecessor" in resume
        or resume_name != expected_name
        or resume["execution_checkout_sha"] != bridge["execution_checkout_sha"]
        or resume["procedure_identity_sha256"]
        != bridge["authoring_procedure_identity_sha256"]
        or resume["operator_session_procedure_identity_sha256"]
        != bridge["operator_session_procedure_identity_sha256"]
        or resume["python_identity_sha256"] != python_identity["identity_sha256"]
        or python_identity["sha256"] != bridge["python"]["sha256"]
        or resume["authoring_session_identity"]
        != base_authorization["authoring_session_identity"]
        or resume_capture
        != {
            "capture_manifest_sha256": root_capture["capture_manifest_sha256"],
            "evidence_run_id": root_capture["evidence_run_id"],
            "opaque_index_sha256": root_capture["opaque_index_sha256"],
            "raw_toc_sha256": root_capture["raw_toc_sha256"],
        }
        or set(resume)
        != {
            "annotation_root",
            "artifact_kind",
            "authorization_sha256",
            "authoring_session_identity",
            "capture",
            "execution_checkout_sha",
            "format_version",
            "operator_session_procedure_identity_sha256",
            "primary_operator_identity",
            "procedure_identity_sha256",
            "python_identity_sha256",
            "resume_checkpoint_sha256",
            "resume_generation",
            "resume_release_token",
        }
    ):
        _fail("history_conflict")
    historical_binding = AUTHOR.AuthoringBinding(
        execution_checkout_sha=bridge["execution_checkout_sha"],
        procedure_identity_sha256=bridge["authoring_procedure_identity_sha256"],
        execution_python_identity_sha256=bridge["python"]["sha256"],
    )
    return ResumeExecutionMode(
        "legacy_generation_one",
        AUTHOR.GenerationOneBindingPolicy(
            historical_binding=historical_binding,
            current_binding=current_binding,
            allow_successor_transition=True,
        ),
    )


def _run_authorized_initialize(authorization: Mapping[str, Any], tty_fd: int, session_root_fd: int, authorization_sha256: str) -> tuple[int, bytes]:
    expected_session_procedure = authorization["execution"][
        "approved_operator_session_procedure_identity_sha256"
    ]
    observed_session_procedure = _operator_session_procedure_identity(
        authorization["execution"]["approved_checkout_sha"]
    )
    if observed_session_procedure != expected_session_procedure:
        _fail("binding_mismatch")
    expected_procedure = authorization["execution"]["approved_procedure_identity_sha256"]
    observed_procedure = _procedure_identity(authorization["execution"]["approved_checkout_sha"])
    if observed_procedure != expected_procedure:
        _fail("binding_mismatch")
    python_identity = _validated_python_identity(authorization["execution"]["python"])
    environment = _environment_from_authorization(authorization)

    def recorder(generation: int, checkpoint_sha256: str, release_token: str) -> None:
        if generation != 1 or not HEX64_RE.fullmatch(checkpoint_sha256) or not HEX64_RE.fullmatch(release_token):
            _fail("internal_failure")
        resume = {
            "annotation_root": authorization["annotation_root"],
            "artifact_kind": RESUME_KIND,
            "authorization_sha256": authorization_sha256,
            "authoring_session_identity": authorization["authoring_session_identity"],
            "capture": {
                "capture_manifest_sha256": authorization["capture"]["capture_manifest_sha256"],
                "evidence_run_id": authorization["capture"]["evidence_run_id"],
                "opaque_index_sha256": authorization["capture"]["opaque_index_sha256"],
                "raw_toc_sha256": authorization["capture"]["raw_toc_sha256"],
            },
            "execution_checkout_sha": authorization["execution"]["approved_checkout_sha"],
            "format_version": RESUME_FORMAT_VERSION,
            "operator_session_procedure_identity_sha256": observed_session_procedure,
            "primary_operator_identity": authorization["primary_operator_identity"],
            "procedure_identity_sha256": observed_procedure,
            "python_identity_sha256": python_identity["identity_sha256"],
            "resume_checkpoint_sha256": checkpoint_sha256,
            "resume_generation": generation,
            "resume_release_token": release_token,
        }
        final_name = f"{CURRENT_RESUME_PREFIX}{generation:016d}-{checkpoint_sha256}.json"
        _publish_private_json_at(session_root_fd, final_name, resume)

    return AUTHOR.execute_authoring(environment, tty_fd, resume_recorder=recorder)


def _run_authorized_action(
    action_authorization: Mapping[str, Any],
    base_authorization: Mapping[str, Any],
    resume: Mapping[str, Any],
    resume_name: str,
    resume_sha256: str,
    tty_fd: int,
    session_root_fd: int,
    action_authorization_sha256: str,
    *,
    execution_profile: Mapping[str, Any] | None = None,
    action_authorizer: Callable[[], None] | None = None,
) -> tuple[int, bytes, str | None]:
    expected_session_procedure = action_authorization["execution"][
        "approved_operator_session_procedure_identity_sha256"
    ]
    observed_session_procedure = _operator_session_procedure_identity(
        action_authorization["execution"]["approved_checkout_sha"]
    )
    if observed_session_procedure != expected_session_procedure:
        _fail("binding_mismatch")
    expected_procedure = action_authorization["execution"]["approved_procedure_identity_sha256"]
    observed_procedure = _procedure_identity(
        action_authorization["execution"]["approved_checkout_sha"]
    )
    if observed_procedure != expected_procedure:
        _fail("binding_mismatch")
    if (
        resume["authorization_sha256"]
        != sha256_bytes(canonical_json_bytes(base_authorization))
        or resume["annotation_root"] != base_authorization["annotation_root"]
        or resume["primary_operator_identity"]
        != base_authorization["primary_operator_identity"]
        or action_authorization["session_root"]
        != base_authorization["session_root"]
    ):
        _fail("binding_mismatch")
    if (
        action_authorization["primary_operator_identity"]
        != base_authorization["primary_operator_identity"]
    ):
        _fail("binding_mismatch")
    python_identity = _validated_python_identity(action_authorization["execution"]["python"])
    execution_mode = _classify_resume_execution(
        action_authorization,
        base_authorization,
        resume,
        resume_name,
        observed_procedure=observed_procedure,
        observed_session_procedure=observed_session_procedure,
        python_identity=python_identity,
        execution_profile=execution_profile,
    )
    if execution_mode.name == "legacy_generation_one":
        _require_pristine_legacy_session_root(
            session_root_fd,
            root_authorization_sha256=resume["authorization_sha256"],
            resume_name=resume_name,
        )
    history_snapshot = _verify_predecessor_chain_at(
        session_root_fd,
        base_authorization=base_authorization,
        resume=resume,
        resume_name=resume_name,
        resume_sha256=resume_sha256,
        expected_execution=action_authorization["execution"],
        expected_python_identity_sha256=python_identity["identity_sha256"],
        action_state_matrix=execution_profile["action_state_matrix"],
        execution_mode_name=execution_mode.name,
        compatibility_bridge=(
            execution_profile["compatibility_bridges"][0]
            if (
                type(execution_profile.get("compatibility_bridges")) is list
                and len(execution_profile["compatibility_bridges"]) == 1
            )
            else None
        ),
        pending_action_name=(
            "authorization-action-"
            + action_authorization_sha256[:16]
            + ".json"
        ),
        pending_action=action_authorization,
        pending_action_sha256=action_authorization_sha256,
    )
    environment = _environment_from_authorization(
        action_authorization,
        base_authorization=base_authorization,
        resume=resume,
    )
    successor: RecordPublication | None = None

    def verify_history(
        chain: Any,
        capture: Any,
        private_root_fd: int,
        checkpoints_fd: int,
    ) -> None:
        _revalidate_resume_history_at(
            session_root_fd,
            history_snapshot,
            require_pending_action=False,
        )
        _verify_checkpoint_evidence_at(
            history_snapshot,
            chain,
            capture,
            private_root_fd,
            checkpoints_fd,
        )

    def recorder(generation: int, checkpoint_sha256: str, release_token: str) -> None:
        nonlocal successor
        if not (
            type(generation) is int
            and generation > 0
            and type(checkpoint_sha256) is str
            and HEX64_RE.fullmatch(checkpoint_sha256)
            and type(release_token) is str
            and HEX64_RE.fullmatch(release_token)
        ):
            _fail("internal_failure")
        if release_token in history_snapshot.release_tokens:
            _fail("history_conflict")
        if (
            execution_mode.name == "legacy_generation_one"
            and generation != 2
        ):
            _fail("history_conflict")
        action = action_authorization["action"]
        if (
            action == "finalize"
            or (
                action == "status"
                and (
                    generation != resume["resume_generation"]
                    or checkpoint_sha256
                    != resume["resume_checkpoint_sha256"]
                )
            )
            or (
                action != "status"
                and generation != resume["resume_generation"] + 1
            )
        ):
            _fail("history_conflict")
        _revalidate_resume_history_at(
            session_root_fd,
            history_snapshot,
            require_pending_action=True,
        )
        _revalidate_checkpoint_evidence_from_path(
            history_snapshot,
            expected_generation=generation,
            expected_checkpoint_sha256=checkpoint_sha256,
        )
        successor_resume = {
            "annotation_root": base_authorization["annotation_root"],
            "artifact_kind": RESUME_KIND,
            "authorization_sha256": resume["authorization_sha256"],
            "authoring_session_identity": action_authorization["authoring_session_identity"],
            "capture": dict(resume["capture"]),
            "execution_checkout_sha": action_authorization["execution"]["approved_checkout_sha"],
            "format_version": RESUME_FORMAT_VERSION,
            "operator_session_procedure_identity_sha256": observed_session_procedure,
            "predecessor": {
                "action": action_authorization["action"],
                "action_authorization_sha256": action_authorization_sha256,
                "resume_name": resume_name,
                "resume_sha256": resume_sha256,
            },
            "primary_operator_identity": base_authorization["primary_operator_identity"],
            "procedure_identity_sha256": observed_procedure,
            "python_identity_sha256": python_identity["identity_sha256"],
            "resume_checkpoint_sha256": checkpoint_sha256,
            "resume_generation": generation,
            "resume_release_token": release_token,
        }
        successor_sha256 = sha256_bytes(canonical_json_bytes(successor_resume))
        final_name = (
            f"{CURRENT_RESUME_PREFIX}{generation:016d}-"
            f"{checkpoint_sha256}-{successor_sha256[:16]}.json"
        )
        successor = _publish_private_json_at(session_root_fd, final_name, successor_resume)

    try:
        authoring_options: dict[str, Any] = {
            "history_verifier": verify_history,
            "resume_recorder": recorder,
        }
        if action_authorizer is not None:
            authoring_options["action_authorizer"] = action_authorizer
        if execution_mode.binding_policy is not None:
            authoring_options["binding_policy"] = execution_mode.binding_policy
        status, diagnostic = AUTHOR.execute_authoring(
            environment,
            tty_fd,
            **authoring_options,
        )
    except AUTHOR.AuthoringEntrypointError as exc:
        raise OperatorSessionError(exc.reason) from exc
    if action_authorization["action"] == "finalize":
        _revalidate_resume_history_at(
            session_root_fd,
            history_snapshot,
            require_pending_action=True,
        )
        _revalidate_checkpoint_evidence_from_path(
            history_snapshot,
            expected_generation=resume["resume_generation"],
            expected_checkpoint_sha256=resume["resume_checkpoint_sha256"],
        )
        terminal = {
            "artifact_kind": TERMINAL_RESUME_KIND,
            "finalization_authorization_sha256": sha256_bytes(
                action_authorization["finalization_authorization"].encode("ascii")
            ),
            "format_version": RESUME_FORMAT_VERSION,
            "predecessor": {
                "action": action_authorization["action"],
                "action_authorization_sha256": action_authorization_sha256,
                "resume_name": resume_name,
                "resume_sha256": resume_sha256,
            },
            "resume_checkpoint_sha256": resume["resume_checkpoint_sha256"],
            "resume_generation": resume["resume_generation"],
            "status": "final_candidate_published_unvalidated",
        }
        terminal_name = (
            f"{TERMINAL_RESUME_PREFIX}{resume['resume_generation']:016d}-"
            f"{resume['resume_checkpoint_sha256']}.json"
        )
        successor = _publish_private_json_at(session_root_fd, terminal_name, terminal)
        _tty_write(
            tty_fd,
            b"type_resume_values_recorded_to_confirm\n",
        )
        acknowledgement = _read_line(
            tty_fd,
            b"resume_values_acknowledgement: ",
        )
        if acknowledgement != "resume_values_recorded":
            _fail("input_invalid")
    if successor is None:
        _fail("cleanup_indeterminate")
    _retire_resume_record(session_root_fd, resume_name, successor.sha256)
    return status, diagnostic, successor.name


def run_session(tty_fd: int, verified: Any) -> tuple[int, bytes]:
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    _verification_summary(tty_fd, verified)
    action = _prompt_choice(
        tty_fd,
        b"operator_action",
        frozenset(AUTHOR.ACTION_VALUES) | {VERIFY_ONLY},
    )
    if action == VERIFY_ONLY:
        return 0, PREFLIGHT.fixed_diagnostic("pass", "verified")
    if action == "initialize":
        authorization = _prompt_initialize_authorization(tty_fd, verified)
        _authorize_consequence(
            tty_fd,
            authorization,
            verified,
            ConsequenceGate(),
        )
        return _run_initialize_session(authorization, tty_fd)
    action_authorization = _prompt_action_authorization_for_action(
        tty_fd,
        verified,
        action,
    )
    _authorize_consequence(
        tty_fd,
        action_authorization,
        verified,
        ConsequenceGate(),
    )
    return _run_resume_session(action_authorization, tty_fd, verified)


def _run_initialize_session(authorization: Mapping[str, Any], tty_fd: int) -> tuple[int, bytes]:
    session_root_path = _validate_absolute_path(authorization["session_root"], must_exist=False)
    annotation_root_path = _validate_absolute_path(authorization["annotation_root"], must_exist=False)
    capture_root_path = _validate_absolute_path_lexical(authorization["capture"]["capture_root"])
    _assert_outside_repository(
        (session_root_path, annotation_root_path, capture_root_path)
    )
    if session_root_path == annotation_root_path:
        _fail("input_invalid")
    session_root_fd, _session_metadata = _create_private_directory_no_replace(session_root_path)
    annotation_root_fd = -1
    try:
        authorization_without_digest = dict(authorization)
        authorization_digest = sha256_bytes(canonical_json_bytes(authorization_without_digest))
        final_name = "authorization-root-" + authorization_digest[:16] + ".json"
        _publish_private_json_at(session_root_fd, final_name, authorization_without_digest)
        _tty_write(
            tty_fd,
            b"authorization_digest="
            + authorization_digest.encode("ascii")
            + b"\ntype_authorization_digest_recorded_to_continue\n",
        )
        acknowledgement = _read_line(tty_fd, b"authorization_digest_acknowledgement: ")
        if acknowledgement != "authorization_digest_recorded":
            _fail("input_invalid")
        annotation_root_fd, _annotation_metadata = _create_private_directory_no_replace(annotation_root_path)
        os.close(annotation_root_fd)
        annotation_root_fd = -1
        return _run_authorized_initialize(
            authorization_without_digest,
            tty_fd,
            session_root_fd,
            authorization_digest,
        )
    except OperatorSessionError:
        _mark_session_indeterminate(session_root_fd)
        raise
    except BaseException as exc:
        _mark_session_indeterminate(session_root_fd)
        raise OperatorSessionError("internal_failure") from exc
    finally:
        if annotation_root_fd >= 0:
            try:
                os.close(annotation_root_fd)
            except OSError:
                pass
        try:
            os.close(session_root_fd)
        except OSError:
            pass


def _prompt_action_authorization_for_action(
    tty_fd: int, verified: Any, action: str
) -> dict[str, Any]:
    if action not in (AUTHOR.ACTION_VALUES - {"initialize"}):
        _fail("input_invalid")
    _tty_write(
        tty_fd,
        b"toc_authoring_operator_session_resume\n"
        b"type_human_claims_manually_no_clipboard_no_history_no_recording\n",
    )
    operator = _safe_identity(_read_line(tty_fd, b"current_operator_identity: "))
    if action == "peer_review":
        _reject_ai_peer_identity(operator)
    session_id = _new_session_identity("toc-operator")
    authoring_session = _new_session_identity("toc-authoring")
    action_policy = verified.profile["action_state_matrix"][action]
    allowed_states = frozenset(action_policy["allowed_expected_states"])
    if len(allowed_states) == 1:
        expected_state = next(iter(allowed_states))
    else:
        expected_state = _prompt_choice(
            tty_fd,
            b"expected_authoring_state",
            allowed_states,
        )
    finalization_authorization = ""
    if action == "finalize":
        finalization_authorization = _read_line(tty_fd, b"type_CREATE_UNVALIDATED_LEDGER: ")
        if finalization_authorization != AUTHOR.FINALIZATION_AUTHORIZATION:
            _fail("finalization_incomplete")
    return {
        "action": action,
        "artifact_kind": ACTION_AUTHORIZATION_KIND,
        "authoring_session_identity": authoring_session,
        "execution": _execution_from_preflight(verified),
        "expected_authoring_state": expected_state,
        "finalization_authorization": finalization_authorization,
        "format_version": ACTION_AUTHORIZATION_FORMAT_VERSION,
        "operator_identity": operator,
        "primary_operator_identity": "",
        "session_id": session_id,
        "session_root": verified.operator_session_root_path,
        "tty_attestation": TTY_ATTESTATION,
    }


def _run_resume_session(
    action_authorization: Mapping[str, Any],
    tty_fd: int,
    verified: Any,
) -> tuple[int, bytes]:
    session_root_path = _validate_absolute_path(action_authorization["session_root"], must_exist=True)
    session_root_fd, _session_metadata = _open_existing_private_directory(session_root_path)
    session_lock_token: str | None = None
    try:
        session_lock_token = _acquire_session_lock(session_root_fd)
        root_authorization_sha256 = None
        resume_name = _active_resume_name(session_root_fd, allow_lock=True)
        resume_observed = stable_private_file_at(
            session_root_fd, resume_name, max_bytes=MAX_RECORD_BYTES, exact_mode=0o400
        )
        resume_value = strict_json_loads(resume_observed.data, max_bytes=MAX_RECORD_BYTES)
        if type(resume_value) is not dict:
            _fail("history_conflict")
        if type(resume_value.get("authorization_sha256")) is str:
            root_authorization_sha256 = resume_value["authorization_sha256"]
        if root_authorization_sha256 is None:
            _fail("history_conflict")
        root_authorization = _load_authorization_by_sha(session_root_fd, root_authorization_sha256)
        resume = _validate_loaded_resume_record(
            resume_value,
            authorization_sha256=root_authorization_sha256,
            expected_operator_identity=root_authorization["primary_operator_identity"],
        )
        action_authorization = dict(action_authorization)
        primary_operator = root_authorization["primary_operator_identity"]
        operator = action_authorization["operator_identity"]
        if action_authorization["action"] == "peer_review":
            if operator.casefold() == primary_operator.casefold():
                _fail("binding_mismatch")
            _reject_ai_peer_identity(operator)
        elif operator != primary_operator:
            _fail("binding_mismatch")
        action_authorization["primary_operator_identity"] = primary_operator
        action_authorization["annotation_root"] = root_authorization["annotation_root"]
        action_authorization["capture_binding_sha256"] = sha256_bytes(
            canonical_json_bytes(root_authorization["capture"])
        )
        action_authorization["root_authorization_sha256"] = root_authorization_sha256
        action_authorization["resume"] = {
            "name": resume_name,
            "sha256": resume_observed.sha256,
            "generation": resume["resume_generation"],
            "checkpoint_sha256": resume["resume_checkpoint_sha256"],
        }
        action_digest = sha256_bytes(canonical_json_bytes(action_authorization))
        action_name = f"authorization-action-{action_digest[:16]}.json"
        action_authorization_published = False

        def publish_action_authorization() -> None:
            nonlocal action_authorization_published
            if action_authorization_published:
                _fail("history_conflict")
            _publish_private_json_at(
                session_root_fd,
                action_name,
                action_authorization,
            )
            action_authorization_published = True
            _tty_write(
                tty_fd,
                b"action_authorization_recorded\n"
                b"type_action_authorization_recorded_to_continue\n",
            )
            acknowledgement = _read_line(
                tty_fd,
                b"action_authorization_acknowledgement: ",
            )
            if acknowledgement != "action_authorization_recorded":
                _fail("input_invalid")

        status, diagnostic, _successor_name = _run_authorized_action(
            action_authorization,
            root_authorization,
            resume,
            resume_name,
            resume_observed.sha256,
            tty_fd,
            session_root_fd,
            action_digest,
            execution_profile=verified.profile,
            action_authorizer=publish_action_authorization,
        )
        if not action_authorization_published:
            _fail("cleanup_indeterminate")
        if session_lock_token is None:
            _fail("cleanup_indeterminate")
        _release_session_lock(session_root_fd, session_lock_token)
        session_lock_token = None
        return status, diagnostic
    except OperatorSessionError:
        _mark_session_indeterminate(session_root_fd)
        raise
    except BaseException as exc:
        _mark_session_indeterminate(session_root_fd)
        raise OperatorSessionError("internal_failure") from exc
    finally:
        if session_lock_token is not None:
            _mark_session_indeterminate(session_root_fd)
        try:
            os.close(session_root_fd)
        except OSError:
            pass


def _validate_tty_fd() -> int:
    raw = os.environ.get("TOC_OPERATOR_TTY_FD")
    if type(raw) is not str or not raw.isdigit():
        _fail("tty_invalid")
    descriptor = int(raw)
    if descriptor < 3:
        _fail("tty_invalid")
    try:
        PREFLIGHT.verify_tty(descriptor)
    except PREFLIGHT.PreflightError as exc:
        raise OperatorSessionError("tty_invalid") from exc
    return descriptor


def main() -> int:
    try:
        tty_fd = _validate_tty_fd()
        launcher = REPO / "scripts/migration/run-lovable-toc-annotation-operator-session.sh"
        if _BOOTSTRAP_APPROVAL_BINDING is None:
            _fail("binding_mismatch")
        verified = PREFLIGHT.verify_pre_private(
            launcher,
            tty_fd,
            bootstrap_binding=PREFLIGHT.ApprovalBootstrapBinding(
                approval_name=_BOOTSTRAP_APPROVAL_BINDING.approval_name,
                approval_sha256=_BOOTSTRAP_APPROVAL_BINDING.approval_sha256,
                file_identity=_BOOTSTRAP_APPROVAL_BINDING.file_identity,
                parent_identity=_BOOTSTRAP_APPROVAL_BINDING.parent_identity,
            ),
        )
        status, diagnostic = run_session(tty_fd, verified)
        emit_fixed_diagnostic(sys.stdout.buffer, diagnostic)
        return status
    except PREFLIGHT.PreflightError as exc:
        try:
            os.write(
                _diagnostic_fd(),
                PREFLIGHT.fixed_diagnostic("failed", exc.reason),
            )
        except BaseException:
            pass
        return 1
    except OperatorSessionError as exc:
        _emit_failure(exc.reason)
        return 1
    except BaseException:
        _emit_failure("internal_failure")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
