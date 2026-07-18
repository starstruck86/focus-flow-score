#!/usr/bin/env python3
"""Safely normalize one approved Lovable ZIP and publish one private TOC capture.

This is the reviewed high-level entrypoint for the private TOC-capture phase.
It composes the existing strict ZIP normalizer and low-level TOC capture without
adding a restore or database mode.  All child output is private and bounded;
only one fixed diagnostic is emitted.
"""

from __future__ import annotations

import ctypes
import errno
import hashlib
import importlib.util
import json
import os
import re
import selectors
import secrets
import signal
import stat
import subprocess
import sys
import time
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any


# Repository cleanliness is an execution binding, so importing a reviewed
# repository-local module must not create an untracked ``__pycache__`` before
# or between the repeated clean-worktree checks.  Keep the child ``-B`` flags
# below as defense in depth; this process-level guard also covers modules loaded
# later through ``importlib``.
sys.dont_write_bytecode = True

SCRIPT = Path(__file__).resolve(strict=True)
REPO = SCRIPT.parents[2]
LIB = SCRIPT.parent / "lib"
if str(SCRIPT.parent) not in sys.path:
    sys.path.insert(0, str(SCRIPT.parent))

from lib.lovable_toc_contract import (  # noqa: E402
    CAPTURE_FILES,
    MAX_LEDGER_BYTES,
    MAX_RAW_TOC_BYTES,
    SAFE_NAME_RE as PACKAGE_NAME_RE,
    VERSION_RE,
    ContractError,
    _mark_indeterminate,
    _open_private_directory_at,
    _unlink_tree_at,
    canonical_json_bytes,
    parse_raw_toc,
    sha256_bytes,
    stable_private_file_at,
    stable_regular_digest,
    strict_json_loads,
    validate_capture_schema,
    validate_git_sha,
    validate_private_root,
    validate_sha,
)


DRIVER_STAGE = "capture_driver"
MAX_OUTER_BYTES = 5_000_000_000
MAX_INNER_BYTES = 5_000_000_000
MAX_TOOL_BYTES = 100 * 1024 * 1024
MAX_CHILD_DIAGNOSTIC_BYTES = 64 * 1024
MIN_CAPTURE_OUTPUT_HEADROOM_BYTES = (
    MAX_RAW_TOC_BYTES + (2 * MAX_LEDGER_BYTES) + (256 * 1024 * 1024)
)
NORMALIZER_TIMEOUT_SECONDS = 900
CAPTURE_TIMEOUT_SECONDS = 420
SAFE_NAME_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,254}\Z", re.ASCII)
SAFE_RUN_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,100}\Z", re.ASCII)
POSITIVE_INTEGER_RE = re.compile(r"[1-9][0-9]*\Z", re.ASCII)
ROOT_LOCK_NAME = ".toc-capture-driver.lock"
INNER_NAME = "verified-inner.pgdmp"
NORMALIZATION_NAME = "normalization.json"

REQUIRED_ENVIRONMENT = frozenset(
    {
        "TOC_REVIEW_CANONICAL_OUTER",
        "TOC_REVIEW_APPROVED_EVIDENCE_RUN_DIRECTORY",
        "TOC_REVIEW_PRIVATE_STAGING_ROOT",
        "TOC_REVIEW_OUTPUT_ROOT",
        "TOC_REVIEW_EVIDENCE_RUN_ID",
        "TOC_REVIEW_EXPECTED_ORIGINAL_FILENAME",
        "TOC_REVIEW_UI_EXPORT_OBJECT_NAME",
        "TOC_REVIEW_EXPECTED_OUTER_SIZE_BYTES",
        "TOC_REVIEW_OUTER_SHA256",
        "TOC_REVIEW_INNER_SHA256",
        "TOC_REVIEW_EVIDENCE_MANIFEST_SHA256",
        "TOC_REVIEW_INSPECTION_CHECKOUT_SHA",
        "TOC_REVIEW_INSPECTION_PROCEDURE_SHA256",
        "TOC_REVIEW_APPROVED_EXECUTION_CHECKOUT_SHA",
        "TOC_REVIEW_PG_RESTORE_BIN",
        "TOC_REVIEW_APPROVED_PG_RESTORE_SHA256",
        "TOC_REVIEW_APPROVED_PG_RESTORE_VERSION",
        "TOC_REVIEW_EXPECTED_ENTRY_COUNT",
        "TOC_REVIEW_EXPECTED_DATA_REFERENCE_COUNT",
    }
)

FAILURE_REASONS = frozenset(
    {
        "input_invalid",
        "binding_mismatch",
        "evidence_invalid",
        "normalization_failed",
        "normalization_timeout",
        "normalization_output_invalid",
        "inner_identity_mismatch",
        "capture_failed",
        "capture_timeout",
        "capture_output_invalid",
        "canonical_mutated",
        "publication_exists",
        "publication_failed",
        "cleanup_indeterminate",
        "internal_failure",
    }
)


class DriverError(RuntimeError):
    """One allowlisted, nonleaking failure reason."""

    def __init__(self, reason: str):
        self.reason = reason if reason in FAILURE_REASONS else "internal_failure"
        super().__init__(self.reason)


class RenamedPublicationError(DriverError):
    """Publication failed after the final name became visible."""


class ChildOutputLimit(RuntimeError):
    """A child exceeded the private reviewed diagnostic boundary."""


@dataclass(frozen=True)
class Inputs:
    canonical_outer: Path
    evidence_run_directory: Path
    staging_root: Path
    output_root: Path
    run_id: str
    expected_filename: str
    ui_member_name: str
    expected_outer_size: int
    outer_sha256: str
    inner_sha256: str
    evidence_manifest_sha256: str
    inspection_checkout_sha: str
    inspection_procedure_sha256: str
    approved_checkout_sha: str
    pg_restore: Path
    approved_pg_restore_sha256: str
    approved_pg_restore_version: str
    expected_entry_count: int
    expected_data_reference_count: int


@dataclass(frozen=True)
class ChildResult:
    returncode: int
    stdout: bytes
    stderr: bytes


@dataclass(frozen=True)
class BoundFile:
    sha256: str
    size: int
    device: int
    inode: int
    owner_uid: int
    owner_gid: int
    mode: int


def _diagnostic(
    *,
    status: str,
    reason: str,
    counts: Mapping[str, int] | None = None,
    hashes: Mapping[str, str] | None = None,
) -> bytes:
    if status == "failed":
        safe_reason = reason if reason in FAILURE_REASONS else "internal_failure"
        return canonical_json_bytes(
            {
                "diagnostic_version": 1,
                "reason": safe_reason,
                "stage": DRIVER_STAGE,
                "status": "failed",
            }
        )
    if status != "review_required" or reason != "blocked":
        return _diagnostic(status="failed", reason="internal_failure")
    safe_counts = dict(counts or {})
    safe_hashes = dict(hashes or {})
    if (
        set(safe_counts) != {"data_reference_count", "entry_count"}
        or set(safe_hashes) != {"capture_manifest_sha256", "raw_toc_sha256"}
        or any(type(value) is not int or value < 0 for value in safe_counts.values())
        or any(
            type(value) is not str or re.fullmatch(r"[0-9a-f]{64}", value) is None
            for value in safe_hashes.values()
        )
    ):
        return _diagnostic(status="failed", reason="internal_failure")
    return canonical_json_bytes(
        {
            "annotation_gate": "ANNOTATION_REQUIRED",
            "counts": {key: safe_counts[key] for key in sorted(safe_counts)},
            "diagnostic_version": 1,
            "hashes": {key: safe_hashes[key] for key in sorted(safe_hashes)},
            "reason": "blocked",
            "review_gate": "REVIEW_REQUIRED",
            "restore_command_gate": "BLOCKED",
            "restore_planning_gate": "BLOCKED",
            "stage": DRIVER_STAGE,
            "status": "review_required",
        }
    )


def _required(environment: Mapping[str, str], name: str) -> str:
    value = environment.get(name)
    if (
        type(value) is not str
        or not value
        or value != value.strip()
        or "\x00" in value
        or any(ord(character) < 0x20 or ord(character) == 0x7F for character in value)
    ):
        raise DriverError("input_invalid")
    return value


def _positive_integer(value: str, *, maximum: int) -> int:
    if POSITIVE_INTEGER_RE.fullmatch(value) is None:
        raise DriverError("input_invalid")
    result = int(value)
    if result > maximum:
        raise DriverError("input_invalid")
    return result


def _safe_name(value: str) -> str:
    if (
        SAFE_NAME_RE.fullmatch(value) is None
        or value.endswith(".")
        or ".." in value
    ):
        raise DriverError("input_invalid")
    return value


def _parse_inputs(environment: Mapping[str, str]) -> Inputs:
    if any(not environment.get(name) for name in REQUIRED_ENVIRONMENT):
        raise DriverError("input_invalid")
    run_id = _required(environment, "TOC_REVIEW_EVIDENCE_RUN_ID")
    prospective_final_name = f"toc-capture-{run_id.lower()}-{'0' * 12}"
    if (
        SAFE_RUN_RE.fullmatch(run_id) is None
        or ".." in run_id
        or PACKAGE_NAME_RE.fullmatch(prospective_final_name) is None
    ):
        raise DriverError("input_invalid")
    entry_count = _positive_integer(
        _required(environment, "TOC_REVIEW_EXPECTED_ENTRY_COUNT"), maximum=1_000_000
    )
    data_count = _positive_integer(
        _required(environment, "TOC_REVIEW_EXPECTED_DATA_REFERENCE_COUNT"),
        maximum=1_000_000,
    )
    if data_count > entry_count:
        raise DriverError("input_invalid")
    approved_pg_restore_version = _required(
        environment, "TOC_REVIEW_APPROVED_PG_RESTORE_VERSION"
    )
    if VERSION_RE.fullmatch(approved_pg_restore_version) is None:
        raise DriverError("input_invalid")
    return Inputs(
        canonical_outer=Path(_required(environment, "TOC_REVIEW_CANONICAL_OUTER")),
        evidence_run_directory=Path(
            _required(environment, "TOC_REVIEW_APPROVED_EVIDENCE_RUN_DIRECTORY")
        ),
        staging_root=Path(_required(environment, "TOC_REVIEW_PRIVATE_STAGING_ROOT")),
        output_root=Path(_required(environment, "TOC_REVIEW_OUTPUT_ROOT")),
        run_id=run_id,
        expected_filename=_safe_name(
            _required(environment, "TOC_REVIEW_EXPECTED_ORIGINAL_FILENAME")
        ),
        ui_member_name=_safe_name(
            _required(environment, "TOC_REVIEW_UI_EXPORT_OBJECT_NAME")
        ),
        expected_outer_size=_positive_integer(
            _required(environment, "TOC_REVIEW_EXPECTED_OUTER_SIZE_BYTES"),
            maximum=MAX_OUTER_BYTES,
        ),
        outer_sha256=validate_sha(_required(environment, "TOC_REVIEW_OUTER_SHA256")),
        inner_sha256=validate_sha(_required(environment, "TOC_REVIEW_INNER_SHA256")),
        evidence_manifest_sha256=validate_sha(
            _required(environment, "TOC_REVIEW_EVIDENCE_MANIFEST_SHA256")
        ),
        inspection_checkout_sha=validate_git_sha(
            _required(environment, "TOC_REVIEW_INSPECTION_CHECKOUT_SHA")
        ),
        inspection_procedure_sha256=validate_sha(
            _required(environment, "TOC_REVIEW_INSPECTION_PROCEDURE_SHA256")
        ),
        approved_checkout_sha=validate_git_sha(
            _required(environment, "TOC_REVIEW_APPROVED_EXECUTION_CHECKOUT_SHA")
        ),
        pg_restore=Path(_required(environment, "TOC_REVIEW_PG_RESTORE_BIN")),
        approved_pg_restore_sha256=validate_sha(
            _required(environment, "TOC_REVIEW_APPROVED_PG_RESTORE_SHA256")
        ),
        approved_pg_restore_version=approved_pg_restore_version,
        expected_entry_count=entry_count,
        expected_data_reference_count=data_count,
    )


def _git(arguments: list[str]) -> str:
    result = subprocess.run(
        ["git", *arguments],
        cwd=REPO,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        timeout=20,
    )
    if result.returncode != 0:
        raise DriverError("binding_mismatch")
    return result.stdout.strip()


def _repository_binding(approved_checkout: str) -> dict[str, str]:
    if _git(["rev-parse", "HEAD"]) != approved_checkout:
        raise DriverError("binding_mismatch")
    if _git(["status", "--porcelain=v1"]) != "":
        raise DriverError("binding_mismatch")
    paths = (
        "scripts/migration/README.md",
        "scripts/migration/capture-lovable-toc-envelope.py",
        "scripts/migration/capture-lovable-toc.py",
        "scripts/migration/normalize-lovable-export.py",
        "scripts/migration/bounded-pg-restore.py",
        "scripts/migration/inspect-lovable-export.py",
        "scripts/migration/lib/lovable_toc_contract.py",
        "scripts/migration/lib/lovable_dump_report.py",
    )
    result = {"execution_checkout_sha": approved_checkout}
    for relative in paths:
        path = REPO / relative
        if not path.is_file() or path.is_symlink():
            raise DriverError("binding_mismatch")
        blob = _git(["rev-parse", f"HEAD:{relative}"])
        if re.fullmatch(r"[0-9a-f]{40}", blob) is None:
            raise DriverError("binding_mismatch")
        if _git(["hash-object", "--", relative]) != blob:
            raise DriverError("binding_mismatch")
        key = path.name.replace("-", "_").replace(".", "_")
        result[f"{key}_blob_sha"] = blob
        result[f"{key}_sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


def _resolved_private_root(path: Path) -> tuple[Path, int, os.stat_result]:
    raw_path = os.fspath(path)
    if not path.is_absolute() or raw_path != os.path.abspath(raw_path):
        raise DriverError("input_invalid")
    try:
        descriptor = validate_private_root(path)
        resolved = path.resolve(strict=True)
        metadata = os.fstat(descriptor)
    except (OSError, ContractError) as exc:
        raise DriverError("input_invalid") from exc
    if resolved == REPO or REPO in resolved.parents:
        os.close(descriptor)
        raise DriverError("input_invalid")
    return resolved, descriptor, metadata


def _paths_overlap(left: Path, right: Path) -> bool:
    return left == right or left in right.parents or right in left.parents


def _directory_identity(value: os.stat_result) -> tuple[int, int, int, int, int]:
    return (
        value.st_dev,
        value.st_ino,
        value.st_uid,
        value.st_gid,
        stat.S_IMODE(value.st_mode),
    )


def _validate_paths(inputs: Inputs) -> tuple[dict[str, Path], dict[str, os.stat_result]]:
    resolved: dict[str, Path] = {}
    metadata: dict[str, os.stat_result] = {}
    descriptors: list[int] = []
    try:
        for label, path in (
            ("evidence", inputs.evidence_run_directory),
            ("staging", inputs.staging_root),
            ("output", inputs.output_root),
        ):
            _parent, parent_descriptor, parent_info = _resolved_private_root(path.parent)
            metadata[f"{label}_parent"] = parent_info
            descriptors.append(parent_descriptor)
            value, descriptor, info = _resolved_private_root(path)
            resolved[label] = value
            metadata[label] = info
            descriptors.append(descriptor)
            if label in {"staging", "output"} and os.listdir(descriptor):
                raise DriverError("publication_exists")
        if inputs.evidence_run_directory.name != inputs.run_id:
            raise DriverError("input_invalid")
        for left, right in (("evidence", "staging"), ("evidence", "output"), ("staging", "output")):
            if _paths_overlap(resolved[left], resolved[right]):
                raise DriverError("input_invalid")
        if metadata["output"].st_dev != metadata["staging"].st_dev:
            # Cleanup and final publication are separately fsynced, but a
            # single-filesystem evidence boundary avoids cross-device ambiguity.
            raise DriverError("input_invalid")
    finally:
        for descriptor in descriptors:
            os.close(descriptor)

    canonical_raw = os.fspath(inputs.canonical_outer)
    if (
        not inputs.canonical_outer.is_absolute()
        or canonical_raw != os.path.abspath(canonical_raw)
    ):
        raise DriverError("input_invalid")
    lexical = Path(os.path.abspath(os.fspath(inputs.canonical_outer)))
    try:
        canonical = inputs.canonical_outer.resolve(strict=True)
    except OSError as exc:
        raise DriverError("input_invalid") from exc
    if lexical != canonical or canonical.name != inputs.expected_filename:
        raise DriverError("input_invalid")
    if canonical == REPO or REPO in canonical.parents:
        raise DriverError("input_invalid")
    try:
        canonical_parent_fd = validate_private_root(canonical.parent)
    except ContractError as exc:
        raise DriverError("input_invalid") from exc
    try:
        metadata["canonical_parent"] = os.fstat(canonical_parent_fd)
    finally:
        os.close(canonical_parent_fd)
    for root in resolved.values():
        if _paths_overlap(canonical, root):
            raise DriverError("input_invalid")
    resolved["canonical"] = canonical
    return resolved, metadata


def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise DriverError("binding_mismatch")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    try:
        spec.loader.exec_module(module)
    except BaseException as exc:
        raise DriverError("binding_mismatch") from exc
    return module


def _validate_evidence_run(inputs: Inputs) -> None:
    validator = _load_module(
        "toc_envelope_aggregate_validator",
        REPO / "scripts/migration/inspect-lovable-export.py",
    )
    try:
        run_fd = validate_private_root(inputs.evidence_run_directory)
        try:
            identities = validator.validate_evidence_tree_at(
                run_fd,
                inputs.run_id,
                require_completion_marker=True,
            )
            provenance_bytes = validator.read_private_file_at(run_fd, "provenance.json")
        finally:
            os.close(run_fd)
        provenance = validator.validate_provenance_schema(
            validator.load_evidence_contract_json(
                provenance_bytes, label="approved evidence provenance"
            )
        )
    except BaseException as exc:
        raise DriverError("evidence_invalid") from exc
    if identities["evidence-files.json"]["sha256"] != inputs.evidence_manifest_sha256:
        raise DriverError("binding_mismatch")
    try:
        outer = provenance["outer_artifact"]
        expected = outer["expected_identity"]
        observed = outer["workflow_observed_identity"]
        inner = provenance["inner_pgdmp"]
        ui = provenance["ui_member_binding"]
        matches = (
            provenance["run_id"] == inputs.run_id
            and provenance["inspection_status"] == "REVIEW_REQUIRED"
            and provenance["restore_planning_gate"] == "BLOCKED"
            and provenance["execution_checkout_sha"] == inputs.inspection_checkout_sha
            and provenance["inspection_tool_git_sha"] == inputs.inspection_checkout_sha
            and provenance["procedure_workflow_sha256"]
            == inputs.inspection_procedure_sha256
            and expected["original_filename"] == inputs.expected_filename
            and expected["size_bytes"] == inputs.expected_outer_size
            and expected["sha256"] == inputs.outer_sha256
            and observed["size_bytes_before"] == inputs.expected_outer_size
            and observed["size_bytes_after"] == inputs.expected_outer_size
            and observed["sha256_before"] == inputs.outer_sha256
            and observed["sha256_after"] == inputs.outer_sha256
            and outer["ui_observed_export_object_name"] == inputs.ui_member_name
            and ui["ui_observed_name"] == inputs.ui_member_name
            and inner["sha256"] == inputs.inner_sha256
            and inner["inspector_reported_sha256"] == inputs.inner_sha256
            and inner["retained_in_evidence"] is False
        )
    except (KeyError, TypeError):
        matches = False
    if not matches:
        raise DriverError("binding_mismatch")


def _canonical_identity(inputs: Inputs):
    try:
        identity = stable_regular_digest(
            inputs.canonical_outer,
            max_bytes=MAX_OUTER_BYTES,
            exact_mode=0o400,
        )
    except ContractError as exc:
        if exc.code == "input_mutated":
            raise DriverError("canonical_mutated") from exc
        raise DriverError("input_invalid") from exc
    if (
        identity.size != inputs.expected_outer_size
        or identity.sha256 != inputs.outer_sha256
    ):
        raise DriverError("binding_mismatch")
    return identity


def _tool_identity(inputs: Inputs):
    raw_path = os.fspath(inputs.pg_restore)
    if not inputs.pg_restore.is_absolute() or raw_path != os.path.abspath(raw_path):
        raise DriverError("input_invalid")
    try:
        resolved = inputs.pg_restore.resolve(strict=True)
    except OSError as exc:
        raise DriverError("input_invalid") from exc
    if inputs.pg_restore.is_symlink():
        raise DriverError("input_invalid")
    if resolved == REPO or REPO in resolved.parents:
        raise DriverError("input_invalid")
    try:
        identity = stable_regular_digest(
            inputs.pg_restore,
            max_bytes=MAX_TOOL_BYTES,
            require_executable=True,
        )
    except ContractError as exc:
        raise DriverError("input_invalid") from exc
    if identity.sha256 != inputs.approved_pg_restore_sha256:
        raise DriverError("binding_mismatch")
    return identity


def _mkdir_private_at(parent_fd: int, name: str) -> None:
    try:
        os.mkdir(name, 0o700, dir_fd=parent_fd)
    except FileExistsError as exc:
        raise DriverError("publication_exists") from exc
    except OSError as exc:
        raise DriverError("publication_failed") from exc


def _require_capture_output_headroom(output_fd: int) -> None:
    try:
        filesystem = os.fstatvfs(output_fd)
        available = filesystem.f_bavail * filesystem.f_frsize
    except OSError as exc:
        raise DriverError("input_invalid") from exc
    if available < MIN_CAPTURE_OUTPUT_HEADROOM_BYTES:
        raise DriverError("input_invalid")


def _open_private_child(parent_fd: int, name: str) -> int:
    try:
        descriptor = _open_private_directory_at(parent_fd, name)
    except ContractError as exc:
        raise DriverError("publication_failed") from exc
    return descriptor


def _kill_process_group(process: subprocess.Popen[bytes]) -> None:
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    except OSError:
        try:
            process.kill()
        except OSError:
            pass


def _run_child(
    arguments: list[str],
    *,
    environment: Mapping[str, str],
    directory_fd: int,
    prefix: str,
    timeout_seconds: int,
) -> ChildResult:
    del prefix  # The fixed caller maps the result to an allowlisted stage.
    process: subprocess.Popen[bytes] | None = None
    selector = selectors.DefaultSelector()
    channels: dict[int, bytearray] = {}

    def enter_bound_directory() -> None:
        os.fchdir(directory_fd)

    try:
        child_environment = {key: value for key, value in environment.items()}
        child_environment.update({"LANG": "C", "LC_ALL": "C"})
        process = subprocess.Popen(
            arguments,
            env=child_environment,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=True,
            close_fds=True,
            pass_fds=(directory_fd,),
            preexec_fn=enter_bound_directory,
        )
        if process.stdout is None or process.stderr is None:
            raise DriverError("internal_failure")
        for stream in (process.stdout, process.stderr):
            descriptor = stream.fileno()
            os.set_blocking(descriptor, False)
            channels[descriptor] = bytearray()
            selector.register(descriptor, selectors.EVENT_READ)
        deadline = time.monotonic() + timeout_seconds
        while selector.get_map():
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError
            events = selector.select(min(remaining, 1.0))
            if not events:
                continue
            for key, _mask in events:
                descriptor = int(key.fd)
                try:
                    chunk = os.read(descriptor, 8192)
                except BlockingIOError:
                    continue
                if not chunk:
                    selector.unregister(descriptor)
                    continue
                channel = channels[descriptor]
                channel.extend(chunk)
                if len(channel) > MAX_CHILD_DIAGNOSTIC_BYTES:
                    raise ChildOutputLimit
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError
        returncode = process.wait(timeout=remaining)
        return ChildResult(
            returncode=returncode,
            stdout=bytes(channels[process.stdout.fileno()]),
            stderr=bytes(channels[process.stderr.fileno()]),
        )
    except subprocess.TimeoutExpired as exc:
        raise TimeoutError from exc
    finally:
        selector.close()
        if process is not None:
            if process.poll() is None:
                _kill_process_group(process)
            try:
                process.wait(timeout=5)
            except BaseException:
                _kill_process_group(process)
                try:
                    process.wait(timeout=5)
                except BaseException:
                    pass
            if process.stdout is not None:
                process.stdout.close()
            if process.stderr is not None:
                process.stderr.close()


def _unlink_file_at(directory_fd: int, name: str) -> None:
    try:
        os.unlink(name, dir_fd=directory_fd)
    except FileNotFoundError:
        return
    except OSError as exc:
        raise DriverError("cleanup_indeterminate") from exc


def _strict_object(value: Any, keys: set[str]) -> dict[str, Any]:
    if type(value) is not dict or set(value) != keys:
        raise DriverError("normalization_output_invalid")
    return value


def _read_normalization_metadata(stage_fd: int) -> dict[str, Any]:
    try:
        observed = stable_private_file_at(
            stage_fd,
            "normalization.json",
            max_bytes=64 * 1024,
            exact_mode=0o400,
        )
        value = strict_json_loads(observed.data, max_bytes=64 * 1024)
    except ContractError as exc:
        raise DriverError("normalization_output_invalid") from exc
    return _strict_object(
        value, {"envelope_kind", "format_version", "inner", "member", "outer"}
    )


def _validate_normalization(
    metadata: dict[str, Any],
    inputs: Inputs,
    inner_identity: Any,
) -> None:
    inner = _strict_object(metadata["inner"], {"sha256", "size_bytes"})
    member = _strict_object(
        metadata["member"],
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
    )
    outer = _strict_object(
        metadata["outer"], {"format", "sha256_after", "sha256_before", "size_bytes", "zip"}
    )
    zip_info = _strict_object(
        outer["zip"],
        {
            "archive_comment_length",
            "central_directory_offset",
            "central_directory_size",
            "entry_count",
            "zip64",
        },
    )
    integers = (
        outer["size_bytes"],
        zip_info["entry_count"],
        zip_info["archive_comment_length"],
        zip_info["central_directory_offset"],
        zip_info["central_directory_size"],
        member["compressed_size"],
        member["external_attributes"],
        member["flags"],
        member["method"],
        member["streamed_size"],
        member["uncompressed_size"],
        member["version_made_by"],
        member["version_needed"],
        inner["size_bytes"],
    )
    method_contract = {
        0: ("stored", 10),
        8: ("deflate", 20),
    }
    if (
        type(metadata["format_version"]) is not int
        or any(type(value) is not int or value < 0 for value in integers)
        or type(zip_info["zip64"]) is not bool
        or type(inner["sha256"]) is not str
        or type(member["name"]) is not str
        or type(member["compression"]) is not str
        or type(member["crc32"]) is not str
        or re.fullmatch(r"[0-9a-f]{8}", member["crc32"]) is None
        or member["method"] not in method_contract
        or (member["compression"], member["version_needed"])
        != method_contract.get(member["method"])
        or metadata["format_version"] != 1
        or metadata["envelope_kind"] != "zip"
        or outer["format"] != "zip"
        or outer["size_bytes"] != inputs.expected_outer_size
        or outer["sha256_before"] != inputs.outer_sha256
        or outer["sha256_after"] != inputs.outer_sha256
        or zip_info["entry_count"] != 1
        or zip_info["zip64"] is not False
        or zip_info["archive_comment_length"] != 0
        or zip_info["central_directory_offset"] + zip_info["central_directory_size"] + 22
        != inputs.expected_outer_size
        or member["name"] != inputs.ui_member_name
        or member["flags"] != 0
        or member["compressed_size"] > inputs.expected_outer_size
        or member["streamed_size"] != inner_identity.size
        or member["uncompressed_size"] != inner_identity.size
        or inner["size_bytes"] != inner_identity.size
        or inner["sha256"] != inputs.inner_sha256
        or inner_identity.sha256 != inputs.inner_sha256
    ):
        raise DriverError("inner_identity_mismatch")


def _stable_digest_at(
    directory_fd: int,
    name: str,
    *,
    max_bytes: int,
    exact_mode: int,
) -> BoundFile:
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(name, flags, dir_fd=directory_fd)
        try:
            before = os.fstat(descriptor)
            if (
                not stat.S_ISREG(before.st_mode)
                or before.st_nlink != 1
                or before.st_uid != os.geteuid()
                or stat.S_IMODE(before.st_mode) != exact_mode
                or before.st_size <= 0
                or before.st_size > max_bytes
            ):
                raise DriverError("inner_identity_mismatch")
            digest = hashlib.sha256()
            size = 0
            while True:
                chunk = os.read(descriptor, min(1024 * 1024, max_bytes + 1))
                if not chunk:
                    break
                size += len(chunk)
                if size > max_bytes or size > before.st_size:
                    raise DriverError("inner_identity_mismatch")
                digest.update(chunk)
            after = os.fstat(descriptor)
            if (
                (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
                != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
                or size != after.st_size
            ):
                raise DriverError("inner_identity_mismatch")
            return BoundFile(
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
    except OSError as exc:
        raise DriverError("inner_identity_mismatch") from exc


def _verify_inner_magic_at(directory_fd: int, name: str) -> None:
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(name, flags, dir_fd=directory_fd)
        try:
            if os.read(descriptor, 5) != b"PGDMP":
                raise DriverError("inner_identity_mismatch")
        finally:
            os.close(descriptor)
    except OSError as exc:
        raise DriverError("inner_identity_mismatch") from exc


def _parse_capture_diagnostic(result: ChildResult) -> tuple[dict[str, int], dict[str, str]]:
    if result.returncode != 0 or result.stderr or not result.stdout:
        raise DriverError("capture_failed")
    if len(result.stdout) > MAX_CHILD_DIAGNOSTIC_BYTES or not result.stdout.endswith(b"\n"):
        raise DriverError("capture_output_invalid")
    try:
        value = strict_json_loads(result.stdout, max_bytes=MAX_CHILD_DIAGNOSTIC_BYTES)
    except ContractError as exc:
        raise DriverError("capture_output_invalid") from exc
    value = _strict_capture_diagnostic(value)
    return value["counts"], value["hashes"]


def _strict_capture_diagnostic(value: Any) -> dict[str, Any]:
    if type(value) is not dict or set(value) != {
        "counts",
        "diagnostic_version",
        "hashes",
        "reason",
        "stage",
        "status",
    }:
        raise DriverError("capture_output_invalid")
    counts = value.get("counts")
    hashes = value.get("hashes")
    if (
        value.get("diagnostic_version") != 1
        or value.get("stage") != "capture"
        or value.get("status") != "complete"
        or value.get("reason") != "ok"
        or type(counts) is not dict
        or set(counts) != {"data_reference_count", "entry_count"}
        or type(hashes) is not dict
        or set(hashes) != {"capture_manifest_sha256", "raw_toc_sha256"}
        or any(type(item) is not int or item < 0 for item in counts.values())
        or any(
            type(item) is not str or re.fullmatch(r"[0-9a-f]{64}", item) is None
            for item in hashes.values()
        )
    ):
        raise DriverError("capture_output_invalid")
    return value


def _capture_environment(inputs: Inputs, workdir_fd: int) -> dict[str, str]:
    return {
        "TOC_REVIEW_INNER_ARCHIVE": INNER_NAME,
        "TOC_REVIEW_OUTPUT_ROOT": ".",
        "TOC_REVIEW_DESCRIPTOR_BOUND_WORKDIR_FD": str(workdir_fd),
        "TOC_REVIEW_EVIDENCE_RUN_ID": inputs.run_id,
        "TOC_REVIEW_OUTER_SHA256": inputs.outer_sha256,
        "TOC_REVIEW_INNER_SHA256": inputs.inner_sha256,
        "TOC_REVIEW_EVIDENCE_MANIFEST_SHA256": inputs.evidence_manifest_sha256,
        "TOC_REVIEW_INSPECTION_CHECKOUT_SHA": inputs.inspection_checkout_sha,
        "TOC_REVIEW_INSPECTION_PROCEDURE_SHA256": inputs.inspection_procedure_sha256,
        "TOC_REVIEW_APPROVED_EXECUTION_CHECKOUT_SHA": inputs.approved_checkout_sha,
        "TOC_REVIEW_PG_RESTORE_BIN": str(inputs.pg_restore),
        "TOC_REVIEW_APPROVED_PG_RESTORE_SHA256": inputs.approved_pg_restore_sha256,
        "TOC_REVIEW_EXPECTED_ENTRY_COUNT": str(inputs.expected_entry_count),
        "TOC_REVIEW_EXPECTED_DATA_REFERENCE_COUNT": str(
            inputs.expected_data_reference_count
        ),
    }


def _package_names(directory_fd: int) -> set[str]:
    try:
        names = set(os.listdir(directory_fd))
    except (OSError, TypeError) as exc:
        raise DriverError("publication_failed") from exc
    if any(
        not name
        or name in {".", ".."}
        or "/" in name
        or "\\" in name
        or any(ord(character) < 0x20 or ord(character) == 0x7F for character in name)
        for name in names
    ):
        raise DriverError("publication_failed")
    return names


def _read_capture_package(
    parent_fd: int,
    final_name: str,
    inputs: Inputs,
    counts: Mapping[str, int],
    hashes: Mapping[str, str],
    *,
    tool_identity: Any,
    repository_identity: Mapping[str, str],
    require_marker: bool,
) -> None:
    """Cross-bind every persisted byte to the frozen runtime expectations."""

    package_fd = _open_private_child(parent_fd, final_name)
    try:
        expected_names = set(CAPTURE_FILES)
        if require_marker:
            expected_names.add("EVIDENCE_COMPLETE")
        if _package_names(package_fd) != expected_names:
            raise DriverError("publication_failed")
        try:
            payloads = {
                "raw-pg-restore-list.toc": stable_private_file_at(
                    package_fd,
                    "raw-pg-restore-list.toc",
                    max_bytes=MAX_RAW_TOC_BYTES,
                    exact_mode=0o400,
                ),
                "opaque-id.key": stable_private_file_at(
                    package_fd, "opaque-id.key", max_bytes=32, exact_mode=0o400
                ),
                "opaque-index.json": stable_private_file_at(
                    package_fd,
                    "opaque-index.json",
                    max_bytes=MAX_LEDGER_BYTES,
                    exact_mode=0o400,
                ),
                "capture.json": stable_private_file_at(
                    package_fd,
                    "capture.json",
                    max_bytes=MAX_LEDGER_BYTES,
                    exact_mode=0o400,
                ),
            }
            manifest_file = stable_private_file_at(
                package_fd,
                "evidence-files.json",
                max_bytes=64 * 1024 * 1024,
                exact_mode=0o400,
            )
            marker_file = (
                stable_private_file_at(
                    package_fd,
                    "EVIDENCE_COMPLETE",
                    max_bytes=64 * 1024,
                    exact_mode=0o400,
                )
                if require_marker
                else None
            )
            capture = validate_capture_schema(
                strict_json_loads(payloads["capture.json"].data)
            )
            manifest = strict_json_loads(manifest_file.data)
            marker = (
                strict_json_loads(marker_file.data)
                if marker_file is not None
                else None
            )
        except ContractError as exc:
            raise DriverError("publication_failed") from exc
        if payloads["capture.json"].data != canonical_json_bytes(capture):
            raise DriverError("publication_failed")

        binding = capture["binding"]
        pg_identity = capture["pg_restore_identity"]
        expected_procedure = {
            **repository_identity,
            "evidence_manifest_sha256": inputs.evidence_manifest_sha256,
            "inspection_checkout_sha": inputs.inspection_checkout_sha,
            "inspection_procedure_sha256": inputs.inspection_procedure_sha256,
        }
        expected_pg_identity = {
            "approved_identity": f"sha256:{inputs.approved_pg_restore_sha256}",
            "device": tool_identity.device,
            "executable_path": str(inputs.pg_restore),
            "gid": tool_identity.owner_gid,
            "inode": tool_identity.inode,
            "mode": format(tool_identity.mode, "04o"),
            "reported_version": inputs.approved_pg_restore_version,
            "sha256": tool_identity.sha256,
            "size_bytes": tool_identity.size,
            "uid": tool_identity.owner_uid,
        }
        if (
            capture["entry_count"] != counts["entry_count"]
            or capture["data_reference_count"] != counts["data_reference_count"]
            or capture["raw_toc_sha256"] != hashes["raw_toc_sha256"]
            or capture["raw_toc_size_bytes"]
            != payloads["raw-pg-restore-list.toc"].size
            or capture["opaque_key_sha256"] != payloads["opaque-id.key"].sha256
            or capture["opaque_index_sha256"]
            != payloads["opaque-index.json"].sha256
            or capture.get("capture_status") != "CAPTURE_COMPLETE"
            or capture.get("overall_status") != "REVIEW_REQUIRED"
            or capture.get("review_gate") != "ANNOTATION_REQUIRED"
            or capture.get("restore_planning_gate") != "BLOCKED"
            or capture.get("restore_command_gate") != "BLOCKED"
            or binding["evidence_run_id"] != inputs.run_id
            or binding["outer_archive_sha256"] != inputs.outer_sha256
            or binding["inner_archive_sha256"] != inputs.inner_sha256
            or binding["evidence_manifest_sha256"] != inputs.evidence_manifest_sha256
            or binding["inspection_checkout_sha"] != inputs.inspection_checkout_sha
            or binding["inspection_procedure_sha256"]
            != inputs.inspection_procedure_sha256
            or binding["execution_checkout_sha"] != inputs.approved_checkout_sha
            or binding["procedure_identity_sha256"]
            != sha256_bytes(canonical_json_bytes(expected_procedure))
            or capture["procedure_identity"] != expected_procedure
            or pg_identity != expected_pg_identity
        ):
            raise DriverError("binding_mismatch")

        try:
            entries = parse_raw_toc(
                payloads["raw-pg-restore-list.toc"].data,
                payloads["opaque-id.key"].data,
            )
        except ContractError as exc:
            raise DriverError("publication_failed") from exc
        expected_index = {
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
        if (
            payloads["opaque-id.key"].size != 32
            or len(entries) != counts["entry_count"]
            or sum(entry.is_data_reference for entry in entries)
            != counts["data_reference_count"]
            or payloads["opaque-index.json"].data
            != canonical_json_bytes(expected_index)
        ):
            raise DriverError("publication_failed")

        expected_manifest_files = [
            {
                "name": name,
                "sha256": payloads[name].sha256,
                "size_bytes": payloads[name].size,
            }
            for name in sorted(payloads)
        ]
        if (
            type(manifest) is not dict
            or set(manifest) != {"artifact_kind", "files", "format_version"}
            or manifest.get("artifact_kind") != "lovable_toc_capture_evidence"
            or manifest.get("format_version") != 1
            or manifest.get("files") != expected_manifest_files
            or manifest_file.data != canonical_json_bytes(manifest)
            or sha256_bytes(manifest_file.data) != hashes["capture_manifest_sha256"]
        ):
            raise DriverError("publication_failed")
        expected_marker = {
            "artifact_kind": "lovable_toc_capture_complete",
            "evidence_files_sha256": hashes["capture_manifest_sha256"],
            "format_version": 1,
        }
        if require_marker and (
            type(marker) is not dict
            or marker != expected_marker
            or marker_file is None
            or marker_file.data != canonical_json_bytes(expected_marker)
        ):
            raise DriverError("publication_failed")
        if payloads["raw-pg-restore-list.toc"].sha256 != hashes["raw_toc_sha256"]:
            raise DriverError("publication_failed")
        if _package_names(package_fd) != expected_names:
            raise DriverError("publication_failed")
    finally:
        os.close(package_fd)


def _rename_no_replace_between(
    source_fd: int, source_name: str, destination_fd: int, destination_name: str
) -> None:
    if sys.platform == "darwin":
        libc = ctypes.CDLL(None, use_errno=True)
        function = libc.renameatx_np
        function.argtypes = [
            ctypes.c_int,
            ctypes.c_char_p,
            ctypes.c_int,
            ctypes.c_char_p,
            ctypes.c_uint,
        ]
        function.restype = ctypes.c_int
        result = function(
            source_fd,
            os.fsencode(source_name),
            destination_fd,
            os.fsencode(destination_name),
            0x00000004,
        )
    elif sys.platform.startswith("linux"):
        libc = ctypes.CDLL(None, use_errno=True)
        function = libc.renameat2
        function.argtypes = [
            ctypes.c_int,
            ctypes.c_char_p,
            ctypes.c_int,
            ctypes.c_char_p,
            ctypes.c_uint,
        ]
        function.restype = ctypes.c_int
        result = function(
            source_fd,
            os.fsencode(source_name),
            destination_fd,
            os.fsencode(destination_name),
            1,
        )
    else:
        raise DriverError("publication_failed")
    if result != 0:
        code = ctypes.get_errno()
        if code in {errno.EEXIST, errno.ENOTEMPTY}:
            raise DriverError("publication_exists")
        raise DriverError("publication_failed")


def _identity_matches_at(root_fd: int, name: str, expected: os.stat_result) -> bool:
    try:
        observed = os.stat(name, dir_fd=root_fd, follow_symlinks=False)
    except OSError:
        return False
    return (
        observed.st_dev,
        observed.st_ino,
        observed.st_uid,
        stat.S_IFMT(observed.st_mode),
    ) == (
        expected.st_dev,
        expected.st_ino,
        expected.st_uid,
        stat.S_IFMT(expected.st_mode),
    )


def _write_private_file_at(directory_fd: int, name: str, data: bytes) -> None:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(name, flags, 0o400, dir_fd=directory_fd)
    except OSError as exc:
        raise DriverError("publication_failed") from exc
    try:
        offset = 0
        while offset < len(data):
            written = os.write(descriptor, data[offset:])
            if written <= 0:
                raise DriverError("publication_failed")
            offset += written
        os.fchmod(descriptor, 0o400)
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _claim_root(root_fd: int) -> tuple[int, os.stat_result]:
    if _package_names(root_fd):
        raise DriverError("publication_exists")
    flags = os.O_RDWR | os.O_CREAT | os.O_EXCL | getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_NOFOLLOW", 0)
    lock_fd: int | None = None
    lock_identity: os.stat_result | None = None
    try:
        lock_fd = os.open(ROOT_LOCK_NAME, flags, 0o400, dir_fd=root_fd)
        lock_identity = os.fstat(lock_fd)
        payload = b"toc-capture-driver-v1\n"
        if os.write(lock_fd, payload) != len(payload):
            raise OSError(errno.EIO, "short private lock write")
        os.fchmod(lock_fd, 0o400)
        os.fsync(lock_fd)
        os.fsync(root_fd)
        lock_identity = os.fstat(lock_fd)
        if (
            not stat.S_ISREG(lock_identity.st_mode)
            or lock_identity.st_nlink != 1
            or lock_identity.st_uid != os.geteuid()
            or stat.S_IMODE(lock_identity.st_mode) != 0o400
            or _package_names(root_fd) != {ROOT_LOCK_NAME}
            or not _identity_matches_at(root_fd, ROOT_LOCK_NAME, lock_identity)
        ):
            raise OSError(errno.EINVAL, "private root claim changed")
        return lock_fd, lock_identity
    except OSError as exc:
        cleanup_proven = False
        if lock_identity is not None and _identity_matches_at(
            root_fd, ROOT_LOCK_NAME, lock_identity
        ):
            try:
                os.unlink(ROOT_LOCK_NAME, dir_fd=root_fd)
                os.fsync(root_fd)
                cleanup_proven = True
            except OSError:
                cleanup_proven = False
        if lock_fd is not None:
            os.close(lock_fd)
        if not cleanup_proven and lock_identity is not None:
            _indeterminate_root_marker(root_fd, kind="toc-envelope-claim")
            raise DriverError("cleanup_indeterminate") from exc
        raise DriverError("publication_failed") from exc


def _require_root_contents(
    root_fd: int,
    expected: set[str],
    *,
    lock_fd: int | None = None,
    lock_identity: os.stat_result | None = None,
) -> None:
    if _package_names(root_fd) != expected:
        raise DriverError("binding_mismatch")
    if lock_fd is not None and lock_identity is not None:
        if (
            os.fstat(lock_fd).st_dev != lock_identity.st_dev
            or os.fstat(lock_fd).st_ino != lock_identity.st_ino
            or not _identity_matches_at(root_fd, ROOT_LOCK_NAME, lock_identity)
        ):
            raise DriverError("binding_mismatch")


def _release_root_claim(
    root_fd: int, lock_fd: int, lock_identity: os.stat_result, remaining: set[str]
) -> None:
    _require_root_contents(
        root_fd,
        {ROOT_LOCK_NAME, *remaining},
        lock_fd=lock_fd,
        lock_identity=lock_identity,
    )
    if not _identity_matches_at(root_fd, ROOT_LOCK_NAME, lock_identity):
        raise DriverError("cleanup_indeterminate")
    try:
        os.unlink(ROOT_LOCK_NAME, dir_fd=root_fd)
        os.fsync(root_fd)
    except OSError as exc:
        raise DriverError("cleanup_indeterminate") from exc
    if _package_names(root_fd) != remaining:
        raise DriverError("cleanup_indeterminate")


def _wipe_directory_fd(directory_fd: int) -> bool:
    try:
        names = list(os.listdir(directory_fd))
    except OSError:
        return False
    for name in names:
        try:
            os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
        except OSError:
            return False
        if not _unlink_tree_at(directory_fd, name):
            return False
    try:
        os.fsync(directory_fd)
        return not os.listdir(directory_fd)
    except OSError:
        return False


def _indeterminate_root_marker(root_fd: int, *, kind: str) -> bool:
    name = f".indeterminate-{kind}-{secrets.token_hex(12)}"
    try:
        os.mkdir(name, 0o700, dir_fd=root_fd)
        directory_fd = _open_private_child(root_fd, name)
        try:
            _write_private_file_at(
                directory_fd,
                "EVIDENCE_INDETERMINATE",
                canonical_json_bytes(
                    {
                        "diagnostic_version": 1,
                        "reason": "cleanup_indeterminate",
                    }
                ),
            )
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
        os.fsync(root_fd)
        return True
    except BaseException:
        return False


def _remove_known_stage(
    staging_fd: int,
    stage_name: str,
    stage_fd: int,
    stage_identity: os.stat_result,
) -> bool:
    wiped = _wipe_directory_fd(stage_fd)
    same_name = _identity_matches_at(staging_fd, stage_name, stage_identity)
    if wiped and same_name:
        try:
            os.rmdir(stage_name, dir_fd=staging_fd)
            os.fsync(staging_fd)
            return True
        except OSError:
            pass
    # If the directory was renamed within the root, quarantine that exact inode.
    try:
        candidates = list(os.listdir(staging_fd))
    except OSError:
        candidates = []
    for candidate in candidates:
        if candidate == ROOT_LOCK_NAME:
            continue
        if _identity_matches_at(staging_fd, candidate, stage_identity):
            quarantine = f".indeterminate-toc-envelope-staging-{secrets.token_hex(12)}"
            try:
                _rename_no_replace_between(staging_fd, candidate, staging_fd, quarantine)
                os.fsync(staging_fd)
                return False
            except DriverError:
                break
    _indeterminate_root_marker(staging_fd, kind="toc-envelope-staging")
    return False


def _mark_final_indeterminate(
    output_fd: int, final_name: str, expected_identity: os.stat_result
) -> None:
    if not _identity_matches_at(output_fd, final_name, expected_identity):
        _indeterminate_root_marker(output_fd, kind="toc-envelope-capture")
        raise DriverError("cleanup_indeterminate")
    try:
        if _mark_indeterminate(output_fd, final_name, kind="capture"):
            return
    except BaseException:
        pass
    _indeterminate_root_marker(output_fd, kind="toc-envelope-capture")
    raise DriverError("cleanup_indeterminate")


def _promote_capture(stage_fd: int, output_fd: int, final_name: str) -> None:
    try:
        _rename_no_replace_between(stage_fd, final_name, output_fd, final_name)
        os.fsync(stage_fd)
        os.fsync(output_fd)
    except DriverError:
        raise
    except OSError as exc:
        raise RenamedPublicationError("publication_failed") from exc


def _remove_completion_marker(parent_fd: int, final_name: str) -> None:
    package_fd = _open_private_child(parent_fd, final_name)
    try:
        try:
            os.unlink("EVIDENCE_COMPLETE", dir_fd=package_fd)
        except OSError as exc:
            raise DriverError("publication_failed") from exc
        os.fsync(package_fd)
    finally:
        os.close(package_fd)


def _publish_completion_marker(
    output_fd: int, final_name: str, manifest_sha256: str
) -> None:
    package_fd = _open_private_child(output_fd, final_name)
    try:
        _write_private_file_at(
            package_fd,
            "EVIDENCE_COMPLETE",
            canonical_json_bytes(
                {
                    "artifact_kind": "lovable_toc_capture_complete",
                    "evidence_files_sha256": manifest_sha256,
                    "format_version": 1,
                }
            ),
        )
        os.fsync(package_fd)
        os.fsync(output_fd)
    finally:
        os.close(package_fd)


def _revalidate_runtime_bindings(
    inputs: Inputs,
    *,
    canonical_before: Any,
    tool_before: Any,
    repository_before: Mapping[str, str],
    root_metadata: Mapping[str, os.stat_result],
    staging_fd: int,
    output_fd: int,
) -> None:
    """Prove all externally bound inputs still identify the preflight objects."""

    try:
        canonical_after = _canonical_identity(inputs)
    except DriverError as exc:
        raise DriverError("canonical_mutated") from exc
    if canonical_after != canonical_before:
        raise DriverError("canonical_mutated")
    try:
        tool_after = _tool_identity(inputs)
    except DriverError as exc:
        raise DriverError("binding_mismatch") from exc
    if tool_after != tool_before:
        raise DriverError("binding_mismatch")
    if _repository_binding(inputs.approved_checkout_sha) != repository_before:
        raise DriverError("binding_mismatch")
    for label, path, held_fd in (
        ("evidence", inputs.evidence_run_directory, None),
        ("staging", inputs.staging_root, staging_fd),
        ("output", inputs.output_root, output_fd),
    ):
        expected = _directory_identity(root_metadata[label])
        try:
            if held_fd is not None and _directory_identity(os.fstat(held_fd)) != expected:
                raise DriverError("binding_mismatch")
            fresh_fd = validate_private_root(path)
        except (OSError, ContractError) as exc:
            raise DriverError("binding_mismatch") from exc
        try:
            if _directory_identity(os.fstat(fresh_fd)) != expected:
                raise DriverError("binding_mismatch")
        finally:
            os.close(fresh_fd)
        parent_label = f"{label}_parent"
        try:
            parent_fd = validate_private_root(path.parent)
        except ContractError as exc:
            raise DriverError("binding_mismatch") from exc
        try:
            if _directory_identity(os.fstat(parent_fd)) != _directory_identity(
                root_metadata[parent_label]
            ):
                raise DriverError("binding_mismatch")
        finally:
            os.close(parent_fd)
    try:
        canonical_parent_fd = validate_private_root(inputs.canonical_outer.parent)
    except ContractError as exc:
        raise DriverError("binding_mismatch") from exc
    try:
        if _directory_identity(os.fstat(canonical_parent_fd)) != _directory_identity(
            root_metadata["canonical_parent"]
        ):
            raise DriverError("binding_mismatch")
    finally:
        os.close(canonical_parent_fd)
    _validate_evidence_run(inputs)


def execute(environment: Mapping[str, str]) -> tuple[dict[str, int], dict[str, str]]:
    inputs = _parse_inputs(environment)
    repository_before = _repository_binding(inputs.approved_checkout_sha)
    _, root_metadata = _validate_paths(inputs)
    _validate_evidence_run(inputs)
    canonical_before = _canonical_identity(inputs)
    tool_before = _tool_identity(inputs)

    try:
        staging_fd = validate_private_root(inputs.staging_root)
    except ContractError as exc:
        raise DriverError("binding_mismatch") from exc
    try:
        output_fd = validate_private_root(inputs.output_root)
    except ContractError as exc:
        os.close(staging_fd)
        raise DriverError("binding_mismatch") from exc
    if (
        _directory_identity(os.fstat(staging_fd))
        != _directory_identity(root_metadata["staging"])
        or _directory_identity(os.fstat(output_fd))
        != _directory_identity(root_metadata["output"])
    ):
        os.close(staging_fd)
        os.close(output_fd)
        raise DriverError("binding_mismatch")
    stage_name = f".pending-toc-envelope-{secrets.token_hex(12)}"
    stage_created = False
    stage_child_fd: int | None = None
    stage_identity: os.stat_result | None = None
    staging_lock_fd: int | None = None
    staging_lock_identity: os.stat_result | None = None
    output_lock_fd: int | None = None
    output_lock_identity: os.stat_result | None = None
    staging_claimed = False
    output_claimed = False
    final_name: str | None = None
    package_identity: os.stat_result | None = None
    promoted = False
    counts: dict[str, int] | None = None
    hashes: dict[str, str] | None = None
    try:
        _require_capture_output_headroom(output_fd)
        staging_lock_fd, staging_lock_identity = _claim_root(staging_fd)
        staging_claimed = True
        output_lock_fd, output_lock_identity = _claim_root(output_fd)
        output_claimed = True
        _require_root_contents(
            staging_fd,
            {ROOT_LOCK_NAME},
            lock_fd=staging_lock_fd,
            lock_identity=staging_lock_identity,
        )
        _require_root_contents(
            output_fd,
            {ROOT_LOCK_NAME},
            lock_fd=output_lock_fd,
            lock_identity=output_lock_identity,
        )
        _mkdir_private_at(staging_fd, stage_name)
        stage_created = True
        try:
            os.fsync(staging_fd)
        except OSError as exc:
            raise DriverError("publication_failed") from exc
        stage_child_fd = _open_private_child(staging_fd, stage_name)
        stage_identity = os.fstat(stage_child_fd)
        try:
            _require_root_contents(
                staging_fd,
                {ROOT_LOCK_NAME, stage_name},
                lock_fd=staging_lock_fd,
                lock_identity=staging_lock_identity,
            )
            _require_root_contents(
                output_fd,
                {ROOT_LOCK_NAME},
                lock_fd=output_lock_fd,
                lock_identity=output_lock_identity,
            )
            try:
                normalizer_result = _run_child(
                    [
                        sys.executable,
                        "-B",
                        "-I",
                        str(REPO / "scripts/migration/normalize-lovable-export.py"),
                        "--expected-outer-sha256",
                        inputs.outer_sha256,
                        "--output",
                        INNER_NAME,
                        "--metadata-output",
                        NORMALIZATION_NAME,
                        str(inputs.canonical_outer),
                    ],
                    environment={},
                    directory_fd=stage_child_fd,
                    prefix="normalizer",
                    timeout_seconds=NORMALIZER_TIMEOUT_SECONDS,
                )
            except TimeoutError as exc:
                raise DriverError("normalization_timeout") from exc
            except ChildOutputLimit as exc:
                raise DriverError("normalization_output_invalid") from exc
            if normalizer_result.returncode != 0:
                raise DriverError("normalization_failed")
            if normalizer_result.stdout or normalizer_result.stderr:
                raise DriverError("normalization_output_invalid")
            inner_identity = _stable_digest_at(
                stage_child_fd,
                INNER_NAME,
                max_bytes=MAX_INNER_BYTES,
                exact_mode=0o400,
            )
            _verify_inner_magic_at(stage_child_fd, INNER_NAME)
            metadata = _read_normalization_metadata(stage_child_fd)
            _validate_normalization(metadata, inputs, inner_identity)
            if _package_names(stage_child_fd) != {INNER_NAME, NORMALIZATION_NAME}:
                raise DriverError("normalization_output_invalid")

            try:
                capture_result = _run_child(
                    [
                        sys.executable,
                        "-B",
                        "-I",
                        str(REPO / "scripts/migration/capture-lovable-toc.py"),
                    ],
                    environment=_capture_environment(inputs, stage_child_fd),
                    directory_fd=stage_child_fd,
                    prefix="capture",
                    timeout_seconds=CAPTURE_TIMEOUT_SECONDS,
                )
            except TimeoutError as exc:
                raise DriverError("capture_timeout") from exc
            except ChildOutputLimit as exc:
                raise DriverError("capture_output_invalid") from exc
            counts, hashes = _parse_capture_diagnostic(capture_result)
            if (
                counts["entry_count"] != inputs.expected_entry_count
                or counts["data_reference_count"]
                != inputs.expected_data_reference_count
            ):
                raise DriverError("binding_mismatch")
            final_name = (
                f"toc-capture-{inputs.run_id.lower()}-"
                f"{hashes['raw_toc_sha256'][:12]}"
            )
            if PACKAGE_NAME_RE.fullmatch(final_name) is None:
                raise DriverError("input_invalid")
            if _package_names(stage_child_fd) != {
                INNER_NAME,
                NORMALIZATION_NAME,
                final_name,
            }:
                raise DriverError("publication_failed")
            package_identity = os.stat(
                final_name, dir_fd=stage_child_fd, follow_symlinks=False
            )
            _read_capture_package(
                stage_child_fd,
                final_name,
                inputs,
                counts,
                hashes,
                tool_identity=tool_before,
                repository_identity=repository_before,
                require_marker=True,
            )
            # The child marker is deliberately withheld before the final name
            # can become visible.  Only this outer driver may complete it.
            _remove_completion_marker(stage_child_fd, final_name)
            _read_capture_package(
                stage_child_fd,
                final_name,
                inputs,
                counts,
                hashes,
                tool_identity=tool_before,
                repository_identity=repository_before,
                require_marker=False,
            )
            _unlink_file_at(stage_child_fd, INNER_NAME)
            _unlink_file_at(stage_child_fd, NORMALIZATION_NAME)
            os.fsync(stage_child_fd)
            if _package_names(stage_child_fd) != {final_name}:
                raise DriverError("cleanup_indeterminate")

        finally:
            pass

        _revalidate_runtime_bindings(
            inputs,
            canonical_before=canonical_before,
            tool_before=tool_before,
            repository_before=repository_before,
            root_metadata=root_metadata,
            staging_fd=staging_fd,
            output_fd=output_fd,
        )
        _require_root_contents(
            staging_fd,
            {ROOT_LOCK_NAME, stage_name},
            lock_fd=staging_lock_fd,
            lock_identity=staging_lock_identity,
        )
        _require_root_contents(
            output_fd,
            {ROOT_LOCK_NAME},
            lock_fd=output_lock_fd,
            lock_identity=output_lock_identity,
        )
        if final_name is None or counts is None or hashes is None:
            raise DriverError("internal_failure")
        _promote_capture(stage_child_fd, output_fd, final_name)
        promoted = True
        if package_identity is None or not _identity_matches_at(
            output_fd, final_name, package_identity
        ):
            raise DriverError("cleanup_indeterminate")
        _require_root_contents(
            output_fd,
            {ROOT_LOCK_NAME, final_name},
            lock_fd=output_lock_fd,
            lock_identity=output_lock_identity,
        )
        if _package_names(stage_child_fd):
            raise DriverError("cleanup_indeterminate")
        _read_capture_package(
            output_fd,
            final_name,
            inputs,
            counts,
            hashes,
            tool_identity=tool_before,
            repository_identity=repository_before,
            require_marker=False,
        )
        _revalidate_runtime_bindings(
            inputs,
            canonical_before=canonical_before,
            tool_before=tool_before,
            repository_before=repository_before,
            root_metadata=root_metadata,
            staging_fd=staging_fd,
            output_fd=output_fd,
        )
        if stage_identity is None or not _remove_known_stage(
            staging_fd, stage_name, stage_child_fd, stage_identity
        ):
            raise DriverError("cleanup_indeterminate")
        stage_created = False
        _release_root_claim(
            staging_fd,
            staging_lock_fd,
            staging_lock_identity,
            set(),
        )
        staging_claimed = False
        _publish_completion_marker(
            output_fd, final_name, hashes["capture_manifest_sha256"]
        )
        _read_capture_package(
            output_fd,
            final_name,
            inputs,
            counts,
            hashes,
            tool_identity=tool_before,
            repository_identity=repository_before,
            require_marker=True,
        )
        _revalidate_runtime_bindings(
            inputs,
            canonical_before=canonical_before,
            tool_before=tool_before,
            repository_before=repository_before,
            root_metadata=root_metadata,
            staging_fd=staging_fd,
            output_fd=output_fd,
        )
        _release_root_claim(
            output_fd,
            output_lock_fd,
            output_lock_identity,
            {final_name},
        )
        output_claimed = False
        if _package_names(staging_fd) or _package_names(output_fd) != {final_name}:
            raise DriverError("cleanup_indeterminate")
        _read_capture_package(
            output_fd,
            final_name,
            inputs,
            counts,
            hashes,
            tool_identity=tool_before,
            repository_identity=repository_before,
            require_marker=True,
        )
        _revalidate_runtime_bindings(
            inputs,
            canonical_before=canonical_before,
            tool_before=tool_before,
            repository_before=repository_before,
            root_metadata=root_metadata,
            staging_fd=staging_fd,
            output_fd=output_fd,
        )
        return counts, hashes
    except BaseException as exc:
        if isinstance(exc, RenamedPublicationError):
            promoted = True
        cleanup_failed = False
        final_indeterminate_proven = False
        if promoted and final_name is not None and package_identity is not None:
            try:
                _mark_final_indeterminate(output_fd, final_name, package_identity)
                final_indeterminate_proven = True
            except DriverError:
                cleanup_failed = True
        if stage_created and stage_child_fd is not None and stage_identity is not None:
            if not _remove_known_stage(
                staging_fd, stage_name, stage_child_fd, stage_identity
            ):
                cleanup_failed = True
            else:
                stage_created = False
        if staging_claimed and staging_lock_fd is not None and staging_lock_identity is not None:
            try:
                remaining = _package_names(staging_fd) - {ROOT_LOCK_NAME}
                if any(not name.startswith(".indeterminate-") for name in remaining):
                    _indeterminate_root_marker(staging_fd, kind="toc-envelope-staging")
                    raise DriverError("cleanup_indeterminate")
                _release_root_claim(
                    staging_fd,
                    staging_lock_fd,
                    staging_lock_identity,
                    remaining,
                )
                staging_claimed = False
            except DriverError:
                cleanup_failed = True
        if output_claimed and output_lock_fd is not None and output_lock_identity is not None:
            try:
                remaining = _package_names(output_fd) - {ROOT_LOCK_NAME}
                allowed_final = (
                    {final_name}
                    if final_indeterminate_proven and final_name is not None
                    else set()
                )
                if any(
                    name not in allowed_final and not name.startswith(".indeterminate-")
                    for name in remaining
                ):
                    _indeterminate_root_marker(output_fd, kind="toc-envelope-capture")
                    raise DriverError("cleanup_indeterminate")
                _release_root_claim(
                    output_fd,
                    output_lock_fd,
                    output_lock_identity,
                    remaining,
                )
                output_claimed = False
            except DriverError:
                cleanup_failed = True
        runtime_failure: DriverError | None = None
        try:
            _revalidate_runtime_bindings(
                inputs,
                canonical_before=canonical_before,
                tool_before=tool_before,
                repository_before=repository_before,
                root_metadata=root_metadata,
                staging_fd=staging_fd,
                output_fd=output_fd,
            )
        except DriverError as revalidation_error:
            runtime_failure = revalidation_error
        if cleanup_failed:
            raise DriverError("cleanup_indeterminate") from exc
        if runtime_failure is not None:
            raise runtime_failure from exc
        if isinstance(exc, DriverError):
            raise
        if isinstance(exc, (KeyboardInterrupt, SystemExit)):
            raise
        raise DriverError("internal_failure") from exc
    finally:
        if stage_child_fd is not None:
            os.close(stage_child_fd)
        if staging_lock_fd is not None:
            os.close(staging_lock_fd)
        if output_lock_fd is not None:
            os.close(output_lock_fd)
        os.close(staging_fd)
        os.close(output_fd)


def main() -> int:
    try:
        counts, hashes = execute(os.environ)
    except DriverError as exc:
        sys.stderr.buffer.write(_diagnostic(status="failed", reason=exc.reason))
        return 1
    except BaseException:
        sys.stderr.buffer.write(_diagnostic(status="failed", reason="internal_failure"))
        return 1
    sys.stdout.buffer.write(
        _diagnostic(
            status="review_required",
            reason="blocked",
            counts=counts,
            hashes=hashes,
        )
    )
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
