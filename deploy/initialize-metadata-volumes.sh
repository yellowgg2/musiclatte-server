#!/bin/sh
set -eu
case "$METADATA_UID:$METADATA_GID" in *[!0-9:]*|:*|*:) echo 'invalid_metadata_owner' >&2; exit 1;; esac
[ "$METADATA_UID" -gt 0 ] && [ "$METADATA_GID" -gt 0 ] || exit 1
# Both writers share only derived covers; fail closed instead of changing existing ownership.
[ "$METADATA_UID:$METADATA_GID" = "$GONIC_UID:$GONIC_GID" ] || { echo 'metadata_cover_owner_mismatch' >&2; exit 1; }
for directory in /metadata-data /metadata-uploads /gonic-cover-cache; do
  [ -d "$directory" ] && [ ! -L "$directory" ] || exit 1
  if [ -z "$(ls -A "$directory")" ]; then
    chown "$METADATA_UID:$METADATA_GID" "$directory"
    chmod 700 "$directory"
  elif [ "$(stat -c '%u:%g:%a' "$directory")" != "$METADATA_UID:$METADATA_GID:700" ]; then
    echo 'metadata_volume_owner_mismatch' >&2
    exit 1
  fi
done
