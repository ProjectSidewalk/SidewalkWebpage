/**
 * Prev/next navigation over the map's loaded labels for the label popup (#4572): "next" greedily walks to the
 * nearest label not yet visited this page-load (touring along a street and outward), "prev" retraces the visited
 * trail. Operates on the same in-memory GeoJSON features the map layers draw, so paging costs no requests.
 *
 * @param {Object} mapData The map layer tracker returned by addLabelsToMap (reads .sortedLabels).
 * @returns {{next: function(number): ?number, prev: function(number): ?number, hasPrev: function(number): boolean,
 *     hasNext: function(number): boolean, getCoords: function(number): ?Array<number>,
 *     getLabelType: function(number): ?string}}
 *     Navigator whose paging methods take the currently shown label ID and return the label ID to show (null when
 *     there is nowhere to go); getCoords/getLabelType look up a loaded label's [lng, lat] / label type.
 */
function createNearbyLabelNavigator(mapData) {
  // label_id -> [lng, lat] and label_id -> label type for every label on the map, flattened across types.
  const coordsById = new Map();
  const typeById = new Map();
  for (const [labelType, features] of Object.entries(mapData.sortedLabels)) {
    for (const f of features) {
      coordsById.set(f.properties.label_id, f.geometry.coordinates);
      typeById.set(f.properties.label_id, labelType);
    }
  }

  const trail = [];         // Visited label IDs in visit order; backs prev().
  const visited = new Set(); // next() never revisits, so repeated clicks tour outward instead of ping-ponging.

  /**
   * Squared equirectangular distance — plenty for ranking nearby points.
   * @param {Array<number>} a [lng, lat]
   * @param {Array<number>} b [lng, lat]
   * @param {number} kx cos(reference latitude), precomputed once per ranking pass.
   * @returns {number}
   */
  const dist2 = (a, b, kx) => {
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
      // cos(current latitude) hoisted out of the scan: for ranking nearby candidates it differs negligibly
      // from the per-pair midpoint latitude, and the scan covers every loaded label.
      const kx = Math.cos(here[1] * (Math.PI / 180));
      let best = null;
      let bestD = Infinity;
      for (const [id, coords] of coordsById) {
        if (visited.has(id)) continue;
        const d = dist2(here, coords, kx);
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
    hasNext(currentId) {
      // Mirrors next()'s reachability without mutating state: a known current label plus at least one other
      // unvisited label. Backs the Next button's disabled state.
      if (!coordsById.has(currentId)) return false;
      for (const id of coordsById.keys()) {
        if (id !== currentId && !visited.has(id)) return true;
      }
      return false;
    },
    getCoords(labelId) {
      return coordsById.get(labelId) ?? null;
    },
    getLabelType(labelId) {
      return typeById.get(labelId) ?? null;
    },
  };
}
