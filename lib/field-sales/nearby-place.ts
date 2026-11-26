/** Approximate nearby label from the installed basemap, not an address or administrative boundary. */
export type PlaceFeature = { geometry?: { type?: string; coordinates?: unknown }; properties?: Record<string, unknown> | null };

// Verified local aliases for archive features without a Latin name (e.g. Arada's Aljada).
const englishPlaceAliases: Record<string, string> = { 'الجادة': 'Aljada' };

/** Prefer mapped English names; a Latin-script local name is useful when no translation exists. */
export function englishMapName(properties: Record<string, unknown> | null | undefined) {
  for (const key of ['name:en', 'name:latin', 'int_name', 'name']) {
    const value = properties?.[key];
    if (typeof value === 'string' && /[A-Za-z]/u.test(value) && !/\p{Script=Arabic}/u.test(value)) {
      return value.trim() || null;
    }
  }
  const local = properties?.name;
  return typeof local === 'string' ? englishPlaceAliases[local.trim()] ?? null : null;
}

export function nearbyPlace(features: PlaceFeature[], latitude: number, longitude: number,
  options: { englishOnly?: boolean; maxCityDistanceKm?: number } = {}) {
  let nearestArea: { name: string; distance: number } | null = null;
  let nearestCity: { name: string; distance: number } | null = null;
  for (const feature of features) {
    const coordinates = feature.geometry?.coordinates;
    if (feature.geometry?.type !== 'Point' || !Array.isArray(coordinates)) continue;
    const [lon, lat] = coordinates;
    if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const name = options.englishOnly ? englishMapName(feature.properties) : feature.properties?.['name:en'] ?? feature.properties?.name;
    const kind = feature.properties?.kind;
    if (typeof name !== 'string' || !name.trim() || typeof kind !== 'string') continue;
    if (!['neighbourhood', 'neighborhood', 'macrohood', 'locality'].includes(kind)) continue;
    const radians = Math.PI / 180;
    const deltaLat = (lat - latitude) * radians, deltaLon = (lon - longitude) * radians;
    const arc = Math.sin(deltaLat / 2) ** 2 + Math.cos(latitude * radians) * Math.cos(lat * radians) * Math.sin(deltaLon / 2) ** 2;
    const distance = 12742 * Math.asin(Math.min(1, Math.sqrt(arc)));
    if (kind === 'locality') {
      if (distance <= (options.maxCityDistanceKm ?? 50) && (!nearestCity || distance < nearestCity.distance)) nearestCity = { name: name.trim(), distance };
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

/** A nearby mapped road is an approximate reference, not proof of the road travelled. */
export function nearbyEnglishRoad(features: PlaceFeature[], latitude: number, longitude: number) {
  let nearest: { name: string; metres: number } | null = null;
  const radians = Math.PI / 180, east = Math.cos(latitude * radians) * 111_320, north = 111_320;
  for (const feature of features) {
    const name = englishMapName(feature.properties);
    if (!name || !['LineString', 'MultiLineString'].includes(feature.geometry?.type ?? '')) continue;
    const lines = feature.geometry?.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry?.coordinates;
    if (!Array.isArray(lines)) continue;
    for (const line of lines) {
      if (!Array.isArray(line)) continue;
      for (let index = 1; index < line.length; index++) {
        const a = line[index - 1], b = line[index];
        if (!Array.isArray(a) || !Array.isArray(b) || ![a[0], a[1], b[0], b[1]].every(value => typeof value === 'number' && Number.isFinite(value))) continue;
        const ax = (a[0] - longitude) * east, ay = (a[1] - latitude) * north;
        const bx = (b[0] - longitude) * east, by = (b[1] - latitude) * north;
        const lengthSquared = (bx - ax) ** 2 + (by - ay) ** 2;
        const position = lengthSquared ? Math.max(0, Math.min(1, -(ax * (bx - ax) + ay * (by - ay)) / lengthSquared)) : 0;
        const metres = Math.hypot(ax + position * (bx - ax), ay + position * (by - ay));
        if (metres <= 60 && (!nearest || metres < nearest.metres)) nearest = { name, metres };
      }
    }
  }
  return nearest ? `Near ${nearest.name} (road)` : null;
}
