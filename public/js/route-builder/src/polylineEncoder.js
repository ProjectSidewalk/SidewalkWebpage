/**
 * Google Encoded Polyline Algorithm (precision 5) helpers, matching the backend's PolylineEncoder. These feed the
 * static-map thumbnail URLs for guest-saved routes, whose geometry only exists client-side.
 */

/**
 * Encodes a sequence of [lng, lat] coordinates as a polyline string.
 *
 * @param {Array<Array<number>>} coords - Coordinates as [longitude, latitude] pairs, in path order.
 * @returns {string} The encoded polyline (empty for no coordinates).
 */
function encodePolyline(coords) {
  let out = '';
  let prevLat = 0;
  let prevLng = 0;
  const encodeDiff = (diff) => {
    let v = diff < 0 ? ~(diff * 2) : diff * 2;
    let chunk = '';
    while (v >= 0x20) {
      chunk += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    return chunk + String.fromCharCode(v + 63);
  };
  coords.forEach(([lng, lat]) => {
    const lat5 = Math.round(lat * 1e5);
    const lng5 = Math.round(lng * 1e5);
    out += encodeDiff(lat5 - prevLat) + encodeDiff(lng5 - prevLng);
    prevLat = lat5;
    prevLng = lng5;
  });
  return out;
}

/**
 * Thins a coordinate sequence to at most maxPoints, always keeping the first and last points — thumbnails are
 * tiny, and the polyline rides in a URL.
 *
 * @param {Array<Array<number>>} coords - [lng, lat] pairs.
 * @param {number} maxPoints
 * @returns {Array<Array<number>>}
 */
function decimateCoords(coords, maxPoints) {
  if (coords.length <= maxPoints) return coords;
  const step = Math.ceil(coords.length / (maxPoints - 1));
  return coords.filter((c, i) => i % step === 0).concat([coords[coords.length - 1]]);
}
