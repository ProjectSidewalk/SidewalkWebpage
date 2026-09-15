/**
 * Crumbs on the Explore minimap for where the user can go next (#4669, #4655): a ring at the destination of every
 * on-pano arrow, and rings along the route ahead on the street being audited, including past the gaps where the
 * imagery provider's link graph dead-ends and the arrows fall silent. The crumb the user is facing fills in, so a
 * filled disc has one meaning on the whole map: the forward arrow / up key takes you here. The crumb the spacebar
 * would step to (the link nearest the route's direction, else the route walk's next stop) is always tinted the
 * route line's light blue, so the next step along the route reads at a glance whichever way the user looks. Route
 * stops are deep blue (the forward arrow's family, darker than the peg), other directions gold; the nearest few
 * route stops and every link are clickable and step the user there, the rest of the route is shown but not
 * steppable (#2561).
 *
 * Positions come live from the pano viewer: arrow destinations through getLinkedPanoPositions(), route stops by
 * sampling the street with the metadata-only findPanoNear(), which every provider answers through the same search
 * setLocation() moves with. The street is sampled on the same fixed grid NavigationService.moveForward() walks
 * (DIST_INCREMENT along the full street geometry, never the remainder), which keeps the sample points identical
 * from move to move: the answers are memoised per street, so after the first burst every later refresh is free.
 */

/**
 * A pano a provider found near a sample point: what PanoViewer.findPanoNear() resolves with.
 * @typedef {{panoId: string, lat: number, lng: number}} PanoHit
 */

/**
 * A hit located relative to the street: how far along it the pano projects (km) and how far off the line it sits (m).
 * @typedef {{panoId: string, lat: number, lng: number, alongKm: number, offsetM: number}} MeasuredCrumb
 */

/**
 * One crumb to draw: a route stop or an arrow destination, whether clicking it steps there, and whether the user has
 * already stood on it (it then wears the breadcrumb trail's pine so the two marks read as one).
 * @typedef {{panoId: string, lat: number, lng: number, kind: ('route'|'link'), clickable: boolean, rank: number,
 *     visited: boolean}} Crumb
 */

class ForwardCrumbs {
  /** How many of the route stops ahead are clickable. Stepping, not teleporting (#2561). */
  static REACHABLE_COUNT = 3;

  /** A pano farther than this from the street line belongs to a cross street or alley, not this street (m). */
  static MAX_OFFSET_M = 15;

  /** A pano this close to the furthest point reached is the cluster the user is standing in, not "ahead" (m). */
  static MIN_AHEAD_M = 5;

  /** Long streets sample coarser than DIST_INCREMENT so one street can't queue hundreds of lookups. */
  static MAX_SAMPLES = 100;

  /**
   * How far (degrees) a link may sit from a heading and still count as "that way": the on-pano forward arrow and the
   * faced crumb both use it, so the arrow the route highlights and the crumb that fills always agree (#4671).
   */
  static LINK_THRESHOLD_DEG = 45;

  /** Provider lookups allowed in flight at once; the rest queue. Keeps a fresh street from bursting the provider. */
  static #IN_FLIGHT_LIMIT = 4;

  #navigationService;
  #tracker;
  #markers = new Map(); // panoId -> { marker: AdvancedMarkerElement, kind, clickable, visited }.
  #links = []; // The current pano's positioned links, kept for setFacing().
  #routeStops = []; // Route stops ahead, nearest first, kept for setFacing().
  #facedPanoId = null;
  #nextStepPanoId = null; // The crumb the spacebar would step to; tinted until the next refresh moves it.
  #highlightedPanoId = null;
  #memo = new Map(); // sampleIndex -> Promise<?PanoHit> for the street #memoKey names.
  #memoKey = null; // Identity of the traversal the memo belongs to; see memoKeyFor().
  #providerFailed = false; // A lookup on this street rejected: stop asking until the street changes.
  #generation = 0; // Bumped per refresh(); a refresh whose lookups resolve after a newer one started is dropped.
  #inFlight = 0;
  #queue = [];

  /**
   * @param {NavigationService} navigationService - Makes the moves a crumb click asks for.
   * @param {Tracker} tracker - Interaction logger.
   */
  constructor(navigationService, tracker) {
    this.#navigationService = navigationService;
    this.#tracker = tracker;
  }

  /**
   * Recomputes and redraws the crumbs for the current pano, task and position. Safe to call often: route lookups are
   * memoised per street and a refresh superseded by a newer one is discarded when its lookups come back. Best-effort,
   * like the move preloading it runs beside: it is called from the post-move fan-out, so it never lets an error
   * escape.
   * @returns {Promise<void>}
   */
  async refresh() {
    try {
      await this.#refresh();
    } catch (err) {
      console.warn('Minimap crumbs could not be refreshed:', err);
    }
  }

  /**
   * The work of {@link refresh}.
   * @returns {Promise<void>}
   */
  async #refresh() {
    const generation = ++this.#generation;
    // Nothing is steppable in the tutorial or while walking is hard-locked (mission-complete modal).
    if (!svl.panoViewer || svl.isOnboarding() || this.#navigationService.getStatus('lockDisableWalking')) {
      this.clear();
      return;
    }
    const task = this.#taskToSample();
    const [links, stops] = await Promise.all([
      this.#positionedLinks(),
      task ? this.#routeStopsAhead(task) : Promise.resolve([]),
    ]);
    if (generation !== this.#generation) return; // A newer refresh owns the markers now.

    this.#links = links;
    this.#routeStops = stops;
    const currentPanoId = svl.panoViewer.getPanoId();
    const crumbs = ForwardCrumbs.mergeSources(stops, links, {
      currentPanoId,
      isVisited: (panoId) => Boolean(svl.observedArea && svl.observedArea.hasVisited(panoId)),
      reachableCount: ForwardCrumbs.REACHABLE_COUNT,
    });
    this.#render(crumbs);
    this.#markNextStep(ForwardCrumbs.nextStepPanoId(
      links, this.#targetAngle(), stops.length > 0 ? stops[0].panoId : null,
    ));
    this.setFacing(svl.panoViewer.getPov().heading);
  }

  /**
   * Tints the crumb the spacebar would step to and clears the previous one. Recomputed per refresh only: the
   * spacebar aims at the route's direction, which changes with position, not with where the camera points.
   * @param {?string} panoId
   */
  #markNextStep(panoId) {
    const previous = this.#markers.get(this.#nextStepPanoId);
    if (previous) previous.marker.content.classList.remove('minimap-crumb-next');
    const next = this.#markers.get(panoId);
    if (next) next.marker.content.classList.add('minimap-crumb-next');
    this.#nextStepPanoId = next ? panoId : null;
  }

  /**
   * Fills in the crumb the user now faces (the one the forward arrow / up key would take them to) and empties the
   * previous one. Called on every POV change, so it only toggles classes.
   * @param {number} heading - The live POV heading, degrees clockwise from north.
   */
  setFacing(heading) {
    const nextStop = this.#routeStops.length > 0 ? this.#routeStops[0].panoId : null;
    const panoId = ForwardCrumbs.facedPanoId(this.#links, heading, nextStop, this.#routeHeading());
    if (panoId === this.#facedPanoId) return;
    const previous = this.#markers.get(this.#facedPanoId);
    if (previous) previous.marker.content.classList.remove('minimap-crumb-faced');
    const next = this.#markers.get(panoId);
    if (next) next.marker.content.classList.add('minimap-crumb-faced');
    this.#facedPanoId = next ? panoId : null;
  }

  /** Removes every crumb from the map. The route memo is kept, since re-showing the same street is then free. */
  clear() {
    for (const { marker } of this.#markers.values()) marker.map = null;
    this.#markers.clear();
    this.#links = [];
    this.#routeStops = [];
    this.#facedPanoId = null;
    this.#nextStepPanoId = null;
    this.#highlightedPanoId = null;
  }

  /**
   * Outlines the crumb at a pano, for tying a hovered on-pano arrow to the crumb it leads to (#4682). Distinct from
   * the faced fill. No-op when no crumb marks that pano.
   * @param {string} panoId
   */
  highlight(panoId) {
    if (this.#highlightedPanoId === panoId) return;
    this.clearHighlight();
    const entry = this.#markers.get(panoId);
    if (!entry) return;
    entry.marker.content.classList.add('minimap-crumb-highlight');
    this.#highlightedPanoId = panoId;
  }

  /** Clears any outline set by {@link highlight}. */
  clearHighlight() {
    if (this.#highlightedPanoId === null) return;
    const entry = this.#markers.get(this.#highlightedPanoId);
    if (entry) entry.marker.content.classList.remove('minimap-crumb-highlight');
    this.#highlightedPanoId = null;
  }

  /**
   * Index of the link whose heading is closest to `heading`, if one is within `threshold` degrees of it; -1
   * otherwise. PanoManager uses it to pick the arrow the route highlights (a link-graph dead-end is -1, where it
   * synthesizes a forward arrow instead, #4671); setFacing() uses it to pick the crumb that fills.
   * @param {Array<{heading: number}>} links - The current pano's linked panos.
   * @param {number} heading - The heading to match, degrees clockwise from north.
   * @param {number} [threshold] - Degrees; defaults to LINK_THRESHOLD_DEG.
   * @returns {number}
   */
  static closestLinkIndex(links, heading, threshold = ForwardCrumbs.LINK_THRESHOLD_DEG) {
    let bestDelta = threshold;
    let bestIndex = -1;
    links.forEach((link, i) => {
      const delta = Math.abs(((((link.heading - heading) % 360) + 540) % 360) - 180);
      if (delta < bestDelta) {
        bestDelta = delta;
        bestIndex = i;
      }
    });
    return bestIndex;
  }

  /**
   * The pano the forward arrow / up key leads to from a heading: the link that way, or, where no link points the
   * route's way and the on-pano arrow is the synthesized route-forward one, the route's next stop when the user
   * faces the route's direction. Null when facing nowhere a step leads.
   * @param {Array<{panoId: string, heading: number}>} links - The current pano's links.
   * @param {number} heading - The live POV heading.
   * @param {?string} nextStopPanoId - The nearest route stop ahead, if any.
   * @param {?number} routeHeading - The route's forward heading, or null when not on a route.
   * @returns {?string}
   */
  static facedPanoId(links, heading, nextStopPanoId, routeHeading) {
    const linkIndex = ForwardCrumbs.closestLinkIndex(links, heading);
    if (linkIndex >= 0) return links[linkIndex].panoId;
    if (nextStopPanoId === null || routeHeading === null) return null;
    const routeHasLink = ForwardCrumbs.closestLinkIndex(links, routeHeading) >= 0;
    const facingRoute = ForwardCrumbs.closestLinkIndex([{ heading: routeHeading }], heading) === 0;
    return !routeHasLink && facingRoute ? nextStopPanoId : null;
  }

  /**
   * The pano the spacebar steps to: the same choice KeyboardManager makes, the link nearest the route's direction
   * when one lies within 60° of it (moveToLinkedPano's cosine > 0.5 rule), otherwise the route walk's next stop.
   * Null with no route to follow.
   * @param {Array<{panoId: string, heading: number}>} links - The current pano's links.
   * @param {?number} routeHeading - The route's forward heading from here, or null when there is no route.
   * @param {?string} nextStopPanoId - The nearest route stop ahead, if any.
   * @returns {?string}
   */
  static nextStepPanoId(links, routeHeading, nextStopPanoId) {
    if (routeHeading === null) return null;
    let best = null;
    let bestCosine = 0.5;
    for (const link of links) {
      const cosine = Math.cos(((routeHeading - link.heading) * Math.PI) / 180);
      if (cosine > bestCosine) {
        bestCosine = cosine;
        best = link.panoId;
      }
    }
    return best ?? nextStopPanoId;
  }

  /**
   * Combines the two crumb sources into one list keyed by pano. A route stop wins over a link to the same pano (the
   * link's arrow is the route's forward arrow, so it should read as a route stop). The current pano is left out (the
   * peg marks it); a visited pano stays in, flagged, so that after a backtrack the way forward can still be tinted
   * and filled: the breadcrumb ring alone can't show where the next step goes.
   * @param {MeasuredCrumb[]} stops - Route stops ahead, nearest first.
   * @param {Array<{panoId: string, heading: number, lat: number, lng: number}>} links - Positioned arrow destinations.
   * @param {object} options
   * @param {?string} options.currentPanoId - The pano the user stands on.
   * @param {(panoId: string) => boolean} options.isVisited - Whether the breadcrumb trail already marks a pano.
   * @param {number} options.reachableCount - How many of the nearest route stops are clickable.
   * @returns {Crumb[]}
   */
  static mergeSources(stops, links, { currentPanoId, isVisited, reachableCount }) {
    const crumbs = /** @type {Crumb[]} */ (stops.filter((stop) => stop.panoId !== currentPanoId).map((stop, i) => ({
      panoId: stop.panoId, lat: stop.lat, lng: stop.lng, kind: 'route', clickable: i < reachableCount, rank: i + 1,
      visited: isVisited(stop.panoId),
    })));
    const taken = new Set(crumbs.map((crumb) => crumb.panoId));
    for (const link of links) {
      if (link.panoId === currentPanoId || taken.has(link.panoId)) continue;
      taken.add(link.panoId);
      crumbs.push({
        panoId: link.panoId, lat: link.lat, lng: link.lng, kind: 'link', clickable: true, rank: 0,
        visited: isVisited(link.panoId),
      });
    }
    return crumbs;
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
   * @param {PanoHit[]} hits
   * @returns {PanoHit[]}
   */
  static dedupByPanoId(hits) {
    const seen = new Set();
    return hits.filter((hit) => !seen.has(hit.panoId) && seen.add(hit.panoId));
  }

  /**
   * Locates a pano relative to the street: how far along it the pano projects, and how far off the line it sits.
   * @param {turf.Feature<turf.LineString>} street - The street geometry, in walk direction.
   * @param {PanoHit} hit - A pano the provider found.
   * @returns {MeasuredCrumb}
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
   * Picks the panos that are ahead on this street, nearest first.
   * @param {MeasuredCrumb[]} measured - Panos located by {@link measureAgainstStreet}.
   * @param {object} options
   * @param {number} options.fromKm - Where "ahead" starts: the furthest point reached, along the street.
   * @param {number} options.minAheadM - Panos closer than this to `fromKm` are where the user already is.
   * @param {number} options.maxOffsetM - Panos farther than this from the line are on another street.
   * @returns {MeasuredCrumb[]} In walk order, nearest first.
   */
  static aheadOnStreet(measured, { fromKm, minAheadM, maxOffsetM }) {
    return measured
      .filter((c) => c.offsetM <= maxOffsetM && (c.alongKm - fromKm) * 1000 > minAheadM)
      .sort((a, b) => a.alongKm - b.alongKm);
  }

  /**
   * The task whose street should carry route stops, or null when none should: no route to walk (free exploration,
   * no current task yet) or a finished street (the next one is a jump the compass owns). Arrow-destination crumbs
   * don't depend on this; they draw wherever there are arrows.
   * @returns {?Task}
   */
  #taskToSample() {
    if (svl.isExploreAddressMode() || !svl.taskContainer) return null;
    if (typeof svl.panoViewer.findPanoNear !== 'function') return null;
    const task = svl.taskContainer.getCurrentTask();
    return task && !task.isComplete() ? task : null;
  }

  /**
   * The route's forward heading, or null when there is no route to follow (free exploration, no task, geometry not
   * ready) or the user has left it: the synthesized forward arrow only exists on route, so off route facing the
   * route's direction fills nothing.
   * @returns {?number}
   */
  #routeHeading() {
    if (!svl.compass || !svl.compass.isEnRoute()) return null;
    return this.#targetAngle();
  }

  /**
   * The compass's target heading from the current position (forward on route, back toward it off route), which is
   * where the spacebar aims; null with no route to follow.
   * @returns {?number}
   */
  #targetAngle() {
    if (!svl.compass || svl.isExploreAddressMode() || !svl.taskContainer) return null;
    if (!svl.taskContainer.getCurrentTask()) return null;
    try {
      return (svl.compass.getTargetAngle() + 360) % 360;
    } catch {
      return null;
    }
  }

  /**
   * The current pano's arrow destinations with positions, or none when the provider can't say.
   * @returns {Promise<Array<{panoId: string, heading: number, lat: number, lng: number}>>}
   */
  async #positionedLinks() {
    if (typeof svl.panoViewer.getLinkedPanoPositions !== 'function') return [];
    try {
      return await svl.panoViewer.getLinkedPanoPositions();
    } catch (err) {
      console.warn('Could not position the current pano\'s links:', err);
      return [];
    }
  }

  /**
   * The panos ahead on the task's street, nearest first, from the memoised street sampling.
   * @param {Task} task - The task being walked.
   * @returns {Promise<MeasuredCrumb[]>}
   */
  async #routeStopsAhead(task) {
    const street = task.getFeature();
    const key = ForwardCrumbs.memoKeyFor(task);
    if (key !== this.#memoKey) {
      this.#memoKey = key;
      this.#memo.clear();
      this.#providerFailed = false;
    }

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
          console.warn('Route crumb lookup failed; not sampling further on this street.', err);
          return null;
        })));
      }
      pending.push(this.#memo.get(i));
    });

    const hits = await Promise.all(pending);
    const measured = ForwardCrumbs.dedupByPanoId(hits.filter(Boolean))
      .map((hit) => ForwardCrumbs.measureAgainstStreet(street, hit));
    return ForwardCrumbs.aheadOnStreet(measured, {
      fromKm: originKm, minAheadM: ForwardCrumbs.MIN_AHEAD_M, maxOffsetM: ForwardCrumbs.MAX_OFFSET_M,
    });
  }

  /**
   * Runs a lookup with at most #IN_FLIGHT_LIMIT in flight, queueing the rest in order.
   * @param {() => Promise<*>} lookup - Must not reject (the caller catches before enqueueing).
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
   * Syncs the markers to the wanted crumbs, keyed by pano. A crumb whose kind or clickability changed (a far route
   * stop coming within reach as the user advances) is rebuilt, since clickability is fixed at marker construction.
   * @param {Crumb[]} crumbs
   */
  #render(crumbs) {
    const wanted = new Map(crumbs.map((crumb) => [crumb.panoId, crumb]));
    for (const [panoId, entry] of this.#markers) {
      const want = wanted.get(panoId);
      if (!want || want.kind !== entry.kind || want.clickable !== entry.clickable || want.visited !== entry.visited) {
        entry.marker.map = null;
        this.#markers.delete(panoId);
        if (this.#facedPanoId === panoId) this.#facedPanoId = null;
        if (this.#nextStepPanoId === panoId) this.#nextStepPanoId = null;
        if (this.#highlightedPanoId === panoId) this.#highlightedPanoId = null;
      }
    }
    for (const [panoId, crumb] of wanted) {
      if (!this.#markers.has(panoId)) {
        this.#markers.set(panoId, {
          marker: this.#createMarker(crumb), kind: crumb.kind, clickable: crumb.clickable, visited: crumb.visited,
        });
      }
    }
  }

  /**
   * One crumb marker. Map-positioned, like the visited breadcrumbs, so it tracks zoom without manual projection.
   * @param {Crumb} crumb
   * @returns {google.maps.marker.AdvancedMarkerElement}
   */
  #createMarker(crumb) {
    const content = document.createElement('div');
    // Route stops are small; the spacebar's next step (.minimap-crumb-next, set per refresh) is the one full-size
    // crumb on the route, so the next step stands out whether it is a sampled stop or an arrow's destination.
    content.className = [
      'minimap-crumb',
      `minimap-crumb-${crumb.kind}`,
      crumb.clickable ? '' : 'minimap-crumb-far',
      crumb.kind === 'route' ? 'minimap-crumb-small' : '',
      crumb.visited ? 'minimap-crumb-visited' : '',
    ].join(' ').trim();
    let title;
    if (crumb.kind === 'link') {
      title = i18next.t('audit:right-ui.minimap.link-crumb-title');
    } else if (crumb.clickable) {
      title = i18next.t('audit:right-ui.minimap.forward-crumb-title', { rank: crumb.rank });
    } else {
      title = i18next.t('audit:right-ui.minimap.route-stop-title', { rank: crumb.rank });
    }
    const marker = new google.maps.marker.AdvancedMarkerElement({
      position: new google.maps.LatLng(crumb.lat, crumb.lng),
      map: svl.minimap.getMap(),
      content,
      gmpClickable: crumb.clickable,
      // Above the visited breadcrumbs and label icons, well below the peg (1000), which is click-through anyway.
      zIndex: crumb.clickable ? (crumb.kind === 'route' ? 30 : 25) : 20,
      title, // Hover tooltip and accessible name: every mark on the minimap says what it is.
    });
    if (crumb.clickable) marker.addListener('gmp-click', () => this.#moveTo(crumb));
    return marker;
  }

  /**
   * Steps the user to a crumb's pano. A real move that advances the task, unlike the breadcrumbs' peek back. The
   * pano id is tried first; a provider that no longer serves it (GSV retires panos) gets the same coordinate search
   * moveForward() uses, which lands on whatever now stands there.
   * @param {Crumb} crumb
   * @returns {Promise<void>}
   */
  async #moveTo(crumb) {
    const nav = this.#navigationService;
    if (nav.getStatus('disableWalking')) return;
    this.#tracker.push('Click_MinimapForwardCrumb', { panoId: crumb.panoId, kind: crumb.kind, rank: crumb.rank });
    const moved = await nav.moveToPano(crumb.panoId, false, { alertOnFailure: false });
    if (moved) return;
    this.#tracker.push('ForwardCrumbMove_Fallback', { panoId: crumb.panoId });
    await nav.moveToLocation({ lat: crumb.lat, lng: crumb.lng });
  }
}
