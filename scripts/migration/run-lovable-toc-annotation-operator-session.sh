#!/bin/sh
set -eu

readonly STAGE='annotation_operator_session_launcher'
readonly STARTUP_DIAGNOSTIC='{"diagnostic_version":1,"reason":"startup_environment_invalid","stage":"annotation_operator_session_launcher","status":"failed"}'
readonly TTY_DIAGNOSTIC='{"diagnostic_version":1,"reason":"tty_invalid","stage":"annotation_operator_session_launcher","status":"failed"}'

fail_startup() {
  printf '%s\n' "$STARTUP_DIAGNOSTIC" >&2 2>/dev/null || :
  exit 1
}

fail_tty() {
  printf '%s\n' "$TTY_DIAGNOSTIC" >&2 2>/dev/null || :
  exit 1
}

[ "$#" -eq 0 ] || fail_startup
umask 077 || fail_startup
ulimit -S -c 0 2>/dev/null || fail_startup
ulimit -H -c 0 2>/dev/null || fail_startup

# Reject native/Python/shell startup poisoning before any private prompt or
# reviewed child process can exist.  The child still runs under env -i; this
# pre-child check keeps the operator surface aligned with sibling launchers.
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
  PYTHONPROFILEIMPORTTIME ENV BASH_ENV
do
  eval "poison_is_set=\${${poison_name}+x}"
  [ "$poison_is_set" != x ] || fail_startup
done

for tty_marker_name in \
  SSH_CONNECTION SSH_CLIENT SSH_TTY MOSH_IP MOSH_PORT TMUX STY INSIDE_EMACS \
  VSCODE_IPC_HOOK_CLI ASCIINEMA_REC
do
  eval "tty_marker_is_set=\${${tty_marker_name}+x}"
  [ "$tty_marker_is_set" != x ] || fail_tty
done
case "${TERM_PROGRAM-}" in
  [Vv][Ss][Cc][Oo][Dd][Ee]|\
  [Aa][Pp][Pp][Ll][Ee]_[Tt][Ee][Rr][Mm][Ii][Nn][Aa][Ll]_[Ss][Ss][Hh])
    fail_tty
    ;;
esac

[ -t 1 ] && [ -t 2 ] || fail_tty
{ command exec 0<>/dev/tty; } 2>/dev/null || fail_tty
exec 1>&0 2>&0 || fail_tty
[ -t 0 ] && [ -t 1 ] && [ -t 2 ] || fail_tty
exec 3<>/dev/tty || fail_tty
[ -t 3 ] || fail_tty

readonly script_dir=$(CDPATH= cd -- "$(/usr/bin/dirname -- "$0")" && pwd -P) || fail_startup
readonly driver="$script_dir/author-lovable-toc-operator-session.py"
readonly execution_python='/Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/bin/python3.9'
[ -f "$driver" ] && [ ! -L "$driver" ] || fail_startup
[ -f "$execution_python" ] && [ ! -L "$execution_python" ] && [ -x "$execution_python" ] || fail_startup

exec /usr/bin/env -i \
  LANG=C \
  LC_ALL=C \
  TERM="${TERM:-xterm-256color}" \
  TOC_OPERATOR_OUTER_TTY_CONTEXT=clear-v1 \
  TOC_OPERATOR_TTY_FD=3 \
  "$execution_python" -I -S -B "$driver"
