import { afterEach, describe, expect, it, vi } from 'vitest';
import { nearbyPlace } from '@/lib/field-sales/nearby-place';
import { nearbyPlaceFromTiles, surroundingTiles } from '@/lib/field-sales/nearby-place-tiles';
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
