import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

// Runs the Linux deployment adapter against fake Docker/health/backup tools only.
describe.skipIf(process.platform === 'win32')('CT102 app correction preserves the reviewed voice container', () => {
  const revision = 'a'.repeat(40), app = `ghcr.io/ugeshc007/deskcommcrm@sha256:${'b'.repeat(64)}`;
  const oldApp = `ghcr.io/ugeshc007/deskcommcrm@sha256:${'c'.repeat(64)}`;
  const voice = `ghcr.io/ugeshc007/deskcomm-field-voice@sha256:${'d'.repeat(64)}`;
  function run(mode: 'healthy' | 'wrong-image' | 'bad-app') {
    const root = mkdtempSync(join(tmpdir(), 'ct102-adapter-')), release = join(root, 'releases', revision), bin = join(root, 'bin');
    const put = (path: string, body: string, executable = false) => writeFileSync(path, body, { mode: executable ? 0o700 : 0o600 });
    try {
      for (const dir of [release, bin, join(root, 'hostgator-setup-kit'), join(root, 'field-map-tiles')]) mkdirSync(dir, { recursive: true });
      for (const file of ['.env', 'docker-compose.prod.yml', 'docker-compose.ct102.yml', 'docker-compose.ct102.map.yml']) put(join(root, file), '');
      put(join(root, 'field-map-tiles/uae.pmtiles'), 'synthetic');
      const migrations = ['20260921210000_0383_field_sales_device_presence.sql', '20260922113000_0384_field_sales_project_customers.sql', '20260922160000_0385_field_sales_activity_notes.sql'].map(file => join(release, file));
      for (const file of [...migrations, join(release, 'app-release.override.yml'), join(release, 'field-voice.override.yml')]) put(file, '');
      put(join(release, 'deploy.sh'), readFileSync('ops/ct102/deploy.sh', 'utf8').replaceAll('/opt/deskcommcrm', root));
      put(join(root, 'hostgator-setup-kit/_common.sh'), 'enter_project() { :; }\nurl_do_schema() { printf synthetic; }\n');
      put(join(root, 'hostgator-setup-kit/backup.sh'), 'mkdir -p "$BACKUP_DIR"; printf synthetic > "$BACKUP_DIR/db-test.sql.gz"\n');
      put(join(bin, 'sleep'), '#!/bin/sh\nexit 0\n', true);
      put(join(bin, 'curl'), `#!/bin/sh\nprintf '%s' '{"version":"${mode === 'bad-app' ? 'fffffff' : revision.slice(0, 7)}"}'\n`, true);
      put(join(bin, 'docker'), `#!/bin/bash
echo "$CT102_APP_IMAGE | $*" >> "$TEST_ROOT/docker.log"
case "$*" in
  *"ps -a -q field-voice"*) printf '%s' '${'e'.repeat(64)}' ;;
  *"ps -q app"*) printf '%s' '${'f'.repeat(64)}' ;;
  "inspect ${'e'.repeat(64)}"*"Config.Image"*) printf '%s' '${mode === 'wrong-image' ? 'unreviewed-image' : voice}' ;;
  "inspect ${'f'.repeat(64)}"*"Config.Image"*) printf '%s' '${oldApp}' ;;
  *"Config.Env"*) printf 'APP_VERSION=1234567\\n' ;;
  *"org.opencontainers.image.revision"*) printf '%s' '${revision}' ;;
  *"Health"*) printf healthy ;;
esac
`, true);
      const result = spawnSync('bash', [join(release, 'deploy.sh'), app, revision, ...migrations, voice, 'reuse-existing'],
        { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TEST_ROOT: root }, encoding: 'utf8', timeout: 10000 });
      return { status: result.status, error: result.stderr, log: readFileSync(join(root, 'docker.log'), 'utf8') };
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
  it('switches only the app when the existing voice digest and health match', () => {
    const result = run('healthy');
    expect(result.status, result.error).toBe(0);
    expect(result.log).toContain('up -d --no-deps app');
    expect(result.log).not.toContain('up -d --no-deps field-voice');
    expect(result.log).not.toContain(`pull ${voice}`);
  });
  it('refuses an unreviewed voice image before pulling or switching anything', () => {
    const result = run('wrong-image');
    expect(result.status).toBe(2);
    expect(result.log).not.toContain('pull ');
    expect(result.log).not.toContain('up -d');
  });
  it('restores the previous app on failed health without stopping the existing voice service', () => {
    const result = run('bad-app');
    expect(result.status).toBe(1);
    expect(result.log).toContain(`${oldApp} | compose`);
    expect(result.log).not.toContain('stop ');
  });
});
