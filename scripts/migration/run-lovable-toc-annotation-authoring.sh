#!/bin/sh
# Exact isolated launcher for private, local-only Lovable TOC annotation review.

set -eu
umask 077

readonly STARTUP_ENVIRONMENT_DIAGNOSTIC='{"diagnostic_version":1,"reason":"startup_environment_invalid","stage":"annotation_authoring_launcher","status":"failed"}'
readonly EXECUTION_PYTHON_DIAGNOSTIC='{"diagnostic_version":1,"reason":"execution_python_invalid","stage":"annotation_authoring_launcher","status":"failed"}'
readonly TTY_DIAGNOSTIC='{"diagnostic_version":1,"reason":"tty_invalid","stage":"annotation_authoring_launcher","status":"failed"}'

fail_startup_environment() {
  printf '%s\n' "$STARTUP_ENVIRONMENT_DIAGNOSTIC" >&2 2>/dev/null || :
  exit 1
}

fail_execution_python() {
  printf '%s\n' "$EXECUTION_PYTHON_DIAGNOSTIC" >&2 2>/dev/null || :
  exit 1
}

fail_tty() {
  printf '%s\n' "$TTY_DIAGNOSTIC" >&2 2>/dev/null || :
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

# Raw TOC and private checkpoint bytes must never enter a process core file.
# Lower both limits before any reviewed child or private input can exist.
ulimit -S -c 0 2>/dev/null || fail_startup_environment
ulimit -H -c 0 2>/dev/null || fail_startup_environment

# These variables affect a native/Python process before repository code can
# defend itself. The invoking shell/native runtime remains an explicit trust
# boundary; a set poison variable is rejected rather than propagated.
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

# Reject obvious remote, multiplexer, IDE-terminal, and recording wrappers.
# The reviewed procedure also requires a human attestation because no local
# process can independently prove the absence of screen capture or a hostile
# same-user terminal implementation.
if [ "${SSH_CONNECTION+x}" = x ] || \
   [ "${SSH_CLIENT+x}" = x ] || \
   [ "${SSH_TTY+x}" = x ] || \
   [ "${MOSH_IP+x}" = x ] || \
   [ "${MOSH_PORT+x}" = x ] || \
   [ "${TMUX+x}" = x ] || \
   [ "${STY+x}" = x ] || \
   [ "${INSIDE_EMACS+x}" = x ] || \
   [ "${VSCODE_IPC_HOOK_CLI+x}" = x ]; then
  fail_tty
fi

[ "${TOC_AUTHOR_LOCAL_TTY_ATTESTATION-}" = \
  "LOCAL_CONTROLLING_TTY_NO_RECORDING_NO_REMOTE_NO_CLIPBOARD" ] || fail_tty
[ -t 0 ] && [ -t 1 ] && [ -t 2 ] || fail_tty
# Duplicate the already verified controlling input descriptor. Opening
# /dev/tty is unnecessary and can itself produce a shell-native pathname error
# before the fixed-diagnostic boundary on restricted hosts.
{ exec 3<&0; } 2>/dev/null || fail_tty
[ -t 3 ] || fail_tty

execution_python=${TOC_AUTHOR_EXECUTION_PYTHON-}
approved_python_sha256=${TOC_AUTHOR_APPROVED_EXECUTION_PYTHON_SHA256-}
approved_python_version=${TOC_AUTHOR_APPROVED_EXECUTION_PYTHON_VERSION-}
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
[ "${#python_mode}" -ge 3 ] && [ "${#python_mode}" -le 4 ] || fail_execution_python
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
driver=${script_directory}/author-lovable-toc-annotations.py
if [ ! -f "$driver" ] || [ -L "$driver" ]; then
  fail_execution_python
fi
repository=$(CDPATH= cd -P -- "${script_directory}/../.." 2>/dev/null && pwd -P) || \
  fail_execution_python
approved_checkout=${TOC_AUTHOR_APPROVED_EXECUTION_CHECKOUT_SHA-}
case "$approved_checkout" in
  *[!0-9a-f]* | "") fail_execution_python ;;
esac
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
driver_blob=$(
  /usr/bin/env -i LANG=C LC_ALL=C PATH=/usr/bin:/bin \
    GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_SYSTEM=/dev/null \
    GIT_NO_REPLACE_OBJECTS=1 GIT_OPTIONAL_LOCKS=0 GIT_TERMINAL_PROMPT=0 \
    /usr/bin/git -c core.fsmonitor=false -c core.hooksPath=/dev/null \
      -c core.untrackedCache=false -C "$repository" \
      rev-parse "${approved_checkout}:scripts/migration/author-lovable-toc-annotations.py" \
      2>/dev/null
) || fail_execution_python
case "$driver_blob" in *[!0-9a-f]* | "") fail_execution_python ;; esac
[ "${#driver_blob}" -eq 40 ] || fail_execution_python
{ exec 4<"$driver"; } 2>/dev/null || fail_execution_python
# stdout/stderr are already verified controlling-TTY descriptors.  Do not put
# a scoped redirection on this duplication: redirections are applied before
# the group body and would bind descriptor 5 to /dev/null instead of stderr.
exec 5>&2 6>&1 || fail_execution_python

# The controlled UI uses only inherited descriptor 3. stdout/stderr remain
# fixed-diagnostic channels.  A tiny isolated bootstrap binds the already-open
# component bytes to the approved Git blob before parsing them, then suppresses
# every unexpected interpreter exception behind one fixed diagnostic.
set +e
/usr/bin/env -i \
  LANG=C \
  LC_ALL=C \
  TERM=xterm-256color \
  "TOC_AUTHOR_ACTION=${TOC_AUTHOR_ACTION-}" \
  "TOC_AUTHOR_EXECUTION_PYTHON=$execution_python" \
  "TOC_AUTHOR_APPROVED_EXECUTION_PYTHON_SHA256=$approved_python_sha256" \
  "TOC_AUTHOR_APPROVED_EXECUTION_PYTHON_VERSION=$approved_python_version" \
  "TOC_AUTHOR_APPROVED_EXECUTION_CHECKOUT_SHA=${TOC_AUTHOR_APPROVED_EXECUTION_CHECKOUT_SHA-}" \
  "TOC_AUTHOR_CAPTURE_ROOT=${TOC_AUTHOR_CAPTURE_ROOT-}" \
  "TOC_AUTHOR_CAPTURE_NAME=${TOC_AUTHOR_CAPTURE_NAME-}" \
  "TOC_AUTHOR_PRIVATE_ROOT=${TOC_AUTHOR_PRIVATE_ROOT-}" \
  "TOC_AUTHOR_EXPECTED_CAPTURE_MANIFEST_SHA256=${TOC_AUTHOR_EXPECTED_CAPTURE_MANIFEST_SHA256-}" \
  "TOC_AUTHOR_EXPECTED_RAW_TOC_SHA256=${TOC_AUTHOR_EXPECTED_RAW_TOC_SHA256-}" \
  "TOC_AUTHOR_EXPECTED_OPAQUE_INDEX_SHA256=${TOC_AUTHOR_EXPECTED_OPAQUE_INDEX_SHA256-}" \
  "TOC_AUTHOR_EXPECTED_ENTRY_COUNT=${TOC_AUTHOR_EXPECTED_ENTRY_COUNT-}" \
  "TOC_AUTHOR_EXPECTED_DATA_REFERENCE_COUNT=${TOC_AUTHOR_EXPECTED_DATA_REFERENCE_COUNT-}" \
  "TOC_AUTHOR_EVIDENCE_RUN_ID=${TOC_AUTHOR_EVIDENCE_RUN_ID-}" \
  "TOC_AUTHOR_OUTER_SHA256=${TOC_AUTHOR_OUTER_SHA256-}" \
  "TOC_AUTHOR_INNER_SHA256=${TOC_AUTHOR_INNER_SHA256-}" \
  "TOC_AUTHOR_EVIDENCE_MANIFEST_SHA256=${TOC_AUTHOR_EVIDENCE_MANIFEST_SHA256-}" \
  "TOC_AUTHOR_INSPECTION_CHECKOUT_SHA=${TOC_AUTHOR_INSPECTION_CHECKOUT_SHA-}" \
  "TOC_AUTHOR_INSPECTION_PROCEDURE_SHA256=${TOC_AUTHOR_INSPECTION_PROCEDURE_SHA256-}" \
  "TOC_AUTHOR_CAPTURE_EXECUTION_CHECKOUT_SHA=${TOC_AUTHOR_CAPTURE_EXECUTION_CHECKOUT_SHA-}" \
  "TOC_AUTHOR_EXPECTED_CAPTURE_PROCEDURE_IDENTITY_SHA256=${TOC_AUTHOR_EXPECTED_CAPTURE_PROCEDURE_IDENTITY_SHA256-}" \
  "TOC_AUTHOR_APPROVED_PG_RESTORE_SHA256=${TOC_AUTHOR_APPROVED_PG_RESTORE_SHA256-}" \
  "TOC_AUTHOR_PRIMARY_OPERATOR_IDENTITY=${TOC_AUTHOR_PRIMARY_OPERATOR_IDENTITY-}" \
  "TOC_AUTHOR_OPERATOR_IDENTITY=${TOC_AUTHOR_OPERATOR_IDENTITY-}" \
  "TOC_AUTHOR_SESSION_IDENTITY=${TOC_AUTHOR_SESSION_IDENTITY-}" \
  "TOC_AUTHOR_EXPECTED_HEAD_GENERATION=${TOC_AUTHOR_EXPECTED_HEAD_GENERATION-}" \
  "TOC_AUTHOR_EXPECTED_HEAD_SHA256=${TOC_AUTHOR_EXPECTED_HEAD_SHA256-}" \
  "TOC_AUTHOR_EXPECTED_RELEASE_TOKEN=${TOC_AUTHOR_EXPECTED_RELEASE_TOKEN-}" \
  "TOC_AUTHOR_LOCAL_TTY_ATTESTATION=${TOC_AUTHOR_LOCAL_TTY_ATTESTATION-}" \
  "TOC_AUTHOR_FINALIZATION_AUTHORIZATION=${TOC_AUTHOR_FINALIZATION_AUTHORIZATION-}" \
  TOC_AUTHOR_TTY_FD=3 \
  "TOC_INTERNAL_COMPONENT_FD=4" \
  "TOC_INTERNAL_COMPONENT_PATH=$driver" \
  "TOC_INTERNAL_COMPONENT_BLOB=$driver_blob" \
  TOC_INTERNAL_DIAGNOSTIC_STDERR_FD=5 \
  TOC_INTERNAL_DIAGNOSTIC_STDOUT_FD=6 \
  "$execution_python" -I -S -B -c '
import hashlib, os, resource, stat, sys
diagnostic = b"{\"diagnostic_version\":1,\"reason\":\"binding_mismatch\",\"stage\":\"annotation_authoring\",\"status\":\"failed\"}\n"
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
    code = compile(source, "<reviewed-annotation-author>", "exec", dont_inherit=True)
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
    printf '%s\n' '{"diagnostic_version":1,"reason":"internal_failure","stage":"annotation_authoring","status":"failed"}' >&5 2>/dev/null || :
    exit 1
    ;;
esac
