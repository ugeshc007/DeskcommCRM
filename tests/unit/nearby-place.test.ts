import { afterEach, describe, expect, it, vi } from 'vitest';
import { nearbyEnglishRoad, nearbyPlace } from '@/lib/field-sales/nearby-place';
import { nearbyPlaceFromTiles, surroundingTiles } from '@/lib/field-sales/nearby-place-tiles';
import { locationPlaceLabels } from '@/lib/field-sales/location-place-labels';
import { GeoJSONVT } from '@maplibre/geojson-vt';
import { fromGeojsonVt } from '@maplibre/vt-pbf';

afterEach(() => vi.unstubAllGlobals());

describe('local map place labels', () => {
  const place = (name: string, kind: string, longitude: number, latitude: number) => ({
    geometry: { type: 'Point', coordinates: [longitude, latitude] }, properties: { name, kind },
  });

  it('shows a nearby area without claiming a precise address', () => {
    expect(nearbyPlace([place('Deira', 'neighbourhood', 55.32, 25.27)], 25.27, 55.32)).toBe('Near Deira (area)');
  });

  it('does not use a distant place label', () => {
    expect(nearbyPlace([place('Deira', 'neighbourhood', 55.32, 25.27)], 24.0, 54.0)).toBeNull();
  });

  it('falls back to a city when there is no nearby area', () => {
    expect(nearbyPlace([place('Dubai', 'locality', 55.30, 25.24)], 25.25, 55.31)).toBe('Near Dubai (city)');
  });

  it('uses a city at a distance without claiming the employee is in that city', () => {
    expect(nearbyPlace([place('Dubai', 'locality', 55.30, 25.24)], 25.4, 55.45))
      .toMatch(/^Nearest mapped city: Dubai \(about \d+ km away\)$/);
  });

  it('prefers an English road near a reliable fix and uses an area for an imprecise fix', async () => {
    const source = new GeoJSONVT({ type: 'FeatureCollection', features: [
      { type: 'Feature', properties: { name: 'ديرة', 'name:en': 'Deira', kind: 'neighbourhood' },
        geometry: { type: 'Point', coordinates: [55.32, 25.27] } },
      { type: 'Feature', properties: { name: 'شارع السوق', 'name:en': 'Market Street' },
        geometry: { type: 'LineString', coordinates: [[55.319, 25.27], [55.321, 25.27]] } },
    ] });
    const readTile = async ({ z, x, y }: { z: number; x: number; y: number }) => {
      const tile = source.getTile(z, x, y);
      if (!tile) throw new Error('outside archive');
      const bytes = fromGeojsonVt({ places: tile, roads: tile });
      return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    };
    const fixes = [
      { latitude: 25.27, longitude: 55.32, accuracy_m: 8, mock_location: false, quality_flags: [] },
      { latitude: 25.27, longitude: 55.32, accuracy_m: 90, mock_location: false, quality_flags: [] },
    ];
    expect(await locationPlaceLabels('', '/field-map-tiles/uae.pmtiles', fixes, { readTile }))
      .toEqual(['Near Market Street (road)', 'Near Deira (area)']);
    expect(await locationPlaceLabels('', '/field-map-tiles/uae.pmtiles', fixes, { readTile, areaOnly: true }))
      .toEqual(['Near Deira (area)', 'Near Deira (area)']);
    expect(nearbyEnglishRoad([{ geometry: { type: 'LineString', coordinates: [[55.319, 25.27], [55.321, 25.27]] },
      properties: { name: 'شارع السوق' } }], 25.27, 55.32)).toBeNull();
  });

  it('does not invent an English label when the archive is absent', async () => {
    expect(await locationPlaceLabels(undefined, null, [{ latitude: 25.27, longitude: 55.32,
      accuracy_m: 8, mock_location: false }])).toEqual([null]);
    expect(nearbyPlace([place('ديرة', 'neighbourhood', 55.32, 25.27)], 25.27, 55.32,
      { englishOnly: true })).toBeNull();
  });

  it('reads a nearby area from an archive tile outside the visible map tiles', async () => {
    const source = new GeoJSONVT({ type: 'FeatureCollection', features: [{
      type: 'Feature', properties: { name: 'Deira', kind: 'neighbourhood' },
      geometry: { type: 'Point', coordinates: [55.32, 25.27] },
    }] });
    const requested: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      requested.push(url);
      const match = /\/(\d+)\/(\d+)\/(\d+)$/.exec(url)!;
      const tile = source.getTile(Number(match[1]), Number(match[2]), Number(match[3]));
      if (!tile) return { ok: false };
      const bytes = fromGeojsonVt({ places: tile });
      return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    }));
    expect(await nearbyPlaceFromTiles('/field-map-tiles/uae.pmtiles', 'https://crm.example.test', 25.27, 55.32))
      .toBe('Near Deira (area)');
    expect(requested).toHaveLength(9);
    expect(surroundingTiles(25.27, 55.32, 12)).toHaveLength(9);
  });
});
