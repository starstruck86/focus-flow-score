#!/usr/bin/env bash

# Shared fail-closed guards for destructive synthetic PostgreSQL fixtures.
# This file is sourced by the integration scripts; it must not enable or
# disable caller shell options.

migration_verify_error() {
  echo "migration verification safety: $*" >&2
}

migration_verify_require_command() {
  local command_name=$1
  if ! command -v "$command_name" >/dev/null 2>&1; then
    migration_verify_error "missing required command: $command_name"
    return 127
  fi
}

migration_verify_require_file() {
  local path=$1
  if [[ ! -f "$path" || ! -r "$path" ]]; then
    migration_verify_error "required input is not a readable regular file: $path"
    return 2
  fi
}

migration_verify_require_safe_target() {
  if [[ ${MIGRATION_VERIFY_ALLOW_FIXTURE:-} != 1 ]]; then
    migration_verify_error \
      "destructive synthetic fixtures require MIGRATION_VERIFY_ALLOW_FIXTURE=1"
    return 2
  fi

  if [[ ! ${PGDATABASE:-} =~ ^migration_verify_[a-z0-9_]+$ ]]; then
    migration_verify_error \
      "database must match the disposable migration_verify_* naming boundary"
    return 2
  fi

  if [[ -n ${POSTGRES_CONTAINER:-} ]]; then
    if [[ ! $POSTGRES_CONTAINER =~ ^focus-flow-migration-verify-[a-z0-9][a-z0-9_.-]*$ ]]; then
      migration_verify_error \
        "container mode requires the explicit focus-flow-migration-verify-* test prefix"
      return 2
    fi
    case ${DOCKER_HOST:-} in
      ""|unix:///*) ;;
      *)
        migration_verify_error \
          "container mode refuses non-local DOCKER_HOST: ${DOCKER_HOST}"
        return 2
        ;;
    esac
    return 0
  fi

  case ${PGHOST:-} in
    /var/run/postgresql) ;;
    *)
      migration_verify_error \
        "direct mode requires the canonical local PostgreSQL Unix socket /var/run/postgresql"
      return 2
      ;;
  esac
}

migration_verify_validate_identity() {
  local identity=$1
  local mode=$2
  local actual_database major_version server_address extra

  if [[ $identity == *$'\n'* ]]; then
    migration_verify_error "database identity probe returned more than one row"
    return 2
  fi

  IFS='|' read -r \
    actual_database major_version server_address extra <<< "$identity"
  if [[ -n ${extra:-} || -z ${actual_database:-} || -z ${major_version:-} ]]; then
    migration_verify_error "database identity probe returned an invalid record"
    return 2
  fi
  if [[ $actual_database != "$PGDATABASE" ]]; then
    migration_verify_error \
      "database identity mismatch: expected $PGDATABASE, received $actual_database"
    return 2
  fi
  if [[ $major_version != 17 ]]; then
    migration_verify_error \
      "PostgreSQL 17 is required for this integration fixture; received major $major_version"
    return 2
  fi

  if [[ $mode != direct && $mode != container ]]; then
    migration_verify_error "database identity validation received an unknown mode"
    return 2
  fi
  if [[ $server_address != local-socket ]]; then
    migration_verify_error \
      "$mode database identity did not use its local Unix socket"
    return 2
  fi
}

migration_verify_validate_docker_endpoint() {
  local endpoint=$1
  if [[ $endpoint == *$'\n'* || $endpoint != unix:///* ]]; then
    migration_verify_error \
      "selected Docker context is not a single local Unix endpoint: ${endpoint:-<empty>}"
    return 2
  fi
}

migration_verify_validate_container_label() {
  local label_value=$1
  if [[ $label_value != true ]]; then
    migration_verify_error \
      "container lacks required test-only label com.focus-flow.migration-verify=true"
    return 2
  fi
}

migration_verify_assert_absent() {
  local grep_mode=$1
  local pattern=$2
  local leak_message=$3
  local status
  shift 3

  if grep "$grep_mode" "$pattern" "$@"; then
    echo "$leak_message" >&2
    return 1
  else
    status=$?
  fi

  if [[ $status -eq 1 ]]; then
    return 0
  fi

  migration_verify_error \
    "assertion command failed with exit $status instead of reporting match/no-match"
  return "$status"
}
