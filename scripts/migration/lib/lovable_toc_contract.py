#!/usr/bin/env python3
"""Private capture and reviewed-ledger contract for Lovable pg_restore TOCs.

This module deliberately does not parse object names from ``pg_restore --list``.
PostgreSQL does not specify a lossless quoting grammar for that editable text
format.  It recognizes only the numeric entry prefix and a closed TOC-class
vocabulary; the exact remainder stays exclusively in the private raw capture.
"""

from __future__ import annotations

import ctypes
import errno
import hashlib
import hmac
import json
import os
import re
import secrets
import stat
import struct
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence

from .lovable_dump_report import (
    DATA_TOC_CLASSES as REPORT_DATA_TOC_CLASSES,
    KNOWN_TOC_CLASSES,
)


CAPTURE_FORMAT_VERSION = 1
LEDGER_FORMAT_VERSION = 1
DIAGNOSTIC_VERSION = 1
MAX_PUBLIC_DIAGNOSTIC_BYTES = 4096
MAX_RAW_TOC_BYTES = 128 * 1024 * 1024
MAX_LEDGER_BYTES = 64 * 1024 * 1024
MAX_ENTRY_COUNT = 1_000_000
OPAQUE_ID_DOMAIN = b"focus-flow-score/lovable-toc-entry/v1\0"
OPAQUE_ID_RE = re.compile(r"^te1_[0-9a-f]{64}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
GIT_SHA_RE = re.compile(r"^[0-9a-f]{40}$")
SAFE_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,126}$")
VERSION_RE = re.compile(
    r"^pg_restore \(PostgreSQL\) "
    r"[0-9]{1,3}(?:\.[0-9]{1,3}){1,3}"
    r"(?:(?:beta|rc)[0-9]{1,3}|devel)?$",
    re.ASCII,
)
EXECUTION_PYTHON_VERSION_RE = re.compile(
    r"^cpython:(?:0|[1-9][0-9]{0,2})\."
    r"(?:0|[1-9][0-9]{0,2})\."
    r"(?:0|[1-9][0-9]{0,2})$",
    re.ASCII,
)

CLASSIFICATIONS = frozenset(
    {
        "restore",
        "exclude_supabase_managed",
        "exclude_duplicate",
        "dependency_only",
        "manual_conflict",
        "unresolved",
    }
)
FINAL_DISPOSITIONS = frozenset(
    {
        "restore",
        "exclude_supabase_managed",
        "exclude_duplicate",
        "dependency_only",
    }
)
MANAGED_DOMAINS = (
    "auth",
    "storage",
    "realtime",
    "cron",
    "net",
    "vault",
    "supabase_prefixed",
    "extension_owned",
    "publication",
    "migration_history",
)
ENTRY_MANAGED_DOMAINS = frozenset({"none", *MANAGED_DOMAINS})
MANAGED_HANDLING = frozenset(
    {
        "restore",
        "exclude_supabase_managed",
        "manual_conflict",
        "not_present",
    }
)
GLOBAL_HANDLING = {
    "schema": frozenset({"selective_restore", "recreate_from_reviewed_source"}),
    "owner": frozenset({"strip_and_rebind", "precreate_exact_owner"}),
    "role": frozenset({"precreate_reviewed_roles", "exclude_source_roles"}),
    "extension": frozenset({"target_supported_only", "manual_conflict"}),
}
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

# ``SEQUENCE SET`` carries durable state even though the merged aggregate report
# does not include it in its externally bound data-reference count.  Preserve
# that count definition exactly while still requiring every state-bearing entry
# to bind to a compatible metadata object.
DATA_PARENT_CLASSES = {
    "BLOB DATA": frozenset({"BLOB", "BLOB METADATA"}),
    "LARGE OBJECT DATA": frozenset({"LARGE OBJECT"}),
    "MATERIALIZED VIEW DATA": frozenset({"MATERIALIZED VIEW"}),
    "SEQUENCE SET": frozenset({"SEQUENCE"}),
    "STATISTICS DATA": frozenset({"STATISTICS"}),
    "TABLE DATA": frozenset({"FOREIGN TABLE", "TABLE"}),
}
DATA_TOC_CLASSES = REPORT_DATA_TOC_CLASSES
METADATA_PARENT_REQUIRED_CLASSES = frozenset(DATA_PARENT_CLASSES)
CLASS_MANAGED_DOMAINS = {
    "PUBLICATION": "publication",
    "PUBLICATION TABLE": "publication",
    "PUBLICATION TABLES IN SCHEMA": "publication",
}
TABLE_ONLY = frozenset({"TABLE"})
TABLE_OR_FOREIGN = frozenset({"FOREIGN TABLE", "TABLE"})
RELATIONSHIP_PARENT_GROUPS = {
    "CHECK CONSTRAINT": (frozenset({"DOMAIN", "FOREIGN TABLE", "TABLE"}),),
    "CONSTRAINT": (frozenset({"DOMAIN", "FOREIGN TABLE", "TABLE"}),),
    "DEFAULT": (TABLE_OR_FOREIGN,),
    "FK CONSTRAINT": (TABLE_ONLY, TABLE_ONLY),
    "INDEX ATTACH": (frozenset({"INDEX"}), frozenset({"INDEX"})),
    "POLICY": (TABLE_ONLY,),
    "PUBLICATION TABLE": (frozenset({"PUBLICATION"}), TABLE_ONLY),
    "PUBLICATION TABLES IN SCHEMA": (
        frozenset({"PUBLICATION"}),
        frozenset({"SCHEMA"}),
    ),
    "ROW SECURITY": (TABLE_ONLY,),
    "SEQUENCE OWNED BY": (frozenset({"SEQUENCE"}), TABLE_ONLY),
    "TABLE ATTACH": (TABLE_ONLY, TABLE_OR_FOREIGN),
    "TRIGGER": (frozenset({"FOREIGN TABLE", "TABLE", "VIEW"}),),
}
RELATIONSHIP_REQUIRED_CLASSES = frozenset(RELATIONSHIP_PARENT_GROUPS)

CAPTURE_FILES = (
    "raw-pg-restore-list.toc",
    "opaque-id.key",
    "opaque-index.json",
    "capture.json",
    "evidence-files.json",
)
LEDGER_FILES = (
    "annotation-ledger.json",
    "classification-result.json",
    "evidence-files.json",
)

ENTRY_PREFIX_RE = re.compile(
    rb"^[ \t]*(?P<dump_id>[0-9]+);[ \t]+(?P<table_oid>[0-9]+)"
    rb"[ \t]+(?P<object_oid>[0-9]+)[ \t]+(?P<body>[^\r\n]+?)[ \t]*$"
)
KNOWN_CLASSES_BYTES = tuple(
    sorted(
        ((value.encode("ascii"), value) for value in KNOWN_TOC_CLASSES),
        key=lambda item: (-len(item[0]), item[1]),
    )
)

ERROR_CODES = frozenset(
    {
        "input_invalid",
        "input_mutated",
        "toc_malformed",
        "toc_unknown_class",
        "toc_duplicate_id",
        "tool_identity_mismatch",
        "tool_failed",
        "binding_mismatch",
        "ledger_schema_invalid",
        "entry_set_mismatch",
        "data_reference_unmapped",
        "manual_conflict_incomplete",
        "dependency_invalid",
        "managed_domain_invalid",
        "unresolved_present",
        "publication_exists",
        "publication_failed",
        "cleanup_indeterminate",
        "internal_failure",
    }
)
DIAGNOSTIC_COUNT_KEYS = {
    "capture": frozenset({"data_reference_count", "entry_count"}),
    "ledger": frozenset(
        {"data_reference_count", "entry_count", "unresolved_count"}
    ),
}
DIAGNOSTIC_HASH_KEYS = {
    "capture": frozenset({"capture_manifest_sha256", "raw_toc_sha256"}),
    "ledger": frozenset(
        {
            "ledger_procedure_identity_sha256",
            "ledger_sha256",
            "publication_manifest_sha256",
        }
    ),
}


class ContractError(RuntimeError):
    """A private failure reduced to one allowlisted public reason code."""

    def __init__(self, code: str):
        if code not in ERROR_CODES:
            code = "internal_failure"
        self.code = code
        super().__init__(code)


@dataclass(frozen=True)
class TocEntry:
    ordinal: int
    dump_id: int
    object_class: str
    is_data_reference: bool
    raw_line: bytes
    entry_id: str


@dataclass(frozen=True)
class StableFile:
    data: bytes
    sha256: str
    size: int
    device: int
    inode: int
    owner_uid: int
    owner_gid: int
    mode: int


@dataclass(frozen=True)
class PublicationResult:
    path: Path
    manifest_sha256: str


def _stable_stat_identity(metadata: os.stat_result) -> tuple[int, ...]:
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


def canonical_json_bytes(value: Any) -> bytes:
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


def _reject_constant(_: str) -> None:
    raise ContractError("ledger_schema_invalid")


def _reject_duplicate_pairs(pairs: Sequence[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ContractError("ledger_schema_invalid")
        result[key] = value
    return result


def strict_json_loads(data: bytes, *, max_bytes: int = MAX_LEDGER_BYTES) -> Any:
    if not data or len(data) > max_bytes:
        raise ContractError("ledger_schema_invalid")
    try:
        text = data.decode("utf-8", errors="strict")
    except UnicodeDecodeError as exc:
        raise ContractError("ledger_schema_invalid") from exc
    try:
        return json.loads(
            text,
            object_pairs_hook=_reject_duplicate_pairs,
            parse_constant=_reject_constant,
        )
    except ContractError:
        raise
    except (json.JSONDecodeError, RecursionError, ValueError) as exc:
        raise ContractError("ledger_schema_invalid") from exc


def require_exact_keys(value: Any, expected: set[str]) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != expected:
        raise ContractError("ledger_schema_invalid")
    return value


def require_string(value: Any, *, pattern: re.Pattern[str] | None = None) -> str:
    if type(value) is not str or not value or not value.isascii():
        raise ContractError("ledger_schema_invalid")
    if pattern is not None and pattern.fullmatch(value) is None:
        raise ContractError("ledger_schema_invalid")
    return value


def require_int(value: Any, *, minimum: int = 0, maximum: int = 2**63 - 1) -> int:
    if type(value) is not int or value < minimum or value > maximum:
        raise ContractError("ledger_schema_invalid")
    return value


def require_bool(value: Any) -> bool:
    if type(value) is not bool:
        raise ContractError("ledger_schema_invalid")
    return value


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def validate_sha(value: Any) -> str:
    return require_string(value, pattern=SHA256_RE)


def validate_git_sha(value: Any) -> str:
    return require_string(value, pattern=GIT_SHA_RE)


def opaque_entry_id(key: bytes, ordinal: int, raw_line: bytes) -> str:
    if len(key) != 32 or ordinal < 0:
        raise ContractError("internal_failure")
    framed = (
        OPAQUE_ID_DOMAIN
        + struct.pack(">Q", ordinal)
        + struct.pack(">Q", len(raw_line))
        + raw_line
    )
    return "te1_" + hmac.new(key, framed, hashlib.sha256).hexdigest()


def _validate_raw_line(raw_line: bytes) -> None:
    if not raw_line:
        raise ContractError("toc_malformed")
    # Horizontal tab is the only allowed ASCII control.  Names may contain
    # Unicode, punctuation, spaces, and quoting; those bytes remain opaque.
    if any(byte < 0x20 and byte != 0x09 for byte in raw_line) or 0x7F in raw_line:
        raise ContractError("toc_malformed")
    try:
        raw_line.decode("utf-8", errors="strict")
    except UnicodeDecodeError as exc:
        raise ContractError("toc_malformed") from exc


def _class_from_body(body: bytes) -> str:
    for class_bytes, class_name in KNOWN_CLASSES_BYTES:
        if body == class_bytes or (
            body.startswith(class_bytes) and body[len(class_bytes) : len(class_bytes) + 1] in {b" ", b"\t"}
        ):
            if body == class_bytes:
                raise ContractError("toc_malformed")
            return class_name
    raise ContractError("toc_unknown_class")


def parse_raw_toc(raw: bytes, key: bytes) -> list[TocEntry]:
    if not raw or len(raw) > MAX_RAW_TOC_BYTES:
        raise ContractError("input_invalid")
    if any(byte < 0x20 and byte not in {0x09, 0x0A} for byte in raw) or 0x7F in raw:
        raise ContractError("toc_malformed")
    try:
        raw.decode("utf-8", errors="strict")
    except UnicodeDecodeError as exc:
        raise ContractError("toc_malformed") from exc

    entries: list[TocEntry] = []
    seen_dump_ids: set[int] = set()
    for physical_line in raw.splitlines():
        if not physical_line or physical_line.startswith(b";"):
            continue
        _validate_raw_line(physical_line)
        match = ENTRY_PREFIX_RE.fullmatch(physical_line)
        if match is None:
            raise ContractError("toc_malformed")
        dump_id = int(match.group("dump_id"))
        if dump_id in seen_dump_ids:
            raise ContractError("toc_duplicate_id")
        seen_dump_ids.add(dump_id)
        body = match.group("body")
        object_class = _class_from_body(body)
        ordinal = len(entries)
        entries.append(
            TocEntry(
                ordinal=ordinal,
                dump_id=dump_id,
                object_class=object_class,
                is_data_reference=object_class in DATA_TOC_CLASSES,
                raw_line=physical_line,
                entry_id=opaque_entry_id(key, ordinal, physical_line),
            )
        )
        if len(entries) > MAX_ENTRY_COUNT:
            raise ContractError("input_invalid")
    if not entries:
        raise ContractError("toc_malformed")
    return entries


def stable_private_file(
    path: Path,
    *,
    max_bytes: int,
    exact_mode: int | None = 0o400,
    expected_uid: int | None = None,
    mutation_hook: Callable[[], None] | None = None,
) -> StableFile:
    owner_uid = os.geteuid() if expected_uid is None else expected_uid
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError as exc:
        raise ContractError("input_invalid") from exc
    try:
        before = os.fstat(descriptor)
        if (
            not stat.S_ISREG(before.st_mode)
            or before.st_uid != owner_uid
            or before.st_nlink != 1
            or before.st_size <= 0
            or before.st_size > max_bytes
            or (exact_mode is not None and stat.S_IMODE(before.st_mode) != exact_mode)
        ):
            raise ContractError("input_invalid")
        digest = hashlib.sha256()
        chunks: list[bytes] = []
        size = 0
        while True:
            chunk = os.read(descriptor, min(1024 * 1024, max_bytes + 1))
            if not chunk:
                break
            size += len(chunk)
            if size > max_bytes or size > before.st_size:
                raise ContractError("input_mutated")
            digest.update(chunk)
            chunks.append(chunk)
        if mutation_hook is not None:
            mutation_hook()
        after = os.fstat(descriptor)
        if (
            _stable_stat_identity(before) != _stable_stat_identity(after)
            or size != after.st_size
        ):
            raise ContractError("input_mutated")
        return StableFile(
            data=b"".join(chunks),
            sha256=digest.hexdigest(),
            size=size,
            device=after.st_dev,
            inode=after.st_ino,
            owner_uid=after.st_uid,
            owner_gid=after.st_gid,
            mode=stat.S_IMODE(after.st_mode),
        )
    finally:
        os.close(descriptor)


def stable_private_file_at(
    directory_fd: int,
    name: str,
    *,
    max_bytes: int,
    exact_mode: int = 0o400,
    expected_uid: int | None = None,
) -> StableFile:
    """Read one fixed private file relative to an already validated directory."""

    if SAFE_NAME_RE.fullmatch(name) is None and name not in {"EVIDENCE_COMPLETE"}:
        raise ContractError("input_invalid")
    owner_uid = os.geteuid() if expected_uid is None else expected_uid
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(name, flags, dir_fd=directory_fd)
    except OSError as exc:
        raise ContractError("input_invalid") from exc
    try:
        before = os.fstat(descriptor)
        if (
            not stat.S_ISREG(before.st_mode)
            or before.st_uid != owner_uid
            or before.st_nlink != 1
            or before.st_size <= 0
            or before.st_size > max_bytes
            or stat.S_IMODE(before.st_mode) != exact_mode
        ):
            raise ContractError("input_invalid")
        digest = hashlib.sha256()
        chunks: list[bytes] = []
        size = 0
        while True:
            chunk = os.read(descriptor, min(1024 * 1024, max_bytes + 1))
            if not chunk:
                break
            size += len(chunk)
            if size > max_bytes or size > before.st_size:
                raise ContractError("input_mutated")
            digest.update(chunk)
            chunks.append(chunk)
        after = os.fstat(descriptor)
        if (
            _stable_stat_identity(before) != _stable_stat_identity(after)
            or size != after.st_size
        ):
            raise ContractError("input_mutated")
        return StableFile(
            data=b"".join(chunks),
            sha256=digest.hexdigest(),
            size=size,
            device=after.st_dev,
            inode=after.st_ino,
            owner_uid=after.st_uid,
            owner_gid=after.st_gid,
            mode=stat.S_IMODE(after.st_mode),
        )
    finally:
        os.close(descriptor)


def stable_regular_digest(
    path: Path,
    *,
    max_bytes: int,
    require_executable: bool = False,
    exact_mode: int | None = None,
    expected_uid: int | None = None,
) -> StableFile:
    """Fingerprint a stable non-symlink regular file without retaining bytes."""

    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError as exc:
        raise ContractError("input_invalid") from exc
    try:
        before = os.fstat(descriptor)
        owner_uid = os.geteuid() if expected_uid is None else expected_uid
        if (
            not stat.S_ISREG(before.st_mode)
            or before.st_nlink != 1
            or before.st_size <= 0
            or before.st_size > max_bytes
            or (require_executable and not os.access(path, os.X_OK))
            or (exact_mode is not None and stat.S_IMODE(before.st_mode) != exact_mode)
            or (exact_mode is not None and before.st_uid != owner_uid)
        ):
            raise ContractError("input_invalid")
        digest = hashlib.sha256()
        size = 0
        while True:
            chunk = os.read(descriptor, min(1024 * 1024, max_bytes + 1))
            if not chunk:
                break
            size += len(chunk)
            if size > max_bytes or size > before.st_size:
                raise ContractError("input_mutated")
            digest.update(chunk)
        after = os.fstat(descriptor)
        if (
            _stable_stat_identity(before) != _stable_stat_identity(after)
            or size != after.st_size
        ):
            raise ContractError("input_mutated")
        return StableFile(
            data=b"",
            sha256=digest.hexdigest(),
            size=size,
            device=after.st_dev,
            inode=after.st_ino,
            owner_uid=after.st_uid,
            owner_gid=after.st_gid,
            mode=stat.S_IMODE(after.st_mode),
        )
    finally:
        os.close(descriptor)


def validate_private_root(path: Path, *, expected_uid: int | None = None) -> int:
    if not path.is_absolute():
        raise ContractError("input_invalid")
    lexical = Path(os.path.abspath(os.fspath(path)))
    try:
        resolved = path.resolve(strict=True)
    except OSError as exc:
        raise ContractError("input_invalid") from exc
    if lexical != resolved:
        raise ContractError("input_invalid")
    owner_uid = os.geteuid() if expected_uid is None else expected_uid
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError as exc:
        raise ContractError("input_invalid") from exc
    metadata = os.fstat(descriptor)
    if (
        not stat.S_ISDIR(metadata.st_mode)
        or metadata.st_uid != owner_uid
        or stat.S_IMODE(metadata.st_mode) != 0o700
    ):
        os.close(descriptor)
        raise ContractError("input_invalid")
    return descriptor


def duplicate_private_root_fd(
    directory_fd: int, *, expected_uid: int | None = None
) -> int:
    """Duplicate and validate an already-open private directory descriptor.

    This is the descriptor-relative counterpart to :func:`validate_private_root`.
    It deliberately accepts no pathname, so a caller that inherited a reviewed
    directory descriptor cannot be redirected by a later pathname replacement.
    The returned descriptor is owned by the caller.
    """

    if type(directory_fd) is not int or directory_fd < 0:
        raise ContractError("input_invalid")
    descriptor: int | None = None
    try:
        descriptor = os.dup(directory_fd)
        os.set_inheritable(descriptor, False)
    except OSError as exc:
        if descriptor is not None:
            os.close(descriptor)
        raise ContractError("input_invalid") from exc
    owner_uid = os.geteuid() if expected_uid is None else expected_uid
    try:
        metadata = os.fstat(descriptor)
        if (
            not stat.S_ISDIR(metadata.st_mode)
            or metadata.st_uid != owner_uid
            or stat.S_IMODE(metadata.st_mode) != 0o700
        ):
            raise ContractError("input_invalid")
        return descriptor
    except BaseException:
        os.close(descriptor)
        raise


def _write_exclusive(directory_fd: int, name: str, data: bytes) -> None:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(name, flags, 0o400, dir_fd=directory_fd)
    try:
        offset = 0
        while offset < len(data):
            written = os.write(descriptor, data[offset:])
            if written <= 0:
                raise ContractError("publication_failed")
            offset += written
        os.fsync(descriptor)
        os.fchmod(descriptor, 0o400)
    finally:
        os.close(descriptor)


def _open_private_directory_at(parent_fd: int, name: str) -> int:
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(name, flags, dir_fd=parent_fd)
    except OSError as exc:
        raise ContractError("publication_failed") from exc
    metadata = os.fstat(descriptor)
    if (
        not stat.S_ISDIR(metadata.st_mode)
        or metadata.st_uid != os.geteuid()
        or stat.S_IMODE(metadata.st_mode) != 0o700
    ):
        os.close(descriptor)
        raise ContractError("publication_failed")
    return descriptor


def _directory_names(directory_fd: int) -> set[str]:
    try:
        names = set(os.listdir(directory_fd))
    except (OSError, TypeError) as exc:
        raise ContractError("publication_failed") from exc
    if any(
        not name
        or name in {".", ".."}
        or "/" in name
        or "\\" in name
        or any(ord(character) < 0x20 or ord(character) == 0x7F for character in name)
        for name in names
    ):
        raise ContractError("publication_failed")
    return names


def _validate_published_files(directory_fd: int, expected: Mapping[str, bytes]) -> None:
    """Descriptor-bind one exact private package without relaying its contents."""

    try:
        if _directory_names(directory_fd) != set(expected):
            raise ContractError("publication_failed")
        for name in sorted(expected):
            content = expected[name]
            if not content:
                raise ContractError("publication_failed")
            observed = stable_private_file_at(
                directory_fd,
                name,
                max_bytes=len(content),
                exact_mode=0o400,
            )
            if (
                observed.size != len(content)
                or observed.sha256 != sha256_bytes(content)
                or not hmac.compare_digest(observed.data, content)
            ):
                raise ContractError("publication_failed")
        if _directory_names(directory_fd) != set(expected):
            raise ContractError("publication_failed")
    except ContractError as exc:
        if exc.code == "publication_failed":
            raise
        raise ContractError("publication_failed") from exc


def _unlink_tree_at(parent_fd: int, name: str) -> bool:
    """Remove one tree without following a member-controlled path or symlink."""

    try:
        metadata = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
    except FileNotFoundError:
        return True
    except OSError:
        return False
    try:
        if not stat.S_ISDIR(metadata.st_mode):
            os.unlink(name, dir_fd=parent_fd)
            return True
        flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
        flags |= getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
        directory_fd = os.open(name, flags, dir_fd=parent_fd)
        try:
            for child in os.listdir(directory_fd):
                if not _unlink_tree_at(directory_fd, child):
                    return False
        finally:
            os.close(directory_fd)
        os.rmdir(name, dir_fd=parent_fd)
        return True
    except OSError:
        return False


def _rename_no_replace(root_fd: int, old: str, new: str) -> None:
    if sys.platform == "darwin":
        libc = ctypes.CDLL(None, use_errno=True)
        function = libc.renameatx_np
        function.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
        function.restype = ctypes.c_int
        result = function(root_fd, os.fsencode(old), root_fd, os.fsencode(new), 0x00000004)
    elif sys.platform.startswith("linux"):
        libc = ctypes.CDLL(None, use_errno=True)
        function = libc.renameat2
        function.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
        function.restype = ctypes.c_int
        result = function(root_fd, os.fsencode(old), root_fd, os.fsencode(new), 1)
    else:
        raise ContractError("publication_failed")
    if result != 0:
        code = ctypes.get_errno()
        if code in {errno.EEXIST, errno.ENOTEMPTY}:
            raise ContractError("publication_exists")
        raise ContractError("publication_failed")


def _mark_indeterminate(root_fd: int, final_name: str, *, kind: str) -> bool:
    marker = canonical_json_bytes(
        {
            "diagnostic_version": DIAGNOSTIC_VERSION,
            "reason": "cleanup_indeterminate",
        }
    )
    # First make the expected final name visibly non-complete.  If that cannot
    # be proven, atomically quarantine the whole directory under a name that can
    # never be mistaken for a successful package.
    try:
        final_fd = _open_private_directory_at(root_fd, final_name)
        try:
            try:
                os.unlink("EVIDENCE_COMPLETE", dir_fd=final_fd)
            except FileNotFoundError:
                pass
            try:
                _write_exclusive(final_fd, "EVIDENCE_INDETERMINATE", marker)
            except FileExistsError:
                existing = stable_private_file_at(
                    final_fd,
                    "EVIDENCE_INDETERMINATE",
                    max_bytes=len(marker),
                    exact_mode=0o400,
                )
                if existing.data != marker:
                    raise ContractError("cleanup_indeterminate")
            os.fsync(final_fd)
            return True
        finally:
            os.close(final_fd)
    except (OSError, ContractError):
        pass

    quarantine_name = f".indeterminate-{kind}-{secrets.token_hex(12)}"
    try:
        _rename_no_replace(root_fd, final_name, quarantine_name)
        os.fsync(root_fd)
        return True
    except (ContractError, OSError):
        try:
            os.stat(final_name, dir_fd=root_fd, follow_symlinks=False)
        except FileNotFoundError:
            return True
        except OSError:
            return False
        return False


def _cleanup_failed_publication(
    root_fd: int,
    *,
    pending_name: str,
    pending_created: bool,
    final_name: str,
    kind: str,
    renamed: bool,
    cause: BaseException,
) -> None:
    if not renamed and not pending_created:
        return
    target = final_name if renamed else pending_name
    if _unlink_tree_at(root_fd, target):
        try:
            os.fsync(root_fd)
        except OSError as exc:
            raise ContractError("cleanup_indeterminate") from exc
        return
    if renamed and _mark_indeterminate(root_fd, final_name, kind=kind):
        raise ContractError("cleanup_indeterminate") from cause
    raise ContractError("cleanup_indeterminate") from cause


def _publish_private_package_on_open_root(
    root_fd: int,
    result_path: Path,
    final_name: str,
    files: Mapping[str, bytes],
    *,
    kind: str,
    fail_stage: str | None = None,
) -> PublicationResult:
    if SAFE_NAME_RE.fullmatch(final_name) is None:
        raise ContractError("input_invalid")
    if kind not in {"capture", "ledger"}:
        raise ContractError("internal_failure")
    pending_name = f".pending-{kind}-{secrets.token_hex(12)}"
    pending_created = False
    renamed = False
    try:
        try:
            os.mkdir(pending_name, 0o700, dir_fd=root_fd)
            pending_created = True
        except OSError as exc:
            raise ContractError("publication_failed") from exc
        pending_fd = _open_private_directory_at(root_fd, pending_name)
        try:
            expected_files = set(CAPTURE_FILES if kind == "capture" else LEDGER_FILES)
            if set(files) != expected_files - {"evidence-files.json"}:
                raise ContractError("publication_failed")
            evidence_files = {
                "artifact_kind": f"lovable_toc_{kind}_evidence",
                "format_version": 1,
                "files": [
                    {"name": name, "sha256": sha256_bytes(files[name]), "size_bytes": len(files[name])}
                    for name in sorted(files)
                ],
            }
            complete_files = dict(files)
            complete_files["evidence-files.json"] = canonical_json_bytes(evidence_files)
            for name in sorted(complete_files):
                if SAFE_NAME_RE.fullmatch(name) is None:
                    raise ContractError("publication_failed")
                _write_exclusive(pending_fd, name, complete_files[name])
            if fail_stage == "partial_write":
                raise ContractError("publication_failed")
            _validate_published_files(pending_fd, complete_files)
            os.fsync(pending_fd)
        finally:
            os.close(pending_fd)

        if fail_stage == "before_rename":
            raise ContractError("publication_failed")
        _rename_no_replace(root_fd, pending_name, final_name)
        renamed = True
        if fail_stage == "after_rename":
            raise ContractError("publication_failed")
        os.fsync(root_fd)

        final_fd = _open_private_directory_at(root_fd, final_name)
        try:
            _validate_published_files(final_fd, complete_files)
            manifest_bytes = complete_files["evidence-files.json"]
            marker = canonical_json_bytes(
                {
                    "artifact_kind": f"lovable_toc_{kind}_complete",
                    "evidence_files_sha256": sha256_bytes(manifest_bytes),
                    "format_version": 1,
                }
            )
            _write_exclusive(final_fd, "EVIDENCE_COMPLETE", marker)
            _validate_published_files(
                final_fd,
                {**complete_files, "EVIDENCE_COMPLETE": marker},
            )
            os.fsync(final_fd)
        finally:
            os.close(final_fd)
        if fail_stage == "after_complete":
            raise ContractError("publication_failed")
        os.fsync(root_fd)
        return PublicationResult(result_path, sha256_bytes(manifest_bytes))
    except ContractError as exc:
        _cleanup_failed_publication(
            root_fd,
            pending_name=pending_name,
            pending_created=pending_created,
            final_name=final_name,
            kind=kind,
            renamed=renamed,
            cause=exc,
        )
        raise
    except BaseException as exc:
        _cleanup_failed_publication(
            root_fd,
            pending_name=pending_name,
            pending_created=pending_created,
            final_name=final_name,
            kind=kind,
            renamed=renamed,
            cause=exc,
        )
        raise ContractError("publication_failed") from exc


def publish_private_package_at(
    root_fd: int,
    final_name: str,
    files: Mapping[str, bytes],
    *,
    kind: str,
    fail_stage: str | None = None,
) -> PublicationResult:
    """Publish beneath an already-open private root without resolving a path.

    The caller's descriptor remains open.  The returned ``path`` is deliberately
    relative and informational; descriptor-relative consumers must continue to
    use their held root descriptor for all validation and movement.
    """

    descriptor = duplicate_private_root_fd(root_fd)
    try:
        return _publish_private_package_on_open_root(
            descriptor,
            Path(final_name),
            final_name,
            files,
            kind=kind,
            fail_stage=fail_stage,
        )
    finally:
        os.close(descriptor)


def publish_private_package(
    root: Path,
    final_name: str,
    files: Mapping[str, bytes],
    *,
    kind: str,
    fail_stage: str | None = None,
) -> PublicationResult:
    """Path-based compatibility wrapper for standalone capture/ledger tools."""

    root_fd = validate_private_root(root)
    try:
        return _publish_private_package_on_open_root(
            root_fd,
            root / final_name,
            final_name,
            files,
            kind=kind,
            fail_stage=fail_stage,
        )
    finally:
        os.close(root_fd)


def build_capture_payloads(
    *,
    raw_toc: bytes,
    key: bytes,
    binding: Mapping[str, Any],
    execution_python_identity: Mapping[str, Any],
    pg_restore_identity: Mapping[str, Any],
    procedure_identity: Mapping[str, Any],
    expected_entry_count: int,
    expected_data_reference_count: int,
) -> tuple[dict[str, bytes], list[TocEntry], dict[str, Any]]:
    entries = parse_raw_toc(raw_toc, key)
    data_count = sum(entry.is_data_reference for entry in entries)
    if len(entries) != expected_entry_count or data_count != expected_data_reference_count:
        raise ContractError("binding_mismatch")

    index = {
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
        "format_version": CAPTURE_FORMAT_VERSION,
    }
    index_bytes = canonical_json_bytes(index)
    raw_sha = sha256_bytes(raw_toc)
    key_sha = sha256_bytes(key)
    procedure = dict(procedure_identity)
    if set(procedure) != CAPTURE_PROCEDURE_IDENTITY_KEYS:
        raise ContractError("binding_mismatch")
    if binding.get("procedure_identity_sha256") != sha256_bytes(
        canonical_json_bytes(procedure)
    ):
        raise ContractError("binding_mismatch")
    capture = {
        "artifact_kind": "lovable_toc_private_capture",
        "binding": dict(binding),
        "capture_status": "CAPTURE_COMPLETE",
        "data_reference_count": data_count,
        "entry_count": len(entries),
        "execution_python_identity": dict(execution_python_identity),
        "format_version": CAPTURE_FORMAT_VERSION,
        "opaque_index_sha256": sha256_bytes(index_bytes),
        "opaque_key_sha256": key_sha,
        "overall_status": "REVIEW_REQUIRED",
        "pg_restore_identity": dict(pg_restore_identity),
        "procedure_identity": procedure,
        "raw_toc_sha256": raw_sha,
        "raw_toc_size_bytes": len(raw_toc),
        "review_gate": "ANNOTATION_REQUIRED",
        "restore_command_gate": "BLOCKED",
        "restore_planning_gate": "BLOCKED",
    }
    capture_bytes = canonical_json_bytes(capture)
    files = {
        "raw-pg-restore-list.toc": raw_toc,
        "opaque-id.key": key,
        "opaque-index.json": index_bytes,
        "capture.json": capture_bytes,
    }
    return files, entries, capture


def validate_capture_schema(value: Any) -> dict[str, Any]:
    capture = require_exact_keys(
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
        capture["artifact_kind"] != "lovable_toc_private_capture"
        or capture["capture_status"] != "CAPTURE_COMPLETE"
        or capture["overall_status"] != "REVIEW_REQUIRED"
        or capture["review_gate"] != "ANNOTATION_REQUIRED"
        or capture["restore_command_gate"] != "BLOCKED"
        or capture["restore_planning_gate"] != "BLOCKED"
    ):
        raise ContractError("binding_mismatch")
    if require_int(
        capture["format_version"],
        minimum=CAPTURE_FORMAT_VERSION,
        maximum=CAPTURE_FORMAT_VERSION,
    ) != CAPTURE_FORMAT_VERSION:
        raise ContractError("binding_mismatch")
    require_int(capture["entry_count"], minimum=1, maximum=MAX_ENTRY_COUNT)
    require_int(capture["data_reference_count"], maximum=MAX_ENTRY_COUNT)
    require_int(capture["raw_toc_size_bytes"], minimum=1, maximum=MAX_RAW_TOC_BYTES)
    for key in ("opaque_index_sha256", "opaque_key_sha256", "raw_toc_sha256"):
        validate_sha(capture[key])
    binding = require_exact_keys(
        capture["binding"],
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
    validate_sha(binding["evidence_manifest_sha256"])
    require_string(binding["evidence_run_id"])
    validate_git_sha(binding["execution_checkout_sha"])
    validate_sha(binding["inner_archive_sha256"])
    validate_git_sha(binding["inspection_checkout_sha"])
    validate_sha(binding["inspection_procedure_sha256"])
    validate_sha(binding["outer_archive_sha256"])
    validate_sha(binding["procedure_identity_sha256"])
    execution_python_identity = require_exact_keys(
        capture["execution_python_identity"],
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
    approved_python_identity = require_string(
        execution_python_identity["approved_identity"]
    )
    if not approved_python_identity.startswith("sha256:"):
        raise ContractError("binding_mismatch")
    approved_python_sha256 = validate_sha(
        approved_python_identity.removeprefix("sha256:")
    )
    if validate_sha(execution_python_identity["sha256"]) != approved_python_sha256:
        raise ContractError("binding_mismatch")
    for key in ("device", "gid", "inode", "size_bytes", "uid"):
        require_int(execution_python_identity[key])
    require_string(
        execution_python_identity["mode"], pattern=re.compile(r"^[0-7]{4}$")
    )
    require_string(
        execution_python_identity["reported_version"],
        pattern=EXECUTION_PYTHON_VERSION_RE,
    )
    python_path = execution_python_identity["executable_path"]
    if (
        type(python_path) is not str
        or not python_path.startswith("/")
        or "\x00" in python_path
    ):
        raise ContractError("binding_mismatch")

    identity = require_exact_keys(
        capture["pg_restore_identity"],
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
    approved_identity = require_string(identity["approved_identity"])
    if not approved_identity.startswith("sha256:"):
        raise ContractError("binding_mismatch")
    validate_sha(approved_identity.removeprefix("sha256:"))
    validate_sha(identity["sha256"])
    for key in ("device", "gid", "inode", "size_bytes", "uid"):
        require_int(identity[key])
    require_string(identity["mode"], pattern=re.compile(r"^[0-7]{4}$"))
    require_string(identity["reported_version"], pattern=VERSION_RE)
    executable_path = identity["executable_path"]
    if type(executable_path) is not str or not executable_path.startswith("/") or "\x00" in executable_path:
        raise ContractError("binding_mismatch")
    procedure = require_exact_keys(
        capture["procedure_identity"], set(CAPTURE_PROCEDURE_IDENTITY_KEYS)
    )
    for key, value in procedure.items():
        if key.endswith("_blob_sha") or key in {
            "execution_checkout_sha",
            "inspection_checkout_sha",
        }:
            validate_git_sha(value)
        else:
            validate_sha(value)
    if procedure["execution_checkout_sha"] != binding["execution_checkout_sha"]:
        raise ContractError("binding_mismatch")
    if procedure["inspection_checkout_sha"] != binding["inspection_checkout_sha"]:
        raise ContractError("binding_mismatch")
    if (
        procedure["execution_python_approved_sha256"]
        != approved_python_sha256
        or procedure["execution_python_identity_sha256"]
        != sha256_bytes(canonical_json_bytes(execution_python_identity))
        or procedure["inspection_procedure_sha256"]
        != binding["inspection_procedure_sha256"]
        or procedure["evidence_manifest_sha256"]
        != binding["evidence_manifest_sha256"]
        or sha256_bytes(canonical_json_bytes(procedure))
        != binding["procedure_identity_sha256"]
    ):
        raise ContractError("binding_mismatch")
    return capture


def _validate_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        raise ContractError("ledger_schema_invalid")
    result: list[str] = []
    seen: set[str] = set()
    for item in value:
        entry_id = require_string(item, pattern=OPAQUE_ID_RE)
        if entry_id in seen:
            raise ContractError("dependency_invalid")
        seen.add(entry_id)
        result.append(entry_id)
    return result


def _detect_cycles(graph: Mapping[str, set[str]]) -> None:
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(node: str) -> None:
        if node in visited:
            return
        if node in visiting:
            raise ContractError("dependency_invalid")
        visiting.add(node)
        for target in graph[node]:
            visit(target)
        visiting.remove(node)
        visited.add(node)

    for node in graph:
        visit(node)


def _parents_cover_required_groups(
    parent_ids: Sequence[str],
    captured: Mapping[str, TocEntry],
    groups: Sequence[frozenset[str]],
) -> bool:
    """Match distinct opaque parent entries to every required class group."""

    def match(group_index: int, used: set[str]) -> bool:
        if group_index == len(groups):
            return True
        allowed = groups[group_index]
        for parent_id in parent_ids:
            if (
                parent_id not in used
                and parent_id in captured
                and captured[parent_id].object_class in allowed
            ):
                used.add(parent_id)
                if match(group_index + 1, used):
                    return True
                used.remove(parent_id)
        return False

    return match(0, set())


def _effective_disposition(annotation: Mapping[str, Any]) -> str:
    classification = annotation["classification"]
    if classification == "manual_conflict":
        disposition = annotation["manual_conflict_disposition"]
        if type(disposition) is not str or disposition not in FINAL_DISPOSITIONS:
            raise ContractError("manual_conflict_incomplete")
        return disposition
    return classification


def _required_managed_handling(effective_dispositions: set[str]) -> str:
    if effective_dispositions == {"restore"}:
        return "restore"
    if effective_dispositions == {"exclude_supabase_managed"}:
        return "exclude_supabase_managed"
    return "manual_conflict"


def validate_ledger(
    ledger: Any,
    *,
    capture: Mapping[str, Any],
    entries: Sequence[TocEntry],
    capture_manifest_sha256: str,
) -> dict[str, Any]:
    root = require_exact_keys(
        ledger,
        {
            "annotations",
            "artifact_kind",
            "capture_binding",
            "format_version",
            "global_handling",
            "managed_domain_handling",
        },
    )
    if root["artifact_kind"] != "lovable_toc_annotation_ledger":
        raise ContractError("ledger_schema_invalid")
    require_int(
        root["format_version"],
        minimum=LEDGER_FORMAT_VERSION,
        maximum=LEDGER_FORMAT_VERSION,
    )

    binding = require_exact_keys(
        root["capture_binding"],
        {
            "capture_manifest_sha256",
            "evidence_manifest_sha256",
            "evidence_run_id",
            "execution_checkout_sha",
            "inner_archive_sha256",
            "inspection_checkout_sha",
            "inspection_procedure_sha256",
            "outer_archive_sha256",
            "pg_restore_identity_sha256",
            "procedure_identity_sha256",
            "raw_toc_sha256",
            "raw_toc_size_bytes",
        },
    )
    expected_binding = capture["binding"]
    required_expected = {
        "evidence_manifest_sha256",
        "evidence_run_id",
        "execution_checkout_sha",
        "inner_archive_sha256",
        "inspection_checkout_sha",
        "inspection_procedure_sha256",
        "outer_archive_sha256",
        "procedure_identity_sha256",
    }
    if not isinstance(expected_binding, dict) or not required_expected.issubset(expected_binding):
        raise ContractError("binding_mismatch")
    expected_values = {
        "capture_manifest_sha256": capture_manifest_sha256,
        "evidence_manifest_sha256": expected_binding["evidence_manifest_sha256"],
        "evidence_run_id": expected_binding["evidence_run_id"],
        "execution_checkout_sha": expected_binding["execution_checkout_sha"],
        "inner_archive_sha256": expected_binding["inner_archive_sha256"],
        "inspection_checkout_sha": expected_binding["inspection_checkout_sha"],
        "inspection_procedure_sha256": expected_binding["inspection_procedure_sha256"],
        "outer_archive_sha256": expected_binding["outer_archive_sha256"],
        "pg_restore_identity_sha256": sha256_bytes(canonical_json_bytes(capture["pg_restore_identity"])),
        "procedure_identity_sha256": expected_binding["procedure_identity_sha256"],
        "raw_toc_sha256": capture["raw_toc_sha256"],
        "raw_toc_size_bytes": capture["raw_toc_size_bytes"],
    }
    if binding != expected_values:
        raise ContractError("binding_mismatch")

    global_handling = require_exact_keys(root["global_handling"], set(GLOBAL_HANDLING))
    for category, allowed in GLOBAL_HANDLING.items():
        if type(global_handling[category]) is not str or global_handling[category] not in allowed:
            raise ContractError("managed_domain_invalid")

    managed = require_exact_keys(root["managed_domain_handling"], set(MANAGED_DOMAINS))
    for domain in MANAGED_DOMAINS:
        if type(managed[domain]) is not str or managed[domain] not in MANAGED_HANDLING:
            raise ContractError("managed_domain_invalid")

    if not isinstance(root["annotations"], list):
        raise ContractError("ledger_schema_invalid")
    captured = {entry.entry_id: entry for entry in entries}
    annotations: dict[str, dict[str, Any]] = {}
    graph: dict[str, set[str]] = {}
    effective_dispositions: dict[str, str] = {}
    classification_counts: Counter[str] = Counter()
    managed_seen: Counter[str] = Counter()
    managed_effective: dict[str, set[str]] = {
        domain: set() for domain in MANAGED_DOMAINS
    }
    data_mapped = 0
    parent_required_mapped = 0
    for raw_annotation in root["annotations"]:
        annotation = require_exact_keys(
            raw_annotation,
            {
                "classification",
                "dependency_entry_ids",
                "dependency_review_complete",
                "entry_id",
                "managed_domain",
                "manual_conflict_disposition",
                "metadata_parent_entry_id",
                "parent_entry_ids",
            },
        )
        entry_id = require_string(annotation["entry_id"], pattern=OPAQUE_ID_RE)
        if entry_id in annotations:
            raise ContractError("entry_set_mismatch")
        classification = annotation["classification"]
        if type(classification) is not str or classification not in CLASSIFICATIONS:
            raise ContractError("ledger_schema_invalid")
        managed_domain = annotation["managed_domain"]
        if type(managed_domain) is not str or managed_domain not in ENTRY_MANAGED_DOMAINS:
            raise ContractError("managed_domain_invalid")
        if classification == "exclude_supabase_managed" and managed_domain == "none":
            raise ContractError("managed_domain_invalid")
        if managed_domain != "none" and classification not in {
            "exclude_supabase_managed",
            "manual_conflict",
            "unresolved",
        }:
            raise ContractError("managed_domain_invalid")
        disposition = annotation["manual_conflict_disposition"]
        if classification == "manual_conflict":
            if type(disposition) is not str or disposition not in FINAL_DISPOSITIONS:
                raise ContractError("manual_conflict_incomplete")
        elif disposition is not None:
            raise ContractError("ledger_schema_invalid")
        effective = _effective_disposition(annotation)
        if effective == "exclude_supabase_managed" and managed_domain == "none":
            raise ContractError("managed_domain_invalid")
        if require_bool(annotation["dependency_review_complete"]) is not True:
            raise ContractError("dependency_invalid")
        parents = _validate_string_list(annotation["parent_entry_ids"])
        dependencies = _validate_string_list(annotation["dependency_entry_ids"])
        if set(parents) & set(dependencies) or entry_id in parents or entry_id in dependencies:
            raise ContractError("dependency_invalid")
        metadata_parent = annotation["metadata_parent_entry_id"]
        if metadata_parent is not None:
            metadata_parent = require_string(metadata_parent, pattern=OPAQUE_ID_RE)
            if metadata_parent == entry_id:
                raise ContractError("dependency_invalid")
        annotations[entry_id] = annotation
        graph[entry_id] = set(parents) | set(dependencies)
        if metadata_parent is not None:
            graph[entry_id].add(metadata_parent)
        effective_dispositions[entry_id] = effective
        classification_counts[classification] += 1
        if managed_domain != "none":
            managed_seen[managed_domain] += 1
            managed_effective[managed_domain].add(effective)

    if set(annotations) != set(captured):
        raise ContractError("entry_set_mismatch")
    for entry_id, targets in graph.items():
        if not targets.issubset(captured):
            raise ContractError("dependency_invalid")
    _detect_cycles(graph)

    for entry_id, annotation in annotations.items():
        entry = captured[entry_id]
        required_domain = CLASS_MANAGED_DOMAINS.get(entry.object_class)
        if required_domain is not None and annotation["managed_domain"] != required_domain:
            raise ContractError("managed_domain_invalid")
        parent_groups = RELATIONSHIP_PARENT_GROUPS.get(entry.object_class)
        if parent_groups is not None and not _parents_cover_required_groups(
            annotation["parent_entry_ids"], captured, parent_groups
        ):
            raise ContractError("dependency_invalid")
        metadata_parent = annotation["metadata_parent_entry_id"]
        if entry.object_class in METADATA_PARENT_REQUIRED_CLASSES:
            allowed_parents = DATA_PARENT_CLASSES.get(entry.object_class)
            if (
                allowed_parents is None
                or metadata_parent is None
                or metadata_parent not in captured
                or captured[metadata_parent].object_class not in allowed_parents
            ):
                raise ContractError("data_reference_unmapped")
            if (
                effective_dispositions[entry_id] in {"restore", "dependency_only"}
                and effective_dispositions[metadata_parent]
                not in {"restore", "dependency_only"}
            ):
                raise ContractError("data_reference_unmapped")
            parent_required_mapped += 1
            if entry.is_data_reference:
                data_mapped += 1
        elif metadata_parent is not None:
            raise ContractError("data_reference_unmapped")

    # A dependency-only entry must be in the dependency closure of a retained
    # restore entry.  An unresolved root is provisionally retained so that an
    # incomplete ledger can still be published as BLOCKED for further review;
    # once all entries are resolved, only a restore root can justify it.
    dependency_roots = {
        entry_id
        for entry_id, disposition in effective_dispositions.items()
        if disposition in {"restore", "unresolved"}
    }
    required_by_retained = set(dependency_roots)
    pending = list(dependency_roots)
    while pending:
        source = pending.pop()
        for target in graph[source]:
            if (
                effective_dispositions[target]
                in {"restore", "dependency_only", "unresolved"}
                and target not in required_by_retained
            ):
                required_by_retained.add(target)
                pending.append(target)
    for entry_id, disposition in effective_dispositions.items():
        if disposition == "dependency_only" and entry_id not in required_by_retained:
            raise ContractError("dependency_invalid")

    for domain in MANAGED_DOMAINS:
        handling = managed[domain]
        if managed_seen[domain] == 0 and handling != "not_present":
            raise ContractError("managed_domain_invalid")
        if managed_seen[domain] > 0:
            expected_handling = _required_managed_handling(managed_effective[domain])
            if handling != expected_handling:
                raise ContractError("managed_domain_invalid")

    unresolved = classification_counts["unresolved"]
    eligible = unresolved == 0
    result = {
        "annotation_status": "COMPLETE" if eligible else "INCOMPLETE",
        "artifact_kind": "lovable_toc_classification_result",
        "classification_counts": {name: classification_counts[name] for name in sorted(CLASSIFICATIONS)},
        "data_reference_count": sum(entry.is_data_reference for entry in entries),
        "data_reference_mapped_count": data_mapped,
        "metadata_parent_mapped_count": parent_required_mapped,
        "metadata_parent_required_count": sum(
            entry.object_class in METADATA_PARENT_REQUIRED_CLASSES
            for entry in entries
        ),
        "entry_count": len(entries),
        "format_version": LEDGER_FORMAT_VERSION,
        "migration_readiness": "RED",
        "annotation_accounting_status": "COMPLETE" if eligible else "INCOMPLETE",
        # This validator proves opaque annotation accounting, not that a TOC
        # object's human-readable identity was parsed or independently verified.
        "object_reference_analysis": "INCOMPLETE",
        "restore_command_gate": "BLOCKED",
        "restore_planning_gate": "ELIGIBLE_FOR_HUMAN_REVIEW" if eligible else "BLOCKED",
        "unresolved_count": unresolved,
    }
    return result


def fixed_diagnostic(*, stage: str, status: str, reason: str, counts: Mapping[str, int] | None = None, hashes: Mapping[str, str] | None = None) -> bytes:
    if stage not in {"capture", "ledger"} or status not in {
        "complete",
        "failed",
        "review_required",
    }:
        raise ContractError("internal_failure")
    if status == "review_required" and reason != "blocked":
        status = "failed"
        reason = "internal_failure"
    elif status == "complete" and reason != "ok":
        status = "failed"
        reason = "internal_failure"
    elif status == "failed" and reason not in ERROR_CODES:
        reason = "internal_failure"
    if status in {"complete", "review_required"}:
        supplied_counts = dict(counts or {})
        supplied_hashes = dict(hashes or {})
        if (
            set(supplied_counts) != DIAGNOSTIC_COUNT_KEYS[stage]
            or set(supplied_hashes) != DIAGNOSTIC_HASH_KEYS[stage]
            or any(type(value) is not int or value < 0 for value in supplied_counts.values())
            or any(
                type(value) is not str or SHA256_RE.fullmatch(value) is None
                for value in supplied_hashes.values()
            )
        ):
            status = "failed"
            reason = "internal_failure"
            counts = None
            hashes = None
    record: dict[str, Any] = {
        "diagnostic_version": DIAGNOSTIC_VERSION,
        "stage": stage,
        "status": status,
        "reason": reason,
    }
    if status in {"complete", "review_required"}:
        record["counts"] = {key: counts[key] for key in sorted(counts or {})}
        record["hashes"] = {key: hashes[key] for key in sorted(hashes or {})}
    if status == "review_required":
        record["review_gate"] = "REVIEW_REQUIRED"
        record["restore_planning_gate"] = "BLOCKED"
    return canonical_json_bytes(record)


def emit_fixed_diagnostic(stream: object, payload: bytes) -> bool:
    """Best-effort one bounded diagnostic without changing workflow outcome.

    Capture completion and failure are already decided before this notification
    boundary.  A closed pipe, closed stream, or short write must therefore not
    raise, trigger a traceback, change an exit status, or cause a second message
    on the other channel.  Real file descriptors use unbuffered ``os.write`` so
    Python has no diagnostic bytes left to flush during interpreter shutdown;
    the write/flush fallback exists only for descriptor-less in-memory streams.

    The caller deliberately receives only a boolean and must not retry or relay
    any exception details.  Payload validation keeps this helper from becoming
    an arbitrary-output path.
    """

    if (
        type(payload) is not bytes
        or not payload
        or len(payload) > MAX_PUBLIC_DIAGNOSTIC_BYTES
        or not payload.endswith(b"\n")
    ):
        return False

    try:
        target = getattr(stream, "buffer", stream)
    except Exception:
        return False

    try:
        descriptor = target.fileno()
    except (
        AttributeError,
        OSError,
        OverflowError,
        RuntimeError,
        TypeError,
        ValueError,
    ):
        descriptor = None

    if descriptor is not None:
        if type(descriptor) is not int or descriptor < 0:
            return False
        offset = 0
        try:
            while offset < len(payload):
                written = os.write(descriptor, payload[offset:])
                if (
                    type(written) is not int
                    or written <= 0
                    or written > len(payload) - offset
                ):
                    return False
                offset += written
        except (
            BrokenPipeError,
            OSError,
            OverflowError,
            RuntimeError,
            TypeError,
            ValueError,
        ):
            return False
        return True

    offset = 0
    try:
        while offset < len(payload):
            written = target.write(payload[offset:])
            if (
                type(written) is not int
                or written <= 0
                or written > len(payload) - offset
            ):
                return False
            offset += written
        flush = getattr(target, "flush", None)
        if flush is not None:
            flush()
    except (
        AttributeError,
        BrokenPipeError,
        OSError,
        OverflowError,
        RuntimeError,
        TypeError,
        ValueError,
    ):
        return False
    return True


def fresh_opaque_key() -> bytes:
    return secrets.token_bytes(32)
