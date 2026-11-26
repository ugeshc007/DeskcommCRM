import path from 'node:path';
import { defineConfig } from '@playwright/test';

// Focused smoke against a separately started loopback-only dev app. The
// source checkout must be supplied explicitly; never fall back to production.
const envRoot = process.env.FIELD_LOCAL_ENV_ROOT;
if (!envRoot) throw new Error('FIELD_LOCAL_ENV_ROOT is required for local Field Sales smoke');
const nextRoot = path.dirname(require.resolve('next/package.json'));
// Playwright loads this config as CommonJS; resolve Next's private dependency from its package.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { loadEnvConfig } = require(require.resolve('@next/env', { paths: [nextRoot] })) as {
  loadEnvConfig: (dir: string, dev?: boolean) => void;
};
loadEnvConfig(envRoot, true);

for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_DB_URL']) {
  const value = process.env[key];
  if (!value || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(value).hostname)) {
    throw new Error(`Local Field Sales smoke requires ${key} to point to localhost`);
  }
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Local service role is missing');
const port = process.env.E2E_PORT || '3005';
if (!/^\d{4,5}$/.test(port)) throw new Error('Invalid local E2E port');
const baseURL = `http://127.0.0.1:${port}`;
process.env.NEXT_PUBLIC_APP_URL = baseURL;

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  retries: 0,
  use: { baseURL, browserName: 'chromium', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
