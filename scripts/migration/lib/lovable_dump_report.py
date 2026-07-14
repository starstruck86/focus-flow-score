#!/usr/bin/env python3
"""Render a sanitized, metadata-only report from a pg_restore TOC list.

The archive itself is opened only to compute its byte length, SHA-256 digest,
and PGDMP header version. Row payload bytes are never decoded or emitted.
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
TOC_LINE_RE = re.compile(r"^\s*(\d+);\s+(\d+)\s+(\d+)\s+(.+?)\s*$")


class InspectionError(RuntimeError):
    """An unsafe or unrecognized metadata condition."""


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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--dump", required=True, type=Path)
    parser.add_argument("--toc", required=True, type=Path)
    parser.add_argument("--pg-restore-version", required=True)
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
        raise InspectionError("archive no longer has the required PGDMP header")
    if len(header) < 8:
        raise InspectionError("archive has a truncated PGDMP header")

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
    raise InspectionError(f"unknown TOC class at line {line_number}")


def parse_toc(path: Path) -> list[TocEntry]:
    entries: list[TocEntry] = []
    text = path.read_text(encoding="utf-8", errors="strict")

    for line_number, line in enumerate(text.splitlines(), start=1):
        stripped = line.strip()
        if not stripped or stripped.startswith(";"):
            continue
        match = TOC_LINE_RE.match(line)
        if not match:
            raise InspectionError(f"malformed TOC metadata at line {line_number}")
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
        raise InspectionError("archive TOC contains no object entries")
    if len({entry.toc_id for entry in entries}) != len(entries):
        raise InspectionError("archive TOC contains duplicate entry identifiers")
    return entries


def clean_identifier(value: str) -> Optional[str]:
    value = value.strip('"')
    value = value.split("(", 1)[0]
    return value if IDENTIFIER_RE.fullmatch(value) else None


def object_ref(entry: TocEntry) -> Optional[ObjectRef]:
    if entry.object_class in DATA_TOC_CLASSES or entry.object_class in {
        "ACL",
        "BLOB METADATA",
        "COMMENT",
        "DEFAULT ACL",
        "SECURITY LABEL",
    }:
        return None

    tokens = entry.remainder.split()
    if len(tokens) < 2:
        return None

    if entry.object_class == "SCHEMA":
        schema = clean_identifier(tokens[1])
        return ObjectRef("SCHEMA", schema, schema) if schema else None

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
    "INDEX": r"(?:create|alter)(?:\s+unique)?\s+index",
    "MATERIALIZED VIEW": r"(?:create|alter)\s+materialized\s+view",
    "POLICY": r"(?:create|alter)\s+policy",
    "PROCEDURE": r"(?:create|alter)(?:\s+or\s+replace)?\s+procedure",
    "PUBLICATION": r"(?:create|alter)\s+publication",
    "SCHEMA": r"(?:create|alter)\s+schema",
    "SEQUENCE": r"(?:create|alter)\s+sequence",
    "STATISTICS": r"(?:create|alter)\s+statistics",
    "TABLE": r"(?:create|alter)\s+table",
    "TRIGGER": r"(?:create|alter)\s+trigger",
    "TYPE": r"(?:create|alter)\s+type",
    "VIEW": r"(?:create|alter)(?:\s+or\s+replace)?\s+view",
}


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


def find_migration_duplicates(
    entries: Iterable[TocEntry], migrations_dir: Path
) -> list[tuple[ObjectRef, str]]:
    migration_text: list[tuple[str, str]] = []
    for path in sorted(migrations_dir.rglob("*.sql")):
        if not path.is_file():
            continue
        try:
            content = path.read_text(encoding="utf-8", errors="strict")
        except (OSError, UnicodeError) as exc:
            raise InspectionError(
                f"could not safely read migration metadata file: {path.name}"
            ) from exc
        migration_text.append((path.name, content))

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
    entries = parse_toc(args.toc)
    class_counts = Counter(entry.object_class for entry in entries)
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
    data_entries = sum(class_counts[name] for name in DATA_TOC_CLASSES)

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

    duplicates = find_migration_duplicates(entries, args.migrations_dir)
    role_references = owners + acl

    lines = [
        "LOVABLE CLOUD DUMP — METADATA-ONLY INSPECTION",
        "inspection_status: REVIEW_REQUIRED",
        "scope: archive header, SHA-256, pg_restore TOC metadata, migration-name comparison",
        "restore_attempted: no",
        "database_connection_attempted: no",
        "row_payload_inspected: no",
        f"input_file: {args.dump.name}",
        f"size_bytes: {size}",
        f"sha256: {sha256}",
        "archive_format: PostgreSQL custom archive (PGDMP)",
        f"archive_header_version: {archive_version}",
        f"pg_restore_version: {args.pg_restore_version}",
        "pg_restore_list_compatibility: PASS",
        f"toc_entries: {len(entries)}",
        f"toc_metadata_entries: {len(entries) - data_entries}",
        f"toc_data_references_not_extracted: {data_entries}",
        "unknown_toc_classes: none (inspection fails closed if encountered)",
        "",
        "TOC CLASS COUNTS",
    ]
    for object_class in sorted(class_counts):
        lines.append(f"{object_class}: {class_counts[object_class]}")

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
            "Review flagged ownership, grants, managed schemas, and duplicate definitions before any rehearsal.",
        ]
    )
    return "\n".join(lines) + "\n"


def main() -> int:
    try:
        args = parse_args()
        if not args.migrations_dir.is_dir():
            raise InspectionError("migrations directory is unavailable")
        report = build_report(args)
    except (InspectionError, OSError, UnicodeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 4

    sys.stdout.write(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
