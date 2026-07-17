#!/usr/bin/env python3
"""Validate the immutable Docker Official Image lock without leaking input."""

from __future__ import annotations

import json
import os
import stat
import sys
from pathlib import Path
from typing import Any


MAX_LOCK_BYTES = 4096
FAILURE = "postgres_image_lock_failed:invalid_contract"
EXPECTED = {
    "format_version": 1,
    "platform": "linux/amd64",
    "postgres_17_6": {
        "official_tag": "docker.io/library/postgres:17.6-bookworm",
        "reference": (
            "docker.io/library/postgres@sha256:"
            "f3bd19c606e442c3d7bdfa8002e03fe260a1023351e0ea4598032022b68dd6e3"
        ),
    },
    "postgres_18_4": {
        "official_tag": "docker.io/library/postgres:18.4-bookworm",
        "reference": (
            "docker.io/library/postgres@sha256:"
            "1961f96e6029a02c3812d7cb329a3b03a3ac2bb067058dec17b0f5596aca9296"
        ),
    },
}
RUNTIME_BINDING_ARGUMENT = "--emit-runtime-bindings"


class InvalidLock(Exception):
    """An intentionally detail-free image-lock rejection."""


def reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise InvalidLock
        result[key] = value
    return result


def reject_nonfinite(_value: str) -> None:
    raise InvalidLock


def matches_exact_contract(actual: Any, expected: Any) -> bool:
    """Compare JSON values without Python's bool/int or int/float coercions."""

    if type(actual) is not type(expected):
        return False
    if isinstance(expected, dict):
        return actual.keys() == expected.keys() and all(
            matches_exact_contract(actual[key], value)
            for key, value in expected.items()
        )
    if isinstance(expected, list):
        return len(actual) == len(expected) and all(
            matches_exact_contract(actual_value, expected_value)
            for actual_value, expected_value in zip(actual, expected)
        )
    return bool(actual == expected)


def load_lock(path: Path) -> Any:
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0)
    flags |= getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError as exc:
        raise InvalidLock from exc
    try:
        before = os.fstat(descriptor)
        if (
            not stat.S_ISREG(before.st_mode)
            or before.st_nlink != 1
            or before.st_size <= 0
            or before.st_size > MAX_LOCK_BYTES
        ):
            raise InvalidLock
        raw = os.read(descriptor, MAX_LOCK_BYTES + 1)
        if os.read(descriptor, 1) or len(raw) != before.st_size:
            raise InvalidLock
        after = os.fstat(descriptor)
        identity_before = (
            before.st_dev,
            before.st_ino,
            before.st_mode,
            before.st_nlink,
            before.st_uid,
            before.st_gid,
            before.st_size,
            before.st_mtime_ns,
            before.st_ctime_ns,
        )
        identity_after = (
            after.st_dev,
            after.st_ino,
            after.st_mode,
            after.st_nlink,
            after.st_uid,
            after.st_gid,
            after.st_size,
            after.st_mtime_ns,
            after.st_ctime_ns,
        )
        if identity_before != identity_after:
            raise InvalidLock
        text = raw.decode("ascii", errors="strict")
        return json.loads(
            text,
            object_pairs_hook=reject_duplicate_keys,
            parse_constant=reject_nonfinite,
        )
    except (
        OSError,
        UnicodeError,
        json.JSONDecodeError,
        RecursionError,
        ValueError,
        InvalidLock,
    ) as exc:
        raise InvalidLock from exc
    finally:
        try:
            os.close(descriptor)
        except OSError as exc:
            raise InvalidLock from exc


def main(arguments: list[str]) -> int:
    if len(arguments) not in (1, 2):
        raise InvalidLock
    emit_runtime_bindings = len(arguments) == 2
    if emit_runtime_bindings and arguments[1] != RUNTIME_BINDING_ARGUMENT:
        raise InvalidLock
    lock = load_lock(Path(arguments[0]))
    if not matches_exact_contract(lock, EXPECTED):
        raise InvalidLock
    if emit_runtime_bindings:
        print(lock["platform"])
        print(lock["postgres_17_6"]["reference"])
        print(lock["postgres_18_4"]["reference"])
    return 0


def cli(arguments: list[str]) -> int:
    """Collapse every validator failure to one reviewed diagnostic."""

    try:
        return main(arguments)
    except Exception:
        print(FAILURE, file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(cli(sys.argv[1:]))
