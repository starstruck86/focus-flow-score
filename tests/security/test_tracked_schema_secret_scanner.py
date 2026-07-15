from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCANNER = ROOT / "scripts" / "security" / "scan-tracked-schema-secrets.py"
ALLOWED_KEYS = {"path", "finding_type"}


class TrackedSchemaSecretScannerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="schema-secret-scan-")
        self.repo = Path(self.temporary.name)
        result = subprocess.run(
            ["git", "init", "-q", str(self.repo)],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        if result.returncode != 0:
            self.fail("synthetic Git repository setup failed")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def track(self, relative: str, content: str | bytes) -> None:
        path = self.repo / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(content, bytes):
            path.write_bytes(content)
        else:
            path.write_text(content, encoding="utf-8")
        result = subprocess.run(
            ["git", "-C", str(self.repo), "add", "--", relative],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        if result.returncode != 0:
            self.fail("synthetic tracked-file setup failed")

    def run_scanner(
        self,
        *,
        repo_root: Path | None = None,
        extra_environment: dict[str, str] | None = None,
    ) -> subprocess.CompletedProcess[bytes]:
        environment = {
            "HOME": os.environ.get("HOME", str(self.repo)),
            "PATH": os.environ.get("PATH", ""),
            "LC_ALL": "C",
        }
        if extra_environment:
            environment.update(extra_environment)
        return subprocess.run(
            [
                sys.executable,
                str(SCANNER),
                "--repo-root",
                str(self.repo if repo_root is None else repo_root),
            ],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=environment,
        )

    def safe_records(
        self,
        result: subprocess.CompletedProcess[bytes],
        forbidden: tuple[bytes, ...] = (),
    ) -> list[dict[str, str]]:
        if result.stderr:
            self.fail("scanner emitted noncanonical stderr")
        combined = result.stdout + result.stderr
        if any(item in combined for item in forbidden):
            self.fail("scanner leaked matched or poisoned content")
        try:
            text = result.stdout.decode("ascii", errors="strict")
            lines = [line for line in text.splitlines() if line]
            records = [json.loads(line) for line in lines]
        except (UnicodeError, json.JSONDecodeError):
            self.fail("scanner output was not canonical ASCII JSONL")
        for record in records:
            if not isinstance(record, dict) or set(record) != ALLOWED_KEYS:
                self.fail("scanner output included a nonallowlisted field")
            if not all(isinstance(value, str) for value in record.values()):
                self.fail("scanner output field type was invalid")
        return records

    @staticmethod
    def finding(path: str, finding_type: str) -> dict[str, str]:
        return {"path": path, "finding_type": finding_type}

    def test_non_placeholder_cron_header_fails_without_value_leakage(self) -> None:
        poison = "synthetic" + "-cron-value-must-not-escape"
        key = "x-cron" + "-secret"
        self.track("schema.sql", f"select '{{\"{key}\": \"{poison}\"}}'::jsonb;\n")
        result = self.run_scanner()
        records = self.safe_records(result, (poison.encode(),))
        if result.returncode != 1 or records != [
            self.finding("schema.sql", "non_placeholder_x_cron_secret")
        ]:
            self.fail("non-placeholder cron header did not fail canonically")

    def test_embedded_bearer_jwt_fails_without_token_leakage(self) -> None:
        token = ".".join(("syntheticHeader", "syntheticPayload", "syntheticSignature"))
        self.track("schema.sql", "select 'Bearer " + token + "';\n")
        result = self.run_scanner()
        records = self.safe_records(result, (token.encode(),))
        if result.returncode != 1 or records != [
            self.finding("schema.sql", "embedded_bearer_jwt")
        ]:
            self.fail("embedded bearer JWT did not fail canonically")

    def test_multiple_matches_are_deduplicated_by_path_and_type(self) -> None:
        token = ".".join(("headerA", "payloadB", "signatureC"))
        key = "x-cron" + "-secret"
        value = "synthetic" + "-static-value"
        content = (
            f"select '{{\"{key}\": \"{value}\"}}';\n"
            f"select '{{\"{key}\": \"{value}\"}}';\n"
            f"select 'Bearer {token}';\n"
            f"select 'Bearer {token}';\n"
        )
        self.track("schema.sql", content)
        result = self.run_scanner()
        records = self.safe_records(result, (token.encode(), value.encode()))
        expected = [
            self.finding("schema.sql", "embedded_bearer_jwt"),
            self.finding("schema.sql", "non_placeholder_x_cron_secret"),
        ]
        if result.returncode != 1 or records != expected:
            self.fail("scanner did not emit a deduplicated canonical finding set")

    def test_exact_template_markers_and_runtime_indirection_pass(self) -> None:
        key = "x-cron" + "-secret"
        markers = (
            "${X_CRON_SECRET}",
            "{{X_CRON_SECRET}}",
            "<X_CRON_SECRET>",
            "__X_CRON_SECRET_REQUIRED__",
        )
        content = "".join(
            f"select '{{\"{key}\": \"{marker}\"}}';\n" for marker in markers
        )
        content += (
            f"select jsonb_build_object('{key}', "
            "current_setting('app.runtime.cron_secret', true));\n"
        )
        self.track("schema.sql", content)
        result = self.run_scanner()
        records = self.safe_records(result)
        if result.returncode != 0 or records:
            self.fail("approved template/runtime indirection was rejected")

    def test_exact_template_markers_pass_in_server_config_formats(self) -> None:
        key = "x-cron" + "-secret"
        self.track(
            "supabase/private/config.yaml",
            f"{key}: ${{X_CRON_SECRET}}\n",
        )
        self.track(
            "supabase/private/config.ini",
            f"{key}=__X_CRON_SECRET_REQUIRED__\n",
        )
        self.track(
            "supabase/private/config.json",
            f'{{"{key}": "<X_CRON_SECRET>"}}\n',
        )
        self.track(
            "supabase/private/config.toml",
            f'{key} = "{{{{X_CRON_SECRET}}}}"\n',
        )
        result = self.run_scanner()
        records = self.safe_records(result)
        if result.returncode != 0 or records:
            self.fail("approved server-config template marker was rejected")

    def test_placeholder_near_miss_fails(self) -> None:
        key = "x-cron" + "-secret"
        near_miss = "${X_CRON_SECRET}" + "-fallback"
        self.track("schema.sql", f"select '{{\"{key}\": \"{near_miss}\"}}';\n")
        result = self.run_scanner()
        records = self.safe_records(result, (near_miss.encode(),))
        if result.returncode != 1 or records != [
            self.finding("schema.sql", "non_placeholder_x_cron_secret")
        ]:
            self.fail("placeholder near-miss did not fail")

    def test_safe_cron_values_reject_hardcoded_expression_suffixes(self) -> None:
        key = "x-cron" + "-secret"
        poison = "synthetic" + "-suffix-must-not-escape"
        cases = (
            (
                "template_concatenation",
                f"select jsonb_build_object('{key}', "
                f"'${{X_CRON_SECRET}}' || '{poison}');\n",
            ),
            (
                "runtime_concatenation",
                f"select jsonb_build_object('{key}', "
                "current_setting('app.runtime.cron_secret', true) || "
                f"'{poison}');\n",
            ),
            (
                "template_multiline_concatenation",
                f"select jsonb_build_object('{key}', "
                f"'${{X_CRON_SECRET}}'\n || '{poison}');\n",
            ),
            (
                "runtime_multiline_concatenation",
                f"select jsonb_build_object('{key}', "
                "current_setting('app.runtime.cron_secret', true)\n || "
                f"'{poison}');\n",
            ),
        )
        for label, content in cases:
            with self.subTest(expression=label):
                self.track("schema.sql", content)
                result = self.run_scanner()
                records = self.safe_records(result, (poison.encode(),))
                if result.returncode != 1 or records != [
                    self.finding("schema.sql", "non_placeholder_x_cron_secret")
                ]:
                    self.fail("hardcoded safe-expression suffix did not fail")

    def test_config_template_markers_reject_continuation_suffixes(self) -> None:
        key = "x-cron" + "-secret"
        poison = "synthetic" + "-continuation-must-not-escape"
        cases = (
            (
                "yaml_continuation",
                "supabase/private/config.yaml",
                f'{key}: "${{X_CRON_SECRET}}"\n  {poison}\n',
            ),
            (
                "ini_continuation",
                "supabase/private/config.ini",
                f'{key}="${{X_CRON_SECRET}}"\n\t{poison}\n',
            ),
            (
                "yaml_blank_line_continuation",
                "supabase/private/config.yaml",
                f'{key}: "${{X_CRON_SECRET}}"\n\n  {poison}\n',
            ),
            (
                "ini_blank_line_continuation",
                "supabase/private/config.ini",
                f'{key}="${{X_CRON_SECRET}}"\n\n\t{poison}\n',
            ),
            (
                "yaml_comment_line_continuation",
                "supabase/private/config.yaml",
                f'{key}: "${{X_CRON_SECRET}}"\n# synthetic comment\n  {poison}\n',
            ),
            (
                "ini_comment_line_continuation",
                "supabase/private/config.ini",
                f'{key}="${{X_CRON_SECRET}}"\n; synthetic comment\n\t{poison}\n',
            ),
            (
                "yaml_same_line_punctuation_suffix",
                "supabase/private/config.yaml",
                f'{key}: "${{X_CRON_SECRET}}", {poison}\n',
            ),
            (
                "ini_same_line_punctuation_suffix",
                "supabase/private/config.ini",
                f'{key}="${{X_CRON_SECRET}}"; {poison}\n',
            ),
            (
                "ini_indented_brace_continuation",
                "supabase/private/config.ini",
                f'{key}="${{X_CRON_SECRET}}"\n  }}{poison}\n',
            ),
        )
        for label, relative, content in cases:
            with self.subTest(config_continuation=label):
                for candidate in (
                    "supabase/private/config.yaml",
                    "supabase/private/config.ini",
                ):
                    self.track(candidate, "safe_setting=enabled\n")
                self.track(relative, content)
                result = self.run_scanner()
                records = self.safe_records(result, (poison.encode(),))
                if result.returncode != 1 or records != [
                    self.finding(relative, "non_placeholder_x_cron_secret")
                ]:
                    self.fail("continued config template value did not fail")

    def test_runtime_secret_setting_assignments_fail_without_value_leakage(self) -> None:
        key = "x-cron" + "-secret"
        setting = "app.runtime.cron" + "_secret"
        poison = "synthetic" + "-runtime-default-must-not-escape"
        approved_read = (
            f"select jsonb_build_object('{key}', "
            f"current_setting('{setting}', true));\n"
        )
        cases = (
            (
                "set_statement",
                f"set {setting} = '{poison}';\n" + approved_read,
            ),
            (
                "set_config_call",
                f"select set_config('{setting}', '{poison}', false);\n"
                + approved_read,
            ),
            (
                "server_config_assignment",
                f"{setting} = '{poison}'\n",
            ),
        )
        for label, content in cases:
            with self.subTest(runtime_assignment=label):
                self.track("schema.sql", "select 1;\n")
                self.track(
                    "supabase/private/config.toml",
                    "safe_setting = true\n",
                )
                relative = (
                    "supabase/private/config.toml"
                    if label == "server_config_assignment"
                    else "schema.sql"
                )
                self.track(relative, content)
                result = self.run_scanner()
                records = self.safe_records(result, (poison.encode(),))
                if result.returncode != 1 or records != [
                    self.finding(
                        relative, "unsafe_cron_secret_runtime_binding"
                    )
                ]:
                    self.fail("runtime cron-secret assignment did not fail")

    def test_alternate_cron_literal_forms_fail_without_value_leakage(self) -> None:
        key = "x-cron" + "-secret"
        poison = "synthetic" + "-alternate-value-must-not-escape"
        cases = (
            (
                "postgres_escape_string",
                "schema.sql",
                f"select jsonb_build_object('{key}', E'{poison}');\n",
            ),
            (
                "postgres_unicode_escape_string",
                "schema.sql",
                f"select jsonb_build_object('{key}', U&'{poison}');\n",
            ),
            (
                "postgres_untagged_dollar_string",
                "schema.sql",
                f"select jsonb_build_object('{key}', $${poison}$$);\n",
            ),
            (
                "postgres_tagged_dollar_string",
                "schema.sql",
                f"select jsonb_build_object('{key}', $credential${poison}$credential$);\n",
            ),
            (
                "postgres_parenthesized_string",
                "schema.sql",
                f"select jsonb_build_object('{key}', ('{poison}'));\n",
            ),
            (
                "postgres_empty_string",
                "schema.sql",
                f"select jsonb_build_object('{key}', '');\n",
            ),
            (
                "yaml_plain_scalar",
                "supabase/private/config.yaml",
                f"{key}: {poison}\n",
            ),
            (
                "ini_unquoted_value",
                "supabase/private/config.ini",
                f"{key}={poison}\n",
            ),
        )
        for label, relative, content in cases:
            with self.subTest(literal_form=label):
                for candidate in (
                    "schema.sql",
                    "supabase/private/config.yaml",
                    "supabase/private/config.ini",
                ):
                    self.track(candidate, "select 1;\n")
                self.track(relative, content)
                result = self.run_scanner()
                forbidden = (
                    ()
                    if label == "postgres_empty_string"
                    else (poison.encode(),)
                )
                records = self.safe_records(result, forbidden)
                if result.returncode != 1 or records != [
                    self.finding(relative, "non_placeholder_x_cron_secret")
                ]:
                    self.fail("alternate non-placeholder cron literal did not fail")

    def test_tracked_sql_and_supabase_server_config_are_both_scanned(self) -> None:
        token = ".".join(("configHeader", "configPayload", "configSignature"))
        self.track("database/schema artifact.sql", "select 1;\n")
        self.track("supabase/private/config.toml", 'header = "Bearer ' + token + '"\n')
        result = self.run_scanner()
        records = self.safe_records(result, (token.encode(),))
        if result.returncode != 1 or records != [
            self.finding("supabase/private/config.toml", "embedded_bearer_jwt")
        ]:
            self.fail("tracked server configuration was not scanned canonically")

    def test_untracked_artifact_is_ignored(self) -> None:
        self.track("tracked.sql", "select 1;\n")
        token = ".".join(("ignoredHeader", "ignoredPayload", "ignoredSignature"))
        (self.repo / "untracked.sql").write_text("select 'Bearer " + token + "';\n")
        result = self.run_scanner()
        records = self.safe_records(result, (token.encode(),))
        if result.returncode != 0 or records:
            self.fail("scanner consumed an untracked artifact")

    def test_derived_snapshot_cannot_reintroduce_executable_cron(self) -> None:
        self.track(
            "supabase/dynamic_staging_schema.sql",
            "select cron" + ".schedule('synthetic', '* * * * *', 'select 1');\n",
        )
        result = self.run_scanner()
        records = self.safe_records(result)
        if result.returncode != 1 or records != [
            self.finding(
                "supabase/dynamic_staging_schema.sql",
                "executable_cron_in_derived_snapshot",
            )
        ]:
            self.fail("derived snapshot executable cron did not fail closed")

    def test_derived_snapshot_rejects_quoted_and_alternate_cron_entrypoints(self) -> None:
        cases = (
            (
                "quoted_schedule",
                "select \"cron\".\"schedule\"('synthetic', '* * * * *', 'select 1');\n",
            ),
            (
                "schedule_in_database",
                "select cron.schedule_in_database("
                "'synthetic', '* * * * *', 'select 1', 'postgres');\n",
            ),
            (
                "quoted_schedule_in_database",
                "select \"cron\".\"schedule_in_database\"("
                "'synthetic', '* * * * *', 'select 1', 'postgres');\n",
            ),
        )
        relative = "supabase/dynamic_staging_schema.sql"
        for label, content in cases:
            with self.subTest(cron_entrypoint=label):
                self.track(relative, content)
                result = self.run_scanner()
                records = self.safe_records(result)
                if result.returncode != 1 or records != [
                    self.finding(relative, "executable_cron_in_derived_snapshot")
                ]:
                    self.fail("alternate executable cron entrypoint did not fail closed")

    def test_derived_snapshot_rejects_comments_between_cron_tokens(self) -> None:
        cases = (
            (
                "comment_before_dot",
                "select cron/* synthetic gap */.schedule("
                "'synthetic', '* * * * *', 'select 1');\n",
            ),
            (
                "comment_before_call",
                "select cron.schedule/* synthetic gap */("
                "'synthetic', '* * * * *', 'select 1');\n",
            ),
            (
                "nested_comment_gap",
                "select cron/* outer /* inner */ outer */.schedule("
                "'synthetic', '* * * * *', 'select 1');\n",
            ),
        )
        relative = "supabase/dynamic_staging_schema.sql"
        for label, content in cases:
            with self.subTest(comment_placement=label):
                self.track(relative, content)
                result = self.run_scanner()
                records = self.safe_records(result)
                if result.returncode != 1 or records != [
                    self.finding(relative, "executable_cron_in_derived_snapshot")
                ]:
                    self.fail("comment-separated executable cron did not fail closed")

    def test_non_utf8_tracked_artifact_fails_closed(self) -> None:
        self.track("schema.sql", b"\xff\xfe\x00")
        result = self.run_scanner()
        records = self.safe_records(result)
        if result.returncode != 2 or records != [
            self.finding("schema.sql", "scan_error")
        ]:
            self.fail("non-UTF-8 tracked artifact did not fail closed")

    def test_missing_tracked_artifact_fails_closed(self) -> None:
        self.track("schema.sql", "select 1;\n")
        (self.repo / "schema.sql").unlink()
        result = self.run_scanner()
        records = self.safe_records(result)
        if result.returncode != 2 or records != [
            self.finding("schema.sql", "scan_error")
        ]:
            self.fail("missing tracked artifact did not fail closed")

    def test_oversized_tracked_artifact_fails_closed(self) -> None:
        relative = "oversized.sql"
        path = self.repo / relative
        with path.open("wb") as stream:
            stream.truncate((16 * 1024 * 1024) + 1)
        result = subprocess.run(
            ["git", "-C", str(self.repo), "add", "--", relative],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        if result.returncode != 0:
            self.fail("synthetic oversized tracked-file setup failed")
        scanned = self.run_scanner()
        records = self.safe_records(scanned)
        if scanned.returncode != 2 or records != [
            self.finding(relative, "scan_error")
        ]:
            self.fail("oversized tracked artifact did not fail closed")

    def test_descriptor_read_mutation_fails_identity_revalidation(self) -> None:
        relative = "mutating.sql"
        self.track(relative, "select 1;\n" + (" " * (1024 * 1024)))
        target = self.repo / relative
        hook_directory = self.repo / "synthetic-hook"
        hook_directory.mkdir()
        hook = hook_directory / "sitecustomize.py"
        hook.write_text(
            """import os

_original_read = os.read
_mutation_done = False


def _mutating_read(descriptor, count):
    global _mutation_done
    target = os.environ.get("SYNTHETIC_MUTATION_TARGET")
    if not _mutation_done and target:
        try:
            opened = os.fstat(descriptor)
            expected = os.stat(target, follow_symlinks=False)
            if (opened.st_dev, opened.st_ino) == (expected.st_dev, expected.st_ino):
                _mutation_done = True
                with open(target, "r+b", buffering=0) as stream:
                    stream.seek(0)
                    stream.write(b"X")
                    os.fsync(stream.fileno())
        except OSError:
            pass
    return _original_read(descriptor, count)


os.read = _mutating_read
""",
            encoding="utf-8",
        )
        scanned = self.run_scanner(
            extra_environment={
                "PYTHONPATH": str(hook_directory),
                "SYNTHETIC_MUTATION_TARGET": str(target),
            }
        )
        records = self.safe_records(scanned)
        if scanned.returncode != 2 or records != [
            self.finding(relative, "scan_error")
        ]:
            self.fail("descriptor mutation escaped identity revalidation")

    def test_path_replacement_during_read_fails_identity_revalidation(self) -> None:
        relative = "replaced.sql"
        self.track(relative, "select 1;\n" + (" " * (1024 * 1024)))
        target = self.repo / relative
        poison = "replacement" + "-content-must-not-escape"
        hook_directory = self.repo / "synthetic-replacement-hook"
        hook_directory.mkdir()
        hook = hook_directory / "sitecustomize.py"
        hook.write_text(
            """import os

_original_read = os.read
_replacement_done = False


def _replacing_read(descriptor, count):
    global _replacement_done
    target = os.environ.get("SYNTHETIC_REPLACEMENT_TARGET")
    replacement = os.environ.get("SYNTHETIC_REPLACEMENT_CONTENT", "")
    if not _replacement_done and target:
        try:
            opened = os.fstat(descriptor)
            expected = os.stat(target, follow_symlinks=False)
            if (opened.st_dev, opened.st_ino) == (expected.st_dev, expected.st_ino):
                _replacement_done = True
                os.replace(target, target + ".previous")
                descriptor_new = os.open(
                    target,
                    os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                    0o600,
                )
                try:
                    os.write(descriptor_new, replacement.encode("utf-8"))
                    os.fsync(descriptor_new)
                finally:
                    os.close(descriptor_new)
        except OSError:
            pass
    return _original_read(descriptor, count)


os.read = _replacing_read
""",
            encoding="utf-8",
        )
        scanned = self.run_scanner(
            extra_environment={
                "PYTHONPATH": str(hook_directory),
                "SYNTHETIC_REPLACEMENT_TARGET": str(target),
                "SYNTHETIC_REPLACEMENT_CONTENT": poison,
            }
        )
        records = self.safe_records(scanned, (poison.encode(),))
        if scanned.returncode != 2 or records != [
            self.finding(relative, "scan_error")
        ]:
            self.fail("tracked pathname replacement escaped identity revalidation")

    @unittest.skipUnless(hasattr(os, "symlink"), "symlink support is required")
    def test_symlinked_tracked_artifact_fails_closed_without_reading_target(self) -> None:
        target = self.repo / "target.txt"
        poison = "symlink" + "-target-must-not-escape"
        target.write_text(poison, encoding="utf-8")
        link = self.repo / "schema.sql"
        link.symlink_to(target.name)
        result = subprocess.run(
            ["git", "-C", str(self.repo), "add", "--", "schema.sql"],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        if result.returncode != 0:
            self.fail("synthetic symlink setup failed")
        scanned = self.run_scanner()
        records = self.safe_records(scanned, (poison.encode(),))
        if scanned.returncode != 2 or records != [
            self.finding("schema.sql", "scan_error")
        ]:
            self.fail("symlinked tracked artifact did not fail closed")

    def test_empty_scan_scope_fails_closed(self) -> None:
        self.track("README.md", "synthetic repository\n")
        result = self.run_scanner()
        records = self.safe_records(result)
        if result.returncode != 2 or records != [self.finding(".", "scan_error")]:
            self.fail("empty scan scope did not fail closed")

    def test_nested_repo_root_is_rejected_before_partial_scan(self) -> None:
        key = "x-cron" + "-secret"
        poison = "synthetic" + "-outside-nested-root-must-not-escape"
        self.track(
            "outside.sql",
            f"select jsonb_build_object('{key}', '{poison}');\n",
        )
        self.track("nested/safe.sql", "select 1;\n")
        result = self.run_scanner(repo_root=self.repo / "nested")
        records = self.safe_records(result, (poison.encode(),))
        if result.returncode != 2 or records != [self.finding(".", "scan_error")]:
            self.fail("nested repository root allowed a partial tracked-file scan")

    def test_ambient_alternate_git_index_cannot_hide_a_tracked_finding(self) -> None:
        key = "x-cron" + "-secret"
        poison = "synthetic" + "-alternate-index-must-not-hide"
        self.track(
            "flagged.sql",
            f"select jsonb_build_object('{key}', '{poison}');\n",
        )
        self.track("safe.sql", "select 1;\n")

        alternate_index = self.repo / "alternate.index"
        environment = {
            "HOME": os.environ.get("HOME", str(self.repo)),
            "PATH": os.environ.get("PATH", ""),
            "LC_ALL": "C",
            "GIT_INDEX_FILE": str(alternate_index),
        }
        result = subprocess.run(
            ["git", "-C", str(self.repo), "add", "--", "safe.sql"],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=environment,
        )
        if result.returncode != 0:
            self.fail("synthetic alternate-index setup failed")

        scanned = self.run_scanner(
            extra_environment={"GIT_INDEX_FILE": str(alternate_index)}
        )
        records = self.safe_records(scanned, (poison.encode(),))
        if scanned.returncode != 1 or records != [
            self.finding("flagged.sql", "non_placeholder_x_cron_secret")
        ]:
            self.fail("ambient alternate Git index hid a tracked finding")

    def test_current_repository_is_clean_under_the_scanner(self) -> None:
        result = subprocess.run(
            [sys.executable, str(SCANNER), "--repo-root", str(ROOT)],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        records = self.safe_records(result)
        if result.returncode != 0 or records:
            self.fail("current tracked repository failed credential scanning")

    def test_historical_snapshot_text_diff_is_suppressed(self) -> None:
        attributes = ROOT / ".gitattributes"
        try:
            lines = attributes.read_text(encoding="utf-8").splitlines()
        except (OSError, UnicodeError):
            self.fail("repository attributes could not be read")
        if "supabase/dynamic_staging_schema.sql -diff" not in lines:
            self.fail("historical credential-bearing snapshot diff is not suppressed")


if __name__ == "__main__":
    unittest.main()
