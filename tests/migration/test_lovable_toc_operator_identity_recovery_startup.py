#!/usr/bin/env python3
"""Startup-boundary tests for the TOC operator-identity recovery entrypoint."""

from __future__ import annotations

import ast
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest


ROOT = Path(__file__).resolve().parents[2]
ORDINARY_LAUNCHER = (
    ROOT / "scripts/migration/run-lovable-toc-annotation-operator-session.sh"
)
RECOVERY_LAUNCHER = (
    ROOT / "scripts/migration/run-lovable-toc-operator-identity-recovery.sh"
)
RECOVERY_DRIVER = (
    ROOT / "scripts/migration/recover-lovable-toc-operator-identity.py"
)
PREFLIGHT_PATH = (
    ROOT / "scripts/migration/lib/lovable_toc_operator_preflight.py"
)


def _load_preflight():
    spec = importlib.util.spec_from_file_location(
        "lovable_toc_operator_preflight_for_recovery_startup_tests",
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
        ["/bin/sh", "-c", shell, "recovery-startup-test", os.fspath(RECOVERY_LAUNCHER), name],
        check=False,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env={"LANG": "C", "LC_ALL": "C", "PATH": "/usr/bin:/bin"},
        timeout=10,
    )


class RecoveryStartupContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.ordinary = ORDINARY_LAUNCHER.read_text(encoding="utf-8")
        cls.recovery = RECOVERY_LAUNCHER.read_text(encoding="utf-8")
        cls.driver = RECOVERY_DRIVER.read_text(encoding="utf-8")

    def test_launcher_security_flow_is_exact_ordinary_launcher_parity(self):
        normalized = self.ordinary.replace(
            "annotation_operator_session_launcher",
            "toc_operator_identity_recovery_launcher",
        ).replace(
            "author-lovable-toc-operator-session.py",
            "recover-lovable-toc-operator-identity.py",
        )
        self.assertEqual(self.recovery, normalized)

    def test_launcher_rejects_arguments_before_tty_or_driver_access(self):
        result = subprocess.run(
            ["/bin/sh", os.fspath(RECOVERY_LAUNCHER), "unexpected"],
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
            b'"stage":"toc_operator_identity_recovery_launcher",'
            b'"status":"failed"}\n',
        )

    def test_launcher_poison_list_is_complete_and_every_name_rejects(self):
        names = _shell_loop_names(self.recovery, "poison_name")
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
                    b'"stage":"toc_operator_identity_recovery_launcher",'
                    b'"status":"failed"}\n',
                )

    def test_launcher_remote_multiplexer_ide_and_recorder_list_is_complete(self):
        names = _shell_loop_names(self.recovery, "tty_marker_name")
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
                    b'"stage":"toc_operator_identity_recovery_launcher",'
                    b'"status":"failed"}\n',
                )
        self.assertIn('case "${TERM_PROGRAM-}" in', self.recovery)
        self.assertIn("[Vv][Ss][Cc][Oo][Dd][Ee]", self.recovery)
        self.assertIn(
            "[Aa][Pp][Pp][Ll][Ee]_[Tt][Ee][Rr][Mm][Ii][Nn][Aa][Ll]_[Ss][Ss][Hh]",
            self.recovery,
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
        self.assertIn(ordered_fd_contract, self.recovery)
        tail = self.recovery.split("exec /usr/bin/env -i \\\n", 1)[1]
        environment_names = {
            line.strip().split("=", 1)[0]
            for line in tail.splitlines()
            if line.startswith("  ") and "=" in line
        }
        self.assertEqual(environment_names, PREFLIGHT.ALLOWED_ENVIRONMENT_NAMES)
        self.assertIn('"$execution_python" -I -S -B "$driver"', tail)
        self.assertNotIn("PYTHONPATH=", tail)
        self.assertNotIn("PYTHONHOME=", tail)

    def test_direct_driver_without_isolation_has_one_fixed_failure(self):
        result = subprocess.run(
            [sys.executable, os.fspath(RECOVERY_DRIVER)],
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
            b'"stage":"toc_operator_identity_recovery","status":"failed"}\n',
        )
        self.assertNotIn(b"Traceback", result.stderr)

    def test_recovery_entrypoints_do_not_add_or_dispatch_an_authoring_action(self):
        self.assertIn(
            'driver="$script_dir/recover-lovable-toc-operator-identity.py"',
            self.recovery,
        )
        for forbidden in (
            "author-lovable-toc-operator-session.py",
            "run-lovable-toc-annotation-authoring.sh",
            "TOC_AUTHOR_ACTION",
            "operator_action",
            "primary_review",
        ):
            self.assertNotIn(forbidden, self.recovery)

        tree = ast.parse(self.driver)
        exact_action_strings = {
            "initialize",
            "primary_review",
            "revisit_unresolved",
            "relationship_review",
            "data_reference_review",
            "sequence_review",
            "managed_review",
            "manual_conflict_review",
            "peer_review",
            "correction_review",
            "finalize",
        }
        driver_strings = {
            node.value
            for node in ast.walk(tree)
            if isinstance(node, ast.Constant) and isinstance(node.value, str)
        }
        self.assertTrue(exact_action_strings.isdisjoint(driver_strings))
        # The literal "status" is required by fixed public diagnostic JSON; it
        # is not selected through an operator-action prompt or dispatch call.
        self.assertNotIn("operator_action", self.driver)
        self.assertNotIn("ACTION_VALUES", self.driver)
        for forbidden_call in (
            ".run_session(",
            "._run_resume_session(",
            "._run_authorized_action(",
            ".apply_transition(",
        ):
            self.assertNotIn(forbidden_call, self.driver)


if __name__ == "__main__":
    unittest.main()
