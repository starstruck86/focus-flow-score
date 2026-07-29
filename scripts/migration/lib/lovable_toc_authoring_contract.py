#!/usr/bin/env python3
"""Private, append-only authoring contract for opaque Lovable TOC decisions.

This module contains no operator entrypoint, network operation, database mode,
``pg_restore`` invocation, or final-ledger validator call.  The interactive
entrypoint owns the controlling-TTY boundary and supplies reviewed decisions;
this module binds those decisions to an immutable private checkpoint chain.

Raw TOC bytes returned by :func:`load_capture_for_authoring` are private input
for that controlling-TTY surface only.  They must never be placed in an
ordinary diagnostic or persisted in a checkpoint.
"""

from __future__ import annotations

import hashlib
import os
import re
import secrets
import stat
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping, Optional, Sequence, Tuple

from .lovable_toc_contract import (
    CAPTURE_FILES,
    CLASSIFICATIONS,
    CLASS_MANAGED_DOMAINS,
    DATA_PARENT_CLASSES,
    ENTRY_MANAGED_DOMAINS,
    FINAL_DISPOSITIONS,
    GLOBAL_HANDLING,
    MANAGED_DOMAINS,
    MANAGED_HANDLING,
    MAX_ENTRY_COUNT,
    MAX_LEDGER_BYTES,
    MAX_RAW_TOC_BYTES,
    METADATA_PARENT_REQUIRED_CLASSES,
    OPAQUE_ID_RE,
    RELATIONSHIP_PARENT_GROUPS,
    ContractError,
    RawTocEntry,
    _rename_no_replace,
    canonical_json_bytes,
    parse_raw_toc_structure,
    require_exact_keys,
    require_int,
    sha256_bytes,
    stable_private_file_at,
    strict_json_loads,
    validate_capture_schema,
    validate_git_sha,
    validate_sha,
)


CHECKPOINT_FORMAT_VERSION = 1
CHECKPOINT_ARTIFACT_KIND = "lovable_toc_annotation_checkpoint"
FINALIZATION_RECEIPT_FORMAT_VERSION = 1
MAX_CHECKPOINT_BYTES = MAX_LEDGER_BYTES
CHECKPOINT_NAME_RE = re.compile(
    r"^checkpoint-g([0-9]{16})-([0-9a-f]{64})[.]json$", re.ASCII
)
SAFE_IDENTITY_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ._@()+:-]{0,127}$", re.ASCII)
SHA256_RE = re.compile(r"^[0-9a-f]{64}$", re.ASCII)
CHECKPOINT_ACTIONS = frozenset(
    {
        "initialize",
        "primary_review",
        "relationship_correction",
        "revisit_unresolved",
        "relationship_review",
        "data_reference_review",
        "sequence_review",
        "managed_review",
        "manual_conflict_review",
        "peer_review",
    }
)
ENTRY_PRIMARY_ACTIONS = frozenset(
    {
        "primary_review",
        "relationship_correction",
        "revisit_unresolved",
        "relationship_review",
        "data_reference_review",
        "sequence_review",
        "managed_review",
        "manual_conflict_review",
    }
)
ENTRY_PHASES = frozenset({*ENTRY_PRIMARY_ACTIONS, "peer_review"})
RANGE_OPTIONAL_ACTIONS = frozenset({"managed_review", "peer_review"})
STATE_BEARING_REVIEW_CLASSES = frozenset({"SEQUENCE OWNED BY", "SEQUENCE SET"})
REVIEW_STATE_VALUES = frozenset({"pending", "reviewed", "not_applicable"})
PEER_STATE_VALUES = frozenset({"pending", "approved", "changes_requested"})
PUBLIC_AUTHORING_STATES = frozenset(
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

DECISION_KEYS = frozenset(
    {
        "classification",
        "classification_reviewed",
        "data_reference_review_state",
        "dependency_entry_ids",
        "dependency_reviewed",
        "managed_domain",
        "managed_domain_reviewed",
        "manual_conflict_disposition",
        "manual_conflict_review_state",
        "metadata_parent_entry_id",
        "parent_entry_ids",
        "relationship_review_state",
        "sequence_review_state",
    }
)
DECISION_FIELDS_BY_ACTION = {
    "primary_review": frozenset(
        {
            "classification",
            "classification_reviewed",
            "manual_conflict_disposition",
            "manual_conflict_review_state",
        }
    ),
    "revisit_unresolved": frozenset(
        {
            "classification",
            "classification_reviewed",
            "manual_conflict_review_state",
        }
    ),
    "relationship_review": frozenset(
        {
            "dependency_entry_ids",
            "dependency_reviewed",
            "parent_entry_ids",
            "relationship_review_state",
        }
    ),
    "relationship_correction": frozenset(
        {
            "dependency_entry_ids",
            "parent_entry_ids",
            "relationship_review_state",
            "sequence_review_state",
        }
    ),
    "data_reference_review": frozenset(
        {"data_reference_review_state", "metadata_parent_entry_id"}
    ),
    "sequence_review": frozenset(
        {"metadata_parent_entry_id", "sequence_review_state"}
    ),
    "managed_review": frozenset({"managed_domain", "managed_domain_reviewed"}),
    "manual_conflict_review": frozenset(
        {"manual_conflict_disposition", "manual_conflict_review_state"}
    ),
}


class AuthoringContractError(RuntimeError):
    """One fixed authoring failure code with no private context."""

    ALLOWED_CODES = frozenset(
        {
            "binding_mismatch",
            "capture_invalid",
            "checkpoint_invalid",
            "cleanup_indeterminate",
            "finalization_incomplete",
            "history_conflict",
            "history_invalid",
            "input_invalid",
            "input_mutated",
            "peer_identity_conflict",
            "publication_exists",
            "publication_failed",
            "review_transition_invalid",
        }
    )

    def __init__(self, code: str):
        if code not in self.ALLOWED_CODES:
            code = "checkpoint_invalid"
        self.code = code
        super().__init__(code)


@dataclass(frozen=True)
class CaptureExpectations:
    capture_manifest_sha256: str
    raw_toc_sha256: str
    opaque_index_sha256: str
    entry_count: int
    data_reference_count: int
    evidence_run_id: str
    outer_archive_sha256: str
    inner_archive_sha256: str
    evidence_manifest_sha256: str
    inspection_checkout_sha: str
    inspection_procedure_sha256: str
    capture_execution_checkout_sha: str
    capture_procedure_identity_sha256: str
    approved_pg_restore_sha256: str


@dataclass(frozen=True)
class AuthoringBinding:
    execution_checkout_sha: str
    procedure_identity_sha256: str
    execution_python_identity_sha256: str

    def as_dict(self) -> dict[str, str]:
        try:
            checkout = validate_git_sha(self.execution_checkout_sha)
            procedure = validate_sha(self.procedure_identity_sha256)
            python_identity = validate_sha(self.execution_python_identity_sha256)
        except ContractError as exc:
            raise AuthoringContractError("binding_mismatch") from exc
        return {
            "execution_checkout_sha": checkout,
            "execution_python_identity_sha256": python_identity,
            "procedure_identity_sha256": procedure,
        }


@dataclass(frozen=True)
class GenerationOneBindingPolicy:
    """Exact historical-to-current checkpoint binding boundary.

    The policy is intentionally narrower than a general compatibility list.
    It can validate one immutable generation-1 checkpoint under the reviewed
    historical binding and later checkpoints under the current binding.  Only
    a caller that sets ``allow_successor_transition`` may create the single
    generation-1 to generation-2 boundary.
    """

    historical_binding: AuthoringBinding
    current_binding: AuthoringBinding
    allow_successor_transition: bool = False

    def __post_init__(self) -> None:
        exact_historical = AuthoringBinding(
            execution_checkout_sha=(
                "b1986e4079b52edbb4ef5cd4c56ed4d20af07195"
            ),
            procedure_identity_sha256=(
                "bc0b990d878db1e2c72bd4ac91314fe32261a454ac38505b7ea6df4af2b5f3d8"
            ),
            execution_python_identity_sha256=(
                "4b42b1a117605cafc8607b67b0892a609c2cd125012dd56288abeed8c89cdfb1"
            ),
        )
        if (
            type(self.allow_successor_transition) is not bool
            or self.historical_binding.as_dict() != exact_historical.as_dict()
            or self.current_binding.as_dict() == exact_historical.as_dict()
        ):
            raise AuthoringContractError("history_invalid")


@dataclass(frozen=True)
class AuthoringEntry:
    entry_id: str
    ordinal: int
    object_class: str
    is_data_reference: bool
    raw_line: bytes


@dataclass(frozen=True)
class AuthoringCapture:
    capture_binding: Mapping[str, Any]
    entries_by_ordinal: Tuple[AuthoringEntry, ...]
    package_device: int
    package_inode: int


@dataclass(frozen=True)
class CheckpointChain:
    checkpoints: Tuple[Mapping[str, Any], ...]
    hashes: Tuple[str, ...]

    @property
    def head(self) -> Optional[Mapping[str, Any]]:
        if not self.checkpoints:
            return None
        return self.checkpoints[-1]

    @property
    def head_sha256(self) -> Optional[str]:
        if not self.hashes:
            return None
        return self.hashes[-1]


def _fail(code: str, cause: Optional[BaseException] = None) -> None:
    error = AuthoringContractError(code)
    if cause is None:
        raise error
    raise error from cause


def _identity(value: Any) -> str:
    if (
        type(value) is not str
        or value != value.strip()
        or "  " in value
        or SAFE_IDENTITY_RE.fullmatch(value) is None
    ):
        _fail("input_invalid")
    return value


def _sha(value: Any) -> str:
    if type(value) is not str or SHA256_RE.fullmatch(value) is None:
        _fail("binding_mismatch")
    return value


def _exact_dict(value: Any, keys: Sequence[str], code: str) -> dict[str, Any]:
    if type(value) is not dict or set(value) != set(keys):
        _fail(code)
    return value


def _private_directory_metadata(directory_fd: int) -> os.stat_result:
    try:
        metadata = os.fstat(directory_fd)
    except OSError as exc:
        _fail("input_invalid", exc)
    if (
        not stat.S_ISDIR(metadata.st_mode)
        or metadata.st_uid != os.geteuid()
        or stat.S_IMODE(metadata.st_mode) != 0o700
    ):
        _fail("input_invalid")
    return metadata


def _package_names(package_fd: int) -> set[str]:
    try:
        names = set(os.listdir(package_fd))
    except (OSError, TypeError) as exc:
        _fail("capture_invalid", exc)
    if names != set(CAPTURE_FILES) | {"EVIDENCE_COMPLETE"}:
        _fail("capture_invalid")
    return names


def _read_capture_file(package_fd: int, name: str, maximum: int) -> bytes:
    try:
        return stable_private_file_at(
            package_fd, name, max_bytes=maximum, exact_mode=0o400
        ).data
    except ContractError as exc:
        _fail("capture_invalid", exc)


def _key_metadata_identity(metadata: os.stat_result) -> dict[str, int]:
    return {
        "opaque_key_ctime_ns": metadata.st_ctime_ns,
        "opaque_key_device": metadata.st_dev,
        "opaque_key_gid": metadata.st_gid,
        "opaque_key_inode": metadata.st_ino,
        "opaque_key_mode": stat.S_IMODE(metadata.st_mode),
        "opaque_key_mtime_ns": metadata.st_mtime_ns,
        "opaque_key_nlink": metadata.st_nlink,
        "opaque_key_size_bytes": metadata.st_size,
        "opaque_key_uid": metadata.st_uid,
    }


def _validate_key_metadata_without_open(package_fd: int) -> os.stat_result:
    """Validate only key metadata; the authoring path never opens key bytes."""

    try:
        metadata = os.stat("opaque-id.key", dir_fd=package_fd, follow_symlinks=False)
    except OSError as exc:
        _fail("capture_invalid", exc)
    if (
        not stat.S_ISREG(metadata.st_mode)
        or metadata.st_uid != os.geteuid()
        or metadata.st_nlink != 1
        or stat.S_IMODE(metadata.st_mode) != 0o400
        or metadata.st_size != 32
    ):
        _fail("capture_invalid")
    return metadata


def _parse_opaque_index(raw: bytes, structures: Sequence[RawTocEntry]) -> list[dict[str, Any]]:
    try:
        value = strict_json_loads(raw)
    except ContractError as exc:
        _fail("capture_invalid", exc)
    root = _exact_dict(value, ("artifact_kind", "entries", "format_version"), "capture_invalid")
    if (
        root["artifact_kind"] != "lovable_toc_opaque_index"
        or type(root["format_version"]) is not int
        or root["format_version"] != 1
    ):
        _fail("capture_invalid")
    if type(root["entries"]) is not list or len(root["entries"]) != len(structures):
        _fail("capture_invalid")
    result: list[dict[str, Any]] = []
    ids: set[str] = set()
    ordinals: set[int] = set()
    for raw_entry in root["entries"]:
        item = _exact_dict(
            raw_entry,
            ("entry_id", "is_data_reference", "object_class", "ordinal"),
            "capture_invalid",
        )
        entry_id = item["entry_id"]
        ordinal = item["ordinal"]
        if (
            type(entry_id) is not str
            or OPAQUE_ID_RE.fullmatch(entry_id) is None
            or type(ordinal) is not int
            or ordinal < 0
            or ordinal >= len(structures)
            or type(item["object_class"]) is not str
            or not item["object_class"].isascii()
            or type(item["is_data_reference"]) is not bool
            or entry_id in ids
            or ordinal in ordinals
        ):
            _fail("capture_invalid")
        structure = structures[ordinal]
        if (
            item["object_class"] != structure.object_class
            or item["is_data_reference"] != structure.is_data_reference
        ):
            _fail("binding_mismatch")
        ids.add(entry_id)
        ordinals.add(ordinal)
        result.append(dict(item))
    if ordinals != set(range(len(structures))):
        _fail("capture_invalid")
    if root["entries"] != sorted(root["entries"], key=lambda item: item["entry_id"]):
        _fail("capture_invalid")
    if raw != canonical_json_bytes(root):
        _fail("capture_invalid")
    return sorted(result, key=lambda item: item["ordinal"])


def _validate_capture_evidence_manifest(
    raw: bytes,
    *,
    expected_manifest_sha256: str,
    capture_bytes: bytes,
    raw_toc: bytes,
    index_bytes: bytes,
    capture: Mapping[str, Any],
) -> None:
    if sha256_bytes(raw) != expected_manifest_sha256:
        _fail("binding_mismatch")
    try:
        root = strict_json_loads(raw)
    except ContractError as exc:
        _fail("capture_invalid", exc)
    root = _exact_dict(root, ("artifact_kind", "files", "format_version"), "capture_invalid")
    if (
        root["artifact_kind"] != "lovable_toc_capture_evidence"
        or type(root["format_version"]) is not int
        or root["format_version"] != 1
    ):
        _fail("capture_invalid")
    if type(root["files"]) is not list or len(root["files"]) != 4:
        _fail("capture_invalid")
    records: dict[str, dict[str, Any]] = {}
    for raw_record in root["files"]:
        record = _exact_dict(raw_record, ("name", "sha256", "size_bytes"), "capture_invalid")
        name = record["name"]
        if (
            type(name) is not str
            or name in records
            or name not in set(CAPTURE_FILES) - {"evidence-files.json"}
            or type(record["sha256"]) is not str
            or SHA256_RE.fullmatch(record["sha256"]) is None
            or type(record["size_bytes"]) is not int
            or record["size_bytes"] <= 0
        ):
            _fail("capture_invalid")
        records[name] = dict(record)
    observed = {
        "capture.json": capture_bytes,
        "opaque-index.json": index_bytes,
        "raw-pg-restore-list.toc": raw_toc,
    }
    for name, data in observed.items():
        if records.get(name) != {
            "name": name,
            "sha256": sha256_bytes(data),
            "size_bytes": len(data),
        }:
            _fail("binding_mismatch")
    # The key is deliberately not opened.  Its manifest identity must still
    # agree with capture.json and its separately validated fixed 32-byte size.
    if records.get("opaque-id.key") != {
        "name": "opaque-id.key",
        "sha256": capture["opaque_key_sha256"],
        "size_bytes": 32,
    }:
        _fail("binding_mismatch")
    if raw != canonical_json_bytes(root):
        _fail("capture_invalid")


def _validate_complete_marker(raw: bytes, manifest_sha256: str) -> None:
    try:
        value = strict_json_loads(raw)
    except ContractError as exc:
        _fail("capture_invalid", exc)
    expected = {
        "artifact_kind": "lovable_toc_capture_complete",
        "evidence_files_sha256": manifest_sha256,
        "format_version": 1,
    }
    if value != expected or raw != canonical_json_bytes(expected):
        _fail("binding_mismatch")


def load_capture_for_authoring(
    package_fd: int, expectations: CaptureExpectations
) -> AuthoringCapture:
    """Load the private authoring inputs while never opening ``opaque-id.key``."""

    package_before = _private_directory_metadata(package_fd)
    _package_names(package_fd)
    key_before = _validate_key_metadata_without_open(package_fd)
    raw_toc = _read_capture_file(package_fd, "raw-pg-restore-list.toc", MAX_RAW_TOC_BYTES)
    index_bytes = _read_capture_file(package_fd, "opaque-index.json", MAX_LEDGER_BYTES)
    capture_bytes = _read_capture_file(package_fd, "capture.json", MAX_LEDGER_BYTES)
    evidence_bytes = _read_capture_file(package_fd, "evidence-files.json", MAX_LEDGER_BYTES)
    complete_bytes = _read_capture_file(package_fd, "EVIDENCE_COMPLETE", MAX_LEDGER_BYTES)
    _package_names(package_fd)
    key_after = _validate_key_metadata_without_open(package_fd)
    if _key_metadata_identity(key_before) != _key_metadata_identity(key_after):
        _fail("input_mutated")
    package_after = _private_directory_metadata(package_fd)
    if (
        package_before.st_dev,
        package_before.st_ino,
        package_before.st_mode,
        package_before.st_uid,
        package_before.st_mtime_ns,
        package_before.st_ctime_ns,
    ) != (
        package_after.st_dev,
        package_after.st_ino,
        package_after.st_mode,
        package_after.st_uid,
        package_after.st_mtime_ns,
        package_after.st_ctime_ns,
    ):
        _fail("input_mutated")

    for supplied in (
        expectations.capture_manifest_sha256,
        expectations.raw_toc_sha256,
        expectations.opaque_index_sha256,
        expectations.outer_archive_sha256,
        expectations.inner_archive_sha256,
        expectations.evidence_manifest_sha256,
        expectations.inspection_procedure_sha256,
        expectations.capture_procedure_identity_sha256,
        expectations.approved_pg_restore_sha256,
    ):
        _sha(supplied)
    try:
        validate_git_sha(expectations.inspection_checkout_sha)
        validate_git_sha(expectations.capture_execution_checkout_sha)
    except ContractError as exc:
        _fail("binding_mismatch", exc)
    if (
        type(expectations.evidence_run_id) is not str
        or not expectations.evidence_run_id
        or not expectations.evidence_run_id.isascii()
        or len(expectations.evidence_run_id) > 160
        or any(
            character not in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._:-"
            for character in expectations.evidence_run_id
        )
    ):
        _fail("input_invalid")
    if (
        type(expectations.entry_count) is not int
        or expectations.entry_count <= 0
        or expectations.entry_count > MAX_ENTRY_COUNT
        or type(expectations.data_reference_count) is not int
        or expectations.data_reference_count < 0
        or expectations.data_reference_count > expectations.entry_count
    ):
        _fail("input_invalid")
    try:
        capture = validate_capture_schema(strict_json_loads(capture_bytes))
    except ContractError as exc:
        _fail("capture_invalid", exc)
    if capture_bytes != canonical_json_bytes(capture):
        _fail("capture_invalid")
    if (
        sha256_bytes(raw_toc) != expectations.raw_toc_sha256
        or capture["raw_toc_sha256"] != expectations.raw_toc_sha256
        or capture["raw_toc_size_bytes"] != len(raw_toc)
        or sha256_bytes(index_bytes) != expectations.opaque_index_sha256
        or capture["opaque_index_sha256"] != expectations.opaque_index_sha256
        or capture["entry_count"] != expectations.entry_count
        or capture["data_reference_count"] != expectations.data_reference_count
    ):
        _fail("binding_mismatch")
    expected_capture_binding = {
        "evidence_manifest_sha256": expectations.evidence_manifest_sha256,
        "evidence_run_id": expectations.evidence_run_id,
        "execution_checkout_sha": expectations.capture_execution_checkout_sha,
        "inner_archive_sha256": expectations.inner_archive_sha256,
        "inspection_checkout_sha": expectations.inspection_checkout_sha,
        "inspection_procedure_sha256": expectations.inspection_procedure_sha256,
        "outer_archive_sha256": expectations.outer_archive_sha256,
        "procedure_identity_sha256": expectations.capture_procedure_identity_sha256,
    }
    if capture["binding"] != expected_capture_binding:
        _fail("binding_mismatch")
    pg_restore_identity = capture["pg_restore_identity"]
    if (
        pg_restore_identity["approved_identity"]
        != "sha256:" + expectations.approved_pg_restore_sha256
        or pg_restore_identity["sha256"] != expectations.approved_pg_restore_sha256
    ):
        _fail("binding_mismatch")
    _validate_capture_evidence_manifest(
        evidence_bytes,
        expected_manifest_sha256=expectations.capture_manifest_sha256,
        capture_bytes=capture_bytes,
        raw_toc=raw_toc,
        index_bytes=index_bytes,
        capture=capture,
    )
    _validate_complete_marker(complete_bytes, expectations.capture_manifest_sha256)
    try:
        structures = parse_raw_toc_structure(raw_toc)
    except ContractError as exc:
        _fail("capture_invalid", exc)
    index = _parse_opaque_index(index_bytes, structures)
    if (
        len(structures) != expectations.entry_count
        or sum(item.is_data_reference for item in structures)
        != expectations.data_reference_count
    ):
        _fail("binding_mismatch")
    entries = tuple(
        AuthoringEntry(
            entry_id=index_entry["entry_id"],
            ordinal=structure.ordinal,
            object_class=structure.object_class,
            is_data_reference=structure.is_data_reference,
            raw_line=structure.raw_line,
        )
        for structure, index_entry in zip(structures, index)
    )
    capture_binding = {
        "capture_json_sha256": sha256_bytes(capture_bytes),
        "capture_execution_checkout_sha": expectations.capture_execution_checkout_sha,
        "capture_manifest_sha256": expectations.capture_manifest_sha256,
        "data_reference_count": expectations.data_reference_count,
        "entry_count": expectations.entry_count,
        "evidence_manifest_sha256": capture["binding"]["evidence_manifest_sha256"],
        "evidence_run_id": capture["binding"]["evidence_run_id"],
        "inner_archive_sha256": capture["binding"]["inner_archive_sha256"],
        "inspection_checkout_sha": capture["binding"]["inspection_checkout_sha"],
        "inspection_procedure_sha256": capture["binding"]["inspection_procedure_sha256"],
        "opaque_index_sha256": expectations.opaque_index_sha256,
        "outer_archive_sha256": capture["binding"]["outer_archive_sha256"],
        "package_device": package_after.st_dev,
        "package_inode": package_after.st_ino,
        "pg_restore_identity_sha256": sha256_bytes(
            canonical_json_bytes(capture["pg_restore_identity"])
        ),
        "raw_toc_sha256": expectations.raw_toc_sha256,
        "raw_toc_size_bytes": len(raw_toc),
        "capture_procedure_identity_sha256": capture["binding"][
            "procedure_identity_sha256"
        ],
        **_key_metadata_identity(key_after),
    }
    return AuthoringCapture(
        capture_binding=capture_binding,
        entries_by_ordinal=entries,
        package_device=package_after.st_dev,
        package_inode=package_after.st_ino,
    )


def _required_review_kinds(entry: AuthoringEntry) -> list[str]:
    kinds = ["classification", "dependencies", "managed_domain"]
    if entry.object_class in RELATIONSHIP_PARENT_GROUPS:
        kinds.append("relationship")
    if entry.is_data_reference:
        kinds.append("data_reference")
    if entry.object_class in STATE_BEARING_REVIEW_CLASSES:
        kinds.append("sequence_state")
    kinds.append("peer")
    return sorted(kinds)


def _initial_decision(entry: AuthoringEntry) -> dict[str, Any]:
    return {
        "classification": None,
        "classification_reviewed": False,
        "data_reference_review_state": (
            "pending" if entry.is_data_reference else "not_applicable"
        ),
        "dependency_entry_ids": [],
        "dependency_reviewed": False,
        "managed_domain": None,
        "managed_domain_reviewed": False,
        "manual_conflict_disposition": None,
        "manual_conflict_review_state": "not_applicable",
        "metadata_parent_entry_id": None,
        "parent_entry_ids": [],
        "relationship_review_state": (
            "pending"
            if entry.object_class in RELATIONSHIP_PARENT_GROUPS
            else "not_applicable"
        ),
        "sequence_review_state": (
            "pending"
            if entry.object_class in STATE_BEARING_REVIEW_CLASSES
            else "not_applicable"
        ),
    }


def _decision_sha256(decision: Mapping[str, Any]) -> str:
    return sha256_bytes(canonical_json_bytes(decision))


def _pending_peer() -> dict[str, Any]:
    return {
        "operator_identity": None,
        "primary_decision_sha256": None,
        "session_identity": None,
        "status": "pending",
    }


def _rejected_decision_context(
    decision: Mapping[str, Any], entry: AuthoringEntry
) -> dict[str, Any]:
    """Retain prior choices but remove every human-approval claim."""

    rejected = _deep_copy(decision)
    rejected["classification_reviewed"] = False
    rejected["dependency_reviewed"] = False
    rejected["managed_domain_reviewed"] = False
    rejected["relationship_review_state"] = (
        "pending"
        if entry.object_class in RELATIONSHIP_PARENT_GROUPS
        else "not_applicable"
    )
    rejected["data_reference_review_state"] = (
        "pending" if entry.is_data_reference else "not_applicable"
    )
    rejected["sequence_review_state"] = (
        "pending"
        if entry.object_class in STATE_BEARING_REVIEW_CLASSES
        else "not_applicable"
    )
    rejected["manual_conflict_review_state"] = (
        "pending"
        if rejected["classification"] == "manual_conflict"
        else "not_applicable"
    )
    return rejected


def _initial_decision_record(value: Any = None) -> dict[str, Any]:
    return {
        "peer_review": _pending_peer(),
        "primary_decision_sha256": None,
        "primary_reviewed": False,
        "value": value,
    }


def initialize_checkpoint(
    capture: AuthoringCapture,
    binding: AuthoringBinding,
    primary_operator_identity: str,
    session_identity: str,
) -> dict[str, Any]:
    primary = _identity(primary_operator_identity)
    session = _identity(session_identity)
    entries: list[dict[str, Any]] = []
    for entry in capture.entries_by_ordinal:
        decision = _initial_decision(entry)
        entries.append(
            {
                "dependency_review_complete": False,
                "entry_id": entry.entry_id,
                "is_data_reference": entry.is_data_reference,
                "mechanical_proposal": {
                    "classification": "unresolved",
                    "forced_managed_domain": CLASS_MANAGED_DOMAINS.get(
                        entry.object_class
                    ),
                    "proposal_version": 1,
                    "required_review_kinds": _required_review_kinds(entry),
                },
                "object_class": entry.object_class,
                "ordinal": entry.ordinal,
                "peer_review": _pending_peer(),
                "primary_decision": decision,
                "primary_decision_sha256": _decision_sha256(decision),
            }
        )
    checkpoint = {
        "artifact_kind": CHECKPOINT_ARTIFACT_KIND,
        "authoring_binding": binding.as_dict(),
        "capture_binding": dict(capture.capture_binding),
        "entries": entries,
        "event": {
            "action": "initialize",
            "operator_identity": primary,
            "operator_role": "primary",
            "operator_session_identity": session,
            "reviewed_ordinal_ranges": [],
        },
        "format_version": CHECKPOINT_FORMAT_VERSION,
        "generation": 1,
        "global_decisions": {
            name: _initial_decision_record() for name in sorted(GLOBAL_HANDLING)
        },
        "managed_domain_decisions": {
            name: _initial_decision_record() for name in sorted(MANAGED_DOMAINS)
        },
        "peer_operator_identity": None,
        "previous_checkpoint_sha256": None,
        "primary_operator_identity": primary,
    }
    return validate_checkpoint(checkpoint, capture, binding)


def _validate_ranges(value: Any, entry_count: int) -> list[dict[str, int]]:
    if type(value) is not list:
        _fail("checkpoint_invalid")
    result: list[dict[str, int]] = []
    previous_end = -1
    for raw_range in value:
        item = _exact_dict(raw_range, ("end_exclusive", "start"), "checkpoint_invalid")
        start = item["start"]
        end = item["end_exclusive"]
        if (
            type(start) is not int
            or type(end) is not int
            or start < 0
            or end <= start
            or end > entry_count
            or start < previous_end
        ):
            _fail("checkpoint_invalid")
        previous_end = end
        result.append({"end_exclusive": end, "start": start})
    return result


def _ids(value: Any) -> list[str]:
    if type(value) is not list:
        _fail("checkpoint_invalid")
    result: list[str] = []
    for item in value:
        if type(item) is not str or OPAQUE_ID_RE.fullmatch(item) is None or item in result:
            _fail("checkpoint_invalid")
        result.append(item)
    return result


def _validate_decision(value: Any, entry: AuthoringEntry) -> dict[str, Any]:
    decision = _exact_dict(value, DECISION_KEYS, "checkpoint_invalid")
    classification = decision["classification"]
    if classification is not None and (
        type(classification) is not str or classification not in CLASSIFICATIONS
    ):
        _fail("checkpoint_invalid")
    if type(decision["classification_reviewed"]) is not bool:
        _fail("checkpoint_invalid")
    if decision["classification_reviewed"] and classification is None:
        _fail("checkpoint_invalid")
    if type(decision["dependency_reviewed"]) is not bool:
        _fail("checkpoint_invalid")
    domain = decision["managed_domain"]
    if domain is not None and (
        type(domain) is not str or domain not in ENTRY_MANAGED_DOMAINS
    ):
        _fail("checkpoint_invalid")
    if type(decision["managed_domain_reviewed"]) is not bool:
        _fail("checkpoint_invalid")
    if decision["managed_domain_reviewed"] and domain is None:
        _fail("checkpoint_invalid")
    disposition = decision["manual_conflict_disposition"]
    if disposition is not None and (
        type(disposition) is not str or disposition not in FINAL_DISPOSITIONS
    ):
        _fail("checkpoint_invalid")
    for key in (
        "data_reference_review_state",
        "manual_conflict_review_state",
        "relationship_review_state",
        "sequence_review_state",
    ):
        if type(decision[key]) is not str or decision[key] not in REVIEW_STATE_VALUES:
            _fail("checkpoint_invalid")
    if entry.is_data_reference:
        if decision["data_reference_review_state"] == "not_applicable":
            _fail("checkpoint_invalid")
    elif decision["data_reference_review_state"] != "not_applicable":
        _fail("checkpoint_invalid")
    relationship_required = entry.object_class in RELATIONSHIP_PARENT_GROUPS
    if relationship_required == (
        decision["relationship_review_state"] == "not_applicable"
    ):
        _fail("checkpoint_invalid")
    sequence_required = entry.object_class in STATE_BEARING_REVIEW_CLASSES
    if sequence_required == (decision["sequence_review_state"] == "not_applicable"):
        _fail("checkpoint_invalid")
    if classification == "manual_conflict":
        if decision["manual_conflict_review_state"] == "not_applicable":
            _fail("checkpoint_invalid")
    elif (
        disposition is not None
        or decision["manual_conflict_review_state"] != "not_applicable"
    ):
        _fail("checkpoint_invalid")
    metadata_parent = decision["metadata_parent_entry_id"]
    if metadata_parent is not None and (
        type(metadata_parent) is not str or OPAQUE_ID_RE.fullmatch(metadata_parent) is None
    ):
        _fail("checkpoint_invalid")
    decision = dict(decision)
    decision["parent_entry_ids"] = _ids(decision["parent_entry_ids"])
    decision["dependency_entry_ids"] = _ids(decision["dependency_entry_ids"])
    if (
        entry.entry_id in decision["parent_entry_ids"]
        or entry.entry_id in decision["dependency_entry_ids"]
        or set(decision["parent_entry_ids"]) & set(decision["dependency_entry_ids"])
        or metadata_parent == entry.entry_id
    ):
        _fail("checkpoint_invalid")
    return decision


def _validate_peer(value: Any, primary_sha: str) -> dict[str, Any]:
    peer = _exact_dict(
        value,
        ("operator_identity", "primary_decision_sha256", "session_identity", "status"),
        "checkpoint_invalid",
    )
    status_value = peer["status"]
    if type(status_value) is not str or status_value not in PEER_STATE_VALUES:
        _fail("checkpoint_invalid")
    if status_value == "pending":
        if any(
            peer[name] is not None
            for name in ("operator_identity", "primary_decision_sha256", "session_identity")
        ):
            _fail("checkpoint_invalid")
    else:
        _identity(peer["operator_identity"])
        _identity(peer["session_identity"])
        if peer["primary_decision_sha256"] != primary_sha:
            _fail("checkpoint_invalid")
    return dict(peer)


def _validate_decision_record(
    value: Any, allowed: Sequence[str]
) -> dict[str, Any]:
    record = _exact_dict(
        value,
        ("peer_review", "primary_decision_sha256", "primary_reviewed", "value"),
        "checkpoint_invalid",
    )
    if type(record["primary_reviewed"]) is not bool:
        _fail("checkpoint_invalid")
    selected = record["value"]
    if selected is not None and (type(selected) is not str or selected not in allowed):
        _fail("checkpoint_invalid")
    expected_sha: Optional[str] = None
    if record["primary_reviewed"]:
        if selected is None:
            _fail("checkpoint_invalid")
        expected_sha = sha256_bytes(canonical_json_bytes({"value": selected}))
        if record["primary_decision_sha256"] != expected_sha:
            _fail("checkpoint_invalid")
    elif record["primary_decision_sha256"] is not None:
        _fail("checkpoint_invalid")
    _validate_peer(record["peer_review"], expected_sha or "0" * 64)
    if not record["primary_reviewed"] and record["peer_review"]["status"] != "pending":
        _fail("checkpoint_invalid")
    return dict(record)


def validate_checkpoint(
    checkpoint: Any, capture: AuthoringCapture, binding: AuthoringBinding
) -> dict[str, Any]:
    root = _exact_dict(
        checkpoint,
        (
            "artifact_kind",
            "authoring_binding",
            "capture_binding",
            "entries",
            "event",
            "format_version",
            "generation",
            "global_decisions",
            "managed_domain_decisions",
            "peer_operator_identity",
            "previous_checkpoint_sha256",
            "primary_operator_identity",
        ),
        "checkpoint_invalid",
    )
    if (
        root["artifact_kind"] != CHECKPOINT_ARTIFACT_KIND
        or type(root["format_version"]) is not int
        or root["format_version"] != 1
    ):
        _fail("checkpoint_invalid")
    if root["authoring_binding"] != binding.as_dict():
        _fail("binding_mismatch")
    if root["capture_binding"] != dict(capture.capture_binding):
        _fail("binding_mismatch")
    generation = root["generation"]
    if type(generation) is not int or generation < 1:
        _fail("checkpoint_invalid")
    previous = root["previous_checkpoint_sha256"]
    if generation == 1:
        if previous is not None:
            _fail("checkpoint_invalid")
    elif type(previous) is not str or SHA256_RE.fullmatch(previous) is None:
        _fail("checkpoint_invalid")
    primary = _identity(root["primary_operator_identity"])
    peer_operator = root["peer_operator_identity"]
    if peer_operator is not None:
        peer_operator = _identity(peer_operator)
        if peer_operator.casefold() == primary.casefold():
            _fail("peer_identity_conflict")
    event = _exact_dict(
        root["event"],
        (
            "action",
            "operator_identity",
            "operator_role",
            "operator_session_identity",
            "reviewed_ordinal_ranges",
        ),
        "checkpoint_invalid",
    )
    if event["action"] not in CHECKPOINT_ACTIONS:
        _fail("checkpoint_invalid")
    _identity(event["operator_identity"])
    _identity(event["operator_session_identity"])
    if event["operator_role"] not in {"primary", "peer"}:
        _fail("checkpoint_invalid")
    if (event["action"] == "peer_review") != (event["operator_role"] == "peer"):
        _fail("checkpoint_invalid")
    ranges = _validate_ranges(event["reviewed_ordinal_ranges"], len(capture.entries_by_ordinal))
    if event["action"] == "initialize":
        if generation != 1 or ranges or event["operator_role"] != "primary":
            _fail("checkpoint_invalid")
    elif event["action"] in ENTRY_PHASES - RANGE_OPTIONAL_ACTIONS and not ranges:
        _fail("checkpoint_invalid")
    if event["operator_role"] == "primary" and event["operator_identity"] != primary:
        _fail("checkpoint_invalid")
    if event["operator_role"] == "peer" and event["operator_identity"] != peer_operator:
        _fail("peer_identity_conflict")

    raw_entries = root["entries"]
    if type(raw_entries) is not list or len(raw_entries) != len(capture.entries_by_ordinal):
        _fail("checkpoint_invalid")
    capture_ids = {entry.entry_id for entry in capture.entries_by_ordinal}
    for ordinal, (raw_entry, captured) in enumerate(
        zip(raw_entries, capture.entries_by_ordinal)
    ):
        entry = _exact_dict(
            raw_entry,
            (
                "dependency_review_complete",
                "entry_id",
                "is_data_reference",
                "mechanical_proposal",
                "object_class",
                "ordinal",
                "peer_review",
                "primary_decision",
                "primary_decision_sha256",
            ),
            "checkpoint_invalid",
        )
        if (
            entry["dependency_review_complete"] is not False
            or entry["entry_id"] != captured.entry_id
            or type(entry["ordinal"]) is not int
            or entry["ordinal"] != ordinal
            or entry["object_class"] != captured.object_class
            or entry["is_data_reference"] is not captured.is_data_reference
        ):
            _fail("checkpoint_invalid")
        proposal = _exact_dict(
            entry["mechanical_proposal"],
            (
                "classification",
                "forced_managed_domain",
                "proposal_version",
                "required_review_kinds",
            ),
            "checkpoint_invalid",
        )
        if type(proposal["proposal_version"]) is not int or proposal != {
            "classification": "unresolved",
            "forced_managed_domain": CLASS_MANAGED_DOMAINS.get(captured.object_class),
            "proposal_version": 1,
            "required_review_kinds": _required_review_kinds(captured),
        }:
            _fail("checkpoint_invalid")
        decision = _validate_decision(entry["primary_decision"], captured)
        references = set(decision["parent_entry_ids"]) | set(
            decision["dependency_entry_ids"]
        )
        if decision["metadata_parent_entry_id"] is not None:
            references.add(decision["metadata_parent_entry_id"])
        if not references.issubset(capture_ids):
            _fail("checkpoint_invalid")
        decision_sha = _decision_sha256(decision)
        if entry["primary_decision_sha256"] != decision_sha:
            _fail("checkpoint_invalid")
        _validate_peer(entry["peer_review"], decision_sha)
        if (
            entry["peer_review"]["status"] != "pending"
            and entry["peer_review"]["operator_identity"] != peer_operator
        ):
            _fail("peer_identity_conflict")

    global_decisions = _exact_dict(
        root["global_decisions"], GLOBAL_HANDLING, "checkpoint_invalid"
    )
    for name, allowed in GLOBAL_HANDLING.items():
        record = _validate_decision_record(global_decisions[name], allowed)
        peer = record["peer_review"]
        if peer["status"] != "pending" and peer["operator_identity"] != peer_operator:
            _fail("peer_identity_conflict")
    managed_decisions = _exact_dict(
        root["managed_domain_decisions"], MANAGED_DOMAINS, "checkpoint_invalid"
    )
    for name in MANAGED_DOMAINS:
        record = _validate_decision_record(managed_decisions[name], MANAGED_HANDLING)
        peer = record["peer_review"]
        if peer["status"] != "pending" and peer["operator_identity"] != peer_operator:
            _fail("peer_identity_conflict")
    return root


def checkpoint_bytes(checkpoint: Mapping[str, Any]) -> bytes:
    return canonical_json_bytes(checkpoint)


def checkpoint_sha256(checkpoint: Mapping[str, Any]) -> str:
    return sha256_bytes(checkpoint_bytes(checkpoint))


def checkpoint_filename(checkpoint: Mapping[str, Any]) -> str:
    generation = checkpoint.get("generation")
    if type(generation) is not int or generation < 1:
        _fail("checkpoint_invalid")
    return "checkpoint-g%016d-%s.json" % (generation, checkpoint_sha256(checkpoint))


def _ordinals_for_ranges(ranges: Sequence[Mapping[str, int]]) -> set[int]:
    result: set[int] = set()
    for item in ranges:
        result.update(range(item["start"], item["end_exclusive"]))
    return result


def _changed_keys(before: Mapping[str, Any], after: Mapping[str, Any]) -> set[str]:
    return {name for name in before if before[name] != after[name]}


def _validate_relationship_transition(
    action: str, before: Mapping[str, Any], after: Mapping[str, Any]
) -> None:
    before_decision = before["primary_decision"]
    after_decision = after["primary_decision"]
    parents_changed = (
        before_decision["parent_entry_ids"] != after_decision["parent_entry_ids"]
    )

    if action == "relationship_review":
        if (
            before_decision["dependency_reviewed"]
            and before_decision["relationship_review_state"] != "pending"
        ):
            _fail("review_transition_invalid")
    elif action == "relationship_correction":
        if (
            not before_decision["dependency_reviewed"]
            or before_decision["relationship_review_state"]
            not in {"reviewed", "not_applicable"}
            or after_decision["dependency_reviewed"] is not True
        ):
            _fail("review_transition_invalid")
        if before["object_class"] in RELATIONSHIP_PARENT_GROUPS:
            expected_relationship_state = (
                "pending"
                if parents_changed and not after_decision["parent_entry_ids"]
                else before_decision["relationship_review_state"]
            )
            if (
                after_decision["relationship_review_state"]
                != expected_relationship_state
            ):
                _fail("review_transition_invalid")
        elif (
            parents_changed
            or after_decision["relationship_review_state"]
            != before_decision["relationship_review_state"]
        ):
            _fail("review_transition_invalid")
        if (
            before_decision["dependency_entry_ids"]
            == after_decision["dependency_entry_ids"]
            and not parents_changed
        ):
            _fail("review_transition_invalid")
    else:
        _fail("review_transition_invalid")

    if before["object_class"] == "SEQUENCE OWNED BY" and parents_changed:
        if after_decision["sequence_review_state"] != "pending":
            _fail("review_transition_invalid")
    elif (
        after_decision["sequence_review_state"]
        != before_decision["sequence_review_state"]
    ):
        _fail("review_transition_invalid")


def _validate_primary_classification_transition(
    before: Mapping[str, Any], after: Mapping[str, Any]
) -> None:
    before_decision = before["primary_decision"]
    after_decision = after["primary_decision"]
    if after_decision["classification_reviewed"] is not True:
        _fail("review_transition_invalid")
    if (
        before_decision["manual_conflict_disposition"]
        != after_decision["manual_conflict_disposition"]
        and after_decision["manual_conflict_disposition"] is not None
    ):
        _fail("review_transition_invalid")
    if after_decision["manual_conflict_disposition"] is not None:
        _fail("review_transition_invalid")
    expected_review_state = (
        "pending"
        if after_decision["classification"] == "manual_conflict"
        else "not_applicable"
    )
    if after_decision["manual_conflict_review_state"] != expected_review_state:
        _fail("review_transition_invalid")


def _validate_transition(
    previous: Mapping[str, Any],
    current: Mapping[str, Any],
    *,
    binding_policy: GenerationOneBindingPolicy | None = None,
) -> None:
    if current["generation"] != previous["generation"] + 1:
        _fail("history_invalid")
    if current["previous_checkpoint_sha256"] != checkpoint_sha256(previous):
        _fail("history_invalid")
    for invariant in (
        "artifact_kind",
        "capture_binding",
        "format_version",
        "primary_operator_identity",
    ):
        if current[invariant] != previous[invariant]:
            _fail("history_invalid")
    if current["authoring_binding"] != previous["authoring_binding"]:
        if (
            binding_policy is None
            or previous["generation"] != 1
            or current["generation"] != 2
            or previous["authoring_binding"]
            != binding_policy.historical_binding.as_dict()
            or current["authoring_binding"] != binding_policy.current_binding.as_dict()
            or current["event"]["action"] != "primary_review"
        ):
            _fail("history_invalid")
    action = current["event"]["action"]
    if action == "initialize":
        _fail("history_invalid")
    if (
        action == "relationship_correction"
        and _review_phase_state(previous) != "FINALIZATION_REVIEW_REQUIRED"
    ):
        _fail("review_transition_invalid")
    covered = _ordinals_for_ranges(current["event"]["reviewed_ordinal_ranges"])
    if action == "peer_review":
        if current["peer_operator_identity"] != current["event"]["operator_identity"]:
            _fail("history_invalid")
        if previous["peer_operator_identity"] not in {
            None,
            current["peer_operator_identity"],
        }:
            _fail("history_invalid")
    elif current["peer_operator_identity"] != previous["peer_operator_identity"]:
        _fail("history_invalid")
    changed_entries = {
        ordinal
        for ordinal, (before, after) in enumerate(zip(previous["entries"], current["entries"]))
        if before != after
    }
    if changed_entries != covered:
        _fail("review_transition_invalid")
    if not changed_entries and not (
        previous["global_decisions"] != current["global_decisions"]
        or previous["managed_domain_decisions"]
        != current["managed_domain_decisions"]
    ):
        _fail("review_transition_invalid")
    if action == "peer_review":
        for ordinal in changed_entries:
            before = previous["entries"][ordinal]
            after = current["entries"][ordinal]
            if (
                after["peer_review"]["operator_identity"]
                != current["event"]["operator_identity"]
                or after["peer_review"]["session_identity"]
                != current["event"]["operator_session_identity"]
            ):
                _fail("history_invalid")
            if after["peer_review"]["status"] == "approved":
                if (
                    before["primary_decision"] != after["primary_decision"]
                    or before["primary_decision_sha256"]
                    != after["primary_decision_sha256"]
                    or _changed_keys(before, after) - {"peer_review"}
                ):
                    _fail("review_transition_invalid")
            else:
                expected = _rejected_decision_context(
                    before["primary_decision"],
                    # The structural entry is recoverable from the immutable
                    # record without exposing its raw private context.
                    AuthoringEntry(
                        entry_id=before["entry_id"],
                        ordinal=before["ordinal"],
                        object_class=before["object_class"],
                        is_data_reference=before["is_data_reference"],
                        raw_line=b"",
                    ),
                )
                if (
                    after["primary_decision"] != expected
                    or after["primary_decision_sha256"]
                    != _decision_sha256(expected)
                    or _changed_keys(before, after)
                    - {"peer_review", "primary_decision", "primary_decision_sha256"}
                ):
                    _fail("review_transition_invalid")
    else:
        allowed = DECISION_FIELDS_BY_ACTION[action]
        for ordinal in changed_entries:
            before = previous["entries"][ordinal]
            after = current["entries"][ordinal]
            if _changed_keys(before, after) - {
                "peer_review",
                "primary_decision",
                "primary_decision_sha256",
            }:
                _fail("review_transition_invalid")
            if (
                _changed_keys(before["primary_decision"], after["primary_decision"])
                - allowed
            ):
                _fail("review_transition_invalid")
            if action in {"relationship_review", "relationship_correction"}:
                _validate_relationship_transition(action, before, after)
            if action in {"primary_review", "revisit_unresolved"}:
                _validate_primary_classification_transition(before, after)
            if after["peer_review"] != _pending_peer():
                _fail("review_transition_invalid")
    if action != "managed_review" and action != "peer_review":
        if (
            previous["global_decisions"] != current["global_decisions"]
            or previous["managed_domain_decisions"]
            != current["managed_domain_decisions"]
        ):
            _fail("review_transition_invalid")
    elif action == "managed_review":
        for section in ("global_decisions", "managed_domain_decisions"):
            for name, before in previous[section].items():
                after = current[section][name]
                if before == after:
                    continue
                if (
                    after["peer_review"] != _pending_peer()
                    or not after["primary_reviewed"]
                    or after["primary_decision_sha256"]
                    != sha256_bytes(canonical_json_bytes({"value": after["value"]}))
                ):
                    _fail("review_transition_invalid")
    else:
        for section in ("global_decisions", "managed_domain_decisions"):
            for name, before in previous[section].items():
                after = current[section][name]
                if before == after:
                    continue
                if (
                    before["value"] != after["value"]
                    or before["primary_reviewed"] != after["primary_reviewed"]
                    or before["primary_decision_sha256"]
                    != after["primary_decision_sha256"]
                    or after["peer_review"]["operator_identity"]
                    != current["event"]["operator_identity"]
                    or after["peer_review"]["session_identity"]
                    != current["event"]["operator_session_identity"]
                ):
                    _fail("review_transition_invalid")


def _deep_copy(value: Any) -> Any:
    try:
        return strict_json_loads(canonical_json_bytes(value))
    except ContractError as exc:
        _fail("checkpoint_invalid", exc)


def _review_record(value: str) -> dict[str, Any]:
    digest = sha256_bytes(canonical_json_bytes({"value": value}))
    return {
        "peer_review": _pending_peer(),
        "primary_decision_sha256": digest,
        "primary_reviewed": True,
        "value": value,
    }


def _peer_record(
    record: Mapping[str, Any], status_value: str, operator: str, session: str
) -> dict[str, Any]:
    if not record["primary_reviewed"] or record["primary_decision_sha256"] is None:
        _fail("review_transition_invalid")
    if status_value not in {"approved", "changes_requested"}:
        _fail("review_transition_invalid")
    updated = _deep_copy(record)
    updated["peer_review"] = {
        "operator_identity": operator,
        "primary_decision_sha256": record["primary_decision_sha256"],
        "session_identity": session,
        "status": status_value,
    }
    return updated


def apply_transition(
    previous: Mapping[str, Any],
    capture: AuthoringCapture,
    binding: AuthoringBinding,
    *,
    action: str,
    operator_identity: str,
    session_identity: str,
    reviewed_ordinal_ranges: Sequence[Mapping[str, int]],
    entry_updates: Sequence[Mapping[str, Any]] = (),
    global_updates: Optional[Mapping[str, str]] = None,
    managed_updates: Optional[Mapping[str, str]] = None,
    binding_policy: GenerationOneBindingPolicy | None = None,
) -> dict[str, Any]:
    previous_binding = binding
    crossing_generation_one_boundary = False
    if (
        binding_policy is not None
        and previous.get("generation") == 1
        and previous.get("authoring_binding")
        == binding_policy.historical_binding.as_dict()
    ):
        if (
            not binding_policy.allow_successor_transition
            or binding != binding_policy.current_binding
            or action != "primary_review"
        ):
            _fail("history_invalid")
        previous_binding = binding_policy.historical_binding
        crossing_generation_one_boundary = True
    previous = validate_checkpoint(previous, capture, previous_binding)
    if action not in CHECKPOINT_ACTIONS - {"initialize"}:
        _fail("review_transition_invalid")
    operator = _identity(operator_identity)
    session = _identity(session_identity)
    ranges = _validate_ranges(list(reviewed_ordinal_ranges), len(capture.entries_by_ordinal))
    current = _deep_copy(previous)
    current["generation"] += 1
    current["previous_checkpoint_sha256"] = checkpoint_sha256(previous)
    if crossing_generation_one_boundary:
        current["authoring_binding"] = binding.as_dict()
    role = "peer" if action == "peer_review" else "primary"
    if role == "primary" and operator != previous["primary_operator_identity"]:
        _fail("review_transition_invalid")
    if role == "peer":
        if operator == previous["primary_operator_identity"]:
            _fail("peer_identity_conflict")
        existing_peer = previous["peer_operator_identity"]
        if existing_peer is not None and existing_peer != operator:
            _fail("peer_identity_conflict")
        current["peer_operator_identity"] = operator
    current["event"] = {
        "action": action,
        "operator_identity": operator,
        "operator_role": role,
        "operator_session_identity": session,
        "reviewed_ordinal_ranges": ranges,
    }
    expected_ordinals = _ordinals_for_ranges(ranges)
    observed_ordinals: set[int] = set()
    for raw_update in entry_updates:
        if action == "peer_review":
            update = _exact_dict(
                raw_update,
                ("ordinal", "peer_status", "primary_decision_sha256"),
                "review_transition_invalid",
            )
        else:
            update = _exact_dict(
                raw_update,
                ("ordinal", "primary_decision"),
                "review_transition_invalid",
            )
        ordinal = update["ordinal"]
        if (
            type(ordinal) is not int
            or ordinal not in expected_ordinals
            or ordinal in observed_ordinals
        ):
            _fail("review_transition_invalid")
        observed_ordinals.add(ordinal)
        record = current["entries"][ordinal]
        if action == "peer_review":
            if update["primary_decision_sha256"] != record["primary_decision_sha256"]:
                _fail("review_transition_invalid")
            if update["peer_status"] not in {"approved", "changes_requested"}:
                _fail("review_transition_invalid")
            if update["peer_status"] == "changes_requested":
                rejected = _rejected_decision_context(
                    record["primary_decision"], capture.entries_by_ordinal[ordinal]
                )
                record["primary_decision"] = rejected
                record["primary_decision_sha256"] = _decision_sha256(rejected)
            record["peer_review"] = {
                "operator_identity": operator,
                "primary_decision_sha256": record["primary_decision_sha256"],
                "session_identity": session,
                "status": update["peer_status"],
            }
        else:
            new_decision = _validate_decision(
                update["primary_decision"], capture.entries_by_ordinal[ordinal]
            )
            changed = _changed_keys(record["primary_decision"], new_decision)
            if not changed or changed - DECISION_FIELDS_BY_ACTION[action]:
                _fail("review_transition_invalid")
            record["primary_decision"] = new_decision
            record["primary_decision_sha256"] = _decision_sha256(new_decision)
            record["peer_review"] = _pending_peer()
    if observed_ordinals != expected_ordinals:
        _fail("review_transition_invalid")

    supplied_global = dict(global_updates or {})
    supplied_managed = dict(managed_updates or {})
    if action == "managed_review":
        for name, value in supplied_global.items():
            if name not in GLOBAL_HANDLING or value not in GLOBAL_HANDLING[name]:
                _fail("review_transition_invalid")
            current["global_decisions"][name] = _review_record(value)
        for name, value in supplied_managed.items():
            if name not in MANAGED_DOMAINS or value not in MANAGED_HANDLING:
                _fail("review_transition_invalid")
            current["managed_domain_decisions"][name] = _review_record(value)
    elif action == "peer_review":
        for name, value in supplied_global.items():
            if name not in GLOBAL_HANDLING:
                _fail("review_transition_invalid")
            current["global_decisions"][name] = _peer_record(
                current["global_decisions"][name], value, operator, session
            )
        for name, value in supplied_managed.items():
            if name not in MANAGED_DOMAINS:
                _fail("review_transition_invalid")
            current["managed_domain_decisions"][name] = _peer_record(
                current["managed_domain_decisions"][name], value, operator, session
            )
    elif supplied_global or supplied_managed:
        _fail("review_transition_invalid")

    current = validate_checkpoint(current, capture, binding)
    _validate_transition(previous, current, binding_policy=binding_policy)
    return current


def load_checkpoint_chain(
    checkpoints_fd: int,
    capture: AuthoringCapture,
    binding: AuthoringBinding,
    *,
    binding_policy: GenerationOneBindingPolicy | None = None,
) -> CheckpointChain:
    _private_directory_metadata(checkpoints_fd)
    try:
        names = os.listdir(checkpoints_fd)
    except (OSError, TypeError) as exc:
        _fail("history_invalid", exc)
    parsed_names: list[tuple[int, str, str]] = []
    for name in names:
        match = CHECKPOINT_NAME_RE.fullmatch(name)
        if match is None:
            _fail("history_conflict")
        parsed_names.append((int(match.group(1)), match.group(2), name))
    parsed_names.sort()
    checkpoints: list[Mapping[str, Any]] = []
    hashes: list[str] = []
    for expected_generation, (generation, name_sha, name) in enumerate(
        parsed_names, start=1
    ):
        if generation != expected_generation:
            _fail("history_conflict")
        try:
            file = stable_private_file_at(
                checkpoints_fd,
                name,
                max_bytes=MAX_CHECKPOINT_BYTES,
                exact_mode=0o400,
            )
            checkpoint = strict_json_loads(file.data)
        except ContractError as exc:
            _fail("history_invalid", exc)
        if file.sha256 != name_sha or file.data != canonical_json_bytes(checkpoint):
            _fail("history_invalid")
        checkpoint_binding = binding
        if binding_policy is not None:
            if binding.as_dict() != binding_policy.current_binding.as_dict():
                _fail("history_invalid")
            if checkpoint.get("generation") == 1:
                if (
                    checkpoint.get("authoring_binding")
                    != binding_policy.historical_binding.as_dict()
                ):
                    _fail("history_invalid")
                checkpoint_binding = binding_policy.historical_binding
            elif (
                checkpoint.get("authoring_binding")
                != binding_policy.current_binding.as_dict()
            ):
                _fail("history_invalid")
            else:
                checkpoint_binding = binding_policy.current_binding
        checkpoint = validate_checkpoint(checkpoint, capture, checkpoint_binding)
        if checkpoint["generation"] != expected_generation:
            _fail("history_invalid")
        if checkpoints:
            _validate_transition(
                checkpoints[-1],
                checkpoint,
                binding_policy=binding_policy,
            )
        elif checkpoint["event"]["action"] != "initialize":
            _fail("history_invalid")
        checkpoints.append(checkpoint)
        hashes.append(name_sha)
    return CheckpointChain(tuple(checkpoints), tuple(hashes))


def _write_all(descriptor: int, data: bytes) -> None:
    offset = 0
    while offset < len(data):
        written = os.write(descriptor, data[offset:])
        if written <= 0:
            _fail("publication_failed")
        offset += written


def publish_checkpoint_at(
    checkpoints_fd: int,
    checkpoint: Mapping[str, Any],
    *,
    fail_stage: Optional[str] = None,
) -> str:
    """Atomically publish one immutable generation beneath an open root."""

    _private_directory_metadata(checkpoints_fd)
    data = checkpoint_bytes(checkpoint)
    final_name = checkpoint_filename(checkpoint)
    pending_name = ".pending-checkpoint-%s" % secrets.token_hex(12)
    pending_created = False
    renamed = False
    descriptor: Optional[int] = None

    def cleanup_failed_checkpoint() -> None:
        target = final_name if renamed else pending_name
        try:
            os.unlink(target, dir_fd=checkpoints_fd)
            os.fsync(checkpoints_fd)
            return
        except OSError as cleanup_error:
            if renamed:
                quarantine = ".indeterminate-checkpoint-%s" % secrets.token_hex(12)
                try:
                    _rename_no_replace(checkpoints_fd, final_name, quarantine)
                    os.fsync(checkpoints_fd)
                except (ContractError, OSError):
                    pass
            _fail("cleanup_indeterminate", cleanup_error)

    try:
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_CLOEXEC", 0)
        flags |= getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(pending_name, flags, 0o400, dir_fd=checkpoints_fd)
        pending_created = True
        if fail_stage == "partial_write":
            _write_all(descriptor, data[: max(1, len(data) // 2)])
            os.fsync(descriptor)
            _fail("publication_failed")
        _write_all(descriptor, data)
        os.fsync(descriptor)
        os.fchmod(descriptor, 0o400)
        os.close(descriptor)
        descriptor = None
        if fail_stage == "before_rename":
            _fail("publication_failed")
        try:
            _rename_no_replace(checkpoints_fd, pending_name, final_name)
        except ContractError as exc:
            if exc.code == "publication_exists":
                _fail("publication_exists", exc)
            _fail("publication_failed", exc)
        renamed = True
        if fail_stage == "after_rename":
            _fail("publication_failed")
        if fail_stage == "post_rename_mode":
            os.chmod(final_name, 0o600, dir_fd=checkpoints_fd, follow_symlinks=False)
        if fail_stage == "post_rename_substitute":
            os.unlink(final_name, dir_fd=checkpoints_fd)
            substitute_flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
            substitute_flags |= getattr(os, "O_NOFOLLOW", 0)
            substitute = os.open(final_name, substitute_flags, 0o400, dir_fd=checkpoints_fd)
            try:
                _write_all(substitute, b"{}\n")
                os.fsync(substitute)
            finally:
                os.close(substitute)
        try:
            readback = stable_private_file_at(
                checkpoints_fd,
                final_name,
                max_bytes=MAX_CHECKPOINT_BYTES,
                exact_mode=0o400,
            )
        except ContractError as readback_error:
            _fail("publication_failed", readback_error)
        if readback.data != data or readback.sha256 != sha256_bytes(data):
            _fail("publication_failed")
        if fail_stage == "after_readback":
            _fail("publication_failed")
        os.fsync(checkpoints_fd)
        if fail_stage == "after_fsync":
            _fail("publication_failed")
        try:
            final_readback = stable_private_file_at(
                checkpoints_fd,
                final_name,
                max_bytes=MAX_CHECKPOINT_BYTES,
                exact_mode=0o400,
            )
        except ContractError as readback_error:
            _fail("publication_failed", readback_error)
        if final_readback.data != data or final_readback.sha256 != sha256_bytes(data):
            _fail("publication_failed")
        return final_name
    except AuthoringContractError as exc:
        if descriptor is not None:
            try:
                os.close(descriptor)
            except OSError:
                pass
        if pending_created:
            cleanup_failed_checkpoint()
        raise exc
    except BaseException as exc:
        if descriptor is not None:
            try:
                os.close(descriptor)
            except OSError:
                pass
        if pending_created:
            cleanup_failed_checkpoint()
        _fail("publication_failed", exc)


def publish_final_candidate_at(
    private_root_fd: int,
    ledger_bytes: bytes,
    finalization_bytes: bytes,
    checkpoint_head_sha256: str,
    *,
    fail_stage: Optional[str] = None,
) -> str:
    """Atomically publish one private, unvalidated final-candidate package.

    The completion marker is deliberately created *after* the no-replace
    directory publication and descriptor-relative readback of every evidence
    file.  A failure after publication therefore either removes the package or
    makes it visibly indeterminate; it must never leave a normal-looking
    completed package behind.
    """

    _private_directory_metadata(private_root_fd)
    if (
        type(ledger_bytes) is not bytes
        or not ledger_bytes
        or len(ledger_bytes) > MAX_LEDGER_BYTES
        or type(finalization_bytes) is not bytes
        or not finalization_bytes
        or len(finalization_bytes) > MAX_LEDGER_BYTES
        or type(checkpoint_head_sha256) is not str
        or SHA256_RE.fullmatch(checkpoint_head_sha256) is None
    ):
        _fail("publication_failed")
    final_name = "final-ledger-%s" % checkpoint_head_sha256[:12]
    pending_name = ".pending-final-ledger-%s" % secrets.token_hex(12)
    pending_created = False
    renamed = False
    package_fd: Optional[int] = None

    evidence = canonical_json_bytes(
        {
            "artifact_kind": "lovable_toc_authoring_final_evidence",
            "files": [
                {
                    "name": "annotation-ledger.json",
                    "sha256": sha256_bytes(ledger_bytes),
                    "size_bytes": len(ledger_bytes),
                },
                {
                    "name": "authoring-finalization.json",
                    "sha256": sha256_bytes(finalization_bytes),
                    "size_bytes": len(finalization_bytes),
                },
            ],
            "format_version": 1,
        }
    )
    complete = canonical_json_bytes(
        {
            "artifact_kind": "lovable_toc_authoring_final_complete",
            "evidence_files_sha256": sha256_bytes(evidence),
            "format_version": 1,
        }
    )
    evidence_files = (
        ("annotation-ledger.json", ledger_bytes),
        ("authoring-finalization.json", finalization_bytes),
        ("evidence-files.json", evidence),
    )

    complete_file = ("EVIDENCE_COMPLETE", complete)
    all_files = evidence_files + (complete_file,)

    def open_package(target: str) -> int:
        flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
        flags |= getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0)
        try:
            descriptor = os.open(target, flags, dir_fd=private_root_fd)
            _private_directory_metadata(descriptor)
            return descriptor
        except AuthoringContractError:
            try:
                os.close(descriptor)
            except (OSError, UnboundLocalError):
                pass
            raise
        except OSError as exc:
            try:
                os.close(descriptor)
            except (OSError, UnboundLocalError):
                pass
            _fail("publication_failed", exc)

    def write_file(package_descriptor: int, name: str, data: bytes) -> None:
        descriptor: Optional[int] = None
        try:
            file_flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
            file_flags |= getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0)
            descriptor = os.open(name, file_flags, 0o400, dir_fd=package_descriptor)
            _write_all(descriptor, data)
            os.fchmod(descriptor, 0o400)
            os.fsync(descriptor)
        except AuthoringContractError:
            raise
        except OSError as exc:
            _fail("publication_failed", exc)
        finally:
            if descriptor is not None:
                try:
                    os.close(descriptor)
                except OSError as exc:
                    _fail("publication_failed", exc)

    def verify_package(
        package_descriptor: int,
        expected_files: Sequence[tuple[str, bytes]],
    ) -> None:
        try:
            observed_names = set(os.listdir(package_descriptor))
        except (OSError, TypeError) as exc:
            _fail("publication_failed", exc)
        if observed_names != {name for name, _ in expected_files}:
            _fail("publication_failed")
        for name, expected in expected_files:
            try:
                observed = stable_private_file_at(
                    package_descriptor,
                    name,
                    max_bytes=MAX_LEDGER_BYTES,
                    exact_mode=0o400,
                )
            except ContractError as exc:
                _fail("publication_failed", exc)
            if observed.data != expected or observed.sha256 != sha256_bytes(expected):
                _fail("publication_failed")

    def quarantine(target: str) -> bool:
        """Ensure ``target`` cannot be mistaken for a complete package."""

        quarantine_name = ".indeterminate-final-ledger-%s" % secrets.token_hex(12)
        try:
            _rename_no_replace(private_root_fd, target, quarantine_name)
            os.fsync(private_root_fd)
            return True
        except (ContractError, OSError):
            pass
        quarantine_fd: Optional[int] = None
        try:
            quarantine_fd = open_package(target)
            try:
                os.unlink("EVIDENCE_COMPLETE", dir_fd=quarantine_fd)
            except FileNotFoundError:
                pass
            marker = canonical_json_bytes(
                {
                    "artifact_kind": "lovable_toc_authoring_indeterminate",
                    "format_version": 1,
                }
            )
            try:
                write_file(quarantine_fd, "EVIDENCE_INDETERMINATE", marker)
            except AuthoringContractError:
                existing = stable_private_file_at(
                    quarantine_fd,
                    "EVIDENCE_INDETERMINATE",
                    max_bytes=len(marker),
                    exact_mode=0o400,
                )
                if existing.data != marker:
                    return False
            os.fsync(quarantine_fd)
            os.fsync(private_root_fd)
            return True
        except (AuthoringContractError, ContractError, OSError):
            return False
        finally:
            if quarantine_fd is not None:
                try:
                    os.close(quarantine_fd)
                except OSError:
                    pass

    def cleanup(target: str, *, was_renamed: bool) -> None:
        cleanup_fd: Optional[int] = None
        try:
            cleanup_fd = open_package(target)
            # A completed package must first cease looking complete.  This
            # ordering matters if a later unlink or fsync fails.
            if was_renamed:
                try:
                    os.unlink("EVIDENCE_COMPLETE", dir_fd=cleanup_fd)
                except FileNotFoundError:
                    pass
                os.fsync(cleanup_fd)
            for name, _ in all_files:
                if name == "EVIDENCE_COMPLETE":
                    continue
                try:
                    os.unlink(name, dir_fd=cleanup_fd)
                except FileNotFoundError:
                    pass
            if os.listdir(cleanup_fd):
                _fail("cleanup_indeterminate")
            os.fsync(cleanup_fd)
            os.close(cleanup_fd)
            cleanup_fd = None
            os.rmdir(target, dir_fd=private_root_fd)
            os.fsync(private_root_fd)
        except (AuthoringContractError, OSError) as exc:
            if was_renamed and quarantine(target):
                _fail("cleanup_indeterminate", exc)
            _fail("cleanup_indeterminate", exc)
        finally:
            if cleanup_fd is not None:
                try:
                    os.close(cleanup_fd)
                except OSError:
                    pass

    try:
        os.mkdir(pending_name, 0o700, dir_fd=private_root_fd)
        pending_created = True
        package_fd = open_package(pending_name)
        for index, (name, data) in enumerate(evidence_files):
            if fail_stage == "partial_write" and index == 0:
                descriptor = os.open(
                    name,
                    os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
                    0o400,
                    dir_fd=package_fd,
                )
                try:
                    _write_all(descriptor, data[: max(1, len(data) // 2)])
                    os.fsync(descriptor)
                finally:
                    os.close(descriptor)
                _fail("publication_failed")
            write_file(package_fd, name, data)
        verify_package(package_fd, evidence_files)
        os.fsync(package_fd)
        os.close(package_fd)
        package_fd = None
        if fail_stage == "before_rename":
            _fail("publication_failed")
        try:
            _rename_no_replace(private_root_fd, pending_name, final_name)
        except ContractError as exc:
            if exc.code == "publication_exists":
                _fail("publication_exists", exc)
            _fail("publication_failed", exc)
        renamed = True
        if fail_stage == "after_rename":
            _fail("publication_failed")
        os.fsync(private_root_fd)
        if fail_stage in {"after_fsync", "after_rename_fsync"}:
            _fail("publication_failed")
        package_fd = open_package(final_name)
        verify_package(package_fd, evidence_files)
        if fail_stage == "before_complete":
            _fail("publication_failed")
        write_file(package_fd, *complete_file)
        if fail_stage == "after_complete":
            _fail("publication_failed")
        verify_package(package_fd, all_files)
        os.fsync(package_fd)
        if fail_stage == "after_package_fsync":
            _fail("publication_failed")
        os.fsync(private_root_fd)
        if fail_stage == "after_final_fsync":
            _fail("publication_failed")
        verify_package(package_fd, all_files)
        os.close(package_fd)
        package_fd = None
        return final_name
    except AuthoringContractError as exc:
        if package_fd is not None:
            try:
                os.close(package_fd)
            except OSError:
                pass
        target = final_name if renamed else pending_name
        if pending_created:
            cleanup(target, was_renamed=renamed)
        raise exc
    except BaseException as exc:
        if package_fd is not None:
            try:
                os.close(package_fd)
            except OSError:
                pass
        target = final_name if renamed else pending_name
        if pending_created:
            cleanup(target, was_renamed=renamed)
        _fail("publication_failed", exc)


def next_review_ordinals(
    checkpoint: Mapping[str, Any], phase: str, batch_size: int = 100
) -> Tuple[int, ...]:
    if type(batch_size) is not int or batch_size < 1 or batch_size > 1000:
        _fail("input_invalid")
    result: list[int] = []
    for entry in checkpoint["entries"]:
        decision = entry["primary_decision"]
        needed = False
        if phase == "primary_review":
            needed = not decision["classification_reviewed"]
        elif phase == "revisit_unresolved":
            needed = decision["classification"] == "unresolved"
        elif phase == "relationship_review":
            needed = (
                decision["dependency_reviewed"] is False
                or decision["relationship_review_state"] == "pending"
            )
        elif phase == "data_reference_review":
            needed = decision["data_reference_review_state"] == "pending"
        elif phase == "sequence_review":
            needed = decision["sequence_review_state"] == "pending"
        elif phase == "managed_review":
            needed = not decision["managed_domain_reviewed"]
        elif phase == "manual_conflict_review":
            needed = decision["manual_conflict_review_state"] == "pending"
        elif phase == "peer_review":
            needed = entry["peer_review"]["status"] != "approved"
        else:
            _fail("input_invalid")
        if needed:
            result.append(entry["ordinal"])
            if len(result) == batch_size:
                break
    return tuple(result)


def _primary_complete(entry: Mapping[str, Any]) -> bool:
    decision = entry["primary_decision"]
    return (
        decision["classification_reviewed"]
        and decision["classification"] is not None
        and decision["dependency_reviewed"]
        and decision["relationship_review_state"] != "pending"
        and decision["data_reference_review_state"] != "pending"
        and decision["sequence_review_state"] != "pending"
        and decision["managed_domain_reviewed"]
        and decision["manual_conflict_review_state"] != "pending"
    )


def _review_phase_state(checkpoint: Mapping[str, Any]) -> str:
    entries = checkpoint["entries"]
    classification_counts: Counter[str] = Counter(
        entry["primary_decision"]["classification"]
        for entry in entries
        if entry["primary_decision"]["classification"] in CLASSIFICATIONS
    )
    if any(not item["primary_decision"]["classification_reviewed"] for item in entries):
        state = "PRIMARY_REVIEW_REQUIRED"
    elif classification_counts["unresolved"]:
        state = "REVISIT_REQUIRED"
    elif any(
        not item["primary_decision"]["dependency_reviewed"]
        or item["primary_decision"]["relationship_review_state"] == "pending"
        for item in entries
    ):
        state = "RELATIONSHIP_REVIEW_REQUIRED"
    elif any(
        item["primary_decision"]["data_reference_review_state"] == "pending"
        for item in entries
    ):
        state = "DATA_REFERENCE_REVIEW_REQUIRED"
    elif any(
        item["primary_decision"]["sequence_review_state"] == "pending"
        for item in entries
    ):
        state = "SEQUENCE_REVIEW_REQUIRED"
    elif any(
        not item["primary_decision"]["managed_domain_reviewed"] for item in entries
    ) or any(
        not item["primary_reviewed"]
        for item in checkpoint["global_decisions"].values()
    ) or any(
        not item["primary_reviewed"]
        for item in checkpoint["managed_domain_decisions"].values()
    ):
        state = "MANAGED_GLOBAL_REVIEW_REQUIRED"
    elif any(
        item["primary_decision"]["manual_conflict_review_state"] == "pending"
        for item in entries
    ):
        state = "MANUAL_CONFLICT_REVIEW_REQUIRED"
    elif any(item["peer_review"]["status"] != "approved" for item in entries) or any(
        item["peer_review"]["status"] != "approved"
        for item in checkpoint["global_decisions"].values()
    ) or any(
        item["peer_review"]["status"] != "approved"
        for item in checkpoint["managed_domain_decisions"].values()
    ):
        state = "PEER_REVIEW_REQUIRED"
    else:
        state = "FINALIZATION_REVIEW_REQUIRED"
    return state


def aggregate_status(
    checkpoint: Mapping[str, Any], capture: AuthoringCapture
) -> dict[str, Any]:
    entries = checkpoint["entries"]
    classification_counts: Counter[str] = Counter()
    for entry in entries:
        value = entry["primary_decision"]["classification"]
        if value in CLASSIFICATIONS:
            classification_counts[value] += 1
    counts = {
        "data_reference_count": sum(item.is_data_reference for item in capture.entries_by_ordinal),
        "data_reference_reviewed_count": sum(
            item["primary_decision"]["data_reference_review_state"] == "reviewed"
            for item in entries
        ),
        "entry_count": len(entries),
        "manual_conflict_pending_count": sum(
            item["primary_decision"]["manual_conflict_review_state"] == "pending"
            for item in entries
        ),
        "peer_reviewed_count": sum(
            item["peer_review"]["status"] == "approved" for item in entries
        ),
        "primary_reviewed_count": sum(_primary_complete(item) for item in entries),
        "sequence_reviewed_count": sum(
            item["primary_decision"]["sequence_review_state"] == "reviewed"
            for item in entries
        ),
        "unresolved_count": classification_counts["unresolved"],
    }
    state = _review_phase_state(checkpoint)
    if state == "FINALIZATION_REVIEW_REQUIRED":
        binding_value = checkpoint.get("authoring_binding")
        if type(binding_value) is dict:
            try:
                derived_binding = AuthoringBinding(
                    binding_value["execution_checkout_sha"],
                    binding_value["procedure_identity_sha256"],
                    binding_value["execution_python_identity_sha256"],
                )
                finalization_eligibility(checkpoint, capture, derived_binding)
            except (AuthoringContractError, KeyError, TypeError):
                pass
            else:
                state = "FINALIZATION_ELIGIBLE"
    if state not in PUBLIC_AUTHORING_STATES:
        _fail("checkpoint_invalid")
    return {
        "authoring_state": state,
        "classification_counts": {
            name: classification_counts[name] for name in sorted(CLASSIFICATIONS)
        },
        "counts": counts,
        "migration_readiness": "RED",
        "restore_command_gate": "BLOCKED",
        "restore_planning_gate": "BLOCKED",
        "review_status": "REVIEW_REQUIRED",
    }


def _cover_parent_groups(
    parent_ids: Sequence[str], captured: Mapping[str, AuthoringEntry], groups: Sequence[frozenset[str]]
) -> bool:
    def visit(group_index: int, used: set[str]) -> bool:
        if group_index == len(groups):
            return True
        for parent_id in parent_ids:
            if (
                parent_id not in used
                and parent_id in captured
                and captured[parent_id].object_class in groups[group_index]
            ):
                used.add(parent_id)
                if visit(group_index + 1, used):
                    return True
                used.remove(parent_id)
        return False

    return visit(0, set())


def _detect_cycles(graph: Mapping[str, set[str]]) -> None:
    visiting: set[str] = set()
    visited: set[str] = set()
    for start in graph:
        if start in visited:
            continue
        visiting.add(start)
        stack: list[tuple[str, Any]] = [(start, iter(graph[start]))]
        while stack:
            node, targets = stack[-1]
            try:
                target = next(targets)
            except StopIteration:
                stack.pop()
                visiting.remove(node)
                visited.add(node)
                continue
            if target in visiting:
                _fail("finalization_incomplete")
            if target not in visited:
                visiting.add(target)
                stack.append((target, iter(graph[target])))


def _effective_disposition(decision: Mapping[str, Any]) -> str:
    if decision["classification"] == "manual_conflict":
        return decision["manual_conflict_disposition"]
    return decision["classification"]


def finalization_eligibility(
    checkpoint: Mapping[str, Any],
    capture: AuthoringCapture,
    binding: AuthoringBinding,
) -> dict[str, Any]:
    checkpoint = validate_checkpoint(checkpoint, capture, binding)
    if _review_phase_state(checkpoint) != "FINALIZATION_REVIEW_REQUIRED":
        _fail("finalization_incomplete")
    captured = {entry.entry_id: entry for entry in capture.entries_by_ordinal}
    decisions = {
        entry["entry_id"]: entry["primary_decision"] for entry in checkpoint["entries"]
    }
    graph: dict[str, set[str]] = {}
    dispositions: dict[str, str] = {}
    managed_seen: dict[str, set[str]] = {name: set() for name in MANAGED_DOMAINS}
    data_mapped = 0
    state_mapped = 0
    for record in checkpoint["entries"]:
        if record["peer_review"]["primary_decision_sha256"] != record["primary_decision_sha256"]:
            _fail("finalization_incomplete")
        entry_id = record["entry_id"]
        entry = captured[entry_id]
        decision = record["primary_decision"]
        classification = decision["classification"]
        if classification is None or classification == "unresolved":
            _fail("finalization_incomplete")
        disposition = _effective_disposition(decision)
        if disposition not in FINAL_DISPOSITIONS:
            _fail("finalization_incomplete")
        dispositions[entry_id] = disposition
        targets = set(decision["parent_entry_ids"]) | set(decision["dependency_entry_ids"])
        if decision["metadata_parent_entry_id"] is not None:
            targets.add(decision["metadata_parent_entry_id"])
        if not targets.issubset(captured):
            _fail("finalization_incomplete")
        graph[entry_id] = targets
        required_domain = CLASS_MANAGED_DOMAINS.get(entry.object_class)
        domain = decision["managed_domain"]
        if required_domain is not None and domain != required_domain:
            _fail("finalization_incomplete")
        if domain is None:
            _fail("finalization_incomplete")
        if classification == "exclude_supabase_managed" and domain == "none":
            _fail("finalization_incomplete")
        if domain != "none" and classification not in {
            "exclude_supabase_managed",
            "manual_conflict",
        }:
            _fail("finalization_incomplete")
        if domain != "none":
            managed_seen[domain].add(disposition)
        groups = RELATIONSHIP_PARENT_GROUPS.get(entry.object_class)
        if groups is not None and not _cover_parent_groups(
            decision["parent_entry_ids"], captured, groups
        ):
            _fail("finalization_incomplete")
        if entry.object_class in METADATA_PARENT_REQUIRED_CLASSES:
            parent_id = decision["metadata_parent_entry_id"]
            allowed = DATA_PARENT_CLASSES[entry.object_class]
            if parent_id not in captured or captured[parent_id].object_class not in allowed:
                _fail("finalization_incomplete")
            if disposition in {"restore", "dependency_only"} and _effective_disposition(
                decisions[parent_id]
            ) not in {"restore", "dependency_only"}:
                _fail("finalization_incomplete")
            state_mapped += 1
            if entry.is_data_reference:
                data_mapped += 1
        elif decision["metadata_parent_entry_id"] is not None:
            _fail("finalization_incomplete")
    _detect_cycles(graph)
    roots = {entry_id for entry_id, value in dispositions.items() if value == "restore"}
    closure = set(roots)
    pending = list(roots)
    while pending:
        source = pending.pop()
        for target in graph[source]:
            if dispositions[target] in {"restore", "dependency_only"} and target not in closure:
                closure.add(target)
                pending.append(target)
    if any(
        disposition == "dependency_only" and entry_id not in closure
        for entry_id, disposition in dispositions.items()
    ):
        _fail("finalization_incomplete")
    for name, record in checkpoint["managed_domain_decisions"].items():
        selected = record["value"]
        observed = managed_seen[name]
        if not observed:
            expected = "not_present"
        elif observed == {"restore"}:
            expected = "restore"
        elif observed == {"exclude_supabase_managed"}:
            expected = "exclude_supabase_managed"
        else:
            expected = "manual_conflict"
        if selected != expected:
            _fail("finalization_incomplete")
    return {
        "data_reference_count": sum(item.is_data_reference for item in capture.entries_by_ordinal),
        "data_reference_mapped_count": data_mapped,
        "entry_count": len(capture.entries_by_ordinal),
        "metadata_parent_mapped_count": state_mapped,
        "migration_readiness": "RED",
        "restore_command_gate": "BLOCKED",
        "restore_planning_gate": "BLOCKED",
        "review_status": "REVIEW_REQUIRED",
    }


def build_final_ledger(
    checkpoint: Mapping[str, Any],
    capture: AuthoringCapture,
    binding: AuthoringBinding,
) -> bytes:
    """Construct, but deliberately do not validate, one final ledger candidate."""

    finalization_eligibility(checkpoint, capture, binding)
    binding_value = checkpoint["capture_binding"]
    ledger = {
        "annotations": [
            {
                "classification": record["primary_decision"]["classification"],
                "dependency_entry_ids": record["primary_decision"][
                    "dependency_entry_ids"
                ],
                "dependency_review_complete": True,
                "entry_id": record["entry_id"],
                "managed_domain": record["primary_decision"]["managed_domain"],
                "manual_conflict_disposition": record["primary_decision"][
                    "manual_conflict_disposition"
                ],
                "metadata_parent_entry_id": record["primary_decision"][
                    "metadata_parent_entry_id"
                ],
                "parent_entry_ids": record["primary_decision"]["parent_entry_ids"],
            }
            for record in sorted(checkpoint["entries"], key=lambda item: item["entry_id"])
        ],
        "artifact_kind": "lovable_toc_annotation_ledger",
        "capture_binding": {
            "capture_manifest_sha256": binding_value["capture_manifest_sha256"],
            "evidence_manifest_sha256": binding_value["evidence_manifest_sha256"],
            "evidence_run_id": binding_value["evidence_run_id"],
            "execution_checkout_sha": binding_value[
                "capture_execution_checkout_sha"
            ],
            "inner_archive_sha256": binding_value["inner_archive_sha256"],
            "inspection_checkout_sha": binding_value["inspection_checkout_sha"],
            "inspection_procedure_sha256": binding_value[
                "inspection_procedure_sha256"
            ],
            "outer_archive_sha256": binding_value["outer_archive_sha256"],
            "pg_restore_identity_sha256": binding_value[
                "pg_restore_identity_sha256"
            ],
            "procedure_identity_sha256": binding_value[
                "capture_procedure_identity_sha256"
            ],
            "raw_toc_sha256": binding_value["raw_toc_sha256"],
            "raw_toc_size_bytes": binding_value["raw_toc_size_bytes"],
        },
        "format_version": 1,
        "global_handling": {
            name: checkpoint["global_decisions"][name]["value"]
            for name in sorted(GLOBAL_HANDLING)
        },
        "managed_domain_handling": {
            name: checkpoint["managed_domain_decisions"][name]["value"]
            for name in sorted(MANAGED_DOMAINS)
        },
    }
    return canonical_json_bytes(ledger)
