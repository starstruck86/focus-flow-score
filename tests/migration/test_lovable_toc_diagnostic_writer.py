from __future__ import annotations

import errno
import io
import os
import sys
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "migration"))

from lib import lovable_toc_contract as contract  # noqa: E402


PAYLOAD = b'{"diagnostic_version":1,"reason":"internal_failure"}\n'


class StreamWrapper:
    def __init__(self, buffer: object):
        self.buffer = buffer


class WriteOnlyBuffer:
    def __init__(self) -> None:
        self.data = bytearray()
        self.flush_count = 0

    def write(self, payload: bytes) -> int:
        self.data.extend(payload)
        return len(payload)

    def flush(self) -> None:
        self.flush_count += 1


class BrokenWriteBuffer:
    def __init__(self, error: Exception):
        self.error = error

    def write(self, _payload: bytes) -> int:
        raise self.error


class RaisingBufferProperty:
    @property
    def buffer(self) -> object:
        raise RuntimeError("private exception text")


class FlushFailureBuffer(WriteOnlyBuffer):
    def flush(self) -> None:
        raise OSError(errno.EIO, "private exception text")


class ZeroWriteBuffer:
    def write(self, _payload: bytes) -> int:
        return 0


class NegativeWriteBuffer:
    def write(self, _payload: bytes) -> int:
        return -1


class PartialWriteBuffer(WriteOnlyBuffer):
    def write(self, payload: bytes) -> int:
        length = min(3, len(payload))
        self.data.extend(payload[:length])
        return length


class DescriptorBuffer:
    def __init__(self, descriptor: int):
        self.descriptor = descriptor
        self.write = mock.Mock()
        self.flush = mock.Mock()

    def fileno(self) -> int:
        return self.descriptor


class LovableTocDiagnosticWriterTests(unittest.TestCase):
    def test_descriptorless_binary_stream_writes_and_flushes_once(self) -> None:
        output = WriteOnlyBuffer()
        self.assertTrue(contract.emit_fixed_diagnostic(StreamWrapper(output), PAYLOAD))
        self.assertEqual(bytes(output.data), PAYLOAD)
        self.assertEqual(output.flush_count, 1)

    def test_descriptorless_partial_writes_are_completed(self) -> None:
        output = PartialWriteBuffer()
        self.assertTrue(contract.emit_fixed_diagnostic(StreamWrapper(output), PAYLOAD))
        self.assertEqual(bytes(output.data), PAYLOAD)
        self.assertEqual(output.flush_count, 1)

    def test_broken_and_closed_descriptorless_streams_fail_silently(self) -> None:
        closed = io.BytesIO()
        closed.close()
        cases = (
            BrokenWriteBuffer(BrokenPipeError(errno.EPIPE, "private exception text")),
            BrokenWriteBuffer(OSError(errno.EBADF, "private exception text")),
            BrokenWriteBuffer(OverflowError("private exception text")),
            BrokenWriteBuffer(ValueError("private exception text")),
            closed,
            RaisingBufferProperty(),
            FlushFailureBuffer(),
        )
        for stream in cases:
            with self.subTest(stream=type(stream).__name__):
                self.assertFalse(contract.emit_fixed_diagnostic(stream, PAYLOAD))

    def test_zero_negative_and_noninteger_writes_fail_silently(self) -> None:
        for stream in (ZeroWriteBuffer(), NegativeWriteBuffer()):
            with self.subTest(stream=type(stream).__name__):
                self.assertFalse(contract.emit_fixed_diagnostic(stream, PAYLOAD))

        stream = mock.Mock()
        del stream.fileno
        stream.write.return_value = None
        self.assertFalse(contract.emit_fixed_diagnostic(stream, PAYLOAD))

    def test_os_write_short_writes_are_completed_without_buffer_flush(self) -> None:
        read_fd, write_fd = os.pipe()
        try:
            real_write = os.write

            def short_write(descriptor: int, payload: bytes) -> int:
                return real_write(descriptor, payload[: min(4, len(payload))])

            output = DescriptorBuffer(write_fd)
            stream = StreamWrapper(output)
            with mock.patch.object(contract.os, "write", side_effect=short_write):
                self.assertTrue(contract.emit_fixed_diagnostic(stream, PAYLOAD))
            os.close(write_fd)
            write_fd = -1
            self.assertEqual(os.read(read_fd, len(PAYLOAD) + 1), PAYLOAD)
            output.write.assert_not_called()
            output.flush.assert_not_called()
        finally:
            if write_fd >= 0:
                os.close(write_fd)
            os.close(read_fd)

    def test_os_write_broken_pipe_bad_fd_and_zero_write_fail_silently(self) -> None:
        stream = DescriptorBuffer(123)
        for failure in (
            BrokenPipeError(errno.EPIPE, "private exception text"),
            OSError(errno.EBADF, "private exception text"),
        ):
            with self.subTest(error=type(failure).__name__), mock.patch.object(
                contract.os, "write", side_effect=failure
            ):
                self.assertFalse(contract.emit_fixed_diagnostic(stream, PAYLOAD))
        with mock.patch.object(contract.os, "write", return_value=0):
            self.assertFalse(contract.emit_fixed_diagnostic(stream, PAYLOAD))

        read_fd, write_fd = os.pipe()
        os.close(read_fd)
        try:
            self.assertFalse(
                contract.emit_fixed_diagnostic(DescriptorBuffer(write_fd), PAYLOAD)
            )
        finally:
            os.close(write_fd)

    def test_invalid_descriptor_values_fail_without_fallback_write(self) -> None:
        for descriptor in (-1, True, "1", 10**100):
            output = DescriptorBuffer(1)
            output.descriptor = descriptor  # type: ignore[assignment]
            with self.subTest(descriptor=descriptor):
                self.assertFalse(contract.emit_fixed_diagnostic(output, PAYLOAD))
                output.write.assert_not_called()
                output.flush.assert_not_called()

    def test_invalid_or_oversized_payloads_never_touch_stream(self) -> None:
        stream = mock.Mock()
        cases = (
            bytearray(PAYLOAD),
            b"",
            b"missing-newline",
            b"x" * contract.MAX_PUBLIC_DIAGNOSTIC_BYTES + b"\n",
        )
        for payload in cases:
            with self.subTest(payload_type=type(payload).__name__, size=len(payload)):
                self.assertFalse(contract.emit_fixed_diagnostic(stream, payload))  # type: ignore[arg-type]
        self.assertFalse(stream.mock_calls)

    def test_maximum_bounded_payload_is_accepted(self) -> None:
        payload = b"x" * (contract.MAX_PUBLIC_DIAGNOSTIC_BYTES - 1) + b"\n"
        output = WriteOnlyBuffer()
        self.assertTrue(contract.emit_fixed_diagnostic(output, payload))
        self.assertEqual(bytes(output.data), payload)


if __name__ == "__main__":
    unittest.main()
