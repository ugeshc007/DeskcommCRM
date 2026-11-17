/** Open one recorded coordinate in Google Maps without requesting place details. */
export function googleMapsPointUrl(latitude: number | string, longitude: number | string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`;
}
