/**
 * Keeps Explore's address bar in step with the labeler, so the URL is always a link to where they are and what they
 * are looking at (#5480): the current pano, its position, the point of view, and whether the pano fills the window.
 *
 * This is the write side of `/explore`'s seed params. The read side already existed — `ExploreController.explore`
 * binds `panoId`, `lat`, `lng`, `heading`, `pitch` and `zoom`, and the mission-complete "keep exploring here" and the
 * label card's "Explore here" build that URL — so the two have to agree on names and meaning. The rules:
 *
 * - The URL is a place, not a session. Opening it lands in free exploration at that spot, which is what `?lat&lng`
 *   has meant since #4451, and never in the sharer's mission or route: `routeId`, `resumeRoute`, `regionId`,
 *   `streetEdgeId` and the rest of the mission's own params are dropped from the live URL rather than carried. That
 *   applies to the labeler's own refresh too. It resumes the view, while the audit mission they were in is untouched
 *   (the drop-in path deliberately leaves the current region alone) and waits behind a bare /explore.
 * - `lat`/`lng` are the pano's position, not the task's, so the server resolves the street under the imagery.
 * - `replaceState`, never `pushState`: a pan is not a navigation, and the page the labeler came from stays one Back
 *   press away.
 * - Writes are throttled, because a drag reports a POV change per frame and browsers ration history writes: Safari
 *   throws a SecurityError past 100 in 30 s, and Chrome silently drops them. One write per interval, trailing edge,
 *   so the view that ends a drag is the one in the URL; a pano change on a quiet page writes at once.
 */
class ExploreUrlSync {
  /** The floor between two writes: a fifth of Safari's budget, leaving room for the pano changes on top. */
  static WRITE_INTERVAL_MS = 500;
  /** Explore's canonical path; /audit is an alias the URL is normalized away from. */
  static PATH = '/explore';
  // 6 decimals of a degree is ~10 cm, 0.1° of heading is finer than a pan can hold, and the zoom is the wheel's
  // continuous value (#5480 widened the route's `zoom` from an Int for it), so two decimals keep the view.
  static #COORD_DECIMALS = 6;
  static #ANGLE_DECIMALS = 1;
  static #ZOOM_DECIMALS = 2;

  /** @type {PanoViewer} */
  #viewer;
  /** @type {() => boolean} */
  #isImmersive;
  #timer = null;
  #lastWriteAt = Number.NEGATIVE_INFINITY;

  /**
   * @param {PanoViewer} viewer - The pano viewer whose pano and POV the URL follows.
   * @param {() => boolean} isImmersive - Whether immersive mode (#5085) is on, read at write time.
   */
  constructor(viewer, isImmersive) {
    this.#viewer = viewer;
    this.#isImmersive = isImmersive;
  }

  /** Subscribes to the viewer and writes the URL for the pano it is already showing. */
  start() {
    this.#viewer.addListener('pano_changed', () => this.request());
    this.#viewer.addListener('pov_changed', () => this.request());
    this.request();
  }

  /**
   * Asks for the URL to be brought up to date: now if the last write is old enough, otherwise once the interval
   * since it has elapsed. Requests inside the wait collapse into that one write, which reads the state when it runs.
   */
  request() {
    if (this.#timer !== null) return;
    const wait = this.#lastWriteAt + ExploreUrlSync.WRITE_INTERVAL_MS - Date.now();
    if (wait <= 0) {
      this.writeNow();
      return;
    }
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.writeNow();
    }, wait);
  }

  /** Rewrites the URL from the viewer's current state, skipping the write when it would change nothing. */
  writeNow() {
    this.#lastWriteAt = Date.now();
    const params = ExploreUrlSync.paramsFor(this.#viewer, this.#isImmersive());
    if (params === null) return;
    const url = new URL(ExploreUrlSync.PATH, window.location.origin);
    for (const [name, value] of params) url.searchParams.set(name, value);
    url.hash = window.location.hash;
    const next = `${url.pathname}?${util.url.serialize(url.searchParams)}`;
    if (next === `${window.location.pathname}${window.location.search}`) return;
    try {
      util.url.replaceQuery(url);
    } catch {
      // A browser that has run out of history writes for the moment: the address bar lags until the next one that
      // goes through, which is never worth taking the tool down over.
    }
  }

  /**
   * The query a viewer's state reads as, in the read side's names.
   *
   * @param {PanoViewer} viewer - The pano viewer.
   * @param {boolean} immersive - Whether immersive mode is on.
   * @returns {?URLSearchParams} The params, or null while the viewer has no pano or view to name (a load in flight).
   */
  static paramsFor(viewer, immersive) {
    const panoId = viewer.getPanoId();
    const position = viewer.getPosition();
    const pov = viewer.getPov();
    if (!panoId || !position || !pov) return null;
    const numbers = [position.lat, position.lng, pov.heading, pov.pitch, pov.zoom];
    if (!numbers.every(Number.isFinite)) return null;

    const round = (value, decimals) => String(Number(value.toFixed(decimals)));
    const params = new URLSearchParams();
    params.set('panoId', panoId);
    params.set('lat', round(position.lat, ExploreUrlSync.#COORD_DECIMALS));
    params.set('lng', round(position.lng, ExploreUrlSync.#COORD_DECIMALS));
    // Viewers report a heading as they please (GSV goes past 360 on a long drag); the URL says it once, in [0, 360),
    // re-wrapped after rounding so 359.96 reads 0 rather than 360.
    const heading = Number((((pov.heading % 360) + 360) % 360).toFixed(ExploreUrlSync.#ANGLE_DECIMALS)) % 360;
    params.set('heading', String(heading));
    params.set('pitch', round(pov.pitch, ExploreUrlSync.#ANGLE_DECIMALS));
    params.set('zoom', round(pov.zoom, ExploreUrlSync.#ZOOM_DECIMALS));
    if (immersive) params.set('immersive', '1');
    return params;
  }
}
