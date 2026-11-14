/** Approximate nearby label from the installed basemap, not an address or administrative boundary. */
export function nearbyPlace(features: Array<{ geometry?: { type?: string; coordinates?: unknown }; properties?: Record<string, unknown> | null }>, latitude: number, longitude: number) {
  let nearest: { name: string; kind: string; distance: number } | null = null;
  for (const feature of features) {
    const coordinates = feature.geometry?.coordinates;
    if (feature.geometry?.type !== 'Point' || !Array.isArray(coordinates)) continue;
    const [lon, lat] = coordinates;
    if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const name = feature.properties?.['name:en'] ?? feature.properties?.name;
    const kind = feature.properties?.kind;
    if (typeof name !== 'string' || !name.trim() || typeof kind !== 'string') continue;
    if (!['neighbourhood', 'neighborhood', 'macrohood', 'locality'].includes(kind)) continue;
    const radians = Math.PI / 180;
    const deltaLat = (lat - latitude) * radians, deltaLon = (lon - longitude) * radians;
    const arc = Math.sin(deltaLat / 2) ** 2 + Math.cos(latitude * radians) * Math.cos(lat * radians) * Math.sin(deltaLon / 2) ** 2;
    const distance = 12742 * Math.asin(Math.min(1, Math.sqrt(arc)));
    if (distance > (kind === 'locality' ? 20 : 3)) continue;
    if (!nearest || distance < nearest.distance) nearest = { name: name.trim(), kind, distance };
  }
  return nearest ? `Near ${nearest.name}${nearest.kind === 'locality' ? ' (city)' : ' (area)'}` : null;
}
