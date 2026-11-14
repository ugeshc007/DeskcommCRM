import { describe, expect, it } from 'vitest';
import { nearbyPlace } from '@/lib/field-sales/nearby-place';

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
});
