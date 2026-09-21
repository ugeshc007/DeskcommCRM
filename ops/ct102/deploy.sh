#!/usr/bin/env bash
# CT102 snapshot adapter: pull a CI-built immutable app image, back up, migrate,
# switch only the app, probe it, and restore the previous app image on failure.
set -Eeuo pipefail

image="${1:?image digest required}"
revision="${2:?full commit SHA required}"
baseline="${3:?baseline path required}"
release_override="$(cd "$(dirname "$0")" && pwd)/app-release.override.yml"
project=/opt/deskcommcrm

[[ "$image" =~ ^ghcr\.io/ugeshc007/deskcommcrm@sha256:[a-f0-9]{64}$ ]] || { echo 'Invalid pinned image' >&2; exit 2; }
[[ "$revision" =~ ^[a-f0-9]{40}$ ]] || { echo 'Invalid commit SHA' >&2; exit 2; }
[[ "$baseline" == "$project"/releases/"$revision"/baseline.sql ]] || { echo 'Unexpected baseline path' >&2; exit 2; }
[[ -f "$baseline" && -f "$release_override" ]] || { echo 'Release files missing' >&2; exit 2; }
cd "$project"
[[ -f .env && -f docker-compose.prod.yml && -f docker-compose.ct102.yml && -f docker-compose.ct102.map.yml ]] || { echo 'CT102 compose files missing' >&2; exit 2; }
[[ -s field-map-tiles/uae.pmtiles ]] || { echo 'Self-hosted map archive missing' >&2; exit 2; }

compose() {
  docker compose -f docker-compose.prod.yml -f docker-compose.ct102.yml \
    -f docker-compose.ct102.map.yml -f "$release_override" --env-file .env "$@"
}
app_container="$(docker compose -f docker-compose.prod.yml -f docker-compose.ct102.yml --env-file .env ps -q app)"
[[ -n "$app_container" ]] || { echo 'Running app not found' >&2; exit 2; }
previous_image="$(docker inspect "$app_container" --format '{{.Config.Image}}')"
previous_version="$(docker inspect "$app_container" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^APP_VERSION=//p' | head -1)"
[[ -n "$previous_image" && -n "$previous_version" ]] || { echo 'Previous app version unavailable' >&2; exit 2; }
switched=0
rollback() {
  result=$?
  trap - ERR
  if [[ "$switched" == 1 ]]; then
    echo 'Release failed; restoring previous app image' >&2
    CT102_APP_IMAGE="$previous_image" CT102_APP_VERSION="$previous_version" compose up -d --no-deps app || true
  fi
  exit "$result"
}
trap rollback ERR

# Existing kit resolves the schema connection from CT102's private .env.
# Never print that URL or any container environment.
source hostgator-setup-kit/_common.sh
enter_project
backup_dir="$project/backups/ct102-$(date -u +%Y%m%d-%H%M%S)-${revision:0:7}"
BACKUP_DIR="$backup_dir" bash hostgator-setup-kit/backup.sh
[[ -n "$(find "$backup_dir" -maxdepth 1 -name 'db-*.sql.gz' -size +0c -print -quit)" ]] || { echo 'Database backup missing' >&2; exit 1; }

docker pull "$image"
image_revision="$(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')"
[[ "$image_revision" == "$revision" ]] || { echo 'Image revision does not match release commit' >&2; exit 1; }

docker run --rm -i -v "$baseline:/release-baseline.sql:ro" postgres:17-alpine \
  psql "$(url_do_schema)" -q -v ON_ERROR_STOP=1 -f /release-baseline.sql

export CT102_APP_IMAGE="$image" CT102_APP_VERSION="${revision:0:7}"
compose config --quiet
switched=1
compose up -d --no-deps app
app_container="$(compose ps -q app)"
for attempt in $(seq 1 30); do
  if [[ "$(docker inspect "$app_container" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}')" == healthy ]] \
    && curl -fsS --max-time 5 http://127.0.0.1:3002/api/v1/health >/dev/null \
    && curl -fsS --max-time 8 https://crm.techspothub.com/api/v1/health \
      | grep -q "\"version\":\"${revision:0:7}\""; then
    echo "CT102 app healthy at ${revision:0:7}; backup: $backup_dir"
    switched=0
    exit 0
  fi
  sleep 2
done
echo 'CT102 app did not become healthy' >&2
false
