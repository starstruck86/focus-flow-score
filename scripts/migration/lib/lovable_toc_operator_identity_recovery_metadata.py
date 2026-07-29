#!/usr/bin/env python3
"""Read-only generation-one metadata probe for operator identity recovery.

The probe deliberately has no action, recovery, validation, or restore
dispatch.  Public repository, Python, ordinary-approval, and probe-approval
verification completes before the first private pathname operation.  After
the operator authorizes the exact consequence, this module reads only the
generation-one root authorization, current resume, checkpoint, and release
marker.  It emits one closed owner-private metadata result through the held
controlling TTY and never discloses the stored operator identity.
"""

from __future__ import annotations

import base64
import datetime as dt
import hashlib
import hmac
import json
import os
from pathlib import Path
import pwd
import re
import secrets
import stat
import sys
from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from . import lovable_toc_authoring_contract as AUTHORING
from . import lovable_toc_contract as TOC
from . import lovable_toc_operator_identity_recovery as RECOVERY
from . import lovable_toc_operator_preflight as PREFLIGHT


STAGE = "toc_operator_identity_recovery_metadata_probe"
PROFILE_RELATIVE_PATH = (
    "scripts/migration/verification/"
    "lovable-toc-operator-identity-recovery-metadata-profile.v1.json"
)
PROFILE_KIND = "lovable_toc_operator_identity_recovery_metadata_profile"
APPROVAL_KIND = "lovable_toc_operator_identity_recovery_metadata_approval"
RESULT_KIND = "lovable_toc_operator_identity_recovery_metadata"
APPROVAL_RELATIVE_PARENT = (
    "Library/Application Support/focus-flow-score/migration-approvals/"
    "toc-operator-identity-recovery-metadata"
)
APPROVAL_NAME_RE = re.compile(
    r"^lovable-toc-operator-identity-recovery-metadata-approval-"
    r"([0-9a-f]{40})-[0-9a-f]{16}[.]json$",
    re.ASCII,
)
ROOT_NAME_RE = re.compile(r"^authorization-root-([0-9a-f]{16})[.]json$", re.ASCII)
RESUME_NAME_RE = re.compile(
    r"^resume-current-g0000000000000001-([0-9a-f]{64})[.]json$", re.ASCII
)
CHECKPOINT_NAME_RE = re.compile(
    r"^checkpoint-g0000000000000001-([0-9a-f]{64})[.]json$", re.ASCII
)
HEX64_RE = re.compile(r"^[0-9a-f]{64}$", re.ASCII)
GIT_SHA_RE = re.compile(r"^[0-9a-f]{40}$", re.ASCII)
SAFE_IDENTITY_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ._@()+:-]{0,127}$", re.ASCII)
SAFE_SESSION_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$", re.ASCII)
UTC_RE = re.compile(
    r"^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])"
    r"T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]Z$",
    re.ASCII,
)
AI_IDENTITY_RE = re.compile(
    r"(?:^|[^a-z0-9])(?:ai|bot|chatgpt|claude|codex|copilot|gemini|"
    r"llm|model|openai)(?:$|[^a-z0-9])",
    re.IGNORECASE | re.ASCII,
)

MAX_PROFILE_BYTES = 512 * 1024
MAX_RESULT_BYTES = 16 * 1024
MAX_PRIVATE_PATH_CHARACTERS = 4096
MAX_OPERATOR_INPUT_BYTES = 256
INVOCATION_NONCE_BYTES = 16
CONSEQUENCE_CHALLENGE_BYTES = 5
MAX_APPROVAL_LIFETIME = dt.timedelta(hours=24)
EXPECTED_GENERATION = 1
EXPECTED_STATE = "PRIMARY_REVIEW_REQUIRED"
TTY_ATTESTATION = "LOCAL_CONTROLLING_TTY_NO_RECORDING_NO_REMOTE_NO_CLIPBOARD"
NO_RETRY_ACKNOWLEDGEMENT = "NO_RETRY_AFTER_PRIVATE_ACCESS"
TRUST_ACKNOWLEDGEMENT = (
    "PROCEDURAL_METADATA_PROBE_REVIEW_AND_DOCUMENTED_CEILINGS_ACCEPTED"
)
ACCEPTED_CEILINGS = (
    "HOSTILE_SAME_UID_PRELAUNCH_PATH_REPLACEMENT",
    "LOCAL_TERMINAL_PARTIAL_WRITE_OR_RECORDING_NOT_INDEPENDENTLY_ATTESTABLE",
    "READ_ATIME_SIDE_EFFECT_NOT_INDEPENDENTLY_ATTESTABLE",
    "READ_ONLY_AUTHORIZATION_CONSUMPTION_NOT_DURABLY_RECORDED",
    "PROCESS_MEMORY_ZEROIZATION_NOT_INDEPENDENTLY_ATTESTABLE",
)
ALLOWED_READS = (
    "operator_session_root_descriptor_metadata",
    "operator_session_root_exact_namespace",
    "root_authorization_v1_canonical_bytes",
    "current_generation_one_resume_v2_canonical_bytes",
    "annotation_root_descriptor_metadata",
    "annotation_root_exact_namespace",
    "checkpoints_directory_descriptor_metadata",
    "checkpoints_exact_namespace",
    "generation_one_checkpoint_v1_canonical_bytes",
    "AUTHORING_RELEASED_stable_bytes",
)
ALLOWED_OUTPUT = "one_canonical_owner_private_metadata_result_on_held_tty_only"
PROHIBITED_EFFECTS = (
    "approval_mutation",
    "annotation_decision_mutation",
    "audit_record_creation",
    "authoring_action_dispatch",
    "bytecode_write",
    "cache_creation",
    "capture_package_access",
    "checkpoint_mutation",
    "chmod",
    "create",
    "database_access",
    "directory_fsync",
    "file_fsync",
    "identity_disclosure",
    "link",
    "lock_creation",
    "marker_creation",
    "mkdir",
    "network_access",
    "raw_toc_access",
    "receipt_creation",
    "recovery_action_dispatch",
    "recovery_evidence_access",
    "rename",
    "restore_command_generation",
    "root_authorization_mutation",
    "runtime_access",
    "subprocess_after_public_preflight",
    "unlink",
    "write",
    "validator_invocation",
)


class MetadataProbeError(RuntimeError):
    """Closed public diagnostic; no observed values are retained."""

    ALLOWED = frozenset(
        {
            "approval_ambiguous",
            "approval_binding_mismatch",
            "approval_invalid",
            "approval_missing",
            "authorization_failed",
            "binding_mismatch",
            "execution_profile_invalid",
            "indeterminate",
            "internal_failure",
            "private_chain_invalid",
            "python_identity_mismatch",
            "repository_binding_mismatch",
            "startup_environment_invalid",
            "tty_invalid",
        }
    )

    def __init__(self, reason: str):
        self.reason = reason if reason in self.ALLOWED else "internal_failure"
        super().__init__(self.reason)


@dataclass(frozen=True)
class MetadataVerified:
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
class MetadataSnapshot:
    root: Observation
    resume: Observation
    checkpoint: Observation
    root_fd: int
    root_identity: tuple[Any, ...]
    root_path: Path
    annotation_fd: int
    annotation_identity: tuple[Any, ...]
    annotation_path: Path
    checkpoints_fd: int
    checkpoints_identity: tuple[Any, ...]
    released: Any
    capture_root_path: str


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
    selected = reason if reason in MetadataProbeError.ALLOWED else "internal_failure"
    try:
        TOC.emit_fixed_diagnostic(sys.stderr.buffer, _fixed("failed", selected))
    except BaseException:
        pass


def emit_success() -> None:
    try:
        TOC.emit_fixed_diagnostic(sys.stdout.buffer, _fixed("pass", "metadata_delivered"))
    except BaseException:
        pass


def _fail(reason: str) -> None:
    raise MetadataProbeError(reason)


def held_tty_fd() -> int:
    raw = os.environ.get("TOC_OPERATOR_TTY_FD")
    if type(raw) is not str or not raw.isdigit() or int(raw) < 3:
        _fail("tty_invalid")
    descriptor = int(raw)
    _verify_tty(descriptor, private_access_started=False)
    return descriptor


def _verify_tty(tty_fd: int, *, private_access_started: bool) -> None:
    try:
        PREFLIGHT.verify_tty(tty_fd)
    except PREFLIGHT.PreflightError as exc:
        raise MetadataProbeError(
            "indeterminate" if private_access_started else "tty_invalid"
        ) from exc


def _verify_approved_tty(
    tty_fd: int,
    tty_binding: Mapping[str, Any],
    *,
    private_access_started: bool,
) -> None:
    reason = "indeterminate" if private_access_started else "tty_invalid"
    _verify_tty(tty_fd, private_access_started=private_access_started)
    if (
        type(tty_binding) is not dict
        or set(tty_binding) != {"device", "inode"}
        or type(tty_binding.get("device")) is not int
        or type(tty_binding.get("inode")) is not int
        or tty_binding["inode"] <= 0
    ):
        _fail(reason)
    try:
        before = os.fstat(tty_fd)
    except OSError as exc:
        raise MetadataProbeError(reason) from exc
    expected = (tty_binding["device"], tty_binding["inode"])
    if (before.st_dev, before.st_ino) != expected:
        _fail(reason)
    _verify_tty(tty_fd, private_access_started=private_access_started)
    try:
        after = os.fstat(tty_fd)
    except OSError as exc:
        raise MetadataProbeError(reason) from exc
    if (after.st_dev, after.st_ino) != expected:
        _fail(reason)


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


def _exact(value: Any, keys: Sequence[str] | set[str] | frozenset[str]) -> Mapping[str, Any]:
    if type(value) is not dict or set(value) != set(keys):
        _fail("binding_mismatch")
    return value


def _canonical(value: Any) -> bytes:
    return TOC.canonical_json_bytes(value)


def _digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


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
        if stat.S_ISLNK(before_path.st_mode) or not stat.S_ISREG(before_path.st_mode):
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
        ) or before.st_size <= 0 or before.st_size > MAX_PROFILE_BYTES:
            raise OSError
        chunks: list[bytes] = []
        total = 0
        while total <= MAX_PROFILE_BYTES:
            chunk = os.read(descriptor, min(65536, MAX_PROFILE_BYTES + 1 - total))
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
        data = b"".join(chunks)
        after = os.fstat(descriptor)
        after_path = os.lstat(path)
        identity = PREFLIGHT._public_profile_file_identity(before)
        if (
            identity != PREFLIGHT._public_profile_file_identity(after)
            or (
                before.st_dev,
                before.st_ino,
                before.st_mode,
                before.st_size,
            )
            != (
                after_path.st_dev,
                after_path.st_ino,
                after_path.st_mode,
                after_path.st_size,
            )
        ):
            raise OSError
        value = PREFLIGHT.strict_canonical_json_loads(
            data,
            maximum_bytes=MAX_PROFILE_BYTES,
            reason="execution_profile_invalid",
        )
    except (OSError, PREFLIGHT.PreflightError) as exc:
        raise MetadataProbeError("binding_mismatch") from exc
    finally:
        if descriptor >= 0:
            try:
                os.close(descriptor)
            except OSError:
                pass
    if type(value) is not dict or data != _canonical(value):
        _fail("binding_mismatch")
    try:
        blob = PREFLIGHT._git_ascii(
            repository, ["rev-parse", f"HEAD:{PROFILE_RELATIVE_PATH}"]
        )
        working = PREFLIGHT._git_ascii(
            repository, ["hash-object", "--", PROFILE_RELATIVE_PATH]
        )
    except PREFLIGHT.PreflightError as exc:
        raise MetadataProbeError("binding_mismatch") from exc
    if blob != working:
        _fail("binding_mismatch")
    return value, data, blob


def _profile_reviewed_files(profile: Mapping[str, Any]) -> tuple[str, ...]:
    value = profile.get("reviewed_files")
    if (
        type(value) is not list
        or not value
        or value != sorted(value)
        or len(value) != len(set(value))
        or any(
            type(item) is not str
            or not item
            or item.startswith("/")
            or ".." in Path(item).parts
            for item in value
        )
    ):
        _fail("binding_mismatch")
    return tuple(value)


def _validate_profile(profile: Mapping[str, Any]) -> Mapping[str, Any]:
    _exact(
        profile,
        {
            "accepted_ceilings",
            "approval_discovery",
            "artifact_kind",
            "checkout_policy",
            "format_version",
            "ordinary_execution_approval_dependency",
            "output_contract",
            "permitted_private_reads",
            "procedure_identity_formula",
            "prohibited_effects",
            "python_policy",
            "record_versions",
            "recovery_metadata_contract",
            "repository",
            "reviewed_files",
            "verification_labels",
        },
    )
    if (
        profile["artifact_kind"] != PROFILE_KIND
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
        != {"checkpoint": [1], "resume": [2], "root_authorization": [1]}
        or tuple(profile["accepted_ceilings"]) != ACCEPTED_CEILINGS
        or tuple(profile["prohibited_effects"]) != PROHIBITED_EFFECTS
        or profile["verification_labels"]
        != [
            "checkout_verified",
            "metadata_approval_verified",
            "metadata_procedure_verified",
            "ordinary_execution_approval_verified",
            "profile_verified",
            "python_verified",
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
        discovery["filename_pattern"] != APPROVAL_NAME_RE.pattern
        or discovery["home_resolution"] != "passwd_database_effective_uid"
        or discovery["relative_parent"] != APPROVAL_RELATIVE_PARENT
        or discovery["required_file_mode"] != "0400"
        or discovery["required_file_nlink"] != 1
        or discovery["required_parent_mode"] != "0700"
        or discovery["selection"] != "exactly_one_matching_current_checkout"
    ):
        _fail("binding_mismatch")
    ordinary = _exact(
        profile["ordinary_execution_approval_dependency"],
        {
            "exact_current_checkout",
            "public_verifier",
            "required",
            "selection",
        },
    )
    contract = _exact(
        profile["recovery_metadata_contract"],
        {
            "authorization_consumption",
            "challenge_phrase_prefix",
            "expected_generation",
            "expected_predecessor",
            "expected_state",
            "identity_comparison",
            "identity_disclosure",
            "no_retry_acknowledgement",
            "ordinary_action_dispatched",
            "private_mutation",
            "recovery_action_dispatched",
        },
    )
    if (
        ordinary
        != {
            "exact_current_checkout": True,
            "public_verifier": "shared_ordinary_pre_private",
            "required": True,
            "selection": "exactly_one_matching_current_checkout",
        }
        or tuple(profile["permitted_private_reads"]) != ALLOWED_READS
        or contract["challenge_phrase_prefix"]
        != "AUTHORIZE PROBE_RECOVERY_METADATA"
        or contract["expected_generation"] != EXPECTED_GENERATION
        or contract["expected_predecessor"] != "absent"
        or contract["expected_state"] != EXPECTED_STATE
        or contract["authorization_consumption"]
        != "procedural_on_first_private_pathname_operation"
        or contract["identity_comparison"] != "internal_equality_only"
        or contract["identity_disclosure"] != "forbidden"
        or contract["no_retry_acknowledgement"] != NO_RETRY_ACKNOWLEDGEMENT
        or contract["ordinary_action_dispatched"] is not False
        or contract["private_mutation"] != "forbidden"
        or contract["recovery_action_dispatched"] is not False
    ):
        _fail("binding_mismatch")
    output = _exact(
        profile["output_contract"],
        {
            "artifact_kind",
            "destination",
            "encoding",
            "format_version",
            "maximum_bytes",
            "metadata_results_per_invocation",
            "ordinary_diagnostics",
            "prohibited_fields",
        },
    )
    if (
        output["artifact_kind"] != RESULT_KIND
        or output["destination"] != "held_verified_tty_only"
        or output["encoding"] != "canonical_compact_sorted_ascii_json_lf"
        or output["format_version"] != 1
        or output["maximum_bytes"] != MAX_RESULT_BYTES
        or output["metadata_results_per_invocation"] != 1
        or output["ordinary_diagnostics"] != "fixed_categorical_only"
        or output["prohibited_fields"]
        != [
            "operator_identity",
            "primary_operator_identity",
            "identity_length",
            "identity_prefix",
            "identity_suffix",
            "identity_encoding",
            "identity_sha256",
            "identity_fingerprint",
            "release_token",
            "checkpoint_entries",
            "decisions",
            "capture_metadata",
            "raw_private_json",
            "arbitrary_filenames",
            "mismatch_details",
            "exceptions",
        ]
    ):
        _fail("binding_mismatch")
    return profile


def _approval_parent(profile: Mapping[str, Any]) -> Path:
    try:
        home = Path(pwd.getpwuid(os.geteuid()).pw_dir)
        if not home.is_absolute():
            raise OSError
        return home.joinpath(
            *Path(profile["approval_discovery"]["relative_parent"]).parts
        )
    except (KeyError, OSError, TypeError) as exc:
        raise MetadataProbeError("approval_missing") from exc


def _load_approval(
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
        if (
            PREFLIGHT._approval_parent_identity(held)
            != PREFLIGHT._approval_parent_identity(named)
            or PREFLIGHT._approval_parent_identity(held) != bootstrap.parent_identity
        ):
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
            PREFLIGHT._approval_file_identity(metadata) != bootstrap.file_identity
            or _digest(data) != bootstrap.approval_sha256
            or PREFLIGHT._approval_parent_identity(held)
            != PREFLIGHT._approval_parent_identity(os.fstat(parent_fd))
        ):
            _fail("approval_invalid")
    except FileNotFoundError as exc:
        raise MetadataProbeError("approval_missing") from exc
    except MetadataProbeError:
        raise
    except (OSError, PREFLIGHT.PreflightError, RuntimeError) as exc:
        raise MetadataProbeError("approval_invalid") from exc
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
        raise MetadataProbeError("approval_invalid") from exc
    if type(value) is not dict or data != _canonical(value):
        _fail("approval_invalid")
    return value, matches[0], _digest(data)


def _parse_expiry(value: Any) -> dt.datetime:
    if type(value) is not str or UTC_RE.fullmatch(value) is None:
        _fail("approval_invalid")
    try:
        parsed = dt.datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(
            tzinfo=dt.timezone.utc
        )
    except ValueError as exc:
        raise MetadataProbeError("approval_invalid") from exc
    now = dt.datetime.now(dt.timezone.utc)
    if parsed <= now or parsed > now + MAX_APPROVAL_LIFETIME:
        _fail("approval_invalid")
    return parsed


def _validate_absolute_literal(value: Any, repository: Path) -> str:
    if (
        type(value) is not str
        or not value.startswith("/")
        or len(value) > MAX_PRIVATE_PATH_CHARACTERS
        or "\x00" in value
        or os.path.abspath(value) != value
        or any(part in {"", ".", ".."} for part in Path(value).parts)
    ):
        _fail("approval_invalid")
    try:
        Path(value).relative_to(repository)
    except ValueError:
        return value
    _fail("approval_invalid")


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
    repository: Path,
) -> Mapping[str, Any]:
    _exact(
        approval,
        {
            "accepted_ceilings",
            "allowed_output",
            "approved_checkout_sha",
            "artifact_kind",
            "authorizer_identity",
            "executing_operator_identity",
            "expected_chain",
            "format_version",
            "independent_reviewer_identity",
            "local_tty_attestation",
            "metadata_probe_profile",
            "metadata_probe_procedure_identity_sha256",
            "metadata_session",
            "no_retry_acknowledgement",
            "operator_session_root_path",
            "ordinary_execution_approval",
            "permitted_private_reads",
            "python_identity",
            "repository",
            "review_reference",
            "reviewed_file_blobs",
            "trust_model_acknowledgement",
            "tty_binding",
        },
    )
    if (
        approval["artifact_kind"] != APPROVAL_KIND
        or approval["format_version"] != 1
        or approval["approved_checkout_sha"] != checkout
        or approval["repository"]
        != {"name": "focus-flow-score", "owner": "starstruck86"}
        or approval["accepted_ceilings"] != list(ACCEPTED_CEILINGS)
        or approval["permitted_private_reads"] != list(ALLOWED_READS)
        or approval["allowed_output"] != ALLOWED_OUTPUT
        or approval["local_tty_attestation"] != TTY_ATTESTATION
        or approval["no_retry_acknowledgement"] != NO_RETRY_ACKNOWLEDGEMENT
        or approval["trust_model_acknowledgement"] != TRUST_ACKNOWLEDGEMENT
        or approval["metadata_probe_profile"]
        != {"format_version": 1, "sha256": profile_sha256}
        or approval["metadata_probe_procedure_identity_sha256"]
        != procedure_identity
        or approval["reviewed_file_blobs"] != dict(blobs)
        or approval["operator_session_root_path"]
        != ordinary.operator_session_root_path
        or approval["python_identity"] != ordinary.approval["python_identity"]
    ):
        _fail("binding_mismatch")
    _validate_absolute_literal(approval["operator_session_root_path"], repository)
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
        approval["metadata_session"],
        {"expires_at_utc", "metadata_session_id", "nonce"},
    )
    _safe_session(session["metadata_session_id"])
    _sha(session["nonce"])
    _parse_expiry(session["expires_at_utc"])
    _verify_approved_tty(
        tty_fd, _exact(approval["tty_binding"], {"device", "inode"}),
        private_access_started=False,
    )
    chain = _exact(
        approval["expected_chain"],
        {"checkpoint", "generation", "resume", "root_authorization", "state"},
    )
    if (
        chain
        != {
            "checkpoint": {"format_version": 1},
            "generation": EXPECTED_GENERATION,
            "resume": {"format_version": 2, "predecessor": "absent"},
            "root_authorization": {"format_version": 1},
            "state": EXPECTED_STATE,
        }
    ):
        _fail("binding_mismatch")
    return approval


def _procedure_identity(
    checkout: str, formula: Mapping[str, Any], blobs: Mapping[str, str]
) -> str:
    record = {"execution_checkout_sha": checkout}
    for relative in formula["files"]:
        try:
            record[relative] = blobs[relative]
        except KeyError as exc:
            raise MetadataProbeError("binding_mismatch") from exc
    return _digest(_canonical(record))


def _historical_bridge(ordinary_profile: Mapping[str, Any]) -> Mapping[str, Any]:
    """Return the sole ordinary profile bridge that created generation one."""

    bridges = ordinary_profile.get("compatibility_bridges")
    if type(bridges) is not list or len(bridges) != 1:
        _fail("binding_mismatch")
    bridge = _exact(
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
    )
    if (
        bridge["allowed_action"] != "primary_review"
        or bridge["generation"] != EXPECTED_GENERATION
        or bridge["required_state"] != EXPECTED_STATE
        or bridge["resume_predecessor"] != "absent"
        or bridge["self_closing"]
        != {
            "ordinary_exact_current_rules_after_success": True,
            "reject_generation_at_or_above": 2,
            "single_use": True,
        }
    ):
        _fail("binding_mismatch")
    _git_sha(bridge["execution_checkout_sha"])
    _sha(bridge["authoring_procedure_identity_sha256"])
    _sha(bridge["operator_session_procedure_identity_sha256"])
    python = _exact(
        bridge["python"], {"absolute_path", "reported_version", "sha256"}
    )
    if (
        type(python["absolute_path"]) is not str
        or not python["absolute_path"].startswith("/")
        or type(python["reported_version"]) is not str
    ):
        _fail("binding_mismatch")
    _sha(python["sha256"])
    return bridge


def verify_pre_private(
    *,
    launcher: Path,
    ordinary_launcher: Path,
    ordinary_bootstrap: PREFLIGHT.ApprovalBootstrapBinding,
    metadata_bootstrap: PREFLIGHT.ApprovalBootstrapBinding,
    ordinary_module: Any,
    tty_fd: int,
    approval_parent: Path | None = None,
    ordinary_approval_parent: Path | None = None,
    account_home: Path | None = None,
) -> MetadataVerified:
    """Verify all public bindings without any private-root operation."""

    ordinary = PREFLIGHT.verify_pre_private(
        ordinary_launcher,
        tty_fd,
        bootstrap_binding=ordinary_bootstrap,
        approval_parent=ordinary_approval_parent,
        account_home=account_home,
    )
    repository = Path(PREFLIGHT.repository_root_from_launcher(launcher))
    if os.fspath(repository) != ordinary.repository_root:
        _fail("binding_mismatch")
    profile, profile_data, profile_blob = _read_public_profile(repository)
    _validate_profile(profile)
    if profile["python_policy"] != ordinary.profile["python_policy"]:
        _fail("binding_mismatch")
    checkout = ordinary.approved_checkout_sha
    for reference in ("HEAD", "refs/heads/main", "refs/remotes/origin/main"):
        if PREFLIGHT._git_ascii(repository, ["rev-parse", reference]) != checkout:
            _fail("binding_mismatch")
    profile_sha256 = _digest(profile_data)
    parent = approval_parent if approval_parent is not None else _approval_parent(profile)
    approval, name, approval_sha256 = _load_approval(
        parent,
        bootstrap=metadata_bootstrap,
        checkout=checkout,
        profile=profile,
    )
    reviewed = _profile_reviewed_files(profile)
    blobs = approval.get("reviewed_file_blobs")
    if type(blobs) is not dict or set(blobs) != set(reviewed):
        _fail("binding_mismatch")
    for relative in reviewed:
        expected_blob = blobs.get(relative)
        if type(expected_blob) is not str or GIT_SHA_RE.fullmatch(expected_blob) is None:
            _fail("approval_invalid")
        committed = PREFLIGHT._git_ascii(
            repository, ["rev-parse", f"{checkout}:{relative}"]
        )
        working = (
            profile_blob
            if relative == PROFILE_RELATIVE_PATH
            else PREFLIGHT._git_ascii(repository, ["hash-object", "--", relative])
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
        repository=repository,
    )
    historical = _historical_bridge(ordinary.profile)
    try:
        historical_python = ordinary_module._validated_python_identity(
            {
                "path": historical["python"]["absolute_path"],
                "sha256": historical["python"]["sha256"],
                "version": historical["python"]["reported_version"],
            }
        )
    except BaseException as exc:
        raise MetadataProbeError("binding_mismatch") from exc
    return MetadataVerified(
        approval=approval,
        approval_name=name,
        approval_sha256=approval_sha256,
        ordinary=ordinary,
        profile=profile,
        profile_sha256=profile_sha256,
        procedure_identity_sha256=procedure_identity,
        repository_root=os.fspath(repository),
        historical_python_identity_sha256=historical_python["identity_sha256"],
    )


def _tty_write(tty_fd: int, payload: bytes, *, private_access_started: bool) -> None:
    if any(byte > 0x7F for byte in payload):
        _fail("internal_failure")
    remaining = memoryview(payload)
    try:
        while remaining:
            written = os.write(tty_fd, remaining)
            if type(written) is not int or written <= 0 or written > len(remaining):
                raise OSError
            remaining = remaining[written:]
    except OSError as exc:
        raise MetadataProbeError(
            "indeterminate" if private_access_started else "tty_invalid"
        ) from exc


def _read_hidden(tty_fd: int, prompt: bytes) -> str:
    import termios

    if not prompt.endswith(b": "):
        _fail("internal_failure")
    data = bytearray()
    old = None
    pending: BaseException | None = None
    try:
        _tty_write(tty_fd, prompt, private_access_started=False)
        old = termios.tcgetattr(tty_fd)
        changed = list(old)
        changed[3] &= ~termios.ECHO
        termios.tcsetattr(tty_fd, termios.TCSADRAIN, changed)
        while len(data) <= MAX_OPERATOR_INPUT_BYTES:
            chunk = os.read(tty_fd, 1)
            if chunk == b"":
                _fail("authorization_failed")
            if chunk in {b"\n", b"\r"}:
                break
            data.extend(chunk)
        else:
            _fail("authorization_failed")
    except BaseException as exc:
        pending = exc
    finally:
        try:
            if old is not None:
                termios.tcsetattr(tty_fd, termios.TCSADRAIN, old)
            _tty_write(tty_fd, b"\n", private_access_started=False)
        except BaseException as exc:
            if pending is None:
                pending = exc
    if pending is not None:
        if isinstance(pending, MetadataProbeError):
            raise pending
        raise MetadataProbeError("tty_invalid") from pending
    try:
        value = bytes(data).decode("utf-8", errors="strict")
    except UnicodeError as exc:
        raise MetadataProbeError("authorization_failed") from exc
    if any(ord(character) < 0x20 or ord(character) == 0x7F for character in value):
        _fail("authorization_failed")
    return value


def _challenge(verified: MetadataVerified, invocation_nonce: bytes) -> str:
    if type(invocation_nonce) is not bytes or len(invocation_nonce) != INVOCATION_NONCE_BYTES:
        _fail("internal_failure")
    consequence = {
        "approved_checkout_sha": verified.ordinary.approved_checkout_sha,
        "expected_generation": EXPECTED_GENERATION,
        "expected_state": EXPECTED_STATE,
        "metadata_approval_sha256": verified.approval_sha256,
        "metadata_profile_sha256": verified.profile_sha256,
        "metadata_procedure_identity_sha256": verified.procedure_identity_sha256,
        "metadata_session_id": verified.approval["metadata_session"][
            "metadata_session_id"
        ],
        "no_identity_disclosure": True,
        "no_retry_after_private_access": True,
        "no_write": True,
        "ordinary_approval_sha256": verified.ordinary.approval_sha256,
    }
    encoded = base64.b32encode(
        hashlib.sha256(
            b"toc-operator-identity-recovery-metadata-probe-v1\x00"
            + bytes.fromhex(verified.approval["metadata_session"]["nonce"])
            + invocation_nonce
            + _canonical(consequence)
        ).digest()[:CONSEQUENCE_CHALLENGE_BYTES]
    ).decode("ascii").rstrip("=")
    if len(encoded) != 8:
        _fail("internal_failure")
    return encoded[:4] + "-" + encoded[4:]


def authorize_consequence(
    tty_fd: int,
    verified: MetadataVerified,
    *,
    invocation_nonce: bytes | None = None,
) -> None:
    if invocation_nonce is None:
        try:
            invocation_nonce = secrets.token_bytes(INVOCATION_NONCE_BYTES)
        except BaseException as exc:
            raise MetadataProbeError("internal_failure") from exc
    phrase = "AUTHORIZE PROBE_RECOVERY_METADATA " + _challenge(
        verified, invocation_nonce
    )
    summary = (
        "ACTION: PROBE_RECOVERY_METADATA\n"
        "EXPECTED GENERATION: 1\n"
        "EXPECTED STATE: PRIMARY_REVIEW_REQUIRED\n"
        "PRIVATE EFFECTS:\n"
        "- read and validate the immutable generation-one metadata chain\n"
        "- read no capture package, raw TOC, opaque index, opaque key, or business data\n"
        "- reveal no operator identity or standalone identity derivative\n"
        "- create no lock, marker, audit record, receipt, or state mutation\n"
        "- output one bounded owner-private metadata result on this verified TTY\n"
        "- consume authorization on the first private pathname operation\n"
        "- permit no automatic retry\n"
        "- run no recovery or authoring action\n"
        "NO OTHER ACTION AUTHORIZED\n"
        "TYPE EXACTLY: "
        + phrase
        + "\n"
    ).encode("ascii")
    _verify_tty(tty_fd, private_access_started=False)
    _tty_write(tty_fd, summary, private_access_started=False)
    observed = _read_hidden(
        tty_fd, b"metadata_probe_consequence_authorization: "
    )
    _verify_tty(tty_fd, private_access_started=False)
    if not secrets.compare_digest(observed, phrase):
        _fail("authorization_failed")


def _private_path(value: Any, repository: Path) -> Path:
    if (
        type(value) is not str
        or not value.startswith("/")
        or len(value) > MAX_PRIVATE_PATH_CHARACTERS
        or "\x00" in value
    ):
        _fail("private_chain_invalid")
    if os.path.abspath(value) != value:
        _fail("private_chain_invalid")
    path = Path(value)
    try:
        path.relative_to(repository)
    except ValueError:
        return path
    _fail("private_chain_invalid")


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
        raise MetadataProbeError("indeterminate") from exc


def _revalidate_directory(path: Path, descriptor: int, identity: tuple[Any, ...]) -> None:
    try:
        if (
            _directory_identity(os.fstat(descriptor)) != identity
            or _directory_identity(os.lstat(path)) != identity
            or path.resolve(strict=True) != path
        ):
            raise OSError
    except (OSError, RuntimeError) as exc:
        raise MetadataProbeError("indeterminate") from exc


def _stable_json_at(
    root_fd: int, name: str, *, maximum_bytes: int = RECOVERY.MAX_RECORD_BYTES
) -> Observation:
    observed = _stable_file_at(
        root_fd, name, maximum_bytes=maximum_bytes, expected_size=None
    )
    try:
        value = TOC.strict_json_loads(observed.data, max_bytes=maximum_bytes)
    except TOC.ContractError as exc:
        raise MetadataProbeError("private_chain_invalid") from exc
    if type(value) is not dict or observed.data != _canonical(value):
        _fail("private_chain_invalid")
    return Observation(
        name=name,
        value=value,
        data=observed.data,
        sha256=observed.sha256,
        identity=_file_observation_identity(observed),
    )


def _stable_file_at(
    directory_fd: int,
    name: str,
    *,
    maximum_bytes: int,
    expected_size: int | None,
) -> TOC.StableFile:
    """Read one private file with security ambiguity separated from content."""

    if (
        type(name) is not str
        or (
            TOC.SAFE_NAME_RE.fullmatch(name) is None
            and name != RECOVERY.AUTHORING_RELEASED_NAME
        )
        or type(maximum_bytes) is not int
        or maximum_bytes <= 0
    ):
        _fail("private_chain_invalid")
    descriptor = -1
    pending: BaseException | None = None
    observed: TOC.StableFile | None = None
    try:
        descriptor = os.open(
            name,
            os.O_RDONLY
            | getattr(os, "O_CLOEXEC", 0)
            | getattr(os, "O_NONBLOCK", 0)
            | getattr(os, "O_NOFOLLOW", 0),
            dir_fd=directory_fd,
        )
        before = os.fstat(descriptor)
        parent = os.fstat(directory_fd)
        if (
            not stat.S_ISREG(before.st_mode)
            or before.st_uid != os.geteuid()
            or before.st_nlink != 1
            or stat.S_IMODE(before.st_mode) != 0o400
            or before.st_dev != parent.st_dev
            or before.st_size <= 0
            or before.st_size > maximum_bytes
            or (expected_size is not None and before.st_size != expected_size)
        ):
            _fail("indeterminate")
        chunks: list[bytes] = []
        digest = hashlib.sha256()
        size = 0
        while size <= maximum_bytes:
            chunk = os.read(
                descriptor, min(1024 * 1024, maximum_bytes + 1 - size)
            )
            if not chunk:
                break
            chunks.append(chunk)
            digest.update(chunk)
            size += len(chunk)
        after = os.fstat(descriptor)
        identity_before = (
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
        identity_after = (
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
        if identity_before != identity_after or size != after.st_size:
            _fail("indeterminate")
        observed = TOC.StableFile(
            data=b"".join(chunks),
            sha256=digest.hexdigest(),
            size=size,
            device=after.st_dev,
            inode=after.st_ino,
            owner_uid=after.st_uid,
            owner_gid=after.st_gid,
            mode=stat.S_IMODE(after.st_mode),
        )
    except BaseException as exc:
        pending = exc
    finally:
        if descriptor >= 0:
            try:
                os.close(descriptor)
            except OSError:
                pending = MetadataProbeError("indeterminate")
    if pending is not None:
        if isinstance(pending, MetadataProbeError):
            raise pending
        raise MetadataProbeError("indeterminate") from pending
    if observed is None:
        _fail("indeterminate")
    return observed


def _stable_release_marker(annotation_fd: int, expected_token: str) -> TOC.StableFile:
    if type(expected_token) is not str or HEX64_RE.fullmatch(expected_token) is None:
        _fail("private_chain_invalid")
    expected = (
        RECOVERY.AUTHORING_RELEASED_PREFIX
        + expected_token.encode("ascii")
        + b"\n"
    )
    observed = _stable_file_at(
        annotation_fd,
        RECOVERY.AUTHORING_RELEASED_NAME,
        maximum_bytes=len(expected),
        expected_size=len(expected),
    )
    if observed.data != expected:
        _fail("private_chain_invalid")
    return observed


def _revalidate_json_at(
    root_fd: int, expected: Observation, *, maximum_bytes: int = RECOVERY.MAX_RECORD_BYTES
) -> None:
    observed = _stable_json_at(root_fd, expected.name, maximum_bytes=maximum_bytes)
    if (
        observed.value != expected.value
        or observed.sha256 != expected.sha256
        or observed.identity != expected.identity
    ):
        _fail("indeterminate")


def _list_exact(
    directory_fd: int, expected: set[str], *, revalidation: bool = False
) -> None:
    try:
        names = os.listdir(directory_fd)
    except OSError as exc:
        raise MetadataProbeError("indeterminate") from exc
    if (
        any(type(name) is not str for name in names)
        or len(names) != len(set(names))
        or set(names) != expected
    ):
        _fail("indeterminate" if revalidation else "private_chain_invalid")


def _discover_root_names(root_fd: int) -> tuple[str, str]:
    try:
        names = os.listdir(root_fd)
    except OSError as exc:
        raise MetadataProbeError("indeterminate") from exc
    if any(type(name) is not str for name in names) or len(names) != len(set(names)):
        _fail("private_chain_invalid")
    roots = [name for name in names if ROOT_NAME_RE.fullmatch(name) is not None]
    resumes = [name for name in names if RESUME_NAME_RE.fullmatch(name) is not None]
    if len(names) != 2 or len(roots) != 1 or len(resumes) != 1:
        _fail("private_chain_invalid")
    return roots[0], resumes[0]


def _open_checkpoints(annotation_fd: int) -> tuple[int, tuple[Any, ...]]:
    descriptor = -1
    try:
        descriptor = os.open(
            RECOVERY.CHECKPOINTS_NAME,
            os.O_RDONLY
            | getattr(os, "O_DIRECTORY", 0)
            | getattr(os, "O_CLOEXEC", 0)
            | getattr(os, "O_NOFOLLOW", 0),
            dir_fd=annotation_fd,
        )
        held = os.fstat(descriptor)
        named = os.stat(
            RECOVERY.CHECKPOINTS_NAME,
            dir_fd=annotation_fd,
            follow_symlinks=False,
        )
        if (
            not stat.S_ISDIR(held.st_mode)
            or stat.S_ISLNK(named.st_mode)
            or held.st_uid != os.geteuid()
            or stat.S_IMODE(held.st_mode) != 0o700
            or _directory_identity(held) != _directory_identity(named)
            or held.st_dev != os.fstat(annotation_fd).st_dev
        ):
            raise OSError
        return descriptor, _directory_identity(held)
    except OSError as exc:
        if descriptor >= 0:
            try:
                os.close(descriptor)
            except OSError:
                pass
        raise MetadataProbeError("indeterminate") from exc


def _discover_checkpoint(checkpoints_fd: int) -> str:
    try:
        names = os.listdir(checkpoints_fd)
    except OSError as exc:
        raise MetadataProbeError("indeterminate") from exc
    if any(type(name) is not str for name in names) or len(names) != len(set(names)):
        _fail("private_chain_invalid")
    matches = [name for name in names if CHECKPOINT_NAME_RE.fullmatch(name)]
    if len(names) != 1 or len(matches) != 1:
        _fail("private_chain_invalid")
    return matches[0]


def _private_failure(exc: BaseException) -> MetadataProbeError:
    if isinstance(exc, MetadataProbeError):
        if exc.reason == "indeterminate":
            return exc
        return MetadataProbeError("private_chain_invalid")
    if isinstance(exc, RECOVERY.RecoveryError):
        if exc.reason == "indeterminate":
            return MetadataProbeError("indeterminate")
        return MetadataProbeError("private_chain_invalid")
    return MetadataProbeError("indeterminate")


def _load_snapshot(
    verified: MetadataVerified, repository: Path, ordinary_module: Any
) -> MetadataSnapshot:
    root_fd = annotation_fd = checkpoints_fd = -1
    try:
        root_path = _private_path(
            verified.approval["operator_session_root_path"], repository
        )
        root_fd, root_identity = _open_private_directory(root_path)
        root_name, resume_name = _discover_root_names(root_fd)
        root = _stable_json_at(root_fd, root_name)
        resume = _stable_json_at(root_fd, resume_name)
        if root_name != "authorization-root-" + root.sha256[:16] + ".json":
            _fail("private_chain_invalid")
        resume_value = resume.value
        root_value = root.value
        bridge = _historical_bridge(verified.ordinary.profile)
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
            or root_value["artifact_kind"] != "lovable_toc_operator_authorization"
            or root_value["format_version"] != 1
            or root_value["action"] != "initialize"
            or root_value["finalization_authorization"] != ""
            or root_value["operator_identity"] != root_value["primary_operator_identity"]
            or root_value["tty_attestation"] != TTY_ATTESTATION
            or root_value["initial_head"]
            != {
                "checkpoint_sha256": "0" * 64,
                "generation": 0,
                "release_token": "0" * 64,
            }
            or root_value["session_root"] != root_path.as_posix()
            or not ordinary_module._legacy_root_matches(root_value, bridge)
        ):
            _fail("private_chain_invalid")
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
        ):
            _fail("private_chain_invalid")
        capture_root_path = _private_path(
            root_capture["capture_root"], repository
        ).as_posix()
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
            or resume_value["capture"]
            != {
                "capture_manifest_sha256": root_capture["capture_manifest_sha256"],
                "evidence_run_id": root_capture["evidence_run_id"],
                "opaque_index_sha256": root_capture["opaque_index_sha256"],
                "raw_toc_sha256": root_capture["raw_toc_sha256"],
            }
            or not HEX64_RE.fullmatch(resume_value["resume_release_token"])
            or "predecessor" in resume_value
        ):
            _fail("private_chain_invalid")
        if resume_name != (
            "resume-current-g0000000000000001-"
            + resume_value["resume_checkpoint_sha256"]
            + ".json"
        ):
            _fail("private_chain_invalid")
        try:
            validated_resume = ordinary_module._validate_loaded_resume_record(
                resume_value,
                authorization_sha256=root.sha256,
                expected_operator_identity=root_value["primary_operator_identity"],
            )
        except BaseException as exc:
            raise MetadataProbeError("private_chain_invalid") from exc
        if (
            validated_resume != resume_value
            or not ordinary_module._current_resume_shape_matches(
                resume_value, resume_name
            )
        ):
            _fail("private_chain_invalid")
        annotation_path = _private_path(root_value["annotation_root"], repository)
        private_literals = tuple(
            os.path.normcase(value)
            for value in (
                root_path.as_posix(),
                annotation_path.as_posix(),
                capture_root_path,
            )
        )
        try:
            for index, left in enumerate(private_literals):
                for right in private_literals[index + 1 :]:
                    if os.path.commonpath((left, right)) in {left, right}:
                        _fail("private_chain_invalid")
        except ValueError as exc:
            raise MetadataProbeError("private_chain_invalid") from exc
        annotation_fd, annotation_identity = _open_private_directory(annotation_path)
        _list_exact(
            annotation_fd,
            {RECOVERY.CHECKPOINTS_NAME, RECOVERY.AUTHORING_RELEASED_NAME},
        )
        checkpoints_fd, checkpoints_identity = _open_checkpoints(annotation_fd)
        checkpoint_name = _discover_checkpoint(checkpoints_fd)
        checkpoint = _stable_json_at(
            checkpoints_fd,
            checkpoint_name,
            maximum_bytes=AUTHORING.MAX_CHECKPOINT_BYTES,
        )
        if (
            checkpoint_name
            != "checkpoint-g0000000000000001-" + checkpoint.sha256 + ".json"
            or checkpoint.sha256 != resume_value["resume_checkpoint_sha256"]
        ):
            _fail("private_chain_invalid")
        try:
            RECOVERY._validate_checkpoint(
                checkpoint.value,
                root=root_value,
                resume=resume_value,
                bridge=bridge,
            )
        except BaseException as exc:
            mapped = _private_failure(exc)
            if mapped is exc:
                raise mapped
            raise mapped from exc
        identities = (
            root_value["operator_identity"],
            root_value["primary_operator_identity"],
            resume_value["primary_operator_identity"],
            checkpoint.value["primary_operator_identity"],
            checkpoint.value["event"]["operator_identity"],
        )
        if any(
            not hmac.compare_digest(identities[0], value)
            for value in identities[1:]
        ):
            _fail("private_chain_invalid")
        released = _stable_release_marker(
            annotation_fd, resume_value["resume_release_token"]
        )
        snapshot = MetadataSnapshot(
            root=root,
            resume=resume,
            checkpoint=checkpoint,
            root_fd=root_fd,
            root_identity=root_identity,
            root_path=root_path,
            annotation_fd=annotation_fd,
            annotation_identity=annotation_identity,
            annotation_path=annotation_path,
            checkpoints_fd=checkpoints_fd,
            checkpoints_identity=checkpoints_identity,
            released=released,
            capture_root_path=capture_root_path,
        )
        root_fd = annotation_fd = checkpoints_fd = -1
        return snapshot
    except BaseException as exc:
        mapped = _private_failure(exc)
        if mapped is exc:
            raise mapped
        raise mapped from exc
    finally:
        close_failed = False
        for descriptor in (checkpoints_fd, annotation_fd, root_fd):
            if descriptor >= 0:
                try:
                    os.close(descriptor)
                except OSError:
                    close_failed = True
        if close_failed:
            raise MetadataProbeError("indeterminate")


def _revalidate_snapshot(snapshot: MetadataSnapshot) -> None:
    _revalidate_directory(
        snapshot.root_path, snapshot.root_fd, snapshot.root_identity
    )
    _revalidate_directory(
        snapshot.annotation_path,
        snapshot.annotation_fd,
        snapshot.annotation_identity,
    )
    try:
        named_checkpoints = os.stat(
            RECOVERY.CHECKPOINTS_NAME,
            dir_fd=snapshot.annotation_fd,
            follow_symlinks=False,
        )
        if (
            _directory_identity(os.fstat(snapshot.checkpoints_fd))
            != snapshot.checkpoints_identity
            or _directory_identity(named_checkpoints)
            != snapshot.checkpoints_identity
        ):
            raise OSError
    except OSError as exc:
        raise MetadataProbeError("indeterminate") from exc
    _list_exact(
        snapshot.root_fd,
        {snapshot.root.name, snapshot.resume.name},
        revalidation=True,
    )
    _list_exact(
        snapshot.annotation_fd,
        {RECOVERY.CHECKPOINTS_NAME, RECOVERY.AUTHORING_RELEASED_NAME},
        revalidation=True,
    )
    _list_exact(
        snapshot.checkpoints_fd,
        {snapshot.checkpoint.name},
        revalidation=True,
    )
    _revalidate_json_at(snapshot.root_fd, snapshot.root)
    _revalidate_json_at(snapshot.root_fd, snapshot.resume)
    _revalidate_json_at(
        snapshot.checkpoints_fd,
        snapshot.checkpoint,
        maximum_bytes=AUTHORING.MAX_CHECKPOINT_BYTES,
    )
    observed = _stable_release_marker(
        snapshot.annotation_fd,
        snapshot.resume.value["resume_release_token"],
    )
    if _file_observation_identity(observed) != _file_observation_identity(
        snapshot.released
    ):
        _fail("indeterminate")


def _close_snapshot(snapshot: MetadataSnapshot) -> None:
    failed = False
    for descriptor in (
        snapshot.checkpoints_fd,
        snapshot.annotation_fd,
        snapshot.root_fd,
    ):
        try:
            os.close(descriptor)
        except OSError:
            failed = True
    if failed:
        _fail("indeterminate")


def _result(verified: MetadataVerified, snapshot: MetadataSnapshot) -> bytes:
    value = {
        "approved_checkout_sha": verified.ordinary.approved_checkout_sha,
        "artifact_kind": RESULT_KIND,
        "expected_chain": {
            "checkpoint": {
                "format_version": 1,
                "sha256": snapshot.checkpoint.sha256,
            },
            "generation": 1,
            "resume": {
                "format_version": 2,
                "predecessor": "absent",
                "sha256": snapshot.resume.sha256,
            },
            "root_authorization": {
                "format_version": 1,
                "sha256": snapshot.root.sha256,
            },
            "state": EXPECTED_STATE,
        },
        "format_version": 1,
        "metadata_probe": {
            "procedure_identity_sha256": verified.procedure_identity_sha256,
            "profile_sha256": verified.profile_sha256,
        },
        "metadata_session_id": verified.approval["metadata_session"][
            "metadata_session_id"
        ],
        "ordinary_execution_approval": {
            "approved_checkout_sha": verified.ordinary.approved_checkout_sha,
            "filename": verified.ordinary.approval_name,
            "sha256": verified.ordinary.approval_sha256,
        },
        "paths": {
            "annotation_root_path": snapshot.annotation_path.as_posix(),
            "capture_root_path": snapshot.capture_root_path,
            "operator_session_root_path": snapshot.root_path.as_posix(),
        },
        "status": "pass",
    }
    data = _canonical(value)
    if len(data) > MAX_RESULT_BYTES:
        _fail("indeterminate")
    return data


def run_probe(
    tty_fd: int,
    verified: MetadataVerified,
    *,
    ordinary_module: Any,
) -> None:
    repository = Path(verified.repository_root)
    snapshot: MetadataSnapshot | None = None
    result: bytes | None = None
    try:
        # The authorization is procedurally consumed by this first private
        # pathname operation.  The read-only probe intentionally creates no
        # consumption marker.
        snapshot = _load_snapshot(verified, repository, ordinary_module)
        _revalidate_snapshot(snapshot)
        result = _result(verified, snapshot)
        _close_snapshot(snapshot)
        snapshot = None
        _verify_approved_tty(
            tty_fd,
            verified.approval["tty_binding"],
            private_access_started=True,
        )
        _tty_write(tty_fd, result, private_access_started=True)
        result = None
        _verify_approved_tty(
            tty_fd,
            verified.approval["tty_binding"],
            private_access_started=True,
        )
    except BaseException as exc:
        if snapshot is not None:
            try:
                _close_snapshot(snapshot)
            except BaseException:
                raise MetadataProbeError("indeterminate") from None
        if isinstance(exc, MetadataProbeError):
            raise exc
        raise MetadataProbeError("indeterminate") from exc


def execute(
    *,
    launcher: Path,
    ordinary_launcher: Path,
    ordinary_module: Any,
    tty_fd: int,
    metadata_bootstrap: PREFLIGHT.ApprovalBootstrapBinding,
    ordinary_bootstrap: PREFLIGHT.ApprovalBootstrapBinding,
) -> int:
    verified = verify_pre_private(
        launcher=launcher,
        ordinary_launcher=ordinary_launcher,
        ordinary_bootstrap=ordinary_bootstrap,
        metadata_bootstrap=metadata_bootstrap,
        ordinary_module=ordinary_module,
        tty_fd=tty_fd,
    )
    authorize_consequence(tty_fd, verified)
    _parse_expiry(verified.approval["metadata_session"]["expires_at_utc"])
    _verify_approved_tty(
        tty_fd,
        verified.approval["tty_binding"],
        private_access_started=False,
    )
    run_probe(tty_fd, verified, ordinary_module=ordinary_module)
    emit_success()
    return 0
