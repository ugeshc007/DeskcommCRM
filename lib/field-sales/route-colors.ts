/** Stored per-officer index: adding or renaming a colleague never changes an existing route. */
export function routeColor(styleIndex: number): string {
  const hue = Number(((styleIndex * 137.508) % 360).toFixed(3));
  const lightness = [38, 44, 32][styleIndex % 3];
  return `hsl(${hue}, 78%, ${lightness}%)`;
}

/** Shape complements color when many paths overlap or colors are hard to distinguish. */
export function routeDash(styleIndex: number): number[] | undefined {
  const patterns = [undefined, [3, 2], [1, 2], [5, 2, 1, 2]];
  return patterns[styleIndex % patterns.length];
}
