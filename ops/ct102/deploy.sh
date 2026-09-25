#!/usr/bin/env bash
# CT102 snapshot adapter: pull a CI-built immutable app image, back up, migrate,
# switch only the app, probe it, and restore the previous app image on failure.
set -Eeuo pipefail

image="${1:?image digest required}"
revision="${2:?full commit SHA required}"
migration="${3:?migration path required}"
customers_migration="${4:?customer migration path required}"
activity_migration="${5:?activity migration path required}"
voice_image="${6:?voice image digest required}"
voice_mode="${7:-create}"
quality_migration="${8:?location quality migration path required}"
attendance_migration="${9:?attendance leave migration path required}"
[[ "$voice_mode" == create || "$voice_mode" == reuse-existing ]] || { echo 'Invalid voice deployment mode' >&2; exit 2; }
release_override="$(cd "$(dirname "$0")" && pwd)/app-release.override.yml"
release_dir="$(cd "$(dirname "$0")" && pwd)"
voice_override="$release_dir/field-voice.override.yml"
project=/opt/deskcommcrm

[[ "$image" =~ ^ghcr\.io/ugeshc007/deskcommcrm@sha256:[a-f0-9]{64}$ ]] || { echo 'Invalid pinned image' >&2; exit 2; }
[[ "$voice_image" =~ ^ghcr\.io/ugeshc007/deskcomm-field-voice@sha256:[a-f0-9]{64}$ ]] || { echo 'Invalid pinned voice image' >&2; exit 2; }
[[ "$revision" =~ ^[a-f0-9]{40}$ ]] || { echo 'Invalid commit SHA' >&2; exit 2; }
[[ "$migration" == "$project"/releases/"$revision"/20260921210000_0383_field_sales_device_presence.sql ]] || { echo 'Unexpected migration path' >&2; exit 2; }
[[ "$customers_migration" == "$project"/releases/"$revision"/20260922113000_0384_field_sales_project_customers.sql ]] || { echo 'Unexpected customer migration path' >&2; exit 2; }
[[ "$activity_migration" == "$project"/releases/"$revision"/20260922160000_0385_field_sales_activity_notes.sql ]] || { echo 'Unexpected activity migration path' >&2; exit 2; }
[[ "$quality_migration" == "$project"/releases/"$revision"/20260924180000_0388_field_sales_location_quality.sql ]] || { echo 'Unexpected location quality migration path' >&2; exit 2; }
[[ "$attendance_migration" == "$project"/releases/"$revision"/20260925120000_0389_field_sales_attendance_leave.sql ]] || { echo 'Unexpected attendance migration path' >&2; exit 2; }
[[ -f "$migration" && -f "$customers_migration" && -f "$activity_migration" && -f "$quality_migration" && -f "$attendance_migration" && -f "$release_override" && -f "$voice_override" ]] || { echo 'Release files missing' >&2; exit 2; }
cd "$project"
[[ -f .env && -f docker-compose.prod.yml && -f docker-compose.ct102.yml && -f docker-compose.ct102.map.yml ]] || { echo 'CT102 compose files missing' >&2; exit 2; }
[[ -s field-map-tiles/uae.pmtiles ]] || { echo 'Self-hosted map archive missing' >&2; exit 2; }

compose() {
  docker compose -f docker-compose.prod.yml -f docker-compose.ct102.yml \
    -f docker-compose.ct102.map.yml -f "$release_override" \
    -f "$voice_override" --env-file .env "$@"
}
export CT102_APP_IMAGE="$image" CT102_APP_VERSION="${revision:0:7}" CT102_VOICE_IMAGE="$voice_image"
export COMPOSE_PROFILES=field-voice
existing_voice="$(compose ps -a -q field-voice)"
if [[ "$voice_mode" == reuse-existing ]]; then
  [[ "$existing_voice" =~ ^[a-f0-9]{64}$ ]] || { echo 'Existing voice sidecar required' >&2; exit 2; }
  [[ "$(docker inspect "$existing_voice" --format '{{.Config.Image}}')" == "$voice_image" ]] || { echo 'Existing voice image does not match reviewed digest' >&2; exit 2; }
  [[ "$(docker inspect "$existing_voice" --format '{{.State.Health.Status}}')" == healthy ]] || { echo 'Existing voice sidecar is not healthy' >&2; exit 2; }
else
  [[ -z "$existing_voice" ]] || { echo 'A voice sidecar already exists; manual review is required before replacing it' >&2; exit 2; }
fi
app_container="$(docker compose -f docker-compose.prod.yml -f docker-compose.ct102.yml --env-file .env ps -q app)"
[[ -n "$app_container" ]] || { echo 'Running app not found' >&2; exit 2; }
previous_image="$(docker inspect "$app_container" --format '{{.Config.Image}}')"
previous_version="$(docker inspect "$app_container" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^APP_VERSION=//p' | head -1)"
[[ -n "$previous_image" && -n "$previous_version" ]] || { echo 'Previous app version unavailable' >&2; exit 2; }
[[ "$previous_image" =~ ^ghcr\.io/ugeshc007/deskcommcrm@sha256:[a-f0-9]{64}$ ]] || { echo 'Previous image is not a pinned CT102 app image' >&2; exit 2; }
[[ "$previous_version" =~ ^[a-f0-9]{7,40}$ ]] || { echo 'Previous app version is invalid' >&2; exit 2; }
switched=0
voice_started=0
rollback() {
  result=$?
  trap - EXIT
  if [[ "$result" == 0 ]]; then exit 0; fi
  if [[ "$switched" == 1 ]]; then
    echo 'Release failed; restoring previous app image' >&2
    CT102_APP_IMAGE="$previous_image" CT102_APP_VERSION="$previous_version" compose up -d --no-deps app || true
  fi
  if [[ "$voice_started" == 1 ]]; then
    if [[ -f "$release_dir/new-voice-container.txt" ]]; then
      docker stop "$(cat "$release_dir/new-voice-container.txt")" || true
    else
      compose stop field-voice || true
    fi
  fi
  exit "$result"
}
trap rollback EXIT

# Existing kit resolves the schema connection from CT102's private .env.
# Never print that URL or any container environment.
source hostgator-setup-kit/_common.sh
enter_project
backup_dir="$project/backups/ct102-$(date -u +%Y%m%d-%H%M%S)-${revision:0:7}"
BACKUP_DIR="$backup_dir" bash hostgator-setup-kit/backup.sh
[[ -n "$(find "$backup_dir" -maxdepth 1 -name 'db-*.sql.gz' -size +0c -print -quit)" ]] || { echo 'Database backup missing' >&2; exit 1; }

docker pull "$image"
if [[ "$voice_mode" == create ]]; then docker pull "$voice_image"; fi
image_revision="$(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')"
[[ "$image_revision" == "$revision" ]] || { echo 'Image revision does not match release commit' >&2; exit 1; }
if [[ "$voice_mode" == create ]]; then
  voice_revision="$(docker image inspect "$voice_image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')"
  [[ "$voice_revision" == "$revision" ]] || { echo 'Voice image revision does not match release commit' >&2; exit 1; }
fi

docker run --rm -v "$migration:/release-migration.sql:ro" \
  -v "$customers_migration:/customers-migration.sql:ro" \
  -v "$activity_migration:/activity-migration.sql:ro" \
  -v "$quality_migration:/location-quality-migration.sql:ro" \
  -v "$attendance_migration:/attendance-migration.sql:ro" postgres:17-alpine \
  psql "$(url_do_schema)" -1 -q -v ON_ERROR_STOP=1 \
  -f /release-migration.sql -f /customers-migration.sql -f /activity-migration.sql -f /location-quality-migration.sql -f /attendance-migration.sql

# Retain the exact prior image for the runner's external public-health rollback.
printf '%s\n%s\n' "$previous_image" "$previous_version" > "$release_dir/previous-app.txt"
chmod 600 "$release_dir/previous-app.txt"

export CT102_APP_IMAGE="$image" CT102_APP_VERSION="${revision:0:7}" CT102_VOICE_IMAGE="$voice_image"
export COMPOSE_PROFILES=field-voice
compose config --quiet
if [[ "$voice_mode" == create ]]; then
voice_started=1
compose up -d --no-deps field-voice
voice_container="$(compose ps -q field-voice)"
[[ "$voice_container" =~ ^[a-f0-9]{64}$ ]] || { echo 'Voice sidecar did not start' >&2; exit 1; }
printf '%s\n' "$voice_container" > "$release_dir/new-voice-container.txt"
chmod 600 "$release_dir/new-voice-container.txt"
else
  voice_container="$existing_voice"
fi
voice_healthy=0
for attempt in $(seq 1 30); do
  if [[ "$(docker inspect "$voice_container" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}')" == healthy ]]; then
    voice_healthy=1
    break
  fi
  sleep 2
done
[[ "$voice_healthy" == 1 ]] || { echo 'Voice sidecar did not become healthy' >&2; exit 1; }
switched=1
compose up -d --no-deps app
app_container="$(compose ps -q app)"
for attempt in $(seq 1 30); do
  if [[ "$(docker inspect "$app_container" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}')" == healthy ]] \
    && curl -fsS --max-time 5 http://127.0.0.1:3002/api/v1/health \
      | grep -q "\"version\":\"${revision:0:7}\""; then
    echo "CT102 app internally healthy at ${revision:0:7}; backup: $backup_dir"
    switched=0
    exit 0
  fi
  sleep 2
done
echo 'CT102 app did not become healthy' >&2
false
