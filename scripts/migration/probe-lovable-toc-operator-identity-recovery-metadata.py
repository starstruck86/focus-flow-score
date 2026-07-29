#!/usr/bin/env python3
"""Isolated entrypoint for the read-only recovery-metadata probe.

This internal component is supported only through the checked-in zero-argument
shell launcher.  Before importing repository-local code it binds the exact
checkout and complete probe closure to one separately installed owner-private
metadata-probe approval.  The ordinary approval is then independently bound by
the existing ordinary pre-import guard and shared public verifier.
"""

from __future__ import annotations

import sys


_STARTUP_FAILURE = (
    b'{"diagnostic_version":1,"reason":"startup_environment_invalid",'
    b'"stage":"toc_operator_identity_recovery_metadata_probe","status":"failed"}\n'
)
_BINDING_FAILURE = (
    b'{"diagnostic_version":1,"reason":"binding_mismatch",'
    b'"stage":"toc_operator_identity_recovery_metadata_probe","status":"failed"}\n'
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
    _startup_write(_STARTUP_FAILURE)
    raise SystemExit(1)

import os


_DARWIN_RUNTIME_NAME = "__CF_USER_TEXT_ENCODING"


def _normalize_darwin_environment() -> None:
    if sys.platform != "darwin":
        return
    try:
        if _DARWIN_RUNTIME_NAME in os.environ:
            del os.environ[_DARWIN_RUNTIME_NAME]
        if _DARWIN_RUNTIME_NAME in os.environ:
            raise RuntimeError
    except BaseException:
        _startup_write(_STARTUP_FAILURE)
        raise SystemExit(1) from None


_normalize_darwin_environment()

if len(sys.argv) != 1:
    _startup_write(_STARTUP_FAILURE)
    raise SystemExit(1)

import hashlib
import importlib.util
import json
from pathlib import Path
import pwd
import re
import stat
import subprocess
from dataclasses import dataclass
from typing import Any


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
_MAX_APPROVAL_BYTES = 512 * 1024
_APPROVAL_RELATIVE_PARENT = (
    "Library/Application Support/focus-flow-score/migration-approvals/"
    "toc-operator-identity-recovery-metadata"
)
_APPROVAL_NAME_RE = re.compile(
    r"^lovable-toc-operator-identity-recovery-metadata-approval-"
    r"([0-9a-f]{40})-[0-9a-f]{16}[.]json$",
    re.ASCII,
)
_BOOTSTRAP_REVIEWED_FILES = frozenset(
    {
        "scripts/migration/author-lovable-toc-annotations.py",
        "scripts/migration/author-lovable-toc-operator-session.py",
        "scripts/migration/lib/lovable_toc_authoring_contract.py",
        "scripts/migration/lib/lovable_toc_contract.py",
        "scripts/migration/lib/lovable_toc_operator_identity_recovery.py",
        "scripts/migration/lib/lovable_toc_operator_identity_recovery_metadata.py",
        "scripts/migration/lib/lovable_toc_operator_preflight.py",
        "scripts/migration/probe-lovable-toc-operator-identity-recovery-metadata.py",
        "scripts/migration/run-lovable-toc-annotation-operator-session.sh",
        "scripts/migration/run-lovable-toc-operator-identity-recovery-metadata-probe.sh",
        "scripts/migration/verification/lovable-toc-annotation-checkpoint.schema.json",
        "scripts/migration/verification/lovable-toc-operator-execution-profile-approval.schema.json",
        "scripts/migration/verification/lovable-toc-operator-execution-profile.schema.json",
        "scripts/migration/verification/lovable-toc-operator-execution-profile.v1.json",
        "scripts/migration/verification/lovable-toc-operator-identity-recovery-metadata-approval.schema.json",
        "scripts/migration/verification/lovable-toc-operator-identity-recovery-metadata-profile.schema.json",
        "scripts/migration/verification/lovable-toc-operator-identity-recovery-metadata-profile.v1.json",
        "scripts/migration/verification/lovable-toc-operator-identity-recovery-metadata-result.schema.json",
        "scripts/migration/verification/lovable-toc-operator-session-authorization.schema.json",
        "scripts/migration/verification/lovable-toc-operator-session-resume.schema.json",
    }
)


class _StartupFailure(RuntimeError):
    pass


@dataclass(frozen=True)
class _MetadataBootstrapBinding:
    approval_name: str
    approval_sha256: str
    file_identity: tuple[int, ...]
    parent_identity: tuple[int, ...]


def _file_identity(metadata: os.stat_result) -> tuple[int, ...]:
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


def _parent_identity(metadata: os.stat_result) -> tuple[int, ...]:
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


def _is_git_sha(value: Any) -> bool:
    return (
        type(value) is str
        and len(value) == 40
        and all(character in "0123456789abcdef" for character in value)
    )


def _duplicate_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise _StartupFailure
        result[key] = value
    return result


def _reject_nonfinite(_value: str) -> None:
    raise _StartupFailure


def _canonical_json(value: Any) -> bytes:
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


def _stable_approval(
    parent_fd: int, parent_metadata: os.stat_result, name: str
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
        while total <= _MAX_APPROVAL_BYTES:
            chunk = os.read(
                descriptor, min(65536, _MAX_APPROVAL_BYTES + 1 - total)
            )
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
        after = os.fstat(descriptor)
        if _file_identity(before) != _file_identity(after):
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


def _preimport_metadata_guard(
    *,
    repository: Path | None = None,
    account_home: Path | None = None,
) -> _MetadataBootstrapBinding:
    """Bind the metadata-probe closure before repository-local imports."""

    parent_fd = -1
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
        if (
            stat.S_ISLNK(parent_lstat.st_mode)
            or not stat.S_ISDIR(parent_lstat.st_mode)
            or parent_lstat.st_uid != os.geteuid()
            or stat.S_IMODE(parent_lstat.st_mode) != 0o700
            or approval_parent.resolve(strict=True) != approval_parent
        ):
            raise _StartupFailure
        parent_fd = os.open(
            approval_parent,
            os.O_RDONLY
            | getattr(os, "O_DIRECTORY", 0)
            | getattr(os, "O_CLOEXEC", 0)
            | getattr(os, "O_NOFOLLOW", 0),
        )
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
        checkout = (
            _reviewed_git(os.fspath(selected_repository), ["rev-parse", "HEAD"])
            .strip()
            .decode("ascii", errors="strict")
        )
        if not _is_git_sha(checkout):
            raise _StartupFailure
        matches: list[str] = []
        for name in os.listdir(parent_fd):
            if type(name) is not str:
                raise _StartupFailure
            matched = _APPROVAL_NAME_RE.fullmatch(name)
            if matched is not None and matched.group(1) == checkout:
                matches.append(name)
        if len(matches) != 1:
            raise _StartupFailure
        data, approval_metadata = _stable_approval(
            parent_fd, opened_parent, matches[0]
        )
        if _parent_identity(opened_parent) != _parent_identity(
            os.fstat(parent_fd)
        ):
            raise _StartupFailure
        approval = json.loads(
            data.decode("ascii", errors="strict"),
            object_pairs_hook=_duplicate_pairs,
            parse_constant=_reject_nonfinite,
        )
        if (
            type(approval) is not dict
            or _canonical_json(approval) != data
            or approval.get("artifact_kind")
            != "lovable_toc_operator_identity_recovery_metadata_approval"
            or approval.get("format_version") != 1
            or approval.get("approved_checkout_sha") != checkout
            or approval.get("repository")
            != {"name": "focus-flow-score", "owner": "starstruck86"}
            or type(approval.get("reviewed_file_blobs")) is not dict
            or set(approval["reviewed_file_blobs"])
            != _BOOTSTRAP_REVIEWED_FILES
        ):
            raise _StartupFailure
        for blob in approval["reviewed_file_blobs"].values():
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
                if _reviewed_git(os.fspath(selected_repository), arguments):
                    raise _StartupFailure
        for relative, approved_blob in approval["reviewed_file_blobs"].items():
            committed = _reviewed_git(
                os.fspath(selected_repository),
                ["rev-parse", f"{checkout}:{relative}"],
            ).strip()
            working = _reviewed_git(
                os.fspath(selected_repository),
                ["hash-object", "--", relative],
            ).strip()
            if committed != approved_blob.encode("ascii") or working != committed:
                raise _StartupFailure
        migration_directory = selected_repository / "scripts/migration"
        for relative in (
            "argparse.py",
            "author_lovable_toc_annotations.py",
            "base64.py",
            "collections.py",
            "ctypes.py",
            "dataclasses.py",
            "datetime.py",
            "errno.py",
            "hashlib.py",
            "hmac.py",
            "importlib.py",
            "json.py",
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
            "lib.py",
            "lib/__init__.py",
        ):
            try:
                os.lstat(migration_directory / relative)
            except FileNotFoundError:
                continue
            raise _StartupFailure
        return _MetadataBootstrapBinding(
            approval_name=matches[0],
            approval_sha256=hashlib.sha256(data).hexdigest(),
            file_identity=_file_identity(approval_metadata),
            parent_identity=_parent_identity(opened_parent),
        )
    except (
        KeyError,
        OSError,
        RuntimeError,
        TypeError,
        UnicodeError,
        ValueError,
        json.JSONDecodeError,
    ) as exc:
        raise _StartupFailure from exc
    finally:
        if parent_fd >= 0:
            try:
                os.close(parent_fd)
            except OSError:
                pass


_METADATA_BOOTSTRAP_BINDING: _MetadataBootstrapBinding | None = None


if __name__ == "__main__":
    try:
        _METADATA_BOOTSTRAP_BINDING = _preimport_metadata_guard()
    except BaseException:
        _startup_write(_BINDING_FAILURE)
        raise SystemExit(1)


try:
    SCRIPT = Path(__file__).resolve(strict=True)
    REPO = SCRIPT.parents[2]
    if str(SCRIPT.parent) not in sys.path:
        sys.path.insert(0, str(SCRIPT.parent))
    from lib import (  # noqa: E402
        lovable_toc_operator_identity_recovery_metadata as METADATA,
    )
    from lib import lovable_toc_operator_preflight as PREFLIGHT  # noqa: E402

    ordinary_path = SCRIPT.with_name("author-lovable-toc-operator-session.py")
    ordinary_spec = importlib.util.spec_from_file_location(
        "lovable_toc_operator_session_for_identity_recovery_metadata",
        ordinary_path,
    )
    if ordinary_spec is None or ordinary_spec.loader is None:
        raise RuntimeError
    ORDINARY = importlib.util.module_from_spec(ordinary_spec)
    sys.modules[ordinary_spec.name] = ORDINARY
    ordinary_spec.loader.exec_module(ORDINARY)
except BaseException:
    _startup_write(_BINDING_FAILURE)
    raise SystemExit(1)


def main() -> int:
    try:
        if _METADATA_BOOTSTRAP_BINDING is None:
            raise METADATA.MetadataProbeError("binding_mismatch")
        ordinary_bootstrap = ORDINARY._preimport_external_guard()
        return METADATA.execute(
            launcher=REPO
            / "scripts/migration/"
            "run-lovable-toc-operator-identity-recovery-metadata-probe.sh",
            ordinary_launcher=REPO
            / "scripts/migration/"
            "run-lovable-toc-annotation-operator-session.sh",
            ordinary_module=ORDINARY,
            tty_fd=METADATA.held_tty_fd(),
            metadata_bootstrap=PREFLIGHT.ApprovalBootstrapBinding(
                approval_name=_METADATA_BOOTSTRAP_BINDING.approval_name,
                approval_sha256=_METADATA_BOOTSTRAP_BINDING.approval_sha256,
                file_identity=_METADATA_BOOTSTRAP_BINDING.file_identity,
                parent_identity=_METADATA_BOOTSTRAP_BINDING.parent_identity,
            ),
            ordinary_bootstrap=PREFLIGHT.ApprovalBootstrapBinding(
                approval_name=ordinary_bootstrap.approval_name,
                approval_sha256=ordinary_bootstrap.approval_sha256,
                file_identity=ordinary_bootstrap.file_identity,
                parent_identity=ordinary_bootstrap.parent_identity,
            ),
        )
    except PREFLIGHT.PreflightError as exc:
        METADATA.emit_failure(exc.reason)
        return 1
    except METADATA.MetadataProbeError as exc:
        METADATA.emit_failure(exc.reason)
        return 1
    except BaseException:
        METADATA.emit_failure("internal_failure")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
