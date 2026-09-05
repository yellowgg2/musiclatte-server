#!/bin/sh
set -eu
case "${WEB_UI_ENABLED:-false}" in true|false) ;; *) echo 'Invalid gateway configuration' >&2; exit 1;; esac
if [ "${LAN_DEVELOPMENT:-false}" = true ] && [ "${ADMIN_SETUP_COMPLETE:-false}" != true ]; then
  echo 'Complete loopback administrator setup before LAN development' >&2
  exit 1
fi
export WEB_UI_ENABLED="${WEB_UI_ENABLED:-false}"
envsubst '${WEB_UI_ENABLED}' < /etc/nginx/musiclatte.conf.template > /tmp/nginx.conf
exec nginx -c /tmp/nginx.conf -g 'daemon off;'
