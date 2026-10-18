import { describe, expect, it } from 'vitest';
import { routeColor, routeDash } from './route-colors';

describe('field route styles', () => {
  it('gives a large team distinct colors without depending on roster order', () => {
    const colors = Array.from({ length: 100 }, (_, index) => routeColor(index));
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('alternates line patterns in addition to color', () => {
    expect(routeDash(0)).toBeUndefined();
    expect(routeDash(1)).toEqual([3, 2]);
    expect(routeDash(2)).toEqual([1, 2]);
    expect(routeDash(3)).toEqual([5, 2, 1, 2]);
  });
});
