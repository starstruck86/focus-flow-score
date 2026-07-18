from __future__ import annotations

import json
import os
import stat
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts" / "migration"))

from lib import lovable_toc_contract as contract  # noqa: E402


SHA_A = "a" * 64
SHA_B = "b" * 64
SHA_C = "c" * 64
GIT_A = "a" * 40
GIT_B = "b" * 40


def raw_toc(classes: list[str]) -> bytes:
    lines = [
        b"; Archive created at synthetic time",
        b"; Dumped from database version: 17.6",
        b"; Dumped by pg_dump version: 18.4",
    ]
    for index, object_class in enumerate(classes, 1):
        name = f'"synthetic name {index}"'.encode()
        lines.append(f"{index}; 0 {1000 + index} {object_class} ".encode() + name + b" owner")
    return b"\n".join(lines) + b"\n"


def capture_binding() -> dict[str, str]:
    return {
        "evidence_manifest_sha256": SHA_A,
        "evidence_run_id": "synthetic-run",
        "execution_checkout_sha": GIT_A,
        "inner_archive_sha256": SHA_B,
        "inspection_checkout_sha": GIT_B,
        "inspection_procedure_sha256": SHA_C,
        "outer_archive_sha256": "d" * 64,
        "procedure_identity_sha256": "e" * 64,
    }


def pg_identity() -> dict[str, object]:
    return {
        "approved_identity": f"sha256:{SHA_A}",
        "device": 1,
        "executable_path": "/synthetic/pg_restore",
        "gid": 1,
        "inode": 2,
        "mode": "0755",
        "reported_version": "pg_restore (PostgreSQL) 18.4",
        "sha256": SHA_A,
        "size_bytes": 123,
        "uid": 1,
    }


def execution_python_identity() -> dict[str, object]:
    return {
        "approved_identity": f"sha256:{SHA_B}",
        "device": 3,
        "executable_path": "/synthetic/python3",
        "gid": 1,
        "inode": 4,
        "mode": "0755",
        "reported_version": "cpython:3.12.9",
        "sha256": SHA_B,
        "size_bytes": 456,
        "uid": 1,
    }


def procedure_identity() -> dict[str, str]:
    return {
        "execution_checkout_sha": GIT_A,
        "execution_python_approved_sha256": SHA_B,
        "execution_python_identity_sha256": contract.sha256_bytes(
            contract.canonical_json_bytes(execution_python_identity())
        ),
        "README_md_blob_sha": GIT_B,
        "README_md_sha256": SHA_A,
        "run_lovable_toc_capture_sh_blob_sha": GIT_B,
        "run_lovable_toc_capture_sh_sha256": SHA_A,
        "capture_lovable_toc_envelope_py_blob_sha": GIT_B,
        "capture_lovable_toc_envelope_py_sha256": SHA_A,
        "capture_lovable_toc_py_blob_sha": GIT_B,
        "capture_lovable_toc_py_sha256": SHA_A,
        "bounded_pg_restore_py_blob_sha": GIT_B,
        "bounded_pg_restore_py_sha256": SHA_A,
        "inspect_lovable_export_py_blob_sha": GIT_B,
        "inspect_lovable_export_py_sha256": SHA_A,
        "lovable_toc_contract_py_blob_sha": GIT_B,
        "lovable_toc_contract_py_sha256": SHA_A,
        "lovable_dump_report_py_blob_sha": GIT_B,
        "lovable_dump_report_py_sha256": SHA_A,
        "normalize_lovable_export_py_blob_sha": GIT_B,
        "normalize_lovable_export_py_sha256": SHA_A,
        "evidence_manifest_sha256": SHA_A,
        "inspection_checkout_sha": GIT_B,
        "inspection_procedure_sha256": SHA_C,
    }


def capture_for(classes: list[str]):
    raw = raw_toc(classes)
    binding = capture_binding()
    binding["procedure_identity_sha256"] = contract.sha256_bytes(
        contract.canonical_json_bytes(procedure_identity())
    )
    files, entries, capture = contract.build_capture_payloads(
        raw_toc=raw,
        key=b"k" * 32,
        binding=binding,
        execution_python_identity=execution_python_identity(),
        pg_restore_identity=pg_identity(),
        procedure_identity=procedure_identity(),
        expected_entry_count=len(classes),
        expected_data_reference_count=sum(
            object_class in contract.DATA_TOC_CLASSES for object_class in classes
        ),
    )
    return raw, files, entries, capture


def base_ledger(entries, capture, manifest_sha=SHA_A):
    annotations = []
    metadata_parent = next(
        (entry.entry_id for entry in entries if not entry.is_data_reference), None
    )
    for entry in entries:
        annotations.append(
            {
                "classification": "restore",
                "dependency_entry_ids": [],
                "dependency_review_complete": True,
                "entry_id": entry.entry_id,
                "managed_domain": "none",
                "manual_conflict_disposition": None,
                "metadata_parent_entry_id": metadata_parent
                if entry.object_class in contract.METADATA_PARENT_REQUIRED_CLASSES
                else None,
                "parent_entry_ids": [],
            }
        )
    binding = capture["binding"]
    return {
        "annotations": annotations,
        "artifact_kind": "lovable_toc_annotation_ledger",
        "capture_binding": {
            "capture_manifest_sha256": manifest_sha,
            "evidence_manifest_sha256": binding["evidence_manifest_sha256"],
            "evidence_run_id": binding["evidence_run_id"],
            "execution_checkout_sha": binding["execution_checkout_sha"],
            "inner_archive_sha256": binding["inner_archive_sha256"],
            "inspection_checkout_sha": binding["inspection_checkout_sha"],
            "inspection_procedure_sha256": binding["inspection_procedure_sha256"],
            "outer_archive_sha256": binding["outer_archive_sha256"],
            "pg_restore_identity_sha256": contract.sha256_bytes(
                contract.canonical_json_bytes(capture["pg_restore_identity"])
            ),
            "procedure_identity_sha256": binding["procedure_identity_sha256"],
            "raw_toc_sha256": capture["raw_toc_sha256"],
            "raw_toc_size_bytes": capture["raw_toc_size_bytes"],
        },
        "format_version": 1,
        "global_handling": {
            "extension": "target_supported_only",
            "owner": "strip_and_rebind",
            "role": "exclude_source_roles",
            "schema": "selective_restore",
        },
        "managed_domain_handling": {
            domain: "not_present" for domain in contract.MANAGED_DOMAINS
        },
    }


class RawTocContractTest(unittest.TestCase):
    def test_exact_unresolved_classes_are_recognized_without_name_parsing(self):
        classes = [
            "POLICY",
            "CONSTRAINT",
            "FK CONSTRAINT",
            "ROW SECURITY",
            "TRIGGER",
            "INDEX ATTACH",
            "PUBLICATION TABLE",
            "TABLE ATTACH",
            "CHECK CONSTRAINT",
            "DEFAULT",
            "SEQUENCE OWNED BY",
        ]
        fixture = (
            ROOT
            / "scripts"
            / "migration"
            / "tests"
            / "fixtures"
            / "toc-review-unresolved-classes.toc"
        ).read_bytes()
        entries = contract.parse_raw_toc(fixture, b"x" * 32)
        self.assertEqual([entry.object_class for entry in entries], classes)

    def test_ambiguous_quoted_punctuation_unicode_and_whitespace_stay_opaque(self):
        raw = (
            b'; header\n'
            b'1;\t0 0 POLICY\t"ambiguous name !?" owner\n'
            + '2; 0 0 TABLE public "snowman-\u2603" owner\n'.encode()
        )
        entries = contract.parse_raw_toc(raw, b"x" * 32)
        self.assertEqual([entry.object_class for entry in entries], ["POLICY", "TABLE"])
        self.assertNotIn("snowman", " ".join(entry.entry_id for entry in entries))

    def test_control_character_is_fatal(self):
        for value in (
            b"1; 0 0 TABLE bad\x01name owner\n",
            b"; poisoned\x01comment\n1; 0 0 TABLE safe owner\n",
            b"1; 0 0 TABLE carriage owner\r\n",
        ):
            with self.subTest(), self.assertRaisesRegex(
                contract.ContractError, "toc_malformed"
            ):
                contract.parse_raw_toc(value, b"x" * 32)

    def test_malformed_utf8_is_fatal(self):
        with self.assertRaisesRegex(contract.ContractError, "toc_malformed"):
            contract.parse_raw_toc(b"1; 0 0 TABLE bad\xff owner\n", b"x" * 32)

    def test_unknown_class_is_fatal(self):
        with self.assertRaisesRegex(contract.ContractError, "toc_unknown_class"):
            contract.parse_raw_toc(b"1; 0 0 FUTURE CLASS name owner\n", b"x" * 32)

    def test_missing_id_and_oversized_raw_input_are_fatal(self):
        with self.assertRaisesRegex(contract.ContractError, "toc_malformed"):
            contract.parse_raw_toc(b"; header\nTABLE missing numeric identity\n", b"x" * 32)
        with mock.patch.object(contract, "MAX_RAW_TOC_BYTES", 8):
            with self.assertRaisesRegex(contract.ContractError, "input_invalid"):
                contract.parse_raw_toc(b"123456789", b"x" * 32)

    def test_duplicate_numeric_id_is_fatal(self):
        with self.assertRaisesRegex(contract.ContractError, "toc_duplicate_id"):
            contract.parse_raw_toc(
                b"1; 0 0 TABLE one owner\n1; 0 0 TABLE two owner\n", b"x" * 32
            )

    def test_per_capture_hmac_ids_are_deterministic_but_unlinkable(self):
        raw = b"1; 0 0 TABLE common owner\n"
        first = contract.parse_raw_toc(raw, b"a" * 32)[0].entry_id
        same = contract.parse_raw_toc(raw, b"a" * 32)[0].entry_id
        other = contract.parse_raw_toc(raw, b"b" * 32)[0].entry_id
        self.assertEqual(first, same)
        self.assertNotEqual(first, other)
        self.assertRegex(first, contract.OPAQUE_ID_RE)

    def test_declared_counts_are_external_bindings(self):
        binding = capture_binding()
        binding["procedure_identity_sha256"] = contract.sha256_bytes(
            contract.canonical_json_bytes(procedure_identity())
        )
        with self.assertRaisesRegex(contract.ContractError, "binding_mismatch"):
            contract.build_capture_payloads(
                raw_toc=raw_toc(["TABLE", "TABLE DATA"]),
                key=b"x" * 32,
                binding=binding,
                execution_python_identity=execution_python_identity(),
                pg_restore_identity=pg_identity(),
                procedure_identity=procedure_identity(),
                expected_entry_count=3,
                expected_data_reference_count=1,
            )

    def test_capture_persists_and_validates_exact_procedure_identity(self):
        _, _, _, capture = capture_for(["TABLE"])
        self.assertEqual(
            contract.validate_capture_schema(capture)["procedure_identity"],
            procedure_identity(),
        )
        changed = json.loads(contract.canonical_json_bytes(capture))
        changed["procedure_identity"]["README_md_sha256"] = "f" * 64
        with self.assertRaisesRegex(contract.ContractError, "binding_mismatch"):
            contract.validate_capture_schema(changed)

    def test_capture_persists_review_required_and_both_restore_blocks(self):
        _, _, _, capture = capture_for(["TABLE"])
        self.assertEqual(capture["overall_status"], "REVIEW_REQUIRED")
        self.assertEqual(capture["review_gate"], "ANNOTATION_REQUIRED")
        self.assertEqual(capture["restore_planning_gate"], "BLOCKED")
        self.assertEqual(capture["restore_command_gate"], "BLOCKED")
        for field in (
            "overall_status",
            "review_gate",
            "restore_planning_gate",
            "restore_command_gate",
        ):
            changed = json.loads(contract.canonical_json_bytes(capture))
            changed[field] = "READY"
            with self.subTest(field=field), self.assertRaisesRegex(
                contract.ContractError, "binding_mismatch"
            ):
                contract.validate_capture_schema(changed)


class StrictJsonTest(unittest.TestCase):
    def test_checked_in_schema_is_json_and_matches_closed_vocabularies(self):
        schema_path = (
            ROOT
            / "scripts"
            / "migration"
            / "verification"
            / "lovable-toc-annotation-ledger.schema.json"
        )
        schema = contract.strict_json_loads(schema_path.read_bytes())
        fixed_objects = (
            schema,
            schema["properties"]["capture_binding"],
            schema["properties"]["annotations"]["items"],
            schema["properties"]["global_handling"],
            schema["properties"]["managed_domain_handling"],
        )
        for fixed in fixed_objects:
            self.assertFalse(fixed["additionalProperties"])
            self.assertEqual(set(fixed["required"]), set(fixed["properties"]))
        self.assertEqual(
            set(
                schema["properties"]["annotations"]["items"]["properties"][
                    "classification"
                ]["enum"]
            ),
            contract.CLASSIFICATIONS,
        )
        self.assertEqual(
            set(schema["properties"]["managed_domain_handling"]["required"]),
            set(contract.MANAGED_DOMAINS),
        )

    def test_duplicate_keys_at_any_depth_fail(self):
        for value in (
            b'{"a":1,"a":2}',
            b'{"a":{"b":1,"b":2}}',
        ):
            with self.subTest(value=value), self.assertRaisesRegex(
                contract.ContractError, "ledger_schema_invalid"
            ):
                contract.strict_json_loads(value)

    def test_nonfinite_malformed_utf8_and_oversized_fail(self):
        values = (b'{"a":NaN}', b'{"a":Infinity}', b'{"a":"\xff"}', b" " * (contract.MAX_LEDGER_BYTES + 1))
        for value in values:
            with self.subTest(size=len(value)), self.assertRaisesRegex(
                contract.ContractError, "ledger_schema_invalid"
            ):
                contract.strict_json_loads(value)


class LedgerContractTest(unittest.TestCase):
    def setUp(self):
        _, _, self.entries, self.capture = capture_for(
            ["TABLE", "TABLE DATA", "EXTENSION", "SCHEMA", "ACL", "COMMENT"]
        )

    def validate(self, ledger):
        return contract.validate_ledger(
            ledger,
            capture=self.capture,
            entries=self.entries,
            capture_manifest_sha256=SHA_A,
        )

    def test_complete_resolved_classifications_are_only_human_review_eligible(self):
        ledger = base_ledger(self.entries, self.capture)
        annotations = ledger["annotations"]
        annotations[0]["classification"] = "restore"
        annotations[1]["classification"] = "restore"
        annotations[2]["classification"] = "exclude_supabase_managed"
        annotations[2]["managed_domain"] = "extension_owned"
        ledger["managed_domain_handling"]["extension_owned"] = "exclude_supabase_managed"
        annotations[3]["classification"] = "dependency_only"
        annotations[4]["classification"] = "manual_conflict"
        annotations[4]["manual_conflict_disposition"] = "exclude_duplicate"
        annotations[5]["classification"] = "restore"
        annotations[5]["dependency_entry_ids"] = [annotations[3]["entry_id"]]
        result = self.validate(ledger)
        self.assertEqual(result["restore_planning_gate"], "ELIGIBLE_FOR_HUMAN_REVIEW")
        self.assertEqual(result["restore_command_gate"], "BLOCKED")
        self.assertEqual(result["migration_readiness"], "RED")
        self.assertEqual(result["annotation_accounting_status"], "COMPLETE")
        self.assertEqual(result["object_reference_analysis"], "INCOMPLETE")
        self.assertEqual(set(result["classification_counts"]), contract.CLASSIFICATIONS)

    def test_unresolved_publishes_only_blocked_incomplete_analysis(self):
        ledger = base_ledger(self.entries, self.capture)
        # Keep the TABLE/TABLE DATA parent pair disposition-compatible and put
        # the unresolved review state on an independent metadata entry.
        ledger["annotations"][5]["classification"] = "unresolved"
        result = self.validate(ledger)
        self.assertEqual(result["unresolved_count"], 1)
        self.assertEqual(result["object_reference_analysis"], "INCOMPLETE")
        self.assertEqual(result["restore_planning_gate"], "BLOCKED")

    def test_missing_extra_and_conflicting_duplicate_entries_fail(self):
        missing = base_ledger(self.entries, self.capture)
        missing["annotations"].pop()
        extra = base_ledger(self.entries, self.capture)
        extra["annotations"].append({**extra["annotations"][0], "entry_id": "te1_" + "f" * 64})
        duplicate = base_ledger(self.entries, self.capture)
        duplicate["annotations"].append(dict(duplicate["annotations"][0]))
        conflicting_duplicate = base_ledger(self.entries, self.capture)
        conflicting_duplicate["annotations"].append(
            {
                **conflicting_duplicate["annotations"][0],
                "classification": "unresolved",
            }
        )
        for ledger in (missing, extra, duplicate, conflicting_duplicate):
            with self.subTest(), self.assertRaisesRegex(
                contract.ContractError, "entry_set_mismatch"
            ):
                self.validate(ledger)

    def test_publication_classes_require_explicit_publication_handling(self):
        cases = (
            ("PUBLICATION", ()),
            ("PUBLICATION TABLE", ("PUBLICATION", "TABLE")),
            ("PUBLICATION TABLES IN SCHEMA", ("PUBLICATION", "SCHEMA")),
        )
        for object_class, parent_classes in cases:
            with self.subTest(object_class=object_class):
                classes = [object_class, *parent_classes]
                _, _, entries, capture = capture_for(classes)
                default_ledger = base_ledger(entries, capture)
                with self.assertRaisesRegex(
                    contract.ContractError, "managed_domain_invalid"
                ):
                    contract.validate_ledger(
                        default_ledger,
                        capture=capture,
                        entries=entries,
                        capture_manifest_sha256=SHA_A,
                    )

                reviewed = base_ledger(entries, capture)
                for entry, annotation in zip(entries, reviewed["annotations"]):
                    if entry.object_class in contract.CLASS_MANAGED_DOMAINS:
                        annotation["classification"] = "manual_conflict"
                        annotation["managed_domain"] = "publication"
                        annotation["manual_conflict_disposition"] = "restore"
                reviewed["managed_domain_handling"]["publication"] = "restore"
                if parent_classes:
                    reviewed["annotations"][0]["parent_entry_ids"] = [
                        annotation["entry_id"]
                        for annotation in reviewed["annotations"][1:]
                    ]
                result = contract.validate_ledger(
                    reviewed,
                    capture=capture,
                    entries=entries,
                    capture_manifest_sha256=SHA_A,
                )
                self.assertEqual(
                    result["restore_planning_gate"],
                    "ELIGIBLE_FOR_HUMAN_REVIEW",
                )

        _, _, entries, capture = capture_for(["PUBLICATION"])
        partial = base_ledger(entries, capture)
        partial["annotations"][0]["classification"] = "unresolved"
        partial["annotations"][0]["managed_domain"] = "publication"
        partial["managed_domain_handling"]["publication"] = "manual_conflict"
        result = contract.validate_ledger(
            partial,
            capture=capture,
            entries=entries,
            capture_manifest_sha256=SHA_A,
        )
        self.assertEqual(result["unresolved_count"], 1)
        self.assertEqual(result["restore_planning_gate"], "BLOCKED")

    def test_relationship_bearing_classes_cannot_attest_an_empty_graph(self):
        for object_class in sorted(contract.RELATIONSHIP_REQUIRED_CLASSES):
            with self.subTest(object_class=object_class):
                parent_classes = [
                    sorted(group)[0]
                    for group in contract.RELATIONSHIP_PARENT_GROUPS[object_class]
                ]
                _, _, entries, capture = capture_for(
                    [object_class, *parent_classes]
                )
                ledger = base_ledger(entries, capture)
                for entry, annotation in zip(entries, ledger["annotations"]):
                    if entry.object_class in contract.CLASS_MANAGED_DOMAINS:
                        annotation["classification"] = "exclude_supabase_managed"
                        annotation["managed_domain"] = "publication"
                        ledger["managed_domain_handling"][
                            "publication"
                        ] = "exclude_supabase_managed"
                with self.assertRaisesRegex(
                    contract.ContractError, "dependency_invalid"
                ):
                    contract.validate_ledger(
                        ledger,
                        capture=capture,
                        entries=entries,
                        capture_manifest_sha256=SHA_A,
                    )
                ledger["annotations"][0]["parent_entry_ids"] = [
                    annotation["entry_id"] for annotation in ledger["annotations"][1:]
                ]
                result = contract.validate_ledger(
                    ledger,
                    capture=capture,
                    entries=entries,
                    capture_manifest_sha256=SHA_A,
                )
                self.assertNotEqual(result["restore_planning_gate"], "BLOCKED")

    def test_missing_parent_and_dependency_cycle_fail(self):
        missing = base_ledger(self.entries, self.capture)
        missing["annotations"][0]["parent_entry_ids"] = ["te1_" + "f" * 64]
        cycle = base_ledger(self.entries, self.capture)
        cycle["annotations"][0]["dependency_entry_ids"] = [cycle["annotations"][2]["entry_id"]]
        cycle["annotations"][2]["dependency_entry_ids"] = [cycle["annotations"][0]["entry_id"]]
        for ledger in (missing, cycle):
            with self.subTest(), self.assertRaisesRegex(
                contract.ContractError, "dependency_invalid"
            ):
                self.validate(ledger)

    def test_dependency_review_must_be_explicitly_complete(self):
        ledger = base_ledger(self.entries, self.capture)
        ledger["annotations"][0]["dependency_review_complete"] = False
        with self.assertRaisesRegex(contract.ContractError, "dependency_invalid"):
            self.validate(ledger)

    def test_data_reference_mapping_is_mandatory_and_metadata_only(self):
        missing = base_ledger(self.entries, self.capture)
        missing["annotations"][1]["metadata_parent_entry_id"] = None
        data_to_data = base_ledger(self.entries, self.capture)
        data_to_data["annotations"][1]["metadata_parent_entry_id"] = data_to_data["annotations"][1]["entry_id"]
        for ledger in (missing, data_to_data):
            with self.subTest(), self.assertRaisesRegex(
                contract.ContractError, "data_reference_unmapped|dependency_invalid"
            ):
                self.validate(ledger)

    def test_data_reference_parent_classes_are_exact_and_sequence_set_is_data(self):
        self.assertTrue(
            set(contract.DATA_TOC_CLASSES).issubset(contract.DATA_PARENT_CLASSES)
        )
        for data_class, parent_classes in contract.DATA_PARENT_CLASSES.items():
            for parent_class in parent_classes:
                with self.subTest(data_class=data_class, parent_class=parent_class):
                    _, _, entries, capture = capture_for([parent_class, data_class])
                    ledger = base_ledger(entries, capture)
                    result = contract.validate_ledger(
                        ledger,
                        capture=capture,
                        entries=entries,
                        capture_manifest_sha256=SHA_A,
                    )
                    expected_data = int(data_class in contract.DATA_TOC_CLASSES)
                    self.assertEqual(result["data_reference_count"], expected_data)
                    self.assertEqual(
                        result["data_reference_mapped_count"], expected_data
                    )
                    self.assertEqual(result["metadata_parent_required_count"], 1)
                    self.assertEqual(result["metadata_parent_mapped_count"], 1)
        _, _, entries, capture = capture_for(["SEQUENCE", "SEQUENCE SET"])
        self.assertFalse(entries[1].is_data_reference)
        self.assertEqual(capture["data_reference_count"], 0)

    def test_data_reference_mapped_to_wrong_metadata_class_fails(self):
        _, _, entries, capture = capture_for(["ACL", "TABLE DATA"])
        ledger = base_ledger(entries, capture)
        ledger["annotations"][1]["metadata_parent_entry_id"] = entries[0].entry_id
        with self.assertRaisesRegex(contract.ContractError, "data_reference_unmapped"):
            contract.validate_ledger(
                ledger,
                capture=capture,
                entries=entries,
                capture_manifest_sha256=SHA_A,
            )

    def test_retained_data_cannot_map_to_an_excluded_metadata_parent(self):
        _, _, entries, capture = capture_for(["TABLE", "TABLE DATA"])
        ledger = base_ledger(entries, capture)
        ledger["annotations"][0]["classification"] = "exclude_duplicate"
        with self.assertRaisesRegex(contract.ContractError, "data_reference_unmapped"):
            contract.validate_ledger(
                ledger,
                capture=capture,
                entries=entries,
                capture_manifest_sha256=SHA_A,
            )

    def test_managed_domain_handling_must_match_effective_dispositions(self):
        _, _, entries, capture = capture_for(["TABLE"])
        contradictory = base_ledger(entries, capture)
        annotation = contradictory["annotations"][0]
        annotation["classification"] = "exclude_supabase_managed"
        annotation["managed_domain"] = "auth"
        contradictory["managed_domain_handling"]["auth"] = "restore"
        with self.assertRaisesRegex(contract.ContractError, "managed_domain_invalid"):
            contract.validate_ledger(
                contradictory,
                capture=capture,
                entries=entries,
                capture_manifest_sha256=SHA_A,
            )

        resolved_restore = base_ledger(entries, capture)
        annotation = resolved_restore["annotations"][0]
        annotation["classification"] = "manual_conflict"
        annotation["manual_conflict_disposition"] = "restore"
        annotation["managed_domain"] = "auth"
        resolved_restore["managed_domain_handling"]["auth"] = "restore"
        result = contract.validate_ledger(
            resolved_restore,
            capture=capture,
            entries=entries,
            capture_manifest_sha256=SHA_A,
        )
        self.assertEqual(result["restore_planning_gate"], "ELIGIBLE_FOR_HUMAN_REVIEW")

    def test_dependency_only_requires_a_retained_effective_root(self):
        _, _, entries, capture = capture_for(["TABLE", "INDEX"])
        excluded_only = base_ledger(entries, capture)
        excluded_only["annotations"][0]["classification"] = "dependency_only"
        excluded_only["annotations"][1]["classification"] = "exclude_duplicate"
        excluded_only["annotations"][1]["dependency_entry_ids"] = [entries[0].entry_id]
        with self.assertRaisesRegex(contract.ContractError, "dependency_invalid"):
            contract.validate_ledger(
                excluded_only,
                capture=capture,
                entries=entries,
                capture_manifest_sha256=SHA_A,
            )

        manual_dependency = base_ledger(entries, capture)
        manual_dependency["annotations"][0]["classification"] = "manual_conflict"
        manual_dependency["annotations"][0]["manual_conflict_disposition"] = "dependency_only"
        manual_dependency["annotations"][1]["classification"] = "exclude_duplicate"
        manual_dependency["annotations"][1]["dependency_entry_ids"] = [entries[0].entry_id]
        with self.assertRaisesRegex(contract.ContractError, "dependency_invalid"):
            contract.validate_ledger(
                manual_dependency,
                capture=capture,
                entries=entries,
                capture_manifest_sha256=SHA_A,
            )

        _, _, chained_entries, chained_capture = capture_for(["TABLE", "INDEX", "COMMENT"])
        excluded_barrier = base_ledger(chained_entries, chained_capture)
        excluded_barrier["annotations"][1]["classification"] = "exclude_duplicate"
        excluded_barrier["annotations"][0]["dependency_entry_ids"] = [
            chained_entries[1].entry_id
        ]
        excluded_barrier["annotations"][1]["dependency_entry_ids"] = [
            chained_entries[2].entry_id
        ]
        excluded_barrier["annotations"][2]["classification"] = "dependency_only"
        with self.assertRaisesRegex(contract.ContractError, "dependency_invalid"):
            contract.validate_ledger(
                excluded_barrier,
                capture=chained_capture,
                entries=chained_entries,
                capture_manifest_sha256=SHA_A,
            )

        retained = base_ledger(entries, capture)
        retained["annotations"][0]["classification"] = "dependency_only"
        retained["annotations"][1]["dependency_entry_ids"] = [entries[0].entry_id]
        result = contract.validate_ledger(
            retained,
            capture=capture,
            entries=entries,
            capture_manifest_sha256=SHA_A,
        )
        self.assertEqual(result["restore_planning_gate"], "ELIGIBLE_FOR_HUMAN_REVIEW")

    def test_manual_conflict_and_managed_domain_require_closed_dispositions(self):
        manual = base_ledger(self.entries, self.capture)
        manual["annotations"][0]["classification"] = "manual_conflict"
        managed = base_ledger(self.entries, self.capture)
        managed["annotations"][0]["classification"] = "exclude_supabase_managed"
        for ledger, reason in ((manual, "manual_conflict_incomplete"), (managed, "managed_domain_invalid")):
            with self.subTest(), self.assertRaisesRegex(contract.ContractError, reason):
                self.validate(ledger)

    def test_unknown_readiness_field_is_rejected(self):
        ledger = base_ledger(self.entries, self.capture)
        ledger["migration_readiness"] = "GREEN"
        with self.assertRaisesRegex(contract.ContractError, "ledger_schema_invalid"):
            self.validate(ledger)

    def test_cross_binding_is_exact(self):
        ledger = base_ledger(self.entries, self.capture)
        ledger["capture_binding"]["outer_archive_sha256"] = "f" * 64
        with self.assertRaisesRegex(contract.ContractError, "binding_mismatch"):
            self.validate(ledger)

    def test_boolean_format_versions_never_equal_integer_protocol_versions(self):
        capture = dict(self.capture)
        capture["format_version"] = True
        with self.assertRaisesRegex(contract.ContractError, "ledger_schema_invalid"):
            contract.validate_capture_schema(capture)

        ledger = base_ledger(self.entries, self.capture)
        ledger["format_version"] = True
        with self.assertRaisesRegex(contract.ContractError, "ledger_schema_invalid"):
            self.validate(ledger)


class PrivateFileAndPublicationTest(unittest.TestCase):
    def test_symlink_hardlink_permissive_mode_and_mutation_fail(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            root = root.resolve()
            original = root / "input"
            original.write_bytes(b"safe")
            original.chmod(0o400)
            link = root / "link"
            link.symlink_to(original)
            hard = root / "hard"
            os.link(original, hard)
            with self.assertRaisesRegex(contract.ContractError, "input_invalid"):
                contract.stable_private_file(link, max_bytes=100)
            with self.assertRaisesRegex(contract.ContractError, "input_invalid"):
                contract.stable_private_file(original, max_bytes=100)
            hard.unlink()
            original.chmod(0o644)
            with self.assertRaisesRegex(contract.ContractError, "input_invalid"):
                contract.stable_private_file(original, max_bytes=100)
            original.chmod(0o400)

            def mutate():
                original.chmod(0o600)
                original.write_bytes(b"changed")
                original.chmod(0o400)

            with self.assertRaisesRegex(contract.ContractError, "input_mutated"):
                contract.stable_private_file(original, max_bytes=100, mutation_hook=mutate)

    def test_publication_is_private_atomic_no_replace_and_cleans_partial(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            root = root.resolve()
            root.chmod(0o700)
            files = {
                "raw-pg-restore-list.toc": b"raw",
                "opaque-id.key": b"k" * 32,
                "opaque-index.json": b"{}\n",
                "capture.json": b"{}\n",
            }
            result = contract.publish_private_package(root, "capture-one", files, kind="capture")
            self.assertEqual(stat.S_IMODE(result.path.stat().st_mode), 0o700)
            for path in result.path.iterdir():
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o400)
            with self.assertRaisesRegex(contract.ContractError, "publication_exists"):
                contract.publish_private_package(root, "capture-one", files, kind="capture")
            with self.assertRaisesRegex(contract.ContractError, "publication_failed"):
                contract.publish_private_package(
                    root, "capture-two", files, kind="capture", fail_stage="partial_write"
                )
            self.assertFalse((root / "capture-two").exists())
            self.assertFalse(any(path.name.startswith(".pending-") for path in root.iterdir()))

    def test_descriptor_relative_publication_preserves_caller_fd_and_ignores_path_replacement(self):
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary).resolve()
            root = parent / "private-root"
            root.mkdir(mode=0o700)
            root_fd = os.open(
                root,
                os.O_RDONLY
                | os.O_DIRECTORY
                | getattr(os, "O_NOFOLLOW", 0)
                | getattr(os, "O_CLOEXEC", 0),
            )
            moved = parent / "held-root"
            root.rename(moved)
            replacement = parent / "private-root"
            replacement.mkdir(mode=0o700)
            files = {
                "raw-pg-restore-list.toc": b"raw",
                "opaque-id.key": b"k" * 32,
                "opaque-index.json": b"{}\n",
                "capture.json": b"{}\n",
            }
            try:
                result = contract.publish_private_package_at(
                    root_fd, "capture-held", files, kind="capture"
                )
                self.assertEqual(result.path, Path("capture-held"))
                os.fstat(root_fd)  # the API must not consume the caller's descriptor
            finally:
                os.close(root_fd)
            self.assertTrue((moved / "capture-held" / "EVIDENCE_COMPLETE").is_file())
            self.assertEqual(list(replacement.iterdir()), [])

    def test_preexisting_pending_name_is_never_removed_as_failed_run_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            root.chmod(0o700)
            planted = root / ".pending-capture-deadbeef"
            planted.mkdir(mode=0o700)
            marker = planted / "preexisting"
            marker.write_bytes(b"do-not-remove")
            marker.chmod(0o400)
            files = {
                "raw-pg-restore-list.toc": b"raw",
                "opaque-id.key": b"k" * 32,
                "opaque-index.json": b"{}\n",
                "capture.json": b"{}\n",
            }
            with mock.patch.object(contract.secrets, "token_hex", return_value="deadbeef"):
                with self.assertRaisesRegex(contract.ContractError, "publication_failed"):
                    contract.publish_private_package(
                        root, "capture-pending-collision", files, kind="capture"
                    )
            self.assertEqual(marker.read_bytes(), b"do-not-remove")
            self.assertFalse((root / "capture-pending-collision").exists())

    def test_publication_validates_staged_and_renamed_bytes_modes_and_exact_set(self):
        files = {
            "raw-pg-restore-list.toc": b"raw",
            "opaque-id.key": b"k" * 32,
            "opaque-index.json": b"{}\n",
            "capture.json": b"{}\n",
        }
        original_write = contract._write_exclusive
        original_rename = contract._rename_no_replace

        def run_with_write_plant(plant):
            with tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary).resolve()
                root.chmod(0o700)

                def planted_write(directory_fd, name, data):
                    original_write(directory_fd, name, data)
                    plant(directory_fd, name)

                with mock.patch.object(contract, "_write_exclusive", side_effect=planted_write):
                    with self.assertRaisesRegex(contract.ContractError, "publication_failed"):
                        contract.publish_private_package(root, "capture-planted", files, kind="capture")
                self.assertFalse((root / "capture-planted").exists())
                self.assertFalse(any(path.name.startswith(".pending-") for path in root.iterdir()))

        def add_extra(directory_fd, name):
            if name == "capture.json":
                descriptor = os.open(
                    "unexpected",
                    os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                    0o400,
                    dir_fd=directory_fd,
                )
                os.write(descriptor, b"x")
                os.close(descriptor)

        def change_mode(directory_fd, name):
            if name == "capture.json":
                os.chmod(name, 0o600, dir_fd=directory_fd, follow_symlinks=False)

        def change_bytes(directory_fd, name):
            if name == "capture.json":
                os.chmod(name, 0o600, dir_fd=directory_fd, follow_symlinks=False)
                descriptor = os.open(
                    name,
                    os.O_WRONLY | os.O_TRUNC | getattr(os, "O_NOFOLLOW", 0),
                    dir_fd=directory_fd,
                )
                os.write(descriptor, b"[]\n")
                os.close(descriptor)
                os.chmod(name, 0o400, dir_fd=directory_fd, follow_symlinks=False)

        run_with_write_plant(add_extra)
        run_with_write_plant(change_mode)
        run_with_write_plant(change_bytes)

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            root.chmod(0o700)

            def mutate_after_rename(root_fd, old, new):
                original_rename(root_fd, old, new)
                final_fd = os.open(
                    new,
                    os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0),
                    dir_fd=root_fd,
                )
                try:
                    os.chmod(
                        "capture.json",
                        0o600,
                        dir_fd=final_fd,
                        follow_symlinks=False,
                    )
                finally:
                    os.close(final_fd)

            with mock.patch.object(contract, "_rename_no_replace", side_effect=mutate_after_rename):
                with self.assertRaisesRegex(contract.ContractError, "publication_failed"):
                    contract.publish_private_package(
                        root, "capture-renamed-plant", files, kind="capture"
                    )
            self.assertFalse((root / "capture-renamed-plant").exists())

    def test_post_rename_cleanup_failure_is_marked_indeterminate(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            root = root.resolve()
            root.chmod(0o700)
            files = {
                "raw-pg-restore-list.toc": b"raw",
                "opaque-id.key": b"k" * 32,
                "opaque-index.json": b"{}\n",
                "capture.json": b"{}\n",
            }
            with mock.patch.object(contract, "_unlink_tree_at", return_value=False):
                with self.assertRaisesRegex(contract.ContractError, "cleanup_indeterminate"):
                    contract.publish_private_package(
                        root, "capture-indeterminate", files, kind="capture", fail_stage="after_rename"
                    )
            package = root / "capture-indeterminate"
            self.assertFalse((package / "EVIDENCE_COMPLETE").exists())
            self.assertTrue((package / "EVIDENCE_INDETERMINATE").is_file())

    def test_final_fsync_and_cleanup_failure_cannot_leave_normal_complete_package(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            root.chmod(0o700)
            root_inode = root.stat().st_ino
            files = {
                "raw-pg-restore-list.toc": b"raw",
                "opaque-id.key": b"k" * 32,
                "opaque-index.json": b"{}\n",
                "capture.json": b"{}\n",
            }
            original_fsync = os.fsync
            root_fsync_count = 0

            def fail_final_root_fsync(descriptor):
                nonlocal root_fsync_count
                if os.fstat(descriptor).st_ino == root_inode:
                    root_fsync_count += 1
                    if root_fsync_count == 2:
                        raise OSError("planted final directory fsync failure")
                return original_fsync(descriptor)

            with mock.patch.object(contract.os, "fsync", side_effect=fail_final_root_fsync), mock.patch.object(
                contract, "_unlink_tree_at", return_value=False
            ):
                with self.assertRaisesRegex(contract.ContractError, "cleanup_indeterminate"):
                    contract.publish_private_package(
                        root, "capture-final-fsync", files, kind="capture"
                    )
            package = root / "capture-final-fsync"
            self.assertTrue(package.is_dir())
            self.assertFalse((package / "EVIDENCE_COMPLETE").exists())
            self.assertTrue((package / "EVIDENCE_INDETERMINATE").is_file())

    def test_failed_indeterminate_marker_quarantines_complete_package(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            root.chmod(0o700)
            files = {
                "raw-pg-restore-list.toc": b"raw",
                "opaque-id.key": b"k" * 32,
                "opaque-index.json": b"{}\n",
                "capture.json": b"{}\n",
            }
            original_unlink = os.unlink

            def fail_complete_unlink(path, *args, **kwargs):
                if path == "EVIDENCE_COMPLETE":
                    raise OSError("planted marker removal failure")
                return original_unlink(path, *args, **kwargs)

            with mock.patch.object(contract, "_unlink_tree_at", return_value=False), mock.patch.object(
                contract.os, "unlink", side_effect=fail_complete_unlink
            ):
                with self.assertRaisesRegex(contract.ContractError, "cleanup_indeterminate"):
                    contract.publish_private_package(
                        root,
                        "capture-quarantine",
                        files,
                        kind="capture",
                        fail_stage="after_complete",
                    )
            self.assertFalse((root / "capture-quarantine").exists())
            quarantines = [
                path for path in root.iterdir() if path.name.startswith(".indeterminate-capture-")
            ]
            self.assertEqual(len(quarantines), 1)

    def test_fixed_diagnostic_never_relays_poisoned_inputs(self):
        poison = "SECRET ROW /private/path object-name CREATE TABLE"
        output = contract.fixed_diagnostic(
            stage="ledger", status="failed", reason=poison
        )
        if poison.encode() in output:
            self.fail("poisoned sentinel escaped fixed diagnostic")
        self.assertEqual(
            json.loads(output),
            {
                "diagnostic_version": 1,
                "reason": "internal_failure",
                "stage": "ledger",
                "status": "failed",
            },
        )
        poisoned_key = contract.fixed_diagnostic(
            stage="ledger",
            status="complete",
            reason="ok",
            counts={poison: 1},
            hashes={poison: poison},
        )
        if poison.encode() in poisoned_key:
            self.fail("poisoned diagnostic key escaped")
        self.assertEqual(
            json.loads(poisoned_key),
            {
                "diagnostic_version": 1,
                "reason": "internal_failure",
                "stage": "ledger",
                "status": "failed",
            },
        )

    def test_review_required_diagnostic_is_explicitly_blocked(self):
        output = contract.fixed_diagnostic(
            stage="ledger",
            status="review_required",
            reason="blocked",
            counts={
                "data_reference_count": 1,
                "entry_count": 2,
                "unresolved_count": 1,
            },
            hashes={
                "ledger_procedure_identity_sha256": "b" * 64,
                "ledger_sha256": "a" * 64,
                "publication_manifest_sha256": "c" * 64,
            },
        )
        self.assertEqual(
            json.loads(output),
            {
                "counts": {
                    "data_reference_count": 1,
                    "entry_count": 2,
                    "unresolved_count": 1,
                },
                "diagnostic_version": 1,
                "hashes": {
                    "ledger_procedure_identity_sha256": "b" * 64,
                    "ledger_sha256": "a" * 64,
                    "publication_manifest_sha256": "c" * 64,
                },
                "reason": "blocked",
                "review_gate": "REVIEW_REQUIRED",
                "restore_planning_gate": "BLOCKED",
                "stage": "ledger",
                "status": "review_required",
            },
        )


if __name__ == "__main__":
    unittest.main()
