from __future__ import annotations

import os
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SYSTEM_GIT = Path("/usr/bin/git")
PYTHON = Path(sys.executable).resolve(strict=True)
ENTRYPOINTS = (
    (
        "capture_driver",
        "capture-lovable-toc-envelope.py",
        b'{"diagnostic_version":1,"reason":"binding_mismatch",'
        b'"stage":"capture_driver","status":"failed"}\n',
        b'{"diagnostic_version":1,"reason":"input_invalid",'
        b'"stage":"capture_driver","status":"failed"}\n',
    ),
    (
        "capture",
        "capture-lovable-toc.py",
        b'{"diagnostic_version":1,"reason":"binding_mismatch",'
        b'"stage":"capture","status":"failed"}\n',
        b'{"diagnostic_version":1,"reason":"input_invalid",'
        b'"stage":"capture","status":"failed"}\n',
    ),
)


class LovableTocPreimportGuardTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="toc-preimport-guard.")
        self.root = Path(self.temporary.name).resolve()
        self.private_input = self.root / "synthetic-private-input"
        self.private_bytes = b"PRIVATE_SYNTHETIC_SENTINEL_MUST_NOT_ESCAPE"
        self.private_input.write_bytes(self.private_bytes)
        self.private_input.chmod(0o400)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _git(
        self,
        repository: Path,
        *arguments: str,
        environment: dict[str, str] | None = None,
    ) -> subprocess.CompletedProcess[bytes]:
        return subprocess.run(
            [str(SYSTEM_GIT), *arguments],
            cwd=repository,
            env=environment,
            check=False,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=20,
        )

    def _checkout(self, label: str, entrypoint_name: str) -> tuple[Path, str]:
        repository = self.root / f"checkout-{label}"
        migration = repository / "scripts/migration"
        library = migration / "lib"
        library.mkdir(parents=True, mode=0o700)
        for relative in (
            f"scripts/migration/{entrypoint_name}",
            "scripts/migration/lib/lovable_toc_contract.py",
            "scripts/migration/lib/lovable_dump_report.py",
        ):
            source = ROOT / relative
            destination = repository / relative
            shutil.copyfile(source, destination)
            destination.chmod(0o500 if destination == migration / entrypoint_name else 0o400)

        self.assertEqual(self._git(repository, "init", "-q").returncode, 0)
        self.assertEqual(
            self._git(repository, "config", "user.name", "Synthetic Test").returncode,
            0,
        )
        self.assertEqual(
            self._git(
                repository, "config", "user.email", "synthetic@example.invalid"
            ).returncode,
            0,
        )
        self.assertEqual(self._git(repository, "add", ".").returncode, 0)
        self.assertEqual(
            self._git(repository, "commit", "-q", "-m", "synthetic fixture").returncode,
            0,
        )
        head = self._git(repository, "rev-parse", "HEAD")
        self.assertEqual(head.returncode, 0)
        return repository, head.stdout.decode("ascii").strip()

    def _poison_python(self, destination: Path, marker_prefix: str) -> tuple[Path, Path, Path]:
        marker = self.root / f"{marker_prefix}-executed"
        leak = self.root / f"{marker_prefix}-leak"
        child = self.root / f"{marker_prefix}-child"
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(
            "import pathlib, subprocess, sys\n"
            f"private = pathlib.Path({os.fspath(self.private_input)!r})\n"
            f"pathlib.Path({os.fspath(leak)!r}).write_bytes(private.read_bytes())\n"
            f"pathlib.Path({os.fspath(marker)!r}).write_text('executed', encoding='ascii')\n"
            f"subprocess.run(['/usr/bin/touch', {os.fspath(child)!r}], check=False)\n"
            f"print({self.private_bytes.decode('ascii')!r})\n"
            f"print({self.private_bytes.decode('ascii')!r}, file=sys.stderr)\n",
            encoding="ascii",
        )
        return marker, leak, child

    def _invoke(
        self,
        repository: Path,
        entrypoint_name: str,
        approved_head: str,
        *,
        extra_environment: dict[str, str] | None = None,
    ) -> subprocess.CompletedProcess[bytes]:
        environment = {
            "LANG": "C",
            "LC_ALL": "C",
            "TOC_REVIEW_APPROVED_EXECUTION_CHECKOUT_SHA": approved_head,
        }
        if extra_environment:
            environment.update(extra_environment)
        return subprocess.run(
            [
                str(PYTHON),
                "-I",
                "-S",
                "-B",
                str(repository / "scripts/migration" / entrypoint_name),
            ],
            cwd=repository,
            env=environment,
            check=False,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=30,
        )

    def _assert_no_poison_effect(
        self,
        result: subprocess.CompletedProcess[bytes],
        expected_stderr: bytes,
        artifacts: tuple[Path, ...],
    ) -> None:
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, b"")
        self.assertEqual(result.stderr, expected_stderr)
        self.assertNotIn(self.private_bytes, result.stdout + result.stderr)
        for artifact in artifacts:
            self.assertFalse(artifact.exists(), artifact.name)
        self.assertEqual(self.private_input.read_bytes(), self.private_bytes)
        self.assertEqual(self.private_input.stat().st_mode & 0o777, 0o400)

    def test_untracked_repository_local_shadows_fail_before_import(self) -> None:
        shadow_names = (
            Path("lib.py"),
            Path("lib/__init__.py"),
            Path("argparse.py"),
        )
        for stage, entrypoint_name, binding_failure, _ in ENTRYPOINTS:
            for shadow_name in shadow_names:
                with self.subTest(stage=stage, shadow=shadow_name.as_posix()):
                    repository, head = self._checkout(
                        f"{stage}-{shadow_name.as_posix().replace('/', '-')}",
                        entrypoint_name,
                    )
                    migration = repository / "scripts/migration"
                    artifacts = self._poison_python(
                        migration / shadow_name,
                        f"{stage}-{shadow_name.as_posix().replace('/', '-')}",
                    )
                    result = self._invoke(repository, entrypoint_name, head)
                    self._assert_no_poison_effect(result, binding_failure, artifacts)

    def test_ignored_repository_local_shadow_fails_before_import(self) -> None:
        for stage, entrypoint_name, binding_failure, _ in ENTRYPOINTS:
            with self.subTest(stage=stage):
                repository, head = self._checkout(
                    f"{stage}-ignored-shadow", entrypoint_name
                )
                exclude = repository / ".git/info/exclude"
                with exclude.open("a", encoding="ascii") as stream:
                    stream.write("/scripts/migration/lib.py\n")
                artifacts = self._poison_python(
                    repository / "scripts/migration/lib.py",
                    f"{stage}-ignored-shadow",
                )
                ordinary_status = self._git(
                    repository,
                    "status",
                    "--porcelain=v1",
                    "--untracked-files=all",
                )
                self.assertEqual(ordinary_status.returncode, 0, ordinary_status.stderr)
                self.assertEqual(ordinary_status.stdout, b"")
                ignored = self._git(
                    repository,
                    "ls-files",
                    "--others",
                    "--ignored",
                    "--exclude-standard",
                    "--",
                    "scripts/migration",
                )
                self.assertEqual(ignored.returncode, 0, ignored.stderr)
                self.assertNotEqual(ignored.stdout, b"")
                result = self._invoke(repository, entrypoint_name, head)
                self._assert_no_poison_effect(result, binding_failure, artifacts)

    def _fsmonitor_hook(self, label: str) -> tuple[Path, tuple[Path, Path, Path]]:
        hook = self.root / f"{label}-fsmonitor"
        marker = self.root / f"{label}-executed"
        leak = self.root / f"{label}-leak"
        child = self.root / f"{label}-child"
        hook.write_text(
            "#!/bin/sh\n"
            f"/bin/cp {shlex.quote(os.fspath(self.private_input))} {shlex.quote(os.fspath(leak))}\n"
            f"/usr/bin/touch {shlex.quote(os.fspath(marker))}\n"
            f"/usr/bin/touch {shlex.quote(os.fspath(child))}\n"
            "exit 0\n",
            encoding="ascii",
        )
        hook.chmod(0o500)
        return hook, (marker, leak, child)

    def _prove_plain_git_executes_hook(
        self,
        repository: Path,
        artifacts: tuple[Path, Path, Path],
        *,
        environment: dict[str, str] | None = None,
    ) -> None:
        result = self._git(
            repository,
            "status",
            "--porcelain=v1",
            "--untracked-files=all",
            environment=environment,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        for artifact in artifacts:
            self.assertTrue(artifact.exists(), artifact.name)
            artifact.unlink()

    def test_local_and_injected_fsmonitor_cannot_execute_in_guard(self) -> None:
        for stage, entrypoint_name, _, input_failure in ENTRYPOINTS:
            for source in ("local", "environment"):
                with self.subTest(stage=stage, source=source):
                    repository, head = self._checkout(
                        f"{stage}-{source}", entrypoint_name
                    )
                    hook, artifacts = self._fsmonitor_hook(f"{stage}-{source}")
                    poison_environment: dict[str, str] = {}
                    control_environment: dict[str, str] | None = None
                    if source == "local":
                        configured = self._git(
                            repository, "config", "core.fsmonitor", str(hook)
                        )
                        self.assertEqual(configured.returncode, 0, configured.stderr)
                    else:
                        poison_environment = {
                            "GIT_CONFIG_COUNT": "1",
                            "GIT_CONFIG_KEY_0": "core.fsmonitor",
                            "GIT_CONFIG_VALUE_0": str(hook),
                        }
                        control_environment = {
                            "LANG": "C",
                            "LC_ALL": "C",
                            "PATH": "/usr/bin:/bin",
                            **poison_environment,
                        }
                    self._prove_plain_git_executes_hook(
                        repository, artifacts, environment=control_environment
                    )
                    result = self._invoke(
                        repository,
                        entrypoint_name,
                        head,
                        extra_environment=poison_environment,
                    )
                    self._assert_no_poison_effect(result, input_failure, artifacts)


if __name__ == "__main__":
    unittest.main()
