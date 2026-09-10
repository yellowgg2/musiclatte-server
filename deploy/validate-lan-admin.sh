#!/bin/sh
set -eu

fail() {
  echo 'gonic LAN administration requires a private IPv4 address and completed setup' >&2
  exit 1
}

[ "${ADMIN_SETUP_COMPLETE:-}" = 'true' ] || fail
address=${LAN_BIND_ADDRESS:-}

case "$address" in
  '' | *[!0-9.]* | .* | *. | *..*) fail ;;
esac

old_ifs=$IFS
IFS=.
set -- $address
IFS=$old_ifs
[ "$#" -eq 4 ] || fail

for octet in "$@"; do
  case "$octet" in
    '' | *[!0-9]*) fail ;;
  esac
  [ "$octet" -le 255 ] 2>/dev/null || fail
done

case "$1:$2" in
  10:* | 192:168) ;;
  172:*) [ "$2" -ge 16 ] && [ "$2" -le 31 ] || fail ;;
  *) fail ;;
esac
