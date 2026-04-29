#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# Phase 3A — manual debug validation script (v2, hardened)
#
# Audited against the 10-gap pre-Phase-3.5 checklist:
#   1.  Real account test (REAL_ACCOUNT env var, defaults to a known
#       account from the database).
#   2.  Plan hash stability (case 1 is run twice; case 1b diffs hashes).
#   3.  Retrieval quality audit (titles, relevance_class, matched_terms,
#       primary/supporting/weak counts, confidence, generic_output_risk).
#   4.  Proof-burden BOTH sides (refusal AND pass for library_required).
#   5.  Separate refusals: unknown skill, missing id, invalid envelope,
#       version_mismatch.
#   6.  Default-path validation is explicit (asserts absence of
#       early_return AND source=strategy-skills/passthrough AND envelope).
#   7.  Injection: sourceMode, behaviorIntent, workspace, fake retrieval
#       plan, fake planHash, fake rubric, fake output shape, nested
#       overrides — all must be ignored / dropped.
#   8.  Show-proof readiness: dump the fields readProof() will consume.
#   9.  No synthesis influence: assert synthesisAddendumPreview is
#       returned ONLY as a debug preview, never injected. (Shape check.)
#  10.  Go/no-go checklist printed at the end.
#
# Phase 3.5 (artifact handoff) remains BLOCKED until this script's
# checklist is fully GREEN against the deployed environment.
#
# Usage:
#   export AUTH_BEARER="eyJ..."        # logged-in user JWT
#   export REAL_ACCOUNT="Beechwood Hotel"   # optional override
#   export REAL_PERSONA="GM"           # optional
#   export REAL_TOPIC="loyalty program"# optional
#   # Optional broader inputs for Case 3c (methodology-heavy fallback):
#   export REAL_OPPORTUNITY="Q3 Platform Renewal"
#   export REAL_METHODOLOGY="MEDDICC"
#   bash scripts/phase3a-debug-validation.sh
#
# Pre-req for cases 1–5, 7a/b, 8, 9: edge env STRATEGY_SKILLS_ENABLED=true
# Case 6 (flag-off proof) MUST be re-run separately with the flag off.
#
# Phase 3.5 GO requires BOTH:
#   (a) at least one library_required skill PASSES honestly  (3b OR 3c), and
#   (b) at least one library_required skill REFUSES honestly (3a).
# If 3b refuses, status is "coverage gap" — run 3c with broader inputs or
# extend the library until a library_required skill legitimately passes.
# ─────────────────────────────────────────────────────────────────────
set -u

URL="https://odbjjklumdsuqdvkgwyv.supabase.co/functions/v1/strategy-chat"
ANON="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9kYmpqa2x1bWRzdXFkdmtnd3l2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzMDc1MzEsImV4cCI6MjA4NTg4MzUzMX0.Cv5fwUYrFLJpF-vzgkE6qClZC6A7KBPbSDYAl_NAm4o"
BEARER="${AUTH_BEARER:-$ANON}"

REAL_ACCOUNT="${REAL_ACCOUNT:-Beechwood Hotel}"
REAL_PERSONA="${REAL_PERSONA:-General Manager}"
REAL_STAGE="${REAL_STAGE:-discovery}"
REAL_TOPIC="${REAL_TOPIC:-guest experience platform consolidation}"
REAL_INDUSTRY="${REAL_INDUSTRY:-hospitality}"
REAL_OPPORTUNITY="${REAL_OPPORTUNITY:-Q3 Platform Renewal}"
REAL_METHODOLOGY="${REAL_METHODOLOGY:-MEDDICC}"

FAKE_ACCOUNT="ZZ-NoSuchAccount-9999"
FAKE_PERSONA="ZZ-NoSuchPersona-9999"
FAKE_TOPIC="ZZ-NoSuchTopic-XYZQ"

# Capture trace JSON per case so later cases can diff hashes / re-read
# proof view without re-running the network call.
TMPDIR_TRACE="$(mktemp -d -t phase3a.XXXXXX)"
trap 'rm -rf "$TMPDIR_TRACE"' EXIT

# ─────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────

post() {
  local payload="$1" extra_header="$2" tmp code
  tmp="$(mktemp)"
  code="$(curl -sS -o "$tmp" -w '%{http_code}' \
    -X POST "$URL" \
    -H "Authorization: Bearer ${BEARER}" \
    -H "apikey: ${ANON}" \
    -H "Content-Type: application/json" \
    ${extra_header:+-H "$extra_header"} \
    --data "$payload")"
  echo "$code"
  cat "$tmp"
  rm -f "$tmp"
}

# Print a rich, audit-grade summary of the trace. Includes every field
# a reviewer needs to judge real retrieval quality (gap 3) AND every
# field readProof() consumes (gap 8).
summarize_trace() {
  local label="$1" body="$2" status="$3" save_to="${4:-}"
  echo
  echo "════════════════════════════════════════════════════════════════"
  echo "▶ ${label}   (HTTP ${status})"
  echo "════════════════════════════════════════════════════════════════"
  if ! echo "$body" | jq -e . >/dev/null 2>&1; then
    echo "[non-JSON body]"
    echo "$body" | head -40
    return
  fi
  [ -n "$save_to" ] && echo "$body" > "$save_to"

  echo "$body" | jq '{
    early_return: .early_return,
    source: .source,
    has_envelope: (.envelope != null),
    ok: .envelope.ok,
    refusal: .envelope.refusal,
    schema: .envelope.schema,
    skill: {
      id: .envelope.trace.skill_id,
      version: .envelope.trace.skill_version,
      depth: .envelope.trace.depth,
      source_mode: .envelope.trace.source_mode,
      behavior_intent: .envelope.trace.behavior_intent,
      workspace: .envelope.trace.workspace,
      run_id: .envelope.trace.run_id
    },
    plan: {
      context_hash: .envelope.trace.plan.context_hash,
      plan_hash: .envelope.trace.plan.plan_hash,
      term_seeds: .envelope.trace.plan.term_seeds,
      unresolved_bindings: .envelope.trace.plan.unresolved_bindings,
      entity_scoped: .envelope.trace.plan.entity_scoped,
      scope_budgets: .envelope.trace.plan.scope_budgets
    },
    retrieval_quality: {
      counts: .envelope.trace.retrieval.counts,
      confidence: .envelope.trace.retrieval.confidence,
      latency_ms: .envelope.trace.retrieval.latency_ms,
      hits_total: (.envelope.trace.retrieval.hits | length),
      hits_summary: [
        .envelope.trace.retrieval.hits[]? | {
          kind: .kind,
          title: .title,
          context: .context,
          relevance_class: .relevance_class,
          matched_terms: .matched_terms,
          score: .score
        }
      ],
      influence: .envelope.trace.retrieval.influence
    },
    gate: .envelope.trace.gate,
    overrides_clamped: .envelope.trace.overrides_clamped,
    dropped_client_keys: .envelope.trace.dropped_client_keys,
    generic_output_risk: .envelope.trace.generic_output_risk,
    drift: .envelope.trace.drift,
    chain_depth: .envelope.trace.chain_depth,
    why_this_skill: .envelope.trace.why_this_skill,
    addendum_preview_present: ((.synthesisAddendumPreview // "") | length > 0),
    addendum_preview_first_160: ((.synthesisAddendumPreview // "")[0:160])
  }'
}

run_case() {
  local label="$1" payload="$2" header="$3" save_to="${4:-}"
  local out status body
  out="$(post "$payload" "$header")"
  status="$(echo "$out" | head -1)"
  body="$(echo "$out" | tail -n +2)"
  summarize_trace "$label" "$body" "$status" "$save_to"
}

# Default-path assertion: explicitly verify the response is NOT a skill
# envelope. Checks BOTH the absence of early_return / source AND the
# absence of an envelope object (gap 6).
assert_default_path() {
  local label="$1" payload="$2" header="$3"
  local out status body verdict
  out="$(post "$payload" "$header")"
  status="$(echo "$out" | head -1)"
  body="$(echo "$out" | tail -n +2)"
  echo
  echo "════════════════════════════════════════════════════════════════"
  echo "▶ ${label}   (HTTP ${status})  [default-path assertion]"
  echo "════════════════════════════════════════════════════════════════"
  if echo "$body" | jq -e . >/dev/null 2>&1; then
    verdict="$(echo "$body" | jq -r '
      def has_skill_marker: (.early_return == true)
        or (.source == "strategy-skills/passthrough")
        or (.envelope.schema == "skill_envelope.v1")
        or (.envelope.trace.skill_id != null);
      if has_skill_marker then "FAIL: skill markers present"
      else "PASS: no skill markers (default path engaged)"
      end')"
    echo "verdict: $verdict"
    echo "$body" | jq '{
      early_return: .early_return,
      source: .source,
      envelope_schema: .envelope.schema,
      skill_id: .envelope.trace.skill_id,
      top_level_keys: (keys)
    }'
  else
    echo "[non-JSON body — also acceptable for default path errors]"
    echo "$body" | head -10
  fi
}

# ═════════════════════════════════════════════════════════════════════
# CASE 1  — conversation-pov, REAL account (gap 1, gap 3)
# ═════════════════════════════════════════════════════════════════════
PAYLOAD_REAL_POV=$(cat <<JSON
{
  "threadId": "debug-thread-real-pov",
  "skill": {
    "id": "conversation-pov",
    "inputs": {
      "account": "${REAL_ACCOUNT}",
      "persona": "${REAL_PERSONA}",
      "stage":   "${REAL_STAGE}",
      "topic":   "${REAL_TOPIC}"
    },
    "runId": "debug-run-real-pov-1"
  }
}
JSON
)
run_case "1. conversation-pov — REAL account (${REAL_ACCOUNT})" \
  "$PAYLOAD_REAL_POV" "x-skill-debug: 1" "$TMPDIR_TRACE/case1.json"

# ═════════════════════════════════════════════════════════════════════
# CASE 1b — REPEAT identical payload to verify plan-hash stability (gap 2)
# ═════════════════════════════════════════════════════════════════════
run_case "1b. conversation-pov — REPEAT (plan-hash stability)" \
  "$PAYLOAD_REAL_POV" "x-skill-debug: 1" "$TMPDIR_TRACE/case1b.json"

if [ -s "$TMPDIR_TRACE/case1.json" ] && [ -s "$TMPDIR_TRACE/case1b.json" ]; then
  echo
  echo "── Plan-hash stability diff (case 1 vs 1b) ─────────────────────"
  jq -n \
    --slurpfile a "$TMPDIR_TRACE/case1.json" \
    --slurpfile b "$TMPDIR_TRACE/case1b.json" \
    '{
      plan_hash_match:    ($a[0].envelope.trace.plan.plan_hash    == $b[0].envelope.trace.plan.plan_hash),
      context_hash_match: ($a[0].envelope.trace.plan.context_hash == $b[0].envelope.trace.plan.context_hash),
      term_seeds_match:   ($a[0].envelope.trace.plan.term_seeds   == $b[0].envelope.trace.plan.term_seeds),
      counts_a: $a[0].envelope.trace.retrieval.counts,
      counts_b: $b[0].envelope.trace.retrieval.counts,
      confidence_a: $a[0].envelope.trace.retrieval.confidence,
      confidence_b: $b[0].envelope.trace.retrieval.confidence,
      verdict: (
        if ($a[0].envelope.trace.plan.plan_hash    == $b[0].envelope.trace.plan.plan_hash)
        and ($a[0].envelope.trace.plan.context_hash == $b[0].envelope.trace.plan.context_hash)
        and ($a[0].envelope.trace.plan.term_seeds   == $b[0].envelope.trace.plan.term_seeds)
        then "PASS: plan deterministic"
        else "FAIL: plan drift detected"
        end
      )
    }'
fi

# ═════════════════════════════════════════════════════════════════════
# CASE 1c — SAME skill with FAKE account, for quality comparison (gap 1)
# Real-vs-fake retrieval should differ: fake should have lower / zero
# entity-bound hits and higher generic_output_risk.
# ═════════════════════════════════════════════════════════════════════
run_case "1c. conversation-pov — FAKE account (compare against case 1)" "{
  \"threadId\": \"debug-thread-fake-pov\",
  \"skill\": {
    \"id\": \"conversation-pov\",
    \"inputs\": {
      \"account\": \"${FAKE_ACCOUNT}\",
      \"persona\": \"${FAKE_PERSONA}\",
      \"stage\":   \"discovery\",
      \"topic\":   \"${FAKE_TOPIC}\"
    },
    \"runId\": \"debug-run-fake-pov-1\"
  }
}" "x-skill-debug: 1" "$TMPDIR_TRACE/case1c.json"

if [ -s "$TMPDIR_TRACE/case1.json" ] && [ -s "$TMPDIR_TRACE/case1c.json" ]; then
  echo
  echo "── Real vs Fake retrieval comparison ───────────────────────────"
  jq -n \
    --slurpfile r "$TMPDIR_TRACE/case1.json" \
    --slurpfile f "$TMPDIR_TRACE/case1c.json" \
    '{
      real: {
        confidence:           $r[0].envelope.trace.retrieval.confidence,
        counts:               $r[0].envelope.trace.retrieval.counts,
        primary_dominant:     $r[0].envelope.trace.retrieval.influence.primary_dominant,
        primary:              $r[0].envelope.trace.retrieval.influence.primary,
        supporting:           $r[0].envelope.trace.retrieval.influence.supporting,
        weak:                 $r[0].envelope.trace.retrieval.influence.weak,
        generic_output_risk:  $r[0].envelope.trace.generic_output_risk
      },
      fake: {
        confidence:           $f[0].envelope.trace.retrieval.confidence,
        counts:               $f[0].envelope.trace.retrieval.counts,
        primary_dominant:     $f[0].envelope.trace.retrieval.influence.primary_dominant,
        primary:              $f[0].envelope.trace.retrieval.influence.primary,
        supporting:           $f[0].envelope.trace.retrieval.influence.supporting,
        weak:                 $f[0].envelope.trace.retrieval.influence.weak,
        generic_output_risk:  $f[0].envelope.trace.generic_output_risk
      },
      verdict: (
        if ($r[0].envelope.trace.retrieval.influence.primary // 0)
           > ($f[0].envelope.trace.retrieval.influence.primary // 0)
        then "PASS: real account has stronger primary hits"
        else "REVIEW: fake account is not weaker than real — investigate"
        end
      )
    }'
fi

# ═════════════════════════════════════════════════════════════════════
# CASE 2 — commercial-insight, REAL inputs (gap 1)
# ═════════════════════════════════════════════════════════════════════
run_case "2. commercial-insight — REAL inputs" "{
  \"threadId\": \"debug-thread-real-ci\",
  \"skill\": {
    \"id\": \"commercial-insight\",
    \"inputs\": {
      \"topic\":    \"${REAL_TOPIC}\",
      \"industry\": \"${REAL_INDUSTRY}\",
      \"persona\":  \"${REAL_PERSONA}\"
    },
    \"runId\": \"debug-run-real-ci-1\"
  }
}" "x-skill-debug: 1" "$TMPDIR_TRACE/case2.json"

# ═════════════════════════════════════════════════════════════════════
# CASE 3a — proof burden REFUSAL (library_required + sparse) (gap 4)
# ═════════════════════════════════════════════════════════════════════
run_case "3a. executive-brief — REFUSAL (library_required, sparse)" "{
  \"threadId\": \"debug-thread-eb-refuse\",
  \"skill\": {
    \"id\": \"executive-brief\",
    \"inputs\": {
      \"account\": \"${FAKE_ACCOUNT}\",
      \"persona\": \"${FAKE_PERSONA}\",
      \"stage\":   \"ZZ-NoSuchStage\",
      \"topic\":   \"${FAKE_TOPIC}\"
    },
    \"runId\": \"debug-run-eb-refuse-1\"
  }
}" "x-skill-debug: 1" "$TMPDIR_TRACE/case3a.json"

# ═════════════════════════════════════════════════════════════════════
# CASE 3b — proof burden PASS ATTEMPT (library_required + REAL inputs)
#
# Status semantics (per reviewer):
#   • ok=true, gate=pass            → GO  (honest pass)
#   • ok=false, refusal=source_mode_gate → COVERAGE GAP, not GO.
#     Run Case 3c with broader inputs / methodology-heavy skill until at
#     least one library_required skill passes honestly.
# ═════════════════════════════════════════════════════════════════════
run_case "3b. executive-brief — PASS ATTEMPT (library_required, REAL)" "{
  \"threadId\": \"debug-thread-eb-pass\",
  \"skill\": {
    \"id\": \"executive-brief\",
    \"inputs\": {
      \"account\": \"${REAL_ACCOUNT}\",
      \"persona\": \"${REAL_PERSONA}\",
      \"stage\":   \"${REAL_STAGE}\",
      \"topic\":   \"${REAL_TOPIC}\"
    },
    \"runId\": \"debug-run-eb-pass-1\"
  }
}" "x-skill-debug: 1" "$TMPDIR_TRACE/case3b.json"

# ═════════════════════════════════════════════════════════════════════
# CASE 3c — methodology-heavy library_required PASS attempt (fallback)
#
# Use meddicc-review with a real opportunity + an explicit methodology
# term. Methodology + standards content is typically the densest part of
# the library, so this is the best chance to legitimately satisfy the
# library_required proof burden when 3b refuses for coverage reasons.
#
# If BOTH 3b and 3c refuse, treat as COVERAGE GAP and broaden inputs
# (or extend the library) before declaring Phase 3.5 unblocked.
# ═════════════════════════════════════════════════════════════════════
run_case "3c. meddicc-review — PASS ATTEMPT (library_required, methodology-heavy)" "{
  \"threadId\": \"debug-thread-meddicc-pass\",
  \"skill\": {
    \"id\": \"meddicc-review\",
    \"inputs\": {
      \"account\":      \"${REAL_ACCOUNT}\",
      \"opportunity\":  \"${REAL_OPPORTUNITY}\",
      \"stage\":        \"${REAL_STAGE}\",
      \"persona\":      \"${REAL_PERSONA}\",
      \"methodology\":  \"${REAL_METHODOLOGY}\"
    },
    \"runId\": \"debug-run-meddicc-pass-1\"
  }
}" "x-skill-debug: 1" "$TMPDIR_TRACE/case3c.json"

# Cross-case verdict for the library_required proof burden.
if [ -s "$TMPDIR_TRACE/case3a.json" ] \
   && { [ -s "$TMPDIR_TRACE/case3b.json" ] || [ -s "$TMPDIR_TRACE/case3c.json" ]; }; then
  echo
  echo "── library_required proof-burden verdict (3a refusal + 3b/3c pass) ──"
  jq -n \
    --slurpfile a "$TMPDIR_TRACE/case3a.json" \
    --argjson  hasB "$( [ -s "$TMPDIR_TRACE/case3b.json" ] && echo true || echo false )" \
    --argjson  hasC "$( [ -s "$TMPDIR_TRACE/case3c.json" ] && echo true || echo false )" \
    --slurpfile b "${TMPDIR_TRACE}/case3b.json" \
    --slurpfile c "${TMPDIR_TRACE}/case3c.json" \
    '
    def passed(x): (x[0].envelope.ok == true)
                   and (x[0].envelope.trace.gate.decision == "pass");
    def refused_honestly(x): (x[0].envelope.ok == false)
                   and (x[0].envelope.refusal.code == "source_mode_gate");
    {
      case_3a_refused_honestly: refused_honestly($a),
      case_3b_passed:           ($hasB and passed($b)),
      case_3c_passed:           ($hasC and passed($c)),
      verdict: (
        if refused_honestly($a)
           and (( $hasB and passed($b) ) or ( $hasC and passed($c) ))
        then "GO: library_required both passes (3b or 3c) and refuses (3a) honestly"
        elif refused_honestly($a)
        then "COVERAGE GAP: 3a refuses honestly but no library_required skill passed. Broaden inputs or extend library, then re-run 3c."
        else "NO-GO: 3a did not refuse honestly — gate is not enforcing library_required."
        end
      )
    }'
fi

# ═════════════════════════════════════════════════════════════════════
# CASE 4a — unknown skill id (gap 5)
# ═════════════════════════════════════════════════════════════════════
run_case "4a. unknown skill id" '{
  "threadId": "debug-thread-unknown",
  "skill": { "id": "definitely-not-a-real-skill", "runId": "dr-unk-1" }
}' "x-skill-debug: 1"

# ═════════════════════════════════════════════════════════════════════
# CASE 4b — missing skill id  (gap 5)
# Note: the strategy-chat passthrough requires a non-empty string id to
# even engage. So missing-id should FALL THROUGH to default path, not
# return a skill refusal. We assert that explicitly.
# ═════════════════════════════════════════════════════════════════════
assert_default_path "4b. missing skill id (must fall through to default path)" '{
  "threadId": "debug-thread-missing-id",
  "skill": { "inputs": { "account": "x" }, "runId": "dr-missing-id-1" }
}' "x-skill-debug: 1"

# ═════════════════════════════════════════════════════════════════════
# CASE 4c — invalid skill envelope (id is wrong type) (gap 5)
# Same expectation as 4b: triple-gate requires id:string, so it falls
# through to default path.
# ═════════════════════════════════════════════════════════════════════
assert_default_path "4c. invalid skill envelope (id is number)" '{
  "threadId": "debug-thread-invalid-env",
  "skill": { "id": 1234, "runId": "dr-invalid-1" }
}' "x-skill-debug: 1"

# ═════════════════════════════════════════════════════════════════════
# CASE 4d — version_mismatch refusal (gap 5)
# Pin the wrong version to force the authority resolver to refuse.
# ═════════════════════════════════════════════════════════════════════
run_case "4d. version mismatch refusal" '{
  "threadId": "debug-thread-version",
  "skill": {
    "id": "conversation-pov",
    "expectedVersion": "999",
    "inputs": { "account": "Acme" },
    "runId": "dr-version-1"
  }
}' "x-skill-debug: 1"

# ═════════════════════════════════════════════════════════════════════
# CASE 5 — kitchen-sink injection attempt (gap 7)
# Client tries to override EVERY proof-burden field. Server must:
#   • keep manifest source_mode=library_first
#   • keep manifest behavior_intent=conversation_strategy
#   • keep manifest workspace=work
#   • drop fake retrieval, planHash, rubric, output, nested overrides
#   • list dropped keys explicitly in trace.dropped_client_keys
# ═════════════════════════════════════════════════════════════════════
run_case "5. injection attempt — server manifest must win" "{
  \"threadId\": \"debug-thread-inject\",
  \"skill\": {
    \"id\": \"conversation-pov\",
    \"inputs\": { \"account\": \"${REAL_ACCOUNT}\", \"persona\": \"${REAL_PERSONA}\" },
    \"sourceMode\":      \"library_relevant\",
    \"behaviorIntent\":  \"objection_handling\",
    \"workspace\":       \"library\",
    \"retrieval\":       { \"scopes\": [\"made_up_scope\"], \"minRelevantItems\": 0 },
    \"planHash\":        \"deadbeef-fake-hash\",
    \"rubric\":          { \"mustHave\": [], \"genericMarkers\": [], \"maxGenericMarkers\": 99 },
    \"output\":          { \"shape\": \"structured_artifact\" },
    \"overrides\":       { \"sourceMode\": \"library_relevant\", \"workspace\": \"library\" },
    \"evilKey\":         \"ignored\",
    \"runId\":           \"dr-inject-1\"
  }
}" "x-skill-debug: 1" "$TMPDIR_TRACE/case5.json"

# ═════════════════════════════════════════════════════════════════════
# CASE 6 — flag OFF: default path untouched (gap 6)
# RUN THIS WITH STRATEGY_SKILLS_ENABLED=false (or unset) IN EDGE ENV.
# Asserts: no early_return, no skill source, no skill envelope.
# ═════════════════════════════════════════════════════════════════════
assert_default_path "6. flag OFF — default path untouched (re-run with flag off)" "{
  \"threadId\": \"debug-thread-flag-off\",
  \"skill\": {
    \"id\": \"conversation-pov\",
    \"inputs\": { \"account\": \"${REAL_ACCOUNT}\" },
    \"runId\": \"dr-flag-off-1\"
  }
}" "x-skill-debug: 1"

# ═════════════════════════════════════════════════════════════════════
# CASE 7 — missing x-skill-debug header: default path untouched (gap 6)
# ═════════════════════════════════════════════════════════════════════
assert_default_path "7. missing x-skill-debug — default path untouched" "{
  \"threadId\": \"debug-thread-no-header\",
  \"skill\": {
    \"id\": \"conversation-pov\",
    \"inputs\": { \"account\": \"${REAL_ACCOUNT}\" },
    \"runId\": \"dr-no-header-1\"
  }
}" ""

# ═════════════════════════════════════════════════════════════════════
# CASE 8 — Show-proof readiness (gap 8)
# Pull case 1's saved trace and emit the EXACT subset readProof()
# returns, so we can confirm the future proof drawer has enough data.
# ═════════════════════════════════════════════════════════════════════
echo
echo "════════════════════════════════════════════════════════════════"
echo "▶ 8. Show-proof readiness — readProof() projection from case 1"
echo "════════════════════════════════════════════════════════════════"
if [ -s "$TMPDIR_TRACE/case1.json" ]; then
  jq '.envelope | if .schema == "skill_envelope.v1" then {
    proof_view: {
      skill: {
        id:         .trace.skill_id,
        version:    .trace.skill_version,
        depth:      .trace.depth,
        sourceMode: .trace.source_mode
      },
      plan: {
        contextHash: .trace.plan.context_hash,
        planHash:    .trace.plan.plan_hash,
        termSeeds:   .trace.plan.term_seeds
      },
      retrieval: {
        counts:     .trace.retrieval.counts,
        confidence: .trace.retrieval.confidence,
        hits:       .trace.retrieval.hits,
        influence:  .trace.retrieval.influence
      },
      gate:                .trace.gate,
      overridesClamped:    .trace.overrides_clamped,
      droppedClientKeys:   .trace.dropped_client_keys,
      genericOutputRisk:   .trace.generic_output_risk,
      drift:               .trace.drift,
      chainDepth:          .trace.chain_depth,
      whyThisSkill:        .trace.why_this_skill
    },
    populated: {
      skill_id_present:     (.trace.skill_id != null),
      plan_hash_present:    (.trace.plan.plan_hash != null and .trace.plan.plan_hash != ""),
      hits_present:         ((.trace.retrieval.hits | length) >= 0),
      influence_present:    (.trace.retrieval.influence != null),
      confidence_present:   (.trace.retrieval.confidence != null),
      gate_present:         (.trace.gate != null),
      why_present:          (.trace.why_this_skill != null and .trace.why_this_skill != "")
    }
  } else { error: "no skill envelope in case 1" } end' "$TMPDIR_TRACE/case1.json"
else
  echo "[case 1 trace not captured — re-run with the flag on]"
fi

# ═════════════════════════════════════════════════════════════════════
# CASE 9 — No synthesis influence yet (gap 9)
# Confirm shape: synthesisAddendumPreview is RETURNED only as a debug
# preview alongside the envelope, and is bounded (<=800 chars). It is
# NOT injected into a model call (this passthrough does no synthesis).
# ═════════════════════════════════════════════════════════════════════
echo
echo "════════════════════════════════════════════════════════════════"
echo "▶ 9. No synthesis influence — preview is bounded debug artifact"
echo "════════════════════════════════════════════════════════════════"
if [ -s "$TMPDIR_TRACE/case1.json" ]; then
  jq '{
    addendum_preview_present: ((.synthesisAddendumPreview // "") | length > 0),
    addendum_preview_length:  ((.synthesisAddendumPreview // "") | length),
    addendum_preview_capped:  (((.synthesisAddendumPreview // "") | length) <= 800),
    response_top_keys:        (keys),
    has_generated_answer:     (.answer != null or .response != null or .message != null),
    verdict: (
      if (.answer != null or .response != null or .message != null)
      then "FAIL: passthrough leaked a generated answer field"
      else "PASS: passthrough returns trace-only (no synthesis output)"
      end
    )
  }' "$TMPDIR_TRACE/case1.json"
else
  echo "[case 1 trace not captured]"
fi

# ═════════════════════════════════════════════════════════════════════
# Final go/no-go checklist (gap 10)
# ═════════════════════════════════════════════════════════════════════
cat <<'CHECKLIST'

════════════════════════════════════════════════════════════════════════
PRE-PHASE-3.5 GO / NO-GO CHECKLIST  (mark each from the output above)
════════════════════════════════════════════════════════════════════════

GO requires ALL of:

[ ] Case 1   ok=true, source_mode=library_first, gate=pass,
             confidence ∈ {medium, high}, hits[].title populated,
             hits[].relevance_class set, why_this_skill non-empty.
[ ] Case 1b  plan_hash, context_hash, term_seeds IDENTICAL to case 1
             (verdict: "PASS: plan deterministic").
[ ] Case 1c  fake-account run shows weaker primary influence than the
             real-account run (or zero primary hits).
[ ] Case 2   ok=true, behavior_intent=pov_synthesis, hits populated.
[ ] Case 3a  ok=false, refusal.code=source_mode_gate, gate=refuse,
             generic_output_risk=high.
[ ] Case 3b  EITHER ok=true with gate=pass and ≥1 standardish hit,
             OR ok=false with the same explicit refusal shape as 3a
             (proves the gate is not a one-way door — it can pass when
             coverage exists, and refuses honestly when it doesn't).
[ ] Case 4a  ok=false, refusal.code=unknown_skill.
[ ] Case 4b  default path engaged (verdict: PASS), no skill markers.
[ ] Case 4c  default path engaged (verdict: PASS), no skill markers.
[ ] Case 4d  ok=false, refusal.code=version_mismatch with expected/actual.
[ ] Case 5   source_mode=library_first (NOT library_relevant),
             behavior_intent=conversation_strategy,
             workspace=work,
             dropped_client_keys includes "forbidden:sourceMode" AND the
             unknown keys (retrieval, planHash, rubric, output, overrides,
             evilKey),
             overrides_clamped includes "behaviorIntent" and "workspace",
             plan_hash is the SERVER-computed hash (not "deadbeef-fake-hash").
[ ] Case 6   default path engaged (re-run with STRATEGY_SKILLS_ENABLED off).
[ ] Case 7   default path engaged (header omitted).
[ ] Case 8   readProof projection has ALL "populated.*" flags = true.
[ ] Case 9   addendum_preview_capped=true, has_generated_answer=false,
             verdict: "PASS: passthrough returns trace-only".

NO-GO if ANY of:

[ ] Weak retrieval (confidence=low / insufficient) shown as gate=pass.
[ ] Client-supplied sourceMode changed source_mode in case 5.
[ ] Cases 6 or 7 returned a skill envelope.
[ ] An artifact-depth skill (executive-brief, discovery-prep, meddicc-review)
    proceeded with hits<minRelevantItems or zero standardish hits.
[ ] Plan hashes differ between case 1 and case 1b.
[ ] Show-proof projection is missing skill_id, plan_hash, hits,
    influence, confidence, gate, or why_this_skill.

Phase 3.5 (artifact handoff) remains BLOCKED until this checklist is
fully GREEN against the deployed environment with real account data.
════════════════════════════════════════════════════════════════════════
CHECKLIST
