/**
 * Rolls edge scores up the way the server does, so a street's number under a reader's own weights is comparable with
 * the one the page opened with. The JS twin of `AccessScoreSpotlight.stretchScore` and
 * `AccessScoreCalculator.scoreRegion`.
 *
 * What this doesn't do is re-decide which stretch of a way a section shows, or which streets are ranked: those stay the
 * server's. A section's map, cards and anchor stay put while its number moves.
 */

/**
 * @param {Array<{score: number, length: number}>} edges - The scored edges of a stretch.
 * @returns {?number} Weighted by length where there is any, a plain mean where every edge is zero-length, null with no
 *   edges.
 */
export function stretchScore(edges) {
  if (edges.length === 0) return null;
  const weight = edges.reduce((sum, e) => sum + Math.max(0, e.length), 0);
  if (weight > 0) return edges.reduce((sum, e) => sum + e.score * Math.max(0, e.length), 0) / weight;
  return edges.reduce((sum, e) => sum + e.score, 0) / edges.length;
}

/**
 * @param {Array<{score: number, length: number}>} edges - The audited streets of a region.
 * @returns {?number} The length-weighted mean, or null when there's no length to weigh by.
 */
export function regionScore(edges) {
  const total = edges.reduce((sum, e) => sum + e.length, 0);
  if (total <= 0) return null;
  return edges.reduce((sum, e) => sum + e.score * e.length, 0) / total;
}

/**
 * @param {Array<{wayId: number, score: ?number}>} streets - The streets with their new numbers, in their current order.
 * @returns {number[]} The ways, lowest score first; a street with no score goes last, and a tie keeps its place.
 */
export function rankWays(streets) {
  return streets
    .map((street, index) => ({ ...street, index }))
    .sort((a, b) => (a.score ?? Infinity) - (b.score ?? Infinity) || a.index - b.index)
    .map((street) => street.wayId);
}
