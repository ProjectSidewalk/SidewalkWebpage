/**
 * Prev/next navigation over the map's loaded labels for the label popup (#4572): "next" greedily walks to the
 * nearest label not yet visited this page-load (touring along a street and outward), "prev" retraces the visited
 * trail. Operates on the same in-memory GeoJSON features the map layers draw, so paging costs no requests.
 *
 * @param {Object} mapData The map layer tracker returned by addLabelsToMap (reads .sortedLabels).
 * @param {Object} [options]
 * @param {function(string, Object): boolean} [options.isCandidate] Called with a label's type and GeoJSON feature
 *     to decide whether "next" may land on it; omit to page over every loaded label. LabelMap passes the sidebar
 *     filters here so the arrows never step onto a label the user has filtered off the map (#5124). Evaluated on
 *     each call rather than cached, so a filter change takes effect on the very next click; call refresh() after
 *     one so subscribers (the popup's arrow states) re-derive too. "prev" is exempt: it retraces where the user
 *     has actually been, and the spotlight keeps that label visible whatever the filters say.
 * @returns {{next: function(number): ?number, prev: function(number): ?number, hasPrev: function(number): boolean,
 *     hasNext: function(number): boolean, getCoords: function(number): ?Array<number>,
 *     getLabelType: function(number): ?string, refresh: function(): void,
 *     onRefresh: function(function(): void): void}}
 *     Navigator whose paging methods take the currently shown label ID and return the label ID to show (null when
 *     there is nowhere to go); getCoords/getLabelType look up a loaded label's [lng, lat] / label type; refresh
 *     re-reads .sortedLabels after a viewport refetch has swapped the loaded labels, notifying onRefresh
 *     subscribers so everything derived from the label set (e.g. the popup's arrow states) follows it.
 */
function createNearbyLabelNavigator(mapData, { isCandidate = () => true } = {}) {
  // label_id -> [lng, lat], label type, and feature for every label on the map, flattened across types.
  const coordsById = new Map();
  const typeById = new Map();
  const featureById = new Map();
  const rebuild = () => {
    coordsById.clear();
    typeById.clear();
    featureById.clear();
    for (const [labelType, features] of Object.entries(mapData.sortedLabels)) {
      for (const f of features) {
        coordsById.set(f.properties.label_id, f.geometry.coordinates);
        typeById.set(f.properties.label_id, labelType);
        featureById.set(f.properties.label_id, f);
      }
    }
  };
  rebuild();

  // Subscribers re-derive whatever they compute from the label set. Anything holding state keyed on the set —
  // the popup's prev/next disabled states — is only correct if it recomputes with the set, so the navigator
  // announces the change rather than leaving each host to pair a second call with every refresh() (#5068).
  const refreshListeners = [];

  // The trail and visited set deliberately survive refresh(): prev() retraces even labels a refetch dropped
  // (the page falls back to popup-metadata coords for those), and next() from a dropped label returns null,
  // which the popup already renders as "nowhere to go".
  const trail = [];         // Visited label IDs in visit order; backs prev().
  const visited = new Set(); // next() never revisits, so repeated clicks tour outward instead of ping-ponging.

  /**
   * Whether next() may land on a label: not the one being paged from, not yet toured, and passing the host's
   * filter predicate.
   * @param {number} id A loaded label's ID.
   * @param {number} currentId The label being paged from.
   * @returns {boolean}
   */
  const isReachable = (id, currentId) =>
    id !== currentId && !visited.has(id) && isCandidate(typeById.get(id), featureById.get(id));

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
        if (!isReachable(id, currentId)) continue;
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
      // reachable label. Backs the Next button's disabled state.
      if (!coordsById.has(currentId)) return false;
      for (const id of coordsById.keys()) {
        if (isReachable(id, currentId)) return true;
      }
      return false;
    },
    getCoords(labelId) {
      return coordsById.get(labelId) ?? null;
    },
    getLabelType(labelId) {
      return typeById.get(labelId) ?? null;
    },
    refresh() {
      rebuild();
      for (const listener of refreshListeners) listener();
    },
    onRefresh(callback) {
      refreshListeners.push(callback);
    },
  };
}
