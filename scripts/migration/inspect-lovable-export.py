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
HEX_OBJECT = re.compile(r"[0-9a-f]{40,64}")
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
INSPECTOR_FAILURE_REASONS = frozenset(
    {
        "not_applicable",
        "unsupported_archive_version",
        "invalid_archive",
        "truncated_archive",
        "timeout",
        "output_cap",
        "invalid_output",
        "other_nonzero",
    }
)
DRIVER_INSPECTOR_STAGE_CODES = INSPECTOR_STAGE_CODES | {
    "inspector_diagnostic_invalid"
}
MAX_INSPECTOR_DIAGNOSTIC_BYTES = 4096
MAX_OUTER_BYTES = 5_000_000_000
MIN_WORKSPACE_OVERHEAD_BYTES = 256 * 1024 * 1024
MAX_REPORT_BYTES = 128 * 1024 * 1024
DURABLE_EVIDENCE_DIRECTORY = "migration-inspection-evidence"


class WorkflowError(RuntimeError):
    """A fail-closed workflow condition."""


class InspectorStageError(WorkflowError):
    """A raw-inspector failure reduced to reviewed machine codes only."""

    def __init__(self, stage: str, reason: str):
        if stage not in DRIVER_INSPECTOR_STAGE_CODES:
            stage = "inspector_diagnostic_invalid"
        if reason not in INSPECTOR_FAILURE_REASONS:
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
        try:
            manifest = json.loads(manifest_bytes.decode("utf-8"))
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise WorkflowError("durable evidence manifest is invalid") from exc
        if (
            not isinstance(manifest, dict)
            or set(manifest)
            != {
                "format_version",
                "artifact_kind",
                "run_id",
                "files",
                "self_hash_boundary",
            }
            or manifest.get("format_version") != 1
            or manifest.get("artifact_kind")
            != "migration_inspection_evidence_file_manifest"
            or manifest.get("run_id") != expected_run_id
            or not isinstance(manifest.get("files"), dict)
            or set(manifest["files"]) != CORE_EVIDENCE_FILES
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
        try:
            provenance = json.loads(
                read_private_file_at(root_fd, "provenance.json").decode("utf-8")
            )
        except (UnicodeError, json.JSONDecodeError) as exc:
            raise WorkflowError("durable provenance is invalid") from exc
        if not isinstance(provenance, dict) or provenance.get("run_id") != expected_run_id:
            raise WorkflowError("durable provenance run_id does not match its package")
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
        "self_hash_boundary": (
            "the detached evidence-files.sha256 binds this manifest; "
            "runtime publication verification also compares every copied file"
        ),
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
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if (
        not isinstance(manifest, dict)
        or set(manifest)
        != {
            "format_version",
            "artifact_kind",
            "run_id",
            "files",
            "self_hash_boundary",
        }
        or manifest.get("format_version") != 1
        or manifest.get("artifact_kind")
        != "migration_inspection_evidence_file_manifest"
        or manifest.get("run_id") != expected_run_id
        or not isinstance(manifest.get("files"), dict)
        or set(manifest["files"]) != CORE_EVIDENCE_FILES
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
    try:
        provenance = json.loads((pending / "provenance.json").read_text(encoding="utf-8"))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise WorkflowError("provenance is invalid") from exc
    if not isinstance(provenance, dict) or provenance.get("run_id") != expected_run_id:
        raise WorkflowError("provenance run_id does not match its package")
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
) -> Path:
    """Copy, verify, fsync, and no-replace publish outside disposable Git space."""

    source_identities = validate_evidence_tree(pending, run_id)
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
        source_identities_after_copy = validate_evidence_tree(pending, run_id)
        if source_identities_after_copy != source_identities:
            raise WorkflowError("publication source changed while evidence was copied")
        destination_identities = validate_evidence_tree_at(staging_fd, run_id)
        if destination_identities != source_identities:
            raise WorkflowError("durable evidence copy identity mismatch")
        os.fsync(staging_fd)
        os.fsync(parent_fd)
        os.fsync(bound.root_fd)

        # Disposable archive bytes are removed before the durable commit gate.
        remove_incomplete_run(run_root)
        verify_bound_canonical(bound)
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
        if validate_evidence_tree_at(staging_fd, run_id) != source_identities:
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
                validate_evidence_tree_at(staging_fd, run_id)
                != source_identities
            ):
                raise WorkflowError("published durable evidence identity mismatch")
            verify_bound_canonical(bound)
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
        or reason not in INSPECTOR_FAILURE_REASONS
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

    baseline_paths = [
        "scripts/migration/lib/lovable_dump_report.py",
        "supabase/migrations",
    ]
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
        raise WorkflowError(
            "inspection helper/migration inputs differ from their historical baseline"
        )

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
        write_exclusive(expected_sha_file, (expected_sha256 + "\n").encode("ascii"))
        write_exclusive(
            observed_before_file,
            (bound.observed_sha256 + "\n").encode("ascii"),
        )

        derived_dir = pending / ".derived"
        derived_dir.mkdir(mode=0o700)
        inner_archive = derived_dir / "verified-inner.pgdmp"
        normalization_file = derived_dir / "normalization.json"
        normalizer = repo / "scripts/migration/normalize-lovable-export.py"
        normalize_result = subprocess.run(
            [
                identities["execution_python_executable"],
                "-I",
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
        required_report_lines = {
            "inspection_status: REVIEW_REQUIRED",
            "restore_attempted: no",
            "database_connection_attempted: no",
            "row_payload_inspected: no",
            "input_file: verified-inner.pgdmp",
            f"size_bytes: {inner_size}",
        }
        report_lines = set(report_text.splitlines())
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
        write_exclusive(
            observed_after_file,
            (canonical_sha_after + "\n").encode("ascii"),
        )

        report_sha = file_sha256(report)
        report_sha_file = inspection_dir / "report.sha256"
        write_exclusive(report_sha_file, (report_sha + "\n").encode("ascii"))

        identities_after_execution = preflight(repo)
        if identities_after_execution != identities:
            raise WorkflowError("execution provenance changed during inspection")
        if repository_project_id(repo) != configured_project_ref:
            raise WorkflowError("repository project binding changed during inspection")

        root_metadata = os.fstat(bound.root_fd)
        file_metadata = os.fstat(bound.file_fd)
        provenance: dict[str, Any] = {
            "format_version": 4,
            "artifact_kind": "lovable_cloud_export_inspection_provenance",
            "inspection_status": "REVIEW_REQUIRED",
            "export_timeline_status": timeline_status,
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
                "historical_baseline_scope": (
                    "unchanged report helper and supabase/migrations only"
                ),
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
                "publication_semantics": (
                    "descriptor_bound_fsynced_payload_then_atomic_no_replace_"
                    "postcommit_validation_then_completion_marker"
                ),
            },
            "support_reported_not_independently_verified": [
                "export source completeness and point-in-time boundary",
                "maximum export size 5 GB",
                "one export generation per 24 hours",
                "Lovable UI export control to backend-project mapping",
            ],
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
        )
        completed = True
        print("inspection_status=REVIEW_REQUIRED")
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
