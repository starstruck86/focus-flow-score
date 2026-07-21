#!/bin/sh
# Zero-argument isolated launcher for the metadata-only TOC capture probe.

set -eu
umask 077

readonly STAGE=toc_capture_metadata_reattestation

session_id=${TOC_REATTEST_METADATA_SESSION_ID-}
case "$session_id" in
  "" | *[!A-Za-z0-9._:@+-]*) exit 1 ;;
esac
[ "${#session_id}" -le 160 ] || exit 1

fail() {
  reason=$1
  case "$reason" in
    archive_inspection_provenance_mismatch | input_invalid | input_mutated | \
      internal_failure | manifest_completion_binding_mismatch | \
      metadata_invalid | operator_reviewer_session_binding_mismatch | \
      output_failed | package_filesystem_identity_mismatch | \
      capture_procedure_binding_mismatch | pg_restore_tool_identity_mismatch | \
      repository_binding_mismatch | recorded_payload_metadata_mismatch | \
      run_count_binding_mismatch | session_invalid | \
      terminal_output_binding_mismatch | execution_python_identity_mismatch) ;;
    *) reason=internal_failure ;;
  esac
  printf '%s\n' \
    "{\"diagnostic_version\":1,\"metadata_session_id\":\"$session_id\",\"reason\":\"$reason\",\"stage\":\"$STAGE\",\"status\":\"failed\"}" \
    2>/dev/null || :
  exit 1
}

[ "$#" -eq 0 ] || fail input_invalid

# No reviewed child may inherit a core-dump capability.
ulimit -S -c 0 2>/dev/null || fail input_invalid
ulimit -H -c 0 2>/dev/null || fail input_invalid

# Reject native/Python startup poisoning instead of silently normalizing it.
for poison_name in \
  LD_PRELOAD LD_LIBRARY_PATH LD_AUDIT LD_DEBUG LD_DEBUG_OUTPUT LD_PROFILE \
  LD_PROFILE_OUTPUT LD_ORIGIN_PATH LD_ASSUME_KERNEL LD_TRACE_LOADED_OBJECTS \
  LD_BIND_NOW LD_BIND_NOT LD_SHOW_AUXV LD_VERBOSE LD_WARN LD_DYNAMIC_WEAK \
  LD_HWCAP_MASK LD_POINTER_GUARD GLIBC_TUNABLES \
  DYLD_INSERT_LIBRARIES DYLD_LIBRARY_PATH DYLD_FRAMEWORK_PATH \
  DYLD_FALLBACK_LIBRARY_PATH DYLD_FALLBACK_FRAMEWORK_PATH DYLD_IMAGE_SUFFIX \
  DYLD_ROOT_PATH DYLD_FORCE_FLAT_NAMESPACE DYLD_SHARED_REGION \
  DYLD_PRINT_LIBRARIES DYLD_PRINT_LIBRARIES_POST_LAUNCH DYLD_PRINT_APIS \
  DYLD_PRINT_BINDINGS DYLD_PRINT_TO_FILE DYLD_PRINT_RPATHS DYLD_PRINT_ENV \
  DYLD_PRINT_OPTS DYLD_PRINT_WARNINGS DYLD_PRINT_INITIALIZERS \
  DYLD_PRINT_SEGMENTS DYLD_PRINT_STATISTICS DYLD_PRINT_STATISTICS_DETAILS \
  DYLD_PRINT_INTERPOSING DYLD_PRINT_SEARCHING DYLD_PRINT_UUIDS \
  DYLD_PRINT_DOFS DYLD_PRINT_LINKS_WITH DYLD_PRINT_FIXUPS \
  DYLD_USE_CLOSURES DYLD_DISABLE_CLOSURES DYLD_SHARED_CACHE_DIR \
  PYTHONHOME PYTHONPATH PYTHONUSERBASE PYTHONSTARTUP PYTHONINSPECT \
  PYTHONBREAKPOINT PYTHONWARNINGS PYTHONMALLOC PYTHONTRACEMALLOC \
  PYTHONPROFILEIMPORTTIME
do
  eval "poison_is_set=\${${poison_name}+x}"
  [ "$poison_is_set" != x ] || fail input_invalid
done

# The only supported output is the invoking local foreground terminal. This is
# an explicit human boundary, not proof that screen capture is absent.
[ "${TOC_REATTEST_OUTPUT_DESTINATION_ATTESTATION-}" = \
  LOCAL_FOREGROUND_STDOUT_NO_RECORDING ] || fail terminal_output_binding_mismatch
[ "${NO_RETRY_AFTER_PRIVATE_ACCESS-}" = ACKNOWLEDGED ] || fail operator_reviewer_session_binding_mismatch
[ "${CANDIDATE_DISCLOSURE-}" = RECORDED_OPAQUE_INDEX_SHA256_ONLY ] || fail operator_reviewer_session_binding_mismatch
[ "${CEILINGS_ACCEPTED-}" = \
  TERMINAL_PARTIAL_WRITE_SAME_USER_PATH_SWAP_ATIME_AND_READ_ONLY_NONCE ] || fail operator_reviewer_session_binding_mismatch
[ -t 0 ] && [ -t 1 ] && [ -t 2 ] || fail terminal_output_binding_mismatch
for remote_name in SSH_CONNECTION SSH_CLIENT SSH_TTY MOSH_IP MOSH_PORT TMUX STY \
  INSIDE_EMACS VSCODE_IPC_HOOK_CLI
do
  eval "remote_is_set=\${${remote_name}+x}"
  [ "$remote_is_set" != x ] || fail terminal_output_binding_mismatch
done

execution_python=${TOC_REATTEST_EXECUTION_PYTHON-}
approved_python_sha=${TOC_REATTEST_APPROVED_EXECUTION_PYTHON_SHA256-}
approved_python_version=${TOC_REATTEST_APPROVED_EXECUTION_PYTHON_VERSION-}
approved_python_device=${TOC_REATTEST_APPROVED_EXECUTION_PYTHON_DEVICE-}
approved_python_inode=${TOC_REATTEST_APPROVED_EXECUTION_PYTHON_INODE-}
approved_python_size=${TOC_REATTEST_APPROVED_EXECUTION_PYTHON_SIZE_BYTES-}
approved_python_uid=${TOC_REATTEST_APPROVED_EXECUTION_PYTHON_UID-}
approved_python_gid=${TOC_REATTEST_APPROVED_EXECUTION_PYTHON_GID-}
approved_python_mode=${TOC_REATTEST_APPROVED_EXECUTION_PYTHON_MODE-}

case "$execution_python" in /*) ;; *) fail input_invalid ;; esac
case "$approved_python_sha" in "" | *[!0-9a-f]*) fail input_invalid ;; esac
[ "${#approved_python_sha}" -eq 64 ] || fail input_invalid
case "$approved_python_version" in cpython:*.*.*) ;; *) fail input_invalid ;; esac
case "$approved_python_version" in *[!a-z0-9.:]*) fail input_invalid ;; esac
for numeric_value in "$approved_python_device" "$approved_python_inode" \
  "$approved_python_size" "$approved_python_uid" "$approved_python_gid"
do
  case "$numeric_value" in "" | *[!0-9]*) fail input_invalid ;; esac
done
case "$approved_python_mode" in [0-7][0-7][0-7][0-7]) ;; *) fail input_invalid ;; esac

[ -f "$execution_python" ] && [ -x "$execution_python" ] && \
  [ ! -L "$execution_python" ] || fail input_invalid
execution_directory=$(/usr/bin/dirname -- "$execution_python" 2>/dev/null) || fail input_invalid
execution_basename=$(/usr/bin/basename -- "$execution_python" 2>/dev/null) || fail input_invalid
canonical_execution_directory=$(CDPATH= cd -P -- "$execution_directory" 2>/dev/null && pwd -P) || fail input_invalid
case "$canonical_execution_directory" in
  /) canonical_execution_python=/${execution_basename} ;;
  *) canonical_execution_python=${canonical_execution_directory}/${execution_basename} ;;
esac
[ "$canonical_execution_python" = "$execution_python" ] || fail input_invalid

platform=$(/usr/bin/uname -s 2>/dev/null) || fail input_invalid
case "$platform" in
  Darwin)
    observed_python_identity=$(/usr/bin/stat -f '%d %i %z %u %g %Lp %l' -- "$execution_python" 2>/dev/null) || fail input_invalid
    ;;
  Linux)
    observed_python_identity=$(/usr/bin/stat -c '%d %i %s %u %g %a %h' -- "$execution_python" 2>/dev/null) || fail input_invalid
    ;;
  *) fail input_invalid ;;
esac
set -- $observed_python_identity
[ "$#" -eq 7 ] || fail input_invalid
observed_mode=$(printf '%04o' "$((0$6))" 2>/dev/null) || fail input_invalid
[ "$1" = "$approved_python_device" ] && [ "$2" = "$approved_python_inode" ] && \
  [ "$3" = "$approved_python_size" ] && [ "$4" = "$approved_python_uid" ] && \
  [ "$5" = "$approved_python_gid" ] && [ "$observed_mode" = "$approved_python_mode" ] && \
  [ "$7" = 1 ] || fail execution_python_identity_mismatch
operator_uid=$(/usr/bin/id -u 2>/dev/null) || fail input_invalid
[ "$4" = 0 ] || [ "$4" = "$operator_uid" ] || fail execution_python_identity_mismatch
mode_value=$((0$6))
[ $((mode_value & 07022)) -eq 0 ] && [ $((mode_value & 00100)) -ne 0 ] || fail execution_python_identity_mismatch

digest_file() {
  target=$1
  if [ -x /usr/bin/sha256sum ]; then
    digest_line=$(/usr/bin/env -i LANG=C LC_ALL=C /usr/bin/sha256sum -- "$target" 2>/dev/null) || return 1
  elif [ -x /usr/bin/shasum ]; then
    digest_line=$(/usr/bin/env -i LANG=C LC_ALL=C /usr/bin/shasum -a 256 -- "$target" 2>/dev/null) || return 1
  else
    return 1
  fi
  observed_digest=${digest_line%%[[:space:]]*}
  case "$observed_digest" in "" | *[!0-9a-f]*) return 1 ;; esac
  [ "${#observed_digest}" -eq 64 ] || return 1
  printf '%s' "$observed_digest"
}

[ "$(digest_file "$execution_python")" = "$approved_python_sha" ] || fail execution_python_identity_mismatch
observed_python_version=$(
  /usr/bin/env -i LANG=C LC_ALL=C \
    "$execution_python" -I -S -B -c \
    'import sys; print(f"{sys.implementation.name}:{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")' \
    2>/dev/null
) || fail execution_python_identity_mismatch
[ "$observed_python_version" = "$approved_python_version" ] || fail execution_python_identity_mismatch
[ "$(digest_file "$execution_python")" = "$approved_python_sha" ] || fail execution_python_identity_mismatch

script_directory=$(CDPATH= cd -P -- "$(/usr/bin/dirname -- "$0")" 2>/dev/null && pwd -P) || fail repository_binding_mismatch
repository=$(CDPATH= cd -P -- "${script_directory}/../.." 2>/dev/null && pwd -P) || fail repository_binding_mismatch
probe=${script_directory}/probe-lovable-toc-capture-metadata.py
launcher=${script_directory}/run-lovable-toc-capture-metadata-reattestation.sh
readme=${script_directory}/README.md
runbook=${repository}/docs/migration/migration-runbook.md
for reviewed_path in "$probe" "$launcher" "$readme" "$runbook"
do
  [ -f "$reviewed_path" ] && [ ! -L "$reviewed_path" ] || fail repository_binding_mismatch
done

approved_checkout=${TOC_REATTEST_APPROVED_EXECUTION_CHECKOUT_SHA-}
case "$approved_checkout" in "" | *[!0-9a-f]*) fail input_invalid ;; esac
[ "${#approved_checkout}" -eq 40 ] || fail input_invalid

git_reviewed() {
  /usr/bin/env -i LANG=C LC_ALL=C PATH=/usr/bin:/bin \
    GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_SYSTEM=/dev/null \
    GIT_NO_REPLACE_OBJECTS=1 GIT_OPTIONAL_LOCKS=0 GIT_TERMINAL_PROMPT=0 \
    /usr/bin/git -c core.fsmonitor=false -c core.hooksPath=/dev/null \
      -c core.untrackedCache=false -C "$repository" "$@"
}

[ "$(git_reviewed rev-parse HEAD 2>/dev/null)" = "$approved_checkout" ] || fail repository_binding_mismatch
[ -z "$(git_reviewed status --porcelain=v1 --untracked-files=all 2>/dev/null)" ] || fail repository_binding_mismatch
for input_root in scripts/migration supabase/migrations
do
  [ -z "$(git_reviewed ls-files --others --exclude-standard -- "$input_root" 2>/dev/null)" ] || fail repository_binding_mismatch
  [ -z "$(git_reviewed ls-files --others --ignored --exclude-standard -- "$input_root" 2>/dev/null)" ] || fail repository_binding_mismatch
done

reviewed_file_identity() {
  label=$1
  relative=$2
  path=$3
  blob=$(git_reviewed rev-parse "${approved_checkout}:${relative}" 2>/dev/null) || return 1
  working_blob=$(git_reviewed hash-object -- "$relative" 2>/dev/null) || return 1
  [ "$blob" = "$working_blob" ] || return 1
  sha=$(digest_file "$path") || return 1
  printf '%s|%s|%s|%s' "$label" "$relative" "$blob" "$sha"
}

launcher_identity=$(reviewed_file_identity launcher scripts/migration/run-lovable-toc-capture-metadata-reattestation.sh "$launcher") || fail repository_binding_mismatch
probe_identity=$(reviewed_file_identity probe scripts/migration/probe-lovable-toc-capture-metadata.py "$probe") || fail repository_binding_mismatch
readme_identity=$(reviewed_file_identity readme scripts/migration/README.md "$readme") || fail repository_binding_mismatch
runbook_identity=$(reviewed_file_identity runbook docs/migration/migration-runbook.md "$runbook") || fail repository_binding_mismatch

identity_json() {
  item=$1
  label=${item%%|*}; item=${item#*|}
  path=${item%%|*}; item=${item#*|}
  blob=${item%%|*}; sha=${item#*|}
  printf '"%s":{"blob_sha":"%s","path":"%s","sha256":"%s"}' "$label" "$blob" "$path" "$sha"
}
procedure_json=$(printf '{"execution_checkout_sha":"%s","files":{%s,%s,%s,%s},"format_version":1}' \
  "$approved_checkout" \
  "$(identity_json "$launcher_identity")" \
  "$(identity_json "$probe_identity")" \
  "$(identity_json "$readme_identity")" \
  "$(identity_json "$runbook_identity")") || fail repository_binding_mismatch
procedure_sha=$(printf '%s\n' "$procedure_json" | {
  if [ -x /usr/bin/sha256sum ]; then /usr/bin/sha256sum; else /usr/bin/shasum -a 256; fi
} 2>/dev/null) || fail repository_binding_mismatch
procedure_sha=${procedure_sha%%[[:space:]]*}
[ "$procedure_sha" = "${TOC_REATTEST_APPROVED_PROCEDURE_IDENTITY_SHA256-}" ] || fail repository_binding_mismatch

# Open the checked-in component only after every startup/repository guard. The
# isolated bootstrap binds its exact bytes to the reviewed Git blob before exec.
probe_blob=${probe_identity#*|}; probe_blob=${probe_blob#*|}; probe_blob=${probe_blob%%|*}
{ exec 3<"$probe"; } 2>/dev/null || fail repository_binding_mismatch
exec 4>&1 || fail input_invalid

exec /usr/bin/env -i \
  LANG=C LC_ALL=C \
  "CANDIDATE_DISCLOSURE=${CANDIDATE_DISCLOSURE-}" \
  "CEILINGS_ACCEPTED=${CEILINGS_ACCEPTED-}" \
  "NO_RETRY_AFTER_PRIVATE_ACCESS=${NO_RETRY_AFTER_PRIVATE_ACCESS-}" \
  "TOC_REATTEST_APPROVED_EXECUTION_CHECKOUT_SHA=$approved_checkout" \
  "TOC_REATTEST_APPROVED_EXECUTION_PYTHON_DEVICE=$approved_python_device" \
  "TOC_REATTEST_APPROVED_EXECUTION_PYTHON_GID=$approved_python_gid" \
  "TOC_REATTEST_APPROVED_EXECUTION_PYTHON_INODE=$approved_python_inode" \
  "TOC_REATTEST_APPROVED_EXECUTION_PYTHON_MODE=$approved_python_mode" \
  "TOC_REATTEST_APPROVED_EXECUTION_PYTHON_SHA256=$approved_python_sha" \
  "TOC_REATTEST_APPROVED_EXECUTION_PYTHON_SIZE_BYTES=$approved_python_size" \
  "TOC_REATTEST_APPROVED_EXECUTION_PYTHON_UID=$approved_python_uid" \
  "TOC_REATTEST_APPROVED_EXECUTION_PYTHON_VERSION=$approved_python_version" \
  "TOC_REATTEST_APPROVED_PROCEDURE_IDENTITY_SHA256=${TOC_REATTEST_APPROVED_PROCEDURE_IDENTITY_SHA256-}" \
  "TOC_REATTEST_AUTHORIZER_IDENTITY=${TOC_REATTEST_AUTHORIZER_IDENTITY-}" \
  "TOC_REATTEST_CAPTURE_PACKAGE_NAME=${TOC_REATTEST_CAPTURE_PACKAGE_NAME-}" \
  "TOC_REATTEST_CAPTURE_ROOT=${TOC_REATTEST_CAPTURE_ROOT-}" \
  "TOC_REATTEST_ENCRYPTION_ATTESTATION=${TOC_REATTEST_ENCRYPTION_ATTESTATION-}" \
  "TOC_REATTEST_EXECUTION_PYTHON=$execution_python" \
  "TOC_REATTEST_EXPECTED_CAPTURE_EVIDENCE_FILES_SHA256=${TOC_REATTEST_EXPECTED_CAPTURE_EVIDENCE_FILES_SHA256-}" \
  "TOC_REATTEST_EXPECTED_CAPTURE_EXECUTION_CHECKOUT_SHA=${TOC_REATTEST_EXPECTED_CAPTURE_EXECUTION_CHECKOUT_SHA-}" \
  "TOC_REATTEST_EXPECTED_CAPTURE_PROCEDURE_IDENTITY_SHA256=${TOC_REATTEST_EXPECTED_CAPTURE_PROCEDURE_IDENTITY_SHA256-}" \
  "TOC_REATTEST_EXPECTED_DATA_REFERENCE_COUNT=${TOC_REATTEST_EXPECTED_DATA_REFERENCE_COUNT-}" \
  "TOC_REATTEST_EXPECTED_DEVICE=${TOC_REATTEST_EXPECTED_DEVICE-}" \
  "TOC_REATTEST_EXPECTED_ENTRY_COUNT=${TOC_REATTEST_EXPECTED_ENTRY_COUNT-}" \
  "TOC_REATTEST_EXPECTED_GID=${TOC_REATTEST_EXPECTED_GID-}" \
  "TOC_REATTEST_EXPECTED_HOST_ID=${TOC_REATTEST_EXPECTED_HOST_ID-}" \
  "TOC_REATTEST_EXPECTED_INNER_ARCHIVE_SHA256=${TOC_REATTEST_EXPECTED_INNER_ARCHIVE_SHA256-}" \
  "TOC_REATTEST_EXPECTED_INSPECTION_CHECKOUT_SHA=${TOC_REATTEST_EXPECTED_INSPECTION_CHECKOUT_SHA-}" \
  "TOC_REATTEST_EXPECTED_INSPECTION_EVIDENCE_MANIFEST_SHA256=${TOC_REATTEST_EXPECTED_INSPECTION_EVIDENCE_MANIFEST_SHA256-}" \
  "TOC_REATTEST_EXPECTED_INSPECTION_PROCEDURE_SHA256=${TOC_REATTEST_EXPECTED_INSPECTION_PROCEDURE_SHA256-}" \
  "TOC_REATTEST_EXPECTED_OUTER_ARCHIVE_SHA256=${TOC_REATTEST_EXPECTED_OUTER_ARCHIVE_SHA256-}" \
  "TOC_REATTEST_EXPECTED_OUTPUT_DEVICE=${TOC_REATTEST_EXPECTED_OUTPUT_DEVICE-}" \
  "TOC_REATTEST_EXPECTED_OUTPUT_INODE=${TOC_REATTEST_EXPECTED_OUTPUT_INODE-}" \
  "TOC_REATTEST_EXPECTED_PG_RESTORE_DEVICE=${TOC_REATTEST_EXPECTED_PG_RESTORE_DEVICE-}" \
  "TOC_REATTEST_EXPECTED_PG_RESTORE_GID=${TOC_REATTEST_EXPECTED_PG_RESTORE_GID-}" \
  "TOC_REATTEST_EXPECTED_PG_RESTORE_IDENTITY_SHA256=${TOC_REATTEST_EXPECTED_PG_RESTORE_IDENTITY_SHA256-}" \
  "TOC_REATTEST_EXPECTED_PG_RESTORE_INODE=${TOC_REATTEST_EXPECTED_PG_RESTORE_INODE-}" \
  "TOC_REATTEST_EXPECTED_PG_RESTORE_MODE=${TOC_REATTEST_EXPECTED_PG_RESTORE_MODE-}" \
  "TOC_REATTEST_EXPECTED_PG_RESTORE_PATH=${TOC_REATTEST_EXPECTED_PG_RESTORE_PATH-}" \
  "TOC_REATTEST_EXPECTED_PG_RESTORE_SHA256=${TOC_REATTEST_EXPECTED_PG_RESTORE_SHA256-}" \
  "TOC_REATTEST_EXPECTED_PG_RESTORE_SIZE_BYTES=${TOC_REATTEST_EXPECTED_PG_RESTORE_SIZE_BYTES-}" \
  "TOC_REATTEST_EXPECTED_PG_RESTORE_UID=${TOC_REATTEST_EXPECTED_PG_RESTORE_UID-}" \
  "TOC_REATTEST_EXPECTED_PG_RESTORE_VERSION=${TOC_REATTEST_EXPECTED_PG_RESTORE_VERSION-}" \
  "TOC_REATTEST_EXPECTED_RAW_TOC_SHA256=${TOC_REATTEST_EXPECTED_RAW_TOC_SHA256-}" \
  "TOC_REATTEST_EXPECTED_RUN_ID=${TOC_REATTEST_EXPECTED_RUN_ID-}" \
  "TOC_REATTEST_EXPECTED_UID=${TOC_REATTEST_EXPECTED_UID-}" \
  "TOC_REATTEST_EXECUTING_OPERATOR_IDENTITY=${TOC_REATTEST_EXECUTING_OPERATOR_IDENTITY-}" \
  "TOC_REATTEST_INDEPENDENT_REVIEWER_IDENTITY=${TOC_REATTEST_INDEPENDENT_REVIEWER_IDENTITY-}" \
  "TOC_REATTEST_METADATA_SESSION_EXPIRES_AT_UTC=${TOC_REATTEST_METADATA_SESSION_EXPIRES_AT_UTC-}" \
  "TOC_REATTEST_METADATA_SESSION_ID=$session_id" \
  "TOC_REATTEST_METADATA_SESSION_NONCE=${TOC_REATTEST_METADATA_SESSION_NONCE-}" \
  "TOC_REATTEST_OUTPUT_DESTINATION_ATTESTATION=${TOC_REATTEST_OUTPUT_DESTINATION_ATTESTATION-}" \
  "TOC_INTERNAL_COMPONENT_BLOB=$probe_blob" \
  TOC_INTERNAL_COMPONENT_FD=3 \
  "TOC_INTERNAL_COMPONENT_PATH=$probe" \
  TOC_INTERNAL_DIAGNOSTIC_FD=4 \
  "TOC_INTERNAL_PROCEDURE_IDENTITY_JSON=$procedure_json" \
  "TOC_INTERNAL_REPOSITORY_ROOT=$repository" \
  "$execution_python" -I -S -B -c '
import hashlib, os, resource, stat, sys
session = os.environ.get("TOC_REATTEST_METADATA_SESSION_ID", "")
failure = ("{\"diagnostic_version\":1,\"metadata_session_id\":\"" + session +
           "\",\"reason\":\"repository_binding_mismatch\",\"stage\":"
           "\"toc_capture_metadata_reattestation\",\"status\":\"failed\"}\n").encode("ascii")
output_fd = 4
try:
    if resource.getrlimit(resource.RLIMIT_CORE) != (0, 0):
        raise RuntimeError
    flags = sys.flags
    if not (flags.isolated == 1 and flags.ignore_environment == 1 and
            flags.no_user_site == 1 and flags.no_site == 1 and
            flags.dont_write_bytecode == 1 and sys.dont_write_bytecode):
        raise RuntimeError
    component_fd = int(os.environ["TOC_INTERNAL_COMPONENT_FD"])
    expected_blob = os.environ["TOC_INTERNAL_COMPONENT_BLOB"]
    path = os.environ["TOC_INTERNAL_COMPONENT_PATH"]
    metadata = os.fstat(component_fd)
    if (not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1 or
            metadata.st_uid not in {0, os.geteuid()} or metadata.st_mode & 0o22 or
            metadata.st_size <= 0 or metadata.st_size > 4 * 1024 * 1024):
        raise RuntimeError
    chunks = []
    remaining = metadata.st_size
    while remaining:
        chunk = os.read(component_fd, min(65536, remaining))
        if not chunk:
            raise RuntimeError
        chunks.append(chunk)
        remaining -= len(chunk)
    if os.read(component_fd, 1):
        raise RuntimeError
    source = b"".join(chunks)
    observed_blob = hashlib.sha1(
        b"blob " + str(len(source)).encode("ascii") + b"\0" + source
    ).hexdigest()
    if observed_blob != expected_blob:
        raise RuntimeError
    sys.argv = [path]
    namespace = {"__builtins__": __builtins__, "__file__": path,
                 "__name__": "__main__", "__package__": None}
    exec(compile(source, path, "exec", dont_inherit=True), namespace, namespace)
except SystemExit:
    raise
except BaseException:
    try:
        os.write(output_fd, failure)
    except BaseException:
        pass
    raise SystemExit(1)
' </dev/null >/dev/null 2>/dev/null
