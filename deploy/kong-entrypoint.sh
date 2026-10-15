#!/bin/sh
set -eu
# Values are generated HS256 JWTs (base64url), never arbitrary shell fragments.
case "$ANON_KEY$SERVICE_ROLE_KEY" in *[!A-Za-z0-9_.-]*) exit 1 ;; esac
sed -e "s/ANON_KEY_PLACEHOLDER/$ANON_KEY/g" \
    -e "s/SERVICE_KEY_PLACEHOLDER/$SERVICE_ROLE_KEY/g" \
    /etc/kong/template.yml > /tmp/kong.yml
exec /entrypoint.sh kong docker-start
