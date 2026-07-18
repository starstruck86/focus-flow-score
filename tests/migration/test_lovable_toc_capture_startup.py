from __future__ import annotations

import hashlib
import io
import json
import os
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tests.migration import test_lovable_toc_capture_driver as driver_tests


CAPTURE = driver_tests.CAPTURE
DRIVER = driver_tests.DRIVER


LAUNCHER = ROOT / "scripts/migration/run-lovable-toc-capture.sh"


class BrokenBinaryStream:
    @property
    def buffer(self):
        return self

    def write(self, _payload):
        raise BrokenPipeError


class SinkBinaryStream:
    def __init__(self):
        self.payload = io.BytesIO()

    @property
    def buffer(self):
        return self

    def write(self, payload):
        return self.payload.write(payload)


class TocCaptureLauncherContractTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="toc-capture-startup.")
        self.root = Path(self.temporary.name).resolve()

    def tearDown(self):
        self.temporary.cleanup()

    def test_macos_ci_uses_the_reviewed_system_interpreter_contract(self):
        workflow = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")
        start = workflow.index("  migration-envelope-macos:\n")
        end = workflow.index("  postgres-cross-major-compatibility:\n", start)
        macos_job = workflow[start:end]
        self.assertNotIn("actions/setup-python", macos_job)
        self.assertIn("PATH: /usr/bin:/bin", macos_job)
        self.assertGreaterEqual(macos_job.count("/usr/bin/python3 -I -S -B"), 11)
        for required_guard in (
            "metadata.st_uid in {0, os.geteuid()}",
            "mode & 0o7022 == 0",
            "metadata.st_nlink == 1",
            "sys.flags.isolated == 1",
            "sys.flags.ignore_environment == 1",
            "sys.flags.no_user_site == 1",
            "sys.flags.no_site == 1",
            "sys.flags.dont_write_bytecode == 1",
        ):
            self.assertIn(required_guard, macos_job)

    def test_launcher_requires_absolute_regular_nonsymlink_execution_python(self):
        ledger = self.root / "safe-launcher-ledger"
        fake_python = self.root / "reviewed-python"
        fake_python.write_text(
            "#!/bin/sh\n"
            "if [ \"$1\" = -I ] && [ \"$2\" = -S ] && [ \"$3\" = -B ] && "
            "[ \"$4\" = -c ] && [ $# -eq 5 ]; then\n"
            "  printf '%s\\n' cpython:3.12.9\n"
            "  exit 0\n"
            "fi\n"
            "if [ \"$1\" = -I ] && [ \"$2\" = -S ] && [ \"$3\" = -B ] && "
            "[ \"$(basename -- \"$4\")\" = capture-lovable-toc-envelope.py ] && "
            "[ $# -eq 4 ]; then\n"
            f"  printf '%s\\n' isolated_flags_ok > {str(ledger)!r}\n"
            "  printf '%s\\n' "
            "'{\"annotation_gate\":\"ANNOTATION_REQUIRED\",\"counts\":{\"data_reference_count\":214,\"entry_count\":2354},\"diagnostic_version\":1,\"hashes\":{\"capture_manifest_sha256\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"raw_toc_sha256\":\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\"},\"reason\":\"blocked\",\"restore_command_gate\":\"BLOCKED\",\"restore_planning_gate\":\"BLOCKED\",\"review_gate\":\"REVIEW_REQUIRED\",\"stage\":\"capture_driver\",\"status\":\"review_required\"}'\n"
            "  exit 2\n"
            "fi\n"
            f"printf '%s\\n' unexpected_shape > {str(ledger)!r}\n"
            "exit 91\n",
            encoding="ascii",
        )
        fake_python.chmod(0o500)
        fake_python_sha256 = hashlib.sha256(fake_python.read_bytes()).hexdigest()

        accepted = subprocess.run(
            [str(LAUNCHER)],
            env={
                "TOC_REVIEW_EXECUTION_PYTHON": str(fake_python),
                "TOC_REVIEW_APPROVED_EXECUTION_PYTHON_SHA256": fake_python_sha256,
                "TOC_REVIEW_APPROVED_EXECUTION_PYTHON_VERSION": "cpython:3.12.9",
            },
            check=False,
            capture_output=True,
            timeout=10,
        )
        self.assertEqual(accepted.returncode, 2)
        self.assertIn(b'"status":"review_required"', accepted.stdout)
        self.assertEqual(accepted.stderr, b"")
        self.assertEqual(ledger.read_text(encoding="ascii"), "isolated_flags_ok\n")

        fake_python.chmod(0o775)
        permissive = subprocess.run(
            [str(LAUNCHER)],
            env={
                "TOC_REVIEW_EXECUTION_PYTHON": str(fake_python),
                "TOC_REVIEW_APPROVED_EXECUTION_PYTHON_SHA256": fake_python_sha256,
                "TOC_REVIEW_APPROVED_EXECUTION_PYTHON_VERSION": "cpython:3.12.9",
            },
            check=False,
            capture_output=True,
            timeout=10,
        )
        fake_python.chmod(0o500)
        self.assertEqual(permissive.returncode, 1)
        self.assertEqual(permissive.stdout, b"")
        self.assertEqual(
            json.loads(permissive.stderr),
            {
                "diagnostic_version": 1,
                "reason": "execution_python_invalid",
                "stage": "capture_launcher",
                "status": "failed",
            },
        )
        self.assertEqual(ledger.read_text(encoding="ascii"), "isolated_flags_ok\n")

        symlink = self.root / "python-link"
        symlink.symlink_to(fake_python)
        real_parent = self.root / "real-python-parent"
        real_parent.mkdir(mode=0o700)
        parent_python = real_parent / "reviewed-python"
        parent_python.write_bytes(fake_python.read_bytes())
        parent_python.chmod(0o500)
        symlinked_parent = self.root / "symlinked-python-parent"
        symlinked_parent.symlink_to(real_parent, target_is_directory=True)
        nonexecutable = self.root / "nonexecutable-python"
        nonexecutable.write_bytes(b"synthetic\n")
        nonexecutable.chmod(0o400)
        invalid_values = (
            None,
            "relative-python",
            str(self.root),
            str(symlink),
            str(symlinked_parent / "reviewed-python"),
            str(nonexecutable),
        )
        expected = {
            "diagnostic_version": 1,
            "reason": "execution_python_invalid",
            "stage": "capture_launcher",
            "status": "failed",
        }
        for value in invalid_values:
            with self.subTest(kind="missing" if value is None else "invalid"):
                environment = {}
                if value is not None:
                    environment["TOC_REVIEW_EXECUTION_PYTHON"] = value
                environment["TOC_REVIEW_APPROVED_EXECUTION_PYTHON_SHA256"] = (
                    fake_python_sha256
                )
                environment["TOC_REVIEW_APPROVED_EXECUTION_PYTHON_VERSION"] = (
                    "cpython:3.12.9"
                )
                result = subprocess.run(
                    [str(LAUNCHER)],
                    env=environment,
                    check=False,
                    capture_output=True,
                    timeout=10,
                )
                self.assertEqual(result.returncode, 1)
                self.assertEqual(result.stdout, b"")
                self.assertEqual(json.loads(result.stderr), expected)
                self.assertEqual(
                    ledger.read_text(encoding="ascii"), "isolated_flags_ok\n"
                )

        extra_argument = subprocess.run(
            [str(LAUNCHER), "unexpected-argument"],
            env={
                "TOC_REVIEW_EXECUTION_PYTHON": str(fake_python),
                "TOC_REVIEW_APPROVED_EXECUTION_PYTHON_SHA256": fake_python_sha256,
                "TOC_REVIEW_APPROVED_EXECUTION_PYTHON_VERSION": "cpython:3.12.9",
            },
            check=False,
            capture_output=True,
            timeout=10,
        )
        self.assertEqual(extra_argument.returncode, 1)
        self.assertEqual(extra_argument.stdout, b"")
        self.assertEqual(json.loads(extra_argument.stderr), expected)
        self.assertEqual(ledger.read_text(encoding="ascii"), "isolated_flags_ok\n")

        for label, approved_sha, approved_version in (
            ("wrong_sha", "0" * 64, "cpython:3.12.9"),
            ("wrong_version", fake_python_sha256, "cpython:3.12.8"),
            ("missing_version", fake_python_sha256, None),
        ):
            with self.subTest(label=label):
                environment = {
                    "TOC_REVIEW_EXECUTION_PYTHON": str(fake_python),
                    "TOC_REVIEW_APPROVED_EXECUTION_PYTHON_SHA256": approved_sha,
                }
                if approved_version is not None:
                    environment["TOC_REVIEW_APPROVED_EXECUTION_PYTHON_VERSION"] = (
                        approved_version
                    )
                rejected = subprocess.run(
                    [str(LAUNCHER)],
                    env=environment,
                    check=False,
                    capture_output=True,
                    timeout=10,
                )
                self.assertEqual(rejected.returncode, 1)
                self.assertEqual(rejected.stdout, b"")
                self.assertEqual(json.loads(rejected.stderr), expected)
                self.assertEqual(
                    ledger.read_text(encoding="ascii"), "isolated_flags_ok\n"
                )

    def test_internal_python_components_reject_missing_runtime_flags(self):
        components = (
            (
                "capture_driver",
                ROOT / "scripts/migration/capture-lovable-toc-envelope.py",
                {
                    "diagnostic_version": 1,
                    "reason": "input_invalid",
                    "stage": "capture_driver",
                    "status": "failed",
                },
            ),
            (
                "capture",
                ROOT / "scripts/migration/capture-lovable-toc.py",
                {
                    "diagnostic_version": 1,
                    "reason": "input_invalid",
                    "stage": "capture",
                    "status": "failed",
                },
            ),
            (
                "normalizer",
                ROOT / "scripts/migration/normalize-lovable-export.py",
                {
                    "diagnostic_version": 1,
                    "reason": "input_invalid",
                    "stage": "normalizer",
                    "status": "failed",
                },
            ),
            (
                "bounded_wrapper",
                ROOT / "scripts/migration/bounded-pg-restore.py",
                {"diagnostic_version": 1, "reason": "other_nonzero"},
            ),
        )
        for label, component, expected in components:
            with self.subTest(component=label):
                result = subprocess.run(
                    [str(Path(sys.executable).resolve(strict=True)), str(component)],
                    env={"LANG": "C", "LC_ALL": "C"},
                    check=False,
                    capture_output=True,
                    timeout=10,
                )
                self.assertEqual(result.returncode, 1)
                self.assertEqual(result.stdout, b"")
                self.assertEqual(json.loads(result.stderr), expected)
                self.assertNotIn(b"Traceback", result.stderr)

    def test_launcher_suppresses_post_probe_replacement_and_unreviewed_child_output(self):
        expected_execution_failure = {
            "diagnostic_version": 1,
            "reason": "execution_python_invalid",
            "stage": "capture_launcher",
            "status": "failed",
        }
        expected_child_failure = {
            "diagnostic_version": 1,
            "reason": "child_diagnostic_invalid",
            "stage": "capture_launcher",
            "status": "failed",
        }
        poison = b"PRIVATE_PATH_PAYLOAD_SENTINEL_MUST_NOT_ESCAPE"

        replacing_python = self.root / "replacing-python"
        replacement = self.root / "replacing-python.next"
        replacement_marker = self.root / "replacement-executed"
        replacing_python.write_text(
            "#!/bin/sh\n"
            "if [ \"$4\" = -c ]; then\n"
            "  printf '%s\\n' cpython:3.12.9\n"
            "  /bin/mv \"$0.next\" \"$0\"\n"
            "  exit 0\n"
            "fi\n"
            "exit 90\n",
            encoding="ascii",
        )
        replacement.write_text(
            "#!/bin/sh\n"
            f"/usr/bin/touch {os.fspath(replacement_marker)!r}\n"
            f"printf '%s\\n' {poison.decode('ascii')!r}\n"
            "exit 127\n",
            encoding="ascii",
        )
        replacing_python.chmod(0o500)
        replacement.chmod(0o500)
        approved_sha = hashlib.sha256(replacing_python.read_bytes()).hexdigest()
        replaced = subprocess.run(
            [str(LAUNCHER)],
            env={
                "TOC_REVIEW_EXECUTION_PYTHON": str(replacing_python),
                "TOC_REVIEW_APPROVED_EXECUTION_PYTHON_SHA256": approved_sha,
                "TOC_REVIEW_APPROVED_EXECUTION_PYTHON_VERSION": "cpython:3.12.9",
            },
            check=False,
            capture_output=True,
            timeout=10,
        )
        self.assertEqual(replaced.returncode, 1)
        self.assertEqual(replaced.stdout, b"")
        self.assertEqual(json.loads(replaced.stderr), expected_execution_failure)
        self.assertNotIn(poison, replaced.stdout + replaced.stderr)
        self.assertFalse(replacement_marker.exists())

        raw_child = self.root / "raw-child-python"
        raw_child.write_text(
            "#!/bin/sh\n"
            "if [ \"$4\" = -c ]; then\n"
            "  printf '%s\\n' cpython:3.12.9\n"
            "  exit 0\n"
            "fi\n"
            f"printf '%s\\n' {poison.decode('ascii')!r}\n"
            f"printf '%s\\n' {('/private/' + poison.decode('ascii'))!r} >&2\n"
            "exit 127\n",
            encoding="ascii",
        )
        raw_child.chmod(0o500)
        raw_sha = hashlib.sha256(raw_child.read_bytes()).hexdigest()
        rejected = subprocess.run(
            [str(LAUNCHER)],
            env={
                "TOC_REVIEW_EXECUTION_PYTHON": str(raw_child),
                "TOC_REVIEW_APPROVED_EXECUTION_PYTHON_SHA256": raw_sha,
                "TOC_REVIEW_APPROVED_EXECUTION_PYTHON_VERSION": "cpython:3.12.9",
            },
            check=False,
            capture_output=True,
            timeout=10,
        )
        self.assertEqual(rejected.returncode, 1)
        self.assertEqual(rejected.stdout, b"")
        self.assertEqual(json.loads(rejected.stderr), expected_child_failure)
        self.assertNotIn(poison, rejected.stdout + rejected.stderr)

        oversized_child = self.root / "oversized-child-python"
        oversized_child.write_text(
            "#!/bin/sh\n"
            "if [ \"$4\" = -c ]; then\n"
            "  printf '%s\\n' cpython:3.12.9\n"
            "  exit 0\n"
            "fi\n"
            "i=0\n"
            "while [ \"$i\" -lt 5000 ]; do\n"
            "  printf x\n"
            "  i=$((i + 1))\n"
            "done\n"
            f"printf '%s\\n' {poison.decode('ascii')!r}\n"
            "exit 127\n",
            encoding="ascii",
        )
        oversized_child.chmod(0o500)
        oversized_sha = hashlib.sha256(oversized_child.read_bytes()).hexdigest()
        oversized = subprocess.run(
            [str(LAUNCHER)],
            env={
                "TOC_REVIEW_EXECUTION_PYTHON": str(oversized_child),
                "TOC_REVIEW_APPROVED_EXECUTION_PYTHON_SHA256": oversized_sha,
                "TOC_REVIEW_APPROVED_EXECUTION_PYTHON_VERSION": "cpython:3.12.9",
            },
            check=False,
            capture_output=True,
            timeout=10,
        )
        self.assertEqual(oversized.returncode, 1)
        self.assertEqual(oversized.stdout, b"")
        self.assertEqual(json.loads(oversized.stderr), expected_child_failure)
        self.assertNotIn(poison, oversized.stdout + oversized.stderr)

    def test_nested_wrapper_invocation_is_isolated_and_ordered(self):
        completed = subprocess.CompletedProcess(
            args=[], returncode=0, stdout=b"synthetic", stderr=b""
        )
        with mock.patch.object(
            CAPTURE.subprocess, "run", return_value=completed
        ) as invoked:
            result = CAPTURE._run_bounded(
                Path("/synthetic/reviewed-wrapper.py"),
                Path("/synthetic/pg_restore"),
                ["--version"],
                Path(sys.executable),
                temporary_parent_fd=None,
                temporary_parent=self.root,
            )
        self.assertEqual(result, b"synthetic")
        arguments = invoked.call_args.args[0]
        self.assertEqual(
            arguments,
            [
                sys.executable,
                "-I",
                "-S",
                "-B",
                "/synthetic/reviewed-wrapper.py",
                "--version",
            ],
        )
        self.assertEqual(
            invoked.call_args.kwargs["env"]["LOVABLE_BOUNDED_TEMP_PARENT"],
            str(self.root),
        )
        self.assertEqual(invoked.call_args.kwargs["pass_fds"], ())

    def _write_poison_module(
        self,
        destination: Path,
        *,
        marker: Path,
        leak: Path,
        child_marker: Path,
        sentinel: str,
    ) -> None:
        destination.write_text(
            "import os, pathlib, subprocess, sys\n"
            f"private = pathlib.Path({os.fspath(self.root / 'synthetic-private-input')!r})\n"
            f"pathlib.Path({os.fspath(leak)!r}).write_bytes(private.read_bytes())\n"
            f"pathlib.Path({os.fspath(marker)!r}).write_text('executed', encoding='ascii')\n"
            f"subprocess.Popen(['/usr/bin/touch', {os.fspath(child_marker)!r}]).wait()\n"
            f"print({sentinel!r})\n"
            f"print({sentinel!r}, file=sys.stderr)\n",
            encoding="ascii",
        )

    def test_complete_chain_ignores_user_site_and_pythonpath_startup_poison(self):
        fixture = driver_tests.TocCaptureDriverTest(
            "test_synthetic_zip_to_private_capture_is_end_to_end_and_cleanup_complete"
        )
        fixture.setUp()
        try:
            checkout, canonical, approved_checkout, provenance = (
                fixture.build_real_completed_inspection_package()
            )
            launcher_copy = checkout / "scripts/migration/run-lovable-toc-capture.sh"

            private_input = self.root / "synthetic-private-input"
            private_bytes = b"SYNTHETIC_PRIVATE_INPUT_MUST_NOT_ESCAPE"
            private_input.write_bytes(private_bytes)
            private_input.chmod(0o400)
            sentinel = "SYNTHETIC_STARTUP_SENTINEL_MUST_NOT_ESCAPE"
            user_base = self.root / "user-base"
            query_environment = os.environ | {"PYTHONUSERBASE": str(user_base)}
            user_site_result = subprocess.run(
                [
                    str(Path(sys.executable).resolve()),
                    "-S",
                    "-c",
                    "import site; print(site.getusersitepackages())",
                ],
                env=query_environment,
                check=True,
                capture_output=True,
                text=True,
            )
            user_site = Path(user_site_result.stdout.strip())
            user_site.mkdir(parents=True, mode=0o700)
            pth_marker = self.root / "pth-executed"
            pth_leak = self.root / "pth-leak"
            pth_child = self.root / "pth-child"
            self._write_poison_module(
                user_site / "synthetic_pth_poison.py",
                marker=pth_marker,
                leak=pth_leak,
                child_marker=pth_child,
                sentinel=sentinel,
            )
            (user_site / "synthetic-startup.pth").write_text(
                "import synthetic_pth_poison\n", encoding="ascii"
            )
            site_marker = self.root / "sitecustomize-executed"
            site_leak = self.root / "sitecustomize-leak"
            site_child = self.root / "sitecustomize-child"
            self._write_poison_module(
                user_site / "sitecustomize.py",
                marker=site_marker,
                leak=site_leak,
                child_marker=site_child,
                sentinel=sentinel,
            )
            pythonpath_root = self.root / "pythonpath-poison"
            pythonpath_root.mkdir(mode=0o700)
            path_marker = self.root / "pythonpath-executed"
            path_leak = self.root / "pythonpath-leak"
            path_child = self.root / "pythonpath-child"
            self._write_poison_module(
                pythonpath_root / "sitecustomize.py",
                marker=path_marker,
                leak=path_leak,
                child_marker=path_child,
                sentinel=sentinel,
            )

            control_environment = os.environ | {
                "PYTHONUSERBASE": str(user_base),
            }
            for name in (
                "PYTHONHOME",
                "PYTHONNOUSERSITE",
                "PYTHONPATH",
                "PYTHONSAFEPATH",
            ):
                control_environment.pop(name, None)
            # CI-managed interpreters may disable automatic user-site loading.
            # Execute the exact planted .pth import line and user-site
            # sitecustomize module explicitly so the positive control proves
            # both payloads are viable on every runner; the actual launcher
            # regression below still relies only on Python startup's -I/-S
            # boundary and never performs either explicit load.
            pth_path = user_site / "synthetic-startup.pth"
            control = subprocess.run(
                [
                    str(Path(sys.executable).resolve()),
                    "-S",
                    "-c",
                    (
                        "import pathlib,sys;"
                        f"sys.path.insert(0,{str(user_site)!r});"
                        f"exec(pathlib.Path({str(pth_path)!r}).read_text(encoding='ascii'),{{}});"
                        "import sitecustomize"
                    ),
                ],
                env=control_environment,
                check=False,
                capture_output=True,
                timeout=10,
            )
            if not (
                control.returncode == 0
                and pth_marker.exists()
                and site_marker.exists()
                and pth_child.exists()
                and site_child.exists()
                and pth_leak.read_bytes() == private_bytes
                and site_leak.read_bytes() == private_bytes
                and sentinel.encode("ascii") in control.stdout
                and sentinel.encode("ascii") in control.stderr
            ):
                self.fail("user-site startup poison control did not execute")

            for path in (
                pth_marker,
                pth_leak,
                pth_child,
                site_marker,
                site_leak,
                site_child,
            ):
                path.unlink()
            path_control_environment = os.environ | {
                "PYTHONPATH": str(pythonpath_root),
                "PYTHONNOUSERSITE": "1",
            }
            path_control = subprocess.run(
                [
                    str(Path(sys.executable).resolve()),
                    "-S",
                    "-c",
                    (
                        "import sys;"
                        f"sys.path.insert(0,{str(pythonpath_root)!r});"
                        "import sitecustomize"
                    ),
                ],
                env=path_control_environment,
                check=False,
                capture_output=True,
                timeout=10,
            )
            if not (
                path_control.returncode == 0
                and path_marker.exists()
                and path_child.exists()
                and path_leak.read_bytes() == private_bytes
                and sentinel.encode("ascii") in path_control.stdout
                and sentinel.encode("ascii") in path_control.stderr
            ):
                self.fail("PYTHONPATH startup poison control did not execute")
            for path in (path_marker, path_leak, path_child):
                path.unlink()

            safe_ledger = self.root / "safe-pg-restore-ledger"
            toc = (
                b"; Dumped from database version: 17.6\n"
                b"; Dumped by pg_dump version: 18.4\n"
                + b"".join(
                    (
                        f"{entry}; 0 0 "
                        f"{'TABLE DATA' if entry <= 214 else 'TABLE'} synthetic owner\n"
                    ).encode("ascii")
                    for entry in range(1, 2355)
                )
            )
            fixture.tool.chmod(0o600)
            fixture.tool.write_text(
                f"#!{sys.executable}\n"
                "import pathlib, sys\n"
                f"ledger = pathlib.Path({os.fspath(safe_ledger)!r})\n"
                f"toc = {toc!r}\n"
                "arguments = sys.argv[1:]\n"
                "if arguments == ['--version']:\n"
                "    ledger.open('a', encoding='ascii').write('version_exact\\n')\n"
                "    print('pg_restore (PostgreSQL) 18.4')\n"
                "    raise SystemExit(0)\n"
                "if (len(arguments) == 2 and arguments[0] == '--list' and "
                "pathlib.Path(arguments[1]).name == 'verified-inner.pgdmp'):\n"
                "    ledger.open('a', encoding='ascii').write('list_exact\\n')\n"
                "    sys.stdout.buffer.write(toc)\n"
                "    raise SystemExit(0)\n"
                "ledger.open('a', encoding='ascii').write('unexpected_shape\\n')\n"
                "raise SystemExit(97)\n",
                encoding="ascii",
            )
            fixture.tool.chmod(0o500)

            evidence_run = (
                canonical.parent
                / "migration-inspection-evidence"
                / str(provenance["run_id"])
            )
            outer = provenance["outer_artifact"]["expected_identity"]
            inner = provenance["inner_pgdmp"]
            environment = os.environ | {
                "TOC_REVIEW_CANONICAL_OUTER": str(canonical),
                "TOC_REVIEW_APPROVED_EVIDENCE_RUN_DIRECTORY": str(evidence_run),
                "TOC_REVIEW_PRIVATE_STAGING_ROOT": str(fixture.staging_root),
                "TOC_REVIEW_OUTPUT_ROOT": str(fixture.output_root),
                "TOC_REVIEW_EVIDENCE_RUN_ID": str(provenance["run_id"]),
                "TOC_REVIEW_EXPECTED_ORIGINAL_FILENAME": str(
                    outer["original_filename"]
                ),
                "TOC_REVIEW_UI_EXPORT_OBJECT_NAME": fixture.member_name,
                "TOC_REVIEW_EXPECTED_OUTER_SIZE_BYTES": str(outer["size_bytes"]),
                "TOC_REVIEW_OUTER_SHA256": str(outer["sha256"]),
                "TOC_REVIEW_INNER_SHA256": str(inner["sha256"]),
                "TOC_REVIEW_EVIDENCE_MANIFEST_SHA256": hashlib.sha256(
                    (evidence_run / "evidence-files.json").read_bytes()
                ).hexdigest(),
                "TOC_REVIEW_INSPECTION_CHECKOUT_SHA": str(
                    provenance["execution_checkout_sha"]
                ),
                "TOC_REVIEW_INSPECTION_PROCEDURE_SHA256": str(
                    provenance["procedure_workflow_sha256"]
                ),
                "TOC_REVIEW_APPROVED_EXECUTION_CHECKOUT_SHA": approved_checkout,
                "TOC_REVIEW_EXECUTION_PYTHON": str(Path(sys.executable).resolve()),
                "TOC_REVIEW_APPROVED_EXECUTION_PYTHON_SHA256": hashlib.sha256(
                    Path(sys.executable).resolve().read_bytes()
                ).hexdigest(),
                "TOC_REVIEW_APPROVED_EXECUTION_PYTHON_VERSION": (
                    f"{sys.implementation.name}:{sys.version_info.major}."
                    f"{sys.version_info.minor}.{sys.version_info.micro}"
                ),
                "TOC_REVIEW_PG_RESTORE_BIN": str(fixture.tool),
                "TOC_REVIEW_APPROVED_PG_RESTORE_SHA256": driver_tests.sha256(
                    fixture.tool.read_bytes()
                ),
                "TOC_REVIEW_APPROVED_PG_RESTORE_VERSION": "pg_restore (PostgreSQL) 18.4",
                "TOC_REVIEW_EXPECTED_ENTRY_COUNT": "2354",
                "TOC_REVIEW_EXPECTED_DATA_REFERENCE_COUNT": "214",
                "PYTHONUSERBASE": str(user_base),
                "PYTHONPATH": str(pythonpath_root),
            }
            result = subprocess.run(
                [str(launcher_copy)],
                cwd=checkout,
                env=environment,
                check=False,
                capture_output=True,
                timeout=90,
            )
            if result.returncode != 2 or result.stderr:
                self.fail("isolated complete capture chain failed")
            forbidden_payloads = (sentinel.encode("ascii"), private_bytes)
            if any(
                forbidden in stream
                for forbidden in forbidden_payloads
                for stream in (result.stdout, result.stderr)
            ):
                self.fail("startup poison content escaped the isolated launcher")
            time.sleep(0.3)
            if any(
                path.exists()
                for path in (
                    pth_marker,
                    pth_leak,
                    pth_child,
                    site_marker,
                    site_leak,
                    site_child,
                    path_marker,
                    path_leak,
                    path_child,
                )
            ):
                self.fail("startup poison executed inside the isolated chain")
            self.assertEqual(private_input.read_bytes(), private_bytes)
            self.assertEqual(stat.S_IMODE(private_input.stat().st_mode), 0o400)
            for durable_file in fixture.output_root.rglob("*"):
                if durable_file.is_file() and any(
                    forbidden in durable_file.read_bytes()
                    for forbidden in forbidden_payloads
                ):
                    self.fail("startup poison content escaped into durable evidence")
            if safe_ledger.read_text(encoding="ascii").splitlines() != [
                "version_exact",
                "list_exact",
            ]:
                self.fail("pg_restore invocation ledger was not exact")
        finally:
            fixture.tearDown()


class TocCaptureBrokenStreamTest(unittest.TestCase):
    def test_envelope_entrypoint_handles_closed_success_and_failure_channels(self):
        counts = {"data_reference_count": 214, "entry_count": 2354}
        hashes = {
            "capture_manifest_sha256": "a" * 64,
            "raw_toc_sha256": "b" * 64,
        }
        fallback = SinkBinaryStream()
        with mock.patch.object(
            DRIVER, "execute", return_value=(counts, hashes)
        ), mock.patch.object(sys, "stdout", BrokenBinaryStream()), mock.patch.object(
            sys, "stderr", fallback
        ):
            self.assertEqual(DRIVER.main(), 2)
        self.assertEqual(fallback.payload.getvalue(), b"")
        fallback = SinkBinaryStream()
        with mock.patch.object(
            DRIVER, "execute", side_effect=DRIVER.DriverError("input_invalid")
        ), mock.patch.object(sys, "stdout", fallback), mock.patch.object(
            sys, "stderr", BrokenBinaryStream()
        ):
            self.assertEqual(DRIVER.main(), 1)
        self.assertEqual(fallback.payload.getvalue(), b"")

    def test_low_level_entrypoint_handles_closed_success_and_failure_channels(self):
        counts = {"data_reference_count": 214, "entry_count": 2354}
        hashes = {
            "capture_manifest_sha256": "a" * 64,
            "raw_toc_sha256": "b" * 64,
        }
        fallback = SinkBinaryStream()
        with mock.patch.object(
            CAPTURE, "execute", return_value=(counts, hashes)
        ), mock.patch.object(sys, "stdout", BrokenBinaryStream()), mock.patch.object(
            sys, "stderr", fallback
        ):
            self.assertEqual(CAPTURE.main(), 0)
        self.assertEqual(fallback.payload.getvalue(), b"")
        fallback = SinkBinaryStream()
        with mock.patch.object(
            CAPTURE, "execute", side_effect=CAPTURE.ContractError("input_invalid")
        ), mock.patch.object(sys, "stdout", fallback), mock.patch.object(
            sys, "stderr", BrokenBinaryStream()
        ):
            self.assertEqual(CAPTURE.main(), 1)
        self.assertEqual(fallback.payload.getvalue(), b"")


if __name__ == "__main__":
    unittest.main()
