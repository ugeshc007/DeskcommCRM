import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('CT102 release safety', () => {
  it('uses the versioned Field Sales migration atomically, not the full baseline', () => {
    const deploy = read('ops/ct102/deploy.sh');
    expect(deploy).toContain('20260921210000_0383_field_sales_device_presence.sql');
    expect(deploy).toContain('20260922113000_0384_field_sales_project_customers.sql');
    expect(deploy).toContain('20260924180000_0388_field_sales_location_quality.sql');
    expect(deploy).toContain('psql "$(url_do_schema)" -1 -q -v ON_ERROR_STOP=1');
    expect(deploy).not.toContain('baseline.sql');
    expect(deploy.indexOf('BACKUP_DIR="$backup_dir"')).toBeLessThan(deploy.indexOf('psql "$(url_do_schema)"'));
  });

  it('checks the public hostname from the runner and rolls back after a failed smoke', () => {
    const workflow = read('.github/workflows/ct102-release.yml');
    const deploy = read('ops/ct102/deploy.sh');
    const rollback = read('ops/ct102/rollback.sh');
    expect(workflow).toContain('20260921210000_0383_field_sales_device_presence.sql');
    expect(workflow).toContain('20260922113000_0384_field_sales_project_customers.sql');
    expect(workflow).toContain('20260924180000_0388_field_sales_location_quality.sql');
    expect(workflow).toContain('Pin the running voice sidecar for app-only release');
    expect(workflow).toContain('reuse-existing');
    expect(workflow).toContain('field-voice.override.yml');
    expect(workflow).toContain('https://crm.techspothub.com/api/v1/health');
    expect(workflow).toContain("failure() && steps.deploy_app.outcome == 'success'");
    expect(workflow).toContain("'$destination/rollback.sh'");
    expect(deploy).not.toContain('https://crm.techspothub.com');
    expect(rollback).toContain('previous-app.txt');
    expect(rollback).toContain('docker compose -f docker-compose.prod.yml');
    expect(deploy).toContain('voice_healthy');
    expect(deploy).toContain('trap rollback EXIT');
    expect(rollback).toContain('new-voice-container.txt');
  });
});
