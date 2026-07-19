#!/usr/bin/env python3
"""Internal metadata-only re-attestation probe for one private TOC capture.

Operators must use ``run-lovable-toc-capture-metadata-reattestation.sh``.
This component is deliberately stdlib-only.  It content-opens exactly three
fixed metadata files and only metadata-stats the raw TOC, opaque index, and
opaque key.  It creates no file, invokes no child, and performs no network I/O.
"""

from __future__ import annotations

import sys


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


if not _runtime_isolation_enabled():
    raise SystemExit(1)

import datetime as _datetime
import hashlib
import json
import os
import re
import stat
from dataclasses import dataclass
from typing import Any, Callable, Mapping, Sequence


DIAGNOSTIC_VERSION = 1
STAGE = "toc_capture_metadata_reattestation"
MAX_METADATA_BYTES = 8 * 1024 * 1024
MAX_JSON_DEPTH = 32
MAX_VALUE_BYTES = 512
SHA256_RE = re.compile(r"^[0-9a-f]{64}$", re.ASCII)
GIT_SHA_RE = re.compile(r"^[0-9a-f]{40}$", re.ASCII)
SAFE_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,126}$", re.ASCII)
SAFE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,159}$", re.ASCII)
VERSION_RE = re.compile(
    r"^pg_restore \(PostgreSQL\) [0-9]{1,3}(?:\.[0-9]{1,3}){1,3}"
    r"(?:(?:beta|rc)[0-9]{1,3}|devel)?$",
    re.ASCII,
)
PYTHON_VERSION_RE = re.compile(
    r"^cpython:(?:0|[1-9][0-9]{0,2})\."
    r"(?:0|[1-9][0-9]{0,2})\."
    r"(?:0|[1-9][0-9]{0,2})$",
    re.ASCII,
)

PACKAGE_FILES = frozenset(
    {
        "EVIDENCE_COMPLETE",
        "capture.json",
        "evidence-files.json",
        "opaque-id.key",
        "opaque-index.json",
        "raw-pg-restore-list.toc",
    }
)
PERMITTED_CONTENT_FILES = frozenset(
    {"EVIDENCE_COMPLETE", "capture.json", "evidence-files.json"}
)
FORBIDDEN_CONTENT_FILES = frozenset(
    {"opaque-id.key", "opaque-index.json", "raw-pg-restore-list.toc"}
)
MANIFEST_PAYLOAD_FILES = frozenset(
    {"capture.json", "opaque-id.key", "opaque-index.json", "raw-pg-restore-list.toc"}
)
CAPTURE_PROCEDURE_IDENTITY_KEYS = frozenset(
    {
        "execution_checkout_sha",
        "execution_python_approved_sha256",
        "execution_python_identity_sha256",
        "README_md_blob_sha",
        "README_md_sha256",
        "run_lovable_toc_capture_sh_blob_sha",
        "run_lovable_toc_capture_sh_sha256",
        "capture_lovable_toc_envelope_py_blob_sha",
        "capture_lovable_toc_envelope_py_sha256",
        "capture_lovable_toc_py_blob_sha",
        "capture_lovable_toc_py_sha256",
        "bounded_pg_restore_py_blob_sha",
        "bounded_pg_restore_py_sha256",
        "inspect_lovable_export_py_blob_sha",
        "inspect_lovable_export_py_sha256",
        "lovable_toc_contract_py_blob_sha",
        "lovable_toc_contract_py_sha256",
        "lovable_dump_report_py_blob_sha",
        "lovable_dump_report_py_sha256",
        "normalize_lovable_export_py_blob_sha",
        "normalize_lovable_export_py_sha256",
        "evidence_manifest_sha256",
        "inspection_checkout_sha",
        "inspection_procedure_sha256",
    }
)
PROCEDURE_PATH_KEYS = (
    ("launcher", "scripts/migration/run-lovable-toc-capture-metadata-reattestation.sh"),
    ("probe", "scripts/migration/probe-lovable-toc-capture-metadata.py"),
    ("readme", "scripts/migration/README.md"),
    ("runbook", "docs/migration/migration-runbook.md"),
)
FAILURE_REASONS = frozenset(
    {
        "binding_mismatch",
        "input_invalid",
        "input_mutated",
        "internal_failure",
        "metadata_invalid",
        "output_failed",
        "package_invalid",
        "repository_binding_mismatch",
        "session_invalid",
    }
)

USER_ENVIRONMENT_KEYS = frozenset(
    {
        "CANDIDATE_DISCLOSURE",
        "CEILINGS_ACCEPTED",
        "NO_RETRY_AFTER_PRIVATE_ACCESS",
        "TOC_REATTEST_APPROVED_EXECUTION_CHECKOUT_SHA",
        "TOC_REATTEST_APPROVED_EXECUTION_PYTHON_DEVICE",
        "TOC_REATTEST_APPROVED_EXECUTION_PYTHON_GID",
        "TOC_REATTEST_APPROVED_EXECUTION_PYTHON_INODE",
        "TOC_REATTEST_APPROVED_EXECUTION_PYTHON_MODE",
        "TOC_REATTEST_APPROVED_EXECUTION_PYTHON_SHA256",
        "TOC_REATTEST_APPROVED_EXECUTION_PYTHON_SIZE_BYTES",
        "TOC_REATTEST_APPROVED_EXECUTION_PYTHON_UID",
        "TOC_REATTEST_APPROVED_EXECUTION_PYTHON_VERSION",
        "TOC_REATTEST_APPROVED_PROCEDURE_IDENTITY_SHA256",
        "TOC_REATTEST_AUTHORIZER_IDENTITY",
        "TOC_REATTEST_CAPTURE_PACKAGE_NAME",
        "TOC_REATTEST_CAPTURE_ROOT",
        "TOC_REATTEST_ENCRYPTION_ATTESTATION",
        "TOC_REATTEST_EXECUTION_PYTHON",
        "TOC_REATTEST_EXPECTED_CAPTURE_EVIDENCE_FILES_SHA256",
        "TOC_REATTEST_EXPECTED_CAPTURE_EXECUTION_CHECKOUT_SHA",
        "TOC_REATTEST_EXPECTED_CAPTURE_PROCEDURE_IDENTITY_SHA256",
        "TOC_REATTEST_EXPECTED_DATA_REFERENCE_COUNT",
        "TOC_REATTEST_EXPECTED_DEVICE",
        "TOC_REATTEST_EXPECTED_ENTRY_COUNT",
        "TOC_REATTEST_EXPECTED_GID",
        "TOC_REATTEST_EXPECTED_HOST_ID",
        "TOC_REATTEST_EXPECTED_INNER_ARCHIVE_SHA256",
        "TOC_REATTEST_EXPECTED_INSPECTION_CHECKOUT_SHA",
        "TOC_REATTEST_EXPECTED_INSPECTION_EVIDENCE_MANIFEST_SHA256",
        "TOC_REATTEST_EXPECTED_INSPECTION_PROCEDURE_SHA256",
        "TOC_REATTEST_EXPECTED_OUTER_ARCHIVE_SHA256",
        "TOC_REATTEST_EXPECTED_OUTPUT_DEVICE",
        "TOC_REATTEST_EXPECTED_OUTPUT_INODE",
        "TOC_REATTEST_EXPECTED_PG_RESTORE_DEVICE",
        "TOC_REATTEST_EXPECTED_PG_RESTORE_GID",
        "TOC_REATTEST_EXPECTED_PG_RESTORE_IDENTITY_SHA256",
        "TOC_REATTEST_EXPECTED_PG_RESTORE_INODE",
        "TOC_REATTEST_EXPECTED_PG_RESTORE_MODE",
        "TOC_REATTEST_EXPECTED_PG_RESTORE_PATH",
        "TOC_REATTEST_EXPECTED_PG_RESTORE_SHA256",
        "TOC_REATTEST_EXPECTED_PG_RESTORE_SIZE_BYTES",
        "TOC_REATTEST_EXPECTED_PG_RESTORE_UID",
        "TOC_REATTEST_EXPECTED_PG_RESTORE_VERSION",
        "TOC_REATTEST_EXPECTED_RAW_TOC_SHA256",
        "TOC_REATTEST_EXPECTED_RUN_ID",
        "TOC_REATTEST_EXPECTED_UID",
        "TOC_REATTEST_EXECUTING_OPERATOR_IDENTITY",
        "TOC_REATTEST_INDEPENDENT_REVIEWER_IDENTITY",
        "TOC_REATTEST_METADATA_SESSION_EXPIRES_AT_UTC",
        "TOC_REATTEST_METADATA_SESSION_ID",
        "TOC_REATTEST_METADATA_SESSION_NONCE",
        "TOC_REATTEST_OUTPUT_DESTINATION_ATTESTATION",
    }
)
INTERNAL_ENVIRONMENT_KEYS = frozenset(
    {
        "LANG",
        "LC_ALL",
        "TOC_INTERNAL_COMPONENT_BLOB",
        "TOC_INTERNAL_COMPONENT_FD",
        "TOC_INTERNAL_COMPONENT_PATH",
        "TOC_INTERNAL_DIAGNOSTIC_FD",
        "TOC_INTERNAL_PROCEDURE_IDENTITY_JSON",
        "TOC_INTERNAL_REPOSITORY_ROOT",
    }
)
ALLOWED_ENVIRONMENT_KEYS = USER_ENVIRONMENT_KEYS | INTERNAL_ENVIRONMENT_KEYS


class ProbeFailure(RuntimeError):
    """A private failure reduced to one closed public reason."""

    def __init__(self, reason: str):
        self.reason = reason if reason in FAILURE_REASONS else "internal_failure"
        super().__init__(self.reason)


@dataclass(frozen=True)
class EntryMetadata:
    device: int
    inode: int
    mode: int
    links: int
    uid: int
    gid: int
    size: int
    mtime_ns: int
    ctime_ns: int


@dataclass(frozen=True)
class Expectations:
    session_id: str
    session_nonce: str
    expires_at: _datetime.datetime
    repository_root: str
    procedure_identity: Mapping[str, Any]
    approved_procedure_identity_sha256: str
    capture_root: str
    package_name: str
    expected_uid: int
    expected_gid: int
    expected_device: int
    capture_manifest_sha256: str
    evidence_run_id: str
    outer_archive_sha256: str
    inner_archive_sha256: str
    inspection_evidence_manifest_sha256: str
    inspection_checkout_sha: str
    inspection_procedure_sha256: str
    capture_execution_checkout_sha: str
    capture_procedure_identity_sha256: str
    pg_restore_identity: Mapping[str, Any]
    pg_restore_identity_sha256: str
    raw_toc_sha256: str
    entry_count: int
    data_reference_count: int


_TEST_HOOK: Callable[[str], None] | None = None


def _hook(stage: str) -> None:
    if _TEST_HOOK is not None:
        _TEST_HOOK(stage)


def _canonical_json(value: Any) -> bytes:
    try:
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
    except (TypeError, ValueError, UnicodeError) as exc:
        raise ProbeFailure("metadata_invalid") from exc


def _duplicate_rejecting_pairs(pairs: Sequence[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ProbeFailure("metadata_invalid")
        result[key] = value
    return result


def _reject_constant(_: str) -> None:
    raise ProbeFailure("metadata_invalid")


def _depth(value: Any) -> int:
    maximum = 0
    stack: list[tuple[Any, int]] = [(value, 1)]
    seen = 0
    while stack:
        current, level = stack.pop()
        maximum = max(maximum, level)
        seen += 1
        if seen > 1_000_000 or maximum > MAX_JSON_DEPTH:
            raise ProbeFailure("metadata_invalid")
        if type(current) is dict:
            stack.extend((item, level + 1) for item in current.values())
        elif type(current) is list:
            stack.extend((item, level + 1) for item in current)
    return maximum


def _strict_json(raw: bytes, maximum: int = MAX_METADATA_BYTES) -> Any:
    if not raw or len(raw) > maximum:
        raise ProbeFailure("metadata_invalid")
    try:
        text = raw.decode("utf-8", errors="strict")
        value = json.loads(
            text,
            object_pairs_hook=_duplicate_rejecting_pairs,
            parse_constant=_reject_constant,
        )
    except ProbeFailure:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError, ValueError) as exc:
        raise ProbeFailure("metadata_invalid") from exc
    _depth(value)
    if raw != _canonical_json(value):
        raise ProbeFailure("metadata_invalid")
    return value


def _exact_dict(value: Any, keys: set[str] | frozenset[str]) -> dict[str, Any]:
    if type(value) is not dict or set(value) != set(keys):
        raise ProbeFailure("metadata_invalid")
    return value


def _string(value: Any, pattern: re.Pattern[str] | None = None) -> str:
    if (
        type(value) is not str
        or not value
        or not value.isascii()
        or len(value.encode("ascii")) > MAX_VALUE_BYTES
        or (pattern is not None and pattern.fullmatch(value) is None)
    ):
        raise ProbeFailure("input_invalid")
    return value


def _sha(value: Any) -> str:
    return _string(value, SHA256_RE)


def _git_sha(value: Any) -> str:
    return _string(value, GIT_SHA_RE)


def _integer(value: Any, minimum: int = 0, maximum: int = 2**63 - 1) -> int:
    if type(value) is not int or value < minimum or value > maximum:
        raise ProbeFailure("input_invalid")
    return value


def _env_integer(name: str, minimum: int = 0, maximum: int = 2**63 - 1) -> int:
    raw = os.environ.get(name)
    if type(raw) is not str or not raw.isascii() or not raw.isdigit():
        raise ProbeFailure("input_invalid")
    value = int(raw)
    return _integer(value, minimum, maximum)


def _env_device(name: str) -> int:
    raw = os.environ.get(name)
    if (
        type(raw) is not str
        or not raw.isascii()
        or re.fullmatch(r"-?(?:0|[1-9][0-9]*)", raw, re.ASCII) is None
    ):
        raise ProbeFailure("input_invalid")
    value = int(raw)
    if value < -(2**63) or value > 2**64 - 1:
        raise ProbeFailure("input_invalid")
    return value


def _parse_expiry(value: str) -> _datetime.datetime:
    if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z", value):
        raise ProbeFailure("session_invalid")
    try:
        result = _datetime.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=_datetime.timezone.utc
        )
    except ValueError as exc:
        raise ProbeFailure("session_invalid") from exc
    now = _datetime.datetime.now(_datetime.timezone.utc)
    if result <= now or result > now + _datetime.timedelta(hours=24):
        raise ProbeFailure("session_invalid")
    return result


def _identity(metadata: os.stat_result) -> EntryMetadata:
    return EntryMetadata(
        device=metadata.st_dev,
        inode=metadata.st_ino,
        mode=stat.S_IMODE(metadata.st_mode),
        links=metadata.st_nlink,
        uid=metadata.st_uid,
        gid=metadata.st_gid,
        size=metadata.st_size,
        mtime_ns=metadata.st_mtime_ns,
        ctime_ns=metadata.st_ctime_ns,
    )


def _directory_identity(metadata: os.stat_result) -> tuple[int, ...]:
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


def _read_stable_metadata_file(
    package_fd: int,
    name: str,
    *,
    expected_uid: int,
    expected_gid: int,
    expected_device: int,
) -> tuple[bytes, EntryMetadata]:
    if name not in PERMITTED_CONTENT_FILES:
        raise ProbeFailure("internal_failure")
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(name, flags, dir_fd=package_fd)
    except OSError as exc:
        raise ProbeFailure("package_invalid") from exc
    try:
        before_raw = os.fstat(descriptor)
        before = _identity(before_raw)
        if (
            not stat.S_ISREG(before_raw.st_mode)
            or before.uid != expected_uid
            or before.gid != expected_gid
            or before.device != expected_device
            or before.links != 1
            or before.mode != 0o400
            or before.size <= 0
            or before.size > MAX_METADATA_BYTES
        ):
            raise ProbeFailure("package_invalid")
        chunks: list[bytes] = []
        observed = 0
        while True:
            chunk = os.read(descriptor, min(65536, MAX_METADATA_BYTES + 1))
            if not chunk:
                break
            observed += len(chunk)
            if observed > MAX_METADATA_BYTES or observed > before.size:
                raise ProbeFailure("input_mutated")
            chunks.append(chunk)
        after = _identity(os.fstat(descriptor))
        if after != before or observed != before.size:
            raise ProbeFailure("input_mutated")
        return b"".join(chunks), after
    finally:
        try:
            os.close(descriptor)
        except OSError as exc:
            raise ProbeFailure("input_mutated") from exc


def _stat_package_entry(
    package_fd: int,
    name: str,
    *,
    expected_uid: int,
    expected_gid: int,
    expected_device: int,
) -> EntryMetadata:
    if name not in PACKAGE_FILES:
        raise ProbeFailure("internal_failure")
    try:
        raw = os.stat(name, dir_fd=package_fd, follow_symlinks=False)
    except OSError as exc:
        raise ProbeFailure("package_invalid") from exc
    identity = _identity(raw)
    if (
        not stat.S_ISREG(raw.st_mode)
        or identity.uid != expected_uid
        or identity.gid != expected_gid
        or identity.device != expected_device
        or identity.links != 1
        or identity.mode != 0o400
        or identity.size <= 0
    ):
        raise ProbeFailure("package_invalid")
    if name == "opaque-id.key" and identity.size != 32:
        raise ProbeFailure("package_invalid")
    if name in PERMITTED_CONTENT_FILES and identity.size > MAX_METADATA_BYTES:
        raise ProbeFailure("package_invalid")
    return identity


def _list_package(package_fd: int) -> None:
    try:
        names = os.listdir(package_fd)
    except (OSError, TypeError) as exc:
        raise ProbeFailure("package_invalid") from exc
    if (
        len(names) != len(PACKAGE_FILES)
        or set(names) != PACKAGE_FILES
        or len({name.casefold() for name in names}) != len(names)
    ):
        raise ProbeFailure("package_invalid")


def _open_directory(path: str) -> int:
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        return os.open(path, flags)
    except OSError as exc:
        raise ProbeFailure("package_invalid") from exc


def _open_child_directory(parent_fd: int, name: str) -> int:
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        return os.open(name, flags, dir_fd=parent_fd)
    except OSError as exc:
        raise ProbeFailure("package_invalid") from exc


def _validate_directory(
    descriptor: int,
    *,
    expected_uid: int,
    expected_gid: int,
    expected_device: int,
) -> os.stat_result:
    try:
        metadata = os.fstat(descriptor)
    except OSError as exc:
        raise ProbeFailure("package_invalid") from exc
    if (
        not stat.S_ISDIR(metadata.st_mode)
        or metadata.st_uid != expected_uid
        or metadata.st_gid != expected_gid
        or metadata.st_dev != expected_device
        or stat.S_IMODE(metadata.st_mode) != 0o700
    ):
        raise ProbeFailure("package_invalid")
    return metadata


def _manifest_records(raw: bytes) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    root = _exact_dict(
        _strict_json(raw), {"artifact_kind", "files", "format_version"}
    )
    if (
        root["artifact_kind"] != "lovable_toc_capture_evidence"
        or root["format_version"] != 1
        or type(root["files"]) is not list
        or len(root["files"]) != 4
    ):
        raise ProbeFailure("metadata_invalid")
    records: dict[str, dict[str, Any]] = {}
    for raw_record in root["files"]:
        record = _exact_dict(raw_record, {"name", "sha256", "size_bytes"})
        name = record["name"]
        if (
            type(name) is not str
            or name not in MANIFEST_PAYLOAD_FILES
            or name in records
            or type(record["size_bytes"]) is not int
            or record["size_bytes"] <= 0
        ):
            raise ProbeFailure("metadata_invalid")
        _sha(record["sha256"])
        records[name] = dict(record)
    if set(records) != MANIFEST_PAYLOAD_FILES:
        raise ProbeFailure("metadata_invalid")
    if root["files"] != [records[name] for name in sorted(records)]:
        raise ProbeFailure("metadata_invalid")
    return records, root


def _validate_runtime_identity(value: Any, *, python_identity: bool = False) -> dict[str, Any]:
    root = _exact_dict(
        value,
        {
            "approved_identity",
            "device",
            "executable_path",
            "gid",
            "inode",
            "mode",
            "reported_version",
            "sha256",
            "size_bytes",
            "uid",
        },
    )
    if root["approved_identity"] != "sha256:" + _sha(root["sha256"]):
        raise ProbeFailure("metadata_invalid")
    for name in ("device", "gid", "inode", "size_bytes", "uid"):
        _integer(root[name])
    if type(root["mode"]) is not str or re.fullmatch(r"[0-7]{4}", root["mode"]) is None:
        raise ProbeFailure("metadata_invalid")
    if (
        type(root["executable_path"]) is not str
        or not root["executable_path"].startswith("/")
        or "\x00" in root["executable_path"]
    ):
        raise ProbeFailure("metadata_invalid")
    pattern = PYTHON_VERSION_RE if python_identity else VERSION_RE
    _string(root["reported_version"], pattern)
    return root


def _validate_capture(value: Any) -> dict[str, Any]:
    root = _exact_dict(
        value,
        {
            "artifact_kind",
            "binding",
            "capture_status",
            "data_reference_count",
            "entry_count",
            "execution_python_identity",
            "format_version",
            "opaque_index_sha256",
            "opaque_key_sha256",
            "overall_status",
            "pg_restore_identity",
            "procedure_identity",
            "raw_toc_sha256",
            "raw_toc_size_bytes",
            "review_gate",
            "restore_command_gate",
            "restore_planning_gate",
        },
    )
    if (
        root["artifact_kind"] != "lovable_toc_private_capture"
        or root["capture_status"] != "CAPTURE_COMPLETE"
        or root["format_version"] != 1
        or root["overall_status"] != "REVIEW_REQUIRED"
        or root["review_gate"] != "ANNOTATION_REQUIRED"
        or root["restore_command_gate"] != "BLOCKED"
        or root["restore_planning_gate"] != "BLOCKED"
    ):
        raise ProbeFailure("metadata_invalid")
    _integer(root["entry_count"], 1, 1_000_000)
    _integer(root["data_reference_count"], 0, root["entry_count"])
    _integer(root["raw_toc_size_bytes"], 1, 128 * 1024 * 1024)
    for name in ("opaque_index_sha256", "opaque_key_sha256", "raw_toc_sha256"):
        _sha(root[name])
    binding = _exact_dict(
        root["binding"],
        {
            "evidence_manifest_sha256",
            "evidence_run_id",
            "execution_checkout_sha",
            "inner_archive_sha256",
            "inspection_checkout_sha",
            "inspection_procedure_sha256",
            "outer_archive_sha256",
            "procedure_identity_sha256",
        },
    )
    _sha(binding["evidence_manifest_sha256"])
    _string(binding["evidence_run_id"], SAFE_ID_RE)
    _git_sha(binding["execution_checkout_sha"])
    _sha(binding["inner_archive_sha256"])
    _git_sha(binding["inspection_checkout_sha"])
    _sha(binding["inspection_procedure_sha256"])
    _sha(binding["outer_archive_sha256"])
    _sha(binding["procedure_identity_sha256"])
    execution_python = _validate_runtime_identity(
        root["execution_python_identity"], python_identity=True
    )
    pg_restore = _validate_runtime_identity(root["pg_restore_identity"])
    procedure = _exact_dict(root["procedure_identity"], CAPTURE_PROCEDURE_IDENTITY_KEYS)
    for name, value_item in procedure.items():
        if name.endswith("_blob_sha") or name in {
            "execution_checkout_sha",
            "inspection_checkout_sha",
        }:
            _git_sha(value_item)
        else:
            _sha(value_item)
    if (
        procedure["execution_checkout_sha"] != binding["execution_checkout_sha"]
        or procedure["inspection_checkout_sha"] != binding["inspection_checkout_sha"]
        or procedure["execution_python_approved_sha256"] != execution_python["sha256"]
        or procedure["execution_python_identity_sha256"]
        != hashlib.sha256(_canonical_json(execution_python)).hexdigest()
        or procedure["inspection_procedure_sha256"]
        != binding["inspection_procedure_sha256"]
        or procedure["evidence_manifest_sha256"]
        != binding["evidence_manifest_sha256"]
        or hashlib.sha256(_canonical_json(procedure)).hexdigest()
        != binding["procedure_identity_sha256"]
        or pg_restore["sha256"]
        != pg_restore["approved_identity"].removeprefix("sha256:")
    ):
        raise ProbeFailure("metadata_invalid")
    return root


def _load_expectations() -> Expectations:
    environment_keys = set(os.environ)
    # Apple's process bootstrap injects this one locale-scoped variable even
    # under ``env -i``. Accept only its reviewed numeric grammar on Darwin and
    # otherwise preserve the exact child allowlist.
    if "__CF_USER_TEXT_ENCODING" in environment_keys:
        injected = os.environ.get("__CF_USER_TEXT_ENCODING", "")
        if os.uname().sysname != "Darwin" or re.fullmatch(
            r"0x[0-9A-Fa-f]{1,8}:0x[0-9A-Fa-f]{1,8}:0x[0-9A-Fa-f]{1,8}",
            injected,
        ) is None:
            raise ProbeFailure("input_invalid")
        environment_keys.remove("__CF_USER_TEXT_ENCODING")
    if environment_keys != ALLOWED_ENVIRONMENT_KEYS:
        raise ProbeFailure("input_invalid")
    if os.environ.get("LANG") != "C" or os.environ.get("LC_ALL") != "C":
        raise ProbeFailure("input_invalid")
    if (
        os.environ.get("NO_RETRY_AFTER_PRIVATE_ACCESS") != "ACKNOWLEDGED"
        or os.environ.get("CANDIDATE_DISCLOSURE")
        != "RECORDED_OPAQUE_INDEX_SHA256_ONLY"
        or os.environ.get("CEILINGS_ACCEPTED")
        != "TERMINAL_PARTIAL_WRITE_SAME_USER_PATH_SWAP_ATIME_AND_READ_ONLY_NONCE"
    ):
        raise ProbeFailure("binding_mismatch")
    session_id = _string(os.environ.get("TOC_REATTEST_METADATA_SESSION_ID"), SAFE_ID_RE)
    nonce = _sha(os.environ.get("TOC_REATTEST_METADATA_SESSION_NONCE"))
    expiry = _parse_expiry(
        _string(os.environ.get("TOC_REATTEST_METADATA_SESSION_EXPIRES_AT_UTC"))
    )
    authorizer = _string(
        os.environ.get("TOC_REATTEST_AUTHORIZER_IDENTITY"), SAFE_ID_RE
    )
    executing_operator = _string(
        os.environ.get("TOC_REATTEST_EXECUTING_OPERATOR_IDENTITY"), SAFE_ID_RE
    )
    independent_reviewer = _string(
        os.environ.get("TOC_REATTEST_INDEPENDENT_REVIEWER_IDENTITY"), SAFE_ID_RE
    )
    if independent_reviewer.casefold() in {
        authorizer.casefold(),
        executing_operator.casefold(),
    }:
        raise ProbeFailure("binding_mismatch")
    if (
        os.environ.get("TOC_REATTEST_OUTPUT_DESTINATION_ATTESTATION")
        != "LOCAL_FOREGROUND_STDOUT_NO_RECORDING"
        or os.environ.get("TOC_REATTEST_ENCRYPTION_ATTESTATION")
        != "APPROVED_ENCRYPTED_LOCAL_VOLUME"
        or _string(os.environ.get("TOC_REATTEST_EXPECTED_HOST_ID"), SAFE_ID_RE)
        != os.uname().nodename
    ):
        raise ProbeFailure("binding_mismatch")

    repository_root = os.environ["TOC_INTERNAL_REPOSITORY_ROOT"]
    procedure_text = os.environ["TOC_INTERNAL_PROCEDURE_IDENTITY_JSON"]
    if "\n" in procedure_text or "\r" in procedure_text:
        raise ProbeFailure("repository_binding_mismatch")
    procedure_identity = _strict_json(
        (procedure_text + "\n").encode("ascii"), 64 * 1024
    )
    procedure_identity = _exact_dict(
        procedure_identity,
        {"execution_checkout_sha", "files", "format_version"},
    )
    if (
        procedure_identity["format_version"] != 1
        or procedure_identity["execution_checkout_sha"]
        != _git_sha(os.environ["TOC_REATTEST_APPROVED_EXECUTION_CHECKOUT_SHA"])
        or type(procedure_identity["files"]) is not dict
        or set(procedure_identity["files"])
        != {label for label, _ in PROCEDURE_PATH_KEYS}
    ):
        raise ProbeFailure("repository_binding_mismatch")
    for label, relative_path in PROCEDURE_PATH_KEYS:
        item = _exact_dict(
            procedure_identity["files"][label],
            {"blob_sha", "path", "sha256"},
        )
        if item["path"] != relative_path:
            raise ProbeFailure("repository_binding_mismatch")
        _git_sha(item["blob_sha"])
        _sha(item["sha256"])
    approved_procedure = _sha(
        os.environ["TOC_REATTEST_APPROVED_PROCEDURE_IDENTITY_SHA256"]
    )
    if hashlib.sha256(_canonical_json(procedure_identity)).hexdigest() != approved_procedure:
        raise ProbeFailure("repository_binding_mismatch")

    pg_sha = _sha(os.environ["TOC_REATTEST_EXPECTED_PG_RESTORE_SHA256"])
    pg_identity = {
        "approved_identity": "sha256:" + pg_sha,
        "device": _env_integer("TOC_REATTEST_EXPECTED_PG_RESTORE_DEVICE"),
        "executable_path": os.environ["TOC_REATTEST_EXPECTED_PG_RESTORE_PATH"],
        "gid": _env_integer("TOC_REATTEST_EXPECTED_PG_RESTORE_GID"),
        "inode": _env_integer("TOC_REATTEST_EXPECTED_PG_RESTORE_INODE"),
        "mode": os.environ["TOC_REATTEST_EXPECTED_PG_RESTORE_MODE"],
        "reported_version": os.environ["TOC_REATTEST_EXPECTED_PG_RESTORE_VERSION"],
        "sha256": pg_sha,
        "size_bytes": _env_integer("TOC_REATTEST_EXPECTED_PG_RESTORE_SIZE_BYTES", 1),
        "uid": _env_integer("TOC_REATTEST_EXPECTED_PG_RESTORE_UID"),
    }
    _validate_runtime_identity(pg_identity)
    if (
        hashlib.sha256(_canonical_json(pg_identity)).hexdigest()
        != _sha(os.environ["TOC_REATTEST_EXPECTED_PG_RESTORE_IDENTITY_SHA256"])
    ):
        raise ProbeFailure("binding_mismatch")

    capture_root = os.environ["TOC_REATTEST_CAPTURE_ROOT"]
    package_name = _string(
        os.environ.get("TOC_REATTEST_CAPTURE_PACKAGE_NAME"), SAFE_NAME_RE
    )
    if (
        not os.path.isabs(capture_root)
        or os.path.abspath(capture_root) != capture_root
        or os.path.realpath(capture_root) != capture_root
        or not os.path.isabs(repository_root)
        or os.path.realpath(repository_root) != repository_root
    ):
        raise ProbeFailure("input_invalid")
    try:
        if os.path.commonpath((capture_root, repository_root)) == repository_root:
            raise ProbeFailure("input_invalid")
    except ValueError as exc:
        raise ProbeFailure("input_invalid") from exc

    return Expectations(
        session_id=session_id,
        session_nonce=nonce,
        expires_at=expiry,
        repository_root=repository_root,
        procedure_identity=procedure_identity,
        approved_procedure_identity_sha256=approved_procedure,
        capture_root=capture_root,
        package_name=package_name,
        expected_uid=_env_integer("TOC_REATTEST_EXPECTED_UID"),
        expected_gid=_env_integer("TOC_REATTEST_EXPECTED_GID"),
        expected_device=_env_integer("TOC_REATTEST_EXPECTED_DEVICE"),
        capture_manifest_sha256=_sha(
            os.environ["TOC_REATTEST_EXPECTED_CAPTURE_EVIDENCE_FILES_SHA256"]
        ),
        evidence_run_id=_string(
            os.environ.get("TOC_REATTEST_EXPECTED_RUN_ID"), SAFE_ID_RE
        ),
        outer_archive_sha256=_sha(
            os.environ["TOC_REATTEST_EXPECTED_OUTER_ARCHIVE_SHA256"]
        ),
        inner_archive_sha256=_sha(
            os.environ["TOC_REATTEST_EXPECTED_INNER_ARCHIVE_SHA256"]
        ),
        inspection_evidence_manifest_sha256=_sha(
            os.environ["TOC_REATTEST_EXPECTED_INSPECTION_EVIDENCE_MANIFEST_SHA256"]
        ),
        inspection_checkout_sha=_git_sha(
            os.environ["TOC_REATTEST_EXPECTED_INSPECTION_CHECKOUT_SHA"]
        ),
        inspection_procedure_sha256=_sha(
            os.environ["TOC_REATTEST_EXPECTED_INSPECTION_PROCEDURE_SHA256"]
        ),
        capture_execution_checkout_sha=_git_sha(
            os.environ["TOC_REATTEST_EXPECTED_CAPTURE_EXECUTION_CHECKOUT_SHA"]
        ),
        capture_procedure_identity_sha256=_sha(
            os.environ["TOC_REATTEST_EXPECTED_CAPTURE_PROCEDURE_IDENTITY_SHA256"]
        ),
        pg_restore_identity=pg_identity,
        pg_restore_identity_sha256=_sha(
            os.environ["TOC_REATTEST_EXPECTED_PG_RESTORE_IDENTITY_SHA256"]
        ),
        raw_toc_sha256=_sha(os.environ["TOC_REATTEST_EXPECTED_RAW_TOC_SHA256"]),
        entry_count=_env_integer("TOC_REATTEST_EXPECTED_ENTRY_COUNT", 1, 1_000_000),
        data_reference_count=_env_integer(
            "TOC_REATTEST_EXPECTED_DATA_REFERENCE_COUNT", 0, 1_000_000
        ),
    )


def _success_payload(expectations: Expectations, candidate: str) -> bytes:
    return _canonical_json(
        {
            "archive_binding_match": True,
            "capture_procedure_identity_match": True,
            "checkout_binding_match": True,
            "count_binding_match": True,
            "diagnostic_version": DIAGNOSTIC_VERSION,
            "evidence_binding_match": True,
            "manifest_binding_match": True,
            "metadata_session_id": expectations.session_id,
            "recorded_opaque_index_sha256": candidate,
            "run_binding_match": True,
            "stage": STAGE,
            "status": "pass",
            "tool_binding_match": True,
        }
    )


def _failure_payload(session_id: str, reason: str) -> bytes:
    reviewed = reason if reason in FAILURE_REASONS else "internal_failure"
    return _canonical_json(
        {
            "diagnostic_version": DIAGNOSTIC_VERSION,
            "metadata_session_id": session_id,
            "reason": reviewed,
            "stage": STAGE,
            "status": "failed",
        }
    )


def _write_output(descriptor: int, payload: bytes) -> bool:
    try:
        metadata = os.fstat(descriptor)
        if not (stat.S_ISCHR(metadata.st_mode) or stat.S_ISFIFO(metadata.st_mode)):
            return False
        # One bounded write avoids a retry that could turn a truncated terminal
        # line into a second, misleading output. Terminal writes are not
        # transactional; a short write remains an explicitly accepted ceiling.
        written = os.write(descriptor, payload)
        return type(written) is int and written == len(payload)
    except BaseException:
        return False


def _validate_output_destination(descriptor: int) -> None:
    try:
        metadata = os.fstat(descriptor)
    except OSError as exc:
        raise ProbeFailure("binding_mismatch") from exc
    if (
        not (stat.S_ISCHR(metadata.st_mode) or stat.S_ISFIFO(metadata.st_mode))
        or metadata.st_dev != _env_device("TOC_REATTEST_EXPECTED_OUTPUT_DEVICE")
        or metadata.st_ino
        != _env_integer("TOC_REATTEST_EXPECTED_OUTPUT_INODE", maximum=2**64 - 1)
    ):
        raise ProbeFailure("binding_mismatch")


def _probe(expectations: Expectations) -> str:
    root_fd: int | None = None
    package_fd: int | None = None
    try:
        root_fd = _open_directory(expectations.capture_root)
        root_before = _validate_directory(
            root_fd,
            expected_uid=expectations.expected_uid,
            expected_gid=expectations.expected_gid,
            expected_device=expectations.expected_device,
        )
        package_fd = _open_child_directory(root_fd, expectations.package_name)
        package_before = _validate_directory(
            package_fd,
            expected_uid=expectations.expected_uid,
            expected_gid=expectations.expected_gid,
            expected_device=expectations.expected_device,
        )
        if (root_before.st_dev, root_before.st_ino) == (
            package_before.st_dev,
            package_before.st_ino,
        ):
            raise ProbeFailure("package_invalid")
        _list_package(package_fd)
        before = {
            name: _stat_package_entry(
                package_fd,
                name,
                expected_uid=expectations.expected_uid,
                expected_gid=expectations.expected_gid,
                expected_device=expectations.expected_device,
            )
            for name in PACKAGE_FILES
        }
        _hook("after_metadata_stat")

        evidence_bytes, evidence_identity = _read_stable_metadata_file(
            package_fd,
            "evidence-files.json",
            expected_uid=expectations.expected_uid,
            expected_gid=expectations.expected_gid,
            expected_device=expectations.expected_device,
        )
        if (
            evidence_identity != before["evidence-files.json"]
            or hashlib.sha256(evidence_bytes).hexdigest()
            != expectations.capture_manifest_sha256
        ):
            raise ProbeFailure("binding_mismatch")
        records, _ = _manifest_records(evidence_bytes)
        for name in MANIFEST_PAYLOAD_FILES:
            if records[name]["size_bytes"] != before[name].size:
                raise ProbeFailure("binding_mismatch")
        _hook("after_manifest")

        capture_bytes, capture_identity = _read_stable_metadata_file(
            package_fd,
            "capture.json",
            expected_uid=expectations.expected_uid,
            expected_gid=expectations.expected_gid,
            expected_device=expectations.expected_device,
        )
        if capture_identity != before["capture.json"] or records["capture.json"] != {
            "name": "capture.json",
            "sha256": hashlib.sha256(capture_bytes).hexdigest(),
            "size_bytes": len(capture_bytes),
        }:
            raise ProbeFailure("binding_mismatch")
        capture = _validate_capture(_strict_json(capture_bytes))
        _hook("after_capture")

        marker_bytes, marker_identity = _read_stable_metadata_file(
            package_fd,
            "EVIDENCE_COMPLETE",
            expected_uid=expectations.expected_uid,
            expected_gid=expectations.expected_gid,
            expected_device=expectations.expected_device,
        )
        expected_marker = {
            "artifact_kind": "lovable_toc_capture_complete",
            "evidence_files_sha256": expectations.capture_manifest_sha256,
            "format_version": 1,
        }
        if (
            marker_identity != before["EVIDENCE_COMPLETE"]
            or marker_bytes != _canonical_json(expected_marker)
            or _strict_json(marker_bytes) != expected_marker
        ):
            raise ProbeFailure("binding_mismatch")

        binding = capture["binding"]
        if binding != {
            "evidence_manifest_sha256": expectations.inspection_evidence_manifest_sha256,
            "evidence_run_id": expectations.evidence_run_id,
            "execution_checkout_sha": expectations.capture_execution_checkout_sha,
            "inner_archive_sha256": expectations.inner_archive_sha256,
            "inspection_checkout_sha": expectations.inspection_checkout_sha,
            "inspection_procedure_sha256": expectations.inspection_procedure_sha256,
            "outer_archive_sha256": expectations.outer_archive_sha256,
            "procedure_identity_sha256": expectations.capture_procedure_identity_sha256,
        }:
            raise ProbeFailure("binding_mismatch")
        if (
            capture["entry_count"] != expectations.entry_count
            or capture["data_reference_count"] != expectations.data_reference_count
            or capture["raw_toc_sha256"] != expectations.raw_toc_sha256
            or capture["pg_restore_identity"] != expectations.pg_restore_identity
            or hashlib.sha256(
                _canonical_json(capture["pg_restore_identity"])
            ).hexdigest()
            != expectations.pg_restore_identity_sha256
        ):
            raise ProbeFailure("binding_mismatch")
        if records["raw-pg-restore-list.toc"] != {
            "name": "raw-pg-restore-list.toc",
            "sha256": capture["raw_toc_sha256"],
            "size_bytes": capture["raw_toc_size_bytes"],
        }:
            raise ProbeFailure("binding_mismatch")
        if records["opaque-index.json"] != {
            "name": "opaque-index.json",
            "sha256": capture["opaque_index_sha256"],
            "size_bytes": before["opaque-index.json"].size,
        }:
            raise ProbeFailure("binding_mismatch")
        if records["opaque-id.key"] != {
            "name": "opaque-id.key",
            "sha256": capture["opaque_key_sha256"],
            "size_bytes": 32,
        }:
            raise ProbeFailure("binding_mismatch")
        if (
            binding["procedure_identity_sha256"]
            != hashlib.sha256(_canonical_json(capture["procedure_identity"])).hexdigest()
        ):
            raise ProbeFailure("binding_mismatch")

        _hook("before_revalidation")
        _list_package(package_fd)
        after = {
            name: _stat_package_entry(
                package_fd,
                name,
                expected_uid=expectations.expected_uid,
                expected_gid=expectations.expected_gid,
                expected_device=expectations.expected_device,
            )
            for name in PACKAGE_FILES
        }
        package_after = _validate_directory(
            package_fd,
            expected_uid=expectations.expected_uid,
            expected_gid=expectations.expected_gid,
            expected_device=expectations.expected_device,
        )
        root_after = _validate_directory(
            root_fd,
            expected_uid=expectations.expected_uid,
            expected_gid=expectations.expected_gid,
            expected_device=expectations.expected_device,
        )
        try:
            named_root = os.stat(expectations.capture_root, follow_symlinks=False)
            named_package = os.stat(
                expectations.package_name, dir_fd=root_fd, follow_symlinks=False
            )
        except OSError as exc:
            raise ProbeFailure("input_mutated") from exc
        if (
            before != after
            or _directory_identity(root_before) != _directory_identity(root_after)
            or _directory_identity(package_before) != _directory_identity(package_after)
            or _directory_identity(named_root) != _directory_identity(root_after)
            or _directory_identity(named_package) != _directory_identity(package_after)
        ):
            raise ProbeFailure("input_mutated")
        return _sha(capture["opaque_index_sha256"])
    finally:
        close_failure = False
        for descriptor in (package_fd, root_fd):
            if descriptor is not None:
                try:
                    os.close(descriptor)
                except OSError:
                    close_failure = True
        if close_failure:
            raise ProbeFailure("input_mutated")


def main() -> int:
    session_id = os.environ.get("TOC_REATTEST_METADATA_SESSION_ID", "")
    output_fd = -1
    try:
        if type(session_id) is not str or SAFE_ID_RE.fullmatch(session_id) is None:
            return 1
        raw_output_fd = os.environ.get("TOC_INTERNAL_DIAGNOSTIC_FD")
        if type(raw_output_fd) is not str or not raw_output_fd.isdigit():
            return 1
        output_fd = int(raw_output_fd)
        _validate_output_destination(output_fd)
        expectations = _load_expectations()
        candidate = _probe(expectations)
        payload = _success_payload(expectations, candidate)
        return 0 if _write_output(output_fd, payload) else 1
    except ProbeFailure as exc:
        if output_fd >= 0:
            _write_output(output_fd, _failure_payload(session_id, exc.reason))
        return 1
    except BaseException:
        if output_fd >= 0:
            _write_output(output_fd, _failure_payload(session_id, "internal_failure"))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
