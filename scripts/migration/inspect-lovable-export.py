#!/usr/bin/env python3
"""Build a fail-closed, metadata-only Lovable export evidence package.

This driver is deliberately local-only.  It validates the externally approved
Git checkout and the operator-supplied timeline, captures the canonical outer
artifact into private working space, delegates ZIP/raw-PGDMP normalization to
``normalize-lovable-export.py``, and invokes the existing PGDMP inspector only
against the verified inner archive.  No database connection or restore mode is
implemented.

Reports and provenance remain under a hidden pending directory until every
hash and safety-boundary check succeeds.  A failed run removes its reservation
and all derived bytes; an existing run is never overwritten.
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


INSPECTION_TOOL_GIT_SHA = "c87a124602eb669b3ec5a3829610c6cb465d3e26"
PROCEDURE_ORIGIN_SHA = "e4eed4a21049d274738110710a468e265c2893d2"
WORKFLOW_LABEL = b"LOVABLE EXPORT EVIDENCE WORKFLOW"
HEX40 = re.compile(r"[0-9a-f]{40}")
HEX_OBJECT = re.compile(r"[0-9a-f]{40,64}")
HEX64 = re.compile(r"[0-9a-f]{64}")
PROJECT_REF = re.compile(r"[a-z0-9]{20}")
RFC3339_UTC = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z")
PLACEHOLDER = re.compile(r"[<>]|placeholder|replace|todo|tbd", re.IGNORECASE)
REPORT_SHA = re.compile(r"^sha256: ([0-9a-f]{64})$", re.MULTILINE)
MAX_OUTER_BYTES = 5_000_000_000
MIN_WORKSPACE_OVERHEAD_BYTES = 256 * 1024 * 1024


class WorkflowError(RuntimeError):
    """A fail-closed workflow condition."""


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


def safe_open_regular(path: Path) -> int:
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError as exc:
        raise WorkflowError("canonical export must be a readable, non-symlink local file") from exc
    metadata = os.fstat(descriptor)
    if not stat.S_ISREG(metadata.st_mode):
        os.close(descriptor)
        raise WorkflowError("canonical export must be a regular file")
    if metadata.st_size <= 0:
        os.close(descriptor)
        raise WorkflowError("canonical export is empty")
    if metadata.st_size > MAX_OUTER_BYTES:
        os.close(descriptor)
        raise WorkflowError("canonical export exceeds the 5 GB inspection cap")
    return descriptor


def fingerprint_regular(path: Path) -> tuple[int, str]:
    descriptor = safe_open_regular(path)
    digest = hashlib.sha256()
    size = 0
    try:
        initial = os.fstat(descriptor)
        while True:
            chunk = os.read(descriptor, 1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_OUTER_BYTES or size > initial.st_size:
                raise WorkflowError("canonical export grew beyond its admitted byte length")
            digest.update(chunk)
        final = os.fstat(descriptor)
    finally:
        os.close(descriptor)
    identity_before = (initial.st_dev, initial.st_ino, initial.st_size)
    identity_after = (final.st_dev, final.st_ino, final.st_size)
    if identity_before != identity_after or size != final.st_size:
        raise WorkflowError("canonical export changed while it was fingerprinted")
    return size, digest.hexdigest()


def copy_regular_snapshot(
    source: Path,
    destination: Path,
    expected_sha: str,
    expected_size: int,
) -> int:
    source_fd = safe_open_regular(source)
    partial = destination.with_name(destination.name + ".partial")
    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=False)
    output_fd = -1
    digest = hashlib.sha256()
    size = 0
    published = False
    try:
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
        os.fsync(output_fd)
        os.fchmod(output_fd, 0o400)
        os.close(output_fd)
        output_fd = -1
        if size != expected_size or os.fstat(source_fd).st_size != expected_size:
            raise WorkflowError("canonical export byte length changed during capture")
        if digest.hexdigest() != expected_sha:
            raise WorkflowError("canonical export changed while its working copy was captured")
        os.link(partial, destination, follow_symlinks=False)
        published = True
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
        os.close(source_fd)
        if output_fd >= 0:
            os.close(output_fd)
        partial.unlink(missing_ok=True)
        if not published:
            destination.unlink(missing_ok=True)


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
        os.fsync(descriptor)
        os.fchmod(descriptor, mode)
    except Exception:
        os.close(descriptor)
        path.unlink(missing_ok=True)
        raise
    else:
        os.close(descriptor)


def fsync_directory(path: Path) -> None:
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(path, flags)
    try:
        os.fsync(descriptor)
    finally:
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


def atomic_rename_no_replace(source: Path, destination: Path) -> None:
    library = ctypes.CDLL(None, use_errno=True)
    source_bytes = os.fsencode(source)
    destination_bytes = os.fsencode(destination)
    if sys.platform == "darwin":
        try:
            rename = library.renamex_np
        except AttributeError as exc:
            raise WorkflowError(
                "platform lacks atomic no-replace evidence publication"
            ) from exc
        rename.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_uint]
        rename.restype = ctypes.c_int
        result = rename(source_bytes, destination_bytes, 0x00000004)
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
        result = rename(-100, source_bytes, -100, destination_bytes, 0x00000001)
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


def publish_evidence_no_replace(pending: Path, evidence: Path) -> None:
    expected_directories = {"archive", "inspection"}
    expected_files = {
        "EVIDENCE_COMPLETE",
        "archive/outer.sha256.before",
        "archive/outer.sha256.after",
        "inspection/rehearsal-metadata.txt",
        "inspection/report.sha256",
        "provenance.json",
        "provenance.sha256",
    }
    actual_directories: set[str] = set()
    actual_files: set[str] = set()
    for child in pending.rglob("*"):
        relative = child.relative_to(pending).as_posix()
        metadata = child.lstat()
        if stat.S_ISDIR(metadata.st_mode):
            actual_directories.add(relative)
        elif stat.S_ISREG(metadata.st_mode):
            if stat.S_IMODE(metadata.st_mode) != 0o400:
                raise WorkflowError("pending evidence file mode is not 0400")
            actual_files.add(relative)
        else:
            raise WorkflowError("pending evidence contains a non-regular object")
    if actual_directories != expected_directories or actual_files != expected_files:
        raise WorkflowError("pending evidence tree differs from the reviewed contract")

    for directory in sorted(expected_directories):
        fsync_directory(pending / directory)
    fsync_directory(pending)
    atomic_rename_no_replace(pending, evidence)
    fsync_directory(evidence)
    fsync_directory(evidence.parent)


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
    if not git_success(repo, ["cat-file", "-e", f"{INSPECTION_TOOL_GIT_SHA}^{{commit}}"]):
        raise WorkflowError("inspection tool baseline commit is unavailable")
    if not git_success(
        repo, ["merge-base", "--is-ancestor", INSPECTION_TOOL_GIT_SHA, execution]
    ):
        raise WorkflowError("inspection tool commit is not an execution ancestor")

    tool_paths = [
        "scripts/migration/inspect-lovable-dump.sh",
        "scripts/migration/lib/lovable_dump_report.py",
        "supabase/migrations",
    ]
    if not git_success(repo, ["diff", "--quiet", INSPECTION_TOOL_GIT_SHA, "--", *tool_paths]):
        raise WorkflowError("inspection tool/input tree differs from its reviewed Git SHA")

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
    ]
    if not git_success(repo, ["diff", "--quiet", execution, "--", *execution_paths]):
        raise WorkflowError("execution procedure differs from the approved checkout")
    if run_git(repo, ["status", "--porcelain"]):
        raise WorkflowError("execution checkout must have a clean worktree and index")

    supplied_tool_sha = os.environ.get("INSPECTION_TOOL_GIT_SHA", INSPECTION_TOOL_GIT_SHA)
    if supplied_tool_sha != INSPECTION_TOOL_GIT_SHA:
        raise WorkflowError("unexpected inspection tool Git SHA")

    identities: dict[str, str] = {
        "approved_execution_checkout_sha": approved,
        "execution_checkout_sha": execution,
        "procedure_origin_sha": PROCEDURE_ORIGIN_SHA,
        "inspection_tool_git_sha": INSPECTION_TOOL_GIT_SHA,
    }
    for label, relative in {
        "procedure_readme_blob_sha": "scripts/migration/README.md",
        "execution_driver_blob_sha": "scripts/migration/inspect-lovable-export.py",
        "normalizer_blob_sha": "scripts/migration/normalize-lovable-export.py",
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
    return identities


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
    ui_object_name = required_environment("UI_EXPORT_OBJECT_NAME")
    operator = required_environment("OPERATOR_IDENTITY")
    evidence_profile = required_environment("EXPORT_EVIDENCE_PROFILE")
    timeline, _, timeline_status = build_timeline(evidence_profile)

    canonical_text = required_environment("CANONICAL_EXPORT")
    if re.match(r"^[A-Za-z][A-Za-z0-9+.-]*://", canonical_text) or re.match(
        r"^(postgres|postgresql):", canonical_text
    ):
        raise WorkflowError("CANONICAL_EXPORT must be a local filesystem path")
    canonical = Path(canonical_text)
    if not canonical.is_absolute():
        raise WorkflowError("CANONICAL_EXPORT must be an absolute local path")
    repo_resolved = repo.resolve(strict=True)
    canonical_lexical = Path(os.path.abspath(os.fspath(canonical)))
    canonical_resolved = canonical.resolve(strict=True)
    if path_is_within(canonical_lexical, repo_resolved) or path_is_within(
        canonical_resolved, repo_resolved
    ):
        raise WorkflowError(
            "CANONICAL_EXPORT must be retained outside the Git worktree"
        )
    if any(ord(character) < 32 or ord(character) == 127 for character in canonical.name):
        raise WorkflowError("canonical export filename contains control characters")
    original_filename = canonical.name
    outer_size, outer_sha_before = fingerprint_regular(canonical)

    availability_text = timeline["available_at_utc"]["value"]
    assert isinstance(availability_text, str)
    compact_availability = availability_text.replace("-", "").replace(":", "")
    run_kind = "final_cutover" if evidence_profile == "final_cutover" else "rehearsal"
    run_prefix = "final" if run_kind == "final_cutover" else "rehearsal"
    run_id = f"{run_prefix}-{compact_availability}-{outer_sha_before[:12]}"

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
    ensure_pre_copy_headroom(workspace, outer_size)

    run_root = workspace / run_id
    try:
        run_root.mkdir(mode=0o700)
    except FileExistsError as exc:
        raise WorkflowError("evidence run already exists; refusing to overwrite it") from exc

    pending = run_root / ".pending"
    completed = False
    try:
        pending.mkdir(mode=0o700)
        working_dir = pending / ".working"
        working_outer = working_dir / "canonical-outer.artifact"
        copied_size = copy_regular_snapshot(
            canonical, working_outer, outer_sha_before, outer_size
        )
        if copied_size != outer_size:
            raise WorkflowError("canonical and working outer artifact sizes differ")

        checksum_dir = pending / "archive"
        checksum_dir.mkdir(mode=0o700)
        before_file = checksum_dir / "outer.sha256.before"
        after_file = checksum_dir / "outer.sha256.after"
        write_exclusive(before_file, (outer_sha_before + "\n").encode("ascii"))

        derived_dir = pending / ".derived"
        derived_dir.mkdir(mode=0o700)
        inner_archive = derived_dir / "verified-inner.pgdmp"
        normalization_file = derived_dir / "normalization.json"
        normalizer = repo / "scripts/migration/normalize-lovable-export.py"
        normalize_result = subprocess.run(
            [
                sys.executable,
                str(normalizer),
                "--expected-outer-sha256",
                outer_sha_before,
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
            outer_sha_before,
            outer_size,
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
        inspector_environment = os.environ.copy()
        inspector_environment["TMPDIR"] = str(inspector_temp)
        inspect_result = subprocess.run(
            ["bash", str(inspector), "--output", str(report), str(inner_archive)],
            cwd=repo,
            env=inspector_environment,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if inspect_result.returncode != 0:
            raise WorkflowError("inner PGDMP metadata inspection failed closed")
        if inspect_result.stderr or inspect_result.stdout != (
            f"Metadata-only report written to {report}\n"
        ):
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
        os.chmod(report, 0o400)
        inner_sha_after = file_sha256(inner_archive)
        if len({inner_sha, inner_sha_after, reported_hashes[0]}) != 1:
            raise WorkflowError("normalizer, derived archive, and inspector inner hashes differ")

        working_size_after, working_sha_after = fingerprint_regular(working_outer)
        canonical_size_after, canonical_sha_after = fingerprint_regular(canonical)
        if outer_size != canonical_size_after or copied_size != working_size_after:
            raise WorkflowError("outer artifact byte length changed during inspection")
        normalizer_outer = normalization["outer"]
        outer_hashes = {
            outer_sha_before,
            working_sha_after,
            canonical_sha_after,
            normalizer_outer["sha256_before"],
            normalizer_outer["sha256_after"],
        }
        if len(outer_hashes) != 1:
            raise WorkflowError("canonical or working outer artifact changed during inspection")
        write_exclusive(after_file, (canonical_sha_after + "\n").encode("ascii"))

        report_sha = file_sha256(report)
        report_sha_file = inspection_dir / "report.sha256"
        write_exclusive(report_sha_file, (report_sha + "\n").encode("ascii"))

        identities_after_execution = preflight(repo)
        if identities_after_execution != identities:
            raise WorkflowError("execution provenance changed during inspection")

        envelope_kind = normalization["envelope_kind"]
        provenance: dict[str, Any] = {
            "format_version": 2,
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
                "pgdmp_inspector": {
                    "path": "scripts/migration/inspect-lovable-dump.sh",
                    "git_sha": INSPECTION_TOOL_GIT_SHA,
                },
            },
            "lovable_source_project": {
                "name": source_name,
                "ref": source_ref,
                "identity_boundary": "operator-observed UI plus repository binding; Lovable's internal export mapping is not independently verifiable",
            },
            "export_timeline": timeline,
            "outer_artifact": {
                "role": "canonical_download_envelope",
                "ui_observed_export_object_name": ui_object_name,
                "original_filename": original_filename,
                "size_bytes": outer_size,
                "format": normalization["outer"]["format"],
                "sha256_evidence": {
                    "external_before": outer_sha_before,
                    "normalizer_before": normalizer_outer["sha256_before"],
                    "normalizer_after": normalizer_outer["sha256_after"],
                    "external_after": canonical_sha_after,
                },
                "external_checksum_files": {
                    "before": relative_to(before_file, pending),
                    "after": relative_to(after_file, pending),
                },
                "working_copy_retained_in_evidence": False,
            },
            "zip_envelope": normalization["outer"].get("zip"),
            "archive_member": normalization.get("member"),
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
                "retained_in_evidence": False,
            },
            "operator_identity": operator,
            "report": {
                "filename": report.name,
                "relative_path": relative_to(report, pending),
                "sha256": report_sha,
                "checksum_file": relative_to(report_sha_file, pending),
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
        complete_marker = pending / "EVIDENCE_COMPLETE"
        write_exclusive(
            complete_marker,
            b"inspection_status=REVIEW_REQUIRED\n",
        )
        for directory in (checksum_dir, inspection_dir, pending):
            os.chmod(directory, 0o700)
        evidence = run_root / "evidence"
        publish_evidence_no_replace(pending, evidence)
        completed = True
        print(f"inspection_status=REVIEW_REQUIRED")
        print(f"export_timeline_status={timeline_status}")
        print(f"evidence_run={run_root.relative_to(repo).as_posix()}")
        return run_root
    finally:
        if not completed:
            remove_incomplete_run(run_root)


def main() -> int:
    try:
        inspect()
    except (WorkflowError, OSError, UnicodeError, json.JSONDecodeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 4
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
