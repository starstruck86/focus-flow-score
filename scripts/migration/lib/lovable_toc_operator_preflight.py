"""Shared public pre-private verifier for Lovable TOC operator sessions.

This module is deliberately read-only.  It verifies the committed execution
profile, one externally installed owner-private procedural approval artifact,
the reviewed Git checkout, the deterministic CPython executable, startup
isolation, and the local controlling TTY.  It never opens the approved
operator-session root and contains no authoring, validation, restore, database,
or network mode.

The execution profile is policy, not approval.  A checkout is approved only
when exactly one external owner-private artifact binds that exact checkout,
profile digest, reviewed blob map, procedure identities, Python identity,
repository, operator-session-root string, authorizer, review reference, and an
explicit acknowledgement of the procedural-review and same-UID replacement
ceiling.  The artifact is not cryptographically authenticated or OS-immutable.
"""

from __future__ import annotations

import hashlib
import json
import os
import pwd
import re
import resource
import stat
import subprocess
import sys
import termios
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Mapping, Sequence


STAGE = "annotation_operator_preflight"
PROFILE_RELATIVE_PATH = (
    "scripts/migration/verification/"
    "lovable-toc-operator-execution-profile.v1.json"
)
PROFILE_MAX_BYTES = 256 * 1024
APPROVAL_MAX_BYTES = 512 * 1024
MAX_JSON_DEPTH = 24
MAX_GIT_OUTPUT_BYTES = 2 * 1024 * 1024
REVIEWED_GIT = "/usr/bin/git"
REVIEWED_PS = "/bin/ps"
MAX_PROCESS_ANCESTORS = 32
MAX_PS_OUTPUT_BYTES = 1024
DESCRIPTOR_RELATIVE_PROFILE_SUPPORTED = (
    hasattr(os, "O_NOFOLLOW")
    and os.open in os.supports_dir_fd
    and os.stat in os.supports_dir_fd
)
KNOWN_RECORDING_ANCESTOR_NAMES = frozenset(
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
REVIEWED_GIT_CONFIG = (
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "core.untrackedCache=false",
)
REVIEWED_GIT_ENVIRONMENT = {
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
REVIEWED_PS_ENVIRONMENT = {
    "LANG": "C",
    "LC_ALL": "C",
    "PATH": "/usr/bin:/bin",
}
GIT_SHA_RE = re.compile(r"^[0-9a-f]{40}$", re.ASCII)
SHA256_RE = re.compile(r"^[0-9a-f]{64}$", re.ASCII)
SAFE_IDENTITY_RE = re.compile(
    r"^[A-Za-z0-9][A-Za-z0-9 ._@()+:-]{0,127}$", re.ASCII
)
PYTHON_VERSION_RE = re.compile(
    r"^cpython:(?:0|[1-9][0-9]{0,2})\."
    r"(?:0|[1-9][0-9]{0,2})\."
    r"(?:0|[1-9][0-9]{0,2})$",
    re.ASCII,
)
RELATIVE_PATH_RE = re.compile(
    r"^(?!/)(?!.*(?:^|/)[.][.]?(?:/|$))[A-Za-z0-9._/-]+$", re.ASCII
)
EXPECTED_ACTIONS = frozenset(
    {
        "correction_review",
        "data_reference_review",
        "finalize",
        "initialize",
        "managed_review",
        "manual_conflict_review",
        "peer_review",
        "primary_review",
        "relationship_review",
        "revisit_unresolved",
        "sequence_review",
        "status",
    }
)
EXPECTED_STATES = frozenset(
    {
        "DATA_REFERENCE_REVIEW_REQUIRED",
        "FINALIZATION_ELIGIBLE",
        "FINALIZATION_REVIEW_REQUIRED",
        "MANAGED_GLOBAL_REVIEW_REQUIRED",
        "MANUAL_CONFLICT_REVIEW_REQUIRED",
        "PEER_REVIEW_REQUIRED",
        "PRIMARY_REVIEW_REQUIRED",
        "RELATIONSHIP_REVIEW_REQUIRED",
        "REVISIT_REQUIRED",
        "SEQUENCE_REVIEW_REQUIRED",
    }
)
EXPECTED_RECORD_VERSIONS = {
    "action_authorization": [2],
    "checkpoint": [1],
    "resume": [2],
    "root_authorization": [1],
}
EXPECTED_PROHIBITED_EFFECTS = frozenset(
    {
        "automatic_classification",
        "database_access",
        "multiple_actions",
        "network_access",
        "private_access_before_consequence_authorization",
        "restore_command_generation",
        "runtime_access",
        "validator_invocation",
    }
)
EXPECTED_SUMMARY_LABELS = frozenset(
    {
        "checkout_verified",
        "procedure_identities_verified",
        "python_verified",
        "repository_verified",
        "reviewed_files_verified",
        "tty_verified",
    }
)
ALLOWED_ENVIRONMENT_NAMES = frozenset(
    {
        "LANG",
        "LC_ALL",
        "TERM",
        "TOC_OPERATOR_OUTER_TTY_CONTEXT",
        "TOC_OPERATOR_TTY_FD",
    }
)
OUTER_TTY_CONTEXT_VALUE = "clear-v1"
POISON_ENVIRONMENT_NAMES = frozenset(
    {
        "BASH_ENV",
        "DYLD_DISABLE_CLOSURES",
        "DYLD_FALLBACK_FRAMEWORK_PATH",
        "DYLD_FALLBACK_LIBRARY_PATH",
        "DYLD_FORCE_FLAT_NAMESPACE",
        "DYLD_FRAMEWORK_PATH",
        "DYLD_IMAGE_SUFFIX",
        "DYLD_INSERT_LIBRARIES",
        "DYLD_LIBRARY_PATH",
        "DYLD_PRINT_APIS",
        "DYLD_PRINT_BINDINGS",
        "DYLD_PRINT_DOFS",
        "DYLD_PRINT_ENV",
        "DYLD_PRINT_FIXUPS",
        "DYLD_PRINT_INITIALIZERS",
        "DYLD_PRINT_INTERPOSING",
        "DYLD_PRINT_LIBRARIES",
        "DYLD_PRINT_LIBRARIES_POST_LAUNCH",
        "DYLD_PRINT_LINKS_WITH",
        "DYLD_PRINT_OPTS",
        "DYLD_PRINT_RPATHS",
        "DYLD_PRINT_SEARCHING",
        "DYLD_PRINT_SEGMENTS",
        "DYLD_PRINT_STATISTICS",
        "DYLD_PRINT_STATISTICS_DETAILS",
        "DYLD_PRINT_TO_FILE",
        "DYLD_PRINT_UUIDS",
        "DYLD_PRINT_WARNINGS",
        "DYLD_ROOT_PATH",
        "DYLD_SHARED_CACHE_DIR",
        "DYLD_SHARED_REGION",
        "DYLD_USE_CLOSURES",
        "ENV",
        "GLIBC_TUNABLES",
        "LD_ASSUME_KERNEL",
        "LD_AUDIT",
        "LD_BIND_NOT",
        "LD_BIND_NOW",
        "LD_DEBUG",
        "LD_DEBUG_OUTPUT",
        "LD_DYNAMIC_WEAK",
        "LD_HWCAP_MASK",
        "LD_LIBRARY_PATH",
        "LD_ORIGIN_PATH",
        "LD_POINTER_GUARD",
        "LD_PRELOAD",
        "LD_PROFILE",
        "LD_PROFILE_OUTPUT",
        "LD_SHOW_AUXV",
        "LD_TRACE_LOADED_OBJECTS",
        "LD_VERBOSE",
        "LD_WARN",
        "PYTHONBREAKPOINT",
        "PYTHONHOME",
        "PYTHONINSPECT",
        "PYTHONMALLOC",
        "PYTHONPATH",
        "PYTHONPROFILEIMPORTTIME",
        "PYTHONSTARTUP",
        "PYTHONTRACEMALLOC",
        "PYTHONUSERBASE",
        "PYTHONWARNINGS",
    }
)
TTY_REJECTION_NAMES = frozenset(
    {
        "ASCIINEMA_REC",
        "INSIDE_EMACS",
        "MOSH_IP",
        "MOSH_PORT",
        "SSH_CLIENT",
        "SSH_CONNECTION",
        "SSH_TTY",
        "STY",
        "TMUX",
        "VSCODE_IPC_HOOK_CLI",
    }
)


class PreflightError(RuntimeError):
    """One fixed public failure category with no observed-value context."""

    ALLOWED_REASONS = frozenset(
        {
            "approval_ambiguous",
            "approval_binding_mismatch",
            "approval_invalid",
            "approval_missing",
            "execution_profile_invalid",
            "internal_failure",
            "python_identity_mismatch",
            "repository_binding_mismatch",
            "startup_environment_invalid",
            "tty_invalid",
        }
    )

    def __init__(self, reason: str):
        self.reason = (
            reason if reason in self.ALLOWED_REASONS else "internal_failure"
        )
        super().__init__(self.reason)


@dataclass(frozen=True)
class VerifiedPreflight:
    """Public verified result; it contains no resume or checkpoint material."""

    approval: Mapping[str, Any]
    approval_name: str
    approval_sha256: str
    approved_checkout_sha: str
    authoring_procedure_identity_sha256: str
    operator_session_procedure_identity_sha256: str
    operator_session_root_path: str
    profile: Mapping[str, Any]
    profile_sha256: str
    python_identity_sha256: str
    repository_root: str
    reviewed_file_blobs: Mapping[str, str]
    summary: Mapping[str, bool]


@dataclass(frozen=True)
class PublicProfileSnapshot:
    """One descriptor-stable public profile snapshot and its Git blob ID."""

    profile: Mapping[str, Any]
    profile_sha256: str
    git_blob_id: str
    file_identity: tuple[int, ...]


@dataclass(frozen=True)
class ApprovalBootstrapBinding:
    """External approval snapshot bound before reviewed imports."""

    approval_name: str
    approval_sha256: str
    file_identity: tuple[int, ...]
    parent_identity: tuple[int, ...]


def _approval_file_identity(metadata: os.stat_result) -> tuple[int, ...]:
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


def _approval_parent_identity(metadata: os.stat_result) -> tuple[int, ...]:
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


def _public_profile_file_identity(metadata: os.stat_result) -> tuple[int, ...]:
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


def _public_profile_directory_identity(
    metadata: os.stat_result,
) -> tuple[int, ...]:
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


def fixed_diagnostic(status: str, reason: str) -> bytes:
    """Return the canonical fixed public diagnostic for this verifier."""

    if status not in {"failed", "pass"}:
        status = "failed"
    if status == "pass":
        reason = "verified"
    elif reason not in PreflightError.ALLOWED_REASONS:
        reason = "internal_failure"
    return canonical_json_bytes(
        {
            "diagnostic_version": 1,
            "reason": reason,
            "stage": STAGE,
            "status": status,
        }
    )


def canonical_json_bytes(value: Any) -> bytes:
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


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _reject_duplicate_pairs(pairs: Sequence[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate")
        result[key] = value
    return result


def _reject_nonfinite(_: str) -> None:
    raise ValueError("nonfinite")


def _check_json_depth(value: Any, depth: int = 0) -> None:
    if depth > MAX_JSON_DEPTH:
        raise ValueError("depth")
    if type(value) is dict:
        for key, child in value.items():
            if type(key) is not str:
                raise ValueError("key")
            _check_json_depth(child, depth + 1)
    elif type(value) is list:
        for child in value:
            _check_json_depth(child, depth + 1)
    elif value is not None and type(value) not in {str, int, bool}:
        raise ValueError("type")


def strict_canonical_json_loads(
    data: bytes, *, maximum_bytes: int, reason: str
) -> Any:
    """Load canonical compact ASCII JSON with duplicate/nonfinite rejection."""

    if not data or len(data) > maximum_bytes:
        raise PreflightError(reason)
    try:
        text = data.decode("ascii", errors="strict")
        value = json.loads(
            text,
            object_pairs_hook=_reject_duplicate_pairs,
            parse_constant=_reject_nonfinite,
        )
        _check_json_depth(value)
        if canonical_json_bytes(value) != data:
            raise ValueError("noncanonical")
    except (UnicodeError, ValueError, RecursionError, json.JSONDecodeError) as exc:
        raise PreflightError(reason) from exc
    return value


def _exact_dict(value: Any, keys: set[str], reason: str) -> dict[str, Any]:
    if type(value) is not dict or set(value) != keys:
        raise PreflightError(reason)
    return value


def _require_string(
    value: Any, *, reason: str, pattern: re.Pattern[str] | None = None
) -> str:
    if (
        type(value) is not str
        or not value
        or not value.isascii()
        or (pattern is not None and pattern.fullmatch(value) is None)
    ):
        raise PreflightError(reason)
    return value


def _require_int(
    value: Any, *, reason: str, minimum: int = 0, maximum: int = 2**63 - 1
) -> int:
    if type(value) is not int or not minimum <= value <= maximum:
        raise PreflightError(reason)
    return value


def _require_bool(value: Any, *, reason: str) -> bool:
    if type(value) is not bool:
        raise PreflightError(reason)
    return value


def _validate_relative_path(value: Any, reason: str) -> str:
    path = _require_string(value, reason=reason, pattern=RELATIVE_PATH_RE)
    if PurePosixPath(path).as_posix() != path:
        raise PreflightError(reason)
    return path


def _validate_absolute_path_lexically(value: Any, repository: Path) -> str:
    path = _require_string(value, reason="approval_invalid")
    if "\x00" in path or not path.startswith("/") or os.path.normpath(path) != path:
        raise PreflightError("approval_invalid")
    candidate = Path(path)
    try:
        if os.path.commonpath((os.fspath(repository), path)) == os.fspath(
            repository
        ):
            raise PreflightError("approval_invalid")
    except ValueError as exc:
        raise PreflightError("approval_invalid") from exc
    if any(part in {"", ".", ".."} for part in candidate.parts[1:]):
        raise PreflightError("approval_invalid")
    return path


def validate_profile(value: Any) -> dict[str, Any]:
    reason = "execution_profile_invalid"
    profile = _exact_dict(
        value,
        {
            "action_state_matrix",
            "approval_discovery",
            "artifact_kind",
            "batch_limits",
            "checkout_policy",
            "compatibility_bridges",
            "format_version",
            "procedure_identity_formulas",
            "prohibited_effects",
            "python_policy",
            "record_versions",
            "repository",
            "reviewed_files",
            "verification_summary_labels",
        },
        reason,
    )
    if (
        profile["artifact_kind"] != "lovable_toc_operator_execution_profile"
        or type(profile["format_version"]) is not int
        or profile["format_version"] != 1
        or profile["record_versions"] != EXPECTED_RECORD_VERSIONS
        or any(
            type(version) is not int
            for versions in profile["record_versions"].values()
            for version in versions
        )
    ):
        raise PreflightError(reason)

    repository = _exact_dict(profile["repository"], {"name", "owner"}, reason)
    if repository != {"name": "focus-flow-score", "owner": "starstruck86"}:
        raise PreflightError(reason)

    checkout = _exact_dict(
        profile["checkout_policy"],
        {
            "approval_source",
            "independent_review_enforcement",
            "launcher_mutation",
            "mode",
            "same_uid_prelaunch_replacement_ceiling",
        },
        reason,
    )
    if checkout != {
        "approval_source": "external_owner_private_procedural_artifact",
        "independent_review_enforcement": "human_procedural_not_cryptographic",
        "launcher_mutation": "forbidden",
        "mode": "exact_checkout",
        "same_uid_prelaunch_replacement_ceiling": True,
    }:
        raise PreflightError(reason)
    if type(checkout["same_uid_prelaunch_replacement_ceiling"]) is not bool:
        raise PreflightError(reason)

    discovery = _exact_dict(
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
        reason,
    )
    if (
        discovery["home_resolution"] != "passwd_database_effective_uid"
        or discovery["required_file_mode"] != "0400"
        or type(discovery["required_file_nlink"]) is not int
        or discovery["required_file_nlink"] != 1
        or discovery["required_parent_mode"] != "0700"
        or discovery["selection"] != "exactly_one_matching_current_checkout"
        or not isinstance(discovery["relative_parent"], str)
        or discovery["relative_parent"].startswith("/")
        or ".." in PurePosixPath(discovery["relative_parent"]).parts
    ):
        raise PreflightError(reason)
    try:
        expression = re.compile(discovery["filename_pattern"], re.ASCII)
    except (TypeError, re.error) as exc:
        raise PreflightError(reason) from exc
    if expression.groups != 1:
        raise PreflightError(reason)

    python = _exact_dict(
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
        reason,
    )
    _require_string(python["absolute_path"], reason=reason)
    _require_string(python["sha256"], reason=reason, pattern=SHA256_RE)
    _require_string(
        python["reported_version"], reason=reason, pattern=PYTHON_VERSION_RE
    )
    _require_int(python["exact_uid"], reason=reason)
    _require_int(python["exact_gid"], reason=reason)
    if (
        python["exact_mode"] != "0755"
        or type(python["exact_nlink"]) is not int
        or python["exact_nlink"] != 1
        or python["executable_required"] is not True
        or python["isolated_flags"] != ["-I", "-S", "-B"]
        or python["symlink_components_forbidden"] is not True
        or not python["absolute_path"].startswith("/")
        or os.path.normpath(python["absolute_path"]) != python["absolute_path"]
    ):
        raise PreflightError(reason)

    reviewed = profile["reviewed_files"]
    if (
        type(reviewed) is not list
        or not reviewed
        or reviewed != sorted(reviewed)
        or len(reviewed) != len(set(reviewed))
    ):
        raise PreflightError(reason)
    for item in reviewed:
        _validate_relative_path(item, reason)
    if PROFILE_RELATIVE_PATH not in reviewed:
        raise PreflightError(reason)

    formulas = _exact_dict(
        profile["procedure_identity_formulas"],
        {"authoring", "operator_session"},
        reason,
    )
    formula_files: set[str] = set()
    for formula in formulas.values():
        record = _exact_dict(
            formula,
            {"algorithm", "files", "include_execution_checkout_sha"},
            reason,
        )
        files = record["files"]
        if (
            record["algorithm"] != "sha256_canonical_json_lf"
            or record["include_execution_checkout_sha"] is not True
            or type(files) is not list
            or not files
            or files != sorted(files)
            or len(files) != len(set(files))
            or not set(files).issubset(reviewed)
        ):
            raise PreflightError(reason)
        formula_files.update(files)
    if formula_files != set(reviewed):
        raise PreflightError(reason)

    matrix = profile["action_state_matrix"]
    if type(matrix) is not dict or set(matrix) != EXPECTED_ACTIONS:
        raise PreflightError(reason)
    for action, contract in matrix.items():
        record = _exact_dict(
            contract, {"allowed_expected_states", "max_entry_decisions"}, reason
        )
        states = record["allowed_expected_states"]
        if (
            type(states) is not list
            or len(states) != len(set(states))
            or states != sorted(states)
            or not set(states).issubset(EXPECTED_STATES)
            or type(record["max_entry_decisions"]) is not int
            or not 0 <= record["max_entry_decisions"] <= 100
        ):
            raise PreflightError(reason)
        if action == "primary_review" and record["max_entry_decisions"] != 100:
            raise PreflightError(reason)

    if (
        type(profile["batch_limits"]) is not dict
        or any(
            type(value) is not int
            for value in profile["batch_limits"].values()
        )
        or profile["batch_limits"]
        != {
            "maximum_entry_decisions": 100,
            "primary_review_default": 100,
        }
    ):
        raise PreflightError(reason)
    if (
        type(profile["prohibited_effects"]) is not list
        or frozenset(profile["prohibited_effects"]) != EXPECTED_PROHIBITED_EFFECTS
    ):
        raise PreflightError(reason)
    if (
        type(profile["verification_summary_labels"]) is not list
        or frozenset(profile["verification_summary_labels"])
        != EXPECTED_SUMMARY_LABELS
    ):
        raise PreflightError(reason)

    bridges = profile["compatibility_bridges"]
    if type(bridges) is not list or len(bridges) != 1:
        raise PreflightError(reason)
    bridge = _exact_dict(
        bridges[0],
        {
            "allowed_action",
            "authoring_procedure_identity_sha256",
            "execution_checkout_sha",
            "generation",
            "operator_session_procedure_identity_sha256",
            "python",
            "required_state",
            "resume_predecessor",
            "self_closing",
        },
        reason,
    )
    legacy_python = _exact_dict(
        bridge["python"], {"absolute_path", "reported_version", "sha256"}, reason
    )
    self_closing = _exact_dict(
        bridge["self_closing"],
        {
            "ordinary_exact_current_rules_after_success",
            "reject_generation_at_or_above",
            "single_use",
        },
        reason,
    )
    if (
        bridge["allowed_action"] != "primary_review"
        or type(bridge["generation"]) is not int
        or bridge["generation"] != 1
        or bridge["required_state"] != "PRIMARY_REVIEW_REQUIRED"
        or bridge["resume_predecessor"] != "absent"
        or bridge["execution_checkout_sha"]
        != "b1986e4079b52edbb4ef5cd4c56ed4d20af07195"
        or bridge["authoring_procedure_identity_sha256"]
        != "bc0b990d878db1e2c72bd4ac91314fe32261a454ac38505b7ea6df4af2b5f3d8"
        or bridge["operator_session_procedure_identity_sha256"]
        != "ee0dbb3ecb9b469bef49c1fe0305ea60602bbbbaddd2f551a7774dad6cacdc23"
        or legacy_python
        != {
            "absolute_path": (
                "/Library/Developer/CommandLineTools/Library/Frameworks/"
                "Python3.framework/Versions/3.9/bin/python3.9"
            ),
            "reported_version": "cpython:3.9.6",
            "sha256": (
                "4b42b1a117605cafc8607b67b0892a609c2cd125012dd56288abeed8c89cdfb1"
            ),
        }
        or self_closing
        != {
            "ordinary_exact_current_rules_after_success": True,
            "reject_generation_at_or_above": 2,
            "single_use": True,
        }
        or type(
            self_closing["ordinary_exact_current_rules_after_success"]
        )
        is not bool
        or type(self_closing["reject_generation_at_or_above"]) is not int
        or type(self_closing["single_use"]) is not bool
    ):
        raise PreflightError(reason)
    return profile


def _validate_python_approval(value: Any, profile_python: Mapping[str, Any]) -> dict[str, Any]:
    reason = "approval_invalid"
    identity = _exact_dict(
        value,
        {
            "absolute_path",
            "exact_gid",
            "exact_mode",
            "exact_nlink",
            "exact_uid",
            "identity_sha256",
            "reported_version",
            "sha256",
        },
        reason,
    )
    for key in (
        "absolute_path",
        "exact_gid",
        "exact_mode",
        "exact_nlink",
        "exact_uid",
        "reported_version",
        "sha256",
    ):
        if identity[key] != profile_python[key]:
            raise PreflightError("approval_binding_mismatch")
    for key in ("exact_uid", "exact_gid", "exact_nlink"):
        _require_int(identity[key], reason=reason)
    _require_string(
        identity["identity_sha256"], reason=reason, pattern=SHA256_RE
    )
    unsigned = dict(identity)
    del unsigned["identity_sha256"]
    if sha256_bytes(canonical_json_bytes(unsigned)) != identity["identity_sha256"]:
        raise PreflightError("approval_binding_mismatch")
    return identity


def validate_approval(
    value: Any, *, profile: Mapping[str, Any], repository_root: Path
) -> dict[str, Any]:
    reason = "approval_invalid"
    approval = _exact_dict(
        value,
        {
            "approved_checkout_sha",
            "artifact_kind",
            "authorizer_identity",
            "execution_profile",
            "format_version",
            "operator_session_root_path",
            "procedure_identities",
            "python_identity",
            "repository",
            "review_reference",
            "reviewed_file_blobs",
            "trust_model_acknowledgement",
        },
        reason,
    )
    if (
        approval["artifact_kind"]
        != "lovable_toc_operator_execution_approval"
        or type(approval["format_version"]) is not int
        or approval["format_version"] != 1
        or approval["repository"] != profile["repository"]
    ):
        raise PreflightError(reason)
    _require_string(
        approval["approved_checkout_sha"], reason=reason, pattern=GIT_SHA_RE
    )
    _require_string(
        approval["authorizer_identity"], reason=reason, pattern=SAFE_IDENTITY_RE
    )
    _require_string(
        approval["review_reference"], reason=reason, pattern=SAFE_IDENTITY_RE
    )
    if (
        approval["trust_model_acknowledgement"]
        != "PROCEDURAL_REVIEW_AND_SAME_UID_PRELAUNCH_REPLACEMENT_CEILING_ACCEPTED"
    ):
        raise PreflightError(reason)
    _validate_absolute_path_lexically(
        approval["operator_session_root_path"], repository_root
    )
    profile_binding = _exact_dict(
        approval["execution_profile"], {"format_version", "sha256"}, reason
    )
    if (
        type(profile_binding["format_version"]) is not int
        or profile_binding["format_version"] != 1
    ):
        raise PreflightError(reason)
    _require_string(profile_binding["sha256"], reason=reason, pattern=SHA256_RE)
    procedures = _exact_dict(
        approval["procedure_identities"],
        {"authoring_sha256", "operator_session_sha256"},
        reason,
    )
    for digest in procedures.values():
        _require_string(digest, reason=reason, pattern=SHA256_RE)
    _validate_python_approval(approval["python_identity"], profile["python_policy"])
    blobs = approval["reviewed_file_blobs"]
    if type(blobs) is not dict or set(blobs) != set(profile["reviewed_files"]):
        raise PreflightError("approval_binding_mismatch")
    for path, blob in blobs.items():
        _validate_relative_path(path, reason)
        _require_string(blob, reason=reason, pattern=GIT_SHA_RE)
    return approval


def repository_root_from_launcher(launcher_path: os.PathLike[str] | str) -> Path:
    try:
        supplied = Path(launcher_path)
        if not supplied.is_absolute():
            raise OSError
        metadata = os.lstat(supplied)
        resolved = supplied.resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise PreflightError("repository_binding_mismatch") from exc
    if (
        stat.S_ISLNK(metadata.st_mode)
        or not stat.S_ISREG(metadata.st_mode)
        or os.fspath(resolved) != os.fspath(supplied)
    ):
        raise PreflightError("repository_binding_mismatch")
    root = resolved.parents[2]
    if os.path.realpath(root) != os.fspath(root):
        raise PreflightError("repository_binding_mismatch")
    return root


def _git(repository: Path, arguments: Sequence[str]) -> bytes:
    try:
        executable = os.lstat(REVIEWED_GIT)
        if (
            stat.S_ISLNK(executable.st_mode)
            or not stat.S_ISREG(executable.st_mode)
            or not os.access(REVIEWED_GIT, os.X_OK)
        ):
            raise OSError
        result = subprocess.run(
            [REVIEWED_GIT, *REVIEWED_GIT_CONFIG, *arguments],
            cwd=repository,
            check=False,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            env=dict(REVIEWED_GIT_ENVIRONMENT),
            timeout=20,
            close_fds=True,
        )
    except BaseException as exc:
        raise PreflightError("repository_binding_mismatch") from exc
    if (
        result.returncode != 0
        or len(result.stdout) > MAX_GIT_OUTPUT_BYTES
        or result.stderr
    ):
        raise PreflightError("repository_binding_mismatch")
    return result.stdout


def _git_ascii(repository: Path, arguments: Sequence[str]) -> str:
    try:
        return _git(repository, arguments).decode("ascii", errors="strict").strip()
    except UnicodeError as exc:
        raise PreflightError("repository_binding_mismatch") from exc


def _git_hash_object_bytes(repository: Path, data: bytes) -> str:
    """Return the Git blob ID for the exact already-held public bytes."""

    try:
        executable = os.lstat(REVIEWED_GIT)
        if (
            stat.S_ISLNK(executable.st_mode)
            or not stat.S_ISREG(executable.st_mode)
            or not os.access(REVIEWED_GIT, os.X_OK)
        ):
            raise OSError
        result = subprocess.run(
            [
                REVIEWED_GIT,
                *REVIEWED_GIT_CONFIG,
                "hash-object",
                "--stdin",
            ],
            cwd=repository,
            check=False,
            input=data,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            env=dict(REVIEWED_GIT_ENVIRONMENT),
            timeout=20,
            close_fds=True,
        )
    except BaseException as exc:
        raise PreflightError("repository_binding_mismatch") from exc
    try:
        value = result.stdout.decode("ascii", errors="strict").strip()
    except UnicodeError as exc:
        raise PreflightError("repository_binding_mismatch") from exc
    if result.returncode != 0 or result.stderr or GIT_SHA_RE.fullmatch(value) is None:
        raise PreflightError("repository_binding_mismatch")
    return value


def _read_public_profile(repository: Path) -> PublicProfileSnapshot:
    """Read the profile once through a held descriptor-relative path.

    The returned SHA-256, parsed policy, and Git blob ID all derive from the
    same bounded byte snapshot.  Every path component and the final file are
    revalidated while their descriptors remain held.  The file descriptor is
    not held for the entire preflight; repository verification separately
    reopens the named file descriptor-relatively and requires this recorded
    identity before and after Git binding.  A same-UID actor able to substitute
    and restore paths between those checkpoints remains a documented ceiling.
    """

    opened_descriptors: list[int] = []
    walked_components: list[tuple[int, str, tuple[int, ...]]] = []
    profile_descriptor = -1
    try:
        if not DESCRIPTOR_RELATIVE_PROFILE_SUPPORTED:
            raise OSError
        root_lstat = os.lstat(repository)
        if (
            stat.S_ISLNK(root_lstat.st_mode)
            or not stat.S_ISDIR(root_lstat.st_mode)
            or os.path.realpath(repository) != os.fspath(repository)
        ):
            raise OSError
        directory_flags = (
            os.O_RDONLY
            | getattr(os, "O_DIRECTORY", 0)
            | getattr(os, "O_CLOEXEC", 0)
            | os.O_NOFOLLOW
        )
        root_descriptor = os.open(repository, directory_flags)
        opened_descriptors.append(root_descriptor)
        root_opened = os.fstat(root_descriptor)
        root_identity = _public_profile_directory_identity(root_opened)
        if (
            not stat.S_ISDIR(root_opened.st_mode)
            or root_identity
            != _public_profile_directory_identity(root_lstat)
        ):
            raise OSError

        current_descriptor = root_descriptor
        for component in PurePosixPath(PROFILE_RELATIVE_PATH).parts[:-1]:
            before = os.stat(
                component,
                dir_fd=current_descriptor,
                follow_symlinks=False,
            )
            child_descriptor = os.open(
                component,
                directory_flags,
                dir_fd=current_descriptor,
            )
            opened_descriptors.append(child_descriptor)
            opened = os.fstat(child_descriptor)
            after = os.stat(
                component,
                dir_fd=current_descriptor,
                follow_symlinks=False,
            )
            child_identity = _public_profile_directory_identity(opened)
            if (
                not stat.S_ISDIR(before.st_mode)
                or not stat.S_ISDIR(opened.st_mode)
                or opened.st_dev != root_opened.st_dev
                or child_identity
                != _public_profile_directory_identity(before)
                or child_identity
                != _public_profile_directory_identity(after)
            ):
                raise OSError
            walked_components.append(
                (current_descriptor, component, child_identity)
            )
            current_descriptor = child_descriptor

        filename = PurePosixPath(PROFILE_RELATIVE_PATH).name
        pathname_before = os.stat(
            filename,
            dir_fd=current_descriptor,
            follow_symlinks=False,
        )
        profile_descriptor = os.open(
            filename,
            os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | os.O_NOFOLLOW,
            dir_fd=current_descriptor,
        )
        opened_descriptors.append(profile_descriptor)
        before = os.fstat(profile_descriptor)
        file_identity = _public_profile_file_identity(before)
        if (
            not stat.S_ISREG(before.st_mode)
            or before.st_uid != os.geteuid()
            or stat.S_IMODE(before.st_mode) != 0o644
            or before.st_nlink != 1
            or before.st_dev != root_opened.st_dev
            or before.st_size <= 0
            or before.st_size > PROFILE_MAX_BYTES
            or file_identity
            != _public_profile_file_identity(pathname_before)
        ):
            raise OSError
        chunks: list[bytes] = []
        total = 0
        while True:
            chunk = os.read(
                profile_descriptor,
                min(65536, PROFILE_MAX_BYTES + 1 - total),
            )
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
            if total > PROFILE_MAX_BYTES:
                raise OSError
        data = b"".join(chunks)
        after = os.fstat(profile_descriptor)
        pathname_after = os.stat(
            filename,
            dir_fd=current_descriptor,
            follow_symlinks=False,
        )
        if (
            file_identity != _public_profile_file_identity(after)
            or file_identity != _public_profile_file_identity(pathname_after)
        ):
            raise OSError
        for parent_descriptor, component, child_identity in walked_components:
            observed = os.stat(
                component,
                dir_fd=parent_descriptor,
                follow_symlinks=False,
            )
            if child_identity != _public_profile_directory_identity(observed):
                raise OSError
        if (
            root_identity
            != _public_profile_directory_identity(os.fstat(root_descriptor))
            or root_identity
            != _public_profile_directory_identity(os.lstat(repository))
        ):
            raise OSError
    except (OSError, RuntimeError, ValueError) as exc:
        raise PreflightError("execution_profile_invalid") from exc
    finally:
        for descriptor in reversed(opened_descriptors):
            try:
                os.close(descriptor)
            except OSError:
                pass
    value = strict_canonical_json_loads(
        data, maximum_bytes=PROFILE_MAX_BYTES, reason="execution_profile_invalid"
    )
    profile = validate_profile(value)
    return PublicProfileSnapshot(
        profile=profile,
        profile_sha256=sha256_bytes(data),
        git_blob_id=_git_hash_object_bytes(repository, data),
        file_identity=file_identity,
    )


def _revalidate_public_profile_path_identity(
    repository: Path, snapshot: PublicProfileSnapshot
) -> None:
    """Require the named profile to remain the descriptor-consumed inode."""

    opened_descriptors: list[int] = []
    walked_components: list[tuple[int, str, tuple[int, ...]]] = []
    try:
        if not DESCRIPTOR_RELATIVE_PROFILE_SUPPORTED:
            raise OSError
        root_lstat = os.lstat(repository)
        if (
            stat.S_ISLNK(root_lstat.st_mode)
            or not stat.S_ISDIR(root_lstat.st_mode)
            or os.path.realpath(repository) != os.fspath(repository)
        ):
            raise OSError
        directory_flags = (
            os.O_RDONLY
            | getattr(os, "O_DIRECTORY", 0)
            | getattr(os, "O_CLOEXEC", 0)
            | os.O_NOFOLLOW
        )
        root_descriptor = os.open(repository, directory_flags)
        opened_descriptors.append(root_descriptor)
        root_opened = os.fstat(root_descriptor)
        root_identity = _public_profile_directory_identity(root_opened)
        if (
            not stat.S_ISDIR(root_opened.st_mode)
            or root_identity != _public_profile_directory_identity(root_lstat)
        ):
            raise OSError
        current_descriptor = root_descriptor
        for component in PurePosixPath(PROFILE_RELATIVE_PATH).parts[:-1]:
            pathname_before = os.stat(
                component,
                dir_fd=current_descriptor,
                follow_symlinks=False,
            )
            child_descriptor = os.open(
                component,
                directory_flags,
                dir_fd=current_descriptor,
            )
            opened_descriptors.append(child_descriptor)
            opened = os.fstat(child_descriptor)
            pathname_after = os.stat(
                component,
                dir_fd=current_descriptor,
                follow_symlinks=False,
            )
            child_identity = _public_profile_directory_identity(opened)
            if (
                not stat.S_ISDIR(pathname_before.st_mode)
                or not stat.S_ISDIR(opened.st_mode)
                or opened.st_dev != root_opened.st_dev
                or child_identity
                != _public_profile_directory_identity(pathname_before)
                or child_identity
                != _public_profile_directory_identity(pathname_after)
            ):
                raise OSError
            walked_components.append(
                (current_descriptor, component, child_identity)
            )
            current_descriptor = child_descriptor
        filename = PurePosixPath(PROFILE_RELATIVE_PATH).name
        pathname_before = os.stat(
            filename,
            dir_fd=current_descriptor,
            follow_symlinks=False,
        )
        profile_descriptor = os.open(
            filename,
            os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | os.O_NOFOLLOW,
            dir_fd=current_descriptor,
        )
        opened_descriptors.append(profile_descriptor)
        opened = os.fstat(profile_descriptor)
        pathname_after = os.stat(
            filename,
            dir_fd=current_descriptor,
            follow_symlinks=False,
        )
        if (
            snapshot.file_identity
            != _public_profile_file_identity(pathname_before)
            or snapshot.file_identity != _public_profile_file_identity(opened)
            or snapshot.file_identity
            != _public_profile_file_identity(pathname_after)
        ):
            raise OSError
        for parent_descriptor, component, child_identity in walked_components:
            observed = os.stat(
                component,
                dir_fd=parent_descriptor,
                follow_symlinks=False,
            )
            if child_identity != _public_profile_directory_identity(observed):
                raise OSError
        if (
            root_identity
            != _public_profile_directory_identity(os.fstat(root_descriptor))
            or root_identity
            != _public_profile_directory_identity(os.lstat(repository))
        ):
            raise OSError
    except (OSError, RuntimeError, ValueError) as exc:
        raise PreflightError("repository_binding_mismatch") from exc
    finally:
        for descriptor in reversed(opened_descriptors):
            try:
                os.close(descriptor)
            except OSError:
                pass


def default_approval_parent(
    profile: Mapping[str, Any], *, account_home: os.PathLike[str] | str | None = None
) -> Path:
    try:
        home = (
            Path(account_home)
            if account_home is not None
            else Path(pwd.getpwuid(os.geteuid()).pw_dir)
        )
        if not home.is_absolute():
            raise OSError
        parent = home.joinpath(*PurePosixPath(
            profile["approval_discovery"]["relative_parent"]
        ).parts)
    except (KeyError, OSError, TypeError) as exc:
        raise PreflightError("approval_missing") from exc
    return parent


def _stable_approval_file_at(
    parent_fd: int, parent_metadata: os.stat_result, name: str
) -> tuple[bytes, os.stat_result]:
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(
        os, "O_NOFOLLOW", 0
    )
    try:
        descriptor = os.open(name, flags, dir_fd=parent_fd)
    except OSError as exc:
        raise PreflightError("approval_invalid") from exc
    try:
        before = os.fstat(descriptor)
        if (
            not stat.S_ISREG(before.st_mode)
            or before.st_uid != os.geteuid()
            or stat.S_IMODE(before.st_mode) != 0o400
            or before.st_nlink != 1
            or before.st_dev != parent_metadata.st_dev
            or before.st_size <= 0
            or before.st_size > APPROVAL_MAX_BYTES
        ):
            raise PreflightError("approval_invalid")
        chunks: list[bytes] = []
        total = 0
        while True:
            chunk = os.read(descriptor, min(65536, APPROVAL_MAX_BYTES + 1 - total))
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
            if total > APPROVAL_MAX_BYTES:
                raise PreflightError("approval_invalid")
        after = os.fstat(descriptor)
        comparable = (
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
        if comparable != (
            after.st_dev,
            after.st_ino,
            after.st_mode,
            after.st_nlink,
            after.st_uid,
            after.st_gid,
            after.st_size,
            after.st_mtime_ns,
            after.st_ctime_ns,
        ):
            raise PreflightError("approval_invalid")
        return b"".join(chunks), before
    finally:
        try:
            os.close(descriptor)
        except OSError:
            pass


def _load_unique_approval(
    parent: Path,
    *,
    bootstrap_binding: ApprovalBootstrapBinding,
    checkout: str,
    profile: Mapping[str, Any],
    repository: Path,
) -> tuple[dict[str, Any], str, str]:
    try:
        parent_lstat = os.lstat(parent)
        parent_resolved = parent.resolve(strict=True)
        if (
            stat.S_ISLNK(parent_lstat.st_mode)
            or not stat.S_ISDIR(parent_lstat.st_mode)
            or parent_lstat.st_uid != os.geteuid()
            or stat.S_IMODE(parent_lstat.st_mode) != 0o700
            or parent_resolved != parent
        ):
            raise PreflightError("approval_invalid")
        flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(
            os, "O_CLOEXEC", 0
        ) | getattr(os, "O_NOFOLLOW", 0)
        parent_fd = os.open(parent, flags)
    except FileNotFoundError as exc:
        raise PreflightError("approval_missing") from exc
    except PreflightError:
        raise
    except (OSError, RuntimeError) as exc:
        raise PreflightError("approval_invalid") from exc
    try:
        opened_parent = os.fstat(parent_fd)
        if _approval_parent_identity(opened_parent) != _approval_parent_identity(
            parent_lstat
        ):
            raise PreflightError("approval_invalid")
        if (
            _approval_parent_identity(opened_parent)
            != bootstrap_binding.parent_identity
        ):
            raise PreflightError("approval_binding_mismatch")
        expression = re.compile(
            profile["approval_discovery"]["filename_pattern"], re.ASCII
        )
        names = os.listdir(parent_fd)
        matches = []
        for name in names:
            if type(name) is not str:
                raise PreflightError("approval_invalid")
            match = expression.fullmatch(name)
            if match is not None and match.group(1) == checkout:
                matches.append(name)
        if not matches:
            raise PreflightError("approval_missing")
        if len(matches) != 1:
            raise PreflightError("approval_ambiguous")
        name = matches[0]
        if name != bootstrap_binding.approval_name:
            raise PreflightError("approval_binding_mismatch")
        data, metadata = _stable_approval_file_at(
            parent_fd, opened_parent, name
        )
        if (
            _approval_file_identity(metadata) != bootstrap_binding.file_identity
            or sha256_bytes(data) != bootstrap_binding.approval_sha256
        ):
            raise PreflightError("approval_binding_mismatch")
        after_parent = os.fstat(parent_fd)
        if _approval_parent_identity(opened_parent) != _approval_parent_identity(
            after_parent
        ):
            raise PreflightError("approval_invalid")
    finally:
        try:
            os.close(parent_fd)
        except OSError:
            pass
    value = strict_canonical_json_loads(
        data, maximum_bytes=APPROVAL_MAX_BYTES, reason="approval_invalid"
    )
    approval = validate_approval(
        value, profile=profile, repository_root=repository
    )
    return approval, name, sha256_bytes(data)


def _procedure_identity(
    formula: Mapping[str, Any], checkout: str, blobs: Mapping[str, str]
) -> str:
    record = {"execution_checkout_sha": checkout}
    for path in formula["files"]:
        try:
            record[path] = blobs[path]
        except KeyError as exc:
            raise PreflightError("approval_binding_mismatch") from exc
    return sha256_bytes(canonical_json_bytes(record))


def _verify_repository(
    repository: Path,
    *,
    approval: Mapping[str, Any],
    profile_snapshot: PublicProfileSnapshot,
) -> tuple[str, dict[str, str], str, str]:
    profile = profile_snapshot.profile
    _revalidate_public_profile_path_identity(repository, profile_snapshot)
    checkout = approval["approved_checkout_sha"]
    if not GIT_SHA_RE.fullmatch(checkout):
        raise PreflightError("approval_invalid")
    for ref in ("HEAD", "refs/heads/main", "refs/remotes/origin/main"):
        if _git_ascii(repository, ["rev-parse", ref]) != checkout:
            raise PreflightError("repository_binding_mismatch")
    _git(repository, ["cat-file", "-e", f"{checkout}^{{commit}}"])
    if _git(repository, ["status", "--porcelain=v1", "--untracked-files=all"]):
        raise PreflightError("repository_binding_mismatch")
    for root in ("scripts/migration", "supabase/migrations"):
        for arguments in (
            ["ls-files", "--others", "--exclude-standard", "--", root],
            ["ls-files", "--others", "--ignored", "--exclude-standard", "--", root],
        ):
            if _git(repository, arguments):
                raise PreflightError("repository_binding_mismatch")

    if (
        approval["execution_profile"]["format_version"]
        != profile["format_version"]
        or approval["execution_profile"]["sha256"]
        != profile_snapshot.profile_sha256
    ):
        raise PreflightError("approval_binding_mismatch")
    blobs = dict(approval["reviewed_file_blobs"])
    if set(blobs) != set(profile["reviewed_files"]):
        raise PreflightError("approval_binding_mismatch")
    for path in profile["reviewed_files"]:
        expected = blobs[path]
        committed = _git_ascii(repository, ["rev-parse", f"{checkout}:{path}"])
        working = (
            profile_snapshot.git_blob_id
            if path == PROFILE_RELATIVE_PATH
            else _git_ascii(repository, ["hash-object", "--", path])
        )
        if committed != expected or working != expected:
            raise PreflightError("repository_binding_mismatch")

    formulas = profile["procedure_identity_formulas"]
    authoring = _procedure_identity(formulas["authoring"], checkout, blobs)
    operator = _procedure_identity(formulas["operator_session"], checkout, blobs)
    if approval["procedure_identities"] != {
        "authoring_sha256": authoring,
        "operator_session_sha256": operator,
    }:
        raise PreflightError("approval_binding_mismatch")
    _revalidate_public_profile_path_identity(repository, profile_snapshot)
    return checkout, blobs, authoring, operator


def _verify_python(
    profile: Mapping[str, Any], approval: Mapping[str, Any]
) -> str:
    policy = profile["python_policy"]
    approved = approval["python_identity"]
    path = policy["absolute_path"]
    try:
        path_value = Path(path)
        before_lstat = os.lstat(path_value)
        resolved = path_value.resolve(strict=True)
        if (
            stat.S_ISLNK(before_lstat.st_mode)
            or not stat.S_ISREG(before_lstat.st_mode)
            or os.fspath(resolved) != path
        ):
            raise OSError
        flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(
            os, "O_NOFOLLOW", 0
        )
        descriptor = os.open(path_value, flags)
    except (OSError, RuntimeError) as exc:
        raise PreflightError("python_identity_mismatch") from exc
    try:
        before = os.fstat(descriptor)
        if (
            not stat.S_ISREG(before.st_mode)
            or before.st_uid != policy["exact_uid"]
            or before.st_gid != policy["exact_gid"]
            or stat.S_IMODE(before.st_mode) != int(policy["exact_mode"], 8)
            or before.st_nlink != policy["exact_nlink"]
            or before.st_mode & 0o111 == 0
        ):
            raise PreflightError("python_identity_mismatch")
        digest = hashlib.sha256()
        while True:
            chunk = os.read(descriptor, 1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
        after = os.fstat(descriptor)
        comparable = (
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
        if comparable != (
            after.st_dev,
            after.st_ino,
            after.st_mode,
            after.st_nlink,
            after.st_uid,
            after.st_gid,
            after.st_size,
            after.st_mtime_ns,
            after.st_ctime_ns,
        ):
            raise PreflightError("python_identity_mismatch")
    finally:
        try:
            os.close(descriptor)
        except OSError:
            pass
    reported = (
        f"{sys.implementation.name}:{sys.version_info.major}."
        f"{sys.version_info.minor}.{sys.version_info.micro}"
    )
    flags = sys.flags
    if (
        digest.hexdigest() != policy["sha256"]
        or os.path.realpath(sys.executable) != path
        or reported != policy["reported_version"]
        or getattr(flags, "isolated", 0) != 1
        or getattr(flags, "ignore_environment", 0) != 1
        or getattr(flags, "no_user_site", 0) != 1
        or getattr(flags, "no_site", 0) != 1
        or getattr(flags, "dont_write_bytecode", 0) != 1
        or sys.dont_write_bytecode is not True
    ):
        raise PreflightError("python_identity_mismatch")
    unsigned = {
        "absolute_path": policy["absolute_path"],
        "exact_gid": policy["exact_gid"],
        "exact_mode": policy["exact_mode"],
        "exact_nlink": policy["exact_nlink"],
        "exact_uid": policy["exact_uid"],
        "reported_version": policy["reported_version"],
        "sha256": policy["sha256"],
    }
    identity_sha256 = sha256_bytes(canonical_json_bytes(unsigned))
    if (
        approved != {**unsigned, "identity_sha256": identity_sha256}
        or approved["identity_sha256"] != identity_sha256
    ):
        raise PreflightError("approval_binding_mismatch")
    return identity_sha256


def verify_startup_environment(
    environment: Mapping[str, str] | None = None,
) -> None:
    values = os.environ if environment is None else environment
    if (
        set(values) != set(ALLOWED_ENVIRONMENT_NAMES)
        or values.get("LANG") != "C"
        or values.get("LC_ALL") != "C"
        or type(values.get("TERM")) is not str
        or not values["TERM"]
        or not values["TERM"].isascii()
        or type(values.get("TOC_OPERATOR_TTY_FD")) is not str
        or not values["TOC_OPERATOR_TTY_FD"].isdigit()
        or values.get("TOC_OPERATOR_OUTER_TTY_CONTEXT")
        != OUTER_TTY_CONTEXT_VALUE
        or POISON_ENVIRONMENT_NAMES.intersection(values)
    ):
        raise PreflightError("startup_environment_invalid")
    try:
        soft, hard = resource.getrlimit(resource.RLIMIT_CORE)
    except (OSError, ValueError) as exc:
        raise PreflightError("startup_environment_invalid") from exc
    if soft != 0 or hard != 0:
        raise PreflightError("startup_environment_invalid")


def verify_known_recording_ancestors() -> None:
    """Reject reviewed known record-to-file wrappers before private access.

    The bounded scan follows parent links using the reviewed absolute
    ``/bin/ps`` path and compares only case-folded command basenames. An
    unreadable, malformed, cyclic, or over-depth chain is not treated as safe.
    Observed process data is never included in the fixed public diagnostic.
    """

    try:
        metadata = os.lstat(REVIEWED_PS)
        if (
            stat.S_ISLNK(metadata.st_mode)
            or not stat.S_ISREG(metadata.st_mode)
            or not os.access(REVIEWED_PS, os.X_OK)
        ):
            raise OSError
        process_id = os.getppid()
        seen: set[int] = set()
        for _ in range(MAX_PROCESS_ANCESTORS):
            if process_id <= 1:
                return
            if process_id in seen:
                raise OSError
            seen.add(process_id)
            result = subprocess.run(
                [
                    REVIEWED_PS,
                    "-o",
                    "ppid=",
                    "-o",
                    "comm=",
                    "-p",
                    str(process_id),
                ],
                check=False,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                env=dict(REVIEWED_PS_ENVIRONMENT),
                timeout=5,
                close_fds=True,
            )
            if (
                result.returncode != 0
                or not result.stdout
                or len(result.stdout) > MAX_PS_OUTPUT_BYTES
            ):
                raise OSError
            line = result.stdout.decode("ascii", errors="strict").strip()
            pieces = line.split(None, 1)
            if len(pieces) != 2 or not pieces[0].isdigit():
                raise OSError
            parent = int(pieces[0])
            command = pieces[1].rsplit("/", 1)[-1].casefold()
            if command in KNOWN_RECORDING_ANCESTOR_NAMES:
                raise OSError
            process_id = parent
        raise OSError
    except (OSError, UnicodeError, subprocess.SubprocessError) as exc:
        raise PreflightError("tty_invalid") from exc


def verify_tty(tty_fd: int, environment: Mapping[str, str] | None = None) -> None:
    del environment
    if type(tty_fd) is not int or tty_fd < 3:
        raise PreflightError("tty_invalid")
    controlling_fd = -1
    try:
        descriptors = (0, 1, 2, tty_fd)
        before_by_fd = {}
        for descriptor in descriptors:
            metadata = os.fstat(descriptor)
            if not stat.S_ISCHR(metadata.st_mode) or not os.isatty(descriptor):
                raise PreflightError("tty_invalid")
            before_by_fd[descriptor] = metadata
        before = before_by_fd[tty_fd]
        terminal_identity = (before.st_dev, before.st_rdev)
        if any(
            (metadata.st_dev, metadata.st_rdev) != terminal_identity
            for metadata in before_by_fd.values()
        ):
            raise PreflightError("tty_invalid")
        controlling_fd = os.open(
            "/dev/tty",
            os.O_RDONLY
            | getattr(os, "O_CLOEXEC", 0)
            | getattr(os, "O_NOCTTY", 0),
        )
        controlling = os.fstat(controlling_fd)
        if (
            not stat.S_ISCHR(controlling.st_mode)
            or not os.isatty(controlling_fd)
            or (controlling.st_dev, controlling.st_rdev)
            != (before.st_dev, before.st_rdev)
        ):
            raise PreflightError("tty_invalid")
        process_group = os.getpgrp()
        for descriptor in descriptors:
            if os.tcgetpgrp(descriptor) != process_group:
                raise PreflightError("tty_invalid")
            termios.tcgetattr(descriptor)
        after_by_fd = {descriptor: os.fstat(descriptor) for descriptor in descriptors}
    except PreflightError:
        raise
    except (OSError, termios.error) as exc:
        raise PreflightError("tty_invalid") from exc
    finally:
        if controlling_fd >= 0:
            try:
                os.close(controlling_fd)
            except OSError:
                pass
    for descriptor in descriptors:
        observed_before = before_by_fd[descriptor]
        observed_after = after_by_fd[descriptor]
        if (
            observed_before.st_dev,
            observed_before.st_ino,
            observed_before.st_rdev,
            observed_before.st_mode,
            observed_before.st_uid,
            observed_before.st_gid,
        ) != (
            observed_after.st_dev,
            observed_after.st_ino,
            observed_after.st_rdev,
            observed_after.st_mode,
            observed_after.st_uid,
            observed_after.st_gid,
        ):
            raise PreflightError("tty_invalid")


def verify_pre_private(
    launcher_path: os.PathLike[str] | str,
    tty_fd: int,
    *,
    bootstrap_binding: ApprovalBootstrapBinding,
    approval_parent: os.PathLike[str] | str | None = None,
    account_home: os.PathLike[str] | str | None = None,
    environment: Mapping[str, str] | None = None,
) -> VerifiedPreflight:
    """Perform the sole shared public verifier used by normal/verify-only modes.

    ``approval_parent`` and ``account_home`` are dependency-injection seams for
    synthetic tests.  The reviewed operator path passes neither and therefore
    derives the one profile-declared location from the effective user's passwd
    record.  This function performs no write and never accesses the
    ``operator_session_root_path`` carried by the approval artifact.
    """

    repository = repository_root_from_launcher(launcher_path)
    profile_snapshot = _read_public_profile(repository)
    profile = profile_snapshot.profile
    verify_startup_environment(environment)
    verify_tty(tty_fd, environment)
    verify_known_recording_ancestors()
    checkout = _git_ascii(repository, ["rev-parse", "HEAD"])
    if GIT_SHA_RE.fullmatch(checkout) is None:
        raise PreflightError("repository_binding_mismatch")
    parent = (
        Path(approval_parent)
        if approval_parent is not None
        else default_approval_parent(profile, account_home=account_home)
    )
    approval, approval_name, approval_sha256 = _load_unique_approval(
        parent,
        bootstrap_binding=bootstrap_binding,
        checkout=checkout,
        profile=profile,
        repository=repository,
    )
    checkout, blobs, authoring, operator = _verify_repository(
        repository,
        approval=approval,
        profile_snapshot=profile_snapshot,
    )
    python_identity = _verify_python(profile, approval)
    return VerifiedPreflight(
        approval=approval,
        approval_name=approval_name,
        approval_sha256=approval_sha256,
        approved_checkout_sha=checkout,
        authoring_procedure_identity_sha256=authoring,
        operator_session_procedure_identity_sha256=operator,
        operator_session_root_path=approval["operator_session_root_path"],
        profile=profile,
        profile_sha256=profile_snapshot.profile_sha256,
        python_identity_sha256=python_identity,
        repository_root=os.fspath(repository),
        reviewed_file_blobs=blobs,
        summary={label: True for label in EXPECTED_SUMMARY_LABELS},
    )


__all__ = [
    "ApprovalBootstrapBinding",
    "APPROVAL_MAX_BYTES",
    "PROFILE_MAX_BYTES",
    "PROFILE_RELATIVE_PATH",
    "PreflightError",
    "PublicProfileSnapshot",
    "VerifiedPreflight",
    "canonical_json_bytes",
    "default_approval_parent",
    "fixed_diagnostic",
    "repository_root_from_launcher",
    "sha256_bytes",
    "strict_canonical_json_loads",
    "validate_approval",
    "validate_profile",
    "verify_known_recording_ancestors",
    "verify_pre_private",
    "verify_startup_environment",
    "verify_tty",
]
