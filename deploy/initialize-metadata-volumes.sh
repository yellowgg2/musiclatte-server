#!/bin/sh
set -eu
case "$METADATA_UID:$METADATA_GID" in *[!0-9:]*|:*|*:) echo 'invalid_metadata_owner' >&2; exit 1;; esac
[ "$METADATA_UID" -gt 0 ] && [ "$METADATA_GID" -gt 0 ] || exit 1
for directory in /metadata-data /metadata-uploads; do
  [ -d "$directory" ] && [ ! -L "$directory" ] || exit 1
  if [ -z "$(ls -A "$directory")" ]; then
    chown "$METADATA_UID:$METADATA_GID" "$directory"
    chmod 700 "$directory"
  elif [ "$(stat -c '%u:%g:%a' "$directory")" != "$METADATA_UID:$METADATA_GID:700" ]; then
    echo 'metadata_volume_owner_mismatch' >&2
    exit 1
  fi
done
