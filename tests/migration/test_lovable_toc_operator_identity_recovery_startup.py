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
import tempfile
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


_STDLIB_SHADOW_PROBE = r"""
import importlib
import importlib.util
from pathlib import Path
import sys

driver_path = Path(sys.argv[1]).resolve(strict=True)
fixture_root = Path(sys.argv[2]).resolve(strict=True)
isolated_baseline = tuple(sys.path)
spec = importlib.util.spec_from_file_location(
    "recovery_transitive_shadow_driver", driver_path
)
if spec is None or spec.loader is None:
    raise RuntimeError("driver spec unavailable")
driver = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = driver
saved_argv = sys.argv
sys.argv = [str(driver_path)]
try:
    spec.loader.exec_module(driver)
finally:
    sys.argv = saved_argv

if tuple(sys.path) != isolated_baseline:
    raise RuntimeError("driver retained its reviewed import root")
baseline = isolated_baseline
for module_name in ("binascii", "random", "gettext", "_sha512"):
    for shadow_kind in ("module", "package"):
        case_root = fixture_root / (module_name + "-" + shadow_kind)
        case_root.mkdir()
        marker = case_root / "planted-code-executed"
        planted_source = (
            "with open("
            + repr(str(marker))
            + ", 'wb') as stream:\n"
            + "    stream.write(b'executed')\n"
            + "raise RuntimeError('planted repository shadow executed')\n"
        )
        if shadow_kind == "module":
            shadow_path = case_root / (module_name + ".py")
        else:
            package = case_root / module_name
            package.mkdir()
            shadow_path = package / "__init__.py"
        shadow_path.write_text(planted_source, encoding="ascii")

        sys.modules.pop(module_name, None)
        importlib.invalidate_caches()
        token = driver._append_reviewed_import_root(
            case_root, require_isolated=True
        )
        try:
            loaded = importlib.import_module(module_name)
            module_file = getattr(loaded, "__file__", None)
            spec_origin = getattr(
                getattr(loaded, "__spec__", None), "origin", None
            )
            if not isinstance(module_file, str) or not isinstance(
                spec_origin, str
            ):
                raise RuntimeError("stdlib origin unavailable")
            for raw_origin in (module_file, spec_origin):
                origin = Path(raw_origin).resolve(strict=True)
                if origin == case_root or case_root in origin.parents:
                    raise RuntimeError("repository shadow selected")
        finally:
            driver._remove_reviewed_import_root(token)
            sys.modules.pop(module_name, None)
        if marker.exists():
            raise RuntimeError("planted repository code executed")
        if tuple(sys.path) != baseline:
            raise RuntimeError("reviewed import root was not removed")

sys.stdout.write("transitive_stdlib_shadow_resolution_verified\n")
"""


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

    def test_driver_binds_exact_claude_review_before_repository_import(self):
        guard = (
            "_RECOVERY_BOOTSTRAP_BINDING = "
            "_preimport_recovery_guard()"
        )
        repository_import = (
            "from lib import (  # noqa: E402\n"
            "            lovable_toc_operator_identity_recovery as RECOVERY,"
        )
        import_root_append = (
            "_reviewed_import_token = _append_reviewed_import_root(\n"
            "        SCRIPT.parent,"
        )
        self.assertLess(
            self.driver.index(guard),
            self.driver.index(import_root_append),
        )
        self.assertLess(
            self.driver.index(import_root_append),
            self.driver.index(repository_import),
        )
        for required in (
            "_RECOVERY_REVIEW_NAME_RE.fullmatch(name)",
            "review_matches != [expected_review_name]",
            "_stable_approval(",
            "_validate_bootstrap_review(",
            "_validate_bootstrap_embedded_audit(",
            "_reject_tracked_symlinks(selected_repository)",
            'approval.get("format_version") != 2',
            '_REQUESTED_CLAUDE_MODEL = "fable"',
            '_REQUIRED_CLAUDE_MODEL = "claude-fable-5"',
            '"6a4d3ea4ad2dfeb440efbe9b62c7ae543dc3af428941e85363bc77cf8e49de66"',
            '"required_requested_model": _REQUESTED_CLAUDE_MODEL',
            '"required_effective_model": _REQUIRED_CLAUDE_MODEL',
            '"enforced_git_environment",',
            'invocation["enforced_git_environment"]',
            '_REQUIRED_GIT_ENVIRONMENT = {"GIT_NO_LAZY_FETCH": "1"}',
            '"requested_reasoning_effort": _REQUIRED_REASONING_EFFORT',
            '"model_usage": [_REQUIRED_CLAUDE_MODEL]',
            '"fallback_observed": False',
            '"fresh_session": True',
            'review.get("decision") != "APPROVE FOR MERGE"',
            "spec.count(subject) != 1",
            "prompt\n        != _expected_audit_prompt(",
            '_validate_exact_audit_command(invocation["command"])',
            '"sha256:"',
            "review_sha256=hashlib.sha256(review_data).hexdigest()",
            "review_file_identity=_file_identity(review_metadata)",
            'for relative in (name + ".py", name + "/__init__.py")',
            "baseline != _ISOLATED_STDLIB_PATH",
            "resolved_entry.relative_to(base_prefix)",
            "sys.path.append(root_text)",
            "_require_reviewed_lib_namespace(",
            "_require_reviewed_module_origin(",
            "_remove_reviewed_import_root(_reviewed_import_token)",
            "sys.path_importer_cache.pop(root_text, None)",
            "recovery_review_bootstrap="
            "PREFLIGHT.ApprovalBootstrapBinding(",
        ):
            self.assertIn(required, self.driver)
        self.assertNotIn("sys.path.insert(0", self.driver)
        self.assertLess(
            self.driver.index(
                "_reject_tracked_symlinks(selected_repository)"
            ),
            self.driver.index("matches: list[str] = []"),
        )

    def test_transitive_stdlib_module_and_package_shadows_never_execute(self):
        with tempfile.TemporaryDirectory(
            prefix="recovery-transitive-shadows."
        ) as temporary:
            result = subprocess.run(
                [
                    sys.executable,
                    "-I",
                    "-S",
                    "-B",
                    "-c",
                    _STDLIB_SHADOW_PROBE,
                    os.fspath(RECOVERY_DRIVER),
                    temporary,
                ],
                check=False,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env={
                    "LANG": "C",
                    "LC_ALL": "C",
                    "PATH": "/usr/bin:/bin",
                },
                timeout=30,
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            result.stdout,
            b"transitive_stdlib_shadow_resolution_verified\n",
        )
        self.assertEqual(result.stderr, b"")

    def test_driver_bootstrap_closure_contains_shared_and_v2_contracts(self):
        tree = ast.parse(self.driver)
        reviewed = None
        for node in tree.body:
            if not isinstance(node, ast.Assign):
                continue
            if not any(
                isinstance(target, ast.Name)
                and target.id == "_BOOTSTRAP_REVIEWED_FILES"
                for target in node.targets
            ):
                continue
            self.assertIsInstance(node.value, ast.Call)
            reviewed = frozenset(ast.literal_eval(node.value.args[0]))
            break
        self.assertIsNotNone(reviewed)
        self.assertEqual(len(reviewed), 26)
        self.assertTrue(
            {
                "scripts/migration/lib/lovable_dump_report.py",
                "scripts/migration/verification/"
                "lovable-toc-independent-claude-review-attestation.schema.json",
                "scripts/migration/verification/"
                "lovable-toc-operator-identity-recovery-approval.v2.schema.json",
                "scripts/migration/verification/"
                "lovable-toc-operator-identity-recovery-audit-record.v2.schema.json",
                "scripts/migration/verification/"
                "lovable-toc-operator-identity-recovery-profile.v2.json",
                "scripts/migration/verification/"
                "lovable-toc-operator-identity-recovery-profile.v2.schema.json",
            }.issubset(reviewed)
        )
        # Version 1 remains in the immutable closure for historical
        # reproducibility, but the bootstrap selector above accepts only v2.
        self.assertTrue(
            {
                "scripts/migration/verification/"
                "lovable-toc-operator-identity-recovery-approval.schema.json",
                "scripts/migration/verification/"
                "lovable-toc-operator-identity-recovery-audit-record.schema.json",
                "scripts/migration/verification/"
                "lovable-toc-operator-identity-recovery-profile.v1.json",
                "scripts/migration/verification/"
                "lovable-toc-operator-identity-recovery-profile.schema.json",
            }.issubset(reviewed)
        )

    def test_driver_bootstrap_closure_covers_every_local_python_import(self):
        tree = ast.parse(self.driver)
        assignment = next(
            node
            for node in tree.body
            if isinstance(node, ast.Assign)
            and any(
                isinstance(target, ast.Name)
                and target.id == "_BOOTSTRAP_REVIEWED_FILES"
                for target in node.targets
            )
        )
        reviewed = frozenset(ast.literal_eval(assignment.value.args[0]))
        migration_root = ROOT / "scripts" / "migration"
        discovered: set[str] = set()

        def record_candidate(candidate: Path) -> None:
            if candidate.is_file():
                discovered.add(candidate.relative_to(ROOT).as_posix())

        for relative in sorted(reviewed):
            if not relative.endswith(".py"):
                continue
            source_path = ROOT / relative
            source_tree = ast.parse(
                source_path.read_text(encoding="utf-8"),
                filename=relative,
            )
            for node in ast.walk(source_tree):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        if alias.name == "lib" or alias.name.startswith(
                            "lib."
                        ):
                            record_candidate(
                                migration_root
                                / (alias.name.replace(".", "/") + ".py")
                            )
                    continue
                if not isinstance(node, ast.ImportFrom):
                    continue
                if node.level:
                    parent = source_path.parent
                    for _index in range(node.level - 1):
                        parent = parent.parent
                    module_base = parent
                    if node.module:
                        module_base /= node.module.replace(".", "/")
                elif node.module == "lib" or (
                    node.module and node.module.startswith("lib.")
                ):
                    module_base = migration_root / node.module.replace(
                        ".", "/"
                    )
                else:
                    continue
                record_candidate(module_base.with_suffix(".py"))
                if module_base.is_dir() or node.module in {None, "lib"}:
                    for alias in node.names:
                        record_candidate(module_base / (alias.name + ".py"))

        self.assertIn(
            "scripts/migration/lib/lovable_dump_report.py",
            discovered,
        )
        self.assertTrue(
            discovered.issubset(reviewed),
            sorted(discovered - reviewed),
        )

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
