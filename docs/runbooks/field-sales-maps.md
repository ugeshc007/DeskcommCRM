# Field Sales: self-hosted map assets

The UAE pilot uses a self-hosted Protomaps v4 archive. A Google Maps API key is not needed.
Map tiles do not improve the phone's GPS accuracy. If an indoor position appears across the
street, check the Android app's precise-location permission, enable the phone's location
and Wi-Fi scanning, and compare fixes briefly outdoors. The manager map shows uncertainty
and may omit a route when the phone cannot provide credible movement. Do not interpret a
pin as proof that the officer entered a particular building.
For an open work session, the map retains the last non-mock fix reported within 100 m
accuracy even when a newer upload is less precise or untrusted. An orange pin means the latest
upload was rejected for display; its popup and officer card show the reliable fix's timestamp.
The pin is a last known area, not proof of the officer's present position. Punch-out
removes the pin; raw location history is preserved within the retention period.

The app can serve licensed raster XYZ tiles from an absolute directory configured by
`FIELD_MAP_TILES_DIR`. Supply a read-only runtime volume outside the repository and
container image; no employee positions belong in this directory. Preserve the current
deployment proxy configuration when adding a volume. Do not replace other hosted services.

Expected layout: `<directory>/uae/<z>/<x>/<y>.png` (JPEG and WebP also supported).
Alternatively install a Protomaps v4 vector archive as `<directory>/uae.pmtiles` and use
`/field-map-tiles/uae.pmtiles`. The server serves authenticated, bounded XYZ extracts
from the archive. MapLibre's worker and shared module are copied from the installed
package before dev/build and served from `/maplibre/`; both files are required or the
map mounts but never requests tiles. The whole archive is never returned in one request.
Existing raster configurations remain valid.
In Field Sales → Live view → Self-hosted basemap, enter either
`/field-map-tiles/uae.pmtiles` or `/field-map-tiles/uae/{z}/{x}/{y}.png` and the
dataset's required attribution.
The map already displays the OpenStreetMap copyright link; preserve source attribution.

Only authenticated CRM staff can request tiles. Requests are local file reads: no Google
API, address lookup, paid routing or external fallback. Missing tiles return a visible map
error. The server accepts zoom 0–22, valid tile coordinates, raster files up to 1 MiB
and vector extracts up to 2 MiB.
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
