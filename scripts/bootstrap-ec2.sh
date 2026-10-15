#!/usr/bin/env bash
# Run once on a fresh Ubuntu 24.04 EC2 host. Does not start the application.
set -euo pipefail
if [[ $(id -u) != 0 ]]; then echo 'Run with sudo.' >&2; exit 1; fi
. /etc/os-release
if [[ $ID != ubuntu || $VERSION_ID != 24.04 ]]; then
  echo 'This installer targets Ubuntu 24.04 LTS.' >&2; exit 1
fi
apt-get update
apt-get install -y ca-certificates curl git python3 awscli
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
architecture=$(dpkg --print-architecture)
cat > /etc/apt/sources.list.d/docker.sources <<SOURCES
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: $architecture
Signed-By: /etc/apt/keyrings/docker.asc
SOURCES
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
bash "$(dirname "$0")/install-services.sh"
echo 'Host ready. Next: generate /etc/gym/production.env and follow docs/PRODUCTION.md.'
