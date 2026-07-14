#!/usr/bin/env python3
"""Compare two provenance-bound migration manifests without database access."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any


FORMAT_VERSION = 2
ALLOWED_TOP_LEVEL = {
    "format_version",
    "label",
    "role",
    "project_ref",
    "collection",
    "components",
}
ALLOWED_COLLECTION_FIELDS = {"boundary", "collected_at", "collector", "artifact"}
ALLOWED_BOUNDARY_FIELDS = {"kind", "value"}
ALLOWED_COLLECTOR_FIELDS = {"name", "version"}
ALLOWED_ARTIFACT_FIELDS = {"kind", "source", "sha256"}
ALLOWED_COMPONENT_FIELDS = {
    "key",
    "kind",
    "count",
    "evidence",
    "configuration",
    "configuration_known",
    "independently_verifiable",
    "note",
}
ALLOWED_EVIDENCE_FIELDS = {"kind", "fingerprint", "closure"}
ALLOWED_SETTING_FIELDS = {"value", "source"}
EDGE_CONFIGURATION_FIELDS = {"verify_jwt", "entrypoint", "import_map"}

ALLOWED_KINDS = {
    "auth",
    "column",
    "constraint",
    "database",
    "default_privilege",
    "domain",
    "edge_function",
    "enum",
    "extension",
    "foreign_table",
    "function",
    "index",
    "job",
    "materialized_view",
    "policy",
    "publication",
    "publication_table",
    "schema",
    "sequence",
    "storage",
    "table",
    "trigger",
    "view",
}
CATALOG_KINDS = {
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
    "job",
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
EVIDENCE_KINDS_BY_COMPONENT = {
    **{kind: {"database_catalog", "synthetic_fixture", "unavailable"} for kind in CATALOG_KINDS},
    "auth": {"service_inventory", "synthetic_fixture", "unavailable"},
    "job": {
        "database_catalog",
        "service_inventory",
        "synthetic_fixture",
        "unavailable",
    },
    "storage": {"service_inventory", "synthetic_fixture", "unavailable"},
    "edge_function": {
        "edge_function_deployment_closure",
        "synthetic_fixture",
        "unavailable",
    },
}
BOUNDARY_KINDS = {
    "archive_file",
    "database_read_only_transaction",
    "repository_content_sha256",
    "service_snapshot",
    "synthetic_fixture",
    "transaction_snapshot",
}
ARTIFACT_KINDS = {
    "database_catalog_output",
    "repository_deployment_inventory",
    "postgresql_catalog_jsonl",
    "service_inventory_output",
    "synthetic_fixture",
}
SETTING_SOURCES = {
    "documented_default",
    "explicit_config",
    "runtime_observation",
    "synthetic_fixture",
    "unknown",
}
SHA256_RE = re.compile(r"^sha256:([0-9a-f]{64})$")
VERSION_RE = re.compile(r"^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$")
PROJECT_REF_RE = re.compile(r"^(?:[a-z0-9]{20}|synthetic-[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?)$")
PLACEHOLDER_WORDS = ("placeholder", "replace", "todo", "tbd", "example", "unknown")
PLACEHOLDER_DIGESTS = {
    character * 64 for character in "0123456789abcdef"
} | {
    "deadbeef" * 8,
    "0123456789abcdef" * 4,
    # SHA-256 of an empty byte string: a collection artifact may not be empty.
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
}


class ManifestError(ValueError):
    """Raised when a manifest fails the strict local schema."""


def _json_object_no_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ManifestError(f"duplicate JSON object key {key!r}")
        result[key] = value
    return result


@dataclass(frozen=True)
class Evidence:
    kind: str
    fingerprint: str | None
    closure: tuple[str, ...] | None


@dataclass(frozen=True)
class Component:
    key: str
    kind: str
    count: int | None
    evidence: Evidence
    configuration: dict[str, Any]
    configuration_known: bool
    independently_verifiable: bool
    note: str | None


@dataclass(frozen=True)
class Manifest:
    path: Path
    raw_sha256: str
    label: str
    role: str
    project_ref: str
    collection: dict[str, Any]
    components: dict[str, Component]


def _require_exact_keys(
    value: dict[str, Any], allowed: set[str], required: set[str], context: str
) -> None:
    unknown = set(value) - allowed
    if unknown:
        raise ManifestError(f"{context}: unknown field(s): {', '.join(sorted(unknown))}")
    missing = required - set(value)
    if missing:
        raise ManifestError(f"{context}: missing field(s): {', '.join(sorted(missing))}")


def _trimmed_string(value: Any, context: str) -> str:
    if not isinstance(value, str) or not value or value.strip() != value:
        raise ManifestError(f"{context}: expected non-empty trimmed string")
    return value


def _reject_placeholder_text(value: str, context: str) -> None:
    lowered = value.casefold()
    if any(word in lowered for word in PLACEHOLDER_WORDS):
        raise ManifestError(f"{context}: placeholder value is not evidence")


def _fingerprint(value: Any, context: str, *, nullable: bool) -> str | None:
    if value is None and nullable:
        return None
    if not isinstance(value, str):
        raise ManifestError(f"{context}: expected sha256:<64 lowercase hex characters>")
    match = SHA256_RE.fullmatch(value)
    if not match:
        raise ManifestError(f"{context}: expected sha256:<64 lowercase hex characters>")
    digest = match.group(1)
    if digest in PLACEHOLDER_DIGESTS or len(set(digest)) < 8:
        raise ManifestError(f"{context}: placeholder or low-entropy fingerprint is not evidence")
    return value


def _parse_rfc3339_utc(value: Any, context: str) -> str:
    text = _trimmed_string(value, context)
    if not text.endswith("Z"):
        raise ManifestError(f"{context}: expected an RFC3339 UTC timestamp ending in Z")
    try:
        parsed = datetime.fromisoformat(text[:-1] + "+00:00")
    except ValueError as exc:
        raise ManifestError(f"{context}: invalid RFC3339 timestamp") from exc
    if parsed.utcoffset() is None or parsed.utcoffset().total_seconds() != 0:
        raise ManifestError(f"{context}: timestamp must be UTC")
    return text


def _parse_collection(value: Any, context: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ManifestError(f"{context}: expected object")
    _require_exact_keys(
        value,
        ALLOWED_COLLECTION_FIELDS,
        ALLOWED_COLLECTION_FIELDS,
        context,
    )

    boundary = value["boundary"]
    if not isinstance(boundary, dict):
        raise ManifestError(f"{context}.boundary: expected object")
    _require_exact_keys(
        boundary, ALLOWED_BOUNDARY_FIELDS, ALLOWED_BOUNDARY_FIELDS, f"{context}.boundary"
    )
    boundary_kind = _trimmed_string(boundary["kind"], f"{context}.boundary.kind")
    if boundary_kind not in BOUNDARY_KINDS:
        raise ManifestError(f"{context}.boundary.kind: unsupported kind {boundary_kind!r}")
    boundary_value = _trimmed_string(boundary["value"], f"{context}.boundary.value")
    _reject_placeholder_text(boundary_value, f"{context}.boundary.value")
    if boundary_kind == "repository_content_sha256":
        boundary_value = _fingerprint(
            boundary_value, f"{context}.boundary.value", nullable=False
        )
        if boundary_value is None:
            raise ManifestError(f"{context}.boundary.value: missing fingerprint")

    collector = value["collector"]
    if not isinstance(collector, dict):
        raise ManifestError(f"{context}.collector: expected object")
    _require_exact_keys(
        collector, ALLOWED_COLLECTOR_FIELDS, ALLOWED_COLLECTOR_FIELDS, f"{context}.collector"
    )
    collector_name = _trimmed_string(collector["name"], f"{context}.collector.name")
    collector_version = _trimmed_string(
        collector["version"], f"{context}.collector.version"
    )
    _reject_placeholder_text(collector_name, f"{context}.collector.name")
    if not VERSION_RE.fullmatch(collector_version):
        raise ManifestError(f"{context}.collector.version: expected semantic version")

    artifact = value["artifact"]
    if not isinstance(artifact, dict):
        raise ManifestError(f"{context}.artifact: expected object")
    _require_exact_keys(
        artifact, ALLOWED_ARTIFACT_FIELDS, ALLOWED_ARTIFACT_FIELDS, f"{context}.artifact"
    )
    artifact_kind = _trimmed_string(artifact["kind"], f"{context}.artifact.kind")
    if artifact_kind not in ARTIFACT_KINDS:
        raise ManifestError(f"{context}.artifact.kind: unsupported kind {artifact_kind!r}")
    artifact_source = _trimmed_string(artifact["source"], f"{context}.artifact.source")
    _reject_placeholder_text(artifact_source, f"{context}.artifact.source")
    artifact_sha = _fingerprint(artifact["sha256"], f"{context}.artifact.sha256", nullable=False)
    if boundary_kind == "repository_content_sha256" and artifact_sha != boundary_value:
        raise ManifestError(
            f"{context}: repository content boundary must equal artifact SHA-256"
        )

    return {
        "boundary": {"kind": boundary_kind, "value": boundary_value},
        "collected_at": _parse_rfc3339_utc(value["collected_at"], f"{context}.collected_at"),
        "collector": {"name": collector_name, "version": collector_version},
        "artifact": {
            "kind": artifact_kind,
            "source": artifact_source,
            "sha256": artifact_sha,
        },
    }


def _parse_setting(
    value: Any, context: str, expected_type: type, *, nullable: bool = False
) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ManifestError(f"{context}: expected object")
    _require_exact_keys(value, ALLOWED_SETTING_FIELDS, ALLOWED_SETTING_FIELDS, context)
    source = _trimmed_string(value["source"], f"{context}.source")
    if source not in SETTING_SOURCES:
        raise ManifestError(f"{context}.source: unsupported source {source!r}")
    setting_value = value["value"]
    if source == "unknown":
        if setting_value is not None:
            raise ManifestError(f"{context}.value: unknown evidence requires null")
    elif expected_type is bool:
        if not isinstance(setting_value, bool):
            raise ManifestError(f"{context}.value: expected boolean")
    elif setting_value is None:
        if not nullable:
            raise ManifestError(f"{context}.value: null is not allowed")
    elif not isinstance(setting_value, str) or not setting_value or setting_value.strip() != setting_value:
        raise ManifestError(f"{context}.value: expected non-empty trimmed string or null")
    return {"value": setting_value, "source": source}


def _parse_configuration(
    value: Any, kind: str, configuration_known: bool, context: str
) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ManifestError(f"{context}: expected object")
    if kind != "edge_function":
        if value:
            raise ManifestError(f"{context}: only edge_function supports configuration fields")
        return {}

    _require_exact_keys(
        value, EDGE_CONFIGURATION_FIELDS, EDGE_CONFIGURATION_FIELDS, context
    )
    parsed = {
        "verify_jwt": _parse_setting(value["verify_jwt"], f"{context}.verify_jwt", bool),
        "entrypoint": _parse_setting(value["entrypoint"], f"{context}.entrypoint", str),
        "import_map": _parse_setting(
            value["import_map"], f"{context}.import_map", str, nullable=True
        ),
    }
    sources = {setting["source"] for setting in parsed.values()}
    if configuration_known and "unknown" in sources:
        raise ManifestError(f"{context}: configuration_known cannot contain unknown evidence")
    if not configuration_known and "unknown" not in sources:
        raise ManifestError(f"{context}: false configuration_known requires an unknown field")
    return parsed


def _parse_evidence(value: Any, component_kind: str, context: str) -> Evidence:
    if not isinstance(value, dict):
        raise ManifestError(f"{context}: expected object")
    _require_exact_keys(value, ALLOWED_EVIDENCE_FIELDS, ALLOWED_EVIDENCE_FIELDS, context)
    evidence_kind = _trimmed_string(value["kind"], f"{context}.kind")
    if evidence_kind not in EVIDENCE_KINDS_BY_COMPONENT[component_kind]:
        raise ManifestError(
            f"{context}.kind: {evidence_kind!r} is insufficient for component kind {component_kind!r}"
        )
    fingerprint = _fingerprint(
        value["fingerprint"], f"{context}.fingerprint", nullable=evidence_kind == "unavailable"
    )
    closure_value = value["closure"]
    closure: tuple[str, ...] | None
    if closure_value is None:
        closure = None
    elif isinstance(closure_value, list):
        paths = [_trimmed_string(item, f"{context}.closure[{index}]") for index, item in enumerate(closure_value)]
        if not paths or paths != sorted(paths) or len(paths) != len(set(paths)):
            raise ManifestError(f"{context}.closure: expected non-empty sorted unique paths")
        if any(path.startswith("/") or ".." in Path(path).parts for path in paths):
            raise ManifestError(f"{context}.closure: paths must stay repository-relative")
        closure = tuple(paths)
    else:
        raise ManifestError(f"{context}.closure: expected array or null")

    if evidence_kind == "edge_function_deployment_closure" and closure is None:
        raise ManifestError(f"{context}.closure: deployment closure evidence requires file paths")
    if evidence_kind != "edge_function_deployment_closure" and closure is not None:
        raise ManifestError(f"{context}.closure: only deployment closure evidence may list files")
    if evidence_kind == "unavailable" and fingerprint is not None:
        raise ManifestError(f"{context}.fingerprint: unavailable evidence requires null")
    return Evidence(evidence_kind, fingerprint, closure)


def _parse_component(value: Any, index: int) -> Component:
    context = f"components[{index}]"
    if not isinstance(value, dict):
        raise ManifestError(f"{context}: expected object")
    required = ALLOWED_COMPONENT_FIELDS - {"note"}
    _require_exact_keys(value, ALLOWED_COMPONENT_FIELDS, required, context)

    key = _trimmed_string(value["key"], f"{context}.key")
    kind = value["kind"]
    if not isinstance(kind, str) or kind not in ALLOWED_KINDS:
        raise ManifestError(f"{context}.kind: unsupported kind {kind!r}")
    count = value["count"]
    if count is not None and (not isinstance(count, int) or isinstance(count, bool) or count < 0):
        raise ManifestError(f"{context}.count: expected non-negative integer or null")
    configuration_known = value["configuration_known"]
    independently_verifiable = value["independently_verifiable"]
    if not isinstance(configuration_known, bool):
        raise ManifestError(f"{context}.configuration_known: expected boolean")
    if not isinstance(independently_verifiable, bool):
        raise ManifestError(f"{context}.independently_verifiable: expected boolean")
    note = value.get("note")
    if note is not None and not isinstance(note, str):
        raise ManifestError(f"{context}.note: expected string or null")

    evidence = _parse_evidence(value["evidence"], kind, f"{context}.evidence")
    configuration = _parse_configuration(
        value["configuration"], kind, configuration_known, f"{context}.configuration"
    )

    if evidence.kind == "unavailable":
        if count is not None or configuration_known or independently_verifiable:
            raise ManifestError(
                f"{context}: unavailable evidence requires null count and false known/verifiable flags"
            )
    else:
        if evidence.fingerprint is None:
            raise ManifestError(f"{context}: collected evidence requires a fingerprint")
        if kind in {"table", "auth", "storage"} and count is None:
            raise ManifestError(f"{context}.count: {kind} evidence requires an exact count")
        if kind == "edge_function" and count is not None:
            raise ManifestError(f"{context}.count: edge_function count must be null")
        if kind == "edge_function" and not configuration_known:
            raise ManifestError(f"{context}: deployment closure requires known effective configuration")

    return Component(
        key=key,
        kind=kind,
        count=count,
        evidence=evidence,
        configuration=configuration,
        configuration_known=configuration_known,
        independently_verifiable=independently_verifiable,
        note=note,
    )


def load_manifest(path: Path) -> Manifest:
    try:
        raw_bytes = path.read_bytes()
        raw = json.loads(
            raw_bytes.decode("utf-8"), object_pairs_hook=_json_object_no_duplicates
        )
    except FileNotFoundError as exc:
        raise ManifestError(f"manifest not found: {path}") from exc
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ManifestError(f"cannot read valid UTF-8 JSON manifest {path}: {exc}") from exc

    if not isinstance(raw, dict):
        raise ManifestError(f"{path}: expected top-level object")
    _require_exact_keys(raw, ALLOWED_TOP_LEVEL, ALLOWED_TOP_LEVEL, str(path))
    if raw["format_version"] != FORMAT_VERSION:
        raise ManifestError(f"{path}: format_version must be {FORMAT_VERSION}")
    label = _trimmed_string(raw["label"], f"{path}.label")
    role = raw["role"]
    if role not in {"source", "target"}:
        raise ManifestError(f"{path}.role: expected source or target")
    project_ref = _trimmed_string(raw["project_ref"], f"{path}.project_ref")
    if not PROJECT_REF_RE.fullmatch(project_ref):
        raise ManifestError(f"{path}.project_ref: expected a Supabase ref or synthetic-* fixture ref")
    collection = _parse_collection(raw["collection"], f"{path}.collection")

    components = raw["components"]
    if not isinstance(components, list) or not components:
        raise ManifestError(f"{path}: components must be a non-empty array")
    indexed: dict[str, Component] = {}
    for index, item in enumerate(components):
        component = _parse_component(item, index)
        identity = f"{component.kind}:{component.key}"
        if identity in indexed:
            raise ManifestError(f"{path}: duplicate component identity {identity}")
        indexed[identity] = component

    collector_name = collection["collector"]["name"]
    artifact_kind = collection["artifact"]["kind"]
    if (
        role == "target"
        and collector_name == "inventory-edge-functions"
        and artifact_kind == "repository_deployment_inventory"
        and any(component.independently_verifiable for component in indexed.values())
    ):
        raise ManifestError(
            f"{path}: local target repository inventory cannot be independently "
            "verifiable deployed-target evidence"
        )
    if (
        role == "source"
        and not project_ref.startswith("synthetic-")
        and collector_name == "postgresql-jsonl-to-manifest"
        and artifact_kind in {"postgresql_catalog_jsonl", "service_inventory_output"}
        and any(component.independently_verifiable for component in indexed.values())
    ):
        raise ManifestError(
            f"{path}: Lovable source catalog evidence cannot be marked independently "
            "verifiable"
        )

    return Manifest(
        path=path,
        raw_sha256=hashlib.sha256(raw_bytes).hexdigest(),
        label=label,
        role=role,
        project_ref=project_ref,
        collection=collection,
        components=indexed,
    )


def _effective_configuration(component: Component) -> dict[str, Any]:
    return {
        key: setting["value"]
        for key, setting in component.configuration.items()
    }


def compare(source: dict[str, Component], target: dict[str, Component]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for identity in sorted(set(source) | set(target)):
        source_item = source.get(identity)
        target_item = target.get(identity)

        if source_item is None:
            outcomes = ["Unexpected on target"]
            item = target_item
            configuration_differences: list[str] = []
        elif target_item is None:
            outcomes = ["Missing on target"]
            item = source_item
            configuration_differences = []
        else:
            outcomes = []
            item = source_item
            configuration_differences = []
            if not (source_item.independently_verifiable and target_item.independently_verifiable):
                outcomes.append("Not independently verifiable")

            if source_item.count != target_item.count:
                if source_item.count is None or target_item.count is None:
                    outcomes.append("Configuration unknown")
                else:
                    outcomes.append("Count mismatch")

            if not (source_item.configuration_known and target_item.configuration_known):
                if "Configuration unknown" not in outcomes:
                    outcomes.append("Configuration unknown")
            else:
                source_config = _effective_configuration(source_item)
                target_config = _effective_configuration(target_item)
                configuration_differences = sorted(
                    key
                    for key in set(source_config) | set(target_config)
                    if source_config.get(key) != target_config.get(key)
                )
                if configuration_differences:
                    outcomes.append("Configuration mismatch")

            if source_item.evidence.kind == "unavailable" or target_item.evidence.kind == "unavailable":
                if "Configuration unknown" not in outcomes:
                    outcomes.append("Configuration unknown")
            elif source_item.evidence.kind != target_item.evidence.kind:
                if "Configuration mismatch" not in outcomes:
                    outcomes.append("Configuration mismatch")
            elif source_item.evidence.fingerprint != target_item.evidence.fingerprint:
                if "Configuration mismatch" not in outcomes:
                    outcomes.append("Configuration mismatch")
            elif source_item.evidence.closure != target_item.evidence.closure:
                if "Configuration mismatch" not in outcomes:
                    outcomes.append("Configuration mismatch")

            if not outcomes:
                outcomes = ["Match"]

        if item is None:
            raise ManifestError(
                f"comparison internal error: no component for identity {identity!r}"
            )
        results.append(
            {
                "kind": item.kind,
                "key": item.key,
                "outcomes": outcomes,
                "configuration_differences": configuration_differences,
                "source_count": source_item.count if source_item else None,
                "target_count": target_item.count if target_item else None,
                "source_note": source_item.note if source_item else None,
                "target_note": target_item.note if target_item else None,
            }
        )
    return results


def _comparison_guard(source: Manifest, target: Manifest) -> None:
    try:
        same_file = source.path.resolve() == target.path.resolve() or source.path.samefile(target.path)
    except OSError:
        same_file = source.path.resolve() == target.path.resolve()
    if same_file or source.raw_sha256 == target.raw_sha256:
        raise ManifestError("source and target are the same manifest input")
    if source.role != "source" or target.role != "target":
        raise ManifestError(
            f"comparison requires source role then target role; got {source.role!r} and {target.role!r}"
        )
    if source.project_ref == target.project_ref:
        raise ManifestError("source and target project_ref must be different")
    source_identity = (
        source.collection["boundary"]["kind"],
        source.collection["boundary"]["value"],
        source.collection["artifact"]["kind"],
        source.collection["artifact"]["source"],
        source.collection["artifact"]["sha256"],
    )
    target_identity = (
        target.collection["boundary"]["kind"],
        target.collection["boundary"]["value"],
        target.collection["artifact"]["kind"],
        target.collection["artifact"]["source"],
        target.collection["artifact"]["sha256"],
    )
    if source_identity == target_identity:
        raise ManifestError("source and target have the same collection/artifact provenance")


def _write_text(results: list[dict[str, Any]]) -> None:
    print("kind\tkey\toutcomes\tconfiguration_differences\tsource_count\ttarget_count")
    for row in results:
        outcomes = "; ".join(row["outcomes"])
        differences = ",".join(row["configuration_differences"])
        source_count = "" if row["source_count"] is None else str(row["source_count"])
        target_count = "" if row["target_count"] is None else str(row["target_count"])
        print(
            f"{row['kind']}\t{row['key']}\t{outcomes}\t{differences}\t{source_count}\t{target_count}"
        )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compare strict, provenance-bound local migration manifests."
    )
    parser.add_argument("source", type=Path)
    parser.add_argument("target", type=Path)
    parser.add_argument("--format", choices=("text", "json"), default="text")
    args = parser.parse_args()

    try:
        source_manifest = load_manifest(args.source)
        target_manifest = load_manifest(args.target)
        _comparison_guard(source_manifest, target_manifest)
        results = compare(source_manifest.components, target_manifest.components)
    except ManifestError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    if args.format == "json":
        json.dump(
            {
                "format_version": FORMAT_VERSION,
                "source": {
                    "label": source_manifest.label,
                    "project_ref": source_manifest.project_ref,
                    "collection": source_manifest.collection,
                },
                "target": {
                    "label": target_manifest.label,
                    "project_ref": target_manifest.project_ref,
                    "collection": target_manifest.collection,
                },
                "results": results,
            },
            sys.stdout,
            indent=2,
            sort_keys=True,
        )
        print()
    else:
        _write_text(results)

    return 0 if all(row["outcomes"] == ["Match"] for row in results) else 2


if __name__ == "__main__":
    raise SystemExit(main())
