#!/usr/bin/env python3
"""Startup-boundary tests for the recovery-metadata probe entrypoint."""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import unittest


ROOT = Path(__file__).resolve().parents[2]
RECOVERY_LAUNCHER = (
    ROOT / "scripts/migration/run-lovable-toc-operator-identity-recovery.sh"
)
METADATA_LAUNCHER = (
    ROOT
    / "scripts/migration/"
    "run-lovable-toc-operator-identity-recovery-metadata-probe.sh"
)
METADATA_DRIVER = (
    ROOT
    / "scripts/migration/"
    "probe-lovable-toc-operator-identity-recovery-metadata.py"
)
PREFLIGHT_PATH = (
    ROOT / "scripts/migration/lib/lovable_toc_operator_preflight.py"
)


def _load_preflight():
    spec = importlib.util.spec_from_file_location(
        "lovable_toc_operator_preflight_for_recovery_metadata_startup_tests",
        PREFLIGHT_PATH,
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("preflight load failed")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


PREFLIGHT = _load_preflight()


def _shell_loop_names(source: str, loop_name: str) -> tuple[str, ...]:
    marker = f"for {loop_name} in \\\n"
    try:
        body = source.split(marker, 1)[1].split("\ndo\n", 1)[0]
    except IndexError as exc:
        raise AssertionError(f"missing reviewed {loop_name} loop") from exc
    return tuple(body.replace("\\\n", " ").split())


def _source_launcher_with_environment(name: str) -> subprocess.CompletedProcess[bytes]:
    shell = (
        'launcher=$1; planted_name=$2; set --; export "$planted_name=planted"; '
        '. "$launcher"'
    )
    return subprocess.run(
        [
            "/bin/sh",
            "-c",
            shell,
            "recovery-metadata-startup-test",
            os.fspath(METADATA_LAUNCHER),
            name,
        ],
        check=False,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env={"LANG": "C", "LC_ALL": "C", "PATH": "/usr/bin:/bin"},
        timeout=10,
    )


class RecoveryMetadataStartupContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.recovery = RECOVERY_LAUNCHER.read_text(encoding="utf-8")
        cls.metadata = METADATA_LAUNCHER.read_text(encoding="utf-8")

    def test_launcher_security_flow_is_exact_recovery_launcher_parity(self):
        normalized = self.recovery.replace(
            "toc_operator_identity_recovery_launcher",
            "toc_operator_identity_recovery_metadata_probe_launcher",
        ).replace(
            "recover-lovable-toc-operator-identity.py",
            "probe-lovable-toc-operator-identity-recovery-metadata.py",
        )
        self.assertEqual(self.metadata, normalized)

    def test_launcher_rejects_arguments_before_tty_or_driver_access(self):
        result = subprocess.run(
            ["/bin/sh", os.fspath(METADATA_LAUNCHER), "unexpected"],
            check=False,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env={
                "LANG": "C",
                "LC_ALL": "C",
                "PATH": "/usr/bin:/bin",
                "TERM": "xterm-256color",
            },
            timeout=10,
        )
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, b"")
        self.assertEqual(
            result.stderr,
            b'{"diagnostic_version":1,"reason":"startup_environment_invalid",'
            b'"stage":"toc_operator_identity_recovery_metadata_probe_launcher",'
            b'"status":"failed"}\n',
        )

    def test_launcher_poison_list_is_complete_and_every_name_rejects(self):
        names = _shell_loop_names(self.metadata, "poison_name")
        self.assertEqual(frozenset(names), PREFLIGHT.POISON_ENVIRONMENT_NAMES)
        self.assertEqual(len(names), len(set(names)))
        for name in names:
            with self.subTest(name=name):
                result = _source_launcher_with_environment(name)
                self.assertEqual(result.returncode, 1)
                self.assertEqual(result.stdout, b"")
                self.assertEqual(
                    result.stderr,
                    b'{"diagnostic_version":1,'
                    b'"reason":"startup_environment_invalid",'
                    b'"stage":"toc_operator_identity_recovery_metadata_probe_launcher",'
                    b'"status":"failed"}\n',
                )

    def test_launcher_remote_multiplexer_ide_and_recorder_list_is_complete(self):
        names = _shell_loop_names(self.metadata, "tty_marker_name")
        self.assertEqual(frozenset(names), PREFLIGHT.TTY_REJECTION_NAMES)
        self.assertEqual(len(names), len(set(names)))
        for name in names:
            with self.subTest(name=name):
                result = _source_launcher_with_environment(name)
                self.assertEqual(result.returncode, 1)
                self.assertEqual(result.stdout, b"")
                self.assertEqual(
                    result.stderr,
                    b'{"diagnostic_version":1,"reason":"tty_invalid",'
                    b'"stage":"toc_operator_identity_recovery_metadata_probe_launcher",'
                    b'"status":"failed"}\n',
                )
        self.assertIn('case "${TERM_PROGRAM-}" in', self.metadata)
        self.assertIn("[Vv][Ss][Cc][Oo][Dd][Ee]", self.metadata)
        self.assertIn(
            "[Aa][Pp][Pp][Ll][Ee]_[Tt][Ee][Rr][Mm][Ii][Nn][Aa][Ll]_[Ss][Ss][Hh]",
            self.metadata,
        )

    def test_launcher_fd_binding_environment_and_isolation_are_exact(self):
        ordered_fd_contract = (
            "[ -t 1 ] && [ -t 2 ] || fail_tty\n"
            "{ command exec 0<>/dev/tty; } 2>/dev/null || fail_tty\n"
            "exec 1>&0 2>&0 || fail_tty\n"
            "[ -t 0 ] && [ -t 1 ] && [ -t 2 ] || fail_tty\n"
            "exec 3<>/dev/tty || fail_tty\n"
            "[ -t 3 ] || fail_tty\n"
        )
        self.assertIn(ordered_fd_contract, self.metadata)
        tail = self.metadata.split("exec /usr/bin/env -i \\\n", 1)[1]
        environment_names = {
            line.strip().split("=", 1)[0]
            for line in tail.splitlines()
            if line.startswith("  ") and "=" in line
        }
        self.assertEqual(environment_names, PREFLIGHT.ALLOWED_ENVIRONMENT_NAMES)
        self.assertIn('"$execution_python" -I -S -B "$driver"', tail)
        for forbidden in (
            "HOME=",
            "PATH=",
            "PYTHONHOME=",
            "PYTHONPATH=",
            "TOC_AUTHOR_",
            "TOC_OPERATOR_SESSION_ROOT",
        ):
            self.assertNotIn(forbidden, tail)

    def test_direct_driver_without_isolation_has_one_fixed_failure(self):
        result = subprocess.run(
            [sys.executable, os.fspath(METADATA_DRIVER)],
            check=False,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env={"LANG": "C", "LC_ALL": "C", "PATH": "/usr/bin:/bin"},
            timeout=10,
        )
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, b"")
        self.assertEqual(
            result.stderr,
            b'{"diagnostic_version":1,'
            b'"reason":"startup_environment_invalid",'
            b'"stage":"toc_operator_identity_recovery_metadata_probe",'
            b'"status":"failed"}\n',
        )
        self.assertNotIn(b"Traceback", result.stderr)

    def test_launcher_has_no_private_path_or_authoring_action_surface(self):
        self.assertIn(
            'driver="$script_dir/'
            'probe-lovable-toc-operator-identity-recovery-metadata.py"',
            self.metadata,
        )
        for forbidden in (
            "MigrationEvidence",
            "migration-approvals",
            "operator_session_root",
            "annotation_root",
            "capture_root",
            "recovery_evidence",
            "author-lovable-toc-operator-session.py",
            "recover-lovable-toc-operator-identity.py",
            "run-lovable-toc-annotation-authoring.sh",
            "TOC_AUTHOR_ACTION",
            "operator_action",
            "VERIFY_ONLY",
            "primary_review",
        ):
            self.assertNotIn(forbidden, self.metadata)


if __name__ == "__main__":
    unittest.main()
