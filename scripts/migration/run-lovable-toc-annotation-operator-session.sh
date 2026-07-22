#!/usr/bin/env bash
set -euo pipefail

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

[ -t 0 ] && [ -t 1 ] && [ -t 2 ] || fail_tty
[ -z "${SSH_CONNECTION-}" ] || fail_tty
[ -z "${SSH_CLIENT-}" ] || fail_tty
[ -z "${SSH_TTY-}" ] || fail_tty
[ -z "${TMUX-}" ] || fail_tty
[ -z "${STY-}" ] || fail_tty
[ "${TERM_PROGRAM-}" != "vscode" ] || fail_tty
[ "${TERM_PROGRAM-}" != "Apple_Terminal" ] || [ -z "${ASCIINEMA_REC-}" ] || fail_tty

exec 3<>/dev/tty || fail_tty
[ -t 3 ] || fail_tty

read_private() {
  local prompt=$1
  local value
  printf '%s: ' "$prompt" >&3 || fail_tty
  stty -echo <&3 || fail_tty
  IFS= read -r value <&3 || {
    stty echo <&3 2>/dev/null || :
    fail_tty
  }
  stty echo <&3 || fail_tty
  printf '\n' >&3 || fail_tty
  printf '%s' "$value"
}

execution_python=$(read_private 'execution_python_absolute_path')
approved_python_sha256=$(read_private 'execution_python_sha256')
approved_python_version=$(read_private 'execution_python_version')
approved_checkout=$(read_private 'approved_execution_checkout_sha')

case "$execution_python" in
  /*) ;;
  *) fail_startup ;;
esac
case "$approved_python_sha256" in
  *[!0123456789abcdef]* | "") fail_startup ;;
esac
[ "${#approved_python_sha256}" -eq 64 ] || fail_startup
case "$approved_checkout" in
  *[!0123456789abcdef]* | "") fail_startup ;;
esac
[ "${#approved_checkout}" -eq 40 ] || fail_startup
case "$approved_python_version" in
  cpython:[0-9]*.[0-9]*.[0-9]*) ;;
  *) fail_startup ;;
esac

readonly script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P) || fail_startup
readonly driver="$script_dir/author-lovable-toc-operator-session.py"
[ -f "$driver" ] || fail_startup

{
  printf '%s\0%s\0%s\0%s\0' \
    "$execution_python" \
    "$approved_python_sha256" \
    "$approved_python_version" \
    "$approved_checkout"
} | /usr/bin/env -i \
  LANG=C \
  LC_ALL=C \
  TERM="${TERM:-xterm-256color}" \
  TOC_OPERATOR_TTY_FD=3 \
  "$execution_python" -I -S -B "$driver"
