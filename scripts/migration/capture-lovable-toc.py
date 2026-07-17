#!/usr/bin/env python3
"""Capture a future pg_restore TOC into a private, cross-bound package.

This program has no restore mode.  Its only child invocations are the checked-in
bounded wrapper with ``--version`` and ``--list``.  Raw child output is held
privately and is never forwarded to the terminal.
"""

from __future__ import annotations

import hashlib
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Mapping

from lib.lovable_toc_contract import (
    ContractError,
    VERSION_RE,
    build_capture_payloads,
    canonical_json_bytes,
    fixed_diagnostic,
    fresh_opaque_key,
    publish_private_package,
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
    "TOC_REVIEW_PG_RESTORE_BIN",
    "TOC_REVIEW_APPROVED_PG_RESTORE_SHA256",
    "TOC_REVIEW_EXPECTED_ENTRY_COUNT",
    "TOC_REVIEW_EXPECTED_DATA_REFERENCE_COUNT",
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
    result = subprocess.run(
        ["git", *arguments],
        cwd=repo,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        timeout=15,
    )
    if result.returncode != 0:
        raise ContractError("binding_mismatch")
    return result.stdout.strip()


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
        "scripts/migration/capture-lovable-toc.py",
        "scripts/migration/bounded-pg-restore.py",
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


def _run_bounded(
    wrapper: Path,
    pg_restore: Path,
    arguments: list[str],
) -> bytes:
    environment = {
        "LANG": "C",
        "LC_ALL": "C",
        UNDERLYING_ENVIRONMENT_VARIABLE: str(pg_restore),
    }
    result = subprocess.run(
        [sys.executable, str(wrapper), *arguments],
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
    if set(name for name in REQUIRED_ENVIRONMENT if not environment.get(name)):
        raise ContractError("input_invalid")
    script = Path(__file__).resolve(strict=True)
    repo = script.parents[2]

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

    output_root = Path(_required_environment(environment, "TOC_REVIEW_OUTPUT_ROOT"))
    resolved_output_root = output_root.resolve(strict=True)
    resolved_repo = repo.resolve(strict=True)
    if resolved_output_root == resolved_repo or resolved_repo in resolved_output_root.parents:
        raise ContractError("input_invalid")
    root_fd = validate_private_root(output_root)
    os.close(root_fd)

    archive = Path(_required_environment(environment, "TOC_REVIEW_INNER_ARCHIVE"))
    if not archive.is_absolute():
        raise ContractError("input_invalid")
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
    version_bytes = _run_bounded(wrapper, pg_restore, ["--version"])
    try:
        version = version_bytes.decode("ascii", errors="strict").rstrip("\n")
    except UnicodeDecodeError as exc:
        raise ContractError("tool_failed") from exc
    if VERSION_RE.fullmatch(version) is None or "\n" in version or "\r" in version:
        raise ContractError("tool_failed")
    raw_toc = _run_bounded(wrapper, pg_restore, ["--list", str(archive)])

    tool_after = stable_regular_digest(
        pg_restore, max_bytes=MAX_TOOL_BYTES, require_executable=True
    )
    archive_after = stable_regular_digest(
        archive, max_bytes=MAX_ARCHIVE_BYTES, exact_mode=0o400
    )
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
    procedure_identity = {
        **repository_identity,
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
        pg_restore_identity=pg_restore_identity,
        procedure_identity=procedure_identity,
        expected_entry_count=expected_entry_count,
        expected_data_reference_count=expected_data_count,
    )
    raw_sha = capture["raw_toc_sha256"]
    final_name = f"toc-capture-{run_id}-{raw_sha[:12]}"
    if _repository_binding(repo, approved_checkout) != repository_identity:
        raise ContractError("binding_mismatch")
    publication = publish_private_package(
        output_root, final_name, files, kind="capture"
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
        sys.stderr.buffer.write(
            fixed_diagnostic(stage="capture", status="failed", reason=exc.code)
        )
        return 1
    except BaseException:
        sys.stderr.buffer.write(
            fixed_diagnostic(stage="capture", status="failed", reason="internal_failure")
        )
        return 1
    sys.stdout.buffer.write(
        fixed_diagnostic(
            stage="capture", status="complete", reason="ok", counts=counts, hashes=hashes
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
