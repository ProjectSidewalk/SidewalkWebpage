/**
 * Landmarks on the Explore minimap: the schools, health care, libraries, community centers, and government offices
 * near the user, from the same places table the AccessScore map draws (`/v3/api/places`, #5311). They help a labeler
 * orient, and they are where accessibility matters most.
 *
 * Places are fetched for a box around the map's center and fetched again only once the view leaves the middle of that
 * box, so walking, panning, and the route overview cost a request every kilometer or so rather than one per move.
 * Drawing is Minimap's (setLandmarks); this class only decides what to ask for and when.
 */
class MinimapLandmarks {
  // Which of the backend's categories (`place_categories` on /v3/api/accessScoreConfig) are landmarks here. A choice
  // of presentation, like AccessScore's glyphs: grocery stores, transit stops, and parks are numerous enough to bury
  // a ~200px map. The API rejects an id it doesn't list, which would leave the minimap without landmarks, not broken.
  static CATEGORIES = Object.freeze(['school', 'health', 'library', 'community', 'government']);

  // Half the side of the fetched box, in meters. The minimap shows at most ~1 km across outside the overview.
  static #HALF_SPAN_M = 1500;

  // The view's center may drift this fraction of the half-span from the box's center before a refetch.
  static #REFETCH_AT = 0.5;

  /** @type {Minimap} */
  #minimap;

  /** Center of the box last fetched, or null before the first fetch. @type {?{lat: number, lng: number}} */
  #fetchedCenter = null;

  /** Whether a fetch is under way, so a burst of moves doesn't start several. */
  #fetching = false;

  /**
   * @param {Minimap} minimap - The minimap to draw on.
   */
  constructor(minimap) {
    this.#minimap = minimap;
    minimap.onMoveEnd(() => this.#maybeFetch());
    this.#maybeFetch();
  }

  /**
   * Meters between two points, on a sphere; ample for deciding when a kilometer-scale box needs refreshing.
   * @param {{lat: number, lng: number}} a
   * @param {{lat: number, lng: number}} b
   * @returns {number}
   */
  static #metersBetween(a, b) {
    return turf.distance([a.lng, a.lat], [b.lng, b.lat], { units: 'meters' });
  }

  /**
   * The box to fetch around a point, as the API's "minLng,minLat,maxLng,maxLat".
   * @param {{lat: number, lng: number}} center
   * @returns {string}
   */
  static #bboxAround(center) {
    const dLat = MinimapLandmarks.#HALF_SPAN_M / 111320;
    const dLng = dLat / Math.cos((center.lat * Math.PI) / 180);
    const corners = [center.lng - dLng, center.lat - dLat, center.lng + dLng, center.lat + dLat];
    return corners.map((v) => v.toFixed(6)).join(',');
  }

  /** Fetches the landmarks around the view's center, unless the last fetch still covers it. */
  async #maybeFetch() {
    if (this.#fetching) return;
    const center = this.#minimap.getCenter();
    if (this.#fetchedCenter && MinimapLandmarks.#metersBetween(center, this.#fetchedCenter)
      < MinimapLandmarks.#HALF_SPAN_M * MinimapLandmarks.#REFETCH_AT) return;

    this.#fetching = true;
    try {
      const params = new URLSearchParams({
        bbox: MinimapLandmarks.#bboxAround(center), category: MinimapLandmarks.CATEGORIES.join(','),
      });
      const response = await fetch(`/v3/api/places?${params}`, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      this.#minimap.setLandmarks(await response.json());
      this.#fetchedCenter = center;
    } catch (error) {
      // Landmarks are orientation help, not a task: a failed fetch leaves the map without them and retries on the
      // next move.
      console.error('MinimapLandmarks: could not fetch places', error);
    } finally {
      this.#fetching = false;
    }
  }
}
