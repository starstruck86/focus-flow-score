#!/usr/bin/env python3
"""Render a sanitized, metadata-only report from a pg_restore TOC list.

The archive itself is opened only to compute its byte length, SHA-256 digest,
and PGDMP archive-format version. Row payload bytes are never decoded or
emitted. The caller supplies the SHA-256 captured around ``pg_restore --list``;
this helper recomputes it so the TOC and report cannot refer to different
archive byte snapshots.
"""

from __future__ import annotations

import argparse
import hashlib
import re
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional


KNOWN_TOC_CLASSES = frozenset(
    {
        "ACCESS METHOD",
        "ACL",
        "AGGREGATE",
        "BLOB",
        "BLOB DATA",
        "BLOB METADATA",
        "CAST",
        "CHECK CONSTRAINT",
        "COLLATION",
        "COMMENT",
        "CONSTRAINT",
        "CONVERSION",
        "DATABASE",
        "DATABASE PROPERTIES",
        "DEFAULT",
        "DEFAULT ACL",
        "DOMAIN",
        "DOMAIN CONSTRAINT",
        "EVENT TRIGGER",
        "EXTENSION",
        "FK CONSTRAINT",
        "FOREIGN DATA WRAPPER",
        "FOREIGN SERVER",
        "FOREIGN TABLE",
        "FUNCTION",
        "INDEX",
        "INDEX ATTACH",
        "LANGUAGE",
        "LARGE OBJECT",
        "LARGE OBJECT DATA",
        "MATERIALIZED VIEW",
        "MATERIALIZED VIEW DATA",
        "OPERATOR",
        "OPERATOR CLASS",
        "OPERATOR FAMILY",
        "POLICY",
        "PROCEDURE",
        "PROTOCOL",
        "PUBLICATION",
        "PUBLICATION TABLE",
        "PUBLICATION TABLES IN SCHEMA",
        "ROW SECURITY",
        "RULE",
        "SCHEMA",
        "SECURITY LABEL",
        "SEQUENCE",
        "SEQUENCE OWNED BY",
        "SEQUENCE SET",
        "SHELL TYPE",
        "STATISTICS",
        "STATISTICS DATA",
        "SUBSCRIPTION",
        "TABLE",
        "TABLE ATTACH",
        "TABLE DATA",
        "TABLESPACE",
        "TEXT SEARCH CONFIGURATION",
        "TEXT SEARCH DICTIONARY",
        "TEXT SEARCH PARSER",
        "TEXT SEARCH TEMPLATE",
        "TRANSFORM",
        "TRIGGER",
        "TYPE",
        "USER MAPPING",
        "VIEW",
    }
)
KNOWN_TOC_CLASSES_LONGEST_FIRST = tuple(
    sorted(KNOWN_TOC_CLASSES, key=lambda value: (-len(value), value))
)
DATA_TOC_CLASSES = frozenset(
    {
        "BLOB DATA",
        "LARGE OBJECT DATA",
        "MATERIALIZED VIEW DATA",
        "STATISTICS DATA",
        "TABLE DATA",
    }
)
OWNER_BEARING_CLASSES = frozenset(
    {
        "ACCESS METHOD",
        "AGGREGATE",
        "COLLATION",
        "CONVERSION",
        "DATABASE",
        "DOMAIN",
        "EVENT TRIGGER",
        "EXTENSION",
        "FOREIGN DATA WRAPPER",
        "FOREIGN SERVER",
        "FOREIGN TABLE",
        "FUNCTION",
        "INDEX",
        "LANGUAGE",
        "MATERIALIZED VIEW",
        "OPERATOR",
        "OPERATOR CLASS",
        "OPERATOR FAMILY",
        "PROCEDURE",
        "PUBLICATION",
        "SCHEMA",
        "SEQUENCE",
        "STATISTICS",
        "SUBSCRIPTION",
        "TABLE",
        "TEXT SEARCH CONFIGURATION",
        "TEXT SEARCH DICTIONARY",
        "TEXT SEARCH PARSER",
        "TEXT SEARCH TEMPLATE",
        "TRANSFORM",
        "TRIGGER",
        "TYPE",
        "VIEW",
    }
)
MANAGED_SCHEMAS = frozenset(
    {
        "auth",
        "cron",
        "extensions",
        "graphql",
        "graphql_public",
        "net",
        "pgbouncer",
        "pgmq",
        "pgsodium",
        "pgsodium_masks",
        "realtime",
        "storage",
        "supabase_functions",
        "supabase_migrations",
        "vault",
    }
)
IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_$]*$")
# PostgreSQL's text TOC output does not provide a reliably parseable quoted
# identifier for every object class.  Extension names are also control-file
# names in practice, and repository-known extensions such as ``uuid-ossp``
# contain a hyphen that is intentionally rejected by ``IDENTIFIER_RE``.  Keep
# this exception class-specific and narrow: ASCII identifier-like segments,
# separated by single hyphens, with no leading, trailing, or repeated hyphen.
HYPHENATED_EXTENSION_NAME_RE = re.compile(
    r"^[A-Za-z_][A-Za-z0-9_]*(?:-[A-Za-z0-9_]+)+$"
)
ROUTINE_TOC_RE = re.compile(
    r"^([A-Za-z_][A-Za-z0-9_$]*|-) "
    r"([A-Za-z_][A-Za-z0-9_$]*)\(([^()]*)\)"
    r"(?: ([A-Za-z_][A-Za-z0-9_$]*|-))?$"
)
ROUTINE_TOC_CLASSES = frozenset({"AGGREGATE", "FUNCTION", "PROCEDURE"})
GENERIC_SINGLE_NAME_TOC_CLASSES = frozenset(
    {
        "ACCESS METHOD",
        "COLLATION",
        "CONVERSION",
        "DATABASE",
        "DOMAIN",
        "EVENT TRIGGER",
        "FOREIGN DATA WRAPPER",
        "FOREIGN SERVER",
        "FOREIGN TABLE",
        "INDEX",
        "LANGUAGE",
        "MATERIALIZED VIEW",
        "PUBLICATION",
        "SEQUENCE",
        "STATISTICS",
        "SUBSCRIPTION",
        "TABLE",
        "TABLESPACE",
        "TEXT SEARCH CONFIGURATION",
        "TEXT SEARCH DICTIONARY",
        "TEXT SEARCH PARSER",
        "TEXT SEARCH TEMPLATE",
        "TRANSFORM",
        "TYPE",
        "VIEW",
    }
)
TOC_LINE_RE = re.compile(r"^\s*(\d+);\s+(\d+)\s+(\d+)\s+(.+?)\s*$")
# ``pg_restore --list`` emits these values as free-form comment text.  Accept
# only an exact, bounded ASCII grammar: numeric components, or PostgreSQL's
# explicit ``betaN``, ``rcN``, and ``devel`` prerelease forms.  Vendor suffixes
# and any trailing text are never copied to visible or retained evidence.
# Prefix recognition is separate so an unsafe value can be represented by one
# fixed redaction token.
SAFE_VERSION_VALUE_PATTERN = (
    r"[0-9]{1,3}(?:\.[0-9]{1,3}){0,3}"
    r"(?:(?:beta|rc)[0-9]{1,3}|devel)?"
)
SOURCE_POSTGRES_VERSION_RE = re.compile(
    rf"^;[ \t]{{0,8}}Dumped from database version:[ \t]"
    rf"({SAFE_VERSION_VALUE_PATTERN})[ \t]{{0,4}}$",
    re.ASCII,
)
PG_DUMP_VERSION_RE = re.compile(
    rf"^;[ \t]{{0,8}}Dumped by pg_dump version:[ \t]"
    rf"({SAFE_VERSION_VALUE_PATTERN})[ \t]{{0,4}}$",
    re.ASCII,
)
SOURCE_POSTGRES_VERSION_PREFIX_RE = re.compile(
    r"^;[ \t]{0,8}Dumped from database version:[ \t]",
    re.ASCII,
)
PG_DUMP_VERSION_PREFIX_RE = re.compile(
    r"^;[ \t]{0,8}Dumped by pg_dump version:[ \t]",
    re.ASCII,
)
REDACTED_VERSION = "REDACTED_UNSAFE_OR_UNRECOGNIZED"
MAX_VERSION_HEADER_LINE_BYTES = 160
MAX_VERSION_HEADER_CANDIDATES = 4
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")

REASON_UNKNOWN_TOC_CLASS = "unknown_toc_class"
REASON_UNRESOLVED_KNOWN_TOC_ENTRY = "unresolved_known_toc_entry"
REASON_MALFORMED_TOC = "malformed_toc"
REASON_DUPLICATE_TOC_ID = "duplicate_toc_id"
REASON_CONFLICTING_SOURCE_VERSION = "conflicting_source_version"
REASON_CONFLICTING_PG_DUMP_VERSION = "conflicting_pg_dump_version"
REASON_MIGRATION_METADATA_UNREADABLE = "migration_metadata_unreadable"
REASON_OTHER_NONZERO = "other_nonzero"
ALLOWED_FAILURE_REASONS = frozenset(
    {
        REASON_UNKNOWN_TOC_CLASS,
        REASON_UNRESOLVED_KNOWN_TOC_ENTRY,
        REASON_MALFORMED_TOC,
        REASON_DUPLICATE_TOC_ID,
        REASON_CONFLICTING_SOURCE_VERSION,
        REASON_CONFLICTING_PG_DUMP_VERSION,
        REASON_MIGRATION_METADATA_UNREADABLE,
        REASON_OTHER_NONZERO,
    }
)


class InspectionError(RuntimeError):
    """A private helper failure reduced to one approved public reason."""

    def __init__(self, reason: str):
        if reason not in ALLOWED_FAILURE_REASONS:
            raise ValueError("unapproved Lovable dump report failure reason")
        self.reason = reason
        super().__init__(reason)


class FailClosedArgumentParser(argparse.ArgumentParser):
    """Convert every argument failure to the non-sensitive helper protocol."""

    def error(self, _message: str) -> None:
        raise InspectionError(REASON_OTHER_NONZERO)


@dataclass(frozen=True)
class TocEntry:
    toc_id: int
    object_class: str
    remainder: str
    line_number: int


@dataclass(frozen=True)
class ObjectRef:
    object_class: str
    schema: str
    name: str


@dataclass(frozen=True)
class TocProvenance:
    source_postgresql_version: Optional[str]
    pg_dump_version: Optional[str]


def parse_args() -> argparse.Namespace:
    parser = FailClosedArgumentParser(add_help=False)
    parser.add_argument("--dump", required=True, type=Path)
    parser.add_argument("--toc", required=True, type=Path)
    parser.add_argument("--pg-restore-version", required=True)
    parser.add_argument("--expected-sha256", required=True)
    parser.add_argument("--input-name", required=True)
    parser.add_argument("--migrations-dir", required=True, type=Path)
    return parser.parse_args()


def archive_fingerprint(path: Path) -> tuple[int, str, str]:
    digest = hashlib.sha256()
    size = 0
    header = b""

    with path.open("rb") as archive:
        while True:
            chunk = archive.read(1024 * 1024)
            if not chunk:
                break
            if len(header) < 11:
                header += chunk[: 11 - len(header)]
            size += len(chunk)
            digest.update(chunk)

    if not header.startswith(b"PGDMP"):
        raise InspectionError(REASON_OTHER_NONZERO)
    if len(header) < 8:
        raise InspectionError(REASON_OTHER_NONZERO)

    archive_version = f"{header[5]}.{header[6]}.{header[7]}"
    return size, digest.hexdigest(), archive_version


def identify_toc_class(payload: str, line_number: int) -> tuple[str, str]:
    for object_class in KNOWN_TOC_CLASSES_LONGEST_FIRST:
        if payload == object_class:
            return object_class, ""
        prefix = object_class + " "
        if payload.startswith(prefix):
            return object_class, payload[len(prefix) :]

    # Do not echo unclassified TOC text: until the class is recognized, none
    # of that line is trusted metadata suitable for a report or error message.
    raise InspectionError(REASON_UNKNOWN_TOC_CLASS)


def parse_toc(path: Path) -> tuple[list[TocEntry], TocProvenance]:
    entries: list[TocEntry] = []
    try:
        text = path.read_text(encoding="utf-8", errors="strict")
    except UnicodeError as exc:
        raise InspectionError(REASON_MALFORMED_TOC) from exc
    source_postgresql_versions: set[str] = set()
    pg_dump_versions: set[str] = set()
    source_header_identities: set[str] = set()
    pg_dump_header_identities: set[str] = set()
    source_header_candidates = 0
    pg_dump_header_candidates = 0
    source_version_redacted = False
    pg_dump_version_redacted = False

    for line_number, line in enumerate(text.splitlines(), start=1):
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith(";"):
            if SOURCE_POSTGRES_VERSION_PREFIX_RE.match(line):
                source_header_candidates += 1
                if source_header_candidates > MAX_VERSION_HEADER_CANDIDATES:
                    raise InspectionError(REASON_CONFLICTING_SOURCE_VERSION)
                encoded_header = line.encode("utf-8")
                source_header_identities.add(
                    hashlib.sha256(encoded_header).hexdigest()
                )
                source_match = (
                    SOURCE_POSTGRES_VERSION_RE.fullmatch(line)
                    if len(encoded_header) <= MAX_VERSION_HEADER_LINE_BYTES
                    else None
                )
                if source_match is None:
                    source_version_redacted = True
                else:
                    source_postgresql_versions.add(source_match.group(1))
            if PG_DUMP_VERSION_PREFIX_RE.match(line):
                pg_dump_header_candidates += 1
                if pg_dump_header_candidates > MAX_VERSION_HEADER_CANDIDATES:
                    raise InspectionError(REASON_CONFLICTING_PG_DUMP_VERSION)
                encoded_header = line.encode("utf-8")
                pg_dump_header_identities.add(
                    hashlib.sha256(encoded_header).hexdigest()
                )
                dump_match = (
                    PG_DUMP_VERSION_RE.fullmatch(line)
                    if len(encoded_header) <= MAX_VERSION_HEADER_LINE_BYTES
                    else None
                )
                if dump_match is None:
                    pg_dump_version_redacted = True
                else:
                    pg_dump_versions.add(dump_match.group(1))
            continue
        match = TOC_LINE_RE.match(line)
        if not match:
            raise InspectionError(REASON_MALFORMED_TOC)
        object_class, remainder = identify_toc_class(match.group(4), line_number)
        entries.append(
            TocEntry(
                toc_id=int(match.group(1)),
                object_class=object_class,
                remainder=remainder,
                line_number=line_number,
            )
        )

    if not entries:
        raise InspectionError(REASON_MALFORMED_TOC)
    if len({entry.toc_id for entry in entries}) != len(entries):
        raise InspectionError(REASON_DUPLICATE_TOC_ID)
    if len(source_header_identities) > 1:
        raise InspectionError(REASON_CONFLICTING_SOURCE_VERSION)
    if len(pg_dump_header_identities) > 1:
        raise InspectionError(REASON_CONFLICTING_PG_DUMP_VERSION)

    return entries, TocProvenance(
        source_postgresql_version=(
            REDACTED_VERSION
            if source_version_redacted
            else next(iter(source_postgresql_versions), None)
        ),
        pg_dump_version=(
            REDACTED_VERSION
            if pg_dump_version_redacted
            else next(iter(pg_dump_versions), None)
        ),
    )


def clean_identifier(value: str) -> Optional[str]:
    # pg_restore --list does not promise SQL-identifier quoting here. Treat a
    # quote as object-name data, not syntax that this parser may strip.
    if '"' in value:
        return None
    return value if IDENTIFIER_RE.fullmatch(value) else None


def clean_extension_name(value: str) -> Optional[str]:
    """Normalize only conservative ASCII extension names from a TOC entry."""

    if IDENTIFIER_RE.fullmatch(value):
        return value
    return value if HYPHENATED_EXTENSION_NAME_RE.fullmatch(value) else None


def object_ref(entry: TocEntry) -> Optional[ObjectRef]:
    if entry.object_class in DATA_TOC_CLASSES or entry.object_class in {
        "ACL",
        "BLOB METADATA",
        "COMMENT",
        "DEFAULT ACL",
        "SECURITY LABEL",
    }:
        return None

    if entry.object_class in ROUTINE_TOC_CLASSES:
        routine_match = ROUTINE_TOC_RE.fullmatch(entry.remainder)
        if routine_match is None:
            return None
        schema = (
            "-"
            if routine_match.group(1) == "-"
            else clean_identifier(routine_match.group(1))
        )
        name = clean_identifier(routine_match.group(2))
        if not schema or not name:
            return None
        return ObjectRef(entry.object_class, schema, name)

    tokens = entry.remainder.split()
    if len(tokens) < 2:
        return None

    if entry.object_class == "SCHEMA":
        if len(tokens) != 3 or tokens[0] != "-" or not (
            tokens[2] == "-" or IDENTIFIER_RE.fullmatch(tokens[2])
        ):
            return None
        schema = clean_identifier(tokens[1])
        return ObjectRef("SCHEMA", schema, schema) if schema else None

    if entry.object_class == "EXTENSION":
        # pg_restore --list renders the repository-known shape as
        # ``EXTENSION - uuid-ossp <owner>``; ownerless list output such as
        # ``EXTENSION - pgcrypto`` is also emitted by PostgreSQL.  Requiring
        # exactly those two layouts avoids accepting a whitespace-containing
        # or otherwise ambiguous name by considering only its first token.
        if len(tokens) not in (2, 3) or tokens[0] != "-":
            return None
        if len(tokens) == 3 and not (
            tokens[2] == "-" or IDENTIFIER_RE.fullmatch(tokens[2])
        ):
            return None
        name = clean_extension_name(tokens[1])
        return ObjectRef("EXTENSION", "-", name) if name else None

    if entry.object_class not in GENERIC_SINGLE_NAME_TOC_CLASSES:
        return None
    if len(tokens) != 3 or not (
        tokens[2] == "-" or IDENTIFIER_RE.fullmatch(tokens[2])
    ):
        return None
    schema = clean_identifier(tokens[0]) if tokens[0] != "-" else "-"
    name = clean_identifier(tokens[1])
    if not schema or not name:
        return None
    return ObjectRef(entry.object_class, schema, name)


def owner_reference_count(entries: Iterable[TocEntry]) -> int:
    count = 0
    for entry in entries:
        if entry.object_class not in OWNER_BEARING_CLASSES:
            continue
        tokens = entry.remainder.split()
        if len(tokens) >= 3 and tokens[-1] != "-":
            count += 1
    return count


def schema_for_flag(entry: TocEntry) -> Optional[str]:
    ref = object_ref(entry)
    if ref is None:
        tokens = entry.remainder.split()
        if not tokens:
            return None
        return clean_identifier(tokens[0]) if tokens[0] != "-" else None
    return ref.schema if ref.schema != "-" else ref.name


MIGRATION_CLASS_PREFIXES = {
    "COLLATION": r"(?:create|alter)\s+collation",
    "DOMAIN": r"(?:create|alter)\s+domain",
    "EVENT TRIGGER": r"(?:create|alter)\s+event\s+trigger",
    "EXTENSION": r"(?:create|alter)\s+extension",
    "FOREIGN TABLE": r"(?:create|alter)\s+foreign\s+table",
    "FUNCTION": r"(?:create|alter)(?:\s+or\s+replace)?\s+function",
    "INDEX": (
        r"(?:create(?:\s+unique)?\s+index(?:\s+concurrently)?|"
        r"alter\s+index)"
    ),
    "LANGUAGE": (
        r"(?:create(?:\s+or\s+replace)?(?:\s+trusted)?"
        r"(?:\s+procedural)?|alter(?:\s+procedural)?)\s+language"
    ),
    "MATERIALIZED VIEW": r"(?:create|alter)\s+materialized\s+view",
    "POLICY": r"(?:create|alter)\s+policy",
    "PROCEDURE": r"(?:create|alter)(?:\s+or\s+replace)?\s+procedure",
    "PUBLICATION": r"(?:create|alter)\s+publication",
    "SCHEMA": r"(?:create|alter)\s+schema",
    "SEQUENCE": r"(?:create|alter)\s+sequence",
    "STATISTICS": r"(?:create|alter)\s+statistics",
    "SUBSCRIPTION": r"(?:create|alter)\s+subscription",
    "TABLE": r"(?:create|alter)\s+table",
    "TRIGGER": r"(?:create|alter)\s+trigger",
    "TYPE": r"(?:create|alter)\s+type",
    "VIEW": r"(?:create|alter)(?:\s+or\s+replace)?\s+view",
}

# These classes do not carry a standalone object reference for the report's
# purpose, or refer only to data payload/position rather than a schema object.
# Every other recognized TOC class participates in the conservative analysis:
# failing to normalize any such entry makes object-reference and duplicate
# analysis incomplete rather than silently omitting it.
OBJECT_REFERENCE_EXEMPT_CLASSES = DATA_TOC_CLASSES | {
    "ACL",
    "BLOB",
    "BLOB METADATA",
    "COMMENT",
    "DEFAULT ACL",
    "LARGE OBJECT",
    "SECURITY LABEL",
    "SEQUENCE SET",
}
OBJECT_REFERENCE_REQUIRED_CLASSES = (
    KNOWN_TOC_CLASSES - OBJECT_REFERENCE_EXEMPT_CLASSES
)
UNRESOLVED_CLASS_COUNT_KEYS = tuple(sorted(KNOWN_TOC_CLASSES))


def unresolved_required_object_references(
    entries: Iterable[TocEntry],
) -> Counter[str]:
    """Count recognized entries whose object reference is not losslessly parsed."""

    return Counter(
        entry.object_class
        for entry in entries
        if entry.object_class in OBJECT_REFERENCE_REQUIRED_CLASSES
        and object_ref(entry) is None
    )


def quoted_identifier_pattern(identifier: str) -> str:
    escaped = re.escape(identifier)
    return rf'(?:"{escaped}"|{escaped})'


def migration_definition_pattern(ref: ObjectRef) -> Optional[re.Pattern[str]]:
    prefix = MIGRATION_CLASS_PREFIXES.get(ref.object_class)
    if prefix is None:
        return None

    name_pattern = quoted_identifier_pattern(ref.name)
    if ref.object_class == "SCHEMA":
        qualified = name_pattern
    elif ref.schema == "public":
        schema_pattern = quoted_identifier_pattern("public")
        qualified = rf"(?:(?:{schema_pattern})\s*\.\s*)?{name_pattern}"
    elif ref.schema == "-":
        qualified = name_pattern
    else:
        schema_pattern = quoted_identifier_pattern(ref.schema)
        qualified = rf"(?:{schema_pattern})\s*\.\s*{name_pattern}"

    return re.compile(
        rf"\b{prefix}\s+(?:if\s+(?:not\s+)?exists\s+)?{qualified}(?![A-Za-z0-9_$])",
        re.IGNORECASE,
    )


def load_migration_text(migrations_dir: Path) -> list[tuple[str, str]]:
    migration_text: list[tuple[str, str]] = []
    try:
        migration_paths = sorted(migrations_dir.rglob("*.sql"))
        for path in migration_paths:
            if not path.is_file():
                continue
            content = path.read_text(encoding="utf-8", errors="strict")
            migration_text.append((path.name, content))
    except (OSError, UnicodeError) as exc:
        raise InspectionError(REASON_MIGRATION_METADATA_UNREADABLE) from exc
    return migration_text


def find_migration_duplicates(
    entries: Iterable[TocEntry], migration_text: Iterable[tuple[str, str]]
) -> list[tuple[ObjectRef, str]]:

    duplicates: set[tuple[ObjectRef, str]] = set()
    for entry in entries:
        ref = object_ref(entry)
        if ref is None:
            continue
        pattern = migration_definition_pattern(ref)
        if pattern is None:
            continue
        for filename, content in migration_text:
            if pattern.search(content):
                duplicates.add((ref, filename))

    return sorted(
        duplicates,
        key=lambda item: (
            item[0].schema,
            item[0].name,
            item[0].object_class,
            item[1],
        ),
    )


def flag_line(label: str, count: int) -> str:
    state = "PRESENT" if count else "none"
    return f"{label}: {state} ({count})"


def build_report(args: argparse.Namespace) -> str:
    size, sha256, archive_version = archive_fingerprint(args.dump)
    if not SHA256_RE.fullmatch(args.expected_sha256):
        raise InspectionError(REASON_OTHER_NONZERO)
    if sha256 != args.expected_sha256:
        raise InspectionError(REASON_OTHER_NONZERO)
    if Path(args.input_name).name != args.input_name or any(
        character in args.input_name for character in ("\n", "\r")
    ):
        raise InspectionError(REASON_OTHER_NONZERO)

    entries, toc_provenance = parse_toc(args.toc)
    class_counts = Counter(entry.object_class for entry in entries)
    unresolved_counts = unresolved_required_object_references(entries)
    unresolved_total = sum(unresolved_counts.values())
    migration_text: list[tuple[str, str]] = []
    if not unresolved_total:
        migration_text = load_migration_text(args.migrations_dir)
    data_entries = sum(class_counts[name] for name in DATA_TOC_CLASSES)

    source_postgresql_version = (
        toc_provenance.source_postgresql_version or "UNKNOWN_NOT_REPORTED"
    )
    pg_dump_version = toc_provenance.pg_dump_version or "UNKNOWN_NOT_REPORTED"

    if unresolved_total:
        # PostgreSQL's list format is not a lossless serialization of every
        # namespace, tag, and owner.  Once a recognized object-bearing entry
        # cannot be normalized, do not run name-, schema-, owner-, or
        # migration-definition analysis. Retain only fixed-class aggregate
        # evidence and a hard blocked restore-planning gate.
        lines = [
            "LOVABLE CLOUD DUMP — METADATA-ONLY INSPECTION",
            "inspection_status: REVIEW_REQUIRED",
            "object_reference_analysis: INCOMPLETE",
            "migration_duplicate_analysis: INCOMPLETE",
            "restore_planning_gate: BLOCKED",
            "scope: archive header, SHA-256, pg_restore TOC metadata, aggregate unresolved-object counts",
            "restore_attempted: no",
            "database_connection_attempted: no",
            "row_payload_inspected: no",
            f"size_bytes: {size}",
            f"sha256: {sha256}",
            "archive_format: PostgreSQL custom archive (PGDMP)",
            f"archive_format_version: {archive_version}",
            f"source_postgresql_version: {source_postgresql_version}",
            f"source_pg_dump_version: {pg_dump_version}",
            f"pg_restore_version: {args.pg_restore_version}",
            "pg_restore_list_compatibility: PASS",
            "archive_snapshot_binding: PASS "
            "(TOC and SHA-256 use one private read-only capture)",
            f"toc_entries: {len(entries)}",
            f"toc_metadata_entries: {len(entries) - data_entries}",
            f"toc_data_references_not_extracted: {data_entries}",
            "unknown_toc_classes: none (inspection fails closed if encountered)",
            f"unresolved_known_toc_entries: {unresolved_total}",
            "",
            "UNRESOLVED KNOWN TOC CLASS COUNTS",
        ]
        for object_class in UNRESOLVED_CLASS_COUNT_KEYS:
            lines.append(f"{object_class}: {unresolved_counts[object_class]}")
        lines.extend(
            [
                "",
                "BOUNDARY",
                "This report is an inventory aid, not a restore plan or completeness proof.",
                "Object-reference analysis is incomplete; restore planning remains blocked.",
            ]
        )
        return "\n".join(lines) + "\n"

    owners = owner_reference_count(entries)
    acl = sum(
        class_counts[name] for name in ("ACL", "DEFAULT ACL")
    )
    extensions = class_counts["EXTENSION"]
    subscriptions = class_counts["SUBSCRIPTION"]
    event_triggers = class_counts["EVENT TRIGGER"]
    publications = sum(
        count
        for name, count in class_counts.items()
        if name == "PUBLICATION" or name.startswith("PUBLICATION ")
    )
    schemas = [schema_for_flag(entry) for entry in entries]
    managed = sum(schema in MANAGED_SCHEMAS for schema in schemas if schema)
    auth = sum(schema == "auth" for schema in schemas)
    storage = sum(schema == "storage" for schema in schemas)
    supabase_prefixed = 0
    for entry, schema in zip(entries, schemas):
        tokens = entry.remainder.split()
        metadata_tokens = [token.strip('"').lower() for token in tokens[:-1]]
        if (schema and schema.lower().startswith("supabase_")) or any(
            token.startswith("supabase_") for token in metadata_tokens
        ):
            supabase_prefixed += 1

    duplicates = find_migration_duplicates(entries, migration_text)
    role_references = owners + acl
    not_object_normalized = Counter(
        entry.object_class for entry in entries if object_ref(entry) is None
    )

    lines = [
        "LOVABLE CLOUD DUMP — METADATA-ONLY INSPECTION",
        "inspection_status: REVIEW_REQUIRED",
        "object_reference_analysis: COMPLETE",
        "migration_duplicate_analysis: CONSERVATIVE",
        "restore_planning_gate: BLOCKED",
        "scope: archive header, SHA-256, pg_restore TOC metadata, conservative migration-name comparison",
        "restore_attempted: no",
        "database_connection_attempted: no",
        "row_payload_inspected: no",
        f"input_file: {args.input_name}",
        f"size_bytes: {size}",
        f"sha256: {sha256}",
        "archive_format: PostgreSQL custom archive (PGDMP)",
        f"archive_format_version: {archive_version}",
        f"source_postgresql_version: {source_postgresql_version}",
        f"source_pg_dump_version: {pg_dump_version}",
        f"pg_restore_version: {args.pg_restore_version}",
        "pg_restore_list_compatibility: PASS",
        "archive_snapshot_binding: PASS "
        "(TOC and SHA-256 use one private read-only capture)",
        f"toc_entries: {len(entries)}",
        f"toc_metadata_entries: {len(entries) - data_entries}",
        f"toc_data_references_not_extracted: {data_entries}",
        "unknown_toc_classes: none (inspection fails closed if encountered)",
        "unresolved_known_toc_entries: 0",
        "",
        "TOC CLASS COUNTS",
    ]
    for object_class in sorted(class_counts):
        lines.append(f"{object_class}: {class_counts[object_class]}")

    lines.extend(["", "UNRESOLVED KNOWN TOC CLASS COUNTS"])
    for object_class in UNRESOLVED_CLASS_COUNT_KEYS:
        lines.append(f"{object_class}: 0")

    lines.extend(
        [
            "",
            "KNOWN TOC ENTRIES WITHOUT NORMALIZED OBJECT REFERENCES",
            "These entries remain counted and flagged; required object-bearing "
            "classes fail inspection instead.",
        ]
    )
    if not not_object_normalized:
        lines.append("none")
    else:
        for object_class in sorted(not_object_normalized):
            lines.append(f"{object_class}: {not_object_normalized[object_class]}")

    lines.extend(
        [
            "",
            "REVIEW FLAGS",
            flag_line("owner_metadata", owners),
            flag_line("acl_metadata", acl),
            flag_line("role_references", role_references),
            flag_line("extensions", extensions),
            flag_line("subscriptions", subscriptions),
            flag_line("event_triggers", event_triggers),
            flag_line("publications", publications),
            flag_line("managed_schema_objects", managed),
            flag_line("auth_schema_objects", auth),
            flag_line("storage_schema_objects", storage),
            flag_line("supabase_prefixed_objects", supabase_prefixed),
            flag_line("possible_repo_migration_duplicates", len(duplicates)),
            "",
            "POSSIBLE REPO MIGRATION DUPLICATES",
        ]
    )

    if not duplicates:
        lines.append("none")
    else:
        for ref, filename in duplicates[:100]:
            qualified = ref.name if ref.schema == "-" else f"{ref.schema}.{ref.name}"
            lines.append(f"{ref.object_class} {qualified} -> {filename}")
        if len(duplicates) > 100:
            lines.append(f"... {len(duplicates) - 100} additional matches omitted")

    lines.extend(
        [
            "",
            "BOUNDARY",
            "This report is an inventory aid, not a restore plan or completeness proof.",
            "Migration-duplicate analysis is conservative: possible name matches may be flagged, but absence is not proof across aliases, modifiers, or dynamic SQL.",
            "Review flagged ownership, grants, managed schemas, and duplicate definitions before any rehearsal.",
        ]
    )
    return "\n".join(lines) + "\n"


def failure_diagnostic(reason: str) -> bytes:
    """Return the exact public helper-failure record."""

    if reason not in ALLOWED_FAILURE_REASONS:
        reason = REASON_OTHER_NONZERO
    return f'{{"diagnostic_version":1,"reason":"{reason}"}}\n'.encode("ascii")


def emit_failure_diagnostic(reason: str) -> None:
    try:
        sys.stderr.buffer.write(failure_diagnostic(reason))
        sys.stderr.buffer.flush()
    except Exception:
        # Never replace the fixed diagnostic with a traceback or free-form text.
        pass


def main() -> int:
    try:
        args = parse_args()
        if not args.migrations_dir.is_dir():
            raise InspectionError(REASON_MIGRATION_METADATA_UNREADABLE)
        report = build_report(args)
        sys.stdout.write(report)
        sys.stdout.flush()
    except InspectionError as exc:
        emit_failure_diagnostic(exc.reason)
        return 4
    except Exception:
        emit_failure_diagnostic(REASON_OTHER_NONZERO)
        return 4
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
