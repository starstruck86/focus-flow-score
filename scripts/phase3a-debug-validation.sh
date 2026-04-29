#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# Phase 3A — manual debug validation script
#
# Exercises the strategy-chat skill passthrough across all 7 cases the
# user requested and prints a compact trace summary for each.
#
# Usage:
#   export AUTH_BEARER="eyJ..."   # logged-in user JWT (from browser devtools)
#   bash scripts/phase3a-debug-validation.sh
#
# All requests hit the deployed edge function. The skill passthrough is
# triple-gated server-side:
#   1. STRATEGY_SKILLS_ENABLED=true (env)
#   2. x-skill-debug: 1 (header)
#   3. body.skill.id present
# Cases 6 and 7 deliberately omit a guard to prove the default path is
# byte-identical.
#
# IMPORTANT: enable the flag in the edge function env first:
#   STRATEGY_SKILLS_ENABLED=true
# Otherwise even the "success" cases fall through to the default chat
# handler. Case 6 below verifies that fall-through explicitly.
# ─────────────────────────────────────────────────────────────────────
set -u

URL="https://odbjjklumdsuqdvkgwyv.supabase.co/functions/v1/strategy-chat"
ANON="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9kYmpqa2x1bWRzdXFkdmtnd3l2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzMDc1MzEsImV4cCI6MjA4NTg4MzUzMX0.Cv5fwUYrFLJpF-vzgkE6qClZC6A7KBPbSDYAl_NAm4o"
BEARER="${AUTH_BEARER:-$ANON}"

# Pretty-print key trace fields. Falls back to raw body if not JSON.
summarize() {
  local label="$1" body="$2" status="$3"
  echo
  echo "════════════════════════════════════════════════════════════════"
  echo "▶ ${label}   (HTTP ${status})"
  echo "════════════════════════════════════════════════════════════════"
  if echo "$body" | jq -e . >/dev/null 2>&1; then
    echo "$body" | jq '{
      early_return: .early_return,
      source: .source,
      ok: .envelope.ok,
      refusal: .envelope.refusal,
      skill: .envelope.trace.skill_id,
      version: .envelope.trace.skill_version,
      depth: .envelope.trace.depth,
      source_mode: .envelope.trace.source_mode,
      behavior_intent: .envelope.trace.behavior_intent,
      workspace: .envelope.trace.workspace,
      term_seeds: .envelope.trace.plan.term_seeds,
      plan_hash: .envelope.trace.plan.plan_hash,
      context_hash: .envelope.trace.plan.context_hash,
      counts: .envelope.trace.retrieval.counts,
      confidence: .envelope.trace.retrieval.confidence,
      influence: .envelope.trace.retrieval.influence,
      gate: .envelope.trace.gate,
      generic_output_risk: .envelope.trace.generic_output_risk,
      drift: .envelope.trace.drift,
      chain_depth: .envelope.trace.chain_depth,
      overrides_clamped: .envelope.trace.overrides_clamped,
      dropped_client_keys: .envelope.trace.dropped_client_keys,
      why_this_skill: .envelope.trace.why_this_skill,
      addendum_preview_first_120: (.synthesisAddendumPreview // "" | .[0:120])
    }'
  else
    echo "$body" | head -40
  fi
}

# A reusable POST that captures status + body separately.
post() {
  local payload="$1" extra_header="$2"
  local tmp; tmp="$(mktemp)"
  local code
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

run_case() {
  local label="$1" payload="$2" header="$3"
  local out status body
  out="$(post "$payload" "$header")"
  status="$(echo "$out" | head -1)"
  body="$(echo "$out" | tail -n +2)"
  summarize "$label" "$body" "$status"
}

# ─── 1. conversation-pov success trace ───────────────────────────────
run_case "1. conversation-pov — success trace" '{
  "threadId": "debug-thread-1",
  "skill": {
    "id": "conversation-pov",
    "inputs": {
      "account": "Acme",
      "persona": "CIO",
      "stage": "discovery",
      "topic": "platform consolidation"
    },
    "runId": "debug-run-pov-1"
  }
}' "x-skill-debug: 1"

# ─── 2. commercial-insight success trace ─────────────────────────────
run_case "2. commercial-insight — success trace" '{
  "threadId": "debug-thread-2",
  "skill": {
    "id": "commercial-insight",
    "inputs": {
      "topic": "platform consolidation",
      "industry": "fintech",
      "persona": "CIO"
    },
    "runId": "debug-run-ci-1"
  }
}' "x-skill-debug: 1"

# ─── 3. source-mode refusal (executive-brief: library_required) ──────
# executive-brief requires library_required + minRelevantItems=3 + ≥1
# standardish hit. We pass narrow seeds the existing retriever is
# unlikely to satisfy → expect gate refusal with code=source_mode_gate.
run_case "3. executive-brief — source-mode refusal (library_required)" '{
  "threadId": "debug-thread-3",
  "skill": {
    "id": "executive-brief",
    "inputs": {
      "account": "ZZ-NoSuchAccount-9999",
      "persona": "ZZ-NoSuchPersona-9999",
      "stage": "ZZ-NoSuchStage",
      "topic": "ZZ-NoSuchTopic-XYZQ"
    },
    "runId": "debug-run-eb-refuse-1"
  }
}' "x-skill-debug: 1"

# ─── 4. unknown skill refusal ────────────────────────────────────────
run_case "4. unknown skill refusal" '{
  "threadId": "debug-thread-4",
  "skill": {
    "id": "definitely-not-a-real-skill",
    "inputs": { "account": "Acme" },
    "runId": "debug-run-unknown-1"
  }
}' "x-skill-debug: 1"

# ─── 5. sourceMode injection attempt ─────────────────────────────────
# Client tries to downgrade conversation-pov from library_first →
# library_relevant, AND tries to override behaviorIntent + workspace,
# AND smuggles an unknown key. The trace MUST show:
#   • source_mode == "library_first" (server manifest, NOT client value)
#   • dropped_client_keys contains "forbidden:sourceMode"
#   • overrides_clamped contains "behaviorIntent" and "workspace"
run_case "5. sourceMode injection — proves it is dropped" '{
  "threadId": "debug-thread-5",
  "skill": {
    "id": "conversation-pov",
    "inputs": { "account": "Acme", "persona": "CIO" },
    "sourceMode": "library_relevant",
    "behaviorIntent": "objection_handling",
    "workspace": "library",
    "overrides": { "sourceMode": "library_relevant" },
    "evilKey": "ignored",
    "runId": "debug-run-injection-1"
  }
}' "x-skill-debug: 1"

# ─── 6. flag OFF — default path untouched ────────────────────────────
# This case sends the SAME well-formed skill envelope and the debug
# header, but with the env flag off the skill branch is bypassed
# entirely. Expected: NOT a skill envelope. The body should look like
# default Strategy chat (likely an action/threadId validation error
# because we're not sending a real `action`). The KEY assertion is
# absence of `early_return: true` and `source: "strategy-skills/passthrough"`.
#
# To run this case truthfully:
#   1) Set STRATEGY_SKILLS_ENABLED=false (or unset) in edge env, OR
#   2) Run case 6 in a separate session against an env where the flag
#      is off. The script just sends the request — verify the body
#      shape is NOT a skill envelope.
run_case "6. flag OFF (run with STRATEGY_SKILLS_ENABLED unset) — default path" '{
  "threadId": "debug-thread-6",
  "skill": {
    "id": "conversation-pov",
    "inputs": { "account": "Acme", "persona": "CIO" },
    "runId": "debug-run-flag-off"
  }
}' "x-skill-debug: 1"

# ─── 7. missing x-skill-debug — default path untouched ───────────────
# Identical payload to case 1, but WITHOUT the debug header. Even with
# the flag on, the passthrough must not engage. Expected: NOT a skill
# envelope (no early_return, no source: "strategy-skills/passthrough").
run_case "7. missing x-skill-debug header — default path" '{
  "threadId": "debug-thread-7",
  "skill": {
    "id": "conversation-pov",
    "inputs": { "account": "Acme", "persona": "CIO" },
    "runId": "debug-run-no-header"
  }
}' ""

echo
echo "════════════════════════════════════════════════════════════════"
echo "DONE. Verification checklist:"
echo "════════════════════════════════════════════════════════════════"
echo "[ ] Case 1: ok=true, source_mode=library_first, gate.decision=pass,"
echo "             confidence ∈ {medium,high}, hits[].relevance_class set,"
echo "             why_this_skill present, plan_hash stable across runs."
echo "[ ] Case 2: ok=true, source_mode=library_first, behavior_intent=pov_synthesis."
echo "[ ] Case 3: ok=false, refusal.code=source_mode_gate,"
echo "             gate.decision=refuse, source_mode=library_required,"
echo "             generic_output_risk=high, hits=[]."
echo "[ ] Case 4: ok=false, refusal.code=unknown_skill (no silent fallback)."
echo "[ ] Case 5: ok=true, source_mode=library_first (NOT library_relevant),"
echo "             dropped_client_keys includes 'forbidden:sourceMode',"
echo "             overrides_clamped includes 'behaviorIntent' and 'workspace',"
echo "             behavior_intent=conversation_strategy (server manifest)."
echo "[ ] Case 6: response is NOT a skill envelope — no 'early_return',"
echo "             no 'source: strategy-skills/passthrough'. Run with"
echo "             STRATEGY_SKILLS_ENABLED unset/false to fully prove."
echo "[ ] Case 7: response is NOT a skill envelope — header omission alone"
echo "             must bypass the passthrough."
