from __future__ import annotations

import hashlib
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
HELPER = ROOT / "scripts" / "migration" / "lib" / "lovable_dump_report.py"
SPEC = importlib.util.spec_from_file_location("lovable_dump_report", HELPER)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("could not load Lovable dump report helper")
REPORT = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = REPORT
SPEC.loader.exec_module(REPORT)

SENTINEL = "SYNTHETIC_PRIVATE_TOC_SQL_PATH_PAYLOAD_MUST_NOT_APPEAR"


class LovableDumpReportDiagnosticTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(
            prefix="lovable-dump-report-test."
        )
        self.root = Path(self.temporary.name)
        self.dump = self.root / "synthetic archive.backup"
        self.dump.write_bytes(b"PGDMP\x01\x0e\x00\x04\x08\x01synthetic-only")
        self.dump_sha = hashlib.sha256(self.dump.read_bytes()).hexdigest()
        self.toc = self.root / "synthetic archive.toc"
        self.migrations = self.root / "synthetic migrations"
        self.migrations.mkdir()

    def tearDown(self):
        self.temporary.cleanup()

    def helper_arguments(self) -> list[str]:
        return [
            "--dump",
            str(self.dump),
            "--toc",
            str(self.toc),
            "--pg-restore-version",
            "17.5",
            "--expected-sha256",
            self.dump_sha,
            "--input-name",
            "synthetic.backup",
            "--migrations-dir",
            str(self.migrations),
        ]

    def run_helper(self, arguments: list[str] | None = None):
        return subprocess.run(
            [
                sys.executable,
                "-I",
                str(HELPER),
                *(self.helper_arguments() if arguments is None else arguments),
            ],
            cwd=ROOT,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
            timeout=5,
        )

    def assert_failure(self, result, reason: str):
        expected = (
            f'{{"diagnostic_version":1,"reason":"{reason}"}}\n'.encode("ascii")
        )
        self.assertEqual(result.returncode, 4)
        if result.stdout:
            self.fail("helper failure wrote private stdout bytes")
        if result.stderr != expected:
            self.fail("helper failure diagnostic was not the exact canonical record")
        self.assertEqual(result.stderr.count(b"\n"), 1)
        if SENTINEL.encode("ascii") in result.stderr:
            self.fail("helper failure diagnostic exposed private sentinel bytes")
        if str(self.root).encode("utf-8") in result.stderr:
            self.fail("helper failure diagnostic exposed a private path")
        self.assertEqual(
            json.loads(result.stderr),
            {"diagnostic_version": 1, "reason": reason},
        )

    def write_toc(self, text: str) -> None:
        self.toc.write_text(text, encoding="utf-8")

    def valid_toc(self) -> str:
        return (
            "; Dumped from database version: 17.5\n"
            "; Dumped by pg_dump version: 17.5\n"
            "1; 0 0 TABLE public synthetic_table synthetic_owner\n"
        )

    def test_failure_reason_allowlist_and_wire_format_are_fixed(self):
        expected = frozenset(
            {
                "unknown_toc_class",
                "unresolved_known_toc_entry",
                "malformed_toc",
                "duplicate_toc_id",
                "conflicting_source_version",
                "conflicting_pg_dump_version",
                "migration_metadata_unreadable",
                "other_nonzero",
            }
        )
        self.assertEqual(REPORT.ALLOWED_FAILURE_REASONS, expected)
        for reason in expected:
            with self.subTest(reason=reason):
                self.assertEqual(
                    REPORT.failure_diagnostic(reason),
                    f'{{"diagnostic_version":1,"reason":"{reason}"}}\n'.encode(
                        "ascii"
                    ),
                )
        self.assertEqual(
            REPORT.failure_diagnostic("not_allowlisted"),
            b'{"diagnostic_version":1,"reason":"other_nonzero"}\n',
        )

    def test_success_report_passthrough_is_preserved(self):
        self.write_toc(self.valid_toc())
        result = self.run_helper()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, b"")
        report = result.stdout.decode("utf-8")
        self.assertIn("inspection_status: REVIEW_REQUIRED\n", report)
        self.assertIn(f"sha256: {self.dump_sha}\n", report)
        self.assertIn("TABLE: 1\n", report)

    def test_toc_failure_reasons_are_specific_and_never_relay_metadata(self):
        cases = {
            "unknown_toc_class": (
                "1; 0 0 FUTURE OBJECT " + SENTINEL + "\n"
            ),
            "unresolved_known_toc_entry": (
                "1; 0 0 TABLE " + SENTINEL + "\n"
            ),
            "malformed_toc": "not-a-toc-line " + SENTINEL + "\n",
            "duplicate_toc_id": (
                "1; 0 0 TABLE public first synthetic_owner\n"
                "1; 0 0 TABLE public second synthetic_owner\n"
            ),
            "conflicting_source_version": (
                "; Dumped from database version: 16.9\n"
                "; Dumped from database version: 17.5\n"
                "1; 0 0 TABLE public synthetic_table synthetic_owner\n"
            ),
            "conflicting_pg_dump_version": (
                "; Dumped by pg_dump version: 16.9\n"
                "; Dumped by pg_dump version: 17.5\n"
                "1; 0 0 TABLE public synthetic_table synthetic_owner\n"
            ),
        }
        for reason, toc_text in cases.items():
            with self.subTest(reason=reason):
                self.write_toc(toc_text)
                self.assert_failure(self.run_helper(), reason)

    def test_invalid_utf8_toc_is_malformed_without_relaying_bytes(self):
        self.toc.write_bytes(b"\xff\xfe" + SENTINEL.encode("ascii"))
        self.assert_failure(self.run_helper(), "malformed_toc")

    def test_unreadable_migration_metadata_has_only_allowlisted_reason(self):
        self.write_toc(self.valid_toc())
        migration = self.migrations / f"{SENTINEL}.sql"
        migration.write_bytes(b"\xff\xfe" + SENTINEL.encode("ascii"))
        self.assert_failure(self.run_helper(), "migration_metadata_unreadable")

    def test_argument_and_unclassified_filesystem_failures_are_other_nonzero(self):
        malformed_arguments = ["--unknown-" + SENTINEL]
        self.assert_failure(self.run_helper(malformed_arguments), "other_nonzero")

        self.write_toc(self.valid_toc())
        self.dump = self.root / f"absent-{SENTINEL}.backup"
        self.assert_failure(self.run_helper(), "other_nonzero")


if __name__ == "__main__":
    unittest.main()
