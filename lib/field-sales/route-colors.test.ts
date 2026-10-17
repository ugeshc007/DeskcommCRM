import { describe, expect, it } from 'vitest';
import { routeColor } from './route-colors';

describe('field route colors', () => {
  it('keeps each officer distinct and stable when the team order changes', () => {
    const ids = Array.from({ length: 25 }, (_, index) => `officer-${String(index).padStart(2, '0')}`);
    const colors = ids.map(id => routeColor(id, ids));
    expect(new Set(colors).size).toBe(ids.length);
    expect(ids.map(id => routeColor(id, [...ids].reverse()))).toEqual(colors);
  });
});
