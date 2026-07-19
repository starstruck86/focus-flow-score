#!/usr/bin/env python3
"""Validate and privately publish one opaque Lovable TOC annotation ledger."""

from __future__ import annotations

import sys


_STARTUP_FAILURE_DIAGNOSTIC = (
    b'{"diagnostic_version":1,"reason":"input_invalid",'
    b'"stage":"ledger","status":"failed"}\n'
)
_STARTUP_BINDING_FAILURE_DIAGNOSTIC = (
    b'{"diagnostic_version":1,"reason":"binding_mismatch",'
    b'"stage":"ledger","status":"failed"}\n'
)
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


# Reject direct/unisolated invocation before importing anything beyond builtin
# sys.  The reviewed launcher is the decisive pre-start boundary: an unsupported
# direct invocation may already have processed site startup before script code.
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


class _ReviewedGitFailure(RuntimeError):
    """A private failure whose data is never included in a diagnostic."""


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
            raise _ReviewedGitFailure
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
        raise _ReviewedGitFailure from exc
    if result.returncode != 0 or len(result.stdout) > _MAX_REVIEWED_GIT_OUTPUT_BYTES:
        raise _ReviewedGitFailure
    return result.stdout


def _is_full_lowercase_git_sha(value: str | None) -> bool:
    return (
        type(value) is str
        and len(value) == 40
        and all(character in "0123456789abcdef" for character in value)
    )


def _preimport_repository_guard() -> None:
    approved = os.environ.get("TOC_REVIEW_APPROVED_EXECUTION_CHECKOUT_SHA")
    if not _is_full_lowercase_git_sha(approved):
        raise _ReviewedGitFailure
    script = os.path.realpath(__file__)
    repository = os.path.dirname(os.path.dirname(os.path.dirname(script)))
    if _reviewed_git_bytes(
        repository, ["rev-parse", "HEAD"], timeout_seconds=20
    ).strip() != approved.encode("ascii"):
        raise _ReviewedGitFailure
    if _reviewed_git_bytes(
        repository,
        ["status", "--porcelain=v1", "--untracked-files=all"],
        timeout_seconds=20,
    ):
        raise _ReviewedGitFailure
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
                raise _ReviewedGitFailure
    for relative in (
        "scripts/migration/run-lovable-toc-ledger-validation.sh",
        "scripts/migration/validate-lovable-toc-ledger.py",
        "scripts/migration/lib/lovable_toc_contract.py",
        "scripts/migration/lib/lovable_dump_report.py",
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
            raise _ReviewedGitFailure


if __name__ == "__main__":
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
import stat
import struct
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, Optional, Sequence, Tuple

try:
    SCRIPT = Path(__file__).resolve(strict=True)
    if str(SCRIPT.parent) not in sys.path:
        sys.path.insert(0, str(SCRIPT.parent))
    from lib.lovable_toc_contract import (
        CAPTURE_FILES,
        ContractError,
        MAX_LEDGER_BYTES,
        MAX_RAW_TOC_BYTES,
        SAFE_NAME_RE,
        canonical_json_bytes,
        emit_fixed_diagnostic,
        fixed_diagnostic,
        parse_raw_toc,
        publish_private_package,
        require_exact_keys,
        require_int,
        sha256_bytes,
        stable_regular_digest,
        stable_private_file_at,
        strict_json_loads,
        validate_capture_schema,
        validate_git_sha,
        validate_ledger,
        validate_private_root,
        validate_sha,
    )
except BaseException:
    if __name__ == "__main__":
        _fail_startup_binding()
    raise


REQUIRED_ENVIRONMENT = (
    "TOC_REVIEW_CAPTURE_ROOT",
    "TOC_REVIEW_CAPTURE_NAME",
    "TOC_REVIEW_LEDGER",
    "TOC_REVIEW_OUTPUT_ROOT",
    "TOC_REVIEW_EXPECTED_CAPTURE_MANIFEST_SHA256",
    "TOC_REVIEW_EXPECTED_RAW_TOC_SHA256",
    "TOC_REVIEW_EXPECTED_PROCEDURE_IDENTITY_SHA256",
    "TOC_REVIEW_EVIDENCE_RUN_ID",
    "TOC_REVIEW_OUTER_SHA256",
    "TOC_REVIEW_INNER_SHA256",
    "TOC_REVIEW_EVIDENCE_MANIFEST_SHA256",
    "TOC_REVIEW_INSPECTION_CHECKOUT_SHA",
    "TOC_REVIEW_INSPECTION_PROCEDURE_SHA256",
    "TOC_REVIEW_APPROVED_EXECUTION_CHECKOUT_SHA",
    "TOC_REVIEW_APPROVED_PG_RESTORE_SHA256",
)
SAFE_VALUE_RE = re.compile(r"^[A-Za-z0-9._:-]{1,160}$", re.ASCII)
OPERATOR_ENTRYPOINT = __name__ == "__main__"


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


def _execution_python_procedure_identity() -> dict[str, str]:
    try:
        executable = Path(sys.executable).resolve(strict=True)
        observed = stable_regular_digest(
            executable, max_bytes=100 * 1024 * 1024, require_executable=True
        )
    except (OSError, RuntimeError, ContractError) as exc:
        raise ContractError("binding_mismatch") from exc
    version = (
        f"{sys.implementation.name}:{sys.version_info.major}."
        f"{sys.version_info.minor}.{sys.version_info.micro}"
    )
    approved_sha = os.environ.get("TOC_INTERNAL_APPROVED_EXECUTION_PYTHON_SHA256")
    approved_version = os.environ.get(
        "TOC_INTERNAL_APPROVED_EXECUTION_PYTHON_VERSION"
    )
    if OPERATOR_ENTRYPOINT:
        if approved_sha != observed.sha256 or approved_version != version:
            raise ContractError("binding_mismatch")
        basis = "reviewed_launcher"
    else:
        approved_sha = observed.sha256
        approved_version = version
        basis = "internal_library_call"
    return {
        "execution_python_approval_basis": basis,
        "execution_python_approved_sha256": approved_sha,
        "execution_python_device": str(observed.device),
        "execution_python_inode": str(observed.inode),
        "execution_python_mode": format(observed.mode, "04o"),
        "execution_python_reported_version": approved_version,
        "execution_python_sha256": observed.sha256,
        "execution_python_uid": str(observed.owner_uid),
    }


def _required(environment: Mapping[str, str], name: str) -> str:
    value = environment.get(name)
    if (
        value is None
        or not value
        or value != value.strip()
        or any(ord(character) < 0x20 or ord(character) == 0x7F for character in value)
    ):
        raise ContractError("input_invalid")
    return value


def _open_package(
    root: Path, name: str, *, allowed_root_siblings: frozenset[str]
) -> tuple[int, Path]:
    if SAFE_NAME_RE.fullmatch(name) is None:
        raise ContractError("input_invalid")
    if any(
        SAFE_NAME_RE.fullmatch(sibling) is None or sibling == name
        for sibling in allowed_root_siblings
    ):
        raise ContractError("input_invalid")
    root_fd = validate_private_root(root)
    package_fd: int | None = None
    try:
        expected_root_names = {name, *allowed_root_siblings}
        if _package_names(root_fd) != expected_root_names:
            raise ContractError("input_invalid")
        flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
        flags |= getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
        package_fd = os.open(name, flags, dir_fd=root_fd)
        if _package_names(root_fd) != expected_root_names:
            raise ContractError("input_mutated")
    except OSError as exc:
        if package_fd is not None:
            os.close(package_fd)
        os.close(root_fd)
        raise ContractError("input_invalid") from exc
    except BaseException:
        if package_fd is not None:
            os.close(package_fd)
        os.close(root_fd)
        raise
    os.close(root_fd)
    if package_fd is None:
        raise ContractError("internal_failure")
    metadata = os.fstat(package_fd)
    if (
        not stat.S_ISDIR(metadata.st_mode)
        or metadata.st_uid != os.geteuid()
        or stat.S_IMODE(metadata.st_mode) != 0o700
    ):
        os.close(package_fd)
        raise ContractError("input_invalid")
    return package_fd, root / name


def _package_names(package_fd: int) -> set[str]:
    try:
        names = set(os.listdir(package_fd))
    except (OSError, TypeError) as exc:
        raise ContractError("input_invalid") from exc
    if any(
        not name
        or name in {".", ".."}
        or "/" in name
        or "\\" in name
        or any(ord(character) < 0x20 or ord(character) == 0x7F for character in name)
        for name in names
    ):
        raise ContractError("input_invalid")
    return names


def _read_at(package_fd: int, name: str, max_bytes: int) -> bytes:
    return stable_private_file_at(
        package_fd, name, max_bytes=max_bytes, exact_mode=0o400
    ).data


def _validate_evidence_manifest(
    raw: bytes,
    files: Mapping[str, bytes],
    *,
    expected_sha: str,
) -> None:
    if sha256_bytes(raw) != expected_sha:
        raise ContractError("binding_mismatch")
    value = require_exact_keys(
        strict_json_loads(raw), {"artifact_kind", "files", "format_version"}
    )
    if value["artifact_kind"] != "lovable_toc_capture_evidence":
        raise ContractError("binding_mismatch")
    require_int(value["format_version"], minimum=1, maximum=1)
    if not isinstance(value["files"], list):
        raise ContractError("binding_mismatch")
    for item in value["files"]:
        item = require_exact_keys(item, {"name", "sha256", "size_bytes"})
        if type(item["name"]) is not str or item["name"] not in files:
            raise ContractError("binding_mismatch")
        validate_sha(item["sha256"])
        require_int(item["size_bytes"], minimum=1, maximum=MAX_RAW_TOC_BYTES)
    expected = [
        {"name": name, "sha256": sha256_bytes(files[name]), "size_bytes": len(files[name])}
        for name in sorted(files)
    ]
    if value["files"] != expected or raw != canonical_json_bytes(value):
        raise ContractError("binding_mismatch")


def _validate_complete_marker(raw: bytes, expected_manifest_sha: str) -> None:
    marker = require_exact_keys(
        strict_json_loads(raw),
        {"artifact_kind", "evidence_files_sha256", "format_version"},
    )
    require_int(marker["format_version"], minimum=1, maximum=1)
    if marker != {
        "artifact_kind": "lovable_toc_capture_complete",
        "evidence_files_sha256": expected_manifest_sha,
        "format_version": 1,
    }:
        raise ContractError("binding_mismatch")
    if raw != canonical_json_bytes(marker):
        raise ContractError("binding_mismatch")


def _validate_opaque_index(raw: bytes, entries: list[Any]) -> None:
    index = require_exact_keys(
        strict_json_loads(raw), {"artifact_kind", "entries", "format_version"}
    )
    expected = {
        "artifact_kind": "lovable_toc_opaque_index",
        "entries": [
            {
                "entry_id": entry.entry_id,
                "is_data_reference": entry.is_data_reference,
                "object_class": entry.object_class,
                "ordinal": entry.ordinal,
            }
            for entry in sorted(entries, key=lambda item: item.entry_id)
        ],
        "format_version": 1,
    }
    if index != expected or raw != canonical_json_bytes(expected):
        raise ContractError("binding_mismatch")


def _capture_binding_expected(environment: Mapping[str, str]) -> dict[str, str]:
    run_id = _required(environment, "TOC_REVIEW_EVIDENCE_RUN_ID")
    if SAFE_VALUE_RE.fullmatch(run_id) is None:
        raise ContractError("input_invalid")
    execution_checkout = validate_git_sha(
        _required(environment, "TOC_REVIEW_APPROVED_EXECUTION_CHECKOUT_SHA")
    )
    inspection_checkout = validate_git_sha(
        _required(environment, "TOC_REVIEW_INSPECTION_CHECKOUT_SHA")
    )
    outer_sha = validate_sha(_required(environment, "TOC_REVIEW_OUTER_SHA256"))
    inner_sha = validate_sha(_required(environment, "TOC_REVIEW_INNER_SHA256"))
    evidence_sha = validate_sha(
        _required(environment, "TOC_REVIEW_EVIDENCE_MANIFEST_SHA256")
    )
    inspection_procedure = validate_sha(
        _required(environment, "TOC_REVIEW_INSPECTION_PROCEDURE_SHA256")
    )
    # The procedure identity is itself a canonical hash assembled by the
    # capture tool.  Its complete internal repository identity remains in the
    # private capture; the validator cross-binds the exact digest here.
    return {
        "evidence_manifest_sha256": evidence_sha,
        "evidence_run_id": run_id,
        "execution_checkout_sha": execution_checkout,
        "inner_archive_sha256": inner_sha,
        "inspection_checkout_sha": inspection_checkout,
        "outer_archive_sha256": outer_sha,
        "inspection_procedure_sha256": inspection_procedure,
    }


def _verify_checkout(approved: str) -> dict[str, str]:
    repo = Path(__file__).resolve(strict=True).parents[2]
    for arguments, expected in (
        (["rev-parse", "HEAD"], approved),
        (["status", "--porcelain=v1", "--untracked-files=all"], ""),
    ):
        try:
            observed = _reviewed_git_bytes(
                os.fspath(repo), arguments, timeout_seconds=15
            ).decode("ascii", errors="strict").strip()
        except (UnicodeDecodeError, _ReviewedGitFailure) as exc:
            raise ContractError("binding_mismatch") from exc
        if observed != expected:
            raise ContractError("binding_mismatch")
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
            try:
                if _reviewed_git_bytes(
                    os.fspath(repo), arguments, timeout_seconds=15
                ):
                    raise ContractError("binding_mismatch")
            except _ReviewedGitFailure as exc:
                raise ContractError("binding_mismatch") from exc
    identity = {
        "execution_checkout_sha": approved,
        **_execution_python_procedure_identity(),
    }
    for relative in (
        "scripts/migration/README.md",
        "scripts/migration/run-lovable-toc-ledger-validation.sh",
        "scripts/migration/validate-lovable-toc-ledger.py",
        "scripts/migration/lib/lovable_toc_contract.py",
        "scripts/migration/verification/lovable-toc-annotation-ledger.schema.json",
    ):
        path = repo / relative
        if not path.is_file() or path.is_symlink():
            raise ContractError("binding_mismatch")
        try:
            blob_sha = _reviewed_git_bytes(
                os.fspath(repo), ["rev-parse", f"HEAD:{relative}"], timeout_seconds=15
            ).decode("ascii", errors="strict").strip()
            worktree_sha = _reviewed_git_bytes(
                os.fspath(repo), ["hash-object", "--", relative], timeout_seconds=15
            ).decode("ascii", errors="strict").strip()
        except (UnicodeDecodeError, _ReviewedGitFailure) as exc:
            raise ContractError("binding_mismatch") from exc
        if (
            re.fullmatch(r"[0-9a-f]{40}", blob_sha) is None
            or worktree_sha != blob_sha
        ):
            raise ContractError("binding_mismatch")
        key = relative.rsplit("/", 1)[-1].replace("-", "_").replace(".", "_")
        identity[f"{key}_blob_sha"] = blob_sha
        identity[f"{key}_sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
    return identity


def execute(environment: Mapping[str, str]) -> tuple[dict[str, int], dict[str, str]]:
    if set(name for name in REQUIRED_ENVIRONMENT if not environment.get(name)):
        raise ContractError("input_invalid")
    ledger_procedure_identity = _verify_checkout(
        validate_git_sha(
            _required(environment, "TOC_REVIEW_APPROVED_EXECUTION_CHECKOUT_SHA")
        )
    )
    capture_root = Path(_required(environment, "TOC_REVIEW_CAPTURE_ROOT"))
    repo = Path(__file__).resolve(strict=True).parents[2]
    resolved_capture_root = capture_root.resolve(strict=True)
    if repo.resolve(strict=True) in resolved_capture_root.parents or resolved_capture_root == repo.resolve(strict=True):
        raise ContractError("input_invalid")
    capture_name = _required(environment, "TOC_REVIEW_CAPTURE_NAME")
    ledger_candidate = Path(_required(environment, "TOC_REVIEW_LEDGER"))
    lexical_ledger_candidate = Path(os.path.abspath(os.fspath(ledger_candidate)))
    allowed_root_siblings: frozenset[str] = frozenset()
    if (
        ledger_candidate.is_absolute()
        and lexical_ledger_candidate.parent == resolved_capture_root
        and SAFE_NAME_RE.fullmatch(lexical_ledger_candidate.name) is not None
    ):
        allowed_root_siblings = frozenset({lexical_ledger_candidate.name})
    package_fd, _package_path = _open_package(
        capture_root,
        capture_name,
        allowed_root_siblings=allowed_root_siblings,
    )
    try:
        expected_names = set(CAPTURE_FILES) | {"EVIDENCE_COMPLETE"}
        if _package_names(package_fd) != expected_names:
            raise ContractError("binding_mismatch")
        raw_toc = _read_at(package_fd, "raw-pg-restore-list.toc", MAX_RAW_TOC_BYTES)
        opaque_key = _read_at(package_fd, "opaque-id.key", 32)
        opaque_index = _read_at(package_fd, "opaque-index.json", MAX_LEDGER_BYTES)
        capture_bytes = _read_at(package_fd, "capture.json", MAX_LEDGER_BYTES)
        evidence_files = _read_at(package_fd, "evidence-files.json", MAX_LEDGER_BYTES)
        complete_marker = _read_at(package_fd, "EVIDENCE_COMPLETE", MAX_LEDGER_BYTES)
        if _package_names(package_fd) != expected_names:
            raise ContractError("input_mutated")
    finally:
        os.close(package_fd)
    if len(opaque_key) != 32:
        raise ContractError("binding_mismatch")

    expected_capture_manifest_sha = validate_sha(
        _required(environment, "TOC_REVIEW_EXPECTED_CAPTURE_MANIFEST_SHA256")
    )
    _validate_evidence_manifest(
        evidence_files,
        {
            "raw-pg-restore-list.toc": raw_toc,
            "opaque-id.key": opaque_key,
            "opaque-index.json": opaque_index,
            "capture.json": capture_bytes,
        },
        expected_sha=expected_capture_manifest_sha,
    )
    _validate_complete_marker(complete_marker, expected_capture_manifest_sha)

    capture = validate_capture_schema(strict_json_loads(capture_bytes))
    if capture_bytes != canonical_json_bytes(capture):
        raise ContractError("binding_mismatch")
    expected_raw_sha = validate_sha(
        _required(environment, "TOC_REVIEW_EXPECTED_RAW_TOC_SHA256")
    )
    if (
        sha256_bytes(raw_toc) != expected_raw_sha
        or capture["raw_toc_sha256"] != expected_raw_sha
        or capture["raw_toc_size_bytes"] != len(raw_toc)
        or capture["opaque_key_sha256"] != sha256_bytes(opaque_key)
        or capture["opaque_index_sha256"] != sha256_bytes(opaque_index)
    ):
        raise ContractError("binding_mismatch")
    entries = parse_raw_toc(raw_toc, opaque_key)
    if (
        capture["entry_count"] != len(entries)
        or capture["data_reference_count"] != sum(entry.is_data_reference for entry in entries)
    ):
        raise ContractError("binding_mismatch")
    _validate_opaque_index(opaque_index, entries)

    expected = _capture_binding_expected(environment)
    binding = capture["binding"]
    if not isinstance(binding, dict):
        raise ContractError("binding_mismatch")
    for name in (
        "evidence_manifest_sha256",
        "evidence_run_id",
        "execution_checkout_sha",
        "inner_archive_sha256",
        "inspection_checkout_sha",
        "inspection_procedure_sha256",
        "outer_archive_sha256",
    ):
        if binding.get(name) != expected[name]:
            raise ContractError("binding_mismatch")
    if binding.get("procedure_identity_sha256") != validate_sha(
        _required(environment, "TOC_REVIEW_EXPECTED_PROCEDURE_IDENTITY_SHA256")
    ):
        raise ContractError("binding_mismatch")
    approved_tool_sha = validate_sha(
        _required(environment, "TOC_REVIEW_APPROVED_PG_RESTORE_SHA256")
    )
    pg_identity = capture["pg_restore_identity"]
    if (
        not isinstance(pg_identity, dict)
        or pg_identity.get("approved_identity") != f"sha256:{approved_tool_sha}"
        or pg_identity.get("sha256") != approved_tool_sha
    ):
        raise ContractError("tool_identity_mismatch")

    output_root = Path(_required(environment, "TOC_REVIEW_OUTPUT_ROOT"))
    resolved_output_root = output_root.resolve(strict=True)
    resolved_repo = repo.resolve(strict=True)
    if (
        resolved_output_root == resolved_repo
        or resolved_repo in resolved_output_root.parents
    ):
        raise ContractError("input_invalid")
    output_root_fd = validate_private_root(output_root)
    try:
        ledger_path = Path(_required(environment, "TOC_REVIEW_LEDGER"))
        if not ledger_path.is_absolute():
            raise ContractError("input_invalid")
        lexical_ledger = Path(os.path.abspath(os.fspath(ledger_path)))
        if (
            lexical_ledger.parent != resolved_output_root
            or SAFE_NAME_RE.fullmatch(lexical_ledger.name) is None
        ):
            raise ContractError("input_invalid")
        ledger_file = stable_private_file_at(
            output_root_fd,
            lexical_ledger.name,
            max_bytes=MAX_LEDGER_BYTES,
            exact_mode=0o400,
        )
    finally:
        os.close(output_root_fd)
    ledger = strict_json_loads(ledger_file.data)
    if ledger_file.data != canonical_json_bytes(ledger):
        raise ContractError("ledger_schema_invalid")
    result = validate_ledger(
        ledger,
        capture=capture,
        entries=entries,
        capture_manifest_sha256=expected_capture_manifest_sha,
    )
    if _verify_checkout(
        validate_git_sha(
            _required(environment, "TOC_REVIEW_APPROVED_EXECUTION_CHECKOUT_SHA")
        )
    ) != ledger_procedure_identity:
        raise ContractError("binding_mismatch")
    result["ledger_procedure_identity"] = ledger_procedure_identity
    result["ledger_procedure_identity_sha256"] = sha256_bytes(
        canonical_json_bytes(ledger_procedure_identity)
    )
    ledger_bytes = canonical_json_bytes(ledger)
    result_bytes = canonical_json_bytes(result)
    final_name = (
        f"toc-ledger-{expected_capture_manifest_sha[:12]}-{sha256_bytes(ledger_bytes)[:12]}"
    )
    publication = publish_private_package(
        output_root,
        final_name,
        {
            "annotation-ledger.json": ledger_bytes,
            "classification-result.json": result_bytes,
        },
        kind="ledger",
    )
    counts = {
        "data_reference_count": result["data_reference_count"],
        "entry_count": result["entry_count"],
        "unresolved_count": result["unresolved_count"],
    }
    hashes = {
        "ledger_sha256": sha256_bytes(ledger_bytes),
        "ledger_procedure_identity_sha256": result[
            "ledger_procedure_identity_sha256"
        ],
        "publication_manifest_sha256": publication.manifest_sha256,
    }
    return counts, hashes


def main() -> int:
    try:
        counts, hashes = execute(os.environ)
    except ContractError as exc:
        _emit_operator_diagnostic(
            "TOC_INTERNAL_DIAGNOSTIC_STDERR_FD",
            sys.stderr,
            fixed_diagnostic(stage="ledger", status="failed", reason=exc.code),
        )
        return 1
    except BaseException:
        _emit_operator_diagnostic(
            "TOC_INTERNAL_DIAGNOSTIC_STDERR_FD",
            sys.stderr,
            fixed_diagnostic(
                stage="ledger", status="failed", reason="internal_failure"
            ),
        )
        return 1
    if counts["unresolved_count"] > 0:
        _emit_operator_diagnostic(
            "TOC_INTERNAL_DIAGNOSTIC_STDOUT_FD",
            sys.stdout,
            fixed_diagnostic(
                stage="ledger",
                status="review_required",
                reason="blocked",
                counts=counts,
                hashes=hashes,
            )
        )
        return 2
    _emit_operator_diagnostic(
        "TOC_INTERNAL_DIAGNOSTIC_STDOUT_FD",
        sys.stdout,
        fixed_diagnostic(
            stage="ledger", status="complete", reason="ok", counts=counts, hashes=hashes
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
