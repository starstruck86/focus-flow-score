#!/usr/bin/env python3
"""Guard against reviewed credential/cron patterns in tracked artifacts.

This is a narrow accidental-regression guard, not a PostgreSQL parser or an
exhaustive SQL security scanner. It recognizes only the documented patterns
below. Operational scan errors stop the check, but a clean result must never be
treated as proof that arbitrary SQL contains no credential or executable job.

Output is restricted to canonical JSONL records containing an allowlisted
finding type and either the one explicitly reviewed public schema path or a
fixed opaque placeholder. Matching bytes, context, line numbers, hashes,
sizes, exception text, and untrusted filenames are never emitted.
"""

from __future__ import annotations

import json
import os
import re
import stat
import subprocess
import sys
from pathlib import Path, PurePosixPath


# These are the only server-config syntaxes intentionally covered, and only
# beneath supabase/. Generic .cfg/.conf and configs elsewhere are out of scope.
SUPABASE_CONFIG_SUFFIX_FAMILIES = {
    ".ini": "line",
    ".json": "json",
    ".toml": "line",
    ".yaml": "line",
    ".yml": "line",
}
MAX_ARTIFACT_BYTES = 16 * 1024 * 1024
OPAQUE_DIAGNOSTIC_PATH = "<redacted-tracked-artifact>"
FINDING_TYPES = frozenset(
    {
        "embedded_bearer_jwt",
        "executable_cron_in_derived_snapshot",
        "non_placeholder_x_cron_secret",
        "scan_error",
        "supabase_project_binding_in_derived_snapshot",
        "unsafe_cron_secret_runtime_binding",
        "x_cron_secret_in_derived_snapshot",
    }
)
APPROVED_TEMPLATE_MARKERS = frozenset(
    {
        "${X_CRON_SECRET}",
        "{{X_CRON_SECRET}}",
        "<X_CRON_SECRET>",
        "__X_CRON_SECRET_REQUIRED__",
    }
)
DERIVED_STAGING_SNAPSHOT = "supabase/dynamic_staging_schema.sql"

X_CRON_KEY = re.compile(r"(?i)x-cron-secret")
REVIEWED_TEXT_ESCAPES = (
    (re.compile(r"(?i)\\u002d|\\x2d|\\055|\\002d"), "-"),
    (re.compile(r"(?i)\\u0065|\\x65|\\145|\\0065"), "e"),
)
SQL_LITERAL_JOIN = re.compile(
    r"(?is)"
    r"['\"]"
    r"(?:\s|--[^\r\n]*(?:\r?\n|$)|/\*.*?\*/)*"
    r"(?:\|\|(?:\s|--[^\r\n]*(?:\r?\n|$)|/\*.*?\*/)*)?"
    r"(?:[Ee]|[Uu]&)?['\"]"
)
SQL_CONCAT_TWO_LITERALS = re.compile(
    r"(?is)\bconcat\s*\(\s*"
    r"(?:[Ee]|[Uu]&)?(?P<first_quote>['\"])(?P<first>[^'\"]*)"
    r"(?P=first_quote)\s*,\s*"
    r"(?:[Ee]|[Uu]&)?(?P<second_quote>['\"])(?P<second>[^'\"]*)"
    r"(?P=second_quote)\s*\)"
)
TEMPLATE_MARKER_PATTERN = "(?:" + "|".join(
    re.escape(marker) for marker in sorted(APPROVED_TEMPLATE_MARKERS)
) + ")"
SAFE_X_CRON_TEMPLATE_BINDING = (
    rf"(?ix)"
    rf"(?P<key_quote>['\"]?)(?P<key_name>x-cron-secret)(?P=key_quote)"
    rf"\s*(?::|,|=>|=)\s*"
    rf"(?:"
    rf"(?P<value_quote>['\"]){TEMPLATE_MARKER_PATTERN}(?P=value_quote)"
    rf"|{TEMPLATE_MARKER_PATTERN}"
    rf")"
)
SAFE_X_CRON_TEMPLATE_SQL = re.compile(
    SAFE_X_CRON_TEMPLATE_BINDING + r"(?=\s*(?:[,\)}\];]|$))"
)
SAFE_X_CRON_TEMPLATE_CONFIG_CANDIDATE = re.compile(SAFE_X_CRON_TEMPLATE_BINDING)
SAFE_X_CRON_RUNTIME = re.compile(
    r"(?ix)"
    r"(?P<key_quote>['\"])(?P<key_name>x-cron-secret)(?P=key_quote)"
    r"\s*,\s*current_setting\s*\(\s*"
    r"(?P<setting_quote>['\"])(?P<setting_name>app\.runtime\.cron_secret)"
    r"(?P=setting_quote)"
    r"\s*,\s*true\s*\)"
    r"(?=\s*(?:[,\)}\];]|$))"
)
SAFE_CRON_SETTING_READ = re.compile(
    r"(?ix)current_setting\s*\(\s*"
    r"(?P<setting_quote>['\"])(?P<setting_name>app\.runtime\.cron_secret)"
    r"(?P=setting_quote)\s*,\s*true\s*\)"
)
RUNTIME_CRON_SETTING = re.compile(r"(?i)app\.runtime\.cron_secret")
BEARER_JWT = re.compile(
    r"(?i)(?<![A-Za-z0-9_-])"
    r"bearer[ \t]+"
    r"[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"
    r"(?![A-Za-z0-9_-])"
)
CRON_SCHEMA_TOKEN = re.compile(
    r"(?i)(?<![A-Za-z0-9_$])(?:cron|\"cron\")(?![A-Za-z0-9_$])"
)
CRON_FUNCTION_TOKEN = re.compile(
    r"(?i)(?:schedule|schedule_in_database|alter_job|unschedule|"
    r"\"schedule\"|\"schedule_in_database\"|\"alter_job\"|"
    r"\"unschedule\")(?![A-Za-z0-9_$])"
)
CRON_JOB_TOKEN = re.compile(r'(?i)(?:job|"job")(?![A-Za-z0-9_$])')
SQL_COMMAND_TOKEN = re.compile(r"(?i)\b(?:insert|update|delete)\b")
SEARCH_PATH_TOKEN = re.compile(r"(?i)\bsearch_path\b")
SUPABASE_ENDPOINT_SHAPE = re.compile(
    r"(?i)(?<![A-Za-z0-9])https://[a-z0-9]{20}\.supabase\.co"
    r"(?=[:/\s'\"),;]|$)"
)
SUPABASE_PROJECT_REF_BINDING_SHAPE = re.compile(
    r"(?ix)"
    r"\b(?:source[_-]?project[_-]?ref|supabase[_-]?project[_-]?ref|"
    r"project[_-]?ref)\b"
    r"\s*(?:=|:|=>|,)\s*"
    r"['\"]?[a-z0-9]{20}['\"]?"
    r"(?=\s*(?:[,;)}\]]|$))"
)
PUBLIC_DIAGNOSTIC_PATHS = frozenset({DERIVED_STAGING_SNAPSHOT})


def diagnostic_path(path: str) -> str:
    """Return only an explicitly reviewed public path or an opaque label."""

    if path == "." or path in PUBLIC_DIAGNOSTIC_PATHS:
        return path
    return OPAQUE_DIAGNOSTIC_PATH


def canonical_record(path: str, finding_type: str) -> str:
    if finding_type not in FINDING_TYPES:
        finding_type = "scan_error"
    return json.dumps(
        {"path": diagnostic_path(path), "finding_type": finding_type},
        ensure_ascii=True,
        separators=(",", ":"),
    )


def emit(findings: set[tuple[str, str]]) -> None:
    records = {
        canonical_record(path, finding_type) for path, finding_type in findings
    }
    for record in sorted(records):
        print(record)


def parse_repo_root(arguments: list[str]) -> Path | None:
    if not arguments:
        return Path.cwd()
    if len(arguments) == 2 and arguments[0] == "--repo-root":
        return Path(arguments[1])
    return None


def git_environment() -> dict[str, str]:
    environment = {
        key: value for key, value in os.environ.items() if not key.startswith("GIT_")
    }
    environment.update(
        {
            "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_OPTIONAL_LOCKS": "0",
            "LC_ALL": "C",
        }
    )
    return environment


def git_top_level(candidate: Path) -> Path | None:
    result = subprocess.run(
        ["git", "-C", str(candidate), "rev-parse", "--show-toplevel"],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        env=git_environment(),
    )
    if result.returncode != 0:
        return None
    try:
        root_text = result.stdout.decode("utf-8", errors="strict").strip()
        return Path(root_text).resolve(strict=True) if root_text else None
    except (OSError, RuntimeError, UnicodeError):
        return None


def tracked_paths(root: Path) -> list[str] | None:
    result = subprocess.run(
        ["git", "-C", str(root), "ls-files", "-z"],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        env=git_environment(),
    )
    if result.returncode != 0:
        return None
    try:
        decoded = result.stdout.decode("utf-8", errors="strict")
    except UnicodeError:
        return None
    paths = [item for item in decoded.split("\0") if item]
    return sorted(path for path in paths if is_scanned_artifact(path))


def is_scanned_artifact(relative: str) -> bool:
    path = PurePosixPath(relative)
    if path.is_absolute() or ".." in path.parts or not path.parts:
        return False
    suffix = path.suffix.casefold()
    if suffix == ".sql":
        return True
    return (
        path.parts[0] == "supabase"
        and suffix in SUPABASE_CONFIG_SUFFIX_FAMILIES
    )


def read_tracked_artifact(root_fd: int, relative: str) -> str | None:
    components = PurePosixPath(relative).parts
    if not components or ".." in components:
        return None
    nofollow = getattr(os, "O_NOFOLLOW", 0)
    directory_flag = getattr(os, "O_DIRECTORY", 0)
    close_on_exec = getattr(os, "O_CLOEXEC", 0)
    if not nofollow or not directory_flag:
        return None
    directory_fd = os.dup(root_fd)
    file_fd: int | None = None
    try:
        for component in components[:-1]:
            next_fd = os.open(
                component,
                os.O_RDONLY | directory_flag | nofollow | close_on_exec,
                dir_fd=directory_fd,
            )
            os.close(directory_fd)
            directory_fd = next_fd
        file_fd = os.open(
            components[-1],
            os.O_RDONLY | nofollow | close_on_exec,
            dir_fd=directory_fd,
        )
        before = os.fstat(file_fd)
        if not stat.S_ISREG(before.st_mode) or before.st_size > MAX_ARTIFACT_BYTES:
            return None
        chunks: list[bytes] = []
        total = 0
        while True:
            chunk = os.read(file_fd, min(64 * 1024, MAX_ARTIFACT_BYTES + 1 - total))
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
            if total > MAX_ARTIFACT_BYTES:
                return None
        after = os.fstat(file_fd)
        before_identity = (
            before.st_dev,
            before.st_ino,
            before.st_mode,
            before.st_size,
            before.st_mtime_ns,
            before.st_ctime_ns,
        )
        after_identity = (
            after.st_dev,
            after.st_ino,
            after.st_mode,
            after.st_size,
            after.st_mtime_ns,
            after.st_ctime_ns,
        )
        if before_identity != after_identity or total != after.st_size:
            return None
        current_fd = os.open(
            components[-1],
            os.O_RDONLY | nofollow | close_on_exec,
            dir_fd=directory_fd,
        )
        try:
            current = os.fstat(current_fd)
        finally:
            os.close(current_fd)
        current_identity = (
            current.st_dev,
            current.st_ino,
            current.st_mode,
            current.st_size,
            current.st_mtime_ns,
            current.st_ctime_ns,
        )
        if current_identity != after_identity or not stat.S_ISREG(current.st_mode):
            return None
        return b"".join(chunks).decode("utf-8", errors="strict")
    except (OSError, RuntimeError, UnicodeError, ValueError):
        return None
    finally:
        if file_fd is not None:
            os.close(file_fd)
        os.close(directory_fd)


def skip_sql_token_gap(text: str, start: int) -> int:
    """Skip whitespace and PostgreSQL line/nested-block comments."""

    position = start
    while position < len(text):
        if text[position].isspace():
            position += 1
            continue
        if text.startswith("--", position):
            newline = position + 2
            while newline < len(text) and text[newline] not in "\r\n":
                newline += 1
            position = newline
            continue
        if text.startswith("/*", position):
            depth = 1
            position += 2
            while position < len(text) and depth:
                if text.startswith("/*", position):
                    depth += 1
                    position += 2
                elif text.startswith("*/", position):
                    depth -= 1
                    position += 2
                else:
                    position += 1
            if depth:
                return len(text)
            continue
        break
    return position


def reviewed_pattern_view(text: str) -> str:
    """Normalize only reviewed escape and SQL-literal-join spellings.

    This deliberately is not general SQL/config canonicalization.
    """

    normalized = text
    for pattern, replacement in REVIEWED_TEXT_ESCAPES:
        normalized = pattern.sub(replacement, normalized)
    while True:
        joined = SQL_LITERAL_JOIN.sub("", normalized)
        joined = SQL_CONCAT_TWO_LITERALS.sub(
            lambda match: match.group("first") + match.group("second"),
            joined,
        )
        if joined == normalized:
            return normalized
        normalized = joined


def has_qualified_cron_call(text: str) -> bool:
    for schema_match in CRON_SCHEMA_TOKEN.finditer(text):
        position = skip_sql_token_gap(text, schema_match.end())
        if position >= len(text) or text[position] != ".":
            continue
        position = skip_sql_token_gap(text, position + 1)
        function_match = CRON_FUNCTION_TOKEN.match(text, position)
        if function_match is None:
            continue
        position = skip_sql_token_gap(text, function_match.end())
        if position < len(text) and text[position] == "(":
            return True
    return False


def has_any_cron_function_call(text: str) -> bool:
    for function_match in CRON_FUNCTION_TOKEN.finditer(text):
        position = skip_sql_token_gap(text, function_match.end())
        if position < len(text) and text[position] == "(":
            return True
    return False


def has_cron_search_path(text: str) -> bool:
    """Recognize reviewed SET/set_config search-path forms containing cron."""

    assignments = re.finditer(
        r"(?is)\bset\s+(?:(?:local|session)\s+)?search_path\s*"
        r"(?:=|to)\s*(?P<value>[^;]{0,512})",
        text,
    )
    set_config_calls = re.finditer(
        r"(?is)\bset_config\s*\(\s*['\"]search_path['\"]\s*,\s*"
        r"(?P<quote>['\"])(?P<value>.{0,512}?)(?P=quote)",
        text,
    )
    return any(
        CRON_SCHEMA_TOKEN.search(match.group("value"))
        for match in (*assignments, *set_config_calls)
    )


def match_sql_keyword(text: str, position: int, keyword: str) -> int | None:
    end = position + len(keyword)
    if text[position:end].casefold() != keyword:
        return None
    if position and (text[position - 1].isalnum() or text[position - 1] in "_$"):
        return None
    if end < len(text) and (text[end].isalnum() or text[end] in "_$"):
        return None
    return end


def match_cron_job_relation(text: str, position: int) -> int | None:
    position = skip_sql_token_gap(text, position)
    schema_match = CRON_SCHEMA_TOKEN.match(text, position)
    if schema_match is None:
        return None
    position = skip_sql_token_gap(text, schema_match.end())
    if position >= len(text) or text[position] != ".":
        return None
    position = skip_sql_token_gap(text, position + 1)
    job_match = CRON_JOB_TOKEN.match(text, position)
    return None if job_match is None else job_match.end()


def has_direct_cron_job_dml(text: str) -> bool:
    for command_match in SQL_COMMAND_TOKEN.finditer(text):
        command = command_match.group(0).casefold()
        position = skip_sql_token_gap(text, command_match.end())
        if command == "insert":
            matched = match_sql_keyword(text, position, "into")
            if matched is None:
                continue
            position = skip_sql_token_gap(text, matched)
        elif command == "delete":
            matched = match_sql_keyword(text, position, "from")
            if matched is None:
                continue
            position = skip_sql_token_gap(text, matched)
        if command in {"insert", "update", "delete"}:
            only = match_sql_keyword(text, position, "only")
            if only is not None:
                position = skip_sql_token_gap(text, only)
        if match_cron_job_relation(text, position) is not None:
            return True
    return False


def has_executable_cron(text: str) -> bool:
    return (
        has_qualified_cron_call(text)
        or (has_cron_search_path(text) and has_any_cron_function_call(text))
        or has_direct_cron_job_dml(text)
    )


def config_binding_terminated(text: str, start: int, suffix: str) -> bool:
    """Prove that a config marker is not followed by a folded continuation."""

    position = start
    while position < len(text) and text[position] in " \t":
        position += 1
    if suffix == ".json":
        while position < len(text) and text[position].isspace():
            position += 1
        return position == len(text) or text[position] in ",}]"
    if position == len(text):
        return True
    if text[position] not in "\r\n":
        return False

    while position < len(text):
        if text.startswith("\r\n", position):
            position += 2
        elif text[position] in "\r\n":
            position += 1
        else:
            return False
        line_end = position
        while line_end < len(text) and text[line_end] not in "\r\n":
            line_end += 1
        line = text[position:line_end]
        stripped = line.lstrip(" \t")
        if not stripped or stripped.startswith(("#", ";")):
            position = line_end
            continue
        return not line.startswith((" ", "\t"))
    return True


def scan_text(relative: str, text: str) -> set[tuple[str, str]]:
    findings: set[tuple[str, str]] = set()
    reviewed_view = reviewed_pattern_view(text)
    if BEARER_JWT.search(text) or BEARER_JWT.search(reviewed_view):
        findings.add((relative, "embedded_bearer_jwt"))
    suffix = PurePosixPath(relative).suffix.casefold()
    is_sql = suffix == ".sql"
    if is_sql:
        safe_key_positions = {
            match.start("key_name")
            for match in SAFE_X_CRON_TEMPLATE_SQL.finditer(text)
        }
    else:
        safe_key_positions = {
            match.start("key_name")
            for match in SAFE_X_CRON_TEMPLATE_CONFIG_CANDIDATE.finditer(text)
            if config_binding_terminated(text, match.end(), suffix)
        }
    if is_sql:
        safe_key_positions.update(
            match.start("key_name") for match in SAFE_X_CRON_RUNTIME.finditer(text)
        )
        safe_setting_positions = {
            match.start("setting_name")
            for match in SAFE_CRON_SETTING_READ.finditer(text)
        }
    else:
        safe_setting_positions = set()
    if any(
        match.start() not in safe_setting_positions
        for match in RUNTIME_CRON_SETTING.finditer(text)
    ) or len(RUNTIME_CRON_SETTING.findall(reviewed_view)) > len(
        RUNTIME_CRON_SETTING.findall(text)
    ):
        findings.add((relative, "unsafe_cron_secret_runtime_binding"))
    original_key_matches = tuple(X_CRON_KEY.finditer(text))
    reviewed_key_matches = tuple(X_CRON_KEY.finditer(reviewed_view))
    if any(
        match.start() not in safe_key_positions for match in original_key_matches
    ) or len(reviewed_key_matches) > len(original_key_matches):
        findings.add((relative, "non_placeholder_x_cron_secret"))
    if relative == DERIVED_STAGING_SNAPSHOT:
        if reviewed_key_matches:
            findings.add((relative, "x_cron_secret_in_derived_snapshot"))
        if has_executable_cron(text) or has_executable_cron(reviewed_view):
            findings.add((relative, "executable_cron_in_derived_snapshot"))
        if SUPABASE_ENDPOINT_SHAPE.search(
            reviewed_view
        ) or SUPABASE_PROJECT_REF_BINDING_SHAPE.search(reviewed_view):
            findings.add(
                (relative, "supabase_project_binding_in_derived_snapshot")
            )
    return findings


def main(arguments: list[str]) -> int:
    root = parse_repo_root(arguments)
    if root is None:
        emit({(".", "scan_error")})
        return 2
    try:
        root = root.resolve(strict=True)
    except (OSError, RuntimeError):
        emit({(".", "scan_error")})
        return 2
    top_level = git_top_level(root)
    if top_level is None or top_level != root:
        emit({(".", "scan_error")})
        return 2
    paths = tracked_paths(root)
    if not paths:
        emit({(".", "scan_error")})
        return 2

    findings: set[tuple[str, str]] = set()
    scan_failed = False
    directory_flag = getattr(os, "O_DIRECTORY", 0)
    nofollow = getattr(os, "O_NOFOLLOW", 0)
    close_on_exec = getattr(os, "O_CLOEXEC", 0)
    if not directory_flag or not nofollow:
        emit({(".", "scan_error")})
        return 2
    try:
        root_fd = os.open(
            root,
            os.O_RDONLY | directory_flag | nofollow | close_on_exec,
        )
    except OSError:
        emit({(".", "scan_error")})
        return 2
    try:
        for relative in paths:
            text = read_tracked_artifact(root_fd, relative)
            if text is None:
                findings.add((relative, "scan_error"))
                scan_failed = True
                continue
            findings.update(scan_text(relative, text))
    finally:
        os.close(root_fd)

    emit(findings)
    if scan_failed:
        return 2
    return 1 if findings else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except SystemExit:
        raise
    except BaseException:
        emit({(".", "scan_error")})
        raise SystemExit(2)
