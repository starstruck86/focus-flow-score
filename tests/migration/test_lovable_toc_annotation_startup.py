from __future__ import annotations

import errno
import hashlib
import importlib.util
import json
import os
import pty
import select
import shlex
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import types
import unittest
from unittest import mock
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "scripts" / "migration"
AUTHOR_LAUNCHER = MIGRATION / "run-lovable-toc-annotation-authoring.sh"
VALIDATOR_LAUNCHER = MIGRATION / "run-lovable-toc-ledger-validation.sh"
AUTHOR_COMPONENT = MIGRATION / "author-lovable-toc-annotations.py"
VALIDATOR_COMPONENT = MIGRATION / "validate-lovable-toc-ledger.py"
LOCAL_COMPONENTS = (
    MIGRATION / "lib" / "lovable_dump_report.py",
    MIGRATION / "lib" / "lovable_toc_contract.py",
    MIGRATION / "lib" / "lovable_toc_authoring_contract.py",
    MIGRATION / "verification" / "lovable-toc-annotation-checkpoint.schema.json",
    MIGRATION / "verification" / "lovable-toc-annotation-ledger.schema.json",
)
PYTHON = Path(sys.executable).resolve(strict=True)
TTY_ATTESTATION = "LOCAL_CONTROLLING_TTY_NO_RECORDING_NO_REMOTE_NO_CLIPBOARD"
CHILD_STDOUT_SENTINEL = b"SYNTHETIC_CHILD_STDOUT_PRIVATE_SENTINEL"
CHILD_STDERR_SENTINEL = b"SYNTHETIC_CHILD_STDERR_PRIVATE_SENTINEL"


def load_script(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError("synthetic module load failed")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


AUTHOR = load_script("lovable_toc_annotation_entrypoint", AUTHOR_COMPONENT)
from test_lovable_toc_annotation_authoring import (  # noqa: E402
    immutable_tree_snapshot,
    make_capture_package,
)


def _wait_status_code(status: int) -> int:
    if os.WIFEXITED(status):
        return os.WEXITSTATUS(status)
    if os.WIFSIGNALED(status):
        return 128 + os.WTERMSIG(status)
    return 255


def run_in_pty(
    executable: Path,
    environment: dict[str, str],
    *,
    timeout_seconds: float = 15,
    reply_after_marker: tuple[bytes, bytes] | None = None,
) -> tuple[int, bytes]:
    pid, master_fd = pty.fork()
    if pid == 0:
        try:
            os.execve(os.fspath(executable), [os.fspath(executable)], environment)
        except BaseException:
            os._exit(127)
    transcript = bytearray()
    deadline = time.monotonic() + timeout_seconds
    child_status: int | None = None
    reply_sent = False
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
                    if (
                        reply_after_marker is not None
                        and not reply_sent
                        and reply_after_marker[0] in transcript
                    ):
                        os.write(master_fd, reply_after_marker[1])
                        reply_sent = True
                elif child_status is not None:
                    break
            elif child_status is not None:
                break
        if child_status is None:
            os.kill(pid, 9)
            _, child_status = os.waitpid(pid, 0)
            raise AssertionError("PTY child exceeded fixed test deadline")
        return _wait_status_code(child_status), bytes(transcript)
    finally:
        os.close(master_fd)


class LovableTocAnnotationStartupTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="toc-author-startup.")
        self.root = Path(self.temporary.name).resolve()
        repository = self.root / "synthetic-repository"
        synthetic_migration = repository / "scripts" / "migration"
        synthetic_migration.mkdir(parents=True, mode=0o700)
        for source in (
            AUTHOR_LAUNCHER,
            VALIDATOR_LAUNCHER,
            AUTHOR_COMPONENT,
            VALIDATOR_COMPONENT,
        ):
            shutil.copy2(source, synthetic_migration / source.name)
        for source in LOCAL_COMPONENTS:
            destination = synthetic_migration / source.relative_to(MIGRATION)
            destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            shutil.copy2(source, destination)
        shutil.copy2(MIGRATION / "README.md", synthetic_migration / "README.md")
        runbook_destination = repository / "docs" / "migration" / "migration-runbook.md"
        runbook_destination.parent.mkdir(parents=True, mode=0o700)
        shutil.copy2(ROOT / "docs" / "migration" / "migration-runbook.md", runbook_destination)
        subprocess.run(["git", "init", "-q", os.fspath(repository)], check=True)
        subprocess.run(["git", "-C", os.fspath(repository), "add", "."], check=True)
        subprocess.run(
            [
                "git",
                "-c",
                "user.name=Synthetic Test",
                "-c",
                "user.email=synthetic@example.invalid",
                "-C",
                os.fspath(repository),
                "commit",
                "-qm",
                "synthetic launcher fixture",
            ],
            check=True,
        )
        self.synthetic_checkout = subprocess.run(
            ["git", "-C", os.fspath(repository), "rev-parse", "HEAD"],
            check=True,
            stdout=subprocess.PIPE,
            text=True,
        ).stdout.strip()
        self.author_launcher = synthetic_migration / AUTHOR_LAUNCHER.name
        self.validator_launcher = synthetic_migration / VALIDATOR_LAUNCHER.name
        self.synthetic_migration = synthetic_migration

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _fake_python(self) -> tuple[Path, str, Path]:
        fake = self.root / "reviewed-python"
        environment_ledger = self.root / "child-environment"
        argument_ledger = self.root / "child-arguments"
        fake.write_text(
            "#!/bin/sh\n"
            "[ \"$(ulimit -S -c)\" = 0 ] && [ \"$(ulimit -H -c)\" = 0 ] || exit 95\n"
            "if [ \"$1\" = -I ] && [ \"$2\" = -S ] && [ \"$3\" = -B ] && "
            "[ \"$4\" = -c ] && [ $# -eq 5 ] && [ -z \"${TOC_INTERNAL_COMPONENT_FD-}\" ]; then\n"
            "  printf '%s\\n' cpython:3.12.9\n"
            "  exit 0\n"
            "fi\n"
            "[ \"$1\" = -I ] && [ \"$2\" = -S ] && [ \"$3\" = -B ] && "
            "[ \"$4\" = -c ] && [ $# -eq 5 ] || exit 97\n"
            "[ -n \"${TOC_INTERNAL_COMPONENT_FD-}\" ] || exit 98\n"
            "eval \"test -r /dev/fd/${TOC_INTERNAL_COMPONENT_FD}\" || exit 99\n"
            "if [ -n \"${TOC_AUTHOR_TTY_FD-}\" ]; then eval \"test -t ${TOC_AUTHOR_TTY_FD}\" || exit 96; fi\n"
            f"printf '%s\\n' \"$1\" \"$2\" \"$3\" \"$4\" \"$#\" > {os.fspath(argument_ledger)!r}\n"
            f"/usr/bin/env > {os.fspath(environment_ledger)!r}\n"
            f"printf '%s\\n' {CHILD_STDOUT_SENTINEL.decode('ascii')!r}\n"
            f"printf '%s\\n' {CHILD_STDERR_SENTINEL.decode('ascii')!r} >&2\n"
            "printf '%s\\n' "
            "'{\"diagnostic_version\":1,\"reason\":\"internal_failure\","
            "\"stage\":\"annotation_authoring\",\"status\":\"failed\"}' >&5\n"
            "exit 1\n",
            encoding="ascii",
        )
        fake.chmod(0o500)
        return fake, hashlib.sha256(fake.read_bytes()).hexdigest(), environment_ledger

    def _author_launcher_environment(self, fake: Path, digest: str) -> dict[str, str]:
        return {
            "TOC_AUTHOR_LOCAL_TTY_ATTESTATION": TTY_ATTESTATION,
            "TOC_AUTHOR_EXECUTION_PYTHON": os.fspath(fake),
            "TOC_AUTHOR_APPROVED_EXECUTION_PYTHON_SHA256": digest,
            "TOC_AUTHOR_APPROVED_EXECUTION_PYTHON_VERSION": "cpython:3.12.9",
            "TOC_AUTHOR_APPROVED_EXECUTION_CHECKOUT_SHA": self.synthetic_checkout,
            "TOC_AUTHOR_ACTION": "status",
        }

    def _commit_synthetic_change(self, message: str) -> str:
        repository = self.synthetic_migration.parents[1]
        subprocess.run(["git", "-C", os.fspath(repository), "add", "."], check=True)
        subprocess.run(
            [
                "git",
                "-c",
                "user.name=Synthetic Test",
                "-c",
                "user.email=synthetic@example.invalid",
                "-C",
                os.fspath(repository),
                "commit",
                "-qm",
                message,
            ],
            check=True,
        )
        return subprocess.run(
            ["git", "-C", os.fspath(repository), "rev-parse", "HEAD"],
            check=True,
            stdout=subprocess.PIPE,
            text=True,
        ).stdout.strip()

    def _supported_author_environment(
        self, package: Path, expectations, private_root: Path
    ) -> dict[str, str]:
        python_digest = hashlib.sha256(PYTHON.read_bytes()).hexdigest()
        python_version = (
            f"{sys.implementation.name}:{sys.version_info.major}."
            f"{sys.version_info.minor}.{sys.version_info.micro}"
        )
        return {
            "TOC_AUTHOR_ACTION": "initialize",
            "TOC_AUTHOR_EXECUTION_PYTHON": os.fspath(PYTHON),
            "TOC_AUTHOR_APPROVED_EXECUTION_PYTHON_SHA256": python_digest,
            "TOC_AUTHOR_APPROVED_EXECUTION_PYTHON_VERSION": python_version,
            "TOC_AUTHOR_APPROVED_EXECUTION_CHECKOUT_SHA": self.synthetic_checkout,
            "TOC_AUTHOR_CAPTURE_ROOT": os.fspath(package.parent),
            "TOC_AUTHOR_CAPTURE_NAME": package.name,
            "TOC_AUTHOR_PRIVATE_ROOT": os.fspath(private_root),
            "TOC_AUTHOR_EXPECTED_CAPTURE_MANIFEST_SHA256": expectations.capture_manifest_sha256,
            "TOC_AUTHOR_EXPECTED_RAW_TOC_SHA256": expectations.raw_toc_sha256,
            "TOC_AUTHOR_EXPECTED_OPAQUE_INDEX_SHA256": expectations.opaque_index_sha256,
            "TOC_AUTHOR_EXPECTED_ENTRY_COUNT": str(expectations.entry_count),
            "TOC_AUTHOR_EXPECTED_DATA_REFERENCE_COUNT": str(
                expectations.data_reference_count
            ),
            "TOC_AUTHOR_EVIDENCE_RUN_ID": expectations.evidence_run_id,
            "TOC_AUTHOR_OUTER_SHA256": expectations.outer_archive_sha256,
            "TOC_AUTHOR_INNER_SHA256": expectations.inner_archive_sha256,
            "TOC_AUTHOR_EVIDENCE_MANIFEST_SHA256": expectations.evidence_manifest_sha256,
            "TOC_AUTHOR_INSPECTION_CHECKOUT_SHA": expectations.inspection_checkout_sha,
            "TOC_AUTHOR_INSPECTION_PROCEDURE_SHA256": expectations.inspection_procedure_sha256,
            "TOC_AUTHOR_CAPTURE_EXECUTION_CHECKOUT_SHA": expectations.capture_execution_checkout_sha,
            "TOC_AUTHOR_EXPECTED_CAPTURE_PROCEDURE_IDENTITY_SHA256": expectations.capture_procedure_identity_sha256,
            "TOC_AUTHOR_APPROVED_PG_RESTORE_SHA256": expectations.approved_pg_restore_sha256,
            "TOC_AUTHOR_PRIMARY_OPERATOR_IDENTITY": "Synthetic Primary",
            "TOC_AUTHOR_OPERATOR_IDENTITY": "Synthetic Primary",
            "TOC_AUTHOR_SESSION_IDENTITY": "synthetic-supported-session",
            "TOC_AUTHOR_EXPECTED_HEAD_GENERATION": "0",
            "TOC_AUTHOR_EXPECTED_HEAD_SHA256": "0" * 64,
            "TOC_AUTHOR_EXPECTED_RELEASE_TOKEN": "0" * 64,
            "TOC_AUTHOR_LOCAL_TTY_ATTESTATION": TTY_ATTESTATION,
            "TOC_AUTHOR_FINALIZATION_AUTHORIZATION": "",
        }

    def test_author_launcher_uses_tty_and_minimal_isolated_child_environment(self) -> None:
        fake, digest, ledger = self._fake_python()
        status, transcript = run_in_pty(
            self.author_launcher, self._author_launcher_environment(fake, digest)
        )
        self.assertEqual(status, 1)
        self.assertIn(b'"stage":"annotation_authoring"', transcript)
        if CHILD_STDOUT_SENTINEL in transcript or CHILD_STDERR_SENTINEL in transcript:
            self.fail("unreviewed child output escaped the fixed diagnostic boundary")
        environment = ledger.read_text(encoding="ascii").splitlines()
        keys = {line.split("=", 1)[0] for line in environment}
        for forbidden in (
            "HOME",
            "PYTHONHOME",
            "PYTHONPATH",
            "PYTHONUSERBASE",
            "PYTHONSTARTUP",
            "LD_PRELOAD",
            "DYLD_INSERT_LIBRARIES",
        ):
            self.assertNotIn(forbidden, keys)
        self.assertIn("TOC_AUTHOR_TTY_FD", keys)
        self.assertIn("TOC_AUTHOR_LOCAL_TTY_ATTESTATION", keys)
        arguments = (self.root / "child-arguments").read_text(
            encoding="ascii"
        ).splitlines()
        self.assertEqual(arguments[:4], ["-I", "-S", "-B", "-c"])
        self.assertEqual(arguments[4], "5")

    def test_real_reviewed_python_completes_supported_initialize_through_launcher(self) -> None:
        try:
            ps_probe = subprocess.run(
                ["/bin/ps", "-p", str(os.getpid()), "-o", "comm="],
                check=False,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                timeout=5,
            )
        except OSError:
            self.skipTest("local sandbox denies the reviewed process-ancestry probe")
        if ps_probe.returncode != 0:
            self.skipTest("local sandbox denies the reviewed process-ancestry probe")
        capture_root = self.root / "supported-capture"
        package, expectations, _capture, _entries = make_capture_package(
            capture_root, ["TABLE"]
        )
        private_root = self.root / "supported-private"
        private_root.mkdir(mode=0o700)
        environment = self._supported_author_environment(
            package, expectations, private_root
        )
        status, transcript = run_in_pty(
            self.author_launcher,
            environment,
            timeout_seconds=30,
            reply_after_marker=(
                b"type_resume_values_recorded_to_confirm",
                b"resume_values_recorded\n",
            ),
        )
        self.assertEqual(status, 2)
        if b'"status":"review_required"' not in transcript:
            self.fail("supported launcher did not emit the fixed review-required result")
        if b"resume_release_token=" not in transcript:
            self.fail("supported launcher did not return the private release token")
        self.assertEqual(
            {item.name for item in private_root.iterdir()},
            {"AUTHORING_RELEASED", "checkpoints"},
        )
        checkpoint_names = list((private_root / "checkpoints").iterdir())
        self.assertEqual(len(checkpoint_names), 1)
        self.assertEqual(stat.S_IMODE(checkpoint_names[0].stat().st_mode), 0o400)

    def test_real_launcher_rejects_invalid_initialize_before_private_roots(self) -> None:
        try:
            ps_probe = subprocess.run(
                ["/bin/ps", "-p", str(os.getpid()), "-o", "comm="],
                check=False,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                timeout=5,
            )
        except OSError:
            self.skipTest("local sandbox denies the reviewed process-ancestry probe")
        if ps_probe.returncode != 0:
            self.skipTest("local sandbox denies the reviewed process-ancestry probe")
        poison = "PTY_PREACCESS_PRIVATE_OBJECT_SQL_SECRET_PAYLOAD_SENTINEL"
        capture_root = self.root / "preaccess-capture"
        package, expectations, _capture, _entries = make_capture_package(
            capture_root, ["TABLE"], poison=poison
        )
        private_root = self.root / "preaccess-private"
        private_root.mkdir(mode=0o700)
        capture_before = immutable_tree_snapshot(capture_root)
        private_before = immutable_tree_snapshot(private_root)
        environment = self._supported_author_environment(
            package, expectations, private_root
        )
        environment["TOC_AUTHOR_EXPECTED_HEAD_GENERATION"] = "1"
        environment["TOC_AUTHOR_EXPECTED_HEAD_SHA256"] = "e" * 64

        status, transcript = run_in_pty(
            self.author_launcher, environment, timeout_seconds=30
        )
        self.assertEqual(status, 1)
        visible = json.loads(transcript.replace(b"\r", b"").strip())
        self.assertEqual(
            visible,
            {
                "diagnostic_version": 1,
                "reason": "input_invalid",
                "stage": "annotation_authoring",
                "status": "failed",
            },
        )
        self.assertNotIn(b"\x1b", transcript)
        self.assertNotIn(b"resume_", transcript)
        self.assertNotIn(poison.encode("ascii"), transcript)
        self.assertNotIn(os.fspath(capture_root).encode("utf-8"), transcript)
        self.assertNotIn(os.fspath(private_root).encode("utf-8"), transcript)
        self.assertEqual(immutable_tree_snapshot(capture_root), capture_before)
        self.assertEqual(immutable_tree_snapshot(private_root), private_before)
        self.assertEqual(list(private_root.iterdir()), [])

    def test_non_tty_and_poisoned_startup_fail_before_interpreter(self) -> None:
        fake, digest, ledger = self._fake_python()
        base = self._author_launcher_environment(fake, digest)
        cases = (
            (base, "tty_invalid"),
            ({**base, "PYTHONPATH": os.fspath(self.root)}, "startup_environment_invalid"),
            ({**base, "PYTHONUSERBASE": os.fspath(self.root)}, "startup_environment_invalid"),
            ({**base, "LD_PRELOAD": ""}, "startup_environment_invalid"),
            ({**base, "LD_LIBRARY_PATH": os.fspath(self.root)}, "startup_environment_invalid"),
            ({**base, "LD_AUDIT": ""}, "startup_environment_invalid"),
            ({**base, "SSH_CONNECTION": "synthetic"}, "tty_invalid"),
        )
        for environment, reason in cases:
            with self.subTest(reason=reason):
                result = subprocess.run(
                    [os.fspath(self.author_launcher)],
                    env=environment,
                    check=False,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    timeout=10,
                )
                self.assertEqual(result.returncode, 1)
                self.assertEqual(result.stdout, b"")
                diagnostic = json.loads(result.stderr)
                self.assertEqual(diagnostic["reason"], reason)
                self.assertFalse(ledger.exists())

    def test_viable_python_startup_poison_is_rejected_before_reviewed_python(self) -> None:
        marker = self.root / "poison-executed"
        pythonpath = self.root / "pythonpath-poison"
        pythonpath.mkdir(mode=0o700)
        (pythonpath / "sitecustomize.py").write_text(
            "from pathlib import Path\n"
            f"Path({os.fspath(marker)!r}).write_text('pythonpath', encoding='ascii')\n",
            encoding="ascii",
        )
        userbase = self.root / "userbase"
        user_site_probe = subprocess.run(
            [
                os.fspath(PYTHON),
                "-c",
                "import site; print(site.getusersitepackages())",
            ],
            env={"LANG": "C", "LC_ALL": "C", "PYTHONUSERBASE": os.fspath(userbase)},
            check=True,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=10,
        )
        user_site = Path(user_site_probe.stdout.decode("utf-8").strip())
        user_site.mkdir(parents=True, mode=0o700)
        pth = user_site / "poison.pth"
        pth.write_text(
            "import pathlib; pathlib.Path(%r).write_text('pth', encoding='ascii')\n"
            % os.fspath(marker),
            encoding="ascii",
        )

        # CI-managed interpreters may disable automatic user-site loading.
        # Execute the exact planted modules outside isolation so the controls
        # prove that both payloads are viable on every runner.  The launcher
        # regression below never performs either explicit load and continues
        # to rely only on its reviewed startup boundary.
        controls = (
            (
                pythonpath,
                "import sitecustomize",
                {"PYTHONPATH": os.fspath(pythonpath)},
            ),
            (
                user_site,
                (
                    "import pathlib;"
                    f"exec(pathlib.Path({os.fspath(pth)!r}).read_text(encoding='ascii'),{{}})"
                ),
                {"PYTHONUSERBASE": os.fspath(userbase)},
            ),
        )
        for import_root, statement, poison_environment in controls:
            with self.subTest(positive_control=poison_environment):
                control = subprocess.run(
                    [
                        os.fspath(PYTHON),
                        "-S",
                        "-c",
                        f"import sys;sys.path.insert(0,{os.fspath(import_root)!r});{statement}",
                    ],
                    env={"LANG": "C", "LC_ALL": "C", **poison_environment},
                    check=False,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    timeout=10,
                )
                self.assertEqual(control.returncode, 0)
                self.assertTrue(marker.exists())
                marker.unlink()

        # Replace the .pth file with a user-site sitecustomize positive control.
        pth.unlink()
        (user_site / "sitecustomize.py").write_text(
            "from pathlib import Path\n"
            f"Path({os.fspath(marker)!r}).write_text('user-site', encoding='ascii')\n",
            encoding="ascii",
        )
        control = subprocess.run(
            [
                os.fspath(PYTHON),
                "-S",
                "-c",
                f"import sys;sys.path.insert(0,{os.fspath(user_site)!r});import sitecustomize",
            ],
            env={"LANG": "C", "LC_ALL": "C", "PYTHONUSERBASE": os.fspath(userbase)},
            check=False,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=10,
        )
        self.assertEqual(control.returncode, 0)
        self.assertTrue(marker.exists())
        marker.unlink()

        fake, digest, ledger = self._fake_python()
        rejected = (
            {"PYTHONPATH": os.fspath(pythonpath)},
            {"PYTHONUSERBASE": os.fspath(userbase)},
        )
        for poison_environment in rejected:
            with self.subTest(rejected=poison_environment):
                poisoned = {
                    **self._author_launcher_environment(fake, digest),
                    **poison_environment,
                }
                status, transcript = run_in_pty(self.author_launcher, poisoned)
                self.assertEqual(status, 1)
                self.assertEqual(
                    json.loads(transcript)["reason"], "startup_environment_invalid"
                )
                self.assertFalse(marker.exists())
                self.assertFalse(ledger.exists())

    def test_viable_loader_poison_is_rejected_before_reviewed_child(self) -> None:
        compiler = shutil.which("cc")
        if compiler is None:
            self.fail("reviewed CI image has no C compiler for loader-poison control")
        marker = self.root / "loader-poison-executed"
        source = self.root / "loader-poison.c"
        source.write_text(
            "#include <fcntl.h>\n#include <unistd.h>\n"
            "__attribute__((constructor)) static void poison(void) {\n"
            f"  int fd = open({json.dumps(os.fspath(marker))}, O_WRONLY|O_CREAT|O_TRUNC, 0600);\n"
            "  if (fd >= 0) { (void)write(fd, \"x\", 1); (void)close(fd); }\n"
            "}\n",
            encoding="ascii",
        )
        helper_source = self.root / "loader-helper.c"
        helper_source.write_text("int main(void) { return 0; }\n", encoding="ascii")
        helper = self.root / "loader-helper"
        if sys.platform == "darwin":
            library = self.root / "loader-poison.dylib"
            library_arguments = [compiler, "-dynamiclib", os.fspath(source), "-o", os.fspath(library)]
            variable = "DYLD_INSERT_LIBRARIES"
        else:
            library = self.root / "loader-poison.so"
            library_arguments = [compiler, "-shared", "-fPIC", os.fspath(source), "-o", os.fspath(library)]
            variable = "LD_PRELOAD"
        subprocess.run(
            library_arguments,
            check=True,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=30,
        )
        subprocess.run(
            [compiler, os.fspath(helper_source), "-o", os.fspath(helper)],
            check=True,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=30,
        )
        control = subprocess.run(
            [os.fspath(helper)],
            env={"LANG": "C", "LC_ALL": "C", variable: os.fspath(library)},
            check=False,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=10,
        )
        self.assertEqual(control.returncode, 0)
        if not marker.exists():
            self.fail("viable loader-poison positive control did not execute")
        marker.unlink()

        # Set the already-proved viable variable only after this shell has
        # started, then source the zero-argument launcher. The launcher must
        # reject it without starting any reviewed Python/private-input child.
        command = (
            f"{variable}={shlex.quote(os.fspath(library))}; export {variable}; "
            f". {shlex.quote(os.fspath(self.author_launcher))}"
        )
        rejected = subprocess.run(
            ["/bin/sh", "-c", command],
            env={"LANG": "C", "LC_ALL": "C"},
            check=False,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=10,
        )
        self.assertEqual(rejected.returncode, 1)
        self.assertEqual(rejected.stdout, b"")
        self.assertEqual(
            json.loads(rejected.stderr)["reason"], "startup_environment_invalid"
        )
        if marker.exists():
            self.fail("loader poison executed inside the reviewed launcher boundary")

    def test_known_script_recorder_is_rejected_before_private_input(self) -> None:
        recorder = Path("/usr/bin/script")
        if not recorder.is_file():
            self.fail("reviewed CI image has no /usr/bin/script recorder fixture")
        digest = hashlib.sha256(PYTHON.read_bytes()).hexdigest()
        version = (
            f"{sys.implementation.name}:{sys.version_info.major}."
            f"{sys.version_info.minor}.{sys.version_info.micro}"
        )
        environment = {
            "LANG": "C",
            "LC_ALL": "C",
            "TOC_AUTHOR_ACTION": "status",
            "TOC_AUTHOR_APPROVED_EXECUTION_CHECKOUT_SHA": self.synthetic_checkout,
            "TOC_AUTHOR_APPROVED_EXECUTION_PYTHON_SHA256": digest,
            "TOC_AUTHOR_APPROVED_EXECUTION_PYTHON_VERSION": version,
            "TOC_AUTHOR_EXECUTION_PYTHON": os.fspath(PYTHON),
            "TOC_AUTHOR_LOCAL_TTY_ATTESTATION": TTY_ATTESTATION,
        }
        if sys.platform == "darwin":
            command = [
                os.fspath(recorder),
                "-q",
                "/dev/null",
                os.fspath(self.author_launcher),
            ]
        else:
            command = [
                os.fspath(recorder),
                "-q",
                "-c",
                os.fspath(self.author_launcher),
                "/dev/null",
            ]
        result = subprocess.run(
            command,
            env=environment,
            check=False,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=20,
        )
        combined = result.stdout + result.stderr
        if b'"reason":"tty_invalid"' not in combined:
            self.fail("known record-to-file wrapper reached the private-input boundary")

    def test_wrong_python_identity_and_unsafe_python_paths_fail_before_child(self) -> None:
        fake, digest, ledger = self._fake_python()
        symlink = self.root / "reviewed-python-link"
        symlink.symlink_to(fake)
        cases = (
            {
                **self._author_launcher_environment(fake, digest),
                "TOC_AUTHOR_APPROVED_EXECUTION_PYTHON_SHA256": "0" * 64,
            },
            {
                **self._author_launcher_environment(fake, digest),
                "TOC_AUTHOR_APPROVED_EXECUTION_PYTHON_VERSION": "cpython:3.12.8",
            },
            {
                **self._author_launcher_environment(fake, digest),
                "TOC_AUTHOR_EXECUTION_PYTHON": os.fspath(symlink),
            },
        )
        for environment in cases:
            with self.subTest(environment=environment):
                status, transcript = run_in_pty(self.author_launcher, environment)
                self.assertEqual(status, 1)
                self.assertEqual(
                    json.loads(transcript)["reason"], "execution_python_invalid"
                )
                self.assertFalse(ledger.exists())
        hardlink = self.root / "reviewed-python-hardlink"
        os.link(fake, hardlink)
        status, transcript = run_in_pty(
            self.author_launcher,
            self._author_launcher_environment(fake, digest),
        )
        self.assertEqual(status, 1)
        self.assertEqual(
            json.loads(transcript)["reason"], "execution_python_invalid"
        )
        hardlink.unlink()
        fake.chmod(0o520)
        status, transcript = run_in_pty(
            self.author_launcher,
            self._author_launcher_environment(fake, digest),
        )
        self.assertEqual(status, 1)
        self.assertEqual(
            json.loads(transcript)["reason"], "execution_python_invalid"
        )

    def test_internal_author_and_validator_reject_missing_runtime_flags(self) -> None:
        expected = (
            (AUTHOR_COMPONENT, "annotation_authoring"),
            (VALIDATOR_COMPONENT, "ledger"),
        )
        flag_sets = (
            (),
            ("-S", "-B"),
            ("-I", "-B"),
            ("-I", "-S"),
        )
        for component, stage in expected:
            for flags in flag_sets:
                with self.subTest(stage=stage, flags=flags):
                    result = subprocess.run(
                        [os.fspath(PYTHON), *flags, os.fspath(component)],
                        env={"LANG": "C", "LC_ALL": "C"},
                        check=False,
                        stdin=subprocess.DEVNULL,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        timeout=10,
                    )
                    self.assertEqual(result.returncode, 1)
                    self.assertEqual(result.stdout, b"")
                    self.assertEqual(json.loads(result.stderr)["stage"], stage)
                    self.assertNotIn(b"Traceback", result.stderr)

    def test_direct_missing_flags_reject_before_subprocess_module_shadow(self) -> None:
        shadow = self.root / "module-shadow"
        shadow.mkdir(mode=0o700)
        marker = self.root / "shadow-executed"
        (shadow / "subprocess.py").write_text(
            "from pathlib import Path\n"
            f"Path({os.fspath(marker)!r}).write_text('executed', encoding='ascii')\n",
            encoding="ascii",
        )
        # Positive control: the planted module is viable in an ordinary child.
        control = subprocess.run(
            [os.fspath(PYTHON), "-c", "import subprocess"],
            env={"LANG": "C", "LC_ALL": "C", "PYTHONPATH": os.fspath(shadow)},
            check=False,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=10,
        )
        self.assertEqual(control.returncode, 0)
        self.assertTrue(marker.exists())
        marker.unlink()

        for component in (AUTHOR_COMPONENT, VALIDATOR_COMPONENT):
            with self.subTest(component=component.name):
                result = subprocess.run(
                    [os.fspath(PYTHON), os.fspath(component)],
                    env={
                        "LANG": "C",
                        "LC_ALL": "C",
                        "PYTHONPATH": os.fspath(shadow),
                    },
                    check=False,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    timeout=10,
                )
                self.assertEqual(result.returncode, 1)
                self.assertEqual(result.stdout, b"")
                self.assertNotIn(b"Traceback", result.stderr)
                self.assertFalse(marker.exists())

    def test_supported_launch_preloads_tracked_module_shadow_closure(self) -> None:
        marker = self.root / "tracked-shadow-executed"
        shadow = self.synthetic_migration / "json.py"
        shadow.write_text(
            "from pathlib import Path\n"
            f"Path({os.fspath(marker)!r}).write_text('executed', encoding='ascii')\n",
            encoding="ascii",
        )
        approved = self._commit_synthetic_change("tracked shadow fixture")

        control = subprocess.run(
            [os.fspath(PYTHON), "-c", "import json"],
            env={"LANG": "C", "LC_ALL": "C", "PYTHONPATH": os.fspath(self.synthetic_migration)},
            check=False,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=10,
        )
        self.assertEqual(control.returncode, 0)
        self.assertTrue(marker.exists())
        marker.unlink()

        executable = PYTHON
        digest = hashlib.sha256(executable.read_bytes()).hexdigest()
        version = (
            f"{sys.implementation.name}:{sys.version_info.major}."
            f"{sys.version_info.minor}.{sys.version_info.micro}"
        )
        author_environment = {
            "TOC_AUTHOR_ACTION": "status",
            "TOC_AUTHOR_APPROVED_EXECUTION_CHECKOUT_SHA": approved,
            "TOC_AUTHOR_APPROVED_EXECUTION_PYTHON_SHA256": digest,
            "TOC_AUTHOR_APPROVED_EXECUTION_PYTHON_VERSION": version,
            "TOC_AUTHOR_EXECUTION_PYTHON": os.fspath(executable),
            "TOC_AUTHOR_LOCAL_TTY_ATTESTATION": TTY_ATTESTATION,
        }
        status, transcript = run_in_pty(self.author_launcher, author_environment)
        self.assertEqual(status, 1)
        self.assertFalse(marker.exists())
        self.assertNotIn(b"Traceback", transcript)

        validator = subprocess.run(
            [os.fspath(self.validator_launcher)],
            env={
                "TOC_REVIEW_APPROVED_EXECUTION_CHECKOUT_SHA": approved,
                "TOC_REVIEW_APPROVED_EXECUTION_PYTHON_SHA256": digest,
                "TOC_REVIEW_APPROVED_EXECUTION_PYTHON_VERSION": version,
                "TOC_REVIEW_EXECUTION_PYTHON": os.fspath(executable),
            },
            check=False,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=15,
        )
        self.assertEqual(validator.returncode, 1)
        self.assertFalse(marker.exists())
        self.assertEqual(validator.stdout, b"")
        self.assertNotIn(b"Traceback", validator.stderr)

    def test_preimport_guard_rejects_ordinary_and_ignored_migration_inputs(self) -> None:
        approved = "a" * 40
        cases = (
            ("scripts/migration", False),
            ("scripts/migration", True),
            ("supabase/migrations", False),
            ("supabase/migrations", True),
        )
        for target, ignored in cases:
            with self.subTest(target=target, ignored=ignored):
                def fake_git(_repository, arguments, *, timeout_seconds):
                    del timeout_seconds
                    if arguments == ["rev-parse", "HEAD"]:
                        return approved.encode("ascii") + b"\n"
                    if arguments[:2] == ["status", "--porcelain=v1"]:
                        return b""
                    if arguments[:2] == ["ls-files", "--others"]:
                        is_ignored = "--ignored" in arguments
                        if arguments[-1] == target and is_ignored == ignored:
                            return b"opaque-finding\n"
                        return b""
                    return b""

                with mock.patch.dict(
                    AUTHOR.os.environ,
                    {"TOC_AUTHOR_APPROVED_EXECUTION_CHECKOUT_SHA": approved},
                    clear=True,
                ), mock.patch.object(
                    AUTHOR, "_reviewed_git_bytes", side_effect=fake_git
                ):
                    with self.assertRaises(AUTHOR._ReviewedStartupFailure):
                        AUTHOR._preimport_repository_guard()

    def test_closed_diagnostic_stream_does_not_escape_a_traceback(self) -> None:
        class BrokenStream:
            def write(self, _payload):
                raise BrokenPipeError

            def flush(self):
                raise BrokenPipeError

        with mock.patch.object(AUTHOR, "_validate_tty", side_effect=RuntimeError), mock.patch.object(
            AUTHOR.sys, "stderr", BrokenStream()
        ):
            self.assertEqual(AUTHOR.main(), 1)

    def test_controlled_tty_receives_escaped_context_and_clear_sequence_only(self) -> None:
        sentinel = b"PRIVATE_TOC_CONTEXT_SENTINEL"
        pid, master_fd = pty.fork()
        if pid == 0:
            try:
                os.dup2(0, 3)
                os.dup2(2, 5)
                os.dup2(1, 6)
                tty_fd = 3
                environment = {
                    "TOC_AUTHOR_LOCAL_TTY_ATTESTATION": TTY_ATTESTATION,
                    "TOC_AUTHOR_TTY_FD": str(tty_fd),
                    "TOC_INTERNAL_DIAGNOSTIC_STDERR_FD": "5",
                    "TOC_INTERNAL_DIAGNOSTIC_STDOUT_FD": "6",
                }
                validated = AUTHOR._validate_tty(environment)
                AUTHOR._write_tty(validated, AUTHOR.ENTER_ALTERNATE_SCREEN)
                rendered = AUTHOR._escape_tty_context(
                    sentinel + b"\x1b[31m owner SQL payload"
                )
                AUTHOR._write_tty(validated, rendered)
                AUTHOR._clear_tty_best_effort(validated)
                os.close(tty_fd)
                os._exit(0)
            except BaseException:
                os._exit(91)
        transcript = bytearray()
        child_status: int | None = None
        try:
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                if child_status is None:
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
                    transcript.extend(chunk)
                    if not chunk and child_status is not None:
                        break
                elif child_status is not None:
                    break
            if child_status is None:
                os.kill(pid, 9)
                _, child_status = os.waitpid(pid, 0)
                self.fail("controlled TTY child timed out")
            self.assertEqual(_wait_status_code(child_status), 0)
            if sentinel not in transcript:
                self.fail("controlled TTY did not receive reviewed context")
            if b"\x1b[31m" in transcript:
                self.fail("raw terminal-control sequence reached controlled TTY")
            self.assertIn(AUTHOR.CLEAR_SCREEN, transcript)
            self.assertIn(AUTHOR.ENTER_ALTERNATE_SCREEN, transcript)
            self.assertIn(AUTHOR.LEAVE_ALTERNATE_SCREEN, transcript)
        finally:
            os.close(master_fd)

    def test_private_review_context_uses_only_the_explicit_tty_sink(self) -> None:
        sentinel = b"RAW_NAME_SQL_OWNER_OPAQUE_PATH_SECRET_PAYLOAD_SENTINEL"
        capture = types.SimpleNamespace(
            entries_by_ordinal=(
                types.SimpleNamespace(
                    entry_id="te1_" + "a" * 64,
                    ordinal=0,
                    object_class="TABLE",
                    raw_line=b'1; 0 1 TABLE "' + sentinel + b'" owner',
                ),
            )
        )
        read_fd, write_fd = os.pipe()
        try:
            AUTHOR._show_review_context(write_fd, capture, 0)
            os.close(write_fd)
            write_fd = -1
            private_output = os.read(read_fd, 1024 * 1024)
        finally:
            os.close(read_fd)
            if write_fd >= 0:
                os.close(write_fd)
        if sentinel not in private_output:
            self.fail("controlled private sink did not receive intended context")
        fixed = AUTHOR._fixed_diagnostic(
            status="failed", reason="input_invalid"
        )
        if sentinel in fixed:
            self.fail("private sentinel escaped into a fixed diagnostic")
        self.assertNotIn(b"te1_", fixed)

    def test_validator_launcher_consumes_identity_inputs_and_preserves_fixed_contract(self) -> None:
        fake, digest, ledger = self._fake_python()
        # The fake child emits an authoring failure, but this test is concerned
        # with the launcher's minimal environment and identity boundary.
        environment = {
            "TOC_REVIEW_EXECUTION_PYTHON": os.fspath(fake),
            "TOC_REVIEW_APPROVED_EXECUTION_PYTHON_SHA256": digest,
            "TOC_REVIEW_APPROVED_EXECUTION_PYTHON_VERSION": "cpython:3.12.9",
            "TOC_REVIEW_APPROVED_EXECUTION_CHECKOUT_SHA": self.synthetic_checkout,
        }
        result = subprocess.run(
            [os.fspath(self.validator_launcher)],
            env=environment,
            check=False,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=10,
        )
        self.assertEqual(result.returncode, 1)
        if CHILD_STDOUT_SENTINEL in result.stdout or CHILD_STDERR_SENTINEL in result.stderr:
            self.fail("unreviewed validator-child output escaped the fixed diagnostic boundary")
        child_environment = ledger.read_text(encoding="ascii").splitlines()
        keys = {line.split("=", 1)[0] for line in child_environment}
        self.assertNotIn("TOC_REVIEW_EXECUTION_PYTHON", keys)
        self.assertNotIn("TOC_REVIEW_APPROVED_EXECUTION_PYTHON_SHA256", keys)
        expected_validator = set(
            (
                "TOC_REVIEW_CAPTURE_ROOT",
                "TOC_REVIEW_CAPTURE_NAME",
                "TOC_REVIEW_LEDGER",
                "TOC_REVIEW_OUTPUT_ROOT",
                "TOC_REVIEW_EXPECTED_CAPTURE_MANIFEST_SHA256",
                "TOC_REVIEW_EXPECTED_RAW_TOC_SHA256",
                "TOC_REVIEW_EXPECTED_PROCEDURE_IDENTITY_SHA256",
                "TOC_REVIEW_EVIDENCE_RUN_ID",
                "TOC_REVIEW_OUTER_SHA256",
                "TOC_REVIEW_INNER_SHA256",
                "TOC_REVIEW_EVIDENCE_MANIFEST_SHA256",
                "TOC_REVIEW_INSPECTION_CHECKOUT_SHA",
                "TOC_REVIEW_INSPECTION_PROCEDURE_SHA256",
                "TOC_REVIEW_APPROVED_EXECUTION_CHECKOUT_SHA",
                "TOC_REVIEW_APPROVED_PG_RESTORE_SHA256",
            )
        )
        self.assertEqual(
            keys
            - {
                "LANG",
                "LC_ALL",
                "PWD",
                "SHLVL",
                "_",
                "TOC_INTERNAL_COMPONENT_FD",
                "TOC_INTERNAL_COMPONENT_BLOB",
                "TOC_INTERNAL_COMPONENT_PATH",
                "TOC_INTERNAL_APPROVED_EXECUTION_PYTHON_SHA256",
                "TOC_INTERNAL_APPROVED_EXECUTION_PYTHON_VERSION",
                "TOC_INTERNAL_DIAGNOSTIC_STDERR_FD",
                "TOC_INTERNAL_DIAGNOSTIC_STDOUT_FD",
            },
            expected_validator,
        )
        arguments = (self.root / "child-arguments").read_text(
            encoding="ascii"
        ).splitlines()
        self.assertEqual(arguments[:4], ["-I", "-S", "-B", "-c"])
        self.assertEqual(arguments[4], "5")


if __name__ == "__main__":
    unittest.main()
