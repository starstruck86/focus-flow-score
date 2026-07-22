#!/usr/bin/env python3
"""Reviewed private operator-session wrapper for TOC annotation initialization.

This internal component is launched only by
``run-lovable-toc-annotation-operator-session.sh``.  It collects the approved
authoring bindings from the verified local controlling TTY, publishes one
immutable private authorization record, creates the empty annotation root, and
runs exactly one generation-0 ``initialize`` operation.  It never classifies TOC
entries, invokes validation, generates restore planning, connects to a database,
or performs any network operation.

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

import hashlib
import json
import os
import re
import resource
import stat
import subprocess
import termios
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
    "GIT_NO_REPLACE_OBJECTS": "1",
    "GIT_OPTIONAL_LOCKS": "0",
    "GIT_TERMINAL_PROMPT": "0",
    "LANG": "C",
    "LC_ALL": "C",
    "PATH": "/usr/bin:/bin",
}
_MAX_GIT_BYTES = 1024 * 1024


class _StartupFailure(RuntimeError):
    pass


def _startup_read_bootstrap() -> dict[str, str]:
    try:
        raw = sys.stdin.buffer.read(8192)
    except BaseException as exc:
        raise _StartupFailure from exc
    pieces = raw.split(b"\0")
    if len(pieces) != 5 or pieces[-1] != b"":
        raise _StartupFailure
    try:
        python_path, python_sha256, python_version, approved_checkout = [
            item.decode("utf-8", errors="strict") for item in pieces[:-1]
        ]
    except UnicodeError as exc:
        raise _StartupFailure from exc
    if (
        not python_path
        or "\x00" in python_path
        or len(python_sha256) != 64
        or any(character not in "0123456789abcdef" for character in python_sha256)
        or not python_version.startswith("cpython:")
        or len(approved_checkout) != 40
        or any(character not in "0123456789abcdef" for character in approved_checkout)
    ):
        raise _StartupFailure
    return {
        "approved_checkout": approved_checkout,
        "python_path": python_path,
        "python_sha256": python_sha256,
        "python_version": python_version,
    }


_BOOTSTRAP: dict[str, str] | None = None
if __name__ == "__main__":
    try:
        _BOOTSTRAP = _startup_read_bootstrap()
    except BaseException:
        _startup_write(_STARTUP_FAILURE_DIAGNOSTIC)
        raise SystemExit(1)


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


def _preimport_guard() -> None:
    if _BOOTSTRAP is None:
        raise _StartupFailure
    approved = _BOOTSTRAP["approved_checkout"]
    if not _is_git_sha(approved):
        raise _StartupFailure
    script = os.path.realpath(__file__)
    repository = os.path.dirname(os.path.dirname(os.path.dirname(script)))
    if _reviewed_git(repository, ["rev-parse", "HEAD"]).strip() != approved.encode("ascii"):
        raise _StartupFailure
    if _reviewed_git(repository, ["status", "--porcelain=v1", "--untracked-files=all"]):
        raise _StartupFailure
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
            if _reviewed_git(repository, arguments):
                raise _StartupFailure
    migration_directory = os.path.dirname(script)
    for relative in (
        "lib.py",
        "lib/__init__.py",
        "argparse.py",
        "ctypes.py",
        "json.py",
        "termios.py",
    ):
        try:
            os.lstat(os.path.join(migration_directory, relative))
        except FileNotFoundError:
            continue
        except OSError as exc:
            raise _StartupFailure from exc
        raise _StartupFailure
    for relative in (
        "scripts/migration/run-lovable-toc-annotation-operator-session.sh",
        "scripts/migration/author-lovable-toc-operator-session.py",
        "scripts/migration/run-lovable-toc-annotation-authoring.sh",
        "scripts/migration/author-lovable-toc-annotations.py",
        "scripts/migration/lib/lovable_toc_authoring_contract.py",
        "scripts/migration/lib/lovable_toc_contract.py",
        "scripts/migration/verification/lovable-toc-operator-session-authorization.schema.json",
        "scripts/migration/verification/lovable-toc-operator-session-resume.schema.json",
    ):
        blob = _reviewed_git(repository, ["rev-parse", f"HEAD:{relative}"]).strip()
        working = _reviewed_git(repository, ["hash-object", "--", relative]).strip()
        if (
            len(blob) != 40
            or any(byte not in b"0123456789abcdef" for byte in blob)
            or blob != working
        ):
            raise _StartupFailure


if __name__ == "__main__":
    try:
        _preimport_guard()
    except BaseException:
        _startup_write(_STARTUP_BINDING_FAILURE_DIAGNOSTIC)
        raise SystemExit(1)


try:
    SCRIPT = Path(__file__).resolve(strict=True)
    REPO = SCRIPT.parents[2]
    if str(SCRIPT.parent) not in sys.path:
        sys.path.insert(0, str(SCRIPT.parent))
    from lib.lovable_toc_contract import (  # noqa: E402
        ContractError,
        _rename_no_replace,
        canonical_json_bytes,
        emit_fixed_diagnostic,
        sha256_bytes,
        stable_private_file_at,
        strict_json_loads,
    )
    import author_lovable_toc_annotations as _unused  # type: ignore  # noqa: E402,F401
except BaseException:
    try:
        import importlib.util

        author_path = SCRIPT.with_name("author-lovable-toc-annotations.py")
        spec = importlib.util.spec_from_file_location(
            "lovable_toc_authoring_component_for_operator_session", author_path
        )
        if spec is None or spec.loader is None:
            raise RuntimeError("component load failed")
        AUTHOR = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = AUTHOR
        spec.loader.exec_module(AUTHOR)
        from lib.lovable_toc_contract import (  # noqa: E402
            ContractError,
            _rename_no_replace,
            canonical_json_bytes,
            emit_fixed_diagnostic,
            sha256_bytes,
            stable_private_file_at,
            strict_json_loads,
        )
    except BaseException:
        _emit_failure("binding_mismatch")
        raise SystemExit(1)
else:
    # Unreachable for the hyphenated component filename; retained so type checkers
    # understand AUTHOR is set in the normal importlib fallback above.
    AUTHOR = sys.modules["author_lovable_toc_annotations"]


STAGE = "annotation_operator_session"
FORMAT_VERSION = 1
AUTHORIZATION_KIND = "lovable_toc_operator_authorization"
RESUME_KIND = "lovable_toc_operator_resume"
TTY_ATTESTATION = "LOCAL_CONTROLLING_TTY_NO_RECORDING_NO_REMOTE_NO_CLIPBOARD"
INITIAL_RELEASE_TOKEN = "0" * 64
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


class OperatorSessionError(RuntimeError):
    ALLOWED = frozenset(
        {
            "binding_mismatch",
            "cleanup_indeterminate",
            "history_conflict",
            "input_invalid",
            "input_mutated",
            "publication_failed",
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
    if type(value) is not str or not value or "\x00" in value:
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
    if type(value) is not str or not value or "\x00" in value:
        _fail("input_invalid")
    path = Path(value)
    if (
        not path.is_absolute()
        or value != os.path.abspath(value)
        or any(part in {"", ".", ".."} for part in path.parts)
    ):
        _fail("input_invalid")
    return path


def _assert_outside_repository(paths: tuple[Path, ...]) -> None:
    repository = REPO.resolve(strict=True)
    for path in paths:
        try:
            path.resolve(strict=path.exists()).relative_to(repository)
        except ValueError:
            continue
        _fail("input_invalid")
    normalized = [os.path.normcase(os.fspath(path)) for path in paths]
    if len(set(normalized)) != len(normalized):
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


def validate_resume_record_at(
    root_fd: int,
    name: str,
    *,
    authorization_sha256: str,
    expected_generation: int,
    expected_checkpoint_sha256: str,
    expected_operator_identity: str,
    expected_session_id: str,
) -> str:
    """Return the private release token for a future exact resume.

    This helper is intentionally not wired to an executable review action in
    this PR.  It documents and tests the safe consumption boundary for later
    authoring phases: descriptor-relative single-link mode-0400 record, strict
    duplicate-key-rejecting canonical JSON, exact authorization/head/operator
    binding, and no diagnostic disclosure of the token.
    """

    if type(expected_generation) is not int or expected_generation <= 0:
        _fail("input_invalid")
    _sha(authorization_sha256)
    _sha(expected_checkpoint_sha256)
    _safe_identity(expected_operator_identity)
    _safe_session(expected_session_id)
    record = _load_private_json_at(root_fd, name)
    expected_keys = {
        "annotation_root",
        "artifact_kind",
        "authorization_sha256",
        "authoring_session_identity",
        "capture",
        "execution_checkout_sha",
        "format_version",
        "operator_identity",
        "operator_session_procedure_identity_sha256",
        "primary_operator_identity",
        "procedure_identity_sha256",
        "python_identity_sha256",
        "resume_checkpoint_sha256",
        "resume_generation",
        "resume_release_token",
        "session_id",
    }
    if set(record) != expected_keys or record["artifact_kind"] != RESUME_KIND or record["format_version"] != FORMAT_VERSION:
        _fail("history_conflict")
    if (
        record["authorization_sha256"] != authorization_sha256
        or record["resume_generation"] != expected_generation
        or record["resume_checkpoint_sha256"] != expected_checkpoint_sha256
        or record["operator_identity"] != expected_operator_identity
        or record["session_id"] != expected_session_id
        or type(record["resume_release_token"]) is not str
        or HEX64_RE.fullmatch(record["resume_release_token"]) is None
    ):
        _fail("history_conflict")
    return record["resume_release_token"]


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
    try:
        os.write(tty_fd, prompt)
        old = termios.tcgetattr(tty_fd)
        if not echo:
            new = list(old)
            new[3] = new[3] & ~termios.ECHO
            termios.tcsetattr(tty_fd, termios.TCSADRAIN, new)
        data = bytearray()
        while len(data) <= MAX_OPERATOR_INPUT_BYTES:
            chunk = os.read(tty_fd, 1)
            if chunk in {b"", b"\n", b"\r"}:
                break
            data.extend(chunk)
        else:
            _fail("input_invalid")
    except OperatorSessionError:
        raise
    except OSError as exc:
        raise OperatorSessionError("tty_invalid") from exc
    finally:
        try:
            if "old" in locals():
                termios.tcsetattr(tty_fd, termios.TCSADRAIN, old)
            if not echo:
                os.write(tty_fd, b"\n")
        except OSError:
            pass
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
    try:
        os.write(tty_fd, payload)
    except OSError as exc:
        raise OperatorSessionError("tty_invalid") from exc


def _prompt_choice(tty_fd: int, prompt: bytes, allowed: frozenset[str]) -> str:
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


def _prompt_authorization(tty_fd: int, bootstrap: Mapping[str, str]) -> dict[str, Any]:
    _tty_write(
        tty_fd,
        b"toc_authoring_operator_session_initialize_only\n"
        b"type_values_manually_no_clipboard_no_history_no_recording\n",
    )
    session_id = _safe_session(_read_line(tty_fd, b"operator_session_id: "))
    primary = _safe_identity(_read_line(tty_fd, b"primary_operator_identity: "))
    operator = _safe_identity(_read_line(tty_fd, b"current_operator_identity: "))
    authoring_session = _safe_session(_read_line(tty_fd, b"authoring_session_identity: "))
    if primary != operator:
        _fail("binding_mismatch")
    session_root = os.fspath(_validate_absolute_path(_read_line(tty_fd, b"operator_session_root: "), must_exist=False))
    annotation_root = os.fspath(_validate_absolute_path(_read_line(tty_fd, b"annotation_root: "), must_exist=False))
    capture_root = os.fspath(_validate_absolute_path_lexical(_read_line(tty_fd, b"capture_root: ")))
    capture_name = _safe_capture_name(_read_line(tty_fd, b"capture_name: "))
    approved_checkout = _git_sha(bootstrap["approved_checkout"])
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
        "execution": {
            "approved_checkout_sha": approved_checkout,
            "approved_operator_session_procedure_identity_sha256": _sha(
                _read_line(tty_fd, b"operator_session_procedure_identity_sha256: ")
            ),
            "approved_procedure_identity_sha256": _sha(_read_line(tty_fd, b"authoring_procedure_identity_sha256: ")),
            "python": {
                "path": bootstrap["python_path"],
                "sha256": bootstrap["python_sha256"],
                "version": bootstrap["python_version"],
            },
        },
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
        "tty_attestation": _prompt_choice(
            tty_fd,
            b"type_LOCAL_CONTROLLING_TTY_NO_RECORDING_NO_REMOTE_NO_CLIPBOARD: ",
            frozenset({TTY_ATTESTATION}),
        ),
    }
    return authorization


def _environment_from_authorization(authorization: Mapping[str, Any]) -> dict[str, str]:
    capture = authorization["capture"]
    execution = authorization["execution"]
    python = execution["python"]
    initial = authorization["initial_head"]
    return {
        "TOC_AUTHOR_ACTION": "initialize",
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
        "TOC_AUTHOR_EXPECTED_HEAD_GENERATION": str(initial["generation"]),
        "TOC_AUTHOR_EXPECTED_HEAD_SHA256": initial["checkpoint_sha256"],
        "TOC_AUTHOR_EXPECTED_RELEASE_TOKEN": initial["release_token"],
        "TOC_AUTHOR_LOCAL_TTY_ATTESTATION": authorization["tty_attestation"],
        "TOC_AUTHOR_FINALIZATION_AUTHORIZATION": "",
    }


def _procedure_identity(approved_checkout: str) -> str:
    return AUTHOR._authoring_procedure_identity(approved_checkout)


def _operator_session_procedure_identity(approved_checkout: str) -> str:
    records: dict[str, str] = {"execution_checkout_sha": approved_checkout}
    for relative in (
        "scripts/migration/run-lovable-toc-annotation-operator-session.sh",
        "scripts/migration/author-lovable-toc-operator-session.py",
        "scripts/migration/run-lovable-toc-annotation-authoring.sh",
        "scripts/migration/author-lovable-toc-annotations.py",
        "scripts/migration/lib/lovable_toc_authoring_contract.py",
        "scripts/migration/lib/lovable_toc_contract.py",
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
            "format_version": FORMAT_VERSION,
            "operator_session_procedure_identity_sha256": observed_session_procedure,
            "operator_identity": authorization["operator_identity"],
            "primary_operator_identity": authorization["primary_operator_identity"],
            "procedure_identity_sha256": observed_procedure,
            "python_identity_sha256": python_identity["identity_sha256"],
            "resume_checkpoint_sha256": checkpoint_sha256,
            "resume_generation": generation,
            "resume_release_token": release_token,
            "session_id": authorization["session_id"],
        }
        final_name = f"resume-g{generation:016d}-{checkpoint_sha256}.json"
        _publish_private_json_at(session_root_fd, final_name, resume)

    return AUTHOR.execute_authoring(environment, tty_fd, resume_recorder=recorder)


def run_session(tty_fd: int, bootstrap: Mapping[str, str]) -> tuple[int, bytes]:
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    authorization = _prompt_authorization(tty_fd, bootstrap)
    session_root_path = _validate_absolute_path(authorization["session_root"], must_exist=False)
    annotation_root_path = _validate_absolute_path(authorization["annotation_root"], must_exist=False)
    capture_root_path = _validate_absolute_path_lexical(authorization["capture"]["capture_root"])
    _assert_outside_repository((session_root_path, annotation_root_path))
    if session_root_path == annotation_root_path:
        _fail("input_invalid")
    session_root_fd, _session_metadata = _create_private_directory_no_replace(session_root_path)
    annotation_root_fd = -1
    try:
        authorization_name_prefix = f"authorization-{authorization['session_id']}-"
        authorization_without_digest = dict(authorization)
        authorization_digest = sha256_bytes(canonical_json_bytes(authorization_without_digest))
        final_name = authorization_name_prefix + authorization_digest[:16] + ".json"
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
        _assert_outside_repository((session_root_path, annotation_root_path, capture_root_path))
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


def _validate_tty_fd() -> int:
    raw = os.environ.get("TOC_OPERATOR_TTY_FD")
    if type(raw) is not str or not raw.isdigit():
        _fail("tty_invalid")
    descriptor = int(raw)
    if descriptor < 3:
        _fail("tty_invalid")
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISCHR(before.st_mode) or not os.isatty(descriptor):
            _fail("tty_invalid")
        controlling_fd = os.open(
            "/dev/tty", os.O_RDONLY | getattr(os, "O_NOCTTY", 0)
        )
        try:
            controlling = os.fstat(controlling_fd)
            if (
                not stat.S_ISCHR(controlling.st_mode)
                or not os.isatty(controlling_fd)
                or (controlling.st_dev, controlling.st_rdev)
                != (before.st_dev, before.st_rdev)
            ):
                _fail("tty_invalid")
        finally:
            os.close(controlling_fd)
        if os.tcgetpgrp(descriptor) != os.getpgrp():
            _fail("tty_invalid")
        termios.tcgetattr(descriptor)
        after = os.fstat(descriptor)
    except OperatorSessionError:
        raise
    except (OSError, termios.error) as exc:
        raise OperatorSessionError("tty_invalid") from exc
    if (
        before.st_dev,
        before.st_ino,
        before.st_rdev,
        before.st_mode,
    ) != (
        after.st_dev,
        after.st_ino,
        after.st_rdev,
        after.st_mode,
    ):
        _fail("tty_invalid")
    return descriptor


def main() -> int:
    try:
        tty_fd = _validate_tty_fd()
        if _BOOTSTRAP is None:
            raise OperatorSessionError("internal_failure")
        bootstrap = dict(_BOOTSTRAP)
        status, diagnostic = run_session(tty_fd, bootstrap)
        emit_fixed_diagnostic(sys.stdout.buffer, diagnostic)
        return status
    except OperatorSessionError as exc:
        _emit_failure(exc.reason)
        return 1
    except BaseException:
        _emit_failure("internal_failure")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
