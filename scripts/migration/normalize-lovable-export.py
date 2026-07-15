#!/usr/bin/env python3
"""Normalize a local Lovable export envelope to one verified PGDMP file.

This utility has no restore or database mode.  It accepts either a direct
PostgreSQL custom-format archive or a deliberately small subset of ZIP: one
regular member, no extras/comments/data descriptor/ZIP64, and STORE or raw
DEFLATE compression only.  ZIP bytes are parsed independently and the member
is decompressed manually so declared sizes are never treated as a safety cap.

The caller must provide a pre-existing private directory owned by the current
user with mode 0700.  The only accepted output basenames are
``verified-inner.pgdmp`` and ``normalization.json``.  Both are created with
exclusive, no-overwrite publication; partial files are removed on failure.
"""

from __future__ import annotations

import argparse
import errno
import hashlib
import json
import os
import re
import shutil
import stat
import struct
import sys
import zlib
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any


FORMAT_VERSION = 1
PGDMP_MAGIC = b"PGDMP"
PGDMP_MINIMUM_HEADER_SIZE = 11
ZIP_LOCAL_MAGIC = b"PK\x03\x04"
ZIP_CENTRAL_MAGIC = b"PK\x01\x02"
ZIP_EOCD_MAGIC = b"PK\x05\x06"

OUTPUT_BASENAME = "verified-inner.pgdmp"
METADATA_BASENAME = "normalization.json"
OUTPUT_PARTIAL_BASENAME = ".verified-inner.pgdmp.partial"
METADATA_PARTIAL_BASENAME = ".normalization.json.partial"

CHUNK_SIZE = 1024 * 1024
HEADER_CAPTURE_SIZE = 512
DEFAULT_MAX_OUTER_BYTES = 5_000_000_000
DEFAULT_MAX_INNER_BYTES = 5_000_000_000
DEFAULT_MAX_COMPRESSION_RATIO = 100
MIN_DISK_RESERVE_BYTES = 256 * 1024 * 1024

ZIP_STORED = 0
ZIP_DEFLATED = 8
ZIP_STORED_VERSION_NEEDED = 10
ZIP_DEFLATED_VERSION_NEEDED = 20
ZIP_UTF8_FLAG = 0x0800
ZIP_DEFLATE_OPTION_FLAGS = 0x0006
ZIP_ENCRYPTED_FLAG = 0x0001
ZIP_DATA_DESCRIPTOR_FLAG = 0x0008
ZIP_STRONG_ENCRYPTION_FLAG = 0x0040
ZIP_MASKED_HEADER_FLAG = 0x2000

LOCAL_HEADER = struct.Struct("<4s5H3I2H")
CENTRAL_HEADER = struct.Struct("<4s6H3I5H2I")
EOCD = struct.Struct("<4s4H2IH")

SHA256_RE = re.compile(r"[0-9a-f]{64}\Z")
SAFE_MEMBER_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,254}\Z")
REMOTE_PATH_RE = re.compile(r"[A-Za-z][A-Za-z0-9+.-]*://")
WINDOWS_RESERVED_NAMES = frozenset(
    {"CON", "PRN", "AUX", "NUL"}
    | {f"COM{number}" for number in range(1, 10)}
    | {f"LPT{number}" for number in range(1, 10)}
)
NESTED_ARCHIVE_SUFFIXES = (
    ".zip",
    ".gz",
    ".tgz",
    ".bz2",
    ".xz",
    ".7z",
    ".rar",
    ".tar",
    ".jar",
    ".war",
)
NESTED_ARCHIVE_MAGICS = (
    b"PK\x03\x04",
    b"PK\x05\x06",
    b"PK\x07\x08",
    b"\x1f\x8b",
    b"BZh",
    b"\xfd7zXZ\x00",
    b"7z\xbc\xaf'\x1c",
    b"Rar!\x1a\x07\x00",
    b"Rar!\x1a\x07\x01\x00",
)


class NormalizationError(RuntimeError):
    """An unsafe, malformed, or unsupported export condition."""


@dataclass(frozen=True)
class Limits:
    max_outer_bytes: int = DEFAULT_MAX_OUTER_BYTES
    max_inner_bytes: int = DEFAULT_MAX_INNER_BYTES
    max_compression_ratio: int = DEFAULT_MAX_COMPRESSION_RATIO
    minimum_disk_reserve_bytes: int = MIN_DISK_RESERVE_BYTES

    def validate(self) -> None:
        for label, value in (
            ("outer byte cap", self.max_outer_bytes),
            ("inner byte cap", self.max_inner_bytes),
            ("compression-ratio cap", self.max_compression_ratio),
            ("minimum disk reserve", self.minimum_disk_reserve_bytes),
        ):
            if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
                raise NormalizationError(f"{label} must be a positive integer")


@dataclass(frozen=True)
class ZipMember:
    name: str
    method: int
    flags: int
    crc32: int
    compressed_size: int
    uncompressed_size: int
    data_offset: int
    version_needed: int
    version_made_by: int
    dos_time: int
    dos_date: int
    internal_attributes: int
    external_attributes: int
    central_directory_offset: int
    central_directory_size: int

    @property
    def compression(self) -> str:
        if self.method == ZIP_STORED:
            return "stored"
        if self.method == ZIP_DEFLATED:
            return "deflate"
        raise NormalizationError("unsupported ZIP compression method")


@dataclass(frozen=True)
class StreamResult:
    size_bytes: int
    sha256: str
    crc32: int
    header: bytes


DiskFreeFunction = Callable[[int], int]


def _default_disk_free(directory_fd: int) -> int:
    filesystem = os.fstatvfs(directory_fd)
    return filesystem.f_bavail * filesystem.f_frsize


def _read_exact_at(file_fd: int, offset: int, length: int) -> bytes:
    if offset < 0 or length < 0:
        raise NormalizationError("malformed ZIP byte range")
    result = bytearray()
    while len(result) < length:
        chunk = os.pread(file_fd, length - len(result), offset + len(result))
        if not chunk:
            raise NormalizationError("truncated archive structure")
        result.extend(chunk)
    return bytes(result)


def _iter_file_range(file_fd: int, offset: int, length: int) -> Iterator[bytes]:
    remaining = length
    cursor = offset
    while remaining:
        requested = min(CHUNK_SIZE, remaining)
        chunk = os.pread(file_fd, requested, cursor)
        if not chunk:
            raise NormalizationError("archive changed or became truncated while reading")
        if len(chunk) > remaining:
            raise NormalizationError("archive range exceeded its declared boundary")
        yield chunk
        cursor += len(chunk)
        remaining -= len(chunk)


def _sha256_fd(file_fd: int, maximum_bytes: int) -> tuple[int, str]:
    digest = hashlib.sha256()
    size = 0
    while True:
        chunk = os.pread(file_fd, CHUNK_SIZE, size)
        if not chunk:
            break
        size += len(chunk)
        if size > maximum_bytes:
            raise NormalizationError("outer artifact exceeds the reviewed byte cap")
        digest.update(chunk)
    return size, digest.hexdigest()


def _stable_stat_key(value: os.stat_result) -> tuple[int, int, int, int, int, int]:
    return (
        value.st_dev,
        value.st_ino,
        value.st_mode,
        value.st_size,
        value.st_mtime_ns,
        value.st_ctime_ns,
    )


def _validate_member_name(raw_name: bytes) -> str:
    try:
        name = raw_name.decode("ascii", errors="strict")
    except UnicodeDecodeError as exc:
        raise NormalizationError("ZIP member name must be unambiguous ASCII") from exc

    if not SAFE_MEMBER_RE.fullmatch(name):
        raise NormalizationError("ZIP member name is not a safe portable basename")
    if name.endswith("."):
        raise NormalizationError("ZIP member name has an ambiguous trailing dot")
    if ".." in name:
        raise NormalizationError("ZIP member name contains an ambiguous dot sequence")
    if name.split(".", 1)[0].upper() in WINDOWS_RESERVED_NAMES:
        raise NormalizationError("ZIP member name is a reserved portable filename")
    if name.lower().endswith(NESTED_ARCHIVE_SUFFIXES):
        raise NormalizationError("nested archive members are not accepted")
    return name


def _validate_regular_member(version_made_by: int, external_attributes: int) -> None:
    creator_system = version_made_by >> 8
    if creator_system not in {0, 3, 19}:
        raise NormalizationError("ZIP member creator system is unsupported")

    dos_attributes = external_attributes & 0xFF
    if dos_attributes & 0x58:
        raise NormalizationError("ZIP member is a directory, volume, or device entry")

    unix_mode = (external_attributes >> 16) & 0xFFFF
    file_type = stat.S_IFMT(unix_mode)
    # Unix/Darwin creators can positively identify a regular file and therefore
    # must do so.  DOS/FAT creators commonly have no POSIX type bits; zero is
    # accepted only for that creator system, with DOS directory/volume bits
    # already rejected above.
    if creator_system in {3, 19} and file_type != stat.S_IFREG:
        raise NormalizationError("ZIP member does not positively identify a regular file")
    if creator_system == 0 and file_type not in {0, stat.S_IFREG}:
        raise NormalizationError("ZIP member is not a regular file")


def _parse_strict_zip(file_fd: int, outer_size: int, limits: Limits) -> ZipMember:
    minimum_size = LOCAL_HEADER.size + CENTRAL_HEADER.size + EOCD.size + 1
    if outer_size < minimum_size:
        raise NormalizationError("ZIP envelope is truncated")

    eocd_offset = outer_size - EOCD.size
    eocd_values = EOCD.unpack(_read_exact_at(file_fd, eocd_offset, EOCD.size))
    (
        eocd_magic,
        disk_number,
        central_disk,
        entries_on_disk,
        total_entries,
        central_size,
        central_offset,
        archive_comment_length,
    ) = eocd_values
    if eocd_magic != ZIP_EOCD_MAGIC:
        raise NormalizationError("ZIP EOCD is missing or trailing bytes are present")
    if archive_comment_length != 0:
        raise NormalizationError("ZIP archive comments are not accepted")
    if disk_number != 0 or central_disk != 0:
        raise NormalizationError("multi-disk ZIP envelopes are not accepted")
    if entries_on_disk != 1 or total_entries != 1:
        raise NormalizationError("ZIP envelope must contain exactly one member")
    if central_size == 0xFFFFFFFF or central_offset == 0xFFFFFFFF:
        raise NormalizationError("ZIP64 envelopes are not accepted")
    if central_offset + central_size != eocd_offset:
        raise NormalizationError("ZIP central directory does not exactly precede EOCD")
    if central_size < CENTRAL_HEADER.size or central_offset < LOCAL_HEADER.size:
        raise NormalizationError("malformed ZIP central directory bounds")

    central_values = CENTRAL_HEADER.unpack(
        _read_exact_at(file_fd, central_offset, CENTRAL_HEADER.size)
    )
    (
        central_magic,
        version_made_by,
        version_needed,
        flags,
        method,
        dos_time,
        dos_date,
        crc32,
        compressed_size,
        uncompressed_size,
        name_length,
        central_extra_length,
        member_comment_length,
        disk_start,
        internal_attributes,
        external_attributes,
        local_header_offset,
    ) = central_values
    if central_magic != ZIP_CENTRAL_MAGIC:
        raise NormalizationError("malformed ZIP central-directory signature")
    if name_length == 0:
        raise NormalizationError("ZIP member name is empty")
    if central_extra_length != 0:
        raise NormalizationError("ZIP extra fields are not accepted")
    if member_comment_length != 0:
        raise NormalizationError("ZIP member comments are not accepted")
    if disk_start != 0:
        raise NormalizationError("multi-disk ZIP members are not accepted")
    if local_header_offset != 0:
        raise NormalizationError("ZIP prefix or noncanonical local-header offset detected")
    if (
        compressed_size == 0xFFFFFFFF
        or uncompressed_size == 0xFFFFFFFF
        or version_needed >= 45
    ):
        raise NormalizationError("ZIP64 envelopes are not accepted")
    if method not in {ZIP_STORED, ZIP_DEFLATED}:
        raise NormalizationError("unsupported ZIP compression method")
    expected_version_needed = {
        ZIP_STORED: ZIP_STORED_VERSION_NEEDED,
        ZIP_DEFLATED: ZIP_DEFLATED_VERSION_NEEDED,
    }[method]
    if version_needed != expected_version_needed:
        method_label = "stored" if method == ZIP_STORED else "DEFLATE"
        expected_version_label = (
            f"{expected_version_needed // 10}.{expected_version_needed % 10}"
        )
        raise NormalizationError(
            f"{method_label} ZIP members must require ZIP version "
            f"{expected_version_label}"
        )

    forbidden_flags = (
        ZIP_ENCRYPTED_FLAG
        | ZIP_DATA_DESCRIPTOR_FLAG
        | ZIP_STRONG_ENCRYPTION_FLAG
        | ZIP_MASKED_HEADER_FLAG
    )
    if flags & forbidden_flags:
        if flags & (
            ZIP_ENCRYPTED_FLAG | ZIP_STRONG_ENCRYPTION_FLAG | ZIP_MASKED_HEADER_FLAG
        ):
            raise NormalizationError("encrypted ZIP members are not accepted")
        raise NormalizationError("ZIP data descriptors are not accepted")
    allowed_flags = ZIP_UTF8_FLAG
    if method == ZIP_DEFLATED:
        allowed_flags |= ZIP_DEFLATE_OPTION_FLAGS
    if flags & ~allowed_flags:
        raise NormalizationError("unsupported ZIP general-purpose flags")

    central_record_size = (
        CENTRAL_HEADER.size
        + name_length
        + central_extra_length
        + member_comment_length
    )
    if central_record_size != central_size:
        raise NormalizationError("ZIP central directory contains extra structures")
    raw_central_name = _read_exact_at(
        file_fd, central_offset + CENTRAL_HEADER.size, name_length
    )
    member_name = _validate_member_name(raw_central_name)
    _validate_regular_member(version_made_by, external_attributes)

    local_values = LOCAL_HEADER.unpack(_read_exact_at(file_fd, 0, LOCAL_HEADER.size))
    (
        local_magic,
        local_version_needed,
        local_flags,
        local_method,
        local_dos_time,
        local_dos_date,
        local_crc32,
        local_compressed_size,
        local_uncompressed_size,
        local_name_length,
        local_extra_length,
    ) = local_values
    if local_magic != ZIP_LOCAL_MAGIC:
        raise NormalizationError("ZIP local header is missing at byte zero")
    if local_extra_length != 0:
        raise NormalizationError("ZIP local extra fields are not accepted")
    raw_local_name = _read_exact_at(file_fd, LOCAL_HEADER.size, local_name_length)
    if raw_local_name != raw_central_name or local_name_length != name_length:
        raise NormalizationError("ZIP local and central member names differ")
    if (
        local_version_needed != version_needed
        or local_flags != flags
        or local_method != method
        or local_dos_time != dos_time
        or local_dos_date != dos_date
        or local_crc32 != crc32
        or local_compressed_size != compressed_size
        or local_uncompressed_size != uncompressed_size
    ):
        raise NormalizationError("ZIP local and central metadata differ")

    data_offset = LOCAL_HEADER.size + local_name_length
    if data_offset + compressed_size != central_offset:
        raise NormalizationError("ZIP member data does not exactly precede the central directory")
    if compressed_size == 0 or uncompressed_size == 0:
        raise NormalizationError("ZIP member must be nonempty")
    if uncompressed_size > limits.max_inner_bytes:
        raise NormalizationError("ZIP member exceeds the reviewed declared-size cap")
    if method == ZIP_STORED and compressed_size != uncompressed_size:
        raise NormalizationError("stored ZIP member has inconsistent sizes")
    if uncompressed_size > compressed_size * limits.max_compression_ratio:
        raise NormalizationError("ZIP member exceeds the reviewed declared compression ratio")

    return ZipMember(
        name=member_name,
        method=method,
        flags=flags,
        crc32=crc32,
        compressed_size=compressed_size,
        uncompressed_size=uncompressed_size,
        data_offset=data_offset,
        version_needed=version_needed,
        version_made_by=version_made_by,
        dos_time=dos_time,
        dos_date=dos_date,
        internal_attributes=internal_attributes,
        external_attributes=external_attributes,
        central_directory_offset=central_offset,
        central_directory_size=central_size,
    )


def _iter_deflated_member(file_fd: int, member: ZipMember) -> Iterator[bytes]:
    decompressor = zlib.decompressobj(-zlib.MAX_WBITS)
    remaining = member.compressed_size
    cursor = member.data_offset

    while remaining:
        requested = min(CHUNK_SIZE, remaining)
        compressed = os.pread(file_fd, requested, cursor)
        if not compressed:
            raise NormalizationError("ZIP member compressed data is truncated")
        if len(compressed) > remaining:
            raise NormalizationError("ZIP member exceeded its compressed-data boundary")
        cursor += len(compressed)
        remaining -= len(compressed)

        pending = compressed
        while pending:
            pending_size = len(pending)
            try:
                output = decompressor.decompress(pending, CHUNK_SIZE)
            except zlib.error as exc:
                raise NormalizationError("ZIP member contains invalid DEFLATE data") from exc
            pending = decompressor.unconsumed_tail
            if decompressor.unused_data:
                raise NormalizationError("ZIP member contains bytes after the DEFLATE stream")
            if output:
                yield output
            if pending and len(pending) >= pending_size and not output:
                raise NormalizationError("ZIP DEFLATE stream made no progress")

        if decompressor.eof and remaining:
            raise NormalizationError("ZIP DEFLATE stream ends before its declared boundary")

    if not decompressor.eof:
        raise NormalizationError("ZIP DEFLATE stream is truncated")
    if decompressor.unused_data or decompressor.unconsumed_tail:
        raise NormalizationError("ZIP DEFLATE stream has ambiguous trailing data")
    try:
        tail = decompressor.flush(CHUNK_SIZE)
    except zlib.error as exc:
        raise NormalizationError("ZIP DEFLATE finalization failed") from exc
    if tail:
        yield tail


def _write_all(file_fd: int, data: bytes) -> None:
    view = memoryview(data)
    while view:
        written = os.write(file_fd, view)
        if written <= 0:
            raise NormalizationError("could not make progress writing derived archive")
        view = view[written:]


def _is_nested_archive(header: bytes) -> bool:
    if any(header.startswith(magic) for magic in NESTED_ARCHIVE_MAGICS):
        return True
    return len(header) >= 262 and header[257:262] == b"ustar"


def _validate_pgdmp_header(header: bytes) -> None:
    """Reject magic-only/polyglot inputs before invoking the real inspector.

    PostgreSQL custom archives start with three archive-version bytes followed
    by integer size, offset size, and format.  The existing inspector and
    ``pg_restore --list`` remain authoritative for full compatibility; this
    deliberately small check only prevents arbitrary ``PGDMP``-prefixed bytes
    from being accepted as a normalized inner archive.
    """

    if len(header) < PGDMP_MINIMUM_HEADER_SIZE:
        raise NormalizationError("derived PGDMP header is truncated")
    major, minor, revision, integer_size, offset_size, archive_format = header[5:11]
    if major != 1 or minor > 32 or revision > 32:
        raise NormalizationError("derived PGDMP archive version header is invalid")
    if integer_size not in {4, 8} or offset_size not in {4, 8}:
        raise NormalizationError("derived PGDMP numeric-width header is invalid")
    if archive_format != 1:
        raise NormalizationError("derived archive is not PostgreSQL custom format")


def _materialize_chunks(
    chunks: Iterator[bytes],
    output_fd: int,
    *,
    expected_size: int,
    expected_crc32: int | None,
    compressed_size: int | None,
    limits: Limits,
) -> StreamResult:
    digest = hashlib.sha256()
    crc32 = 0
    streamed_size = 0
    header = bytearray()

    for chunk in chunks:
        if not chunk:
            continue
        next_size = streamed_size + len(chunk)
        if next_size > limits.max_inner_bytes:
            raise NormalizationError("derived archive exceeds the reviewed streaming byte cap")
        if (
            compressed_size is not None
            and next_size > compressed_size * limits.max_compression_ratio
        ):
            raise NormalizationError(
                "derived archive exceeds the reviewed streaming compression ratio"
            )
        if len(header) < HEADER_CAPTURE_SIZE:
            header.extend(chunk[: HEADER_CAPTURE_SIZE - len(header)])
        digest.update(chunk)
        crc32 = zlib.crc32(chunk, crc32)
        _write_all(output_fd, chunk)
        streamed_size = next_size

    if streamed_size == 0:
        raise NormalizationError("derived archive is empty")
    if streamed_size != expected_size:
        raise NormalizationError("derived archive length differs from declared length")
    crc32 &= 0xFFFFFFFF
    if expected_crc32 is not None and crc32 != expected_crc32:
        raise NormalizationError("ZIP member CRC32 verification failed")
    if streamed_size < 8:
        raise NormalizationError("derived PGDMP header is truncated")
    header_bytes = bytes(header)
    if not header_bytes.startswith(PGDMP_MAGIC):
        if _is_nested_archive(header_bytes):
            raise NormalizationError("nested archive member is not accepted")
        raise NormalizationError("derived member is not a PGDMP archive")
    _validate_pgdmp_header(header_bytes)

    return StreamResult(
        size_bytes=streamed_size,
        sha256=digest.hexdigest(),
        crc32=crc32,
        header=bytes(header),
    )


def _required_disk_bytes(declared_inner_size: int, limits: Limits) -> int:
    proportional_reserve = (declared_inner_size + 9) // 10
    reserve = max(limits.minimum_disk_reserve_bytes, proportional_reserve)
    # The derived file and the existing inspector's private PGDMP snapshot are
    # simultaneously present.  Keep both full inner copies plus report/tmp
    # reserve available before materialization begins.
    return (2 * declared_inner_size) + reserve


def _remaining_disk_reserve(declared_inner_size: int, limits: Limits) -> int:
    return declared_inner_size + max(
        limits.minimum_disk_reserve_bytes, (declared_inner_size + 9) // 10
    )


def _ensure_absent(directory_fd: int, name: str) -> None:
    try:
        os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
    except FileNotFoundError:
        return
    raise NormalizationError("output already exists; refusing to overwrite")


def _create_exclusive(directory_fd: int, name: str, mode: int) -> int:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_CLOEXEC
    nofollow = getattr(os, "O_NOFOLLOW", None)
    if nofollow is None:
        raise NormalizationError("platform does not provide O_NOFOLLOW")
    flags |= nofollow
    try:
        return os.open(name, flags, mode, dir_fd=directory_fd)
    except FileExistsError as exc:
        raise NormalizationError("output already exists; refusing to overwrite") from exc


def _publish_no_replace(
    directory_fd: int,
    partial_name: str,
    final_name: str,
    created_names: set[str],
) -> None:
    try:
        os.link(
            partial_name,
            final_name,
            src_dir_fd=directory_fd,
            dst_dir_fd=directory_fd,
            follow_symlinks=False,
        )
    except FileExistsError as exc:
        raise NormalizationError("output already exists; refusing to overwrite") from exc
    created_names.add(final_name)
    os.unlink(partial_name, dir_fd=directory_fd)
    created_names.discard(partial_name)
    os.fsync(directory_fd)


def _cleanup_created(directory_fd: int, created_names: set[str]) -> None:
    cleanup_failed = False
    for name in tuple(created_names):
        try:
            os.unlink(name, dir_fd=directory_fd)
        except FileNotFoundError:
            pass
        except OSError:
            cleanup_failed = True
        else:
            created_names.discard(name)
    try:
        os.fsync(directory_fd)
    except OSError:
        cleanup_failed = True
    if cleanup_failed or created_names:
        raise NormalizationError("failed to remove partial normalization outputs")


def _open_private_output_directory(output: Path, metadata_output: Path) -> int:
    if output.name != OUTPUT_BASENAME:
        raise NormalizationError(f"output basename must be {OUTPUT_BASENAME}")
    if metadata_output.name != METADATA_BASENAME:
        raise NormalizationError(f"metadata basename must be {METADATA_BASENAME}")

    output_parent = os.path.abspath(os.fspath(output.parent))
    metadata_parent = os.path.abspath(os.fspath(metadata_output.parent))
    if output_parent != metadata_parent:
        raise NormalizationError("output and metadata must share one private directory")

    nofollow = getattr(os, "O_NOFOLLOW", None)
    directory_flag = getattr(os, "O_DIRECTORY", None)
    if nofollow is None or directory_flag is None:
        raise NormalizationError("platform lacks required no-follow directory support")
    try:
        directory_fd = os.open(
            output_parent,
            os.O_RDONLY | os.O_CLOEXEC | nofollow | directory_flag,
        )
    except OSError as exc:
        raise NormalizationError("could not open the private output directory") from exc

    directory_stat = os.fstat(directory_fd)
    if not stat.S_ISDIR(directory_stat.st_mode):
        os.close(directory_fd)
        raise NormalizationError("output parent is not a directory")
    if directory_stat.st_uid != os.geteuid():
        os.close(directory_fd)
        raise NormalizationError("private output directory is not owned by this user")
    if stat.S_IMODE(directory_stat.st_mode) != 0o700:
        os.close(directory_fd)
        raise NormalizationError("private output directory must have mode 0700")
    return directory_fd


def _open_local_regular_input(input_path: Path) -> tuple[int, os.stat_result]:
    input_text = os.fspath(input_path)
    if "\n" in input_text or "\r" in input_text or REMOTE_PATH_RE.match(input_text):
        raise NormalizationError("input must be a local single-line filesystem path")
    nofollow = getattr(os, "O_NOFOLLOW", None)
    if nofollow is None:
        raise NormalizationError("platform does not provide O_NOFOLLOW")
    try:
        file_fd = os.open(
            input_text,
            os.O_RDONLY | os.O_CLOEXEC | os.O_NONBLOCK | nofollow,
        )
    except OSError as exc:
        if exc.errno == errno.ELOOP:
            raise NormalizationError("symlink input is not accepted") from exc
        raise NormalizationError("could not open local input artifact") from exc

    input_stat = os.fstat(file_fd)
    if not stat.S_ISREG(input_stat.st_mode):
        os.close(file_fd)
        raise NormalizationError("input artifact is not a regular file")
    if input_stat.st_size <= 0:
        os.close(file_fd)
        raise NormalizationError("input artifact is empty")
    return file_fd, input_stat


def _write_metadata_partial(
    directory_fd: int,
    metadata: dict[str, Any],
    created_names: set[str],
) -> None:
    payload = (
        json.dumps(metadata, indent=2, sort_keys=True, ensure_ascii=True) + "\n"
    ).encode("utf-8")
    metadata_fd = _create_exclusive(directory_fd, METADATA_PARTIAL_BASENAME, 0o600)
    created_names.add(METADATA_PARTIAL_BASENAME)
    try:
        _write_all(metadata_fd, payload)
        os.fchmod(metadata_fd, 0o400)
        os.fsync(metadata_fd)
        metadata_stat = os.fstat(metadata_fd)
        if not stat.S_ISREG(metadata_stat.st_mode) or metadata_stat.st_size != len(payload):
            raise NormalizationError("normalization metadata publication is incomplete")
        if stat.S_IMODE(metadata_stat.st_mode) != 0o400:
            raise NormalizationError("normalization metadata mode is not 0400")
    finally:
        os.close(metadata_fd)


def normalize(
    input_path: Path,
    *,
    expected_outer_sha256: str,
    output: Path,
    metadata_output: Path,
    limits: Limits = Limits(),
    disk_free: DiskFreeFunction = _default_disk_free,
) -> dict[str, Any]:
    """Normalize ``input_path`` and exclusively publish the two fixed outputs.

    ``disk_free`` is injectable solely so synthetic unit tests can plant an
    insufficient-headroom condition without consuming real disk space.
    """

    limits.validate()
    if not SHA256_RE.fullmatch(expected_outer_sha256):
        raise NormalizationError(
            "expected outer SHA-256 must be 64 lowercase hexadecimal characters"
        )

    directory_fd = _open_private_output_directory(output, metadata_output)
    file_fd = -1
    created_names: set[str] = set()
    try:
        for name in (
            OUTPUT_BASENAME,
            METADATA_BASENAME,
            OUTPUT_PARTIAL_BASENAME,
            METADATA_PARTIAL_BASENAME,
        ):
            _ensure_absent(directory_fd, name)

        file_fd, initial_stat = _open_local_regular_input(input_path)
        if initial_stat.st_size > limits.max_outer_bytes:
            raise NormalizationError("outer artifact exceeds the reviewed byte cap")

        size_before, sha256_before = _sha256_fd(file_fd, limits.max_outer_bytes)
        if size_before != initial_stat.st_size:
            raise NormalizationError("outer artifact size changed during initial hashing")
        if _stable_stat_key(os.fstat(file_fd)) != _stable_stat_key(initial_stat):
            raise NormalizationError("outer artifact metadata changed during initial hashing")
        if sha256_before != expected_outer_sha256:
            raise NormalizationError("outer artifact SHA-256 does not match the expected digest")

        prefix = _read_exact_at(file_fd, 0, min(5, initial_stat.st_size))
        member: ZipMember | None
        if prefix.startswith(PGDMP_MAGIC):
            envelope_kind = "direct_pgdmp"
            declared_inner_size = initial_stat.st_size
            member = None
        elif prefix.startswith(ZIP_LOCAL_MAGIC):
            envelope_kind = "zip"
            member = _parse_strict_zip(file_fd, initial_stat.st_size, limits)
            declared_inner_size = member.uncompressed_size
        else:
            if _is_nested_archive(_read_exact_at(file_fd, 0, min(HEADER_CAPTURE_SIZE, initial_stat.st_size))):
                raise NormalizationError("nested or unsupported outer archive is not accepted")
            raise NormalizationError("input is neither a direct PGDMP nor a strict ZIP envelope")

        if declared_inner_size > limits.max_inner_bytes:
            raise NormalizationError("derived archive exceeds the reviewed declared-size cap")
        required_free = _required_disk_bytes(declared_inner_size, limits)
        available_free = disk_free(directory_fd)
        if not isinstance(available_free, int) or isinstance(available_free, bool):
            raise NormalizationError("disk headroom probe returned an invalid value")
        if available_free < required_free:
            raise NormalizationError("insufficient disk headroom for safe normalization")

        output_fd = _create_exclusive(directory_fd, OUTPUT_PARTIAL_BASENAME, 0o600)
        created_names.add(OUTPUT_PARTIAL_BASENAME)
        try:
            if member is None:
                result = _materialize_chunks(
                    _iter_file_range(file_fd, 0, initial_stat.st_size),
                    output_fd,
                    expected_size=initial_stat.st_size,
                    expected_crc32=None,
                    compressed_size=None,
                    limits=limits,
                )
            else:
                if member.method == ZIP_STORED:
                    member_chunks = _iter_file_range(
                        file_fd, member.data_offset, member.compressed_size
                    )
                else:
                    member_chunks = _iter_deflated_member(file_fd, member)
                result = _materialize_chunks(
                    member_chunks,
                    output_fd,
                    expected_size=member.uncompressed_size,
                    expected_crc32=member.crc32,
                    compressed_size=member.compressed_size,
                    limits=limits,
                )

            os.fchmod(output_fd, 0o400)
            os.fsync(output_fd)
            output_stat = os.fstat(output_fd)
            if not stat.S_ISREG(output_stat.st_mode):
                raise NormalizationError("derived archive output is not a regular file")
            if output_stat.st_size != result.size_bytes:
                raise NormalizationError("derived archive output length changed after streaming")
            if stat.S_IMODE(output_stat.st_mode) != 0o400:
                raise NormalizationError("derived archive output mode is not 0400")
        finally:
            os.close(output_fd)

        size_after, sha256_after = _sha256_fd(file_fd, limits.max_outer_bytes)
        final_stat = os.fstat(file_fd)
        if size_after != initial_stat.st_size:
            raise NormalizationError("outer artifact size changed during normalization")
        if _stable_stat_key(final_stat) != _stable_stat_key(initial_stat):
            raise NormalizationError("outer artifact metadata changed during normalization")
        if sha256_after != sha256_before or sha256_after != expected_outer_sha256:
            raise NormalizationError("outer artifact changed during normalization")
        if envelope_kind == "direct_pgdmp" and result.sha256 != sha256_before:
            raise NormalizationError("direct PGDMP copy does not match the outer artifact")

        if disk_free(directory_fd) < _remaining_disk_reserve(declared_inner_size, limits):
            raise NormalizationError("insufficient disk reserve remains after normalization")

        outer_metadata: dict[str, Any] = {
            "format": "zip" if member is not None else "postgresql_custom_archive",
            "sha256_after": sha256_after,
            "sha256_before": sha256_before,
            "size_bytes": size_before,
        }
        member_metadata: dict[str, Any] | None = None
        if member is not None:
            outer_metadata["zip"] = {
                "archive_comment_length": 0,
                "central_directory_offset": member.central_directory_offset,
                "central_directory_size": member.central_directory_size,
                "entry_count": 1,
                "zip64": False,
            }
            member_metadata = {
                "compressed_size": member.compressed_size,
                "compression": member.compression,
                "crc32": f"{member.crc32:08x}",
                "external_attributes": member.external_attributes,
                "flags": member.flags,
                "method": member.method,
                "name": member.name,
                "streamed_size": result.size_bytes,
                "uncompressed_size": member.uncompressed_size,
                "version_made_by": member.version_made_by,
                "version_needed": member.version_needed,
            }

        metadata: dict[str, Any] = {
            "envelope_kind": envelope_kind,
            "format_version": FORMAT_VERSION,
            "inner": {
                "sha256": result.sha256,
                "size_bytes": result.size_bytes,
            },
            "member": member_metadata,
            "outer": outer_metadata,
        }

        _publish_no_replace(
            directory_fd,
            OUTPUT_PARTIAL_BASENAME,
            OUTPUT_BASENAME,
            created_names,
        )
        _write_metadata_partial(directory_fd, metadata, created_names)
        _publish_no_replace(
            directory_fd,
            METADATA_PARTIAL_BASENAME,
            METADATA_BASENAME,
            created_names,
        )
        os.fsync(directory_fd)
        created_names.clear()
        return metadata
    except BaseException as exc:
        if created_names:
            try:
                _cleanup_created(directory_fd, created_names)
            except NormalizationError as cleanup_error:
                raise cleanup_error from exc
        if isinstance(exc, NormalizationError):
            raise
        if isinstance(exc, (KeyboardInterrupt, SystemExit)):
            raise
        raise NormalizationError("normalization failed closed") from exc
    finally:
        if file_fd >= 0:
            os.close(file_fd)
        os.close(directory_fd)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Normalize one local Lovable export envelope without restoring it."
    )
    parser.add_argument("--expected-outer-sha256", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--metadata-output", required=True, type=Path)
    parser.add_argument("input", type=Path)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        normalize(
            args.input,
            expected_outer_sha256=args.expected_outer_sha256,
            output=args.output,
            metadata_output=args.metadata_output,
        )
    except NormalizationError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 4
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
