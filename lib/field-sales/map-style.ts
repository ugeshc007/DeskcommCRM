import type { StyleSpecification } from 'maplibre-gl';

/** Protomaps v4 geometry. Assets stay on this installation; no remote map requests. */
export function fieldMapStyle(tile: string | null | undefined, origin: string): StyleSpecification {
  if (!tile) return { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#edf2ee' } }] };
  const url = new URL(tile, origin).toString();
  if (!tile.endsWith('.pmtiles')) return { version: 8, sources: { basemap: { type: 'raster', tiles: [url], tileSize: 256 } }, layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }] };
  return { version: 8, 'font-faces': { 'Noto Sans Regular': [{ url: '/fonts/field-map/NotoSans.ttf' }] }, sources: { basemap: { type: 'vector', url: `pmtiles://${url}` } }, layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#eae6dc' } },
    { id: 'landuse', type: 'fill', source: 'basemap', 'source-layer': 'landuse', paint: { 'fill-color': '#dce6d4', 'fill-opacity': 0.6 } },
    { id: 'water', type: 'fill', source: 'basemap', 'source-layer': 'water', filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': '#afd4e8' } },
    { id: 'buildings', type: 'fill', source: 'basemap', 'source-layer': 'buildings', minzoom: 13, paint: { 'fill-color': '#c9c4b9', 'fill-outline-color': '#b3aea5' } },
    { id: 'roads-casing', type: 'line', source: 'basemap', 'source-layer': 'roads', paint: { 'line-color': '#aaa497', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 15, 5] } },
    { id: 'roads', type: 'line', source: 'basemap', 'source-layer': 'roads', paint: { 'line-color': '#fffdf6', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.2, 15, 3] } },
    { id: 'boundaries', type: 'line', source: 'basemap', 'source-layer': 'boundaries', paint: { 'line-color': '#878799', 'line-width': 1, 'line-dasharray': [3, 3] } },
    { id: 'road-labels', type: 'symbol', source: 'basemap', 'source-layer': 'roads', minzoom: 13,
      layout: { 'symbol-placement': 'line', 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': ['Noto Sans Regular'], 'text-size': 11 },
      paint: { 'text-color': '#444444', 'text-halo-color': '#ffffff', 'text-halo-width': 1 } },
    { id: 'place-labels', type: 'symbol', source: 'basemap', 'source-layer': 'places',
      layout: { 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': ['Noto Sans Regular'], 'text-size': 13 },
      paint: { 'text-color': '#333333', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 } },
  ] };
}
