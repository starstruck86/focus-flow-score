#!/usr/bin/env bash
set -euo pipefail

readonly EXPECTED_PROJECT_REF="odbjjklumdsuqdvkgwyv"
readonly EXPECTED_PROOF_SCOPE="edge-function-bundle"
readonly expected_source_commit="${EXPECTED_SOURCE_COMMIT:-}"
readonly project_ref="${SUPABASE_PROJECT_REF:-}"
readonly max_attempts="${EDGE_ATTESTATION_MAX_ATTEMPTS:-12}"
readonly retry_seconds="${EDGE_ATTESTATION_RETRY_SECONDS:-5}"
readonly run_id="${GITHUB_RUN_ID:-local}"
readonly run_attempt="${GITHUB_RUN_ATTEMPT:-1}"
readonly functions=(strategy-chat analyze-call mcp version)

if [[ ! "$expected_source_commit" =~ ^[0-9a-f]{40}$ ]]; then
  printf 'EXPECTED_SOURCE_COMMIT must be a full lowercase Git SHA.\n' >&2
  exit 2
fi
if [[ "$project_ref" != "$EXPECTED_PROJECT_REF" ]]; then
  printf 'SUPABASE_PROJECT_REF must equal the production project ref.\n' >&2
  exit 2
fi
if [[ ! "$max_attempts" =~ ^[1-9][0-9]*$ ]]; then
  printf 'EDGE_ATTESTATION_MAX_ATTEMPTS must be a positive integer.\n' >&2
  exit 2
fi
if [[ ! "$retry_seconds" =~ ^[0-9]+$ ]]; then
  printf 'EDGE_ATTESTATION_RETRY_SECONDS must be a non-negative integer.\n' >&2
  exit 2
fi

temp_dir="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/edge-attestation.XXXXXX")"
trap 'rm -rf "$temp_dir"' EXIT
evidence_file="$temp_dir/evidence.ndjson"
: > "$evidence_file"
deployment_ids=()

header_value() {
  local header_name="$1"
  local header_file="$2"
  awk -F ':' -v target="$header_name" '
    tolower($1) == tolower(target) {
      value = substr($0, index($0, ":") + 1)
      sub(/^[[:space:]]+/, "", value)
      sub(/\r$/, "", value)
    }
    END { print value }
  ' "$header_file"
}

for function_name in "${functions[@]}"; do
  matched=false
  observed_status=""
  observed_verified=""
  observed_function=""
  observed_source=""
  observed_deployment=""
  observed_scope=""
  observed_cache=""
  observed_max_age=""

  for ((attempt = 1; attempt <= max_attempts; attempt += 1)); do
    header_file="$temp_dir/${function_name}.headers"
    if ! observed_status="$(
        curl --silent --show-error \
          --proto '=https' \
          --tlsv1.2 \
          --connect-timeout 10 \
          --max-time 30 \
          --request OPTIONS \
          --dump-header "$header_file" \
          --output /dev/null \
          --write-out '%{http_code}' \
          "https://${project_ref}.supabase.co/functions/v1/${function_name}?attestation_run=${run_id}-${run_attempt}-${attempt}"
      )"; then
      observed_status="curl_error"
      : > "$header_file"
    fi
    observed_verified="$(header_value X-Edge-Attestation-Verified "$header_file")"
    observed_function="$(header_value X-Edge-Function "$header_file")"
    observed_source="$(header_value X-Edge-Source-Commit "$header_file")"
    observed_deployment="$(header_value X-Edge-Deployment-Id "$header_file")"
    observed_scope="$(header_value X-Edge-Proof-Scope "$header_file")"
    observed_cache="$(header_value Cache-Control "$header_file")"
    observed_max_age="$(header_value Access-Control-Max-Age "$header_file")"

    if { [[ "$observed_status" == "200" ]] || \
      [[ "$observed_status" == "204" ]]; } && \
      [[ "$observed_verified" == "true" ]] && \
      [[ "$observed_function" == "$function_name" ]] && \
      [[ "$observed_source" == "$expected_source_commit" ]] && \
      [[ "$observed_deployment" =~ ^${project_ref}_.+ ]] && \
      [[ "$observed_scope" == "$EXPECTED_PROOF_SCOPE" ]] && \
      [[ "$observed_cache" == "no-store" ]] && \
      [[ "$observed_max_age" == "0" ]]; then
      matched=true
      break
    fi
    if ((attempt < max_attempts)); then
      sleep "$retry_seconds"
    fi
  done

  jq -cn \
    --arg function "$function_name" \
    --arg source_commit "$observed_source" \
    --arg deployment_id "$observed_deployment" \
    --arg proof_scope "$observed_scope" \
    --arg verified "$observed_verified" \
    --arg http_status "$observed_status" \
    '{function, source_commit, deployment_id, proof_scope,
      verified: ($verified == "true"), http_status}' \
    | tee -a "$evidence_file"

  if [[ "$matched" != "true" ]]; then
    printf 'Runtime attestation mismatch for %s.\n' "$function_name" >&2
    exit 1
  fi
  deployment_ids+=("$observed_deployment")
done

unique_deployments="$(printf '%s\n' "${deployment_ids[@]}" | sort -u | wc -l | tr -d ' ')"
if [[ "$unique_deployments" != "4" ]]; then
  printf 'Expected four distinct deployment IDs; observed %s.\n' \
    "$unique_deployments" >&2
  exit 1
fi

printf 'Verified all four edge bundles at source commit %s:\n' \
  "$expected_source_commit"
cat "$evidence_file"
