#!/bin/sh
set -eu
case "$GONIC_UID:$GONIC_GID" in *[!0-9:]*|:*|*:) echo 'Invalid gonic UID/GID' >&2; exit 1;; esac
[ "$GONIC_UID" -gt 0 ] && [ "$GONIC_GID" -gt 0 ] || exit 1
for directory in /data /cache /playlists /podcasts; do
  if [ -z "$(ls -A "$directory")" ]; then
    chown "$GONIC_UID:$GONIC_GID" "$directory"
    chmod 700 "$directory"
  elif [ "$(stat -c '%u:%g' "$directory")" != "$GONIC_UID:$GONIC_GID" ]; then
    echo 'Existing gonic volume ownership does not match configured UID/GID' >&2
    exit 1
  fi
done
