#!/bin/sh
# Exact isolated launcher for the existing private TOC ledger validator.

set -eu
umask 077

readonly STARTUP_ENVIRONMENT_DIAGNOSTIC='{"diagnostic_version":1,"reason":"startup_environment_invalid","stage":"ledger_launcher","status":"failed"}'
readonly EXECUTION_PYTHON_DIAGNOSTIC='{"diagnostic_version":1,"reason":"execution_python_invalid","stage":"ledger_launcher","status":"failed"}'

fail_startup_environment() {
  printf '%s\n' "$STARTUP_ENVIRONMENT_DIAGNOSTIC" >&2 2>/dev/null || :
  exit 1
}

fail_execution_python() {
  printf '%s\n' "$EXECUTION_PYTHON_DIAGNOSTIC" >&2 2>/dev/null || :
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

[ "$#" -eq 0 ] || fail_startup_environment
ulimit -S -c 0 2>/dev/null || fail_startup_environment
ulimit -H -c 0 2>/dev/null || fail_startup_environment
if [ "${LD_PRELOAD+x}" = x ] || \
   [ "${LD_LIBRARY_PATH+x}" = x ] || \
   [ "${LD_AUDIT+x}" = x ] || \
   [ "${LD_DEBUG+x}" = x ] || \
   [ "${LD_DEBUG_OUTPUT+x}" = x ] || \
   [ "${LD_PROFILE+x}" = x ] || \
   [ "${LD_PROFILE_OUTPUT+x}" = x ] || \
   [ "${LD_ORIGIN_PATH+x}" = x ] || \
   [ "${LD_ASSUME_KERNEL+x}" = x ] || \
   [ "${DYLD_INSERT_LIBRARIES+x}" = x ] || \
   [ "${DYLD_LIBRARY_PATH+x}" = x ] || \
   [ "${DYLD_FRAMEWORK_PATH+x}" = x ] || \
   [ "${DYLD_FALLBACK_LIBRARY_PATH+x}" = x ] || \
   [ "${DYLD_FALLBACK_FRAMEWORK_PATH+x}" = x ] || \
   [ "${DYLD_IMAGE_SUFFIX+x}" = x ] || \
   [ "${DYLD_ROOT_PATH+x}" = x ] || \
   [ "${DYLD_FORCE_FLAT_NAMESPACE+x}" = x ] || \
   [ "${DYLD_SHARED_REGION+x}" = x ] || \
   [ "${DYLD_PRINT_LIBRARIES+x}" = x ] || \
   [ "${DYLD_PRINT_APIS+x}" = x ] || \
   [ "${DYLD_PRINT_BINDINGS+x}" = x ] || \
   [ "${PYTHONHOME+x}" = x ] || \
   [ "${PYTHONPATH+x}" = x ] || \
   [ "${PYTHONUSERBASE+x}" = x ] || \
   [ "${PYTHONSTARTUP+x}" = x ] || \
   [ "${PYTHONINSPECT+x}" = x ] || \
   [ "${PYTHONBREAKPOINT+x}" = x ] || \
   [ "${PYTHONWARNINGS+x}" = x ] || \
   [ "${PYTHONMALLOC+x}" = x ] || \
   [ "${PYTHONTRACEMALLOC+x}" = x ] || \
   [ "${PYTHONPROFILEIMPORTTIME+x}" = x ]; then
  fail_startup_environment
fi

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

if [ ! -f "$execution_python" ] || [ ! -x "$execution_python" ] || \
   [ -L "$execution_python" ]; then
  fail_execution_python
fi
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

platform=$(/usr/bin/uname -s 2>/dev/null) || fail_execution_python
case "$platform" in
  Darwin)
    python_owner_mode_links=$(/usr/bin/stat -f '%u %Lp %l' -- "$execution_python" 2>/dev/null) || \
      fail_execution_python
    ;;
  Linux)
    python_owner_mode_links=$(/usr/bin/stat -c '%u %a %h' -- "$execution_python" 2>/dev/null) || \
      fail_execution_python
    ;;
  *) fail_execution_python ;;
esac
python_owner=${python_owner_mode_links%% *}
python_mode_links=${python_owner_mode_links#* }
python_mode=${python_mode_links%% *}
python_links=${python_mode_links#* }
case "$python_owner" in *[!0-9]* | "") fail_execution_python ;; esac
case "$python_mode" in *[!0-7]* | "") fail_execution_python ;; esac
case "$python_links" in *[!0-9]* | "") fail_execution_python ;; esac
[ "$python_links" -eq 1 ] || fail_execution_python
[ "$python_owner_mode_links" = "$python_owner $python_mode $python_links" ] || \
  fail_execution_python
operator_uid=$(/usr/bin/id -u 2>/dev/null) || fail_execution_python
[ "$python_owner" = 0 ] || [ "$python_owner" = "$operator_uid" ] || \
  fail_execution_python
python_mode_value=$((0$python_mode))
[ $((python_mode_value & 07022)) -eq 0 ] || fail_execution_python
[ $((python_mode_value & 00100)) -ne 0 ] || fail_execution_python

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
validator=${script_directory}/validate-lovable-toc-ledger.py
if [ ! -f "$validator" ] || [ -L "$validator" ]; then
  fail_execution_python
fi
repository=$(CDPATH= cd -P -- "${script_directory}/../.." 2>/dev/null && pwd -P) || \
  fail_execution_python
approved_checkout=${TOC_REVIEW_APPROVED_EXECUTION_CHECKOUT_SHA-}
case "$approved_checkout" in *[!0-9a-f]* | "") fail_execution_python ;; esac
[ "${#approved_checkout}" -eq 40 ] || fail_execution_python
observed_head=$(
  /usr/bin/env -i LANG=C LC_ALL=C PATH=/usr/bin:/bin \
    GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_SYSTEM=/dev/null \
    GIT_NO_REPLACE_OBJECTS=1 GIT_OPTIONAL_LOCKS=0 GIT_TERMINAL_PROMPT=0 \
    /usr/bin/git -c core.fsmonitor=false -c core.hooksPath=/dev/null \
      -c core.untrackedCache=false -C "$repository" rev-parse HEAD 2>/dev/null
) || fail_execution_python
[ "$observed_head" = "$approved_checkout" ] || fail_execution_python
worktree_status=$(
  /usr/bin/env -i LANG=C LC_ALL=C PATH=/usr/bin:/bin \
    GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_SYSTEM=/dev/null \
    GIT_NO_REPLACE_OBJECTS=1 GIT_OPTIONAL_LOCKS=0 GIT_TERMINAL_PROMPT=0 \
    /usr/bin/git -c core.fsmonitor=false -c core.hooksPath=/dev/null \
      -c core.untrackedCache=false -C "$repository" \
      status --porcelain=v1 --untracked-files=all 2>/dev/null
) || fail_execution_python
[ -z "$worktree_status" ] || fail_execution_python
validator_blob=$(
  /usr/bin/env -i LANG=C LC_ALL=C PATH=/usr/bin:/bin \
    GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_SYSTEM=/dev/null \
    GIT_NO_REPLACE_OBJECTS=1 GIT_OPTIONAL_LOCKS=0 GIT_TERMINAL_PROMPT=0 \
    /usr/bin/git -c core.fsmonitor=false -c core.hooksPath=/dev/null \
      -c core.untrackedCache=false -C "$repository" \
      rev-parse "${approved_checkout}:scripts/migration/validate-lovable-toc-ledger.py" \
      2>/dev/null
) || fail_execution_python
case "$validator_blob" in *[!0-9a-f]* | "") fail_execution_python ;; esac
[ "${#validator_blob}" -eq 40 ] || fail_execution_python
{ exec 3<"$validator"; } 2>/dev/null || fail_execution_python
# Preserve the caller's diagnostic channels before the child redirects its
# ordinary stdout/stderr.  A scoped `2>/dev/null` here would be applied first
# and silently bind descriptor 5 to /dev/null.
exec 5>&2 6>&1 || fail_execution_python

# Preserve the validator's existing 15-variable contract. Interpreter approval
# is consumed by this launcher and is deliberately not an additional validator
# input.
set +e
/usr/bin/env -i \
  LANG=C \
  LC_ALL=C \
  "TOC_REVIEW_CAPTURE_ROOT=${TOC_REVIEW_CAPTURE_ROOT-}" \
  "TOC_REVIEW_CAPTURE_NAME=${TOC_REVIEW_CAPTURE_NAME-}" \
  "TOC_REVIEW_LEDGER=${TOC_REVIEW_LEDGER-}" \
  "TOC_REVIEW_OUTPUT_ROOT=${TOC_REVIEW_OUTPUT_ROOT-}" \
  "TOC_REVIEW_EXPECTED_CAPTURE_MANIFEST_SHA256=${TOC_REVIEW_EXPECTED_CAPTURE_MANIFEST_SHA256-}" \
  "TOC_REVIEW_EXPECTED_RAW_TOC_SHA256=${TOC_REVIEW_EXPECTED_RAW_TOC_SHA256-}" \
  "TOC_REVIEW_EXPECTED_PROCEDURE_IDENTITY_SHA256=${TOC_REVIEW_EXPECTED_PROCEDURE_IDENTITY_SHA256-}" \
  "TOC_REVIEW_EVIDENCE_RUN_ID=${TOC_REVIEW_EVIDENCE_RUN_ID-}" \
  "TOC_REVIEW_OUTER_SHA256=${TOC_REVIEW_OUTER_SHA256-}" \
  "TOC_REVIEW_INNER_SHA256=${TOC_REVIEW_INNER_SHA256-}" \
  "TOC_REVIEW_EVIDENCE_MANIFEST_SHA256=${TOC_REVIEW_EVIDENCE_MANIFEST_SHA256-}" \
  "TOC_REVIEW_INSPECTION_CHECKOUT_SHA=${TOC_REVIEW_INSPECTION_CHECKOUT_SHA-}" \
  "TOC_REVIEW_INSPECTION_PROCEDURE_SHA256=${TOC_REVIEW_INSPECTION_PROCEDURE_SHA256-}" \
  "TOC_REVIEW_APPROVED_EXECUTION_CHECKOUT_SHA=${TOC_REVIEW_APPROVED_EXECUTION_CHECKOUT_SHA-}" \
  "TOC_REVIEW_APPROVED_PG_RESTORE_SHA256=${TOC_REVIEW_APPROVED_PG_RESTORE_SHA256-}" \
  TOC_INTERNAL_COMPONENT_FD=3 \
  "TOC_INTERNAL_COMPONENT_PATH=$validator" \
  "TOC_INTERNAL_COMPONENT_BLOB=$validator_blob" \
  TOC_INTERNAL_DIAGNOSTIC_STDERR_FD=5 \
  TOC_INTERNAL_DIAGNOSTIC_STDOUT_FD=6 \
  "TOC_INTERNAL_APPROVED_EXECUTION_PYTHON_SHA256=$approved_python_sha256" \
  "TOC_INTERNAL_APPROVED_EXECUTION_PYTHON_VERSION=$approved_python_version" \
  "$execution_python" -I -S -B -c '
import hashlib, os, resource, stat, sys
diagnostic = b"{\"diagnostic_version\":1,\"reason\":\"binding_mismatch\",\"stage\":\"ledger\",\"status\":\"failed\"}\n"
diagnostic_fd = 5
try:
    diagnostic_fd = int(os.environ["TOC_INTERNAL_DIAGNOSTIC_STDERR_FD"])
    diagnostic_mode = os.fstat(diagnostic_fd).st_mode
    if diagnostic_fd < 3 or not (
        stat.S_ISFIFO(diagnostic_mode)
        or stat.S_ISCHR(diagnostic_mode)
        or stat.S_ISREG(diagnostic_mode)
    ):
        raise RuntimeError
    if resource.getrlimit(resource.RLIMIT_CORE) != (0, 0):
        raise RuntimeError
    descriptor = int(os.environ["TOC_INTERNAL_COMPONENT_FD"])
    path = os.environ["TOC_INTERNAL_COMPONENT_PATH"]
    expected = os.environ["TOC_INTERNAL_COMPONENT_BLOB"]
    metadata = os.fstat(descriptor)
    if (not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1 or
            metadata.st_uid not in {0, os.geteuid()} or metadata.st_mode & 0o22 or
            metadata.st_mode & 0o400 == 0 or metadata.st_size <= 0 or
            metadata.st_size > 2 * 1024 * 1024):
        raise RuntimeError
    chunks = []
    remaining = metadata.st_size
    while remaining:
        chunk = os.read(descriptor, min(65536, remaining))
        if not chunk:
            raise RuntimeError
        chunks.append(chunk)
        remaining -= len(chunk)
    if os.read(descriptor, 1):
        raise RuntimeError
    source = b"".join(chunks)
    observed = hashlib.sha1(b"blob " + str(len(source)).encode("ascii") + b"\0" + source).hexdigest()
    if observed != expected:
        raise RuntimeError
    del os.environ["TOC_INTERNAL_COMPONENT_FD"]
    del os.environ["TOC_INTERNAL_COMPONENT_PATH"]
    del os.environ["TOC_INTERNAL_COMPONENT_BLOB"]
    sys.argv = [path]
    code = compile(source, "<reviewed-toc-ledger-validator>", "exec", dont_inherit=True)
    scope = {"__name__": "__main__", "__file__": path, "__package__": None}
    exec(code, scope, scope)
except SystemExit as exc:
    if exc.code is None or type(exc.code) is int:
        raise
    try:
        os.write(diagnostic_fd, diagnostic)
    except BaseException:
        pass
    raise SystemExit(1)
except BaseException:
    try:
        os.write(diagnostic_fd, diagnostic)
    except BaseException:
        pass
    raise SystemExit(1)
' 1>/dev/null 2>/dev/null
child_status=$?
set -e
case "$child_status" in
  0|1|2) exit "$child_status" ;;
  *)
    printf '%s\n' '{"diagnostic_version":1,"reason":"internal_failure","stage":"ledger","status":"failed"}' >&5 2>/dev/null || :
    exit 1
    ;;
esac
