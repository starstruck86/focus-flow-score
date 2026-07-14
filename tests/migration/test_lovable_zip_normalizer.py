from __future__ import annotations

import hashlib
import importlib.util
import os
import stat
import struct
import sys
import tempfile
import unittest
import zlib
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
TOOL = ROOT / "scripts" / "migration" / "normalize-lovable-export.py"
SPEC = importlib.util.spec_from_file_location("lovable_export_normalizer", TOOL)
assert SPEC and SPEC.loader
NORMALIZER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = NORMALIZER
SPEC.loader.exec_module(NORMALIZER)


LOCAL = struct.Struct("<4s5H3I2H")
CENTRAL = struct.Struct("<4s6H3I5H2I")
EOCD = struct.Struct("<4s4H2IH")


@dataclass
class Entry:
    name: bytes
    data: bytes
    method: int = 8
    flags: int = 0
    external_attributes: int = (stat.S_IFREG | 0o600) << 16
    version_made_by: int = (3 << 8) | 20
    version_needed: int = 20
    crc32_override: int | None = None
    compressed_size_override: int | None = None
    uncompressed_size_override: int | None = None
    local_extra: bytes = b""
    central_extra: bytes = b""
    member_comment: bytes = b""


def raw_deflate(data: bytes) -> bytes:
    compressor = zlib.compressobj(level=6, wbits=-zlib.MAX_WBITS)
    return compressor.compress(data) + compressor.flush()


def zip_bytes(entries: list[Entry]) -> bytes:
    local_records: list[bytes] = []
    central_records: list[bytes] = []
    local_offset = 0
    for entry in entries:
        if entry.method == 8:
            compressed = raw_deflate(entry.data)
        else:
            compressed = entry.data
        crc32 = (
            zlib.crc32(entry.data) & 0xFFFFFFFF
            if entry.crc32_override is None
            else entry.crc32_override
        )
        compressed_size = (
            len(compressed)
            if entry.compressed_size_override is None
            else entry.compressed_size_override
        )
        uncompressed_size = (
            len(entry.data)
            if entry.uncompressed_size_override is None
            else entry.uncompressed_size_override
        )
        local_header = LOCAL.pack(
            b"PK\x03\x04",
            entry.version_needed,
            entry.flags,
            entry.method,
            0,
            0,
            crc32,
            compressed_size,
            uncompressed_size,
            len(entry.name),
            len(entry.local_extra),
        )
        local_record = local_header + entry.name + entry.local_extra + compressed
        local_records.append(local_record)
        central_records.append(
            CENTRAL.pack(
                b"PK\x01\x02",
                entry.version_made_by,
                entry.version_needed,
                entry.flags,
                entry.method,
                0,
                0,
                crc32,
                compressed_size,
                uncompressed_size,
                len(entry.name),
                len(entry.central_extra),
                len(entry.member_comment),
                0,
                0,
                entry.external_attributes,
                local_offset,
            )
            + entry.name
            + entry.central_extra
            + entry.member_comment
        )
        local_offset += len(local_record)

    local_bytes = b"".join(local_records)
    central_bytes = b"".join(central_records)
    eocd = EOCD.pack(
        b"PK\x05\x06",
        0,
        0,
        len(entries),
        len(entries),
        len(central_bytes),
        len(local_bytes),
        0,
    )
    return local_bytes + central_bytes + eocd


class LovableZipNormalizerTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="lovable-normalizer.")
        self.root = Path(self.temporary.name)
        self.output_directory = self.root / "private output"
        self.output_directory.mkdir(mode=0o700)
        self.output = self.output_directory / "verified-inner.pgdmp"
        self.metadata_output = self.output_directory / "normalization.json"
        self.row_sentinel = b"SYNTHETIC_ROW_PAYLOAD_MUST_NOT_APPEAR_IN_METADATA"
        self.pgdmp = b"PGDMP\x01\x0e\x00\x04\x08\x01" + self.row_sentinel

    def tearDown(self):
        self.temporary.cleanup()

    def write_input(self, data: bytes, name: str = "synthetic export.zip") -> Path:
        path = self.root / name
        path.write_bytes(data)
        return path

    def normalize(
        self,
        path: Path,
        *,
        expected_sha: str | None = None,
        limits=None,
        disk_free=None,
    ):
        if expected_sha is None:
            expected_sha = hashlib.sha256(path.read_bytes()).hexdigest()
        arguments = {
            "expected_outer_sha256": expected_sha,
            "output": self.output,
            "metadata_output": self.metadata_output,
        }
        if limits is not None:
            arguments["limits"] = limits
        if disk_free is not None:
            arguments["disk_free"] = disk_free
        return NORMALIZER.normalize(path, **arguments)

    def assert_rejected(
        self,
        data: bytes,
        expected: str,
        *,
        limits=None,
        disk_free=None,
    ) -> None:
        source = self.write_input(data)
        with self.assertRaisesRegex(NORMALIZER.NormalizationError, expected):
            self.normalize(source, limits=limits, disk_free=disk_free)
        self.assertFalse(self.output.exists())
        self.assertFalse(self.metadata_output.exists())
        self.assertEqual(list(self.output_directory.iterdir()), [])

    def test_valid_single_member_zip_streams_verified_pgdmp(self):
        source_bytes = zip_bytes([Entry(b"synthetic.backup", self.pgdmp)])
        source = self.write_input(source_bytes)
        metadata = self.normalize(source)

        outer_sha = hashlib.sha256(source_bytes).hexdigest()
        inner_sha = hashlib.sha256(self.pgdmp).hexdigest()
        self.assertEqual(metadata["envelope_kind"], "zip")
        self.assertEqual(metadata["outer"]["sha256_before"], outer_sha)
        self.assertEqual(metadata["outer"]["sha256_after"], outer_sha)
        self.assertNotEqual(outer_sha, inner_sha)
        self.assertEqual(metadata["inner"], {"sha256": inner_sha, "size_bytes": len(self.pgdmp)})
        self.assertEqual(metadata["member"]["name"], "synthetic.backup")
        self.assertEqual(metadata["member"]["streamed_size"], len(self.pgdmp))
        self.assertEqual(metadata["outer"]["zip"]["entry_count"], 1)
        self.assertEqual(self.output.read_bytes(), self.pgdmp)
        self.assertEqual(stat.S_IMODE(self.output.stat().st_mode), 0o400)
        self.assertEqual(stat.S_IMODE(self.metadata_output.stat().st_mode), 0o400)
        self.assertNotIn(
            self.row_sentinel.decode("ascii"),
            self.metadata_output.read_text(encoding="utf-8"),
        )

    def test_direct_pgdmp_behavior_is_preserved(self):
        source = self.write_input(self.pgdmp, "synthetic direct.backup")
        metadata = self.normalize(source)
        digest = hashlib.sha256(self.pgdmp).hexdigest()
        self.assertEqual(metadata["envelope_kind"], "direct_pgdmp")
        self.assertIsNone(metadata["member"])
        self.assertNotIn("zip", metadata["outer"])
        self.assertEqual(metadata["outer"]["sha256_before"], digest)
        self.assertEqual(metadata["inner"]["sha256"], digest)
        self.assertEqual(self.output.read_bytes(), self.pgdmp)

    def test_rejects_multiple_and_duplicate_members(self):
        self.assert_rejected(
            zip_bytes(
                [
                    Entry(b"one.backup", self.pgdmp),
                    Entry(b"two.backup", self.pgdmp),
                ]
            ),
            "exactly one member",
        )
        self.assert_rejected(
            zip_bytes(
                [
                    Entry(b"duplicate.backup", self.pgdmp),
                    Entry(b"duplicate.backup", self.pgdmp),
                ]
            ),
            "exactly one member",
        )

    def test_rejects_unsafe_or_ambiguous_member_names(self):
        for name in (
            b"../escape.backup",
            b"/absolute.backup",
            b"folder/member.backup",
            b"folder\\member.backup",
            b"C:drive.backup",
            b"control\x01.backup",
            b"ambiguous..backup",
            b"trailing.",
            b".hidden.backup",
            "unicode-\N{LATIN SMALL LETTER E WITH ACUTE}.backup".encode("utf-8"),
        ):
            with self.subTest(name=name):
                self.assert_rejected(
                    zip_bytes([Entry(name, self.pgdmp)]),
                    "name",
                )

    def test_rejects_directory_symlink_and_special_entries(self):
        cases = {
            "directory": Entry(
                b"directory/",
                self.pgdmp,
                external_attributes=(stat.S_IFDIR | 0o700) << 16,
            ),
            "symlink": Entry(
                b"link.backup",
                self.pgdmp,
                external_attributes=(stat.S_IFLNK | 0o777) << 16,
            ),
            "character device": Entry(
                b"device.backup",
                self.pgdmp,
                external_attributes=(stat.S_IFCHR | 0o600) << 16,
            ),
            "fifo": Entry(
                b"fifo.backup",
                self.pgdmp,
                external_attributes=(stat.S_IFIFO | 0o600) << 16,
            ),
            "unknown Unix type": Entry(
                b"unknown.backup",
                self.pgdmp,
                external_attributes=0,
                version_made_by=(3 << 8) | 20,
            ),
            "DOS device": Entry(
                b"dos-device.backup",
                self.pgdmp,
                external_attributes=0x40,
                version_made_by=20,
            ),
        }
        for label, entry in cases.items():
            with self.subTest(label=label):
                self.assert_rejected(zip_bytes([entry]), "regular|directory|name")

    def test_rejects_encryption_unsupported_compression_and_nested_archive(self):
        self.assert_rejected(
            zip_bytes([Entry(b"encrypted.backup", self.pgdmp, flags=1)]),
            "encrypted",
        )
        self.assert_rejected(
            zip_bytes([Entry(b"unsupported.backup", self.pgdmp, method=12)]),
            "unsupported ZIP compression",
        )
        self.assert_rejected(
            zip_bytes([Entry(b"nested.backup", zip_bytes([Entry(b"inner.backup", self.pgdmp)]), method=0)]),
            "nested archive",
        )
        self.assert_rejected(
            zip_bytes([Entry(b"nested.zip", self.pgdmp)]),
            "nested archive",
        )

    def test_rejects_descriptor_extras_comments_zip64_and_header_mismatch(self):
        self.assert_rejected(
            zip_bytes([Entry(b"descriptor.backup", self.pgdmp, flags=0x0008)]),
            "data descriptors",
        )
        self.assert_rejected(
            zip_bytes(
                [Entry(b"local-extra.backup", self.pgdmp, local_extra=b"\x01\x00")]
            ),
            "local extra fields",
        )
        self.assert_rejected(
            zip_bytes(
                [
                    Entry(
                        b"central-extra.backup",
                        self.pgdmp,
                        central_extra=b"\x01\x00",
                    )
                ]
            ),
            "extra fields",
        )
        self.assert_rejected(
            zip_bytes(
                [
                    Entry(
                        b"member-comment.backup",
                        self.pgdmp,
                        member_comment=b"comment",
                    )
                ]
            ),
            "member comments",
        )
        self.assert_rejected(
            zip_bytes([Entry(b"zip64.backup", self.pgdmp, version_needed=45)]),
            "ZIP64",
        )

        mismatch = bytearray(
            zip_bytes([Entry(b"mismatch.backup", self.pgdmp, method=8)])
        )
        struct.pack_into("<H", mismatch, 8, 0)
        self.assert_rejected(bytes(mismatch), "local and central metadata differ")

        archive_comment = bytearray(
            zip_bytes([Entry(b"archive-comment.backup", self.pgdmp)])
        )
        struct.pack_into("<H", archive_comment, len(archive_comment) - 2, 7)
        archive_comment.extend(b"comment")
        self.assert_rejected(
            bytes(archive_comment),
            "EOCD|trailing bytes|archive comments",
        )

    def test_rejects_empty_non_pgdmp_bad_crc_and_truncation(self):
        self.assert_rejected(zip_bytes([Entry(b"empty.backup", b"")]), "nonempty")
        self.assert_rejected(
            zip_bytes([Entry(b"plain.backup", b"not a database archive")]),
            "not a PGDMP",
        )
        self.assert_rejected(
            zip_bytes([Entry(b"bad-crc.backup", self.pgdmp, crc32_override=0)]),
            "CRC32",
        )
        self.assert_rejected(
            zip_bytes([Entry(b"truncated.backup", self.pgdmp)])[:-3],
            "trailing bytes|truncated|EOCD",
        )

    def test_rejects_size_lie_streamed_overflow_and_compression_bomb(self):
        self.assert_rejected(
            zip_bytes(
                [
                    Entry(
                        b"declared-too-large.backup",
                        self.pgdmp,
                        uncompressed_size_override=101,
                    )
                ]
            ),
            "declared-size cap",
            limits=NORMALIZER.Limits(
                max_outer_bytes=10_000,
                max_inner_bytes=100,
                max_compression_ratio=100,
                minimum_disk_reserve_bytes=1,
            ),
        )

        self.assert_rejected(
            zip_bytes(
                [
                    Entry(
                        b"size-lie.backup",
                        self.pgdmp,
                        uncompressed_size_override=len(self.pgdmp) + 1,
                    )
                ]
            ),
            "length differs",
        )

        expanded = b"PGDMP" + b"x" * 100
        self.assert_rejected(
            zip_bytes(
                [
                    Entry(
                        b"stream-overflow.backup",
                        expanded,
                        uncompressed_size_override=10,
                    )
                ]
            ),
            "streaming byte cap|length differs",
            limits=NORMALIZER.Limits(
                max_outer_bytes=10_000,
                max_inner_bytes=20,
                max_compression_ratio=100,
                minimum_disk_reserve_bytes=1,
            ),
        )

        bomb = b"PGDMP" + b"0" * 50_000
        self.assert_rejected(
            zip_bytes([Entry(b"bomb.backup", bomb)]),
            "compression ratio",
            limits=NORMALIZER.Limits(
                max_outer_bytes=100_000,
                max_inner_bytes=100_000,
                max_compression_ratio=2,
                minimum_disk_reserve_bytes=1,
            ),
        )

        compressed_bomb = raw_deflate(bomb)
        lying_declared_size = len(compressed_bomb)
        self.assert_rejected(
            zip_bytes(
                [
                    Entry(
                        b"streaming-ratio.backup",
                        bomb,
                        uncompressed_size_override=lying_declared_size,
                    )
                ]
            ),
            "streaming compression ratio",
            limits=NORMALIZER.Limits(
                max_outer_bytes=100_000,
                max_inner_bytes=100_000,
                max_compression_ratio=1,
                minimum_disk_reserve_bytes=1,
            ),
        )

    def test_rejects_insufficient_disk_headroom(self):
        self.assert_rejected(
            zip_bytes([Entry(b"disk.backup", self.pgdmp)]),
            "insufficient disk headroom",
            disk_free=lambda _directory_fd: 0,
        )

    def test_rejects_prefix_polyglot_trailing_junk_and_malformed_structure(self):
        valid = zip_bytes([Entry(b"strict.backup", self.pgdmp)])
        self.assert_rejected(b"PGDMP-polyglot-prefix" + valid, "PGDMP|byte cap")
        self.assert_rejected(b"prefix" + valid, "central|local|prefix|strict ZIP")
        self.assert_rejected(valid + b"trailing", "trailing bytes|EOCD")
        central_offset = valid.index(b"PK\x01\x02")
        malformed = bytearray(valid)
        malformed[central_offset : central_offset + 4] = b"BAD!"
        self.assert_rejected(bytes(malformed), "central-directory signature")

    def test_rejects_wrong_expected_sha_symlink_input_and_existing_outputs(self):
        source = self.write_input(zip_bytes([Entry(b"safe.backup", self.pgdmp)]))
        with self.assertRaisesRegex(NORMALIZER.NormalizationError, "expected digest"):
            self.normalize(source, expected_sha="0" * 64)
        self.assertEqual(list(self.output_directory.iterdir()), [])

        backing = self.write_input(source.read_bytes(), "backing.zip")
        link = self.root / "linked.zip"
        link.symlink_to(backing)
        with self.assertRaisesRegex(NORMALIZER.NormalizationError, "symlink"):
            self.normalize(link, expected_sha=hashlib.sha256(backing.read_bytes()).hexdigest())
        self.assertEqual(list(self.output_directory.iterdir()), [])

        self.output.write_bytes(b"existing")
        with self.assertRaisesRegex(NORMALIZER.NormalizationError, "already exists"):
            self.normalize(source)
        self.assertEqual(self.output.read_bytes(), b"existing")
        self.assertFalse(self.metadata_output.exists())

    def test_canonical_mutation_fails_and_removes_partial_outputs(self):
        source = self.write_input(zip_bytes([Entry(b"mutable.backup", self.pgdmp)]))
        calls = 0

        def mutate_after_parse(_directory_fd: int) -> int:
            nonlocal calls
            calls += 1
            if calls == 1:
                with source.open("r+b") as artifact:
                    artifact.seek(10)
                    original = artifact.read(1)
                    artifact.seek(10)
                    artifact.write(bytes([original[0] ^ 1]))
                    artifact.flush()
                    os.fsync(artifact.fileno())
            return 10**12

        with self.assertRaisesRegex(
            NORMALIZER.NormalizationError,
            "outer artifact metadata changed|outer artifact changed",
        ):
            self.normalize(source, disk_free=mutate_after_parse)
        self.assertEqual(list(self.output_directory.iterdir()), [])

    def test_corrupt_crc_partial_extraction_leaves_no_outputs(self):
        self.assert_rejected(
            zip_bytes([Entry(b"partial.backup", self.pgdmp, crc32_override=1)]),
            "CRC32",
        )


if __name__ == "__main__":
    unittest.main()
