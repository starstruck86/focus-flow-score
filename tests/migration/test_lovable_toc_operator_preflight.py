from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "scripts" / "migration"
PROFILE_PATH = (
    MIGRATION
    / "verification"
    / "lovable-toc-operator-execution-profile.v1.json"
)
PROFILE_SCHEMA_PATH = (
    MIGRATION
    / "verification"
    / "lovable-toc-operator-execution-profile.schema.json"
)
APPROVAL_SCHEMA_PATH = (
    MIGRATION
    / "verification"
    / "lovable-toc-operator-execution-profile-approval.schema.json"
)


def load_preflight():
    path = MIGRATION / "lib" / "lovable_toc_operator_preflight.py"
    spec = importlib.util.spec_from_file_location(
        "lovable_toc_operator_preflight_test", path
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("preflight module load failed")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


PREFLIGHT = load_preflight()


def git(repository: Path, *arguments: str) -> str:
    result = subprocess.run(
        ["/usr/bin/git", *arguments],
        cwd=repository,
        check=True,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env={
            "GIT_CONFIG_GLOBAL": "/dev/null",
            "GIT_CONFIG_NOSYSTEM": "1",
            "HOME": str(repository),
            "LANG": "C",
            "LC_ALL": "C",
            "PATH": "/usr/bin:/bin",
        },
        text=True,
    )
    return result.stdout.strip()


def load_profile() -> dict:
    value = PREFLIGHT.strict_canonical_json_loads(
        PROFILE_PATH.read_bytes(),
        maximum_bytes=PREFLIGHT.PROFILE_MAX_BYTES,
        reason="execution_profile_invalid",
    )
    return PREFLIGHT.validate_profile(value)


def procedure_identity(
    profile: dict, name: str, checkout: str, blobs: dict[str, str]
) -> str:
    value = {"execution_checkout_sha": checkout}
    for path in profile["procedure_identity_formulas"][name]["files"]:
        value[path] = blobs[path]
    return PREFLIGHT.sha256_bytes(PREFLIGHT.canonical_json_bytes(value))


def approval_for(
    profile: dict,
    checkout: str,
    blobs: dict[str, str],
    *,
    profile_sha256: str,
    operator_root: str = "/synthetic/private/operator-session",
) -> dict:
    python_unsigned = {
        "absolute_path": profile["python_policy"]["absolute_path"],
        "exact_gid": profile["python_policy"]["exact_gid"],
        "exact_mode": profile["python_policy"]["exact_mode"],
        "exact_nlink": profile["python_policy"]["exact_nlink"],
        "exact_uid": profile["python_policy"]["exact_uid"],
        "reported_version": profile["python_policy"]["reported_version"],
        "sha256": profile["python_policy"]["sha256"],
    }
    return {
        "approved_checkout_sha": checkout,
        "artifact_kind": "lovable_toc_operator_execution_approval",
        "authorizer_identity": "Synthetic Human Reviewer",
        "execution_profile": {
            "format_version": 1,
            "sha256": profile_sha256,
        },
        "format_version": 1,
        "operator_session_root_path": operator_root,
        "procedure_identities": {
            "authoring_sha256": procedure_identity(
                profile, "authoring", checkout, blobs
            ),
            "operator_session_sha256": procedure_identity(
                profile, "operator_session", checkout, blobs
            ),
        },
        "python_identity": {
            **python_unsigned,
            "identity_sha256": PREFLIGHT.sha256_bytes(
                PREFLIGHT.canonical_json_bytes(python_unsigned)
            ),
        },
        "repository": {"name": "focus-flow-score", "owner": "starstruck86"},
        "review_reference": "synthetic-independent-review",
        "reviewed_file_blobs": blobs,
    }


class SyntheticRepository:
    def __init__(self, owner: unittest.TestCase):
        self.owner = owner
        self.temporary = tempfile.TemporaryDirectory(dir="/private/tmp")
        owner.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.repository = self.base / "repository"
        self.approvals = self.base / "approvals"
        self.repository.mkdir(mode=0o700)
        self.approvals.mkdir(mode=0o700)
        self.profile = load_profile()
        for relative in self.profile["reviewed_files"]:
            path = self.repository / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            if relative == PREFLIGHT.PROFILE_RELATIVE_PATH:
                path.write_bytes(PROFILE_PATH.read_bytes())
            else:
                path.write_bytes(("synthetic:" + relative + "\n").encode("ascii"))
        git(self.repository, "init", "-b", "main")
        git(self.repository, "config", "user.name", "Synthetic")
        git(self.repository, "config", "user.email", "synthetic@example.invalid")
        git(self.repository, "add", ".")
        git(self.repository, "commit", "-m", "synthetic profile fixture")
        self.checkout = git(self.repository, "rev-parse", "HEAD")
        git(
            self.repository,
            "update-ref",
            "refs/remotes/origin/main",
            self.checkout,
        )
        self.blobs = {
            relative: git(
                self.repository, "rev-parse", f"{self.checkout}:{relative}"
            )
            for relative in self.profile["reviewed_files"]
        }
        self.profile_sha256 = hashlib.sha256(PROFILE_PATH.read_bytes()).hexdigest()
        self.approval = approval_for(
            self.profile,
            self.checkout,
            self.blobs,
            profile_sha256=self.profile_sha256,
        )
        self.approval_name = (
            f"lovable-toc-operator-approval-{self.checkout}-"
            "0123456789abcdef.json"
        )
        self.write_approval(self.approval_name, self.approval)
        self.launcher = (
            self.repository
            / "scripts"
            / "migration"
            / "run-lovable-toc-annotation-operator-session.sh"
        )

    def write_approval(self, name: str, value: object) -> Path:
        path = self.approvals / name
        path.write_bytes(PREFLIGHT.canonical_json_bytes(value))
        path.chmod(0o400)
        return path

    def verify(self):
        environment = {
            "LANG": "C",
            "LC_ALL": "C",
            "TERM": "xterm-256color",
            "TOC_OPERATOR_TTY_FD": "3",
        }
        with (
            mock.patch.object(
                PREFLIGHT, "verify_startup_environment", return_value=None
            ),
            mock.patch.object(PREFLIGHT, "verify_tty", return_value=None),
            mock.patch.object(
                PREFLIGHT,
                "_verify_python",
                return_value=self.approval["python_identity"]["identity_sha256"],
            ),
        ):
            return PREFLIGHT.verify_pre_private(
                self.launcher,
                3,
                approval_parent=self.approvals,
                environment=environment,
            )


class ProfileContractTests(unittest.TestCase):
    def test_committed_profile_is_canonical_and_exact(self):
        data = PROFILE_PATH.read_bytes()
        profile = load_profile()
        self.assertEqual(PREFLIGHT.canonical_json_bytes(profile), data)
        bridge = profile["compatibility_bridges"][0]
        self.assertEqual(bridge["generation"], 1)
        self.assertEqual(bridge["allowed_action"], "primary_review")
        self.assertEqual(bridge["required_state"], "PRIMARY_REVIEW_REQUIRED")
        self.assertEqual(bridge["resume_predecessor"], "absent")
        self.assertTrue(bridge["self_closing"]["single_use"])
        self.assertEqual(
            bridge["execution_checkout_sha"],
            "b1986e4079b52edbb4ef5cd4c56ed4d20af07195",
        )

    def test_schema_documents_are_valid_json(self):
        for path in (PROFILE_SCHEMA_PATH, APPROVAL_SCHEMA_PATH):
            value = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(value["$schema"], "https://json-schema.org/draft/2020-12/schema")
            self.assertFalse(value["additionalProperties"])

    def test_duplicate_key_nonfinite_noncanonical_and_malformed_fail(self):
        cases = (
            b'{"artifact_kind":"a","artifact_kind":"b"}\n',
            b'{"value":NaN}\n',
            b'{ "value":1 }\n',
            b'{"value":"\xff"}\n',
        )
        for data in cases:
            with self.subTest(data=data):
                with self.assertRaises(PREFLIGHT.PreflightError) as caught:
                    PREFLIGHT.strict_canonical_json_loads(
                        data,
                        maximum_bytes=1024,
                        reason="execution_profile_invalid",
                    )
                self.assertEqual(caught.exception.reason, "execution_profile_invalid")

    def test_oversized_and_deep_json_fail(self):
        with self.assertRaises(PREFLIGHT.PreflightError):
            PREFLIGHT.strict_canonical_json_loads(
                b'{"x":"' + b"a" * 1024 + b'"}\n',
                maximum_bytes=32,
                reason="approval_invalid",
            )
        value: object = "leaf"
        for _ in range(PREFLIGHT.MAX_JSON_DEPTH + 2):
            value = [value]
        with self.assertRaises(PREFLIGHT.PreflightError):
            PREFLIGHT.strict_canonical_json_loads(
                PREFLIGHT.canonical_json_bytes(value),
                maximum_bytes=4096,
                reason="approval_invalid",
            )

    def test_unknown_profile_field_and_wrong_version_fail(self):
        profile = load_profile()
        for mutation in (
            lambda value: value.update({"unknown": True}),
            lambda value: value.update({"format_version": 2}),
        ):
            altered = copy.deepcopy(profile)
            mutation(altered)
            with self.assertRaises(PREFLIGHT.PreflightError) as caught:
                PREFLIGHT.validate_profile(altered)
            self.assertEqual(caught.exception.reason, "execution_profile_invalid")

    def test_profile_rejects_non_self_closing_legacy_bridge(self):
        profile = load_profile()
        profile["compatibility_bridges"][0]["self_closing"]["single_use"] = False
        with self.assertRaises(PREFLIGHT.PreflightError):
            PREFLIGHT.validate_profile(profile)

    def test_profile_rejects_reviewed_file_omission_or_addition(self):
        for mutation in ("omit", "add"):
            profile = load_profile()
            if mutation == "omit":
                profile["reviewed_files"].remove(PREFLIGHT.PROFILE_RELATIVE_PATH)
            else:
                profile["reviewed_files"].append("scripts/migration/unreviewed.py")
                profile["reviewed_files"].sort()
            with self.assertRaises(PREFLIGHT.PreflightError):
                PREFLIGHT.validate_profile(profile)


class ApprovalAndRepositoryTests(unittest.TestCase):
    def setUp(self):
        self.fixture = SyntheticRepository(self)

    def test_exact_external_approval_succeeds_without_private_root_access(self):
        original_open = PREFLIGHT.os.open
        touched: list[str] = []

        def recording_open(path, *args, **kwargs):
            touched.append(os.fspath(path))
            if "synthetic/private/operator-session" in os.fspath(path):
                raise AssertionError("private root accessed")
            return original_open(path, *args, **kwargs)

        with mock.patch.object(PREFLIGHT.os, "open", side_effect=recording_open):
            result = self.fixture.verify()
        self.assertEqual(result.approved_checkout_sha, self.fixture.checkout)
        self.assertEqual(
            result.operator_session_root_path,
            "/synthetic/private/operator-session",
        )
        self.assertTrue(all(result.summary.values()))
        self.assertFalse(
            any("synthetic/private/operator-session" in value for value in touched)
        )

    def test_missing_and_multiple_matching_approvals_fail(self):
        self.fixture.approval_path = self.fixture.approvals / self.fixture.approval_name
        self.fixture.approval_path.unlink()
        with self.assertRaises(PREFLIGHT.PreflightError) as missing:
            self.fixture.verify()
        self.assertEqual(missing.exception.reason, "approval_missing")

        self.fixture.write_approval(self.fixture.approval_name, self.fixture.approval)
        self.fixture.write_approval(
            f"lovable-toc-operator-approval-{self.fixture.checkout}-"
            "fedcba9876543210.json",
            self.fixture.approval,
        )
        with self.assertRaises(PREFLIGHT.PreflightError) as ambiguous:
            self.fixture.verify()
        self.assertEqual(ambiguous.exception.reason, "approval_ambiguous")

    def test_approval_unknown_field_and_noncanonical_bytes_fail(self):
        path = self.fixture.approvals / self.fixture.approval_name
        path.chmod(0o600)
        altered = copy.deepcopy(self.fixture.approval)
        altered["unknown"] = True
        path.write_bytes(PREFLIGHT.canonical_json_bytes(altered))
        path.chmod(0o400)
        with self.assertRaises(PREFLIGHT.PreflightError) as unknown:
            self.fixture.verify()
        self.assertEqual(unknown.exception.reason, "approval_invalid")

        path.chmod(0o600)
        path.write_text(json.dumps(self.fixture.approval, indent=2), encoding="ascii")
        path.chmod(0o400)
        with self.assertRaises(PREFLIGHT.PreflightError) as noncanonical:
            self.fixture.verify()
        self.assertEqual(noncanonical.exception.reason, "approval_invalid")

    def test_approval_mode_hardlink_and_symlink_fail(self):
        path = self.fixture.approvals / self.fixture.approval_name
        path.chmod(0o600)
        with self.assertRaises(PREFLIGHT.PreflightError):
            self.fixture.verify()
        path.chmod(0o400)

        hardlink = self.fixture.base / "approval-hardlink"
        os.link(path, hardlink)
        with self.assertRaises(PREFLIGHT.PreflightError):
            self.fixture.verify()
        hardlink.unlink()

        target = path.read_bytes()
        path.unlink()
        real = self.fixture.base / "real-approval"
        real.write_bytes(target)
        real.chmod(0o400)
        path.symlink_to(real)
        with self.assertRaises(PREFLIGHT.PreflightError):
            self.fixture.verify()

    def test_approval_parent_mode_and_symlink_fail(self):
        self.fixture.approvals.chmod(0o755)
        with self.assertRaises(PREFLIGHT.PreflightError):
            self.fixture.verify()
        self.fixture.approvals.chmod(0o700)

        real = self.fixture.approvals
        alias = self.fixture.base / "approval-alias"
        alias.symlink_to(real, target_is_directory=True)
        with self.assertRaises(PREFLIGHT.PreflightError):
            with (
                mock.patch.object(
                    PREFLIGHT, "verify_startup_environment", return_value=None
                ),
                mock.patch.object(PREFLIGHT, "verify_tty", return_value=None),
            ):
                PREFLIGHT.verify_pre_private(
                    self.fixture.launcher, 3, approval_parent=alias, environment={}
                )

    def test_profile_tampering_fails_against_external_digest(self):
        path = self.fixture.repository / PREFLIGHT.PROFILE_RELATIVE_PATH
        path.write_bytes(
            path.read_bytes().replace(
                b'"primary_review_default":100',
                b'"primary_review_default":99',
            )
        )
        with self.assertRaises(PREFLIGHT.PreflightError):
            self.fixture.verify()

    def test_profile_and_checkout_changed_together_cannot_reuse_old_approval(self):
        marker = self.fixture.repository / "synthetic-change"
        marker.write_text("changed\n", encoding="ascii")
        git(self.fixture.repository, "add", "synthetic-change")
        git(self.fixture.repository, "commit", "-m", "unapproved checkout")
        changed = git(self.fixture.repository, "rev-parse", "HEAD")
        git(
            self.fixture.repository,
            "update-ref",
            "refs/remotes/origin/main",
            changed,
        )
        with self.assertRaises(PREFLIGHT.PreflightError) as caught:
            self.fixture.verify()
        self.assertEqual(caught.exception.reason, "approval_missing")

    def test_dirty_modified_ordinary_and_ignored_untracked_inputs_fail(self):
        reviewed = self.fixture.repository / self.fixture.profile["reviewed_files"][0]
        reviewed.write_bytes(reviewed.read_bytes() + b"dirty\n")
        with self.assertRaises(PREFLIGHT.PreflightError):
            self.fixture.verify()
        git(self.fixture.repository, "checkout", "--", str(reviewed))

        ordinary = self.fixture.repository / "scripts/migration/untracked.py"
        ordinary.write_text("synthetic\n", encoding="ascii")
        with self.assertRaises(PREFLIGHT.PreflightError):
            self.fixture.verify()
        ordinary.unlink()

        ignore = self.fixture.repository / ".gitignore"
        ignore.write_text("scripts/migration/ignored.py\n", encoding="ascii")
        git(self.fixture.repository, "add", ".gitignore")
        git(self.fixture.repository, "commit", "-m", "synthetic ignore")
        changed = git(self.fixture.repository, "rev-parse", "HEAD")
        git(
            self.fixture.repository,
            "update-ref",
            "refs/remotes/origin/main",
            changed,
        )
        ignored = self.fixture.repository / "scripts/migration/ignored.py"
        ignored.write_text("synthetic\n", encoding="ascii")
        with self.assertRaises(PREFLIGHT.PreflightError):
            self.fixture.verify()

    def test_wrong_main_or_origin_relationship_fails(self):
        git(
            self.fixture.repository,
            "update-ref",
            "refs/remotes/origin/main",
            "0" * 40,
        )
        with self.assertRaises(PREFLIGHT.PreflightError) as caught:
            self.fixture.verify()
        self.assertEqual(caught.exception.reason, "repository_binding_mismatch")

    def test_blob_map_omission_addition_and_wrong_procedure_fail(self):
        path = self.fixture.approvals / self.fixture.approval_name
        cases = []
        omitted = copy.deepcopy(self.fixture.approval)
        omitted["reviewed_file_blobs"].pop(next(iter(omitted["reviewed_file_blobs"])))
        cases.append(omitted)
        added = copy.deepcopy(self.fixture.approval)
        added["reviewed_file_blobs"]["scripts/migration/unreviewed.py"] = "a" * 40
        cases.append(added)
        wrong_procedure = copy.deepcopy(self.fixture.approval)
        wrong_procedure["procedure_identities"]["authoring_sha256"] = "a" * 64
        cases.append(wrong_procedure)
        for value in cases:
            with self.subTest(keys=set(value["reviewed_file_blobs"])):
                path.chmod(0o600)
                path.write_bytes(PREFLIGHT.canonical_json_bytes(value))
                path.chmod(0o400)
                with self.assertRaises(PREFLIGHT.PreflightError):
                    self.fixture.verify()

    def test_verifier_never_creates_approval_or_calls_network(self):
        path = self.fixture.approvals / self.fixture.approval_name
        path.unlink()
        original_open = PREFLIGHT.os.open

        def reject_create(path_value, flags, *args, **kwargs):
            self.assertEqual(flags & os.O_CREAT, 0)
            return original_open(path_value, flags, *args, **kwargs)

        with mock.patch.object(PREFLIGHT.os, "open", side_effect=reject_create):
            with self.assertRaises(PREFLIGHT.PreflightError):
                self.fixture.verify()
        self.assertEqual(list(self.fixture.approvals.iterdir()), [])


class PythonAndStartupTests(unittest.TestCase):
    def make_python_contract(self, path: Path) -> tuple[dict, dict]:
        metadata = path.stat()
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        policy = {
            "absolute_path": str(path),
            "exact_gid": metadata.st_gid,
            "exact_mode": format(stat.S_IMODE(metadata.st_mode), "04o"),
            "exact_nlink": 1,
            "exact_uid": metadata.st_uid,
            "executable_required": True,
            "isolated_flags": ["-I", "-S", "-B"],
            "reported_version": "cpython:9.8.7",
            "sha256": digest,
            "symlink_components_forbidden": True,
        }
        unsigned = {
            key: policy[key]
            for key in (
                "absolute_path",
                "exact_gid",
                "exact_mode",
                "exact_nlink",
                "exact_uid",
                "reported_version",
                "sha256",
            )
        }
        approval = {
            **unsigned,
            "identity_sha256": PREFLIGHT.sha256_bytes(
                PREFLIGHT.canonical_json_bytes(unsigned)
            ),
        }
        return {"python_policy": policy}, {"python_identity": approval}

    def test_exact_python_identity_and_isolated_flags_succeed(self):
        temporary = tempfile.TemporaryDirectory(dir="/private/tmp")
        self.addCleanup(temporary.cleanup)
        path = Path(temporary.name) / "python"
        path.write_bytes(b"synthetic python")
        path.chmod(0o755)
        profile, approval = self.make_python_contract(path)
        fake_version = types.SimpleNamespace(major=9, minor=8, micro=7)
        fake_implementation = types.SimpleNamespace(name="cpython")
        fake_flags = types.SimpleNamespace(
            isolated=1,
            ignore_environment=1,
            no_user_site=1,
            no_site=1,
            dont_write_bytecode=1,
        )
        with (
            mock.patch.object(PREFLIGHT.sys, "executable", str(path)),
            mock.patch.object(PREFLIGHT.sys, "version_info", fake_version),
            mock.patch.object(PREFLIGHT.sys, "implementation", fake_implementation),
            mock.patch.object(PREFLIGHT.sys, "flags", fake_flags),
            mock.patch.object(PREFLIGHT.sys, "dont_write_bytecode", True),
        ):
            observed = PREFLIGHT._verify_python(profile, approval)
        self.assertEqual(observed, approval["python_identity"]["identity_sha256"])

    def test_missing_wrong_hash_version_mode_link_and_symlink_fail(self):
        temporary = tempfile.TemporaryDirectory(dir="/private/tmp")
        self.addCleanup(temporary.cleanup)
        path = Path(temporary.name) / "python"
        path.write_bytes(b"synthetic python")
        path.chmod(0o755)
        base_profile, base_approval = self.make_python_contract(path)
        cases = []
        missing = copy.deepcopy(base_profile)
        missing["python_policy"]["absolute_path"] = str(path.with_name("missing"))
        missing_approval = copy.deepcopy(base_approval)
        missing_approval["python_identity"]["absolute_path"] = missing["python_policy"]["absolute_path"]
        cases.append((missing, missing_approval))
        wrong_hash = copy.deepcopy(base_profile)
        wrong_hash["python_policy"]["sha256"] = "a" * 64
        cases.append((wrong_hash, base_approval))
        wrong_version = copy.deepcopy(base_profile)
        wrong_version["python_policy"]["reported_version"] = "cpython:1.2.3"
        cases.append((wrong_version, base_approval))
        wrong_mode = copy.deepcopy(base_profile)
        wrong_mode["python_policy"]["exact_mode"] = "0700"
        cases.append((wrong_mode, base_approval))
        for profile, approval in cases:
            with self.subTest(profile=profile):
                with self.assertRaises(PREFLIGHT.PreflightError):
                    PREFLIGHT._verify_python(profile, approval)

        alias = path.with_name("python-alias")
        alias.symlink_to(path)
        profile, approval = self.make_python_contract(path)
        profile["python_policy"]["absolute_path"] = str(alias)
        approval["python_identity"]["absolute_path"] = str(alias)
        with self.assertRaises(PREFLIGHT.PreflightError):
            PREFLIGHT._verify_python(profile, approval)

        hardlink = path.with_name("python-hardlink")
        os.link(path, hardlink)
        profile, approval = self.make_python_contract(path)
        with self.assertRaises(PREFLIGHT.PreflightError):
            PREFLIGHT._verify_python(profile, approval)

    def test_nonisolated_runtime_flags_fail(self):
        temporary = tempfile.TemporaryDirectory(dir="/private/tmp")
        self.addCleanup(temporary.cleanup)
        path = Path(temporary.name) / "python"
        path.write_bytes(b"synthetic python")
        path.chmod(0o755)
        profile, approval = self.make_python_contract(path)
        fake_version = types.SimpleNamespace(major=9, minor=8, micro=7)
        fake_implementation = types.SimpleNamespace(name="cpython")
        fake_flags = types.SimpleNamespace(
            isolated=0,
            ignore_environment=0,
            no_user_site=0,
            no_site=0,
            dont_write_bytecode=0,
        )
        with (
            mock.patch.object(PREFLIGHT.sys, "executable", str(path)),
            mock.patch.object(PREFLIGHT.sys, "version_info", fake_version),
            mock.patch.object(PREFLIGHT.sys, "implementation", fake_implementation),
            mock.patch.object(PREFLIGHT.sys, "flags", fake_flags),
            mock.patch.object(PREFLIGHT.sys, "dont_write_bytecode", False),
        ):
            with self.assertRaises(PREFLIGHT.PreflightError) as caught:
                PREFLIGHT._verify_python(profile, approval)
        self.assertEqual(caught.exception.reason, "python_identity_mismatch")

    def test_minimal_environment_and_poison_are_fail_closed(self):
        valid = {
            "LANG": "C",
            "LC_ALL": "C",
            "TERM": "xterm-256color",
            "TOC_OPERATOR_TTY_FD": "3",
        }
        with mock.patch.object(
            PREFLIGHT.resource, "getrlimit", return_value=(0, 0)
        ):
            PREFLIGHT.verify_startup_environment(valid)
            for name in sorted(PREFLIGHT.POISON_ENVIRONMENT_NAMES):
                poisoned = dict(valid)
                poisoned[name] = "planted-private-sentinel"
                with self.subTest(name=name):
                    with self.assertRaises(PREFLIGHT.PreflightError) as caught:
                        PREFLIGHT.verify_startup_environment(poisoned)
                    self.assertEqual(
                        caught.exception.reason, "startup_environment_invalid"
                    )
            with self.assertRaises(PREFLIGHT.PreflightError):
                PREFLIGHT.verify_startup_environment({**valid, "HOME": "/tmp"})

    def test_core_dump_limit_is_required(self):
        valid = {
            "LANG": "C",
            "LC_ALL": "C",
            "TERM": "xterm-256color",
            "TOC_OPERATOR_TTY_FD": "3",
        }
        with mock.patch.object(
            PREFLIGHT.resource, "getrlimit", return_value=(1, 1)
        ):
            with self.assertRaises(PREFLIGHT.PreflightError) as caught:
                PREFLIGHT.verify_startup_environment(valid)
        self.assertEqual(caught.exception.reason, "startup_environment_invalid")

    def test_fixed_diagnostics_do_not_include_observed_values(self):
        sentinel = "PRIVATE-PATH-TOC-SQL-SECRET"
        for reason in sorted(PREFLIGHT.PreflightError.ALLOWED_REASONS):
            payload = PREFLIGHT.fixed_diagnostic("failed", reason)
            self.assertNotIn(sentinel.encode("ascii"), payload)
            self.assertEqual(payload, PREFLIGHT.canonical_json_bytes(json.loads(payload)))


if __name__ == "__main__":
    unittest.main()
