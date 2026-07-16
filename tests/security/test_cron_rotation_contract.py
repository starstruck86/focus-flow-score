from dataclasses import dataclass, replace
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]
ROTATION_DESIGN = ROOT / "docs" / "security" / "cron-secret-rotation.md"


LEGACY_HANDOFF_STATES = (
    "LEGACY_IDENTITY_BOUND",
    "LEGACY_PAUSED",
    "LEGACY_DRAINED",
    "VAULT_SENDER_READY",
    "REPLACEMENT_COMMITTED_INACTIVE",
    "REPLACEMENT_VERIFIED_INACTIVE",
    "CONTROLLED_DISPATCH_VERIFIED",
    "REPLACEMENTS_ENABLED",
)

LEGACY_HANDOFF_REQUIRED = (
    "exactly IDs `7`, `9`, and `15`",
    "`jobname`, `schedule`, `username`, `database`",
    "set all three IDs inactive",
    "Do not edit `cron.job` directly",
    "every associated pg_net request is terminal",
    "one serializable, cron-mutation-fenced transaction",
    "one parameter-free private wrapper per bound job/function-slug tuple",
    "same name, schedule, owner, database, and function slug",
    "must not enter\n`LEGACY_PAUSED`",
    "exactly one inactive replacement occupies each bound tuple",
    "zero rows for old IDs `7`, `9`, and `15`",
    "no cron command contains an `x-cron-secret` header construction",
    "keep every replacement schedule inactive",
    "directly exactly once",
    "Never activate a schedule to perform this probe",
    "invocation/transport/application gate",
    "Rollback never reinstalls or re-enables a plaintext legacy command",
)

LEGACY_HANDOFF_FORBIDDEN = (
    "update cron.job set",
    "insert into cron.job",
    "re-enable a plaintext legacy command",
    "invoke wrapper more than once",
)


@dataclass(frozen=True)
class SyntheticCronJob:
    job_id: int
    name: str
    schedule: str
    owner: str
    database: str
    function_slug: str
    active: bool
    command_kind: str

    @property
    def identity(self):
        return (self.name, self.schedule, self.owner, self.database)


@dataclass(frozen=True)
class SyntheticHandoffOutcome:
    state: str
    jobs: tuple
    mutation_started: bool


def synthetic_legacy_jobs():
    return tuple(
        SyntheticCronJob(
            job_id=job_id,
            name=f"synthetic-job-{job_id}",
            schedule=f"{job_id} * * * *",
            owner="synthetic-owner",
            database="synthetic-database",
            function_slug=function_slug,
            active=True,
            command_kind="legacy-plaintext-header",
        )
        for job_id, function_slug in zip(
            (7, 9, 15),
            (
                "synthetic-daily",
                "synthetic-reaper",
                "synthetic-schedule",
            ),
        )
    )


def model_legacy_handoff(
    *,
    mutation_gate_cleared=False,
    drained=True,
    receipt_ready=False,
    controlled_dispatches=0,
    fault=None,
):
    original = synthetic_legacy_jobs()
    if not mutation_gate_cleared or not receipt_ready:
        return SyntheticHandoffOutcome("BLOCKED_BEFORE_PAUSE", original, False)

    paused = tuple(replace(job, active=False) for job in original)
    if not drained or fault == "concurrent_mutation":
        return SyntheticHandoffOutcome("PAUSED_ROLLBACK", paused, True)

    replacements = tuple(
        SyntheticCronJob(
            job_id=job.job_id + 100,
            name=job.name,
            schedule=job.schedule,
            owner=("drifted-owner" if fault == "identity_drift" else job.owner),
            database=job.database,
            function_slug=(
                "drifted-function"
                if fault == "endpoint_drift"
                else job.function_slug
            ),
            active=False,
            command_kind=(
                "legacy-plaintext-header"
                if fault == "plaintext_residual"
                else f"reviewed-wrapper:{job.function_slug}"
            ),
        )
        for job in paused
    )
    if fault == "duplicate_replacement":
        replacements += (replace(replacements[0], job_id=999),)
    if fault == "old_id_retained":
        replacements += (paused[0],)

    original_identities = {job.identity for job in original}
    original_endpoints = {
        job.identity: job.function_slug
        for job in original
    }
    replacement_identities = [job.identity for job in replacements]
    valid_replacement = (
        len(replacements) == 3
        and set(replacement_identities) == original_identities
        and len(set(replacement_identities)) == 3
        and all(job.job_id not in {7, 9, 15} for job in replacements)
        and all(not job.active for job in replacements)
        and all(
            original_endpoints.get(job.identity) == job.function_slug
            and job.command_kind == f"reviewed-wrapper:{job.function_slug}"
            for job in replacements
        )
    )
    if not valid_replacement or fault == "replacement_transaction_failure":
        return SyntheticHandoffOutcome("PAUSED_ROLLBACK", paused, True)

    if not receipt_ready or controlled_dispatches != 1:
        return SyntheticHandoffOutcome(
            "REPLACEMENT_VERIFIED_INACTIVE",
            replacements,
            True,
        )

    # A controlled verification directly invokes the wrapper. It does not
    # activate a cron schedule, so a crash cannot leave a recurring dispatch.
    return SyntheticHandoffOutcome(
        "CONTROLLED_DISPATCH_VERIFIED",
        replacements,
        True,
    )


def legacy_handoff_contract_is_fail_closed(text: str) -> bool:
    lowered = text.lower()
    if any(marker.lower() not in lowered for marker in LEGACY_HANDOFF_REQUIRED):
        return False
    if any(marker in lowered for marker in LEGACY_HANDOFF_FORBIDDEN):
        return False
    table_start = text.find("| `LEGACY_IDENTITY_BOUND`")
    if table_start < 0:
        return False
    positions = [text.find(f"`{state}`", table_start) for state in LEGACY_HANDOFF_STATES]
    return all(position >= 0 for position in positions) and positions == sorted(positions)


def controlled_sql_guard_precedes_dispatch(text: str) -> bool:
    marker = (
        "create function __REQUIRED_PRIVATE_SCHEMA__.invoke_reviewed_cron_probe("
    )
    start = text.find(marker)
    if start < 0:
        return False
    end = text.find("$controlled_probe$;", start)
    if end < 0:
        return False
    block = text[start:end]
    dispatch = block.find("select net.http_post(")
    if dispatch < 0:
        return False
    before_dispatch = block[:dispatch]
    required_before_dispatch = (
        "returns table (attempt_id uuid, request_id bigint)",
        "p_use_rejected_control is null",
        "v_accepted_secret = v_rejected_control",
        "v_accepted_secret = v_api_key",
        "v_rejected_control = v_api_key",
        "v_verify_jwt and v_gateway_jwt is null",
        "v_gateway_jwt = v_accepted_secret",
        "v_gateway_jwt = v_rejected_control",
        "v_gateway_jwt = v_api_key",
        "pg_catalog.octet_length(v_accepted_secret)",
        "pg_catalog.octet_length(v_rejected_control)",
        "pg_catalog.octet_length(v_api_key)",
        "pg_catalog.octet_length(v_gateway_jwt)",
        "v_accepted_secret !~ '^[!-~]+$'",
        "v_rejected_control !~ '^[!-~]+$'",
        "v_api_key !~ '^[!-~]+$'",
        "v_gateway_jwt !~ '^[!-~]+$'",
        "raise exception 'credential domains must be distinct'",
    )
    return (
        all(value in before_dispatch for value in required_before_dispatch)
        and "return query select v_attempt_id, v_request_id" in block[dispatch:]
    )


RECEIVER_SOURCES = (
    ROOT / "supabase" / "functions" / "daily-digest" / "index.ts",
    ROOT / "supabase" / "functions" / "daily-digest" / "handler.ts",
    ROOT / "supabase" / "functions" / "run-strategy-task-reaper" / "index.ts",
    ROOT / "supabase" / "functions" / "run-strategy-task-reaper" / "handler.ts",
    ROOT / "supabase" / "functions" / "schedule-daily-plan" / "index.ts",
    ROOT / "supabase" / "functions" / "schedule-daily-plan" / "handler.ts",
    ROOT / "supabase" / "functions" / "_shared" / "cronHeadReceiver.ts",
)


class CronRotationContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.text = ROTATION_DESIGN.read_text(encoding="utf-8")

    def test_gateway_api_key_and_jwt_are_independent(self) -> None:
        self.assertIn("'apikey', v_api_key", self.text)
        self.assertIn("'authorization', 'Bearer ' || v_gateway_jwt", self.text)
        self.assertIn("v_gateway_jwt = v_api_key", self.text)
        self.assertIn("v_api_key = v_cron_secret", self.text)
        self.assertIn("v_gateway_jwt = v_cron_secret", self.text)
        self.assertNotIn("'authorization', 'Bearer ' || v_api_key", self.text)

        wrapper_start = self.text.index(
            "create function __REQUIRED_PRIVATE_SCHEMA__.invoke_reviewed_cron_job()"
        )
        first_dispatch = self.text.index("select net.http_post(", wrapper_start)
        pre_dispatch = self.text[wrapper_start:first_dispatch]
        self.assertIn("v_api_key = v_cron_secret", pre_dispatch)
        self.assertIn("v_gateway_jwt = v_api_key", pre_dispatch)
        self.assertIn("v_gateway_jwt = v_cron_secret", pre_dispatch)
        self.assertIn("v_api_key !~ '^[!-~]+$'", pre_dispatch)
        self.assertIn("v_cron_secret !~ '^[!-~]+$'", pre_dispatch)
        self.assertIn("v_gateway_jwt !~ '^[!-~]+$'", pre_dispatch)
        self.assertIn("pg_catalog.octet_length(v_cron_secret)", pre_dispatch)
        self.assertIn("pg_catalog.octet_length(v_api_key)", pre_dispatch)
        self.assertIn("pg_catalog.octet_length(v_gateway_jwt)", pre_dispatch)
        self.assertNotIn("v_rejected_control", pre_dispatch)

    def test_controlled_verification_domains_are_pairwise_distinct(self) -> None:
        self.assertTrue(controlled_sql_guard_precedes_dispatch(self.text))
        self.assertIn("must never be\ninstalled as a recurring schedule", self.text)
        self.assertIn("block either branch from deployment or invocation", self.text)
        self.assertIn("grants execute to no operator role", self.text)
        self.assertIn("durable single-invocation enforcement", self.text)

        planted_missing_pair = self.text.replace(
            "v_accepted_secret = v_api_key",
            "v_accepted_secret is not null",
            1,
        )
        self.assertFalse(
            controlled_sql_guard_precedes_dispatch(planted_missing_pair)
        )

        planted_missing_required_jwt = self.text.replace(
            "v_verify_jwt and v_gateway_jwt is null",
            "v_verify_jwt and false",
            1,
        )
        self.assertFalse(
            controlled_sql_guard_precedes_dispatch(planted_missing_required_jwt)
        )

        function_start = self.text.index(
            "create function __REQUIRED_PRIVATE_SCHEMA__.invoke_reviewed_cron_probe("
        )
        begin_at = self.text.index("begin\n", function_start) + len("begin\n")
        planted_early_dispatch = (
            self.text[:begin_at]
            + "  select net.http_post();\n"
            + self.text[begin_at:]
        )
        self.assertFalse(
            controlled_sql_guard_precedes_dispatch(planted_early_dispatch)
        )

    def test_all_caller_branches_are_explicit(self) -> None:
        for branch in (
            "Confirmed no caller/job",
            "Verified pg_cron + Vault caller",
            "Other external caller",
        ):
            self.assertIn(branch, self.text)
        self.assertIn("scheduler as a side effect of credential containment", self.text)

    def test_sanitized_database_evidence_contract_is_present(self) -> None:
        for marker in (
            "security_definer_enabled",
            "proconfig_is_only_empty_search_path",
            "acl_is_owner_plus_job_role_only",
            "definition_fingerprint_matches_reviewed",
            "cron.job_run_details",
            "response_matches_exact_request",
        ):
            self.assertIn(marker, self.text)

    def test_three_layer_gate_and_inferred_run_link_are_explicit(self) -> None:
        self.assertIn("The three required proof", self.text)
        self.assertIn("label that link `INFERRED`", self.text)
        self.assertIn("Ambiguity is a stop", self.text)

    def test_production_legacy_sender_handoff_is_fail_closed(self) -> None:
        self.assertTrue(legacy_handoff_contract_is_fail_closed(self.text))
        self.assertIn("Sanitized production evidence supplied for this review", self.text)
        self.assertIn("active Edge Function callers", self.text)
        self.assertIn("text constructs an `x-cron-secret` header", self.text)
        self.assertIn("does not read Vault", self.text)
        self.assertIn("Production rotation is\n**BLOCKED**", self.text)
        self.assertIn("every later failure leaves all affected jobs inactive", self.text)
        self.assertIn("fresh-install same-name precondition", self.text)
        self.assertIn("must not enter\n`LEGACY_PAUSED`", self.text)
        self.assertIn("Never activate a schedule to perform this probe", self.text)

    def test_blocked_entry_gate_causes_no_production_mutation(self) -> None:
        for inputs in (
            {},
            {"mutation_gate_cleared": True},
            {"receipt_ready": True},
        ):
            with self.subTest(inputs=inputs):
                outcome = model_legacy_handoff(**inputs)
                self.assertEqual(outcome.state, "BLOCKED_BEFORE_PAUSE")
                self.assertFalse(outcome.mutation_started)
                self.assertEqual(outcome.jobs, synthetic_legacy_jobs())

    def test_synthetic_future_handoff_preserves_inactive_identity(self) -> None:
        outcome = model_legacy_handoff(
            mutation_gate_cleared=True,
            receipt_ready=True,
        )
        self.assertEqual(outcome.state, "REPLACEMENT_VERIFIED_INACTIVE")
        self.assertEqual(
            {job.identity for job in outcome.jobs},
            {job.identity for job in synthetic_legacy_jobs()},
        )
        self.assertEqual(len(outcome.jobs), 3)
        self.assertTrue(all(not job.active for job in outcome.jobs))
        self.assertTrue(all(job.job_id not in {7, 9, 15} for job in outcome.jobs))
        self.assertTrue(
            all(
                job.command_kind == f"reviewed-wrapper:{job.function_slug}"
                for job in outcome.jobs
            )
        )

    def test_synthetic_transition_faults_rollback_to_paused_legacy_set(self) -> None:
        for fault in (
            "concurrent_mutation",
            "identity_drift",
            "endpoint_drift",
            "duplicate_replacement",
            "old_id_retained",
            "plaintext_residual",
            "replacement_transaction_failure",
        ):
            with self.subTest(fault=fault):
                outcome = model_legacy_handoff(
                    mutation_gate_cleared=True,
                    receipt_ready=True,
                    fault=fault,
                )
                self.assertEqual(outcome.state, "PAUSED_ROLLBACK")
                self.assertEqual(
                    {job.job_id for job in outcome.jobs},
                    {7, 9, 15},
                )
                self.assertTrue(all(not job.active for job in outcome.jobs))

    def test_controlled_dispatch_never_activates_a_schedule(self) -> None:
        verified = model_legacy_handoff(
            mutation_gate_cleared=True,
            receipt_ready=True,
            controlled_dispatches=1,
        )
        self.assertEqual(verified.state, "CONTROLLED_DISPATCH_VERIFIED")
        self.assertTrue(all(not job.active for job in verified.jobs))

        for dispatches in (0, 2):
            blocked = model_legacy_handoff(
                mutation_gate_cleared=True,
                receipt_ready=True,
                controlled_dispatches=dispatches,
            )
            self.assertEqual(blocked.state, "REPLACEMENT_VERIFIED_INACTIVE")
            self.assertTrue(all(not job.active for job in blocked.jobs))

    def test_legacy_handoff_preserves_identity_without_duplicate_schedules(self) -> None:
        for marker in (
            "same name, schedule, owner, database, and function slug",
            "every command exactly its tuple-bound fixed wrapper call",
            "zero rows for old IDs `7`, `9`, and `15`",
            "exactly three distinct replacement\nIDs",
            "exactly one row for each approved",
            "no committed\nstate contains both an old and replacement schedule",
            "Each new job is disabled\nbefore commit",
        ):
            self.assertIn(marker, self.text)

    def test_legacy_handoff_retirement_and_rollback_never_restore_plaintext(self) -> None:
        for marker in (
            "uses the installed `cron.unschedule` interface for each bound old ID",
            "keep the replacement jobs inactive",
            "same reviewed Vault name",
            "Do not recreate IDs `7`, `9`, or `15`",
            "interpolate a secret into a cron\ncommand",
            "reactivate a legacy sender",
        ):
            self.assertIn(marker, self.text)

    def test_planted_unsafe_legacy_handoffs_are_rejected(self) -> None:
        planted_mutations = (
            (
                "must not enter\n`LEGACY_PAUSED`",
                "may enter\n`LEGACY_PAUSED` by operator attestation",
            ),
            ("set all three IDs inactive", "leave all three IDs active"),
            ("every associated pg_net request is terminal", "request drain is optional"),
            (
                "one serializable, cron-mutation-fenced transaction",
                "several unfenced transactions",
            ),
            (
                "exactly one inactive replacement occupies each bound tuple",
                "duplicate replacements are acceptable",
            ),
            (
                "same name, schedule, owner, database, and function slug",
                "a replacement may change its identity",
            ),
            (
                "no cron command contains an `x-cron-secret` header construction",
                "a cron command may retain the plaintext header",
            ),
            (
                "directly exactly once",
                "invoke wrapper more than once",
            ),
            (
                "keep every replacement schedule inactive",
                "activate one replacement schedule temporarily",
            ),
            (
                "Never activate a schedule to perform this probe",
                "A crash may leave the schedule active indefinitely",
            ),
            (
                "Rollback never reinstalls or re-enables a plaintext legacy command",
                "Rollback may re-enable a plaintext legacy command",
            ),
            (
                "zero rows for old IDs `7`, `9`, and `15`",
                "old job IDs may remain after publication",
            ),
        )
        for original, unsafe in planted_mutations:
            with self.subTest(unsafe=unsafe):
                planted = self.text.replace(original, unsafe, 1)
                self.assertFalse(legacy_handoff_contract_is_fail_closed(planted))

        planted_direct_dml = self.text + "\nUPDATE cron.job SET active = true;\n"
        self.assertFalse(legacy_handoff_contract_is_fail_closed(planted_direct_dml))

    def test_application_receipt_gap_blocks_sender_and_production(self) -> None:
        fixed_gates = (
            "APPLICATION_RECEIPT_STATUS: NOT_IMPLEMENTED",
            "CONTROLLED_SQL_VERIFICATION_STATUS: TEMPLATE_ONLY_BLOCKED",
            "SENDER_ACTIVATION_GATE: BLOCKED",
            "CONTROLLED_DISPATCH_GATE: BLOCKED",
            "LEGACY_HANDOFF_MUTATION_GATE: BLOCKED",
            "PRODUCTION_ROTATION_GATE: BLOCKED",
        )
        for gate in fixed_gates:
            self.assertEqual(
                self.text.count(gate),
                1,
                f"gate must appear exactly once: {gate}",
            )

        for forbidden in (
            "APPLICATION_RECEIPT_STATUS: IMPLEMENTED",
            "CONTROLLED_SQL_VERIFICATION_STATUS: IMPLEMENTED",
            "CONTROLLED_SQL_VERIFICATION_STATUS: READY",
            "SENDER_ACTIVATION_GATE: READY",
            "CONTROLLED_DISPATCH_GATE: READY",
            "LEGACY_HANDOFF_MUTATION_GATE: READY",
            "PRODUCTION_ROTATION_GATE: READY",
        ):
            self.assertNotIn(forbidden, self.text)

        self.assertIn(
            "A caller branch stops here while `CONTROLLED_DISPATCH_GATE` is `BLOCKED`.",
            self.text,
        )
        self.assertIn(
            "The `HEAD` harness may establish receiver-key acceptance and rejection only.",
            self.text,
        )

    def test_all_receivers_are_truthfully_marked_without_receipts(self) -> None:
        for receiver in (
            "daily-digest",
            "run-strategy-task-reaper",
            "schedule-daily-plan",
        ):
            self.assertIn(f"| `{receiver}` | `NOT_IMPLEMENTED` |", self.text)

        for unresolved in (
            "Success, failure, duplicate attempt ID,",
            "and legitimate no-op semantics therefore remain unresolved.",
            "a legitimate no-op is distinguishable",
            "partial failure remains visibly indeterminate",
        ):
            self.assertIn(unresolved, self.text)

        for path in RECEIVER_SOURCES:
            source = path.read_text(encoding="utf-8")
            self.assertNotIn(
                "cron_attempt_id",
                source,
                f"{path.relative_to(ROOT)} consumes an attempt ID; update the receipt gate",
            )


if __name__ == "__main__":
    unittest.main()
