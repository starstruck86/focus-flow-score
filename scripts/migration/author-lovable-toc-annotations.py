#!/usr/bin/env python3
"""Internal, isolated TTY entrypoint for private TOC annotation authoring.

Operators must use ``run-lovable-toc-annotation-authoring.sh``.  This component
never invokes the ledger validator, pg_restore, a database client, or a network
operation.  Private review context is written only to the inherited controlling
TTY descriptor; stdout and stderr carry fixed diagnostics only.
"""

from __future__ import annotations

import sys


_STARTUP_FAILURE_DIAGNOSTIC = (
    b'{"diagnostic_version":1,"reason":"input_invalid",'
    b'"stage":"annotation_authoring","status":"failed"}\n'
)
_STARTUP_BINDING_FAILURE_DIAGNOSTIC = (
    b'{"diagnostic_version":1,"reason":"binding_mismatch",'
    b'"stage":"annotation_authoring","status":"failed"}\n'
)
_STARTUP_TTY_FAILURE_DIAGNOSTIC = (
    b'{"diagnostic_version":1,"reason":"tty_invalid",'
    b'"stage":"annotation_authoring","status":"failed"}\n'
)
_REVIEWED_GIT = "/usr/bin/git"
_REVIEWED_PS = "/bin/ps"
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
    "GIT_NO_REPLACE_OBJECTS": "1",
    "GIT_OPTIONAL_LOCKS": "0",
    "GIT_TERMINAL_PROMPT": "0",
    "LANG": "C",
    "LC_ALL": "C",
    "PATH": "/usr/bin:/bin",
}
_MAX_REVIEWED_GIT_OUTPUT_BYTES = 1024 * 1024


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


def _fail_unisolated_startup() -> None:
    try:
        sys.stderr.buffer.write(_STARTUP_FAILURE_DIAGNOSTIC)
        sys.stderr.buffer.flush()
    except BaseException:
        pass
    raise SystemExit(1)


# Do not import anything beyond builtin sys until the interpreter has proved
# the complete -I -S -B contract.  The reviewed shell launcher is decisive:
# an unsupported direct interpreter invocation could already have processed
# site startup before this file receives control.
if not _runtime_isolation_enabled():
    _fail_unisolated_startup()

import os
import stat as _startup_stat
import subprocess as _startup_subprocess


def _startup_diagnostic_write(payload: bytes) -> None:
    descriptor = 2
    try:
        raw = os.environ.get("TOC_INTERNAL_DIAGNOSTIC_STDERR_FD")
        if type(raw) is str and raw.isdigit() and int(raw) >= 3:
            descriptor = int(raw)
        os.write(descriptor, payload)
    except BaseException:
        pass


def _fail_startup_binding() -> None:
    _startup_diagnostic_write(_STARTUP_BINDING_FAILURE_DIAGNOSTIC)
    raise SystemExit(1)


def _fail_startup_tty() -> None:
    _startup_diagnostic_write(_STARTUP_TTY_FAILURE_DIAGNOSTIC)
    raise SystemExit(1)


class _ReviewedStartupFailure(RuntimeError):
    """A private startup failure whose data is never made diagnostic text."""


def _reviewed_git_bytes(
    repository: str, arguments: list[str], *, timeout_seconds: int
) -> bytes:
    try:
        metadata = os.lstat(_REVIEWED_GIT)
        if (
            _startup_stat.S_ISLNK(metadata.st_mode)
            or not _startup_stat.S_ISREG(metadata.st_mode)
            or not os.access(_REVIEWED_GIT, os.X_OK)
        ):
            raise _ReviewedStartupFailure
        result = _startup_subprocess.run(
            [_REVIEWED_GIT, *_REVIEWED_GIT_CONFIG, *arguments],
            cwd=repository,
            check=False,
            stdin=_startup_subprocess.DEVNULL,
            stdout=_startup_subprocess.PIPE,
            stderr=_startup_subprocess.DEVNULL,
            env=dict(_REVIEWED_GIT_ENVIRONMENT),
            timeout=timeout_seconds,
            close_fds=True,
        )
    except BaseException as exc:
        raise _ReviewedStartupFailure from exc
    if result.returncode != 0 or len(result.stdout) > _MAX_REVIEWED_GIT_OUTPUT_BYTES:
        raise _ReviewedStartupFailure
    return result.stdout


def _is_full_lowercase_git_sha(value: str | None) -> bool:
    return (
        type(value) is str
        and len(value) == 40
        and all(character in "0123456789abcdef" for character in value)
    )


def _reject_known_recording_ancestors() -> None:
    """Reject reviewed known record-to-file wrappers before private input."""

    recorders = frozenset(
        {
            "asciinema",
            "script",
            "scriptreplay",
            "shelr",
            "termrec",
            "tlog-rec-session",
            "ttyrec",
        }
    )
    try:
        metadata = os.lstat(_REVIEWED_PS)
        if (
            _startup_stat.S_ISLNK(metadata.st_mode)
            or not _startup_stat.S_ISREG(metadata.st_mode)
            or not os.access(_REVIEWED_PS, os.X_OK)
        ):
            raise _ReviewedStartupFailure
        process_id = os.getppid()
        seen: set[int] = set()
        for _ in range(32):
            if process_id <= 1 or process_id in seen:
                return
            seen.add(process_id)
            result = _startup_subprocess.run(
                [_REVIEWED_PS, "-o", "ppid=", "-o", "comm=", "-p", str(process_id)],
                check=False,
                stdin=_startup_subprocess.DEVNULL,
                stdout=_startup_subprocess.PIPE,
                stderr=_startup_subprocess.DEVNULL,
                env=dict(_REVIEWED_GIT_ENVIRONMENT),
                timeout=5,
                close_fds=True,
            )
            if result.returncode != 0 or not result.stdout or len(result.stdout) > 1024:
                raise _ReviewedStartupFailure
            line = result.stdout.decode("ascii", errors="strict").strip()
            pieces = line.split(None, 1)
            if len(pieces) != 2 or not pieces[0].isdigit():
                raise _ReviewedStartupFailure
            parent = int(pieces[0])
            command = pieces[1].rsplit("/", 1)[-1].casefold()
            if command in recorders:
                raise _ReviewedStartupFailure
            process_id = parent
        raise _ReviewedStartupFailure
    except _ReviewedStartupFailure:
        raise
    except BaseException as exc:
        raise _ReviewedStartupFailure from exc


def _preimport_repository_guard() -> None:
    """Prove the approved checkout before repository code becomes importable."""

    approved = os.environ.get("TOC_AUTHOR_APPROVED_EXECUTION_CHECKOUT_SHA")
    if not _is_full_lowercase_git_sha(approved):
        raise _ReviewedStartupFailure
    script = os.path.realpath(__file__)
    repository = os.path.dirname(os.path.dirname(os.path.dirname(script)))
    if _reviewed_git_bytes(
        repository, ["rev-parse", "HEAD"], timeout_seconds=20
    ).strip() != approved.encode("ascii"):
        raise _ReviewedStartupFailure
    if _reviewed_git_bytes(
        repository,
        ["status", "--porcelain=v1", "--untracked-files=all"],
        timeout_seconds=20,
    ):
        raise _ReviewedStartupFailure
    for relative_root in ("scripts/migration", "supabase/migrations"):
        for arguments in (
            ["ls-files", "--others", "--exclude-standard", "--", relative_root],
            [
                "ls-files",
                "--others",
                "--ignored",
                "--exclude-standard",
                "--",
                relative_root,
            ],
        ):
            if _reviewed_git_bytes(repository, arguments, timeout_seconds=20):
                raise _ReviewedStartupFailure

    migration_directory = os.path.dirname(script)
    for relative in (
        "lib.py",
        "lib/__init__.py",
        "argparse.py",
        "curses.py",
        "termios.py",
        "tty.py",
    ):
        try:
            os.lstat(os.path.join(migration_directory, relative))
        except FileNotFoundError:
            continue
        except OSError as exc:
            raise _ReviewedStartupFailure from exc
        raise _ReviewedStartupFailure

    for relative in (
        "scripts/migration/run-lovable-toc-annotation-authoring.sh",
        "scripts/migration/author-lovable-toc-annotations.py",
        "scripts/migration/lib/lovable_toc_authoring_contract.py",
        "scripts/migration/lib/lovable_toc_contract.py",
        "scripts/migration/lib/lovable_dump_report.py",
        "scripts/migration/verification/lovable-toc-annotation-checkpoint.schema.json",
        "scripts/migration/verification/lovable-toc-annotation-ledger.schema.json",
    ):
        blob = _reviewed_git_bytes(
            repository, ["rev-parse", f"HEAD:{relative}"], timeout_seconds=20
        ).strip()
        working = _reviewed_git_bytes(
            repository, ["hash-object", "--", relative], timeout_seconds=20
        ).strip()
        if (
            len(blob) != 40
            or any(byte not in b"0123456789abcdef" for byte in blob)
            or working != blob
        ):
            raise _ReviewedStartupFailure


if __name__ == "__main__":
    try:
        _reject_known_recording_ancestors()
    except BaseException:
        _fail_startup_tty()
    try:
        _preimport_repository_guard()
    except BaseException:
        _fail_startup_binding()

import argparse  # Preload the complete reviewed local-library stdlib closure.
import ctypes
import errno
import hashlib
import hmac
import json
import re
import secrets
import struct
import termios
from collections import Counter
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable, Optional, Sequence, Tuple


try:
    SCRIPT = Path(__file__).resolve(strict=True)
    REPO = SCRIPT.parents[2]
    if str(SCRIPT.parent) not in sys.path:
        sys.path.insert(0, str(SCRIPT.parent))
    from lib.lovable_toc_contract import (  # noqa: E402
        CLASSIFICATIONS,
        ENTRY_MANAGED_DOMAINS,
        FINAL_DISPOSITIONS,
        GLOBAL_HANDLING,
        MANAGED_DOMAINS,
        MANAGED_HANDLING,
        ContractError,
        canonical_json_bytes,
        emit_fixed_diagnostic,
        stable_regular_digest,
        strict_json_loads,
    )
    from lib.lovable_toc_authoring_contract import (  # noqa: E402
        AuthoringBinding,
        AuthoringContractError,
        CaptureExpectations,
        PUBLIC_AUTHORING_STATES,
        aggregate_status,
        apply_transition,
        build_final_ledger,
        checkpoint_sha256,
        finalization_eligibility,
        initialize_checkpoint,
        load_capture_for_authoring,
        load_checkpoint_chain,
        next_review_ordinals,
        publish_checkpoint_at,
        publish_final_candidate_at,
    )
except BaseException:
    if __name__ == "__main__":
        _fail_startup_binding()
    raise


STAGE = "annotation_authoring"
MAX_TOOL_BYTES = 100 * 1024 * 1024
TTY_ATTESTATION = "LOCAL_CONTROLLING_TTY_NO_RECORDING_NO_REMOTE_NO_CLIPBOARD"
TTY_FD_RE = re.compile(r"[3-9][0-9]{0,7}\Z", re.ASCII)
PYTHON_VERSION_RE = re.compile(
    r"cpython:(?:0|[1-9][0-9]{0,2})\."
    r"(?:0|[1-9][0-9]{0,2})\."
    r"(?:0|[1-9][0-9]{0,2})\Z",
    re.ASCII,
)
CLEAR_SCREEN = b"\x1b[2J\x1b[H\x1b[3J"
ENTER_ALTERNATE_SCREEN = b"\x1b[?1049h"
LEAVE_ALTERNATE_SCREEN = b"\x1b[?1049l"
MAX_TTY_INPUT_BYTES = 128
MAX_TTY_CONTEXT_BYTES = 1024 * 1024
LOCK_NAME = "AUTHORING_LOCK"
RELEASED_NAME = "AUTHORING_RELEASED"
INDETERMINATE_NAME = "AUTHORING_INDETERMINATE"
LOCK_PREFIX = b"AUTHORING_LOCK_V2 "
INITIAL_RELEASE_TOKEN = "0" * 64
CHECKPOINTS_NAME = "checkpoints"
FINAL_PACKAGE_RE = re.compile(r"final-ledger-[0-9a-f]{12}\Z", re.ASCII)
FINALIZATION_AUTHORIZATION = "CREATE_UNVALIDATED_LEDGER"
SAFE_CHILD_NAME_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,159}\Z", re.ASCII)
SAFE_IDENTITY_RE = re.compile(
    r"[A-Za-z0-9][A-Za-z0-9 ._@()+:-]{0,127}\Z", re.ASCII
)
ACTION_VALUES = frozenset(
    {
        "initialize",
        "primary_review",
        "revisit_unresolved",
        "relationship_review",
        "data_reference_review",
        "sequence_review",
        "managed_review",
        "manual_conflict_review",
        "peer_review",
        "correction_review",
        "status",
        "finalize",
    }
)
PUBLIC_COUNT_KEYS = frozenset(
    {
        "data_reference_count",
        "data_reference_reviewed_count",
        "entry_count",
        "manual_conflict_pending_count",
        "peer_reviewed_count",
        "primary_reviewed_count",
        "sequence_reviewed_count",
        "unresolved_count",
        *{"classification_" + value + "_count" for value in CLASSIFICATIONS},
    }
)

FAILURE_REASONS = frozenset(
    {
        "input_invalid",
        "binding_mismatch",
        "tty_invalid",
        "checkpoint_invalid",
        "capture_invalid",
        "finalization_incomplete",
        "history_conflict",
        "history_invalid",
        "input_mutated",
        "peer_identity_conflict",
        "review_transition_invalid",
        "publication_exists",
        "publication_failed",
        "cleanup_indeterminate",
        "internal_failure",
    }
)
OPERATOR_ENTRYPOINT = __name__ == "__main__"


class AuthoringEntrypointError(RuntimeError):
    def __init__(self, reason: str):
        self.reason = reason if reason in FAILURE_REASONS else "internal_failure"
        super().__init__(self.reason)


def _emit_operator_diagnostic(name: str, fallback: Any, payload: bytes) -> None:
    if type(payload) is not bytes or len(payload) > 16 * 1024:
        return
    if not OPERATOR_ENTRYPOINT:
        emit_fixed_diagnostic(fallback, payload)
        return
    try:
        raw = os.environ[name]
        if not raw.isdigit() or int(raw) < 3:
            return
        descriptor = int(raw)
        offset = 0
        while offset < len(payload):
            written = os.write(descriptor, payload[offset:])
            if written <= 0:
                return
            offset += written
    except BaseException:
        pass


def _fixed_diagnostic(
    *,
    status: str,
    reason: str,
    counts: Mapping[str, int] | None = None,
    authoring_state: str | None = None,
) -> bytes:
    if status == "failed":
        if reason not in FAILURE_REASONS:
            reason = "internal_failure"
        record: dict[str, Any] = {
            "diagnostic_version": 1,
            "reason": reason,
            "stage": STAGE,
            "status": "failed",
        }
        return canonical_json_bytes(record)
    if (
        status != "review_required"
        or reason != "blocked"
        or type(counts) is not dict
        or type(authoring_state) is not str
        or authoring_state not in PUBLIC_AUTHORING_STATES
    ):
        return _fixed_diagnostic(status="failed", reason="internal_failure")
    if set(counts) != set(PUBLIC_COUNT_KEYS) or any(
        type(key) is not str
        or type(value) is not int
        or value < 0
        for key, value in counts.items()
    ):
        return _fixed_diagnostic(status="failed", reason="internal_failure")
    return canonical_json_bytes(
        {
            "authoring_state": authoring_state,
            "counts": {key: counts[key] for key in sorted(counts)},
            "diagnostic_version": 1,
            "ledger_validation_gate": "BLOCKED",
            "migration_readiness": "RED",
            "reason": "blocked",
            "restore_command_gate": "BLOCKED",
            "restore_planning_gate": "BLOCKED",
            "review_gate": "REVIEW_REQUIRED",
            "stage": STAGE,
            "status": "review_required",
        }
    )


def _required(environment: Mapping[str, str], name: str) -> str:
    value = environment.get(name)
    if (
        type(value) is not str
        or not value
        or value != value.strip()
        or "\x00" in value
        or any(ord(character) < 0x20 or ord(character) == 0x7F for character in value)
    ):
        raise AuthoringEntrypointError("input_invalid")
    return value


def _validate_execution_python(environment: Mapping[str, str]) -> dict[str, Any]:
    raw_path = _required(environment, "TOC_AUTHOR_EXECUTION_PYTHON")
    approved_sha = _required(
        environment, "TOC_AUTHOR_APPROVED_EXECUTION_PYTHON_SHA256"
    )
    approved_version = _required(
        environment, "TOC_AUTHOR_APPROVED_EXECUTION_PYTHON_VERSION"
    )
    if re.fullmatch(r"[0-9a-f]{64}", approved_sha, re.ASCII) is None:
        raise AuthoringEntrypointError("input_invalid")
    if PYTHON_VERSION_RE.fullmatch(approved_version) is None:
        raise AuthoringEntrypointError("input_invalid")
    path = Path(raw_path)
    try:
        resolved = path.resolve(strict=True)
        running = Path(sys.executable).resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise AuthoringEntrypointError("input_invalid") from exc
    if (
        not path.is_absolute()
        or raw_path != os.path.abspath(raw_path)
        or path.is_symlink()
        or resolved != path
        or running != resolved
    ):
        raise AuthoringEntrypointError("binding_mismatch")
    try:
        identity = stable_regular_digest(
            resolved, max_bytes=MAX_TOOL_BYTES, require_executable=True
        )
    except ContractError as exc:
        raise AuthoringEntrypointError("input_invalid") from exc
    observed_version = (
        f"{sys.implementation.name}:{sys.version_info.major}."
        f"{sys.version_info.minor}.{sys.version_info.micro}"
    )
    if (
        identity.sha256 != approved_sha
        or observed_version != approved_version
        or identity.owner_uid not in {0, os.geteuid()}
        or identity.mode & 0o7022
        or identity.mode & 0o100 == 0
    ):
        raise AuthoringEntrypointError("binding_mismatch")
    return {
        "approved_identity": f"sha256:{approved_sha}",
        "device": identity.device,
        "gid": identity.owner_gid,
        "inode": identity.inode,
        "mode": format(identity.mode, "04o"),
        "reported_version": approved_version,
        "sha256": identity.sha256,
        "size_bytes": identity.size,
        "uid": identity.owner_uid,
    }


def _validate_tty(environment: Mapping[str, str]) -> int:
    if _required(environment, "TOC_AUTHOR_LOCAL_TTY_ATTESTATION") != TTY_ATTESTATION:
        raise AuthoringEntrypointError("tty_invalid")
    raw_fd = _required(environment, "TOC_AUTHOR_TTY_FD")
    if raw_fd != "3":
        raise AuthoringEntrypointError("tty_invalid")
    tty_fd = int(raw_fd)
    diagnostic_stdout_raw = _required(
        environment, "TOC_INTERNAL_DIAGNOSTIC_STDOUT_FD"
    )
    diagnostic_stderr_raw = _required(
        environment, "TOC_INTERNAL_DIAGNOSTIC_STDERR_FD"
    )
    if diagnostic_stdout_raw != "6" or diagnostic_stderr_raw != "5":
        raise AuthoringEntrypointError("tty_invalid")
    diagnostic_stdout_fd = int(diagnostic_stdout_raw)
    diagnostic_stderr_fd = int(diagnostic_stderr_raw)
    reviewed_descriptors = (
        0,
        tty_fd,
        diagnostic_stdout_fd,
        diagnostic_stderr_fd,
    )
    if len(set(reviewed_descriptors)) != len(reviewed_descriptors):
        raise AuthoringEntrypointError("tty_invalid")
    try:
        reviewed_metadata = [os.fstat(descriptor) for descriptor in reviewed_descriptors]
        if (
            any(
                not _startup_stat.S_ISCHR(metadata.st_mode)
                or not os.isatty(descriptor)
                for descriptor, metadata in zip(
                    reviewed_descriptors, reviewed_metadata
                )
            )
            or len(
                {(item.st_dev, item.st_rdev) for item in reviewed_metadata}
            )
            != 1
            or any(
                os.tcgetpgrp(descriptor) != os.getpgrp()
                for descriptor in reviewed_descriptors
            )
        ):
            raise AuthoringEntrypointError("tty_invalid")
        termios.tcgetattr(tty_fd)
    except (AuthoringEntrypointError, OSError, termios.error) as exc:
        if isinstance(exc, AuthoringEntrypointError):
            raise
        raise AuthoringEntrypointError("tty_invalid") from exc
    return tty_fd


def _write_tty(tty_fd: int, payload: bytes) -> None:
    if type(payload) is not bytes or len(payload) > MAX_TTY_CONTEXT_BYTES:
        raise AuthoringEntrypointError("tty_invalid")
    offset = 0
    try:
        while offset < len(payload):
            written = os.write(tty_fd, payload[offset:])
            if type(written) is not int or written <= 0:
                raise AuthoringEntrypointError("tty_invalid")
            offset += written
    except OSError as exc:
        raise AuthoringEntrypointError("tty_invalid") from exc


def _escape_tty_context(raw_line: bytes) -> bytes:
    """Render exact private bytes without allowing terminal-control injection."""

    if type(raw_line) is not bytes or len(raw_line) > MAX_TTY_CONTEXT_BYTES:
        raise AuthoringEntrypointError("input_invalid")
    try:
        text = raw_line.decode("utf-8", errors="strict")
    except UnicodeDecodeError as exc:
        raise AuthoringEntrypointError("input_invalid") from exc
    # ascii() keeps the byte-distinguishing review context but escapes every
    # control, bidi/format, and non-ASCII scalar before it reaches the TTY.
    return ascii(text).encode("ascii", errors="strict")


def _read_tty_choice(tty_fd: int, *, allowed: frozenset[str]) -> str:
    if not allowed or any(
        re.fullmatch(r"[a-z][a-z0-9_]{0,63}", value, re.ASCII) is None
        for value in allowed
    ):
        raise AuthoringEntrypointError("internal_failure")
    try:
        original = termios.tcgetattr(tty_fd)
    except BaseException as exc:
        raise AuthoringEntrypointError("tty_invalid") from exc
    adjusted = list(original)
    adjusted[3] &= ~(termios.ECHO | termios.ECHONL)
    data = bytearray()
    pending_error: BaseException | None = None
    try:
        termios.tcsetattr(tty_fd, termios.TCSAFLUSH, adjusted)
        while len(data) <= MAX_TTY_INPUT_BYTES:
            chunk = os.read(tty_fd, 1)
            if not chunk:
                raise AuthoringEntrypointError("tty_invalid")
            if chunk in {b"\n", b"\r"}:
                break
            if chunk[0] < 0x20 or chunk[0] > 0x7E:
                raise AuthoringEntrypointError("tty_invalid")
            data.extend(chunk)
        else:
            raise AuthoringEntrypointError("tty_invalid")
    except BaseException as exc:
        pending_error = exc
    finally:
        try:
            termios.tcsetattr(tty_fd, termios.TCSAFLUSH, original)
        except BaseException as exc:
            pending_error = exc
    if pending_error is not None:
        if isinstance(pending_error, AuthoringEntrypointError):
            raise pending_error
        raise AuthoringEntrypointError("tty_invalid") from pending_error
    try:
        value = bytes(data).decode("ascii", errors="strict")
    except UnicodeDecodeError as exc:
        raise AuthoringEntrypointError("tty_invalid") from exc
    if value not in allowed:
        raise AuthoringEntrypointError("input_invalid")
    return value


def _require_resume_acknowledgement(tty_fd: int) -> None:
    """Hold the private tuple on screen until one exact non-echoed response."""

    expected = b"resume_values_recorded"
    try:
        original = termios.tcgetattr(tty_fd)
    except BaseException as exc:
        raise AuthoringEntrypointError("tty_invalid") from exc
    adjusted = list(original)
    adjusted[3] &= ~(termios.ECHO | termios.ECHONL)
    data = bytearray()
    pending_error: BaseException | None = None
    try:
        termios.tcsetattr(tty_fd, termios.TCSAFLUSH, adjusted)
        _write_tty(tty_fd, b"type_resume_values_recorded_to_confirm\n")
        while len(data) <= len(expected):
            chunk = os.read(tty_fd, 1)
            if not chunk:
                raise AuthoringEntrypointError("tty_invalid")
            if chunk in {b"\n", b"\r"}:
                break
            if chunk[0] < 0x20 or chunk[0] > 0x7E:
                raise AuthoringEntrypointError("tty_invalid")
            data.extend(chunk)
        else:
            raise AuthoringEntrypointError("tty_invalid")
        if bytes(data) != expected:
            raise AuthoringEntrypointError("tty_invalid")
    except BaseException as exc:
        pending_error = exc
    finally:
        try:
            termios.tcsetattr(tty_fd, termios.TCSAFLUSH, original)
        except BaseException as exc:
            pending_error = exc
    if pending_error is not None:
        if isinstance(pending_error, AuthoringEntrypointError):
            raise pending_error
        raise AuthoringEntrypointError("tty_invalid") from pending_error


def _clear_tty_best_effort(tty_fd: int) -> None:
    try:
        _write_tty(tty_fd, CLEAR_SCREEN + LEAVE_ALTERNATE_SCREEN)
    except BaseException:
        pass


def _required_sha(environment: Mapping[str, str], name: str) -> str:
    value = _required(environment, name)
    if re.fullmatch(r"[0-9a-f]{64}", value, re.ASCII) is None:
        raise AuthoringEntrypointError("input_invalid")
    return value


def _required_count(environment: Mapping[str, str], name: str, *, allow_zero: bool) -> int:
    value = _required(environment, name)
    if re.fullmatch(r"(?:0|[1-9][0-9]{0,11})", value, re.ASCII) is None:
        raise AuthoringEntrypointError("input_invalid")
    observed = int(value)
    if (not allow_zero and observed == 0) or observed > 10_000_000:
        raise AuthoringEntrypointError("input_invalid")
    return observed


def _open_private_directory_path(raw: str) -> tuple[int, Path, os.stat_result]:
    if type(raw) is not str or not raw or "\x00" in raw:
        raise AuthoringEntrypointError("input_invalid")
    path = Path(raw)
    try:
        resolved = path.resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise AuthoringEntrypointError("input_invalid") from exc
    if not path.is_absolute() or raw != os.path.abspath(raw) or resolved != path:
        raise AuthoringEntrypointError("input_invalid")
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(raw, flags)
        metadata = os.fstat(descriptor)
        named = os.stat(raw, follow_symlinks=False)
    except OSError as exc:
        try:
            os.close(descriptor)
        except (OSError, UnboundLocalError):
            pass
        raise AuthoringEntrypointError("input_invalid") from exc
    if (
        not _startup_stat.S_ISDIR(metadata.st_mode)
        or (metadata.st_dev, metadata.st_ino) != (named.st_dev, named.st_ino)
        or _startup_stat.S_ISLNK(named.st_mode)
        or metadata.st_uid != os.geteuid()
        or _startup_stat.S_IMODE(metadata.st_mode) != 0o700
    ):
        os.close(descriptor)
        raise AuthoringEntrypointError("input_invalid")
    return descriptor, path, metadata


def _open_private_child_directory(parent_fd: int, name: str) -> tuple[int, os.stat_result]:
    if type(name) is not str or SAFE_CHILD_NAME_RE.fullmatch(name) is None:
        raise AuthoringEntrypointError("input_invalid")
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(name, flags, dir_fd=parent_fd)
        metadata = os.fstat(descriptor)
        named = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
    except OSError as exc:
        try:
            os.close(descriptor)
        except (OSError, UnboundLocalError):
            pass
        raise AuthoringEntrypointError("input_invalid") from exc
    if (
        not _startup_stat.S_ISDIR(metadata.st_mode)
        or _startup_stat.S_ISLNK(named.st_mode)
        or (metadata.st_dev, metadata.st_ino) != (named.st_dev, named.st_ino)
        or metadata.st_uid != os.geteuid()
        or _startup_stat.S_IMODE(metadata.st_mode) != 0o700
    ):
        os.close(descriptor)
        raise AuthoringEntrypointError("input_invalid")
    return descriptor, metadata


def _revalidate_named_directory(path: Path, metadata: os.stat_result) -> None:
    try:
        observed = os.stat(path, follow_symlinks=False)
    except OSError as exc:
        raise AuthoringEntrypointError("input_mutated") from exc
    if (
        _startup_stat.S_ISLNK(observed.st_mode)
        or not _startup_stat.S_ISDIR(observed.st_mode)
        or (observed.st_dev, observed.st_ino) != (metadata.st_dev, metadata.st_ino)
        or observed.st_uid != metadata.st_uid
        or _startup_stat.S_IMODE(observed.st_mode) != 0o700
    ):
        raise AuthoringEntrypointError("input_mutated")


def _revalidate_child_directory(
    parent_fd: int,
    name: str,
    descriptor: int,
    expected: os.stat_result,
) -> None:
    """Bind an open child directory to its still-named parent entry."""

    try:
        held = os.fstat(descriptor)
        named = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
    except OSError as exc:
        raise AuthoringEntrypointError("input_mutated") from exc
    expected_identity = (expected.st_dev, expected.st_ino)
    if (
        not _startup_stat.S_ISDIR(held.st_mode)
        or not _startup_stat.S_ISDIR(named.st_mode)
        or _startup_stat.S_ISLNK(named.st_mode)
        or (held.st_dev, held.st_ino) != expected_identity
        or (named.st_dev, named.st_ino) != expected_identity
        or held.st_uid != os.geteuid()
        or named.st_uid != os.geteuid()
        or _startup_stat.S_IMODE(held.st_mode) != 0o700
        or _startup_stat.S_IMODE(named.st_mode) != 0o700
    ):
        raise AuthoringEntrypointError("input_mutated")


def _assert_disjoint_outside_repository(paths: tuple[Path, ...]) -> None:
    repository = REPO.resolve(strict=True)
    normalized = [path.resolve(strict=True) for path in paths]
    for path in normalized:
        try:
            if os.path.commonpath((os.fspath(repository), os.fspath(path))) == os.fspath(repository):
                raise AuthoringEntrypointError("input_invalid")
        except ValueError as exc:
            raise AuthoringEntrypointError("input_invalid") from exc
    for index, left in enumerate(normalized):
        for right in normalized[index + 1 :]:
            try:
                common = Path(os.path.commonpath((os.fspath(left), os.fspath(right))))
            except ValueError as exc:
                raise AuthoringEntrypointError("input_invalid") from exc
            if common in {left, right}:
                raise AuthoringEntrypointError("input_invalid")


def _authoring_procedure_identity(approved_checkout: str) -> str:
    records: dict[str, str] = {"execution_checkout_sha": approved_checkout}
    relatives = (
        "docs/migration/migration-runbook.md",
        "scripts/migration/README.md",
        "scripts/migration/author-lovable-toc-annotations.py",
        "scripts/migration/run-lovable-toc-annotation-authoring.sh",
        "scripts/migration/lib/lovable_toc_authoring_contract.py",
        "scripts/migration/lib/lovable_toc_contract.py",
        "scripts/migration/verification/lovable-toc-annotation-checkpoint.schema.json",
        "scripts/migration/verification/lovable-toc-annotation-ledger.schema.json",
    )
    for relative in relatives:
        try:
            blob = _reviewed_git_bytes(
                os.fspath(REPO), ["rev-parse", f"HEAD:{relative}"], timeout_seconds=20
            ).decode("ascii", errors="strict").strip()
        except (UnicodeDecodeError, _ReviewedStartupFailure) as exc:
            raise AuthoringEntrypointError("binding_mismatch") from exc
        if re.fullmatch(r"[0-9a-f]{40}", blob, re.ASCII) is None:
            raise AuthoringEntrypointError("binding_mismatch")
        records[relative] = blob
    return hashlib.sha256(canonical_json_bytes(records)).hexdigest()


def _read_tty_line(tty_fd: int) -> str:
    try:
        original = termios.tcgetattr(tty_fd)
    except BaseException as exc:
        raise AuthoringEntrypointError("tty_invalid") from exc
    adjusted = list(original)
    adjusted[3] &= ~(termios.ECHO | termios.ECHONL)
    data = bytearray()
    pending_error: BaseException | None = None
    try:
        termios.tcsetattr(tty_fd, termios.TCSAFLUSH, adjusted)
        while len(data) <= MAX_TTY_INPUT_BYTES:
            chunk = os.read(tty_fd, 1)
            if not chunk:
                raise AuthoringEntrypointError("tty_invalid")
            if chunk in {b"\n", b"\r"}:
                break
            if chunk[0] < 0x20 or chunk[0] > 0x7E:
                raise AuthoringEntrypointError("tty_invalid")
            data.extend(chunk)
        else:
            raise AuthoringEntrypointError("tty_invalid")
    except BaseException as exc:
        pending_error = exc
    finally:
        try:
            termios.tcsetattr(tty_fd, termios.TCSAFLUSH, original)
        except BaseException as exc:
            pending_error = exc
    if pending_error is not None:
        if isinstance(pending_error, AuthoringEntrypointError):
            raise pending_error
        raise AuthoringEntrypointError("tty_invalid") from pending_error
    try:
        return bytes(data).decode("ascii", errors="strict")
    except UnicodeDecodeError as exc:
        raise AuthoringEntrypointError("tty_invalid") from exc


def _prompt_choice(tty_fd: int, label: bytes, allowed: frozenset[str]) -> str:
    menu = b"|".join(value.encode("ascii") for value in sorted(allowed))
    _write_tty(tty_fd, label + b" [" + menu + b"]\n")
    return _read_tty_choice(tty_fd, allowed=allowed)


REFERENCE_ROLES = frozenset(
    {
        "dependency",
        "structural_parent",
        "metadata_parent",
        "sequence_metadata_parent",
        "sequence_structural_parent",
    }
)


def _show_review_context(
    tty_fd: int,
    capture: Any,
    ordinal: int,
    *,
    reference_role: str | None = None,
) -> None:
    entry = capture.entries_by_ordinal[ordinal]
    if reference_role is not None and reference_role not in REFERENCE_ROLES:
        raise AuthoringEntrypointError("internal_failure")
    heading = (
        b"REFERENCE_CONTEXT"
        if reference_role is not None
        else b"PRIVATE_REVIEW_CONTEXT"
    )
    context = (
        CLEAR_SCREEN
        + heading
        + (
            b"\nreference_role=" + reference_role.encode("ascii")
            if reference_role is not None
            else b""
        )
        + b"\nordinal="
        + str(ordinal + 1).encode("ascii")
        + b"\nclass="
        + entry.object_class.encode("ascii")
        + b"\nraw_toc="
        + _escape_tty_context(entry.raw_line)
        + b"\nmechanical_proposal_version=1"
        + b"\nmechanical_classification=unresolved"
        + b"\nmechanical_proposal_is_not_approval=true\n"
    )
    _write_tty(tty_fd, context)


def _prompt_ordinals(
    tty_fd: int,
    capture: Any,
    *,
    current: int,
    role: str,
    single: bool,
) -> list[str]:
    prompts = {
        ("dependency", False): b"dependency_ordinals_csv_or_none",
        ("structural_parent", False): b"structural_parent_ordinals_csv_or_none",
        ("metadata_parent", True): b"metadata_parent_ordinal",
        ("sequence_metadata_parent", True): b"sequence_metadata_parent_ordinal",
    }
    prompt = prompts.get((role, single))
    if prompt is None:
        raise AuthoringEntrypointError("internal_failure")
    shown: set[int] = set()
    while True:
        _write_tty(tty_fd, prompt + b" (show:N displays local context)\n")
        value = _read_tty_line(tty_fd)
        if value.startswith("show:"):
            raw = value[5:]
            if re.fullmatch(r"[1-9][0-9]{0,11}", raw, re.ASCII) is None:
                raise AuthoringEntrypointError("input_invalid")
            ordinal = int(raw) - 1
            if ordinal < 0 or ordinal >= len(capture.entries_by_ordinal):
                raise AuthoringEntrypointError("input_invalid")
            _show_review_context(
                tty_fd, capture, ordinal, reference_role=role
            )
            shown.add(ordinal)
            continue
        if value == "none" and not single:
            return []
        pieces = value.split(",")
        if single and len(pieces) != 1:
            raise AuthoringEntrypointError("input_invalid")
        ordinals: list[int] = []
        for piece in pieces:
            if re.fullmatch(r"[1-9][0-9]{0,11}", piece, re.ASCII) is None:
                raise AuthoringEntrypointError("input_invalid")
            ordinal = int(piece) - 1
            if (
                ordinal < 0
                or ordinal >= len(capture.entries_by_ordinal)
                or ordinal == current
                or ordinal in ordinals
            ):
                raise AuthoringEntrypointError("input_invalid")
            ordinals.append(ordinal)
        if not set(ordinals).issubset(shown):
            raise AuthoringEntrypointError("input_invalid")
        return [capture.entries_by_ordinal[item].entry_id for item in ordinals]


def _show_role_context_and_acknowledge(
    tty_fd: int, capture: Any, ordinal: int, *, role: str
) -> None:
    if role not in REFERENCE_ROLES:
        raise AuthoringEntrypointError("internal_failure")
    _show_review_context(tty_fd, capture, ordinal, reference_role=role)
    confirmation = _prompt_choice(
        tty_fd,
        b"confirm_" + role.encode("ascii") + b"_context_reviewed",
        frozenset({"context_reviewed"}),
    )
    if confirmation != "context_reviewed":
        raise AuthoringEntrypointError("input_invalid")


def _prompt_correction_ordinals(
    tty_fd: int, capture: Any, *, allow_empty: bool
) -> tuple[int, ...]:
    """Read one deterministic correction batch only from the held TTY."""

    _write_tty(
        tty_fd,
        b"correction_ordinals_csv_1_based_max_100"
        + (b"_or_none" if allow_empty else b"")
        + b"\n",
    )
    value = _read_tty_line(tty_fd)
    if value == "none" and allow_empty:
        return ()
    pieces = value.split(",")
    if not pieces or len(pieces) > 100:
        raise AuthoringEntrypointError("input_invalid")
    ordinals: list[int] = []
    for piece in pieces:
        if re.fullmatch(r"[1-9][0-9]{0,11}", piece, re.ASCII) is None:
            raise AuthoringEntrypointError("input_invalid")
        ordinal = int(piece) - 1
        if (
            ordinal < 0
            or ordinal >= len(capture.entries_by_ordinal)
            or ordinal in ordinals
        ):
            raise AuthoringEntrypointError("input_invalid")
        ordinals.append(ordinal)
    if ordinals != sorted(ordinals):
        raise AuthoringEntrypointError("input_invalid")
    return tuple(ordinals)


def _ranges(ordinals: tuple[int, ...]) -> list[dict[str, int]]:
    if not ordinals:
        return []
    result: list[dict[str, int]] = []
    start = previous = ordinals[0]
    for ordinal in ordinals[1:]:
        if ordinal == previous + 1:
            previous = ordinal
            continue
        result.append({"end_exclusive": previous + 1, "start": start})
        start = previous = ordinal
    result.append({"end_exclusive": previous + 1, "start": start})
    return result


def _copy_decision(record: Mapping[str, Any]) -> dict[str, Any]:
    return strict_json_loads(canonical_json_bytes(record["primary_decision"]))


def _show_peer_decision(
    tty_fd: int, capture: Any, record: Mapping[str, Any]
) -> None:
    decision = record["primary_decision"]
    fields = (
        ("classification", decision["classification"]),
        ("managed_domain", decision["managed_domain"]),
        ("manual_conflict_disposition", decision["manual_conflict_disposition"]),
        ("dependency_reviewed", decision["dependency_reviewed"]),
        ("relationship_review_state", decision["relationship_review_state"]),
        ("data_reference_review_state", decision["data_reference_review_state"]),
        ("sequence_review_state", decision["sequence_review_state"]),
    )
    lines = [b"PRIMARY_DECISION_FOR_PEER_REVIEW"]
    for name, value in fields:
        rendered = "none" if value is None else str(value).lower() if type(value) is bool else value
        if type(rendered) is not str or not rendered.isascii():
            raise AuthoringEntrypointError("checkpoint_invalid")
        lines.append(name.encode("ascii") + b"=" + rendered.encode("ascii"))
    lines.extend(
        (
            b"dependency_count=" + str(len(decision["dependency_entry_ids"])).encode("ascii"),
            b"structural_parent_count="
            + str(len(decision["parent_entry_ids"])).encode("ascii"),
            b"metadata_parent_present="
            + (b"true" if decision["metadata_parent_entry_id"] is not None else b"false"),
        )
    )
    _write_tty(tty_fd, b"\n".join(lines) + b"\n")
    summary_confirmation = _prompt_choice(
        tty_fd,
        b"confirm_primary_decision_summary_reviewed",
        frozenset({"summary_reviewed"}),
    )
    if summary_confirmation != "summary_reviewed":
        raise AuthoringEntrypointError("input_invalid")
    by_id = {entry.entry_id: entry.ordinal for entry in capture.entries_by_ordinal}
    role_assignments: list[tuple[str, list[str]]] = [
        ("dependency", list(decision["dependency_entry_ids"])),
        ("structural_parent", list(decision["parent_entry_ids"])),
    ]
    metadata_parent = decision["metadata_parent_entry_id"]
    if metadata_parent is not None:
        role_assignments.append(("metadata_parent", [metadata_parent]))
    object_class = capture.entries_by_ordinal[record["ordinal"]].object_class
    if object_class == "SEQUENCE SET" and metadata_parent is not None:
        role_assignments.append(("sequence_metadata_parent", [metadata_parent]))
    if object_class == "SEQUENCE OWNED BY":
        role_assignments.append(
            ("sequence_structural_parent", list(decision["parent_entry_ids"]))
        )
    for role, entry_ids in role_assignments:
        for entry_id in sorted(entry_ids, key=lambda value: by_id[value]):
            _show_role_context_and_acknowledge(
                tty_fd,
                capture,
                by_id[entry_id],
                role=role,
            )


def _entry_updates(
    action: str, checkpoint: Mapping[str, Any], capture: Any, ordinals: tuple[int, ...], tty_fd: int
) -> list[dict[str, Any]]:
    updates: list[dict[str, Any]] = []
    for ordinal in ordinals:
        record = checkpoint["entries"][ordinal]
        _show_review_context(tty_fd, capture, ordinal)
        if action == "peer_review":
            _show_peer_decision(tty_fd, capture, record)
            status = _prompt_choice(
                tty_fd, b"peer_decision", frozenset({"approved", "changes_requested"})
            )
            updates.append(
                {
                    "ordinal": ordinal,
                    "peer_status": status,
                    "primary_decision_sha256": record["primary_decision_sha256"],
                }
            )
            continue
        decision = _copy_decision(record)
        if action in {"primary_review", "revisit_unresolved"}:
            allowed = CLASSIFICATIONS
            if action == "revisit_unresolved":
                allowed = frozenset(CLASSIFICATIONS - {"unresolved"})
            classification = _prompt_choice(tty_fd, b"classification", allowed)
            decision["classification"] = classification
            decision["classification_reviewed"] = True
            decision["manual_conflict_disposition"] = None
            decision["manual_conflict_review_state"] = (
                "pending" if classification == "manual_conflict" else "not_applicable"
            )
        elif action in {"relationship_review", "relationship_correction"}:
            previous_parent_entry_ids = list(decision["parent_entry_ids"])
            decision["dependency_entry_ids"] = _prompt_ordinals(
                tty_fd,
                capture,
                current=ordinal,
                role="dependency",
                single=False,
            )
            decision["dependency_reviewed"] = True
            relationship_state = decision["relationship_review_state"]
            if relationship_state == "pending" or (
                action == "relationship_correction" and relationship_state == "reviewed"
            ):
                decision["parent_entry_ids"] = _prompt_ordinals(
                    tty_fd,
                    capture,
                    current=ordinal,
                    role="structural_parent",
                    single=False,
                )
                decision["relationship_review_state"] = (
                    "pending"
                    if action == "relationship_correction"
                    and not decision["parent_entry_ids"]
                    else "reviewed"
                )
            if (
                action == "relationship_correction"
                and capture.entries_by_ordinal[ordinal].object_class
                == "SEQUENCE OWNED BY"
                and decision["parent_entry_ids"] != previous_parent_entry_ids
            ):
                decision["sequence_review_state"] = "pending"
        elif action == "data_reference_review":
            selected = _prompt_ordinals(
                tty_fd,
                capture,
                current=ordinal,
                role="metadata_parent",
                single=True,
            )
            decision["metadata_parent_entry_id"] = selected[0]
            decision["data_reference_review_state"] = "reviewed"
        elif action == "sequence_review":
            if capture.entries_by_ordinal[ordinal].object_class == "SEQUENCE SET":
                selected = _prompt_ordinals(
                    tty_fd,
                    capture,
                    current=ordinal,
                    role="sequence_metadata_parent",
                    single=True,
                )
                decision["metadata_parent_entry_id"] = selected[0]
            elif (
                capture.entries_by_ordinal[ordinal].object_class == "SEQUENCE OWNED BY"
                and decision["relationship_review_state"] == "reviewed"
                and decision["parent_entry_ids"]
            ):
                for entry_id in decision["parent_entry_ids"]:
                    by_id = {
                        entry.entry_id: entry.ordinal
                        for entry in capture.entries_by_ordinal
                    }
                    _show_role_context_and_acknowledge(
                        tty_fd,
                        capture,
                        by_id[entry_id],
                        role="sequence_structural_parent",
                    )
                confirmation = _prompt_choice(
                    tty_fd,
                    b"confirm_sequence_structural_parent_relationship",
                    frozenset({"confirmed"}),
                )
                if confirmation != "confirmed":
                    raise AuthoringEntrypointError("input_invalid")
            else:
                raise AuthoringEntrypointError("review_transition_invalid")
            decision["sequence_review_state"] = "reviewed"
        elif action == "managed_review":
            decision["managed_domain"] = _prompt_choice(
                tty_fd, b"managed_domain", ENTRY_MANAGED_DOMAINS
            )
            decision["managed_domain_reviewed"] = True
        elif action == "manual_conflict_review":
            decision["manual_conflict_disposition"] = _prompt_choice(
                tty_fd, b"manual_conflict_disposition", FINAL_DISPOSITIONS
            )
            decision["manual_conflict_review_state"] = "reviewed"
        else:
            raise AuthoringEntrypointError("input_invalid")
        updates.append({"ordinal": ordinal, "primary_decision": decision})
    return updates


def _global_updates(
    action: str,
    checkpoint: Mapping[str, Any],
    tty_fd: int,
    *,
    force_primary_review: bool = False,
) -> tuple[dict[str, str], dict[str, str]]:
    global_updates: dict[str, str] = {}
    managed_updates: dict[str, str] = {}
    if action == "managed_review":
        for name in sorted(GLOBAL_HANDLING):
            record = checkpoint["global_decisions"][name]
            if (
                force_primary_review
                or not record["primary_reviewed"]
                or record["peer_review"]["status"] == "changes_requested"
            ):
                global_updates[name] = _prompt_choice(
                    tty_fd, b"global_" + name.encode("ascii"), GLOBAL_HANDLING[name]
                )
        for name in MANAGED_DOMAINS:
            record = checkpoint["managed_domain_decisions"][name]
            if (
                force_primary_review
                or not record["primary_reviewed"]
                or record["peer_review"]["status"] == "changes_requested"
            ):
                managed_updates[name] = _prompt_choice(
                    tty_fd, b"managed_handling_" + name.encode("ascii"), MANAGED_HANDLING
                )
    elif action == "peer_review":
        peer_choices = frozenset({"approved", "changes_requested"})
        for name in sorted(GLOBAL_HANDLING):
            record = checkpoint["global_decisions"][name]
            if record["primary_reviewed"] and record["peer_review"]["status"] != "approved":
                global_updates[name] = _prompt_choice(
                    tty_fd,
                    b"peer_global_"
                    + name.encode("ascii")
                    + b"_current_"
                    + record["value"].encode("ascii"),
                    peer_choices,
                )
        for name in MANAGED_DOMAINS:
            record = checkpoint["managed_domain_decisions"][name]
            if record["primary_reviewed"] and record["peer_review"]["status"] != "approved":
                managed_updates[name] = _prompt_choice(
                    tty_fd,
                    b"peer_managed_"
                    + name.encode("ascii")
                    + b"_current_"
                    + record["value"].encode("ascii"),
                    peer_choices,
                )
    return global_updates, managed_updates


def _public_counts(status: Mapping[str, Any]) -> dict[str, int]:
    counts = dict(status["counts"])
    for name in CLASSIFICATIONS:
        counts["classification_" + name + "_count"] = status[
            "classification_counts"
        ][name]
    if set(counts) != set(PUBLIC_COUNT_KEYS):
        raise AuthoringEntrypointError("internal_failure")
    return counts


def _lock_content(token: str) -> bytes:
    if re.fullmatch(r"[0-9a-f]{64}", token, re.ASCII) is None:
        raise AuthoringEntrypointError("history_conflict")
    return LOCK_PREFIX + token.encode("ascii") + b"\n"


def _acquire_lock(root_fd: int, expected_release_token: str) -> str:
    expected_content = _lock_content(expected_release_token)
    released_present = False
    try:
        released = os.stat(RELEASED_NAME, dir_fd=root_fd, follow_symlinks=False)
    except FileNotFoundError:
        pass
    except OSError as exc:
        raise AuthoringEntrypointError("history_conflict") from exc
    else:
        released_present = True
        released_fd = -1
        try:
            if (
                not _startup_stat.S_ISREG(released.st_mode)
                or released.st_uid != os.geteuid()
                or released.st_nlink != 1
                or _startup_stat.S_IMODE(released.st_mode) != 0o400
                or released.st_size != len(expected_content)
            ):
                raise AuthoringEntrypointError("history_conflict")
            flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
            flags |= getattr(os, "O_NOFOLLOW", 0)
            released_fd = os.open(RELEASED_NAME, flags, dir_fd=root_fd)
            held = os.fstat(released_fd)
            content = os.read(released_fd, len(expected_content) + 1)
            held_after = os.fstat(released_fd)
            held_identity = (
                held.st_dev,
                held.st_ino,
                held.st_mode,
                held.st_nlink,
                held.st_uid,
                held.st_gid,
                held.st_size,
                held.st_mtime_ns,
                held.st_ctime_ns,
            )
            if (
                held_identity
                != (
                    released.st_dev,
                    released.st_ino,
                    released.st_mode,
                    released.st_nlink,
                    released.st_uid,
                    released.st_gid,
                    released.st_size,
                    released.st_mtime_ns,
                    released.st_ctime_ns,
                )
                or held_identity
                != (
                    held_after.st_dev,
                    held_after.st_ino,
                    held_after.st_mode,
                    held_after.st_nlink,
                    held_after.st_uid,
                    held_after.st_gid,
                    held_after.st_size,
                    held_after.st_mtime_ns,
                    held_after.st_ctime_ns,
                )
                or content != expected_content
            ):
                raise AuthoringEntrypointError("history_conflict")
        except OSError as exc:
            raise AuthoringEntrypointError("history_conflict") from exc
        finally:
            if released_fd >= 0:
                try:
                    os.close(released_fd)
                except OSError:
                    pass
    if not released_present and expected_release_token != INITIAL_RELEASE_TOKEN:
        raise AuthoringEntrypointError("history_conflict")

    descriptor = -1
    active_token = secrets.token_hex(32)
    active_content = _lock_content(active_token)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(LOCK_NAME, flags, 0o400, dir_fd=root_fd)
        if os.write(descriptor, active_content) != len(active_content):
            raise OSError("short private lock write")
        os.fsync(descriptor)
        os.close(descriptor)
        descriptor = -1
        os.fsync(root_fd)
        if released_present:
            os.unlink(RELEASED_NAME, dir_fd=root_fd)
            os.fsync(root_fd)
    except FileExistsError as exc:
        raise AuthoringEntrypointError("history_conflict") from exc
    except OSError as exc:
        try:
            os.close(descriptor)
        except OSError:
            pass
        _mark_indeterminate(root_fd)
        raise AuthoringEntrypointError("cleanup_indeterminate") from exc
    return active_token


def _mark_indeterminate(root_fd: int) -> None:
    marker_fd = -1
    try:
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_CLOEXEC", 0)
        flags |= getattr(os, "O_NOFOLLOW", 0)
        marker_fd = os.open(INDETERMINATE_NAME, flags, 0o400, dir_fd=root_fd)
        os.write(marker_fd, b"AUTHORING_INDETERMINATE\n")
        os.fsync(marker_fd)
        os.close(marker_fd)
        marker_fd = -1
        os.fsync(root_fd)
    except OSError:
        pass
    finally:
        if marker_fd >= 0:
            try:
                os.close(marker_fd)
            except OSError:
                pass


def _release_lock(root_fd: int, active_token: str) -> str:
    expected_content = _lock_content(active_token)
    lock_fd = -1
    try:
        flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
        flags |= getattr(os, "O_NOFOLLOW", 0)
        lock_fd = os.open(LOCK_NAME, flags, dir_fd=root_fd)
        before = os.fstat(lock_fd)
        content = os.read(lock_fd, len(expected_content) + 1)
        after = os.fstat(lock_fd)
        if (
            not _startup_stat.S_ISREG(before.st_mode)
            or before.st_uid != os.geteuid()
            or before.st_nlink != 1
            or _startup_stat.S_IMODE(before.st_mode) != 0o400
            or before.st_size != len(expected_content)
            or content != expected_content
            or (before.st_dev, before.st_ino, before.st_mode, before.st_nlink,
                before.st_uid, before.st_gid, before.st_size, before.st_mtime_ns,
                before.st_ctime_ns)
            != (after.st_dev, after.st_ino, after.st_mode, after.st_nlink,
                after.st_uid, after.st_gid, after.st_size, after.st_mtime_ns,
                after.st_ctime_ns)
        ):
            raise OSError("private authoring lock changed")
        os.close(lock_fd)
        lock_fd = -1
        os.link(
            LOCK_NAME,
            RELEASED_NAME,
            src_dir_fd=root_fd,
            dst_dir_fd=root_fd,
            follow_symlinks=False,
        )
        os.fsync(root_fd)
        os.unlink(LOCK_NAME, dir_fd=root_fd)
        os.fsync(root_fd)
        return active_token
    except OSError as exc:
        if lock_fd >= 0:
            try:
                os.close(lock_fd)
            except OSError:
                pass
        # If the unlink happened but its durability could not be proven,
        # restore a live blocking name from the same inode. The token was
        # privately displayed and acknowledged before this function, but a
        # failed release remains a no-retry hard stop.
        try:
            os.link(
                RELEASED_NAME,
                LOCK_NAME,
                src_dir_fd=root_fd,
                dst_dir_fd=root_fd,
                follow_symlinks=False,
            )
            try:
                os.fsync(root_fd)
            except OSError:
                pass
        except OSError:
            pass
        _mark_indeterminate(root_fd)
        raise AuthoringEntrypointError("cleanup_indeterminate") from exc


def execute_authoring(
    environment: Mapping[str, str], tty_fd: int
) -> tuple[int, bytes]:
    """Run exactly one descriptor-bound authoring operation."""

    action = _required(environment, "TOC_AUTHOR_ACTION")
    if action not in ACTION_VALUES:
        raise AuthoringEntrypointError("input_invalid")
    if (
        action == "finalize"
        and environment.get("TOC_AUTHOR_FINALIZATION_AUTHORIZATION")
        != FINALIZATION_AUTHORIZATION
    ):
        raise AuthoringEntrypointError("finalization_incomplete")
    approved_checkout = _required(
        environment, "TOC_AUTHOR_APPROVED_EXECUTION_CHECKOUT_SHA"
    )
    if re.fullmatch(r"[0-9a-f]{40}", approved_checkout, re.ASCII) is None:
        raise AuthoringEntrypointError("input_invalid")
    primary_operator = _required(environment, "TOC_AUTHOR_PRIMARY_OPERATOR_IDENTITY")
    operator = _required(environment, "TOC_AUTHOR_OPERATOR_IDENTITY")
    session = _required(environment, "TOC_AUTHOR_SESSION_IDENTITY")
    if any(
        value != value.strip()
        or "  " in value
        or SAFE_IDENTITY_RE.fullmatch(value) is None
        for value in (primary_operator, operator, session)
    ):
        raise AuthoringEntrypointError("input_invalid")
    expected_generation = _required_count(
        environment, "TOC_AUTHOR_EXPECTED_HEAD_GENERATION", allow_zero=True
    )
    expected_head = _required(environment, "TOC_AUTHOR_EXPECTED_HEAD_SHA256")
    if expected_generation == 0:
        if expected_head != "0" * 64:
            raise AuthoringEntrypointError("input_invalid")
    elif re.fullmatch(r"[0-9a-f]{64}", expected_head, re.ASCII) is None:
        raise AuthoringEntrypointError("input_invalid")
    expected_release_token = _required_sha(
        environment, "TOC_AUTHOR_EXPECTED_RELEASE_TOKEN"
    )
    if action == "initialize" and expected_release_token != INITIAL_RELEASE_TOKEN:
        raise AuthoringEntrypointError("input_invalid")

    expectations = CaptureExpectations(
        capture_manifest_sha256=_required_sha(
            environment, "TOC_AUTHOR_EXPECTED_CAPTURE_MANIFEST_SHA256"
        ),
        raw_toc_sha256=_required_sha(environment, "TOC_AUTHOR_EXPECTED_RAW_TOC_SHA256"),
        opaque_index_sha256=_required_sha(
            environment, "TOC_AUTHOR_EXPECTED_OPAQUE_INDEX_SHA256"
        ),
        entry_count=_required_count(
            environment, "TOC_AUTHOR_EXPECTED_ENTRY_COUNT", allow_zero=False
        ),
        data_reference_count=_required_count(
            environment, "TOC_AUTHOR_EXPECTED_DATA_REFERENCE_COUNT", allow_zero=True
        ),
        evidence_run_id=_required(environment, "TOC_AUTHOR_EVIDENCE_RUN_ID"),
        outer_archive_sha256=_required_sha(environment, "TOC_AUTHOR_OUTER_SHA256"),
        inner_archive_sha256=_required_sha(environment, "TOC_AUTHOR_INNER_SHA256"),
        evidence_manifest_sha256=_required_sha(
            environment, "TOC_AUTHOR_EVIDENCE_MANIFEST_SHA256"
        ),
        inspection_checkout_sha=_required(
            environment, "TOC_AUTHOR_INSPECTION_CHECKOUT_SHA"
        ),
        inspection_procedure_sha256=_required_sha(
            environment, "TOC_AUTHOR_INSPECTION_PROCEDURE_SHA256"
        ),
        capture_execution_checkout_sha=_required(
            environment, "TOC_AUTHOR_CAPTURE_EXECUTION_CHECKOUT_SHA"
        ),
        capture_procedure_identity_sha256=_required_sha(
            environment, "TOC_AUTHOR_EXPECTED_CAPTURE_PROCEDURE_IDENTITY_SHA256"
        ),
        approved_pg_restore_sha256=_required_sha(
            environment, "TOC_AUTHOR_APPROVED_PG_RESTORE_SHA256"
        ),
    )
    if expectations.data_reference_count > expectations.entry_count:
        raise AuthoringEntrypointError("input_invalid")
    capture_root_raw = _required(environment, "TOC_AUTHOR_CAPTURE_ROOT")
    capture_name = _required(environment, "TOC_AUTHOR_CAPTURE_NAME")
    private_root_raw = _required(environment, "TOC_AUTHOR_PRIVATE_ROOT")
    if SAFE_CHILD_NAME_RE.fullmatch(capture_name) is None:
        raise AuthoringEntrypointError("input_invalid")
    python_identity = _validate_execution_python(environment)
    procedure_identity = _authoring_procedure_identity(approved_checkout)
    binding = AuthoringBinding(
        execution_checkout_sha=approved_checkout,
        procedure_identity_sha256=procedure_identity,
        execution_python_identity_sha256=python_identity["sha256"],
    )

    capture_root_fd = package_fd = private_root_fd = checkpoints_fd = -1
    checkpoints_metadata: os.stat_result | None = None
    lock_held = False
    created_checkpoints = False
    publication_attempted = False
    publication_performed = False
    operation_succeeded = False
    cleanup_ambiguous = False
    active_lock_token: str | None = None
    expected_final_generation = expected_generation
    expected_final_head = expected_head
    try:
        capture_root_fd, capture_root, capture_root_metadata = _open_private_directory_path(
            capture_root_raw
        )
        private_root_fd, private_root, private_root_metadata = _open_private_directory_path(
            private_root_raw
        )
        _assert_disjoint_outside_repository((capture_root, private_root))
        package_fd, package_metadata = _open_private_child_directory(
            capture_root_fd, capture_name
        )
        package_path = capture_root / capture_name
        _assert_disjoint_outside_repository((package_path, private_root))

        try:
            initial_names = set(os.listdir(private_root_fd))
        except OSError as exc:
            raise AuthoringEntrypointError("input_invalid") from exc
        released_present = RELEASED_NAME in initial_names
        base_names = initial_names - {RELEASED_NAME}
        if action == "initialize":
            if initial_names:
                raise AuthoringEntrypointError("history_conflict")
        elif not released_present or CHECKPOINTS_NAME not in base_names:
            raise AuthoringEntrypointError("history_conflict")
        final_packages_before = {
            name
            for name in base_names
            if type(name) is str and FINAL_PACKAGE_RE.fullmatch(name) is not None
        }
        if final_packages_before:
            raise AuthoringEntrypointError("publication_exists")
        if action != "initialize" and base_names != {CHECKPOINTS_NAME}:
            raise AuthoringEntrypointError("history_conflict")

        active_lock_token = _acquire_lock(
            private_root_fd, expected_release_token
        )
        lock_held = True
        if action == "initialize":
            try:
                os.mkdir(CHECKPOINTS_NAME, 0o700, dir_fd=private_root_fd)
                os.fsync(private_root_fd)
                created_checkpoints = True
            except OSError as exc:
                raise AuthoringEntrypointError("publication_failed") from exc
        checkpoints_fd, checkpoints_metadata = _open_private_child_directory(
            private_root_fd, CHECKPOINTS_NAME
        )
        capture = load_capture_for_authoring(package_fd, expectations)
        chain = load_checkpoint_chain(checkpoints_fd, capture, binding)
        observed_generation = 0 if chain.head is None else chain.head["generation"]
        observed_sha = "0" * 64 if chain.head_sha256 is None else chain.head_sha256
        if observed_generation != expected_generation or observed_sha != expected_head:
            raise AuthoringEntrypointError("history_conflict")
        expected_final_generation = observed_generation
        expected_final_head = observed_sha

        if action == "initialize":
            if chain.head is not None:
                raise AuthoringEntrypointError("history_conflict")
            if operator != primary_operator:
                raise AuthoringEntrypointError("binding_mismatch")
            checkpoint = initialize_checkpoint(
                capture, binding, primary_operator, session
            )
            refreshed = load_capture_for_authoring(package_fd, expectations)
            if refreshed.capture_binding != capture.capture_binding:
                raise AuthoringEntrypointError("input_mutated")
            publication_attempted = True
            try:
                publish_checkpoint_at(checkpoints_fd, checkpoint)
            except AuthoringContractError as exc:
                if exc.code == "cleanup_indeterminate":
                    cleanup_ambiguous = True
                raise
            publication_performed = True
            expected_final_generation = checkpoint["generation"]
            expected_final_head = checkpoint_sha256(checkpoint)
            published_chain = load_checkpoint_chain(checkpoints_fd, capture, binding)
            if (
                len(published_chain.checkpoints) != 1
                or published_chain.head_sha256 != checkpoint_sha256(checkpoint)
            ):
                raise AuthoringEntrypointError("history_conflict")
            status = aggregate_status(checkpoint, capture)
        else:
            if chain.head is None:
                raise AuthoringEntrypointError("history_invalid")
            checkpoint = chain.head
            if checkpoint["primary_operator_identity"] != primary_operator:
                raise AuthoringEntrypointError("binding_mismatch")
            current_state = aggregate_status(checkpoint, capture)["authoring_state"]
            required_action = {
                "PRIMARY_REVIEW_REQUIRED": "primary_review",
                "REVISIT_REQUIRED": "revisit_unresolved",
                "RELATIONSHIP_REVIEW_REQUIRED": "relationship_review",
                "DATA_REFERENCE_REVIEW_REQUIRED": "data_reference_review",
                "SEQUENCE_REVIEW_REQUIRED": "sequence_review",
                "MANAGED_GLOBAL_REVIEW_REQUIRED": "managed_review",
                "MANUAL_CONFLICT_REVIEW_REQUIRED": "manual_conflict_review",
                "PEER_REVIEW_REQUIRED": "peer_review",
                "FINALIZATION_REVIEW_REQUIRED": "status",
                "FINALIZATION_ELIGIBLE": "finalize",
            }[current_state]
            if action == "status":
                status = aggregate_status(checkpoint, capture)
            elif action == "finalize":
                if required_action != "finalize":
                    raise AuthoringEntrypointError("finalization_incomplete")
                if (
                    _required(environment, "TOC_AUTHOR_FINALIZATION_AUTHORIZATION")
                    != FINALIZATION_AUTHORIZATION
                ):
                    raise AuthoringEntrypointError("finalization_incomplete")
                finalization_eligibility(checkpoint, capture, binding)
                ledger = build_final_ledger(checkpoint, capture, binding)
                finalization = canonical_json_bytes(
                    {
                        "artifact_kind": "lovable_toc_authoring_finalization",
                        "authoring_binding": binding.as_dict(),
                        "capture_binding": dict(capture.capture_binding),
                        "checkpoint_generation": checkpoint["generation"],
                        "checkpoint_sha256": chain.head_sha256,
                        "finalization_operator_identity": operator,
                        "finalization_session_identity": session,
                        "format_version": 1,
                        "ledger_sha256": hashlib.sha256(ledger).hexdigest(),
                        "ledger_validation_status": "NOT_INVOKED",
                        "migration_readiness": "RED",
                        "restore_command_gate": "BLOCKED",
                        "restore_planning_gate": "BLOCKED",
                        "review_status": "REVIEW_REQUIRED",
                    }
                )
                refreshed = load_capture_for_authoring(package_fd, expectations)
                if refreshed.capture_binding != capture.capture_binding:
                    raise AuthoringEntrypointError("input_mutated")
                publication_attempted = True
                try:
                    publish_final_candidate_at(
                        private_root_fd, ledger, finalization, chain.head_sha256
                    )
                except AuthoringContractError as exc:
                    if exc.code == "cleanup_indeterminate":
                        cleanup_ambiguous = True
                    raise
                publication_performed = True
                unchanged_chain = load_checkpoint_chain(
                    checkpoints_fd, capture, binding
                )
                if (
                    len(unchanged_chain.checkpoints) != len(chain.checkpoints)
                    or unchanged_chain.head_sha256 != chain.head_sha256
                ):
                    raise AuthoringEntrypointError("history_conflict")
                status = aggregate_status(checkpoint, capture)
            else:
                semantic_correction = (
                    current_state
                    in {"FINALIZATION_REVIEW_REQUIRED", "FINALIZATION_ELIGIBLE"}
                    and action == "correction_review"
                )
                correcting_peer_rejection = (
                    current_state == "PEER_REVIEW_REQUIRED"
                    and action
                    in {
                        "primary_review",
                        "relationship_review",
                        "data_reference_review",
                        "sequence_review",
                        "managed_review",
                        "manual_conflict_review",
                    }
                )
                if (
                    action != required_action
                    and not correcting_peer_rejection
                    and not semantic_correction
                ):
                    raise AuthoringEntrypointError("review_transition_invalid")
                transition_action = action
                if semantic_correction:
                    transition_action = _prompt_choice(
                        tty_fd,
                        b"correction_phase",
                        frozenset(
                            {
                                "primary_review",
                                "relationship_review",
                                "data_reference_review",
                                "sequence_review",
                                "managed_review",
                                "manual_conflict_review",
                            }
                        ),
                    )
                    ordinals = _prompt_correction_ordinals(
                        tty_fd,
                        capture,
                        allow_empty=transition_action == "managed_review",
                    )
                elif correcting_peer_rejection:
                    requested = tuple(
                        record["ordinal"]
                        for record in checkpoint["entries"]
                        if record["peer_review"]["status"] == "changes_requested"
                    )
                    if action == "data_reference_review":
                        requested = tuple(
                            ordinal
                            for ordinal in requested
                            if capture.entries_by_ordinal[ordinal].is_data_reference
                        )
                    elif action == "sequence_review":
                        requested = tuple(
                            ordinal
                            for ordinal in requested
                            if capture.entries_by_ordinal[ordinal].object_class
                            in {"SEQUENCE SET", "SEQUENCE OWNED BY"}
                        )
                    elif action == "manual_conflict_review":
                        requested = tuple(
                            ordinal
                            for ordinal in requested
                            if checkpoint["entries"][ordinal]["primary_decision"][
                                "classification"
                            ]
                            == "manual_conflict"
                        )
                    ordinals = requested[:100]
                else:
                    ordinals = next_review_ordinals(checkpoint, action, batch_size=100)
                checkpoint_action = (
                    "relationship_correction"
                    if semantic_correction
                    and transition_action == "relationship_review"
                    else transition_action
                )
                entry_updates = _entry_updates(
                    checkpoint_action, checkpoint, capture, ordinals, tty_fd
                )
                global_updates, managed_updates = _global_updates(
                    transition_action,
                    checkpoint,
                    tty_fd,
                    force_primary_review=(
                        semantic_correction and transition_action == "managed_review"
                    ),
                )
                if not entry_updates and not global_updates and not managed_updates:
                    if correcting_peer_rejection:
                        raise AuthoringEntrypointError("review_transition_invalid")
                    status = aggregate_status(checkpoint, capture)
                else:
                    updated = apply_transition(
                        checkpoint,
                        capture,
                        binding,
                        action=checkpoint_action,
                        operator_identity=operator,
                        session_identity=session,
                        reviewed_ordinal_ranges=_ranges(ordinals),
                        entry_updates=entry_updates,
                        global_updates=global_updates,
                        managed_updates=managed_updates,
                    )
                    refreshed = load_capture_for_authoring(package_fd, expectations)
                    if refreshed.capture_binding != capture.capture_binding:
                        raise AuthoringEntrypointError("input_mutated")
                    publication_attempted = True
                    try:
                        publish_checkpoint_at(checkpoints_fd, updated)
                    except AuthoringContractError as exc:
                        if exc.code == "cleanup_indeterminate":
                            cleanup_ambiguous = True
                        raise
                    publication_performed = True
                    expected_final_generation = updated["generation"]
                    expected_final_head = checkpoint_sha256(updated)
                    published_chain = load_checkpoint_chain(
                        checkpoints_fd, capture, binding
                    )
                    if (
                        len(published_chain.checkpoints)
                        != len(chain.checkpoints) + 1
                        or published_chain.head_sha256
                        != checkpoint_sha256(updated)
                    ):
                        raise AuthoringEntrypointError("history_conflict")
                    status = aggregate_status(updated, capture)

        _revalidate_named_directory(capture_root, capture_root_metadata)
        _revalidate_named_directory(private_root, private_root_metadata)
        if checkpoints_metadata is None:
            raise AuthoringEntrypointError("input_mutated")
        _revalidate_child_directory(
            private_root_fd,
            CHECKPOINTS_NAME,
            checkpoints_fd,
            checkpoints_metadata,
        )
        observed_package = os.stat(package_path, follow_symlinks=False)
        if (
            _startup_stat.S_ISLNK(observed_package.st_mode)
            or (observed_package.st_dev, observed_package.st_ino)
            != (package_metadata.st_dev, package_metadata.st_ino)
            or _startup_stat.S_IMODE(observed_package.st_mode) != 0o700
            or observed_package.st_uid != os.geteuid()
        ):
            raise AuthoringEntrypointError("input_mutated")
        if len(
            {
                (capture_root_metadata.st_dev, capture_root_metadata.st_ino),
                (private_root_metadata.st_dev, private_root_metadata.st_ino),
                (package_metadata.st_dev, package_metadata.st_ino),
            }
        ) != 3:
            raise AuthoringEntrypointError("input_mutated")
        final_names = set(os.listdir(private_root_fd))
        expected_names = {CHECKPOINTS_NAME, LOCK_NAME}
        final_packages = {
            name
            for name in final_names
            if type(name) is str and FINAL_PACKAGE_RE.fullmatch(name) is not None
        }
        if len(final_packages) > 1 or final_names != expected_names | final_packages:
            raise AuthoringEntrypointError("history_conflict")
        final_chain = load_checkpoint_chain(checkpoints_fd, capture, binding)
        final_generation = (
            0 if final_chain.head is None else final_chain.head["generation"]
        )
        final_head = (
            "0" * 64
            if final_chain.head_sha256 is None
            else final_chain.head_sha256
        )
        if (
            final_generation != expected_final_generation
            or final_head != expected_final_head
        ):
            raise AuthoringEntrypointError("history_conflict")
        operation_succeeded = True
        return 2, _fixed_diagnostic(
            status="review_required",
            reason="blocked",
            counts=_public_counts(status),
            authoring_state=status["authoring_state"],
        )
    except AuthoringContractError as exc:
        raise AuthoringEntrypointError(exc.code) from exc
    finally:
        for descriptor in (checkpoints_fd, package_fd, capture_root_fd):
            if descriptor >= 0:
                try:
                    os.close(descriptor)
                except OSError:
                    operation_succeeded = False
        if (
            created_checkpoints
            and not operation_succeeded
            and not publication_performed
            and private_root_fd >= 0
        ):
            cleanup_fd = -1
            try:
                cleanup_fd = os.open(
                    CHECKPOINTS_NAME,
                    os.O_RDONLY | getattr(os, "O_DIRECTORY", 0),
                    dir_fd=private_root_fd,
                )
                if not os.listdir(cleanup_fd):
                    os.close(cleanup_fd)
                    cleanup_fd = -1
                    os.rmdir(CHECKPOINTS_NAME, dir_fd=private_root_fd)
                    os.fsync(private_root_fd)
                else:
                    cleanup_ambiguous = True
            except OSError:
                cleanup_ambiguous = True
            finally:
                if cleanup_fd >= 0:
                    try:
                        os.close(cleanup_fd)
                    except OSError:
                        cleanup_ambiguous = True
        if publication_performed and not operation_succeeded:
            cleanup_ambiguous = True
        if publication_attempted and cleanup_ambiguous:
            operation_succeeded = False
        try:
            if lock_held and private_root_fd >= 0:
                if cleanup_ambiguous:
                    _mark_indeterminate(private_root_fd)
                    raise AuthoringEntrypointError("cleanup_indeterminate")
                if active_lock_token is None:
                    raise AuthoringEntrypointError("cleanup_indeterminate")
                if operation_succeeded and action != "finalize":
                    if tty_fd < 0:
                        _mark_indeterminate(private_root_fd)
                        raise AuthoringEntrypointError("tty_invalid")
                    private_resume = (
                        b"resume_generation="
                        + str(expected_final_generation).encode("ascii")
                        + b"\nresume_checkpoint_sha256="
                        + expected_final_head.encode("ascii")
                        + b"\nresume_release_token="
                        + active_lock_token.encode("ascii")
                        + b"\n"
                    )
                    try:
                        _write_tty(tty_fd, private_resume)
                        _require_resume_acknowledgement(tty_fd)
                    except BaseException:
                        # The durable lock still exists. Add a second blocking
                        # marker where possible, but never release after an
                        # incomplete private handoff.
                        _mark_indeterminate(private_root_fd)
                        raise
                    _release_lock(private_root_fd, active_lock_token)
                elif operation_succeeded:
                    _release_lock(private_root_fd, active_lock_token)
                else:
                    # Any failed operation keeps the durable writer lock. It is
                    # never converted into a normal resumable release state.
                    _mark_indeterminate(private_root_fd)
        finally:
            if private_root_fd >= 0:
                try:
                    os.close(private_root_fd)
                except OSError:
                    # Process exit closes the read-only descriptor; all persistent
                    # publication and lock durability has already been fsynced.
                    pass


def main() -> int:
    tty_fd = -1
    try:
        tty_fd = _validate_tty(os.environ)
        _write_tty(tty_fd, ENTER_ALTERNATE_SCREEN + CLEAR_SCREEN)
        _validate_execution_python(os.environ)
        status, diagnostic = execute_authoring(os.environ, tty_fd)
        if status not in {0, 2}:
            raise AuthoringEntrypointError("internal_failure")
    except AuthoringEntrypointError as exc:
        _emit_operator_diagnostic(
            "TOC_INTERNAL_DIAGNOSTIC_STDERR_FD",
            sys.stderr,
            _fixed_diagnostic(status="failed", reason=exc.reason),
        )
        return 1
    except BaseException:
        _emit_operator_diagnostic(
            "TOC_INTERNAL_DIAGNOSTIC_STDERR_FD",
            sys.stderr,
            _fixed_diagnostic(status="failed", reason="internal_failure"),
        )
        return 1
    finally:
        if tty_fd >= 0:
            _clear_tty_best_effort(tty_fd)
    _emit_operator_diagnostic(
        "TOC_INTERNAL_DIAGNOSTIC_STDOUT_FD", sys.stdout, diagnostic
    )
    return status


if __name__ == "__main__":
    raise SystemExit(main())
