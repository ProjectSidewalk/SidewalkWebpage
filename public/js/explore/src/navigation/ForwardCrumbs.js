/**
 * Forward crumbs on the Explore minimap (#4669, #4655): the panos that exist ahead of the user on the street being
 * audited, drawn as amber dots so the labeler can see that imagery continues, including past the gaps where the
 * imagery provider's own link graph dead-ends and the on-pano arrows fall silent. The nearest few are clickable and
 * step the user forward, the same move the compass's "go straight" makes; the rest are informational only, so a
 * user can't skip most of a street in one click (#2561).
 *
 * Positions come live from the pano viewer's metadata-only findPanoNear(), which every provider answers through the
 * same search that setLocation() moves with, so a crumb is exactly where a move there would land. The street is
 * sampled on the same fixed grid NavigationService.moveForward() walks (DIST_INCREMENT along the full street
 * geometry, never the remainder), which keeps the sample points identical from move to move: the answers are
 * memoised per street, so after the first burst on a street every later refresh costs no provider calls.
 */
class ForwardCrumbs {
  /** How many of the crumbs ahead are clickable. Stepping, not teleporting (#2561). */
  static REACHABLE_COUNT = 3;

  /** A pano farther than this from the street line belongs to a cross street or alley, not this street (m). */
  static MAX_OFFSET_M = 15;

  /** A pano this close to the furthest point reached is the cluster the user is standing in, not "ahead" (m). */
  static MIN_AHEAD_M = 5;

  /** Long streets sample coarser than DIST_INCREMENT so one street can't queue hundreds of lookups. */
  static MAX_SAMPLES = 100;

  /** Provider lookups allowed in flight at once; the rest queue. Keeps a fresh street from bursting the provider. */
  static #IN_FLIGHT_LIMIT = 4;

  #navigationService;
  #tracker;
  #markers = new Map(); // panoId -> { marker: AdvancedMarkerElement, rank: number }; rank 0 = faint, 1..N = clickable.
  #memo = new Map(); // sampleIndex -> Promise<?{panoId, lat, lng}> for the street #memoKey names.
  #memoKey = null; // Identity of the traversal the memo belongs to; see memoKeyFor().
  #providerFailed = false; // A lookup on this street rejected: stop asking until the street changes.
  #generation = 0; // Bumped per refresh(); a refresh whose lookups resolve after a newer one started is dropped.
  #inFlight = 0;
  #queue = [];
  #highlightedPanoId = null;

  /**
   * @param {NavigationService} navigationService - Makes the moves a crumb click asks for.
   * @param {Tracker} tracker - Interaction logger.
   */
  constructor(navigationService, tracker) {
    this.#navigationService = navigationService;
    this.#tracker = tracker;
  }

  /**
   * Recomputes and redraws the crumbs for the current task and position. Safe to call often: lookups are memoised
   * per street and a refresh superseded by a newer one is discarded when its lookups come back. Best-effort, like
   * the move preloading it runs beside: it is called from the post-move fan-out, so it never lets an error escape.
   * @returns {Promise<void>}
   */
  async refresh() {
    try {
      await this.#refresh();
    } catch (err) {
      console.warn('Forward crumbs could not be refreshed:', err);
    }
  }

  /**
   * The work of {@link refresh}.
   * @returns {Promise<void>}
   */
  async #refresh() {
    const task = this.#taskToSample();
    if (!task) {
      this.clear();
      return;
    }
    const street = task.getFeature();
    const key = ForwardCrumbs.memoKeyFor(task);
    if (key !== this.#memoKey) {
      this.#memoKey = key;
      this.#memo.clear();
      this.#providerFailed = false;
    }
    const generation = ++this.#generation;

    const originKm = turf.nearestPointOnLine(street, task.getFurthestPointReached()).properties.location;
    const offsets = ForwardCrumbs.sampleOffsetsKm(
      turf.length(street), NavigationService.DIST_INCREMENT, ForwardCrumbs.MAX_SAMPLES,
    );
    const pending = [];
    offsets.forEach((offsetKm, i) => {
      // Points already walked can't hold a crumb, so they are never asked about.
      if (offsetKm < originKm - NavigationService.DIST_INCREMENT) return;
      if (!this.#memo.has(i)) {
        if (this.#providerFailed) return;
        const [lng, lat] = turf.along(street, offsetKm).geometry.coordinates;
        this.#memo.set(i, this.#enqueue(() => svl.panoViewer.findPanoNear({ lat, lng }).catch((err) => {
          // An unanswered lookup says nothing about the street (#4918); remember that it failed rather than
          // re-asking on every move, and show whatever the answered points found.
          this.#providerFailed = true;
          console.warn('Forward crumb lookup failed; not sampling further on this street.', err);
          return null;
        })));
      }
      pending.push(this.#memo.get(i));
    });

    const hits = await Promise.all(pending);
    if (generation !== this.#generation) return; // A newer refresh owns the markers now.

    const currentPanoId = svl.panoViewer.getPanoId();
    const candidates = ForwardCrumbs.dedupByPanoId(hits.filter(Boolean))
      .filter((hit) => hit.panoId !== currentPanoId
        && !(svl.observedArea && svl.observedArea.hasVisited(hit.panoId)))
      .map((hit) => ForwardCrumbs.measureAgainstStreet(street, hit));
    const { reachable, faint } = ForwardCrumbs.windowCandidates(candidates, {
      fromKm: originKm,
      minAheadM: ForwardCrumbs.MIN_AHEAD_M,
      maxOffsetM: ForwardCrumbs.MAX_OFFSET_M,
      reachableCount: ForwardCrumbs.REACHABLE_COUNT,
    });
    this.#render(reachable, faint);
  }

  /** Removes every crumb from the map. The memo is kept, since re-showing the same street is then free. */
  clear() {
    for (const { marker } of this.#markers.values()) marker.map = null;
    this.#markers.clear();
    this.#highlightedPanoId = null;
  }

  /**
   * Emphasizes the crumb at a pano, for tying an on-pano arrow to the crumb it leads to (#4682). No-op when no
   * crumb marks that pano.
   * @param {string} panoId
   */
  highlight(panoId) {
    if (this.#highlightedPanoId === panoId) return;
    this.clearHighlight();
    const entry = this.#markers.get(panoId);
    if (!entry) return;
    entry.marker.content.classList.add('minimap-forward-crumb-highlight');
    this.#highlightedPanoId = panoId;
  }

  /** Clears any highlight set by {@link highlight}. */
  clearHighlight() {
    if (this.#highlightedPanoId === null) return;
    const entry = this.#markers.get(this.#highlightedPanoId);
    if (entry) entry.marker.content.classList.remove('minimap-forward-crumb-highlight');
    this.#highlightedPanoId = null;
  }

  /**
   * Identity of the traversal a memo belongs to. Walk order separates the two passes of an out-and-back route
   * (the same reasoning as NavigationService's stuck-pano set), and the direction flag is in because reversing a
   * street reverses the sample grid, so the answers no longer line up with their indices.
   * @param {Task} task
   * @returns {string}
   */
  static memoKeyFor(task) {
    return `${task.getStreetEdgeId()}|${task.getWalkOrder()}|${task.getProperty('startPointReversed')}`;
  }

  /**
   * Distances along a street at which to look for panos: every `stepKm` from the start, widened so that no street
   * needs more than `maxSamples` lookups, always ending at the street's end.
   * @param {number} lengthKm - The street's length.
   * @param {number} stepKm - The preferred spacing (NavigationService.DIST_INCREMENT, so caches primed by the
   *     forward walk are hit).
   * @param {number} maxSamples - Cap on the number of offsets.
   * @returns {number[]} Ascending offsets in km, starting at 0.
   */
  static sampleOffsetsKm(lengthKm, stepKm, maxSamples) {
    if (!(lengthKm > 0)) return [0];
    const step = Math.max(stepKm, lengthKm / maxSamples);
    const offsets = [];
    for (let d = 0; d < lengthKm - step / 2; d += step) offsets.push(d);
    offsets.push(lengthKm);
    return offsets;
  }

  /**
   * Collapses the hits of adjacent sample points that resolved to the same pano (a 25 m search radius over a 10 m
   * grid returns each pano several times), keeping the first.
   * @param {Array<{panoId: string}>} hits
   * @returns {Array<{panoId: string}>}
   */
  static dedupByPanoId(hits) {
    const seen = new Set();
    return hits.filter((hit) => !seen.has(hit.panoId) && seen.add(hit.panoId));
  }

  /**
   * Locates a pano relative to the street: how far along it the pano projects, and how far off the line it sits.
   * @param {turf.Feature<turf.LineString>} street - The street geometry, in walk direction.
   * @param {{panoId: string, lat: number, lng: number}} hit - A pano the provider found.
   * @returns {{panoId: string, lat: number, lng: number, alongKm: number, offsetM: number}}
   */
  static measureAgainstStreet(street, hit) {
    const point = turf.point([hit.lng, hit.lat]);
    return {
      ...hit,
      alongKm: turf.nearestPointOnLine(street, point).properties.location,
      offsetM: turf.pointToLineDistance(point, street, { units: 'meters' }),
    };
  }

  /**
   * Picks the panos that are ahead on this street and splits them into the clickable few and the rest.
   * @param {Array<{alongKm: number, offsetM: number}>} measured - Panos located by {@link measureAgainstStreet}.
   * @param {object} options
   * @param {number} options.fromKm - Where "ahead" starts: the furthest point reached, along the street.
   * @param {number} options.minAheadM - Panos closer than this to `fromKm` are where the user already is.
   * @param {number} options.maxOffsetM - Panos farther than this from the line are on another street.
   * @param {number} options.reachableCount - How many of the nearest to make clickable.
   * @returns {{reachable: object[], faint: object[]}} Both in walk order, nearest first.
   */
  static windowCandidates(measured, { fromKm, minAheadM, maxOffsetM, reachableCount }) {
    const ahead = measured
      .filter((c) => c.offsetM <= maxOffsetM && (c.alongKm - fromKm) * 1000 > minAheadM)
      .sort((a, b) => a.alongKm - b.alongKm);
    return { reachable: ahead.slice(0, reachableCount), faint: ahead.slice(reachableCount) };
  }

  /**
   * The task whose street should carry crumbs, or null when none should show: no route to walk (free exploration,
   * the tutorial, no current task yet), a finished street (the next one is a jump the compass owns), walking locked
   * (mission-complete modal), or a provider with no location search (Pannellum). The same gates the on-pano
   * route-forward arrow uses.
   * @returns {?Task}
   */
  #taskToSample() {
    if (svl.isOnboarding() || svl.isExploreAddressMode()) return null;
    if (!svl.taskContainer || !svl.panoViewer || typeof svl.panoViewer.findPanoNear !== 'function') return null;
    if (this.#navigationService.getStatus('lockDisableWalking')) return null;
    const task = svl.taskContainer.getCurrentTask();
    return task && !task.isComplete() ? task : null;
  }

  /**
   * Runs a lookup with at most #IN_FLIGHT_LIMIT in flight, queueing the rest in order.
   * @param {() => Promise<*>} lookup - Must not reject (refresh() catches before enqueueing).
   * @returns {Promise<*>}
   */
  #enqueue(lookup) {
    return new Promise((resolve) => {
      this.#queue.push(() => lookup().then(resolve, () => resolve(null)));
      this.#drain();
    });
  }

  /** Starts queued lookups while there is room. */
  #drain() {
    while (this.#inFlight < ForwardCrumbs.#IN_FLIGHT_LIMIT && this.#queue.length > 0) {
      const run = this.#queue.shift();
      this.#inFlight++;
      run().finally(() => {
        this.#inFlight--;
        this.#drain();
      });
    }
  }

  /**
   * Syncs the markers to the wanted set, keyed by pano. A crumb whose rank changed (a faint one becoming clickable
   * as the user advances) is rebuilt, since clickability is fixed at marker construction.
   * @param {object[]} reachable - Clickable crumbs, nearest first.
   * @param {object[]} faint - The rest, nearest first.
   */
  #render(reachable, faint) {
    const wanted = new Map();
    reachable.forEach((crumb, i) => wanted.set(crumb.panoId, { crumb, rank: i + 1 }));
    faint.forEach((crumb) => wanted.set(crumb.panoId, { crumb, rank: 0 }));

    for (const [panoId, entry] of this.#markers) {
      const want = wanted.get(panoId);
      if (!want || want.rank !== entry.rank) {
        entry.marker.map = null;
        this.#markers.delete(panoId);
        if (this.#highlightedPanoId === panoId) this.#highlightedPanoId = null;
      }
    }
    for (const [panoId, { crumb, rank }] of wanted) {
      if (!this.#markers.has(panoId)) this.#markers.set(panoId, { marker: this.#createMarker(crumb, rank), rank });
    }
  }

  /**
   * One crumb marker. Map-positioned, like the visited breadcrumbs, so it tracks zoom without manual projection.
   * @param {{panoId: string, lat: number, lng: number}} crumb
   * @param {number} rank - 1..N for the clickable crumbs (nearest first), 0 for a faint one.
   * @returns {google.maps.marker.AdvancedMarkerElement}
   */
  #createMarker(crumb, rank) {
    const reachable = rank > 0;
    const content = document.createElement('div');
    content.className = reachable ? 'minimap-forward-crumb minimap-forward-crumb-reachable' : 'minimap-forward-crumb';
    const marker = new google.maps.marker.AdvancedMarkerElement({
      position: new google.maps.LatLng(crumb.lat, crumb.lng),
      map: svl.minimap.getMap(),
      content,
      gmpClickable: reachable,
      // Above the visited breadcrumbs and label icons, well below the peg (1000), which is click-through anyway.
      zIndex: reachable ? 30 : 20,
      title: reachable ? i18next.t('audit:right-ui.minimap.forward-crumb-title', { rank }) : undefined,
    });
    if (reachable) marker.addListener('gmp-click', () => this.#moveTo(crumb, rank));
    return marker;
  }

  /**
   * Steps the user to a crumb's pano. A real move that advances the task, unlike the breadcrumbs' peek back. The
   * pano id is tried first; a provider that no longer serves it (GSV retires panos) gets the same coordinate search
   * moveForward() uses, which lands on whatever now stands there.
   * @param {{panoId: string, lat: number, lng: number}} crumb
   * @param {number} rank - The crumb's position among the clickable ones, for the log.
   * @returns {Promise<void>}
   */
  async #moveTo(crumb, rank) {
    const nav = this.#navigationService;
    if (nav.getStatus('disableWalking')) return;
    this.#tracker.push('Click_MinimapForwardCrumb', { panoId: crumb.panoId, rank });
    const moved = await nav.moveToPano(crumb.panoId, false, { alertOnFailure: false });
    if (moved) return;
    this.#tracker.push('ForwardCrumbMove_Fallback', { panoId: crumb.panoId });
    await nav.moveToLocation({ lat: crumb.lat, lng: crumb.lng });
  }
}
