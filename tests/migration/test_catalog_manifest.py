from __future__ import annotations

import hashlib
import importlib.util
import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
TOOL = ROOT / "scripts" / "migration" / "catalog-jsonl-to-manifest.py"
CATALOG_SQL = ROOT / "scripts" / "migration" / "verification" / "catalog-and-counts.sql"

SPEC = importlib.util.spec_from_file_location("catalog_manifest", TOOL)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def fingerprint(value: str) -> str:
    return "sha256:" + hashlib.sha256(value.encode("utf-8")).hexdigest()


def collection_record(
    *,
    boundary_value: str = "10:20:30",
    collected_at: str = "2026-07-14T12:00:00.123456Z",
) -> dict[str, object]:
    return {
        "record_version": 1,
        "record_kind": "collection",
        "component_kind": "collection",
        "key": "database-catalog-snapshot",
        "parent": None,
        "count": None,
        "attributes": {
            "boundary_kind": "database_read_only_transaction",
            "boundary_value": boundary_value,
            "collected_at": collected_at,
            "isolation_level": "repeatable read",
            "read_only": True,
        },
    }


def record(
    component_kind: str,
    key: str,
    *,
    record_kind: str = "component",
    parent: str | None = None,
    count: int | None = None,
    attributes: dict[str, object] | None = None,
) -> dict[str, object]:
    return {
        "record_version": 1,
        "record_kind": record_kind,
        "component_kind": component_kind,
        "key": key,
        "parent": parent,
        "count": count,
        "attributes": attributes if attributes is not None else {},
    }


def relation_attributes(component_kind: str) -> dict[str, object]:
    relation_kind = {
        "table": "ordinary_table",
        "view": "view",
        "materialized_view": "materialized_view",
        "sequence": "sequence",
        "foreign_table": "foreign_table",
    }[component_kind]
    is_sequence = component_kind == "sequence"
    is_view = component_kind in {"view", "materialized_view"}
    is_foreign = component_kind == "foreign_table"
    return {
        "relation_kind": relation_kind,
        "owner": "postgres",
        "acl": None,
        "persistence": "permanent",
        "row_security": False,
        "force_row_security": False,
        "replica_identity": "default",
        "replica_identity_index": None,
        "is_partition": False,
        "partition_bound_fingerprint": None,
        "partition_key_fingerprint": None,
        "access_method": None,
        "options_fingerprints": None,
        "view_definition_fingerprint": fingerprint("view") if is_view else None,
        "sequence_start": -10 if is_sequence else None,
        "sequence_increment": 1 if is_sequence else None,
        "sequence_min": -10 if is_sequence else None,
        "sequence_max": 10 if is_sequence else None,
        "sequence_cache": 1 if is_sequence else None,
        "sequence_cycle": False if is_sequence else None,
        "sequence_last_value": -7 if is_sequence else None,
        "sequence_owned_by": None,
        "foreign_server": "fixture_server" if is_foreign else None,
        "foreign_options_fingerprints": [] if is_foreign else None,
    }


def database_attributes() -> dict[str, object]:
    return {
        "server_version": "17.5",
        "server_version_num": 170005,
        "owner": "postgres",
        "acl": None,
        "encoding": "UTF8",
        "collation": "C.UTF-8",
        "character_type": "C.UTF-8",
        "locale_provider": "c",
        "locale": None,
        "icu_rules": None,
        "collation_version": None,
        "connection_limit": -1,
        "is_template": False,
        "allow_connections": True,
        "has_login_event_triggers": False,
    }


def column_attributes() -> dict[str, object]:
    return {
        "ordinal": 1,
        "type": "integer",
        "type_schema": "pg_catalog",
        "type_name": "int4",
        "nullable": False,
        "default_fingerprint": None,
        "generated": "none",
        "identity": "always",
        "collation": None,
        "acl": None,
    }


class CatalogManifestConverterTest(unittest.TestCase):
    def run_tool(
        self,
        records: list[dict[str, object]] | None,
        *,
        raw: bytes | None = None,
        evidence_kind: str = "database_catalog",
        role: str = "source",
        project_ref: str = "abcdefghijklmnopqrst",
        artifact_source: str = "captured-catalog-jsonl",
        extra_args: list[str] | None = None,
    ):
        temporary = tempfile.TemporaryDirectory(prefix="catalog converter paths with spaces ")
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        input_path = root / "captured catalog output.jsonl"
        output_path = root / "source manifest.json"
        if raw is None:
            assert records is not None
            raw = ("\n".join(json.dumps(item, sort_keys=True) for item in records) + "\n").encode()
        input_path.write_bytes(raw)
        command = [
            sys.executable,
            str(TOOL),
            str(input_path),
            "--output",
            str(output_path),
            "--label",
            "captured catalog",
            "--role",
            role,
            "--project-ref",
            project_ref,
            "--artifact-source",
            artifact_source,
            "--evidence-kind",
            evidence_kind,
        ]
        if extra_args:
            command.extend(extra_args)
        result = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
        )
        return result, output_path, raw

    @staticmethod
    def valid_records() -> list[dict[str, object]]:
        return [
            collection_record(),
            record("database", "postgresql-server", attributes=database_attributes()),
            record(
                "schema",
                "fixture",
                attributes={"owner": "postgres", "acl": None},
            ),
            record(
                "table",
                "fixture.items",
                parent="fixture",
                attributes=relation_attributes("table"),
            ),
            record(
                "column",
                "fixture.items.id",
                parent="fixture.items",
                attributes=column_attributes(),
            ),
            record(
                "table",
                "fixture.items",
                record_kind="count",
                parent="fixture",
                count=2,
            ),
        ]

    def test_converts_same_bytes_and_database_collection_provenance(self):
        result, output_path, raw = self.run_tool(self.valid_records())
        self.assertEqual(result.returncode, 0, result.stderr)
        manifest = json.loads(output_path.read_text(encoding="utf-8"))
        self.assertEqual(manifest["format_version"], 2)
        self.assertEqual(manifest["role"], "source")
        self.assertEqual(
            manifest["collection"]["boundary"],
            {"kind": "database_read_only_transaction", "value": "10:20:30"},
        )
        self.assertEqual(
            manifest["collection"]["collected_at"],
            "2026-07-14T12:00:00.123456Z",
        )
        self.assertEqual(manifest["collection"]["collector"]["version"], "3.0.0")
        self.assertEqual(
            manifest["collection"]["artifact"]["sha256"],
            "sha256:" + hashlib.sha256(raw).hexdigest(),
        )
        by_identity = {
            f"{item['kind']}:{item['key']}": item for item in manifest["components"]
        }
        self.assertEqual(by_identity["table:fixture.items"]["count"], 2)
        self.assertFalse(by_identity["table:fixture.items"]["independently_verifiable"])
        for item in manifest["components"]:
            self.assertRegex(item["evidence"]["fingerprint"], r"^sha256:[0-9a-f]{64}$")
            self.assertIsNone(item["evidence"]["closure"])

    def test_typed_length_framing_prevents_separator_and_type_ambiguity(self):
        left = MODULE.typed_frame({"values": ["a|b", "c"]})
        right = MODULE.typed_frame({"values": ["a", "b|c"]})
        typed = MODULE.typed_frame({"value": 1})
        textual = MODULE.typed_frame({"value": "1"})
        negative = MODULE.typed_frame({"value": -1})
        self.assertNotEqual(left, right)
        self.assertNotEqual(typed, textual)
        self.assertNotEqual(typed, negative)

    def test_attribution_is_derived_and_cannot_be_overridden(self):
        real_source, real_path, _ = self.run_tool(self.valid_records())
        self.assertEqual(real_source.returncode, 0, real_source.stderr)
        self.assertTrue(
            all(
                not item["independently_verifiable"]
                for item in json.loads(real_path.read_text())["components"]
            )
        )

        synthetic, synthetic_path, _ = self.run_tool(
            self.valid_records(), project_ref="synthetic-catalog-source"
        )
        self.assertEqual(synthetic.returncode, 0, synthetic.stderr)
        self.assertTrue(
            all(
                item["independently_verifiable"]
                for item in json.loads(synthetic_path.read_text())["components"]
            )
        )

        target, target_path, _ = self.run_tool(
            self.valid_records(), role="target", project_ref="bcdefghijklmnopqrstu"
        )
        self.assertEqual(target.returncode, 0, target.stderr)
        self.assertTrue(
            all(
                item["independently_verifiable"]
                for item in json.loads(target_path.read_text())["components"]
            )
        )

        override, output_path, _ = self.run_tool(
            self.valid_records(), extra_args=["--independently-verifiable", "true"]
        )
        self.assertEqual(override.returncode, 2)
        self.assertIn("unrecognized arguments", override.stderr)
        self.assertFalse(output_path.exists())

    def test_service_inventory_uses_kind_specific_evidence(self):
        values = [
            collection_record(),
            record(
                "auth",
                "auth.users",
                parent="auth",
                count=7,
                attributes={"entity": "users"},
            ),
        ]
        result, output_path, _ = self.run_tool(values, evidence_kind="service_inventory")
        self.assertEqual(result.returncode, 0, result.stderr)
        manifest = json.loads(output_path.read_text(encoding="utf-8"))
        self.assertEqual(
            manifest["collection"]["artifact"]["kind"],
            "service_inventory_output",
        )
        self.assertEqual(manifest["components"][0]["evidence"]["kind"], "service_inventory")

    def test_kind_insufficient_sql_evidence_fails_closed(self):
        result, output_path, _ = self.run_tool(
            [
                collection_record(),
                record("auth", "auth.users", count=1, attributes={"entity": "users"}),
            ],
            evidence_kind="database_catalog",
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("insufficient for component", result.stderr)
        self.assertFalse(output_path.exists())

    def test_missing_or_duplicate_collection_fails_closed(self):
        missing = self.valid_records()[1:]
        result, output_path, _ = self.run_tool(missing)
        self.assertEqual(result.returncode, 1)
        self.assertIn("exactly one collection record; found 0", result.stderr)
        self.assertFalse(output_path.exists())

        duplicate = [collection_record(), *self.valid_records()]
        result, output_path, _ = self.run_tool(duplicate)
        self.assertEqual(result.returncode, 1)
        self.assertIn("exactly one collection record; found 2", result.stderr)
        self.assertFalse(output_path.exists())

    def test_malformed_collection_envelope_and_attributes_fail_closed(self):
        cases: list[tuple[str, object]] = [
            ("component_kind", "schema"),
            ("key", "different-snapshot"),
            ("parent", "fixture"),
            ("count", 1),
        ]
        for field, bad_value in cases:
            with self.subTest(field=field):
                values = self.valid_records()
                values[0][field] = bad_value
                result, output_path, _ = self.run_tool(values)
                self.assertEqual(result.returncode, 1)
                self.assertFalse(output_path.exists())

        attribute_cases: list[tuple[str, object]] = [
            ("boundary_kind", "transaction_snapshot"),
            ("boundary_value", ""),
            ("collected_at", "2026-07-14 12:00:00"),
            ("isolation_level", "read committed"),
            ("read_only", False),
        ]
        for field, bad_value in attribute_cases:
            with self.subTest(attribute=field):
                values = self.valid_records()
                attributes = values[0]["attributes"]
                assert isinstance(attributes, dict)
                attributes[field] = bad_value
                result, output_path, _ = self.run_tool(values)
                self.assertEqual(result.returncode, 1)
                self.assertFalse(output_path.exists())

    def test_incomplete_unknown_and_wrong_typed_kind_evidence_fails_closed(self):
        for mutation, expected in (
            ("missing", "missing field(s) for database"),
            ("unknown", "unknown field(s) for database"),
            ("wrong_type", "expected signed integer"),
        ):
            with self.subTest(mutation=mutation):
                values = self.valid_records()
                attributes = values[1]["attributes"]
                assert isinstance(attributes, dict)
                if mutation == "missing":
                    del attributes["owner"]
                elif mutation == "unknown":
                    attributes["silently_ignored"] = "value"
                else:
                    attributes["server_version_num"] = "170005"
                result, output_path, _ = self.run_tool(values)
                self.assertEqual(result.returncode, 1)
                self.assertIn(expected, result.stderr)
                self.assertFalse(output_path.exists())

    def test_signed_sequence_values_are_valid_kind_complete_evidence(self):
        values = self.valid_records()
        values.insert(
            -1,
            record(
                "sequence",
                "fixture.items_id_seq",
                parent="fixture",
                attributes=relation_attributes("sequence"),
            ),
        )
        result, output_path, _ = self.run_tool(values)
        self.assertEqual(result.returncode, 0, result.stderr)
        manifest = json.loads(output_path.read_text())
        self.assertIn("sequence", {item["kind"] for item in manifest["components"]})

    def test_placeholder_internal_fingerprint_fails_closed(self):
        values = self.valid_records()
        attributes = values[4]["attributes"]
        assert isinstance(attributes, dict)
        attributes["default_fingerprint"] = "sha256:" + "0" * 64
        result, output_path, _ = self.run_tool(values)
        self.assertEqual(result.returncode, 1)
        self.assertIn("placeholder or low-entropy fingerprint", result.stderr)
        self.assertFalse(output_path.exists())

    def test_missing_table_count_fails_closed(self):
        values = [item for item in self.valid_records() if item["record_kind"] != "count"]
        result, output_path, _ = self.run_tool(values)
        self.assertEqual(result.returncode, 1)
        self.assertIn("missing required exact count", result.stderr)
        self.assertFalse(output_path.exists())

    def test_orphan_count_fails_closed(self):
        values = self.valid_records()
        values[-1] = record(
            "table",
            "fixture.missing",
            record_kind="count",
            parent="fixture",
            count=2,
        )
        result, output_path, _ = self.run_tool(values)
        self.assertEqual(result.returncode, 1)
        self.assertIn("orphan count overlay", result.stderr)
        self.assertFalse(output_path.exists())

    def test_unknown_record_class_and_top_level_field_fail_closed(self):
        values = self.valid_records()
        values[1]["component_kind"] = "mystery"
        result, output_path, _ = self.run_tool(values)
        self.assertEqual(result.returncode, 1)
        self.assertIn("unsupported 'mystery'", result.stderr)
        self.assertFalse(output_path.exists())

        values = self.valid_records()
        values[1]["silently_ignored"] = True
        result, output_path, _ = self.run_tool(values)
        self.assertEqual(result.returncode, 1)
        self.assertIn("unknown field", result.stderr)
        self.assertFalse(output_path.exists())

    def test_duplicate_json_keys_at_any_depth_fail_closed(self):
        raw = (
            '{"record_version":1,"record_kind":"collection",'
            '"component_kind":"collection","key":"database-catalog-snapshot",'
            '"parent":null,"count":null,"attributes":{'
            '"boundary_kind":"database_read_only_transaction",'
            '"boundary_value":"10:20:30",'
            '"collected_at":"2026-07-14T12:00:00Z",'
            '"isolation_level":"repeatable read",'
            '"read_only":true,"read_only":true}}\n'
        ).encode()
        result, output_path, _ = self.run_tool(None, raw=raw)
        self.assertEqual(result.returncode, 1)
        self.assertIn("duplicate JSON object key", result.stderr)
        self.assertFalse(output_path.exists())

    def test_float_and_non_json_output_fail_closed(self):
        values = self.valid_records()
        attributes = values[1]["attributes"]
        assert isinstance(attributes, dict)
        attributes["server_version_num"] = 1.5
        result, output_path, _ = self.run_tool(values)
        self.assertEqual(result.returncode, 1)
        self.assertIn("floating-point", result.stderr)
        self.assertFalse(output_path.exists())

        empty, output_path, _ = self.run_tool(None, raw=b"")
        self.assertEqual(empty.returncode, 1)
        self.assertIn("empty catalog artifact", empty.stderr)
        self.assertFalse(output_path.exists())
        non_json, output_path, _ = self.run_tool(None, raw=b"BEGIN\n")
        self.assertEqual(non_json.returncode, 1)
        self.assertIn("not JSON", non_json.stderr)
        self.assertFalse(output_path.exists())

    def test_generated_manifest_must_pass_strict_provenance_validation(self):
        for kwargs, expected in (
            ({"project_ref": "not-a-project-ref"}, "project_ref"),
            ({"artifact_source": "placeholder-output"}, "placeholder value"),
        ):
            with self.subTest(kwargs=kwargs):
                result, output_path, _ = self.run_tool(self.valid_records(), **kwargs)
                self.assertEqual(result.returncode, 1)
                self.assertIn("generated manifest failed strict validation", result.stderr)
                self.assertIn(expected, result.stderr)
                self.assertFalse(output_path.exists())

    def test_output_refusal_and_concurrent_creation_never_clobber(self):
        result, output_path, _ = self.run_tool(self.valid_records())
        self.assertEqual(result.returncode, 0, result.stderr)
        original = output_path.read_bytes()

        # A normal pre-existing destination is refused by the CLI.
        input_path = output_path.parent / "second input.jsonl"
        input_path.write_text(
            "\n".join(json.dumps(item, sort_keys=True) for item in self.valid_records())
            + "\n"
        )
        refused = subprocess.run(
            [
                sys.executable,
                str(TOOL),
                str(input_path),
                "--output",
                str(output_path),
                "--label",
                "captured catalog",
                "--role",
                "source",
                "--project-ref",
                "abcdefghijklmnopqrst",
                "--artifact-source",
                "captured-catalog-jsonl",
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(refused.returncode, 1)
        self.assertIn("refusing to overwrite output", refused.stderr)
        self.assertEqual(output_path.read_bytes(), original)

        # Simulate a creator winning the race between the CLI precheck and the
        # atomic publish. The converter must surface EEXIST and preserve bytes.
        raced_output = output_path.parent / "raced manifest.json"
        concurrent_bytes = b"concurrent-winner\n"

        def win_race(_source: object, destination: object) -> None:
            Path(destination).write_bytes(concurrent_bytes)
            raise FileExistsError("destination exists")

        with mock.patch.object(MODULE.os, "link", side_effect=win_race):
            with self.assertRaisesRegex(
                MODULE.CatalogConversionError, "refusing to overwrite output"
            ):
                MODULE._write_validated_manifest(
                    raced_output, original.decode("utf-8")
                )
        self.assertEqual(raced_output.read_bytes(), concurrent_bytes)
        self.assertEqual(
            list(raced_output.parent.glob(f".{raced_output.name}.*.tmp")), []
        )

    def test_catalog_sql_has_read_only_snapshot_and_no_pk_value_collection(self):
        sql = CATALOG_SQL.read_text(encoding="utf-8")
        self.assertIn("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY", sql)
        self.assertIn("pg_catalog.pg_current_snapshot()", sql)
        self.assertIn("'record_kind', 'collection'", sql)
        for forbidden in ("primary_key_range", "minimum_value", "maximum_value"):
            self.assertNotIn(forbidden, sql)
        self.assertNotRegex(sql, re.compile(r"ORDER\s+BY\s+%I\s+(?:ASC|DESC)", re.I))


if __name__ == "__main__":
    unittest.main()
