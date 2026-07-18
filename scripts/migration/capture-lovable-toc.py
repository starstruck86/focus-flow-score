#!/usr/bin/env python3
"""Capture a future pg_restore TOC into a private, cross-bound package.

This internal component has no restore mode. Its only child invocations are the
checked-in bounded wrapper with ``--version`` and ``--list``. Raw child output
is held privately and is never forwarded to the terminal.
"""

from __future__ import annotations

import os
import stat as _startup_stat
import subprocess as _startup_subprocess
import sys


_STARTUP_FAILURE_DIAGNOSTIC = (
    b'{"diagnostic_version":1,"reason":"input_invalid",'
    b'"stage":"capture","status":"failed"}\n'
)
_STARTUP_BINDING_FAILURE_DIAGNOSTIC = (
    b'{"diagnostic_version":1,"reason":"binding_mismatch",'
    b'"stage":"capture","status":"failed"}\n'
)
_REVIEWED_GIT = "/usr/bin/git"
_REVIEWED_GIT_CONFIG = (
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "core.untrackedCache=false",
)
_REVIEWED_GIT_ENVIRONMENT = {
    "GIT_CONFIG_GLOBAL": "/dev/null",
    "GIT_CONFIG_NOSYSTEM": "1",
    "GIT_CONFIG_SYSTEM": "/dev/null",
    "GIT_NO_REPLACE_OBJECTS": "1",
    "GIT_OPTIONAL_LOCKS": "0",
    "GIT_TERMINAL_PROMPT": "0",
    "LANG": "C",
    "LC_ALL": "C",
    "PATH": "/usr/bin:/bin",
}
_MAX_REVIEWED_GIT_OUTPUT_BYTES = 1024 * 1024


class _ReviewedGitFailure(RuntimeError):
    """A private failure whose data is never included in a diagnostic."""


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


def _fail_unisolated_startup() -> None:
    try:
        os.write(2, _STARTUP_FAILURE_DIAGNOSTIC)
    except BaseException:
        pass
    raise SystemExit(1)


def _fail_startup_binding() -> None:
    try:
        os.write(2, _STARTUP_BINDING_FAILURE_DIAGNOSTIC)
    except BaseException:
        pass
    raise SystemExit(1)


def _reviewed_git_bytes(
    repository: str, arguments: list[str], *, timeout_seconds: int
) -> bytes:
    """Run only the reviewed system Git under a closed configuration domain."""

    try:
        metadata = os.lstat(_REVIEWED_GIT)
        if (
            _startup_stat.S_ISLNK(metadata.st_mode)
            or not _startup_stat.S_ISREG(metadata.st_mode)
            or not os.access(_REVIEWED_GIT, os.X_OK)
        ):
            raise _ReviewedGitFailure
        result = _startup_subprocess.run(
            [_REVIEWED_GIT, *_REVIEWED_GIT_CONFIG, *arguments],
            cwd=repository,
            check=False,
            stdin=_startup_subprocess.DEVNULL,
            stdout=_startup_subprocess.PIPE,
            stderr=_startup_subprocess.DEVNULL,
            env=dict(_REVIEWED_GIT_ENVIRONMENT),
            timeout=timeout_seconds,
            close_fds=True,
        )
    except BaseException as exc:
        raise _ReviewedGitFailure from exc
    if (
        result.returncode != 0
        or len(result.stdout) > _MAX_REVIEWED_GIT_OUTPUT_BYTES
    ):
        raise _ReviewedGitFailure
    return result.stdout


def _is_full_lowercase_git_sha(value: str | None) -> bool:
    return (
        type(value) is str
        and len(value) == 40
        and all(character in "0123456789abcdef" for character in value)
    )


def _preimport_repository_guard() -> None:
    """Prove the checkout before making its directory importable."""

    approved = os.environ.get("TOC_REVIEW_APPROVED_EXECUTION_CHECKOUT_SHA")
    if not _is_full_lowercase_git_sha(approved):
        raise _ReviewedGitFailure
    script = os.path.realpath(__file__)
    repository = os.path.dirname(os.path.dirname(os.path.dirname(script)))
    head = _reviewed_git_bytes(
        repository, ["rev-parse", "HEAD"], timeout_seconds=20
    ).strip()
    if head != approved.encode("ascii"):
        raise _ReviewedGitFailure
    if _reviewed_git_bytes(
        repository,
        ["status", "--porcelain=v1", "--untracked-files=all"],
        timeout_seconds=20,
    ):
        raise _ReviewedGitFailure
    for untracked_arguments in (
        [
            "ls-files",
            "--others",
            "--exclude-standard",
            "--",
            "scripts/migration",
        ],
        [
            "ls-files",
            "--others",
            "--ignored",
            "--exclude-standard",
            "--",
            "scripts/migration",
        ],
    ):
        if _reviewed_git_bytes(
            repository, untracked_arguments, timeout_seconds=20
        ):
            raise _ReviewedGitFailure

    migration_directory = os.path.dirname(script)
    shadow_paths = (
        os.path.join(migration_directory, "lib.py"),
        os.path.join(migration_directory, "lib", "__init__.py"),
        os.path.join(migration_directory, "argparse.py"),
    )
    for shadow_path in shadow_paths:
        try:
            os.lstat(shadow_path)
        except FileNotFoundError:
            continue
        except OSError as exc:
            raise _ReviewedGitFailure from exc
        raise _ReviewedGitFailure

    relative_paths = (
        "scripts/migration/capture-lovable-toc.py",
        "scripts/migration/lib/lovable_toc_contract.py",
        "scripts/migration/lib/lovable_dump_report.py",
    )
    for relative_path in relative_paths:
        blob = _reviewed_git_bytes(
            repository,
            ["rev-parse", f"HEAD:{relative_path}"],
            timeout_seconds=20,
        ).strip()
        working = _reviewed_git_bytes(
            repository,
            ["hash-object", "--", relative_path],
            timeout_seconds=20,
        ).strip()
        if (
            len(blob) != 40
            or any(byte not in b"0123456789abcdef" for byte in blob)
            or working != blob
        ):
            raise _ReviewedGitFailure


if not _runtime_isolation_enabled():
    _fail_unisolated_startup()

if __name__ == "__main__":
    try:
        _preimport_repository_guard()
    except BaseException:
        _fail_startup_binding()

import hashlib
import re
import subprocess
from pathlib import Path
from typing import Any, Mapping

# The pre-import guard requires the real ``-B`` flag, so this reviewed
# repository-local import cannot create an untracked bytecode artifact.

SCRIPT = Path(__file__).resolve(strict=True)
if str(SCRIPT.parent) not in sys.path:
    sys.path.insert(0, str(SCRIPT.parent))

from lib.lovable_toc_contract import (
    ContractError,
    VERSION_RE,
    build_capture_payloads,
    canonical_json_bytes,
    duplicate_private_root_fd,
    emit_fixed_diagnostic,
    fixed_diagnostic,
    fresh_opaque_key,
    publish_private_package,
    publish_private_package_at,
    sha256_bytes,
    stable_regular_digest,
    validate_git_sha,
    validate_private_root,
    validate_sha,
)


MAX_ARCHIVE_BYTES = 5_000_000_000
MAX_TOOL_BYTES = 100 * 1024 * 1024
SAFE_VALUE_RE = re.compile(r"^[A-Za-z0-9._:-]{1,160}$", re.ASCII)
POSITIVE_INTEGER_RE = re.compile(r"^[1-9][0-9]{0,9}$", re.ASCII)
UNDERLYING_ENVIRONMENT_VARIABLE = "LOVABLE_UNDERLYING_PG_RESTORE_BIN"
DESCRIPTOR_BOUND_WORKDIR_VARIABLE = "TOC_REVIEW_DESCRIPTOR_BOUND_WORKDIR_FD"
DESCRIPTOR_BOUND_ARCHIVE = "verified-inner.pgdmp"
DESCRIPTOR_BOUND_OUTPUT_ROOT = "."

REQUIRED_ENVIRONMENT = (
    "TOC_REVIEW_INNER_ARCHIVE",
    "TOC_REVIEW_OUTPUT_ROOT",
    "TOC_REVIEW_EVIDENCE_RUN_ID",
    "TOC_REVIEW_OUTER_SHA256",
    "TOC_REVIEW_INNER_SHA256",
    "TOC_REVIEW_EVIDENCE_MANIFEST_SHA256",
    "TOC_REVIEW_INSPECTION_CHECKOUT_SHA",
    "TOC_REVIEW_INSPECTION_PROCEDURE_SHA256",
    "TOC_REVIEW_APPROVED_EXECUTION_CHECKOUT_SHA",
    "TOC_REVIEW_EXECUTION_PYTHON",
    "TOC_REVIEW_APPROVED_EXECUTION_PYTHON_SHA256",
    "TOC_REVIEW_APPROVED_EXECUTION_PYTHON_VERSION",
    "TOC_REVIEW_PG_RESTORE_BIN",
    "TOC_REVIEW_APPROVED_PG_RESTORE_SHA256",
    "TOC_REVIEW_EXPECTED_ENTRY_COUNT",
    "TOC_REVIEW_EXPECTED_DATA_REFERENCE_COUNT",
)
EXECUTION_PYTHON_VERSION_RE = re.compile(
    r"cpython:(?:0|[1-9][0-9]{0,2})\."
    r"(?:0|[1-9][0-9]{0,2})\."
    r"(?:0|[1-9][0-9]{0,2})\Z",
    re.ASCII,
)


def _required_environment(environment: Mapping[str, str], name: str) -> str:
    value = environment.get(name)
    if (
        value is None
        or value == ""
        or value != value.strip()
        or "\x00" in value
        or any(ord(character) < 0x20 or ord(character) == 0x7F for character in value)
    ):
        raise ContractError("input_invalid")
    return value


def _run_git(repo: Path, arguments: list[str]) -> str:
    try:
        output = _reviewed_git_bytes(
            os.fspath(repo), arguments, timeout_seconds=15
        )
        return output.decode("ascii", errors="strict").strip()
    except (UnicodeDecodeError, _ReviewedGitFailure) as exc:
        raise ContractError("binding_mismatch")


def _git_blob(repo: Path, relative: str) -> str:
    value = _run_git(repo, ["rev-parse", f"HEAD:{relative}"])
    if re.fullmatch(r"[0-9a-f]{40}", value) is None:
        raise ContractError("binding_mismatch")
    return value


def _repository_binding(repo: Path, approved_checkout: str) -> dict[str, str]:
    head = _run_git(repo, ["rev-parse", "HEAD"])
    if head != approved_checkout:
        raise ContractError("binding_mismatch")
    if _run_git(repo, ["status", "--porcelain=v1"]) != "":
        raise ContractError("binding_mismatch")
    paths = (
        "scripts/migration/README.md",
        "scripts/migration/run-lovable-toc-capture.sh",
        "scripts/migration/capture-lovable-toc-envelope.py",
        "scripts/migration/capture-lovable-toc.py",
        "scripts/migration/normalize-lovable-export.py",
        "scripts/migration/bounded-pg-restore.py",
        "scripts/migration/inspect-lovable-export.py",
        "scripts/migration/lib/lovable_toc_contract.py",
        "scripts/migration/lib/lovable_dump_report.py",
    )
    result = {"execution_checkout_sha": head}
    for relative in paths:
        path = repo / relative
        if not path.is_file() or path.is_symlink():
            raise ContractError("binding_mismatch")
        file_sha = hashlib.sha256(path.read_bytes()).hexdigest()
        blob_sha = _git_blob(repo, relative)
        if _run_git(repo, ["hash-object", "--", relative]) != blob_sha:
            raise ContractError("binding_mismatch")
        key = relative.rsplit("/", 1)[-1].replace("-", "_").replace(".", "_")
        result[f"{key}_blob_sha"] = blob_sha
        result[f"{key}_sha256"] = file_sha
    return result


def _execution_python_identity(
    raw_path: str, approved_sha256: str, approved_version: str
):
    """Bind the explicit canonical interpreter to this isolated process."""

    execution_python = Path(raw_path)
    if (
        not execution_python.is_absolute()
        or raw_path != os.path.abspath(raw_path)
        or execution_python.is_symlink()
    ):
        raise ContractError("input_invalid")
    try:
        resolved = execution_python.resolve(strict=True)
        running = Path(sys.executable)
        running_resolved = running.resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise ContractError("input_invalid") from exc
    if (
        resolved != execution_python
        or not running.is_absolute()
        or running_resolved != resolved
    ):
        raise ContractError("binding_mismatch")
    try:
        identity = stable_regular_digest(
            resolved,
            max_bytes=MAX_TOOL_BYTES,
            require_executable=True,
        )
    except ContractError as exc:
        raise ContractError("input_invalid") from exc
    runtime_version = (
        f"{sys.implementation.name}:{sys.version_info.major}."
        f"{sys.version_info.minor}.{sys.version_info.micro}"
    )
    if (
        identity.sha256 != approved_sha256
        or runtime_version != approved_version
        or identity.owner_uid not in {0, os.geteuid()}
        or identity.mode & 0o7022
        or identity.mode & 0o100 == 0
    ):
        raise ContractError("binding_mismatch")
    return resolved, identity


def _execution_python_provenance(
    execution_python: Path,
    approved_sha256: str,
    approved_version: str,
    identity: Any,
) -> dict[str, Any]:
    return {
        "approved_identity": f"sha256:{approved_sha256}",
        "device": identity.device,
        "executable_path": str(execution_python),
        "gid": identity.owner_gid,
        "inode": identity.inode,
        "mode": format(identity.mode, "04o"),
        "reported_version": approved_version,
        "sha256": identity.sha256,
        "size_bytes": identity.size,
        "uid": identity.owner_uid,
    }


def _parse_count(environment: Mapping[str, str], name: str, *, allow_zero: bool) -> int:
    value = _required_environment(environment, name)
    if allow_zero and value == "0":
        return 0
    if POSITIVE_INTEGER_RE.fullmatch(value) is None:
        raise ContractError("input_invalid")
    parsed = int(value)
    if parsed > 1_000_000:
        raise ContractError("input_invalid")
    return parsed


def _descriptor_bound_workdir(
    environment: Mapping[str, str],
) -> int | None:
    """Validate the high-level driver's exact inherited-directory mode.

    Standalone callers retain the existing absolute-path contract.  This narrow
    internal mode accepts only fixed relative names and requires the process
    working directory to be the very same private directory as the inherited
    descriptor.  Publication still uses the descriptor, never the pathname.
    """

    raw = environment.get(DESCRIPTOR_BOUND_WORKDIR_VARIABLE)
    if raw is None:
        return None
    if re.fullmatch(r"[1-9][0-9]{0,8}", raw, re.ASCII) is None:
        raise ContractError("input_invalid")
    descriptor = int(raw)
    if descriptor <= 2:
        raise ContractError("input_invalid")
    validated = duplicate_private_root_fd(descriptor)
    try:
        current = os.stat(".", follow_symlinks=False)
        bound = os.fstat(validated)
        if (
            current.st_dev != bound.st_dev
            or current.st_ino != bound.st_ino
            or current.st_uid != bound.st_uid
            or current.st_mode != bound.st_mode
        ):
            raise ContractError("input_invalid")
    except OSError as exc:
        raise ContractError("input_invalid") from exc
    finally:
        os.close(validated)
    return descriptor


def _run_bounded(
    wrapper: Path,
    pg_restore: Path,
    arguments: list[str],
    execution_python: Path,
) -> bytes:
    environment = {
        "LANG": "C",
        "LC_ALL": "C",
        UNDERLYING_ENVIRONMENT_VARIABLE: str(pg_restore),
    }
    result = subprocess.run(
        [str(execution_python), "-I", "-S", "-B", str(wrapper), *arguments],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        env=environment,
        timeout=330,
    )
    if result.returncode != 0:
        raise ContractError("tool_failed")
    return result.stdout


def execute(environment: Mapping[str, str]) -> tuple[dict[str, int], dict[str, str]]:
    if not _runtime_isolation_enabled():
        raise ContractError("input_invalid")
    if set(name for name in REQUIRED_ENVIRONMENT if not environment.get(name)):
        raise ContractError("input_invalid")
    script = Path(__file__).resolve(strict=True)
    repo = script.parents[2]

    approved_execution_python_sha256 = validate_sha(
        _required_environment(
            environment, "TOC_REVIEW_APPROVED_EXECUTION_PYTHON_SHA256"
        )
    )
    approved_execution_python_version = _required_environment(
        environment, "TOC_REVIEW_APPROVED_EXECUTION_PYTHON_VERSION"
    )
    if (
        EXECUTION_PYTHON_VERSION_RE.fullmatch(approved_execution_python_version)
        is None
    ):
        raise ContractError("input_invalid")
    execution_python, execution_python_before = _execution_python_identity(
        _required_environment(environment, "TOC_REVIEW_EXECUTION_PYTHON"),
        approved_execution_python_sha256,
        approved_execution_python_version,
    )

    descriptor_bound_fd = _descriptor_bound_workdir(environment)

    approved_checkout = validate_git_sha(
        _required_environment(environment, "TOC_REVIEW_APPROVED_EXECUTION_CHECKOUT_SHA")
    )
    repository_identity = _repository_binding(repo, approved_checkout)

    run_id = _required_environment(environment, "TOC_REVIEW_EVIDENCE_RUN_ID")
    if SAFE_VALUE_RE.fullmatch(run_id) is None:
        raise ContractError("input_invalid")
    outer_sha = validate_sha(_required_environment(environment, "TOC_REVIEW_OUTER_SHA256"))
    expected_inner_sha = validate_sha(_required_environment(environment, "TOC_REVIEW_INNER_SHA256"))
    evidence_manifest_sha = validate_sha(
        _required_environment(environment, "TOC_REVIEW_EVIDENCE_MANIFEST_SHA256")
    )
    inspection_checkout = validate_git_sha(
        _required_environment(environment, "TOC_REVIEW_INSPECTION_CHECKOUT_SHA")
    )
    inspection_procedure_sha = validate_sha(
        _required_environment(environment, "TOC_REVIEW_INSPECTION_PROCEDURE_SHA256")
    )
    expected_entry_count = _parse_count(
        environment, "TOC_REVIEW_EXPECTED_ENTRY_COUNT", allow_zero=False
    )
    expected_data_count = _parse_count(
        environment, "TOC_REVIEW_EXPECTED_DATA_REFERENCE_COUNT", allow_zero=True
    )
    if expected_data_count > expected_entry_count:
        raise ContractError("input_invalid")

    resolved_repo = repo.resolve(strict=True)
    output_value = _required_environment(environment, "TOC_REVIEW_OUTPUT_ROOT")
    archive_value = _required_environment(environment, "TOC_REVIEW_INNER_ARCHIVE")
    if descriptor_bound_fd is None:
        output_root = Path(output_value)
        resolved_output_root = output_root.resolve(strict=True)
        if resolved_output_root == resolved_repo or resolved_repo in resolved_output_root.parents:
            raise ContractError("input_invalid")
        root_fd = validate_private_root(output_root)
        os.close(root_fd)
        archive = Path(archive_value)
        if not archive.is_absolute():
            raise ContractError("input_invalid")
    else:
        if (
            output_value != DESCRIPTOR_BOUND_OUTPUT_ROOT
            or archive_value != DESCRIPTOR_BOUND_ARCHIVE
        ):
            raise ContractError("input_invalid")
        output_root = Path(DESCRIPTOR_BOUND_OUTPUT_ROOT)
        archive = Path(DESCRIPTOR_BOUND_ARCHIVE)
    resolved_archive = archive.resolve(strict=True)
    if resolved_archive == resolved_repo or resolved_repo in resolved_archive.parents:
        raise ContractError("input_invalid")
    archive_before = stable_regular_digest(
        archive, max_bytes=MAX_ARCHIVE_BYTES, exact_mode=0o400
    )
    if archive_before.sha256 != expected_inner_sha:
        raise ContractError("binding_mismatch")

    pg_restore = Path(_required_environment(environment, "TOC_REVIEW_PG_RESTORE_BIN"))
    if not pg_restore.is_absolute():
        raise ContractError("input_invalid")
    expected_tool_sha = validate_sha(
        _required_environment(environment, "TOC_REVIEW_APPROVED_PG_RESTORE_SHA256")
    )
    tool_before = stable_regular_digest(
        pg_restore, max_bytes=MAX_TOOL_BYTES, require_executable=True
    )
    if tool_before.sha256 != expected_tool_sha:
        raise ContractError("tool_identity_mismatch")

    wrapper = repo / "scripts/migration/bounded-pg-restore.py"
    version_bytes = _run_bounded(
        wrapper, pg_restore, ["--version"], execution_python
    )
    try:
        version = version_bytes.decode("ascii", errors="strict").rstrip("\n")
    except UnicodeDecodeError as exc:
        raise ContractError("tool_failed") from exc
    if VERSION_RE.fullmatch(version) is None or "\n" in version or "\r" in version:
        raise ContractError("tool_failed")
    # The bounded wrapper's reviewed interface requires an absolute local path.
    # Descriptor-bound mode still publishes through the inherited directory FD;
    # both archive digests and the high-level driver detect path replacement.
    raw_toc = _run_bounded(
        wrapper,
        pg_restore,
        ["--list", str(resolved_archive)],
        execution_python,
    )

    tool_after = stable_regular_digest(
        pg_restore, max_bytes=MAX_TOOL_BYTES, require_executable=True
    )
    archive_after = stable_regular_digest(
        archive, max_bytes=MAX_ARCHIVE_BYTES, exact_mode=0o400
    )
    _, execution_python_after = _execution_python_identity(
        str(execution_python),
        approved_execution_python_sha256,
        approved_execution_python_version,
    )
    if execution_python_after != execution_python_before:
        raise ContractError("binding_mismatch")
    if tool_after != tool_before:
        raise ContractError("tool_identity_mismatch")
    if archive_after != archive_before:
        raise ContractError("input_mutated")
    if _repository_binding(repo, approved_checkout) != repository_identity:
        raise ContractError("binding_mismatch")

    pg_restore_identity = {
        "approved_identity": f"sha256:{expected_tool_sha}",
        "device": tool_before.device,
        "executable_path": str(pg_restore),
        "gid": tool_before.owner_gid,
        "inode": tool_before.inode,
        "mode": format(tool_before.mode, "04o"),
        "reported_version": version,
        "sha256": tool_before.sha256,
        "size_bytes": tool_before.size,
        "uid": tool_before.owner_uid,
    }
    execution_python_identity = _execution_python_provenance(
        execution_python,
        approved_execution_python_sha256,
        approved_execution_python_version,
        execution_python_before,
    )
    procedure_identity = {
        **repository_identity,
        "execution_python_approved_sha256": approved_execution_python_sha256,
        "execution_python_identity_sha256": sha256_bytes(
            canonical_json_bytes(execution_python_identity)
        ),
        "evidence_manifest_sha256": evidence_manifest_sha,
        "inspection_checkout_sha": inspection_checkout,
        "inspection_procedure_sha256": inspection_procedure_sha,
    }
    binding = {
        "evidence_manifest_sha256": evidence_manifest_sha,
        "evidence_run_id": run_id,
        "execution_checkout_sha": approved_checkout,
        "inner_archive_sha256": expected_inner_sha,
        "inspection_checkout_sha": inspection_checkout,
        "inspection_procedure_sha256": inspection_procedure_sha,
        "outer_archive_sha256": outer_sha,
        "procedure_identity_sha256": sha256_bytes(canonical_json_bytes(procedure_identity)),
    }
    files, entries, capture = build_capture_payloads(
        raw_toc=raw_toc,
        key=fresh_opaque_key(),
        binding=binding,
        execution_python_identity=execution_python_identity,
        pg_restore_identity=pg_restore_identity,
        procedure_identity=procedure_identity,
        expected_entry_count=expected_entry_count,
        expected_data_reference_count=expected_data_count,
    )
    raw_sha = capture["raw_toc_sha256"]
    # Evidence run IDs use UTC ``T``/``Z`` markers; private package names use
    # the contract's lowercase no-ambiguity filename grammar.
    final_name = f"toc-capture-{run_id.lower()}-{raw_sha[:12]}"
    if _repository_binding(repo, approved_checkout) != repository_identity:
        raise ContractError("binding_mismatch")
    if descriptor_bound_fd is None:
        publication = publish_private_package(
            output_root, final_name, files, kind="capture"
        )
    else:
        publication = publish_private_package_at(
            descriptor_bound_fd, final_name, files, kind="capture"
        )
    counts = {
        "data_reference_count": expected_data_count,
        "entry_count": len(entries),
    }
    hashes = {
        "capture_manifest_sha256": publication.manifest_sha256,
        "raw_toc_sha256": raw_sha,
    }
    return counts, hashes


def main() -> int:
    try:
        counts, hashes = execute(os.environ)
    except ContractError as exc:
        emit_fixed_diagnostic(
            sys.stderr,
            fixed_diagnostic(stage="capture", status="failed", reason=exc.code),
        )
        return 1
    except BaseException:
        emit_fixed_diagnostic(
            sys.stderr,
            fixed_diagnostic(
                stage="capture", status="failed", reason="internal_failure"
            ),
        )
        return 1
    emit_fixed_diagnostic(
        sys.stdout,
        fixed_diagnostic(
            stage="capture", status="complete", reason="ok", counts=counts, hashes=hashes
        ),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
