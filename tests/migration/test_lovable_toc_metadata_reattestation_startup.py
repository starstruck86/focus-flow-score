from __future__ import annotations

import errno
import hashlib
import json
import os
import pty
import select
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "scripts/migration"
LAUNCHER = MIGRATION / "run-lovable-toc-capture-metadata-reattestation.sh"
PROBE = MIGRATION / "probe-lovable-toc-capture-metadata.py"
PYTHON = Path(sys.executable).resolve(strict=True)

from test_lovable_toc_metadata_reattestation import (  # noqa: E402
    MetadataProbeFixture,
    canonical,
    digest,
    tree_snapshot,
)


def wait_status_code(status: int) -> int:
    if os.WIFEXITED(status):
        return os.WEXITSTATUS(status)
    if os.WIFSIGNALED(status):
        return 128 + os.WTERMSIG(status)
    return 255


def run_in_pty(
    executable: Path,
    environment: dict[str, str],
    *,
    arguments: list[str] | None = None,
    timeout_seconds: float = 20,
) -> tuple[int, bytes]:
    argv = [os.fspath(executable), *(arguments or [])]
    pid, master_fd = pty.fork()
    if pid == 0:
        try:
            child_environment = dict(environment)
            output_identity = os.fstat(1)
            if child_environment.get("TOC_REATTEST_EXPECTED_OUTPUT_DEVICE") == "AUTO":
                child_environment["TOC_REATTEST_EXPECTED_OUTPUT_DEVICE"] = str(
                    output_identity.st_dev
                )
            if child_environment.get("TOC_REATTEST_EXPECTED_OUTPUT_INODE") == "AUTO":
                child_environment["TOC_REATTEST_EXPECTED_OUTPUT_INODE"] = str(
                    output_identity.st_ino
                )
            os.execve(os.fspath(executable), argv, child_environment)
        except BaseException:
            os._exit(127)
    transcript = bytearray()
    deadline = time.monotonic() + timeout_seconds
    child_status: int | None = None
    try:
        while time.monotonic() < deadline:
            waited, status = os.waitpid(pid, os.WNOHANG)
            if waited == pid:
                child_status = status
            readable, _, _ = select.select([master_fd], [], [], 0.05)
            if readable:
                try:
                    chunk = os.read(master_fd, 8192)
                except OSError as exc:
                    if exc.errno == errno.EIO:
                        chunk = b""
                    else:
                        raise
                if chunk:
                    transcript.extend(chunk)
                elif child_status is not None:
                    break
            elif child_status is not None:
                break
        if child_status is None:
            os.kill(pid, 9)
            _, child_status = os.waitpid(pid, 0)
            raise AssertionError("metadata-probe launcher exceeded test deadline")
        return wait_status_code(child_status), bytes(transcript).replace(b"\r\n", b"\n")
    finally:
        os.close(master_fd)


class LovableTocMetadataReattestationStartupTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="toc-metadata-startup.")
        self.root = Path(self.temporary.name).resolve()
        self.repository = self.root / "synthetic-repository"
        migration = self.repository / "scripts/migration"
        docs = self.repository / "docs/migration"
        migration.mkdir(parents=True, mode=0o700)
        docs.mkdir(parents=True, mode=0o700)
        shutil.copy2(LAUNCHER, migration / LAUNCHER.name)
        shutil.copy2(PROBE, migration / PROBE.name)
        shutil.copy2(MIGRATION / "README.md", migration / "README.md")
        shutil.copy2(ROOT / "docs/migration/migration-runbook.md", docs / "migration-runbook.md")
        self.launcher = migration / LAUNCHER.name
        self.probe = migration / PROBE.name
        subprocess.run(["git", "init", "-q", os.fspath(self.repository)], check=True)
        subprocess.run(["git", "-C", os.fspath(self.repository), "add", "."], check=True)
        subprocess.run(
            [
                "git",
                "-c",
                "user.name=Synthetic Test",
                "-c",
                "user.email=synthetic@example.invalid",
                "-C",
                os.fspath(self.repository),
                "commit",
                "-qm",
                "synthetic metadata probe fixture",
            ],
            check=True,
        )
        self.checkout = subprocess.run(
            ["git", "-C", os.fspath(self.repository), "rev-parse", "HEAD"],
            check=True,
            stdout=subprocess.PIPE,
            text=True,
        ).stdout.strip()
        self.fixture = MetadataProbeFixture(self.root / "private-fixture")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def procedure_identity(self) -> tuple[dict, str]:
        files = {}
        for label, relative in (
            (
                "launcher",
                "scripts/migration/run-lovable-toc-capture-metadata-reattestation.sh",
            ),
            ("probe", "scripts/migration/probe-lovable-toc-capture-metadata.py"),
            ("readme", "scripts/migration/README.md"),
            ("runbook", "docs/migration/migration-runbook.md"),
        ):
            path = self.repository / relative
            blob = subprocess.run(
                [
                    "git",
                    "-C",
                    os.fspath(self.repository),
                    "rev-parse",
                    f"{self.checkout}:{relative}",
                ],
                check=True,
                stdout=subprocess.PIPE,
                text=True,
            ).stdout.strip()
            files[label] = {
                "blob_sha": blob,
                "path": relative,
                "sha256": digest(path.read_bytes()),
            }
        identity = {
            "execution_checkout_sha": self.checkout,
            "files": files,
            "format_version": 1,
        }
        return identity, digest(canonical(identity))

    def supported_environment(self, python: Path = PYTHON) -> dict[str, str]:
        source = self.fixture.environment
        environment = {
            key: value
            for key, value in source.items()
            if key.startswith("TOC_REATTEST_")
            or key
            in {
                "CANDIDATE_DISCLOSURE",
                "CEILINGS_ACCEPTED",
                "NO_RETRY_AFTER_PRIVATE_ACCESS",
            }
        }
        python_metadata = python.stat()
        environment.update(
            {
                "TOC_REATTEST_APPROVED_EXECUTION_CHECKOUT_SHA": self.checkout,
                "TOC_REATTEST_APPROVED_EXECUTION_PYTHON_DEVICE": str(
                    python_metadata.st_dev
                ),
                "TOC_REATTEST_APPROVED_EXECUTION_PYTHON_GID": str(
                    python_metadata.st_gid
                ),
                "TOC_REATTEST_APPROVED_EXECUTION_PYTHON_INODE": str(
                    python_metadata.st_ino
                ),
                "TOC_REATTEST_APPROVED_EXECUTION_PYTHON_MODE": format(
                    stat.S_IMODE(python_metadata.st_mode), "04o"
                ),
                "TOC_REATTEST_APPROVED_EXECUTION_PYTHON_SHA256": digest(
                    python.read_bytes()
                ),
                "TOC_REATTEST_APPROVED_EXECUTION_PYTHON_SIZE_BYTES": str(
                    python_metadata.st_size
                ),
                "TOC_REATTEST_APPROVED_EXECUTION_PYTHON_UID": str(
                    python_metadata.st_uid
                ),
                "TOC_REATTEST_APPROVED_EXECUTION_PYTHON_VERSION": (
                    f"{sys.implementation.name}:{sys.version_info.major}."
                    f"{sys.version_info.minor}.{sys.version_info.micro}"
                ),
                "TOC_REATTEST_EXECUTION_PYTHON": os.fspath(python),
            }
        )
        _, procedure_sha = self.procedure_identity()
        environment["TOC_REATTEST_APPROVED_PROCEDURE_IDENTITY_SHA256"] = procedure_sha
        return environment

    def test_real_isolated_launcher_succeeds_on_exact_synthetic_package(self) -> None:
        environment = self.supported_environment()
        before = tree_snapshot(self.fixture.root)
        status, transcript = run_in_pty(self.launcher, environment)
        self.assertEqual(status, 0, transcript)
        result = json.loads(transcript)
        self.assertEqual(result["status"], "pass")
        self.assertEqual(
            result["recorded_opaque_index_sha256"], digest(self.fixture.index)
        )
        self.assertEqual(before, tree_snapshot(self.fixture.root))

    def test_launcher_rejects_arguments_before_private_access(self) -> None:
        before = tree_snapshot(self.fixture.root)
        status, transcript = run_in_pty(
            self.launcher, self.supported_environment(), arguments=["unexpected"]
        )
        self.assertEqual(status, 1)
        self.assertEqual(json.loads(transcript)["reason"], "input_invalid")
        self.assertEqual(before, tree_snapshot(self.fixture.root))

    def test_pythonpath_sitecustomize_is_viable_but_rejected(self) -> None:
        poison = self.root / "poison"
        poison.mkdir()
        marker = self.root / "poison-executed"
        (poison / "sitecustomize.py").write_text(
            f"from pathlib import Path\nPath({os.fspath(marker)!r}).write_text('x')\n",
            encoding="ascii",
        )
        control_environment = dict(os.environ)
        control_environment["PYTHONPATH"] = os.fspath(poison)
        control = subprocess.run(
            [os.fspath(PYTHON), "-c", "pass"],
            env=control_environment,
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        self.assertEqual(control.returncode, 0)
        self.assertTrue(marker.exists())
        marker.unlink()
        environment = self.supported_environment()
        environment["PYTHONPATH"] = os.fspath(poison)
        before = tree_snapshot(self.fixture.root)
        status, transcript = run_in_pty(self.launcher, environment)
        self.assertEqual(status, 1)
        self.assertEqual(json.loads(transcript)["reason"], "input_invalid")
        self.assertFalse(marker.exists())
        self.assertEqual(before, tree_snapshot(self.fixture.root))

    def test_user_site_pth_and_sitecustomize_poison_do_not_execute(self) -> None:
        userbase = self.root / "userbase"
        site = userbase / "lib" / (
            f"python{sys.version_info.major}.{sys.version_info.minor}"
        ) / "site-packages"
        site.mkdir(parents=True)
        marker = self.root / "pth-executed"
        (site / "synthetic.pth").write_text(
            f"import pathlib; pathlib.Path({os.fspath(marker)!r}).write_text('x')\n",
            encoding="ascii",
        )
        environment = self.supported_environment()
        environment["PYTHONUSERBASE"] = os.fspath(userbase)
        before = tree_snapshot(self.fixture.root)
        status, transcript = run_in_pty(self.launcher, environment)
        self.assertEqual(status, 1)
        self.assertEqual(json.loads(transcript)["reason"], "input_invalid")
        self.assertFalse(marker.exists())
        self.assertEqual(before, tree_snapshot(self.fixture.root))

    def test_native_loader_environment_is_rejected_before_private_access(self) -> None:
        environment = self.supported_environment()
        environment["LD_LIBRARY_PATH"] = os.fspath(
            self.root / "PRIVATE_LOADER_SENTINEL"
        )
        before = tree_snapshot(self.fixture.root)
        status, transcript = run_in_pty(self.launcher, environment)
        self.assertEqual(status, 1)
        self.assertEqual(json.loads(transcript)["reason"], "input_invalid")
        self.assertNotIn(b"PRIVATE_LOADER_SENTINEL", transcript)
        self.assertEqual(before, tree_snapshot(self.fixture.root))

        # macOS may strip DYLD_* before a protected shell starts. Source the
        # launcher from an already-started clean shell after planting the
        # variable so the shell-level guard itself is exercised deterministically.
        source_command = (
            "launcher=$1; set --; "
            "DYLD_LIBRARY_PATH=PRIVATE_LOADER_SENTINEL; "
            "export DYLD_LIBRARY_PATH; . \"$launcher\""
        )
        before = tree_snapshot(self.fixture.root)
        status, transcript = run_in_pty(
            Path("/bin/sh"),
            self.supported_environment(),
            arguments=["-c", source_command, "synthetic-sh", os.fspath(self.launcher)],
        )
        self.assertEqual(status, 1)
        self.assertEqual(json.loads(transcript)["reason"], "input_invalid")
        self.assertNotIn(b"PRIVATE_LOADER_SENTINEL", transcript)
        self.assertEqual(before, tree_snapshot(self.fixture.root))

    def test_dirty_untracked_and_ignored_tool_inputs_fail_before_private_access(self) -> None:
        cases = ("tracked", "untracked", "ignored")
        for case in cases:
            with self.subTest(case=case):
                environment = self.supported_environment()
                target = self.repository / "scripts/migration"
                if case == "tracked":
                    (target / "README.md").write_text("changed\n", encoding="ascii")
                elif case == "untracked":
                    (target / "shadow.py").write_text("PRIVATE_SENTINEL\n", encoding="ascii")
                else:
                    exclude = self.repository / ".git/info/exclude"
                    exclude.write_text("/scripts/migration/shadow.py\n", encoding="ascii")
                    (target / "shadow.py").write_text("PRIVATE_SENTINEL\n", encoding="ascii")
                before = tree_snapshot(self.fixture.root)
                status, transcript = run_in_pty(self.launcher, environment)
                self.assertEqual(status, 1)
                self.assertEqual(
                    json.loads(transcript)["reason"], "repository_binding_mismatch"
                )
                self.assertNotIn(b"PRIVATE_SENTINEL", transcript)
                self.assertEqual(before, tree_snapshot(self.fixture.root))
                subprocess.run(
                    ["git", "-C", os.fspath(self.repository), "checkout", "--", "."],
                    check=True,
                )
                shadow = target / "shadow.py"
                if shadow.exists():
                    shadow.unlink()
                exclude = self.repository / ".git/info/exclude"
                if exclude.exists():
                    exclude.write_text("", encoding="ascii")

    def test_wrong_python_identity_fails_before_private_access(self) -> None:
        for key in (
            "TOC_REATTEST_APPROVED_EXECUTION_PYTHON_SHA256",
            "TOC_REATTEST_APPROVED_EXECUTION_PYTHON_DEVICE",
            "TOC_REATTEST_APPROVED_EXECUTION_PYTHON_INODE",
            "TOC_REATTEST_APPROVED_EXECUTION_PYTHON_SIZE_BYTES",
            "TOC_REATTEST_APPROVED_EXECUTION_PYTHON_UID",
            "TOC_REATTEST_APPROVED_EXECUTION_PYTHON_GID",
            "TOC_REATTEST_APPROVED_EXECUTION_PYTHON_MODE",
            "TOC_REATTEST_APPROVED_EXECUTION_PYTHON_VERSION",
        ):
            with self.subTest(key=key):
                environment = self.supported_environment()
                current = environment[key]
                if key.endswith("SHA256"):
                    environment[key] = "0" * 64
                elif key.endswith("MODE"):
                    environment[key] = "0700"
                elif key.endswith("VERSION"):
                    environment[key] = "cpython:0.0.0"
                else:
                    environment[key] = str(int(current) + 1)
                before = tree_snapshot(self.fixture.root)
                status, transcript = run_in_pty(self.launcher, environment)
                self.assertEqual(status, 1)
                self.assertIn(
                    json.loads(transcript)["reason"],
                    {"binding_mismatch", "input_invalid"},
                )
                self.assertEqual(before, tree_snapshot(self.fixture.root))

    def test_output_binding_and_acknowledgements_fail_before_private_access(self) -> None:
        cases = (
            ("TOC_REATTEST_EXPECTED_OUTPUT_DEVICE", None),
            ("TOC_REATTEST_EXPECTED_OUTPUT_INODE", None),
            ("TOC_REATTEST_EXPECTED_OUTPUT_DEVICE", "999999999"),
            ("TOC_REATTEST_EXPECTED_OUTPUT_INODE", "999999999"),
            ("NO_RETRY_AFTER_PRIVATE_ACCESS", "NOT_ACKNOWLEDGED"),
            ("CANDIDATE_DISCLOSURE", "TOO_BROAD"),
            ("CEILINGS_ACCEPTED", "NOT_ACCEPTED"),
        )
        for key, value in cases:
            with self.subTest(key=key, value=value):
                environment = self.supported_environment()
                if value is None:
                    environment.pop(key)
                else:
                    environment[key] = value
                before = tree_snapshot(self.fixture.root)
                status, transcript = run_in_pty(self.launcher, environment)
                self.assertEqual(status, 1)
                self.assertIn(
                    json.loads(transcript)["reason"],
                    {"binding_mismatch", "input_invalid"},
                )
                self.assertEqual(before, tree_snapshot(self.fixture.root))

    def test_non_tty_and_redirected_output_are_rejected(self) -> None:
        environment = self.supported_environment()
        before = tree_snapshot(self.fixture.root)
        result = subprocess.run(
            [os.fspath(self.launcher)],
            env=environment,
            check=False,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads(result.stdout)["reason"], "binding_mismatch")
        self.assertEqual(result.stderr, b"")
        self.assertEqual(before, tree_snapshot(self.fixture.root))


if __name__ == "__main__":
    unittest.main()
