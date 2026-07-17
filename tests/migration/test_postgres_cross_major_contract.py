from __future__ import annotations

import contextlib
import io
import json
import importlib.util
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
VALIDATOR = ROOT / "scripts/migration/validate-postgres-image-lock.py"
LOCK = ROOT / "scripts/migration/tests/postgres-cross-major-images.lock.json"
INTEGRATION = (
    ROOT
    / "scripts/migration/tests/postgres-cross-major-compatibility.integration.sh"
)
CI = ROOT / ".github/workflows/ci.yml"
FIXED_FAILURE = "postgres_image_lock_failed:invalid_contract\n"
FIXED_FAILURE_BYTES = FIXED_FAILURE.encode("ascii")
POISON = "PLANTED_PATH_SECRET_ROW_SQL_ERROR_SENTINEL"


class PostgresCrossMajorContractTest(unittest.TestCase):
    def assert_fixed_validator_rejection(
        self, result: subprocess.CompletedProcess
    ) -> None:
        expected_empty = b"" if isinstance(result.stdout, bytes) else ""
        expected_failure = (
            FIXED_FAILURE_BYTES if isinstance(result.stderr, bytes) else FIXED_FAILURE
        )
        if not (
            result.returncode == 2
            and result.stdout == expected_empty
            and result.stderr == expected_failure
        ):
            self.fail("validator rejection did not match the fixed safe contract")

    def assert_poison_suppressed(self, *values) -> None:
        def contains_poison(value) -> bool:
            if isinstance(value, bytes):
                return POISON.encode("ascii") in value
            return POISON in value

        if any(contains_poison(value) for value in values):
            self.fail("a planted sentinel escaped the fixed diagnostic boundary")

    def assert_fixed_integration_failure(
        self, result: subprocess.CompletedProcess[str], expected_stderr: str
    ) -> None:
        if not (
            result.returncode != 0
            and result.stdout == ""
            and result.stderr == expected_stderr
        ):
            self.fail("integration failure did not match the fixed safe contract")

    def load_validator_module(self):
        specification = importlib.util.spec_from_file_location(
            "postgres_image_lock_validator_test", VALIDATOR
        )
        self.assertIsNotNone(specification)
        self.assertIsNotNone(specification.loader)
        module = importlib.util.module_from_spec(specification)
        specification.loader.exec_module(module)
        return module

    def run_validator(self, path: Path) -> subprocess.CompletedProcess[bytes]:
        return subprocess.run(
            ["python3", "-B", "-I", str(VALIDATOR), str(path)],
            check=False,
            capture_output=True,
            env=os.environ.copy(),
        )

    def assert_sanitized_rejection(self, raw: bytes) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / f"{POISON}.json"
            path.write_bytes(raw)
            result = self.run_validator(path)
        self.assert_fixed_validator_rejection(result)
        self.assert_poison_suppressed(result.stdout, result.stderr)

    def test_checked_in_lock_is_exact_and_accepted(self) -> None:
        result = self.run_validator(LOCK)
        if result.returncode != 0:
            self.fail("checked-in image lock was rejected")
        self.assertEqual(result.stdout, b"")
        self.assertEqual(result.stderr, b"")

        bindings = subprocess.run(
            [
                "python3",
                "-B",
                "-I",
                str(VALIDATOR),
                str(LOCK),
                "--emit-runtime-bindings",
            ],
            check=False,
            capture_output=True,
            text=True,
            env=os.environ.copy(),
        )
        expected = json.loads(LOCK.read_text(encoding="ascii"))
        if bindings.returncode != 0:
            self.fail("checked-in image lock bindings were rejected")
        self.assertEqual(bindings.stderr, "")
        self.assertEqual(
            bindings.stdout.splitlines(),
            [
                expected["platform"],
                expected["postgres_17_6"]["reference"],
                expected["postgres_18_4"]["reference"],
            ],
        )

    def test_duplicate_unknown_mutable_and_malformed_locks_fail_safely(self) -> None:
        valid = LOCK.read_text(encoding="ascii")
        wrong_nested_primitive = json.loads(valid)
        wrong_nested_primitive["postgres_17_6"] = False
        cases = {
            "duplicate root": valid.replace(
                '"format_version": 1,',
                '"format_version": 999, "format_version": 1,',
                1,
            ),
            "duplicate nested": valid.replace(
                '"official_tag": "docker.io/library/postgres:17.6-bookworm",',
                (
                    '"official_tag": "bad-' + POISON + '", '
                    '"official_tag": "docker.io/library/postgres:17.6-bookworm",'
                ),
                1,
            ),
            "unknown key": valid.replace(
                '"format_version": 1,',
                '"format_version": 1, "migration_readiness": "GREEN",',
                1,
            ),
            "mutable reference": valid.replace(
                "docker.io/library/postgres@sha256:"
                "f3bd19c606e442c3d7bdfa8002e03fe260a1023351e0ea4598032022b68dd6e3",
                "docker.io/library/postgres:17.6-bookworm",
                1,
            ),
            "wrong platform": valid.replace("linux/amd64", "linux/arm64", 1),
            "boolean integer false green": valid.replace(
                '"format_version": 1', '"format_version": true', 1
            ),
            "float integer false green": valid.replace(
                '"format_version": 1', '"format_version": 1.0', 1
            ),
            "wrong root primitive": "[]",
            "wrong nested primitive": json.dumps(wrong_nested_primitive),
            "nonfinite": valid.replace('"format_version": 1', '"format_version": NaN', 1),
            "malformed": '{"format_version":1,"value":"' + POISON,
            "recursive": "[" * 1200 + "0" + "]" * 1200,
        }
        for label, raw in cases.items():
            with self.subTest(label=label):
                self.assert_sanitized_rejection(raw.encode("utf-8"))

    def test_value_error_from_decoder_is_sanitized_as_invalid_lock(self) -> None:
        module = self.load_validator_module()
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / f"{POISON}.json"
            path.write_bytes(LOCK.read_bytes())
            caught_is_invalid = False
            caught_text = ""
            with mock.patch.object(
                module.json, "loads", side_effect=ValueError(POISON)
            ):
                try:
                    module.load_lock(path)
                except BaseException as error:
                    caught_is_invalid = type(error) is module.InvalidLock
                    try:
                        caught_text = str(error)
                    except BaseException:
                        caught_text = POISON
        if not caught_is_invalid:
            self.fail("decoder failure did not collapse to InvalidLock")
        self.assert_poison_suppressed(caught_text)

    def test_close_and_unexpected_failures_emit_only_fixed_diagnostic(self) -> None:
        module = self.load_validator_module()
        real_close = os.close

        def close_then_fail(descriptor: int) -> None:
            real_close(descriptor)
            raise OSError(POISON)

        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / f"{POISON}.json"
            path.write_bytes(LOCK.read_bytes())
            caught_is_invalid = False
            caught_text = ""
            with mock.patch.object(module.os, "close", side_effect=close_then_fail):
                try:
                    module.load_lock(path)
                except BaseException as error:
                    caught_is_invalid = type(error) is module.InvalidLock
                    try:
                        caught_text = str(error)
                    except BaseException:
                        caught_text = POISON
        if not caught_is_invalid:
            self.fail("descriptor-close failure did not collapse to InvalidLock")
        self.assert_poison_suppressed(caught_text)

        stdout = io.StringIO()
        stderr = io.StringIO()
        cli_raised = False
        status = -1
        with mock.patch.object(module, "main", side_effect=RuntimeError(POISON)):
            with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
                try:
                    status = module.cli([str(LOCK)])
                except BaseException:
                    cli_raised = True
        if cli_raised:
            self.fail("unexpected validator failure escaped the CLI boundary")
        synthetic_result = subprocess.CompletedProcess(
            args=[],
            returncode=status,
            stdout=stdout.getvalue(),
            stderr=stderr.getvalue(),
        )
        self.assert_fixed_validator_rejection(synthetic_result)
        self.assert_poison_suppressed(stdout.getvalue(), stderr.getvalue())

    def test_non_ascii_oversized_and_symlink_locks_fail_safely(self) -> None:
        self.assert_sanitized_rejection(b'{"value":"\xff"}')
        self.assert_sanitized_rejection(b"{" + b" " * 5000 + b"}")

        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            target = directory / "target.json"
            target.write_bytes(LOCK.read_bytes())
            link = directory / f"{POISON}.json"
            link.symlink_to(target)
            result = self.run_validator(link)
            hardlink = directory / "hardlink.json"
            os.link(target, hardlink)
            hardlink_result = self.run_validator(hardlink)
        self.assert_fixed_validator_rejection(result)
        self.assert_poison_suppressed(result.stdout, result.stderr)
        self.assert_fixed_validator_rejection(hardlink_result)
        self.assert_poison_suppressed(hardlink_result.stdout, hardlink_result.stderr)

    def test_integration_is_local_private_bounded_and_cleanup_first(self) -> None:
        script = INTEGRATION.read_text(encoding="utf-8")
        for marker in (
            "docker context inspect",
            '"$context_endpoint" == unix:///*',
            "docker network create --internal",
            "assert_no_published_ports_or_volumes",
            "docker network disconnect",
            "{{len .NetworkSettings.Networks}}",
            "ulimit -f 2048",
            "ulimit -f 2048 || exit 70; exec pg_restore --list",
            '"$toc_size" -le "$TOC_CAP_BYTES"',
            "from lib.lovable_toc_contract import DATA_TOC_CLASSES, parse_raw_toc",
            "parse_raw_toc(raw, b\"s\" * 32)",
            "--tmpfs /var/lib/postgresql:rw,nosuid,nodev,noexec,size=16m",
            "docker network rm",
            "container_probe",
            "network_probe",
            "container_id_probe",
            "network_id_probe",
            "verify_container_binding",
            "verify_network_binding",
            "remove_bound_container_if_present",
            "remove_bound_network_if_present",
            'docker rm -f "$id"',
            'docker network rm "$id"',
            "authorize_resource_cleanup_after_absence",
            "resource_cleanup_authorized=1",
            "resource_ownership_indeterminate=1",
            "stage='cleanup_indeterminate'",
            "docker_ready -eq 1 && $resource_cleanup_authorized -eq 1",
            "stage='resource_name_preflight'",
            "--emit-runtime-bindings",
            "readonly PLATFORM PG17_IMAGE PG18_IMAGE",
            "export PYTHONDONTWRITEBYTECODE=1",
            "python3 -B -I",
            "repository_python_residue_snapshot",
            "stage='cleanup_failed'",
        ):
            if marker not in script:
                self.fail("cross-major harness is missing a required safety marker")

        def docker_run_records(source: str) -> str:
            records: list[str] = []
            in_run = False
            for line in source.splitlines():
                if re.search(r"\bdocker run\b", line):
                    in_run = True
                if in_run:
                    records.append(line)
                    if not line.rstrip().endswith("\\"):
                        in_run = False
            return "\n".join(records)

        docker_commands = docker_run_records(script)
        long_publish = re.compile(
            r"(?<![A-Za-z0-9_-])--publish(?:-all)?(?:=|\s|$)"
        )
        short_publish = re.compile(r"(?<!\S)-p")
        short_publish_all = re.compile(r"(?<!\S)-(?!-)[^\s]*P[^\s]*(?=\s|$)")
        if (
            long_publish.search(docker_commands)
            or short_publish.search(docker_commands)
            or short_publish_all.search(docker_commands)
        ):
            self.fail("cross-major harness contains a Docker publish flag")
        planted_publish_mutations = (
            (long_publish, "docker run --publish=5432:5432 image"),
            (long_publish, "docker run --publish-all image"),
            (short_publish, "docker run -p 5432:5432 image"),
            (short_publish, "docker run -p=5432:5432 image"),
            (short_publish, "docker run -p5432:5432 image"),
            (short_publish_all, "docker run -P image"),
            (short_publish_all, "docker run -itP image"),
        )
        for pattern, mutation in planted_publish_mutations:
            if not pattern.search(docker_run_records(mutation)):
                self.fail("a planted Docker publish mutation was not detected")
        if "|| true" in script or "python3 -I" in script:
            self.fail("cross-major harness contains a prohibited fail-open construct")
        lock = json.loads(LOCK.read_text(encoding="ascii"))
        if any(
            lock[key]["reference"] in script
            for key in ("postgres_17_6", "postgres_18_4")
        ):
            self.fail("cross-major harness duplicates a lock-bound image reference")
        try:
            ulimit_position = script.index("ulimit -f 2048 || exit 70")
            restore_position = script.index("exec pg_restore --list")
            trap_position = script.index("trap - EXIT INT TERM HUP")
            success_position = script.index(
                "postgres_cross_major:pg_dump18.4_from_pg17.6=passed"
            )
        except ValueError:
            self.fail("cross-major harness ordering markers are incomplete")
        if ulimit_position >= restore_position or trap_position >= success_position:
            self.fail("cross-major harness safety operations are out of order")

    def test_remote_docker_host_is_rejected_before_docker_invocation(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            fake_bin = root / "bin"
            fake_bin.mkdir()
            ledger = root / "docker-ledger"
            docker = fake_bin / "docker"
            docker.write_text(
                "#!/bin/sh\nprintf '%s\\n' invoked > \"$DOCKER_LEDGER\"\nexit 99\n",
                encoding="ascii",
            )
            docker.chmod(0o700)
            timeout = fake_bin / "timeout"
            timeout.write_text("#!/bin/sh\nexit 99\n", encoding="ascii")
            timeout.chmod(0o700)
            environment = os.environ.copy()
            environment.update(
                {
                    "PATH": f"{fake_bin}:{environment.get('PATH', '')}",
                    "DOCKER_HOST": "tcp://external.invalid:2375",
                    "DOCKER_LEDGER": str(ledger),
                    "TMPDIR": str(root),
                }
            )
            result = subprocess.run(
                ["/bin/bash", str(INTEGRATION)],
                cwd=ROOT,
                env=environment,
                check=False,
                capture_output=True,
                text=True,
            )
            leftovers = list(root.glob("focus-flow-pg-cross-major.*"))
            ledger_exists = ledger.exists()

        self.assert_fixed_integration_failure(
            result, "postgres_cross_major_failed:docker_context\n"
        )
        self.assertFalse(ledger_exists)
        if leftovers:
            self.fail("cross-major harness left a temporary workspace")

    def test_cleanup_resource_probe_errors_cannot_false_green(self) -> None:
        cases = {
            "absent": "postgres_cross_major_failed:image_pull\n",
            "cleanup_error": "postgres_cross_major_failed:cleanup_failed\n",
        }
        for probe_mode, expected_stderr in cases.items():
            with self.subTest(probe_mode=probe_mode):
                with tempfile.TemporaryDirectory() as temporary:
                    root = Path(temporary)
                    fake_bin = root / "bin"
                    fake_bin.mkdir()
                    ledger = root / "docker-ledger"
                    probe_counter = root / "probe-counter"
                    network_name = root / "network-name"
                    container_name = root / "container-name"
                    timeout = fake_bin / "timeout"
                    timeout.write_text(
                        """#!/bin/sh
while [ "$#" -gt 0 ]; do
  case "$1" in
    --signal=*|--kill-after=*) shift ;;
    [0-9]*s) shift; break ;;
    *) break ;;
  esac
done
exec "$@"
""",
                        encoding="ascii",
                    )
                    timeout.chmod(0o700)
                    docker = fake_bin / "docker"
                    docker.write_text(
                        """#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_LEDGER"
case "$1 $2" in
  'context inspect') printf '%s\\n' 'unix:///synthetic-docker.sock'; exit 0 ;;
  'info ') exit 0 ;;
  'pull --platform')
    [ "$PROBE_MODE" = cleanup_error ] && exit 0
    exit 41
    ;;
  'network create')
    for argument in "$@"; do last=$argument; done
    printf '%s\\n' "$last" > "$NETWORK_NAME"
    printf '%064d\\n' 1
    exit 0
    ;;
  'network inspect')
    case "$*" in
      *'{{.Id}}|'*)
        printf '%064d|%s|%s\\n' 1 "$(cat "$NETWORK_NAME")" \
          postgres-cross-major-compatibility
        ;;
      *) printf '%s\\n' false ;;
    esac
    exit 0
    ;;
  'run --detach')
    while [ "$#" -gt 0 ]; do
      if [ "$1" = --name ]; then
        shift
        printf '%s\n' "$1" > "$CONTAINER_NAME"
        break
      fi
      shift
    done
    printf '%064d\n' 3
    exit 0
    ;;
  'container inspect')
    printf '%064d|/%s|%s\n' 3 "$(cat "$CONTAINER_NAME")" \
      postgres-cross-major-compatibility
    exit 0
    ;;
  'inspect --format') printf '%s\n' unsafe; exit 0 ;;
  'container ls'|'network ls')
    count=0
    [ ! -f "$PROBE_COUNTER" ] || count=$(cat "$PROBE_COUNTER")
    count=$((count + 1))
    printf '%s\\n' "$count" > "$PROBE_COUNTER"
    if [ "$PROBE_MODE" = cleanup_error ] && [ "$count" -gt 5 ]; then
      exit 42
    fi
    exit 0
    ;;
esac
exit 42
""",
                        encoding="ascii",
                    )
                    docker.chmod(0o700)
                    environment = os.environ.copy()
                    environment.update(
                        {
                            "PATH": f"{fake_bin}:{environment.get('PATH', '')}",
                            "DOCKER_HOST": "",
                            "DOCKER_LEDGER": str(ledger),
                            "PROBE_COUNTER": str(probe_counter),
                            "PROBE_MODE": probe_mode,
                            "NETWORK_NAME": str(network_name),
                            "CONTAINER_NAME": str(container_name),
                            "TMPDIR": str(root),
                        }
                    )
                    result = subprocess.run(
                        ["/bin/bash", str(INTEGRATION)],
                        cwd=ROOT,
                        env=environment,
                        check=False,
                        capture_output=True,
                        text=True,
                    )
                    leftovers = list(root.glob("focus-flow-pg-cross-major.*"))
                    ledger_text = ledger.read_text(encoding="ascii")

                self.assert_fixed_integration_failure(result, expected_stderr)
                if "container ls" not in ledger_text or "network ls" not in ledger_text:
                    self.fail("fake-Docker probe ledger is incomplete")
                lock = json.loads(LOCK.read_text(encoding="ascii"))
                expected_pull = (
                    "pull --platform "
                    f"{lock['platform']} {lock['postgres_17_6']['reference']}"
                )
                if expected_pull not in ledger_text:
                    self.fail("validated image lock was not bound to the pull command")
                if leftovers:
                    self.fail("cross-major harness left a temporary workspace")

    def test_preexisting_resource_names_are_never_removed(self) -> None:
        for resource_mode in ("container_present", "network_present"):
            with self.subTest(resource_mode=resource_mode):
                with tempfile.TemporaryDirectory() as temporary:
                    root = Path(temporary)
                    fake_bin = root / "bin"
                    fake_bin.mkdir()
                    ledger = root / "docker-ledger"
                    timeout = fake_bin / "timeout"
                    timeout.write_text(
                        """#!/bin/sh
while [ "$#" -gt 0 ]; do
  case "$1" in
    --signal=*|--kill-after=*) shift ;;
    [0-9]*s) shift; break ;;
    *) break ;;
  esac
done
exec "$@"
""",
                        encoding="ascii",
                    )
                    timeout.chmod(0o700)
                    docker = fake_bin / "docker"
                    docker.write_text(
                        """#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_LEDGER"
case "$1 $2" in
  'context inspect') printf '%s\\n' 'unix:///synthetic-docker.sock'; exit 0 ;;
  'info ') exit 0 ;;
  'container ls')
    [ "$RESOURCE_MODE" != container_present ] || printf '%064d\\n' 0
    exit 0
    ;;
  'network ls')
    [ "$RESOURCE_MODE" != network_present ] || printf '%064d\\n' 0
    exit 0
    ;;
esac
exit 42
""",
                        encoding="ascii",
                    )
                    docker.chmod(0o700)
                    environment = os.environ.copy()
                    environment.update(
                        {
                            "PATH": f"{fake_bin}:{environment.get('PATH', '')}",
                            "DOCKER_HOST": "",
                            "DOCKER_LEDGER": str(ledger),
                            "RESOURCE_MODE": resource_mode,
                            "TMPDIR": str(root),
                        }
                    )
                    result = subprocess.run(
                        ["/bin/bash", str(INTEGRATION)],
                        cwd=ROOT,
                        env=environment,
                        check=False,
                        capture_output=True,
                        text=True,
                    )
                    ledger_lines = ledger.read_text(encoding="ascii").splitlines()
                    leftovers = list(root.glob("focus-flow-pg-cross-major.*"))

                self.assert_fixed_integration_failure(
                    result,
                    "postgres_cross_major_failed:resource_name_preflight\n",
                )
                self.assertFalse(any(line.startswith("rm -f ") for line in ledger_lines))
                self.assertFalse(any(line.startswith("network rm ") for line in ledger_lines))
                if leftovers:
                    self.fail("cross-major harness left a temporary workspace")

    def test_post_preflight_foreign_race_is_never_removed(self) -> None:
        bound_network_id = "2" * 64
        for collision_mode in ("network_collision", "container_collision"):
            with self.subTest(collision_mode=collision_mode):
                with tempfile.TemporaryDirectory() as temporary:
                    root = Path(temporary)
                    fake_bin = root / "bin"
                    fake_bin.mkdir()
                    ledger = root / "docker-ledger"
                    network_name = root / "network-name"
                    network_removed = root / "network-removed"
                    timeout = fake_bin / "timeout"
                    timeout.write_text(
                        """#!/bin/sh
while [ "$#" -gt 0 ]; do
  case "$1" in
    --signal=*|--kill-after=*) shift ;;
    [0-9]*s) shift; break ;;
    *) break ;;
  esac
done
exec "$@"
""",
                        encoding="ascii",
                    )
                    timeout.chmod(0o700)
                    docker = fake_bin / "docker"
                    docker.write_text(
                        """#!/bin/sh
printf '%s\\n' "$*" >> "$DOCKER_LEDGER"
case "$1 $2" in
  'context inspect') printf '%s\\n' 'unix:///synthetic-docker.sock'; exit 0 ;;
  'info ') exit 0 ;;
  'pull --platform') exit 0 ;;
  'container ls') exit 0 ;;
  'network create')
    if [ "$COLLISION_MODE" = network_collision ]; then
      exit 41
    fi
    for argument in "$@"; do last=$argument; done
    printf '%s\\n' "$last" > "$NETWORK_NAME"
    printf '%s\\n' "$BOUND_NETWORK_ID"
    exit 0
    ;;
  'network inspect')
    case "$*" in
      *'{{.Id}}|'*)
        printf '%s|%s|%s\\n' "$BOUND_NETWORK_ID" \
          "$(cat "$NETWORK_NAME")" postgres-cross-major-compatibility
        ;;
      *) printf '%s\\n' true ;;
    esac
    exit 0
    ;;
  'network ls')
    case "$*" in
      *"id=$BOUND_NETWORK_ID"*)
        [ -f "$NETWORK_REMOVED" ] || printf '%s\\n' "$BOUND_NETWORK_ID"
        ;;
    esac
    exit 0
    ;;
  'network rm')
    [ "$3" = "$BOUND_NETWORK_ID" ] || exit 42
    : > "$NETWORK_REMOVED"
    exit 0
    ;;
  'run --detach')
    [ "$COLLISION_MODE" = container_collision ] && exit 41
    exit 42
    ;;
esac
exit 42
""",
                        encoding="ascii",
                    )
                    docker.chmod(0o700)
                    environment = os.environ.copy()
                    environment.update(
                        {
                            "PATH": f"{fake_bin}:{environment.get('PATH', '')}",
                            "DOCKER_HOST": "",
                            "DOCKER_LEDGER": str(ledger),
                            "COLLISION_MODE": collision_mode,
                            "BOUND_NETWORK_ID": bound_network_id,
                            "NETWORK_NAME": str(network_name),
                            "NETWORK_REMOVED": str(network_removed),
                            "TMPDIR": str(root),
                        }
                    )
                    result = subprocess.run(
                        ["/bin/bash", str(INTEGRATION)],
                        cwd=ROOT,
                        env=environment,
                        check=False,
                        capture_output=True,
                        text=True,
                    )
                    ledger_lines = ledger.read_text(encoding="ascii").splitlines()
                    leftovers = list(root.glob("focus-flow-pg-cross-major.*"))

                self.assert_fixed_integration_failure(
                    result,
                    "postgres_cross_major_failed:cleanup_indeterminate\n",
                )
                self.assertFalse(any(line.startswith("rm -f ") for line in ledger_lines))
                if collision_mode == "network_collision":
                    self.assertFalse(
                        any(line.startswith("network rm ") for line in ledger_lines)
                    )
                else:
                    if f"network rm {bound_network_id}" not in ledger_lines:
                        self.fail("bound synthetic network was not cleaned by exact ID")
                if leftovers:
                    self.fail("cross-major harness left a temporary workspace")

    def test_archive_and_restore_evidence_is_exact_but_nongeneral(self) -> None:
        script = INTEGRATION.read_text(encoding="utf-8")
        for marker in (
            "newer pg_dump can be loaded into an older server",
            "proves only the exact semantics",
            "PGDMP",
            "Dumped from database version:",
            "Dumped by pg_dump version:",
            "TABLE DATA public synthetic_items",
            "TYPE public synthetic_state",
            "VIEW public synthetic_done",
            "FUNCTION public synthetic_count",
            "SEQUENCE public synthetic_items_id_seq",
            "SYNTHETIC_ROW_PAYLOAD_MUST_NOT_APPEAR_IN_TOC",
            "public.synthetic_count() = 3",
            "attidentity = 'a'",
            "public.synthetic_items_id_seq",
            "restore_to_pg17.6_exact_tested_semantics=passed",
            "restore_to_pg18.4_exact_tested_semantics=passed",
            "pg18_toc_parser=passed",
        ):
            if marker not in script:
                self.fail("cross-major evidence assertion marker is missing")

    def test_ci_runs_static_contract_before_live_fixture(self) -> None:
        workflow = CI.read_text(encoding="utf-8")
        test_command = (
            "python3 -m unittest "
            "tests.migration.test_postgres_cross_major_contract -v"
        )
        live_command = (
            "bash scripts/migration/tests/"
            "postgres-cross-major-compatibility.integration.sh"
        )
        if test_command not in workflow or live_command not in workflow:
            self.fail("CI is missing a required cross-major command")
        if workflow.index(test_command) >= workflow.index(live_command):
            self.fail("CI cross-major commands are ordered unsafely")


if __name__ == "__main__":
    unittest.main()
