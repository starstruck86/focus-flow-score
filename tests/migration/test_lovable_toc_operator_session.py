from __future__ import annotations

from contextlib import ExitStack
import copy
import dataclasses
import errno
import hashlib
import importlib.util
import json
import os
import pty
import re
import select
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import termios
import time
import types
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "scripts" / "migration"
sys.path.insert(0, str(MIGRATION))

from lib import lovable_toc_contract as capture_contract  # noqa: E402
from lib import lovable_toc_authoring_contract as authoring_contract  # noqa: E402
from test_lovable_toc_annotation_authoring import (  # noqa: E402
    GIT_A,
    GIT_B,
    SHA_A,
    SHA_B,
    SHA_C,
    SHA_D,
    immutable_tree_snapshot,
    make_capture_package,
)


def load_session():
    path = MIGRATION / "author-lovable-toc-operator-session.py"
    spec = importlib.util.spec_from_file_location("toc_operator_session_test", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("synthetic operator session load failed")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


SESSION = load_session()
AUTHOR = SESSION.AUTHOR
ZERO64 = "0" * 64
LAUNCHER = MIGRATION / "run-lovable-toc-annotation-operator-session.sh"

LAUNCHER_POISON_VARIABLES = (
    "LD_PRELOAD",
    "LD_LIBRARY_PATH",
    "LD_AUDIT",
    "LD_DEBUG",
    "LD_DEBUG_OUTPUT",
    "LD_PROFILE",
    "LD_PROFILE_OUTPUT",
    "LD_ORIGIN_PATH",
    "LD_ASSUME_KERNEL",
    "LD_TRACE_LOADED_OBJECTS",
    "LD_BIND_NOW",
    "LD_BIND_NOT",
    "LD_SHOW_AUXV",
    "LD_VERBOSE",
    "LD_WARN",
    "LD_DYNAMIC_WEAK",
    "LD_HWCAP_MASK",
    "LD_POINTER_GUARD",
    "GLIBC_TUNABLES",
    "DYLD_INSERT_LIBRARIES",
    "DYLD_LIBRARY_PATH",
    "DYLD_FRAMEWORK_PATH",
    "DYLD_FALLBACK_LIBRARY_PATH",
    "DYLD_FALLBACK_FRAMEWORK_PATH",
    "DYLD_IMAGE_SUFFIX",
    "DYLD_ROOT_PATH",
    "DYLD_FORCE_FLAT_NAMESPACE",
    "DYLD_SHARED_REGION",
    "DYLD_PRINT_LIBRARIES",
    "DYLD_PRINT_LIBRARIES_POST_LAUNCH",
    "DYLD_PRINT_APIS",
    "DYLD_PRINT_BINDINGS",
    "DYLD_PRINT_TO_FILE",
    "DYLD_PRINT_RPATHS",
    "DYLD_PRINT_ENV",
    "DYLD_PRINT_OPTS",
    "DYLD_PRINT_WARNINGS",
    "DYLD_PRINT_INITIALIZERS",
    "DYLD_PRINT_SEGMENTS",
    "DYLD_PRINT_STATISTICS",
    "DYLD_PRINT_STATISTICS_DETAILS",
    "DYLD_PRINT_INTERPOSING",
    "DYLD_PRINT_SEARCHING",
    "DYLD_PRINT_UUIDS",
    "DYLD_PRINT_DOFS",
    "DYLD_PRINT_LINKS_WITH",
    "DYLD_PRINT_FIXUPS",
    "DYLD_USE_CLOSURES",
    "DYLD_DISABLE_CLOSURES",
    "DYLD_SHARED_CACHE_DIR",
    "PYTHONHOME",
    "PYTHONPATH",
    "PYTHONUSERBASE",
    "PYTHONSTARTUP",
    "PYTHONINSPECT",
    "PYTHONBREAKPOINT",
    "PYTHONWARNINGS",
    "PYTHONMALLOC",
    "PYTHONTRACEMALLOC",
    "PYTHONPROFILEIMPORTTIME",
    "ENV",
    "BASH_ENV",
)
LOADER_EAGER_VARIABLES = {
    "LD_TRACE_LOADED_OBJECTS",
    "LD_SHOW_AUXV",
}


class TocOperatorSessionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="toc-operator-session.")
        self.root = Path(self.temporary.name).resolve()
        self.root.chmod(0o700)
        self.capture_root = self.root / "capture-root"
        self.package, self.expectations, _capture, _entries = make_capture_package(
            self.capture_root, ["TABLE", "TABLE DATA"], run_id="synthetic-run"
        )
        self.session_root = self.root / "operator-session-root"
        self.annotation_root = self.root / "annotation-root"
        self.python = Path(sys.executable).resolve(strict=True)
        self.python_sha = hashlib.sha256(self.python.read_bytes()).hexdigest()
        self.python_version = (
            f"{sys.implementation.name}:{sys.version_info.major}."
            f"{sys.version_info.minor}.{sys.version_info.micro}"
        )
        self.bootstrap = {
            "approved_checkout": GIT_A,
            "python_path": os.fspath(self.python),
            "python_sha256": self.python_sha,
            "python_version": self.python_version,
        }
        profile = json.loads(
            (
                MIGRATION
                / "verification"
                / "lovable-toc-operator-execution-profile.v1.json"
            ).read_text(encoding="utf-8")
        )
        profile["python_policy"] = {
            **profile["python_policy"],
            "absolute_path": os.fspath(self.python),
            "exact_gid": self.python.stat().st_gid,
            "exact_mode": format(stat.S_IMODE(self.python.stat().st_mode), "04o"),
            "exact_nlink": self.python.stat().st_nlink,
            "exact_uid": self.python.stat().st_uid,
            "reported_version": self.python_version,
            "sha256": self.python_sha,
        }
        self.verified = types.SimpleNamespace(
            approval={},
            approval_name="synthetic-approval.json",
            approval_sha256=SHA_A,
            approved_checkout_sha=GIT_A,
            authoring_procedure_identity_sha256=SHA_C,
            operator_session_procedure_identity_sha256=SHA_D,
            operator_session_root_path=os.fspath(self.session_root),
            profile=profile,
            profile_sha256=SHA_B,
            python_identity_sha256=SHA_C,
            repository_root=os.fspath(ROOT),
            reviewed_file_blobs={},
            summary={
                "checkout_verified": True,
                "procedure_identities_verified": True,
                "python_verified": True,
                "repository_verified": True,
                "reviewed_files_verified": True,
                "tty_verified": True,
            },
        )

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def responses(
        self,
        *,
        primary: str = "Primary Reviewer",
        operator: str = "Primary Reviewer",
        session_id: str = "operator-session-1",
        authoring_session: str = "authoring-session-1",
        authorization_ack: str = "authorization_digest_recorded",
    ) -> list[str]:
        return [
            "initialize",
            primary,
            operator,
            os.fspath(self.annotation_root),
            os.fspath(self.capture_root),
            self.package.name,
            self.expectations.approved_pg_restore_sha256,
            self.expectations.capture_execution_checkout_sha,
            self.expectations.capture_manifest_sha256,
            self.expectations.capture_procedure_identity_sha256,
            str(self.expectations.data_reference_count),
            str(self.expectations.entry_count),
            self.expectations.evidence_manifest_sha256,
            self.expectations.evidence_run_id,
            self.expectations.inner_archive_sha256,
            self.expectations.inspection_checkout_sha,
            self.expectations.inspection_procedure_sha256,
            self.expectations.opaque_index_sha256,
            self.expectations.outer_archive_sha256,
            self.expectations.raw_toc_sha256,
            authorization_ack,
        ]

    def run_with_responses(
        self,
        responses: list[str],
        *,
        execute_authoring_side_effect=None,
        tty_write_side_effect=None,
        authorize_consequence=True,
    ):
        seen_prompts: list[bytes] = []
        iterator = iter(responses)

        def fake_read(_tty_fd: int, prompt: bytes, *, echo: bool = False) -> str:
            seen_prompts.append(prompt)
            try:
                return next(iterator)
            except StopIteration as exc:
                raise AssertionError("operator prompt requested an unexpected value") from exc

        tty_writes: list[bytes] = []

        def fake_tty_write(_tty_fd: int, payload: bytes) -> None:
            tty_writes.append(payload)

        def fake_author_tty_write(_tty_fd: int, payload: bytes) -> None:
            tty_writes.append(payload)

        with ExitStack() as stack:
            stack.enter_context(mock.patch.object(SESSION, "_read_line", side_effect=fake_read))
            stack.enter_context(
                mock.patch.object(
                    SESSION,
                    "_tty_write",
                    side_effect=tty_write_side_effect or fake_tty_write,
                )
            )
            stack.enter_context(
                mock.patch.object(
                    SESSION, "_operator_session_procedure_identity", return_value=SHA_D
                )
            )
            stack.enter_context(mock.patch.object(SESSION, "_procedure_identity", return_value=SHA_C))
            stack.enter_context(mock.patch.object(AUTHOR, "_authoring_procedure_identity", return_value=SHA_C))
            stack.enter_context(mock.patch.object(AUTHOR, "_write_tty", side_effect=fake_author_tty_write))
            stack.enter_context(mock.patch.object(AUTHOR, "_require_resume_acknowledgement", return_value=None))
            if authorize_consequence:
                stack.enter_context(
                    mock.patch.object(
                        SESSION,
                        "_authorize_consequence",
                        return_value=None,
                    )
                )
            if execute_authoring_side_effect is not None:
                stack.enter_context(
                    mock.patch.object(
                        AUTHOR,
                        "execute_authoring",
                        side_effect=execute_authoring_side_effect,
                    )
                )
                stack.enter_context(
                    mock.patch.object(
                        SESSION,
                        "_revalidate_checkpoint_evidence_from_path",
                        return_value=None,
                    )
                )
            result = SESSION.run_session(9, self.verified)
        return result, seen_prompts, tty_writes

    def action_responses(
        self,
        action: str,
        *,
        primary: str = "Primary Reviewer",
        operator: str = "Primary Reviewer",
        session_id: str = "operator-session-action",
        authoring_session: str = "authoring-session-action",
        expected_state: str = "PRIMARY_REVIEW_REQUIRED",
        finalization_authorization: str = "",
        action_ack: str = "action_authorization_recorded",
        resume_ack: str = "resume_values_recorded",
    ) -> list[str]:
        responses = [
            action,
            operator,
        ]
        allowed_states = self.verified.profile["action_state_matrix"][action][
            "allowed_expected_states"
        ]
        if len(allowed_states) != 1:
            responses.append(expected_state)
        if action == "finalize":
            responses.append(finalization_authorization or AUTHOR.FINALIZATION_AUTHORIZATION)
        responses.append(action_ack)
        if action == "finalize":
            responses.append(resume_ack)
        return responses

    def current_resume_path(self) -> Path:
        matches = [
            path
            for path in self.session_root.iterdir()
            if path.name.startswith(SESSION.CURRENT_RESUME_PREFIX)
        ]
        self.assertEqual(len(matches), 1)
        return matches[0]

    def load_private_json(self, path: Path):
        return capture_contract.strict_json_loads(path.read_bytes())

    def digest_for(self, label: str) -> str:
        return hashlib.sha256(label.encode("ascii")).hexdigest()

    def initialize_operator_session(self) -> dict:
        status, _diagnostic = self.run_with_responses(self.responses())[0]
        self.assertEqual(status, 2)
        return self.load_private_json(self.current_resume_path())

    def predecessor_bearing_session(self):
        self.initialize_operator_session()
        result, _prompts, _writes = self.run_with_responses(
            self.action_responses(
                "status", expected_state="PRIMARY_REVIEW_REQUIRED"
            )
        )
        self.assertEqual(result[0], 2)
        current = self.current_resume_path()
        resume = self.load_private_json(current)
        predecessor = resume["predecessor"]
        retired = [
            path
            for path in self.session_root.iterdir()
            if path.name.startswith(SESSION.RETIRED_RESUME_PREFIX)
            and hashlib.sha256(path.read_bytes()).hexdigest()
            == predecessor["resume_sha256"]
        ]
        action_authorizations = [
            path
            for path in self.session_root.iterdir()
            if path.name.startswith("authorization-action-")
            and hashlib.sha256(path.read_bytes()).hexdigest()
            == predecessor["action_authorization_sha256"]
        ]
        self.assertEqual(len(retired), 1)
        self.assertEqual(len(action_authorizations), 1)
        return current, retired[0], action_authorizations[0]

    def multiple_predecessor_session(self, edge_count: int = 2) -> Path:
        self.initialize_operator_session()
        for _index in range(edge_count):
            result, _prompts, _writes = self.run_with_responses(
                self.action_responses(
                    "status", expected_state="PRIMARY_REVIEW_REQUIRED"
                )
            )
            self.assertEqual(result[0], 2)
        return self.current_resume_path()

    def replace_current_resume(self, current: Path, resume: dict) -> Path:
        data = capture_contract.canonical_json_bytes(resume)
        digest = hashlib.sha256(data).hexdigest()
        replacement = self.session_root / (
            SESSION.CURRENT_RESUME_PREFIX
            + f"{resume['resume_generation']:016d}-"
            + resume["resume_checkpoint_sha256"]
            + "-"
            + digest[:16]
            + ".json"
        )
        replacement.write_bytes(data)
        replacement.chmod(0o400)
        current.unlink()
        return replacement

    def replace_immediate_action_evidence(
        self,
        current: Path,
        retired: Path,
        action: Path,
        mutate,
    ) -> Path:
        resume = self.load_private_json(current)
        action_record = self.load_private_json(action)
        mutate(action_record)
        action_data = capture_contract.canonical_json_bytes(action_record)
        action_sha256 = hashlib.sha256(action_data).hexdigest()
        replacement_action = self.session_root / (
            "authorization-action-" + action_sha256[:16] + ".json"
        )
        replacement_action.write_bytes(action_data)
        replacement_action.chmod(0o400)
        action.unlink()
        resume["predecessor"]["action"] = action_record["action"]
        resume["predecessor"][
            "action_authorization_sha256"
        ] = action_sha256
        replacement_data = capture_contract.canonical_json_bytes(resume)
        replacement_sha256 = hashlib.sha256(replacement_data).hexdigest()
        generation = int(
            re.search(r"g([0-9]{16})-", resume["predecessor"]["resume_name"]).group(1)
        )
        retired.rename(
            self.session_root
            / (
                SESSION.RETIRED_RESUME_PREFIX
                + f"{generation:016d}-"
                + replacement_sha256[:16]
                + ".json"
            )
        )
        return self.replace_current_resume(current, resume)

    def assert_predecessor_evidence_mutation_blocks(
        self, evidence_kind: str, mutation: str
    ) -> None:
        current, retired, action = self.predecessor_bearing_session()
        target = retired if evidence_kind == "retired" else action
        if mutation == "missing":
            target.unlink()
        elif mutation == "altered":
            target.chmod(0o600)
            target.write_bytes(b"{}\n")
            target.chmod(0o400)
        elif mutation == "duplicate":
            prefix = (
                SESSION.RETIRED_RESUME_PREFIX
                if evidence_kind == "retired"
                else "authorization-action-"
            )
            duplicate = self.session_root / (
                prefix + "duplicate-evidence.json"
            )
            duplicate.write_bytes(target.read_bytes())
            duplicate.chmod(0o400)
        elif mutation == "permissive_mode":
            target.chmod(0o600)
        elif mutation == "symlink":
            target.unlink()
            target.symlink_to(current.name)
        elif mutation == "hardlink":
            duplicate = self.session_root / (
                (
                    SESSION.RETIRED_RESUME_PREFIX
                    if evidence_kind == "retired"
                    else "authorization-action-"
                )
                + "hardlink-evidence.json"
            )
            os.link(target, duplicate)
        else:
            raise AssertionError("unknown planted evidence mutation")
        with self.assertRaises(SESSION.OperatorSessionError) as raised:
            self.run_with_responses(
                self.action_responses(
                    "status", expected_state="PRIMARY_REVIEW_REQUIRED"
                ),
                execute_authoring_side_effect=AssertionError(
                    "invalid predecessor evidence dispatched"
                ),
            )
        self.assertEqual(raised.exception.reason, "history_conflict")
        self.assertTrue(current.exists())
        self.assertTrue(
            (self.session_root / "OPERATOR_SESSION_INDETERMINATE").exists()
        )

    def fake_action_execute(self, action: str, seen: list[dict[str, str]]):
        def fake_execute(
            environment,
            _tty_fd,
            *,
            resume_recorder,
            action_authorizer=None,
            history_verifier=None,
            binding_policy=None,
        ):
            copied = dict(environment)
            seen.append(copied)
            if action_authorizer is not None:
                action_authorizer()
            if action != "finalize":
                current_generation = int(copied["TOC_AUTHOR_EXPECTED_HEAD_GENERATION"])
                if action == "status":
                    next_generation = current_generation
                    next_head = copied["TOC_AUTHOR_EXPECTED_HEAD_SHA256"]
                else:
                    next_generation = current_generation + 1
                    next_head = self.digest_for(f"{action}-checkpoint-{current_generation}")
                next_token = self.digest_for(f"{action}-release-{current_generation}")
                resume_recorder(next_generation, next_head, next_token)
            return (
                2,
                b'{"authoring_state":"SYNTHETIC","diagnostic_version":1,'
                b'"reason":"blocked","review_gate":"REVIEW_REQUIRED",'
                b'"status":"review_required"}\n',
            )

        return fake_execute

    def legacy_bridge_records(self):
        legacy_checkout = "b1986e4079b52edbb4ef5cd4c56ed4d20af07195"
        legacy_authoring = (
            "bc0b990d878db1e2c72bd4ac91314fe32261a454ac38505b7ea6df4af2b5f3d8"
        )
        legacy_session = (
            "ee0dbb3ecb9b469bef49c1fe0305ea60602bbbbaddd2f551a7774dad6cacdc23"
        )
        legacy_python_sha = (
            "4b42b1a117605cafc8607b67b0892a609c2cd125012dd56288abeed8c89cdfb1"
        )
        bridge = {
            "allowed_action": "primary_review",
            "authoring_procedure_identity_sha256": legacy_authoring,
            "execution_checkout_sha": legacy_checkout,
            "generation": 1,
            "operator_session_procedure_identity_sha256": legacy_session,
            "python": {
                "absolute_path": (
                    "/Library/Developer/CommandLineTools/Library/Frameworks/"
                    "Python3.framework/Versions/3.9/bin/python3.9"
                ),
                "reported_version": "cpython:3.9.6",
                "sha256": legacy_python_sha,
            },
            "required_state": "PRIMARY_REVIEW_REQUIRED",
            "resume_predecessor": "absent",
            "self_closing": {
                "ordinary_exact_current_rules_after_success": True,
                "reject_generation_at_or_above": 2,
                "single_use": True,
            },
        }
        root_capture = {
            "approved_pg_restore_sha256": SHA_A,
            "capture_execution_checkout_sha": GIT_A,
            "capture_manifest_sha256": SHA_B,
            "capture_name": "synthetic-capture",
            "capture_procedure_identity_sha256": SHA_C,
            "capture_root": "/synthetic/capture",
            "data_reference_count": 1,
            "entry_count": 2,
            "evidence_manifest_sha256": SHA_D,
            "evidence_run_id": "synthetic-run",
            "inner_sha256": SHA_A,
            "inspection_checkout_sha": GIT_A,
            "inspection_procedure_sha256": SHA_B,
            "opaque_index_sha256": SHA_C,
            "outer_sha256": SHA_D,
            "raw_toc_sha256": SHA_A,
        }
        root = {
            "action": "initialize",
            "annotation_root": "/synthetic/annotation",
            "artifact_kind": SESSION.AUTHORIZATION_KIND,
            "authoring_session_identity": "legacy-authoring-session",
            "capture": root_capture,
            "execution": {
                "approved_checkout_sha": legacy_checkout,
                "approved_operator_session_procedure_identity_sha256": legacy_session,
                "approved_procedure_identity_sha256": legacy_authoring,
                "python": {
                    "path": bridge["python"]["absolute_path"],
                    "sha256": legacy_python_sha,
                    "version": bridge["python"]["reported_version"],
                },
            },
            "finalization_authorization": "",
            "format_version": SESSION.FORMAT_VERSION,
            "initial_head": {
                "checkpoint_sha256": ZERO64,
                "generation": 0,
                "release_token": ZERO64,
            },
            "operator_identity": "Primary Reviewer",
            "primary_operator_identity": "Primary Reviewer",
            "session_id": "legacy-operator-session",
            "session_root": "/synthetic/operator-session",
            "tty_attestation": SESSION.TTY_ATTESTATION,
        }
        root_sha = hashlib.sha256(
            capture_contract.canonical_json_bytes(root)
        ).hexdigest()
        checkpoint_sha = self.digest_for("legacy-generation-one")
        resume = {
            "annotation_root": root["annotation_root"],
            "artifact_kind": SESSION.RESUME_KIND,
            "authorization_sha256": root_sha,
            "authoring_session_identity": root["authoring_session_identity"],
            "capture": {
                "capture_manifest_sha256": root_capture["capture_manifest_sha256"],
                "evidence_run_id": root_capture["evidence_run_id"],
                "opaque_index_sha256": root_capture["opaque_index_sha256"],
                "raw_toc_sha256": root_capture["raw_toc_sha256"],
            },
            "execution_checkout_sha": legacy_checkout,
            "format_version": SESSION.RESUME_FORMAT_VERSION,
            "operator_session_procedure_identity_sha256": legacy_session,
            "primary_operator_identity": root["primary_operator_identity"],
            "procedure_identity_sha256": legacy_authoring,
            "python_identity_sha256": self.digest_for("full-python-identity"),
            "resume_checkpoint_sha256": checkpoint_sha,
            "resume_generation": 1,
            "resume_release_token": self.digest_for("legacy-release"),
        }
        action = {
            "action": "primary_review",
            "execution": {
                "approved_checkout_sha": GIT_B,
                "approved_operator_session_procedure_identity_sha256": SHA_D,
                "approved_procedure_identity_sha256": SHA_C,
                "python": {
                    "path": bridge["python"]["absolute_path"],
                    "sha256": legacy_python_sha,
                    "version": bridge["python"]["reported_version"],
                },
            },
            "expected_authoring_state": "PRIMARY_REVIEW_REQUIRED",
            "primary_operator_identity": "Primary Reviewer",
        }
        profile = {"compatibility_bridges": [bridge]}
        resume_name = (
            SESSION.CURRENT_RESUME_PREFIX
            + "0000000000000001-"
            + checkpoint_sha
            + ".json"
        )
        python_identity = {
            "identity_sha256": resume["python_identity_sha256"],
            "sha256": legacy_python_sha,
        }
        return action, root, resume, resume_name, profile, python_identity

    def build_legacy_history(
        self,
        label: str,
        *,
        insert_current_generation_one: bool = False,
        generation_two_mutation=None,
        extra_current_edge: bool = False,
        final_generation: int = 3,
        second_historical_transition: bool = False,
    ):
        action, root, legacy_resume, legacy_name, profile, python_identity = (
            self.legacy_bridge_records()
        )
        history_root = self.root / label
        history_root.mkdir(mode=0o700)
        current_execution = copy.deepcopy(action["execution"])
        root_sha256 = hashlib.sha256(
            capture_contract.canonical_json_bytes(root)
        ).hexdigest()
        capture_binding_sha256 = hashlib.sha256(
            capture_contract.canonical_json_bytes(root["capture"])
        ).hexdigest()
        written_edges = []

        def add_edge(
            predecessor,
            predecessor_name,
            *,
            transition_action,
            expected_state,
            successor_generation,
            successor_session,
            successor_execution,
            mutate_successor=None,
        ):
            predecessor_data = capture_contract.canonical_json_bytes(
                predecessor
            )
            predecessor_sha256 = hashlib.sha256(predecessor_data).hexdigest()
            action_record = {
                "action": transition_action,
                "annotation_root": root["annotation_root"],
                "artifact_kind": SESSION.ACTION_AUTHORIZATION_KIND,
                "authoring_session_identity": successor_session,
                "capture_binding_sha256": capture_binding_sha256,
                "execution": copy.deepcopy(current_execution),
                "expected_authoring_state": expected_state,
                "finalization_authorization": "",
                "format_version": SESSION.ACTION_AUTHORIZATION_FORMAT_VERSION,
                "operator_identity": "Primary Reviewer",
                "primary_operator_identity": "Primary Reviewer",
                "resume": {
                    "checkpoint_sha256": predecessor[
                        "resume_checkpoint_sha256"
                    ],
                    "generation": predecessor["resume_generation"],
                    "name": predecessor_name,
                    "sha256": predecessor_sha256,
                },
                "root_authorization_sha256": root_sha256,
                "session_id": successor_session + "-operator",
                "session_root": root["session_root"],
                "tty_attestation": SESSION.TTY_ATTESTATION,
            }
            action_data = capture_contract.canonical_json_bytes(action_record)
            action_sha256 = hashlib.sha256(action_data).hexdigest()
            successor = {
                "annotation_root": root["annotation_root"],
                "artifact_kind": SESSION.RESUME_KIND,
                "authorization_sha256": root_sha256,
                "authoring_session_identity": successor_session,
                "capture": copy.deepcopy(legacy_resume["capture"]),
                "execution_checkout_sha": successor_execution[
                    "approved_checkout_sha"
                ],
                "format_version": SESSION.RESUME_FORMAT_VERSION,
                "operator_session_procedure_identity_sha256": (
                    successor_execution[
                        "approved_operator_session_procedure_identity_sha256"
                    ]
                ),
                "predecessor": {
                    "action": transition_action,
                    "action_authorization_sha256": action_sha256,
                    "resume_name": predecessor_name,
                    "resume_sha256": predecessor_sha256,
                },
                "primary_operator_identity": "Primary Reviewer",
                "procedure_identity_sha256": successor_execution[
                    "approved_procedure_identity_sha256"
                ],
                "python_identity_sha256": python_identity["identity_sha256"],
                "resume_checkpoint_sha256": (
                    predecessor["resume_checkpoint_sha256"]
                    if transition_action == "status"
                    else self.digest_for(
                        f"{label}-checkpoint-{successor_generation}"
                    )
                ),
                "resume_generation": successor_generation,
                "resume_release_token": self.digest_for(
                    f"{label}-release-{successor_generation}-{successor_session}"
                ),
            }
            if mutate_successor is not None:
                mutate_successor(successor)
            successor_data = capture_contract.canonical_json_bytes(successor)
            successor_sha256 = hashlib.sha256(successor_data).hexdigest()
            successor_name = (
                SESSION.CURRENT_RESUME_PREFIX
                + f"{successor['resume_generation']:016d}-"
                + successor["resume_checkpoint_sha256"]
                + "-"
                + successor_sha256[:16]
                + ".json"
            )
            generation_match = re.search(
                r"g([0-9]{16})-", predecessor_name
            )
            self.assertIsNotNone(generation_match)
            retired_path = history_root / (
                SESSION.RETIRED_RESUME_PREFIX
                + generation_match.group(1)
                + "-"
                + successor_sha256[:16]
                + ".json"
            )
            retired_path.write_bytes(predecessor_data)
            retired_path.chmod(0o400)
            action_path = history_root / (
                "authorization-action-" + action_sha256[:16] + ".json"
            )
            action_path.write_bytes(action_data)
            action_path.chmod(0o400)
            written_edges.append(
                {
                    "action": action_path,
                    "retired": retired_path,
                    "successor": successor,
                    "successor_name": successor_name,
                    "successor_sha256": successor_sha256,
                }
            )
            return successor, successor_name

        predecessor = legacy_resume
        predecessor_name = legacy_name
        if insert_current_generation_one:
            predecessor, predecessor_name = add_edge(
                predecessor,
                predecessor_name,
                transition_action="status",
                expected_state="PRIMARY_REVIEW_REQUIRED",
                successor_generation=1,
                successor_session="current-status-generation-one",
                successor_execution=current_execution,
            )
        predecessor, predecessor_name = add_edge(
            predecessor,
            predecessor_name,
            transition_action="primary_review",
            expected_state="PRIMARY_REVIEW_REQUIRED",
            successor_generation=2,
            successor_session="current-primary-generation-two",
            successor_execution=current_execution,
            mutate_successor=generation_two_mutation,
        )
        if second_historical_transition:
            historical_execution = copy.deepcopy(root["execution"])
            predecessor, predecessor_name = add_edge(
                predecessor,
                predecessor_name,
                transition_action="primary_review",
                expected_state="PRIMARY_REVIEW_REQUIRED",
                successor_generation=3,
                successor_session="historical-generation-three",
                successor_execution=historical_execution,
            )
            final_generation = 4
        elif extra_current_edge:
            predecessor, predecessor_name = add_edge(
                predecessor,
                predecessor_name,
                transition_action="primary_review",
                expected_state="PRIMARY_REVIEW_REQUIRED",
                successor_generation=3,
                successor_session="current-primary-generation-three",
                successor_execution=current_execution,
            )
            final_generation = 4
        final_resume, final_name = add_edge(
            predecessor,
            predecessor_name,
            transition_action="primary_review",
            expected_state="PRIMARY_REVIEW_REQUIRED",
            successor_generation=final_generation,
            successor_session=f"current-primary-generation-{final_generation}",
            successor_execution=current_execution,
        )
        root_data = capture_contract.canonical_json_bytes(root)
        root_path = history_root / (
            "authorization-root-"
            + hashlib.sha256(root_data).hexdigest()[:16]
            + ".json"
        )
        root_path.write_bytes(root_data)
        root_path.chmod(0o400)
        final_data = capture_contract.canonical_json_bytes(final_resume)
        final_path = history_root / final_name
        final_path.write_bytes(final_data)
        final_path.chmod(0o400)
        return {
            "action": action,
            "bridge": profile["compatibility_bridges"][0],
            "edges": written_edges,
            "final_name": final_name,
            "final_resume": final_resume,
            "final_sha256": hashlib.sha256(final_data).hexdigest(),
            "history_root": history_root,
            "python_identity": python_identity,
            "root": root,
        }

    def verify_built_legacy_history(self, built) -> None:
        descriptor = os.open(
            built["history_root"],
            os.O_RDONLY
            | getattr(os, "O_DIRECTORY", 0)
            | getattr(os, "O_NOFOLLOW", 0),
        )
        try:
            SESSION._verify_predecessor_chain_at(
                descriptor,
                base_authorization=built["root"],
                resume=built["final_resume"],
                resume_name=built["final_name"],
                resume_sha256=built["final_sha256"],
                expected_execution=built["action"]["execution"],
                expected_python_identity_sha256=built[
                    "python_identity"
                ]["identity_sha256"],
                action_state_matrix=self.verified.profile[
                    "action_state_matrix"
                ],
                execution_mode_name=(
                    "current_after_generation_one_bridge"
                ),
                compatibility_bridge=built["bridge"],
            )
        finally:
            os.close(descriptor)

    def test_exact_legacy_generation_one_resume_classifies_once(self):
        action, root, resume, name, profile, python_identity = (
            self.legacy_bridge_records()
        )
        mode = SESSION._classify_resume_execution(
            action,
            root,
            resume,
            name,
            observed_procedure=SHA_C,
            observed_session_procedure=SHA_D,
            python_identity=python_identity,
            execution_profile=profile,
        )
        self.assertEqual(mode.name, "legacy_generation_one")
        self.assertTrue(mode.binding_policy.allow_successor_transition)
        self.assertEqual(
            mode.binding_policy.historical_binding.execution_checkout_sha,
            "b1986e4079b52edbb4ef5cd4c56ed4d20af07195",
        )
        self.assertEqual(
            mode.binding_policy.current_binding.execution_checkout_sha,
            GIT_B,
        )

    def test_legacy_generation_one_rejects_partially_current_execution(self):
        action, root, resume, name, profile, python_identity = (
            self.legacy_bridge_records()
        )
        mutations = {
            "checkout": (
                "execution_checkout_sha",
                action["execution"]["approved_checkout_sha"],
            ),
            "authoring_procedure": (
                "procedure_identity_sha256",
                action["execution"]["approved_procedure_identity_sha256"],
            ),
            "operator_session_procedure": (
                "operator_session_procedure_identity_sha256",
                action["execution"][
                    "approved_operator_session_procedure_identity_sha256"
                ],
            ),
        }
        for label, (field, value) in mutations.items():
            with self.subTest(field=label):
                changed = copy.deepcopy(resume)
                changed[field] = value
                with self.assertRaises(SESSION.OperatorSessionError):
                    SESSION._classify_resume_execution(
                        action,
                        root,
                        changed,
                        name,
                        observed_procedure=SHA_C,
                        observed_session_procedure=SHA_D,
                        python_identity=python_identity,
                        execution_profile=profile,
                    )

    def test_legacy_root_rejects_fully_current_generation_one_resume(self):
        action, root, resume, _name, profile, python_identity = (
            self.legacy_bridge_records()
        )
        changed = copy.deepcopy(resume)
        changed["execution_checkout_sha"] = action["execution"][
            "approved_checkout_sha"
        ]
        changed["procedure_identity_sha256"] = action["execution"][
            "approved_procedure_identity_sha256"
        ]
        changed["operator_session_procedure_identity_sha256"] = action[
            "execution"
        ]["approved_operator_session_procedure_identity_sha256"]
        changed["python_identity_sha256"] = python_identity["identity_sha256"]
        canonical_name = (
            SESSION.CURRENT_RESUME_PREFIX
            + "0000000000000001-"
            + changed["resume_checkpoint_sha256"]
            + ".json"
        )
        with self.assertRaisesRegex(
            SESSION.OperatorSessionError, "history_conflict"
        ):
            SESSION._classify_resume_execution(
                action,
                root,
                changed,
                canonical_name,
                observed_procedure=action["execution"][
                    "approved_procedure_identity_sha256"
                ],
                observed_session_procedure=action["execution"][
                    "approved_operator_session_procedure_identity_sha256"
                ],
                python_identity=python_identity,
                execution_profile=profile,
            )

    def test_legacy_root_rejects_canonical_historical_generation_two_resume(self):
        action, root, resume, _name, profile, python_identity = (
            self.legacy_bridge_records()
        )
        changed = copy.deepcopy(resume)
        changed["resume_generation"] = 2
        canonical_name = (
            SESSION.CURRENT_RESUME_PREFIX
            + "0000000000000002-"
            + changed["resume_checkpoint_sha256"]
            + ".json"
        )
        with self.assertRaisesRegex(
            SESSION.OperatorSessionError, "history_conflict"
        ):
            SESSION._classify_resume_execution(
                action,
                root,
                changed,
                canonical_name,
                observed_procedure=action["execution"][
                    "approved_procedure_identity_sha256"
                ],
                observed_session_procedure=action["execution"][
                    "approved_operator_session_procedure_identity_sha256"
                ],
                python_identity=python_identity,
                execution_profile=profile,
            )

    def test_true_legacy_to_current_generation_two_and_three_chain_passes(self):
        built = self.build_legacy_history("legacy-current-positive")
        self.verify_built_legacy_history(built)
        self.assertEqual(
            [edge["successor"]["resume_generation"] for edge in built["edges"]],
            [2, 3],
        )
        self.assertEqual(
            built["edges"][0]["successor"]["predecessor"]["action"],
            "primary_review",
        )

    def test_legacy_history_rejects_missing_generation_one_evidence(self):
        built = self.build_legacy_history("legacy-missing-generation-one")
        oldest = built["edges"][0]["retired"]
        immediate = built["edges"][-1]["retired"]
        oldest.unlink()
        self.assertTrue(immediate.exists())
        with self.assertRaisesRegex(
            SESSION.OperatorSessionError, "history_conflict"
        ):
            self.verify_built_legacy_history(built)

    def test_legacy_history_rejects_altered_generation_one_evidence(self):
        built = self.build_legacy_history("legacy-altered-generation-one")
        oldest = built["edges"][0]["retired"]
        oldest.chmod(0o600)
        oldest.write_bytes(b"{}\n")
        oldest.chmod(0o400)
        with self.assertRaisesRegex(
            SESSION.OperatorSessionError, "history_conflict"
        ):
            self.verify_built_legacy_history(built)

    def test_legacy_history_rejects_coherent_older_link_identity_drift(self):
        mutations = {
            "authoring_procedure": lambda resume: resume.__setitem__(
                "procedure_identity_sha256", SHA_A
            ),
            "operator_session_procedure": lambda resume: resume.__setitem__(
                "operator_session_procedure_identity_sha256", SHA_A
            ),
            "python": lambda resume: resume.__setitem__(
                "python_identity_sha256", SHA_B
            ),
            "session": lambda resume: resume.__setitem__(
                "authoring_session_identity", "substituted-older-session"
            ),
        }
        for label, mutation in mutations.items():
            with self.subTest(field=label):
                built = self.build_legacy_history(
                    "legacy-older-drift-" + label,
                    generation_two_mutation=mutation,
                    extra_current_edge=True,
                )
                self.assertEqual(
                    [
                        edge["successor"]["resume_generation"]
                        for edge in built["edges"]
                    ],
                    [2, 3, 4],
                )
                with self.assertRaisesRegex(
                    SESSION.OperatorSessionError, "history_conflict"
                ):
                    self.verify_built_legacy_history(built)

    def test_legacy_history_rejects_generation_skip(self):
        built = self.build_legacy_history(
            "legacy-generation-skip", final_generation=4
        )
        with self.assertRaisesRegex(
            SESSION.OperatorSessionError, "history_conflict"
        ):
            self.verify_built_legacy_history(built)

    def test_legacy_history_rejects_more_than_one_execution_transition(self):
        built = self.build_legacy_history(
            "legacy-second-transition",
            second_historical_transition=True,
        )
        with self.assertRaisesRegex(
            SESSION.OperatorSessionError, "history_conflict"
        ):
            self.verify_built_legacy_history(built)

    def test_bridge_rejects_old_to_current_generation_one_status_hop(self):
        built = self.build_legacy_history(
            "legacy-current-generation-one-hop",
            insert_current_generation_one=True,
        )
        self.assertEqual(
            [edge["successor"]["resume_generation"] for edge in built["edges"]],
            [1, 2, 3],
        )
        with self.assertRaisesRegex(
            SESSION.OperatorSessionError, "history_conflict"
        ):
            self.verify_built_legacy_history(built)

    def test_predecessor_history_depth_is_bounded(self):
        built = self.build_legacy_history("legacy-depth-bound")
        with mock.patch.object(SESSION, "MAX_RESUME_HISTORY_DEPTH", 1):
            with self.assertRaisesRegex(
                SESSION.OperatorSessionError, "history_conflict"
            ):
                self.verify_built_legacy_history(built)

    def test_predecessor_cycle_reaches_visited_hash_guard(self):
        action, root, template, _name, _profile, python_identity = (
            self.legacy_bridge_records()
        )
        root = copy.deepcopy(root)
        root["execution"] = copy.deepcopy(action["execution"])
        root_sha256 = hashlib.sha256(
            capture_contract.canonical_json_bytes(root)
        ).hexdigest()
        checkpoint_sha256 = self.digest_for("cycle-checkpoint")
        name_a = (
            SESSION.CURRENT_RESUME_PREFIX
            + "0000000000000001-"
            + checkpoint_sha256
            + "-"
            + SHA_A[:16]
            + ".json"
        )
        name_b = (
            SESSION.CURRENT_RESUME_PREFIX
            + "0000000000000001-"
            + checkpoint_sha256
            + "-"
            + SHA_B[:16]
            + ".json"
        )

        def cyclic_resume(name, resume_sha, action_sha):
            record = copy.deepcopy(template)
            record["authorization_sha256"] = root_sha256
            record["execution_checkout_sha"] = action["execution"][
                "approved_checkout_sha"
            ]
            record["procedure_identity_sha256"] = action["execution"][
                "approved_procedure_identity_sha256"
            ]
            record[
                "operator_session_procedure_identity_sha256"
            ] = action["execution"][
                "approved_operator_session_procedure_identity_sha256"
            ]
            record["resume_checkpoint_sha256"] = checkpoint_sha256
            record["resume_generation"] = 1
            record["resume_release_token"] = self.digest_for(
                "cycle-release-" + name
            )
            record["predecessor"] = {
                "action": "status",
                "action_authorization_sha256": action_sha,
                "resume_name": name,
                "resume_sha256": resume_sha,
            }
            return record

        resume_a = cyclic_resume(name_b, SHA_B, SHA_C)
        resume_b = cyclic_resume(name_a, SHA_A, SHA_D)
        retired_b_name = (
            SESSION.RETIRED_RESUME_PREFIX
            + "0000000000000001-"
            + SHA_A[:16]
            + ".json"
        )
        retired_a_name = (
            SESSION.RETIRED_RESUME_PREFIX
            + "0000000000000001-"
            + SHA_B[:16]
            + ".json"
        )
        action_c_name = "authorization-action-" + SHA_C[:16] + ".json"
        action_d_name = "authorization-action-" + SHA_D[:16] + ".json"
        root_name = "authorization-root-" + root_sha256[:16] + ".json"
        records = {
            root_name: (
                root,
                types.SimpleNamespace(sha256=root_sha256),
            ),
            name_a: (
                resume_a,
                types.SimpleNamespace(sha256=SHA_A),
            ),
            retired_b_name: (
                resume_b,
                types.SimpleNamespace(sha256=SHA_B),
            ),
            retired_a_name: (
                resume_a,
                types.SimpleNamespace(sha256=SHA_A),
            ),
            action_c_name: ({}, types.SimpleNamespace(sha256=SHA_C)),
            action_d_name: ({}, types.SimpleNamespace(sha256=SHA_D)),
        }
        names = list(records)
        root_bytes = capture_contract.canonical_json_bytes(root)
        resume_a_bytes = capture_contract.canonical_json_bytes(resume_a)
        resume_b_bytes = capture_contract.canonical_json_bytes(resume_b)

        def synthetic_sha(data):
            if data == root_bytes:
                return root_sha256
            if data == resume_a_bytes:
                return SHA_A
            if data == resume_b_bytes:
                return SHA_B
            return hashlib.sha256(data).hexdigest()

        shape_check = mock.Mock(return_value=True)
        evidence_check = mock.Mock(return_value=True)
        with (
            mock.patch.object(SESSION.os, "listdir", return_value=names),
            mock.patch.object(
                SESSION,
                "_stable_canonical_private_json_at",
                side_effect=lambda _fd, name: records[name],
            ),
            mock.patch.object(
                SESSION,
                "_validate_loaded_resume_record",
                side_effect=lambda value, **_kwargs: value,
            ),
            mock.patch.object(
                SESSION, "_current_resume_shape_matches", shape_check
            ),
            mock.patch.object(
                SESSION, "_historical_evidence_matches", evidence_check
            ),
            mock.patch.object(SESSION, "sha256_bytes", side_effect=synthetic_sha),
        ):
            with self.assertRaisesRegex(
                SESSION.OperatorSessionError, "history_conflict"
            ):
                SESSION._verify_predecessor_chain_at(
                    9,
                    base_authorization=root,
                    resume=resume_a,
                    resume_name=name_a,
                    resume_sha256=SHA_A,
                    expected_execution=action["execution"],
                    expected_python_identity_sha256=python_identity[
                        "identity_sha256"
                    ],
                    action_state_matrix=self.verified.profile[
                        "action_state_matrix"
                    ],
                    execution_mode_name="current",
                    compatibility_bridge=None,
                )
        self.assertEqual(shape_check.call_count, 4)
        self.assertEqual(evidence_check.call_count, 2)

    def test_legacy_generation_one_bridge_rejects_every_reuse_shape(self):
        action, root, resume, name, profile, python_identity = (
            self.legacy_bridge_records()
        )
        cases = []
        changed = dict(resume)
        changed["resume_generation"] = 2
        cases.append(("generation_two", action, root, changed, name))
        changed = dict(resume)
        changed["format_version"] = 1
        cases.append(("legacy_resume_format", action, root, changed, name))
        changed = dict(resume)
        changed["predecessor"] = {
            "action": "primary_review",
            "action_authorization_sha256": SHA_A,
            "resume_name": name,
            "resume_sha256": SHA_B,
        }
        cases.append(("predecessor_present", action, root, changed, name))
        changed_action = dict(action)
        changed_action["action"] = "status"
        cases.append(("wrong_action", changed_action, root, resume, name))
        changed_action = dict(action)
        changed_action["expected_authoring_state"] = "REVISIT_REQUIRED"
        cases.append(("wrong_state", changed_action, root, resume, name))
        changed = dict(resume)
        changed["procedure_identity_sha256"] = SHA_A
        cases.append(("wrong_procedure", action, root, changed, name))
        changed = dict(resume)
        changed["python_identity_sha256"] = SHA_B
        cases.append(("wrong_python", action, root, changed, name))
        changed_root = copy.deepcopy(root)
        changed_root["capture"]["unexpected"] = SHA_A
        cases.append(("extra_capture_field", action, changed_root, resume, name))
        changed_root = copy.deepcopy(root)
        del changed_root["capture"]["raw_toc_sha256"]
        cases.append(("missing_capture_field", action, changed_root, resume, name))
        changed_root = copy.deepcopy(root)
        changed_root["operator_identity"] = "Another Reviewer"
        cases.append(("root_operator_changed", action, changed_root, resume, name))
        changed_root = copy.deepcopy(root)
        changed_root["session_id"] = "unsafe/session"
        cases.append(("root_session_changed", action, changed_root, resume, name))
        cases.append(("wrong_name", action, root, resume, "resume-current-wrong.json"))
        for label, selected_action, selected_root, selected_resume, selected_name in cases:
            with self.subTest(case=label):
                with self.assertRaises(SESSION.OperatorSessionError):
                    SESSION._classify_resume_execution(
                        selected_action,
                        selected_root,
                        selected_resume,
                        selected_name,
                        observed_procedure=SHA_C,
                        observed_session_procedure=SHA_D,
                        python_identity=python_identity,
                        execution_profile=profile,
                    )

    def test_exact_current_resume_requires_v2_schema_and_canonical_name(self):
        action, root, resume, _name, profile, python_identity = (
            self.legacy_bridge_records()
        )
        root = copy.deepcopy(root)
        root["execution"] = copy.deepcopy(action["execution"])
        resume = copy.deepcopy(resume)
        resume["execution_checkout_sha"] = action["execution"][
            "approved_checkout_sha"
        ]
        resume["procedure_identity_sha256"] = SHA_C
        resume["operator_session_procedure_identity_sha256"] = SHA_D
        resume["python_identity_sha256"] = python_identity["identity_sha256"]
        name = (
            SESSION.CURRENT_RESUME_PREFIX
            + f"{resume['resume_generation']:016d}-"
            + resume["resume_checkpoint_sha256"]
            + ".json"
        )
        mode = SESSION._classify_resume_execution(
            action,
            root,
            resume,
            name,
            observed_procedure=SHA_C,
            observed_session_procedure=SHA_D,
            python_identity=python_identity,
            execution_profile=profile,
        )
        self.assertEqual(mode.name, "current")

        cases = []
        changed = copy.deepcopy(resume)
        changed["format_version"] = 1
        cases.append(("format_v1", changed, name))
        changed = copy.deepcopy(resume)
        changed["unknown"] = True
        cases.append(("extra_key", changed, name))
        changed = copy.deepcopy(resume)
        del changed["capture"]
        cases.append(("missing_key", changed, name))
        cases.append(("wrong_name", resume, name.replace(".json", "-wrong.json")))
        for label, candidate, candidate_name in cases:
            with self.subTest(case=label):
                with self.assertRaises(SESSION.OperatorSessionError):
                    SESSION._classify_resume_execution(
                        action,
                        root,
                        candidate,
                        candidate_name,
                        observed_procedure=SHA_C,
                        observed_session_procedure=SHA_D,
                        python_identity=python_identity,
                        execution_profile=profile,
                    )

    def test_post_bridge_current_resume_requires_predecessor_and_hash_suffix(self):
        action, root, resume, _name, profile, python_identity = (
            self.legacy_bridge_records()
        )
        resume = copy.deepcopy(resume)
        resume["execution_checkout_sha"] = action["execution"][
            "approved_checkout_sha"
        ]
        resume["procedure_identity_sha256"] = SHA_C
        resume["operator_session_procedure_identity_sha256"] = SHA_D
        resume["python_identity_sha256"] = python_identity["identity_sha256"]
        resume["resume_generation"] = 2
        resume["predecessor"] = {
            "action": "primary_review",
            "action_authorization_sha256": SHA_A,
            "resume_name": "resume-current-g0000000000000001-" + SHA_B + ".json",
            "resume_sha256": SHA_C,
        }
        base = (
            SESSION.CURRENT_RESUME_PREFIX
            + "0000000000000002-"
            + resume["resume_checkpoint_sha256"]
        )
        canonical_name = (
            base
            + "-"
            + hashlib.sha256(
                capture_contract.canonical_json_bytes(resume)
            ).hexdigest()[:16]
            + ".json"
        )
        mode = SESSION._classify_resume_execution(
            action,
            root,
            resume,
            canonical_name,
            observed_procedure=SHA_C,
            observed_session_procedure=SHA_D,
            python_identity=python_identity,
            execution_profile=profile,
        )
        self.assertEqual(mode.name, "current_after_generation_one_bridge")
        for candidate in (
            {key: value for key, value in resume.items() if key != "predecessor"},
            {**resume, "format_version": 1},
        ):
            with self.assertRaises(SESSION.OperatorSessionError):
                SESSION._classify_resume_execution(
                    action,
                    root,
                    candidate,
                    canonical_name,
                    observed_procedure=SHA_C,
                    observed_session_procedure=SHA_D,
                    python_identity=python_identity,
                    execution_profile=profile,
                )
        with self.assertRaises(SESSION.OperatorSessionError):
            SESSION._classify_resume_execution(
                action,
                root,
                resume,
                base + ".json",
                observed_procedure=SHA_C,
                observed_session_procedure=SHA_D,
                python_identity=python_identity,
                execution_profile=profile,
            )

    def test_synthetic_real_format_generation_one_bridges_without_rewrite(self):
        legacy_checkout = "b1986e4079b52edbb4ef5cd4c56ed4d20af07195"
        legacy_authoring = (
            "bc0b990d878db1e2c72bd4ac91314fe32261a454ac38505b7ea6df4af2b5f3d8"
        )
        legacy_session_procedure = (
            "ee0dbb3ecb9b469bef49c1fe0305ea60602bbbbaddd2f551a7774dad6cacdc23"
        )
        legacy_python_sha = (
            "4b42b1a117605cafc8607b67b0892a609c2cd125012dd56288abeed8c89cdfb1"
        )
        profile = copy.deepcopy(self.verified.profile)
        bridge_python = profile["compatibility_bridges"][0]["python"]
        profile["python_policy"]["absolute_path"] = profile[
            "compatibility_bridges"
        ][0]["python"]["absolute_path"]
        profile["python_policy"]["reported_version"] = profile[
            "compatibility_bridges"
        ][0]["python"]["reported_version"]
        profile["python_policy"]["sha256"] = legacy_python_sha
        verified = types.SimpleNamespace(**vars(self.verified))
        verified.profile = profile
        synthetic_full_python_identity = self.digest_for(
            "historical-full-python-identity"
        )

        package_fd = os.open(
            self.package,
            os.O_RDONLY
            | getattr(os, "O_DIRECTORY", 0)
            | getattr(os, "O_NOFOLLOW", 0),
        )
        try:
            capture = AUTHOR.load_capture_for_authoring(
                package_fd, self.expectations
            )
        finally:
            os.close(package_fd)
        self.annotation_root.mkdir(mode=0o700)
        checkpoints = self.annotation_root / AUTHOR.CHECKPOINTS_NAME
        checkpoints.mkdir(mode=0o700)
        historical_binding = AUTHOR.AuthoringBinding(
            execution_checkout_sha=legacy_checkout,
            procedure_identity_sha256=legacy_authoring,
            execution_python_identity_sha256=legacy_python_sha,
        )
        initial = AUTHOR.initialize_checkpoint(
            capture,
            historical_binding,
            "Primary Reviewer",
            "legacy-authoring-session",
        )
        checkpoints_fd = os.open(
            checkpoints,
            os.O_RDONLY
            | getattr(os, "O_DIRECTORY", 0)
            | getattr(os, "O_NOFOLLOW", 0),
        )
        try:
            initial_name = AUTHOR.publish_checkpoint_at(checkpoints_fd, initial)
        finally:
            os.close(checkpoints_fd)
        initial_path = checkpoints / initial_name
        initial_bytes = initial_path.read_bytes()
        initial_sha = hashlib.sha256(initial_bytes).hexdigest()
        release_token = self.digest_for("legacy-authoring-release")
        released = self.annotation_root / AUTHOR.RELEASED_NAME
        released.write_bytes(AUTHOR._lock_content(release_token))
        released.chmod(0o400)

        self.session_root.mkdir(mode=0o700)
        root_authorization = {
            "action": "initialize",
            "annotation_root": os.fspath(self.annotation_root),
            "artifact_kind": SESSION.AUTHORIZATION_KIND,
            "authoring_session_identity": "legacy-authoring-session",
            "capture": {
                "approved_pg_restore_sha256": self.expectations.approved_pg_restore_sha256,
                "capture_execution_checkout_sha": self.expectations.capture_execution_checkout_sha,
                "capture_manifest_sha256": self.expectations.capture_manifest_sha256,
                "capture_name": self.package.name,
                "capture_procedure_identity_sha256": self.expectations.capture_procedure_identity_sha256,
                "capture_root": os.fspath(self.capture_root),
                "data_reference_count": self.expectations.data_reference_count,
                "entry_count": self.expectations.entry_count,
                "evidence_manifest_sha256": self.expectations.evidence_manifest_sha256,
                "evidence_run_id": self.expectations.evidence_run_id,
                "inner_sha256": self.expectations.inner_archive_sha256,
                "inspection_checkout_sha": self.expectations.inspection_checkout_sha,
                "inspection_procedure_sha256": self.expectations.inspection_procedure_sha256,
                "opaque_index_sha256": self.expectations.opaque_index_sha256,
                "outer_sha256": self.expectations.outer_archive_sha256,
                "raw_toc_sha256": self.expectations.raw_toc_sha256,
            },
            "execution": {
                "approved_checkout_sha": legacy_checkout,
                "approved_operator_session_procedure_identity_sha256": legacy_session_procedure,
                "approved_procedure_identity_sha256": legacy_authoring,
                "python": {
                    "path": bridge_python["absolute_path"],
                    "sha256": bridge_python["sha256"],
                    "version": bridge_python["reported_version"],
                },
            },
            "finalization_authorization": "",
            "format_version": SESSION.FORMAT_VERSION,
            "initial_head": {
                "checkpoint_sha256": ZERO64,
                "generation": 0,
                "release_token": ZERO64,
            },
            "operator_identity": "Primary Reviewer",
            "primary_operator_identity": "Primary Reviewer",
            "session_id": "legacy-operator-session",
            "session_root": os.fspath(self.session_root),
            "tty_attestation": SESSION.TTY_ATTESTATION,
        }
        root_data = capture_contract.canonical_json_bytes(root_authorization)
        root_sha = hashlib.sha256(root_data).hexdigest()
        root_path = self.session_root / (
            "authorization-root-" + root_sha[:16] + ".json"
        )
        root_path.write_bytes(root_data)
        root_path.chmod(0o400)
        root_bytes = root_path.read_bytes()
        resume = {
            "annotation_root": os.fspath(self.annotation_root),
            "artifact_kind": SESSION.RESUME_KIND,
            "authorization_sha256": root_sha,
            "authoring_session_identity": "legacy-authoring-session",
            "capture": {
                "capture_manifest_sha256": self.expectations.capture_manifest_sha256,
                "evidence_run_id": self.expectations.evidence_run_id,
                "opaque_index_sha256": self.expectations.opaque_index_sha256,
                "raw_toc_sha256": self.expectations.raw_toc_sha256,
            },
            "execution_checkout_sha": legacy_checkout,
            "format_version": SESSION.RESUME_FORMAT_VERSION,
            "operator_session_procedure_identity_sha256": legacy_session_procedure,
            "primary_operator_identity": "Primary Reviewer",
            "procedure_identity_sha256": legacy_authoring,
            "python_identity_sha256": synthetic_full_python_identity,
            "resume_checkpoint_sha256": initial_sha,
            "resume_generation": 1,
            "resume_release_token": release_token,
        }
        resume_name = (
            SESSION.CURRENT_RESUME_PREFIX
            + "0000000000000001-"
            + initial_sha
            + ".json"
        )
        resume_path = self.session_root / resume_name
        resume_path.write_bytes(capture_contract.canonical_json_bytes(resume))
        resume_path.chmod(0o400)
        resume_bytes = resume_path.read_bytes()
        action_authorization = {
            "action": "primary_review",
            "artifact_kind": SESSION.ACTION_AUTHORIZATION_KIND,
            "authoring_session_identity": "current-primary-session",
            "execution": SESSION._execution_from_preflight(verified),
            "expected_authoring_state": "PRIMARY_REVIEW_REQUIRED",
            "finalization_authorization": "",
            "format_version": SESSION.ACTION_AUTHORIZATION_FORMAT_VERSION,
            "operator_identity": "Primary Reviewer",
            "primary_operator_identity": "",
            "session_id": "current-operator-session",
            "session_root": os.fspath(self.session_root),
            "tty_attestation": SESSION.TTY_ATTESTATION,
        }

        def primary_updates(_action, checkpoint, _capture, ordinals, _tty_fd):
            updates = []
            for ordinal in ordinals:
                decision = copy.deepcopy(
                    checkpoint["entries"][ordinal]["primary_decision"]
                )
                decision["classification"] = "unresolved"
                decision["classification_reviewed"] = True
                decision["manual_conflict_review_state"] = "not_applicable"
                updates.append(
                    {"ordinal": ordinal, "primary_decision": decision}
                )
            return tuple(updates)

        with mock.patch.object(
            SESSION, "_operator_session_procedure_identity", return_value=SHA_D
        ), mock.patch.object(
            SESSION, "_procedure_identity", return_value=SHA_C
        ), mock.patch.object(
            SESSION,
            "_validated_python_identity",
            return_value={
                "identity_sha256": synthetic_full_python_identity,
                "sha256": legacy_python_sha,
            },
        ), mock.patch.object(
            AUTHOR, "_authoring_procedure_identity", return_value=SHA_C
        ), mock.patch.object(
            AUTHOR,
            "_validate_execution_python",
            return_value={"sha256": legacy_python_sha},
        ), mock.patch.object(
            AUTHOR, "_entry_updates", side_effect=primary_updates
        ), mock.patch.object(
            AUTHOR, "_global_updates", return_value=({}, {})
        ), mock.patch.object(
            AUTHOR, "_write_tty", return_value=None
        ), mock.patch.object(
            AUTHOR, "_require_resume_acknowledgement", return_value=None
        ), mock.patch.object(
            SESSION, "_tty_write", return_value=None
        ), mock.patch.object(
            SESSION, "_read_line", return_value="action_authorization_recorded"
        ):
            status, _diagnostic = SESSION._run_resume_session(
                action_authorization,
                9,
                verified,
            )
        self.assertEqual(status, 2)
        self.assertEqual(initial_path.read_bytes(), initial_bytes)
        self.assertEqual(root_path.read_bytes(), root_bytes)
        current_resumes = [
            path
            for path in self.session_root.iterdir()
            if path.name.startswith(SESSION.CURRENT_RESUME_PREFIX)
        ]
        self.assertEqual(len(current_resumes), 1)
        successor_resume = self.load_private_json(current_resumes[0])
        self.assertEqual(successor_resume["resume_generation"], 2)
        self.assertEqual(successor_resume["execution_checkout_sha"], GIT_A)
        self.assertEqual(
            successor_resume["predecessor"]["resume_sha256"],
            hashlib.sha256(
                capture_contract.canonical_json_bytes(resume)
            ).hexdigest(),
        )
        self.assertFalse(resume_path.exists())
        retired = [
            path
            for path in self.session_root.iterdir()
            if path.name.startswith(SESSION.RETIRED_RESUME_PREFIX)
        ]
        self.assertEqual(len(retired), 1)
        self.assertEqual(retired[0].read_bytes(), resume_bytes)
        checkpoints_fd = os.open(
            checkpoints,
            os.O_RDONLY
            | getattr(os, "O_DIRECTORY", 0)
            | getattr(os, "O_NOFOLLOW", 0),
        )
        try:
            chain = AUTHOR.load_checkpoint_chain(
                checkpoints_fd,
                capture,
                AUTHOR.AuthoringBinding(GIT_A, SHA_C, legacy_python_sha),
                binding_policy=AUTHOR.GenerationOneBindingPolicy(
                    historical_binding=historical_binding,
                    current_binding=AUTHOR.AuthoringBinding(
                        GIT_A, SHA_C, legacy_python_sha
                    ),
                    allow_successor_transition=False,
                ),
            )
        finally:
            os.close(checkpoints_fd)
        self.assertEqual(len(chain.checkpoints), 2)
        self.assertEqual(
            chain.checkpoints[0]["authoring_binding"],
            historical_binding.as_dict(),
        )
        self.assertEqual(
            chain.checkpoints[1]["authoring_binding"],
            AUTHOR.AuthoringBinding(GIT_A, SHA_C, legacy_python_sha).as_dict(),
        )

    def test_historical_generation_one_checkpoint_golden_is_unchanged(self):
        capture = authoring_contract.AuthoringCapture(
            {
                "capture_manifest_sha256": "a" * 64,
                "evidence_run_id": "synthetic-run",
                "opaque_index_sha256": "b" * 64,
                "raw_toc_sha256": "c" * 64,
            },
            (
                authoring_contract.AuthoringEntry(
                    "d" * 64,
                    0,
                    "TABLE",
                    False,
                    b"SYNTHETIC",
                ),
            ),
            1,
            2,
        )
        checkpoint = AUTHOR.initialize_checkpoint(
            capture,
            AUTHOR.AuthoringBinding("e" * 40, "f" * 64, "1" * 64),
            "Primary Reviewer",
            "legacy-session",
        )
        self.assertEqual(
            hashlib.sha256(
                capture_contract.canonical_json_bytes(checkpoint)
            ).hexdigest(),
            # Generated independently from the reviewed b1986e407 checkout.
            "302964bdf391192b6ce7b1b4818983d96128cecd34cf900ce164b098e4b22974",
        )

    def test_historical_generation_one_root_and_resume_golden_are_unchanged(self):
        _action, root, resume, _name, _profile, _python = (
            self.legacy_bridge_records()
        )
        self.assertEqual(root["format_version"], 1)
        self.assertEqual(resume["format_version"], 2)
        self.assertEqual(
            hashlib.sha256(
                capture_contract.canonical_json_bytes(root)
            ).hexdigest(),
            "96d539b3d9871ca7256ea42274b7fe68e5bcc4a1cbbdcac20712302f6a7f09a7",
        )
        self.assertEqual(
            hashlib.sha256(
                capture_contract.canonical_json_bytes(resume)
            ).hexdigest(),
            "36eb0e992b5ccbaedf51829ddb2e2efe90a5de537b39d714c41f209b5f8c7e7c",
        )

    def test_legacy_bridge_requires_pristine_operator_session_history(self):
        root = self.root / "legacy-session-history"
        root.mkdir(mode=0o700)
        root_sha = SHA_A
        resume_name = (
            SESSION.CURRENT_RESUME_PREFIX
            + "0000000000000001-"
            + SHA_B
            + ".json"
        )
        for name in (
            SESSION.OPERATOR_SESSION_LOCK_NAME,
            "authorization-root-" + root_sha[:16] + ".json",
            resume_name,
        ):
            (root / name).write_bytes(b"synthetic\n")
            (root / name).chmod(0o400)
        descriptor = os.open(
            root,
            os.O_RDONLY
            | getattr(os, "O_DIRECTORY", 0)
            | getattr(os, "O_NOFOLLOW", 0),
        )
        try:
            SESSION._require_pristine_legacy_session_root(
                descriptor,
                root_authorization_sha256=root_sha,
                resume_name=resume_name,
            )
            for extra_name in (
                "authorization-action-stale.json",
                "resume-retired-g0000000000000001-stale.json",
                "resume-terminal-g0000000000000001-stale.json",
                "unrelated-private-record",
            ):
                extra = root / extra_name
                extra.write_bytes(b"synthetic\n")
                extra.chmod(0o400)
                with self.subTest(extra=extra_name):
                    with self.assertRaises(SESSION.OperatorSessionError):
                        SESSION._require_pristine_legacy_session_root(
                            descriptor,
                            root_authorization_sha256=root_sha,
                            resume_name=resume_name,
                        )
                extra.unlink()
        finally:
            os.close(descriptor)

    def test_post_open_procedure_checks_use_the_profile_formulas(self):
        checkout = subprocess.run(
            ["/usr/bin/git", "rev-parse", "HEAD"],
            cwd=ROOT,
            check=True,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        ).stdout.strip()
        profile = SESSION.PREFLIGHT.validate_profile(
            SESSION.PREFLIGHT.strict_canonical_json_loads(
                (
                    MIGRATION
                    / "verification"
                    / "lovable-toc-operator-execution-profile.v1.json"
                ).read_bytes(),
                maximum_bytes=SESSION.PREFLIGHT.PROFILE_MAX_BYTES,
                reason="execution_profile_invalid",
            )
        )
        blobs = {}
        for relative in profile["reviewed_files"]:
            blobs[relative] = subprocess.run(
                ["/usr/bin/git", "rev-parse", f"{checkout}:{relative}"],
                cwd=ROOT,
                check=True,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            ).stdout.strip()

        def expected(formula_name):
            record = {"execution_checkout_sha": checkout}
            for relative in profile["procedure_identity_formulas"][formula_name][
                "files"
            ]:
                record[relative] = blobs[relative]
            return hashlib.sha256(
                capture_contract.canonical_json_bytes(record)
            ).hexdigest()

        self.assertEqual(
            AUTHOR._authoring_procedure_identity(checkout),
            expected("authoring"),
        )
        self.assertEqual(
            SESSION._operator_session_procedure_identity(checkout),
            expected("operator_session"),
        )

    def test_initialize_creates_private_authorization_and_resume_records(self):
        status, diagnostic = self.run_with_responses(self.responses())[0]
        self.assertEqual(status, 2)
        visible = json.loads(diagnostic)
        self.assertEqual(visible["review_gate"], "REVIEW_REQUIRED")
        self.assertEqual(visible["authoring_state"], "PRIMARY_REVIEW_REQUIRED")

        self.assertTrue(self.session_root.is_dir())
        self.assertTrue(self.annotation_root.is_dir())
        self.assertEqual(stat.S_IMODE(self.session_root.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(self.annotation_root.stat().st_mode), 0o700)

        session_names = sorted(path.name for path in self.session_root.iterdir())
        authorization_names = [name for name in session_names if name.startswith("authorization-")]
        resume_names = [name for name in session_names if name.startswith("resume-current-g")]
        self.assertEqual(len(authorization_names), 1)
        self.assertEqual(len(resume_names), 1)
        for name in authorization_names + resume_names:
            path = self.session_root / name
            metadata = path.stat()
            self.assertEqual(stat.S_IMODE(metadata.st_mode), 0o400)
            self.assertEqual(metadata.st_nlink, 1)

        authorization = capture_contract.strict_json_loads(
            (self.session_root / authorization_names[0]).read_bytes()
        )
        resume = capture_contract.strict_json_loads(
            (self.session_root / resume_names[0]).read_bytes()
        )
        authorization_sha = hashlib.sha256(
            capture_contract.canonical_json_bytes(authorization)
        ).hexdigest()
        self.assertEqual(resume["authorization_sha256"], authorization_sha)
        self.assertEqual(resume["resume_generation"], 1)
        self.assertRegex(resume["resume_checkpoint_sha256"], r"^[0-9a-f]{64}$")
        self.assertRegex(resume["resume_release_token"], r"^[0-9a-f]{64}$")

        checkpoint_names = list((self.annotation_root / AUTHOR.CHECKPOINTS_NAME).iterdir())
        self.assertEqual(len(checkpoint_names), 1)
        self.assertIn(resume["resume_checkpoint_sha256"], checkpoint_names[0].name)
        self.assertFalse((self.annotation_root / AUTHOR.LOCK_NAME).exists())
        self.assertTrue((self.annotation_root / AUTHOR.RELEASED_NAME).exists())

        combined_output = diagnostic + b"".join(
            path.read_bytes() for path in self.session_root.iterdir()
        )
        for sentinel in (b"synthetic-private-object", b"opaque-id.key", b"raw-pg-restore-list"):
            self.assertNotIn(sentinel, diagnostic)
        self.assertNotIn(b"synthetic-private-object", combined_output)

    def test_operator_mismatch_rejects_before_private_roots_exist(self):
        capture_before = immutable_tree_snapshot(self.capture_root)
        with self.assertRaises(SESSION.OperatorSessionError) as raised:
            self.run_with_responses(
                self.responses(operator="primary reviewer")
            )
        self.assertEqual(raised.exception.reason, "binding_mismatch")
        self.assertFalse(self.session_root.exists())
        self.assertFalse(self.annotation_root.exists())
        self.assertEqual(immutable_tree_snapshot(self.capture_root), capture_before)

    def test_ack_failure_marks_session_indeterminate_and_never_initializes(self):
        with self.assertRaises(SESSION.OperatorSessionError) as raised:
            self.run_with_responses(self.responses(authorization_ack="wrong"))
        self.assertEqual(raised.exception.reason, "input_invalid")
        self.assertTrue((self.session_root / "OPERATOR_SESSION_INDETERMINATE").exists())
        self.assertFalse(self.annotation_root.exists())
        self.assertFalse(any(path.name.startswith("resume-g") for path in self.session_root.iterdir()))

    def test_no_replace_rejects_preexisting_session_or_annotation_root(self):
        self.session_root.mkdir(mode=0o700)
        with self.assertRaises(SESSION.OperatorSessionError) as raised:
            self.run_with_responses(self.responses())
        self.assertEqual(raised.exception.reason, "history_conflict")
        self.assertFalse(self.annotation_root.exists())

        self.session_root.rmdir()
        self.annotation_root.mkdir(mode=0o700)
        with self.assertRaises(SESSION.OperatorSessionError) as raised:
            self.run_with_responses(self.responses())
        self.assertEqual(raised.exception.reason, "history_conflict")

    def test_resume_record_consumption_rejects_duplicate_json_keys(self):
        self.session_root.mkdir(mode=0o700)
        record = self.session_root / ("resume-g0000000000000001-" + ("a" * 64) + ".json")
        record.write_bytes(
            b'{"artifact_kind":"lovable_toc_operator_resume",'
            b'"artifact_kind":"lovable_toc_operator_resume"}\n'
        )
        record.chmod(0o400)
        root_fd = os.open(
            self.session_root,
            os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0),
        )
        try:
            with self.assertRaises(SESSION.OperatorSessionError) as raised:
                SESSION.validate_resume_record_at(
                    root_fd,
                    record.name,
                    authorization_sha256=SHA_A,
                    expected_generation=1,
                    expected_checkpoint_sha256="a" * 64,
                    expected_operator_identity="Primary Reviewer",
                    expected_session_id="operator-session-1",
                )
        finally:
            os.close(root_fd)
        self.assertEqual(raised.exception.reason, "history_conflict")

    def test_resume_record_consumption_returns_token_only_on_exact_match(self):
        status, _diagnostic = self.run_with_responses(self.responses())[0]
        self.assertEqual(status, 2)
        resume_path = next(path for path in self.session_root.iterdir() if path.name.startswith("resume-current-g"))
        authorization_path = next(path for path in self.session_root.iterdir() if path.name.startswith("authorization-root-"))
        authorization = capture_contract.strict_json_loads(authorization_path.read_bytes())
        authorization_sha = hashlib.sha256(
            capture_contract.canonical_json_bytes(authorization)
        ).hexdigest()
        resume = capture_contract.strict_json_loads(resume_path.read_bytes())
        root_fd = os.open(
            self.session_root,
            os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0),
        )
        try:
            token = SESSION.validate_resume_record_at(
                root_fd,
                resume_path.name,
                authorization_sha256=authorization_sha,
                expected_generation=1,
                expected_checkpoint_sha256=resume["resume_checkpoint_sha256"],
                expected_operator_identity="Primary Reviewer",
            )
            self.assertEqual(token, resume["resume_release_token"])
            with self.assertRaises(SESSION.OperatorSessionError):
                SESSION.validate_resume_record_at(
                    root_fd,
                    resume_path.name,
                    authorization_sha256=authorization_sha,
                    expected_generation=1,
                    expected_checkpoint_sha256="b" * 64,
                    expected_operator_identity="Primary Reviewer",
                    expected_session_id="operator-session-1",
                )
        finally:
            os.close(root_fd)

    def test_mixed_current_and_legacy_active_resume_names_fail_closed(self):
        self.initialize_operator_session()
        current = self.current_resume_path()
        legacy = self.session_root / (
            "resume-g0000000000000001-" + SHA_A + ".json"
        )
        legacy.write_bytes(current.read_bytes())
        legacy.chmod(0o400)
        with self.assertRaises(SESSION.OperatorSessionError) as raised:
            self.run_with_responses(
                self.action_responses(
                    "status", expected_state="PRIMARY_REVIEW_REQUIRED"
                ),
                execute_authoring_side_effect=AssertionError(
                    "mixed active resume namespace dispatched"
                ),
            )
        self.assertEqual(raised.exception.reason, "history_conflict")
        self.assertTrue(current.exists())
        self.assertTrue(legacy.exists())
        self.assertTrue(
            (self.session_root / "OPERATOR_SESSION_INDETERMINATE").exists()
        )

    def test_multiple_legacy_active_resume_names_fail_closed(self):
        legacy_root = self.root / "multiple-legacy-active-resumes"
        legacy_root.mkdir(mode=0o700)
        for suffix in (SHA_A, SHA_B):
            path = legacy_root / (
                "resume-g0000000000000001-" + suffix + ".json"
            )
            path.write_bytes(b"{}\n")
            path.chmod(0o400)
        descriptor = os.open(
            legacy_root,
            os.O_RDONLY
            | getattr(os, "O_DIRECTORY", 0)
            | getattr(os, "O_NOFOLLOW", 0),
        )
        try:
            with self.assertRaisesRegex(
                SESSION.OperatorSessionError, "history_conflict"
            ):
                SESSION._active_resume_name(descriptor)
        finally:
            os.close(descriptor)

    def test_every_existing_post_initialize_action_consumes_resume_and_retires_predecessor(self):
        resume = self.initialize_operator_session()
        actions = [
            action
            for action in sorted(AUTHOR.ACTION_VALUES - {"initialize", "finalize"})
        ] + ["finalize"]
        for action in actions:
            with self.subTest(action=action):
                before_path = self.current_resume_path()
                before_resume = self.load_private_json(before_path)
                before_sha = hashlib.sha256(before_path.read_bytes()).hexdigest()
                seen: list[dict[str, str]] = []
                operator = "Peer Human" if action == "peer_review" else "Primary Reviewer"
                expected_state = {
                    "correction_review": "FINALIZATION_REVIEW_REQUIRED",
                    "data_reference_review": "DATA_REFERENCE_REVIEW_REQUIRED",
                    "finalize": "FINALIZATION_ELIGIBLE",
                    "managed_review": "MANAGED_GLOBAL_REVIEW_REQUIRED",
                    "manual_conflict_review": "MANUAL_CONFLICT_REVIEW_REQUIRED",
                    "peer_review": "PEER_REVIEW_REQUIRED",
                    "primary_review": "PRIMARY_REVIEW_REQUIRED",
                    "relationship_review": "RELATIONSHIP_REVIEW_REQUIRED",
                    "revisit_unresolved": "REVISIT_REQUIRED",
                    "sequence_review": "SEQUENCE_REVIEW_REQUIRED",
                    "status": "PRIMARY_REVIEW_REQUIRED",
                }[action]
                result, prompts, writes = self.run_with_responses(
                    self.action_responses(
                        action,
                        operator=operator,
                        expected_state=expected_state,
                    ),
                    execute_authoring_side_effect=self.fake_action_execute(action, seen),
                )
                self.assertEqual(result[0], 2)
                self.assertEqual(len(seen), 1)
                environment = seen[0]
                self.assertEqual(environment["TOC_AUTHOR_ACTION"], action)
                self.assertEqual(
                    environment["TOC_AUTHOR_EXPECTED_HEAD_GENERATION"],
                    str(before_resume["resume_generation"]),
                )
                self.assertEqual(
                    environment["TOC_AUTHOR_EXPECTED_HEAD_SHA256"],
                    before_resume["resume_checkpoint_sha256"],
                )
                self.assertEqual(
                    environment["TOC_AUTHOR_EXPECTED_RELEASE_TOKEN"],
                    before_resume["resume_release_token"],
                )
                self.assertEqual(
                    environment.get("TOC_AUTHOR_EXPECTED_REVIEW_STATE"),
                    expected_state,
                )
                self.assertEqual(
                    environment["TOC_AUTHOR_OPERATOR_IDENTITY"],
                    operator,
                )
                self.assertEqual(
                    environment["TOC_AUTHOR_FINALIZATION_AUTHORIZATION"],
                    AUTHOR.FINALIZATION_AUTHORIZATION if action == "finalize" else "",
                )
                prompt_bytes = b"".join(prompts)
                self.assertNotIn(b"resume_generation", prompt_bytes)
                self.assertNotIn(b"resume_checkpoint_sha256", prompt_bytes)
                self.assertNotIn(b"resume_release_token", prompt_bytes)
                self.assertIn(
                    b"action_authorization_recorded", b"".join(writes)
                )
                self.assertNotIn(
                    b"action_authorization_digest=", b"".join(writes)
                )

                session_names = sorted(path.name for path in self.session_root.iterdir())
                self.assertNotIn(SESSION.OPERATOR_SESSION_LOCK_NAME, session_names)
                self.assertNotIn("OPERATOR_SESSION_INDETERMINATE", session_names)
                self.assertFalse(before_path.exists())
                retired_names = [
                    name for name in session_names if name.startswith(SESSION.RETIRED_RESUME_PREFIX)
                ]
                self.assertTrue(retired_names)
                self.assertTrue(
                    any(
                        hashlib.sha256((self.session_root / name).read_bytes()).hexdigest()
                        == before_sha
                        for name in retired_names
                    )
                )
                action_auth_names = [
                    name for name in session_names if name.startswith("authorization-action-")
                ]
                self.assertTrue(action_auth_names)
                action_auth_matches = [
                    self.load_private_json(self.session_root / name)
                    for name in action_auth_names
                    if self.load_private_json(self.session_root / name)["resume"]["name"]
                    == before_path.name
                ]
                self.assertEqual(len(action_auth_matches), 1)
                action_auth = action_auth_matches[0]
                action_auth_sha = hashlib.sha256(
                    capture_contract.canonical_json_bytes(action_auth)
                ).hexdigest()
                self.assertEqual(action_auth["action"], action)
                self.assertEqual(action_auth["resume"]["name"], before_path.name)
                self.assertEqual(action_auth["resume"]["sha256"], before_sha)
                if action == "finalize":
                    self.assertFalse(
                        any(
                            path.name.startswith(SESSION.CURRENT_RESUME_PREFIX)
                            for path in self.session_root.iterdir()
                        )
                    )
                    terminal_names = [
                        name
                        for name in session_names
                        if name.startswith(SESSION.TERMINAL_RESUME_PREFIX)
                    ]
                    self.assertEqual(len(terminal_names), 1)
                    terminal = self.load_private_json(self.session_root / terminal_names[0])
                    self.assertEqual(terminal["artifact_kind"], SESSION.TERMINAL_RESUME_KIND)
                    self.assertEqual(
                        terminal["predecessor"]["action_authorization_sha256"],
                        action_auth_sha,
                    )
                else:
                    resume_path = self.current_resume_path()
                    resume = self.load_private_json(resume_path)
                    self.assertEqual(resume["artifact_kind"], SESSION.RESUME_KIND)
                    self.assertEqual(resume["format_version"], SESSION.RESUME_FORMAT_VERSION)
                    self.assertEqual(resume["predecessor"]["action"], action)
                    self.assertEqual(
                        resume["predecessor"]["action_authorization_sha256"],
                        action_auth_sha,
                    )
                    self.assertEqual(resume["predecessor"]["resume_name"], before_path.name)
                    self.assertEqual(resume["predecessor"]["resume_sha256"], before_sha)

    def test_real_status_action_keeps_same_checkpoint_but_rotates_private_resume_record(self):
        initial_resume = self.initialize_operator_session()
        before_path = self.current_resume_path()
        before_sha = hashlib.sha256(before_path.read_bytes()).hexdigest()
        result, _prompts, writes = self.run_with_responses(
            self.action_responses("status", expected_state="PRIMARY_REVIEW_REQUIRED")
        )
        self.assertEqual(result[0], 2)
        after_path = self.current_resume_path()
        after_resume = self.load_private_json(after_path)
        self.assertEqual(after_resume["resume_generation"], initial_resume["resume_generation"])
        self.assertEqual(
            after_resume["resume_checkpoint_sha256"],
            initial_resume["resume_checkpoint_sha256"],
        )
        self.assertNotEqual(after_resume["resume_release_token"], initial_resume["resume_release_token"])
        self.assertNotEqual(after_path.name, before_path.name)
        self.assertFalse(before_path.exists())
        self.assertTrue(
            any(path.name.startswith(SESSION.RETIRED_RESUME_PREFIX) for path in self.session_root.iterdir())
        )
        self.assertIn(b"resume_record_private", b"".join(writes))
        self.assertNotIn(initial_resume["resume_release_token"].encode("ascii"), b"".join(writes))
        retired = [
            path
            for path in self.session_root.iterdir()
            if path.name.startswith(SESSION.RETIRED_RESUME_PREFIX)
        ][0]
        self.assertEqual(hashlib.sha256(retired.read_bytes()).hexdigest(), before_sha)

    def test_wrong_expected_review_state_fails_with_fixed_reason_and_keeps_resume_current(self):
        self.initialize_operator_session()
        current = self.current_resume_path()
        with self.assertRaises(SESSION.OperatorSessionError) as raised:
            self.run_with_responses(
                self.action_responses("status", expected_state="FINALIZATION_ELIGIBLE")
            )
        self.assertEqual(raised.exception.reason, "review_transition_invalid")
        self.assertTrue(current.exists())
        self.assertFalse(any(path.name.startswith(SESSION.RETIRED_RESUME_PREFIX) for path in self.session_root.iterdir()))
        self.assertTrue((self.session_root / "OPERATOR_SESSION_INDETERMINATE").exists())

    def test_action_prompt_rejects_ai_peer_before_private_access(self):
        capture_before = immutable_tree_snapshot(self.capture_root)
        with self.assertRaises(SESSION.OperatorSessionError) as raised:
            self.run_with_responses(
                self.action_responses(
                    "peer_review",
                    operator="codex-agent",
                    expected_state="PEER_REVIEW_REQUIRED",
                )
            )
        self.assertEqual(raised.exception.reason, "binding_mismatch")
        self.assertFalse(self.session_root.exists())
        self.assertFalse(self.annotation_root.exists())
        self.assertEqual(immutable_tree_snapshot(self.capture_root), capture_before)

    def test_peer_identity_equal_to_private_primary_blocks_after_authorization(self):
        self.initialize_operator_session()
        current = self.current_resume_path()
        with self.assertRaises(SESSION.OperatorSessionError) as raised:
            self.run_with_responses(
                self.action_responses(
                    "peer_review",
                    operator="primary reviewer",
                    expected_state="PEER_REVIEW_REQUIRED",
                )
            )
        self.assertEqual(raised.exception.reason, "binding_mismatch")
        self.assertTrue(current.exists())
        self.assertTrue(
            (self.session_root / "OPERATOR_SESSION_INDETERMINATE").exists()
        )

    def test_finalize_wrong_authorization_rejects_before_private_access(self):
        self.initialize_operator_session()
        before = immutable_tree_snapshot(self.session_root)
        with self.assertRaises(SESSION.OperatorSessionError) as raised:
            self.run_with_responses(
                self.action_responses(
                    "finalize",
                    expected_state="FINALIZATION_ELIGIBLE",
                    finalization_authorization="NOT_APPROVED",
                )
            )
        self.assertEqual(raised.exception.reason, "finalization_incomplete")
        self.assertEqual(immutable_tree_snapshot(self.session_root), before)

    def test_duplicate_current_resume_records_block_resume_and_mark_indeterminate(self):
        self.initialize_operator_session()
        current = self.current_resume_path()
        duplicate = self.session_root / (
            SESSION.CURRENT_RESUME_PREFIX + "0000000000000001-" + SHA_B + ".json"
        )
        duplicate.write_bytes(current.read_bytes())
        duplicate.chmod(0o400)
        with self.assertRaises(SESSION.OperatorSessionError) as raised:
            self.run_with_responses(
                self.action_responses("primary_review"),
                execute_authoring_side_effect=self.fake_action_execute("primary_review", []),
            )
        self.assertEqual(raised.exception.reason, "history_conflict")
        self.assertTrue((self.session_root / "OPERATOR_SESSION_INDETERMINATE").exists())

    def test_nonpeer_operator_substitution_blocks_without_retiring_resume(self):
        self.initialize_operator_session()
        current = self.current_resume_path()
        current_bytes = current.read_bytes()
        with self.assertRaises(SESSION.OperatorSessionError) as raised:
            self.run_with_responses(
                self.action_responses(
                    "primary_review",
                    operator="Another Human Reviewer",
                ),
                execute_authoring_side_effect=AssertionError(
                    "operator substitution dispatched"
                ),
            )
        self.assertEqual(raised.exception.reason, "binding_mismatch")
        self.assertEqual(current.read_bytes(), current_bytes)
        self.assertFalse(
            any(
                path.name.startswith("authorization-action-")
                for path in self.session_root.iterdir()
            )
        )
        self.assertFalse(
            any(
                path.name.startswith(SESSION.RETIRED_RESUME_PREFIX)
                for path in self.session_root.iterdir()
            )
        )
        self.assertTrue(
            (
                self.session_root / "OPERATOR_SESSION_INDETERMINATE"
            ).exists()
        )

    def test_duplicate_root_authorization_digest_blocks_resume(self):
        self.initialize_operator_session()
        authorization = next(
            path
            for path in self.session_root.iterdir()
            if path.name.startswith("authorization-root-")
        )
        duplicate = self.session_root / "authorization-root-duplicate.json"
        duplicate.write_bytes(authorization.read_bytes())
        duplicate.chmod(0o400)
        with self.assertRaises(SESSION.OperatorSessionError) as raised:
            self.run_with_responses(
                self.action_responses("primary_review"),
                execute_authoring_side_effect=self.fake_action_execute("primary_review", []),
            )
        self.assertEqual(raised.exception.reason, "history_conflict")
        self.assertTrue((self.session_root / "OPERATOR_SESSION_INDETERMINATE").exists())

    def test_fabricated_predecessor_without_backing_evidence_is_rejected(self):
        self.initialize_operator_session()
        current = self.current_resume_path()
        resume = self.load_private_json(current)
        resume["predecessor"] = {
            "action": "status",
            "action_authorization_sha256": SHA_A,
            "resume_name": current.name,
            "resume_sha256": hashlib.sha256(current.read_bytes()).hexdigest(),
        }
        replacement = self.replace_current_resume(current, resume)
        with self.assertRaises(SESSION.OperatorSessionError) as raised:
            self.run_with_responses(
                self.action_responses(
                    "status", expected_state="PRIMARY_REVIEW_REQUIRED"
                ),
                execute_authoring_side_effect=AssertionError(
                    "fabricated predecessor dispatched"
                ),
            )
        self.assertEqual(raised.exception.reason, "history_conflict")
        self.assertTrue(replacement.exists())
        self.assertTrue(
            (self.session_root / "OPERATOR_SESSION_INDETERMINATE").exists()
        )

    def test_predecessor_chain_rejects_missing_retired_resume(self):
        self.assert_predecessor_evidence_mutation_blocks("retired", "missing")

    def test_predecessor_chain_rejects_altered_retired_resume(self):
        self.assert_predecessor_evidence_mutation_blocks("retired", "altered")

    def test_predecessor_chain_rejects_missing_action_authorization(self):
        self.assert_predecessor_evidence_mutation_blocks("action", "missing")

    def test_predecessor_chain_rejects_altered_action_authorization(self):
        self.assert_predecessor_evidence_mutation_blocks("action", "altered")

    def test_complete_predecessor_walk_rejects_missing_older_resume(self):
        current = self.multiple_predecessor_session(edge_count=2)
        retired_records = [
            (path, self.load_private_json(path))
            for path in self.session_root.iterdir()
            if path.name.startswith(SESSION.RETIRED_RESUME_PREFIX)
        ]
        oldest = [
            path
            for path, record in retired_records
            if "predecessor" not in record
        ]
        self.assertEqual(len(oldest), 1)
        oldest[0].unlink()
        with self.assertRaises(SESSION.OperatorSessionError) as raised:
            self.run_with_responses(
                self.action_responses(
                    "status", expected_state="PRIMARY_REVIEW_REQUIRED"
                ),
                execute_authoring_side_effect=AssertionError(
                    "incomplete predecessor history dispatched"
                ),
            )
        self.assertEqual(raised.exception.reason, "history_conflict")
        self.assertTrue(current.exists())
        self.assertTrue(
            (self.session_root / "OPERATOR_SESSION_INDETERMINATE").exists()
        )

    def test_predecessor_action_execution_substitution_is_rejected(self):
        current, retired, action = self.predecessor_bearing_session()

        def mutate(action_record):
            action_record["execution"]["approved_checkout_sha"] = GIT_B

        replacement = self.replace_immediate_action_evidence(
            current, retired, action, mutate
        )
        with self.assertRaises(SESSION.OperatorSessionError) as raised:
            self.run_with_responses(
                self.action_responses(
                    "status", expected_state="PRIMARY_REVIEW_REQUIRED"
                ),
                execute_authoring_side_effect=AssertionError(
                    "execution-substituted history dispatched"
                ),
            )
        self.assertEqual(raised.exception.reason, "history_conflict")
        self.assertTrue(replacement.exists())

    def test_predecessor_action_session_substitution_is_rejected(self):
        current, retired, action = self.predecessor_bearing_session()

        def mutate(action_record):
            action_record["authoring_session_identity"] = (
                "substituted-authoring-session"
            )

        replacement = self.replace_immediate_action_evidence(
            current, retired, action, mutate
        )
        with self.assertRaises(SESSION.OperatorSessionError) as raised:
            self.run_with_responses(
                self.action_responses(
                    "status", expected_state="PRIMARY_REVIEW_REQUIRED"
                ),
                execute_authoring_side_effect=AssertionError(
                    "session-substituted history dispatched"
                ),
            )
        self.assertEqual(raised.exception.reason, "history_conflict")
        self.assertTrue(replacement.exists())

    def test_predecessor_action_expected_state_must_match_checkpoint_state(self):
        current, retired, action = self.predecessor_bearing_session()

        def mutate(action_record):
            action_record["expected_authoring_state"] = "REVISIT_REQUIRED"

        replacement = self.replace_immediate_action_evidence(
            current, retired, action, mutate
        )
        with self.assertRaises(SESSION.OperatorSessionError) as raised:
            self.run_with_responses(
                self.action_responses(
                    "status", expected_state="PRIMARY_REVIEW_REQUIRED"
                )
            )
        self.assertEqual(raised.exception.reason, "history_conflict")
        self.assertTrue(replacement.exists())
        self.assertTrue(
            (self.session_root / "OPERATOR_SESSION_INDETERMINATE").exists()
        )

    def test_resume_history_cross_binds_checkpoint_event_hash_operator_and_session(self):
        root = {
            "authoring_session_identity": "initial-authoring-session",
            "primary_operator_identity": "Primary Reviewer",
        }
        retired = {
            "resume_checkpoint_sha256": SHA_A,
            "resume_generation": 1,
        }
        successor = {
            "resume_checkpoint_sha256": SHA_B,
            "resume_generation": 2,
        }
        action = {
            "action": "primary_review",
            "authoring_session_identity": "primary-review-session",
            "expected_authoring_state": "PRIMARY_REVIEW_REQUIRED",
            "operator_identity": "Primary Reviewer",
        }
        edge = SESSION.ResumeHistoryEdge(
            successor=successor,
            successor_name="resume-current-g2.json",
            successor_sha256=SHA_C,
            retired_resume=retired,
            retired_name="resume-retired-g1.json",
            retired_sha256=SHA_D,
            action_authorization=action,
            action_name="authorization-action.json",
            action_sha256=self.digest_for("cross-bound-action"),
        )
        snapshot = SESSION.ResumeHistorySnapshot(
            current_resume=successor,
            current_name="resume-current-g2.json",
            current_sha256=SHA_C,
            root_authorization=root,
            root_name="authorization-root.json",
            root_sha256=self.digest_for("cross-bound-root"),
            edges=(edge,),
            record_observations={},
            relevant_names=frozenset(),
            pending_action_name="",
            pending_action={},
            pending_action_sha256="",
            release_tokens=frozenset(
                {
                    self.digest_for("retired-release"),
                    self.digest_for("successor-release"),
                }
            ),
        )
        checkpoint_one = {
            "event": {
                "action": "initialize",
                "operator_identity": "Primary Reviewer",
                "operator_session_identity": "initial-authoring-session",
            },
        }
        checkpoint_two = {
            "event": {
                "action": "primary_review",
                "operator_identity": "Primary Reviewer",
                "operator_session_identity": "primary-review-session",
            },
        }

        def check(second=checkpoint_two, first=checkpoint_one):
            chain = types.SimpleNamespace(
                checkpoints=(first, second),
                hashes=(SHA_A, SHA_B),
            )
            with mock.patch.object(
                AUTHOR,
                "aggregate_status",
                return_value={"authoring_state": "PRIMARY_REVIEW_REQUIRED"},
            ):
                SESSION._cross_bind_resume_checkpoint_history(
                    snapshot, chain, object()
                )

        check()
        mutations = {
            "checkpoint_action": ("action", "relationship_review"),
            "checkpoint_operator": ("operator_identity", "Other Reviewer"),
            "checkpoint_session": (
                "operator_session_identity",
                "other-authoring-session",
            ),
        }
        for label, (field, value) in mutations.items():
            with self.subTest(case=label):
                changed = copy.deepcopy(checkpoint_two)
                changed["event"][field] = value
                with self.assertRaisesRegex(
                    SESSION.OperatorSessionError, "history_conflict"
                ):
                    check(second=changed)
        changed_retired = dict(retired)
        changed_retired["resume_checkpoint_sha256"] = SHA_D
        changed_snapshot = copy.copy(snapshot)
        changed_snapshot.edges = (
            dataclasses.replace(edge, retired_resume=changed_retired),
        )
        with mock.patch.object(
            AUTHOR,
            "aggregate_status",
            return_value={"authoring_state": "PRIMARY_REVIEW_REQUIRED"},
        ), self.assertRaisesRegex(
            SESSION.OperatorSessionError, "history_conflict"
        ):
            SESSION._cross_bind_resume_checkpoint_history(
                changed_snapshot,
                types.SimpleNamespace(
                    checkpoints=(checkpoint_one, checkpoint_two),
                    hashes=(SHA_A, SHA_B),
                ),
                object(),
            )

    def test_same_name_resume_replacement_mid_invocation_blocks_successor(self):
        self.initialize_operator_session()
        current = self.current_resume_path()
        original = AUTHOR.aggregate_status
        calls = 0

        def replace_once(checkpoint, capture):
            nonlocal calls
            calls += 1
            if calls == 1:
                replacement = self.session_root / ".planted-resume-replacement"
                replacement.write_bytes(current.read_bytes())
                replacement.chmod(0o400)
                os.replace(replacement, current)
            return original(checkpoint, capture)

        with (
            mock.patch.object(
                AUTHOR, "aggregate_status", side_effect=replace_once
            ),
            self.assertRaises(SESSION.OperatorSessionError) as raised,
        ):
            self.run_with_responses(
                self.action_responses(
                    "status", expected_state="PRIMARY_REVIEW_REQUIRED"
                )
            )
        self.assertEqual(raised.exception.reason, "history_conflict")
        self.assertTrue(current.exists())
        self.assertFalse(
            any(
                path.name.startswith(SESSION.RETIRED_RESUME_PREFIX)
                for path in self.session_root.iterdir()
            )
        )
        self.assertTrue(
            (self.session_root / "OPERATOR_SESSION_INDETERMINATE").exists()
        )

    def test_successor_release_token_must_be_fresh(self):
        initial = self.initialize_operator_session()

        def duplicate_token(
            environment,
            _tty_fd,
            *,
            resume_recorder,
            action_authorizer=None,
            history_verifier=None,
            binding_policy=None,
        ):
            if action_authorizer is not None:
                action_authorizer()
            resume_recorder(
                int(environment["TOC_AUTHOR_EXPECTED_HEAD_GENERATION"]),
                environment["TOC_AUTHOR_EXPECTED_HEAD_SHA256"],
                initial["resume_release_token"],
            )
            raise AssertionError("duplicate release token was accepted")

        with self.assertRaises(SESSION.OperatorSessionError) as raised:
            self.run_with_responses(
                self.action_responses(
                    "status", expected_state="PRIMARY_REVIEW_REQUIRED"
                ),
                execute_authoring_side_effect=duplicate_token,
            )
        self.assertEqual(raised.exception.reason, "history_conflict")
        self.assertEqual(len(list(self.session_root.glob("resume-current-*"))), 1)
        self.assertTrue(
            (self.session_root / "OPERATOR_SESSION_INDETERMINATE").exists()
        )

    def test_same_generation_non_status_history_edge_is_rejected(self):
        current, retired, action = self.predecessor_bearing_session()

        def mutate(action_record):
            action_record["action"] = "primary_review"
            action_record["expected_authoring_state"] = (
                "PRIMARY_REVIEW_REQUIRED"
            )

        replacement = self.replace_immediate_action_evidence(
            current, retired, action, mutate
        )
        with self.assertRaises(SESSION.OperatorSessionError) as raised:
            self.run_with_responses(
                self.action_responses(
                    "status", expected_state="PRIMARY_REVIEW_REQUIRED"
                ),
                execute_authoring_side_effect=AssertionError(
                    "same-generation primary review dispatched"
                ),
            )
        self.assertEqual(raised.exception.reason, "history_conflict")
        self.assertTrue(replacement.exists())

    def test_predecessor_chain_rejects_duplicate_retired_resume_bytes(self):
        self.assert_predecessor_evidence_mutation_blocks(
            "retired", "duplicate"
        )

    def test_predecessor_chain_rejects_duplicate_action_authorization_bytes(self):
        self.assert_predecessor_evidence_mutation_blocks(
            "action", "duplicate"
        )

    def test_predecessor_chain_rejects_unsafe_retired_resume_symlink(self):
        self.assert_predecessor_evidence_mutation_blocks("retired", "symlink")

    def test_predecessor_chain_rejects_unsafe_action_authorization_hardlink(self):
        self.assert_predecessor_evidence_mutation_blocks("action", "hardlink")

    def test_predecessor_chain_rejects_permissive_evidence_mode(self):
        self.assert_predecessor_evidence_mutation_blocks(
            "retired", "permissive_mode"
        )

    def test_predecessor_chain_rejects_action_authorization_substitution(self):
        current, retired, action = self.predecessor_bearing_session()
        resume = self.load_private_json(current)
        substituted_action = self.load_private_json(action)
        substituted_action["resume"]["name"] = (
            SESSION.CURRENT_RESUME_PREFIX
            + "0000000000000001-"
            + SHA_A
            + ".json"
        )
        substituted_data = capture_contract.canonical_json_bytes(
            substituted_action
        )
        substituted_sha = hashlib.sha256(substituted_data).hexdigest()
        substituted_path = self.session_root / (
            "authorization-action-" + substituted_sha[:16] + ".json"
        )
        substituted_path.write_bytes(substituted_data)
        substituted_path.chmod(0o400)
        resume["predecessor"][
            "action_authorization_sha256"
        ] = substituted_sha
        replacement_data = capture_contract.canonical_json_bytes(resume)
        replacement_sha = hashlib.sha256(replacement_data).hexdigest()
        expected_retired = self.session_root / (
            SESSION.RETIRED_RESUME_PREFIX
            + "0000000000000001-"
            + replacement_sha[:16]
            + ".json"
        )
        retired.rename(expected_retired)
        replacement = self.replace_current_resume(current, resume)
        with self.assertRaises(SESSION.OperatorSessionError) as raised:
            self.run_with_responses(
                self.action_responses(
                    "status", expected_state="PRIMARY_REVIEW_REQUIRED"
                ),
                execute_authoring_side_effect=AssertionError(
                    "substituted action authorization dispatched"
                ),
            )
        self.assertEqual(raised.exception.reason, "history_conflict")
        self.assertTrue(replacement.exists())

    def test_current_resume_capture_must_equal_root_authorization_capture(self):
        current, retired, _action = self.predecessor_bearing_session()
        resume = self.load_private_json(current)
        resume["capture"]["raw_toc_sha256"] = SHA_D
        replacement_data = capture_contract.canonical_json_bytes(resume)
        replacement_sha = hashlib.sha256(replacement_data).hexdigest()
        expected_retired = self.session_root / (
            SESSION.RETIRED_RESUME_PREFIX
            + "0000000000000001-"
            + replacement_sha[:16]
            + ".json"
        )
        retired.rename(expected_retired)
        replacement = self.replace_current_resume(current, resume)
        with self.assertRaises(SESSION.OperatorSessionError) as raised:
            self.run_with_responses(
                self.action_responses(
                    "status", expected_state="PRIMARY_REVIEW_REQUIRED"
                ),
                execute_authoring_side_effect=AssertionError(
                    "capture-substituted resume dispatched"
                ),
            )
        self.assertEqual(raised.exception.reason, "history_conflict")
        self.assertTrue(replacement.exists())

    def test_generation_one_resume_capture_must_equal_root_authorization_capture(self):
        self.initialize_operator_session()
        current = self.current_resume_path()
        resume = self.load_private_json(current)
        resume["capture"]["raw_toc_sha256"] = SHA_D
        current.chmod(0o600)
        current.write_bytes(capture_contract.canonical_json_bytes(resume))
        current.chmod(0o400)
        with self.assertRaises(SESSION.OperatorSessionError) as raised:
            self.run_with_responses(
                self.action_responses(
                    "status", expected_state="PRIMARY_REVIEW_REQUIRED"
                ),
                execute_authoring_side_effect=AssertionError(
                    "generation-one capture substitution dispatched"
                ),
            )
        self.assertEqual(raised.exception.reason, "history_conflict")
        self.assertTrue(current.exists())

    def test_stale_resume_procedure_identity_blocks_action_without_retiring_current(self):
        self.initialize_operator_session()
        current = self.current_resume_path()
        resume = self.load_private_json(current)
        resume["procedure_identity_sha256"] = SHA_A
        current.chmod(0o600)
        current.write_bytes(capture_contract.canonical_json_bytes(resume))
        current.chmod(0o400)
        with self.assertRaises(SESSION.OperatorSessionError) as raised:
            self.run_with_responses(
                self.action_responses("primary_review"),
                execute_authoring_side_effect=self.fake_action_execute("primary_review", []),
            )
        self.assertEqual(raised.exception.reason, "binding_mismatch")
        self.assertTrue(current.exists())
        self.assertFalse(any(path.name.startswith(SESSION.RETIRED_RESUME_PREFIX) for path in self.session_root.iterdir()))
        self.assertTrue((self.session_root / "OPERATOR_SESSION_INDETERMINATE").exists())

    def test_successor_publication_failure_leaves_predecessor_current_and_blocks_resume(self):
        self.initialize_operator_session()
        current = self.current_resume_path()
        publish_calls = 0
        real_publish = SESSION._publish_private_json_at

        def planted_publish(root_fd, final_name, payload):
            nonlocal publish_calls
            publish_calls += 1
            if publish_calls == 2:
                raise SESSION.OperatorSessionError("publication_failed")
            return real_publish(root_fd, final_name, payload)

        with mock.patch.object(SESSION, "_publish_private_json_at", side_effect=planted_publish):
            with self.assertRaises(SESSION.OperatorSessionError) as raised:
                self.run_with_responses(
                    self.action_responses("primary_review"),
                    execute_authoring_side_effect=self.fake_action_execute("primary_review", []),
                )
        self.assertEqual(raised.exception.reason, "publication_failed")
        self.assertTrue(current.exists())
        self.assertFalse(any(path.name.startswith(SESSION.RETIRED_RESUME_PREFIX) for path in self.session_root.iterdir()))
        self.assertTrue((self.session_root / "OPERATOR_SESSION_INDETERMINATE").exists())

    def test_action_recorder_rejects_wrong_successor_generation_before_publication(self):
        self.initialize_operator_session()
        predecessor = self.current_resume_path()

        def wrong_generation(
            environment,
            _tty_fd,
            *,
            resume_recorder,
            action_authorizer=None,
            history_verifier=None,
            binding_policy=None,
        ):
            if action_authorizer is not None:
                action_authorizer()
            resume_recorder(
                int(environment["TOC_AUTHOR_EXPECTED_HEAD_GENERATION"]) + 2,
                SHA_A,
                SHA_B,
            )
            return 2, b"{}"

        with self.assertRaisesRegex(
            SESSION.OperatorSessionError, "history_conflict"
        ):
            self.run_with_responses(
                self.action_responses("primary_review"),
                execute_authoring_side_effect=wrong_generation,
            )
        current = [
            path
            for path in self.session_root.iterdir()
            if path.name.startswith(SESSION.CURRENT_RESUME_PREFIX)
        ]
        self.assertEqual(current, [predecessor])
        self.assertFalse(
            any(
                path.name.startswith(SESSION.RETIRED_RESUME_PREFIX)
                for path in self.session_root.iterdir()
            )
        )
        self.assertTrue(
            (self.session_root / "OPERATOR_SESSION_INDETERMINATE").exists()
        )

    def test_failure_after_successor_publication_never_leaves_normal_dual_current_state(self):
        self.initialize_operator_session()
        current = self.current_resume_path()

        def fake_execute(
            environment,
            _tty_fd,
            *,
            resume_recorder,
            action_authorizer=None,
            history_verifier=None,
            binding_policy=None,
        ):
            if action_authorizer is not None:
                action_authorizer()
            resume_recorder(
                int(environment["TOC_AUTHOR_EXPECTED_HEAD_GENERATION"]) + 1,
                SHA_A,
                SHA_B,
            )
            raise SESSION.OperatorSessionError("tty_invalid")

        with self.assertRaises(SESSION.OperatorSessionError) as raised:
            self.run_with_responses(
                self.action_responses("primary_review"),
                execute_authoring_side_effect=fake_execute,
            )
        self.assertEqual(raised.exception.reason, "tty_invalid")
        current_records = [
            path for path in self.session_root.iterdir()
            if path.name.startswith(SESSION.CURRENT_RESUME_PREFIX)
        ]
        self.assertEqual(len(current_records), 2)
        self.assertTrue(current.exists())
        self.assertFalse(any(path.name.startswith(SESSION.RETIRED_RESUME_PREFIX) for path in self.session_root.iterdir()))
        self.assertTrue((self.session_root / "OPERATOR_SESSION_INDETERMINATE").exists())

    def test_predecessor_retirement_failure_blocks_with_indeterminate_successor(self):
        self.initialize_operator_session()
        predecessor = self.current_resume_path()
        predecessor_bytes = predecessor.read_bytes()
        with mock.patch.object(
            SESSION,
            "_retire_resume_record",
            side_effect=SESSION.OperatorSessionError("cleanup_indeterminate"),
        ):
            with self.assertRaises(SESSION.OperatorSessionError) as raised:
                self.run_with_responses(
                    self.action_responses("primary_review"),
                    execute_authoring_side_effect=self.fake_action_execute(
                        "primary_review", []
                    ),
                )
        self.assertEqual(raised.exception.reason, "cleanup_indeterminate")
        self.assertEqual(predecessor.read_bytes(), predecessor_bytes)
        self.assertTrue(
            (
                self.session_root / "OPERATOR_SESSION_INDETERMINATE"
            ).is_file()
        )
        current_records = [
            path
            for path in self.session_root.iterdir()
            if path.name.startswith(SESSION.CURRENT_RESUME_PREFIX)
        ]
        self.assertEqual(len(current_records), 2)
        self.assertFalse(
            any(
                path.name.startswith(SESSION.RETIRED_RESUME_PREFIX)
                for path in self.session_root.iterdir()
            )
        )
        with self.assertRaises(SESSION.OperatorSessionError) as retry:
            self.run_with_responses(
                self.action_responses("primary_review"),
                execute_authoring_side_effect=AssertionError(
                    "blocked state dispatched"
                ),
            )
        self.assertIn(
            retry.exception.reason,
            {"history_conflict", "indeterminate_state"},
        )

    def test_action_ack_failure_leaves_blocking_state_without_retiring_resume(self):
        self.initialize_operator_session()
        current = self.current_resume_path()
        with self.assertRaises(SESSION.OperatorSessionError) as raised:
            self.run_with_responses(
                self.action_responses("primary_review", action_ack="wrong"),
                execute_authoring_side_effect=self.fake_action_execute("primary_review", []),
            )
        self.assertEqual(raised.exception.reason, "input_invalid")
        self.assertTrue(current.exists())
        self.assertTrue((self.session_root / "OPERATOR_SESSION_INDETERMINATE").exists())

    def test_finalize_resume_ack_failure_keeps_predecessor_and_blocks(self):
        for acknowledgement in ("wrong", ""):
            with self.subTest(acknowledgement=acknowledgement or "eof"):
                if self.session_root.exists():
                    shutil.rmtree(self.session_root)
                if self.annotation_root.exists():
                    shutil.rmtree(self.annotation_root)
                self.initialize_operator_session()
                current = self.current_resume_path()
                with self.assertRaises(
                    SESSION.OperatorSessionError
                ) as raised:
                    self.run_with_responses(
                        self.action_responses(
                            "finalize",
                            expected_state="FINALIZATION_ELIGIBLE",
                            resume_ack=acknowledgement,
                        ),
                        execute_authoring_side_effect=self.fake_action_execute(
                            "finalize", []
                        ),
                    )
                self.assertEqual(raised.exception.reason, "input_invalid")
                self.assertTrue(current.exists())
                self.assertFalse(
                    any(
                        path.name.startswith(
                            SESSION.RETIRED_RESUME_PREFIX
                        )
                        for path in self.session_root.iterdir()
                    )
                )
                self.assertEqual(
                    len(
                        [
                            path
                            for path in self.session_root.iterdir()
                            if path.name.startswith(
                                SESSION.TERMINAL_RESUME_PREFIX
                            )
                        ]
                    ),
                    1,
                )
                self.assertTrue(
                    (
                        self.session_root
                        / "OPERATOR_SESSION_INDETERMINATE"
                    ).exists()
                )

    def test_launcher_does_not_export_toc_author_binding_block(self):
        launcher = LAUNCHER.read_text(encoding="utf-8")
        self.assertNotIn("TOC_AUTHOR_CAPTURE_ROOT", launcher)
        self.assertNotIn("TOC_AUTHOR_EXPECTED_OPAQUE_INDEX_SHA256", launcher)
        self.assertNotIn("execution_python_absolute_path", launcher)
        self.assertNotIn("approved_execution_checkout_sha", launcher)
        self.assertNotIn("printf '%s\\0", launcher)
        self.assertIn(
            "/Library/Developer/CommandLineTools/Library/Frameworks/"
            "Python3.framework/Versions/3.9/bin/python3.9",
            launcher,
        )
        self.assertIn('/usr/bin/env -i', launcher)
        for forbidden in ("pbcopy", "pbpaste", "osascript", "open ", "mktemp", "tee "):
            self.assertNotIn(forbidden, launcher)

    def test_fixed_failure_diagnostic_suppresses_private_values(self):
        diagnostic = SESSION._fixed("failed", "binding_mismatch")
        for value in (
            os.fspath(self.capture_root).encode(),
            self.expectations.opaque_index_sha256.encode(),
            b"synthetic-private-object",
        ):
            self.assertNotIn(value, diagnostic)
        self.assertEqual(
            json.loads(diagnostic),
            {
                "diagnostic_version": 1,
                "reason": "binding_mismatch",
                "stage": "annotation_operator_session",
                "status": "failed",
            },
        )

    def test_private_tty_write_retries_until_the_entire_payload_is_written(self):
        observed = bytearray()

        def short_write(_fd, payload):
            chunk = bytes(payload[:3])
            observed.extend(chunk)
            return len(chunk)

        with mock.patch.object(SESSION.os, "write", side_effect=short_write) as write:
            SESSION._tty_write(9, b"reviewed-private-tty-message\n")
        self.assertGreater(write.call_count, 1)
        self.assertEqual(observed, b"reviewed-private-tty-message\n")

    def test_private_tty_zero_write_fails_closed(self):
        with mock.patch.object(SESSION.os, "write", return_value=0):
            with self.assertRaises(SESSION.OperatorSessionError) as raised:
                SESSION._tty_write(9, b"reviewed-private-tty-message\n")
        self.assertEqual(raised.exception.reason, "tty_invalid")

    def test_short_write_failure_after_action_publication_blocks_session(self):
        self.initialize_operator_session()
        predecessor = self.current_resume_path()

        def fail_action_record_prompt(_fd, payload):
            if payload.startswith(b"action_authorization_recorded\n"):
                raise SESSION.OperatorSessionError("tty_invalid")

        with self.assertRaises(SESSION.OperatorSessionError) as raised:
            self.run_with_responses(
                self.action_responses("primary_review"),
                execute_authoring_side_effect=self.fake_action_execute(
                    "primary_review", []
                ),
                tty_write_side_effect=fail_action_record_prompt,
            )
        self.assertEqual(raised.exception.reason, "tty_invalid")
        self.assertTrue(predecessor.exists())
        self.assertTrue(
            (self.session_root / "OPERATOR_SESSION_INDETERMINATE").exists()
        )
        self.assertFalse(
            (
                self.session_root / SESSION.OPERATOR_SESSION_RELEASED_NAME
            ).exists()
        )

    def consequence_authorization(self):
        return {
            "action": "primary_review",
            "expected_authoring_state": "PRIMARY_REVIEW_REQUIRED",
            "operator_identity": "Primary Reviewer",
            "session_id": "toc-operator-synthetic-session",
        }

    def expected_primary_phrase(self, authorization, nonce):
        record = SESSION._consequence_record(authorization, self.verified)
        challenge = SESSION._consequence_challenge(record, nonce)
        return "AUTHORIZE PRIMARY_REVIEW 100 " + challenge

    def test_consequence_authorization_is_session_bound_and_nonleaking(self):
        authorization = self.consequence_authorization()
        nonce = b"N" * 16
        phrase = self.expected_primary_phrase(authorization, nonce)
        writes = []
        with mock.patch.object(
            SESSION.secrets, "token_bytes", return_value=nonce
        ), mock.patch.object(
            SESSION.PREFLIGHT, "verify_tty", return_value=None
        ) as tty_check, mock.patch.object(
            SESSION, "_tty_write", side_effect=lambda _fd, payload: writes.append(payload)
        ), mock.patch.object(
            SESSION, "_read_line", return_value=phrase
        ):
            SESSION._authorize_consequence(
                9,
                authorization,
                self.verified,
                SESSION.ConsequenceGate(),
            )
        self.assertEqual(tty_check.call_count, 2)
        transcript = b"".join(writes)
        self.assertIn(phrase.encode("ascii"), transcript)
        self.assertIn(b"consume one current resume record", transcript)
        for forbidden in (
            os.fspath(self.session_root).encode(),
            self.expectations.opaque_index_sha256.encode(),
            b"resume_release_token",
            b"synthetic-private-object",
        ):
            self.assertNotIn(forbidden, transcript)

        base_authorization = self.consequence_authorization()
        base_authorization["session_id"] = "session-one"
        base_record = SESSION._consequence_record(
            base_authorization, self.verified
        )
        observed = {
            SESSION._consequence_challenge(candidate, nonce)
            for candidate in (
                base_record,
                {**base_record, "action": "relationship_review"},
                {**base_record, "expected_authoring_state": "PEER_REVIEW_REQUIRED"},
                {**base_record, "maximum_entry_decisions": 99},
                {**base_record, "current_operator_identity": "Another Human"},
                {**base_record, "profile_sha256": SHA_C},
                {**base_record, "invocation_session_identity": "session-two"},
            )
        }
        self.assertEqual(len(observed), 7)

    def test_wrong_or_reused_consequence_phrase_has_zero_private_operations(self):
        authorization = self.consequence_authorization()
        before = immutable_tree_snapshot(self.root)
        guarded_names = (
            "_open_existing_private_directory",
            "_open_private_json_at",
            "_acquire_session_lock",
            "_active_resume_name",
            "_load_authorization_by_sha",
            "_publish_private_json_at",
            "_retire_resume_record",
            "_mark_session_indeterminate",
        )
        guarded = {}
        with ExitStack() as stack:
            for name in guarded_names:
                if hasattr(SESSION, name):
                    guarded[name] = stack.enter_context(
                        mock.patch.object(SESSION, name)
                    )
            stack.enter_context(
                mock.patch.object(SESSION.secrets, "token_bytes", return_value=b"N" * 16)
            )
            stack.enter_context(
                mock.patch.object(SESSION.PREFLIGHT, "verify_tty", return_value=None)
            )
            stack.enter_context(mock.patch.object(SESSION, "_tty_write"))
            stack.enter_context(
                mock.patch.object(
                    SESSION,
                    "_read_line",
                    return_value="AUTHORIZE PRIMARY_REVIEW 100 WRONG-ONE",
                )
            )
            gate = SESSION.ConsequenceGate()
            with self.assertRaises(SESSION.OperatorSessionError) as raised:
                SESSION._authorize_consequence(
                    9, authorization, self.verified, gate
                )
            self.assertEqual(raised.exception.reason, "input_invalid")
            with self.assertRaises(SESSION.OperatorSessionError):
                SESSION._authorize_consequence(
                    9, authorization, self.verified, gate
                )
        for operation in guarded.values():
            operation.assert_not_called()
        self.assertEqual(immutable_tree_snapshot(self.root), before)

    def test_consequence_authorization_eof_has_zero_private_operations(self):
        authorization = self.consequence_authorization()
        before = immutable_tree_snapshot(self.root)
        raw_names = (
            "open",
            "stat",
            "lstat",
            "listdir",
            "mkdir",
            "rename",
            "link",
            "unlink",
            "fsync",
        )
        high_level = (
            "_open_existing_private_directory",
            "_open_private_json_at",
            "_acquire_session_lock",
            "_active_resume_name",
            "_load_authorization_by_sha",
            "_publish_private_json_at",
            "_retire_resume_record",
            "_mark_session_indeterminate",
        )
        with ExitStack() as stack:
            raw_guards = {
                name: stack.enter_context(
                    mock.patch.object(
                        SESSION.os,
                        name,
                        wraps=getattr(SESSION.os, name),
                    )
                )
                for name in raw_names
            }
            private_guards = {
                name: stack.enter_context(mock.patch.object(SESSION, name))
                for name in high_level
                if hasattr(SESSION, name)
            }
            stack.enter_context(
                mock.patch.object(
                    SESSION.secrets, "token_bytes", return_value=b"N" * 16
                )
            )
            stack.enter_context(
                mock.patch.object(
                    SESSION.PREFLIGHT, "verify_tty", return_value=None
                )
            )
            stack.enter_context(mock.patch.object(SESSION, "_tty_write"))
            stack.enter_context(
                mock.patch.object(SESSION, "_read_line", return_value="")
            )
            with self.assertRaises(SESSION.OperatorSessionError) as raised:
                SESSION._authorize_consequence(
                    9,
                    authorization,
                    self.verified,
                    SESSION.ConsequenceGate(),
                )
        self.assertEqual(raised.exception.reason, "input_invalid")
        for operation in (*raw_guards.values(), *private_guards.values()):
            operation.assert_not_called()
        self.assertEqual(immutable_tree_snapshot(self.root), before)

    def test_copied_phrase_rejects_every_bound_dimension_before_private_access(self):
        base_authorization = self.consequence_authorization()
        nonce = b"N" * 16
        copied_phrase = self.expected_primary_phrase(
            base_authorization, nonce
        )
        cases = []
        changed = dict(base_authorization)
        changed["action"] = "relationship_review"
        changed["expected_authoring_state"] = "RELATIONSHIP_REVIEW_REQUIRED"
        cases.append(("action", changed, self.verified))
        changed = dict(base_authorization)
        changed["expected_authoring_state"] = "PEER_REVIEW_REQUIRED"
        cases.append(("state", changed, self.verified))
        changed = dict(base_authorization)
        changed["operator_identity"] = "Another Human"
        cases.append(("operator", changed, self.verified))
        changed = dict(base_authorization)
        changed["session_id"] = "toc-operator-other-session"
        cases.append(("session", changed, self.verified))

        changed_profile = copy.deepcopy(self.verified.profile)
        changed_profile["action_state_matrix"]["primary_review"][
            "max_entry_decisions"
        ] = 99
        cases.append(
            (
                "batch",
                base_authorization,
                types.SimpleNamespace(
                    **{**vars(self.verified), "profile": changed_profile}
                ),
            )
        )
        cases.append(
            (
                "profile",
                base_authorization,
                types.SimpleNamespace(
                    **{**vars(self.verified), "profile_sha256": SHA_D}
                ),
            )
        )
        cases.append(
            (
                "approval",
                base_authorization,
                types.SimpleNamespace(
                    **{**vars(self.verified), "approval_sha256": SHA_D}
                ),
            )
        )

        raw_names = (
            "open",
            "stat",
            "lstat",
            "listdir",
            "mkdir",
            "rename",
            "link",
            "unlink",
            "fsync",
        )
        high_level = (
            "_open_existing_private_directory",
            "_open_private_json_at",
            "_acquire_session_lock",
            "_active_resume_name",
            "_load_authorization_by_sha",
            "_publish_private_json_at",
            "_retire_resume_record",
            "_mark_session_indeterminate",
        )
        for label, authorization, verified in cases:
            with self.subTest(dimension=label):
                before = immutable_tree_snapshot(self.root)
                with ExitStack() as stack:
                    raw_guards = {
                        name: stack.enter_context(
                            mock.patch.object(
                                SESSION.os,
                                name,
                                wraps=getattr(SESSION.os, name),
                            )
                        )
                        for name in raw_names
                    }
                    private_guards = {
                        name: stack.enter_context(
                            mock.patch.object(SESSION, name)
                        )
                        for name in high_level
                        if hasattr(SESSION, name)
                    }
                    stack.enter_context(
                        mock.patch.object(
                            SESSION.secrets,
                            "token_bytes",
                            return_value=nonce,
                        )
                    )
                    stack.enter_context(
                        mock.patch.object(
                            SESSION.PREFLIGHT,
                            "verify_tty",
                            return_value=None,
                        )
                    )
                    stack.enter_context(
                        mock.patch.object(SESSION, "_tty_write")
                    )
                    stack.enter_context(
                        mock.patch.object(
                            SESSION,
                            "_read_line",
                            return_value=copied_phrase,
                        )
                    )
                    with self.assertRaises(
                        SESSION.OperatorSessionError
                    ) as raised:
                        SESSION._authorize_consequence(
                            9,
                            authorization,
                            verified,
                            SESSION.ConsequenceGate(),
                        )
                self.assertEqual(raised.exception.reason, "input_invalid")
                for operation in raw_guards.values():
                    operation.assert_not_called()
                for operation in private_guards.values():
                    operation.assert_not_called()
                self.assertEqual(immutable_tree_snapshot(self.root), before)

    def test_consequence_summaries_are_action_specific(self):
        cases = {
            "initialize": (
                "UNINITIALIZED",
                b"publish generation-one checkpoint and resume records",
                b"consume one current resume record",
            ),
            "primary_review": (
                "PRIMARY_REVIEW_REQUIRED",
                b"publish at most one successor checkpoint and resume",
                b"unvalidated final-ledger candidate",
            ),
            "status": (
                "PRIMARY_REVIEW_REQUIRED",
                b"read aggregate checkpoint status without changing decisions",
                b"unvalidated final-ledger candidate",
            ),
            "finalize": (
                "FINALIZATION_ELIGIBLE",
                b"publish one unvalidated final-ledger candidate and terminal resume",
                b"publish at most one successor checkpoint",
            ),
        }
        for action, (state, required, forbidden) in cases.items():
            with self.subTest(action=action):
                authorization = {
                    "action": action,
                    "expected_authoring_state": state,
                    "operator_identity": "Primary Reviewer",
                    "session_id": "toc-operator-summary",
                }
                nonce = b"N" * 16
                record = SESSION._consequence_record(
                    authorization, self.verified
                )
                phrase = (
                    "AUTHORIZE "
                    + action.upper()
                    + " "
                    + str(record["maximum_entry_decisions"])
                    + " "
                    + SESSION._consequence_challenge(record, nonce)
                )
                writes = []
                with (
                    mock.patch.object(
                        SESSION.secrets, "token_bytes", return_value=nonce
                    ),
                    mock.patch.object(
                        SESSION.PREFLIGHT, "verify_tty", return_value=None
                    ),
                    mock.patch.object(
                        SESSION,
                        "_tty_write",
                        side_effect=lambda _fd, payload: writes.append(payload),
                    ),
                    mock.patch.object(
                        SESSION, "_read_line", return_value=phrase
                    ),
                ):
                    SESSION._authorize_consequence(
                        9,
                        authorization,
                        self.verified,
                        SESSION.ConsequenceGate(),
                    )
                transcript = b"".join(writes)
                self.assertIn(required, transcript)
                self.assertNotIn(forbidden, transcript)
                self.assertIn(
                    ("EXPECTED STATE: " + state).encode("ascii"),
                    transcript,
                )

    def test_synthetic_primary_review_usability_metrics_are_fixed(self):
        fields = (
            "primary_review",
            "Primary Reviewer",
            "PRIMARY_REVIEW_REQUIRED",
            "AUTHORIZE PRIMARY_REVIEW 100 XXXX-XXXX",
        )
        self.assertEqual(sum(len(value) + 1 for value in fields), 95)
        self.assertEqual(len(fields), 4)
        self.assertEqual(len("action_authorization_recorded") + 1, 30)
        launcher = LAUNCHER.read_text(encoding="utf-8")
        driver = (
            MIGRATION / "author-lovable-toc-operator-session.py"
        ).read_text(encoding="utf-8")
        for removed_manual_field in (
            "execution_python_absolute_path",
            "execution_python_sha256",
            "execution_python_version",
            "approved_execution_checkout_sha",
            "authoring_procedure_identity_sha256: ",
            "operator_session_procedure_identity_sha256: ",
        ):
            self.assertNotIn(removed_manual_field, launcher)
            self.assertNotIn(removed_manual_field, driver)

    def test_tty_change_after_consequence_prompt_fails_before_private_access(self):
        authorization = self.consequence_authorization()
        nonce = b"N" * 16
        phrase = self.expected_primary_phrase(authorization, nonce)
        before = immutable_tree_snapshot(self.root)
        with mock.patch.object(
            SESSION.secrets, "token_bytes", return_value=nonce
        ), mock.patch.object(
            SESSION.PREFLIGHT,
            "verify_tty",
            side_effect=[None, SESSION.PREFLIGHT.PreflightError("tty_invalid")],
        ), mock.patch.object(
            SESSION, "_tty_write"
        ), mock.patch.object(
            SESSION, "_read_line", return_value=phrase
        ), mock.patch.object(
            SESSION, "_open_existing_private_directory"
        ) as private_open:
            with self.assertRaises(SESSION.PREFLIGHT.PreflightError):
                SESSION._authorize_consequence(
                    9,
                    authorization,
                    self.verified,
                    SESSION.ConsequenceGate(),
                )
        private_open.assert_not_called()
        self.assertEqual(immutable_tree_snapshot(self.root), before)

    def test_verify_only_uses_shared_preflight_result_and_never_opens_private_root(self):
        with mock.patch.object(
            SESSION, "_open_existing_private_directory"
        ) as private_open, mock.patch.object(
            SESSION, "_read_line", return_value=SESSION.VERIFY_ONLY
        ), mock.patch.object(
            SESSION, "_tty_write"
        ):
            status, diagnostic = SESSION.run_session(9, self.verified)
        self.assertEqual(status, 0)
        self.assertEqual(
            json.loads(diagnostic),
            {
                "diagnostic_version": 1,
                "reason": "verified",
                "stage": "annotation_operator_preflight",
                "status": "pass",
            },
        )
        private_open.assert_not_called()

    def test_main_uses_the_same_shared_preflight_once_for_each_mode(self):
        bootstrap = SESSION._BootstrapApprovalBinding(
            approval_name="synthetic-approval.json",
            approval_sha256=SHA_A,
            file_identity=(1,) * 9,
            parent_identity=(2,) * 8,
        )
        for label, result in (
            (
                "verify_only",
                (
                    0,
                    SESSION.PREFLIGHT.fixed_diagnostic(
                        "pass", "verified"
                    ),
                ),
            ),
            (
                "operator_action",
                (
                    2,
                    b'{"diagnostic_version":1,"reason":"blocked",'
                    b'"stage":"synthetic","status":"review_required"}\n',
                ),
            ),
        ):
            with self.subTest(mode=label):
                with (
                    mock.patch.object(
                        SESSION, "_BOOTSTRAP_APPROVAL_BINDING", bootstrap
                    ),
                    mock.patch.object(
                        SESSION, "_validate_tty_fd", return_value=9
                    ),
                    mock.patch.object(
                        SESSION.PREFLIGHT,
                        "verify_pre_private",
                        return_value=self.verified,
                    ) as shared,
                    mock.patch.object(
                        SESSION, "run_session", return_value=result
                    ),
                    mock.patch.object(
                        SESSION, "emit_fixed_diagnostic"
                    ) as emitted,
                ):
                    status = SESSION.main()
            self.assertEqual(status, result[0])
            shared.assert_called_once()
            emitted.assert_called_once()

    def test_run_session_primary_review_uses_real_consequence_gate_once(self):
        initial_resume = self.initialize_operator_session()
        nonce = b"N" * 16
        session_id = "toc-operator-real-consequence"
        authoring_session = "toc-authoring-real-consequence"
        prompted_authorization = {
            "action": "primary_review",
            "expected_authoring_state": "PRIMARY_REVIEW_REQUIRED",
            "operator_identity": "Primary Reviewer",
            "session_id": session_id,
        }
        phrase = self.expected_primary_phrase(prompted_authorization, nonce)
        responses = iter(
            [
                "primary_review",
                "Primary Reviewer",
                "PRIMARY_REVIEW_REQUIRED",
                phrase,
                "action_authorization_recorded",
            ]
        )
        writes = []
        seen = []
        prompts: list[bytes] = []
        resume_acknowledgements: list[int] = []

        def read_line(_fd, _prompt, *, echo=False):
            prompts.append(_prompt)
            return next(responses)

        def execute_primary(
            environment,
            tty_fd,
            *,
            resume_recorder,
            action_authorizer=None,
            history_verifier=None,
            binding_policy=None,
        ):
            seen.append(dict(environment))
            self.assertIsNotNone(action_authorizer)
            action_authorizer()
            AUTHOR._require_resume_acknowledgement(tty_fd)
            resume_recorder(
                int(environment["TOC_AUTHOR_EXPECTED_HEAD_GENERATION"]) + 1,
                self.digest_for("primary-review-cardinality-checkpoint"),
                self.digest_for("primary-review-cardinality-release"),
            )
            return (
                2,
                b'{"authoring_state":"PRIMARY_REVIEW_REQUIRED",'
                b'"diagnostic_version":1,"reason":"blocked",'
                b'"review_gate":"REVIEW_REQUIRED",'
                b'"status":"review_required"}\n',
            )

        with (
            mock.patch.object(
                SESSION,
                "_new_session_identity",
                side_effect=[session_id, authoring_session],
            ),
            mock.patch.object(
                SESSION.secrets, "token_bytes", return_value=nonce
            ),
            mock.patch.object(
                SESSION.PREFLIGHT, "verify_tty", return_value=None
            ),
            mock.patch.object(
                SESSION, "_read_line", side_effect=read_line
            ),
            mock.patch.object(
                SESSION,
                "_tty_write",
                side_effect=lambda _fd, payload: writes.append(payload),
            ),
            mock.patch.object(
                SESSION,
                "_operator_session_procedure_identity",
                return_value=SHA_D,
            ),
            mock.patch.object(
                SESSION, "_procedure_identity", return_value=SHA_C
            ),
            mock.patch.object(
                SESSION,
                "_validated_python_identity",
                return_value={
                    "identity_sha256": initial_resume[
                        "python_identity_sha256"
                    ],
                    "sha256": self.python_sha,
                },
            ),
            mock.patch.object(
                AUTHOR,
                "_require_resume_acknowledgement",
                side_effect=lambda fd: resume_acknowledgements.append(fd),
            ),
            mock.patch.object(
                AUTHOR,
                "execute_authoring",
                side_effect=execute_primary,
            ) as dispatch,
            mock.patch.object(
                SESSION,
                "_revalidate_checkpoint_evidence_from_path",
                return_value=None,
            ),
        ):
            status, _diagnostic = SESSION.run_session(9, self.verified)
        self.assertEqual(status, 2)
        self.assertEqual(dispatch.call_count, 1)
        self.assertEqual(len(seen), 1)
        current = self.load_private_json(self.current_resume_path())
        self.assertEqual(current["resume_generation"], 2)
        self.assertEqual(
            len(
                [
                    path
                    for path in self.session_root.iterdir()
                    if path.name.startswith(
                        SESSION.RETIRED_RESUME_PREFIX
                    )
                ]
            ),
            1,
        )
        transcript = b"".join(writes)
        self.assertEqual(transcript.count(b"NO OTHER ACTION AUTHORIZED"), 1)
        self.assertEqual(
            prompts.count(b"consequence_authorization: "), 1
        )
        self.assertEqual(
            prompts.count(b"action_authorization_acknowledgement: "), 1
        )
        self.assertEqual(resume_acknowledgements, [9])
        self.assertEqual(
            len(
                [
                    path
                    for path in self.session_root.iterdir()
                    if path.name.startswith("authorization-action-")
                ]
            ),
            1,
        )
        self.assertNotIn(initial_resume["resume_release_token"].encode(), transcript)

    def test_primary_operator_boundary_invokes_no_external_tool_or_network(self):
        self.initialize_operator_session()
        with mock.patch.object(
            SESSION.subprocess,
            "run",
            side_effect=AssertionError("unexpected operator child"),
        ), mock.patch.object(
            AUTHOR._startup_subprocess,
            "run",
            side_effect=AssertionError("unexpected authoring child"),
        ), mock.patch.object(
            socket,
            "socket",
            side_effect=AssertionError("unexpected network operation"),
        ):
            result, _prompts, _writes = self.run_with_responses(
                self.action_responses("primary_review"),
                execute_authoring_side_effect=self.fake_action_execute(
                    "primary_review", []
                ),
            )
        self.assertEqual(result[0], 2)

    def test_second_action_authorization_attempt_blocks_session(self):
        self.initialize_operator_session()
        current = self.current_resume_path()

        def dispatch_twice(
            _environment,
            _tty_fd,
            *,
            resume_recorder,
            action_authorizer=None,
            history_verifier=None,
            binding_policy=None,
        ):
            self.assertIsNotNone(action_authorizer)
            action_authorizer()
            action_authorizer()
            raise AssertionError("second authorization unexpectedly returned")

        with self.assertRaises(SESSION.OperatorSessionError) as raised:
            self.run_with_responses(
                self.action_responses("primary_review"),
                execute_authoring_side_effect=dispatch_twice,
            )
        self.assertEqual(raised.exception.reason, "history_conflict")
        self.assertTrue(current.exists())
        self.assertTrue(
            (self.session_root / "OPERATOR_SESSION_INDETERMINATE").exists()
        )
        self.assertFalse(
            any(
                path.name.startswith(SESSION.RETIRED_RESUME_PREFIX)
                for path in self.session_root.iterdir()
            )
        )

    def _char_stat(self, *, inode: int = 20, mode: int | None = None):
        return types.SimpleNamespace(
            st_dev=10,
            st_ino=inode,
            st_mode=(stat.S_IFCHR | 0o600) if mode is None else mode,
            st_rdev=30,
            st_uid=os.geteuid(),
            st_gid=os.getegid(),
        )

    def test_validate_tty_fd_checks_controlling_foreground_termios_and_stability(self):
        tty = self._char_stat()
        controlling = self._char_stat(inode=21)
        with ExitStack() as stack:
            stack.enter_context(mock.patch.dict(SESSION.os.environ, {"TOC_OPERATOR_TTY_FD": "3"}))
            stack.enter_context(
                mock.patch.object(
                    SESSION.os,
                    "fstat",
                    side_effect=[tty, tty, tty, tty, controlling, tty, tty, tty, tty],
                )
            )
            stack.enter_context(mock.patch.object(SESSION.os, "isatty", return_value=True))
            stack.enter_context(mock.patch.object(SESSION.os, "open", return_value=4))
            close_mock = stack.enter_context(mock.patch.object(SESSION.os, "close", return_value=None))
            stack.enter_context(mock.patch.object(SESSION.os, "getpgrp", return_value=123))
            stack.enter_context(mock.patch.object(SESSION.os, "tcgetpgrp", return_value=123))
            stack.enter_context(
                mock.patch.object(SESSION.termios, "tcgetattr", return_value=[0, 0, 0, 0, 0, 0, []])
            )
            self.assertEqual(SESSION._validate_tty_fd(), 3)
            close_mock.assert_called_once_with(4)

    def test_validate_tty_fd_rejects_background_process_group(self):
        tty = self._char_stat()
        controlling = self._char_stat(inode=21)
        with ExitStack() as stack:
            stack.enter_context(mock.patch.dict(SESSION.os.environ, {"TOC_OPERATOR_TTY_FD": "3"}))
            stack.enter_context(
                mock.patch.object(
                    SESSION.os,
                    "fstat",
                    side_effect=[tty, tty, tty, tty, controlling],
                )
            )
            stack.enter_context(mock.patch.object(SESSION.os, "isatty", return_value=True))
            stack.enter_context(mock.patch.object(SESSION.os, "open", return_value=4))
            stack.enter_context(mock.patch.object(SESSION.os, "close", return_value=None))
            stack.enter_context(mock.patch.object(SESSION.os, "getpgrp", return_value=123))
            stack.enter_context(mock.patch.object(SESSION.os, "tcgetpgrp", return_value=456))
            with self.assertRaises(SESSION.OperatorSessionError) as raised:
                SESSION._validate_tty_fd()
        self.assertEqual(raised.exception.reason, "tty_invalid")

    def test_validate_tty_fd_rejects_differing_standard_descriptor_tty(self):
        fixture_before = immutable_tree_snapshot(self.root)
        tty = self._char_stat()
        different = self._char_stat(inode=44)
        different.st_rdev = 31
        with ExitStack() as stack:
            stack.enter_context(
                mock.patch.dict(
                    SESSION.os.environ, {"TOC_OPERATOR_TTY_FD": "3"}
                )
            )
            stack.enter_context(
                mock.patch.object(
                    SESSION.os,
                    "fstat",
                    side_effect=[tty, different, tty, tty],
                )
            )
            stack.enter_context(
                mock.patch.object(SESSION.os, "isatty", return_value=True)
            )
            private_open = stack.enter_context(
                mock.patch.object(SESSION, "_open_existing_private_directory")
            )
            with self.assertRaises(SESSION.OperatorSessionError) as raised:
                SESSION._validate_tty_fd()
        self.assertEqual(raised.exception.reason, "tty_invalid")
        private_open.assert_not_called()
        self.assertEqual(immutable_tree_snapshot(self.root), fixture_before)

    def test_validate_tty_fd_rejects_controlling_terminal_device_mismatch(self):
        fixture_before = immutable_tree_snapshot(self.root)
        tty = self._char_stat()
        controlling = self._char_stat(inode=21)
        controlling.st_rdev = 31
        with ExitStack() as stack:
            stack.enter_context(mock.patch.dict(SESSION.os.environ, {"TOC_OPERATOR_TTY_FD": "3"}))
            stack.enter_context(
                mock.patch.object(
                    SESSION.os,
                    "fstat",
                    side_effect=[tty, tty, tty, tty, controlling],
                )
            )
            stack.enter_context(mock.patch.object(SESSION.os, "isatty", return_value=True))
            stack.enter_context(mock.patch.object(SESSION.os, "open", return_value=4))
            stack.enter_context(mock.patch.object(SESSION.os, "close", return_value=None))
            tcgetpgrp_mock = stack.enter_context(mock.patch.object(SESSION.os, "tcgetpgrp"))
            getpgrp_mock = stack.enter_context(mock.patch.object(SESSION.os, "getpgrp"))
            termios_mock = stack.enter_context(mock.patch.object(SESSION.termios, "tcgetattr"))
            tty_write_mock = stack.enter_context(mock.patch.object(SESSION, "_tty_write"))
            read_line_mock = stack.enter_context(mock.patch.object(SESSION, "_read_line"))
            with self.assertRaises(SESSION.OperatorSessionError) as raised:
                SESSION._validate_tty_fd()
        self.assertEqual(raised.exception.reason, "tty_invalid")
        tcgetpgrp_mock.assert_not_called()
        getpgrp_mock.assert_not_called()
        termios_mock.assert_not_called()
        tty_write_mock.assert_not_called()
        read_line_mock.assert_not_called()
        self.assertEqual(immutable_tree_snapshot(self.root), fixture_before)

    def test_validate_tty_fd_rejects_termios_failure(self):
        tty = self._char_stat()
        controlling = self._char_stat(inode=21)
        with ExitStack() as stack:
            stack.enter_context(mock.patch.dict(SESSION.os.environ, {"TOC_OPERATOR_TTY_FD": "3"}))
            stack.enter_context(
                mock.patch.object(
                    SESSION.os,
                    "fstat",
                    side_effect=[tty, tty, tty, tty, controlling],
                )
            )
            stack.enter_context(mock.patch.object(SESSION.os, "isatty", return_value=True))
            stack.enter_context(mock.patch.object(SESSION.os, "open", return_value=4))
            stack.enter_context(mock.patch.object(SESSION.os, "close", return_value=None))
            stack.enter_context(mock.patch.object(SESSION.os, "getpgrp", return_value=123))
            stack.enter_context(mock.patch.object(SESSION.os, "tcgetpgrp", return_value=123))
            stack.enter_context(mock.patch.object(SESSION.termios, "tcgetattr", side_effect=OSError("termios")))
            with self.assertRaises(SESSION.OperatorSessionError) as raised:
                SESSION._validate_tty_fd()
        self.assertEqual(raised.exception.reason, "tty_invalid")

    def test_validate_tty_fd_rejects_descriptor_replacement(self):
        tty_before = self._char_stat(inode=20)
        controlling = self._char_stat(inode=21)
        tty_after = self._char_stat(inode=22)
        with ExitStack() as stack:
            stack.enter_context(mock.patch.dict(SESSION.os.environ, {"TOC_OPERATOR_TTY_FD": "3"}))
            stack.enter_context(
                mock.patch.object(
                    SESSION.os,
                    "fstat",
                    side_effect=[
                        tty_before,
                        tty_before,
                        tty_before,
                        tty_before,
                        controlling,
                        tty_before,
                        tty_before,
                        tty_before,
                        tty_after,
                    ],
                )
            )
            stack.enter_context(mock.patch.object(SESSION.os, "isatty", return_value=True))
            stack.enter_context(mock.patch.object(SESSION.os, "open", return_value=4))
            stack.enter_context(mock.patch.object(SESSION.os, "close", return_value=None))
            stack.enter_context(mock.patch.object(SESSION.os, "getpgrp", return_value=123))
            stack.enter_context(mock.patch.object(SESSION.os, "tcgetpgrp", return_value=123))
            stack.enter_context(
                mock.patch.object(SESSION.termios, "tcgetattr", return_value=[0, 0, 0, 0, 0, 0, []])
            )
            with self.assertRaises(SESSION.OperatorSessionError) as raised:
                SESSION._validate_tty_fd()
        self.assertEqual(raised.exception.reason, "tty_invalid")

    def test_publication_fsync_failure_leaves_indeterminate_no_resume(self):
        with mock.patch.object(SESSION.os, "fsync", side_effect=OSError("planted")):
            with self.assertRaises(SESSION.OperatorSessionError) as raised:
                self.run_with_responses(self.responses())
        self.assertIn(raised.exception.reason, {"cleanup_indeterminate", "publication_failed"})
        if self.session_root.exists():
            self.assertFalse(any(path.name.startswith("resume-g") for path in self.session_root.iterdir()))

    def test_resume_recorder_rejects_non_generation_one(self):
        def fake_execute(
            _environment,
            _tty_fd,
            *,
            resume_recorder,
            action_authorizer=None,
            binding_policy=None,
        ):
            if action_authorizer is not None:
                action_authorizer()
            resume_recorder(2, SHA_A, SHA_B)
            return 2, b"{}"

        with self.assertRaises(SESSION.OperatorSessionError) as raised:
            self.run_with_responses(
                self.responses(), execute_authoring_side_effect=fake_execute
            )
        self.assertEqual(raised.exception.reason, "internal_failure")
        self.assertTrue((self.session_root / "OPERATOR_SESSION_INDETERMINATE").exists())
        self.assertFalse(any(path.name.startswith("resume-g") for path in self.session_root.iterdir()))

    def test_contract_publication_failure_removes_pending_record(self):
        self.session_root.mkdir(mode=0o700)
        root_fd = os.open(
            self.session_root,
            os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0),
        )
        try:
            with mock.patch.object(
                SESSION, "_rename_no_replace", side_effect=capture_contract.ContractError("publication_exists")
            ):
                with self.assertRaises(SESSION.OperatorSessionError) as raised:
                    SESSION._publish_private_json_at(
                        root_fd,
                        "authorization-synthetic.json",
                        {"artifact_kind": "synthetic"},
                    )
            self.assertEqual(raised.exception.reason, "publication_failed")
            self.assertEqual(list(self.session_root.iterdir()), [])
        finally:
            os.close(root_fd)

    def test_tty_write_failure_before_authorization_creates_no_private_roots(self):
        capture_before = immutable_tree_snapshot(self.capture_root)
        with self.assertRaises(SESSION.OperatorSessionError) as raised:
            self.run_with_responses(
                self.responses(),
                tty_write_side_effect=SESSION.OperatorSessionError("tty_invalid"),
            )
        self.assertEqual(raised.exception.reason, "tty_invalid")
        self.assertFalse(self.session_root.exists())
        self.assertFalse(self.annotation_root.exists())
        self.assertEqual(immutable_tree_snapshot(self.capture_root), capture_before)

    def test_tty_restore_failure_rejects_before_private_access(self):
        before = immutable_tree_snapshot(self.root)
        old = [0, 0, 0, termios.ECHO, 0, 0, []]
        with mock.patch.object(
            SESSION.os, "write", return_value=1
        ), mock.patch.object(
            SESSION.os, "read", side_effect=[b"v", b"a", b"l", b"u", b"e", b"\n"]
        ), mock.patch.object(
            SESSION.termios, "tcgetattr", return_value=old
        ), mock.patch.object(
            SESSION.termios,
            "tcsetattr",
            side_effect=[None, OSError("planted restore failure")],
        ), mock.patch.object(
            SESSION, "_open_existing_private_directory"
        ) as private_open:
            with self.assertRaises(SESSION.OperatorSessionError) as raised:
                SESSION._read_line(9, b"synthetic: ")
        self.assertEqual(raised.exception.reason, "tty_invalid")
        private_open.assert_not_called()
        self.assertEqual(immutable_tree_snapshot(self.root), before)

    def test_malformed_count_input_rejects_before_private_roots_exist(self):
        responses = self.responses()
        responses[11] = "not-a-count"
        capture_before = immutable_tree_snapshot(self.capture_root)
        with self.assertRaises(SESSION.OperatorSessionError) as raised:
            self.run_with_responses(responses)
        self.assertEqual(raised.exception.reason, "input_invalid")
        self.assertFalse(self.session_root.exists())
        self.assertFalse(self.annotation_root.exists())
        self.assertEqual(immutable_tree_snapshot(self.capture_root), capture_before)

    def test_private_parent_mode_and_symlink_roots_reject(self):
        self.root.chmod(0o755)
        try:
            with self.assertRaises(SESSION.OperatorSessionError) as raised:
                self.run_with_responses(self.responses())
            self.assertEqual(raised.exception.reason, "input_invalid")
        finally:
            self.root.chmod(0o700)

        self.session_root.symlink_to(self.root)
        with self.assertRaises(SESSION.OperatorSessionError) as raised:
            self.run_with_responses(self.responses())
        self.assertIn(raised.exception.reason, {"history_conflict", "input_invalid"})

    def test_operator_launcher_uses_private_prompts_and_minimal_child_environment(self):
        fake = self.root / "fake-python"
        poison_bin = self.root / "poison-bin"
        poison_bin.mkdir(mode=0o700)
        dirname_marker = self.root / "ambient-dirname-executed"
        fake_dirname = poison_bin / "dirname"
        fake_dirname.write_text(
            "#!/bin/sh\n"
            f"/usr/bin/touch {str(dirname_marker)!r}\n"
            "exit 90\n",
            encoding="ascii",
        )
        fake_dirname.chmod(0o500)
        argument_ledger = self.root / "arguments.json"
        environment_ledger = self.root / "environment.json"
        stdin_ledger = self.root / "stdin.bin"
        fake.write_text(
            "#!/usr/bin/python3\n"
            "import json, os, sys\n"
            f"open({str(argument_ledger)!r}, 'w', encoding='ascii').write(json.dumps(sys.argv))\n"
            f"open({str(environment_ledger)!r}, 'w', encoding='ascii').write(json.dumps(dict(os.environ), sort_keys=True))\n"
            f"open({str(stdin_ledger)!r}, 'wb').write(b'')\n"
            "sys.stderr.write('{\"diagnostic_version\":1,\"reason\":\"internal_failure\",\"stage\":\"annotation_operator_session\",\"status\":\"failed\"}\\n')\n"
            "raise SystemExit(1)\n",
            encoding="ascii",
        )
        fake.chmod(0o500)
        launcher_copy = self.root / "run-lovable-toc-annotation-operator-session.sh"
        driver_copy = self.root / "author-lovable-toc-operator-session.py"
        driver_copy.write_text("# synthetic reviewed driver path\n", encoding="ascii")
        launcher_copy.write_text(
            LAUNCHER.read_text(encoding="utf-8").replace(
                (
                    "/Library/Developer/CommandLineTools/Library/Frameworks/"
                    "Python3.framework/Versions/3.9/bin/python3.9"
                ),
                os.fspath(fake),
            ),
            encoding="utf-8",
        )
        launcher_copy.chmod(0o500)
        exit_status, transcript = run_pty_command(
            launcher_copy,
            [],
            environment={
                "LANG": "C",
                "LC_ALL": "C",
                "PATH": os.fspath(poison_bin),
                "TERM": "xterm-256color",
                "TOC_AUTHOR_CAPTURE_ROOT": os.fspath(self.capture_root),
                "TOC_AUTHOR_EXPECTED_OPAQUE_INDEX_SHA256": self.expectations.opaque_index_sha256,
            },
        )
        if b"/dev/tty: Operation not permitted" in transcript:
            self.skipTest("local sandbox denies /dev/tty for PTY launcher regression")
        self.assertEqual(exit_status, 1)
        self.assertNotIn(b"execution_python_absolute_path", transcript)
        arguments = json.loads(argument_ledger.read_text(encoding="ascii"))
        child_environment = json.loads(environment_ledger.read_text(encoding="ascii"))
        bootstrap = stdin_ledger.read_bytes()
        self.assertEqual(arguments[1:4], ["-I", "-S", "-B"])
        self.assertEqual(arguments[4], os.fspath(driver_copy))
        self.assertEqual(bootstrap, b"")
        self.assertFalse(dirname_marker.exists())
        self.assertNotIn("PATH", child_environment)
        for name in child_environment:
            self.assertFalse(name.startswith("TOC_AUTHOR_"), name)
        self.assertNotIn("PYTHONPATH", child_environment)
        self.assertNotIn("PYTHONSTARTUP", child_environment)
        for value in (
            os.fspath(self.capture_root),
            self.expectations.opaque_index_sha256,
            "synthetic-private-object",
        ):
            self.assertNotIn(value, json.dumps(arguments))
            self.assertNotIn(value, json.dumps(child_environment))
            self.assertNotIn(value.encode(), transcript)

    def test_launcher_rejects_symlinked_driver_or_fixed_python_before_exec(self):
        launcher_source = LAUNCHER.read_text(encoding="utf-8")
        approved_python = (
            "/Library/Developer/CommandLineTools/Library/Frameworks/"
            "Python3.framework/Versions/3.9/bin/python3.9"
        )
        for target in ("driver", "python"):
            with self.subTest(target=target):
                fixture = self.root / ("symlink-" + target)
                fixture.mkdir(mode=0o700)
                marker = fixture / "executed"
                real_python = fixture / "real-python"
                real_python.write_text(
                    "#!/bin/sh\n"
                    f"/usr/bin/touch {str(marker)!r}\n"
                    "exit 1\n",
                    encoding="ascii",
                )
                real_python.chmod(0o500)
                selected_python = real_python
                if target == "python":
                    selected_python = fixture / "python-link"
                    selected_python.symlink_to(real_python)
                launcher = (
                    fixture
                    / "run-lovable-toc-annotation-operator-session.sh"
                )
                launcher.write_text(
                    launcher_source.replace(
                        approved_python, os.fspath(selected_python)
                    ),
                    encoding="utf-8",
                )
                launcher.chmod(0o500)
                driver = fixture / "author-lovable-toc-operator-session.py"
                if target == "driver":
                    real_driver = fixture / "real-driver.py"
                    real_driver.write_text(
                        "# synthetic reviewed driver\n", encoding="ascii"
                    )
                    driver.symlink_to(real_driver)
                else:
                    driver.write_text(
                        "# synthetic reviewed driver\n", encoding="ascii"
                    )
                exit_status, transcript = run_pty_command(
                    launcher,
                    [],
                    environment={
                        "LANG": "C",
                        "LC_ALL": "C",
                        "TERM": "xterm-256color",
                    },
                )
                if b"/dev/tty: Operation not permitted" in transcript:
                    self.skipTest(
                        "local sandbox denies /dev/tty for PTY launcher regression"
                    )
                self.assertEqual(exit_status, 1)
                self.assertIn(
                    b'"reason":"startup_environment_invalid"', transcript
                )
                self.assertFalse(marker.exists())
                self.assertNotIn(b"Traceback", transcript)

    def test_launcher_rejects_asciinema_marker_for_all_terminal_identities(self):
        for term_program in ("Apple_Terminal", "iTerm.app"):
            with self.subTest(term_program=term_program):
                exit_status, transcript = run_pty_command(
                    LAUNCHER,
                    [],
                    environment={
                        "LANG": "C",
                        "LC_ALL": "C",
                        "TERM": "xterm-256color",
                        "TERM_PROGRAM": term_program,
                        "ASCIINEMA_REC": "1",
                    },
                )
                self.assertEqual(exit_status, 1)
                self.assertIn(b'"reason":"tty_invalid"', transcript)
                self.assertNotIn(b"execution_python_absolute_path", transcript)

    def test_launcher_rejects_every_startup_poison_variable_before_prompt(self):
        launcher_source = LAUNCHER.read_text(encoding="utf-8")
        for variable in LAUNCHER_POISON_VARIABLES:
            with self.subTest(variable=variable):
                self.assertIn(variable, launcher_source)
                environment = {
                    "LANG": "C",
                    "LC_ALL": "C",
                    "TERM": "xterm-256color",
                    variable: "",
                }
                if variable in {"BASH_ENV", "ENV"}:
                    marker = self.root / f"{variable}-sourced"
                    poison = self.root / f"{variable}-poison"
                    poison.write_text(
                        f"echo sourced > {str(marker)!r}\n",
                        encoding="ascii",
                    )
                    environment[variable] = os.fspath(poison)
                if variable in LOADER_EAGER_VARIABLES:
                    # glibc can consume these before the script interpreter
                    # starts.  Start a clean shell first, clear positional
                    # parameters, and prove the no-poison path reaches the TTY
                    # guard while the poison path reaches the launcher's
                    # pre-child rejection loop.
                    baseline = subprocess.run(
                        [
                            "/bin/sh",
                            "-c",
                            "launcher_path=$1; set --; . \"$launcher_path\"",
                            "sh",
                            os.fspath(LAUNCHER),
                        ],
                        env={
                            "LANG": "C",
                            "LC_ALL": "C",
                            "TERM": "xterm-256color",
                        },
                        check=False,
                        stdin=subprocess.DEVNULL,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        timeout=10,
                    )
                    self.assertEqual(baseline.returncode, 1)
                    self.assertEqual(baseline.stdout, b"")
                    self.assertEqual(json.loads(baseline.stderr)["reason"], "tty_invalid")
                    result = subprocess.run(
                        [
                            "/bin/sh",
                            "-c",
                            f"launcher_path=$1; set --; {variable}=x; export {variable}; . \"$launcher_path\"",
                            "sh",
                            os.fspath(LAUNCHER),
                        ],
                        env={
                            "LANG": "C",
                            "LC_ALL": "C",
                            "TERM": "xterm-256color",
                        },
                        check=False,
                        stdin=subprocess.DEVNULL,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        timeout=10,
                    )
                else:
                    result = subprocess.run(
                        [os.fspath(LAUNCHER)],
                        env=environment,
                        check=False,
                        stdin=subprocess.DEVNULL,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE,
                        timeout=10,
                    )
                self.assertEqual(result.returncode, 1)
                self.assertEqual(result.stdout, b"")
                if variable.startswith("DYLD_") and result.stderr == b"":
                    # Some macOS execution contexts consume or strip DYLD_PRINT_*
                    # before the POSIX shell can emit the launcher's diagnostic.
                    # The source-list assertion above still pins the checked-in
                    # rejection loop; observable DYLD_* values must take the
                    # startup rejection branch below.
                    continue
                try:
                    diagnostic = json.loads(result.stderr)
                except json.JSONDecodeError:
                    if variable.startswith("DYLD_"):
                        # Other macOS execution contexts let dyld consume the
                        # value and emit non-JSON loader diagnostics before the
                        # launcher can run.  This remains a platform-stripped
                        # source-list pin rather than a launcher-runtime proof.
                        continue
                    raise
                if variable.startswith("DYLD_") and diagnostic["reason"] == "tty_invalid":
                    # macOS SIP can strip DYLD_* variables before /bin/sh starts.
                    # The source-list assertion above still pins the reviewed
                    # rejection for hosts where the variable is observable.
                    pass
                else:
                    self.assertEqual(diagnostic["reason"], "startup_environment_invalid")
                self.assertNotIn(variable.encode("ascii"), result.stderr)
                if variable in {"BASH_ENV", "ENV"}:
                    self.assertFalse(marker.exists())

    def test_launcher_rejects_pythonpath_poison_before_private_prompt(self):
        exit_status, transcript = run_pty_command(
            LAUNCHER,
            [],
            environment={
                "LANG": "C",
                "LC_ALL": "C",
                "TERM": "xterm-256color",
                "PYTHONPATH": "SYNTHETIC_PYTHONPATH_POISON",
            },
        )
        self.assertEqual(exit_status, 1)
        self.assertIn(b'"reason":"startup_environment_invalid"', transcript)
        self.assertNotIn(b"execution_python_absolute_path", transcript)
        self.assertNotIn(b"SYNTHETIC_PYTHONPATH_POISON", transcript)

    def test_operator_component_rejects_direct_nonisolated_python(self):
        result = subprocess.run(
            [sys.executable, os.fspath(MIGRATION / "author-lovable-toc-operator-session.py")],
            check=False,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=10,
        )
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, b"")
        self.assertEqual(
            json.loads(result.stderr),
            {
                "diagnostic_version": 1,
                "reason": "startup_environment_invalid",
                "stage": "annotation_operator_session",
                "status": "failed",
            },
        )
        self.assertNotIn(b"Traceback", result.stderr)


def _wait_status(status: int) -> int:
    if os.WIFEXITED(status):
        return os.WEXITSTATUS(status)
    if os.WIFSIGNALED(status):
        return 128 + os.WTERMSIG(status)
    return 255


def run_pty_command(
    executable: Path, replies: list[str], *, environment: dict[str, str]
) -> tuple[int, bytes]:
    pid, master_fd = pty.fork()
    if pid == 0:
        try:
            os.execve(os.fspath(executable), [os.fspath(executable)], environment)
        except BaseException:
            os._exit(127)
    transcript = bytearray()
    reply_index = 0
    deadline = time.monotonic() + 15
    child_status: int | None = None
    try:
        while time.monotonic() < deadline:
            waited, status = os.waitpid(pid, os.WNOHANG)
            if waited == pid:
                child_status = status
            readable, _, _ = select.select([master_fd], [], [], 0.05)
            if readable:
                try:
                    chunk = os.read(master_fd, 8192)
                except OSError as exc:
                    if exc.errno == errno.EIO:
                        chunk = b""
                    else:
                        raise
                if chunk:
                    transcript.extend(chunk)
                    while reply_index < len(replies) and transcript.endswith(b": "):
                        os.write(master_fd, replies[reply_index].encode("utf-8") + b"\n")
                        reply_index += 1
                elif child_status is not None:
                    break
            elif child_status is not None:
                break
        if child_status is None:
            os.kill(pid, 9)
            _, child_status = os.waitpid(pid, 0)
            raise AssertionError("operator launcher synthetic PTY timed out")
        return _wait_status(child_status), bytes(transcript)
    finally:
        os.close(master_fd)


if __name__ == "__main__":
    unittest.main()
