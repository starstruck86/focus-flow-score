#!/bin/sh
# Exact isolated launcher for the reviewed offline Lovable TOC capture driver.

set -eu
umask 077
LANG=C
LC_ALL=C
export LANG LC_ALL

readonly EXECUTION_PYTHON_DIAGNOSTIC='{"diagnostic_version":1,"reason":"execution_python_invalid","stage":"capture_launcher","status":"failed"}'
readonly CHILD_DIAGNOSTIC_INVALID='{"diagnostic_version":1,"reason":"child_diagnostic_invalid","stage":"capture_launcher","status":"failed"}'
readonly MAX_CAPTURE_DIAGNOSTIC_BYTES=4096

fail_execution_python() {
  printf '%s\n' "$EXECUTION_PYTHON_DIAGNOSTIC" >&2 2>/dev/null || :
  exit 1
}

fail_child_diagnostic() {
  printf '%s\n' "$CHILD_DIAGNOSTIC_INVALID" >&2 2>/dev/null || :
  exit 1
}

python_digest() {
  if [ -x /usr/bin/sha256sum ]; then
    digest_line=$(
      /usr/bin/env -i LANG=C LC_ALL=C \
        /usr/bin/sha256sum -- "$execution_python" 2>/dev/null
    ) || return 1
  elif [ -x /usr/bin/shasum ]; then
    digest_line=$(
      /usr/bin/env -i LANG=C LC_ALL=C \
        /usr/bin/shasum -a 256 -- "$execution_python" 2>/dev/null
    ) || return 1
  else
    return 1
  fi
  observed_digest=${digest_line%%[[:space:]]*}
  [ "$observed_digest" = "$approved_python_sha256" ]
}

launcher_capture_directory=''
launcher_stdout=''
launcher_stderr=''
launcher_stdout_pipe=''
launcher_stderr_pipe=''

cleanup_launcher_capture() {
  [ -n "$launcher_capture_directory" ] || return 0
  /bin/rm -f -- \
    "$launcher_stdout" "$launcher_stderr" \
    "$launcher_stdout_pipe" "$launcher_stderr_pipe" \
    2>/dev/null || return 1
  /bin/rmdir -- "$launcher_capture_directory" 2>/dev/null || return 1
  launcher_capture_directory=''
  launcher_stdout=''
  launcher_stderr=''
  launcher_stdout_pipe=''
  launcher_stderr_pipe=''
  return 0
}

wait_for_collector() {
  collector_pid=$1
  attempts=0
  while /bin/kill -0 "$collector_pid" 2>/dev/null; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 100 ]; then
      /bin/kill "$collector_pid" 2>/dev/null || :
      wait "$collector_pid" 2>/dev/null || :
      return 1
    fi
    /bin/sleep 0.05
  done
  wait "$collector_pid" 2>/dev/null
}

trap 'cleanup_launcher_capture || :' 0

[ "$#" -eq 0 ] || fail_execution_python

# The invoking shell/native runtime is an explicit trust boundary, but no
# loader or Python startup variable is allowed to reach any child launched by
# this reviewed script.
unset \
  LD_PRELOAD LD_LIBRARY_PATH \
  DYLD_INSERT_LIBRARIES DYLD_LIBRARY_PATH DYLD_FRAMEWORK_PATH \
  DYLD_FALLBACK_LIBRARY_PATH DYLD_FALLBACK_FRAMEWORK_PATH \
  PYTHONHOME PYTHONPATH PYTHONUSERBASE PYTHONSTARTUP PYTHONINSPECT

execution_python=${TOC_REVIEW_EXECUTION_PYTHON-}
approved_python_sha256=${TOC_REVIEW_APPROVED_EXECUTION_PYTHON_SHA256-}
approved_python_version=${TOC_REVIEW_APPROVED_EXECUTION_PYTHON_VERSION-}
case "$execution_python" in
  /*) ;;
  *) fail_execution_python ;;
esac
case "$approved_python_sha256" in
  *[!0-9a-f]* | "") fail_execution_python ;;
esac
[ "${#approved_python_sha256}" -eq 64 ] || fail_execution_python
case "$approved_python_version" in
  cpython:*.*.*) ;;
  *) fail_execution_python ;;
esac
case "$approved_python_version" in
  *[!a-z0-9.:]*) fail_execution_python ;;
esac

if [ ! -f "$execution_python" ] || [ ! -x "$execution_python" ] || [ -L "$execution_python" ]; then
  fail_execution_python
fi

# Reject a symlinked or lexically ambiguous parent before Python starts. The
# Python driver repeats this check and binds the stable executable identity.
execution_directory=$(/usr/bin/dirname -- "$execution_python" 2>/dev/null) || \
  fail_execution_python
execution_basename=$(/usr/bin/basename -- "$execution_python" 2>/dev/null) || \
  fail_execution_python
canonical_execution_directory=$(CDPATH= cd -P -- "$execution_directory" 2>/dev/null && pwd -P) || \
  fail_execution_python
case "$canonical_execution_directory" in
  /) canonical_execution_python=/${execution_basename} ;;
  *) canonical_execution_python=${canonical_execution_directory}/${execution_basename} ;;
esac
[ "$canonical_execution_python" = "$execution_python" ] || fail_execution_python

# Reject an interpreter controlled by an unrelated account, group/world
# writable executable bytes, special permission bits, or missing owner execute.
# Root-owned system Python and operator-owned reviewed Python are both allowed.
platform=$(/usr/bin/uname -s 2>/dev/null) || fail_execution_python
case "$platform" in
  Darwin)
    python_owner_mode=$(/usr/bin/stat -f '%u %Lp' -- "$execution_python" 2>/dev/null) || \
      fail_execution_python
    ;;
  Linux)
    python_owner_mode=$(/usr/bin/stat -c '%u %a' -- "$execution_python" 2>/dev/null) || \
      fail_execution_python
    ;;
  *) fail_execution_python ;;
esac
python_owner=${python_owner_mode%% *}
python_mode=${python_owner_mode#* }
case "$python_owner" in *[!0-9]* | "") fail_execution_python ;; esac
case "$python_mode" in *[!0-7]* | "") fail_execution_python ;; esac
[ "${#python_mode}" -ge 3 ] && [ "${#python_mode}" -le 4 ] || fail_execution_python
[ "$python_owner_mode" = "$python_owner $python_mode" ] || fail_execution_python
operator_uid=$(/usr/bin/id -u 2>/dev/null) || fail_execution_python
[ "$python_owner" = 0 ] || [ "$python_owner" = "$operator_uid" ] || \
  fail_execution_python
python_mode_value=$((0$python_mode))
[ $((python_mode_value & 07022)) -eq 0 ] || fail_execution_python
[ $((python_mode_value & 00100)) -ne 0 ] || fail_execution_python

# Python isolation flags cannot attest a substituted interpreter. Verify the
# externally approved executable digest before and after the isolated version
# probe, without ever printing tool output or a pathname.
python_digest || fail_execution_python

observed_python_version=$(
  /usr/bin/env -i LANG=C LC_ALL=C \
    "$execution_python" -I -S -B -c \
    'import sys; print(f"{sys.implementation.name}:{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")' \
    2>/dev/null
) || fail_execution_python
[ "$observed_python_version" = "$approved_python_version" ] || fail_execution_python
python_digest || fail_execution_python

script_directory=$(CDPATH= cd -P -- "$(/usr/bin/dirname -- "$0")" 2>/dev/null && pwd -P) || \
  fail_execution_python
driver=${script_directory}/capture-lovable-toc-envelope.py
if [ ! -f "$driver" ] || [ -L "$driver" ]; then
  fail_execution_python
fi

# Python's isolated/no-site flags are the pre-script startup boundary. Construct
# the exact driver environment rather than inheriting the operator shell. Both
# channels are held in a private, size-limited launcher directory so a native
# exec error or substituted child can never relay an unreviewed pathname or
# payload. Only one exact allowlisted driver diagnostic is released afterward.
launcher_capture_directory=$(
  /usr/bin/env -i LANG=C LC_ALL=C \
    /usr/bin/mktemp -d /tmp/focus-flow-toc-launcher.XXXXXXXX 2>/dev/null
) || fail_child_diagnostic
[ -n "$launcher_capture_directory" ] && [ -d "$launcher_capture_directory" ] && \
  [ ! -L "$launcher_capture_directory" ] || fail_child_diagnostic
/bin/chmod 0700 "$launcher_capture_directory" 2>/dev/null || fail_child_diagnostic
launcher_stdout=${launcher_capture_directory}/stdout
launcher_stderr=${launcher_capture_directory}/stderr
launcher_stdout_pipe=${launcher_capture_directory}/stdout.pipe
launcher_stderr_pipe=${launcher_capture_directory}/stderr.pipe
/usr/bin/mkfifo "$launcher_stdout_pipe" "$launcher_stderr_pipe" 2>/dev/null || \
  fail_child_diagnostic

/usr/bin/env -i LANG=C LC_ALL=C \
  /usr/bin/head -c 4097 "$launcher_stdout_pipe" \
  >"$launcher_stdout" 2>/dev/null &
stdout_collector_pid=$!
/usr/bin/env -i LANG=C LC_ALL=C \
  /usr/bin/head -c 4097 "$launcher_stderr_pipe" \
  >"$launcher_stderr" 2>/dev/null &
stderr_collector_pid=$!

set +e
(
  exec /usr/bin/env -i \
    LANG=C \
    LC_ALL=C \
    "TOC_REVIEW_CANONICAL_OUTER=${TOC_REVIEW_CANONICAL_OUTER-}" \
    "TOC_REVIEW_APPROVED_EVIDENCE_RUN_DIRECTORY=${TOC_REVIEW_APPROVED_EVIDENCE_RUN_DIRECTORY-}" \
    "TOC_REVIEW_PRIVATE_STAGING_ROOT=${TOC_REVIEW_PRIVATE_STAGING_ROOT-}" \
    "TOC_REVIEW_OUTPUT_ROOT=${TOC_REVIEW_OUTPUT_ROOT-}" \
    "TOC_REVIEW_EVIDENCE_RUN_ID=${TOC_REVIEW_EVIDENCE_RUN_ID-}" \
    "TOC_REVIEW_EXPECTED_ORIGINAL_FILENAME=${TOC_REVIEW_EXPECTED_ORIGINAL_FILENAME-}" \
    "TOC_REVIEW_UI_EXPORT_OBJECT_NAME=${TOC_REVIEW_UI_EXPORT_OBJECT_NAME-}" \
    "TOC_REVIEW_EXPECTED_OUTER_SIZE_BYTES=${TOC_REVIEW_EXPECTED_OUTER_SIZE_BYTES-}" \
    "TOC_REVIEW_OUTER_SHA256=${TOC_REVIEW_OUTER_SHA256-}" \
    "TOC_REVIEW_INNER_SHA256=${TOC_REVIEW_INNER_SHA256-}" \
    "TOC_REVIEW_EVIDENCE_MANIFEST_SHA256=${TOC_REVIEW_EVIDENCE_MANIFEST_SHA256-}" \
    "TOC_REVIEW_INSPECTION_CHECKOUT_SHA=${TOC_REVIEW_INSPECTION_CHECKOUT_SHA-}" \
    "TOC_REVIEW_INSPECTION_PROCEDURE_SHA256=${TOC_REVIEW_INSPECTION_PROCEDURE_SHA256-}" \
    "TOC_REVIEW_APPROVED_EXECUTION_CHECKOUT_SHA=${TOC_REVIEW_APPROVED_EXECUTION_CHECKOUT_SHA-}" \
    "TOC_REVIEW_EXECUTION_PYTHON=$execution_python" \
    "TOC_REVIEW_APPROVED_EXECUTION_PYTHON_SHA256=$approved_python_sha256" \
    "TOC_REVIEW_APPROVED_EXECUTION_PYTHON_VERSION=$approved_python_version" \
    "TOC_REVIEW_PG_RESTORE_BIN=${TOC_REVIEW_PG_RESTORE_BIN-}" \
    "TOC_REVIEW_APPROVED_PG_RESTORE_SHA256=${TOC_REVIEW_APPROVED_PG_RESTORE_SHA256-}" \
    "TOC_REVIEW_APPROVED_PG_RESTORE_VERSION=${TOC_REVIEW_APPROVED_PG_RESTORE_VERSION-}" \
    "TOC_REVIEW_EXPECTED_ENTRY_COUNT=${TOC_REVIEW_EXPECTED_ENTRY_COUNT-}" \
    "TOC_REVIEW_EXPECTED_DATA_REFERENCE_COUNT=${TOC_REVIEW_EXPECTED_DATA_REFERENCE_COUNT-}" \
    "$execution_python" -I -S -B "$driver"
) >"$launcher_stdout_pipe" 2>"$launcher_stderr_pipe"
driver_status=$?
set -e
collectors_ok=1
wait_for_collector "$stdout_collector_pid" || collectors_ok=0
wait_for_collector "$stderr_collector_pid" || collectors_ok=0
[ "$collectors_ok" -eq 1 ] || fail_child_diagnostic

stdout_size=$(
  /usr/bin/wc -c <"$launcher_stdout" 2>/dev/null | \
    /usr/bin/tr -d '[:space:]' 2>/dev/null
) || fail_child_diagnostic
stderr_size=$(
  /usr/bin/wc -c <"$launcher_stderr" 2>/dev/null | \
    /usr/bin/tr -d '[:space:]' 2>/dev/null
) || fail_child_diagnostic
case "$stdout_size" in *[!0-9]* | '') fail_child_diagnostic ;; esac
case "$stderr_size" in *[!0-9]* | '') fail_child_diagnostic ;; esac
[ "$stdout_size" -le "$MAX_CAPTURE_DIAGNOSTIC_BYTES" ] 2>/dev/null || \
  fail_child_diagnostic
[ "$stderr_size" -le "$MAX_CAPTURE_DIAGNOSTIC_BYTES" ] 2>/dev/null || \
  fail_child_diagnostic

accepted_file=''
accepted_status=1
if [ "$driver_status" -eq 2 ] && [ "$stderr_size" -eq 0 ]; then
  success_pattern='^\{"annotation_gate":"ANNOTATION_REQUIRED","counts":\{"data_reference_count":[0-9]+,"entry_count":[0-9]+\},"diagnostic_version":1,"hashes":\{"capture_manifest_sha256":"[0-9a-f]{64}","raw_toc_sha256":"[0-9a-f]{64}"\},"reason":"blocked","restore_command_gate":"BLOCKED","restore_planning_gate":"BLOCKED","review_gate":"REVIEW_REQUIRED","stage":"capture_driver","status":"review_required"\}$'
  stdout_lines=$(
    /usr/bin/wc -l <"$launcher_stdout" 2>/dev/null | \
      /usr/bin/tr -d '[:space:]' 2>/dev/null
  ) || fail_child_diagnostic
  if [ "$stdout_size" -gt 0 ] && \
    [ "$stdout_lines" = 1 ] && \
    [ "$(/usr/bin/tail -c 1 "$launcher_stdout" 2>/dev/null | /usr/bin/od -An -tu1 2>/dev/null | /usr/bin/tr -d ' ' 2>/dev/null)" = 10 ] && \
    /usr/bin/env -i LANG=C LC_ALL=C \
      /usr/bin/grep -Eq "$success_pattern" "$launcher_stdout" 2>/dev/null; then
    accepted_file=$launcher_stdout
    accepted_status=2
  fi
elif [ "$driver_status" -eq 1 ] && [ "$stdout_size" -eq 0 ]; then
  failure_pattern='^\{"diagnostic_version":1,"reason":"(input_invalid|binding_mismatch|evidence_invalid|normalization_failed|normalization_timeout|normalization_output_invalid|inner_identity_mismatch|capture_failed|capture_timeout|capture_output_invalid|canonical_mutated|publication_exists|publication_failed|cleanup_indeterminate|internal_failure)","stage":"capture_driver","status":"failed"\}$'
  stderr_lines=$(
    /usr/bin/wc -l <"$launcher_stderr" 2>/dev/null | \
      /usr/bin/tr -d '[:space:]' 2>/dev/null
  ) || fail_child_diagnostic
  if [ "$stderr_size" -gt 0 ] && \
    [ "$stderr_lines" = 1 ] && \
    [ "$(/usr/bin/tail -c 1 "$launcher_stderr" 2>/dev/null | /usr/bin/od -An -tu1 2>/dev/null | /usr/bin/tr -d ' ' 2>/dev/null)" = 10 ] && \
    /usr/bin/env -i LANG=C LC_ALL=C \
      /usr/bin/grep -Eq "$failure_pattern" "$launcher_stderr" 2>/dev/null; then
    accepted_file=$launcher_stderr
    accepted_status=1
  fi
fi

[ -n "$accepted_file" ] || fail_child_diagnostic
accepted_payload=$(/bin/cat -- "$accepted_file" 2>/dev/null) || fail_child_diagnostic
cleanup_launcher_capture || fail_child_diagnostic
trap - 0
if [ "$accepted_status" -eq 2 ]; then
  printf '%s\n' "$accepted_payload" 2>/dev/null || :
  exit 2
fi
printf '%s\n' "$accepted_payload" >&2 2>/dev/null || :
exit 1
