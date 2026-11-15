import { nearbyPlace, type PlaceFeature } from './nearby-place';

const tileCache = new Map<string, Promise<PlaceFeature[]>>();
const maxCachedTiles = 128;

export function surroundingTiles(latitude: number, longitude: number, zoom: number) {
  const size = 2 ** zoom;
  const lat = Math.max(-85.05112878, Math.min(85.05112878, latitude));
  const x = Math.floor((longitude + 180) / 360 * size);
  const radians = lat * Math.PI / 180;
  const y = Math.floor((1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * size);
  const tiles: Array<{ z: number; x: number; y: number }> = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const tileX = x + dx, tileY = y + dy;
    if (tileX >= 0 && tileX < size && tileY >= 0 && tileY < size) tiles.push({ z: zoom, x: tileX, y: tileY });
  }
  return tiles;
}

async function readPlaces(url: string, x: number, y: number, z: number): Promise<PlaceFeature[]> {
  const cached = tileCache.get(url);
  if (cached) return cached;
  const reading = (async () => {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) return [];
    const [{ VectorTile }, { PbfReader }] = await Promise.all([import('@mapbox/vector-tile'), import('pbf')]);
    const tile = new VectorTile(new PbfReader(new Uint8Array(await response.arrayBuffer())));
    const layer = tile.layers.places;
    if (!layer) return [];
    const features: PlaceFeature[] = [];
    for (let index = 0; index < layer.length; index++) {
      const feature = layer.feature(index);
      if (feature.type !== 1) continue;
      const geometry = feature.toGeoJSON(x, y, z).geometry;
      if (geometry.type === 'Point') features.push({ geometry, properties: feature.properties });
    }
    return features;
  })().catch(() => []);
  tileCache.set(url, reading);
  if (tileCache.size > maxCachedTiles) tileCache.delete(tileCache.keys().next().value!);
  return reading;
}

/** Look up nearby labels in the installed archive, including tiles outside the current viewport. */
export async function nearbyPlaceFromTiles(archivePath: string, origin: string, latitude: number, longitude: number) {
  if (!archivePath.endsWith('.pmtiles') || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const base = new URL(archivePath, origin);
  if (base.origin !== origin) return null;
  for (const zoom of [12, 9]) {
    const features = (await Promise.all(surroundingTiles(latitude, longitude, zoom).map(tile => {
      const url = `${base.toString()}/${tile.z}/${tile.x}/${tile.y}`;
      return readPlaces(url, tile.x, tile.y, tile.z);
    }))).flat();
    const place = nearbyPlace(features, latitude, longitude);
    if (place) return place;
  }
  return null;
}
