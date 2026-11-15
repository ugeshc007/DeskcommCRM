/** Approximate nearby label from the installed basemap, not an address or administrative boundary. */
export type PlaceFeature = { geometry?: { type?: string; coordinates?: unknown }; properties?: Record<string, unknown> | null };

export function nearbyPlace(features: PlaceFeature[], latitude: number, longitude: number) {
  let nearestArea: { name: string; distance: number } | null = null;
  let nearestCity: { name: string; distance: number } | null = null;
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
    if (kind === 'locality') {
      if (distance <= 50 && (!nearestCity || distance < nearestCity.distance)) nearestCity = { name: name.trim(), distance };
    } else if (distance <= (kind === 'macrohood' ? 8 : 3) && (!nearestArea || distance < nearestArea.distance)) {
      nearestArea = { name: name.trim(), distance };
    }
  }
  if (nearestArea) return `Near ${nearestArea.name} (area)`;
  if (nearestCity) return nearestCity.distance <= 5
    ? `Near ${nearestCity.name} (city)`
    : `Nearest mapped city: ${nearestCity.name} (about ${Math.round(nearestCity.distance)} km away)`;
  return null;
}
