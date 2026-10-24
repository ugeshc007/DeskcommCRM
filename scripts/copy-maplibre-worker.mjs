import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

// MapLibre's worker imports its sibling ESM module. Next/Turbopack does not
// preserve that sibling when it hashes a new URL(import.meta.url) asset.
const require = createRequire(import.meta.url);
const dist = path.join(path.dirname(require.resolve('maplibre-gl/package.json')), 'dist');
const destination = path.join(process.cwd(), 'public', 'maplibre');
mkdirSync(destination, { recursive: true });
for (const name of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
  copyFileSync(path.join(dist, name), path.join(destination, name));
}
