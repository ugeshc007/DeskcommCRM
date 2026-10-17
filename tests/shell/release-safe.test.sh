#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
release="$root/hostgator-setup-kit/release-safe.sh"
smoke="$root/hostgator-setup-kit/smoke-postdeploy.sh"
android="$root/.github/workflows/android.yml"
staging="$root/.github/workflows/staging-release.yml"

fail() { echo "FAIL: $*" >&2; exit 1; }
assert_has() { grep -Fq -- "$2" "$1" || fail "$1 nao contem: $2"; }

bash -n "$release"
bash -n "$smoke"
bash -n "$root/scripts/ci/test-changed.sh"

assert_has "$release" 'docker pull postgres:17-alpine'
assert_has "$release" 'bash "$KIT_DIR/backup.sh"'
assert_has "$release" 'bash "$KIT_DIR/smoke-postdeploy.sh"'
assert_has "$release" '--force --skip-backup'
assert_has "$release" '.release-safe.lock'
assert_has "$release" 'running_image'

assert_has "$smoke" '/api/v1/health'
assert_has "$smoke" '"waha"[[:space:]]*'
assert_has "$smoke" '/api/v1/field-sales/mobile'
assert_has "$smoke" '/app/field-sales'

assert_has "$android" 'cache: gradle'
assert_has "$android" 'Cache emulator snapshot'
assert_has "$android" ':app:connectedDebugAndroidTest'

assert_has "$staging" 'environment: staging-ct102-parity'
assert_has "$staging" 'release-safe.sh --to'

echo 'release-safe: guards, smoke, staging and Android cache are wired'
