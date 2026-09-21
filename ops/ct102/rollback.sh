#!/usr/bin/env bash
# Restore the pre-release app image if the external public-health probe fails.
set -Eeuo pipefail

revision="${1:?full commit SHA required}"
project=/opt/deskcommcrm
[[ "$revision" =~ ^[a-f0-9]{40}$ ]] || { echo 'Invalid commit SHA' >&2; exit 2; }
release_dir="$project/releases/$revision"
state="$release_dir/previous-app.txt"
[[ -f "$state" && -f "$release_dir/app-release.override.yml" ]] || { echo 'Rollback state missing' >&2; exit 2; }
mapfile -t previous < "$state"
[[ "${#previous[@]}" == 2 ]] || { echo 'Invalid rollback state' >&2; exit 2; }
[[ "${previous[0]}" =~ ^ghcr\.io/ugeshc007/deskcommcrm@sha256:[a-f0-9]{64}$ ]] || { echo 'Invalid prior image' >&2; exit 2; }
[[ "${previous[1]}" =~ ^[a-f0-9]{7,40}$ ]] || { echo 'Invalid prior version' >&2; exit 2; }

cd "$project"
CT102_APP_IMAGE="${previous[0]}" CT102_APP_VERSION="${previous[1]}" \
  docker compose -f docker-compose.prod.yml -f docker-compose.ct102.yml \
    -f docker-compose.ct102.map.yml -f "$release_dir/app-release.override.yml" \
    --env-file .env up -d --no-deps app

for attempt in $(seq 1 30); do
  container="$(docker compose -f docker-compose.prod.yml -f docker-compose.ct102.yml --env-file .env ps -q app)"
  if [[ -n "$container" ]] \
    && [[ "$(docker inspect "$container" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}')" == healthy ]] \
    && curl -fsS --max-time 5 http://127.0.0.1:3002/api/v1/health \
      | grep -q "\"version\":\"${previous[1]}\""; then
    echo "Previous CT102 app restored at ${previous[1]}"
    exit 0
  fi
  sleep 2
done
echo 'Previous CT102 app failed to become healthy' >&2
exit 1
