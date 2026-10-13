// The same visible team receives the same distinct colors in maps and staff lists.
const ROUTE_COLORS = [
  '#1d4ed8', '#b91c1c', '#15803d', '#7e22ce', '#c2410c', '#0e7490',
  '#be185d', '#854d0e', '#4338ca', '#0f766e', '#a21caf', '#374151',
] as const;

export function routeColor(employeeId: string, employeeIds: string[]) {
  const index = [...new Set(employeeIds)].sort().indexOf(employeeId);
  if (index < 0) return ROUTE_COLORS[0];
  if (index < ROUTE_COLORS.length) return ROUTE_COLORS[index];
  const extra = index - ROUTE_COLORS.length;
  return `hsl(${Math.round((extra * 137.508 + 25) % 360)}, 75%, ${extra % 2 ? 34 : 43}%)`;
}
