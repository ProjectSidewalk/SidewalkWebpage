/**
 * Prev/next navigation over the map's loaded labels for the label popup (#4572): "next" greedily walks to the
 * nearest label not yet visited this page-load (touring along a street and outward), "prev" retraces the visited
 * trail. Operates on the same in-memory GeoJSON features the map layers draw, so paging costs no requests.
 *
 * @param {Object} mapData The map layer tracker returned by addLabelsToMap (reads .sortedLabels).
 * @returns {{next: function(number): ?number, prev: function(number): ?number, hasPrev: function(number): boolean}}
 *     Navigator whose methods take the currently shown label ID and return the label ID to show (null when there
 *     is nowhere to go).
 */
function createNearbyLabelNavigator(mapData) {
  // label_id -> [lng, lat] for every label on the map, flattened across types.
  const coordsById = new Map();
  for (const features of Object.values(mapData.sortedLabels)) {
    for (const f of features) coordsById.set(f.properties.label_id, f.geometry.coordinates);
  }

  const trail = [];         // Visited label IDs in visit order; backs prev().
  const visited = new Set(); // next() never revisits, so repeated clicks tour outward instead of ping-ponging.

  /**
   * Squared equirectangular distance — plenty for ranking nearby points.
   * @param {Array<number>} a [lng, lat]
   * @param {Array<number>} b [lng, lat]
   * @returns {number}
   */
  const dist2 = (a, b) => {
    const kx = Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180));
    const dx = (a[0] - b[0]) * kx;
    const dy = a[1] - b[1];
    return dx * dx + dy * dy;
  };

  return {
    next(currentId) {
      const here = coordsById.get(currentId);
      if (!here) return null;
      visited.add(currentId);
      if (trail[trail.length - 1] !== currentId) trail.push(currentId);
      let best = null;
      let bestD = Infinity;
      for (const [id, coords] of coordsById) {
        if (visited.has(id)) continue;
        const d = dist2(here, coords);
        if (d < bestD) {
          bestD = d;
          best = id;
        }
      }
      return best;
    },
    prev(currentId) {
      if (trail.length && trail[trail.length - 1] === currentId) trail.pop();
      return trail.length ? trail[trail.length - 1] : null;
    },
    hasPrev(currentId) {
      return trail.length > (trail[trail.length - 1] === currentId ? 1 : 0);
    },
    getCoords(labelId) {
      return coordsById.get(labelId) ?? null;
    },
  };
}
