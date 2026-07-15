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
REGRESSION_BASE_SHA = "8b872882787859b87549e7f884832c624e29ead9"


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

    def run_helper(
        self,
        arguments: list[str] | None = None,
        *,
        helper: Path = HELPER,
    ):
        return subprocess.run(
            [
                sys.executable,
                "-I",
                str(helper),
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
        self.assertIn("object_reference_analysis: COMPLETE\n", report)
        self.assertIn("migration_duplicate_analysis: COMPLETE\n", report)
        self.assertIn("restore_planning_gate: BLOCKED\n", report)
        self.assertIn(f"sha256: {self.dump_sha}\n", report)
        self.assertIn("TABLE: 1\n", report)

    def test_starting_main_reproduces_hyphenated_extension_false_fatal(self):
        baseline_helper = self.root / "starting-main-lovable-dump-report.py"
        baseline = subprocess.run(
            [
                "git",
                "show",
                f"{REGRESSION_BASE_SHA}:scripts/migration/lib/lovable_dump_report.py",
            ],
            cwd=ROOT,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
            timeout=5,
        )
        self.assertEqual(baseline.returncode, 0, baseline.stderr)
        baseline_helper.write_bytes(baseline.stdout)
        self.write_toc(
            "; Dumped from database version: 17.5\n"
            "; Dumped by pg_dump version: 17.5\n"
            "1; 0 0 EXTENSION - uuid-ossp synthetic_owner\n"
            "2; 0 0 EXTENSION - uuid-ossp\n"
        )

        result = self.run_helper(helper=baseline_helper)

        self.assert_failure(result, "unresolved_known_toc_entry")

    def test_hyphenated_extension_name_uses_only_class_specific_parser(self):
        entry = REPORT.TocEntry(
            toc_id=1,
            object_class="EXTENSION",
            remainder="- uuid-ossp synthetic_owner",
            line_number=1,
        )

        # The general identifier path deliberately rejects this name.  Before
        # the class-specific branch, that made the known TOC entry unresolved.
        self.assertIsNone(REPORT.clean_identifier("uuid-ossp"))
        self.assertEqual(
            REPORT.object_ref(entry),
            REPORT.ObjectRef("EXTENSION", "-", "uuid-ossp"),
        )
        self.assertEqual(REPORT.unresolved_required_object_references([entry]), {})

        self.write_toc(
            "; Dumped from database version: 17.5\n"
            "; Dumped by pg_dump version: 17.5\n"
            "1; 0 0 EXTENSION - uuid-ossp synthetic_owner\n"
            "2; 0 0 EXTENSION - pgcrypto\n"
            "3; 0 0 EXTENSION - uuid-ossp\n"
        )
        result = self.run_helper()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, b"")
        self.assertIn("EXTENSION: 3\n", result.stdout.decode("utf-8"))

    def test_extension_name_exception_remains_conservative(self):
        accepted = {
            "uuid-ossp": "uuid-ossp",
            "postgis-3": "postgis-3",
        }
        rejected = (
            "-uuid-ossp",
            "uuid-ossp-",
            "uuid--ossp",
            "uuid.ossp",
            "uuid/ossp",
            "uuid:ossp",
            "uuid@ossp",
            "uuid–ossp",
            "uüid-ossp",
            '"uuid-ossp',
            'uuid-ossp"',
            '"uuid-ossp"',
            '"uuid"-ossp',
            "",
        )

        for value, normalized in accepted.items():
            with self.subTest(value=value):
                self.assertEqual(REPORT.clean_extension_name(value), normalized)
        for value in rejected:
            with self.subTest(value=value):
                self.assertIsNone(REPORT.clean_extension_name(value))

        malformed_remainders = (
            "- uuid ossp synthetic_owner",
            "- uuid.ossp synthetic_owner",
            "- uuid/ossp synthetic_owner",
            "- uuid–ossp synthetic_owner",
            "- uüid-ossp synthetic_owner",
            "public uuid-ossp synthetic_owner",
            "-",
            "- uuid-ossp synthetic_owner unexpected",
        )
        for remainder in malformed_remainders:
            with self.subTest(remainder=remainder):
                entry = REPORT.TocEntry(1, "EXTENSION", remainder, 1)
                self.assertIsNone(REPORT.object_ref(entry))
                self.assertEqual(
                    REPORT.unresolved_required_object_references([entry]),
                    {"EXTENSION": 1},
                )

        # The same spelling is not accepted for unrelated object classes.
        table = REPORT.TocEntry(
            1,
            "TABLE",
            "public uuid-ossp synthetic_owner",
            1,
        )
        self.assertIsNone(REPORT.object_ref(table))

    def test_generic_and_routine_identifier_grammars_fail_closed(self):
        for value in (
            '"unmatched',
            'unmatched"',
            '"balanced_but_not_documented_as_quoting"',
            '""double""',
            "name.with.punctuation",
            "name/with/slash",
            "name:with:colon",
            "name@owner",
            "name(signature",
            "naïve",
        ):
            with self.subTest(value=value):
                self.assertIsNone(REPORT.clean_identifier(value))

        self.assertEqual(
            REPORT.object_ref(
                REPORT.TocEntry(
                    1,
                    "FUNCTION",
                    "public handle_fixture() synthetic_owner",
                    1,
                )
            ),
            REPORT.ObjectRef("FUNCTION", "public", "handle_fixture"),
        )
        for remainder in (
            '"my schema" "my function"() synthetic_owner',
            "public bad.function() synthetic_owner",
            "public bad/function() synthetic_owner",
            "public naïve() synthetic_owner",
            "public handle_fixture() synthetic-owner",
            "public handle_fixture((integer)) synthetic_owner",
            "public handle_fixture() synthetic_owner extra",
        ):
            with self.subTest(remainder=remainder):
                entry = REPORT.TocEntry(1, "FUNCTION", remainder, 1)
                self.assertIsNone(REPORT.object_ref(entry))
                self.assertEqual(
                    REPORT.unresolved_required_object_references([entry]),
                    {"FUNCTION": 1},
                )

        for remainder in (
            "public safe_name synthetic-owner",
            'public safe_name "synthetic owner"',
            "public safe_name synthetic_owner extra",
            "public safe_name",
            '"my schema" safe_name synthetic_owner',
            'public "my table" synthetic_owner',
        ):
            with self.subTest(remainder=remainder):
                entry = REPORT.TocEntry(1, "TABLE", remainder, 1)
                self.assertIsNone(REPORT.object_ref(entry))
                self.assertEqual(
                    REPORT.unresolved_required_object_references([entry]),
                    {"TABLE": 1},
                )

        for object_class, remainder in (
            ("CONSTRAINT", "public items items_pkey synthetic_owner"),
            ("CONSTRAINT", "public items items_pkey"),
            ("POLICY", "public items private_policy synthetic_owner"),
            ("TRIGGER", "public items update_timestamp synthetic_owner"),
        ):
            with self.subTest(object_class=object_class, remainder=remainder):
                entry = REPORT.TocEntry(1, object_class, remainder, 1)
                self.assertIsNone(REPORT.object_ref(entry))
                self.assertEqual(
                    REPORT.unresolved_required_object_references([entry]),
                    {object_class: 1},
                )

    def test_unresolved_known_entries_publish_only_aggregate_blocked_analysis(self):
        self.write_toc(
            "; Dumped from database version: 17.5\n"
            "; Dumped by pg_dump version: 17.5\n"
            f"1; 123 456 TABLE {SENTINEL}\n"
            f"2; 789 101 FUNCTION public name.with.punctuation {SENTINEL}\n"
            f"3; 102 103 AGGREGATE public malformed.aggregate {SENTINEL}\n"
            f"4; 104 105 ACL public {SENTINEL}\n"
        )

        result = self.run_helper()

        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, b"")
        report = result.stdout.decode("utf-8")
        self.assertIn("inspection_status: REVIEW_REQUIRED\n", report)
        self.assertIn("object_reference_analysis: INCOMPLETE\n", report)
        self.assertIn("migration_duplicate_analysis: INCOMPLETE\n", report)
        self.assertIn("restore_planning_gate: BLOCKED\n", report)
        self.assertIn("unresolved_known_toc_entries: 3\n", report)
        self.assertIn("AGGREGATE: 1\n", report)
        self.assertIn("FUNCTION: 1\n", report)
        self.assertIn("TABLE: 1\n", report)
        self.assertNotIn(SENTINEL, report)
        self.assertNotIn("123", report)
        self.assertNotIn("456", report)
        self.assertNotIn("789", report)
        self.assertNotIn("101", report)
        self.assertNotIn("KNOWN TOC ENTRIES WITHOUT", report)
        self.assertNotIn("REVIEW FLAGS", report)
        self.assertNotIn("POSSIBLE REPO MIGRATION DUPLICATES", report)
        self.assertNotIn("input_file:", report)

        section = report.split("UNRESOLVED KNOWN TOC CLASS COUNTS\n", 1)[1]
        section = section.split("\n\nBOUNDARY", 1)[0]
        counts = dict(line.rsplit(": ", 1) for line in section.splitlines())
        self.assertEqual(tuple(sorted(counts)), REPORT.UNRESOLVED_CLASS_COUNT_KEYS)
        self.assertEqual(sum(int(value) for value in counts.values()), 3)
        self.assertEqual(counts["ACL"], "0")

    def test_spaces_punctuation_and_unicode_are_incomplete_without_leaking(self):
        remainders = (
            "- uuid ossp synthetic_owner",
            "- uuid.ossp synthetic_owner",
            "- uuid/ossp synthetic_owner",
            "- uuid–ossp synthetic_owner",
            "- uüid-ossp synthetic_owner",
            "- uuid-ossp synthetic-owner",
        )
        for index, remainder in enumerate(remainders, start=1):
            with self.subTest(remainder=remainder):
                self.write_toc(f"{index}; 0 0 EXTENSION {remainder}\n")
                result = self.run_helper()
                self.assertEqual(result.returncode, 0, result.stderr)
                report = result.stdout.decode("utf-8")
                self.assertIn("object_reference_analysis: INCOMPLETE\n", report)
                self.assertIn("restore_planning_gate: BLOCKED\n", report)
                self.assertNotIn(remainder, report)

    def test_toc_failure_reasons_are_specific_and_never_relay_metadata(self):
        cases = {
            "unknown_toc_class": (
                "1; 0 0 FUTURE OBJECT " + SENTINEL + "\n"
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
