#!/usr/bin/env python3
"""Build a fail-closed, metadata-only Lovable export evidence package.

This driver is deliberately local-only.  It validates the externally approved
Git checkout and the operator-supplied timeline, captures the canonical outer
artifact into private working space, delegates ZIP/raw-PGDMP normalization to
``normalize-lovable-export.py``, and invokes the existing PGDMP inspector only
against the verified inner archive.  No database connection or restore mode is
implemented.

Reports and provenance remain under a hidden pending directory until every
hash and safety-boundary check succeeds, then a verified copy is durably
published under the approved evidence-store root.  A precommit failure removes
its private staging reservation and all derived bytes.  A postcommit validation
failure is persistently marked indeterminate instead of looking complete; an
existing run is never overwritten or deleted.
"""

from __future__ import annotations

import datetime as dt
import ctypes
import errno
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


INSPECTION_BASELINE_GIT_SHA = "c87a124602eb669b3ec5a3829610c6cb465d3e26"
PROCEDURE_ORIGIN_SHA = "e4eed4a21049d274738110710a468e265c2893d2"
WORKFLOW_LABEL = b"LOVABLE EXPORT EVIDENCE WORKFLOW"
HEX40 = re.compile(r"[0-9a-f]{40}")
HEX_OBJECT = re.compile(r"(?:[0-9a-f]{40}|[0-9a-f]{64})")
HEX64 = re.compile(r"[0-9a-f]{64}")
PROJECT_REF = re.compile(r"[a-z0-9]{20}")
RFC3339_UTC = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z")
PLACEHOLDER = re.compile(r"[<>]|placeholder|replace|todo|tbd", re.IGNORECASE)
REPORT_SHA = re.compile(r"^sha256: ([0-9a-f]{64})$", re.MULTILINE)
REPORT_ARCHIVE_VERSION = re.compile(
    r"^archive_format_version: ([0-9]+)\.([0-9]+)\.([0-9]+)$", re.MULTILINE
)
REPORT_ARCHIVE_VERSION_BYTES = re.compile(
    r"^archive_format_version_bytes: ([0-9]+),([0-9]+),([0-9]+)$",
    re.MULTILINE,
)
REPORT_INTEGER_WIDTH = re.compile(
    r"^archive_integer_width_bytes: ([0-9]+)$", re.MULTILINE
)
REPORT_OFFSET_WIDTH = re.compile(
    r"^archive_offset_width_bytes: ([0-9]+)$", re.MULTILINE
)
REPORT_FORMAT_CODE = re.compile(r"^archive_format_code: ([0-9]+)$", re.MULTILINE)
REPORT_HEADER_SHA = re.compile(
    r"^archive_header_bound_sha256: ([0-9a-f]{64})$", re.MULTILINE
)
REPORT_UNRESOLVED_KNOWN_TOC_ENTRIES = re.compile(
    r"^unresolved_known_toc_entries: (0|[1-9][0-9]*)$", re.MULTILINE
)
REPORT_OBJECT_REFERENCE_ANALYSIS = re.compile(
    r"^object_reference_analysis: (COMPLETE|INCOMPLETE)$", re.MULTILINE
)
REPORT_MIGRATION_DUPLICATE_ANALYSIS = re.compile(
    r"^migration_duplicate_analysis: (CONSERVATIVE|INCOMPLETE)$", re.MULTILINE
)
REPORT_RESTORE_PLANNING_GATE = re.compile(
    r"^restore_planning_gate: (BLOCKED)$", re.MULTILINE
)
REPORT_INSPECTION_STATUS = re.compile(
    r"^inspection_status: (REVIEW_REQUIRED)$", re.MULTILINE
)
REPORT_TOC_ENTRIES = re.compile(r"^toc_entries: (0|[1-9][0-9]*)$", re.MULTILINE)
SAFE_REPORTED_VERSION_VALUE_PATTERN = (
    r"(?:UNKNOWN_NOT_REPORTED|REDACTED_UNSAFE_OR_UNRECOGNIZED|"
    r"[0-9]{1,3}(?:\.[0-9]{1,3}){0,3}"
    r"(?:(?:beta|rc)[0-9]{1,3}|devel)?)"
)
REPORT_SOURCE_POSTGRES_VERSION = re.compile(
    rf"^source_postgresql_version: ({SAFE_REPORTED_VERSION_VALUE_PATTERN})$",
    re.MULTILINE | re.ASCII,
)
REPORT_SOURCE_PG_DUMP_VERSION = re.compile(
    rf"^source_pg_dump_version: ({SAFE_REPORTED_VERSION_VALUE_PATTERN})$",
    re.MULTILINE | re.ASCII,
)
UNRESOLVED_CLASS_COUNT_HEADER = "UNRESOLVED KNOWN TOC CLASS COUNTS"
UNRESOLVED_OBJECT_CLASS_ALLOWLIST = (
    "ACCESS METHOD",
    "ACL",
    "AGGREGATE",
    "BLOB",
    "BLOB DATA",
    "BLOB METADATA",
    "CAST",
    "CHECK CONSTRAINT",
    "COLLATION",
    "COMMENT",
    "CONSTRAINT",
    "CONVERSION",
    "DATABASE",
    "DATABASE PROPERTIES",
    "DEFAULT",
    "DEFAULT ACL",
    "DOMAIN",
    "DOMAIN CONSTRAINT",
    "EVENT TRIGGER",
    "EXTENSION",
    "FK CONSTRAINT",
    "FOREIGN DATA WRAPPER",
    "FOREIGN SERVER",
    "FOREIGN TABLE",
    "FUNCTION",
    "INDEX",
    "INDEX ATTACH",
    "LANGUAGE",
    "LARGE OBJECT",
    "LARGE OBJECT DATA",
    "MATERIALIZED VIEW",
    "MATERIALIZED VIEW DATA",
    "OPERATOR",
    "OPERATOR CLASS",
    "OPERATOR FAMILY",
    "POLICY",
    "PROCEDURE",
    "PROTOCOL",
    "PUBLICATION",
    "PUBLICATION TABLE",
    "PUBLICATION TABLES IN SCHEMA",
    "ROW SECURITY",
    "RULE",
    "SCHEMA",
    "SECURITY LABEL",
    "SEQUENCE",
    "SEQUENCE OWNED BY",
    "SEQUENCE SET",
    "SHELL TYPE",
    "STATISTICS",
    "STATISTICS DATA",
    "SUBSCRIPTION",
    "TABLE",
    "TABLE ATTACH",
    "TABLE DATA",
    "TABLESPACE",
    "TEXT SEARCH CONFIGURATION",
    "TEXT SEARCH DICTIONARY",
    "TEXT SEARCH PARSER",
    "TEXT SEARCH TEMPLATE",
    "TRANSFORM",
    "TRIGGER",
    "TYPE",
    "USER MAPPING",
    "VIEW",
)
INSPECTOR_STAGE_CODES = frozenset(
    {
        "input_validation_failed",
        "dependency_validation_failed",
        "workspace_setup_failed",
        "pg_restore_version_failed",
        "snapshot_copy_failed",
        "snapshot_permissions_failed",
        "snapshot_hash_before_failed",
        "pgdmp_header_failed",
        "pg_restore_list_rejected",
        "pg_restore_list_empty",
        "snapshot_hash_after_failed",
        "snapshot_identity_changed",
        "report_helper_failed",
        "report_publish_failed",
        "cleanup_failed",
        "internal_failure",
    }
)
REPORT_HELPER_FAILURE_REASONS = frozenset(
    {
        "unknown_toc_class",
        "unresolved_known_toc_entry",
        "malformed_toc",
        "duplicate_toc_id",
        "conflicting_source_version",
        "conflicting_pg_dump_version",
        "migration_metadata_unreadable",
        "other_nonzero",
    }
)
PG_RESTORE_LIST_FAILURE_REASONS = frozenset(
    {
        "unsupported_archive_version",
        "invalid_archive",
        "truncated_archive",
        "timeout",
        "output_cap",
        "other_nonzero",
    }
)
PG_RESTORE_VERSION_FAILURE_REASONS = frozenset(
    {"timeout", "output_cap", "invalid_output", "other_nonzero"}
)
INSPECTOR_STAGE_REASON_CODES = {
    "input_validation_failed": frozenset({"not_applicable"}),
    "dependency_validation_failed": frozenset({"not_applicable"}),
    "workspace_setup_failed": frozenset({"not_applicable"}),
    "pg_restore_version_failed": PG_RESTORE_VERSION_FAILURE_REASONS,
    "snapshot_copy_failed": frozenset({"not_applicable"}),
    "snapshot_permissions_failed": frozenset({"not_applicable"}),
    "snapshot_hash_before_failed": frozenset({"not_applicable"}),
    "pgdmp_header_failed": frozenset({"not_applicable", "invalid_output"}),
    "pg_restore_list_rejected": PG_RESTORE_LIST_FAILURE_REASONS,
    "pg_restore_list_empty": frozenset({"not_applicable"}),
    "snapshot_hash_after_failed": frozenset({"not_applicable"}),
    "snapshot_identity_changed": frozenset({"not_applicable"}),
    "report_helper_failed": REPORT_HELPER_FAILURE_REASONS,
    "report_publish_failed": frozenset({"not_applicable"}),
    "cleanup_failed": frozenset({"not_applicable"}),
    "internal_failure": frozenset(
        {"not_applicable", "invalid_output", "other_nonzero"}
    ),
}
INSPECTOR_FAILURE_REASONS = frozenset().union(
    *INSPECTOR_STAGE_REASON_CODES.values()
)
DRIVER_INSPECTOR_STAGE_CODES = INSPECTOR_STAGE_CODES | {
    "inspector_diagnostic_invalid"
}
MAX_INSPECTOR_DIAGNOSTIC_BYTES = 4096
MAX_OUTER_BYTES = 5_000_000_000
MIN_WORKSPACE_OVERHEAD_BYTES = 256 * 1024 * 1024
MAX_REPORT_BYTES = 128 * 1024 * 1024
PROVENANCE_FORMAT_VERSION = 6
DURABLE_EVIDENCE_DIRECTORY = "migration-inspection-evidence"


class WorkflowError(RuntimeError):
    """A fail-closed workflow condition."""


class InspectorStageError(WorkflowError):
    """A raw-inspector failure reduced to reviewed machine codes only."""

    def __init__(self, stage: str, reason: str):
        if stage == "inspector_diagnostic_invalid":
            reason = "other_nonzero"
        elif (
            stage not in INSPECTOR_STAGE_REASON_CODES
            or reason not in INSPECTOR_STAGE_REASON_CODES[stage]
        ):
            stage = "inspector_diagnostic_invalid"
            reason = "other_nonzero"
        self.stage = stage
        self.reason = reason
        super().__init__(stage)


@dataclass(frozen=True)
class TimelineEvent:
    value: str | None
    basis: str
    reason: str | None

    def as_json(self) -> dict[str, str | None]:
        result: dict[str, str | None] = {
            "value": self.value,
            "basis": self.basis,
        }
        if self.reason is not None:
            result["reason"] = self.reason
        return result


@dataclass
class BoundCanonical:
    """Descriptor-bound canonical artifact admitted by external identity."""

    root: Path
    root_fd: int
    path: Path
    file_fd: int
    root_device: int
    root_inode: int
    device: int
    inode: int
    owner_uid: int
    mode: int
    size: int
    observed_sha256: str

    def close(self) -> None:
        if self.file_fd >= 0:
            os.close(self.file_fd)
            self.file_fd = -1
        if self.root_fd >= 0:
            os.close(self.root_fd)
            self.root_fd = -1


@dataclass(frozen=True)
class PublicationExpectations:
    """Immutable live-runtime truth that durable evidence must reproduce."""

    run_id: str
    run_kind: str
    evidence_profile: str
    timeline_status: str
    timeline_sha256: str
    source_name: str
    source_ref: str
    configured_project_ref: str
    ui_export_object_name: str
    operator_identity: str
    preflight_identities: tuple[tuple[str, str], ...]
    approved_root: str
    owner_uid: int
    canonical_mode: str
    canonical_filename: str
    canonical_size_bytes: int
    canonical_sha256: str
    root_device: int
    root_inode: int
    canonical_device: int
    canonical_inode: int
    admitted_bound: BoundCanonical
    outer_format: str
    normalized_member_name: str | None
    envelope_metadata_sha256: str
    inner_size_bytes: int
    inner_sha256: str
    pgdmp_header_sha256: str
    report_sha256: str
    analysis_sha256: str


def required_environment(name: str) -> str:
    value = os.environ.get(name, "")
    if (
        not value
        or value.strip() != value
        or any(ord(character) < 32 or ord(character) == 127 for character in value)
    ):
        raise WorkflowError(f"{name} must be a non-empty single-line value")
    if PLACEHOLDER.search(value):
        raise WorkflowError(f"{name} still contains a placeholder")
    return value


def optional_environment(name: str) -> str:
    value = os.environ.get(name, "")
    if value != value.strip() or any(
        ord(character) < 32 or ord(character) == 127 for character in value
    ):
        raise WorkflowError(f"{name} must be empty or a trimmed single-line value")
    if value and PLACEHOLDER.search(value):
        raise WorkflowError(f"{name} still contains a placeholder")
    return value


def parse_timestamp(value: str, name: str) -> dt.datetime:
    if not RFC3339_UTC.fullmatch(value):
        raise WorkflowError(f"{name} must be second-precision RFC3339 UTC")
    try:
        parsed = dt.datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError as exc:
        raise WorkflowError(f"{name} is not a real UTC timestamp") from exc
    if parsed.strftime("%Y-%m-%dT%H:%M:%SZ") != value:
        raise WorkflowError(f"{name} is not a canonical UTC timestamp")
    return parsed


def structured_event(prefix: str) -> tuple[TimelineEvent, dt.datetime | None]:
    basis = required_environment(f"{prefix}_BASIS")
    value = optional_environment(f"{prefix}_AT_UTC")
    reason = optional_environment(f"{prefix}_REASON")
    if basis == "operator_observed":
        if not value:
            raise WorkflowError(
                f"{prefix}_AT_UTC is required when {prefix}_BASIS is operator_observed"
            )
        if reason:
            raise WorkflowError(
                f"{prefix}_REASON must be empty for an operator-observed event"
            )
        parsed = parse_timestamp(value, f"{prefix}_AT_UTC")
        return TimelineEvent(value, basis, None), parsed
    if basis == "not_observed":
        if value:
            raise WorkflowError(
                f"{prefix}_AT_UTC must be empty when {prefix}_BASIS is not_observed"
            )
        if not reason:
            raise WorkflowError(
                f"{prefix}_REASON is required when {prefix}_BASIS is not_observed"
            )
        return TimelineEvent(None, basis, reason), None
    raise WorkflowError(
        f"{prefix}_BASIS must be operator_observed or not_observed"
    )


def observed_event(name: str) -> tuple[TimelineEvent, dt.datetime]:
    value = required_environment(name)
    return TimelineEvent(value, "operator_observed", None), parse_timestamp(value, name)


def run_git(repo: Path, arguments: Iterable[str], *, check: bool = True) -> str:
    result = subprocess.run(
        ["git", *arguments],
        cwd=repo,
        check=False,
        capture_output=True,
        text=True,
    )
    if check and result.returncode != 0:
        raise WorkflowError(f"Git preflight failed: git {' '.join(arguments)}")
    return result.stdout.strip()


def git_success(repo: Path, arguments: Iterable[str]) -> bool:
    return (
        subprocess.run(
            ["git", *arguments],
            cwd=repo,
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        ).returncode
        == 0
    )


def extract_workflow_fence(readme: bytes) -> bytes:
    begin = b"<!-- BEGIN " + WORKFLOW_LABEL + b" -->\n"
    end = b"\n<!-- END " + WORKFLOW_LABEL + b" -->"
    if readme.count(begin) != 1 or readme.count(end) != 1:
        raise WorkflowError("workflow markers must each occur exactly once")
    start = readme.index(begin) + len(begin)
    finish = readme.index(end, start)
    fenced = readme[start:finish]
    if not fenced.startswith(b"```bash\n") or not fenced.endswith(b"\n```"):
        raise WorkflowError("workflow markers must contain exactly one Bash fence")
    return fenced


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fingerprint_descriptor(descriptor: int) -> tuple[int, str, os.stat_result]:
    """Hash one stable regular-file descriptor from byte zero."""

    digest = hashlib.sha256()
    size = 0
    initial = os.fstat(descriptor)
    if not stat.S_ISREG(initial.st_mode):
        raise WorkflowError("canonical export must be a regular file")
    os.lseek(descriptor, 0, os.SEEK_SET)
    while True:
        chunk = os.read(descriptor, 1024 * 1024)
        if not chunk:
            break
        size += len(chunk)
        if size > MAX_OUTER_BYTES or size > initial.st_size:
            raise WorkflowError("canonical export grew beyond its admitted byte length")
        digest.update(chunk)
    final = os.fstat(descriptor)
    os.lseek(descriptor, 0, os.SEEK_SET)
    identity_before = (initial.st_dev, initial.st_ino, initial.st_size)
    identity_after = (final.st_dev, final.st_ino, final.st_size)
    if identity_before != identity_after or size != final.st_size:
        raise WorkflowError("canonical export changed while it was fingerprinted")
    return size, digest.hexdigest(), final


def fingerprint_regular(path: Path) -> tuple[int, str]:
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_NONBLOCK", 0)
    flags |= getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError as exc:
        raise WorkflowError("artifact must be a readable non-symlink regular file") from exc
    try:
        size, digest, _ = fingerprint_descriptor(descriptor)
        return size, digest
    finally:
        os.close(descriptor)


def validate_private_directory(
    path: Path,
    *,
    expected_uid: int | None = None,
    label: str = "APPROVED_EVIDENCE_STORE_ROOT",
) -> int:
    """Open an owner-only real directory without following its final component."""

    owner = os.geteuid() if expected_uid is None else expected_uid
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError as exc:
        raise WorkflowError(
            f"{label} must be a real non-symlink directory"
        ) from exc
    metadata = os.fstat(descriptor)
    if not stat.S_ISDIR(metadata.st_mode):
        os.close(descriptor)
        raise WorkflowError(f"{label} must be a directory")
    if metadata.st_uid != owner:
        os.close(descriptor)
        raise WorkflowError(
            f"{label} must be owned by the executing user"
        )
    if stat.S_IMODE(metadata.st_mode) != 0o700:
        os.close(descriptor)
        raise WorkflowError(f"{label} must have mode 0700")
    return descriptor


def parse_expected_outer_size(value: str) -> int:
    if len(value) > 10 or not re.fullmatch(r"[1-9][0-9]*", value):
        raise WorkflowError("EXPECTED_OUTER_SIZE_BYTES must be a positive decimal integer")
    parsed = int(value)
    if parsed > MAX_OUTER_BYTES:
        raise WorkflowError("EXPECTED_OUTER_SIZE_BYTES exceeds the 5 GB inspection cap")
    return parsed


def validate_expected_filename(value: str) -> str:
    if (
        value in {".", ".."}
        or "/" in value
        or "\\" in value
        or re.match(r"^[A-Za-z]:", value)
        or any(ord(character) < 32 or ord(character) == 127 for character in value)
    ):
        raise WorkflowError("EXPECTED_ORIGINAL_FILENAME must be one safe basename")
    return value


def validate_canonical_metadata(metadata: os.stat_result, expected_uid: int) -> None:
    if not stat.S_ISREG(metadata.st_mode):
        raise WorkflowError("canonical export must be a regular file")
    if metadata.st_uid != expected_uid:
        raise WorkflowError("canonical export must be owned by the executing user")
    if stat.S_IMODE(metadata.st_mode) & 0o077:
        raise WorkflowError("canonical export must not be group/world accessible")
    if metadata.st_size <= 0:
        raise WorkflowError("canonical export is empty")
    if metadata.st_size > MAX_OUTER_BYTES:
        raise WorkflowError("canonical export exceeds the 5 GB inspection cap")


def validate_pg_restore_executable(raw_path: str) -> str:
    path = Path(raw_path)
    if not path.is_absolute():
        raise WorkflowError("PG_RESTORE_BIN must be an absolute local path")
    try:
        metadata = path.lstat()
    except OSError as exc:
        raise WorkflowError("PG_RESTORE_BIN is unavailable") from exc
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise WorkflowError("PG_RESTORE_BIN must be a non-symlink regular file")
    if not os.access(path, os.X_OK):
        raise WorkflowError("PG_RESTORE_BIN must be executable")
    return str(path)


def open_bound_canonical(
    canonical: Path,
    approved_root: Path,
    expected_filename: str,
    expected_size: int,
    expected_sha256: str,
    repo: Path,
    *,
    expected_uid: int | None = None,
) -> BoundCanonical:
    """Admit the canonical file through an owner-only directory descriptor."""

    if not approved_root.is_absolute():
        raise WorkflowError("APPROVED_EVIDENCE_STORE_ROOT must be absolute")
    root_lexical = Path(os.path.abspath(os.fspath(approved_root)))
    try:
        root_resolved = approved_root.resolve(strict=True)
    except OSError as exc:
        raise WorkflowError(
            "APPROVED_EVIDENCE_STORE_ROOT must be a real non-symlink directory"
        ) from exc
    if root_lexical != root_resolved:
        raise WorkflowError(
            "APPROVED_EVIDENCE_STORE_ROOT must not contain symlink components"
        )
    repo_resolved = repo.resolve(strict=True)
    if path_is_within(root_lexical, repo_resolved):
        raise WorkflowError(
            "APPROVED_EVIDENCE_STORE_ROOT must be outside the Git worktree"
        )

    root_fd = validate_private_directory(root_lexical, expected_uid=expected_uid)
    file_fd = -1
    try:
        canonical_lexical = Path(os.path.abspath(os.fspath(canonical)))
        if canonical_lexical.parent != root_lexical:
            raise WorkflowError(
                "CANONICAL_EXPORT must resolve directly beneath APPROVED_EVIDENCE_STORE_ROOT"
            )
        if canonical_lexical.name != expected_filename:
            raise WorkflowError(
                "canonical basename does not equal EXPECTED_ORIGINAL_FILENAME"
            )
        flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
        flags |= getattr(os, "O_NONBLOCK", 0)
        flags |= getattr(os, "O_NOFOLLOW", 0)
        try:
            file_fd = os.open(expected_filename, flags, dir_fd=root_fd)
        except OSError as exc:
            raise WorkflowError(
                "canonical export must be a readable non-symlink regular file"
            ) from exc
        metadata = os.fstat(file_fd)
        owner = os.geteuid() if expected_uid is None else expected_uid
        validate_canonical_metadata(metadata, owner)
        if metadata.st_size != expected_size:
            raise WorkflowError(
                "canonical byte size does not equal EXPECTED_OUTER_SIZE_BYTES"
            )
        observed_size, observed_sha, final = fingerprint_descriptor(file_fd)
        validate_canonical_metadata(final, owner)
        if observed_size != expected_size:
            raise WorkflowError(
                "canonical byte size does not equal EXPECTED_OUTER_SIZE_BYTES"
            )
        if observed_sha != expected_sha256:
            raise WorkflowError("canonical SHA-256 does not equal EXPECTED_OUTER_SHA256")
        root_metadata = validate_owned_private_directory_descriptor(
            root_fd,
            label="APPROVED_EVIDENCE_STORE_ROOT",
            expected_uid=owner,
        )
        return BoundCanonical(
            root=root_lexical,
            root_fd=root_fd,
            path=canonical_lexical,
            file_fd=file_fd,
            root_device=root_metadata.st_dev,
            root_inode=root_metadata.st_ino,
            device=final.st_dev,
            inode=final.st_ino,
            owner_uid=owner,
            mode=stat.S_IMODE(final.st_mode),
            size=observed_size,
            observed_sha256=observed_sha,
        )
    except Exception:
        if file_fd >= 0:
            os.close(file_fd)
        os.close(root_fd)
        raise


def verify_bound_canonical(bound: BoundCanonical) -> tuple[int, str]:
    """Verify both the admitted descriptor and its descriptor-relative name."""

    root_metadata = os.fstat(bound.root_fd)
    if (
        not stat.S_ISDIR(root_metadata.st_mode)
        or (root_metadata.st_dev, root_metadata.st_ino)
        != (bound.root_device, bound.root_inode)
        or root_metadata.st_uid != bound.owner_uid
        or stat.S_IMODE(root_metadata.st_mode) != 0o700
    ):
        raise WorkflowError("approved evidence store root changed during inspection")
    fresh_root_fd = validate_private_directory(
        bound.root,
        expected_uid=bound.owner_uid,
    )
    try:
        fresh_root = os.fstat(fresh_root_fd)
    finally:
        os.close(fresh_root_fd)
    if (fresh_root.st_dev, fresh_root.st_ino) != (
        bound.root_device,
        bound.root_inode,
    ):
        raise WorkflowError("approved evidence store root path was replaced")
    size, digest, metadata = fingerprint_descriptor(bound.file_fd)
    if (metadata.st_dev, metadata.st_ino) != (bound.device, bound.inode):
        raise WorkflowError("canonical export descriptor identity changed")
    validate_canonical_metadata(metadata, bound.owner_uid)
    if stat.S_IMODE(metadata.st_mode) != bound.mode:
        raise WorkflowError("canonical export mode changed during inspection")
    if (size, digest) != (bound.size, bound.observed_sha256):
        raise WorkflowError("canonical export changed from its admitted identity")
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        fresh_fd = os.open(bound.path.name, flags, dir_fd=bound.root_fd)
    except OSError as exc:
        raise WorkflowError("canonical export path changed during inspection") from exc
    try:
        fresh_size, fresh_digest, fresh = fingerprint_descriptor(fresh_fd)
    finally:
        os.close(fresh_fd)
    if (fresh.st_dev, fresh.st_ino) != (bound.device, bound.inode):
        raise WorkflowError("canonical export path was replaced during inspection")
    validate_canonical_metadata(fresh, bound.owner_uid)
    if stat.S_IMODE(fresh.st_mode) != bound.mode:
        raise WorkflowError("canonical export mode changed during inspection")
    if (size, digest) != (fresh_size, fresh_digest) or (
        fresh_size,
        fresh_digest,
    ) != (bound.size, bound.observed_sha256):
        raise WorkflowError("canonical export changed during inspection")
    return size, digest


def copy_descriptor_snapshot(
    source_fd: int,
    destination: Path,
    expected_sha: str,
    expected_size: int,
) -> int:
    partial = destination.with_name(destination.name + ".partial")
    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=False)
    output_fd = -1
    digest = hashlib.sha256()
    size = 0
    try:
        initial = os.fstat(source_fd)
        os.lseek(source_fd, 0, os.SEEK_SET)
        flags = (
            os.O_WRONLY
            | os.O_CREAT
            | os.O_EXCL
            | getattr(os, "O_CLOEXEC", 0)
            | getattr(os, "O_NOFOLLOW", 0)
        )
        output_fd = os.open(partial, flags, 0o600)
        while True:
            chunk = os.read(source_fd, 1024 * 1024)
            if not chunk:
                break
            next_size = size + len(chunk)
            if next_size > expected_size or next_size > MAX_OUTER_BYTES:
                raise WorkflowError("canonical export grew while its working copy was captured")
            size = next_size
            digest.update(chunk)
            view = memoryview(chunk)
            while view:
                written = os.write(output_fd, view)
                if written <= 0:
                    raise WorkflowError("could not capture the canonical export")
                view = view[written:]
        os.fchmod(output_fd, 0o400)
        os.fsync(output_fd)
        os.close(output_fd)
        output_fd = -1
        final = os.fstat(source_fd)
        os.lseek(source_fd, 0, os.SEEK_SET)
        if (
            size != expected_size
            or final.st_size != expected_size
            or (initial.st_dev, initial.st_ino, initial.st_size)
            != (final.st_dev, final.st_ino, final.st_size)
        ):
            raise WorkflowError("canonical export byte length changed during capture")
        if digest.hexdigest() != expected_sha:
            raise WorkflowError("canonical export changed while its working copy was captured")
        os.link(partial, destination, follow_symlinks=False)
        partial.unlink()
        directory_fd = os.open(destination.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
        return size
    except FileExistsError as exc:
        raise WorkflowError("working output already exists; refusing to overwrite it") from exc
    finally:
        if output_fd >= 0:
            os.close(output_fd)
        partial.unlink(missing_ok=True)


def copy_regular_snapshot(
    source: Path,
    destination: Path,
    expected_sha: str,
    expected_size: int,
) -> int:
    """Synthetic-test helper; production canonical capture holds a bound fd."""

    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(source, flags)
    except OSError as exc:
        raise WorkflowError("source must be a readable non-symlink regular file") from exc
    try:
        return copy_descriptor_snapshot(
            descriptor,
            destination,
            expected_sha,
            expected_size,
        )
    finally:
        os.close(descriptor)


def write_exclusive(path: Path, data: bytes, mode: int = 0o400) -> None:
    flags = (
        os.O_WRONLY
        | os.O_CREAT
        | os.O_EXCL
        | getattr(os, "O_CLOEXEC", 0)
        | getattr(os, "O_NOFOLLOW", 0)
    )
    descriptor = os.open(path, flags, 0o600)
    try:
        view = memoryview(data)
        while view:
            written = os.write(descriptor, view)
            if written <= 0:
                raise WorkflowError(f"could not write evidence file: {path.name}")
            view = view[written:]
        os.fchmod(descriptor, mode)
        os.fsync(descriptor)
    except Exception:
        os.close(descriptor)
        path.unlink(missing_ok=True)
        raise
    else:
        os.close(descriptor)


def remove_incomplete_run(run_root: Path, *, remover=shutil.rmtree) -> None:
    if not os.path.lexists(run_root):
        return
    try:
        remover(run_root)
    except FileNotFoundError:
        return
    except OSError as exc:
        raise WorkflowError("failed to remove incomplete evidence run") from exc
    if os.path.lexists(run_root):
        raise WorkflowError("failed to remove incomplete evidence run")


def atomic_rename_no_replace_at(
    directory_fd: int,
    source_name: str,
    destination_name: str,
) -> None:
    """Rename one descriptor-relative child without replacement."""

    library = ctypes.CDLL(None, use_errno=True)
    source_bytes = os.fsencode(source_name)
    destination_bytes = os.fsencode(destination_name)
    if sys.platform == "darwin":
        try:
            rename = library.renameatx_np
        except AttributeError as exc:
            raise WorkflowError(
                "platform lacks atomic no-replace evidence publication"
            ) from exc
        rename.argtypes = [
            ctypes.c_int,
            ctypes.c_char_p,
            ctypes.c_int,
            ctypes.c_char_p,
            ctypes.c_uint,
        ]
        rename.restype = ctypes.c_int
        result = rename(
            directory_fd,
            source_bytes,
            directory_fd,
            destination_bytes,
            0x00000004,
        )
    elif sys.platform.startswith("linux"):
        try:
            rename = library.renameat2
        except AttributeError as exc:
            raise WorkflowError(
                "platform lacks atomic no-replace evidence publication"
            ) from exc
        rename.argtypes = [
            ctypes.c_int,
            ctypes.c_char_p,
            ctypes.c_int,
            ctypes.c_char_p,
            ctypes.c_uint,
        ]
        rename.restype = ctypes.c_int
        result = rename(
            directory_fd,
            source_bytes,
            directory_fd,
            destination_bytes,
            0x00000001,
        )
    else:
        raise WorkflowError(
            "platform lacks atomic no-replace evidence publication"
        )

    if result == 0:
        return
    error_number = ctypes.get_errno()
    if error_number in {errno.EEXIST, errno.ENOTEMPTY}:
        raise WorkflowError(
            "evidence output already exists; refusing to overwrite it"
        )
    if error_number in {errno.ENOSYS, errno.EINVAL, errno.ENOTSUP}:
        raise WorkflowError(
            "platform lacks atomic no-replace evidence publication"
        )
    raise WorkflowError(
        f"atomic evidence publication failed: {os.strerror(error_number)}"
    )


CORE_EVIDENCE_FILES = {
    "archive/outer.expected.sha256",
    "archive/outer.workflow-observed.before.sha256",
    "archive/outer.workflow-observed.after.sha256",
    "inspection/rehearsal-metadata.txt",
    "inspection/report.sha256",
    "provenance.json",
    "provenance.sha256",
}
ALL_EVIDENCE_FILES = CORE_EVIDENCE_FILES | {
    "evidence-files.json",
    "evidence-files.sha256",
}
EVIDENCE_DIRECTORIES = {"archive", "inspection"}
COMPLETION_MARKER = "EVIDENCE_COMPLETE"
INDETERMINATE_MARKER = "EVIDENCE_INDETERMINATE"
EVIDENCE_MANIFEST_SELF_HASH_BOUNDARY = (
    "the detached evidence-files.sha256 binds this manifest; "
    "runtime publication verification also compares every copied file"
)
SUPPORT_REPORTED_BOUNDARY = [
    "export source completeness and point-in-time boundary",
    "maximum export size 5 GB",
    "one export generation per 24 hours",
    "Lovable UI export control to backend-project mapping",
]
PREFLIGHT_IDENTITY_KEYS = {
    "approved_execution_checkout_sha",
    "execution_checkout_sha",
    "procedure_origin_sha",
    "inspection_tool_git_sha",
    "inspection_baseline_git_sha",
    "procedure_readme_blob_sha",
    "execution_driver_blob_sha",
    "normalizer_blob_sha",
    "pg_restore_guard_blob_sha",
    "pgdmp_inspector_blob_sha",
    "report_helper_blob_sha",
    "supabase_config_blob_sha",
    "procedure_workflow_sha256",
    "execution_driver_sha256",
    "normalizer_sha256",
    "pg_restore_guard_sha256",
    "pgdmp_inspector_sha256",
    "report_helper_sha256",
    "supabase_config_sha256",
    "execution_python_executable",
    "execution_python_sha256",
    "execution_python_implementation",
    "execution_python_version",
}
PROVENANCE_ANALYSIS_KEYS = {
    "object_reference_analysis",
    "migration_duplicate_analysis",
    "restore_planning_gate",
    "unresolved_known_toc_entries",
    "unresolved_known_toc_class_counts",
}
PROVENANCE_TOP_LEVEL_KEYS = {
    "format_version",
    "artifact_kind",
    "inspection_status",
    "export_timeline_status",
    "run_id",
    "run_kind",
    "export_evidence_profile",
    *PREFLIGHT_IDENTITY_KEYS,
    *PROVENANCE_ANALYSIS_KEYS,
    "procedure_identity_boundary",
    "execution_tools",
    "lovable_source_project",
    "export_timeline",
    "evidence_store",
    "outer_artifact",
    "zip_envelope",
    "archive_member",
    "ui_member_binding",
    "inner_pgdmp",
    "operator_identity",
    "report",
    "durable_publication",
    "support_reported_not_independently_verified",
}


def _reject_duplicate_json_members(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    """Build one JSON object while rejecting duplicate members recursively."""

    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON member")
        result[key] = value
    return result


def load_evidence_contract_json(data: bytes, *, label: str) -> Any:
    """Load bounded evidence JSON without last-key-wins or nonfinite numbers."""

    try:
        text = data.decode("utf-8")
        return json.loads(
            text,
            object_pairs_hook=_reject_duplicate_json_members,
            parse_constant=lambda _value: (_ for _ in ()).throw(
                ValueError("nonfinite JSON number")
            ),
        )
    except (UnicodeError, json.JSONDecodeError, ValueError) as exc:
        raise WorkflowError(f"{label} is invalid") from exc


def require_exact_object_keys(value: Any, expected: set[str], *, label: str) -> dict[str, Any]:
    """Require one fixed-schema JSON object with no optional surprise keys."""

    if not isinstance(value, dict) or set(value) != expected:
        raise WorkflowError(f"{label} differs from the reviewed schema")
    return value


def require_nonnegative_json_integer(value: Any, *, label: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise WorkflowError(f"{label} must be a nonnegative JSON integer")
    return value


def require_matching_string(
    value: Any,
    pattern: re.Pattern[str],
    *,
    label: str,
) -> str:
    if not isinstance(value, str) or pattern.fullmatch(value) is None:
        raise WorkflowError(f"{label} is malformed")
    return value


def require_safe_nonempty_string(value: Any, *, label: str) -> str:
    if (
        not isinstance(value, str)
        or not value
        or value.strip() != value
        or any(ord(character) < 32 or ord(character) == 127 for character in value)
    ):
        raise WorkflowError(f"{label} is malformed")
    return value


def validate_file_identity_object(value: Any, *, label: str) -> None:
    identity = require_exact_object_keys(
        value,
        {"sha256", "size_bytes", "mode"},
        label=label,
    )
    if (
        not isinstance(identity["sha256"], str)
        or HEX64.fullmatch(identity["sha256"]) is None
        or identity["mode"] != "0400"
    ):
        raise WorkflowError(f"{label} contains an invalid file identity")
    require_nonnegative_json_integer(
        identity["size_bytes"],
        label=f"{label} size_bytes",
    )


def validate_evidence_manifest_schema(manifest: Any) -> dict[str, Any]:
    manifest_object = require_exact_object_keys(
        manifest,
        {
            "format_version",
            "artifact_kind",
            "run_id",
            "files",
            "self_hash_boundary",
        },
        label="evidence file manifest",
    )
    files = require_exact_object_keys(
        manifest_object["files"],
        set(CORE_EVIDENCE_FILES),
        label="evidence file manifest payload map",
    )
    for relative, identity in files.items():
        validate_file_identity_object(
            identity,
            label=f"evidence file manifest identity for {relative}",
        )
    if (
        not isinstance(manifest_object["format_version"], int)
        or isinstance(manifest_object["format_version"], bool)
        or manifest_object["format_version"] != 1
        or manifest_object["artifact_kind"]
        != "migration_inspection_evidence_file_manifest"
        or not isinstance(manifest_object["run_id"], str)
        or manifest_object["self_hash_boundary"]
        != EVIDENCE_MANIFEST_SELF_HASH_BOUNDARY
    ):
        raise WorkflowError("evidence file manifest differs from the reviewed contract")
    return manifest_object


def _require_nested_keys(parent: dict[str, Any], key: str, expected: set[str]) -> dict[str, Any]:
    return require_exact_object_keys(
        parent[key],
        expected,
        label=f"provenance {key}",
    )


def validate_provenance_schema(provenance: Any) -> dict[str, Any]:
    """Reject unknown or contradictory fields at every fixed provenance level."""

    root = require_exact_object_keys(
        provenance,
        PROVENANCE_TOP_LEVEL_KEYS,
        label="evidence provenance",
    )
    if (
        not isinstance(root["format_version"], int)
        or isinstance(root["format_version"], bool)
        or root["format_version"] != PROVENANCE_FORMAT_VERSION
        or root["artifact_kind"]
        != "lovable_cloud_export_inspection_provenance"
        or root["inspection_status"] != "REVIEW_REQUIRED"
        or not isinstance(root["export_timeline_status"], str)
        or root["export_timeline_status"] not in {"COMPLETE", "INCOMPLETE"}
        or not isinstance(root["run_kind"], str)
        or root["run_kind"] not in {"rehearsal", "final_cutover"}
        or not isinstance(root["export_evidence_profile"], str)
        or root["export_evidence_profile"]
        not in {"retained_rehearsal_missing_initiation", "future_rehearsal", "final_cutover"}
        or not isinstance(root["run_id"], str)
        or not root["run_id"]
    ):
        raise WorkflowError("evidence provenance has invalid fixed contract values")
    for key in (
        "approved_execution_checkout_sha",
        "execution_checkout_sha",
        "procedure_origin_sha",
        "inspection_tool_git_sha",
        "inspection_baseline_git_sha",
    ):
        require_matching_string(root[key], HEX40, label=f"provenance {key}")
    if (
        root["approved_execution_checkout_sha"]
        != root["execution_checkout_sha"]
        or root["inspection_tool_git_sha"] != root["execution_checkout_sha"]
        or root["procedure_origin_sha"] != PROCEDURE_ORIGIN_SHA
        or root["inspection_baseline_git_sha"] != INSPECTION_BASELINE_GIT_SHA
    ):
        raise WorkflowError("provenance Git identity bindings disagree")
    for key in (
        "procedure_readme_blob_sha",
        "execution_driver_blob_sha",
        "normalizer_blob_sha",
        "pg_restore_guard_blob_sha",
        "pgdmp_inspector_blob_sha",
        "report_helper_blob_sha",
        "supabase_config_blob_sha",
    ):
        require_matching_string(root[key], HEX_OBJECT, label=f"provenance {key}")
    for key in (
        "procedure_workflow_sha256",
        "execution_driver_sha256",
        "normalizer_sha256",
        "pg_restore_guard_sha256",
        "pgdmp_inspector_sha256",
        "report_helper_sha256",
        "supabase_config_sha256",
        "execution_python_sha256",
    ):
        require_matching_string(root[key], HEX64, label=f"provenance {key}")
    execution_python = require_safe_nonempty_string(
        root["execution_python_executable"],
        label="provenance execution_python_executable",
    )
    if not Path(execution_python).is_absolute():
        raise WorkflowError("provenance execution Python path is not absolute")
    require_matching_string(
        root["execution_python_implementation"],
        re.compile(r"[a-z][a-z0-9_]{0,31}", re.ASCII),
        label="provenance execution_python_implementation",
    )
    require_matching_string(
        root["execution_python_version"],
        re.compile(r"[0-9]{1,3}(?:\.[0-9]{1,3}){1,3}", re.ASCII),
        label="provenance execution_python_version",
    )
    procedure_boundary = _require_nested_keys(
        root,
        "procedure_identity_boundary",
        {
            "procedure_origin_sha_is_informational_only",
            "external_approval_proof",
            "inspector_identity",
            "historical_baseline_scope",
        },
    )
    if (
        procedure_boundary["procedure_origin_sha_is_informational_only"] is not True
        or procedure_boundary["external_approval_proof"]
        != "approved checkout must exactly equal execution checkout"
        or procedure_boundary["inspector_identity"]
        != "approved execution checkout plus exact Git blob and file SHA-256"
        or procedure_boundary["historical_baseline_scope"]
        != "unchanged supabase/migrations only"
    ):
        raise WorkflowError("provenance procedure identity boundary is contradictory")
    tools = _require_nested_keys(
        root,
        "execution_tools",
        {
            "driver",
            "envelope_normalizer",
            "bounded_pg_restore_guard",
            "pgdmp_inspector",
            "report_helper",
            "python_runtime",
        },
    )
    simple_tool_bindings = {
        "driver": (
            "scripts/migration/inspect-lovable-export.py",
            "execution_driver_blob_sha",
            "execution_driver_sha256",
        ),
        "envelope_normalizer": (
            "scripts/migration/normalize-lovable-export.py",
            "normalizer_blob_sha",
            "normalizer_sha256",
        ),
    }
    for key, (expected_path, blob_key, sha_key) in simple_tool_bindings.items():
        tool = require_exact_object_keys(
            tools[key],
            {"path", "git_blob_sha", "sha256"},
            label=f"provenance execution_tools.{key}",
        )
        if tool != {
            "path": expected_path,
            "git_blob_sha": root[blob_key],
            "sha256": root[sha_key],
        }:
            raise WorkflowError(f"provenance execution_tools.{key} binding disagrees")
    restore_guard = require_exact_object_keys(
        tools["bounded_pg_restore_guard"],
        {
            "path",
            "git_blob_sha",
            "sha256",
            "invoked_with_execution_python_isolated_mode",
        },
        label="provenance execution_tools.bounded_pg_restore_guard",
    )
    if (
        restore_guard["path"] != "scripts/migration/bounded-pg-restore.py"
        or restore_guard["git_blob_sha"] != root["pg_restore_guard_blob_sha"]
        or restore_guard["sha256"] != root["pg_restore_guard_sha256"]
        or restore_guard["invoked_with_execution_python_isolated_mode"] is not True
    ):
        raise WorkflowError("provenance pg_restore guard isolation claim is invalid")
    child_tool_bindings = {
        "pgdmp_inspector": (
            "scripts/migration/inspect-lovable-dump.sh",
            "pgdmp_inspector_blob_sha",
            "pgdmp_inspector_sha256",
        ),
        "report_helper": (
            "scripts/migration/lib/lovable_dump_report.py",
            "report_helper_blob_sha",
            "report_helper_sha256",
        ),
    }
    for key, (expected_path, blob_key, sha_key) in child_tool_bindings.items():
        child_tool = require_exact_object_keys(
            tools[key],
            {
                "path",
                "git_sha",
                "git_blob_sha",
                "sha256",
                "failure_diagnostic_format_version",
                "raw_failure_output_relayed",
            },
            label=f"provenance execution_tools.{key}",
        )
        if (
            child_tool["path"] != expected_path
            or child_tool["git_sha"] != root["inspection_tool_git_sha"]
            or child_tool["git_blob_sha"] != root[blob_key]
            or child_tool["sha256"] != root[sha_key]
            or child_tool["failure_diagnostic_format_version"] != 1
            or isinstance(child_tool["failure_diagnostic_format_version"], bool)
            or child_tool["raw_failure_output_relayed"] is not False
        ):
            raise WorkflowError(
                f"provenance execution_tools.{key} safety claim is invalid"
            )
    python_runtime = require_exact_object_keys(
        tools["python_runtime"],
        {
            "executable",
            "sha256",
            "implementation",
            "version",
            "isolated_mode_for_child_tools",
            "inherited_python_or_shell_startup_environment",
        },
        label="provenance execution_tools.python_runtime",
    )
    if (
        python_runtime["executable"] != root["execution_python_executable"]
        or python_runtime["sha256"] != root["execution_python_sha256"]
        or python_runtime["implementation"]
        != root["execution_python_implementation"]
        or python_runtime["version"] != root["execution_python_version"]
        or python_runtime["isolated_mode_for_child_tools"] is not True
        or python_runtime["inherited_python_or_shell_startup_environment"] is not False
    ):
        raise WorkflowError("provenance Python isolation claim is invalid")

    source = _require_nested_keys(
        root,
        "lovable_source_project",
        {"name", "ref", "repository_binding", "identity_boundary"},
    )
    repository_binding = require_exact_object_keys(
        source["repository_binding"],
        {"path", "declared_project_id", "git_blob_sha", "sha256", "exact_match"},
        label="provenance lovable_source_project.repository_binding",
    )
    require_safe_nonempty_string(
        source["name"], label="provenance lovable_source_project.name"
    )
    source_ref = require_matching_string(
        source["ref"], PROJECT_REF, label="provenance lovable_source_project.ref"
    )
    if (
        repository_binding["path"] != "supabase/config.toml"
        or repository_binding["declared_project_id"] != source_ref
        or repository_binding["git_blob_sha"] != root["supabase_config_blob_sha"]
        or repository_binding["sha256"] != root["supabase_config_sha256"]
        or repository_binding["exact_match"] is not True
        or source["identity_boundary"]
        != (
            "operator-observed UI identity plus exact approved-checkout config "
            "equality; Lovable's internal export mapping is not independently verifiable"
        )
    ):
        raise WorkflowError("provenance repository binding is not exact")
    timeline = _require_nested_keys(
        root,
        "export_timeline",
        {
            "initiated_at_utc",
            "completed_at_utc",
            "available_at_utc",
            "download_completed_at_utc",
            "time_inference_used",
        },
    )
    parsed_timeline: dict[str, dt.datetime | None] = {}
    for event_name in (
        "initiated_at_utc",
        "completed_at_utc",
        "available_at_utc",
        "download_completed_at_utc",
    ):
        event = timeline[event_name]
        if not isinstance(event, dict):
            raise WorkflowError(
                f"provenance export_timeline.{event_name} differs from the reviewed schema"
            )
        basis = event.get("basis")
        if basis == "operator_observed":
            if (
                set(event) != {"value", "basis"}
                or not isinstance(event.get("value"), str)
            ):
                raise WorkflowError(
                    f"provenance export_timeline.{event_name} differs from the reviewed schema"
                )
            parsed_timeline[event_name] = parse_timestamp(
                event["value"], f"provenance export_timeline.{event_name}.value"
            )
        elif basis == "not_observed":
            if (
                set(event) != {"value", "basis", "reason"}
                or event.get("value") is not None
                or not isinstance(event.get("reason"), str)
                or not event["reason"]
            ):
                raise WorkflowError(
                    f"provenance export_timeline.{event_name} differs from the reviewed schema"
                )
            require_safe_nonempty_string(
                event["reason"],
                label=f"provenance export_timeline.{event_name}.reason",
            )
            parsed_timeline[event_name] = None
        else:
            raise WorkflowError(
                f"provenance export_timeline.{event_name} differs from the reviewed schema"
            )
    expected_timeline_status = (
        "COMPLETE"
        if all(
            timeline[event_name]["basis"] == "operator_observed"
            for event_name in (
                "initiated_at_utc",
                "completed_at_utc",
                "available_at_utc",
                "download_completed_at_utc",
            )
        )
        else "INCOMPLETE"
    )
    if (
        timeline["time_inference_used"] is not False
        or root["export_timeline_status"] != expected_timeline_status
        or timeline["available_at_utc"]["basis"] != "operator_observed"
        or timeline["download_completed_at_utc"]["basis"] != "operator_observed"
    ):
        raise WorkflowError("provenance timeline status is contradictory")
    initiated_at = parsed_timeline["initiated_at_utc"]
    completed_at = parsed_timeline["completed_at_utc"]
    available_at = parsed_timeline["available_at_utc"]
    downloaded_at = parsed_timeline["download_completed_at_utc"]
    if (
        available_at is None
        or downloaded_at is None
        or available_at > downloaded_at
        or (initiated_at is not None and initiated_at > available_at)
        or (completed_at is not None and completed_at > available_at)
        or (
            initiated_at is not None
            and completed_at is not None
            and initiated_at > completed_at
        )
        or (
            root["export_evidence_profile"]
            == "retained_rehearsal_missing_initiation"
            and (
                timeline["initiated_at_utc"]["basis"] != "not_observed"
                or root["export_timeline_status"] != "INCOMPLETE"
            )
        )
        or (
            root["export_evidence_profile"] in {"future_rehearsal", "final_cutover"}
            and timeline["initiated_at_utc"]["basis"] != "operator_observed"
        )
    ):
        raise WorkflowError("provenance timeline ordering or profile is contradictory")

    evidence_store = _require_nested_keys(
        root,
        "evidence_store",
        {
            "approved_root",
            "root_owner_uid",
            "root_mode",
            "canonical_direct_child",
            "canonical_owner_uid",
            "canonical_mode",
            "volume_encryption",
            "durable_package_relative_path",
        },
    )
    require_nonnegative_json_integer(
        evidence_store["root_owner_uid"],
        label="provenance evidence_store.root_owner_uid",
    )
    require_nonnegative_json_integer(
        evidence_store["canonical_owner_uid"],
        label="provenance evidence_store.canonical_owner_uid",
    )
    approved_root = require_safe_nonempty_string(
        evidence_store["approved_root"],
        label="provenance evidence_store.approved_root",
    )
    if (
        not Path(approved_root).is_absolute()
        or evidence_store["root_owner_uid"]
        != evidence_store["canonical_owner_uid"]
        or evidence_store["root_mode"] != "0700"
        or evidence_store["canonical_direct_child"] is not True
        or not isinstance(evidence_store["canonical_mode"], str)
        or re.fullmatch(r"0[0-7]00", evidence_store["canonical_mode"]) is None
        or evidence_store["volume_encryption"]
        != "not_independently_verified_by_this_workflow"
        or evidence_store["durable_package_relative_path"]
        != f"{DURABLE_EVIDENCE_DIRECTORY}/{root['run_id']}"
    ):
        raise WorkflowError("provenance evidence-store boundary is contradictory")
    outer = _require_nested_keys(
        root,
        "outer_artifact",
        {
            "role",
            "ui_observed_export_object_name",
            "expected_identity",
            "workflow_observed_identity",
            "format",
            "normalizer_sha256",
            "checksum_files",
            "working_copy_retained_in_evidence",
        },
    )
    expected_identity = require_exact_object_keys(
        outer["expected_identity"],
        {"original_filename", "size_bytes", "sha256", "basis"},
        label="provenance outer_artifact.expected_identity",
    )
    require_nonnegative_json_integer(
        expected_identity["size_bytes"],
        label="provenance outer_artifact.expected_identity.size_bytes",
    )
    expected_filename = require_safe_nonempty_string(
        expected_identity["original_filename"],
        label="provenance outer_artifact.expected_identity.original_filename",
    )
    if Path(expected_filename).name != expected_filename:
        raise WorkflowError("provenance outer expected filename is unsafe")
    expected_outer_sha = require_matching_string(
        expected_identity["sha256"],
        HEX64,
        label="provenance outer_artifact.expected_identity.sha256",
    )
    observed_identity = require_exact_object_keys(
        outer["workflow_observed_identity"],
        {
            "original_filename",
            "size_bytes_before",
            "size_bytes_after",
            "sha256_before",
            "sha256_after",
        },
        label="provenance outer_artifact.workflow_observed_identity",
    )
    for key in ("size_bytes_before", "size_bytes_after"):
        require_nonnegative_json_integer(
            observed_identity[key],
            label=f"provenance outer_artifact.workflow_observed_identity.{key}",
        )
    normalizer_hashes = require_exact_object_keys(
        outer["normalizer_sha256"],
        {"before", "after"},
        label="provenance outer_artifact.normalizer_sha256",
    )
    checksum_files = require_exact_object_keys(
        outer["checksum_files"],
        {"expected", "workflow_observed_before", "workflow_observed_after"},
        label="provenance outer_artifact.checksum_files",
    )
    require_safe_nonempty_string(
        outer["ui_observed_export_object_name"],
        label="provenance outer_artifact.ui_observed_export_object_name",
    )
    if (
        outer["role"] != "canonical_download_envelope"
        or outer["working_copy_retained_in_evidence"] is not False
        or expected_identity["basis"]
        != "mandatory externally supplied runtime approval inputs"
        or observed_identity["original_filename"] != expected_filename
        or expected_identity["size_bytes"] <= 0
        or observed_identity["size_bytes_before"] != expected_identity["size_bytes"]
        or observed_identity["size_bytes_after"] != expected_identity["size_bytes"]
        or observed_identity["sha256_before"] != expected_outer_sha
        or observed_identity["sha256_after"] != expected_outer_sha
        or normalizer_hashes["before"] != expected_outer_sha
        or normalizer_hashes["after"] != expected_outer_sha
        or checksum_files
        != {
            "expected": "archive/outer.expected.sha256",
            "workflow_observed_before": (
                "archive/outer.workflow-observed.before.sha256"
            ),
            "workflow_observed_after": (
                "archive/outer.workflow-observed.after.sha256"
            ),
        }
    ):
        raise WorkflowError("provenance outer-artifact boundary is contradictory")

    zip_metadata = root["zip_envelope"]
    if zip_metadata is not None:
        zip_metadata = require_exact_object_keys(
            zip_metadata,
            {
                "archive_comment_length",
                "central_directory_offset",
                "central_directory_size",
                "entry_count",
                "zip64",
            },
            label="provenance zip_envelope",
        )
        for key in (
            "archive_comment_length",
            "central_directory_offset",
            "central_directory_size",
            "entry_count",
        ):
            require_nonnegative_json_integer(
                zip_metadata[key],
                label=f"provenance zip_envelope.{key}",
            )
        if (
            zip_metadata["archive_comment_length"] != 0
            or zip_metadata["entry_count"] != 1
            or zip_metadata["zip64"] is not False
        ):
            raise WorkflowError("provenance ZIP envelope contract is contradictory")
    member = root["archive_member"]
    if member is not None:
        member = require_exact_object_keys(
            member,
            {
                "compressed_size",
                "compression",
                "crc32",
                "external_attributes",
                "flags",
                "method",
                "name",
                "streamed_size",
                "uncompressed_size",
                "version_made_by",
                "version_needed",
            },
            label="provenance archive_member",
        )
        for key in (
            "compressed_size",
            "external_attributes",
            "flags",
            "method",
            "streamed_size",
            "uncompressed_size",
            "version_made_by",
            "version_needed",
        ):
            require_nonnegative_json_integer(
                member[key],
                label=f"provenance archive_member.{key}",
            )
        member_name = require_safe_nonempty_string(
            member["name"], label="provenance archive_member.name"
        )
        if (
            not member_name.isascii()
            or Path(member_name).name != member_name
            or not isinstance(member["crc32"], str)
            or re.fullmatch(r"[0-9a-f]{8}", member["crc32"]) is None
            or not isinstance(member["compression"], str)
            or member["compression"] not in {"stored", "deflate"}
            or (member["compression"], member["method"])
            not in {("stored", 0), ("deflate", 8)}
            or member["compressed_size"] <= 0
            or member["uncompressed_size"] <= 0
            or member["streamed_size"] != member["uncompressed_size"]
        ):
            raise WorkflowError("provenance ZIP member contract is contradictory")
    member_binding = _require_nested_keys(
        root,
        "ui_member_binding",
        {"status", "ui_observed_name", "normalized_member_name"},
    )
    if (
        member_binding["ui_observed_name"]
        != outer["ui_observed_export_object_name"]
    ):
        raise WorkflowError("provenance UI member binding disagrees")
    if zip_metadata is None:
        if (
            member is not None
            or outer["format"] != "postgresql_custom_archive"
            or member_binding["status"] != "not_applicable"
            or member_binding["normalized_member_name"] is not None
        ):
            raise WorkflowError("provenance direct-PGDMP envelope fields disagree")
    elif (
        member is None
        or outer["format"] != "zip"
        or member_binding["status"] != "exact_match"
        or member_binding["normalized_member_name"] != member["name"]
        or member_binding["ui_observed_name"] != member["name"]
    ):
        raise WorkflowError("provenance ZIP envelope fields disagree")
    inner = _require_nested_keys(
        root,
        "inner_pgdmp",
        {
            "role",
            "relationship_to_outer",
            "size_bytes",
            "sha256",
            "inspector_reported_sha256",
            "pgdmp_header",
            "pg_restore_list",
            "retained_in_evidence",
            "all_bytes_consumed_by_pg_restore_list",
        },
    )
    require_nonnegative_json_integer(
        inner["size_bytes"],
        label="provenance inner_pgdmp.size_bytes",
    )
    inner_sha = require_matching_string(
        inner["sha256"], HEX64, label="provenance inner_pgdmp.sha256"
    )
    pgdmp_header = require_exact_object_keys(
        inner["pgdmp_header"],
        {
            "archive_format_version_bytes",
            "integer_width_bytes",
            "offset_width_bytes",
            "archive_format_code",
            "bound_to_inner_sha256",
            "captured_before_pg_restore",
        },
        label="provenance inner_pgdmp.pgdmp_header",
    )
    pg_restore_list = require_exact_object_keys(
        inner["pg_restore_list"],
        {"compatibility", "failure_diagnostic", "raw_child_output_retained"},
        label="provenance inner_pgdmp.pg_restore_list",
    )
    version_bytes = pgdmp_header["archive_format_version_bytes"]
    if (
        inner["role"] != "verified_inspector_input"
        or inner["size_bytes"] <= 0
        or inner["inspector_reported_sha256"] != inner_sha
        or not isinstance(version_bytes, list)
        or len(version_bytes) != 3
        or any(
            not isinstance(value, int)
            or isinstance(value, bool)
            or not 0 <= value <= 255
            for value in version_bytes
        )
        or not isinstance(pgdmp_header["integer_width_bytes"], int)
        or isinstance(pgdmp_header["integer_width_bytes"], bool)
        or pgdmp_header["integer_width_bytes"] not in {4, 8}
        or not isinstance(pgdmp_header["offset_width_bytes"], int)
        or isinstance(pgdmp_header["offset_width_bytes"], bool)
        or pgdmp_header["offset_width_bytes"] not in {4, 8}
        or not isinstance(pgdmp_header["archive_format_code"], int)
        or pgdmp_header["archive_format_code"] != 1
        or isinstance(pgdmp_header["archive_format_code"], bool)
        or pgdmp_header["bound_to_inner_sha256"] != inner_sha
        or inner["retained_in_evidence"] is not False
        or inner["all_bytes_consumed_by_pg_restore_list"]
        != "not_independently_verifiable"
        or pgdmp_header["captured_before_pg_restore"] is not True
        or pg_restore_list["compatibility"] != "PASS"
        or pg_restore_list["failure_diagnostic"] is not None
        or pg_restore_list["raw_child_output_retained"] is not False
    ):
        raise WorkflowError("provenance inner-PGDMP boundary is contradictory")
    if zip_metadata is None:
        if (
            inner["relationship_to_outer"] != "byte_copy_of_direct_pgdmp"
            or inner_sha != expected_outer_sha
            or inner["size_bytes"] != expected_identity["size_bytes"]
        ):
            raise WorkflowError("provenance direct-PGDMP identity bindings disagree")
    elif (
        inner["relationship_to_outer"] != "derived_from_single_zip_member"
        or inner["size_bytes"] != member["uncompressed_size"]
        or inner["size_bytes"] != member["streamed_size"]
    ):
        raise WorkflowError("provenance ZIP inner identity bindings disagree")
    report = _require_nested_keys(
        root,
        "report",
        {"filename", "relative_path", "sha256", "checksum_file"},
    )
    require_matching_string(
        report["sha256"], HEX64, label="provenance report.sha256"
    )
    if report != {
        "filename": "rehearsal-metadata.txt",
        "relative_path": "inspection/rehearsal-metadata.txt",
        "sha256": report["sha256"],
        "checksum_file": "inspection/report.sha256",
    }:
        raise WorkflowError("provenance report binding is contradictory")
    require_safe_nonempty_string(
        root["operator_identity"], label="provenance operator_identity"
    )
    durable_publication = _require_nested_keys(
        root,
        "durable_publication",
        {
            "relative_directory",
            "file_manifest",
            "file_manifest_checksum",
            "completion_marker",
            "completion_marker_meaning",
            "publication_semantics",
        },
    )
    if (
        durable_publication["relative_directory"]
        != f"{DURABLE_EVIDENCE_DIRECTORY}/{root['run_id']}"
        or evidence_store["durable_package_relative_path"]
        != durable_publication["relative_directory"]
        or durable_publication["file_manifest"] != "evidence-files.json"
        or durable_publication["file_manifest_checksum"] != "evidence-files.sha256"
        or durable_publication["completion_marker"] != COMPLETION_MARKER
        or durable_publication["completion_marker_meaning"]
        != "evidence package bytes are complete; restore planning remains blocked"
        or durable_publication["publication_semantics"]
        != (
            "descriptor_bound_fsynced_payload_then_atomic_no_replace_"
            "postcommit_validation_then_completion_marker"
        )
    ):
        raise WorkflowError("provenance durable-publication boundary is contradictory")
    if root["support_reported_not_independently_verified"] != SUPPORT_REPORTED_BOUNDARY:
        raise WorkflowError(
            "provenance support boundary differs from the reviewed schema"
        )
    return root


def validate_provenance_payload_bindings(
    provenance: dict[str, Any],
    identities: dict[str, dict[str, int | str]],
    read_relative: Any,
) -> None:
    """Bind reviewed provenance claims to the retained package bytes."""

    outer_sha = provenance["outer_artifact"]["expected_identity"]["sha256"]
    for relative in (
        "archive/outer.expected.sha256",
        "archive/outer.workflow-observed.before.sha256",
        "archive/outer.workflow-observed.after.sha256",
    ):
        if read_relative(relative) != (outer_sha + "\n").encode("ascii"):
            raise WorkflowError("outer artifact checksum evidence disagrees")

    report_relative = "inspection/rehearsal-metadata.txt"
    report_bytes = read_relative(report_relative)
    report_sha = provenance["report"]["sha256"]
    if (
        identities[report_relative]["sha256"] != report_sha
        or read_relative("inspection/report.sha256")
        != (report_sha + "\n").encode("ascii")
    ):
        raise WorkflowError("provenance report identity disagrees with package bytes")
    try:
        report_text = report_bytes.decode("utf-8")
    except UnicodeError as exc:
        raise WorkflowError("inspection report is not valid UTF-8") from exc
    inner = provenance["inner_pgdmp"]
    reported_hashes = REPORT_SHA.findall(report_text)
    if len(reported_hashes) != 1 or reported_hashes[0] != inner["sha256"]:
        raise WorkflowError("inspection report inner identity disagrees")
    if f"size_bytes: {inner['size_bytes']}" not in report_text.splitlines():
        raise WorkflowError("inspection report inner size disagrees")
    if parse_report_header_metadata(report_text, inner["sha256"]) != inner["pgdmp_header"]:
        raise WorkflowError("inspection report PGDMP header binding disagrees")


def build_publication_expectations(
    *,
    run_id: str,
    run_kind: str,
    evidence_profile: str,
    timeline_status: str,
    timeline: dict[str, Any],
    source_name: str,
    source_ref: str,
    configured_project_ref: str,
    ui_export_object_name: str,
    operator_identity: str,
    identities: dict[str, str],
    bound: BoundCanonical,
    normalization: dict[str, Any],
    inner_size_bytes: int,
    inner_sha256: str,
    pgdmp_header: dict[str, Any],
    report_sha256: str,
    object_analysis: dict[str, Any],
) -> PublicationExpectations:
    """Freeze runtime truth before retained sidecars/provenance are constructed."""

    if set(identities) != PREFLIGHT_IDENTITY_KEYS:
        raise WorkflowError("publication runtime identities differ from the reviewed set")
    if source_ref != configured_project_ref:
        raise WorkflowError("publication runtime project binding disagrees")
    root_metadata = os.fstat(bound.root_fd)
    file_metadata = os.fstat(bound.file_fd)
    normalization = validate_normalization(
        normalization,
        bound.observed_sha256,
        bound.size,
    )
    outer_format = normalization["outer"]["format"]
    normalized_member_name = (
        normalization["member"]["name"]
        if normalization["envelope_kind"] == "zip"
        else None
    )
    envelope_projection = {
        "outer_format": outer_format,
        "zip_envelope": normalization["outer"].get("zip"),
        "archive_member": normalization.get("member"),
        "normalized_member_name": normalized_member_name,
    }
    envelope_bytes = json.dumps(
        envelope_projection,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    ).encode("ascii")
    if (
        root_metadata.st_uid != bound.owner_uid
        or file_metadata.st_uid != bound.owner_uid
    ):
        raise WorkflowError("publication runtime ownership binding disagrees")
    timeline_bytes = json.dumps(
        timeline,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    ).encode("ascii")
    header_bytes = json.dumps(
        pgdmp_header,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    ).encode("ascii")
    analysis_bytes = json.dumps(
        object_analysis,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    ).encode("ascii")
    if (
        outer_format not in {"zip", "postgresql_custom_archive"}
        or not isinstance(inner_size_bytes, int)
        or isinstance(inner_size_bytes, bool)
        or inner_size_bytes <= 0
        or HEX64.fullmatch(inner_sha256) is None
        or HEX64.fullmatch(report_sha256) is None
        or validate_provenance_object_analysis(object_analysis) != object_analysis
    ):
        raise WorkflowError("publication runtime inspection identity is invalid")
    return PublicationExpectations(
        run_id=run_id,
        run_kind=run_kind,
        evidence_profile=evidence_profile,
        timeline_status=timeline_status,
        timeline_sha256=sha256_bytes(timeline_bytes),
        source_name=source_name,
        source_ref=source_ref,
        configured_project_ref=configured_project_ref,
        ui_export_object_name=ui_export_object_name,
        operator_identity=operator_identity,
        preflight_identities=tuple(sorted(identities.items())),
        approved_root=str(bound.root),
        owner_uid=bound.owner_uid,
        canonical_mode=f"{bound.mode:04o}",
        canonical_filename=bound.path.name,
        canonical_size_bytes=bound.size,
        canonical_sha256=bound.observed_sha256,
        root_device=bound.root_device,
        root_inode=bound.root_inode,
        canonical_device=bound.device,
        canonical_inode=bound.inode,
        admitted_bound=bound,
        outer_format=outer_format,
        normalized_member_name=normalized_member_name,
        envelope_metadata_sha256=sha256_bytes(envelope_bytes),
        inner_size_bytes=inner_size_bytes,
        inner_sha256=inner_sha256,
        pgdmp_header_sha256=sha256_bytes(header_bytes),
        report_sha256=report_sha256,
        analysis_sha256=sha256_bytes(analysis_bytes),
    )


def validate_publication_runtime_bound(
    expectations: PublicationExpectations,
    bound: BoundCanonical,
) -> None:
    """Prove the immutable expectation still describes the admitted descriptor."""

    verify_bound_canonical(bound)
    if (
        expectations.approved_root != str(bound.root)
        or expectations.owner_uid != bound.owner_uid
        or expectations.canonical_mode != f"{bound.mode:04o}"
        or expectations.canonical_filename != bound.path.name
        or expectations.canonical_size_bytes != bound.size
        or expectations.canonical_sha256 != bound.observed_sha256
        or expectations.root_device != bound.root_device
        or expectations.root_inode != bound.root_inode
        or expectations.canonical_device != bound.device
        or expectations.canonical_inode != bound.inode
        or expectations.admitted_bound is not bound
    ):
        raise WorkflowError("publication expectation does not match canonical runtime truth")


def validate_provenance_against_publication_expectations(
    provenance: dict[str, Any],
    expectations: PublicationExpectations,
) -> None:
    """Reject coherent evidence substitution using independent runtime truth."""

    identities = dict(expectations.preflight_identities)
    if (
        set(identities) != PREFLIGHT_IDENTITY_KEYS
        or any(provenance[key] != value for key, value in identities.items())
    ):
        raise WorkflowError("provenance execution identity differs from runtime truth")
    timeline_bytes = json.dumps(
        provenance["export_timeline"],
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    ).encode("ascii")
    source = provenance["lovable_source_project"]
    repository_binding = source["repository_binding"]
    evidence_store = provenance["evidence_store"]
    outer = provenance["outer_artifact"]
    expected = outer["expected_identity"]
    observed = outer["workflow_observed_identity"]
    normalizer = outer["normalizer_sha256"]
    member_binding = provenance["ui_member_binding"]
    inner = provenance["inner_pgdmp"]
    header_bytes = json.dumps(
        inner["pgdmp_header"],
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    ).encode("ascii")
    analysis = {
        key: provenance[key] for key in PROVENANCE_ANALYSIS_KEYS
    }
    analysis_bytes = json.dumps(
        analysis,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    ).encode("ascii")
    envelope_projection = {
        "outer_format": outer["format"],
        "zip_envelope": provenance["zip_envelope"],
        "archive_member": provenance["archive_member"],
        "normalized_member_name": member_binding["normalized_member_name"],
    }
    envelope_bytes = json.dumps(
        envelope_projection,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    ).encode("ascii")
    if (
        provenance["run_id"] != expectations.run_id
        or provenance["run_kind"] != expectations.run_kind
        or provenance["export_evidence_profile"] != expectations.evidence_profile
        or provenance["export_timeline_status"] != expectations.timeline_status
        or sha256_bytes(timeline_bytes) != expectations.timeline_sha256
        or source["name"] != expectations.source_name
        or source["ref"] != expectations.source_ref
        or repository_binding["declared_project_id"]
        != expectations.configured_project_ref
        or outer["ui_observed_export_object_name"]
        != expectations.ui_export_object_name
        or member_binding["ui_observed_name"]
        != expectations.ui_export_object_name
        or provenance["operator_identity"] != expectations.operator_identity
        or evidence_store["approved_root"] != expectations.approved_root
        or evidence_store["root_owner_uid"] != expectations.owner_uid
        or evidence_store["canonical_owner_uid"] != expectations.owner_uid
        or evidence_store["canonical_mode"] != expectations.canonical_mode
        or expected["original_filename"] != expectations.canonical_filename
        or observed["original_filename"] != expectations.canonical_filename
        or expected["size_bytes"] != expectations.canonical_size_bytes
        or observed["size_bytes_before"] != expectations.canonical_size_bytes
        or observed["size_bytes_after"] != expectations.canonical_size_bytes
        or expected["sha256"] != expectations.canonical_sha256
        or observed["sha256_before"] != expectations.canonical_sha256
        or observed["sha256_after"] != expectations.canonical_sha256
        or normalizer["before"] != expectations.canonical_sha256
        or normalizer["after"] != expectations.canonical_sha256
        or outer["format"] != expectations.outer_format
        or member_binding["normalized_member_name"]
        != expectations.normalized_member_name
        or sha256_bytes(envelope_bytes) != expectations.envelope_metadata_sha256
        or inner["size_bytes"] != expectations.inner_size_bytes
        or inner["sha256"] != expectations.inner_sha256
        or inner["inspector_reported_sha256"] != expectations.inner_sha256
        or sha256_bytes(header_bytes) != expectations.pgdmp_header_sha256
        or provenance["report"]["sha256"] != expectations.report_sha256
        or sha256_bytes(analysis_bytes) != expectations.analysis_sha256
    ):
        raise WorkflowError("provenance publication binding differs from runtime truth")


def evidence_file_identity(path: Path) -> dict[str, int | str]:
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError as exc:
        raise WorkflowError(
            "evidence package file must be a readable non-symlink regular file"
        ) from exc
    try:
        initial = os.fstat(descriptor)
        if not stat.S_ISREG(initial.st_mode):
            raise WorkflowError("evidence package contains a non-regular file")
        if stat.S_IMODE(initial.st_mode) != 0o400:
            raise WorkflowError("evidence package file mode is not 0400")
        digest = hashlib.sha256()
        size = 0
        while True:
            chunk = os.read(descriptor, 1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > initial.st_size:
                raise WorkflowError("evidence package file grew while hashed")
            digest.update(chunk)
        final = os.fstat(descriptor)
        identity_before = (
            initial.st_dev,
            initial.st_ino,
            initial.st_size,
            initial.st_mtime_ns,
            initial.st_ctime_ns,
        )
        identity_after = (
            final.st_dev,
            final.st_ino,
            final.st_size,
            final.st_mtime_ns,
            final.st_ctime_ns,
        )
        if identity_before != identity_after or size != final.st_size:
            raise WorkflowError("evidence package file changed while hashed")
        return {
            "sha256": digest.hexdigest(),
            "size_bytes": size,
            "mode": "0400",
        }
    finally:
        os.close(descriptor)


def validate_owned_private_directory_descriptor(
    descriptor: int,
    *,
    label: str,
    expected_uid: int | None = None,
) -> os.stat_result:
    owner = os.geteuid() if expected_uid is None else expected_uid
    metadata = os.fstat(descriptor)
    if (
        not stat.S_ISDIR(metadata.st_mode)
        or metadata.st_uid != owner
        or stat.S_IMODE(metadata.st_mode) != 0o700
    ):
        raise WorkflowError(f"{label} must be an owner-only mode-0700 directory")
    return metadata


def open_private_directory_at(
    parent_fd: int,
    name: str,
    *,
    label: str,
    expected_uid: int | None = None,
) -> int:
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(name, flags, dir_fd=parent_fd)
    except OSError as exc:
        raise WorkflowError(f"{label} must be a real private directory") from exc
    try:
        validate_owned_private_directory_descriptor(
            descriptor,
            label=label,
            expected_uid=expected_uid,
        )
    except Exception:
        os.close(descriptor)
        raise
    return descriptor


def descriptor_entry_names(descriptor: int) -> set[str]:
    duplicate = os.dup(descriptor)
    try:
        with os.scandir(duplicate) as entries:
            return {entry.name for entry in entries}
    finally:
        # scandir owns and normally closes the duplicate; tolerate that behavior.
        try:
            os.close(duplicate)
        except OSError:
            pass


def read_private_file_at(
    directory_fd: int,
    name: str,
    *,
    maximum_bytes: int = 8 * 1024 * 1024,
) -> bytes:
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(name, flags, dir_fd=directory_fd)
    except OSError as exc:
        raise WorkflowError("evidence file is unavailable through its bound directory") from exc
    try:
        initial = os.fstat(descriptor)
        if (
            not stat.S_ISREG(initial.st_mode)
            or initial.st_uid != os.geteuid()
            or stat.S_IMODE(initial.st_mode) != 0o400
            or initial.st_size > maximum_bytes
        ):
            raise WorkflowError("evidence file metadata differs from the reviewed contract")
        chunks: list[bytes] = []
        length = 0
        while True:
            chunk = os.read(descriptor, 1024 * 1024)
            if not chunk:
                break
            length += len(chunk)
            if length > maximum_bytes or length > initial.st_size:
                raise WorkflowError("evidence file exceeded its admitted byte length")
            chunks.append(chunk)
        final = os.fstat(descriptor)
        if (
            (initial.st_dev, initial.st_ino, initial.st_size, initial.st_mtime_ns, initial.st_ctime_ns)
            != (final.st_dev, final.st_ino, final.st_size, final.st_mtime_ns, final.st_ctime_ns)
            or length != final.st_size
        ):
            raise WorkflowError("evidence file changed while read")
        return b"".join(chunks)
    finally:
        os.close(descriptor)


def evidence_file_identity_at(
    directory_fd: int,
    name: str,
) -> dict[str, int | str]:
    maximum = MAX_REPORT_BYTES if name == "rehearsal-metadata.txt" else 8 * 1024 * 1024
    data = read_private_file_at(directory_fd, name, maximum_bytes=maximum)
    return {
        "sha256": sha256_bytes(data),
        "size_bytes": len(data),
        "mode": "0400",
    }


def validate_evidence_tree_at(
    root_fd: int,
    expected_run_id: str,
    *,
    require_completion_marker: bool = False,
    publication_expectations: PublicationExpectations | None = None,
) -> dict[str, dict[str, int | str]]:
    """Validate the fixed durable payload without resolving its parent path."""

    validate_owned_private_directory_descriptor(
        root_fd,
        label="durable evidence staging directory",
    )
    root_files = {name for name in ALL_EVIDENCE_FILES if "/" not in name}
    expected_root_entries = root_files | EVIDENCE_DIRECTORIES
    if require_completion_marker:
        expected_root_entries.add(COMPLETION_MARKER)
    if descriptor_entry_names(root_fd) != expected_root_entries:
        raise WorkflowError("durable evidence tree differs from the reviewed contract")

    directory_fds: dict[str, int] = {}
    try:
        for directory in sorted(EVIDENCE_DIRECTORIES):
            directory_fds[directory] = open_private_directory_at(
                root_fd,
                directory,
                label="durable evidence subdirectory",
            )
            expected_children = {
                relative.split("/", 1)[1]
                for relative in ALL_EVIDENCE_FILES
                if relative.startswith(directory + "/")
            }
            if descriptor_entry_names(directory_fds[directory]) != expected_children:
                raise WorkflowError(
                    "durable evidence tree differs from the reviewed contract"
                )

        identities: dict[str, dict[str, int | str]] = {}
        for relative in sorted(ALL_EVIDENCE_FILES):
            if "/" in relative:
                directory, name = relative.split("/", 1)
                descriptor = directory_fds[directory]
            else:
                name = relative
                descriptor = root_fd
            identities[relative] = evidence_file_identity_at(descriptor, name)

        manifest_bytes = read_private_file_at(root_fd, "evidence-files.json")
        manifest = validate_evidence_manifest_schema(
            load_evidence_contract_json(
                manifest_bytes,
                label="durable evidence manifest",
            )
        )
        if (
            manifest.get("run_id") != expected_run_id
            or manifest["files"]
            != {
                relative: identities[relative]
                for relative in sorted(CORE_EVIDENCE_FILES)
            }
        ):
            raise WorkflowError("durable evidence manifest does not bind its payload")
        detached = read_private_file_at(root_fd, "evidence-files.sha256")
        if detached != (sha256_bytes(manifest_bytes) + "\n").encode("ascii"):
            raise WorkflowError("durable evidence manifest detached SHA-256 does not match")
        report_sha = read_private_file_at(directory_fds["inspection"], "report.sha256")
        if report_sha != (identities["inspection/rehearsal-metadata.txt"]["sha256"] + "\n").encode("ascii"):
            raise WorkflowError("durable report detached SHA-256 does not match")
        provenance_sha = read_private_file_at(root_fd, "provenance.sha256")
        if provenance_sha != (identities["provenance.json"]["sha256"] + "\n").encode("ascii"):
            raise WorkflowError("durable provenance detached SHA-256 does not match")
        provenance = validate_provenance_schema(
            load_evidence_contract_json(
                read_private_file_at(root_fd, "provenance.json"),
                label="durable provenance",
            )
        )
        if (
            provenance.get("format_version") != PROVENANCE_FORMAT_VERSION
            or provenance.get("run_id") != expected_run_id
            or provenance.get("inspection_status") != "REVIEW_REQUIRED"
        ):
            raise WorkflowError("durable provenance run_id does not match its package")
        if publication_expectations is not None:
            validate_provenance_against_publication_expectations(
                provenance,
                publication_expectations,
            )

        def read_durable_relative(relative: str) -> bytes:
            if "/" in relative:
                directory, name = relative.split("/", 1)
                return read_private_file_at(
                    directory_fds[directory],
                    name,
                    maximum_bytes=(
                        MAX_REPORT_BYTES
                        if relative == "inspection/rehearsal-metadata.txt"
                        else 8 * 1024 * 1024
                    ),
                )
            return read_private_file_at(root_fd, relative)

        validate_provenance_payload_bindings(
            provenance,
            identities,
            read_durable_relative,
        )
        provenance_analysis = validate_provenance_object_analysis(provenance)
        try:
            report_analysis = parse_report_object_analysis(
                read_private_file_at(
                    directory_fds["inspection"],
                    "rehearsal-metadata.txt",
                    maximum_bytes=MAX_REPORT_BYTES,
                ).decode("utf-8")
            )
        except UnicodeError as exc:
            raise WorkflowError("durable inspection report is not valid UTF-8") from exc
        if report_analysis != provenance_analysis:
            raise WorkflowError(
                "durable inspection report and provenance analysis gates differ"
            )
        if require_completion_marker:
            validate_completion_marker_at(
                root_fd,
                expected_run_id,
                identities["evidence-files.json"]["sha256"],
            )
        return identities
    finally:
        for descriptor in directory_fds.values():
            os.close(descriptor)


def build_evidence_file_manifest(pending: Path, run_id: str) -> None:
    entries = {
        relative: evidence_file_identity(pending / relative)
        for relative in sorted(CORE_EVIDENCE_FILES)
    }
    manifest = {
        "format_version": 1,
        "artifact_kind": "migration_inspection_evidence_file_manifest",
        "run_id": run_id,
        "files": entries,
        "self_hash_boundary": EVIDENCE_MANIFEST_SELF_HASH_BOUNDARY,
    }
    manifest_bytes = (json.dumps(manifest, indent=2, sort_keys=True) + "\n").encode(
        "utf-8"
    )
    manifest_path = pending / "evidence-files.json"
    write_exclusive(manifest_path, manifest_bytes)
    write_exclusive(
        pending / "evidence-files.sha256",
        (sha256_bytes(manifest_bytes) + "\n").encode("ascii"),
    )


def validate_evidence_tree(
    pending: Path,
    expected_run_id: str,
    *,
    publication_expectations: PublicationExpectations | None = None,
) -> dict[str, dict[str, int | str]]:
    root_metadata = pending.lstat()
    if (
        not stat.S_ISDIR(root_metadata.st_mode)
        or stat.S_IMODE(root_metadata.st_mode) != 0o700
    ):
        raise WorkflowError("evidence package root must be a mode-0700 real directory")
    actual_directories: set[str] = set()
    actual_files: set[str] = set()
    for child in pending.rglob("*"):
        relative = child.relative_to(pending).as_posix()
        metadata = child.lstat()
        if stat.S_ISDIR(metadata.st_mode):
            if stat.S_IMODE(metadata.st_mode) != 0o700:
                raise WorkflowError("evidence package directory mode is not 0700")
            actual_directories.add(relative)
        elif stat.S_ISREG(metadata.st_mode):
            if stat.S_IMODE(metadata.st_mode) != 0o400:
                raise WorkflowError("evidence package file mode is not 0400")
            actual_files.add(relative)
        else:
            raise WorkflowError("evidence package contains a non-regular object")
    if actual_directories != EVIDENCE_DIRECTORIES or actual_files != ALL_EVIDENCE_FILES:
        raise WorkflowError("evidence package tree differs from the reviewed contract")

    identities = {
        relative: evidence_file_identity(pending / relative)
        for relative in sorted(ALL_EVIDENCE_FILES)
    }
    manifest_path = pending / "evidence-files.json"
    manifest = validate_evidence_manifest_schema(
        load_evidence_contract_json(
            manifest_path.read_bytes(),
            label="evidence file manifest",
        )
    )
    if (
        manifest.get("run_id") != expected_run_id
    ):
        raise WorkflowError("evidence file manifest differs from the reviewed contract")
    if manifest["files"] != {
        relative: identities[relative] for relative in sorted(CORE_EVIDENCE_FILES)
    }:
        raise WorkflowError("evidence file manifest does not bind the package files")
    detached = (pending / "evidence-files.sha256").read_text(encoding="ascii")
    if detached != identities["evidence-files.json"]["sha256"] + "\n":
        raise WorkflowError("evidence file manifest detached SHA-256 does not match")
    if (pending / "inspection/report.sha256").read_text(encoding="ascii") != (
        identities["inspection/rehearsal-metadata.txt"]["sha256"] + "\n"
    ):
        raise WorkflowError("report detached SHA-256 does not match")
    if (pending / "provenance.sha256").read_text(encoding="ascii") != (
        identities["provenance.json"]["sha256"] + "\n"
    ):
        raise WorkflowError("provenance detached SHA-256 does not match")
    provenance = validate_provenance_schema(
        load_evidence_contract_json(
            (pending / "provenance.json").read_bytes(),
            label="provenance",
        )
    )
    if (
        provenance.get("format_version") != PROVENANCE_FORMAT_VERSION
        or provenance.get("run_id") != expected_run_id
        or provenance.get("inspection_status") != "REVIEW_REQUIRED"
    ):
        raise WorkflowError("provenance run_id does not match its package")
    if publication_expectations is not None:
        validate_provenance_against_publication_expectations(
            provenance,
            publication_expectations,
        )
    validate_provenance_payload_bindings(
        provenance,
        identities,
        lambda relative: (pending / relative).read_bytes(),
    )
    provenance_analysis = validate_provenance_object_analysis(provenance)
    try:
        report_analysis = parse_report_object_analysis(
            (pending / "inspection/rehearsal-metadata.txt").read_text(
                encoding="utf-8"
            )
        )
    except UnicodeError as exc:
        raise WorkflowError("inspection report is not valid UTF-8") from exc
    if report_analysis != provenance_analysis:
        raise WorkflowError("inspection report and provenance analysis gates differ")
    return identities


def copy_private_file_at(
    source: Path,
    destination_directory_fd: int,
    destination_name: str,
) -> dict[str, int | str]:
    """Copy one private source to a fixed name beneath a held directory."""

    source_fd = os.open(
        source,
        os.O_RDONLY
        | getattr(os, "O_CLOEXEC", 0)
        | getattr(os, "O_NONBLOCK", 0)
        | getattr(os, "O_NOFOLLOW", 0),
    )
    destination_fd = -1
    try:
        source_metadata = os.fstat(source_fd)
        if (
            not stat.S_ISREG(source_metadata.st_mode)
            or source_metadata.st_uid != os.geteuid()
            or stat.S_IMODE(source_metadata.st_mode) != 0o400
        ):
            raise WorkflowError("publication source must be an owned mode-0400 regular file")
        destination_fd = os.open(
            destination_name,
            os.O_WRONLY
            | os.O_CREAT
            | os.O_EXCL
            | getattr(os, "O_CLOEXEC", 0)
            | getattr(os, "O_NOFOLLOW", 0),
            0o600,
            dir_fd=destination_directory_fd,
        )
        digest = hashlib.sha256()
        size = 0
        while True:
            chunk = os.read(source_fd, 1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > source_metadata.st_size:
                raise WorkflowError("publication source grew while copied")
            digest.update(chunk)
            view = memoryview(chunk)
            while view:
                written = os.write(destination_fd, view)
                if written <= 0:
                    raise WorkflowError("durable evidence copy made no progress")
                view = view[written:]
        os.fchmod(destination_fd, 0o400)
        os.fsync(destination_fd)
        final_source = os.fstat(source_fd)
        final_destination = os.fstat(destination_fd)
        if (
            (
                source_metadata.st_dev,
                source_metadata.st_ino,
                source_metadata.st_size,
                source_metadata.st_mtime_ns,
                source_metadata.st_ctime_ns,
            )
            != (
                final_source.st_dev,
                final_source.st_ino,
                final_source.st_size,
                final_source.st_mtime_ns,
                final_source.st_ctime_ns,
            )
            or size != final_source.st_size
        ):
            raise WorkflowError("publication source changed while copied")
        if (
            not stat.S_ISREG(final_destination.st_mode)
            or final_destination.st_uid != os.geteuid()
            or stat.S_IMODE(final_destination.st_mode) != 0o400
            or final_destination.st_size != size
        ):
            raise WorkflowError("durable evidence copy metadata mismatch")
        return {
            "sha256": digest.hexdigest(),
            "size_bytes": size,
            "mode": "0400",
        }
    finally:
        os.close(source_fd)
        if destination_fd >= 0:
            os.close(destination_fd)


def write_exclusive_at(
    directory_fd: int,
    name: str,
    data: bytes,
    *,
    mode: int = 0o400,
) -> None:
    descriptor = os.open(
        name,
        os.O_WRONLY
        | os.O_CREAT
        | os.O_EXCL
        | getattr(os, "O_CLOEXEC", 0)
        | getattr(os, "O_NOFOLLOW", 0),
        0o600,
        dir_fd=directory_fd,
    )
    try:
        view = memoryview(data)
        while view:
            written = os.write(descriptor, view)
            if written <= 0:
                raise WorkflowError("could not write durable completion evidence")
            view = view[written:]
        os.fchmod(descriptor, mode)
        os.fsync(descriptor)
    except Exception:
        os.close(descriptor)
        try:
            os.unlink(name, dir_fd=directory_fd)
        except OSError:
            pass
        raise
    else:
        os.close(descriptor)


def descriptor_entry_exists(directory_fd: int, name: str) -> bool:
    try:
        os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
    except FileNotFoundError:
        return False
    return True


def remove_tree_at(parent_fd: int, name: str) -> None:
    """Remove one descriptor-relative tree without following any link."""

    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(name, flags, dir_fd=parent_fd)
    except FileNotFoundError:
        return
    except OSError:
        os.unlink(name, dir_fd=parent_fd)
        return
    try:
        duplicate = os.dup(descriptor)
        try:
            with os.scandir(duplicate) as entries:
                children = [entry.name for entry in entries]
        finally:
            try:
                os.close(duplicate)
            except OSError:
                pass
        for child in children:
            child_metadata = os.stat(
                child,
                dir_fd=descriptor,
                follow_symlinks=False,
            )
            if stat.S_ISDIR(child_metadata.st_mode):
                remove_tree_at(descriptor, child)
            else:
                os.unlink(child, dir_fd=descriptor)
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    os.rmdir(name, dir_fd=parent_fd)


def completion_marker_bytes(run_id: str, manifest_sha256: str) -> bytes:
    return (
        json.dumps(
            {
                "evidence_files_sha256": manifest_sha256,
                "inspection_status": "REVIEW_REQUIRED",
                "restore_planning_gate": "BLOCKED",
                "run_id": run_id,
            },
            sort_keys=True,
            separators=(",", ":"),
        )
        + "\n"
    ).encode("utf-8")


def validate_completion_marker_at(
    directory_fd: int,
    run_id: str,
    manifest_sha256: str,
) -> None:
    expected = completion_marker_bytes(run_id, manifest_sha256)
    if read_private_file_at(directory_fd, COMPLETION_MARKER) != expected:
        raise WorkflowError("durable completion marker does not bind the evidence payload")


def mark_publication_indeterminate(directory_fd: int, run_id: str) -> None:
    """Persistently prevent a committed-but-failed package from looking complete."""

    if descriptor_entry_exists(directory_fd, COMPLETION_MARKER):
        os.unlink(COMPLETION_MARKER, dir_fd=directory_fd)
    if not descriptor_entry_exists(directory_fd, INDETERMINATE_MARKER):
        write_exclusive_at(
            directory_fd,
            INDETERMINATE_MARKER,
            (
                json.dumps(
                    {
                        "inspection_status": "INDETERMINATE",
                        "reason": "post_commit_validation_failed",
                        "run_id": run_id,
                    },
                    sort_keys=True,
                    separators=(",", ":"),
                )
                + "\n"
            ).encode("utf-8"),
        )
    os.fsync(directory_fd)


def prepare_durable_parent(bound: BoundCanonical) -> tuple[Path, int]:
    try:
        os.mkdir(DURABLE_EVIDENCE_DIRECTORY, 0o700, dir_fd=bound.root_fd)
        os.fsync(bound.root_fd)
    except FileExistsError:
        pass
    parent = bound.root / DURABLE_EVIDENCE_DIRECTORY
    descriptor = open_private_directory_at(
        bound.root_fd,
        DURABLE_EVIDENCE_DIRECTORY,
        label="durable evidence parent",
        expected_uid=bound.owner_uid,
    )
    try:
        descriptor_metadata = os.fstat(descriptor)
        root_relative_metadata = os.stat(
            DURABLE_EVIDENCE_DIRECTORY,
            dir_fd=bound.root_fd,
            follow_symlinks=False,
        )
        if (descriptor_metadata.st_dev, descriptor_metadata.st_ino) != (
            root_relative_metadata.st_dev,
            root_relative_metadata.st_ino,
        ):
            raise WorkflowError("durable evidence parent path identity changed")
    except Exception:
        os.close(descriptor)
        raise
    return parent, descriptor


def publish_durable_evidence(
    pending: Path,
    run_root: Path,
    bound: BoundCanonical,
    run_id: str,
    publication_expectations: PublicationExpectations,
) -> Path:
    """Copy, verify, fsync, and no-replace publish outside disposable Git space."""

    validate_publication_runtime_bound(publication_expectations, bound)
    source_identities = validate_evidence_tree(
        pending,
        run_id,
        publication_expectations=publication_expectations,
    )
    parent, parent_fd = prepare_durable_parent(bound)
    staging_name = f".{run_id}.pending"
    final_name = run_id
    staging_fd = -1
    staging_created = False
    committed = False
    try:
        if descriptor_entry_exists(parent_fd, staging_name) or descriptor_entry_exists(
            parent_fd, final_name
        ):
            raise WorkflowError(
                "durable evidence output already exists; refusing to overwrite it"
            )
        os.mkdir(staging_name, 0o700, dir_fd=parent_fd)
        staging_created = True
        staging_fd = open_private_directory_at(
            parent_fd,
            staging_name,
            label="durable evidence staging directory",
            expected_uid=bound.owner_uid,
        )
        child_fds: dict[str, int] = {}
        for directory in sorted(EVIDENCE_DIRECTORIES):
            os.mkdir(directory, 0o700, dir_fd=staging_fd)
            child_fds[directory] = open_private_directory_at(
                staging_fd,
                directory,
                label="durable evidence subdirectory",
                expected_uid=bound.owner_uid,
            )
        try:
            for relative in sorted(ALL_EVIDENCE_FILES):
                if "/" in relative:
                    directory, destination_name = relative.split("/", 1)
                    destination_fd = child_fds[directory]
                else:
                    destination_name = relative
                    destination_fd = staging_fd
                copied_identity = copy_private_file_at(
                    pending / relative,
                    destination_fd,
                    destination_name,
                )
                if copied_identity != source_identities[relative]:
                    raise WorkflowError("durable evidence copy identity mismatch")
            for descriptor in child_fds.values():
                os.fsync(descriptor)
        finally:
            for descriptor in child_fds.values():
                os.close(descriptor)
        validate_publication_runtime_bound(publication_expectations, bound)
        source_identities_after_copy = validate_evidence_tree(
            pending,
            run_id,
            publication_expectations=publication_expectations,
        )
        if source_identities_after_copy != source_identities:
            raise WorkflowError("publication source changed while evidence was copied")
        validate_publication_runtime_bound(publication_expectations, bound)
        destination_identities = validate_evidence_tree_at(
            staging_fd,
            run_id,
            publication_expectations=publication_expectations,
        )
        if destination_identities != source_identities:
            raise WorkflowError("durable evidence copy identity mismatch")
        os.fsync(staging_fd)
        os.fsync(parent_fd)
        os.fsync(bound.root_fd)

        # Disposable archive bytes are removed before the durable commit gate.
        remove_incomplete_run(run_root)
        verify_bound_canonical(bound)
        validate_publication_runtime_bound(publication_expectations, bound)
        parent_metadata = validate_owned_private_directory_descriptor(
            parent_fd,
            label="durable evidence parent",
            expected_uid=bound.owner_uid,
        )
        root_relative_parent = os.stat(
            DURABLE_EVIDENCE_DIRECTORY,
            dir_fd=bound.root_fd,
            follow_symlinks=False,
        )
        if (parent_metadata.st_dev, parent_metadata.st_ino) != (
            root_relative_parent.st_dev,
            root_relative_parent.st_ino,
        ):
            raise WorkflowError("durable evidence parent binding changed before publication")
        if (
            validate_evidence_tree_at(
                staging_fd,
                run_id,
                publication_expectations=publication_expectations,
            )
            != source_identities
        ):
            raise WorkflowError("durable evidence staging identity changed before publication")

        manifest_sha = source_identities["evidence-files.json"]["sha256"]
        if not isinstance(manifest_sha, str) or not HEX64.fullmatch(manifest_sha):
            raise WorkflowError("durable evidence manifest identity is malformed")

        staging_metadata = os.fstat(staging_fd)
        atomic_rename_no_replace_at(parent_fd, staging_name, final_name)
        committed = True
        final_metadata = os.stat(
            final_name,
            dir_fd=parent_fd,
            follow_symlinks=False,
        )
        if (staging_metadata.st_dev, staging_metadata.st_ino) != (
            final_metadata.st_dev,
            final_metadata.st_ino,
        ):
            raise WorkflowError(
                "durable publication state is indeterminate after atomic commit"
            )
        try:
            if (
                validate_evidence_tree_at(
                    staging_fd,
                    run_id,
                    publication_expectations=publication_expectations,
                )
                != source_identities
            ):
                raise WorkflowError("published durable evidence identity mismatch")
            verify_bound_canonical(bound)
            validate_publication_runtime_bound(publication_expectations, bound)
            final_parent_metadata = validate_owned_private_directory_descriptor(
                parent_fd,
                label="durable evidence parent",
                expected_uid=bound.owner_uid,
            )
            final_root_relative_parent = os.stat(
                DURABLE_EVIDENCE_DIRECTORY,
                dir_fd=bound.root_fd,
                follow_symlinks=False,
            )
            if (final_parent_metadata.st_dev, final_parent_metadata.st_ino) != (
                final_root_relative_parent.st_dev,
                final_root_relative_parent.st_ino,
            ):
                raise WorkflowError("durable evidence parent changed after publication")
            os.fsync(parent_fd)
            os.fsync(bound.root_fd)
            write_exclusive_at(
                staging_fd,
                COMPLETION_MARKER,
                completion_marker_bytes(run_id, manifest_sha),
            )
            if (
                validate_evidence_tree_at(
                    staging_fd,
                    run_id,
                    require_completion_marker=True,
                    publication_expectations=publication_expectations,
                )
                != source_identities
            ):
                raise WorkflowError("completed durable evidence identity mismatch")
            os.fsync(staging_fd)
        except Exception as exc:
            raise WorkflowError(
                "durable publication committed but final validation is indeterminate; manual review required"
            ) from exc
        return parent / final_name
    except Exception as failure:
        if not committed and staging_created:
            try:
                remove_tree_at(parent_fd, staging_name)
                os.fsync(parent_fd)
            except OSError as cleanup_error:
                raise WorkflowError(
                    "incomplete durable publication remains quarantined; manual review required"
                ) from cleanup_error
        elif committed:
            try:
                mark_publication_indeterminate(staging_fd, run_id)
            except Exception as marker_error:
                raise WorkflowError(
                    "committed publication could not be marked indeterminate; manual quarantine required"
                ) from marker_error
        raise failure
    finally:
        if staging_fd >= 0:
            os.close(staging_fd)
        os.close(parent_fd)


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def workspace_free_bytes(path: Path) -> int:
    filesystem = os.statvfs(path)
    return filesystem.f_bavail * filesystem.f_frsize


def ensure_pre_copy_headroom(
    workspace: Path,
    outer_size: int,
    *,
    free_bytes_probe=workspace_free_bytes,
) -> None:
    available = free_bytes_probe(workspace)
    if not isinstance(available, int) or isinstance(available, bool) or available < 0:
        raise WorkflowError("workspace free-space probe returned an invalid value")
    required = (3 * outer_size) + MIN_WORKSPACE_OVERHEAD_BYTES
    if available < required:
        raise WorkflowError("insufficient workspace headroom before outer capture")


def relative_to(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def path_is_within(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
    except ValueError:
        return False
    return True


def parse_inspector_failure(stdout: bytes, stderr: bytes) -> tuple[str, str]:
    """Accept one exact reviewed diagnostic and discard every other child byte."""

    if stdout or not stderr or len(stderr) > MAX_INSPECTOR_DIAGNOSTIC_BYTES:
        return "inspector_diagnostic_invalid", "other_nonzero"
    try:
        diagnostic_text = stderr.decode("ascii")
        diagnostic = json.loads(diagnostic_text)
    except (UnicodeDecodeError, json.JSONDecodeError):
        return "inspector_diagnostic_invalid", "other_nonzero"
    if not diagnostic_text.endswith("\n") or diagnostic_text.count("\n") != 1:
        return "inspector_diagnostic_invalid", "other_nonzero"
    if not isinstance(diagnostic, dict) or set(diagnostic) != {
        "diagnostic_version",
        "stage",
        "reason",
    }:
        return "inspector_diagnostic_invalid", "other_nonzero"
    stage = diagnostic.get("stage")
    reason = diagnostic.get("reason")
    if (
        diagnostic.get("diagnostic_version") != 1
        or not isinstance(stage, str)
        or stage not in INSPECTOR_STAGE_CODES
        or not isinstance(reason, str)
        or reason not in INSPECTOR_STAGE_REASON_CODES[stage]
    ):
        return "inspector_diagnostic_invalid", "other_nonzero"
    canonical = (
        '{"diagnostic_version":1,"stage":"'
        + stage
        + '","reason":"'
        + reason
        + '"}\n'
    )
    if diagnostic_text != canonical:
        return "inspector_diagnostic_invalid", "other_nonzero"
    return stage, reason


def _single_report_value(
    pattern: re.Pattern[str], report_text: str, label: str
) -> str:
    matches = pattern.findall(report_text)
    if len(matches) != 1 or not isinstance(matches[0], str):
        raise WorkflowError(
            f"inspector report must contain exactly one {label} field"
        )
    return matches[0]


def _validate_incomplete_report_lines(
    report_text: str,
    report_lines: list[str],
    class_counts: dict[str, int],
    object_status: str,
) -> None:
    """Require the exact aggregate-only report grammar and arithmetic."""

    # The helper and raw inspector each contribute one fixed, reviewed section.
    # Validating only that every line resembles an allowlisted field is not
    # enough: a second safe-looking field could contradict the canonical value
    # or carry attacker-controlled text.  Bind the complete LF-terminated line
    # sequence, including the ordered class-count ledger, instead.
    if report_text != "\n".join(report_lines) + "\n":
        raise WorkflowError(
            "incomplete object-reference report is not canonical LF-terminated text"
        )

    version_value = SAFE_REPORTED_VERSION_VALUE_PATTERN
    canonical_lines: list[str | re.Pattern[str]] = [
        "LOVABLE CLOUD DUMP — METADATA-ONLY INSPECTION",
        "inspection_status: REVIEW_REQUIRED",
        f"object_reference_analysis: {object_status}",
        "migration_duplicate_analysis: INCOMPLETE",
        "restore_planning_gate: BLOCKED",
        (
            "scope: archive header, SHA-256, pg_restore TOC metadata, "
            "aggregate unresolved-object counts"
        ),
        "restore_attempted: no",
        "database_connection_attempted: no",
        "row_payload_inspected: no",
        re.compile(r"size_bytes: (?:0|[1-9][0-9]*)"),
        re.compile(r"sha256: [0-9a-f]{64}"),
        "archive_format: PostgreSQL custom archive (PGDMP)",
        re.compile(r"archive_format_version: [0-9]+\.[0-9]+\.[0-9]+"),
        re.compile(rf"source_postgresql_version: {version_value}"),
        re.compile(rf"source_pg_dump_version: {version_value}"),
        re.compile(r"pg_restore_version: 17(?:\.[0-9]+)?"),
        "pg_restore_list_compatibility: PASS",
        (
            "archive_snapshot_binding: PASS "
            "(TOC and SHA-256 use one private read-only capture)"
        ),
        re.compile(r"toc_entries: (?:0|[1-9][0-9]*)"),
        re.compile(r"toc_metadata_entries: (?:0|[1-9][0-9]*)"),
        re.compile(r"toc_data_references_not_extracted: (?:0|[1-9][0-9]*)"),
        "unknown_toc_classes: none (inspection fails closed if encountered)",
        re.compile(r"unresolved_known_toc_entries: (?:0|[1-9][0-9]*)"),
        "",
        UNRESOLVED_CLASS_COUNT_HEADER,
    ]
    canonical_lines.extend(
        f"{object_class}: {class_counts[object_class]}"
        for object_class in UNRESOLVED_OBJECT_CLASS_ALLOWLIST
    )
    canonical_lines.extend(
        [
            "",
            "BOUNDARY",
            "This report is an inventory aid, not a restore plan or completeness proof.",
            (
                "Object-reference analysis is incomplete; restore planning remains blocked."
                if object_status == "INCOMPLETE"
                else "Migration-duplicate analysis is incomplete; restore planning remains blocked."
            ),
            "",
            "PGDMP HEADER CAPTURE",
            re.compile(
                r"archive_format_version_bytes: "
                r"(?:0|[1-9][0-9]*),(?:0|[1-9][0-9]*),(?:0|[1-9][0-9]*)"
            ),
            re.compile(r"archive_integer_width_bytes: (?:4|8)"),
            re.compile(r"archive_offset_width_bytes: (?:4|8)"),
            "archive_format_code: 1",
            re.compile(r"archive_header_bound_sha256: [0-9a-f]{64}"),
            "expected_sha256_binding: PASS",
        ]
    )

    if len(report_lines) != len(canonical_lines):
        raise WorkflowError(
            "incomplete object-reference report differs from the canonical line count"
        )
    for line, expected in zip(report_lines, canonical_lines):
        if isinstance(expected, str):
            valid = line == expected
        else:
            valid = expected.fullmatch(line) is not None
        if not valid:
            raise WorkflowError(
                "incomplete object-reference report differs from the canonical grammar"
            )

    toc_entries = int(report_lines[18].split(": ", 1)[1])
    metadata_entries = int(report_lines[19].split(": ", 1)[1])
    data_references = int(report_lines[20].split(": ", 1)[1])
    if metadata_entries + data_references != toc_entries:
        raise WorkflowError(
            "incomplete object-reference report TOC aggregate counts disagree"
        )


def _parse_unresolved_class_count_block(
    lines: list[str],
) -> dict[str, int]:
    header_indexes = [
        index
        for index, line in enumerate(lines)
        if line == UNRESOLVED_CLASS_COUNT_HEADER
    ]
    if len(header_indexes) != 1:
        raise WorkflowError(
            "inspector report must contain exactly one unresolved-class-count block"
        )
    block_start = header_indexes[0] + 1
    block_stop = block_start
    while block_stop < len(lines) and lines[block_stop] != "":
        block_stop += 1
    block_lines = lines[block_start:block_stop]
    if not block_lines:
        raise WorkflowError("inspector report object-class-count block is empty")

    allowlisted = set(UNRESOLVED_OBJECT_CLASS_ALLOWLIST)
    parsed: dict[str, int] = {}
    for line in block_lines:
        match = re.fullmatch(r"([A-Z][A-Z ]*): (0|[1-9][0-9]*)", line)
        if match is None or match.group(1) not in allowlisted:
            raise WorkflowError(
                "inspector report object-class-count block differs from the allowlist"
            )
        object_class = match.group(1)
        if object_class in parsed:
            raise WorkflowError("inspector report contains a duplicate object-class count")
        parsed[object_class] = int(match.group(2))
    if tuple(parsed) != UNRESOLVED_OBJECT_CLASS_ALLOWLIST:
        raise WorkflowError(
            "inspector report object-class-count block order or coverage is invalid"
        )
    return parsed


def parse_report_object_analysis(report_text: str) -> dict[str, Any]:
    """Parse and bind the exact fail-closed TOC object-analysis summary."""

    lines = report_text.splitlines()
    exact_field_prefixes = {
        "unresolved_known_toc_entries:": REPORT_UNRESOLVED_KNOWN_TOC_ENTRIES,
        "object_reference_analysis:": REPORT_OBJECT_REFERENCE_ANALYSIS,
        "migration_duplicate_analysis:": REPORT_MIGRATION_DUPLICATE_ANALYSIS,
        "restore_planning_gate:": REPORT_RESTORE_PLANNING_GATE,
        "inspection_status:": REPORT_INSPECTION_STATUS,
        "toc_entries:": REPORT_TOC_ENTRIES,
        "source_postgresql_version:": REPORT_SOURCE_POSTGRES_VERSION,
        "source_pg_dump_version:": REPORT_SOURCE_PG_DUMP_VERSION,
    }
    for prefix, pattern in exact_field_prefixes.items():
        candidates = [line for line in lines if line.startswith(prefix)]
        if len(candidates) != 1 or pattern.fullmatch(candidates[0]) is None:
            raise WorkflowError(
                "inspector report contains a missing, duplicate, or unreviewed analysis field"
            )

    unresolved_total = int(
        _single_report_value(
            REPORT_UNRESOLVED_KNOWN_TOC_ENTRIES,
            report_text,
            "unresolved-known-TOC count",
        )
    )
    toc_entries = int(
        _single_report_value(REPORT_TOC_ENTRIES, report_text, "TOC-entry count")
    )
    object_status = _single_report_value(
        REPORT_OBJECT_REFERENCE_ANALYSIS,
        report_text,
        "object-reference-analysis",
    )
    duplicate_status = _single_report_value(
        REPORT_MIGRATION_DUPLICATE_ANALYSIS,
        report_text,
        "migration-duplicate-analysis",
    )
    restore_gate = _single_report_value(
        REPORT_RESTORE_PLANNING_GATE,
        report_text,
        "restore-planning-gate",
    )

    class_counts = _parse_unresolved_class_count_block(lines)

    if (
        unresolved_total > toc_entries
        or sum(class_counts.values()) != unresolved_total
    ):
        raise WorkflowError("inspector report unresolved-object counts disagree")
    expected_object_status = "COMPLETE" if unresolved_total == 0 else "INCOMPLETE"
    expected_duplicate_status = (
        "CONSERVATIVE" if expected_object_status == "COMPLETE" else "INCOMPLETE"
    )
    if (
        object_status != expected_object_status
        or duplicate_status != expected_duplicate_status
        or restore_gate != "BLOCKED"
    ):
        raise WorkflowError("inspector report object-analysis gate matrix is invalid")
    if object_status == "INCOMPLETE":
        _validate_incomplete_report_lines(
            report_text,
            lines,
            class_counts,
            object_status,
        )

    return {
        "object_reference_analysis": object_status,
        "migration_duplicate_analysis": duplicate_status,
        "restore_planning_gate": restore_gate,
        "unresolved_known_toc_entries": unresolved_total,
        "unresolved_known_toc_class_counts": class_counts,
    }


def validate_provenance_object_analysis(provenance: Any) -> dict[str, Any]:
    """Require the exact blocked analysis contract in every evidence package."""

    if not isinstance(provenance, dict):
        raise WorkflowError("evidence provenance must be an object")
    expected_keys = {
        "object_reference_analysis",
        "migration_duplicate_analysis",
        "restore_planning_gate",
        "unresolved_known_toc_entries",
        "unresolved_known_toc_class_counts",
    }
    analysis = {key: provenance.get(key) for key in expected_keys}
    if any(key not in provenance for key in expected_keys):
        raise WorkflowError("evidence provenance lacks the object-analysis gate")
    counts = analysis["unresolved_known_toc_class_counts"]
    if (
        not isinstance(counts, dict)
        or list(counts) != list(UNRESOLVED_OBJECT_CLASS_ALLOWLIST)
        or any(
            not isinstance(value, int) or isinstance(value, bool) or value < 0
            for value in counts.values()
        )
    ):
        raise WorkflowError("evidence provenance has invalid unresolved-class counts")
    total = analysis["unresolved_known_toc_entries"]
    if (
        not isinstance(total, int)
        or isinstance(total, bool)
        or total < 0
    ):
        raise WorkflowError("evidence provenance has an invalid unresolved total")
    expected_object_status = "COMPLETE" if total == 0 else "INCOMPLETE"
    expected_duplicate_status = (
        "CONSERVATIVE" if expected_object_status == "COMPLETE" else "INCOMPLETE"
    )
    if (
        sum(counts.values()) != total
        or analysis["object_reference_analysis"] != expected_object_status
        or not isinstance(analysis["migration_duplicate_analysis"], str)
        or analysis["migration_duplicate_analysis"] != expected_duplicate_status
        or analysis["restore_planning_gate"] != "BLOCKED"
    ):
        raise WorkflowError("evidence provenance object-analysis gate matrix is invalid")
    return analysis


def parse_report_header_metadata(report_text: str, inner_sha: str) -> dict[str, Any]:
    """Read one additive safe header record and bind it to the verified inner SHA."""

    patterns = {
        "version": REPORT_ARCHIVE_VERSION,
        "version_bytes": REPORT_ARCHIVE_VERSION_BYTES,
        "integer_width_bytes": REPORT_INTEGER_WIDTH,
        "offset_width_bytes": REPORT_OFFSET_WIDTH,
        "format_code": REPORT_FORMAT_CODE,
        "bound_sha256": REPORT_HEADER_SHA,
    }
    matches: dict[str, tuple[str, ...]] = {}
    for label, pattern in patterns.items():
        found = pattern.findall(report_text)
        if len(found) != 1:
            raise WorkflowError(
                f"inspector report must contain exactly one {label} header field"
            )
        value = found[0]
        matches[label] = value if isinstance(value, tuple) else (value,)

    version = tuple(int(value) for value in matches["version"])
    version_bytes = tuple(int(value) for value in matches["version_bytes"])
    integer_width = int(matches["integer_width_bytes"][0])
    offset_width = int(matches["offset_width_bytes"][0])
    format_code = int(matches["format_code"][0])
    bound_sha = matches["bound_sha256"][0]
    if version != version_bytes or any(not 0 <= value <= 255 for value in version):
        raise WorkflowError("inspector report PGDMP version fields disagree")
    if integer_width not in {4, 8} or offset_width not in {4, 8}:
        raise WorkflowError("inspector report PGDMP widths are unsupported")
    if format_code != 1:
        raise WorkflowError("inspector report does not identify custom archive format")
    if bound_sha != inner_sha:
        raise WorkflowError("inspector report header is not bound to the verified inner SHA")
    return {
        "archive_format_version_bytes": list(version_bytes),
        "integer_width_bytes": integer_width,
        "offset_width_bytes": offset_width,
        "archive_format_code": format_code,
        "bound_to_inner_sha256": bound_sha,
        "captured_before_pg_restore": True,
    }


def validate_normalization(
    metadata: Any, outer_sha: str, outer_size: int
) -> dict[str, Any]:
    if not isinstance(metadata, dict) or metadata.get("format_version") != 1:
        raise WorkflowError("normalizer returned unsupported metadata")
    if set(metadata) != {"format_version", "envelope_kind", "outer", "member", "inner"}:
        raise WorkflowError("normalizer returned unexpected metadata fields")
    if metadata.get("envelope_kind") not in {"zip", "direct_pgdmp"}:
        raise WorkflowError("normalizer returned an unknown envelope kind")
    outer = metadata.get("outer")
    inner = metadata.get("inner")
    if not isinstance(outer, dict) or not isinstance(inner, dict):
        raise WorkflowError("normalizer omitted outer or inner metadata")
    if outer.get("size_bytes") != outer_size:
        raise WorkflowError("normalizer outer byte length does not match the captured artifact")
    outer_hashes = {
        outer.get("sha256_before"),
        outer.get("sha256_after"),
        outer_sha,
    }
    if len(outer_hashes) != 1 or not HEX64.fullmatch(str(outer_sha)):
        raise WorkflowError("normalizer outer SHA-256 does not match the captured artifact")
    inner_sha = inner.get("sha256")
    inner_size = inner.get("size_bytes")
    if not isinstance(inner_sha, str) or not HEX64.fullmatch(inner_sha):
        raise WorkflowError("normalizer returned an invalid inner SHA-256")
    if not isinstance(inner_size, int) or isinstance(inner_size, bool) or inner_size <= 0:
        raise WorkflowError("normalizer returned an invalid inner byte length")
    member = metadata.get("member")
    if metadata["envelope_kind"] == "zip":
        if outer.get("format") != "zip" or not isinstance(outer.get("zip"), dict):
            raise WorkflowError("ZIP normalization omitted structural metadata")
        zip_metadata = outer["zip"]
        if (
            zip_metadata.get("entry_count") != 1
            or zip_metadata.get("zip64") is not False
            or zip_metadata.get("archive_comment_length") != 0
            or not isinstance(zip_metadata.get("central_directory_offset"), int)
            or not isinstance(zip_metadata.get("central_directory_size"), int)
        ):
            raise WorkflowError("ZIP normalizer returned unsafe structural metadata")
        if not isinstance(member, dict):
            raise WorkflowError("ZIP normalization omitted member metadata")
        member_name = member.get("name")
        if (
            not isinstance(member_name, str)
            or Path(member_name).name != member_name
            or not member_name.isascii()
        ):
            raise WorkflowError("ZIP normalization returned an unsafe member name")
        if member.get("compression") not in {"stored", "deflate"}:
            raise WorkflowError("ZIP normalization returned unsupported compression")
        if member.get("method") not in {0, 8}:
            raise WorkflowError("ZIP normalization returned unsupported method")
        if not re.fullmatch(r"[0-9a-f]{8}", str(member.get("crc32"))):
            raise WorkflowError("ZIP normalization returned an invalid CRC32")
        if (
            member.get("uncompressed_size") != inner_size
            or member.get("streamed_size") != inner_size
            or not isinstance(member.get("compressed_size"), int)
            or isinstance(member.get("compressed_size"), bool)
            or member["compressed_size"] <= 0
        ):
            raise WorkflowError("ZIP normalization returned inconsistent member lengths")
    else:
        if outer.get("format") != "postgresql_custom_archive" or "zip" in outer:
            raise WorkflowError("direct PGDMP normalization returned ZIP metadata")
        if member is not None:
            raise WorkflowError("direct PGDMP normalization invented ZIP member metadata")
    return metadata


def preflight(repo: Path) -> dict[str, str]:
    approved = required_environment("APPROVED_EXECUTION_CHECKOUT_SHA")
    if not HEX40.fullmatch(approved):
        raise WorkflowError(
            "APPROVED_EXECUTION_CHECKOUT_SHA must be a full lowercase commit SHA"
        )
    if not git_success(repo, ["cat-file", "-e", f"{approved}^{{commit}}"]):
        raise WorkflowError(
            "APPROVED_EXECUTION_CHECKOUT_SHA does not identify an available commit"
        )
    execution = run_git(repo, ["rev-parse", "HEAD"])
    if not HEX40.fullmatch(execution):
        raise WorkflowError("EXECUTION_CHECKOUT_SHA must be a full lowercase commit SHA")
    if approved != execution:
        raise WorkflowError("approved execution checkout SHA does not match HEAD")
    if run_git(repo, ["rev-parse", "HEAD"]) != execution:
        raise WorkflowError("execution checkout SHA changed during preflight")
    if not git_success(
        repo,
        ["cat-file", "-e", f"{INSPECTION_BASELINE_GIT_SHA}^{{commit}}"],
    ):
        raise WorkflowError("inspection baseline commit is unavailable")
    if not git_success(
        repo,
        [
            "merge-base",
            "--is-ancestor",
            INSPECTION_BASELINE_GIT_SHA,
            execution,
        ],
    ):
        raise WorkflowError("inspection baseline commit is not an execution ancestor")

    baseline_paths = ["supabase/migrations"]
    if not git_success(
        repo,
        [
            "diff",
            "--quiet",
            INSPECTION_BASELINE_GIT_SHA,
            "--",
            *baseline_paths,
        ],
    ):
        raise WorkflowError("migration inputs differ from their historical baseline")

    untracked = run_git(
        repo, ["ls-files", "--others", "--exclude-standard", "--", "supabase/migrations"]
    )
    if untracked:
        raise WorkflowError("untracked files under supabase/migrations can alter inspection")
    ignored = run_git(
        repo,
        [
            "ls-files",
            "--others",
            "--ignored",
            "--exclude-standard",
            "--",
            "supabase/migrations",
        ],
    )
    if ignored:
        raise WorkflowError("ignored files under supabase/migrations can alter inspection")

    execution_paths = [
        "scripts/migration/README.md",
        "scripts/migration/inspect-lovable-export.py",
        "scripts/migration/normalize-lovable-export.py",
        "scripts/migration/bounded-pg-restore.py",
        "scripts/migration/inspect-lovable-dump.sh",
        "scripts/migration/lib/lovable_dump_report.py",
        "supabase/config.toml",
    ]
    if not git_success(repo, ["diff", "--quiet", execution, "--", *execution_paths]):
        raise WorkflowError("execution procedure differs from the approved checkout")
    if run_git(repo, ["status", "--porcelain"]):
        raise WorkflowError("execution checkout must have a clean worktree and index")

    supplied_tool_sha = os.environ.get("INSPECTION_TOOL_GIT_SHA", execution)
    if supplied_tool_sha != execution:
        raise WorkflowError("unexpected inspection tool Git SHA")

    identities: dict[str, str] = {
        "approved_execution_checkout_sha": approved,
        "execution_checkout_sha": execution,
        "procedure_origin_sha": PROCEDURE_ORIGIN_SHA,
        "inspection_tool_git_sha": execution,
        "inspection_baseline_git_sha": INSPECTION_BASELINE_GIT_SHA,
    }
    for label, relative in {
        "procedure_readme_blob_sha": "scripts/migration/README.md",
        "execution_driver_blob_sha": "scripts/migration/inspect-lovable-export.py",
        "normalizer_blob_sha": "scripts/migration/normalize-lovable-export.py",
        "pg_restore_guard_blob_sha": "scripts/migration/bounded-pg-restore.py",
        "pgdmp_inspector_blob_sha": "scripts/migration/inspect-lovable-dump.sh",
        "report_helper_blob_sha": "scripts/migration/lib/lovable_dump_report.py",
        "supabase_config_blob_sha": "supabase/config.toml",
    }.items():
        blob = run_git(repo, ["rev-parse", f"HEAD:{relative}"])
        if not HEX_OBJECT.fullmatch(blob):
            raise WorkflowError(f"{label} is malformed")
        identities[label] = blob

    readme = (repo / "scripts/migration/README.md").read_bytes()
    identities["procedure_workflow_sha256"] = sha256_bytes(extract_workflow_fence(readme))
    identities["execution_driver_sha256"] = file_sha256(
        repo / "scripts/migration/inspect-lovable-export.py"
    )
    identities["normalizer_sha256"] = file_sha256(
        repo / "scripts/migration/normalize-lovable-export.py"
    )
    identities["pg_restore_guard_sha256"] = file_sha256(
        repo / "scripts/migration/bounded-pg-restore.py"
    )
    identities["pgdmp_inspector_sha256"] = file_sha256(
        repo / "scripts/migration/inspect-lovable-dump.sh"
    )
    identities["report_helper_sha256"] = file_sha256(
        repo / "scripts/migration/lib/lovable_dump_report.py"
    )
    identities["supabase_config_sha256"] = file_sha256(repo / "supabase/config.toml")

    raw_python = sys.executable
    if not raw_python or not os.path.isabs(raw_python) or "\n" in raw_python:
        raise WorkflowError("execution Python must have a safe absolute path")
    try:
        execution_python = Path(raw_python).resolve(strict=True)
        python_metadata = execution_python.stat()
    except OSError as exc:
        raise WorkflowError("execution Python is unavailable") from exc
    if not stat.S_ISREG(python_metadata.st_mode) or not os.access(
        execution_python, os.X_OK
    ):
        raise WorkflowError("execution Python must be an executable regular file")
    identities["execution_python_executable"] = str(execution_python)
    identities["execution_python_sha256"] = file_sha256(execution_python)
    identities["execution_python_implementation"] = sys.implementation.name
    identities["execution_python_version"] = ".".join(
        str(component) for component in sys.version_info[:3]
    )
    return identities


def repository_project_id(repo: Path) -> str:
    """Read the single strict top-level project_id in approved config bytes."""

    try:
        text = (repo / "supabase/config.toml").read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise WorkflowError("supabase/config.toml is unavailable or not UTF-8") from exc
    assignment = re.compile(
        r'^project_id[ \t]*=[ \t]*"([a-z0-9]{20})"[ \t]*(?:#.*)?$',
        re.MULTILINE,
    )
    all_assignments = re.findall(r"(?m)^[ \t]*project_id[ \t]*=", text)
    matches = assignment.findall(text)
    if len(all_assignments) != 1 or len(matches) != 1:
        raise WorkflowError(
            "approved supabase/config.toml must declare exactly one top-level project_id"
        )
    # The reviewed repository contract places project_id before any TOML table.
    first_table = re.search(r"(?m)^\s*\[", text)
    match = assignment.search(text)
    if match is None or (first_table is not None and match.start() > first_table.start()):
        raise WorkflowError(
            "approved supabase/config.toml project_id must be a top-level declaration"
        )
    return matches[0]


def build_timeline(
    evidence_profile: str,
) -> tuple[dict[str, Any], dict[str, dt.datetime], str]:
    initiated, initiated_dt = structured_event("EXPORT_INITIATED")
    completed, completed_dt = structured_event("EXPORT_COMPLETED")
    available, available_dt = observed_event("EXPORT_AVAILABLE_AT_UTC")
    downloaded, downloaded_dt = observed_event("DOWNLOAD_COMPLETED_AT_UTC")

    if available_dt > downloaded_dt:
        raise WorkflowError("export availability must not follow download completion")
    if initiated_dt is not None and initiated_dt > available_dt:
        raise WorkflowError("observed export initiation must not follow availability")
    if completed_dt is not None and completed_dt > available_dt:
        raise WorkflowError("observed export completion must not follow availability")
    if (
        initiated_dt is not None
        and completed_dt is not None
        and initiated_dt > completed_dt
    ):
        raise WorkflowError("observed export initiation must not follow completion")

    status = (
        "INCOMPLETE"
        if initiated.basis == "not_observed" or completed.basis == "not_observed"
        else "COMPLETE"
    )
    if evidence_profile == "retained_rehearsal_missing_initiation":
        if initiated.basis != "not_observed" or status != "INCOMPLETE":
            raise WorkflowError(
                "retained rehearsal profile requires unobserved initiation and INCOMPLETE status"
            )
    elif evidence_profile in {"future_rehearsal", "final_cutover"}:
        if initiated.basis != "operator_observed":
            raise WorkflowError(
                "future/final export profiles require operator-observed initiation"
            )
    else:
        raise WorkflowError(
            "EXPORT_EVIDENCE_PROFILE must identify the retained rehearsal, a future rehearsal, or final cutover"
        )
    timeline = {
        "initiated_at_utc": initiated.as_json(),
        "completed_at_utc": completed.as_json(),
        "available_at_utc": available.as_json(),
        "download_completed_at_utc": downloaded.as_json(),
        "time_inference_used": False,
    }
    parsed = {
        "available": available_dt,
        "downloaded": downloaded_dt,
    }
    return timeline, parsed, status


def inspect() -> Path:
    script = Path(__file__).resolve()
    repo = script.parents[2]
    identities = preflight(repo)

    source_name = required_environment("SOURCE_PROJECT_NAME")
    source_ref = required_environment("SOURCE_PROJECT_REF")
    if not PROJECT_REF.fullmatch(source_ref):
        raise WorkflowError("SOURCE_PROJECT_REF must be 20 lowercase letters/digits")
    configured_project_ref = repository_project_id(repo)
    if source_ref != configured_project_ref:
        raise WorkflowError(
            "SOURCE_PROJECT_REF does not equal approved supabase/config.toml project_id"
        )

    ui_object_name = required_environment("UI_EXPORT_OBJECT_NAME")
    operator = required_environment("OPERATOR_IDENTITY")
    evidence_profile = required_environment("EXPORT_EVIDENCE_PROFILE")
    timeline, _, timeline_status = build_timeline(evidence_profile)
    expected_sha256 = required_environment("EXPECTED_OUTER_SHA256")
    if not HEX64.fullmatch(expected_sha256):
        raise WorkflowError("EXPECTED_OUTER_SHA256 must be 64 lowercase hexadecimal characters")
    expected_size = parse_expected_outer_size(
        required_environment("EXPECTED_OUTER_SIZE_BYTES")
    )
    expected_filename = validate_expected_filename(
        required_environment("EXPECTED_ORIGINAL_FILENAME")
    )
    approved_store_text = required_environment("APPROVED_EVIDENCE_STORE_ROOT")
    canonical_text = required_environment("CANONICAL_EXPORT")
    pg_restore_bin = validate_pg_restore_executable(
        required_environment("PG_RESTORE_BIN")
    )
    for name, value in {
        "APPROVED_EVIDENCE_STORE_ROOT": approved_store_text,
        "CANONICAL_EXPORT": canonical_text,
    }.items():
        if re.match(r"^[A-Za-z][A-Za-z0-9+.-]*://", value) or re.match(
            r"^(postgres|postgresql):", value
        ):
            raise WorkflowError(f"{name} must be a local filesystem path")
    canonical = Path(canonical_text)
    if not canonical.is_absolute():
        raise WorkflowError("CANONICAL_EXPORT must be an absolute local path")

    bound = open_bound_canonical(
        canonical,
        Path(approved_store_text),
        expected_filename,
        expected_size,
        expected_sha256,
        repo,
    )
    run_root: Path | None = None
    completed = False
    try:
        availability_text = timeline["available_at_utc"].get("value")
        if not isinstance(availability_text, str):
            raise WorkflowError("observed export availability is missing after validation")
        compact_availability = availability_text.replace("-", "").replace(":", "")
        run_kind = "final_cutover" if evidence_profile == "final_cutover" else "rehearsal"
        run_prefix = "final" if run_kind == "final_cutover" else "rehearsal"
        run_id = f"{run_prefix}-{compact_availability}-{expected_sha256[:12]}"

        durable_parent = bound.root / DURABLE_EVIDENCE_DIRECTORY
        durable_final = durable_parent / run_id
        durable_staging = durable_parent / f".{run_id}.pending"
        if os.path.lexists(durable_parent):
            durable_parent_fd = validate_private_directory(
                durable_parent,
                label="durable evidence parent",
            )
            os.close(durable_parent_fd)
            if os.path.lexists(durable_final) or os.path.lexists(durable_staging):
                raise WorkflowError(
                    "durable evidence output already exists; refusing to overwrite it"
                )

        workspace = repo / "local-migration-artifacts"
        if workspace.exists():
            workspace_metadata = workspace.lstat()
            if not stat.S_ISDIR(workspace_metadata.st_mode):
                raise WorkflowError("local-migration-artifacts must be a directory")
            if workspace_metadata.st_uid != os.geteuid():
                raise WorkflowError("local-migration-artifacts must be owned by the operator")
            if stat.S_IMODE(workspace_metadata.st_mode) != 0o700:
                raise WorkflowError("local-migration-artifacts must have mode 0700")
        else:
            workspace.mkdir(mode=0o700)
        ensure_pre_copy_headroom(workspace, expected_size)

        run_root = workspace / run_id
        try:
            run_root.mkdir(mode=0o700)
        except FileExistsError as exc:
            raise WorkflowError("evidence run already exists; refusing to overwrite it") from exc

        pending = run_root / ".pending"
        pending.mkdir(mode=0o700)
        working_dir = pending / ".working"
        working_outer = working_dir / "canonical-outer.artifact"
        copied_size = copy_descriptor_snapshot(
            bound.file_fd,
            working_outer,
            expected_sha256,
            expected_size,
        )
        if copied_size != expected_size:
            raise WorkflowError("canonical and working outer artifact sizes differ")

        checksum_dir = pending / "archive"
        checksum_dir.mkdir(mode=0o700)
        expected_sha_file = checksum_dir / "outer.expected.sha256"
        observed_before_file = (
            checksum_dir / "outer.workflow-observed.before.sha256"
        )
        observed_after_file = checksum_dir / "outer.workflow-observed.after.sha256"

        derived_dir = pending / ".derived"
        derived_dir.mkdir(mode=0o700)
        inner_archive = derived_dir / "verified-inner.pgdmp"
        normalization_file = derived_dir / "normalization.json"
        normalizer = repo / "scripts/migration/normalize-lovable-export.py"
        normalize_result = subprocess.run(
            [
                identities["execution_python_executable"],
                "-I",
                "-S",
                "-B",
                str(normalizer),
                "--expected-outer-sha256",
                expected_sha256,
                "--output",
                str(inner_archive),
                "--metadata-output",
                str(normalization_file),
                str(working_outer),
            ],
            cwd=repo,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if normalize_result.returncode != 0:
            raise WorkflowError("Lovable export normalization failed closed")
        if normalize_result.stdout or normalize_result.stderr:
            raise WorkflowError("normalizer emitted unexpected output on success")
        normalization = validate_normalization(
            json.loads(normalization_file.read_text(encoding="utf-8")),
            expected_sha256,
            expected_size,
        )
        envelope_kind = normalization["envelope_kind"]
        if (
            envelope_kind == "zip"
            and normalization["member"]["name"] != ui_object_name
        ):
            raise WorkflowError(
                "ZIP member name does not exactly equal UI_EXPORT_OBJECT_NAME"
            )

        inner_sha = normalization["inner"]["sha256"]
        inner_size = normalization["inner"]["size_bytes"]
        if file_sha256(inner_archive) != inner_sha or inner_archive.stat().st_size != inner_size:
            raise WorkflowError("derived PGDMP does not match normalizer metadata")
        if stat.S_IMODE(inner_archive.stat().st_mode) != 0o400:
            raise WorkflowError("derived PGDMP must have mode 0400")

        inspection_dir = pending / "inspection"
        inspection_dir.mkdir(mode=0o700)
        inspector_temp = pending / ".inspector-tmp"
        inspector_temp.mkdir(mode=0o700)
        report = inspection_dir / "rehearsal-metadata.txt"
        inspector = repo / "scripts/migration/inspect-lovable-dump.sh"
        python_executable = identities["execution_python_executable"]
        inspector_environment = {
            "LANG": "C",
            "LC_ALL": "C",
            "PATH": os.pathsep.join(("/usr/bin", "/bin")),
            "TMPDIR": str(inspector_temp),
            "LOVABLE_UNDERLYING_PG_RESTORE_BIN": pg_restore_bin,
            "LOVABLE_PG_RESTORE_GUARD_IS_PYTHON": "1",
            "PG_RESTORE_BIN": str(repo / "scripts/migration/bounded-pg-restore.py"),
            "PYTHON_BIN": python_executable,
        }
        try:
            inspect_result = subprocess.run(
                [
                    "/bin/bash",
                    str(inspector),
                    "--expected-sha256",
                    inner_sha,
                    "--output",
                    str(report),
                    str(inner_archive),
                ],
                cwd=repo,
                env=inspector_environment,
                check=False,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
        except OSError as exc:
            raise InspectorStageError("internal_failure", "other_nonzero") from exc
        if inspect_result.returncode != 0:
            stage, reason = parse_inspector_failure(
                inspect_result.stdout,
                inspect_result.stderr,
            )
            raise InspectorStageError(stage, reason)
        expected_inspector_stdout = (
            f"Metadata-only report written to {report}\n".encode("utf-8")
        )
        if inspect_result.stderr or inspect_result.stdout != expected_inspector_stdout:
            raise WorkflowError("inner PGDMP inspector emitted unexpected output")

        report_text = report.read_text(encoding="utf-8")
        reported_hashes = REPORT_SHA.findall(report_text)
        if len(reported_hashes) != 1:
            raise WorkflowError("inspector report must contain exactly one inner sha256 field")
        object_analysis = parse_report_object_analysis(report_text)
        required_report_lines = {
            "inspection_status: REVIEW_REQUIRED",
            "restore_attempted: no",
            "database_connection_attempted: no",
            "row_payload_inspected: no",
            f"size_bytes: {inner_size}",
        }
        report_lines = set(report_text.splitlines())
        if (
            object_analysis["object_reference_analysis"] == "COMPLETE"
            and object_analysis["migration_duplicate_analysis"] == "CONSERVATIVE"
        ):
            required_report_lines.add("input_file: verified-inner.pgdmp")
        elif any(line.startswith("input_file:") for line in report_lines):
            raise WorkflowError(
                "incomplete object-reference report must not retain an input filename"
            )
        if not required_report_lines <= report_lines or not any(
            line.startswith("archive_snapshot_binding: PASS ") for line in report_lines
        ):
            raise WorkflowError("inspector report is missing a required safety-boundary field")
        if not re.search(r"^pg_restore_version: 17(?:\.|$)", report_text, re.MULTILINE):
            raise WorkflowError("metadata inspection requires PostgreSQL 17 pg_restore")
        header_metadata = parse_report_header_metadata(report_text, inner_sha)
        os.chmod(report, 0o400)
        inner_sha_after = file_sha256(inner_archive)
        if len({inner_sha, inner_sha_after, reported_hashes[0]}) != 1:
            raise WorkflowError("normalizer, derived archive, and inspector inner hashes differ")

        working_size_after, working_sha_after = fingerprint_regular(working_outer)
        canonical_size_after, canonical_sha_after = verify_bound_canonical(bound)
        if expected_size != canonical_size_after or copied_size != working_size_after:
            raise WorkflowError("outer artifact byte length changed during inspection")
        normalizer_outer = normalization["outer"]
        outer_hashes = {
            expected_sha256,
            bound.observed_sha256,
            working_sha_after,
            canonical_sha_after,
            normalizer_outer["sha256_before"],
            normalizer_outer["sha256_after"],
        }
        if len(outer_hashes) != 1:
            raise WorkflowError("canonical or working outer artifact changed during inspection")
        report_sha = file_sha256(report)
        report_sha_file = inspection_dir / "report.sha256"

        identities_after_execution = preflight(repo)
        if identities_after_execution != identities:
            raise WorkflowError("execution provenance changed during inspection")
        if repository_project_id(repo) != configured_project_ref:
            raise WorkflowError("repository project binding changed during inspection")

        publication_expectations = build_publication_expectations(
            run_id=run_id,
            run_kind=run_kind,
            evidence_profile=evidence_profile,
            timeline_status=timeline_status,
            timeline=timeline,
            source_name=source_name,
            source_ref=source_ref,
            configured_project_ref=configured_project_ref,
            ui_export_object_name=ui_object_name,
            operator_identity=operator,
            identities=identities,
            bound=bound,
            normalization=normalization,
            inner_size_bytes=inner_size,
            inner_sha256=inner_sha,
            pgdmp_header=header_metadata,
            report_sha256=report_sha,
            object_analysis=object_analysis,
        )
        write_exclusive(expected_sha_file, (expected_sha256 + "\n").encode("ascii"))
        write_exclusive(
            observed_before_file,
            (bound.observed_sha256 + "\n").encode("ascii"),
        )
        write_exclusive(
            observed_after_file,
            (canonical_sha_after + "\n").encode("ascii"),
        )
        write_exclusive(report_sha_file, (report_sha + "\n").encode("ascii"))

        root_metadata = os.fstat(bound.root_fd)
        file_metadata = os.fstat(bound.file_fd)
        provenance: dict[str, Any] = {
            "format_version": PROVENANCE_FORMAT_VERSION,
            "artifact_kind": "lovable_cloud_export_inspection_provenance",
            "inspection_status": "REVIEW_REQUIRED",
            "export_timeline_status": timeline_status,
            **object_analysis,
            "run_id": run_id,
            "run_kind": run_kind,
            "export_evidence_profile": evidence_profile,
            **identities,
            "procedure_identity_boundary": {
                "procedure_origin_sha_is_informational_only": True,
                "external_approval_proof": "approved checkout must exactly equal execution checkout",
                "inspector_identity": (
                    "approved execution checkout plus exact Git blob and file SHA-256"
                ),
                "historical_baseline_scope": "unchanged supabase/migrations only",
            },
            "execution_tools": {
                "driver": {
                    "path": "scripts/migration/inspect-lovable-export.py",
                    "git_blob_sha": identities["execution_driver_blob_sha"],
                    "sha256": identities["execution_driver_sha256"],
                },
                "envelope_normalizer": {
                    "path": "scripts/migration/normalize-lovable-export.py",
                    "git_blob_sha": identities["normalizer_blob_sha"],
                    "sha256": identities["normalizer_sha256"],
                },
                "bounded_pg_restore_guard": {
                    "path": "scripts/migration/bounded-pg-restore.py",
                    "git_blob_sha": identities["pg_restore_guard_blob_sha"],
                    "sha256": identities["pg_restore_guard_sha256"],
                    "invoked_with_execution_python_isolated_mode": True,
                },
                "pgdmp_inspector": {
                    "path": "scripts/migration/inspect-lovable-dump.sh",
                    "git_sha": identities["inspection_tool_git_sha"],
                    "git_blob_sha": identities["pgdmp_inspector_blob_sha"],
                    "sha256": identities["pgdmp_inspector_sha256"],
                    "failure_diagnostic_format_version": 1,
                    "raw_failure_output_relayed": False,
                },
                "report_helper": {
                    "path": "scripts/migration/lib/lovable_dump_report.py",
                    "git_sha": identities["inspection_tool_git_sha"],
                    "git_blob_sha": identities["report_helper_blob_sha"],
                    "sha256": identities["report_helper_sha256"],
                    "failure_diagnostic_format_version": 1,
                    "raw_failure_output_relayed": False,
                },
                "python_runtime": {
                    "executable": identities["execution_python_executable"],
                    "sha256": identities["execution_python_sha256"],
                    "implementation": identities[
                        "execution_python_implementation"
                    ],
                    "version": identities["execution_python_version"],
                    "isolated_mode_for_child_tools": True,
                    "inherited_python_or_shell_startup_environment": False,
                },
            },
            "lovable_source_project": {
                "name": source_name,
                "ref": source_ref,
                "repository_binding": {
                    "path": "supabase/config.toml",
                    "declared_project_id": configured_project_ref,
                    "git_blob_sha": identities["supabase_config_blob_sha"],
                    "sha256": identities["supabase_config_sha256"],
                    "exact_match": True,
                },
                "identity_boundary": "operator-observed UI identity plus exact approved-checkout config equality; Lovable's internal export mapping is not independently verifiable",
            },
            "export_timeline": timeline,
            "evidence_store": {
                "approved_root": str(bound.root),
                "root_owner_uid": root_metadata.st_uid,
                "root_mode": "0700",
                "canonical_direct_child": True,
                "canonical_owner_uid": file_metadata.st_uid,
                "canonical_mode": f"{bound.mode:04o}",
                "volume_encryption": "not_independently_verified_by_this_workflow",
                "durable_package_relative_path": (
                    f"{DURABLE_EVIDENCE_DIRECTORY}/{run_id}"
                ),
            },
            "outer_artifact": {
                "role": "canonical_download_envelope",
                "ui_observed_export_object_name": ui_object_name,
                "expected_identity": {
                    "original_filename": expected_filename,
                    "size_bytes": expected_size,
                    "sha256": expected_sha256,
                    "basis": "mandatory externally supplied runtime approval inputs",
                },
                "workflow_observed_identity": {
                    "original_filename": bound.path.name,
                    "size_bytes_before": bound.size,
                    "size_bytes_after": canonical_size_after,
                    "sha256_before": bound.observed_sha256,
                    "sha256_after": canonical_sha_after,
                },
                "format": normalization["outer"]["format"],
                "normalizer_sha256": {
                    "before": normalizer_outer["sha256_before"],
                    "after": normalizer_outer["sha256_after"],
                },
                "checksum_files": {
                    "expected": relative_to(expected_sha_file, pending),
                    "workflow_observed_before": relative_to(
                        observed_before_file, pending
                    ),
                    "workflow_observed_after": relative_to(
                        observed_after_file, pending
                    ),
                },
                "working_copy_retained_in_evidence": False,
            },
            "zip_envelope": normalization["outer"].get("zip"),
            "archive_member": normalization.get("member"),
            "ui_member_binding": {
                "status": "exact_match" if envelope_kind == "zip" else "not_applicable",
                "ui_observed_name": ui_object_name,
                "normalized_member_name": (
                    normalization["member"]["name"] if envelope_kind == "zip" else None
                ),
            },
            "inner_pgdmp": {
                "role": "verified_inspector_input",
                "relationship_to_outer": (
                    "derived_from_single_zip_member"
                    if envelope_kind == "zip"
                    else "byte_copy_of_direct_pgdmp"
                ),
                "size_bytes": inner_size,
                "sha256": inner_sha,
                "inspector_reported_sha256": reported_hashes[0],
                "pgdmp_header": header_metadata,
                "pg_restore_list": {
                    "compatibility": "PASS",
                    "failure_diagnostic": None,
                    "raw_child_output_retained": False,
                },
                "retained_in_evidence": False,
                "all_bytes_consumed_by_pg_restore_list": "not_independently_verifiable",
            },
            "operator_identity": operator,
            "report": {
                "filename": report.name,
                "relative_path": relative_to(report, pending),
                "sha256": report_sha,
                "checksum_file": relative_to(report_sha_file, pending),
            },
            "durable_publication": {
                "relative_directory": f"{DURABLE_EVIDENCE_DIRECTORY}/{run_id}",
                "file_manifest": "evidence-files.json",
                "file_manifest_checksum": "evidence-files.sha256",
                "completion_marker": COMPLETION_MARKER,
                "completion_marker_meaning": (
                    "evidence package bytes are complete; restore planning remains blocked"
                ),
                "publication_semantics": (
                    "descriptor_bound_fsynced_payload_then_atomic_no_replace_"
                    "postcommit_validation_then_completion_marker"
                ),
            },
            "support_reported_not_independently_verified": SUPPORT_REPORTED_BOUNDARY,
        }
        provenance_file = pending / "provenance.json"
        provenance_bytes = (
            json.dumps(provenance, indent=2, sort_keys=True) + "\n"
        ).encode("utf-8")
        write_exclusive(provenance_file, provenance_bytes)
        provenance_sha_file = pending / "provenance.sha256"
        write_exclusive(
            provenance_sha_file,
            (sha256_bytes(provenance_bytes) + "\n").encode("ascii"),
        )

        # No archive bytes are retained in the metadata evidence package.
        shutil.rmtree(working_dir)
        shutil.rmtree(derived_dir)
        shutil.rmtree(inspector_temp)
        for directory in (checksum_dir, inspection_dir, pending):
            os.chmod(directory, 0o700)
        build_evidence_file_manifest(pending, run_id)
        durable_evidence = publish_durable_evidence(
            pending,
            run_root,
            bound,
            run_id,
            publication_expectations,
        )
        completed = True
        print("inspection_status=REVIEW_REQUIRED")
        print("restore_planning_gate=BLOCKED")
        print(f"export_timeline_status={timeline_status}")
        print(f"evidence_run_id={run_id}")
        print(
            "durable_evidence_relative="
            f"{DURABLE_EVIDENCE_DIRECTORY}/{durable_evidence.name}"
        )
        return durable_evidence
    finally:
        if not completed and run_root is not None:
            remove_incomplete_run(run_root)
        bound.close()


def main() -> int:
    try:
        inspect()
    except InspectorStageError as exc:
        print(
            '{"diagnostic_version":1,"stage":"'
            + exc.stage
            + '","reason":"'
            + exc.reason
            + '"}',
            file=sys.stderr,
        )
        return 4
    except WorkflowError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 4
    except (OSError, UnicodeError, json.JSONDecodeError):
        print(
            '{"diagnostic_version":1,"stage":"internal_failure",'
            '"reason":"other_nonzero"}',
            file=sys.stderr,
        )
        return 4
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
