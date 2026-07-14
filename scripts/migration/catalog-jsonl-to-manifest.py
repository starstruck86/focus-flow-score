#!/usr/bin/env python3
"""Convert one captured catalog JSONL artifact into a strict manifest v2.

The input bytes are read once, hashed, and parsed from that same in-memory
snapshot. Component fingerprints use an explicit type-tagged, uint64-length-
delimited binary encoding; they never concatenate SQL text with separators.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import struct
import sys
import tempfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any


COLLECTOR_NAME = "postgresql-jsonl-to-manifest"
COLLECTOR_VERSION = "3.0.0"
RECORD_VERSION = 1
FINGERPRINT_DOMAIN = b"focus-flow-score/postgresql-component-evidence/v2\x00"
SHA256_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
PLACEHOLDER_DIGESTS = {
    character * 64 for character in "0123456789abcdef"
} | {
    "deadbeef" * 8,
    "0123456789abcdef" * 4,
    hashlib.sha256(b"").hexdigest(),
}
RFC3339_UTC_RE = re.compile(
    r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z$"
)
ALLOWED_RECORD_KEYS = {
    "record_version",
    "record_kind",
    "component_kind",
    "key",
    "parent",
    "count",
    "attributes",
}
COLLECTION_COMPONENT_KIND = "collection"
COLLECTION_KEY = "database-catalog-snapshot"
COLLECTION_ATTRIBUTE_KEYS = {
    "boundary_kind",
    "boundary_value",
    "collected_at",
    "isolation_level",
    "read_only",
}
DATABASE_CATALOG_COMPONENT_KINDS = {
    "column",
    "constraint",
    "database",
    "default_privilege",
    "domain",
    "enum",
    "extension",
    "foreign_table",
    "function",
    "index",
    "materialized_view",
    "policy",
    "publication",
    "publication_table",
    "schema",
    "sequence",
    "table",
    "trigger",
    "view",
}
RELATION_COMPONENT_KINDS = {
    "foreign_table",
    "materialized_view",
    "sequence",
    "table",
    "view",
}
SERVICE_INVENTORY_COMPONENT_KINDS = {"auth", "job", "storage"}
ALLOWED_COMPONENT_KINDS = (
    DATABASE_CATALOG_COMPONENT_KINDS | SERVICE_INVENTORY_COMPONENT_KINDS
)

# Each collector record is versioned and kind-complete. Nullable fields must be
# present with JSON null; omission is never interpreted as an unknown/default.
RELATION_ATTRIBUTE_SCHEMA = {
    "relation_kind": "string",
    "owner": "string",
    "acl": "nullable_string_list",
    "persistence": "string",
    "row_security": "bool",
    "force_row_security": "bool",
    "replica_identity": "string",
    "replica_identity_index": "nullable_string",
    "is_partition": "bool",
    "partition_bound_fingerprint": "nullable_fingerprint",
    "partition_key_fingerprint": "nullable_fingerprint",
    "access_method": "nullable_string",
    "options_fingerprints": "nullable_fingerprint_list",
    "view_definition_fingerprint": "nullable_fingerprint",
    "sequence_start": "nullable_int",
    "sequence_increment": "nullable_int",
    "sequence_min": "nullable_int",
    "sequence_max": "nullable_int",
    "sequence_cache": "nullable_int",
    "sequence_cycle": "nullable_bool",
    "sequence_last_value": "nullable_int",
    "sequence_owned_by": "nullable_string",
    "foreign_server": "nullable_string",
    "foreign_options_fingerprints": "nullable_fingerprint_list",
}
ATTRIBUTE_SCHEMAS: dict[str, dict[str, str]] = {
    "database": {
        "server_version": "string",
        "server_version_num": "int",
        "owner": "string",
        "acl": "nullable_string_list",
        "encoding": "string",
        "collation": "string",
        "character_type": "string",
        "locale_provider": "string",
        "locale": "nullable_string",
        "icu_rules": "nullable_string",
        "collation_version": "nullable_string",
        "connection_limit": "int",
        "is_template": "bool",
        "allow_connections": "bool",
        "has_login_event_triggers": "bool",
    },
    "schema": {"owner": "string", "acl": "nullable_string_list"},
    "table": RELATION_ATTRIBUTE_SCHEMA,
    "view": RELATION_ATTRIBUTE_SCHEMA,
    "materialized_view": RELATION_ATTRIBUTE_SCHEMA,
    "sequence": RELATION_ATTRIBUTE_SCHEMA,
    "foreign_table": RELATION_ATTRIBUTE_SCHEMA,
    "column": {
        "ordinal": "int",
        "type": "string",
        "type_schema": "string",
        "type_name": "string",
        "nullable": "bool",
        "default_fingerprint": "nullable_fingerprint",
        "generated": "string",
        "identity": "string",
        "collation": "nullable_string",
        "acl": "nullable_string_list",
    },
    "index": {
        "definition_fingerprint": "fingerprint",
        "owner": "string",
        "acl": "nullable_string_list",
        "valid": "bool",
        "ready": "bool",
        "unique": "bool",
        "primary": "bool",
        "exclusion": "bool",
        "replica_identity": "bool",
    },
    "constraint": {
        "constraint_type": "string",
        "definition_fingerprint": "fingerprint",
        "validated": "bool",
        "deferrable": "bool",
        "initially_deferred": "bool",
        "no_inherit": "bool",
    },
    "enum": {
        "owner": "string",
        "acl": "nullable_string_list",
        "enum_labels": "nullable_string_list",
        "base_type": "nullable_string",
        "not_null": "nullable_bool",
        "default_fingerprint": "nullable_fingerprint",
        "collation": "nullable_string",
    },
    "domain": {
        "owner": "string",
        "acl": "nullable_string_list",
        "enum_labels": "nullable_string_list",
        "base_type": "nullable_string",
        "not_null": "nullable_bool",
        "default_fingerprint": "nullable_fingerprint",
        "collation": "nullable_string",
    },
    "function": {
        "definition_fingerprint": "fingerprint",
        "owner": "string",
        "acl": "nullable_string_list",
        "object_type": "string",
        "language": "string",
        "security_definer": "bool",
        "leakproof": "bool",
        "volatility": "string",
        "parallel": "string",
        "configuration_fingerprints": "nullable_fingerprint_list",
    },
    "trigger": {"definition_fingerprint": "fingerprint", "enabled": "string"},
    "policy": {
        "permissive": "string",
        "roles": "string_list",
        "command": "string",
        "using_fingerprint": "nullable_fingerprint",
        "with_check_fingerprint": "nullable_fingerprint",
    },
    "extension": {
        "version": "string",
        "schema": "string",
        "owner": "string",
        "relocatable": "bool",
    },
    "publication": {
        "owner": "string",
        "all_tables": "bool",
        "insert": "bool",
        "update": "bool",
        "delete": "bool",
        "truncate": "bool",
        "via_partition_root": "bool",
    },
    "publication_table": {
        "table": "string",
        "columns": "nullable_string_list",
        "row_filter_fingerprint": "nullable_fingerprint",
    },
    "default_privilege": {
        "owner": "string",
        "schema": "nullable_string",
        "object_type": "string",
        "acl": "nullable_string_list",
    },
    "auth": {"entity": "string"},
    "storage": {
        "bucket_id": "string",
        "public": "bool",
        "file_size_limit": "nullable_int",
        "allowed_mime_types": "nullable_string_list",
    },
    "job": {
        "job_name": "nullable_string",
        "schedule": "string",
        "active": "bool",
        "database": "string",
        "username": "string",
        "node_name": "string",
        "node_port": "int",
        "command_fingerprint": "fingerprint",
    },
}


class CatalogConversionError(ValueError):
    """Raised when captured SQL output is incomplete or ambiguous."""


def _json_object_no_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise CatalogConversionError(f"duplicate JSON object key {key!r}")
        result[key] = value
    return result


@dataclass(frozen=True)
class CatalogRecord:
    record_kind: str
    component_kind: str
    key: str
    parent: str | None
    count: int | None
    attributes: dict[str, Any]

    @property
    def identity(self) -> str:
        return f"{self.component_kind}:{self.key}"


@dataclass(frozen=True)
class CollectionRecord:
    boundary_kind: str
    boundary_value: str
    collected_at: str


def _u64(value: int) -> bytes:
    if value < 0 or value > 0xFFFFFFFFFFFFFFFF:
        raise CatalogConversionError(f"value outside uint64 range: {value}")
    return struct.pack(">Q", value)


def typed_frame(value: Any) -> bytes:
    """Encode JSON-compatible values with type tags and explicit lengths."""

    if value is None:
        return b"N"
    if isinstance(value, bool):
        return b"B" + (b"\x01" if value else b"\x00")
    if isinstance(value, int):
        encoded = str(value).encode("ascii")
        return b"I" + _u64(len(encoded)) + encoded
    if isinstance(value, float):
        raise CatalogConversionError("floating-point values are not allowed in catalog evidence")
    if isinstance(value, str):
        encoded = value.encode("utf-8")
        return b"S" + _u64(len(encoded)) + encoded
    if isinstance(value, list):
        return b"L" + _u64(len(value)) + b"".join(typed_frame(item) for item in value)
    if isinstance(value, dict):
        if not all(isinstance(key, str) for key in value):
            raise CatalogConversionError("object keys must be strings")
        items = sorted(value.items())
        return b"D" + _u64(len(items)) + b"".join(
            typed_frame(key) + typed_frame(item) for key, item in items
        )
    raise CatalogConversionError(f"unsupported catalog value type: {type(value).__name__}")


def component_fingerprint(record: CatalogRecord, evidence_kind: str) -> str:
    evidence = {
        "attributes": record.attributes,
        "component_kind": record.component_kind,
        "key": record.key,
        "parent": record.parent,
    }
    digest = hashlib.sha256(
        FINGERPRINT_DOMAIN + typed_frame(evidence_kind) + typed_frame(evidence)
    ).hexdigest()
    return f"sha256:{digest}"


def _require_trimmed(value: Any, context: str) -> str:
    if not isinstance(value, str) or not value or value.strip() != value:
        raise CatalogConversionError(f"{context}: expected non-empty trimmed string")
    return value


def _validate_fingerprint(value: Any, context: str) -> None:
    if not isinstance(value, str) or not SHA256_RE.fullmatch(value):
        raise CatalogConversionError(f"{context}: expected sha256:<64 lowercase hex>")
    digest = value.removeprefix("sha256:")
    if digest in PLACEHOLDER_DIGESTS or len(set(digest)) < 8:
        raise CatalogConversionError(
            f"{context}: placeholder or low-entropy fingerprint is not evidence"
        )


def _validate_attribute_value(value: Any, expected: str, context: str) -> None:
    nullable = expected.startswith("nullable_")
    base_type = expected.removeprefix("nullable_") if nullable else expected
    if value is None:
        if nullable:
            return
        raise CatalogConversionError(f"{context}: null is not allowed")

    if base_type == "string":
        if not isinstance(value, str):
            raise CatalogConversionError(f"{context}: expected string")
        return
    if base_type == "int":
        # Catalog integers are signed. In particular, sequence bounds and the
        # last persisted sequence value may legitimately be negative.
        if type(value) is not int:
            raise CatalogConversionError(f"{context}: expected signed integer")
        return
    if base_type == "bool":
        if type(value) is not bool:
            raise CatalogConversionError(f"{context}: expected boolean")
        return
    if base_type == "fingerprint":
        _validate_fingerprint(value, context)
        return
    if base_type in {"string_list", "fingerprint_list"}:
        if not isinstance(value, list):
            raise CatalogConversionError(f"{context}: expected array")
        for index, item in enumerate(value):
            item_context = f"{context}[{index}]"
            if base_type == "string_list":
                if not isinstance(item, str):
                    raise CatalogConversionError(f"{item_context}: expected string")
            else:
                _validate_fingerprint(item, item_context)
        return
    raise CatalogConversionError(
        f"{context}: internal unsupported attribute schema type {expected!r}"
    )


def _validate_component_attributes(
    component_kind: str, attributes: dict[str, Any], context: str
) -> None:
    schema = ATTRIBUTE_SCHEMAS[component_kind]
    unknown = set(attributes) - set(schema)
    missing = set(schema) - set(attributes)
    if unknown:
        raise CatalogConversionError(
            f"{context}: unknown field(s) for {component_kind}: "
            + ", ".join(sorted(unknown))
        )
    if missing:
        raise CatalogConversionError(
            f"{context}: missing field(s) for {component_kind}: "
            + ", ".join(sorted(missing))
        )
    for name, expected in schema.items():
        _validate_attribute_value(attributes[name], expected, f"{context}.{name}")

    if component_kind in RELATION_COMPONENT_KINDS:
        expected_relation_kinds = {
            "table": {"ordinary_table", "partitioned_table"},
            "view": {"view"},
            "materialized_view": {"materialized_view"},
            "sequence": {"sequence"},
            "foreign_table": {"foreign_table"},
        }[component_kind]
        if attributes["relation_kind"] not in expected_relation_kinds:
            raise CatalogConversionError(
                f"{context}.relation_kind: incompatible with {component_kind}"
            )

    if component_kind == "enum":
        if attributes["enum_labels"] is None:
            raise CatalogConversionError(f"{context}.enum_labels: enum requires labels")
        for name in ("base_type", "not_null", "default_fingerprint", "collation"):
            if attributes[name] is not None:
                raise CatalogConversionError(
                    f"{context}.{name}: enum requires null"
                )
    elif component_kind == "domain":
        if attributes["enum_labels"] is not None:
            raise CatalogConversionError(f"{context}.enum_labels: domain requires null")
        if attributes["base_type"] is None or attributes["not_null"] is None:
            raise CatalogConversionError(
                f"{context}: domain requires base_type and not_null"
            )


def _validate_collection_record(
    value: dict[str, Any], context: str, attributes: dict[str, Any]
) -> CatalogRecord:
    if value["component_kind"] != COLLECTION_COMPONENT_KIND:
        raise CatalogConversionError(
            f"{context}.component_kind: collection record must be "
            f"{COLLECTION_COMPONENT_KIND!r}"
        )
    if value["key"] != COLLECTION_KEY:
        raise CatalogConversionError(
            f"{context}.key: collection record must be {COLLECTION_KEY!r}"
        )
    if value["parent"] is not None:
        raise CatalogConversionError(f"{context}.parent: collection record requires null")
    if value["count"] is not None:
        raise CatalogConversionError(f"{context}.count: collection record requires null")
    unknown = set(attributes) - COLLECTION_ATTRIBUTE_KEYS
    missing = COLLECTION_ATTRIBUTE_KEYS - set(attributes)
    if unknown:
        raise CatalogConversionError(
            f"{context}.attributes: unknown field(s): {', '.join(sorted(unknown))}"
        )
    if missing:
        raise CatalogConversionError(
            f"{context}.attributes: missing field(s): {', '.join(sorted(missing))}"
        )
    if attributes["boundary_kind"] != "database_read_only_transaction":
        raise CatalogConversionError(
            f"{context}.attributes.boundary_kind: expected "
            "'database_read_only_transaction'"
        )
    _require_trimmed(
        attributes["boundary_value"], f"{context}.attributes.boundary_value"
    )
    _validate_collected_at(attributes["collected_at"])
    if attributes["isolation_level"] != "repeatable read":
        raise CatalogConversionError(
            f"{context}.attributes.isolation_level: expected 'repeatable read'"
        )
    if attributes["read_only"] is not True:
        raise CatalogConversionError(f"{context}.attributes.read_only: expected true")
    return CatalogRecord(
        "collection",
        COLLECTION_COMPONENT_KIND,
        COLLECTION_KEY,
        None,
        None,
        attributes,
    )


def _parse_record(value: Any, line_number: int) -> CatalogRecord:
    context = f"line {line_number}"
    if not isinstance(value, dict):
        raise CatalogConversionError(f"{context}: expected JSON object")
    unknown = set(value) - ALLOWED_RECORD_KEYS
    missing = ALLOWED_RECORD_KEYS - set(value)
    if unknown:
        raise CatalogConversionError(
            f"{context}: unknown field(s): {', '.join(sorted(unknown))}"
        )
    if missing:
        raise CatalogConversionError(
            f"{context}: missing field(s): {', '.join(sorted(missing))}"
        )
    if type(value["record_version"]) is not int or value["record_version"] != RECORD_VERSION:
        raise CatalogConversionError(
            f"{context}.record_version: expected {RECORD_VERSION}"
        )

    record_kind = value["record_kind"]
    if record_kind not in {"collection", "component", "count"}:
        raise CatalogConversionError(f"{context}.record_kind: unsupported {record_kind!r}")
    if record_kind == "collection":
        attributes = value["attributes"]
        if not isinstance(attributes, dict):
            raise CatalogConversionError(f"{context}.attributes: expected object")
        typed_frame(attributes)
        return _validate_collection_record(value, context, attributes)

    component_kind = _require_trimmed(value["component_kind"], f"{context}.component_kind")
    if component_kind not in ALLOWED_COMPONENT_KINDS:
        raise CatalogConversionError(
            f"{context}.component_kind: unsupported {component_kind!r}"
        )
    key = _require_trimmed(value["key"], f"{context}.key")
    parent = value["parent"]
    if parent is not None:
        parent = _require_trimmed(parent, f"{context}.parent")
    count = value["count"]
    if count is not None and (
        not isinstance(count, int) or isinstance(count, bool) or count < 0
    ):
        raise CatalogConversionError(
            f"{context}.count: expected non-negative integer or null"
        )
    attributes = value["attributes"]
    if not isinstance(attributes, dict):
        raise CatalogConversionError(f"{context}.attributes: expected object")
    typed_frame(attributes)  # reject floats or non-JSON types before hashing

    if record_kind == "count":
        if component_kind != "table":
            raise CatalogConversionError(f"{context}: count overlays are table-only")
        if count is None:
            raise CatalogConversionError(f"{context}: count overlay requires a count")
        if attributes:
            raise CatalogConversionError(f"{context}: count overlay attributes must be empty")
    else:
        _validate_component_attributes(
            component_kind, attributes, f"{context}.attributes"
        )
    return CatalogRecord(record_kind, component_kind, key, parent, count, attributes)


def parse_catalog_snapshot(raw: bytes, path: Path) -> list[CatalogRecord]:
    if not raw:
        raise CatalogConversionError(f"{path}: empty catalog artifact")
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise CatalogConversionError(f"{path}: catalog artifact is not UTF-8: {exc}") from exc

    lines = text.splitlines()
    if not lines:
        raise CatalogConversionError(f"{path}: empty catalog artifact")
    records: list[CatalogRecord] = []
    for line_number, line in enumerate(lines, start=1):
        if not line:
            raise CatalogConversionError(f"{path}: blank line at {line_number}")
        try:
            value = json.loads(line, object_pairs_hook=_json_object_no_duplicates)
        except CatalogConversionError as exc:
            raise CatalogConversionError(
                f"{path}: line {line_number}: {exc}"
            ) from exc
        except json.JSONDecodeError as exc:
            raise CatalogConversionError(
                f"{path}: line {line_number} is not JSON: {exc.msg}"
            ) from exc
        records.append(_parse_record(value, line_number))
    return records


def extract_collection(records: list[CatalogRecord]) -> CollectionRecord:
    collection_records = [
        record for record in records if record.record_kind == "collection"
    ]
    if len(collection_records) != 1:
        raise CatalogConversionError(
            "catalog artifact requires exactly one collection record; "
            f"found {len(collection_records)}"
        )
    record = collection_records[0]
    return CollectionRecord(
        boundary_kind=record.attributes["boundary_kind"],
        boundary_value=record.attributes["boundary_value"],
        collected_at=record.attributes["collected_at"],
    )


def build_components(
    records: list[CatalogRecord],
    independently_verifiable: bool,
    evidence_kind: str,
) -> list[dict[str, Any]]:
    allowed_for_evidence = (
        DATABASE_CATALOG_COMPONENT_KINDS
        if evidence_kind == "database_catalog"
        else SERVICE_INVENTORY_COMPONENT_KINDS
    )
    components: dict[str, CatalogRecord] = {}
    count_overlays: dict[str, CatalogRecord] = {}

    for record in records:
        if record.record_kind == "collection":
            continue
        destination = components if record.record_kind == "component" else count_overlays
        if record.identity in destination:
            raise CatalogConversionError(f"duplicate {record.record_kind} identity {record.identity}")
        destination[record.identity] = record

    if not components:
        raise CatalogConversionError("catalog artifact contains no component records")
    insufficient = sorted(
        record.identity
        for record in components.values()
        if record.component_kind not in allowed_for_evidence
    )
    if insufficient:
        raise CatalogConversionError(
            f"{evidence_kind} is insufficient for component(s): " + ", ".join(insufficient)
        )
    for identity, overlay in count_overlays.items():
        base = components.get(identity)
        if base is None:
            raise CatalogConversionError(f"orphan count overlay {identity}")
        if base.parent != overlay.parent:
            raise CatalogConversionError(f"count overlay parent mismatch for {identity}")
        if base.count is not None:
            raise CatalogConversionError(f"component already contains a count for {identity}")

    missing_counts = sorted(
        identity
        for identity, record in components.items()
        if (
            (record.component_kind == "table" and identity not in count_overlays)
            or (record.component_kind in {"auth", "storage"} and record.count is None)
        )
    )
    if missing_counts:
        raise CatalogConversionError(
            "component(s) missing required exact count: " + ", ".join(missing_counts)
        )

    result: list[dict[str, Any]] = []
    for identity in sorted(components):
        record = components[identity]
        overlay = count_overlays.get(identity)
        count = overlay.count if overlay is not None else record.count
        result.append(
            {
                "key": record.key,
                "kind": record.component_kind,
                "count": count,
                "evidence": {
                    "kind": evidence_kind,
                    "fingerprint": component_fingerprint(record, evidence_kind),
                    "closure": None,
                },
                "configuration": {},
                "configuration_known": True,
                "independently_verifiable": independently_verifiable,
            }
        )
    return result


def _validate_collected_at(value: Any) -> str:
    if not isinstance(value, str):
        raise CatalogConversionError("collected_at must be RFC3339 UTC ending in Z")
    if not RFC3339_UTC_RE.fullmatch(value):
        raise CatalogConversionError("collected_at must be RFC3339 UTC ending in Z")
    try:
        datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError as exc:
        raise CatalogConversionError(f"collected_at is invalid: {exc}") from exc
    return value


def _load_strict_manifest_module() -> Any:
    path = Path(__file__).with_name("compare-manifests.py")
    spec = importlib.util.spec_from_file_location("migration_strict_manifest", path)
    if spec is None or spec.loader is None:
        raise CatalogConversionError(f"cannot load strict manifest validator: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _write_validated_manifest(output: Path, encoded: str) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=output.parent,
            prefix=f".{output.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
            temporary_path = Path(handle.name)
        validator = _load_strict_manifest_module()
        try:
            validator.load_manifest(temporary_path)
        except validator.ManifestError as exc:
            raise CatalogConversionError(
                f"generated manifest failed strict validation: {exc}"
            ) from exc
        try:
            # Hard-link publication is atomic and fails if a concurrent process
            # created the destination after the caller's preliminary check.
            # os.replace() would silently clobber that independently created
            # evidence artifact.
            os.link(temporary_path, output)
        except FileExistsError as exc:
            raise CatalogConversionError(f"refusing to overwrite output: {output}") from exc
        temporary_path.unlink()
        temporary_path = None
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def _read_snapshot(path: Path) -> bytes:
    if not path.exists():
        raise CatalogConversionError(f"catalog artifact not found: {path}")
    if not path.is_file():
        raise CatalogConversionError(f"catalog artifact is not a regular file: {path}")
    try:
        return path.read_bytes()
    except OSError as exc:
        raise CatalogConversionError(f"cannot read catalog artifact {path}: {exc}") from exc


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Convert captured catalog JSONL into a strict local manifest."
    )
    parser.add_argument("input", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--label", required=True)
    parser.add_argument("--role", required=True, choices=("source", "target"))
    parser.add_argument("--project-ref", required=True)
    parser.add_argument("--artifact-source", required=True)
    parser.add_argument(
        "--evidence-kind",
        choices=("database_catalog", "service_inventory"),
        default="database_catalog",
    )
    args = parser.parse_args()

    try:
        if args.output.resolve() == args.input.resolve():
            raise CatalogConversionError("output must differ from input")
        if args.output.exists():
            raise CatalogConversionError(f"refusing to overwrite output: {args.output}")
        label = _require_trimmed(args.label, "--label")
        project_ref = _require_trimmed(args.project_ref, "--project-ref")
        artifact_source = _require_trimmed(args.artifact_source, "--artifact-source")

        raw = _read_snapshot(args.input)
        records = parse_catalog_snapshot(raw, args.input)
        collection = extract_collection(records)
        independently_verifiable = args.role == "target" or (
            args.role == "source" and project_ref.startswith("synthetic-")
        )
        components = build_components(
            records,
            independently_verifiable=independently_verifiable,
            evidence_kind=args.evidence_kind,
        )
        artifact_sha256 = f"sha256:{hashlib.sha256(raw).hexdigest()}"
        if not SHA256_RE.fullmatch(artifact_sha256):  # defensive invariant
            raise CatalogConversionError("internal artifact SHA-256 formatting error")

        manifest = {
            "format_version": 2,
            "label": label,
            "role": args.role,
            "project_ref": project_ref,
            "collection": {
                "boundary": {
                    "kind": collection.boundary_kind,
                    "value": collection.boundary_value,
                },
                "collected_at": collection.collected_at,
                "collector": {"name": COLLECTOR_NAME, "version": COLLECTOR_VERSION},
                "artifact": {
                    "kind": (
                        "postgresql_catalog_jsonl"
                        if args.evidence_kind == "database_catalog"
                        else "service_inventory_output"
                    ),
                    "source": artifact_source,
                    "sha256": artifact_sha256,
                },
            },
            "components": components,
        }
        encoded = json.dumps(manifest, indent=2, sort_keys=True) + "\n"
        _write_validated_manifest(args.output, encoded)
    except (CatalogConversionError, OSError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
