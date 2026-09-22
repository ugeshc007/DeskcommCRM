import { describe, expect, it } from 'vitest';
import { fieldMapStyle } from './map-style';

describe('fieldMapStyle', () => {
  it('loads self-hosted PMTiles by XYZ and keeps the archive bounds', () => {
    const style = fieldMapStyle('/field-map-tiles/uae.pmtiles', 'https://crm.example.test', {
      minZoom: 0, maxZoom: 15, minLon: 51, minLat: 22, maxLon: 57, maxLat: 26.5,
    });
    expect(style.sources.basemap).toMatchObject({
      type: 'vector',
      tiles: ['https://crm.example.test/field-map-tiles/uae.pmtiles/{z}/{x}/{y}'],
      minzoom: 0, maxzoom: 15, bounds: [51, 22, 57, 26.5],
    });
    expect(style.layers.map(layer => layer.id)).toEqual(expect.arrayContaining(['place-names', 'road-names', 'shop-and-landmark-names']));
    expect(style['font-faces']).toEqual({ 'Field Map Sans': [{ url: 'https://crm.example.test/fonts/field-map/NotoSans.ttf' }] });
    expect(style.layers.filter(layer => layer.type === 'symbol').every(layer => layer.layout?.['text-font']?.[0] === 'Field Map Sans')).toBe(true);
    expect(style).not.toHaveProperty('glyphs'); // Font and tiles are both served by this installation.
  });
});
