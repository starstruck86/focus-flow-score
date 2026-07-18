from __future__ import annotations

import importlib.util
import io
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
TOOL = ROOT / "scripts" / "migration" / "bounded-pg-restore.py"
SPEC = importlib.util.spec_from_file_location("bounded_pg_restore", TOOL)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("could not load bounded pg_restore wrapper")
WRAPPER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = WRAPPER
SPEC.loader.exec_module(WRAPPER)


FAKE_SOURCE = r'''#!{python}
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ledger = os.environ.get("FAKE_LEDGER")
if ledger:
    with Path(ledger).open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(sys.argv[1:]) + "\n")

mode = os.environ.get("FAKE_MODE", "success")
if mode == "hang":
    marker = os.environ["FAKE_DESCENDANT_MARKER"]
    subprocess.Popen([
        sys.executable,
        "-c",
        "import pathlib,time; time.sleep(0.6); pathlib.Path(%r).write_text('escaped')" % marker,
    ])
    time.sleep(10)
elif mode == "leader-exits-descendant":
    descendant_marker = os.environ["FAKE_DESCENDANT_MARKER"]
    leader_marker = os.environ["FAKE_LEADER_EXIT_MARKER"]
    subprocess.Popen([
        sys.executable,
        "-c",
        "import pathlib,time; time.sleep(0.7); pathlib.Path(%r).write_text('escaped')" % descendant_marker,
    ])
    Path(leader_marker).write_text("leader exited", encoding="utf-8")
    os.write(1, b"LEADER_OUTPUT_MUST_NOT_ESCAPE")
    raise SystemExit(0)
elif mode == "flood":
    os.write(1, b"X" * 8192)
elif mode == "stderr-flood":
    os.write(2, b"X" * 8192)
elif mode == "success-output":
    os.write(1, b"SUCCESS_STDOUT\n")
    os.write(2, b"SUCCESS_STDERR\n")
elif mode == "unsupported-version":
    os.write(2, b"pg_restore: error: unsupported version (1.99) in file header\n")
    raise SystemExit(1)
elif mode == "invalid-archive":
    os.write(2, b"pg_restore: error: input file does not appear to be a valid archive\n")
    raise SystemExit(1)
elif mode == "invalid-archive-too-short":
    os.write(2, b"pg_restore: error: input file does not appear to be a valid archive (too short?)\n")
    raise SystemExit(1)
elif mode == "truncated-archive":
    os.write(2, b"pg_restore: error: unexpected end of file\n")
    raise SystemExit(1)
elif mode == "truncated-short-read":
    os.write(2, b"pg_restore: error: input file is too short (read 5, expected 11)\n")
    raise SystemExit(1)
elif mode == "unsupported-with-extra-line":
    os.write(2, b"pg_restore: error: unsupported version (1.99) in file header\n")
    os.write(2, b"CHILD_PRIVATE_PATH_SENTINEL=/private/export.backup\n")
    raise SystemExit(1)
elif mode == "invalid-utf8":
    os.write(2, b"pg_restore: error: \xffCHILD_BINARY_SENTINEL\n")
    raise SystemExit(1)
elif mode == "failure":
    os.write(1, b"CHILD_STDOUT_SENTINEL")
    os.write(2, b"CHILD_STDERR_SENTINEL")
    raise SystemExit(7)
elif sys.argv[1:] == ["--version"]:
    print("pg_restore (PostgreSQL) 17.synthetic")
elif len(sys.argv) == 3 and sys.argv[1] == "--list":
    print("; synthetic TOC")
else:
    raise SystemExit(9)
'''


class BoundedPgRestoreTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="bounded-pg-restore-test.")
        self.root = Path(self.temporary.name)
        self.fake = self.root / "fake-pg-restore"
        self.fake.write_text(
            FAKE_SOURCE.format(python=sys.executable),
            encoding="utf-8",
        )
        self.fake.chmod(0o700)
        self.archive = self.root / "synthetic archive.backup"
        self.archive.write_bytes(b"PGDMP\x01\x0e\x00\x04\x08\x01")
        self.ledger = self.root / "ledger.jsonl"
        self.capture_parent = self.root / "captures"
        self.capture_parent.mkdir(mode=0o700)
        self.environment = dict(os.environ)
        self.environment[WRAPPER.UNDERLYING_ENVIRONMENT_VARIABLE] = str(self.fake)
        self.environment[
            WRAPPER.TEMPORARY_PARENT_PATH_ENVIRONMENT_VARIABLE
        ] = str(self.capture_parent)
        self.environment["FAKE_LEDGER"] = str(self.ledger)

    def tearDown(self):
        self.temporary.cleanup()

    def run_cli(self, *arguments: str, environment=None):
        return subprocess.run(
            [sys.executable, "-I", "-S", "-B", str(TOOL), *arguments],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=self.environment if environment is None else environment,
            check=False,
            timeout=5,
        )

    def direct_request(self, request, *, environment=None):
        stdout = io.BytesIO()
        stderr = io.BytesIO()
        WRAPPER.run_request(
            str(self.fake),
            request,
            environment=self.environment if environment is None else environment,
            stdout=stdout,
            stderr=stderr,
            temporary_parent=str(self.capture_parent),
        )
        return stdout.getvalue(), stderr.getvalue()

    def ledger_entries(self):
        if not self.ledger.exists():
            return []
        return [
            json.loads(line)
            for line in self.ledger.read_text(encoding="utf-8").splitlines()
        ]

    def assert_failure_diagnostic(self, result, *, reason_code):
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, b"")
        expected = (
            f'{{"diagnostic_version":1,"reason":"{reason_code}"}}\n'.encode(
                "ascii"
            )
        )
        self.assertEqual(result.stderr, expected)
        self.assertEqual(result.stderr.count(b"\n"), 1)
        diagnostic = json.loads(result.stderr)
        self.assertEqual(
            set(diagnostic),
            {"diagnostic_version", "reason"},
        )
        self.assertIn(diagnostic["reason"], WRAPPER.ALLOWED_REASON_CODES)

    def test_reason_code_allowlist_and_diagnostic_schema_are_fixed(self):
        expected_reason_codes = frozenset(
            {
                "timeout",
                "output_cap",
                "unsupported_archive_version",
                "invalid_archive",
                "truncated_archive",
                "other_nonzero",
            }
        )
        self.assertEqual(WRAPPER.ALLOWED_REASON_CODES, expected_reason_codes)
        for reason_code in expected_reason_codes:
            with self.subTest(reason_code=reason_code):
                diagnostic = json.loads(
                    WRAPPER._failure_diagnostic(reason_code)
                )
                self.assertEqual(
                    diagnostic,
                    {
                        "diagnostic_version": 1,
                        "reason": reason_code,
                    },
                )

    def test_cli_ledger_contains_only_version_and_list(self):
        version = self.run_cli("--version")
        self.assertEqual(version.returncode, 0, version.stderr)
        self.assertEqual(version.stdout, b"pg_restore (PostgreSQL) 17.synthetic\n")
        self.assertEqual(version.stderr, b"")

        listing = self.run_cli("--list", str(self.archive))
        self.assertEqual(listing.returncode, 0, listing.stderr)
        self.assertEqual(listing.stdout, b"; synthetic TOC\n")
        self.assertEqual(listing.stderr, b"")
        self.assertEqual(
            self.ledger_entries(),
            [["--version"], ["--list", str(self.archive)]],
        )

    def test_cli_requires_exactly_one_explicit_private_temporary_parent(self):
        missing = dict(self.environment)
        missing.pop(WRAPPER.TEMPORARY_PARENT_PATH_ENVIRONMENT_VARIABLE)
        self.assert_failure_diagnostic(
            self.run_cli("--version", environment=missing),
            reason_code=WRAPPER.REASON_OTHER_NONZERO,
        )

        both = dict(self.environment)
        parent_fd = os.open(self.capture_parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            both[WRAPPER.TEMPORARY_PARENT_FD_ENVIRONMENT_VARIABLE] = str(parent_fd)
            self.assert_failure_diagnostic(
                self.run_cli("--version", environment=both),
                reason_code=WRAPPER.REASON_OTHER_NONZERO,
            )
        finally:
            os.close(parent_fd)

        relative = dict(self.environment)
        relative[WRAPPER.TEMPORARY_PARENT_PATH_ENVIRONMENT_VARIABLE] = "captures"
        self.assert_failure_diagnostic(
            self.run_cli("--version", environment=relative),
            reason_code=WRAPPER.REASON_OTHER_NONZERO,
        )

        linked_parent = self.root / "linked-captures"
        linked_parent.symlink_to(self.capture_parent, target_is_directory=True)
        symlinked = dict(self.environment)
        symlinked[WRAPPER.TEMPORARY_PARENT_PATH_ENVIRONMENT_VARIABLE] = str(
            linked_parent
        )
        self.assert_failure_diagnostic(
            self.run_cli("--version", environment=symlinked),
            reason_code=WRAPPER.REASON_OTHER_NONZERO,
        )

        self.capture_parent.chmod(0o750)
        try:
            self.assert_failure_diagnostic(
                self.run_cli("--version"),
                reason_code=WRAPPER.REASON_OTHER_NONZERO,
            )
        finally:
            self.capture_parent.chmod(0o700)

        self.assertEqual(self.ledger_entries(), [])
        self.assertEqual(list(self.capture_parent.iterdir()), [])

    def test_inherited_private_parent_fd_contains_all_capture_bytes(self):
        environment = dict(self.environment)
        environment.pop(WRAPPER.TEMPORARY_PARENT_PATH_ENVIRONMENT_VARIABLE)
        parent_fd = os.open(self.capture_parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            environment[WRAPPER.TEMPORARY_PARENT_FD_ENVIRONMENT_VARIABLE] = str(
                parent_fd
            )
            result = subprocess.run(
                [
                    sys.executable,
                    "-I",
                    "-S",
                    "-B",
                    str(TOOL),
                    "--list",
                    str(self.archive),
                ],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=environment,
                close_fds=True,
                pass_fds=(parent_fd,),
                check=False,
                timeout=5,
            )
        finally:
            os.close(parent_fd)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, b"; synthetic TOC\n")
        self.assertEqual(result.stderr, b"")
        self.assertEqual(self.ledger_entries(), [["--list", str(self.archive)]])
        self.assertEqual(list(self.capture_parent.iterdir()), [])

    def test_successful_list_then_cleanup_failure_is_private_and_nonemitting(self):
        request = WRAPPER.parse_request(["--list", str(self.archive)])
        stdout = io.BytesIO()
        stderr = io.BytesIO()
        raw_capture_observed = False
        system_roots = {
            Path("/tmp").resolve(),
            Path(tempfile.gettempdir()).resolve(),
        }
        before = {
            (str(root), path.name)
            for root in system_roots
            for path in root.glob(f"{WRAPPER.TEMPORARY_DIRECTORY_PREFIX}*")
        }

        real_unlink = WRAPPER.os.unlink

        def fail_stdout_cleanup(
            name: str, *, dir_fd: int | None = None
        ) -> None:
            nonlocal raw_capture_observed
            if name != "stdout.capture":
                real_unlink(name, dir_fd=dir_fd)
                return
            self.assertIsNotNone(dir_fd)
            raw_fd = os.open(
                "stdout.capture",
                os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0),
                dir_fd=dir_fd,
            )
            try:
                raw_capture_observed = os.read(raw_fd, 4096) == b"; synthetic TOC\n"
            finally:
                os.close(raw_fd)
            raise OSError("planted private capture cleanup failure")

        with mock.patch.object(
            WRAPPER.os,
            "unlink",
            side_effect=fail_stdout_cleanup,
        ):
            with self.assertRaises(WRAPPER.BoundedPgRestoreError) as caught:
                WRAPPER.run_request(
                    str(self.fake),
                    request,
                    environment=self.environment,
                    stdout=stdout,
                    stderr=stderr,
                    temporary_parent=str(self.capture_parent),
                )

        self.assertEqual(caught.exception.reason_code, WRAPPER.REASON_OTHER_NONZERO)
        self.assertTrue(raw_capture_observed)
        self.assertEqual(stdout.getvalue(), b"")
        self.assertEqual(stderr.getvalue(), b"")
        self.assertEqual(self.ledger_entries(), [["--list", str(self.archive)]])
        after = {
            (str(root), path.name)
            for root in system_roots
            for path in root.glob(f"{WRAPPER.TEMPORARY_DIRECTORY_PREFIX}*")
        }
        self.assertEqual(after, before)
        residue = list(
            self.capture_parent.glob(f"{WRAPPER.TEMPORARY_DIRECTORY_PREFIX}*")
        )
        self.assertEqual(len(residue), 1)
        self.assertEqual(
            (residue[0] / "stdout.capture").read_bytes(), b"; synthetic TOC\n"
        )
        self.assertEqual(
            json.loads((residue[0] / "EVIDENCE_INDETERMINATE").read_bytes()),
            {
                "artifact_kind": "bounded_pg_restore_indeterminate",
                "format_version": 1,
                "reason": "cleanup_indeterminate",
            },
        )
        self.assertEqual(
            stat.S_IMODE((residue[0] / "EVIDENCE_INDETERMINATE").stat().st_mode),
            0o400,
        )

    def test_successful_list_then_cleanup_fsync_failure_is_private_and_nonemitting(self):
        request = WRAPPER.parse_request(["--list", str(self.archive)])
        stdout = io.BytesIO()
        stderr = io.BytesIO()
        real_fsync = WRAPPER.os.fsync
        fsync_calls = 0

        def fail_first_capture_directory_fsync(file_descriptor: int) -> None:
            nonlocal fsync_calls
            fsync_calls += 1
            # The first call publishes creation beneath the parent; the second
            # is the post-capture child-directory cleanup durability check.
            if fsync_calls == 2:
                raise OSError("planted private cleanup fsync failure")
            real_fsync(file_descriptor)

        with mock.patch.object(
            WRAPPER.os,
            "fsync",
            side_effect=fail_first_capture_directory_fsync,
        ):
            with self.assertRaises(WRAPPER.BoundedPgRestoreError) as caught:
                WRAPPER.run_request(
                    str(self.fake),
                    request,
                    environment=self.environment,
                    stdout=stdout,
                    stderr=stderr,
                    temporary_parent=str(self.capture_parent),
                )

        self.assertEqual(caught.exception.reason_code, WRAPPER.REASON_OTHER_NONZERO)
        self.assertEqual(stdout.getvalue(), b"")
        self.assertEqual(stderr.getvalue(), b"")
        self.assertEqual(self.ledger_entries(), [["--list", str(self.archive)]])
        residue = list(
            self.capture_parent.glob(f"{WRAPPER.TEMPORARY_DIRECTORY_PREFIX}*")
        )
        self.assertEqual(len(residue), 1)
        self.assertEqual(
            set(path.name for path in residue[0].iterdir()),
            {WRAPPER.INDETERMINATE_MARKER},
        )
        self.assertEqual(
            json.loads((residue[0] / WRAPPER.INDETERMINATE_MARKER).read_bytes()),
            {
                "artifact_kind": "bounded_pg_restore_indeterminate",
                "format_version": 1,
                "reason": "cleanup_indeterminate",
            },
        )

    def test_capture_fd_close_failure_cannot_bypass_private_indeterminate_marker(self):
        request = WRAPPER.parse_request(["--list", str(self.archive)])
        stdout = io.BytesIO()
        stderr = io.BytesIO()
        real_close = WRAPPER.os.close
        failed_descriptor: int | None = None

        def fail_first_explicit_close(file_descriptor: int) -> None:
            nonlocal failed_descriptor
            if failed_descriptor is None:
                try:
                    metadata = os.fstat(file_descriptor)
                except OSError:
                    metadata = None
                if metadata is not None and stat.S_ISREG(metadata.st_mode):
                    failed_descriptor = file_descriptor
                    raise OSError("planted capture descriptor close failure")
            real_close(file_descriptor)

        try:
            with mock.patch.object(
                WRAPPER.os,
                "close",
                side_effect=fail_first_explicit_close,
            ):
                with self.assertRaises(WRAPPER.BoundedPgRestoreError) as caught:
                    WRAPPER.run_request(
                        str(self.fake),
                        request,
                        environment=self.environment,
                        stdout=stdout,
                        stderr=stderr,
                        temporary_parent=str(self.capture_parent),
                    )
        finally:
            if failed_descriptor is not None:
                try:
                    real_close(failed_descriptor)
                except OSError:
                    pass

        self.assertEqual(caught.exception.reason_code, WRAPPER.REASON_OTHER_NONZERO)
        self.assertEqual(stdout.getvalue(), b"")
        self.assertEqual(stderr.getvalue(), b"")
        residue = list(
            self.capture_parent.glob(f"{WRAPPER.TEMPORARY_DIRECTORY_PREFIX}*")
        )
        self.assertEqual(len(residue), 1)
        self.assertEqual(
            set(path.name for path in residue[0].iterdir()),
            {WRAPPER.INDETERMINATE_MARKER},
        )

    def test_real_postgresql17_list_uses_inherited_private_parent_fd(self):
        if os.environ.get("MIGRATION_VERIFY_ALLOW_FIXTURE") != "1":
            self.skipTest("requires the explicitly authorized local CI fixture")
        database = os.environ.get("PGDATABASE", "")
        host = os.environ.get("PGHOST", "")
        if not database.startswith("migration_verify_") or host not in {
            "/var/run/postgresql",
            "/tmp",
        }:
            self.skipTest("requires a local migration_verify_* PostgreSQL fixture")
        pg_dump = shutil.which("pg_dump")
        pg_restore = shutil.which("pg_restore")
        if pg_dump is None or pg_restore is None:
            self.skipTest("PostgreSQL client tools are unavailable")
        for tool in (pg_dump, pg_restore):
            version = subprocess.run(
                [tool, "--version"],
                check=False,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=5,
            )
            self.assertEqual(version.returncode, 0)
            self.assertRegex(version.stdout, rb"\(PostgreSQL\) 17(?:[. ]|$)")

        archive = self.root / "real-postgresql17-schema.backup"
        dump = subprocess.run(
            [
                pg_dump,
                "--format=custom",
                "--schema-only",
                "--no-owner",
                "--no-privileges",
                f"--file={archive}",
            ],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            env=os.environ,
            timeout=30,
        )
        self.assertEqual(dump.returncode, 0, b"synthetic pg_dump failed")
        self.assertTrue(archive.read_bytes().startswith(b"PGDMP"))

        real_ledger = self.root / "real-pg-restore-ledger"
        audited = self.root / "audited-pg-restore"
        audited.write_text(
            "#!/bin/sh\nset -eu\n"
            f"printf '%s\\n' \"$1\" >> {str(real_ledger)!r}\n"
            f"exec {pg_restore!r} \"$@\"\n",
            encoding="ascii",
        )
        audited.chmod(0o500)
        environment = {
            "LANG": "C",
            "LC_ALL": "C",
            WRAPPER.UNDERLYING_ENVIRONMENT_VARIABLE: str(audited),
        }
        parent_fd = os.open(self.capture_parent, os.O_RDONLY | os.O_DIRECTORY)
        environment[WRAPPER.TEMPORARY_PARENT_FD_ENVIRONMENT_VARIABLE] = str(parent_fd)
        try:
            results = [
                subprocess.run(
                    [sys.executable, "-I", "-S", "-B", str(TOOL), *arguments],
                    check=False,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    env=environment,
                    close_fds=True,
                    pass_fds=(parent_fd,),
                    timeout=30,
                )
                for arguments in (("--version",), ("--list", str(archive)))
            ]
        finally:
            os.close(parent_fd)
        for result in results:
            self.assertEqual(
                result.returncode,
                0,
                "bounded PostgreSQL 17 metadata invocation failed",
            )
            self.assertEqual(result.stderr, b"")
        self.assertRegex(results[0].stdout, rb"\(PostgreSQL\) 17(?:[. ]|$)")
        self.assertTrue(results[1].stdout.startswith(b";"))
        self.assertEqual(
            real_ledger.read_text(encoding="ascii").splitlines(),
            ["--version", "--list"],
        )
        self.assertEqual(list(self.capture_parent.iterdir()), [])

    def test_success_preserves_child_stdout_and_stderr_bytes(self):
        environment = dict(self.environment)
        environment["FAKE_MODE"] = "success-output"
        result = self.run_cli("--version", environment=environment)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, b"SUCCESS_STDOUT\n")
        self.assertEqual(result.stderr, b"SUCCESS_STDERR\n")
        self.assertEqual(self.ledger_entries(), [["--version"]])

    def test_rejects_every_other_argument_shape_before_child(self):
        cases = (
            (),
            ("--help",),
            ("--version", "extra"),
            ("--list",),
            ("--list", str(self.archive), "extra"),
            ("--list", "relative.backup"),
            ("--list", "https://example.invalid/export"),
        )
        for arguments in cases:
            with self.subTest(arguments=arguments):
                result = self.run_cli(*arguments)
                self.assert_failure_diagnostic(
                    result,
                    reason_code=WRAPPER.REASON_OTHER_NONZERO,
                )
        self.assertEqual(self.ledger_entries(), [])

    def test_requires_absolute_nonsymlink_executable(self):
        missing = dict(self.environment)
        missing.pop(WRAPPER.UNDERLYING_ENVIRONMENT_VARIABLE)
        self.assert_failure_diagnostic(
            self.run_cli("--version", environment=missing),
            reason_code=WRAPPER.REASON_OTHER_NONZERO,
        )

        relative = dict(self.environment)
        relative[WRAPPER.UNDERLYING_ENVIRONMENT_VARIABLE] = "fake-pg-restore"
        self.assert_failure_diagnostic(
            self.run_cli("--version", environment=relative),
            reason_code=WRAPPER.REASON_OTHER_NONZERO,
        )

        linked_binary = self.root / "linked-pg-restore"
        linked_binary.symlink_to(self.fake)
        symlinked = dict(self.environment)
        symlinked[WRAPPER.UNDERLYING_ENVIRONMENT_VARIABLE] = str(linked_binary)
        self.assert_failure_diagnostic(
            self.run_cli("--version", environment=symlinked),
            reason_code=WRAPPER.REASON_OTHER_NONZERO,
        )
        self.assertEqual(self.ledger_entries(), [])

    def test_timeout_kills_process_group_and_reaps_leader(self):
        marker = self.root / "escaped-descendant"
        environment = dict(self.environment)
        environment["FAKE_MODE"] = "hang"
        environment["FAKE_DESCENDANT_MARKER"] = str(marker)
        request = WRAPPER.Request(
            child_arguments=("--version",),
            timeout_seconds=0.4,
            stdout_cap_bytes=1024,
            stderr_cap_bytes=1024,
        )

        started = time.monotonic()
        with self.assertRaises(WRAPPER.BoundedPgRestoreError) as caught:
            self.direct_request(request, environment=environment)
        self.assertEqual(caught.exception.reason_code, WRAPPER.REASON_TIMEOUT)
        self.assertLess(time.monotonic() - started, 2)
        time.sleep(0.8)
        self.assertFalse(marker.exists())
        self.assertEqual(list(self.capture_parent.iterdir()), [])
        self.assertEqual(self.ledger_entries(), [["--version"]])

    def test_exited_leader_does_not_exempt_live_descendant_from_cleanup(self):
        descendant_marker = self.root / "escaped-after-leader-exit"
        leader_marker = self.root / "leader-exited"
        environment = dict(self.environment)
        environment["FAKE_MODE"] = "leader-exits-descendant"
        environment["FAKE_DESCENDANT_MARKER"] = str(descendant_marker)
        environment["FAKE_LEADER_EXIT_MARKER"] = str(leader_marker)
        request = WRAPPER.Request(
            child_arguments=("--version",),
            timeout_seconds=0.35,
            stdout_cap_bytes=1024,
            stderr_cap_bytes=1024,
        )
        stdout = io.BytesIO()
        stderr = io.BytesIO()

        with self.assertRaises(WRAPPER.BoundedPgRestoreError) as caught:
            WRAPPER.run_request(
                str(self.fake),
                request,
                environment=environment,
                stdout=stdout,
                stderr=stderr,
                temporary_parent=str(self.capture_parent),
            )
        self.assertEqual(caught.exception.reason_code, WRAPPER.REASON_TIMEOUT)
        self.assertTrue(leader_marker.exists())
        self.assertEqual(stdout.getvalue(), b"")
        self.assertEqual(stderr.getvalue(), b"")
        time.sleep(0.8)
        self.assertFalse(descendant_marker.exists())
        self.assertEqual(list(self.capture_parent.iterdir()), [])
        self.assertEqual(self.ledger_entries(), [["--version"]])

    def test_output_flood_is_killed_and_private_capture_is_removed(self):
        for mode, stream_name in (("flood", "stdout"), ("stderr-flood", "stderr")):
            with self.subTest(stream=stream_name):
                environment = dict(self.environment)
                environment["FAKE_MODE"] = mode
                request = WRAPPER.Request(
                    child_arguments=("--version",),
                    timeout_seconds=2,
                    stdout_cap_bytes=1024,
                    stderr_cap_bytes=1024,
                )
                with self.assertRaises(WRAPPER.BoundedPgRestoreError) as caught:
                    self.direct_request(request, environment=environment)
                self.assertEqual(caught.exception.reason_code, WRAPPER.REASON_OUTPUT_CAP)
                self.assertEqual(list(self.capture_parent.iterdir()), [])
        self.assertEqual(self.ledger_entries(), [["--version"], ["--version"]])

    def test_child_failure_reason_codes_are_classified_without_raw_stderr(self):
        cases = (
            ("unsupported-version", WRAPPER.REASON_UNSUPPORTED_ARCHIVE_VERSION),
            ("invalid-archive", WRAPPER.REASON_INVALID_ARCHIVE),
            ("invalid-archive-too-short", WRAPPER.REASON_INVALID_ARCHIVE),
            ("truncated-archive", WRAPPER.REASON_TRUNCATED_ARCHIVE),
            ("truncated-short-read", WRAPPER.REASON_TRUNCATED_ARCHIVE),
            ("failure", WRAPPER.REASON_OTHER_NONZERO),
        )
        for mode, reason_code in cases:
            with self.subTest(mode=mode):
                environment = dict(self.environment)
                environment["FAKE_MODE"] = mode
                result = self.run_cli("--list", str(self.archive), environment=environment)
                self.assert_failure_diagnostic(
                    result,
                    reason_code=reason_code,
                )
                self.assertNotIn(b"pg_restore: error:", result.stderr)
                self.assertNotIn(b"CHILD_STDOUT_SENTINEL", result.stderr)
                self.assertNotIn(b"CHILD_STDERR_SENTINEL", result.stderr)

    def test_known_prefix_with_extra_or_binary_private_stderr_is_other_nonzero(self):
        for mode, forbidden in (
            ("unsupported-with-extra-line", b"CHILD_PRIVATE_PATH_SENTINEL"),
            ("invalid-utf8", b"CHILD_BINARY_SENTINEL"),
        ):
            with self.subTest(mode=mode):
                environment = dict(self.environment)
                environment["FAKE_MODE"] = mode
                result = self.run_cli("--list", str(self.archive), environment=environment)
                self.assert_failure_diagnostic(
                    result,
                    reason_code=WRAPPER.REASON_OTHER_NONZERO,
                )
                self.assertNotIn(forbidden, result.stderr)
                self.assertNotIn(b"/private/export.backup", result.stderr)

    def test_list_input_must_be_a_regular_nonsymlink_local_file(self):
        linked = self.root / "linked.backup"
        linked.symlink_to(self.archive)
        directory = self.root / "archive-directory"
        directory.mkdir()
        for candidate in (str(linked), str(directory), str(self.root / "absent.backup")):
            with self.subTest(candidate=candidate):
                result = self.run_cli("--list", candidate)
                self.assert_failure_diagnostic(
                    result,
                    reason_code=WRAPPER.REASON_OTHER_NONZERO,
                )
        self.assertEqual(self.ledger_entries(), [])

    def test_capture_limits_have_no_environment_override(self):
        environment = dict(self.environment)
        environment.update(
            {
                "PG_RESTORE_TIMEOUT_SECONDS": "999999",
                "PG_RESTORE_STDOUT_CAP_BYTES": "999999999999",
                "PG_RESTORE_STDERR_CAP_BYTES": "999999999999",
            }
        )
        request = WRAPPER.parse_request(["--version"])
        self.assertEqual(request.timeout_seconds, WRAPPER.VERSION_TIMEOUT_SECONDS)
        self.assertEqual(request.stdout_cap_bytes, WRAPPER.VERSION_STDOUT_CAP_BYTES)
        self.assertEqual(request.stderr_cap_bytes, WRAPPER.STDERR_CAP_BYTES)
        stdout, stderr = self.direct_request(request, environment=environment)
        self.assertEqual(stdout, b"pg_restore (PostgreSQL) 17.synthetic\n")
        self.assertEqual(stderr, b"")
        self.assertEqual(list(self.capture_parent.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
