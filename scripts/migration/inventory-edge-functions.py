#!/usr/bin/env python3
"""Fingerprint local Edge Function deployment closures; never contacts Supabase."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable


COLLECTOR_NAME = "inventory-edge-functions"
COLLECTOR_VERSION = "2.0.0"
DOMAIN = b"focus-flow-score/edge-function-deployment-closure/v2\x00"
ARTIFACT_DOMAIN = b"focus-flow-score/edge-function-inventory-artifact/v2\x00"
FUNCTION_HEADER = re.compile(r"^\s*\[functions\.([A-Za-z0-9_-]+)\]\s*(?:#.*)?$")
SECTION_HEADER = re.compile(r"^\s*\[")
PROJECT_ID = re.compile(r'^\s*project_id\s*=\s*"([a-z0-9]+)"\s*(?:#.*)?$')
VERIFY_JWT = re.compile(r"^\s*verify_jwt\s*=\s*(true|false)\s*(?:#.*)?$")
STRING_SETTING = re.compile(
    r'^\s*(entrypoint|import_map)\s*=\s*(["\'])(.*?)\2\s*(?:#.*)?$'
)
ANY_ASSIGNMENT = re.compile(r"^\s*([A-Za-z0-9_-]+)\s*=")
STATIC_FROM = re.compile(
    r"\b(?:import|export)\s+(?:type\s+)?[^;]*?\bfrom\s*([\"\'])([^\"\']+)\1",
    re.MULTILINE,
)
SIDE_EFFECT_IMPORT = re.compile(r"\bimport\s*([\"\'])([^\"\']+)\1")
DYNAMIC_IMPORT = re.compile(r"\bimport\s*\(\s*([\"\'])([^\"\']+)\1\s*\)")
ANY_DYNAMIC_IMPORT = re.compile(r"\bimport\s*\(")
LOCAL_EXTENSIONS = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".json")


@dataclass
class FunctionConfig:
    verify_jwt: bool | None = None
    entrypoint: str | None = None
    import_map: str | None = None


def _frame(digest: Any, value: bytes) -> None:
    digest.update(len(value).to_bytes(8, "big"))
    digest.update(value)


def _validate_collected_at(value: str) -> str:
    if not value.endswith("Z"):
        raise ValueError("--collected-at must be an RFC3339 UTC timestamp ending in Z")
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError as exc:
        raise ValueError("--collected-at must be a valid RFC3339 UTC timestamp") from exc
    if parsed.utcoffset() is None or parsed.utcoffset().total_seconds() != 0:
        raise ValueError("--collected-at must be UTC")
    return value


def read_project_and_function_config(path: Path) -> tuple[str, dict[str, FunctionConfig]]:
    """Parse the small supported Edge Function portion of config.toml strictly."""
    result: dict[str, FunctionConfig] = {}
    project_ref: str | None = None
    current: str | None = None
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError) as exc:
        raise ValueError(f"cannot read {path}: {exc}") from exc

    for line_number, line in enumerate(lines, 1):
        project_match = PROJECT_ID.match(line)
        if project_match and current is None:
            if project_ref is not None:
                raise ValueError(f"{path}:{line_number}: duplicate project_id")
            project_ref = project_match.group(1)
            continue

        header = FUNCTION_HEADER.match(line)
        if header:
            current = header.group(1)
            if current in result:
                raise ValueError(f"{path}:{line_number}: duplicate function block {current}")
            result[current] = FunctionConfig()
            continue
        if SECTION_HEADER.match(line):
            current = None
            continue
        if current is None or not line.strip() or line.lstrip().startswith("#"):
            continue

        verify_match = VERIFY_JWT.match(line)
        if verify_match:
            if result[current].verify_jwt is not None:
                raise ValueError(f"{path}:{line_number}: duplicate verify_jwt for {current}")
            result[current].verify_jwt = verify_match.group(1) == "true"
            continue

        string_match = STRING_SETTING.match(line)
        if string_match:
            setting, _, setting_value = string_match.groups()
            if not setting_value:
                raise ValueError(f"{path}:{line_number}: empty {setting} for {current}")
            if getattr(result[current], setting) is not None:
                raise ValueError(f"{path}:{line_number}: duplicate {setting} for {current}")
            setattr(result[current], setting, setting_value)
            continue

        assignment = ANY_ASSIGNMENT.match(line)
        if assignment:
            raise ValueError(
                f"{path}:{line_number}: unsupported effective function setting "
                f"{assignment.group(1)!r} for {current}"
            )

    if project_ref is None:
        raise ValueError(f"{path}: missing project_id")
    if not re.fullmatch(r"[a-z0-9]{20}", project_ref):
        raise ValueError(f"{path}: project_id is not a 20-character Supabase project ref")
    return project_ref, result


def _mask_comments(source: str) -> str:
    """Replace JS/TS comments while preserving quoted strings and line positions."""
    output: list[str] = []
    index = 0
    state = "code"
    quote = ""
    while index < len(source):
        char = source[index]
        following = source[index + 1] if index + 1 < len(source) else ""
        if state == "code":
            if char in {"'", '"', "`"}:
                state = "string"
                quote = char
                output.append(char)
            elif char == "/" and following == "/":
                state = "line_comment"
                output.extend((" ", " "))
                index += 1
            elif char == "/" and following == "*":
                state = "block_comment"
                output.extend((" ", " "))
                index += 1
            else:
                output.append(char)
        elif state == "string":
            output.append(char)
            if char == "\\" and following:
                output.append(following)
                index += 1
            elif char == quote:
                state = "code"
        elif state == "line_comment":
            if char == "\n":
                state = "code"
                output.append("\n")
            else:
                output.append(" ")
        else:
            if char == "*" and following == "/":
                state = "code"
                output.extend((" ", " "))
                index += 1
            elif char == "\n":
                output.append("\n")
            else:
                output.append(" ")
        index += 1
    if state == "block_comment":
        raise ValueError("unterminated block comment while resolving imports")
    return "".join(output)


def import_specifiers(path: Path) -> set[str]:
    if path.suffix not in {".ts", ".tsx", ".js", ".jsx", ".mjs"}:
        return set()
    try:
        source = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise ValueError(f"cannot read source dependency {path}: {exc}") from exc
    masked = _mask_comments(source)
    matches = list(STATIC_FROM.finditer(masked))
    matches.extend(SIDE_EFFECT_IMPORT.finditer(masked))
    dynamic_matches = list(DYNAMIC_IMPORT.finditer(masked))
    matches.extend(dynamic_matches)
    if len(ANY_DYNAMIC_IMPORT.findall(masked)) != len(dynamic_matches):
        raise ValueError(f"{path}: non-literal dynamic import prevents a complete dependency closure")
    return {match.group(2) for match in matches}


def _within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def resolve_local_import(importer: Path, specifier: str, functions_root: Path) -> Path | None:
    if not specifier.startswith(("./", "../")):
        return None
    if "?" in specifier or "#" in specifier:
        raise ValueError(f"{importer}: local import query/fragment is unsupported: {specifier!r}")
    candidate = (importer.parent / specifier).resolve()
    functions_root = functions_root.resolve()
    if not _within(candidate, functions_root):
        raise ValueError(f"{importer}: local import escapes supabase/functions: {specifier!r}")

    candidates = [candidate]
    if not candidate.suffix:
        candidates.extend(Path(str(candidate) + extension) for extension in LOCAL_EXTENSIONS)
        candidates.extend(candidate / f"index{extension}" for extension in LOCAL_EXTENSIONS)
    resolved = [path for path in candidates if path.is_file()]
    if len(resolved) != 1:
        qualifier = "ambiguous" if resolved else "unresolved"
        raise ValueError(f"{importer}: {qualifier} local import {specifier!r}")
    return resolved[0]


def dependency_closure(entrypoint: Path, functions_root: Path) -> list[Path]:
    pending = [entrypoint.resolve()]
    visited: set[Path] = set()
    while pending:
        path = pending.pop()
        if path in visited:
            continue
        if not path.is_file():
            raise ValueError(f"missing deployment dependency: {path}")
        if not _within(path, functions_root.resolve()):
            raise ValueError(f"deployment dependency escapes supabase/functions: {path}")
        visited.add(path)
        for specifier in import_specifiers(path):
            resolved = resolve_local_import(path, specifier, functions_root)
            if resolved is not None and resolved not in visited:
                pending.append(resolved)
    return sorted(visited)


def _repo_relative(path: Path, root: Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError as exc:
        raise ValueError(f"artifact escapes repository root: {path}") from exc


def deployment_fingerprint(
    root: Path, closure: Iterable[Path], effective_config: dict[str, Any]
) -> str:
    digest = hashlib.sha256()
    digest.update(DOMAIN)
    config_bytes = json.dumps(
        effective_config, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")
    _frame(digest, config_bytes)
    for path in closure:
        relative = _repo_relative(path, root).encode("utf-8")
        content = path.read_bytes()
        _frame(digest, relative)
        _frame(digest, content)
    return f"sha256:{digest.hexdigest()}"


def inventory_artifact_fingerprint(components: list[dict[str, Any]]) -> str:
    canonical = json.dumps(
        components, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")
    digest = hashlib.sha256()
    digest.update(ARTIFACT_DOMAIN)
    _frame(digest, canonical)
    return f"sha256:{digest.hexdigest()}"


def _resolve_config_path(raw: str, config_path: Path, root: Path, setting: str) -> Path:
    path = (config_path.parent / raw).resolve()
    if not _within(path, root.resolve()):
        raise ValueError(f"{setting} path escapes repository root: {raw!r}")
    if not path.is_file():
        raise ValueError(f"{setting} path does not exist: {raw!r}")
    return path


def build_inventory(
    root: Path,
    collected_at: str,
    role: str,
    project_ref_override: str | None = None,
) -> dict[str, Any]:
    if role not in {"source", "target"}:
        raise ValueError("role must be source or target")
    functions_root = root / "supabase" / "functions"
    config_path = root / "supabase" / "config.toml"
    if not functions_root.is_dir():
        raise ValueError(f"missing functions directory: {functions_root}")
    configured_project_ref, function_config = read_project_and_function_config(config_path)
    project_ref = project_ref_override or configured_project_ref
    if not re.fullmatch(r"[a-z0-9]{20}", project_ref):
        raise ValueError("--project-ref must be a 20-character Supabase project ref")

    directories = sorted(
        path for path in functions_root.iterdir() if path.is_dir() and path.name != "_shared"
    )
    directory_names = {path.name for path in directories}
    orphan_config = sorted(set(function_config) - directory_names)
    if orphan_config:
        raise ValueError(
            "config names without matching function directory: " + ", ".join(orphan_config)
        )

    components: list[dict[str, Any]] = []
    for directory in directories:
        config = function_config.get(directory.name, FunctionConfig())
        if config.entrypoint is None:
            entrypoint = directory / "index.ts"
            entrypoint_source = "documented_default"
        else:
            entrypoint = _resolve_config_path(config.entrypoint, config_path, root, "entrypoint")
            entrypoint_source = "explicit_config"
        if not entrypoint.is_file():
            raise ValueError(f"{directory.name}: missing effective entrypoint {entrypoint}")

        if config.import_map is None:
            import_map_path = None
            import_map_value = None
            import_map_source = "documented_default"
        else:
            import_map_path = _resolve_config_path(config.import_map, config_path, root, "import_map")
            import_map_value = _repo_relative(import_map_path, root)
            import_map_source = "explicit_config"

        verify_jwt = True if config.verify_jwt is None else config.verify_jwt
        verify_jwt_source = (
            "documented_default" if config.verify_jwt is None else "explicit_config"
        )
        effective_config = {
            "entrypoint": _repo_relative(entrypoint, root),
            "import_map": import_map_value,
            "verify_jwt": verify_jwt,
        }
        closure = dependency_closure(entrypoint, functions_root)
        if import_map_path is not None and import_map_path not in closure:
            closure = sorted([*closure, import_map_path])
        closure_paths = [_repo_relative(path, root) for path in closure]
        components.append(
            {
                "key": directory.name,
                "kind": "edge_function",
                "count": None,
                "evidence": {
                    "kind": "edge_function_deployment_closure",
                    "fingerprint": deployment_fingerprint(root, closure, effective_config),
                    "closure": closure_paths,
                },
                "configuration": {
                    "verify_jwt": {
                        "value": verify_jwt,
                        "source": verify_jwt_source,
                    },
                    "entrypoint": {
                        "value": effective_config["entrypoint"],
                        "source": entrypoint_source,
                    },
                    "import_map": {
                        "value": import_map_value,
                        "source": import_map_source,
                    },
                },
                "configuration_known": True,
                "independently_verifiable": role == "source",
                "note": (
                    "Reviewed repository source closure; compare with separately "
                    "collected target deployment evidence."
                    if role == "source"
                    else "Local target checkout only; this is not independently "
                    "collected deployed-target evidence."
                ),
            }
        )

    if not components:
        raise ValueError("no deployable Edge Function directories found")
    artifact_sha = inventory_artifact_fingerprint(components)
    return {
        "format_version": 2,
        "label": f"{role}-repository-edge-functions",
        "role": role,
        "project_ref": project_ref,
        "collection": {
            "boundary": {
                "kind": "repository_content_sha256",
                "value": artifact_sha,
            },
            "collected_at": collected_at,
            "collector": {"name": COLLECTOR_NAME, "version": COLLECTOR_VERSION},
            "artifact": {
                "kind": "repository_deployment_inventory",
                "source": (
                    f"local {role} project {project_ref} supabase/config.toml and "
                    "resolved supabase/functions dependency closures"
                ),
                "sha256": artifact_sha,
            },
        },
        "components": components,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Inventory local Supabase Edge Function deployment closures and effective settings."
        )
    )
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parents[2],
        help="repository root (defaults to the checkout containing this script)",
    )
    parser.add_argument(
        "--role",
        required=True,
        choices=("source", "target"),
        help="the migration side represented by this repository checkout",
    )
    parser.add_argument(
        "--project-ref",
        help=(
            "explicit 20-character project ref; required for target collection and "
            "otherwise defaults to supabase/config.toml"
        ),
    )
    parser.add_argument(
        "--collected-at",
        required=True,
        help="explicit RFC3339 UTC collection time, for provenance and reproducibility",
    )
    args = parser.parse_args()
    root = args.repo_root.resolve()
    try:
        if args.role == "target" and not args.project_ref:
            raise ValueError("--project-ref is required when --role=target")
        inventory = build_inventory(
            root,
            _validate_collected_at(args.collected_at),
            args.role,
            args.project_ref,
        )
    except (OSError, UnicodeError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    json.dump(inventory, sys.stdout, indent=2, sort_keys=True)
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
