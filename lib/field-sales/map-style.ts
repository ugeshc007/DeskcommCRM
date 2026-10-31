import type { StyleSpecification } from 'maplibre-gl';

/** Protomaps v4 geometry. Assets stay on this installation; no remote map requests. */
export function fieldMapStyle(tile: string | null | undefined, origin: string, archive?: { minZoom: number; maxZoom: number; minLon: number; minLat: number; maxLon: number; maxLat: number } | null): StyleSpecification {
  if (!tile) return { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#edf2ee' } }] };
  const url = new URL(tile, origin).toString();
  if (!tile.endsWith('.pmtiles')) return { version: 8, sources: { basemap: { type: 'raster', tiles: [url], tileSize: 256 } }, layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }] };
  return { version: 8, 'font-faces': { 'Field Map Sans': [{ url: new URL('/fonts/field-map/NotoSans.ttf', origin).toString() }] },
    sources: { basemap: { type: 'vector', tiles: [`${url}/{z}/{x}/{y}`],
    ...(archive ? { minzoom: archive.minZoom, maxzoom: archive.maxZoom, bounds: [archive.minLon, archive.minLat, archive.maxLon, archive.maxLat] as [number, number, number, number] } : {}) } }, layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#eae6dc' } },
    { id: 'landuse', type: 'fill', source: 'basemap', 'source-layer': 'landuse', paint: { 'fill-color': '#dce6d4', 'fill-opacity': 0.6 } },
    { id: 'water', type: 'fill', source: 'basemap', 'source-layer': 'water', filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': '#afd4e8' } },
    { id: 'buildings', type: 'fill', source: 'basemap', 'source-layer': 'buildings', minzoom: 13, paint: { 'fill-color': '#c9c4b9', 'fill-outline-color': '#b3aea5' } },
    { id: 'roads-casing', type: 'line', source: 'basemap', 'source-layer': 'roads', paint: { 'line-color': '#8e8b82', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.8, 15, 5] } },
    { id: 'roads', type: 'line', source: 'basemap', 'source-layer': 'roads', paint: { 'line-color': '#fffdf6', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.4, 15, 3] } },
    { id: 'boundaries', type: 'line', source: 'basemap', 'source-layer': 'boundaries', paint: { 'line-color': '#878799', 'line-width': 1, 'line-dasharray': [3, 3] } },
    { id: 'place-names', type: 'symbol', source: 'basemap', 'source-layer': 'places',
      layout: { 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': ['Field Map Sans'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 5, 11, 15, 15], 'text-max-width': 10,
        'symbol-sort-key': ['coalesce', ['get', 'sort_rank'], 1000] },
      paint: { 'text-color': '#263b33', 'text-halo-color': '#fffdf7', 'text-halo-width': 1.8 } },
    { id: 'road-names', type: 'symbol', source: 'basemap', 'source-layer': 'roads', minzoom: 10,
      filter: ['has', 'name'], layout: { 'symbol-placement': 'line', 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
        'text-font': ['Field Map Sans'], 'text-size': 11, 'text-padding': 4 },
      paint: { 'text-color': '#3b3833', 'text-halo-color': '#fffdf7', 'text-halo-width': 1.8 } },
    { id: 'shop-and-landmark-names', type: 'symbol', source: 'basemap', 'source-layer': 'pois', minzoom: 15,
      filter: ['has', 'name'], layout: { 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']],
        'text-font': ['Field Map Sans'], 'text-size': 12, 'text-max-width': 9,
        'text-optional': true }, paint: { 'text-color': '#243d4a', 'text-halo-color': '#fffdf7', 'text-halo-width': 1.8 } },
  ] };
}
