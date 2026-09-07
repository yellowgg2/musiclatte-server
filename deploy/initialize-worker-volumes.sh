#!/bin/sh
set -eu
case "$IMPORT_UID:$IMPORT_GID" in *[!0-9:]*|:*|*:) echo 'invalid_worker_owner' >&2; exit 1;; esac
[ "$IMPORT_UID" -gt 0 ] && [ "$IMPORT_GID" -gt 0 ] || exit 1
for directory in /staging /engine; do
  [ -d "$directory" ] && [ ! -L "$directory" ] || exit 1
  if [ -z "$(ls -A "$directory")" ]; then
    chown "$IMPORT_UID:$IMPORT_GID" "$directory"
    chmod 700 "$directory"
  elif [ "$(stat -c '%u:%g' "$directory")" != "$IMPORT_UID:$IMPORT_GID" ]; then
    echo 'worker_volume_owner_mismatch' >&2
    exit 1
  fi
done
