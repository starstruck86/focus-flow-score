#!/usr/bin/env python3
"""Run the metadata-only pg_restore operations behind fixed resource bounds.

The underlying executable is supplied only through
``LOVABLE_UNDERLYING_PG_RESTORE_BIN``.  This wrapper has no restore mode: its
entire command-line interface is either ``--version`` or ``--list PATH``.
Child output is streamed through bounded, private capture files and is emitted
only after pg_restore exits successfully.
"""

from __future__ import annotations

import dataclasses
import os
import re
import selectors
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
from typing import BinaryIO, Mapping, Sequence


UNDERLYING_ENVIRONMENT_VARIABLE = "LOVABLE_UNDERLYING_PG_RESTORE_BIN"

VERSION_TIMEOUT_SECONDS = 15
LIST_TIMEOUT_SECONDS = 300
VERSION_STDOUT_CAP_BYTES = 1 * 1024 * 1024
LIST_STDOUT_CAP_BYTES = 128 * 1024 * 1024
STDERR_CAP_BYTES = 1 * 1024 * 1024
READ_CHUNK_BYTES = 64 * 1024

REMOTE_PATH_RE = re.compile(r"[A-Za-z][A-Za-z0-9+.-]*://")

REASON_TIMEOUT = "timeout"
REASON_OUTPUT_CAP = "output_cap"
REASON_UNSUPPORTED_ARCHIVE_VERSION = "unsupported_archive_version"
REASON_INVALID_ARCHIVE = "invalid_archive"
REASON_TRUNCATED_ARCHIVE = "truncated_archive"
REASON_OTHER_NONZERO = "other_nonzero"
ALLOWED_REASON_CODES = frozenset(
    {
        REASON_TIMEOUT,
        REASON_OUTPUT_CAP,
        REASON_UNSUPPORTED_ARCHIVE_VERSION,
        REASON_INVALID_ARCHIVE,
        REASON_TRUNCATED_ARCHIVE,
        REASON_OTHER_NONZERO,
    }
)

# These expressions intentionally recognize only complete, C-locale messages
# emitted by PostgreSQL.  Any extra line, path, byte, or unrecognized wording
# falls back to other_nonzero and is never relayed to the caller.
UNSUPPORTED_ARCHIVE_VERSION_RE = re.compile(
    rb"\Apg_restore: error: unsupported version \([0-9]{1,3}\.[0-9]{1,3}\) "
    rb"in file header\n?\Z"
)
INVALID_ARCHIVE_MESSAGES = frozenset(
    {
        b"pg_restore: error: input file does not appear to be a valid archive",
        b"pg_restore: error: input file does not appear to be a valid archive "
        b"(too short?)",
        b"pg_restore: error: input file appears to be a text format dump. "
        b"Please use psql.",
    }
)
TRUNCATED_ARCHIVE_MESSAGES = frozenset(
    {
        b"pg_restore: error: unexpected end of file",
        b"pg_restore: error: could not read from input file: end of file",
        b"pg_restore: error: [custom archiver] could not read from input file: "
        b"end of file",
    }
)
TRUNCATED_ARCHIVE_RE = re.compile(
    rb"\Apg_restore: error: input file is too short "
    rb"\(read [0-9]+, expected [0-9]+\)\Z"
)


class BoundedPgRestoreError(RuntimeError):
    """A private failure represented publicly by one approved reason code."""

    def __init__(self, reason_code: str):
        if reason_code not in ALLOWED_REASON_CODES:
            raise ValueError("unapproved bounded pg_restore reason code")
        self.reason_code = reason_code
        super().__init__(reason_code)


@dataclasses.dataclass(frozen=True)
class Request:
    child_arguments: tuple[str, ...]
    timeout_seconds: float
    stdout_cap_bytes: int
    stderr_cap_bytes: int = STDERR_CAP_BYTES

    def validate_limits(self) -> None:
        for value in (
            self.timeout_seconds,
            self.stdout_cap_bytes,
            self.stderr_cap_bytes,
        ):
            if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0:
                raise BoundedPgRestoreError(REASON_OTHER_NONZERO)

def _validate_list_input(raw_path: str) -> str:
    if not raw_path or REMOTE_PATH_RE.search(raw_path):
        raise BoundedPgRestoreError(REASON_OTHER_NONZERO)
    if not os.path.isabs(raw_path) or raw_path.startswith("//"):
        raise BoundedPgRestoreError(REASON_OTHER_NONZERO)

    try:
        archive_stat = os.lstat(raw_path)
    except OSError as exc:
        raise BoundedPgRestoreError(REASON_OTHER_NONZERO) from exc
    if stat.S_ISLNK(archive_stat.st_mode):
        raise BoundedPgRestoreError(REASON_OTHER_NONZERO)
    if not stat.S_ISREG(archive_stat.st_mode):
        raise BoundedPgRestoreError(REASON_OTHER_NONZERO)
    return raw_path


def parse_request(arguments: Sequence[str]) -> Request:
    if list(arguments) == ["--version"]:
        return Request(
            child_arguments=("--version",),
            timeout_seconds=VERSION_TIMEOUT_SECONDS,
            stdout_cap_bytes=VERSION_STDOUT_CAP_BYTES,
        )
    if len(arguments) == 2 and arguments[0] == "--list":
        archive_path = _validate_list_input(arguments[1])
        return Request(
            child_arguments=("--list", archive_path),
            timeout_seconds=LIST_TIMEOUT_SECONDS,
            stdout_cap_bytes=LIST_STDOUT_CAP_BYTES,
        )
    raise BoundedPgRestoreError(REASON_OTHER_NONZERO)


def validate_underlying_executable(environment: Mapping[str, str]) -> str:
    raw_path = environment.get(UNDERLYING_ENVIRONMENT_VARIABLE)
    if raw_path is None or raw_path == "":
        raise BoundedPgRestoreError(REASON_OTHER_NONZERO)
    if not os.path.isabs(raw_path):
        raise BoundedPgRestoreError(REASON_OTHER_NONZERO)

    try:
        executable_stat = os.lstat(raw_path)
    except OSError as exc:
        raise BoundedPgRestoreError(REASON_OTHER_NONZERO) from exc
    if stat.S_ISLNK(executable_stat.st_mode):
        raise BoundedPgRestoreError(REASON_OTHER_NONZERO)
    if not stat.S_ISREG(executable_stat.st_mode):
        raise BoundedPgRestoreError(REASON_OTHER_NONZERO)
    if not os.access(raw_path, os.X_OK):
        raise BoundedPgRestoreError(REASON_OTHER_NONZERO)

    try:
        wrapper_stat = os.stat(__file__)
    except OSError as exc:
        raise BoundedPgRestoreError(REASON_OTHER_NONZERO) from exc
    if (executable_stat.st_dev, executable_stat.st_ino) == (
        wrapper_stat.st_dev,
        wrapper_stat.st_ino,
    ):
        raise BoundedPgRestoreError(REASON_OTHER_NONZERO)
    return raw_path


def _write_all(file_descriptor: int, data: bytes) -> None:
    offset = 0
    while offset < len(data):
        written = os.write(file_descriptor, data[offset:])
        if written <= 0:
            raise BoundedPgRestoreError(REASON_OTHER_NONZERO)
        offset += written


def _read_private_capture(file_descriptor: int, cap_bytes: int) -> bytes:
    if os.fstat(file_descriptor).st_size > cap_bytes:
        raise BoundedPgRestoreError(REASON_OUTPUT_CAP)
    os.lseek(file_descriptor, 0, os.SEEK_SET)
    captured = bytearray()
    while True:
        chunk = os.read(file_descriptor, min(READ_CHUNK_BYTES, cap_bytes + 1))
        if not chunk:
            break
        captured.extend(chunk)
        if len(captured) > cap_bytes:
            raise BoundedPgRestoreError(REASON_OUTPUT_CAP)
    return bytes(captured)


def classify_child_stderr(raw_stderr: bytes) -> str:
    """Reduce private C-locale stderr to a fixed, non-sensitive reason code."""

    if UNSUPPORTED_ARCHIVE_VERSION_RE.fullmatch(raw_stderr) is not None:
        return REASON_UNSUPPORTED_ARCHIVE_VERSION

    message = raw_stderr[:-1] if raw_stderr.endswith(b"\n") else raw_stderr
    if message in INVALID_ARCHIVE_MESSAGES:
        return REASON_INVALID_ARCHIVE
    if (
        message in TRUNCATED_ARCHIVE_MESSAGES
        or TRUNCATED_ARCHIVE_RE.fullmatch(message) is not None
    ):
        return REASON_TRUNCATED_ARCHIVE
    return REASON_OTHER_NONZERO


def _kill_process_group_and_reap_leader(process: subprocess.Popen[bytes]) -> None:
    # start_new_session=True makes the original child PID the process-group ID.
    # The group can still contain a descendant after that leader has exited, so
    # leader status must never gate the group-directed kill.
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    # Only the original leader is our direct child and therefore waitable.
    process.wait()


def _capture_child(
    process: subprocess.Popen[bytes],
    *,
    stdout_fd: int,
    stderr_fd: int,
    timeout_seconds: float,
    stdout_cap_bytes: int,
    stderr_cap_bytes: int,
) -> None:
    if process.stdout is None or process.stderr is None:
        raise BoundedPgRestoreError(REASON_OTHER_NONZERO)

    selector = selectors.DefaultSelector()
    streams = {
        process.stdout: (stdout_fd, stdout_cap_bytes, 0),
        process.stderr: (stderr_fd, stderr_cap_bytes, 0),
    }
    for stream in streams:
        os.set_blocking(stream.fileno(), False)
        selector.register(stream, selectors.EVENT_READ)

    deadline = time.monotonic() + timeout_seconds
    try:
        while selector.get_map() or process.poll() is None:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise BoundedPgRestoreError(REASON_TIMEOUT)
            if not selector.get_map():
                # A child can close both output streams and remain alive.  Keep
                # the process-lifetime timeout authoritative in that case.
                time.sleep(min(remaining, 0.01))
                continue
            events = selector.select(timeout=min(remaining, 0.1))
            for key, _mask in events:
                stream = key.fileobj
                capture_fd, cap_bytes, captured_bytes = streams[stream]
                try:
                    chunk = os.read(stream.fileno(), READ_CHUNK_BYTES)
                except BlockingIOError:
                    continue
                if not chunk:
                    selector.unregister(stream)
                    stream.close()
                    continue
                if captured_bytes + len(chunk) > cap_bytes:
                    raise BoundedPgRestoreError(REASON_OUTPUT_CAP)
                _write_all(capture_fd, chunk)
                streams[stream] = (
                    capture_fd,
                    cap_bytes,
                    captured_bytes + len(chunk),
                )
    finally:
        selector.close()
        for stream in streams:
            if not stream.closed:
                stream.close()


def _emit_capture(file_descriptor: int, destination: BinaryIO) -> None:
    os.lseek(file_descriptor, 0, os.SEEK_SET)
    while True:
        chunk = os.read(file_descriptor, READ_CHUNK_BYTES)
        if not chunk:
            break
        destination.write(chunk)
    destination.flush()


def run_request(
    executable: str,
    request: Request,
    *,
    environment: Mapping[str, str],
    stdout: BinaryIO,
    stderr: BinaryIO,
    temporary_parent: str | None = None,
) -> None:
    """Execute one validated request; explicit Request values support unit tests."""

    request.validate_limits()
    temporary_directory = tempfile.mkdtemp(
        prefix=".bounded-pg-restore.",
        dir=temporary_parent,
    )
    directory_fd = -1
    stdout_fd = -1
    stderr_fd = -1
    process: subprocess.Popen[bytes] | None = None
    request_succeeded = False
    try:
        os.chmod(temporary_directory, 0o700)
        directory_fd = os.open(
            temporary_directory,
            os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC,
        )
        capture_flags = (
            os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC
        )
        stdout_fd = os.open(
            "stdout.capture",
            capture_flags,
            0o600,
            dir_fd=directory_fd,
        )
        stderr_fd = os.open(
            "stderr.capture",
            capture_flags,
            0o600,
            dir_fd=directory_fd,
        )

        child_environment = dict(environment)
        child_environment.pop(UNDERLYING_ENVIRONMENT_VARIABLE, None)
        child_environment["LC_ALL"] = "C"
        child_environment["LANG"] = "C"
        child_environment.pop("LANGUAGE", None)
        try:
            process = subprocess.Popen(
                [executable, *request.child_arguments],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=child_environment,
                start_new_session=True,
            )
        except OSError as exc:
            raise BoundedPgRestoreError(REASON_OTHER_NONZERO) from exc

        _capture_child(
            process,
            stdout_fd=stdout_fd,
            stderr_fd=stderr_fd,
            timeout_seconds=request.timeout_seconds,
            stdout_cap_bytes=request.stdout_cap_bytes,
            stderr_cap_bytes=request.stderr_cap_bytes,
        )

        return_code = process.wait()
        if return_code != 0:
            reason_code = classify_child_stderr(
                _read_private_capture(stderr_fd, request.stderr_cap_bytes)
            )
            raise BoundedPgRestoreError(reason_code)

        if os.fstat(stdout_fd).st_size > request.stdout_cap_bytes:
            raise BoundedPgRestoreError(REASON_OUTPUT_CAP)
        if os.fstat(stderr_fd).st_size > request.stderr_cap_bytes:
            raise BoundedPgRestoreError(REASON_OUTPUT_CAP)

        _emit_capture(stdout_fd, stdout)
        _emit_capture(stderr_fd, stderr)
        request_succeeded = True
    finally:
        # Success is the only boundary at which no forced group cleanup is
        # needed.  Every other exit kills the recorded PGID before captures are
        # closed or their private directory is removed, even when the leader
        # has already exited.
        if process is not None and not request_succeeded:
            _kill_process_group_and_reap_leader(process)
        for file_descriptor in (stdout_fd, stderr_fd, directory_fd):
            if file_descriptor >= 0:
                os.close(file_descriptor)
        shutil.rmtree(temporary_directory)


def _failure_diagnostic(reason_code: str) -> bytes:
    if reason_code not in ALLOWED_REASON_CODES:
        reason_code = REASON_OTHER_NONZERO
    return (
        f'{{"diagnostic_version":1,"reason":"{reason_code}"}}\n'.encode("ascii")
    )


def _emit_failure_diagnostic(reason_code: str) -> None:
    try:
        sys.stderr.buffer.write(_failure_diagnostic(reason_code))
        sys.stderr.buffer.flush()
    except Exception:
        # The diagnostic destination itself may be unavailable.  Never replace
        # the fixed diagnostic with a traceback or other free-form text.
        pass


def main(arguments: Sequence[str] | None = None) -> int:
    if arguments is None:
        arguments = sys.argv[1:]
    try:
        request = parse_request(arguments)
        executable = validate_underlying_executable(os.environ)
        run_request(
            executable,
            request,
            environment=os.environ,
            stdout=sys.stdout.buffer,
            stderr=sys.stderr.buffer,
        )
    except BoundedPgRestoreError as exc:
        _emit_failure_diagnostic(exc.reason_code)
        return 1
    except Exception:
        _emit_failure_diagnostic(REASON_OTHER_NONZERO)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
