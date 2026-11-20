import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const resolve = createRequire(import.meta.url).resolve;
const envRoot = process.argv[2];
const port = process.argv[3] || '3005';
if (!envRoot || !/^\d{4,5}$/.test(port)) throw new Error('Local environment root and port required');
const nextRoot = path.dirname(resolve('next/package.json'));
const envPath = resolve('@next/env', { paths: [nextRoot] });
const envModule = await import(pathToFileURL(envPath).href);
const { loadEnvConfig } = envModule.default ?? envModule;
loadEnvConfig(envRoot, true);
if (!process.env.NEXT_PUBLIC_SUPABASE_URL) throw new Error('Local Supabase configuration is missing');
for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL', 'SUPABASE_DB_URL']) {
  const value = process.env[key];
  if (!value) continue;
  const host = new URL(value).hostname;
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) throw new Error('Refusing non-local Supabase configuration');
}
// Invitation and callback links must point to this local dev server, not the
// port of another checkout whose environment file supplied the credentials.
process.env.NEXT_PUBLIC_APP_URL = `http://127.0.0.1:${port}`;
delete process.env.NODE_OPTIONS;
delete process.env.__NEXT_PROCESSED_ENV;
process.env.NEXT_TELEMETRY_DISABLED = '1';
process.env.SENTRY_DSN = 'off';
const server = spawn(process.execPath,
  [resolve('next/dist/bin/next'), 'dev', '-H', '127.0.0.1', '-p', port],
  { stdio: 'inherit', env: { ...process.env } });
server.on('exit', code => { process.exitCode = code ?? 1; });
