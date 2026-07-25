#!/usr/bin/env python3
"""Reviewed one-shot recovery of a stored TOC primary-operator label.

The module deliberately has no general authoring dispatcher.  It performs one
separately approved, read-only validation of the pristine generation-one
operator/checkpoint chain, shows the already-recorded identity only on a held
local controlling TTY, and writes identity-free audit evidence under a
different approved private root.

It never opens the capture package, raw TOC, opaque index, or opaque key.
"""

from __future__ import annotations

import base64
import datetime as dt
import hashlib
import hmac
import json
import os
import pwd
import re
import secrets
import stat
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

from . import lovable_toc_authoring_contract as AUTHORING
from . import lovable_toc_contract as TOC
from . import lovable_toc_operator_preflight as PREFLIGHT
from .lovable_toc_contract import (
    ContractError,
    StableFile,
    _rename_no_replace,
    canonical_json_bytes,
    emit_fixed_diagnostic,
    sha256_bytes,
    stable_private_file_at,
    strict_json_loads,
)


STAGE = "toc_operator_identity_recovery"
PROFILE_RELATIVE_PATH = (
    "scripts/migration/verification/"
    "lovable-toc-operator-identity-recovery-profile.v1.json"
)
RECOVERY_APPROVAL_RELATIVE_PARENT = (
    "Library/Application Support/focus-flow-score/migration-approvals/"
    "toc-operator-identity-recovery"
)
RECOVERY_APPROVAL_NAME_RE = re.compile(
    r"^lovable-toc-operator-identity-recovery-approval-"
    r"([0-9a-f]{40})-[0-9a-f]{16}[.]json$",
    re.ASCII,
)
RECOVERY_PROFILE_KIND = "lovable_toc_operator_identity_recovery_profile"
RECOVERY_APPROVAL_KIND = "lovable_toc_operator_identity_recovery_approval"
RECOVERY_AUDIT_KIND = "lovable_toc_operator_identity_recovery_audit"
ALLOWED_DISCLOSURE = "stored_primary_operator_identity_only"
EXPECTED_STATE = "PRIMARY_REVIEW_REQUIRED"
EXPECTED_GENERATION = 1
TTY_ATTESTATION = "LOCAL_CONTROLLING_TTY_NO_RECORDING_NO_REMOTE_NO_CLIPBOARD"
NO_RETRY_ACKNOWLEDGEMENT = "NO_RETRY_AFTER_PRIVATE_ACCESS"
TRUST_ACKNOWLEDGEMENT = (
    "PROCEDURAL_RECOVERY_REVIEW_AND_SAME_UID_PRELAUNCH_REPLACEMENT_CEILING_ACCEPTED"
)
ACCEPTED_CEILINGS = (
    "HOSTILE_SAME_UID_PRELAUNCH_PATH_REPLACEMENT",
    "LOCAL_TERMINAL_PARTIAL_WRITE_OR_RECORDING_NOT_INDEPENDENTLY_ATTESTABLE",
)
LOCK_NAME = "operator-session-lock"
LOCK_RELEASED_NAME = "operator-session-released"
LOCK_PREFIX = b"OPERATOR_SESSION_LOCK_V1 "
AUTHORING_RELEASED_NAME = "AUTHORING_RELEASED"
AUTHORING_RELEASED_PREFIX = b"AUTHORING_LOCK_V2 "
CHECKPOINTS_NAME = "checkpoints"
CURRENT_RESUME_PREFIX = "resume-current-g"
MAX_RECORD_BYTES = 1024 * 1024
MAX_PROFILE_BYTES = 512 * 1024
MAX_OPERATOR_INPUT_BYTES = 4096
CONSEQUENCE_CHALLENGE_BYTES = 5
HEX64_RE = re.compile(r"^[0-9a-f]{64}$", re.ASCII)
GIT_SHA_RE = re.compile(r"^[0-9a-f]{40}$", re.ASCII)
SAFE_IDENTITY_RE = re.compile(
    r"^[A-Za-z0-9][A-Za-z0-9 ._@()+:-]{0,127}$", re.ASCII
)
SAFE_SESSION_RE = re.compile(
    r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$", re.ASCII
)
AI_IDENTITY_RE = re.compile(
    r"(?:^|[ ._@()+:-])"
    r"(?:ai|codex|claude|chatgpt|gpt|openai|agent)"
    r"(?:$|[ ._@()+:-])",
    re.ASCII | re.IGNORECASE,
)
SAFE_CHILD_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$", re.ASCII)
UTC_RE = re.compile(
    r"^(20[0-9]{2})-([01][0-9])-([0-3][0-9])T"
    r"([0-2][0-9]):([0-5][0-9]):([0-5][0-9])Z$",
    re.ASCII,
)
CAPTURE_BINDING_KEYS = frozenset(
    {
        "capture_json_sha256",
        "capture_execution_checkout_sha",
        "capture_manifest_sha256",
        "data_reference_count",
        "entry_count",
        "evidence_manifest_sha256",
        "evidence_run_id",
        "inner_archive_sha256",
        "inspection_checkout_sha",
        "inspection_procedure_sha256",
        "opaque_index_sha256",
        "outer_archive_sha256",
        "package_device",
        "package_inode",
        "pg_restore_identity_sha256",
        "raw_toc_sha256",
        "raw_toc_size_bytes",
        "capture_procedure_identity_sha256",
        "opaque_key_ctime_ns",
        "opaque_key_device",
        "opaque_key_gid",
        "opaque_key_inode",
        "opaque_key_mode",
        "opaque_key_mtime_ns",
        "opaque_key_nlink",
        "opaque_key_size_bytes",
        "opaque_key_uid",
    }
)
AUDIT_EVENTS = frozenset(
    {
        "attempt_started",
        "identity_acknowledged",
        "recovery_completed",
        "recovery_failed",
        "recovery_indeterminate",
    }
)


class RecoveryError(RuntimeError):
    ALLOWED = frozenset(
        {
            "approval_ambiguous",
            "approval_invalid",
            "approval_missing",
            "audit_failed",
            "authorization_failed",
            "binding_mismatch",
            "history_conflict",
            "indeterminate",
            "input_invalid",
            "internal_failure",
            "publication_exists",
            "startup_environment_invalid",
            "tty_invalid",
        }
    )

    def __init__(self, reason: str):
        self.reason = reason if reason in self.ALLOWED else "internal_failure"
        super().__init__(self.reason)


@dataclass(frozen=True)
class RecoveryVerified:
    approval: Mapping[str, Any]
    approval_name: str
    approval_sha256: str
    ordinary: PREFLIGHT.VerifiedPreflight
    profile: Mapping[str, Any]
    profile_sha256: str
    procedure_identity_sha256: str
    repository_root: str
    historical_python_identity_sha256: str


@dataclass(frozen=True)
class Observation:
    name: str
    value: Mapping[str, Any]
    data: bytes
    sha256: str
    identity: tuple[Any, ...]


@dataclass
class GenerationOneSnapshot:
    root: Observation
    resume: Observation
    checkpoint: Observation
    root_fd: int
    root_identity: tuple[Any, ...]
    annotation_fd: int
    annotation_identity: tuple[Any, ...]
    checkpoints_fd: int
    checkpoints_identity: tuple[Any, ...]
    released: Any
    primary_operator_identity: str
    lock_token: str


@dataclass(frozen=True)
class AuditPublication:
    name: str
    sha256: str
    observation: Any


def _fixed(status: str, reason: str) -> bytes:
    return (
        json.dumps(
            {
                "diagnostic_version": 1,
                "reason": reason,
                "stage": STAGE,
                "status": status,
            },
            ensure_ascii=True,
            separators=(",", ":"),
            sort_keys=True,
        ).encode("ascii")
        + b"\n"
    )


def emit_failure(reason: str) -> None:
    selected = reason if reason in RecoveryError.ALLOWED else "internal_failure"
    try:
        emit_fixed_diagnostic(sys.stderr.buffer, _fixed("failed", selected))
    except BaseException:
        pass


def _fail(reason: str) -> None:
    raise RecoveryError(reason)


def held_tty_fd() -> int:
    raw = os.environ.get("TOC_OPERATOR_TTY_FD")
    if type(raw) is not str or not raw.isdigit() or int(raw) < 3:
        _fail("tty_invalid")
    descriptor = int(raw)
    try:
        PREFLIGHT.verify_tty(descriptor)
    except PREFLIGHT.PreflightError as exc:
        raise RecoveryError("tty_invalid") from exc
    return descriptor


def _verify_tty(tty_fd: int, *, private_access_started: bool) -> None:
    try:
        PREFLIGHT.verify_tty(tty_fd)
    except PREFLIGHT.PreflightError as exc:
        raise RecoveryError(
            "indeterminate" if private_access_started else "tty_invalid"
        ) from exc


def _sha(value: Any) -> str:
    if type(value) is not str or HEX64_RE.fullmatch(value) is None:
        _fail("binding_mismatch")
    return value


def _git_sha(value: Any) -> str:
    if type(value) is not str or GIT_SHA_RE.fullmatch(value) is None:
        _fail("binding_mismatch")
    return value


def _safe_identity(value: Any) -> str:
    if type(value) is not str or SAFE_IDENTITY_RE.fullmatch(value) is None:
        _fail("binding_mismatch")
    return value


def _safe_session(value: Any) -> str:
    if type(value) is not str or SAFE_SESSION_RE.fullmatch(value) is None:
        _fail("binding_mismatch")
    return value


def _exact(value: Any, keys: frozenset[str] | set[str]) -> Mapping[str, Any]:
    if type(value) is not dict or set(value) != set(keys):
        _fail("binding_mismatch")
    return value


def _directory_identity(metadata: os.stat_result) -> tuple[Any, ...]:
    return (
        metadata.st_dev,
        metadata.st_ino,
        metadata.st_mode,
        metadata.st_uid,
        metadata.st_gid,
    )


def _file_observation_identity(observed: Any) -> tuple[Any, ...]:
    return (
        observed.device,
        observed.inode,
        observed.owner_uid,
        observed.owner_gid,
        observed.mode,
        observed.size,
        observed.sha256,
        observed.data,
    )


def _read_public_profile(repository: Path) -> tuple[Mapping[str, Any], bytes, str]:
    path = repository / PROFILE_RELATIVE_PATH
    descriptor = -1
    try:
        before_path = os.lstat(path)
        if stat.S_ISLNK(before_path.st_mode) or not stat.S_ISREG(
            before_path.st_mode
        ):
            raise OSError
        descriptor = os.open(
            path,
            os.O_RDONLY
            | getattr(os, "O_CLOEXEC", 0)
            | getattr(os, "O_NOFOLLOW", 0),
        )
        before = os.fstat(descriptor)
        if (
            before.st_dev,
            before.st_ino,
            before.st_mode,
            before.st_size,
        ) != (
            before_path.st_dev,
            before_path.st_ino,
            before_path.st_mode,
            before_path.st_size,
        ):
            raise OSError
        if before.st_size <= 0 or before.st_size > MAX_PROFILE_BYTES:
            raise OSError
        data = b""
        while len(data) <= MAX_PROFILE_BYTES:
            chunk = os.read(descriptor, min(65536, MAX_PROFILE_BYTES + 1 - len(data)))
            if not chunk:
                break
            data += chunk
        after = os.fstat(descriptor)
        after_path = os.lstat(path)
        if (
            before.st_dev,
            before.st_ino,
            before.st_mode,
            before.st_nlink,
            before.st_uid,
            before.st_gid,
            before.st_size,
            before.st_mtime_ns,
            before.st_ctime_ns,
        ) != (
            after.st_dev,
            after.st_ino,
            after.st_mode,
            after.st_nlink,
            after.st_uid,
            after.st_gid,
            after.st_size,
            after.st_mtime_ns,
            after.st_ctime_ns,
        ) or (
            before.st_dev,
            before.st_ino,
            before.st_mode,
            before.st_size,
        ) != (
            after_path.st_dev,
            after_path.st_ino,
            after_path.st_mode,
            after_path.st_size,
        ):
            raise OSError
        value = PREFLIGHT.strict_canonical_json_loads(
            data,
            maximum_bytes=MAX_PROFILE_BYTES,
            reason="execution_profile_invalid",
        )
    except (OSError, PREFLIGHT.PreflightError) as exc:
        raise RecoveryError("binding_mismatch") from exc
    finally:
        if descriptor >= 0:
            try:
                os.close(descriptor)
            except OSError:
                pass
    if type(value) is not dict or data != canonical_json_bytes(value):
        _fail("binding_mismatch")
    try:
        blob = PREFLIGHT._git_ascii(
            repository, ["rev-parse", f"HEAD:{PROFILE_RELATIVE_PATH}"]
        )
        working = PREFLIGHT._git_ascii(
            repository, ["hash-object", "--", PROFILE_RELATIVE_PATH]
        )
    except PREFLIGHT.PreflightError as exc:
        raise RecoveryError("binding_mismatch") from exc
    if blob != working:
        _fail("binding_mismatch")
    return value, data, blob


def _profile_reviewed_files(profile: Mapping[str, Any]) -> tuple[str, ...]:
    value = profile.get("reviewed_files")
    if (
        type(value) is not list
        or not value
        or any(
            type(item) is not str
            or not item
            or item.startswith("/")
            or ".." in Path(item).parts
            for item in value
        )
        or len(value) != len(set(value))
        or value != sorted(value)
    ):
        _fail("binding_mismatch")
    return tuple(value)


def _validate_profile(profile: Mapping[str, Any]) -> Mapping[str, Any]:
    expected = {
        "approval_discovery",
        "artifact_kind",
        "audit_storage",
        "checkout_policy",
        "format_version",
        "prohibited_effects",
        "procedure_identity_formula",
        "python_policy",
        "record_versions",
        "recovery_contract",
        "repository",
        "reviewed_files",
        "verification_labels",
    }
    _exact(profile, expected)
    if (
        profile["artifact_kind"] != RECOVERY_PROFILE_KIND
        or profile["format_version"] != 1
        or profile["repository"]
        != {"name": "focus-flow-score", "owner": "starstruck86"}
        or profile["checkout_policy"]
        != {
            "approval_source": "separate_external_owner_private_artifact",
            "mode": "exact_checkout",
            "same_uid_prelaunch_replacement_ceiling": True,
        }
        or profile["record_versions"]
        != {
            "checkpoint": [1],
            "resume": [2],
            "root_authorization": [1],
        }
        or profile["audit_storage"]
        != {
            "initially_empty": True,
            "no_replace": True,
            "required_file_mode": "0400",
            "required_file_nlink": 1,
            "required_root_mode": "0700",
            "root_supplied_by_approval": True,
            "sync_files_and_directories": True,
        }
        or profile["prohibited_effects"]
        != [
            "annotation_decision_mutation",
            "authoring_action_dispatch",
            "automatic_identity_derivation",
            "capture_package_access",
            "checkpoint_mutation",
            "database_access",
            "identity_rotation",
            "network_access",
            "private_access_before_recovery_authorization",
            "raw_toc_access",
            "restore_command_generation",
            "resume_mutation",
            "root_authorization_mutation",
            "runtime_access",
            "validator_invocation",
        ]
        or profile["verification_labels"]
        != [
            "checkout_verified",
            "operator_execution_approval_verified",
            "python_verified",
            "recovery_approval_verified",
            "recovery_procedure_verified",
            "repository_verified",
            "reviewed_files_verified",
            "tty_verified",
        ]
    ):
        _fail("binding_mismatch")
    python_policy = _exact(
        profile["python_policy"],
        {
            "absolute_path",
            "exact_gid",
            "exact_mode",
            "exact_nlink",
            "exact_uid",
            "executable_required",
            "isolated_flags",
            "reported_version",
            "sha256",
            "symlink_components_forbidden",
        },
    )
    if (
        type(python_policy["absolute_path"]) is not str
        or not python_policy["absolute_path"].startswith("/")
        or type(python_policy["exact_uid"]) is not int
        or type(python_policy["exact_gid"]) is not int
        or type(python_policy["exact_mode"]) is not str
        or python_policy["exact_nlink"] != 1
        or python_policy["executable_required"] is not True
        or python_policy["isolated_flags"] != ["-I", "-S", "-B"]
        or type(python_policy["reported_version"]) is not str
        or python_policy["symlink_components_forbidden"] is not True
    ):
        _fail("binding_mismatch")
    _sha(python_policy["sha256"])
    reviewed = _profile_reviewed_files(profile)
    formula = _exact(
        profile["procedure_identity_formula"],
        {"algorithm", "files", "include_execution_checkout_sha"},
    )
    if (
        formula["algorithm"] != "sha256_canonical_json_lf"
        or formula["include_execution_checkout_sha"] is not True
        or tuple(formula["files"]) != reviewed
    ):
        _fail("binding_mismatch")
    discovery = _exact(
        profile["approval_discovery"],
        {
            "filename_pattern",
            "home_resolution",
            "relative_parent",
            "required_file_mode",
            "required_file_nlink",
            "required_parent_mode",
            "selection",
        },
    )
    if (
        discovery["filename_pattern"] != RECOVERY_APPROVAL_NAME_RE.pattern
        or discovery["home_resolution"] != "passwd_database_effective_uid"
        or discovery["relative_parent"] != RECOVERY_APPROVAL_RELATIVE_PARENT
        or discovery["required_file_mode"] != "0400"
        or discovery["required_file_nlink"] != 1
        or discovery["required_parent_mode"] != "0700"
        or discovery["selection"] != "exactly_one_matching_current_checkout"
    ):
        _fail("binding_mismatch")
    recovery = _exact(
        profile["recovery_contract"],
        {
            "allowed_disclosure",
            "audit_events",
            "challenge_phrase_prefix",
            "expected_generation",
            "expected_state",
            "historical_binding",
            "no_retry_acknowledgement",
            "operator_root_mutation",
            "ordinary_action_dispatched",
        },
    )
    historical = recovery["historical_binding"]
    if (
        recovery["allowed_disclosure"] != ALLOWED_DISCLOSURE
        or recovery["audit_events"]
        != [
            "attempt_started",
            "identity_acknowledged",
            "recovery_completed",
            "recovery_failed",
            "recovery_indeterminate",
        ]
        or recovery["challenge_phrase_prefix"]
        != "AUTHORIZE RECOVER_OPERATOR_IDENTITY"
        or recovery["expected_generation"] != EXPECTED_GENERATION
        or recovery["expected_state"] != EXPECTED_STATE
        or recovery["no_retry_acknowledgement"] != NO_RETRY_ACKNOWLEDGEMENT
        or recovery["operator_root_mutation"] != "temporary_lock_lifecycle_only"
        or recovery["ordinary_action_dispatched"] is not False
        or type(historical) is not dict
    ):
        _fail("binding_mismatch")
    for name in (
        "execution_checkout_sha",
        "authoring_procedure_identity_sha256",
        "operator_session_procedure_identity_sha256",
    ):
        if name == "execution_checkout_sha":
            _git_sha(historical.get(name))
        else:
            _sha(historical.get(name))
    python = _exact(
        historical.get("python"), {"absolute_path", "reported_version", "sha256"}
    )
    if (
        type(python["absolute_path"]) is not str
        or not python["absolute_path"].startswith("/")
        or type(python["reported_version"]) is not str
    ):
        _fail("binding_mismatch")
    _sha(python["sha256"])
    return profile


def _recovery_parent(profile: Mapping[str, Any]) -> Path:
    try:
        home = Path(pwd.getpwuid(os.geteuid()).pw_dir)
        if not home.is_absolute():
            raise OSError
        return home.joinpath(
            *Path(profile["approval_discovery"]["relative_parent"]).parts
        )
    except (KeyError, OSError, TypeError) as exc:
        raise RecoveryError("approval_missing") from exc


def _load_recovery_approval(
    parent: Path,
    *,
    bootstrap: PREFLIGHT.ApprovalBootstrapBinding,
    checkout: str,
    profile: Mapping[str, Any],
) -> tuple[Mapping[str, Any], str, str]:
    parent_fd = -1
    try:
        named = os.lstat(parent)
        if (
            stat.S_ISLNK(named.st_mode)
            or not stat.S_ISDIR(named.st_mode)
            or named.st_uid != os.geteuid()
            or stat.S_IMODE(named.st_mode) != 0o700
            or parent.resolve(strict=True) != parent
        ):
            _fail("approval_invalid")
        parent_fd = os.open(
            parent,
            os.O_RDONLY
            | getattr(os, "O_DIRECTORY", 0)
            | getattr(os, "O_CLOEXEC", 0)
            | getattr(os, "O_NOFOLLOW", 0),
        )
        held = os.fstat(parent_fd)
        if PREFLIGHT._approval_parent_identity(
            held
        ) != PREFLIGHT._approval_parent_identity(
            named
        ) or PREFLIGHT._approval_parent_identity(
            held
        ) != bootstrap.parent_identity:
            _fail("approval_invalid")
        expression = re.compile(
            profile["approval_discovery"]["filename_pattern"], re.ASCII
        )
        matches = []
        for name in os.listdir(parent_fd):
            if type(name) is not str:
                _fail("approval_invalid")
            matched = expression.fullmatch(name)
            if matched is not None and matched.group(1) == checkout:
                matches.append(name)
        if not matches:
            _fail("approval_missing")
        if len(matches) != 1:
            _fail("approval_ambiguous")
        if matches[0] != bootstrap.approval_name:
            _fail("approval_invalid")
        data, metadata = PREFLIGHT._stable_approval_file_at(
            parent_fd, held, matches[0]
        )
        if (
            PREFLIGHT._approval_file_identity(metadata)
            != bootstrap.file_identity
            or sha256_bytes(data) != bootstrap.approval_sha256
            or PREFLIGHT._approval_parent_identity(held)
            != PREFLIGHT._approval_parent_identity(os.fstat(parent_fd))
        ):
            _fail("approval_invalid")
    except FileNotFoundError as exc:
        raise RecoveryError("approval_missing") from exc
    except RecoveryError:
        raise
    except (OSError, PREFLIGHT.PreflightError, RuntimeError) as exc:
        raise RecoveryError("approval_invalid") from exc
    finally:
        if parent_fd >= 0:
            try:
                os.close(parent_fd)
            except OSError:
                pass
    try:
        value = PREFLIGHT.strict_canonical_json_loads(
            data,
            maximum_bytes=PREFLIGHT.APPROVAL_MAX_BYTES,
            reason="approval_invalid",
        )
    except PREFLIGHT.PreflightError as exc:
        raise RecoveryError("approval_invalid") from exc
    if type(value) is not dict or data != canonical_json_bytes(value):
        _fail("approval_invalid")
    return value, matches[0], sha256_bytes(data)


def _parse_expiry(value: Any) -> dt.datetime:
    if type(value) is not str or UTC_RE.fullmatch(value) is None:
        _fail("approval_invalid")
    try:
        parsed = dt.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=dt.timezone.utc
        )
    except ValueError as exc:
        raise RecoveryError("approval_invalid") from exc
    if parsed <= dt.datetime.now(dt.timezone.utc):
        _fail("approval_invalid")
    return parsed


def _validate_approval(
    approval: Mapping[str, Any],
    *,
    checkout: str,
    profile: Mapping[str, Any],
    profile_sha256: str,
    procedure_identity: str,
    blobs: Mapping[str, str],
    ordinary: PREFLIGHT.VerifiedPreflight,
    tty_fd: int,
) -> Mapping[str, Any]:
    expected_keys = {
        "accepted_ceilings",
        "allowed_disclosure",
        "annotation_root_path",
        "approved_checkout_sha",
        "artifact_kind",
        "authorizer_identity",
        "capture_root_path",
        "executing_operator_identity",
        "expected_chain",
        "format_version",
        "independent_reviewer_identity",
        "local_tty_attestation",
        "no_retry_acknowledgement",
        "operator_session_root_path",
        "ordinary_execution_approval",
        "python_identity",
        "recovery_evidence_root_path",
        "recovery_profile",
        "recovery_procedure_identity_sha256",
        "recovery_session",
        "repository",
        "review_reference",
        "reviewed_file_blobs",
        "trust_model_acknowledgement",
        "tty_binding",
    }
    _exact(approval, expected_keys)
    if (
        approval["artifact_kind"] != RECOVERY_APPROVAL_KIND
        or approval["format_version"] != 1
        or approval["approved_checkout_sha"] != checkout
        or approval["repository"]
        != {"name": "focus-flow-score", "owner": "starstruck86"}
        or approval["allowed_disclosure"] != ALLOWED_DISCLOSURE
        or approval["local_tty_attestation"] != TTY_ATTESTATION
        or approval["no_retry_acknowledgement"] != NO_RETRY_ACKNOWLEDGEMENT
        or approval["trust_model_acknowledgement"] != TRUST_ACKNOWLEDGEMENT
        or approval["accepted_ceilings"] != list(ACCEPTED_CEILINGS)
        or approval["recovery_profile"]
        != {"format_version": 1, "sha256": profile_sha256}
        or approval["recovery_procedure_identity_sha256"]
        != procedure_identity
        or approval["reviewed_file_blobs"] != dict(blobs)
        or approval["operator_session_root_path"]
        != ordinary.operator_session_root_path
    ):
        _fail("binding_mismatch")
    for path_name in (
        "annotation_root_path",
        "capture_root_path",
        "operator_session_root_path",
        "recovery_evidence_root_path",
    ):
        value = approval[path_name]
        if (
            type(value) is not str
            or not value.startswith("/")
            or "\x00" in value
            or os.path.abspath(value) != value
            or any(part in {"", ".", ".."} for part in Path(value).parts)
        ):
            _fail("approval_invalid")
    private_paths = [
        os.path.normcase(approval[name])
        for name in (
            "annotation_root_path",
            "capture_root_path",
            "operator_session_root_path",
            "recovery_evidence_root_path",
        )
    ]
    try:
        for left_index, left in enumerate(private_paths):
            for right in private_paths[left_index + 1 :]:
                common = os.path.commonpath((left, right))
                if common in {left, right}:
                    _fail("approval_invalid")
    except ValueError as exc:
        raise RecoveryError("approval_invalid") from exc
    ordinary_binding = _exact(
        approval["ordinary_execution_approval"],
        {"approved_checkout_sha", "filename", "sha256"},
    )
    if ordinary_binding != {
        "approved_checkout_sha": ordinary.approved_checkout_sha,
        "filename": ordinary.approval_name,
        "sha256": ordinary.approval_sha256,
    }:
        _fail("binding_mismatch")
    if approval["python_identity"] != ordinary.approval["python_identity"]:
        _fail("binding_mismatch")
    roles = (
        _safe_identity(approval["authorizer_identity"]),
        _safe_identity(approval["executing_operator_identity"]),
        _safe_identity(approval["independent_reviewer_identity"]),
    )
    if (
        roles[2].casefold() == roles[0].casefold()
        or roles[2].casefold() == roles[1].casefold()
        or any(AI_IDENTITY_RE.search(role) is not None for role in roles)
    ):
        _fail("approval_invalid")
    _safe_identity(approval["review_reference"])
    session = _exact(
        approval["recovery_session"],
        {"expires_at_utc", "metadata_session_id", "nonce"},
    )
    _safe_session(session["metadata_session_id"])
    _sha(session["nonce"])
    _parse_expiry(session["expires_at_utc"])
    tty = _exact(approval["tty_binding"], {"device", "inode"})
    try:
        tty_metadata = os.fstat(tty_fd)
    except OSError as exc:
        raise RecoveryError("tty_invalid") from exc
    if (
        type(tty["device"]) is not int
        or type(tty["inode"]) is not int
        or tty["device"] < 0
        or tty["inode"] <= 0
        or (tty_metadata.st_dev, tty_metadata.st_ino)
        != (tty["device"], tty["inode"])
    ):
        _fail("tty_invalid")
    chain = _exact(
        approval["expected_chain"],
        {"checkpoint", "generation", "resume", "root_authorization", "state"},
    )
    if (
        chain["generation"] != EXPECTED_GENERATION
        or chain["state"] != EXPECTED_STATE
    ):
        _fail("binding_mismatch")
    expected_versions = profile["record_versions"]
    for key, version_key in (
        ("root_authorization", "root_authorization"),
        ("resume", "resume"),
        ("checkpoint", "checkpoint"),
    ):
        item_keys = (
            {"format_version", "predecessor", "sha256"}
            if key == "resume"
            else {"format_version", "sha256"}
        )
        item = _exact(chain[key], item_keys)
        if item["format_version"] not in expected_versions[version_key]:
            _fail("binding_mismatch")
        if key == "resume" and item["predecessor"] != "absent":
            _fail("binding_mismatch")
        _sha(item["sha256"])
    return approval


def _procedure_identity(
    checkout: str, formula: Mapping[str, Any], blobs: Mapping[str, str]
) -> str:
    record = {"execution_checkout_sha": checkout}
    for path in formula["files"]:
        try:
            record[path] = blobs[path]
        except KeyError as exc:
            raise RecoveryError("binding_mismatch") from exc
    return sha256_bytes(canonical_json_bytes(record))


def verify_pre_private(
    *,
    launcher: Path,
    ordinary_launcher: Path,
    ordinary_bootstrap: PREFLIGHT.ApprovalBootstrapBinding,
    recovery_bootstrap: PREFLIGHT.ApprovalBootstrapBinding,
    ordinary_module: Any,
    tty_fd: int,
) -> RecoveryVerified:
    """Shared ordinary verification plus recovery-specific public binding.

    No operator-session, annotation, capture, or recovery-evidence path is
    resolved, stated, listed, opened, or read here.
    """

    ordinary = PREFLIGHT.verify_pre_private(
        ordinary_launcher,
        tty_fd,
        bootstrap_binding=ordinary_bootstrap,
    )
    repository = Path(PREFLIGHT.repository_root_from_launcher(launcher))
    if os.fspath(repository) != ordinary.repository_root:
        _fail("binding_mismatch")
    profile, profile_data, profile_blob = _read_public_profile(repository)
    _validate_profile(profile)
    if profile["python_policy"] != ordinary.profile["python_policy"]:
        _fail("binding_mismatch")
    checkout = ordinary.approved_checkout_sha
    if (
        PREFLIGHT._git_ascii(repository, ["rev-parse", "HEAD"]) != checkout
        or PREFLIGHT._git_ascii(repository, ["rev-parse", "refs/heads/main"])
        != checkout
        or PREFLIGHT._git_ascii(
            repository, ["rev-parse", "refs/remotes/origin/main"]
        )
        != checkout
    ):
        _fail("binding_mismatch")
    profile_sha256 = sha256_bytes(profile_data)
    parent = _recovery_parent(profile)
    approval, name, approval_sha256 = _load_recovery_approval(
        parent,
        bootstrap=recovery_bootstrap,
        checkout=checkout,
        profile=profile,
    )
    reviewed = _profile_reviewed_files(profile)
    blobs = approval.get("reviewed_file_blobs")
    if type(blobs) is not dict or set(blobs) != set(reviewed):
        _fail("binding_mismatch")
    for relative in reviewed:
        expected_blob = blobs.get(relative)
        if type(expected_blob) is not str or GIT_SHA_RE.fullmatch(
            expected_blob
        ) is None:
            _fail("approval_invalid")
        committed = PREFLIGHT._git_ascii(
            repository, ["rev-parse", f"{checkout}:{relative}"]
        )
        working = (
            profile_blob
            if relative == PROFILE_RELATIVE_PATH
            else PREFLIGHT._git_ascii(
                repository, ["hash-object", "--", relative]
            )
        )
        if committed != expected_blob or working != committed:
            _fail("binding_mismatch")
    procedure_identity = _procedure_identity(
        checkout, profile["procedure_identity_formula"], blobs
    )
    _validate_approval(
        approval,
        checkout=checkout,
        profile=profile,
        profile_sha256=profile_sha256,
        procedure_identity=procedure_identity,
        blobs=blobs,
        ordinary=ordinary,
        tty_fd=tty_fd,
    )
    historical = profile["recovery_contract"]["historical_binding"]
    try:
        historical_python = ordinary_module._validated_python_identity(
            {
                "path": historical["python"]["absolute_path"],
                "sha256": historical["python"]["sha256"],
                "version": historical["python"]["reported_version"],
            }
        )
    except BaseException as exc:
        raise RecoveryError("binding_mismatch") from exc
    return RecoveryVerified(
        approval=approval,
        approval_name=name,
        approval_sha256=approval_sha256,
        ordinary=ordinary,
        profile=profile,
        profile_sha256=profile_sha256,
        procedure_identity_sha256=procedure_identity,
        repository_root=os.fspath(repository),
        historical_python_identity_sha256=historical_python[
            "identity_sha256"
        ],
    )


def _tty_write(tty_fd: int, payload: bytes) -> None:
    if any(byte > 0x7F for byte in payload):
        _fail("internal_failure")
    remaining = memoryview(payload)
    try:
        while remaining:
            written = os.write(tty_fd, remaining)
            if type(written) is not int or written <= 0 or written > len(
                remaining
            ):
                raise OSError
            remaining = remaining[written:]
    except OSError as exc:
        raise RecoveryError("tty_invalid") from exc


def _read_hidden(
    tty_fd: int,
    prompt: bytes,
    *,
    eof_reason: str,
) -> str:
    if not prompt.endswith(b": "):
        _fail("internal_failure")
    if eof_reason not in RecoveryError.ALLOWED:
        _fail("internal_failure")
    import termios

    data = bytearray()
    old = None
    pending: BaseException | None = None
    try:
        _tty_write(tty_fd, prompt)
        old = termios.tcgetattr(tty_fd)
        changed = list(old)
        changed[3] = changed[3] & ~termios.ECHO
        termios.tcsetattr(tty_fd, termios.TCSADRAIN, changed)
        while len(data) <= MAX_OPERATOR_INPUT_BYTES:
            chunk = os.read(tty_fd, 1)
            if chunk == b"":
                raise RecoveryError(eof_reason)
            if chunk in {b"\n", b"\r"}:
                break
            data.extend(chunk)
        else:
            _fail("input_invalid")
    except BaseException as exc:
        pending = exc
    finally:
        try:
            if old is not None:
                termios.tcsetattr(tty_fd, termios.TCSADRAIN, old)
            _tty_write(tty_fd, b"\n")
        except BaseException as exc:
            if pending is None:
                pending = exc
    if pending is not None:
        if isinstance(pending, RecoveryError):
            raise pending
        raise RecoveryError("tty_invalid") from pending
    try:
        value = bytes(data).decode("utf-8", errors="strict")
    except UnicodeError as exc:
        raise RecoveryError("input_invalid") from exc
    if any(ord(character) < 0x20 or ord(character) == 0x7F for character in value):
        _fail("input_invalid")
    return value


def _challenge(verified: RecoveryVerified) -> str:
    consequence = {
        "allowed_disclosure": ALLOWED_DISCLOSURE,
        "approved_checkout_sha": verified.ordinary.approved_checkout_sha,
        "expected_generation": EXPECTED_GENERATION,
        "expected_state": EXPECTED_STATE,
        "no_authoring_action": True,
        "no_retry_after_private_access": True,
        "recovery_approval_sha256": verified.approval_sha256,
        "recovery_profile_sha256": verified.profile_sha256,
        "recovery_session_id": verified.approval["recovery_session"][
            "metadata_session_id"
        ],
        "separate_audit_evidence": True,
    }
    nonce = bytes.fromhex(verified.approval["recovery_session"]["nonce"])
    encoded = base64.b32encode(
        hashlib.sha256(nonce + canonical_json_bytes(consequence)).digest()[
            :CONSEQUENCE_CHALLENGE_BYTES
        ]
    ).decode("ascii").rstrip("=")
    if len(encoded) != 8:
        _fail("internal_failure")
    return encoded[:4] + "-" + encoded[4:]


def authorize_consequence(tty_fd: int, verified: RecoveryVerified) -> None:
    challenge = _challenge(verified)
    phrase = "AUTHORIZE RECOVER_OPERATOR_IDENTITY " + challenge
    summary = (
        "ACTION: RECOVER_OPERATOR_IDENTITY\n"
        "EXPECTED GENERATION: 1\n"
        "EXPECTED STATE: PRIMARY_REVIEW_REQUIRED\n"
        "PRIVATE EFFECTS:\n"
        "- read and validate the immutable generation-one chain\n"
        "- show one stored identity label only on this verified TTY\n"
        "- require hidden exact re-entry and explicit acknowledgement\n"
        "- write separate immutable recovery audit evidence\n"
        "- use only the existing temporary operator-session lock lifecycle\n"
        "- change no root, resume, checkpoint, TOC, or decision state\n"
        "- consume this authorization on the first private-access attempt\n"
        "- permit no automatic retry\n"
        "- run no authoring action and do not continue into primary_review\n"
        "NO OTHER ACTION AUTHORIZED\n"
        "TYPE EXACTLY: "
        + phrase
        + "\n"
    ).encode("ascii")
    _verify_tty(tty_fd, private_access_started=False)
    _tty_write(tty_fd, summary)
    observed = _read_hidden(
        tty_fd,
        b"recovery_consequence_authorization: ",
        eof_reason="authorization_failed",
    )
    _verify_tty(tty_fd, private_access_started=False)
    if not secrets.compare_digest(observed, phrase):
        _fail("authorization_failed")


def _absolute_private_path(value: Any, repository: Path) -> Path:
    if (
        type(value) is not str
        or not value.startswith("/")
        or "\x00" in value
        or os.path.abspath(value) != value
    ):
        _fail("binding_mismatch")
    path = Path(value)
    try:
        path.relative_to(repository)
    except ValueError:
        return path
    _fail("binding_mismatch")


def _open_private_directory(path: Path) -> tuple[int, tuple[Any, ...]]:
    descriptor = -1
    try:
        named = os.lstat(path)
        if (
            stat.S_ISLNK(named.st_mode)
            or not stat.S_ISDIR(named.st_mode)
            or named.st_uid != os.geteuid()
            or stat.S_IMODE(named.st_mode) != 0o700
            or path.resolve(strict=True) != path
        ):
            raise OSError
        descriptor = os.open(
            path,
            os.O_RDONLY
            | getattr(os, "O_DIRECTORY", 0)
            | getattr(os, "O_CLOEXEC", 0)
            | getattr(os, "O_NOFOLLOW", 0),
        )
        held = os.fstat(descriptor)
        identity = _directory_identity(held)
        if identity != _directory_identity(named):
            raise OSError
        return descriptor, identity
    except (OSError, RuntimeError) as exc:
        if descriptor >= 0:
            try:
                os.close(descriptor)
            except OSError:
                pass
        raise RecoveryError("history_conflict") from exc


def _revalidate_directory(path: Path, descriptor: int, identity: tuple[Any, ...]) -> None:
    try:
        if (
            _directory_identity(os.fstat(descriptor)) != identity
            or _directory_identity(os.lstat(path)) != identity
            or path.resolve(strict=True) != path
        ):
            raise OSError
    except (OSError, RuntimeError) as exc:
        raise RecoveryError("history_conflict") from exc


def _stable_json_at(
    root_fd: int,
    name: str,
    *,
    maximum_bytes: int = MAX_RECORD_BYTES,
) -> Observation:
    if type(name) is not str or SAFE_CHILD_RE.fullmatch(name) is None:
        _fail("history_conflict")
    if type(maximum_bytes) is not int or maximum_bytes <= 0:
        _fail("internal_failure")
    try:
        observed = stable_private_file_at(
            root_fd, name, max_bytes=maximum_bytes, exact_mode=0o400
        )
        value = strict_json_loads(observed.data, max_bytes=maximum_bytes)
    except ContractError as exc:
        raise RecoveryError("history_conflict") from exc
    if type(value) is not dict or observed.data != canonical_json_bytes(value):
        _fail("history_conflict")
    return Observation(
        name=name,
        value=value,
        data=observed.data,
        sha256=observed.sha256,
        identity=_file_observation_identity(observed),
    )


def _revalidate_json_at(
    root_fd: int,
    expected: Observation,
    *,
    maximum_bytes: int = MAX_RECORD_BYTES,
) -> None:
    observed = _stable_json_at(
        root_fd,
        expected.name,
        maximum_bytes=maximum_bytes,
    )
    if (
        observed.value != expected.value
        or observed.sha256 != expected.sha256
        or observed.identity != expected.identity
    ):
        _fail("history_conflict")


def _publish_audit(
    audit_fd: int,
    final_name: str,
    record: Mapping[str, Any],
) -> AuditPublication:
    if SAFE_CHILD_RE.fullmatch(final_name) is None:
        _fail("audit_failed")
    data = canonical_json_bytes(record)
    if len(data) > MAX_RECORD_BYTES:
        _fail("audit_failed")
    pending = ".pending-recovery-" + secrets.token_hex(16)
    descriptor = -1
    created = False
    renamed = False
    try:
        descriptor = os.open(
            pending,
            os.O_WRONLY
            | os.O_CREAT
            | os.O_EXCL
            | getattr(os, "O_CLOEXEC", 0)
            | getattr(os, "O_NOFOLLOW", 0),
            0o400,
            dir_fd=audit_fd,
        )
        created = True
        offset = 0
        while offset < len(data):
            written = os.write(descriptor, data[offset:])
            if type(written) is not int or written <= 0:
                raise OSError
            offset += written
        os.fsync(descriptor)
        try:
            os.close(descriptor)
        except OSError as exc:
            # A failed close cannot prove whether buffered state or the held
            # descriptor is clean.  Retain the pending child as blocking
            # evidence and never downgrade this to an ordinary clean failure.
            try:
                os.close(descriptor)
            except OSError:
                pass
            raise RecoveryError("indeterminate") from exc
        descriptor = -1
        _rename_no_replace(audit_fd, pending, final_name)
        renamed = True
        observed = stable_private_file_at(
            audit_fd, final_name, max_bytes=MAX_RECORD_BYTES, exact_mode=0o400
        )
        if observed.data != data:
            raise OSError
        os.fsync(audit_fd)
        return AuditPublication(final_name, observed.sha256, observed)
    except FileExistsError as exc:
        if not created:
            # A collision on the unpredictable pending name is concurrent
            # foreign state, not a safely classified final-name collision.
            raise RecoveryError("indeterminate") from exc
        if descriptor >= 0:
            try:
                os.close(descriptor)
            except OSError as close_exc:
                raise RecoveryError("indeterminate") from close_exc
            descriptor = -1
        try:
            os.unlink(pending, dir_fd=audit_fd)
            os.fsync(audit_fd)
        except OSError as cleanup_exc:
            raise RecoveryError("indeterminate") from cleanup_exc
        raise RecoveryError("publication_exists") from exc
    except (OSError, ContractError) as exc:
        if descriptor >= 0:
            try:
                os.close(descriptor)
            except OSError:
                pass
        if renamed:
            raise RecoveryError("indeterminate") from exc
        try:
            os.unlink(pending, dir_fd=audit_fd)
            os.fsync(audit_fd)
        except FileNotFoundError:
            pass
        except OSError as cleanup_exc:
            raise RecoveryError("indeterminate") from cleanup_exc
        raise RecoveryError("audit_failed") from exc


def _audit_record(
    verified: RecoveryVerified,
    *,
    event: str,
    previous: str | None,
    identity_sources_agree: bool,
    reason: str,
) -> Mapping[str, Any]:
    if event not in AUDIT_EVENTS or type(identity_sources_agree) is not bool:
        _fail("internal_failure")
    expected = verified.approval["expected_chain"]
    return {
        "approved_checkout_sha": verified.ordinary.approved_checkout_sha,
        "artifact_kind": RECOVERY_AUDIT_KIND,
        "audit_event": event,
        "format_version": 1,
        "human_roles": {
            "authorizer": "bound_by_recovery_approval",
            "executing_operator": "bound_by_recovery_approval",
            "independent_reviewer": "bound_by_recovery_approval",
            "independent_reviewer_distinct": True,
        },
        "identity_disclosure": ALLOWED_DISCLOSURE,
        "identity_sources_agree": identity_sources_agree,
        "previous_recovery_record_sha256": previous,
        "reason": reason,
        "recorded_at_utc": dt.datetime.now(dt.timezone.utc)
        .replace(microsecond=0)
        .strftime("%Y-%m-%dT%H:%M:%SZ"),
        "recovery_approval_sha256": verified.approval_sha256,
        "recovery_profile_sha256": verified.profile_sha256,
        "recovery_procedure_identity_sha256": (
            verified.procedure_identity_sha256
        ),
        "recovery_session": dict(verified.approval["recovery_session"]),
        "repository": {"name": "focus-flow-score", "owner": "starstruck86"},
        "source_binding": {
            "checkpoint": dict(expected["checkpoint"]),
            "generation": expected["generation"],
            "resume": dict(expected["resume"]),
            "root_authorization": dict(expected["root_authorization"]),
            "state": expected["state"],
        },
    }


def _audit_name(order: int, event: str, session_id: str) -> str:
    if order not in {1, 2, 3} or event not in AUDIT_EVENTS:
        _fail("internal_failure")
    _safe_session(session_id)
    return f"{order:04d}-{event}-{session_id}.json"


def _revalidate_audit_publications(
    audit_fd: int,
    publications: tuple[AuditPublication, ...],
) -> None:
    expected_names = {publication.name for publication in publications}
    if len(expected_names) != len(publications):
        _fail("indeterminate")
    try:
        if set(os.listdir(audit_fd)) != expected_names:
            _fail("indeterminate")
        for publication in publications:
            observed = stable_private_file_at(
                audit_fd,
                publication.name,
                max_bytes=MAX_RECORD_BYTES,
                exact_mode=0o400,
            )
            if (
                observed.sha256 != publication.sha256
                or _file_observation_identity(observed)
                != _file_observation_identity(publication.observation)
            ):
                _fail("indeterminate")
    except (OSError, ContractError) as exc:
        raise RecoveryError("indeterminate") from exc


def _acquire_recovery_lock(root_fd: int) -> str:
    token = secrets.token_hex(32)
    payload = LOCK_PREFIX + token.encode("ascii") + b"\n"
    descriptor = -1
    created = False
    try:
        descriptor = os.open(
            LOCK_NAME,
            os.O_WRONLY
            | os.O_CREAT
            | os.O_EXCL
            | getattr(os, "O_CLOEXEC", 0)
            | getattr(os, "O_NOFOLLOW", 0),
            0o400,
            dir_fd=root_fd,
        )
        created = True
        if os.write(descriptor, payload) != len(payload):
            raise OSError
        os.fsync(descriptor)
        os.close(descriptor)
        descriptor = -1
        os.fsync(root_fd)
        return token
    except FileExistsError as exc:
        raise RecoveryError("history_conflict") from exc
    except OSError as exc:
        if descriptor >= 0:
            try:
                os.close(descriptor)
            except OSError:
                pass
        # Deliberately leave any possibly durable lock as the blocking state.
        # Recovery never writes OPERATOR_SESSION_INDETERMINATE.
        raise RecoveryError("indeterminate" if created else "history_conflict") from exc


def _release_recovery_lock(root_fd: int, token: str) -> None:
    expected = LOCK_PREFIX + token.encode("ascii") + b"\n"
    descriptor = -1
    try:
        descriptor = os.open(
            LOCK_NAME,
            os.O_RDONLY
            | getattr(os, "O_CLOEXEC", 0)
            | getattr(os, "O_NOFOLLOW", 0),
            dir_fd=root_fd,
        )
        before = os.fstat(descriptor)
        data = os.read(descriptor, len(expected) + 1)
        after = os.fstat(descriptor)
        identity = (
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
        if (
            not stat.S_ISREG(before.st_mode)
            or before.st_uid != os.geteuid()
            or before.st_nlink != 1
            or stat.S_IMODE(before.st_mode) != 0o400
            or data != expected
            or identity
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
            raise OSError
        os.close(descriptor)
        descriptor = -1
        os.link(
            LOCK_NAME,
            LOCK_RELEASED_NAME,
            src_dir_fd=root_fd,
            dst_dir_fd=root_fd,
            follow_symlinks=False,
        )
        os.fsync(root_fd)
        os.unlink(LOCK_NAME, dir_fd=root_fd)
        os.fsync(root_fd)
        os.unlink(LOCK_RELEASED_NAME, dir_fd=root_fd)
        os.fsync(root_fd)
    except OSError as exc:
        if descriptor >= 0:
            try:
                os.close(descriptor)
            except OSError:
                pass
        # Leave the existing lock/hardlink state intact.  It is the blocking
        # evidence; no recovery-specific marker is written in this root.
        raise RecoveryError("indeterminate") from exc


def _bridge(profile: Mapping[str, Any]) -> Mapping[str, Any]:
    value = profile["recovery_contract"]["historical_binding"]
    _exact(
        value,
        {
            "authoring_procedure_identity_sha256",
            "execution_checkout_sha",
            "operator_session_procedure_identity_sha256",
            "python",
        },
    )
    return value


def _expected_root_names(approval: Mapping[str, Any]) -> tuple[str, str]:
    chain = approval["expected_chain"]
    root_name = (
        "authorization-root-"
        + chain["root_authorization"]["sha256"][:16]
        + ".json"
    )
    resume_name = (
        CURRENT_RESUME_PREFIX
        + "0000000000000001-"
        + chain["checkpoint"]["sha256"]
        + ".json"
    )
    return root_name, resume_name


def _validate_checkpoint(
    checkpoint: Mapping[str, Any],
    *,
    root: Mapping[str, Any],
    resume: Mapping[str, Any],
    bridge: Mapping[str, Any],
) -> Mapping[str, Any]:
    if (
        type(checkpoint) is not dict
        or set(checkpoint)
        != {
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
        }
        or checkpoint["artifact_kind"] != AUTHORING.CHECKPOINT_ARTIFACT_KIND
        or checkpoint["format_version"] != 1
        or checkpoint["generation"] != 1
        or checkpoint["previous_checkpoint_sha256"] is not None
        or checkpoint["peer_operator_identity"] is not None
        or checkpoint["primary_operator_identity"]
        != root["primary_operator_identity"]
        or checkpoint["primary_operator_identity"]
        != resume["primary_operator_identity"]
        or checkpoint["authoring_binding"]
        != {
            "execution_checkout_sha": bridge["execution_checkout_sha"],
            "execution_python_identity_sha256": bridge["python"]["sha256"],
            "procedure_identity_sha256": bridge[
                "authoring_procedure_identity_sha256"
            ],
        }
    ):
        _fail("history_conflict")
    capture_binding = checkpoint["capture_binding"]
    if type(capture_binding) is not dict or set(capture_binding) != CAPTURE_BINDING_KEYS:
        _fail("history_conflict")
    for key in CAPTURE_BINDING_KEYS:
        value = capture_binding[key]
        if key in {
            "data_reference_count",
            "entry_count",
            "package_device",
            "package_inode",
            "raw_toc_size_bytes",
            "opaque_key_ctime_ns",
            "opaque_key_device",
            "opaque_key_gid",
            "opaque_key_inode",
            "opaque_key_mode",
            "opaque_key_mtime_ns",
            "opaque_key_nlink",
            "opaque_key_size_bytes",
            "opaque_key_uid",
        }:
            if type(value) is not int or value < 0:
                _fail("history_conflict")
        elif key in {"capture_execution_checkout_sha", "inspection_checkout_sha"}:
            _git_sha(value)
        elif key == "evidence_run_id":
            _safe_session(value)
        else:
            _sha(value)
    if (
        capture_binding["entry_count"] <= 0
        or capture_binding["data_reference_count"]
        > capture_binding["entry_count"]
        or capture_binding["capture_manifest_sha256"]
        != root["capture"]["capture_manifest_sha256"]
        or capture_binding["data_reference_count"]
        != root["capture"]["data_reference_count"]
        or capture_binding["entry_count"] != root["capture"]["entry_count"]
        or capture_binding["evidence_manifest_sha256"]
        != root["capture"]["evidence_manifest_sha256"]
        or capture_binding["evidence_run_id"]
        != root["capture"]["evidence_run_id"]
        or capture_binding["inner_archive_sha256"]
        != root["capture"]["inner_sha256"]
        or capture_binding["inspection_checkout_sha"]
        != root["capture"]["inspection_checkout_sha"]
        or capture_binding["inspection_procedure_sha256"]
        != root["capture"]["inspection_procedure_sha256"]
        or capture_binding["opaque_index_sha256"]
        != root["capture"]["opaque_index_sha256"]
        or capture_binding["outer_archive_sha256"]
        != root["capture"]["outer_sha256"]
        or capture_binding["raw_toc_sha256"]
        != root["capture"]["raw_toc_sha256"]
        or capture_binding["capture_execution_checkout_sha"]
        != root["capture"]["capture_execution_checkout_sha"]
        or capture_binding["capture_procedure_identity_sha256"]
        != root["capture"]["capture_procedure_identity_sha256"]
    ):
        _fail("history_conflict")
    raw_entries = checkpoint["entries"]
    if (
        type(raw_entries) is not list
        or len(raw_entries) != capture_binding["entry_count"]
    ):
        _fail("history_conflict")
    entries = []
    for ordinal, item in enumerate(raw_entries):
        if (
            type(item) is not dict
            or type(item.get("entry_id")) is not str
            or TOC.OPAQUE_ID_RE.fullmatch(item["entry_id"]) is None
            or item.get("ordinal") != ordinal
            or type(item.get("object_class")) is not str
            or item["object_class"] not in TOC.KNOWN_TOC_CLASSES
            or type(item.get("is_data_reference")) is not bool
        ):
            _fail("history_conflict")
        entries.append(
            AUTHORING.AuthoringEntry(
                entry_id=item["entry_id"],
                ordinal=ordinal,
                object_class=item["object_class"],
                is_data_reference=item["is_data_reference"],
                raw_line=b"",
            )
        )
    if (
        len({entry.entry_id for entry in entries}) != len(entries)
        or sum(entry.is_data_reference for entry in entries)
        != capture_binding["data_reference_count"]
    ):
        _fail("history_conflict")
    synthetic = AUTHORING.AuthoringCapture(
        capture_binding=capture_binding,
        entries_by_ordinal=tuple(entries),
        package_device=capture_binding["package_device"],
        package_inode=capture_binding["package_inode"],
    )
    binding = AUTHORING.AuthoringBinding(
        execution_checkout_sha=bridge["execution_checkout_sha"],
        procedure_identity_sha256=bridge[
            "authoring_procedure_identity_sha256"
        ],
        execution_python_identity_sha256=bridge["python"]["sha256"],
    )
    try:
        validated = AUTHORING.validate_checkpoint(
            checkpoint, synthetic, binding
        )
        aggregate = AUTHORING.aggregate_status(validated, synthetic)
    except AUTHORING.AuthoringContractError as exc:
        raise RecoveryError("history_conflict") from exc
    event = validated["event"]
    if (
        event
        != {
            "action": "initialize",
            "operator_identity": root["primary_operator_identity"],
            "operator_role": "primary",
            "operator_session_identity": root[
                "authoring_session_identity"
            ],
            "reviewed_ordinal_ranges": [],
        }
        or aggregate.get("authoring_state") != EXPECTED_STATE
    ):
        _fail("history_conflict")
    return validated


def _validate_released_marker(
    annotation_fd: int, expected_token: str
) -> Any:
    expected = AUTHORING_RELEASED_PREFIX + expected_token.encode("ascii") + b"\n"
    descriptor = -1
    try:
        descriptor = os.open(
            AUTHORING_RELEASED_NAME,
            os.O_RDONLY
            | getattr(os, "O_CLOEXEC", 0)
            | getattr(os, "O_NONBLOCK", 0)
            | getattr(os, "O_NOFOLLOW", 0),
            dir_fd=annotation_fd,
        )
        before = os.fstat(descriptor)
        directory_metadata = os.fstat(annotation_fd)
        if (
            not stat.S_ISREG(before.st_mode)
            or before.st_uid != os.geteuid()
            or before.st_nlink != 1
            or before.st_size != len(expected)
            or before.st_dev != directory_metadata.st_dev
            or stat.S_IMODE(before.st_mode) != 0o400
        ):
            raise OSError
        data = os.read(descriptor, len(expected) + 1)
        after = os.fstat(descriptor)
        identity = (
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
        if (
            identity
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
            or data != expected
        ):
            raise OSError
        observed = StableFile(
            data=data,
            sha256=sha256_bytes(data),
            size=after.st_size,
            device=after.st_dev,
            inode=after.st_ino,
            owner_uid=after.st_uid,
            owner_gid=after.st_gid,
            mode=stat.S_IMODE(after.st_mode),
        )
    except (OSError, ValueError) as exc:
        raise RecoveryError("history_conflict") from exc
    finally:
        if descriptor >= 0:
            try:
                os.close(descriptor)
            except OSError as exc:
                raise RecoveryError("indeterminate") from exc
    return observed


def _load_generation_one(
    verified: RecoveryVerified,
    repository: Path,
    ordinary_module: Any,
) -> GenerationOneSnapshot:
    approval = verified.approval
    root_path = _absolute_private_path(
        approval["operator_session_root_path"], repository
    )
    annotation_fd = checkpoints_fd = root_fd = -1
    lock_token: str | None = None
    try:
        root_fd, root_identity = _open_private_directory(root_path)
        root_name, resume_name = _expected_root_names(approval)
        if set(os.listdir(root_fd)) != {root_name, resume_name}:
            _fail("history_conflict")
        lock_token = _acquire_recovery_lock(root_fd)
        if set(os.listdir(root_fd)) != {root_name, resume_name, LOCK_NAME}:
            _fail("history_conflict")
        root = _stable_json_at(root_fd, root_name)
        resume = _stable_json_at(root_fd, resume_name)
        expected = approval["expected_chain"]
        if (
            root.sha256 != expected["root_authorization"]["sha256"]
            or resume.sha256 != expected["resume"]["sha256"]
        ):
            _fail("history_conflict")
        bridge = _bridge(verified.profile)
        if not verified.approval["operator_session_root_path"] == root_path.as_posix():
            _fail("binding_mismatch")
        root_value = root.value
        resume_value = resume.value
        # The exact shapes mirror the ordinary validators.  No recovery action
        # is added to the normal action vocabulary.
        root_keys = {
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
        if (
            set(root_value) != root_keys
            or root_value["artifact_kind"]
            != "lovable_toc_operator_authorization"
            or root_value["format_version"] != 1
            or root_value["action"] != "initialize"
            or root_value["finalization_authorization"] != ""
            or root_value["operator_identity"]
            != root_value["primary_operator_identity"]
            or root_value["tty_attestation"] != TTY_ATTESTATION
            or root_value["initial_head"]
            != {
                "checkpoint_sha256": "0" * 64,
                "generation": 0,
                "release_token": "0" * 64,
            }
            or root_value["session_root"] != root_path.as_posix()
            or root_value["annotation_root"]
            != approval["annotation_root_path"]
        ):
            _fail("history_conflict")
        if not ordinary_module._legacy_root_matches(root_value, bridge):
            _fail("history_conflict")
        root_execution = root_value["execution"]
        if (
            type(root_execution) is not dict
            or set(root_execution)
            != {
                "approved_checkout_sha",
                "approved_operator_session_procedure_identity_sha256",
                "approved_procedure_identity_sha256",
                "python",
            }
            or root_execution["approved_checkout_sha"]
            != bridge["execution_checkout_sha"]
            or root_execution["approved_procedure_identity_sha256"]
            != bridge["authoring_procedure_identity_sha256"]
            or root_execution[
                "approved_operator_session_procedure_identity_sha256"
            ]
            != bridge["operator_session_procedure_identity_sha256"]
            or root_execution["python"]
            != {
                "path": bridge["python"]["absolute_path"],
                "sha256": bridge["python"]["sha256"],
                "version": bridge["python"]["reported_version"],
            }
        ):
            _fail("history_conflict")
        root_capture = root_value["capture"]
        if (
            type(root_capture) is not dict
            or set(root_capture)
            != {
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
            or root_capture["capture_root"] != approval["capture_root_path"]
        ):
            _fail("history_conflict")
        resume_keys = {
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
        if (
            set(resume_value) != resume_keys
            or resume_value["artifact_kind"] != "lovable_toc_operator_resume"
            or resume_value["format_version"] != 2
            or resume_value["resume_generation"] != 1
            or resume_value["authorization_sha256"] != root.sha256
            or resume_value["annotation_root"] != root_value["annotation_root"]
            or resume_value["authoring_session_identity"]
            != root_value["authoring_session_identity"]
            or resume_value["primary_operator_identity"]
            != root_value["primary_operator_identity"]
            or resume_value["execution_checkout_sha"]
            != bridge["execution_checkout_sha"]
            or resume_value["procedure_identity_sha256"]
            != bridge["authoring_procedure_identity_sha256"]
            or resume_value["operator_session_procedure_identity_sha256"]
            != bridge["operator_session_procedure_identity_sha256"]
            or resume_value["python_identity_sha256"]
            != verified.historical_python_identity_sha256
            or resume_value["resume_checkpoint_sha256"]
            != expected["checkpoint"]["sha256"]
            or resume_value["capture"]
            != {
                "capture_manifest_sha256": root_capture[
                    "capture_manifest_sha256"
                ],
                "evidence_run_id": root_capture["evidence_run_id"],
                "opaque_index_sha256": root_capture["opaque_index_sha256"],
                "raw_toc_sha256": root_capture["raw_toc_sha256"],
            }
            or not HEX64_RE.fullmatch(resume_value["resume_release_token"])
        ):
            _fail("history_conflict")
        try:
            validated_resume = ordinary_module._validate_loaded_resume_record(
                resume_value,
                authorization_sha256=root.sha256,
                expected_operator_identity=root_value[
                    "primary_operator_identity"
                ],
            )
        except BaseException as exc:
            raise RecoveryError("history_conflict") from exc
        if (
            validated_resume != resume_value
            or not ordinary_module._current_resume_shape_matches(
                resume_value, resume_name
            )
        ):
            _fail("history_conflict")
        annotation_path = _absolute_private_path(
            root_value["annotation_root"], repository
        )
        if os.path.normcase(annotation_path.as_posix()) in {
            os.path.normcase(root_path.as_posix()),
            os.path.normcase(
                approval["recovery_evidence_root_path"]
            ),
        }:
            _fail("history_conflict")
        annotation_fd, annotation_identity = _open_private_directory(
            annotation_path
        )
        if set(os.listdir(annotation_fd)) != {
            CHECKPOINTS_NAME,
            AUTHORING_RELEASED_NAME,
        }:
            _fail("history_conflict")
        flags = (
            os.O_RDONLY
            | getattr(os, "O_DIRECTORY", 0)
            | getattr(os, "O_CLOEXEC", 0)
            | getattr(os, "O_NOFOLLOW", 0)
        )
        checkpoints_fd = os.open(
            CHECKPOINTS_NAME, flags, dir_fd=annotation_fd
        )
        checkpoints_metadata = os.fstat(checkpoints_fd)
        named_checkpoints = os.stat(
            CHECKPOINTS_NAME, dir_fd=annotation_fd, follow_symlinks=False
        )
        if (
            not stat.S_ISDIR(checkpoints_metadata.st_mode)
            or stat.S_ISLNK(named_checkpoints.st_mode)
            or checkpoints_metadata.st_uid != os.geteuid()
            or stat.S_IMODE(checkpoints_metadata.st_mode) != 0o700
            or _directory_identity(checkpoints_metadata)
            != _directory_identity(named_checkpoints)
        ):
            _fail("history_conflict")
        checkpoint_name = (
            "checkpoint-g0000000000000001-"
            + expected["checkpoint"]["sha256"]
            + ".json"
        )
        if set(os.listdir(checkpoints_fd)) != {checkpoint_name}:
            _fail("history_conflict")
        checkpoint = _stable_json_at(
            checkpoints_fd,
            checkpoint_name,
            maximum_bytes=AUTHORING.MAX_CHECKPOINT_BYTES,
        )
        if checkpoint.sha256 != expected["checkpoint"]["sha256"]:
            _fail("history_conflict")
        _validate_checkpoint(
            checkpoint.value,
            root=root_value,
            resume=resume_value,
            bridge=bridge,
        )
        if not hmac.compare_digest(
            root_value["operator_identity"],
            root_value["primary_operator_identity"],
        ) or not hmac.compare_digest(
            root_value["primary_operator_identity"],
            resume_value["primary_operator_identity"],
        ) or not hmac.compare_digest(
            resume_value["primary_operator_identity"],
            checkpoint.value["primary_operator_identity"],
        ) or not hmac.compare_digest(
            checkpoint.value["event"]["operator_identity"],
            root_value["primary_operator_identity"],
        ):
            _fail("history_conflict")
        released = _validate_released_marker(
            annotation_fd, resume_value["resume_release_token"]
        )
        snapshot = GenerationOneSnapshot(
            root=root,
            resume=resume,
            checkpoint=checkpoint,
            root_fd=root_fd,
            root_identity=root_identity,
            annotation_fd=annotation_fd,
            annotation_identity=annotation_identity,
            checkpoints_fd=checkpoints_fd,
            checkpoints_identity=_directory_identity(checkpoints_metadata),
            released=released,
            primary_operator_identity=root_value[
                "primary_operator_identity"
            ],
            lock_token=lock_token,
        )
        root_fd = annotation_fd = checkpoints_fd = -1
        lock_token = None
        return snapshot
    except BaseException:
        if lock_token is not None and root_fd >= 0:
            try:
                _release_recovery_lock(root_fd, lock_token)
                lock_token = None
            except RecoveryError:
                raise RecoveryError("indeterminate") from None
        raise
    finally:
        close_failed = False
        for descriptor in (checkpoints_fd, annotation_fd, root_fd):
            if descriptor >= 0:
                try:
                    os.close(descriptor)
                except OSError:
                    close_failed = True
        if close_failed:
            raise RecoveryError("indeterminate")


def _revalidate_snapshot(
    snapshot: GenerationOneSnapshot,
    verified: RecoveryVerified,
) -> None:
    root_path = Path(verified.approval["operator_session_root_path"])
    annotation_path = Path(snapshot.root.value["annotation_root"])
    _revalidate_directory(root_path, snapshot.root_fd, snapshot.root_identity)
    _revalidate_directory(
        annotation_path, snapshot.annotation_fd, snapshot.annotation_identity
    )
    try:
        named_checkpoints = os.stat(
            CHECKPOINTS_NAME,
            dir_fd=snapshot.annotation_fd,
            follow_symlinks=False,
        )
    except OSError as exc:
        raise RecoveryError("history_conflict") from exc
    if (
        _directory_identity(os.fstat(snapshot.checkpoints_fd))
        != snapshot.checkpoints_identity
        or not stat.S_ISDIR(named_checkpoints.st_mode)
        or _directory_identity(named_checkpoints)
        != snapshot.checkpoints_identity
        or set(os.listdir(snapshot.root_fd))
        != {snapshot.root.name, snapshot.resume.name, LOCK_NAME}
        or set(os.listdir(snapshot.annotation_fd))
        != {CHECKPOINTS_NAME, AUTHORING_RELEASED_NAME}
        or set(os.listdir(snapshot.checkpoints_fd))
        != {snapshot.checkpoint.name}
    ):
        _fail("history_conflict")
    _revalidate_json_at(snapshot.root_fd, snapshot.root)
    _revalidate_json_at(snapshot.root_fd, snapshot.resume)
    _revalidate_json_at(
        snapshot.checkpoints_fd,
        snapshot.checkpoint,
        maximum_bytes=AUTHORING.MAX_CHECKPOINT_BYTES,
    )
    observed_released = _validate_released_marker(
        snapshot.annotation_fd,
        snapshot.resume.value["resume_release_token"],
    )
    if _file_observation_identity(observed_released) != _file_observation_identity(
        snapshot.released
    ):
        _fail("history_conflict")


def _close_snapshot(snapshot: GenerationOneSnapshot) -> None:
    close_failed = False
    for descriptor in (
        snapshot.checkpoints_fd,
        snapshot.annotation_fd,
        snapshot.root_fd,
    ):
        try:
            os.close(descriptor)
        except OSError:
            close_failed = True
    if close_failed:
        _fail("indeterminate")


def _clear_private_tty(tty_fd: int) -> None:
    try:
        _tty_write(tty_fd, b"\x1b[2J\x1b[H")
    except RecoveryError:
        raise


def _audit_terminal_failure(
    audit_fd: int,
    verified: RecoveryVerified,
    prior: tuple[AuditPublication, ...],
    *,
    event: str,
    reason: str,
    identity_sources_agree: bool,
) -> AuditPublication:
    session_id = verified.approval["recovery_session"]["metadata_session_id"]
    try:
        _revalidate_audit_publications(audit_fd, prior)
        publication = _publish_audit(
            audit_fd,
            _audit_name(3, event, session_id),
            _audit_record(
                verified,
                event=event,
                previous=prior[-1].sha256,
                identity_sources_agree=identity_sources_agree,
                reason=reason,
            ),
        )
        _revalidate_audit_publications(
            audit_fd,
            (*prior, publication),
        )
        return publication
    except RecoveryError:
        raise RecoveryError("indeterminate") from None


def run_recovery(
    tty_fd: int, verified: RecoveryVerified, ordinary_module: Any
) -> tuple[int, bytes]:
    """Consume one recovery approval and perform no authoring action."""

    repository = Path(verified.repository_root)
    audit_path = _absolute_private_path(
        verified.approval["recovery_evidence_root_path"], repository
    )
    audit_fd = -1
    snapshot: GenerationOneSnapshot | None = None
    attempt: AuditPublication | None = None
    acknowledged: AuditPublication | None = None
    session_id = verified.approval["recovery_session"]["metadata_session_id"]
    identity_disclosed = False
    try:
        audit_fd, audit_identity = _open_private_directory(audit_path)
        if os.listdir(audit_fd):
            _fail("publication_exists")
        attempt = _publish_audit(
            audit_fd,
            _audit_name(1, "attempt_started", session_id),
            _audit_record(
                verified,
                event="attempt_started",
                previous=None,
                identity_sources_agree=False,
                reason="private_access_started",
            ),
        )
        _revalidate_directory(audit_path, audit_fd, audit_identity)
        _revalidate_audit_publications(audit_fd, (attempt,))
        snapshot = _load_generation_one(
            verified, repository, ordinary_module
        )
        _revalidate_snapshot(snapshot, verified)
        _verify_tty(tty_fd, private_access_started=True)
        identity_disclosed = True
        _tty_write(
            tty_fd,
            b"stored_primary_operator_identity: "
            + snapshot.primary_operator_identity.encode("ascii")
            + b"\n",
        )
        observed = _read_hidden(
            tty_fd,
            b"reenter_stored_primary_operator_identity: ",
            eof_reason="indeterminate",
        )
        if not hmac.compare_digest(
            observed, snapshot.primary_operator_identity
        ):
            _fail("authorization_failed")
        acknowledgement = _read_hidden(
            tty_fd,
            b"type_operator_identity_recorded: ",
            eof_reason="indeterminate",
        )
        if acknowledgement != "operator_identity_recorded":
            raise RecoveryError("indeterminate")
        _clear_private_tty(tty_fd)
        _verify_tty(tty_fd, private_access_started=True)
        _revalidate_snapshot(snapshot, verified)
        _revalidate_audit_publications(audit_fd, (attempt,))
        acknowledged = _publish_audit(
            audit_fd,
            _audit_name(2, "identity_acknowledged", session_id),
            _audit_record(
                verified,
                event="identity_acknowledged",
                previous=attempt.sha256,
                identity_sources_agree=True,
                reason="operator_identity_recorded",
            ),
        )
        _revalidate_audit_publications(
            audit_fd,
            (attempt, acknowledged),
        )
        _revalidate_snapshot(snapshot, verified)
        _release_recovery_lock(snapshot.root_fd, snapshot.lock_token)
        _close_snapshot(snapshot)
        snapshot = None
        _revalidate_directory(audit_path, audit_fd, audit_identity)
        _revalidate_audit_publications(
            audit_fd,
            (attempt, acknowledged),
        )
        completed = _publish_audit(
            audit_fd,
            _audit_name(3, "recovery_completed", session_id),
            _audit_record(
                verified,
                event="recovery_completed",
                previous=acknowledged.sha256,
                identity_sources_agree=True,
                reason="recovery_completed",
            ),
        )
        _revalidate_directory(audit_path, audit_fd, audit_identity)
        _revalidate_audit_publications(
            audit_fd,
            (attempt, acknowledged, completed),
        )
        try:
            os.close(audit_fd)
        except OSError as exc:
            raise RecoveryError("indeterminate") from exc
        audit_fd = -1
        return 0, _fixed("pass", "recovery_completed")
    except BaseException as caught:
        exc = (
            caught
            if isinstance(caught, RecoveryError)
            else RecoveryError("indeterminate")
        )
        if identity_disclosed and exc.reason == "tty_invalid":
            exc = RecoveryError("indeterminate")
        if snapshot is not None:
            release_succeeded = False
            try:
                _clear_private_tty(tty_fd) if identity_disclosed else None
                _revalidate_snapshot(snapshot, verified)
                _release_recovery_lock(snapshot.root_fd, snapshot.lock_token)
                release_succeeded = True
                _close_snapshot(snapshot)
                snapshot = None
            except RecoveryError:
                exc = RecoveryError("indeterminate")
            if not release_succeeded:
                exc = RecoveryError("indeterminate")
        if audit_fd >= 0:
            try:
                _revalidate_directory(audit_path, audit_fd, audit_identity)
            except RecoveryError:
                exc = RecoveryError("indeterminate")
        if audit_fd >= 0 and attempt is not None:
            prior = (
                (attempt, acknowledged)
                if acknowledged is not None
                else (attempt,)
            )
            try:
                _revalidate_directory(audit_path, audit_fd, audit_identity)
                _audit_terminal_failure(
                    audit_fd,
                    verified,
                    prior,
                    event=(
                        "recovery_indeterminate"
                        if exc.reason == "indeterminate"
                        else "recovery_failed"
                    ),
                    reason=(
                        "recovery_indeterminate"
                        if exc.reason == "indeterminate"
                        else "recovery_failed"
                    ),
                    identity_sources_agree=identity_disclosed,
                )
                _revalidate_directory(audit_path, audit_fd, audit_identity)
            except RecoveryError:
                exc = RecoveryError("indeterminate")
        if audit_fd >= 0:
            try:
                _revalidate_directory(audit_path, audit_fd, audit_identity)
            except RecoveryError:
                exc = RecoveryError("indeterminate")
            try:
                os.close(audit_fd)
            except OSError:
                exc = RecoveryError("indeterminate")
            audit_fd = -1
        raise exc
    finally:
        if snapshot is not None:
            # An unproven release is intentionally left blocking.  Close only
            # held descriptors; never add a marker to the operator root.
            for descriptor in (
                snapshot.checkpoints_fd,
                snapshot.annotation_fd,
                snapshot.root_fd,
            ):
                try:
                    os.close(descriptor)
                except OSError:
                    pass
        if audit_fd >= 0:
            try:
                os.close(audit_fd)
            except OSError:
                pass


def execute(
    *,
    launcher: Path,
    ordinary_launcher: Path,
    ordinary_module: Any,
    tty_fd: int,
    recovery_bootstrap: PREFLIGHT.ApprovalBootstrapBinding,
    ordinary_bootstrap: PREFLIGHT.ApprovalBootstrapBinding,
) -> int:
    verified = verify_pre_private(
        launcher=launcher,
        ordinary_launcher=ordinary_launcher,
        ordinary_bootstrap=ordinary_bootstrap,
        recovery_bootstrap=recovery_bootstrap,
        ordinary_module=ordinary_module,
        tty_fd=tty_fd,
    )
    _tty_write(
        tty_fd,
        b"Repository verified\n"
        b"Python verified\n"
        b"Recovery procedure verified\n"
        b"Ordinary operator approval verified\n"
        b"TTY verified\n"
        b"Private state not yet accessed\n",
    )
    authorize_consequence(tty_fd, verified)
    # A human may pause at the public consequence prompt.  Expiry is therefore
    # checked again immediately before the first private pathname operation.
    _parse_expiry(
        verified.approval["recovery_session"]["expires_at_utc"]
    )
    _verify_tty(tty_fd, private_access_started=False)
    status, diagnostic = run_recovery(
        tty_fd, verified, ordinary_module
    )
    emit_fixed_diagnostic(sys.stdout.buffer, diagnostic)
    return status


__all__ = [
    "RecoveryError",
    "RecoveryVerified",
    "authorize_consequence",
    "emit_failure",
    "execute",
    "held_tty_fd",
    "run_recovery",
    "verify_pre_private",
]
