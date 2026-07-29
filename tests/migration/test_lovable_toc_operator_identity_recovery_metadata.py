from __future__ import annotations

from contextlib import ExitStack, redirect_stderr, redirect_stdout
import copy
from dataclasses import replace
import datetime as dt
import hashlib
import io
import importlib.util
import json
import logging
import os
from pathlib import Path
import socket
import stat
import subprocess
import sys
import tempfile
import types
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "scripts" / "migration"
sys.path.insert(0, str(MIGRATION))

from lib import lovable_toc_contract as CONTRACT  # noqa: E402
from lib import lovable_toc_operator_identity_recovery_metadata as METADATA  # noqa: E402
import test_lovable_toc_operator_identity_recovery as RECOVERY_TESTS  # noqa: E402


SESSION = RECOVERY_TESTS.SESSION
SyntheticGenerationOne = RECOVERY_TESTS.SyntheticGenerationOne
PRIVATE_IDENTITY = RECOVERY_TESTS.PRIVATE_IDENTITY
PRIVATE_SENTINELS = RECOVERY_TESTS.PRIVATE_SENTINELS
ZERO64 = "0" * 64
CURRENT_CHECKOUT = "5" * 40
ORDINARY_APPROVAL_SHA = "a" * 64
METADATA_APPROVAL_SHA = "b" * 64
METADATA_PROFILE_SHA = "c" * 64
METADATA_PROCEDURE_SHA = "d" * 64


def load_metadata_driver():
    path = (
        MIGRATION
        / "probe-lovable-toc-operator-identity-recovery-metadata.py"
    )
    spec = importlib.util.spec_from_file_location(
        "toc_recovery_metadata_preimport_test", path
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("synthetic metadata driver load failed")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    with mock.patch.object(sys, "argv", [os.fspath(path)]):
        spec.loader.exec_module(module)
    return module


DRIVER = load_metadata_driver()


def canonical(value) -> bytes:
    return CONTRACT.canonical_json_bytes(value)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def immutable_tree_snapshot(root: Path):
    return RECOVERY_TESTS.immutable_tree_snapshot(root)


def synthetic_verified(fixture: SyntheticGenerationOne):
    ordinary_profile = json.loads(
        (
            MIGRATION
            / "verification"
            / "lovable-toc-operator-execution-profile.v1.json"
        ).read_text(encoding="ascii")
    )
    ordinary = types.SimpleNamespace(
        approved_checkout_sha=CURRENT_CHECKOUT,
        approval_name=(
            "lovable-toc-operator-approval-" + CURRENT_CHECKOUT + "-synthetic.json"
        ),
        approval_sha256=ORDINARY_APPROVAL_SHA,
        operator_session_root_path=os.fspath(fixture.operator_root),
        profile=ordinary_profile,
    )
    approval = {
        "metadata_session": {
            "expires_at_utc": (
                dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=1)
            ).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "metadata_session_id": "synthetic-metadata-probe-session",
            "nonce": "e" * 64,
        },
        "operator_session_root_path": os.fspath(fixture.operator_root),
        "tty_binding": {"device": 1, "inode": 2},
    }
    return METADATA.MetadataVerified(
        approval=approval,
        approval_name="synthetic-metadata-probe-approval.json",
        approval_sha256=METADATA_APPROVAL_SHA,
        ordinary=ordinary,
        profile={"synthetic": True},
        profile_sha256=METADATA_PROFILE_SHA,
        procedure_identity_sha256=METADATA_PROCEDURE_SHA,
        repository_root=os.fspath(ROOT),
        historical_python_identity_sha256=fixture.historical_python_identity,
    )


def load_metadata_profile():
    return json.loads(
        (ROOT / METADATA.PROFILE_RELATIVE_PATH).read_text(encoding="ascii")
    )


def public_approval_fixture():
    profile = load_metadata_profile()
    reviewed = profile["reviewed_files"]
    blobs = {
        relative: hashlib.sha1(
            ("blob:" + relative).encode("ascii")
        ).hexdigest()
        for relative in reviewed
    }
    python_policy = profile["python_policy"]
    python_identity = {
        "absolute_path": python_policy["absolute_path"],
        "exact_gid": python_policy["exact_gid"],
        "exact_mode": python_policy["exact_mode"],
        "exact_nlink": python_policy["exact_nlink"],
        "exact_uid": python_policy["exact_uid"],
        "identity_sha256": "6" * 64,
        "reported_version": python_policy["reported_version"],
        "sha256": python_policy["sha256"],
    }
    checkout = "5" * 40
    ordinary = types.SimpleNamespace(
        approved_checkout_sha=checkout,
        approval={
            "python_identity": python_identity,
        },
        approval_name=(
            "lovable-toc-operator-approval-"
            + checkout
            + "-0123456789abcdef.json"
        ),
        approval_sha256="7" * 64,
        operator_session_root_path="/private/tmp/synthetic-operator-root-literal",
    )
    profile_sha256 = "8" * 64
    procedure_identity = "9" * 64
    expiry = (
        dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=1)
    ).strftime("%Y-%m-%dT%H:%M:%SZ")
    approval = {
        "accepted_ceilings": list(METADATA.ACCEPTED_CEILINGS),
        "allowed_output": METADATA.ALLOWED_OUTPUT,
        "approved_checkout_sha": checkout,
        "artifact_kind": METADATA.APPROVAL_KIND,
        "authorizer_identity": "Synthetic Human Authorizer",
        "executing_operator_identity": "Synthetic Human Executor",
        "expected_chain": {
            "checkpoint": {"format_version": 1},
            "generation": 1,
            "resume": {"format_version": 2, "predecessor": "absent"},
            "root_authorization": {"format_version": 1},
            "state": METADATA.EXPECTED_STATE,
        },
        "format_version": 1,
        "independent_reviewer_identity": "Independent Human Reviewer",
        "local_tty_attestation": METADATA.TTY_ATTESTATION,
        "metadata_probe_profile": {
            "format_version": 1,
            "sha256": profile_sha256,
        },
        "metadata_probe_procedure_identity_sha256": procedure_identity,
        "metadata_session": {
            "expires_at_utc": expiry,
            "metadata_session_id": "synthetic-public-metadata-session",
            "nonce": "a" * 64,
        },
        "no_retry_acknowledgement": METADATA.NO_RETRY_ACKNOWLEDGEMENT,
        "operator_session_root_path": ordinary.operator_session_root_path,
        "ordinary_execution_approval": {
            "approved_checkout_sha": checkout,
            "filename": ordinary.approval_name,
            "sha256": ordinary.approval_sha256,
        },
        "permitted_private_reads": list(METADATA.ALLOWED_READS),
        "python_identity": copy.deepcopy(python_identity),
        "repository": {"name": "focus-flow-score", "owner": "starstruck86"},
        "review_reference": "Synthetic Human Review Reference",
        "reviewed_file_blobs": dict(blobs),
        "trust_model_acknowledgement": METADATA.TRUST_ACKNOWLEDGEMENT,
        "tty_binding": {"device": -1872095033, "inode": 41},
    }
    return (
        approval,
        checkout,
        profile,
        profile_sha256,
        procedure_identity,
        blobs,
        ordinary,
    )


def private_snapshot(fixture: SyntheticGenerationOne):
    return (
        immutable_tree_snapshot(fixture.operator_root),
        immutable_tree_snapshot(fixture.annotation_root),
        immutable_tree_snapshot(fixture.capture_root),
    )


def exact_expected_result(
    fixture: SyntheticGenerationOne, verified: METADATA.MetadataVerified
):
    expected_chain = fixture.approval["expected_chain"]
    return {
        "approved_checkout_sha": CURRENT_CHECKOUT,
        "artifact_kind": METADATA.RESULT_KIND,
        "expected_chain": {
            "checkpoint": {
                "format_version": 1,
                "sha256": expected_chain["checkpoint"]["sha256"],
            },
            "generation": 1,
            "resume": {
                "format_version": 2,
                "predecessor": "absent",
                "sha256": expected_chain["resume"]["sha256"],
            },
            "root_authorization": {
                "format_version": 1,
                "sha256": expected_chain["root_authorization"]["sha256"],
            },
            "state": METADATA.EXPECTED_STATE,
        },
        "format_version": 1,
        "metadata_probe": {
            "procedure_identity_sha256": METADATA_PROCEDURE_SHA,
            "profile_sha256": METADATA_PROFILE_SHA,
        },
        "metadata_session_id": verified.approval["metadata_session"][
            "metadata_session_id"
        ],
        "ordinary_execution_approval": {
            "approved_checkout_sha": CURRENT_CHECKOUT,
            "filename": verified.ordinary.approval_name,
            "sha256": ORDINARY_APPROVAL_SHA,
        },
        "paths": {
            "annotation_root_path": os.fspath(fixture.annotation_root),
            "capture_root_path": os.fspath(fixture.capture_root),
            "operator_session_root_path": os.fspath(fixture.operator_root),
        },
        "status": "pass",
    }


class SyntheticPreimportEnvironment:
    def __init__(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(
            prefix="metadata-preimport."
        )
        self.base = Path(self.temporary.name).resolve()
        self.repository = self.base / "repository"
        self.home = self.base / "home"
        self.repository.mkdir(mode=0o700)
        self.home.mkdir(mode=0o700)
        for relative in sorted(DRIVER._BOOTSTRAP_REVIEWED_FILES):
            path = self.repository / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(("synthetic:" + relative + "\n").encode("ascii"))
        self._git("init", "-q")
        self._git("config", "user.name", "Synthetic Metadata Test")
        self._git("config", "user.email", "synthetic@example.invalid")
        self._git("add", "--all")
        self._git("commit", "-q", "-m", "synthetic reviewed closure")
        self._git("branch", "-M", "main")
        self.checkout = self._git("rev-parse", "HEAD").decode("ascii").strip()
        self._git(
            "update-ref",
            "refs/remotes/origin/main",
            self.checkout,
        )
        self.blobs = {
            relative: self._git(
                "rev-parse", f"{self.checkout}:{relative}"
            )
            .decode("ascii")
            .strip()
            for relative in sorted(DRIVER._BOOTSTRAP_REVIEWED_FILES)
        }
        self.approvals = self.home / DRIVER._APPROVAL_RELATIVE_PARENT
        self.approvals.mkdir(parents=True, mode=0o700)
        self.approvals.chmod(0o700)
        self.approval = {
            "approved_checkout_sha": self.checkout,
            "artifact_kind": (
                "lovable_toc_operator_identity_recovery_metadata_approval"
            ),
            "format_version": 1,
            "repository": {
                "name": "focus-flow-score",
                "owner": "starstruck86",
            },
            "reviewed_file_blobs": dict(self.blobs),
        }
        self.name = (
            "lovable-toc-operator-identity-recovery-metadata-approval-"
            + self.checkout
            + "-0123456789abcdef.json"
        )

    def close(self) -> None:
        self.temporary.cleanup()

    def _git(self, *arguments: str) -> bytes:
        result = subprocess.run(
            ["/usr/bin/git", *arguments],
            cwd=self.repository,
            check=True,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env={
                "GIT_CONFIG_GLOBAL": "/dev/null",
                "GIT_CONFIG_NOSYSTEM": "1",
                "GIT_CONFIG_SYSTEM": "/dev/null",
                "LANG": "C",
                "LC_ALL": "C",
                "PATH": "/usr/bin:/bin",
            },
        )
        return result.stdout

    def write_approval(
        self,
        value=None,
        *,
        name: str | None = None,
        data: bytes | None = None,
        mode: int = 0o400,
    ) -> Path:
        selected_name = self.name if name is None else name
        selected = self.approvals / selected_name
        selected.write_bytes(
            canonical(self.approval if value is None else value)
            if data is None
            else data
        )
        selected.chmod(mode)
        return selected


class MetadataProbeTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.fixture = SyntheticGenerationOne()
        self.verified = synthetic_verified(self.fixture)

    def tearDown(self) -> None:
        self.fixture.close()

    def run_probe(self, *, extra_patches=()):
        writes: list[bytes] = []
        with ExitStack() as stack:
            stack.enter_context(
                mock.patch.object(
                    METADATA, "_verify_approved_tty", return_value=None
                )
            )
            stack.enter_context(
                mock.patch.object(
                    METADATA,
                    "_tty_write",
                    side_effect=lambda _fd, payload, **_kwargs: writes.append(
                        payload
                    ),
                )
            )
            for patcher in extra_patches:
                stack.enter_context(patcher)
            METADATA.run_probe(91, self.verified, ordinary_module=SESSION)
        return writes

    def assert_private_failure(self, expected_reason="private_chain_invalid"):
        before = private_snapshot(self.fixture)
        tty_writes: list[bytes] = []
        with mock.patch.object(
            METADATA, "_verify_approved_tty", return_value=None
        ), mock.patch.object(
            METADATA,
            "_tty_write",
            side_effect=lambda _fd, payload, **_kwargs: tty_writes.append(payload),
        ):
            with self.assertRaises(METADATA.MetadataProbeError) as raised:
                METADATA.run_probe(91, self.verified, ordinary_module=SESSION)
        self.assertEqual(raised.exception.reason, expected_reason)
        self.assertEqual(str(raised.exception), expected_reason)
        self.assertEqual(tty_writes, [])
        self.assertEqual(private_snapshot(self.fixture), before)
        return raised.exception


class PublicContractAndApprovalTest(unittest.TestCase):
    def test_preimport_guard_exact_one_discovery_succeeds_end_to_end(self):
        fixture = SyntheticPreimportEnvironment()
        try:
            path = fixture.write_approval()
            expected_data = path.read_bytes()
            binding = DRIVER._preimport_metadata_guard(
                repository=fixture.repository,
                account_home=fixture.home,
            )
            self.assertEqual(binding.approval_name, fixture.name)
            self.assertEqual(binding.approval_sha256, digest(expected_data))
            self.assertEqual(
                binding.file_identity,
                DRIVER._file_identity(os.lstat(path)),
            )
            self.assertEqual(
                binding.parent_identity,
                DRIVER._parent_identity(os.lstat(fixture.approvals)),
            )
        finally:
            fixture.close()

    def test_preimport_guard_rejects_missing_multiple_symlink_mode_owner_tamper_and_blob_map(
        self,
    ):
        def missing(_fixture):
            return None

        def multiple(fixture):
            fixture.write_approval()
            fixture.write_approval(
                name=(
                    "lovable-toc-operator-identity-recovery-metadata-approval-"
                    + fixture.checkout
                    + "-fedcba9876543210.json"
                )
            )

        def symlink(fixture):
            target = fixture.base / "outside-approval.json"
            target.write_bytes(canonical(fixture.approval))
            (fixture.approvals / fixture.name).symlink_to(target)

        def wrong_mode(fixture):
            fixture.write_approval(mode=0o600)

        def noncanonical(fixture):
            fixture.write_approval(
                data=b" " + canonical(fixture.approval)
            )

        def wrong_blob(fixture):
            altered = copy.deepcopy(fixture.approval)
            first = next(iter(altered["reviewed_file_blobs"]))
            altered["reviewed_file_blobs"][first] = "1" * 40
            fixture.write_approval(altered)

        for label, mutate, wrong_owner in (
            ("missing", missing, False),
            ("multiple", multiple, False),
            ("symlink", symlink, False),
            ("wrong_mode", wrong_mode, False),
            ("wrong_owner", lambda fixture: fixture.write_approval(), True),
            ("noncanonical", noncanonical, False),
            ("wrong_blob", wrong_blob, False),
        ):
            with self.subTest(label=label):
                fixture = SyntheticPreimportEnvironment()
                try:
                    mutate(fixture)
                    owner = (
                        mock.patch.object(
                            DRIVER.os,
                            "geteuid",
                            return_value=os.geteuid() + 1,
                        )
                        if wrong_owner
                        else mock.patch.object(
                            DRIVER.os,
                            "geteuid",
                            wraps=os.geteuid,
                        )
                    )
                    with owner, self.assertRaises(DRIVER._StartupFailure):
                        DRIVER._preimport_metadata_guard(
                            repository=fixture.repository,
                            account_home=fixture.home,
                        )
                finally:
                    fixture.close()

    def test_profile_is_canonical_closed_and_binds_exact_reviewed_closure(self):
        profile_path = ROOT / METADATA.PROFILE_RELATIVE_PATH
        data = profile_path.read_bytes()
        profile = json.loads(data.decode("ascii"))

        self.assertEqual(data, canonical(profile))
        self.assertIs(METADATA._validate_profile(profile), profile)
        reviewed = profile["reviewed_files"]
        self.assertEqual(len(reviewed), 20)
        self.assertEqual(reviewed, sorted(reviewed))
        self.assertEqual(len(reviewed), len(set(reviewed)))
        self.assertEqual(
            profile["procedure_identity_formula"]["files"],
            reviewed,
        )
        self.assertEqual(
            set(reviewed),
            {
                "scripts/migration/author-lovable-toc-annotations.py",
                "scripts/migration/author-lovable-toc-operator-session.py",
                "scripts/migration/lib/lovable_toc_authoring_contract.py",
                "scripts/migration/lib/lovable_toc_contract.py",
                "scripts/migration/lib/lovable_toc_operator_identity_recovery.py",
                "scripts/migration/lib/lovable_toc_operator_identity_recovery_metadata.py",
                "scripts/migration/lib/lovable_toc_operator_preflight.py",
                "scripts/migration/probe-lovable-toc-operator-identity-recovery-metadata.py",
                "scripts/migration/run-lovable-toc-annotation-operator-session.sh",
                "scripts/migration/run-lovable-toc-operator-identity-recovery-metadata-probe.sh",
                "scripts/migration/verification/lovable-toc-annotation-checkpoint.schema.json",
                "scripts/migration/verification/lovable-toc-operator-execution-profile-approval.schema.json",
                "scripts/migration/verification/lovable-toc-operator-execution-profile.schema.json",
                "scripts/migration/verification/lovable-toc-operator-execution-profile.v1.json",
                "scripts/migration/verification/lovable-toc-operator-identity-recovery-metadata-approval.schema.json",
                "scripts/migration/verification/lovable-toc-operator-identity-recovery-metadata-profile.schema.json",
                "scripts/migration/verification/lovable-toc-operator-identity-recovery-metadata-profile.v1.json",
                "scripts/migration/verification/lovable-toc-operator-identity-recovery-metadata-result.schema.json",
                "scripts/migration/verification/lovable-toc-operator-session-authorization.schema.json",
                "scripts/migration/verification/lovable-toc-operator-session-resume.schema.json",
            },
        )
        for relative in reviewed:
            self.assertTrue((ROOT / relative).is_file(), relative)
        self.assertEqual(
            profile["recovery_metadata_contract"],
            {
                "authorization_consumption": (
                    "procedural_on_first_private_pathname_operation"
                ),
                "challenge_phrase_prefix": (
                    "AUTHORIZE PROBE_RECOVERY_METADATA"
                ),
                "expected_generation": 1,
                "expected_predecessor": "absent",
                "expected_state": "PRIMARY_REVIEW_REQUIRED",
                "identity_comparison": "internal_equality_only",
                "identity_disclosure": "forbidden",
                "no_retry_acknowledgement": (
                    "NO_RETRY_AFTER_PRIVATE_ACCESS"
                ),
                "ordinary_action_dispatched": False,
                "private_mutation": "forbidden",
                "recovery_action_dispatched": False,
            },
        )
        self.assertEqual(
            tuple(profile["permitted_private_reads"]), METADATA.ALLOWED_READS
        )
        self.assertEqual(
            tuple(profile["prohibited_effects"]), METADATA.PROHIBITED_EFFECTS
        )

    def test_all_four_verification_artifacts_are_closed_and_result_has_no_identity_fields(
        self,
    ):
        names = (
            "lovable-toc-operator-identity-recovery-metadata-profile.v1.json",
            "lovable-toc-operator-identity-recovery-metadata-profile.schema.json",
            "lovable-toc-operator-identity-recovery-metadata-approval.schema.json",
            "lovable-toc-operator-identity-recovery-metadata-result.schema.json",
        )
        values = {}
        for name in names:
            path = MIGRATION / "verification" / name
            data = path.read_bytes()
            self.assertTrue(data.endswith(b"\n"), name)
            self.assertEqual(data.decode("utf-8").encode("utf-8"), data)
            values[name] = json.loads(data.decode("utf-8"))

        profile = values[names[0]]
        profile_schema = values[names[1]]
        approval_schema = values[names[2]]
        result_schema = values[names[3]]
        self.assertEqual(
            profile_schema["$defs"]["reviewedFiles"]["const"],
            profile["reviewed_files"],
        )
        self.assertEqual(
            approval_schema["properties"]["reviewed_file_blobs"][
                "minProperties"
            ],
            len(profile["reviewed_files"]),
        )
        self.assertEqual(
            approval_schema["properties"]["reviewed_file_blobs"][
                "maxProperties"
            ],
            len(profile["reviewed_files"]),
        )

        def assert_closed_objects(value, location: str) -> None:
            if type(value) is dict:
                if value.get("type") == "object":
                    self.assertIs(
                        value.get("additionalProperties"),
                        False,
                        location,
                    )
                    if "properties" in value:
                        self.assertEqual(
                            set(value["properties"]),
                            set(value.get("required", [])),
                            location,
                        )
                for key, child in value.items():
                    assert_closed_objects(child, location + "/" + key)
            elif type(value) is list:
                for index, child in enumerate(value):
                    assert_closed_objects(child, location + f"/{index}")

        for name, schema in (
            (names[1], profile_schema),
            (names[2], approval_schema),
            (names[3], result_schema),
        ):
            self.assertFalse(schema["additionalProperties"], name)
            assert_closed_objects(schema, name)

        result_property_names: set[str] = set()

        def collect_properties(value) -> None:
            if type(value) is dict:
                properties = value.get("properties")
                if type(properties) is dict:
                    result_property_names.update(properties)
                for child in value.values():
                    collect_properties(child)
            elif type(value) is list:
                for child in value:
                    collect_properties(child)

        collect_properties(result_schema)
        self.assertTrue(
            set(profile["output_contract"]["prohibited_fields"]).isdisjoint(
                result_property_names
            )
        )
        self.assertNotIn("operator_identity", result_property_names)
        self.assertNotIn("primary_operator_identity", result_property_names)
        self.assertNotIn("release_token", result_property_names)

    def test_exact_public_approval_validates_before_any_private_operation(self):
        (
            approval,
            checkout,
            profile,
            profile_sha256,
            procedure_identity,
            blobs,
            ordinary,
        ) = public_approval_fixture()
        private_open = mock.Mock(
            side_effect=AssertionError("public-validation-private-open")
        )
        with mock.patch.object(
            METADATA, "_verify_approved_tty", return_value=None
        ), mock.patch.object(
            METADATA, "_open_private_directory", private_open
        ):
            validated = METADATA._validate_approval(
                approval,
                checkout=checkout,
                profile=profile,
                profile_sha256=profile_sha256,
                procedure_identity=procedure_identity,
                blobs=blobs,
                ordinary=ordinary,
                tty_fd=91,
                repository=ROOT,
            )
        self.assertIs(validated, approval)
        private_open.assert_not_called()

    def test_every_public_approval_substitution_fails_before_private_access(self):
        def wrong_checkout(value, _ordinary):
            value["approved_checkout_sha"] = "1" * 40

        def wrong_profile(value, _ordinary):
            value["metadata_probe_profile"]["sha256"] = "1" * 64

        def wrong_procedure(value, _ordinary):
            value["metadata_probe_procedure_identity_sha256"] = "1" * 64

        def wrong_blob(value, _ordinary):
            first = next(iter(value["reviewed_file_blobs"]))
            value["reviewed_file_blobs"][first] = "1" * 40

        def wrong_python(value, _ordinary):
            value["python_identity"]["identity_sha256"] = "1" * 64

        def wrong_ordinary(value, _ordinary):
            value["ordinary_execution_approval"]["sha256"] = "1" * 64

        def same_reviewer(value, _ordinary):
            value["independent_reviewer_identity"] = value[
                "executing_operator_identity"
            ].swapcase()

        def ai_reviewer(value, _ordinary):
            value["independent_reviewer_identity"] = "Synthetic Codex Reviewer"

        def expired(value, _ordinary):
            value["metadata_session"][
                "expires_at_utc"
            ] = "2020-01-01T00:00:00Z"

        def overlong_expiry(value, _ordinary):
            value["metadata_session"]["expires_at_utc"] = (
                dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=25)
            ).strftime("%Y-%m-%dT%H:%M:%SZ")

        def unknown_field(value, _ordinary):
            value["private_identity_sentinel"] = "must-not-be-read"

        for label, mutate in (
            ("checkout", wrong_checkout),
            ("profile", wrong_profile),
            ("procedure", wrong_procedure),
            ("blob", wrong_blob),
            ("python", wrong_python),
            ("ordinary", wrong_ordinary),
            ("same_reviewer", same_reviewer),
            ("ai_reviewer", ai_reviewer),
            ("expired", expired),
            ("overlong_expiry", overlong_expiry),
            ("unknown_field", unknown_field),
        ):
            with self.subTest(label=label):
                (
                    approval,
                    checkout,
                    profile,
                    profile_sha256,
                    procedure_identity,
                    blobs,
                    ordinary,
                ) = public_approval_fixture()
                mutate(approval, ordinary)
                private_open = mock.Mock(
                    side_effect=AssertionError(
                        "public-substitution-private-open"
                    )
                )
                with mock.patch.object(
                    METADATA, "_verify_approved_tty", return_value=None
                ), mock.patch.object(
                    METADATA, "_open_private_directory", private_open
                ):
                    with self.assertRaises(METADATA.MetadataProbeError) as raised:
                        METADATA._validate_approval(
                            approval,
                            checkout=checkout,
                            profile=profile,
                            profile_sha256=profile_sha256,
                            procedure_identity=procedure_identity,
                            blobs=blobs,
                            ordinary=ordinary,
                            tty_fd=91,
                            repository=ROOT,
                        )
                self.assertIn(
                    raised.exception.reason,
                    {"approval_invalid", "binding_mismatch"},
                )
                private_open.assert_not_called()
                self.assertNotIn(
                    "private_identity_sentinel", str(raised.exception)
                )

    def test_tty_binding_failure_is_public_and_precedes_private_access(self):
        (
            approval,
            checkout,
            profile,
            profile_sha256,
            procedure_identity,
            blobs,
            ordinary,
        ) = public_approval_fixture()
        private_open = mock.Mock(
            side_effect=AssertionError("public-tty-private-open")
        )
        with mock.patch.object(
            METADATA,
            "_verify_approved_tty",
            side_effect=METADATA.MetadataProbeError("tty_invalid"),
        ), mock.patch.object(
            METADATA, "_open_private_directory", private_open
        ):
            with self.assertRaises(METADATA.MetadataProbeError) as raised:
                METADATA._validate_approval(
                    approval,
                    checkout=checkout,
                    profile=profile,
                    profile_sha256=profile_sha256,
                    procedure_identity=procedure_identity,
                    blobs=blobs,
                    ordinary=ordinary,
                    tty_fd=91,
                    repository=ROOT,
                )
        self.assertEqual(raised.exception.reason, "tty_invalid")
        private_open.assert_not_called()

    def test_full_public_verification_never_touches_operator_root_literal(self):
        (
            approval,
            checkout,
            profile,
            _profile_sha256,
            _procedure_identity,
            blobs,
            ordinary,
        ) = public_approval_fixture()
        profile_data = canonical(profile)
        profile_sha256 = digest(profile_data)
        profile_blob = blobs[METADATA.PROFILE_RELATIVE_PATH]
        procedure_identity = METADATA._procedure_identity(
            checkout,
            profile["procedure_identity_formula"],
            blobs,
        )
        approval["metadata_probe_profile"]["sha256"] = profile_sha256
        approval[
            "metadata_probe_procedure_identity_sha256"
        ] = procedure_identity
        ordinary_profile = json.loads(
            (
                MIGRATION
                / "verification"
                / "lovable-toc-operator-execution-profile.v1.json"
            ).read_text(encoding="ascii")
        )
        ordinary = types.SimpleNamespace(
            **{
                **vars(ordinary),
                "profile": ordinary_profile,
                "repository_root": os.fspath(ROOT),
            }
        )
        literal = ordinary.operator_session_root_path
        path_calls: list[str] = []
        real_resolve = Path.resolve

        def is_private_literal(value) -> bool:
            if isinstance(value, int):
                return False
            try:
                return os.fspath(value) == literal
            except TypeError:
                return False

        def trap_path(value, *args, **kwargs):
            if is_private_literal(value):
                path_calls.append("filesystem")
                raise AssertionError("public-validation-private-path")
            raise AssertionError("unexpected-unmocked-public-path-operation")

        def trap_resolve(value, *args, **kwargs):
            if os.fspath(value) == literal:
                path_calls.append("resolve")
                raise AssertionError("public-validation-private-resolve")
            return real_resolve(value, *args, **kwargs)

        def git_ascii(_repository, arguments):
            if arguments[:1] == ["rev-parse"]:
                reference = arguments[1]
                if reference in (
                    "HEAD",
                    "refs/heads/main",
                    "refs/remotes/origin/main",
                ):
                    return checkout
                prefix = checkout + ":"
                if reference.startswith(prefix):
                    return blobs[reference[len(prefix) :]]
            if arguments[:2] == ["hash-object", "--"]:
                return blobs[arguments[2]]
            raise AssertionError("unexpected-public-git-operation")

        ordinary_module = types.SimpleNamespace(
            _validated_python_identity=lambda _value: {
                "identity_sha256": "4" * 64
            }
        )
        with ExitStack() as stack:
            stack.enter_context(
                mock.patch.object(
                    METADATA.PREFLIGHT,
                    "verify_pre_private",
                    return_value=ordinary,
                )
            )
            stack.enter_context(
                mock.patch.object(
                    METADATA.PREFLIGHT,
                    "repository_root_from_launcher",
                    return_value=os.fspath(ROOT),
                )
            )
            stack.enter_context(
                mock.patch.object(
                    METADATA,
                    "_read_public_profile",
                    return_value=(profile, profile_data, profile_blob),
                )
            )
            stack.enter_context(
                mock.patch.object(
                    METADATA,
                    "_load_approval",
                    return_value=(
                        approval,
                        "synthetic-metadata-approval.json",
                        "3" * 64,
                    ),
                )
            )
            stack.enter_context(
                mock.patch.object(
                    METADATA.PREFLIGHT,
                    "_git_ascii",
                    side_effect=git_ascii,
                )
            )
            stack.enter_context(
                mock.patch.object(
                    METADATA, "_verify_approved_tty", return_value=None
                )
            )
            for name in ("listdir", "lstat", "open", "stat"):
                stack.enter_context(
                    mock.patch.object(
                        METADATA.os, name, side_effect=trap_path
                    )
                )
            stack.enter_context(
                mock.patch.object(Path, "resolve", side_effect=trap_resolve)
            )
            verified = METADATA.verify_pre_private(
                launcher=MIGRATION
                / "run-lovable-toc-operator-identity-recovery-metadata-probe.sh",
                ordinary_launcher=MIGRATION
                / "run-lovable-toc-annotation-operator-session.sh",
                ordinary_bootstrap=mock.sentinel.ordinary_bootstrap,
                metadata_bootstrap=mock.sentinel.metadata_bootstrap,
                ordinary_module=ordinary_module,
                tty_fd=91,
            )
        self.assertEqual(path_calls, [])
        self.assertEqual(
            verified.approval["operator_session_root_path"], literal
        )

    def test_runtime_rejects_paths_longer_than_schema_limit_without_access(self):
        too_long = "/" + ("a" * 4096)
        for function, reason in (
            (
                lambda: METADATA._validate_absolute_literal(too_long, ROOT),
                "approval_invalid",
            ),
            (
                lambda: METADATA._private_path(too_long, ROOT),
                "private_chain_invalid",
            ),
        ):
            with self.subTest(reason=reason), mock.patch.object(
                METADATA.os,
                "lstat",
                side_effect=AssertionError("overlong-path-access"),
            ):
                with self.assertRaises(METADATA.MetadataProbeError) as raised:
                    function()
                self.assertEqual(raised.exception.reason, reason)

    def test_approval_parser_rejects_duplicate_noncanonical_nonfinite_and_utf8(self):
        profile = load_metadata_profile()
        checkout = "5" * 40
        filename = (
            "lovable-toc-operator-identity-recovery-metadata-approval-"
            + checkout
            + "-0123456789abcdef.json"
        )
        planted_values = (
            b'{"x":1,"x":2}\n',
            b'{ "x":1}\n',
            b'{"x":NaN}\n',
            b"\xff\n",
        )
        for data in planted_values:
            with self.subTest(data=data[:16]), tempfile.TemporaryDirectory(
                prefix="metadata-approval-parser."
            ) as temporary:
                parent = Path(temporary).resolve()
                parent.chmod(0o700)
                path = parent / filename
                path.write_bytes(data)
                path.chmod(0o400)
                bootstrap = METADATA.PREFLIGHT.ApprovalBootstrapBinding(
                    approval_name=filename,
                    approval_sha256=digest(data),
                    file_identity=METADATA.PREFLIGHT._approval_file_identity(
                        os.lstat(path)
                    ),
                    parent_identity=METADATA.PREFLIGHT._approval_parent_identity(
                        os.lstat(parent)
                    ),
                )
                with self.assertRaises(METADATA.MetadataProbeError) as raised:
                    METADATA._load_approval(
                        parent,
                        bootstrap=bootstrap,
                        checkout=checkout,
                        profile=profile,
                    )
                self.assertEqual(raised.exception.reason, "approval_invalid")

    def test_raw_signed_tty_device_is_compared_without_reinterpretation(self):
        signed_device = -1872095033
        tty_metadata = types.SimpleNamespace(
            st_dev=signed_device,
            st_ino=41,
        )
        with mock.patch.object(
            METADATA.PREFLIGHT, "verify_tty", return_value=None
        ), mock.patch.object(
            METADATA.os, "fstat", return_value=tty_metadata
        ):
            METADATA._verify_approved_tty(
                91,
                {"device": signed_device, "inode": 41},
                private_access_started=False,
            )
            for wrong in (signed_device + 1, 2422872263):
                with self.assertRaises(METADATA.MetadataProbeError) as raised:
                    METADATA._verify_approved_tty(
                        91,
                        {"device": wrong, "inode": 41},
                        private_access_started=False,
                    )
                self.assertEqual(raised.exception.reason, "tty_invalid")

    def test_native_macos_controlling_tty_preserves_raw_device(self):
        if sys.platform != "darwin":
            self.skipTest("PTY_UNAVAILABLE: native macOS controlling TTY only")
        descriptor = -1
        try:
            descriptor = os.open(
                "/dev/tty",
                os.O_RDONLY
                | getattr(os, "O_CLOEXEC", 0)
                | getattr(os, "O_NOCTTY", 0),
            )
            observed = os.fstat(descriptor)
            binding = {"device": observed.st_dev, "inode": observed.st_ino}
            try:
                METADATA._verify_approved_tty(
                    descriptor,
                    binding,
                    private_access_started=False,
                )
            except METADATA.MetadataProbeError as exc:
                self.skipTest(
                    "PTY_UNAVAILABLE: full foreground controlling TTY "
                    f"binding unavailable ({exc.reason})"
                )
            with self.assertRaises(METADATA.MetadataProbeError) as raised:
                METADATA._verify_approved_tty(
                    descriptor,
                    {
                        "device": observed.st_dev + 1,
                        "inode": observed.st_ino,
                    },
                    private_access_started=False,
                )
            self.assertEqual(raised.exception.reason, "tty_invalid")
        except OSError as exc:
            self.skipTest(
                "PTY_UNAVAILABLE: /dev/tty unavailable "
                f"({type(exc).__name__})"
            )
        finally:
            if descriptor >= 0:
                os.close(descriptor)


class SuccessfulReadOnlyProbeTest(MetadataProbeTestCase):
    def test_pristine_chain_emits_exact_canonical_result_without_identity(self):
        before = private_snapshot(self.fixture)
        writes = self.run_probe()

        self.assertEqual(len(writes), 1)
        expected = exact_expected_result(self.fixture, self.verified)
        self.assertEqual(writes[0], canonical(expected))
        self.assertLessEqual(len(writes[0]), METADATA.MAX_RESULT_BYTES)
        self.assertEqual(
            json.loads(writes[0].decode("ascii")),
            expected,
        )
        self.assertEqual(private_snapshot(self.fixture), before)
        for sentinel in PRIVATE_SENTINELS:
            self.assertNotIn(sentinel, writes[0])
        self.assertNotIn(self.fixture.release_token.encode("ascii"), writes[0])
        self.assertNotIn(b"entry_id", writes[0])
        self.assertNotIn(b"decision", writes[0])

    def test_realistic_2354_entry_chain_with_214_data_references(self):
        self.fixture.close()
        object_classes = ["TABLE DATA"] * 214 + ["TABLE"] * (2354 - 214)
        self.fixture = SyntheticGenerationOne(object_classes)
        self.verified = synthetic_verified(self.fixture)
        self.assertEqual(len(self.fixture.checkpoint["entries"]), 2354)
        self.assertEqual(
            sum(
                entry["is_data_reference"]
                for entry in self.fixture.checkpoint["entries"]
            ),
            214,
        )
        self.assertEqual(self.fixture.root["capture"]["entry_count"], 2354)
        self.assertEqual(self.fixture.root["capture"]["data_reference_count"], 214)

        before = private_snapshot(self.fixture)
        writes = self.run_probe()

        self.assertEqual(writes, [canonical(exact_expected_result(self.fixture, self.verified))])
        self.assertEqual(private_snapshot(self.fixture), before)

    def test_capture_root_is_never_opened_statted_or_listed(self):
        capture = os.path.normcase(os.fspath(self.fixture.capture_root))
        real_open = os.open
        real_lstat = os.lstat
        real_stat = os.stat
        real_listdir = os.listdir

        def is_capture_path(value) -> bool:
            if isinstance(value, int):
                return False
            try:
                text = os.path.normcase(os.path.abspath(os.fspath(value)))
            except (TypeError, ValueError):
                return False
            return text == capture or text.startswith(capture + os.sep)

        def guarded_open(path, *args, **kwargs):
            if kwargs.get("dir_fd") is None and is_capture_path(path):
                raise AssertionError("capture-open-sentinel")
            return real_open(path, *args, **kwargs)

        def guarded_lstat(path, *args, **kwargs):
            if is_capture_path(path):
                raise AssertionError("capture-lstat-sentinel")
            return real_lstat(path, *args, **kwargs)

        def guarded_stat(path, *args, **kwargs):
            if kwargs.get("dir_fd") is None and is_capture_path(path):
                raise AssertionError("capture-stat-sentinel")
            return real_stat(path, *args, **kwargs)

        def guarded_listdir(path="."):
            if is_capture_path(path):
                raise AssertionError("capture-listdir-sentinel")
            return real_listdir(path)

        writes = self.run_probe(
            extra_patches=(
                mock.patch.object(METADATA.os, "open", side_effect=guarded_open),
                mock.patch.object(METADATA.os, "lstat", side_effect=guarded_lstat),
                mock.patch.object(METADATA.os, "stat", side_effect=guarded_stat),
                mock.patch.object(
                    METADATA.os, "listdir", side_effect=guarded_listdir
                ),
            )
        )
        self.assertEqual(writes, [canonical(exact_expected_result(self.fixture, self.verified))])

    def test_no_writes_fsync_mutation_network_or_subprocess_after_preflight(self):
        forbidden = AssertionError("forbidden-effect-sentinel")
        patches = [
            mock.patch.object(METADATA.os, name, side_effect=forbidden)
            for name in (
                "chmod",
                "chown",
                "fsync",
                "link",
                "mkdir",
                "remove",
                "rename",
                "replace",
                "rmdir",
                "symlink",
                "unlink",
                "write",
            )
            if hasattr(METADATA.os, name)
        ]
        patches.extend(
            (
                mock.patch.object(socket, "socket", side_effect=forbidden),
                mock.patch.object(subprocess, "Popen", side_effect=forbidden),
                mock.patch.object(subprocess, "call", side_effect=forbidden),
                mock.patch.object(subprocess, "check_call", side_effect=forbidden),
                mock.patch.object(
                    subprocess, "check_output", side_effect=forbidden
                ),
                mock.patch.object(subprocess, "run", side_effect=forbidden),
            )
        )
        before = private_snapshot(self.fixture)
        writes = self.run_probe(extra_patches=patches)
        self.assertEqual(writes, [canonical(exact_expected_result(self.fixture, self.verified))])
        self.assertEqual(private_snapshot(self.fixture), before)

    def test_private_sentinels_never_reach_public_process_or_artifact_channels(self):
        ordinary_stdout = io.StringIO()
        ordinary_stderr = io.StringIO()
        tty_writes: list[bytes] = []
        with tempfile.TemporaryDirectory(
            prefix="metadata-public-artifacts."
        ) as temporary:
            artifact_root = Path(temporary)
            before_artifacts = tuple(artifact_root.iterdir())
            with redirect_stdout(ordinary_stdout), redirect_stderr(
                ordinary_stderr
            ), mock.patch.object(
                logging.Logger,
                "_log",
                side_effect=AssertionError("metadata-log-write-sentinel"),
            ), mock.patch.object(
                METADATA, "_verify_approved_tty", return_value=None
            ), mock.patch.object(
                METADATA,
                "_tty_write",
                side_effect=lambda _fd, payload, **_kwargs: tty_writes.append(
                    payload
                ),
            ):
                METADATA.run_probe(
                    91, self.verified, ordinary_module=SESSION
                )
            self.assertEqual(tuple(artifact_root.iterdir()), before_artifacts)

        self.assertEqual(ordinary_stdout.getvalue(), "")
        self.assertEqual(ordinary_stderr.getvalue(), "")
        self.assertEqual(len(tty_writes), 1)
        public_process = (
            "\x00".join(sys.argv)
            + "\x00"
            + "\x00".join(
                key + "=" + value for key, value in os.environ.items()
            )
        ).encode("utf-8", errors="replace")
        public_artifacts = b"".join(
            (
                (ROOT / METADATA.PROFILE_RELATIVE_PATH).read_bytes(),
                (
                    MIGRATION
                    / "verification"
                    / "lovable-toc-operator-identity-recovery-metadata-approval.schema.json"
                ).read_bytes(),
                (
                    MIGRATION
                    / "verification"
                    / "lovable-toc-operator-identity-recovery-metadata-result.schema.json"
                ).read_bytes(),
            )
        )
        for sentinel in PRIVATE_SENTINELS:
            self.assertNotIn(sentinel, public_process)
            self.assertNotIn(sentinel, ordinary_stdout.getvalue().encode())
            self.assertNotIn(sentinel, ordinary_stderr.getvalue().encode())
            self.assertNotIn(sentinel, tty_writes[0])
            self.assertNotIn(sentinel, public_artifacts)
        self.assertNotIn(
            self.fixture.release_token.encode("ascii"), tty_writes[0]
        )


class PreAuthorizationBoundaryTest(MetadataProbeTestCase):
    def test_wrong_consequence_phrase_performs_zero_private_operations(self):
        before = private_snapshot(self.fixture)
        private_literal = os.fspath(self.fixture.operator_root)
        real_resolve = Path.resolve
        private_calls = {
            name: mock.Mock(side_effect=AssertionError(name))
            for name in (
                "_discover_checkpoint",
                "_discover_root_names",
                "_load_snapshot",
                "_open_checkpoints",
                "_open_private_directory",
                "_revalidate_snapshot",
                "_stable_json_at",
            )
        }
        tty_writes: list[bytes] = []
        with ExitStack() as stack:
            stack.enter_context(
                mock.patch.object(
                    METADATA, "verify_pre_private", return_value=self.verified
                )
            )
            stack.enter_context(
                mock.patch.object(METADATA, "_verify_tty", return_value=None)
            )
            stack.enter_context(
                mock.patch.object(
                    METADATA, "_verify_approved_tty", return_value=None
                )
            )
            stack.enter_context(
                mock.patch.object(
                    METADATA,
                    "_tty_write",
                    side_effect=lambda _fd, payload, **_kwargs: tty_writes.append(
                        payload
                    ),
                )
            )
            stack.enter_context(
                mock.patch.object(
                    METADATA,
                    "_read_hidden",
                    return_value="AUTHORIZE PROBE_RECOVERY_METADATA WRONG-CODE",
                )
            )
            for name, replacement in private_calls.items():
                stack.enter_context(
                    mock.patch.object(METADATA, name, replacement)
                )
            for name in (
                "fsync",
                "lstat",
                "mkdir",
                "open",
                "read",
                "rename",
                "replace",
                "stat",
                "unlink",
                "write",
            ):
                stack.enter_context(
                    mock.patch.object(
                        METADATA.os,
                        name,
                        side_effect=AssertionError(
                            "preauthorization-private-operation-" + name
                        ),
                    )
                )
            stack.enter_context(
                mock.patch.object(
                    METADATA.os,
                    "listdir",
                    side_effect=AssertionError(
                        "preauthorization-private-operation-listdir"
                    ),
                )
            )
            stack.enter_context(
                mock.patch.object(
                    Path,
                    "resolve",
                    side_effect=lambda value, *args, **kwargs: (
                        (_ for _ in ()).throw(
                            AssertionError(
                                "preauthorization-private-resolve"
                            )
                        )
                        if os.fspath(value) == private_literal
                        else real_resolve(value, *args, **kwargs)
                    ),
                )
            )
            with self.assertRaises(METADATA.MetadataProbeError) as raised:
                METADATA.execute(
                    launcher=MIGRATION
                    / "run-lovable-toc-operator-identity-recovery-metadata-probe.sh",
                    ordinary_launcher=MIGRATION
                    / "run-lovable-toc-annotation-operator-session.sh",
                    ordinary_module=SESSION,
                    tty_fd=91,
                    metadata_bootstrap=mock.sentinel.metadata_bootstrap,
                    ordinary_bootstrap=mock.sentinel.ordinary_bootstrap,
                )
        self.assertEqual(raised.exception.reason, "authorization_failed")
        self.assertTrue(tty_writes)
        for replacement in private_calls.values():
            replacement.assert_not_called()
        self.assertEqual(private_snapshot(self.fixture), before)
        ordinary_output = b"".join(tty_writes)
        for sentinel in PRIVATE_SENTINELS:
            self.assertNotIn(sentinel, ordinary_output)

    def test_exact_invocation_bound_phrase_reaches_one_private_load(self):
        invocation_nonce = b"\x19" * METADATA.INVOCATION_NONCE_BYTES
        phrase = (
            "AUTHORIZE PROBE_RECOVERY_METADATA "
            + METADATA._challenge(self.verified, invocation_nonce)
        )
        original_load = METADATA._load_snapshot
        with mock.patch.object(
            METADATA, "verify_pre_private", return_value=self.verified
        ), mock.patch.object(
            METADATA, "_verify_tty", return_value=None
        ), mock.patch.object(
            METADATA, "_verify_approved_tty", return_value=None
        ), mock.patch.object(
            METADATA, "_read_hidden", return_value=phrase
        ), mock.patch.object(
            METADATA.secrets, "token_bytes", return_value=invocation_nonce
        ), mock.patch.object(
            METADATA, "_tty_write", return_value=None
        ), mock.patch.object(
            METADATA, "_load_snapshot", wraps=original_load
        ) as loaded, mock.patch.object(
            METADATA, "emit_success", return_value=None
        ):
            status = METADATA.execute(
                launcher=MIGRATION
                / "run-lovable-toc-operator-identity-recovery-metadata-probe.sh",
                ordinary_launcher=MIGRATION
                / "run-lovable-toc-annotation-operator-session.sh",
                ordinary_module=SESSION,
                tty_fd=91,
                metadata_bootstrap=mock.sentinel.metadata_bootstrap,
                ordinary_bootstrap=mock.sentinel.ordinary_bootstrap,
            )
        self.assertEqual(status, 0)
        loaded.assert_called_once()

    def test_challenge_is_bound_to_invocation_and_every_approval_tuple(self):
        invocation = b"\x06" * METADATA.INVOCATION_NONCE_BYTES
        baseline = METADATA._challenge(self.verified, invocation)
        changed: list[METADATA.MetadataVerified] = []

        approval = copy.deepcopy(self.verified.approval)
        approval["metadata_session"]["metadata_session_id"] = "different-session"
        changed.append(replace(self.verified, approval=approval))

        approval = copy.deepcopy(self.verified.approval)
        approval["metadata_session"]["nonce"] = "1" * 64
        changed.append(replace(self.verified, approval=approval))

        changed.extend(
            (
                replace(self.verified, approval_sha256="2" * 64),
                replace(self.verified, profile_sha256="3" * 64),
                replace(self.verified, procedure_identity_sha256="4" * 64),
                replace(
                    self.verified,
                    ordinary=types.SimpleNamespace(
                        **{
                            **vars(self.verified.ordinary),
                            "approval_sha256": "5" * 64,
                        }
                    ),
                ),
            )
        )
        for item in changed:
            self.assertNotEqual(METADATA._challenge(item, invocation), baseline)
        self.assertNotEqual(
            METADATA._challenge(
                self.verified,
                b"\x07" * METADATA.INVOCATION_NONCE_BYTES,
            ),
            baseline,
        )


class PrivateChainFailureTest(MetadataProbeTestCase):
    def test_duplicate_fork_stale_and_locked_operator_namespaces_are_generic(self):
        def duplicate_current():
            RECOVERY_TESTS.write_private_json(
                self.fixture.operator_root
                / (
                    "resume-current-g0000000000000001-"
                    + ("1" * 64)
                    + ".json"
                ),
                self.fixture.resume,
            )

        def forked_root():
            RECOVERY_TESTS.write_private_json(
                self.fixture.operator_root
                / ("authorization-root-" + ("1" * 16) + ".json"),
                self.fixture.root,
            )

        def stale_execution():
            self.fixture.resume["execution_checkout_sha"] = "1" * 40
            self.fixture.rewrite()

        def locked():
            path = self.fixture.operator_root / RECOVERY_TESTS.RECOVERY.LOCK_NAME
            path.write_bytes(b"synthetic-blocking-lock\n")
            path.chmod(0o400)

        for label, mutate in (
            ("duplicate_current", duplicate_current),
            ("forked_root", forked_root),
            ("stale_execution", stale_execution),
            ("locked", locked),
        ):
            with self.subTest(label=label):
                self.fixture.close()
                self.fixture = SyntheticGenerationOne()
                self.verified = synthetic_verified(self.fixture)
                mutate()
                self.assert_private_failure()

    def test_root_annotation_and_checkpoint_namespace_mismatches_are_generic(self):
        mutations = {
            "extra_root_name": lambda: (
                self.fixture.operator_root / "unexpected-private-sentinel"
            ).write_bytes(b"not-readable"),
            "missing_resume": lambda: (
                self.fixture.operator_root / self.fixture.resume_name
            ).unlink(),
            "extra_annotation_name": lambda: (
                self.fixture.annotation_root / "unexpected-private-sentinel"
            ).write_bytes(b"not-readable"),
            "extra_checkpoint_name": lambda: (
                self.fixture.checkpoints / "unexpected-private-sentinel"
            ).write_bytes(b"not-readable"),
        }
        for label, mutate in mutations.items():
            with self.subTest(label=label):
                self.fixture.close()
                self.fixture = SyntheticGenerationOne()
                self.verified = synthetic_verified(self.fixture)
                mutate()
                self.assert_private_failure()

    def test_symlink_hardlink_and_wrong_mode_are_indeterminate(self):
        def symlink_resume():
            resume = self.fixture.operator_root / self.fixture.resume_name
            resume.unlink()
            resume.symlink_to(self.fixture.base / "outside-private-sentinel")

        def hardlink_root():
            os.link(
                self.fixture.operator_root / self.fixture.root_name,
                self.fixture.base / "root-hardlink-private-sentinel",
            )

        def permissive_checkpoint():
            (self.fixture.checkpoints / self.fixture.checkpoint_name).chmod(0o600)

        for label, mutate in (
            ("resume_symlink", symlink_resume),
            ("root_hardlink", hardlink_root),
            ("checkpoint_mode", permissive_checkpoint),
        ):
            with self.subTest(label=label):
                self.fixture.close()
                self.fixture = SyntheticGenerationOne()
                self.verified = synthetic_verified(self.fixture)
                mutate()
                self.assert_private_failure("indeterminate")

    def test_generation_state_predecessor_release_and_capture_mismatches(self):
        def wrong_generation():
            self.fixture.resume["resume_generation"] = 2
            self.fixture.rewrite()

        def wrong_state():
            self.fixture.checkpoint["event"]["action"] = "primary_review"
            self.fixture.rewrite()

        def predecessor_present():
            self.fixture.resume["predecessor"] = {
                "generation": 0,
                "resume_sha256": ZERO64,
            }
            self.fixture.rewrite()

        def wrong_release():
            released = self.fixture.annotation_root / SESSION.AUTHOR.RELEASED_NAME
            released.chmod(0o600)
            released.write_bytes(SESSION.AUTHOR._lock_content("7" * 64))
            released.chmod(0o400)

        def wrong_capture_binding():
            self.fixture.resume["capture"]["raw_toc_sha256"] = "7" * 64
            self.fixture.rewrite()

        for label, mutate in (
            ("generation", wrong_generation),
            ("state", wrong_state),
            ("predecessor", predecessor_present),
            ("release", wrong_release),
            ("capture", wrong_capture_binding),
        ):
            with self.subTest(label=label):
                self.fixture.close()
                self.fixture = SyntheticGenerationOne()
                self.verified = synthetic_verified(self.fixture)
                mutate()
                error = self.assert_private_failure()
                self.assertNotIn(PRIVATE_IDENTITY, str(error))

    def test_every_operator_identity_source_must_match_but_is_never_disclosed(self):
        self.fixture.checkpoint["event"][
            "operator_identity"
        ] = "Different Private Identity Sentinel"
        self.fixture.rewrite()
        error = self.assert_private_failure()
        self.assertEqual(error.reason, "private_chain_invalid")
        stream = io.BytesIO()
        with mock.patch.object(
            METADATA.sys, "stderr", types.SimpleNamespace(buffer=stream)
        ):
            METADATA.emit_failure(error.reason)
        self.assertEqual(
            stream.getvalue(),
            METADATA._fixed("failed", "private_chain_invalid"),
        )
        self.assertNotIn(PRIVATE_IDENTITY.encode("ascii"), stream.getvalue())
        self.assertNotIn(b"Different Private Identity Sentinel", stream.getvalue())

    def test_malformed_duplicate_and_noncanonical_private_json_are_generic(self):
        malformed_records = (
            b"{not-json}\n",
            b'{"artifact_kind":"one","artifact_kind":"two"}\n',
            b" " + canonical(self.fixture.root),
        )
        for planted in malformed_records:
            with self.subTest(planted=planted[:24]):
                self.fixture.close()
                self.fixture = SyntheticGenerationOne()
                self.verified = synthetic_verified(self.fixture)
                root_path = self.fixture.operator_root / self.fixture.root_name
                root_path.chmod(0o600)
                root_path.write_bytes(planted)
                root_path.chmod(0o400)
                self.assert_private_failure()

    def test_concurrent_private_record_mutation_is_indeterminate(self):
        before = private_snapshot(self.fixture)
        original = METADATA._revalidate_snapshot

        def mutate_then_revalidate(snapshot):
            root_path = self.fixture.operator_root / self.fixture.root_name
            changed = copy.deepcopy(self.fixture.root)
            changed["session_id"] = "mutated-private-session-sentinel"
            root_path.chmod(0o600)
            root_path.write_bytes(canonical(changed))
            root_path.chmod(0o400)
            return original(snapshot)

        with mock.patch.object(
            METADATA, "_verify_approved_tty", return_value=None
        ), mock.patch.object(
            METADATA, "_tty_write", return_value=None
        ), mock.patch.object(
            METADATA,
            "_revalidate_snapshot",
            side_effect=mutate_then_revalidate,
        ):
            with self.assertRaises(METADATA.MetadataProbeError) as raised:
                METADATA.run_probe(91, self.verified, ordinary_module=SESSION)
        self.assertEqual(raised.exception.reason, "indeterminate")
        self.assertNotEqual(private_snapshot(self.fixture), before)
        self.assertNotIn("mutated-private-session-sentinel", str(raised.exception))

    def test_wrong_owner_and_descriptor_device_disagreement_are_indeterminate(self):
        before = private_snapshot(self.fixture)
        with mock.patch.object(
            METADATA.os, "geteuid", return_value=os.geteuid() + 1
        ), mock.patch.object(
            METADATA, "_verify_approved_tty", return_value=None
        ), mock.patch.object(
            METADATA, "_tty_write", return_value=None
        ):
            with self.assertRaises(METADATA.MetadataProbeError) as raised:
                METADATA.run_probe(91, self.verified, ordinary_module=SESSION)
        self.assertEqual(raised.exception.reason, "indeterminate")
        self.assertEqual(private_snapshot(self.fixture), before)

        real_identity = METADATA._directory_identity
        calls = 0

        def disagree(metadata):
            nonlocal calls
            calls += 1
            identity = real_identity(metadata)
            if calls == 2:
                return (identity[0] + 1, *identity[1:])
            return identity

        with mock.patch.object(
            METADATA, "_directory_identity", side_effect=disagree
        ), mock.patch.object(
            METADATA, "_verify_approved_tty", return_value=None
        ), mock.patch.object(
            METADATA, "_tty_write", return_value=None
        ):
            with self.assertRaises(METADATA.MetadataProbeError) as raised:
                METADATA.run_probe(91, self.verified, ordinary_module=SESSION)
        self.assertEqual(raised.exception.reason, "indeterminate")
        self.assertEqual(private_snapshot(self.fixture), before)

    def test_operator_root_path_replacement_during_revalidation_is_indeterminate(self):
        original = METADATA._revalidate_snapshot
        moved = self.fixture.base / "operator-session-root-replaced"

        def replace_then_revalidate(snapshot):
            self.fixture.operator_root.rename(moved)
            self.fixture.operator_root.mkdir(mode=0o700)
            return original(snapshot)

        writes: list[bytes] = []
        with mock.patch.object(
            METADATA, "_verify_approved_tty", return_value=None
        ), mock.patch.object(
            METADATA,
            "_tty_write",
            side_effect=lambda _fd, payload, **_kwargs: writes.append(payload),
        ), mock.patch.object(
            METADATA,
            "_revalidate_snapshot",
            side_effect=replace_then_revalidate,
        ):
            with self.assertRaises(METADATA.MetadataProbeError) as raised:
                METADATA.run_probe(91, self.verified, ordinary_module=SESSION)
        self.assertEqual(raised.exception.reason, "indeterminate")
        self.assertEqual(writes, [])


class TtyAndOutputFailureTest(MetadataProbeTestCase):
    def test_output_write_failure_is_indeterminate_and_nonleaking(self):
        before = private_snapshot(self.fixture)
        with mock.patch.object(
            METADATA, "_verify_approved_tty", return_value=None
        ), mock.patch.object(
            METADATA,
            "_tty_write",
            side_effect=METADATA.MetadataProbeError("indeterminate"),
        ):
            with self.assertRaises(METADATA.MetadataProbeError) as raised:
                METADATA.run_probe(91, self.verified, ordinary_module=SESSION)
        self.assertEqual(raised.exception.reason, "indeterminate")
        self.assertEqual(private_snapshot(self.fixture), before)
        for sentinel in PRIVATE_SENTINELS:
            self.assertNotIn(sentinel.decode("ascii"), str(raised.exception))

    def test_tty_drift_before_output_withholds_result_and_is_indeterminate(self):
        before = private_snapshot(self.fixture)
        writes: list[bytes] = []
        with mock.patch.object(
            METADATA,
            "_verify_approved_tty",
            side_effect=METADATA.MetadataProbeError("indeterminate"),
        ), mock.patch.object(
            METADATA,
            "_tty_write",
            side_effect=lambda _fd, payload, **_kwargs: writes.append(payload),
        ):
            with self.assertRaises(METADATA.MetadataProbeError) as raised:
                METADATA.run_probe(91, self.verified, ordinary_module=SESSION)
        self.assertEqual(raised.exception.reason, "indeterminate")
        self.assertEqual(writes, [])
        self.assertEqual(private_snapshot(self.fixture), before)

    def test_tty_drift_after_complete_output_is_still_indeterminate(self):
        before = private_snapshot(self.fixture)
        writes: list[bytes] = []
        checks = iter(
            (
                None,
                METADATA.MetadataProbeError("indeterminate"),
            )
        )

        def verify(*_args, **_kwargs):
            value = next(checks)
            if value is not None:
                raise value

        with mock.patch.object(
            METADATA, "_verify_approved_tty", side_effect=verify
        ), mock.patch.object(
            METADATA,
            "_tty_write",
            side_effect=lambda _fd, payload, **_kwargs: writes.append(payload),
        ):
            with self.assertRaises(METADATA.MetadataProbeError) as raised:
                METADATA.run_probe(91, self.verified, ordinary_module=SESSION)
        self.assertEqual(raised.exception.reason, "indeterminate")
        self.assertEqual(writes, [canonical(exact_expected_result(self.fixture, self.verified))])
        self.assertEqual(private_snapshot(self.fixture), before)

    def test_partial_low_level_tty_write_is_indeterminate_without_fallback(self):
        calls: list[bytes] = []

        def write(_fd: int, payload) -> int:
            data = bytes(payload)
            calls.append(data)
            if len(calls) == 1:
                return min(7, len(data))
            raise OSError("planted-private-output-write-sentinel")

        with mock.patch.object(METADATA.os, "write", side_effect=write):
            with self.assertRaises(METADATA.MetadataProbeError) as raised:
                METADATA._tty_write(
                    91,
                    b'{"private_result":"planted-output-sentinel"}\n',
                    private_access_started=True,
                )
        self.assertEqual(raised.exception.reason, "indeterminate")
        self.assertEqual(len(calls), 2)
        self.assertNotIn("planted-output-sentinel", str(raised.exception))

    def test_private_file_descriptor_close_failure_is_indeterminate(self):
        before = private_snapshot(self.fixture)
        real_close = os.close
        failed_descriptor: list[int] = []

        def close(descriptor: int) -> None:
            if not failed_descriptor:
                failed_descriptor.append(descriptor)
                raise OSError("planted-close-failure-sentinel")
            real_close(descriptor)

        try:
            with mock.patch.object(
                METADATA, "_verify_approved_tty", return_value=None
            ), mock.patch.object(
                METADATA, "_tty_write", return_value=None
            ), mock.patch.object(
                METADATA.os, "close", side_effect=close
            ):
                with self.assertRaises(METADATA.MetadataProbeError) as raised:
                    METADATA.run_probe(
                        91, self.verified, ordinary_module=SESSION
                    )
            self.assertEqual(raised.exception.reason, "indeterminate")
            self.assertEqual(private_snapshot(self.fixture), before)
            self.assertNotIn("planted-close-failure-sentinel", str(raised.exception))
        finally:
            if failed_descriptor:
                try:
                    real_close(failed_descriptor[0])
                except OSError:
                    pass


if __name__ == "__main__":
    unittest.main()
