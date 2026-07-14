#!/usr/bin/env python3
"""Build a repository-only Edge Function/JWT manifest; never contacts Supabase."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path


FUNCTION_HEADER = re.compile(r"^\s*\[functions\.([A-Za-z0-9_-]+)\]\s*(?:#.*)?$")
VERIFY_JWT = re.compile(r"^\s*verify_jwt\s*=\s*(true|false)\s*(?:#.*)?$")


def directory_digest(path: Path) -> str:
    digest = hashlib.sha256()
    for file_path in sorted(item for item in path.rglob("*") if item.is_file()):
        relative = file_path.relative_to(path).as_posix().encode("utf-8")
        content = file_path.read_bytes()
        digest.update(len(relative).to_bytes(4, "big"))
        digest.update(relative)
        digest.update(len(content).to_bytes(8, "big"))
        digest.update(content)
    return f"sha256:{digest.hexdigest()}"


def read_function_config(path: Path) -> dict[str, bool | None]:
    """Read only the simple function blocks without a third-party TOML package."""
    result: dict[str, bool | None] = {}
    current: str | None = None
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError) as exc:
        raise ValueError(f"cannot read {path}: {exc}") from exc

    for line_number, line in enumerate(lines, 1):
        header = FUNCTION_HEADER.match(line)
        if header:
            current = header.group(1)
            if current in result:
                raise ValueError(f"{path}:{line_number}: duplicate function block {current}")
            result[current] = None
            continue
        if line.lstrip().startswith("["):
            current = None
            continue
        if current is not None:
            setting = VERIFY_JWT.match(line)
            if setting:
                if result[current] is not None:
                    raise ValueError(
                        f"{path}:{line_number}: duplicate verify_jwt for {current}"
                    )
                result[current] = setting.group(1) == "true"
    return result


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Inventory local Supabase Edge Function slugs and explicit verify_jwt settings."
    )
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parents[2],
        help="repository root (defaults to the current checkout containing this script)",
    )
    args = parser.parse_args()
    root = args.repo_root.resolve()
    functions_root = root / "supabase" / "functions"
    config_path = root / "supabase" / "config.toml"

    try:
        function_config = read_function_config(config_path)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1

    directories = sorted(
        path
        for path in functions_root.iterdir()
        if path.is_dir() and path.name != "_shared" and (path / "index.ts").is_file()
    )
    directory_names = {path.name for path in directories}
    orphan_config = sorted(set(function_config) - directory_names)
    if orphan_config:
        print(
            "error: config names without matching function directory: "
            + ", ".join(orphan_config),
            file=sys.stderr,
        )
        return 1

    components = []
    for directory in directories:
        verify_jwt = function_config.get(directory.name)
        explicit = isinstance(verify_jwt, bool)
        components.append(
            {
                "key": directory.name,
                "kind": "edge_function",
                "count": None,
                "fingerprint": directory_digest(directory),
                "configuration_known": explicit,
                "independently_verifiable": True,
                "note": (
                    f"repository verify_jwt={str(verify_jwt).lower()}"
                    if explicit
                    else "verify_jwt is not explicit in supabase/config.toml; confirm effective deployment setting"
                ),
            }
        )

    json.dump(
        {
            "format_version": 1,
            "label": "repository-edge-functions",
            "components": components,
        },
        sys.stdout,
        indent=2,
        sort_keys=True,
    )
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
