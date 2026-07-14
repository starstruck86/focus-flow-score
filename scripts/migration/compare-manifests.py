#!/usr/bin/env python3
"""Compare two migration verification manifests without contacting a database."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


ALLOWED_TOP_LEVEL = {"format_version", "label", "components"}
ALLOWED_COMPONENT_FIELDS = {
    "key",
    "kind",
    "count",
    "fingerprint",
    "configuration_known",
    "independently_verifiable",
    "note",
}
ALLOWED_KINDS = {
    "auth",
    "edge_function",
    "extension",
    "function",
    "job",
    "policy",
    "publication",
    "schema",
    "sequence",
    "storage",
    "table",
    "trigger",
    "view",
}


class ManifestError(ValueError):
    """Raised when a manifest fails the strict local schema."""


@dataclass(frozen=True)
class Component:
    key: str
    kind: str
    count: int | None
    fingerprint: str | None
    configuration_known: bool
    independently_verifiable: bool
    note: str | None


def _require_exact_keys(value: dict[str, Any], allowed: set[str], context: str) -> None:
    unknown = set(value) - allowed
    if unknown:
        raise ManifestError(f"{context}: unknown field(s): {', '.join(sorted(unknown))}")


def _parse_component(value: Any, index: int) -> Component:
    context = f"components[{index}]"
    if not isinstance(value, dict):
        raise ManifestError(f"{context}: expected object")
    _require_exact_keys(value, ALLOWED_COMPONENT_FIELDS, context)

    required = {
        "key",
        "kind",
        "count",
        "fingerprint",
        "configuration_known",
        "independently_verifiable",
    }
    missing = required - set(value)
    if missing:
        raise ManifestError(f"{context}: missing field(s): {', '.join(sorted(missing))}")

    key = value["key"]
    kind = value["kind"]
    count = value["count"]
    fingerprint = value["fingerprint"]
    configuration_known = value["configuration_known"]
    independently_verifiable = value["independently_verifiable"]
    note = value.get("note")

    if not isinstance(key, str) or not key or key.strip() != key:
        raise ManifestError(f"{context}.key: expected non-empty trimmed string")
    if not isinstance(kind, str) or kind not in ALLOWED_KINDS:
        raise ManifestError(f"{context}.kind: unsupported kind {kind!r}")
    if count is not None and (not isinstance(count, int) or isinstance(count, bool) or count < 0):
        raise ManifestError(f"{context}.count: expected non-negative integer or null")
    if fingerprint is not None and (
        not isinstance(fingerprint, str) or not fingerprint or fingerprint.strip() != fingerprint
    ):
        raise ManifestError(f"{context}.fingerprint: expected non-empty trimmed string or null")
    if not isinstance(configuration_known, bool):
        raise ManifestError(f"{context}.configuration_known: expected boolean")
    if not isinstance(independently_verifiable, bool):
        raise ManifestError(f"{context}.independently_verifiable: expected boolean")
    if note is not None and not isinstance(note, str):
        raise ManifestError(f"{context}.note: expected string or null")

    return Component(
        key=key,
        kind=kind,
        count=count,
        fingerprint=fingerprint,
        configuration_known=configuration_known,
        independently_verifiable=independently_verifiable,
        note=note,
    )


def load_manifest(path: Path) -> tuple[str, dict[str, Component]]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ManifestError(f"manifest not found: {path}") from exc
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ManifestError(f"cannot read valid UTF-8 JSON manifest {path}: {exc}") from exc

    if not isinstance(raw, dict):
        raise ManifestError(f"{path}: expected top-level object")
    _require_exact_keys(raw, ALLOWED_TOP_LEVEL, str(path))
    if raw.get("format_version") != 1:
        raise ManifestError(f"{path}: format_version must be 1")
    label = raw.get("label")
    if not isinstance(label, str) or not label:
        raise ManifestError(f"{path}: label must be a non-empty string")
    components = raw.get("components")
    if not isinstance(components, list):
        raise ManifestError(f"{path}: components must be an array")

    indexed: dict[str, Component] = {}
    for index, item in enumerate(components):
        component = _parse_component(item, index)
        identity = f"{component.kind}:{component.key}"
        if identity in indexed:
            raise ManifestError(f"{path}: duplicate component identity {identity}")
        indexed[identity] = component
    return label, indexed


def compare(
    source: dict[str, Component], target: dict[str, Component]
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for identity in sorted(set(source) | set(target)):
        source_item = source.get(identity)
        target_item = target.get(identity)

        if source_item is None:
            outcomes = ["Unexpected on target"]
            item = target_item
        elif target_item is None:
            outcomes = ["Missing on target"]
            item = source_item
        else:
            outcomes = []
            item = source_item
            if not (
                source_item.independently_verifiable
                and target_item.independently_verifiable
            ):
                outcomes.append("Not independently verifiable")

            if source_item.count is not None and target_item.count is not None:
                if source_item.count != target_item.count:
                    outcomes.append("Count mismatch")
            elif source_item.count is not target_item.count:
                outcomes.append("Configuration unknown")

            if not (source_item.configuration_known and target_item.configuration_known):
                if "Configuration unknown" not in outcomes:
                    outcomes.append("Configuration unknown")
            elif source_item.fingerprint is None or target_item.fingerprint is None:
                if "Configuration unknown" not in outcomes:
                    outcomes.append("Configuration unknown")
            elif source_item.fingerprint != target_item.fingerprint:
                outcomes.append("Configuration mismatch")

            if not outcomes:
                outcomes = ["Match"]

        assert item is not None
        results.append(
            {
                "kind": item.kind,
                "key": item.key,
                "outcomes": outcomes,
                "source_count": source_item.count if source_item else None,
                "target_count": target_item.count if target_item else None,
                "source_note": source_item.note if source_item else None,
                "target_note": target_item.note if target_item else None,
            }
        )
    return results


def _write_text(results: list[dict[str, Any]]) -> None:
    print("kind\tkey\toutcomes\tsource_count\ttarget_count")
    for row in results:
        outcomes = "; ".join(row["outcomes"])
        source_count = "" if row["source_count"] is None else str(row["source_count"])
        target_count = "" if row["target_count"] is None else str(row["target_count"])
        print(
            f"{row['kind']}\t{row['key']}\t{outcomes}\t{source_count}\t{target_count}"
        )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compare strict, local migration manifests without database access."
    )
    parser.add_argument("source", type=Path)
    parser.add_argument("target", type=Path)
    parser.add_argument("--format", choices=("text", "json"), default="text")
    args = parser.parse_args()

    try:
        source_label, source = load_manifest(args.source)
        target_label, target = load_manifest(args.target)
        results = compare(source, target)
    except ManifestError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    if args.format == "json":
        json.dump(
            {
                "format_version": 1,
                "source_label": source_label,
                "target_label": target_label,
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
