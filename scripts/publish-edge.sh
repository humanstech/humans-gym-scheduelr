#!/usr/bin/env bash
# Changes only Gym's site. Never recreates the edge container.
set -euo pipefail
[[ $(id -u) == 0 ]] || { echo 'Run with sudo.' >&2; exit 1; }
cd "$(dirname "$0")/.."
exec 9>/opt/gym/deploy.lock
flock 9
site=/opt/edge/conf/sites/gym.caddy
candidate=/opt/edge/conf/sites/gym.caddy.tmp
backup=$(mktemp /opt/gym/logs/edge-site.XXXXXX)
had_site=false
if [[ -f "$site" ]]; then cp "$site" "$backup"; had_site=true; fi
edge=(docker compose --project-name edge --project-directory /opt/edge --env-file /opt/edge/.env -f /opt/edge/compose.yml)
reload() { "${edge[@]}" exec -T caddy caddy reload --config /etc/caddy/Caddyfile --address unix//config/admin.sock; }
install -o root -g root -m 644 deploy/edge/gym.caddy "$candidate"
mv "$candidate" "$site"
if ! reload; then
  if $had_site; then install -o root -g root -m 644 "$backup" "$site"; else rm -f "$site"; fi
  reload || echo 'Edge reload still fails; contact the owner. Previous runtime configuration remains active.' >&2
  rm -f "$backup"
  exit 1
fi
rm -f "$backup"
echo 'Gym edge route installed; verify HTTPS after starting the application.'
