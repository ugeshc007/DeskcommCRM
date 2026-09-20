# Field Sales: self-hosted map assets

Development implementation; a UAE archive has been downloaded and verified locally. No live dataset has been provisioned yet.

The app can serve licensed raster XYZ tiles from an absolute directory configured by
`FIELD_MAP_TILES_DIR`. Supply a read-only runtime volume outside the repository and
container image; no employee positions belong in this directory. Preserve the current
deployment proxy configuration when adding a volume. Do not replace other hosted services.

Expected layout: `<directory>/uae/<z>/<x>/<y>.png` (JPEG and WebP also supported).
Alternatively install a Protomaps v4 vector archive as `<directory>/uae.pmtiles` and use
`/field-map-tiles/uae.pmtiles`. Authenticated, bounded HTTP range reads serve the archive;
the whole file is never returned in one request. Road and place labels use a bundled
OFL-licensed Noto Sans font, not a remote font provider. Existing raster configurations remain valid.
In Field Sales → Map, visits & approvals → Self-hosted basemap, enter
`/field-map-tiles/uae/{z}/{x}/{y}.png` and the dataset's required attribution.
The map already displays the OpenStreetMap copyright link; preserve source attribution.

Only authenticated CRM staff can request tiles. Requests are local file reads: no Google
API, address lookup, paid routing or external fallback. Missing tiles return a visible map
error. The server accepts zoom 0–22, valid tile coordinates, and raster files up to 1 MiB.
Directory traversal, remote URLs, SVG and symlinks escaping the configured root are rejected.
The volume must not be writable by tenants; administrator-owned assets are required.

Before rollout, obtain an appropriately licensed dataset, confirm coverage/zoom/size and
available server capacity, mount it read-only and test known sites at street zoom. Do not
bulk-download public tile servers. Hosting has disk/bandwidth/maintenance costs even when
there is no per-request Google API bill. This endpoint does not generate maps or license
third-party data. Deployment of the app alone does not complete map hosting.

Local dataset evidence (2026-09-19): `20260918.pmtiles` from the Protomaps daily build,
regional extraction bounds 51,22,57,26.5, zoom 0–15, approximately 130 MB. The extraction
completed and `pmtiles verify` passed. Attribution: Protomaps, © OpenStreetMap contributors.
This UAE coverage is not worldwide coverage; install the appropriate archive for another
country. Each organization selects its installed dataset independently.
