import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { readVectorTile } from './map-tiles';
import { nearbyEnglishRoad, nearbyPlace, type PlaceFeature } from './nearby-place';
import { surroundingTiles, tileForPoint } from './nearby-place-tiles';

type Fix = { latitude: number | string; longitude: number | string; accuracy_m: number | string;
  mock_location: boolean; quality_flags?: string[] | null };
type Tile = { z: number; x: number; y: number };
type ReadTile = (tile: Tile) => Promise<Uint8Array>;

/** Names come only from the administrator-installed archive; no employee coordinates leave this server. */
export async function locationPlaceLabels(root: string | undefined, archivePath: string | null | undefined,
  points: Fix[], readTileOverride?: ReadTile): Promise<Array<string | null>> {
  const match = /^\/field-map-tiles\/([a-z0-9][a-z0-9_-]{0,79}\.pmtiles)$/.exec(archivePath ?? '');
  if ((!root && !readTileOverride) || !match) return points.map(() => null);
  const archive = match[1]!;
  const readTile = readTileOverride ?? ((tile: Tile) => readVectorTile(root!, [archive, String(tile.z), String(tile.x), String(tile.y)]));
  const cache = new Map<string, Promise<PlaceFeature[]>>();
  async function features(tile: Tile, layerName: 'roads' | 'places') {
    const key = `${tile.z}/${tile.x}/${tile.y}/${layerName}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const loading = (async () => {
      const vector = new VectorTile(new PbfReader(await readTile(tile)));
      const layer = vector.layers[layerName];
      if (!layer) return [];
      const result: PlaceFeature[] = [];
      for (let index = 0; index < layer.length; index++) {
        const feature = layer.feature(index);
        if (feature.type !== (layerName === 'places' ? 1 : 2)) continue;
        const geometry = feature.toGeoJSON(tile.x, tile.y, tile.z).geometry;
        result.push({ geometry, properties: feature.properties });
      }
      return result;
    })().catch(() => []);
    cache.set(key, loading);
    if (cache.size > 256) cache.delete(cache.keys().next().value!);
    return loading;
  }
  async function label(point: Fix) {
    const latitude = Number(point.latitude), longitude = Number(point.longitude), accuracy = Number(point.accuracy_m);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 85 || Math.abs(longitude) > 180) return null;
    // A wide or flagged fix cannot reliably identify the closest street.
    if (!point.mock_location && !(point.quality_flags?.length) && accuracy <= 35) {
      const road = nearbyEnglishRoad(await features(tileForPoint(latitude, longitude, 14), 'roads'), latitude, longitude);
      if (road) return road;
    }
    for (const zoom of [12, 9]) {
      const mapped = (await Promise.all(surroundingTiles(latitude, longitude, zoom)
        .map(tile => features(tile, 'places')))).flat();
      const area = nearbyPlace(mapped, latitude, longitude, { englishOnly: true, maxCityDistanceKm: 5 });
      if (area) return area;
    }
    return null;
  }
  const labels: Array<string | null> = new Array(points.length).fill(null);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(4, points.length) }, async () => {
    while (cursor < points.length) {
      const index = cursor++;
      labels[index] = await label(points[index]!);
    }
  }));
  return labels;
}
