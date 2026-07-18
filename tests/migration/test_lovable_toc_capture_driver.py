from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import os
import re
import shutil
import stat
import struct
import subprocess
import sys
import tempfile
import unittest
import zlib
from dataclasses import dataclass
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "scripts" / "migration"
DRIVER_PATH = MIGRATION / "capture-lovable-toc-envelope.py"
WORKFLOW_BEGIN = b"<!-- BEGIN LOVABLE EXPORT EVIDENCE WORKFLOW -->\n"
WORKFLOW_END = b"\n<!-- END LOVABLE EXPORT EVIDENCE WORKFLOW -->"


def load_script(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise AssertionError("synthetic test could not load reviewed tool")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


DRIVER = load_script("capture_lovable_toc_envelope", DRIVER_PATH)
CAPTURE = load_script("capture_lovable_toc_for_driver_test", MIGRATION / "capture-lovable-toc.py")
NORMALIZER = load_script(
    "normalize_lovable_export_for_driver_test",
    MIGRATION / "normalize-lovable-export.py",
)


LOCAL = struct.Struct("<4s5H3I2H")
CENTRAL = struct.Struct("<4s6H3I5H2I")
EOCD = struct.Struct("<4s4H2IH")


@dataclass(frozen=True)
class ZipFixture:
    name: bytes
    data: bytes
    method: int = 8


def strict_zip(fixture: ZipFixture) -> bytes:
    if fixture.method == 8:
        compressor = zlib.compressobj(level=6, wbits=-zlib.MAX_WBITS)
        compressed = compressor.compress(fixture.data) + compressor.flush()
        version_needed = 20
    else:
        compressed = fixture.data
        version_needed = 10
    crc = zlib.crc32(fixture.data) & 0xFFFFFFFF
    external_attributes = (stat.S_IFREG | 0o600) << 16
    local = LOCAL.pack(
        b"PK\x03\x04",
        version_needed,
        0,
        fixture.method,
        0,
        0,
        crc,
        len(compressed),
        len(fixture.data),
        len(fixture.name),
        0,
    ) + fixture.name + compressed
    central = CENTRAL.pack(
        b"PK\x01\x02",
        (3 << 8) | 20,
        version_needed,
        0,
        fixture.method,
        0,
        0,
        crc,
        len(compressed),
        len(fixture.data),
        len(fixture.name),
        0,
        0,
        0,
        0,
        external_attributes,
        0,
    ) + fixture.name
    eocd = EOCD.pack(
        b"PK\x05\x06", 0, 0, 1, 1, len(central), len(local), 0
    )
    return local + central + eocd


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def extract_inspection_workflow(readme: bytes) -> str:
    if readme.count(WORKFLOW_BEGIN) != 1 or readme.count(WORKFLOW_END) != 1:
        raise AssertionError("inspection workflow markers are not unique")
    start = readme.index(WORKFLOW_BEGIN) + len(WORKFLOW_BEGIN)
    end = readme.index(WORKFLOW_END, start)
    fenced = readme[start:end]
    if not fenced.startswith(b"```bash\n") or not fenced.endswith(b"\n```"):
        raise AssertionError("inspection workflow fence is malformed")
    return fenced[len(b"```bash\n") : -len(b"\n```")].decode("utf-8")


def fake_capture_repository_identity() -> dict[str, str]:
    result = {"execution_checkout_sha": "a" * 40}
    for name in (
        "README_md",
        "capture_lovable_toc_envelope_py",
        "capture_lovable_toc_py",
        "bounded_pg_restore_py",
        "inspect_lovable_export_py",
        "lovable_toc_contract_py",
        "lovable_dump_report_py",
        "normalize_lovable_export_py",
    ):
        result[f"{name}_blob_sha"] = "b" * 40
        result[f"{name}_sha256"] = "c" * 64
    return result


class TocCaptureDriverTest(unittest.TestCase):
    """Synthetic-only driver coverage; no retained artifact is ever referenced."""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(
            prefix="toc-envelope-driver.",
            dir=Path(tempfile.gettempdir()).resolve(),
        )
        self.base = Path(self.temporary.name).resolve()
        self.approved_run = self.base / "synthetic-run"
        self.staging_root = self.base / "private-staging"
        self.output_root = self.base / "durable-captures"
        for directory in (self.approved_run, self.staging_root, self.output_root):
            directory.mkdir(mode=0o700)

        self.row_sentinel = b"ROW_PAYLOAD_SENTINEL_MUST_NOT_ESCAPE"
        self.path_sentinel = b"/private/PATH_SENTINEL_MUST_NOT_ESCAPE"
        self.secret_sentinel = b"SECRET_SENTINEL_MUST_NOT_ESCAPE"
        self.object_sentinel = b"OBJECT_NAME_SENTINEL_MUST_NOT_ESCAPE"
        self.sql_sentinel = b"SELECT_SQL_SENTINEL_MUST_NOT_ESCAPE"
        self.toc_sentinel = b"999; 0 0 TABLE TOC_SENTINEL_MUST_NOT_ESCAPE owner"
        self.inner = b"PGDMP\x01\x0e\x00\x04\x08\x01" + self.row_sentinel
        self.member_name = "synthetic.backup"
        self.outer_name = "synthetic-export.zip"
        self.outer_bytes = strict_zip(
            ZipFixture(self.member_name.encode("ascii"), self.inner)
        )
        self.outer = self.base / self.outer_name
        self.outer.write_bytes(self.outer_bytes)
        self.outer.chmod(0o400)
        self.outer_before = self.outer.read_bytes()
        self.child_ledger = self.base / "pg-restore-ledger"
        self.tool = self.base / "pg_restore"
        self.tool.write_text(
            f"#!{sys.executable}\n"
            "import pathlib, sys\n"
            f"ledger = pathlib.Path({str(self.child_ledger)!r})\n"
            "with ledger.open('a', encoding='ascii') as handle:\n"
            "    handle.write(' '.join(sys.argv[1:]) + '\\n')\n"
            "if sys.argv[1:] == ['--version']:\n"
            "    print('pg_restore (PostgreSQL) 18.4')\n"
            "    raise SystemExit(0)\n"
            "if len(sys.argv) == 3 and sys.argv[1] == '--list':\n"
            "    print('; Dumped from database version: 17.6')\n"
            "    print('; Dumped by pg_dump version: 18.4')\n"
            "    for entry_id in range(1, 2355):\n"
            "        object_class = 'TABLE DATA' if entry_id <= 214 else 'TABLE'\n"
            f"        sentinel = {self.object_sentinel.decode('ascii')!r}\n"
            "        name = sentinel if entry_id == 1 else 'synthetic'\n"
            "        print(f'{entry_id}; 0 0 {object_class} {name} owner')\n"
            "    raise SystemExit(0)\n"
            "raise SystemExit(77)\n",
            encoding="ascii",
        )
        self.tool.chmod(0o500)

    def tearDown(self):
        self.temporary.cleanup()

    def environment(self) -> dict[str, str]:
        return {
            "TOC_REVIEW_CANONICAL_OUTER": str(self.outer),
            "TOC_REVIEW_APPROVED_EVIDENCE_RUN_DIRECTORY": str(self.approved_run),
            "TOC_REVIEW_PRIVATE_STAGING_ROOT": str(self.staging_root),
            "TOC_REVIEW_OUTPUT_ROOT": str(self.output_root),
            "TOC_REVIEW_EVIDENCE_RUN_ID": "synthetic-run",
            "TOC_REVIEW_EXPECTED_ORIGINAL_FILENAME": self.outer_name,
            "TOC_REVIEW_UI_EXPORT_OBJECT_NAME": self.member_name,
            "TOC_REVIEW_EXPECTED_OUTER_SIZE_BYTES": str(len(self.outer_bytes)),
            "TOC_REVIEW_OUTER_SHA256": sha256(self.outer_bytes),
            "TOC_REVIEW_INNER_SHA256": sha256(self.inner),
            "TOC_REVIEW_EVIDENCE_MANIFEST_SHA256": "b" * 64,
            "TOC_REVIEW_INSPECTION_CHECKOUT_SHA": "b" * 40,
            "TOC_REVIEW_INSPECTION_PROCEDURE_SHA256": "c" * 64,
            "TOC_REVIEW_APPROVED_EXECUTION_CHECKOUT_SHA": "a" * 40,
            "TOC_REVIEW_PG_RESTORE_BIN": str(self.tool),
            "TOC_REVIEW_APPROVED_PG_RESTORE_SHA256": sha256(
                self.tool.read_bytes()
            ),
            "TOC_REVIEW_APPROVED_PG_RESTORE_VERSION": "pg_restore (PostgreSQL) 18.4",
            "TOC_REVIEW_EXPECTED_ENTRY_COUNT": "2354",
            "TOC_REVIEW_EXPECTED_DATA_REFERENCE_COUNT": "214",
        }

    def build_real_completed_inspection_package(
        self,
    ) -> tuple[Path, Path, str, dict[str, object]]:
        """Run the checked-in inspection procedure over only the synthetic ZIP.

        The returned checkout is a private synthetic clone whose current commit
        contains the exact worktree scripts under test.  This lets the later
        driver subprocess exercise its real Git/procedure guards while local
        development changes in the parent checkout remain untouched.
        """

        checkout = self.base / "synthetic reviewed checkout"
        clone = subprocess.run(
            ["git", "clone", "--quiet", "--shared", str(ROOT), str(checkout)],
            check=False,
            capture_output=True,
            text=True,
        )
        if clone.returncode != 0:
            self.fail("synthetic checkout creation failed")
        reviewed_paths = (
            "scripts/migration/README.md",
            "scripts/migration/bounded-pg-restore.py",
            "scripts/migration/capture-lovable-toc-envelope.py",
            "scripts/migration/capture-lovable-toc.py",
            "scripts/migration/inspect-lovable-dump.sh",
            "scripts/migration/inspect-lovable-export.py",
            "scripts/migration/lib/lovable_dump_report.py",
            "scripts/migration/lib/lovable_toc_contract.py",
            "scripts/migration/normalize-lovable-export.py",
        )
        for relative in reviewed_paths:
            source = ROOT / relative
            destination = checkout / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)
        subprocess.run(
            ["git", "add", *reviewed_paths],
            cwd=checkout,
            check=True,
            capture_output=True,
            text=True,
        )
        subprocess.run(
            [
                "git",
                "-c",
                "user.name=Synthetic Migration Test",
                "-c",
                "user.email=migration-test@example.invalid",
                "commit",
                "--quiet",
                "--allow-empty",
                "-m",
                "synthetic reviewed capture checkout",
            ],
            cwd=checkout,
            check=True,
            capture_output=True,
            text=True,
        )
        approved_checkout = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=checkout,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()

        evidence_store = self.base / "synthetic encrypted evidence store"
        evidence_store.mkdir(mode=0o700)
        canonical = evidence_store / self.outer_name
        canonical.write_bytes(self.outer_bytes)
        canonical.chmod(0o400)
        aggregate_tool = self.base / "aggregate-pg-restore"
        aggregate_toc = (
            checkout
            / "scripts/migration/tests/fixtures/representative.toc"
        )
        aggregate_tool.write_text(
            f"#!{sys.executable}\n"
            "import pathlib, sys\n"
            f"toc = pathlib.Path({str(aggregate_toc)!r})\n"
            "if sys.argv[1:] == ['--version']:\n"
            "    print('pg_restore (PostgreSQL) 17.10')\n"
            "    raise SystemExit(0)\n"
            "if len(sys.argv) == 3 and sys.argv[1] == '--list':\n"
            "    sys.stdout.buffer.write(toc.read_bytes())\n"
            "    raise SystemExit(0)\n"
            "raise SystemExit(77)\n",
            encoding="ascii",
        )
        aggregate_tool.chmod(0o500)
        config = (checkout / "supabase/config.toml").read_text(encoding="utf-8")
        project_ids = re.findall(
            r'^project_id\s*=\s*"([a-z0-9]{20})"\s*$', config, re.MULTILINE
        )
        self.assertEqual(len(project_ids), 1)
        aggregate_environment = os.environ | {
            "SOURCE_PROJECT_NAME": "Synthetic Lovable rehearsal",
            "SOURCE_PROJECT_REF": project_ids[0],
            "UI_EXPORT_OBJECT_NAME": self.member_name,
            "OPERATOR_IDENTITY": "synthetic-test-operator",
            "EXPORT_EVIDENCE_PROFILE": "retained_rehearsal_missing_initiation",
            "CANONICAL_EXPORT": str(canonical),
            "APPROVED_EVIDENCE_STORE_ROOT": str(evidence_store),
            "APPROVED_EXECUTION_CHECKOUT_SHA": approved_checkout,
            "PG_RESTORE_BIN": str(aggregate_tool),
            "EXPECTED_OUTER_SHA256": sha256(self.outer_bytes),
            "EXPECTED_OUTER_SIZE_BYTES": str(len(self.outer_bytes)),
            "EXPECTED_ORIGINAL_FILENAME": self.outer_name,
            "EXPORT_INITIATED_BASIS": "not_observed",
            "EXPORT_INITIATED_REASON": "synthetic initiation was not observed",
            "EXPORT_COMPLETED_BASIS": "not_observed",
            "EXPORT_COMPLETED_REASON": "synthetic completion was not observed",
            "EXPORT_AVAILABLE_AT_UTC": "2030-01-02T03:04:05Z",
            "DOWNLOAD_COMPLETED_AT_UTC": "2030-01-02T03:05:06Z",
        }
        workflow_result = subprocess.run(
            ["bash"],
            cwd=checkout,
            env=aggregate_environment,
            input=extract_inspection_workflow(
                (checkout / "scripts/migration/README.md").read_bytes()
            ),
            check=False,
            capture_output=True,
            text=True,
            timeout=60,
        )
        if workflow_result.returncode != 0:
            self.fail("synthetic aggregate evidence workflow failed")
        durable_parent = evidence_store / "migration-inspection-evidence"
        packages = list(durable_parent.iterdir())
        self.assertEqual(len(packages), 1)
        evidence_run = packages[0]
        provenance = json.loads((evidence_run / "provenance.json").read_bytes())
        return checkout, canonical, approved_checkout, provenance

    def assert_canonical_unchanged(self) -> None:
        if self.outer.read_bytes() != self.outer_before:
            self.fail("canonical synthetic input changed")
        self.assertEqual(stat.S_IMODE(self.outer.stat().st_mode), 0o400)

    def assert_no_disposable_bytes(self) -> None:
        self.assertEqual(list(self.staging_root.iterdir()), [])
        for path in self.base.rglob("verified-inner.pgdmp"):
            self.fail(f"derived archive survived outside reviewed package: {path.name}")
        for path in self.base.rglob("normalization.json"):
            self.fail(f"normalization metadata survived outside reviewed package: {path.name}")

    @staticmethod
    def diagnostic_bytes(environment: dict[str, str]) -> tuple[int, bytes, bytes]:
        stdout = io.BytesIO()
        stderr = io.BytesIO()
        fake_stdout = type("CapturedStdout", (), {"buffer": stdout})()
        fake_stderr = type("CapturedStderr", (), {"buffer": stderr})()
        with mock.patch.dict(os.environ, environment, clear=True), mock.patch.object(
            sys, "stdout", fake_stdout
        ), mock.patch.object(sys, "stderr", fake_stderr):
            status = DRIVER.main()
        return status, stdout.getvalue(), stderr.getvalue()

    def assert_fixed_failure(self, output: bytes) -> dict[str, object]:
        for sentinel in (
            self.row_sentinel,
            self.path_sentinel,
            self.secret_sentinel,
            self.object_sentinel,
            self.sql_sentinel,
            self.toc_sentinel,
            self.outer_name.encode("ascii"),
            self.member_name.encode("ascii"),
        ):
            if sentinel in output:
                self.fail("private sentinel escaped the fixed diagnostic")
        self.assertLessEqual(len(output), 512)
        decoded = json.loads(output)
        self.assertEqual(decoded["diagnostic_version"], 1)
        self.assertEqual(decoded["status"], "failed")
        self.assertEqual(set(decoded), {"diagnostic_version", "reason", "stage", "status"})
        return decoded

    @staticmethod
    def replace_private_file_at(directory_fd: int, name: str, data: bytes) -> None:
        os.chmod(name, 0o600, dir_fd=directory_fd, follow_symlinks=False)
        flags = os.O_WRONLY | os.O_TRUNC | getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(name, flags, dir_fd=directory_fd)
        try:
            view = memoryview(data)
            while view:
                written = os.write(descriptor, view)
                if written <= 0:
                    raise AssertionError("synthetic private rewrite made no progress")
                view = view[written:]
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        os.chmod(name, 0o400, dir_fd=directory_fd, follow_symlinks=False)

    def coherently_rewrite_capture(
        self, directory_fd: int, mutate, *, manifest_extra=None
    ) -> dict[str, str]:
        package_names = [
            name for name in os.listdir(directory_fd) if name.startswith("toc-capture-")
        ]
        self.assertEqual(len(package_names), 1)
        package_fd = os.open(
            package_names[0],
            os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0),
            dir_fd=directory_fd,
        )
        try:
            capture_fd = os.open(
                "capture.json", os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0), dir_fd=package_fd
            )
            try:
                capture = json.loads(os.read(capture_fd, 16 * 1024 * 1024))
            finally:
                os.close(capture_fd)
            mutate(capture)
            capture_bytes = (
                json.dumps(capture, sort_keys=True, separators=(",", ":")) + "\n"
            ).encode("ascii")
            self.replace_private_file_at(package_fd, "capture.json", capture_bytes)

            manifest_files = []
            for name in sorted(
                (
                    "capture.json",
                    "opaque-id.key",
                    "opaque-index.json",
                    "raw-pg-restore-list.toc",
                )
            ):
                descriptor = os.open(
                    name, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0), dir_fd=package_fd
                )
                try:
                    digest = hashlib.sha256()
                    size = 0
                    while True:
                        chunk = os.read(descriptor, 1024 * 1024)
                        if not chunk:
                            break
                        digest.update(chunk)
                        size += len(chunk)
                finally:
                    os.close(descriptor)
                manifest_files.append(
                    {"name": name, "sha256": digest.hexdigest(), "size_bytes": size}
                )
            manifest = {
                "artifact_kind": "lovable_toc_capture_evidence",
                "files": manifest_files,
                "format_version": 1,
            }
            if manifest_extra is not None:
                manifest.update(manifest_extra)
            manifest_bytes = (
                json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n"
            ).encode("ascii")
            manifest_sha = sha256(manifest_bytes)
            self.replace_private_file_at(
                package_fd, "evidence-files.json", manifest_bytes
            )
            marker = {
                "artifact_kind": "lovable_toc_capture_complete",
                "evidence_files_sha256": manifest_sha,
                "format_version": 1,
            }
            self.replace_private_file_at(
                package_fd,
                "EVIDENCE_COMPLETE",
                (json.dumps(marker, sort_keys=True, separators=(",", ":")) + "\n").encode(
                    "ascii"
                ),
            )
            os.fsync(package_fd)
            return {
                "capture_manifest_sha256": manifest_sha,
                "raw_toc_sha256": str(capture["raw_toc_sha256"]),
            }
        finally:
            os.close(package_fd)

    def synthetic_capture_child(
        self, real_child, *, mutate=None, manifest_extra=None
    ):
        def run(arguments, *, environment, directory_fd, prefix, timeout_seconds):
            if prefix != "capture":
                return real_child(
                    arguments,
                    environment=environment,
                    directory_fd=directory_fd,
                    prefix=prefix,
                    timeout_seconds=timeout_seconds,
                )
            previous_directory_fd = os.open(
                ".",
                os.O_RDONLY
                | os.O_DIRECTORY
                | getattr(os, "O_CLOEXEC", 0),
            )
            try:
                os.fchdir(directory_fd)
                with mock.patch.object(
                    CAPTURE,
                    "_repository_binding",
                    return_value=fake_capture_repository_identity(),
                ):
                    counts, hashes = CAPTURE.execute(environment)
            finally:
                os.fchdir(previous_directory_fd)
                os.close(previous_directory_fd)
            if mutate is not None or manifest_extra is not None:
                hashes = self.coherently_rewrite_capture(
                    directory_fd,
                    mutate or (lambda _capture: None),
                    manifest_extra=manifest_extra,
                )
            stdout = CAPTURE.fixed_diagnostic(
                stage="capture",
                status="complete",
                reason="ok",
                counts=counts,
                hashes=hashes,
            )
            return DRIVER.ChildResult(returncode=0, stdout=stdout, stderr=b"")

        return run

    def test_synthetic_zip_to_private_capture_is_end_to_end_and_cleanup_complete(self):
        environment = self.environment()
        real_child = DRIVER._run_child
        binding = fake_capture_repository_identity()
        with mock.patch.object(
            DRIVER, "_repository_binding", return_value=binding
        ), mock.patch.object(
            DRIVER, "_validate_evidence_run", return_value=None
        ), mock.patch.object(
            DRIVER,
            "_run_child",
            side_effect=self.synthetic_capture_child(real_child),
        ):
            status, stdout, stderr = self.diagnostic_bytes(environment)

        if status != 2 or stderr:
            self.fail("synthetic success did not emit only the reviewed success channel")
        visible = json.loads(stdout)
        self.assertEqual(visible["status"], "review_required")
        self.assertEqual(visible["review_gate"], "REVIEW_REQUIRED")
        self.assertEqual(visible["annotation_gate"], "ANNOTATION_REQUIRED")
        self.assertEqual(visible["restore_planning_gate"], "BLOCKED")
        self.assertEqual(visible["restore_command_gate"], "BLOCKED")
        self.assertEqual(
            visible["counts"], {"data_reference_count": 214, "entry_count": 2354}
        )
        self.assertEqual(len(list(self.output_root.iterdir())), 1)
        package = next(self.output_root.iterdir())
        self.assertTrue(package.name.startswith("toc-capture-synthetic-run-"))
        self.assertEqual(stat.S_IMODE(package.stat().st_mode), 0o700)
        expected_files = {
            "EVIDENCE_COMPLETE",
            "capture.json",
            "evidence-files.json",
            "opaque-id.key",
            "opaque-index.json",
            "raw-pg-restore-list.toc",
        }
        self.assertEqual({path.name for path in package.iterdir()}, expected_files)
        for path in package.iterdir():
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o400)
        capture = json.loads((package / "capture.json").read_bytes())
        self.assertEqual(capture["capture_status"], "CAPTURE_COMPLETE")
        self.assertEqual(capture["overall_status"], "REVIEW_REQUIRED")
        self.assertEqual(capture["review_gate"], "ANNOTATION_REQUIRED")
        self.assertEqual(capture["restore_planning_gate"], "BLOCKED")
        self.assertEqual(capture["restore_command_gate"], "BLOCKED")
        retained = b"".join(path.read_bytes() for path in package.iterdir())
        for forbidden in (
            self.row_sentinel,
            self.secret_sentinel,
            self.path_sentinel,
        ):
            if forbidden in retained:
                self.fail("non-TOC private sentinel reached durable capture")
        if self.object_sentinel not in retained:
            self.fail("synthetic private raw TOC was not retained")
        if self.object_sentinel in stdout:
            self.fail("private raw TOC escaped into the success diagnostic")
        invocations = self.child_ledger.read_text(encoding="ascii").splitlines()
        self.assertEqual(invocations[0], "--version")
        self.assertEqual(invocations[1].split()[0], "--list")
        self.assertEqual(len(invocations), 2)
        self.assert_no_disposable_bytes()
        self.assert_canonical_unchanged()

    def test_checked_in_driver_subprocess_composes_real_inspection_normalizer_and_capture(self):
        checkout, canonical, approved_checkout, provenance = (
            self.build_real_completed_inspection_package()
        )
        evidence_run = (
            canonical.parent
            / "migration-inspection-evidence"
            / str(provenance["run_id"])
        )
        evidence_manifest_sha = sha256(
            (evidence_run / "evidence-files.json").read_bytes()
        )
        outer = provenance["outer_artifact"]["expected_identity"]
        inner = provenance["inner_pgdmp"]
        environment = os.environ | {
            "TOC_REVIEW_CANONICAL_OUTER": str(canonical),
            "TOC_REVIEW_APPROVED_EVIDENCE_RUN_DIRECTORY": str(evidence_run),
            "TOC_REVIEW_PRIVATE_STAGING_ROOT": str(self.staging_root),
            "TOC_REVIEW_OUTPUT_ROOT": str(self.output_root),
            "TOC_REVIEW_EVIDENCE_RUN_ID": str(provenance["run_id"]),
            "TOC_REVIEW_EXPECTED_ORIGINAL_FILENAME": str(
                outer["original_filename"]
            ),
            "TOC_REVIEW_UI_EXPORT_OBJECT_NAME": self.member_name,
            "TOC_REVIEW_EXPECTED_OUTER_SIZE_BYTES": str(outer["size_bytes"]),
            "TOC_REVIEW_OUTER_SHA256": str(outer["sha256"]),
            "TOC_REVIEW_INNER_SHA256": str(inner["sha256"]),
            "TOC_REVIEW_EVIDENCE_MANIFEST_SHA256": evidence_manifest_sha,
            "TOC_REVIEW_INSPECTION_CHECKOUT_SHA": str(
                provenance["execution_checkout_sha"]
            ),
            "TOC_REVIEW_INSPECTION_PROCEDURE_SHA256": str(
                provenance["procedure_workflow_sha256"]
            ),
            "TOC_REVIEW_APPROVED_EXECUTION_CHECKOUT_SHA": approved_checkout,
            "TOC_REVIEW_PG_RESTORE_BIN": str(self.tool),
            "TOC_REVIEW_APPROVED_PG_RESTORE_SHA256": sha256(
                self.tool.read_bytes()
            ),
            "TOC_REVIEW_APPROVED_PG_RESTORE_VERSION": "pg_restore (PostgreSQL) 18.4",
            "TOC_REVIEW_EXPECTED_ENTRY_COUNT": "2354",
            "TOC_REVIEW_EXPECTED_DATA_REFERENCE_COUNT": "214",
        }
        canonical_before = canonical.read_bytes()
        result = subprocess.run(
            [
                sys.executable,
                "-I",
                str(checkout / "scripts/migration/capture-lovable-toc-envelope.py"),
            ],
            cwd=checkout,
            env=environment,
            check=False,
            capture_output=True,
            timeout=90,
        )
        if result.returncode != 2 or result.stderr:
            safe_detail = "diagnostic_unavailable"
            candidate = result.stderr or result.stdout
            try:
                diagnostic = json.loads(candidate)
                if (
                    type(diagnostic) is dict
                    and set(diagnostic)
                    == {"diagnostic_version", "reason", "stage", "status"}
                    and diagnostic.get("diagnostic_version") == 1
                    and diagnostic.get("status") == "failed"
                    and diagnostic.get("stage") == "capture_driver"
                    and diagnostic.get("reason") in DRIVER.FAILURE_REASONS
                ):
                    safe_detail = f"capture_driver/{diagnostic['reason']}"
            except (UnicodeDecodeError, json.JSONDecodeError, TypeError):
                pass
            self.fail(
                "checked-in synthetic driver subprocess failed with "
                f"{safe_detail}"
            )
        visible = json.loads(result.stdout)
        self.assertEqual(visible["status"], "review_required")
        self.assertEqual(visible["review_gate"], "REVIEW_REQUIRED")
        self.assertEqual(visible["annotation_gate"], "ANNOTATION_REQUIRED")
        self.assertEqual(visible["restore_planning_gate"], "BLOCKED")
        self.assertEqual(visible["restore_command_gate"], "BLOCKED")
        self.assertNotIn(self.object_sentinel, result.stdout)
        self.assertEqual(canonical.read_bytes(), canonical_before)
        self.assertEqual(stat.S_IMODE(canonical.stat().st_mode), 0o400)
        packages = list(self.output_root.iterdir())
        self.assertEqual(len(packages), 1)
        capture = json.loads((packages[0] / "capture.json").read_bytes())
        self.assertEqual(capture["overall_status"], "REVIEW_REQUIRED")
        self.assertEqual(capture["review_gate"], "ANNOTATION_REQUIRED")
        self.assertEqual(capture["restore_planning_gate"], "BLOCKED")
        self.assertEqual(capture["restore_command_gate"], "BLOCKED")
        self.assert_no_disposable_bytes()

    def test_missing_binding_fails_before_children_or_publication(self):
        environment = self.environment()
        environment.pop("TOC_REVIEW_INNER_SHA256")
        with mock.patch.object(DRIVER, "_run_child") as child:
            status, stdout, stderr = self.diagnostic_bytes(environment)
        self.assertNotEqual(status, 0)
        child.assert_not_called()
        diagnostic = self.assert_fixed_failure(stderr or stdout)
        self.assertEqual(diagnostic["reason"], "input_invalid")
        self.assertEqual(list(self.output_root.iterdir()), [])
        self.assert_no_disposable_bytes()
        self.assert_canonical_unchanged()

    def test_symlink_permissive_and_overlapping_paths_fail_before_children(self):
        cases: list[tuple[str, callable]] = []

        symlink = self.base / "canonical-link.zip"
        symlink.symlink_to(self.outer)
        cases.append(
            (
                "symlink",
                lambda env: env.update(
                    {
                        "TOC_REVIEW_CANONICAL_OUTER": str(symlink),
                        "TOC_REVIEW_EXPECTED_ORIGINAL_FILENAME": symlink.name,
                    }
                ),
            )
        )
        staging_link = self.base / "staging-link"
        staging_link.symlink_to(self.staging_root, target_is_directory=True)
        cases.append(
            (
                "symlink-root",
                lambda env: env.update(
                    {"TOC_REVIEW_PRIVATE_STAGING_ROOT": str(staging_link)}
                ),
            )
        )
        ambiguous_root = self.base / "unused" / ".." / self.staging_root.name
        cases.append(
            (
                "ambiguous-parent-component",
                lambda env: env.update(
                    {"TOC_REVIEW_PRIVATE_STAGING_ROOT": str(ambiguous_root)}
                ),
            )
        )

        def permissive(env: dict[str, str]) -> None:
            self.staging_root.chmod(0o755)

        cases.append(("permissive", permissive))
        cases.append(
            (
                "overlap",
                lambda env: env.update(
                    {"TOC_REVIEW_OUTPUT_ROOT": str(self.staging_root)}
                ),
            )
        )

        for label, mutate in cases:
            with self.subTest(label=label):
                self.staging_root.chmod(0o700)
                environment = self.environment()
                mutate(environment)
                with mock.patch.object(
                    DRIVER, "_repository_binding", return_value={}
                ), mock.patch.object(
                    DRIVER, "_validate_evidence_run", return_value=None
                ), mock.patch.object(DRIVER, "_run_child") as child:
                    status, stdout, stderr = self.diagnostic_bytes(environment)
                self.assertNotEqual(status, 0)
                child.assert_not_called()
                self.assert_fixed_failure(stderr or stdout)
                self.assertEqual(list(self.output_root.iterdir()), [])
                self.assert_no_disposable_bytes()
                self.assert_canonical_unchanged()

    def test_canonical_filename_size_and_hash_are_externally_bound(self):
        mutations = (
            ("filename", "TOC_REVIEW_EXPECTED_ORIGINAL_FILENAME", "other.zip"),
            (
                "size",
                "TOC_REVIEW_EXPECTED_OUTER_SIZE_BYTES",
                str(len(self.outer_bytes) + 1),
            ),
            ("hash", "TOC_REVIEW_OUTER_SHA256", "f" * 64),
        )
        for label, key, value in mutations:
            with self.subTest(label=label):
                environment = self.environment()
                environment[key] = value
                with mock.patch.object(
                    DRIVER, "_repository_binding", return_value={}
                ), mock.patch.object(
                    DRIVER, "_validate_evidence_run", return_value=None
                ), mock.patch.object(DRIVER, "_run_child") as child:
                    status, stdout, stderr = self.diagnostic_bytes(environment)
                self.assertNotEqual(status, 0)
                child.assert_not_called()
                self.assert_fixed_failure(stderr or stdout)
                self.assertEqual(list(self.output_root.iterdir()), [])
                self.assert_no_disposable_bytes()
                self.assert_canonical_unchanged()

    def test_relative_root_and_wrong_tool_identity_fail_before_children(self):
        cases = (
            ("relative-root", "TOC_REVIEW_PRIVATE_STAGING_ROOT", "relative/staging"),
            ("wrong-tool", "TOC_REVIEW_APPROVED_PG_RESTORE_SHA256", "f" * 64),
            (
                "malformed-tool-version",
                "TOC_REVIEW_APPROVED_PG_RESTORE_VERSION",
                "PostgreSQL 18.4\nunsafe",
            ),
        )
        for label, key, value in cases:
            with self.subTest(label=label):
                environment = self.environment()
                environment[key] = value
                with mock.patch.object(
                    DRIVER, "_repository_binding", return_value={}
                ), mock.patch.object(
                    DRIVER, "_validate_evidence_run", return_value=None
                ), mock.patch.object(DRIVER, "_run_child") as child:
                    status, stdout, stderr = self.diagnostic_bytes(environment)
                child.assert_not_called()
                self.assert_fixed_failure(stderr or stdout)
                self.assertEqual(list(self.output_root.iterdir()), [])
                self.assert_no_disposable_bytes()
                self.assert_canonical_unchanged()

    def test_reported_tool_version_must_match_external_approval(self):
        environment = self.environment()
        environment["TOC_REVIEW_APPROVED_PG_RESTORE_VERSION"] = (
            "pg_restore (PostgreSQL) 18.5"
        )
        real_child = DRIVER._run_child
        with mock.patch.object(
            DRIVER, "_repository_binding", return_value=fake_capture_repository_identity()
        ), mock.patch.object(
            DRIVER, "_validate_evidence_run", return_value=None
        ), mock.patch.object(
            DRIVER,
            "_run_child",
            side_effect=self.synthetic_capture_child(real_child),
        ):
            status, stdout, stderr = self.diagnostic_bytes(environment)
        self.assertEqual(status, 1)
        diagnostic = self.assert_fixed_failure(stderr or stdout)
        self.assertEqual(diagnostic["reason"], "binding_mismatch")
        self.assertEqual(list(self.output_root.iterdir()), [])
        self.assert_no_disposable_bytes()
        self.assert_canonical_unchanged()

    def test_approved_evidence_binding_is_checked_before_artifact_hashing(self):
        with mock.patch.object(
            DRIVER, "_repository_binding", return_value={}
        ), mock.patch.object(
            DRIVER,
            "_validate_evidence_run",
            side_effect=DRIVER.DriverError("evidence_invalid"),
        ) as evidence_check, mock.patch.object(
            DRIVER, "_canonical_identity"
        ) as canonical_check, mock.patch.object(DRIVER, "_run_child") as child:
            status, stdout, stderr = self.diagnostic_bytes(self.environment())
        evidence_check.assert_called_once()
        canonical_check.assert_not_called()
        child.assert_not_called()
        diagnostic = self.assert_fixed_failure(stderr or stdout)
        self.assertEqual(diagnostic["reason"], "evidence_invalid")
        self.assertEqual(list(self.output_root.iterdir()), [])
        self.assert_no_disposable_bytes()
        self.assert_canonical_unchanged()

    def test_approved_evidence_runtime_bindings_are_exact(self):
        inputs = DRIVER._parse_inputs(self.environment())
        provenance = {
            "run_id": "synthetic-run",
            "inspection_status": "REVIEW_REQUIRED",
            "restore_planning_gate": "BLOCKED",
            "execution_checkout_sha": "b" * 40,
            "inspection_tool_git_sha": "b" * 40,
            "procedure_workflow_sha256": "c" * 64,
            "outer_artifact": {
                "expected_identity": {
                    "original_filename": self.outer_name,
                    "size_bytes": len(self.outer_bytes),
                    "sha256": sha256(self.outer_bytes),
                },
                "workflow_observed_identity": {
                    "size_bytes_before": len(self.outer_bytes),
                    "size_bytes_after": len(self.outer_bytes),
                    "sha256_before": sha256(self.outer_bytes),
                    "sha256_after": sha256(self.outer_bytes),
                },
                "ui_observed_export_object_name": self.member_name,
            },
            "ui_member_binding": {"ui_observed_name": self.member_name},
            "inner_pgdmp": {
                "sha256": sha256(self.inner),
                "inspector_reported_sha256": sha256(self.inner),
                "retained_in_evidence": False,
            },
        }

        class SyntheticValidator:
            @staticmethod
            def validate_evidence_tree_at(*_args, **_kwargs):
                return {"evidence-files.json": {"sha256": "b" * 64}}

            @staticmethod
            def read_private_file_at(*_args, **_kwargs):
                return b"{}\n"

            @staticmethod
            def load_evidence_contract_json(*_args, **_kwargs):
                return provenance

            @staticmethod
            def validate_provenance_schema(value):
                return value

        with mock.patch.object(
            DRIVER, "_load_module", return_value=SyntheticValidator
        ):
            DRIVER._validate_evidence_run(inputs)
            changed = dict(self.environment())
            changed["TOC_REVIEW_EVIDENCE_MANIFEST_SHA256"] = "f" * 64
            with self.assertRaisesRegex(DRIVER.DriverError, "binding_mismatch"):
                DRIVER._validate_evidence_run(DRIVER._parse_inputs(changed))

    def test_fully_rehashed_coherent_runtime_identity_substitutions_are_rejected(self):
        def outer_substitution(capture: dict[str, object]) -> None:
            capture["binding"]["outer_archive_sha256"] = "f" * 64

        def checkout_substitution(capture: dict[str, object]) -> None:
            capture["binding"]["execution_checkout_sha"] = "f" * 40
            capture["procedure_identity"]["execution_checkout_sha"] = "f" * 40
            capture["binding"]["procedure_identity_sha256"] = sha256(
                (
                    json.dumps(
                        capture["procedure_identity"],
                        sort_keys=True,
                        separators=(",", ":"),
                    )
                    + "\n"
                ).encode("ascii")
            )

        def tool_substitution(capture: dict[str, object]) -> None:
            capture["pg_restore_identity"]["device"] += 1

        for label, mutate in (
            ("outer", outer_substitution),
            ("checkout-and-procedure", checkout_substitution),
            ("tool-device", tool_substitution),
        ):
            with self.subTest(label=label):
                real_child = DRIVER._run_child
                with mock.patch.object(
                    DRIVER,
                    "_repository_binding",
                    return_value=fake_capture_repository_identity(),
                ), mock.patch.object(
                    DRIVER, "_validate_evidence_run", return_value=None
                ), mock.patch.object(
                    DRIVER,
                    "_run_child",
                    side_effect=self.synthetic_capture_child(
                        real_child, mutate=mutate
                    ),
                ):
                    status, stdout, stderr = self.diagnostic_bytes(self.environment())
                self.assertEqual(status, 1)
                diagnostic = self.assert_fixed_failure(stderr or stdout)
                self.assertEqual(diagnostic["reason"], "binding_mismatch")
                self.assertEqual(list(self.output_root.iterdir()), [])
                self.assert_no_disposable_bytes()
                self.assert_canonical_unchanged()

    def test_fully_rehashed_manifest_readiness_field_is_rejected(self):
        real_child = DRIVER._run_child
        with mock.patch.object(
            DRIVER, "_repository_binding", return_value=fake_capture_repository_identity()
        ), mock.patch.object(
            DRIVER, "_validate_evidence_run", return_value=None
        ), mock.patch.object(
            DRIVER,
            "_run_child",
            side_effect=self.synthetic_capture_child(
                real_child,
                manifest_extra={"restore_planning_gate": "READY"},
            ),
        ):
            status, stdout, stderr = self.diagnostic_bytes(self.environment())
        self.assertEqual(status, 1)
        diagnostic = self.assert_fixed_failure(stderr or stdout)
        self.assertEqual(diagnostic["reason"], "publication_failed")
        self.assertEqual(list(self.output_root.iterdir()), [])
        self.assert_no_disposable_bytes()
        self.assert_canonical_unchanged()

    def test_in_worktree_root_is_rejected_before_children(self):
        with tempfile.TemporaryDirectory(
            dir=ROOT, prefix="synthetic-private-root."
        ) as raw_root:
            in_worktree = Path(raw_root)
            in_worktree.chmod(0o700)
            environment = self.environment()
            environment["TOC_REVIEW_PRIVATE_STAGING_ROOT"] = str(in_worktree)
            with mock.patch.object(
                DRIVER, "_repository_binding", return_value={}
            ), mock.patch.object(DRIVER, "_run_child") as child:
                status, stdout, stderr = self.diagnostic_bytes(environment)
            child.assert_not_called()
            diagnostic = self.assert_fixed_failure(stderr or stdout)
            self.assertEqual(diagnostic["reason"], "input_invalid")
            self.assertEqual(list(self.output_root.iterdir()), [])
            self.assert_canonical_unchanged()

    def test_canonical_hardlink_and_permissive_mode_are_rejected(self):
        hardlink = self.base / "synthetic-hardlink.zip"
        os.link(self.outer, hardlink)
        hardlink.chmod(0o400)
        hardlink_environment = self.environment()
        hardlink_environment.update(
            {
                "TOC_REVIEW_CANONICAL_OUTER": str(hardlink),
                "TOC_REVIEW_EXPECTED_ORIGINAL_FILENAME": hardlink.name,
            }
        )
        try:
            cases = (("hardlink", hardlink_environment),)
            for label, environment in cases:
                with self.subTest(label=label), mock.patch.object(
                    DRIVER, "_repository_binding", return_value={}
                ), mock.patch.object(
                    DRIVER, "_validate_evidence_run", return_value=None
                ), mock.patch.object(DRIVER, "_run_child") as child:
                    status, stdout, stderr = self.diagnostic_bytes(environment)
                child.assert_not_called()
                self.assert_fixed_failure(stderr or stdout)
                self.assertEqual(list(self.output_root.iterdir()), [])

            hardlink.unlink()
            self.outer.chmod(0o640)
            with mock.patch.object(
                DRIVER, "_repository_binding", return_value={}
            ), mock.patch.object(
                DRIVER, "_validate_evidence_run", return_value=None
            ), mock.patch.object(DRIVER, "_run_child") as child:
                status, stdout, stderr = self.diagnostic_bytes(self.environment())
            child.assert_not_called()
            self.assert_fixed_failure(stderr or stdout)
            self.assertEqual(list(self.output_root.iterdir()), [])
        finally:
            if hardlink.exists():
                hardlink.unlink()
            self.outer.chmod(0o400)
        self.assert_canonical_unchanged()

    def test_preexisting_output_collision_fails_without_replacement(self):
        collision = self.output_root / "toc-capture-synthetic-run-collision"
        collision.mkdir(mode=0o700)
        marker = collision / "existing"
        marker.write_bytes(b"must remain")
        marker.chmod(0o400)
        environment = self.environment()
        with mock.patch.object(DRIVER, "_repository_binding", return_value={}), mock.patch.object(
            DRIVER, "_validate_evidence_run", return_value=None
        ), mock.patch.object(DRIVER, "_run_child") as child:
            status, stdout, stderr = self.diagnostic_bytes(environment)
        self.assertNotEqual(status, 0)
        child.assert_not_called()
        self.assert_fixed_failure(stderr or stdout)
        self.assertEqual(marker.read_bytes(), b"must remain")
        self.assert_no_disposable_bytes()
        self.assert_canonical_unchanged()

    def test_preexisting_staging_content_fails_without_touching_it(self):
        marker = self.staging_root / "existing-private-state"
        marker.write_bytes(b"must remain")
        marker.chmod(0o400)
        with mock.patch.object(
            DRIVER, "_repository_binding", return_value={}
        ), mock.patch.object(DRIVER, "_run_child") as child:
            status, stdout, stderr = self.diagnostic_bytes(self.environment())
        child.assert_not_called()
        diagnostic = self.assert_fixed_failure(stderr or stdout)
        self.assertEqual(diagnostic["reason"], "publication_exists")
        self.assertEqual(marker.read_bytes(), b"must remain")
        self.assertEqual(list(self.output_root.iterdir()), [])
        self.assert_canonical_unchanged()

    def test_normalization_failures_are_fixed_nonleaking_and_fully_cleaned(self):
        poison = b" ".join(
            (
                self.row_sentinel,
                self.secret_sentinel,
                self.path_sentinel,
                self.object_sentinel,
                self.sql_sentinel,
                self.toc_sentinel,
            )
        )
        cases = (
            (
                "nonzero",
                lambda *_args, **_kwargs: DRIVER.ChildResult(9, poison, poison),
                "normalization_failed",
            ),
            (
                "timeout",
                lambda *_args, **_kwargs: (_ for _ in ()).throw(TimeoutError()),
                "normalization_timeout",
            ),
            (
                "unexpected-output",
                lambda *_args, **_kwargs: DRIVER.ChildResult(0, poison, b""),
                "normalization_output_invalid",
            ),
        )
        for label, child_result, expected_reason in cases:
            with self.subTest(label=label), mock.patch.object(
                DRIVER, "_repository_binding", return_value={}
            ), mock.patch.object(
                DRIVER, "_validate_evidence_run", return_value=None
            ), mock.patch.object(DRIVER, "_run_child", side_effect=child_result):
                status, stdout, stderr = self.diagnostic_bytes(self.environment())
            self.assertEqual(status, 1)
            diagnostic = self.assert_fixed_failure(stderr or stdout)
            self.assertEqual(diagnostic["reason"], expected_reason)
            self.assertEqual(list(self.output_root.iterdir()), [])
            self.assert_no_disposable_bytes()
            self.assert_canonical_unchanged()

    def test_child_output_cap_is_streaming_and_never_creates_output_sidecars(self):
        child = self.base / "synthetic-noisy-child.py"
        child.write_text(
            "import os, sys, time\n"
            f"payload = {self.secret_sentinel!r} + b'x' * 70000\n"
            "os.write(sys.stdout.fileno(), payload)\n"
            "time.sleep(30)\n",
            encoding="ascii",
        )
        directory_fd = os.open(self.staging_root, os.O_RDONLY)
        try:
            with self.assertRaises(DRIVER.ChildOutputLimit):
                DRIVER._run_child(
                    [sys.executable, "-I", str(child)],
                    environment={},
                    directory_fd=directory_fd,
                    prefix="normalizer",
                    timeout_seconds=5,
                )
        finally:
            os.close(directory_fd)
        self.assertEqual(list(self.staging_root.iterdir()), [])
        self.assertEqual(list(self.output_root.iterdir()), [])
        self.assert_canonical_unchanged()

    def test_child_timeout_kills_and_reaps_without_output_sidecars(self):
        child = self.base / "synthetic-sleeping-child.py"
        child.write_text(
            "import time\ntime.sleep(30)\n",
            encoding="ascii",
        )
        directory_fd = os.open(self.staging_root, os.O_RDONLY)
        try:
            with self.assertRaises(TimeoutError):
                DRIVER._run_child(
                    [sys.executable, "-I", str(child)],
                    environment={},
                    directory_fd=directory_fd,
                    prefix="capture",
                    timeout_seconds=1,
                )
        finally:
            os.close(directory_fd)
        self.assertEqual(list(self.staging_root.iterdir()), [])
        self.assertEqual(list(self.output_root.iterdir()), [])
        self.assert_canonical_unchanged()

    def test_normalized_inner_hash_mismatch_never_reaches_capture(self):
        environment = self.environment()
        environment["TOC_REVIEW_INNER_SHA256"] = "f" * 64
        real_child = DRIVER._run_child
        prefixes: list[str] = []

        def run(arguments, *, environment, directory_fd, prefix, timeout_seconds):
            prefixes.append(prefix)
            return real_child(
                arguments,
                environment=environment,
                directory_fd=directory_fd,
                prefix=prefix,
                timeout_seconds=timeout_seconds,
            )

        with mock.patch.object(
            DRIVER, "_repository_binding", return_value={}
        ), mock.patch.object(
            DRIVER, "_validate_evidence_run", return_value=None
        ), mock.patch.object(DRIVER, "_run_child", side_effect=run):
            status, stdout, stderr = self.diagnostic_bytes(environment)
        self.assertEqual(prefixes, ["normalizer"])
        diagnostic = self.assert_fixed_failure(stderr or stdout)
        self.assertEqual(diagnostic["reason"], "inner_identity_mismatch")
        self.assertFalse(self.child_ledger.exists())
        self.assertEqual(list(self.output_root.iterdir()), [])
        self.assert_no_disposable_bytes()
        self.assert_canonical_unchanged()

    def test_partial_normalizer_output_is_removed_on_child_failure(self):
        def run(arguments, *, environment, directory_fd, prefix, timeout_seconds):
            self.assertEqual(prefix, "normalizer")
            output = arguments[arguments.index("--output") + 1]
            descriptor = os.open(
                output,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
                0o400,
                dir_fd=directory_fd,
            )
            try:
                os.write(descriptor, b"PGDMP" + self.row_sentinel)
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
            return DRIVER.ChildResult(4, b"", self.secret_sentinel)

        with mock.patch.object(
            DRIVER, "_repository_binding", return_value={}
        ), mock.patch.object(
            DRIVER, "_validate_evidence_run", return_value=None
        ), mock.patch.object(DRIVER, "_run_child", side_effect=run):
            status, stdout, stderr = self.diagnostic_bytes(self.environment())
        diagnostic = self.assert_fixed_failure(stderr or stdout)
        self.assertEqual(diagnostic["reason"], "normalization_failed")
        self.assertEqual(list(self.output_root.iterdir()), [])
        self.assert_no_disposable_bytes()
        self.assert_canonical_unchanged()

    def test_capture_failure_timeout_and_poisoned_output_never_publish(self):
        poison = b" ".join(
            (
                self.row_sentinel,
                self.secret_sentinel,
                self.path_sentinel,
                self.object_sentinel,
                self.sql_sentinel,
                self.toc_sentinel,
            )
        )
        cases = (
            (
                "nonzero",
                lambda: DRIVER.ChildResult(7, poison, poison),
                "capture_failed",
            ),
            (
                "timeout",
                lambda: (_ for _ in ()).throw(TimeoutError()),
                "capture_timeout",
            ),
            (
                "malformed-success",
                lambda: DRIVER.ChildResult(0, poison + b"\n", b""),
                "capture_output_invalid",
            ),
        )
        for label, capture_result, expected_reason in cases:
            with self.subTest(label=label):
                real_child = DRIVER._run_child
                prefixes: list[str] = []

                def run(
                    arguments,
                    *,
                    environment,
                    directory_fd,
                    prefix,
                    timeout_seconds,
                ):
                    prefixes.append(prefix)
                    if prefix == "capture":
                        return capture_result()
                    return real_child(
                        arguments,
                        environment=environment,
                        directory_fd=directory_fd,
                        prefix=prefix,
                        timeout_seconds=timeout_seconds,
                    )

                with mock.patch.object(
                    DRIVER, "_repository_binding", return_value={}
                ), mock.patch.object(
                    DRIVER, "_validate_evidence_run", return_value=None
                ), mock.patch.object(DRIVER, "_run_child", side_effect=run):
                    status, stdout, stderr = self.diagnostic_bytes(self.environment())
                self.assertEqual(prefixes, ["normalizer", "capture"])
                diagnostic = self.assert_fixed_failure(stderr or stdout)
                self.assertEqual(diagnostic["reason"], expected_reason)
                self.assertEqual(list(self.output_root.iterdir()), [])
                self.assert_no_disposable_bytes()
                self.assert_canonical_unchanged()

    def test_partial_capture_output_is_removed_on_child_failure(self):
        real_child = DRIVER._run_child

        def run(arguments, *, environment, directory_fd, prefix, timeout_seconds):
            if prefix == "normalizer":
                return real_child(
                    arguments,
                    environment=environment,
                    directory_fd=directory_fd,
                    prefix=prefix,
                    timeout_seconds=timeout_seconds,
                )
            self.assertEqual(environment["TOC_REVIEW_OUTPUT_ROOT"], ".")
            os.mkdir("partial-capture", 0o700, dir_fd=directory_fd)
            partial_fd = os.open(
                "partial-capture",
                os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0),
                dir_fd=directory_fd,
            )
            try:
                descriptor = os.open(
                    "raw-pg-restore-list.toc",
                    os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                    0o400,
                    dir_fd=partial_fd,
                )
                try:
                    os.write(descriptor, self.toc_sentinel)
                    os.fsync(descriptor)
                finally:
                    os.close(descriptor)
            finally:
                os.close(partial_fd)
            return DRIVER.ChildResult(8, self.row_sentinel, self.secret_sentinel)

        with mock.patch.object(
            DRIVER, "_repository_binding", return_value={}
        ), mock.patch.object(
            DRIVER, "_validate_evidence_run", return_value=None
        ), mock.patch.object(DRIVER, "_run_child", side_effect=run):
            status, stdout, stderr = self.diagnostic_bytes(self.environment())
        diagnostic = self.assert_fixed_failure(stderr or stdout)
        self.assertEqual(diagnostic["reason"], "capture_failed")
        self.assertEqual(list(self.output_root.iterdir()), [])
        self.assert_no_disposable_bytes()
        self.assert_canonical_unchanged()

    def test_ui_member_mismatch_fails_after_normalization_and_before_capture(self):
        environment = self.environment()
        environment["TOC_REVIEW_UI_EXPORT_OBJECT_NAME"] = "other.backup"
        prefixes: list[str] = []
        real_child = DRIVER._run_child

        def run(arguments, *, environment, directory_fd, prefix, timeout_seconds):
            prefixes.append(prefix)
            return real_child(
                arguments,
                environment=environment,
                directory_fd=directory_fd,
                prefix=prefix,
                timeout_seconds=timeout_seconds,
            )

        with mock.patch.object(
            DRIVER, "_repository_binding", return_value={}
        ), mock.patch.object(
            DRIVER, "_validate_evidence_run", return_value=None
        ), mock.patch.object(DRIVER, "_run_child", side_effect=run):
            status, stdout, stderr = self.diagnostic_bytes(environment)
        self.assertEqual(prefixes, ["normalizer"])
        diagnostic = self.assert_fixed_failure(stderr or stdout)
        self.assertEqual(diagnostic["reason"], "inner_identity_mismatch")
        self.assert_no_disposable_bytes()
        self.assertEqual(list(self.output_root.iterdir()), [])
        self.assert_canonical_unchanged()

    def test_wrong_owner_simulation_fails_before_child_execution(self):
        with mock.patch.object(
            DRIVER, "_repository_binding", return_value={}
        ), mock.patch.object(
            DRIVER.os, "geteuid", return_value=os.geteuid() + 1
        ), mock.patch.object(DRIVER, "_run_child") as child:
            status, stdout, stderr = self.diagnostic_bytes(self.environment())
        child.assert_not_called()
        diagnostic = self.assert_fixed_failure(stderr or stdout)
        self.assertEqual(diagnostic["reason"], "input_invalid")
        self.assertEqual(list(self.output_root.iterdir()), [])
        self.assert_no_disposable_bytes()
        self.assert_canonical_unchanged()

    def test_insufficient_disk_from_strict_normalizer_cleans_partial_state(self):
        def run(arguments, *, environment, directory_fd, prefix, timeout_seconds):
            self.assertEqual(prefix, "normalizer")
            output = Path(arguments[arguments.index("--output") + 1])
            metadata = Path(arguments[arguments.index("--metadata-output") + 1])
            source = Path(arguments[-1])
            previous_directory_fd = os.open(
                ".", os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_CLOEXEC", 0)
            )
            try:
                os.fchdir(directory_fd)
                try:
                    NORMALIZER.normalize(
                        source,
                        expected_outer_sha256=self.environment()[
                            "TOC_REVIEW_OUTER_SHA256"
                        ],
                        output=output,
                        metadata_output=metadata,
                        disk_free=lambda _descriptor: 0,
                    )
                finally:
                    os.fchdir(previous_directory_fd)
                    os.close(previous_directory_fd)
            except NORMALIZER.NormalizationError:
                return DRIVER.ChildResult(4, b"", self.path_sentinel)
            self.fail("zero disk headroom was unexpectedly accepted")

        with mock.patch.object(
            DRIVER, "_repository_binding", return_value={}
        ), mock.patch.object(
            DRIVER, "_validate_evidence_run", return_value=None
        ), mock.patch.object(DRIVER, "_run_child", side_effect=run):
            status, stdout, stderr = self.diagnostic_bytes(self.environment())
        diagnostic = self.assert_fixed_failure(stderr or stdout)
        self.assertEqual(diagnostic["reason"], "normalization_failed")
        self.assertEqual(list(self.output_root.iterdir()), [])
        self.assert_no_disposable_bytes()
        self.assert_canonical_unchanged()

    def test_insufficient_durable_output_headroom_fails_before_children(self):
        filesystem = mock.Mock(f_bavail=0, f_frsize=4096)
        with mock.patch.object(
            DRIVER, "_repository_binding", return_value={}
        ), mock.patch.object(
            DRIVER, "_validate_evidence_run", return_value=None
        ), mock.patch.object(
            DRIVER.os, "fstatvfs", return_value=filesystem
        ), mock.patch.object(DRIVER, "_run_child") as child:
            status, stdout, stderr = self.diagnostic_bytes(self.environment())
        child.assert_not_called()
        diagnostic = self.assert_fixed_failure(stderr or stdout)
        self.assertEqual(diagnostic["reason"], "input_invalid")
        self.assertEqual(list(self.output_root.iterdir()), [])
        self.assert_no_disposable_bytes()
        self.assert_canonical_unchanged()

    def test_concurrent_canonical_mutation_on_capture_failure_is_detected(self):
        real_child = DRIVER._run_child
        prefixes: list[str] = []

        def run(arguments, *, environment, directory_fd, prefix, timeout_seconds):
            prefixes.append(prefix)
            if prefix == "normalizer":
                return real_child(
                    arguments,
                    environment=environment,
                    directory_fd=directory_fd,
                    prefix=prefix,
                    timeout_seconds=timeout_seconds,
                )
            self.outer.chmod(0o600)
            changed = bytearray(self.outer_bytes)
            changed[8] ^= 1
            self.outer.write_bytes(bytes(changed))
            self.outer.chmod(0o400)
            return DRIVER.ChildResult(9, b"", b"")

        try:
            with mock.patch.object(
                DRIVER, "_repository_binding", return_value={}
            ), mock.patch.object(
                DRIVER, "_validate_evidence_run", return_value=None
            ), mock.patch.object(DRIVER, "_run_child", side_effect=run):
                status, stdout, stderr = self.diagnostic_bytes(self.environment())
            self.assertEqual(prefixes, ["normalizer", "capture"])
            diagnostic = self.assert_fixed_failure(stderr or stdout)
            self.assertEqual(diagnostic["reason"], "canonical_mutated")
            self.assertEqual(list(self.output_root.iterdir()), [])
            self.assert_no_disposable_bytes()
        finally:
            self.outer.chmod(0o600)
            self.outer.write_bytes(self.outer_bytes)
            self.outer.chmod(0o400)

    def test_path_replacement_during_attempt_is_detected_without_publication(self):
        real_child = DRIVER._run_child
        moved = self.base / "original-preserved.zip"

        def run(arguments, *, environment, directory_fd, prefix, timeout_seconds):
            if prefix == "normalizer":
                result = real_child(
                    arguments,
                    environment=environment,
                    directory_fd=directory_fd,
                    prefix=prefix,
                    timeout_seconds=timeout_seconds,
                )
                self.outer.rename(moved)
                self.outer.symlink_to(moved)
                return result
            return DRIVER.ChildResult(9, b"", b"")

        try:
            with mock.patch.object(
                DRIVER, "_repository_binding", return_value={}
            ), mock.patch.object(
                DRIVER, "_validate_evidence_run", return_value=None
            ), mock.patch.object(DRIVER, "_run_child", side_effect=run):
                status, stdout, stderr = self.diagnostic_bytes(self.environment())
            diagnostic = self.assert_fixed_failure(stderr or stdout)
            self.assertEqual(diagnostic["reason"], "canonical_mutated")
            self.assertEqual(list(self.output_root.iterdir()), [])
            self.assert_no_disposable_bytes()
        finally:
            if self.outer.is_symlink():
                self.outer.unlink()
            if moved.exists():
                moved.rename(self.outer)

    def test_publication_failure_rolls_back_without_normal_capture(self):
        real_child = DRIVER._run_child
        with mock.patch.object(
            DRIVER, "_repository_binding", return_value=fake_capture_repository_identity()
        ), mock.patch.object(
            DRIVER, "_validate_evidence_run", return_value=None
        ), mock.patch.object(
            DRIVER,
            "_run_child",
            side_effect=self.synthetic_capture_child(real_child),
        ), mock.patch.object(
            DRIVER,
            "_promote_capture",
            side_effect=DRIVER.DriverError("publication_failed"),
        ):
            status, stdout, stderr = self.diagnostic_bytes(self.environment())
        diagnostic = self.assert_fixed_failure(stderr or stdout)
        self.assertEqual(diagnostic["reason"], "publication_failed")
        self.assertEqual(list(self.output_root.iterdir()), [])
        self.assert_no_disposable_bytes()
        self.assert_canonical_unchanged()

    def test_evidence_binding_drift_before_publication_cleans_pending_capture(self):
        real_child = DRIVER._run_child
        checks = 0

        def evidence_check(_inputs):
            nonlocal checks
            checks += 1
            if checks >= 2:
                raise DRIVER.DriverError("binding_mismatch")

        with mock.patch.object(
            DRIVER, "_repository_binding", return_value=fake_capture_repository_identity()
        ), mock.patch.object(
            DRIVER, "_validate_evidence_run", side_effect=evidence_check
        ), mock.patch.object(
            DRIVER,
            "_run_child",
            side_effect=self.synthetic_capture_child(real_child),
        ):
            status, stdout, stderr = self.diagnostic_bytes(self.environment())
        diagnostic = self.assert_fixed_failure(stderr or stdout)
        self.assertEqual(diagnostic["reason"], "binding_mismatch")
        self.assertGreaterEqual(checks, 2)
        self.assertEqual(list(self.output_root.iterdir()), [])
        self.assert_no_disposable_bytes()
        self.assert_canonical_unchanged()

    def test_evidence_binding_drift_after_publication_marks_indeterminate(self):
        real_child = DRIVER._run_child
        checks = 0

        def evidence_check(_inputs):
            nonlocal checks
            checks += 1
            if checks >= 3:
                raise DRIVER.DriverError("binding_mismatch")

        with mock.patch.object(
            DRIVER, "_repository_binding", return_value=fake_capture_repository_identity()
        ), mock.patch.object(
            DRIVER, "_validate_evidence_run", side_effect=evidence_check
        ), mock.patch.object(
            DRIVER,
            "_run_child",
            side_effect=self.synthetic_capture_child(real_child),
        ):
            status, stdout, stderr = self.diagnostic_bytes(self.environment())
        diagnostic = self.assert_fixed_failure(stderr or stdout)
        self.assertEqual(diagnostic["reason"], "binding_mismatch")
        self.assertGreaterEqual(checks, 3)
        packages = [
            path for path in self.output_root.iterdir() if not path.name.startswith(".")
        ]
        self.assertEqual(len(packages), 1)
        self.assertFalse((packages[0] / "EVIDENCE_COMPLETE").exists())
        self.assertTrue((packages[0] / "EVIDENCE_INDETERMINATE").exists())
        self.assert_no_disposable_bytes()
        self.assert_canonical_unchanged()

    def test_post_rename_package_mutation_marks_capture_indeterminate(self):
        real_child = DRIVER._run_child
        real_promote = DRIVER._promote_capture

        def promote(stage_fd, output_fd, final_name):
            real_promote(stage_fd, output_fd, final_name)
            capture = self.output_root / final_name / "capture.json"
            capture.chmod(0o600)
            capture.write_bytes(self.secret_sentinel)
            capture.chmod(0o400)

        with mock.patch.object(
            DRIVER,
            "_repository_binding",
            return_value=fake_capture_repository_identity(),
        ), mock.patch.object(
            DRIVER, "_validate_evidence_run", return_value=None
        ), mock.patch.object(
            DRIVER,
            "_run_child",
            side_effect=self.synthetic_capture_child(real_child),
        ), mock.patch.object(DRIVER, "_promote_capture", side_effect=promote):
            status, stdout, stderr = self.diagnostic_bytes(self.environment())
        diagnostic = self.assert_fixed_failure(stderr or stdout)
        self.assertEqual(diagnostic["reason"], "publication_failed")
        packages = [
            path for path in self.output_root.iterdir() if not path.name.startswith(".")
        ]
        self.assertEqual(len(packages), 1)
        self.assertFalse((packages[0] / "EVIDENCE_COMPLETE").exists())
        self.assertTrue((packages[0] / "EVIDENCE_INDETERMINATE").exists())
        self.assert_no_disposable_bytes()
        self.assert_canonical_unchanged()

    def test_post_rename_fsync_failure_marks_capture_indeterminate(self):
        real_child = DRIVER._run_child
        real_promote = DRIVER._promote_capture

        def promote(stage_fd, output_fd, final_name):
            real_fsync = DRIVER.os.fsync
            calls = 0

            def fail_once(descriptor):
                nonlocal calls
                calls += 1
                if calls == 1:
                    raise OSError("synthetic fsync failure")
                return real_fsync(descriptor)

            with mock.patch.object(DRIVER.os, "fsync", side_effect=fail_once):
                return real_promote(stage_fd, output_fd, final_name)

        with mock.patch.object(
            DRIVER, "_repository_binding", return_value=fake_capture_repository_identity()
        ), mock.patch.object(
            DRIVER, "_validate_evidence_run", return_value=None
        ), mock.patch.object(
            DRIVER,
            "_run_child",
            side_effect=self.synthetic_capture_child(real_child),
        ), mock.patch.object(DRIVER, "_promote_capture", side_effect=promote):
            status, stdout, stderr = self.diagnostic_bytes(self.environment())
        diagnostic = self.assert_fixed_failure(stderr or stdout)
        self.assertIn(diagnostic["reason"], {"publication_failed", "cleanup_indeterminate"})
        visible_packages = [
            path for path in self.output_root.iterdir() if not path.name.startswith(".")
        ]
        self.assertLessEqual(len(visible_packages), 1)
        for package in visible_packages:
            self.assertFalse((package / "EVIDENCE_COMPLETE").exists())
            self.assertTrue((package / "EVIDENCE_INDETERMINATE").exists())
        self.assert_no_disposable_bytes()
        self.assert_canonical_unchanged()

    def test_cleanup_failure_quarantines_all_private_partial_state(self):
        real_child = DRIVER._run_child
        with mock.patch.object(
            DRIVER, "_repository_binding", return_value=fake_capture_repository_identity()
        ), mock.patch.object(
            DRIVER, "_validate_evidence_run", return_value=None
        ), mock.patch.object(
            DRIVER,
            "_run_child",
            side_effect=self.synthetic_capture_child(real_child),
        ), mock.patch.object(DRIVER, "_wipe_directory_fd", return_value=False):
            status, stdout, stderr = self.diagnostic_bytes(self.environment())
        diagnostic = self.assert_fixed_failure(stderr or stdout)
        self.assertEqual(diagnostic["reason"], "cleanup_indeterminate")
        self.assertTrue(list(self.staging_root.glob(".indeterminate-*")))
        packages = [
            path for path in self.output_root.iterdir() if not path.name.startswith(".")
        ]
        self.assertEqual(len(packages), 1)
        self.assertFalse((packages[0] / "EVIDENCE_COMPLETE").exists())
        self.assertTrue((packages[0] / "EVIDENCE_INDETERMINATE").exists())
        self.assert_canonical_unchanged()

    def test_staging_root_path_replacement_cannot_redirect_derived_bytes(self):
        real_child = DRIVER._run_child
        moved = self.base / "held-staging-root"
        replaced = False

        def run(arguments, *, environment, directory_fd, prefix, timeout_seconds):
            nonlocal replaced
            result = real_child(
                arguments,
                environment=environment,
                directory_fd=directory_fd,
                prefix=prefix,
                timeout_seconds=timeout_seconds,
            )
            if prefix == "normalizer" and not replaced:
                self.staging_root.rename(moved)
                self.staging_root.mkdir(mode=0o700)
                replaced = True
            return result

        with mock.patch.object(
            DRIVER, "_repository_binding", return_value=fake_capture_repository_identity()
        ), mock.patch.object(
            DRIVER, "_validate_evidence_run", return_value=None
        ), mock.patch.object(DRIVER, "_run_child", side_effect=run):
            status, stdout, stderr = self.diagnostic_bytes(self.environment())
        diagnostic = self.assert_fixed_failure(stderr or stdout)
        self.assertEqual(diagnostic["reason"], "binding_mismatch")
        self.assertEqual(list(self.output_root.iterdir()), [])
        self.assertEqual(list(self.staging_root.iterdir()), [])
        self.assertEqual(list(moved.iterdir()), [])
        self.assertFalse(list(self.base.rglob(DRIVER.INNER_NAME)))
        self.assert_canonical_unchanged()

    def test_output_root_path_replacement_cannot_redirect_publication(self):
        real_child = DRIVER._run_child
        moved = self.base / "held-output-root"
        capture_child = self.synthetic_capture_child(real_child)
        replaced = False

        def run(arguments, *, environment, directory_fd, prefix, timeout_seconds):
            nonlocal replaced
            result = capture_child(
                arguments,
                environment=environment,
                directory_fd=directory_fd,
                prefix=prefix,
                timeout_seconds=timeout_seconds,
            )
            if prefix == "capture" and not replaced:
                self.output_root.rename(moved)
                self.output_root.mkdir(mode=0o700)
                replaced = True
            return result

        with mock.patch.object(
            DRIVER, "_repository_binding", return_value=fake_capture_repository_identity()
        ), mock.patch.object(
            DRIVER, "_validate_evidence_run", return_value=None
        ), mock.patch.object(DRIVER, "_run_child", side_effect=run):
            status, stdout, stderr = self.diagnostic_bytes(self.environment())
        diagnostic = self.assert_fixed_failure(stderr or stdout)
        self.assertEqual(diagnostic["reason"], "binding_mismatch")
        self.assertEqual(list(self.output_root.iterdir()), [])
        self.assertEqual(list(moved.iterdir()), [])
        self.assert_no_disposable_bytes()
        self.assert_canonical_unchanged()

    def test_second_concurrent_driver_is_rejected_by_exclusive_claim(self):
        real_child = DRIVER._run_child
        second_reason: list[str] = []
        attempted = False

        def run(arguments, *, environment, directory_fd, prefix, timeout_seconds):
            nonlocal attempted
            if prefix == "normalizer" and not attempted:
                attempted = True
                with self.assertRaises(DRIVER.DriverError) as caught:
                    DRIVER.execute(self.environment())
                second_reason.append(caught.exception.reason)
            return real_child(
                arguments,
                environment=environment,
                directory_fd=directory_fd,
                prefix=prefix,
                timeout_seconds=timeout_seconds,
            )

        with mock.patch.object(
            DRIVER, "_repository_binding", return_value=fake_capture_repository_identity()
        ), mock.patch.object(
            DRIVER, "_validate_evidence_run", return_value=None
        ), mock.patch.object(DRIVER, "_run_child", side_effect=run):
            status, stdout, stderr = self.diagnostic_bytes(self.environment())
        # The first synthetic attempt intentionally lacks the patched capture
        # child and therefore fails later; the concurrency assertion is the
        # pre-child, no-replacement invariant under test.
        self.assertNotEqual(status, 0)
        self.assertEqual(second_reason, ["publication_exists"])
        self.assert_fixed_failure(stderr or stdout)
        self.assertEqual(list(self.output_root.iterdir()), [])
        self.assert_no_disposable_bytes()
        self.assert_canonical_unchanged()

    def test_post_create_claim_validation_failure_removes_exact_lock(self):
        root_fd = os.open(
            self.staging_root,
            os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0),
        )
        try:
            with mock.patch.object(
                DRIVER,
                "_package_names",
                side_effect=[set(), {DRIVER.ROOT_LOCK_NAME, "synthetic-drift"}],
            ), self.assertRaises(DRIVER.DriverError) as caught:
                DRIVER._claim_root(root_fd)
        finally:
            os.close(root_fd)
        self.assertEqual(caught.exception.reason, "publication_failed")
        self.assertEqual(list(self.staging_root.iterdir()), [])
        self.assert_canonical_unchanged()

    def test_abrupt_failure_before_outer_completion_never_leaves_complete_marker(self):
        real_child = DRIVER._run_child

        def stop_before_marker(output_fd, final_name, manifest_sha256):
            del manifest_sha256
            package = self.output_root / final_name
            self.assertTrue(package.is_dir())
            self.assertFalse((package / "EVIDENCE_COMPLETE").exists())
            raise RuntimeError("synthetic abrupt stop")

        with mock.patch.object(
            DRIVER, "_repository_binding", return_value=fake_capture_repository_identity()
        ), mock.patch.object(
            DRIVER, "_validate_evidence_run", return_value=None
        ), mock.patch.object(
            DRIVER,
            "_run_child",
            side_effect=self.synthetic_capture_child(real_child),
        ), mock.patch.object(
            DRIVER, "_publish_completion_marker", side_effect=stop_before_marker
        ):
            status, stdout, stderr = self.diagnostic_bytes(self.environment())
        diagnostic = self.assert_fixed_failure(stderr or stdout)
        self.assertEqual(diagnostic["reason"], "internal_failure")
        packages = [
            path for path in self.output_root.iterdir() if not path.name.startswith(".")
        ]
        self.assertEqual(len(packages), 1)
        self.assertFalse((packages[0] / "EVIDENCE_COMPLETE").exists())
        self.assertTrue((packages[0] / "EVIDENCE_INDETERMINATE").exists())
        self.assert_no_disposable_bytes()
        self.assert_canonical_unchanged()

    def test_failed_post_marker_rollback_retains_root_indeterminate_claim(self):
        real_child = DRIVER._run_child
        real_read = DRIVER._read_capture_package
        marker_reads = 0

        def fail_after_final_marker(*args, **kwargs):
            nonlocal marker_reads
            result = real_read(*args, **kwargs)
            if kwargs.get("require_marker") is True:
                marker_reads += 1
                if marker_reads == 2:
                    raise DRIVER.DriverError("binding_mismatch")
            return result

        with mock.patch.object(
            DRIVER, "_repository_binding", return_value=fake_capture_repository_identity()
        ), mock.patch.object(
            DRIVER, "_validate_evidence_run", return_value=None
        ), mock.patch.object(
            DRIVER,
            "_run_child",
            side_effect=self.synthetic_capture_child(real_child),
        ), mock.patch.object(
            DRIVER, "_read_capture_package", side_effect=fail_after_final_marker
        ), mock.patch.object(
            DRIVER, "_mark_indeterminate", return_value=False
        ):
            status, stdout, stderr = self.diagnostic_bytes(self.environment())
        diagnostic = self.assert_fixed_failure(stderr or stdout)
        self.assertEqual(diagnostic["reason"], "cleanup_indeterminate")
        self.assertEqual(marker_reads, 2)
        names = {path.name for path in self.output_root.iterdir()}
        self.assertIn(DRIVER.ROOT_LOCK_NAME, names)
        self.assertTrue(any(name.startswith(".indeterminate-") for name in names))
        packages = [
            path for path in self.output_root.iterdir() if not path.name.startswith(".")
        ]
        self.assertEqual(len(packages), 1)
        self.assertTrue((packages[0] / "EVIDENCE_COMPLETE").exists())
        self.assertFalse((packages[0] / "EVIDENCE_INDETERMINATE").exists())
        self.assert_no_disposable_bytes()
        self.assert_canonical_unchanged()

    def test_unexpected_root_insertion_is_explicitly_indeterminate(self):
        real_child = DRIVER._run_child
        inserted = False

        def run(arguments, *, environment, directory_fd, prefix, timeout_seconds):
            nonlocal inserted
            result = real_child(
                arguments,
                environment=environment,
                directory_fd=directory_fd,
                prefix=prefix,
                timeout_seconds=timeout_seconds,
            )
            if prefix == "normalizer" and not inserted:
                planted = self.staging_root / "unexpected-entry"
                planted.write_bytes(b"synthetic")
                planted.chmod(0o400)
                inserted = True
            return result

        with mock.patch.object(
            DRIVER, "_repository_binding", return_value=fake_capture_repository_identity()
        ), mock.patch.object(
            DRIVER, "_validate_evidence_run", return_value=None
        ), mock.patch.object(DRIVER, "_run_child", side_effect=run):
            status, stdout, stderr = self.diagnostic_bytes(self.environment())
        diagnostic = self.assert_fixed_failure(stderr or stdout)
        self.assertEqual(diagnostic["reason"], "cleanup_indeterminate")
        self.assertTrue(list(self.staging_root.glob(".indeterminate-*")))
        self.assertEqual(list(self.output_root.iterdir()), [])
        self.assertFalse(list(self.base.rglob(DRIVER.INNER_NAME)))
        self.assert_canonical_unchanged()
