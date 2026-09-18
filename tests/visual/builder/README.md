# Local builder visual verification

Run from the repository root:

```sh
node node_modules/vite/bin/vite.js --config tests/visual/builder/vite.config.mts
```

Open `http://127.0.0.1:4317`. This renders the real editor with synthetic data and
in-memory flow API responses. Save/publish in this fixture never reaches the CRM,
never persists customer data and never sends a message. Reload resets the fixture.
No environment files are loaded by this Vite configuration.

`/integrations` previews the real integration gallery with one synthetic connection.
API responses are fixtures: do not interpret a fixture save/test as backend proof.
The builder can select that synthetic connection to inspect its mapping fields.

`/store` previews the real draft store installer with synthetic region/channel data.
Run Vite with `--port 4318`, then `node tests/visual/builder/store-check.mjs` for
delivery preview, desktop/mobile and draft receipt checks. The fixture POST does
not install anything in a database; database transaction tests are separate.

Check desktop and 390 × 844 mobile: library search/categories, click/drag creation,
node settings, media file picker, duplicate, confirmed deletion, undo/redo, save
feedback, and layout overflow. Restore the normal viewport after testing.

Uploads are **not** mocked into success here. Use the API/editor unit tests for
multipart parsing, ownership, upload progress/error behavior and worker retries.
Authenticated upload/save/reload and actual channel delivery need a separate
disposable E2E environment; this harness does not replace those release gates.
