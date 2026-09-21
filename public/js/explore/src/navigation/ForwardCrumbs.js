/**
 * Crumbs on the Explore minimap for where the user can go next (#4669, #4655): a ring at the destination of every
 * on-pano arrow, and rings along the route ahead on the street being audited, including past the gaps where the
 * imagery provider's link graph dead-ends and the arrows fall silent. The crumb the user is facing fills in, so a
 * filled disc has one meaning on the whole map: a step forward takes you here (the up key's own rule for a link; at a
 * link-graph dead end, the synthesized forward arrow or the spacebar). The crumb the spacebar
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
  #markers = new Map(); // panoId -> { marker: MinimapMarker, kind, clickable, visited, rank }.
  #links = []; // The current pano's positioned links, kept for setFacing().
  #walkNextPanoId = null; // The stop the route walk (moveForward) would land on: the first ahead of the furthest point.
  #facedPanoId = null;
  #nextStepPanoId = null; // The crumb the spacebar would step to; tinted until the next refresh moves it.
  #highlightedPanoId = null;
  #memo = new Map(); // sampleIndex -> Promise<?PanoHit> for the street #memoKey names.
  #memoKey = null; // Identity of the traversal the memo belongs to; see memoKeyFor().
  #providerFailed = false; // The last lookup here rejected: stop asking until one answers or the street changes.
  #generation = 0; // Bumped per refresh() and clear(); a refresh whose lookups resolve after either is dropped.
  #inFlight = 0;
  #queue = []; // Pending lookups as { key, run }; a job whose street is no longer current is skipped, not run.

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
      task ? this.#routeStopsAhead(task) : Promise.resolve({ ahead: [], walkNextPanoId: null }),
    ]);
    if (generation !== this.#generation) return; // A newer refresh owns the markers now.

    this.#links = links;
    this.#walkNextPanoId = stops.walkNextPanoId;
    const currentPanoId = svl.panoViewer.getPanoId();
    const crumbs = ForwardCrumbs.mergeSources(stops.ahead, links, {
      currentPanoId,
      isVisited: (panoId) => Boolean(svl.observedArea && svl.observedArea.hasVisited(panoId)),
      reachableCount: ForwardCrumbs.REACHABLE_COUNT,
    });
    this.#render(crumbs);
    this.#markNextStep(ForwardCrumbs.nextStepPanoId(links, this.#targetAngle(), this.#walkNextPanoId));
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
   * Fills in the crumb the user now faces (the one a step forward would take them to) and empties the previous one.
   * Called on every POV change, including every tick of a drag, so it only toggles classes and only computes the
   * route heading (two full-street turf passes) when no link is the way the user faces.
   * @param {number} heading - The live POV heading, degrees clockwise from north.
   */
  setFacing(heading) {
    const panoId = ForwardCrumbs.facedPanoId(this.#links, heading, this.#walkNextPanoId, () => this.#routeHeading());
    if (panoId === this.#facedPanoId) return;
    const previous = this.#markers.get(this.#facedPanoId);
    if (previous) previous.marker.content.classList.remove('minimap-crumb-faced');
    const next = this.#markers.get(panoId);
    if (next) next.marker.content.classList.add('minimap-crumb-faced');
    this.#facedPanoId = next ? panoId : null;
  }

  /**
   * Removes every crumb from the map and disowns any refresh still waiting on lookups, so nothing reappears after
   * (the mission-complete modal clears the map while a fresh street's lookups may still be queued). The route memo
   * is kept, since re-showing the same street is then free.
   */
  clear() {
    this.#generation++;
    for (const { marker } of this.#markers.values()) marker.remove();
    this.#markers.clear();
    this.#links = [];
    this.#walkNextPanoId = null;
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

  /** Outlines the route walk's next stop: where the synthesized route-forward arrow leads (#4682). */
  highlightNextStop() {
    if (this.#walkNextPanoId !== null) this.highlight(this.#walkNextPanoId);
  }

  /**
   * Whether a pano is the route walk's next stop, the one the synthesized route-forward arrow leads to.
   * @param {string} panoId
   * @returns {boolean}
   */
  isWalkNextStop(panoId) {
    return panoId === this.#walkNextPanoId;
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
   * synthesizes a forward arrow instead, #4671); the faced rule uses it to recognize that dead end.
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
   * Index of the link a step toward `heading` takes: NavigationService.moveToLinkedPano's own rule, the link with
   * the largest cosine to the heading when that cosine exceeds one half (within 60°); -1 otherwise. The up key and
   * the spacebar both step through that rule, so the crumb that fills and the crumb that tints follow it too.
   * @param {Array<{heading: number}>} links - The current pano's linked panos.
   * @param {number} heading - The heading to step toward, degrees clockwise from north.
   * @returns {number}
   */
  static stepLinkIndex(links, heading) {
    let bestIndex = -1;
    let bestCosine = 0.5;
    links.forEach((link, i) => {
      const cosine = Math.cos(((heading - link.heading) * Math.PI) / 180);
      if (cosine > bestCosine) {
        bestCosine = cosine;
        bestIndex = i;
      }
    });
    return bestIndex;
  }

  /**
   * The pano a step forward leads to from a heading: the link the up key would take (stepLinkIndex), or, at a
   * link-graph dead end where the on-pano arrow is the synthesized route-forward one, the route walk's next stop
   * when the user faces the route's direction. Null when facing nowhere a step leads.
   * @param {Array<{panoId: string, heading: number}>} links - The current pano's links.
   * @param {number} heading - The live POV heading.
   * @param {?string} walkNextPanoId - The stop the route walk would land on, if any.
   * @param {() => ?number} routeHeading - Yields the route's forward heading, or null when not on a route. A
   *     function, since it costs two full-street turf passes and is only needed when no link is faced.
   * @returns {?string}
   */
  static facedPanoId(links, heading, walkNextPanoId, routeHeading) {
    const linkIndex = ForwardCrumbs.stepLinkIndex(links, heading);
    if (linkIndex >= 0) return links[linkIndex].panoId;
    if (walkNextPanoId === null) return null;
    const routeDeg = routeHeading();
    if (routeDeg === null) return null;
    // The synthesized arrow exists only when no link lies within the route-forward threshold of the route (#4671).
    const routeHasLink = ForwardCrumbs.closestLinkIndex(links, routeDeg) >= 0;
    const facingRoute = ForwardCrumbs.closestLinkIndex([{ heading: routeDeg }], heading) === 0;
    return !routeHasLink && facingRoute ? walkNextPanoId : null;
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
    const linkIndex = ForwardCrumbs.stepLinkIndex(links, routeHeading);
    return linkIndex >= 0 ? links[linkIndex].panoId : nextStopPanoId;
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
    if (!svl.panoViewer.supportsLocationSearch()) return null; // Pannellum: nothing to sample the street with.
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
    try {
      return await svl.panoViewer.getLinkedPanoPositions();
    } catch (err) {
      console.warn('Could not position the current pano\'s links:', err);
      return [];
    }
  }

  /**
   * The panos ahead on the task's street, from the memoised street sampling. "Ahead" is measured from where the user
   * stands, not only from the furthest point reached: after a backtrack the way back up to that point is route too,
   * and its stops must read as route stops (blue when faced), not as mere arrow destinations. The route walk itself
   * (moveForward, the spacebar's fallback) still resumes from the furthest point, so its landing stop is reported
   * separately: the first stop past that point when the user is near it, else (off the street, more than the search
   * radius away) the stop nearest that point, since that is where moveForward's coordinate search then starts.
   * @param {Task} task - The task being walked.
   * @returns {Promise<{ahead: MeasuredCrumb[], walkNextPanoId: ?string}>} Stops nearest first, and the walk's stop.
   */
  async #routeStopsAhead(task) {
    const street = task.getFeature();
    const key = ForwardCrumbs.memoKeyFor(task);
    if (key !== this.#memoKey) {
      this.#memoKey = key;
      this.#memo.clear();
      this.#providerFailed = false;
    }

    const furthestKm = turf.nearestPointOnLine(street, task.getFurthestPointReached()).properties.location;
    const here = svl.panoViewer.getPosition();
    const hereKm = turf.nearestPointOnLine(street, turf.point([here.lng, here.lat])).properties.location;
    const originKm = Math.min(furthestKm, hereKm);
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
        this.#memo.set(i, this.#enqueue(key, () => svl.panoViewer.findPanoNear({ lat, lng }).then((hit) => {
          this.#providerFailed = false; // An answer, empty or not: the provider is reachable again.
          return hit;
        }, (err) => {
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
    const window = { minAheadM: ForwardCrumbs.MIN_AHEAD_M, maxOffsetM: ForwardCrumbs.MAX_OFFSET_M };
    const ahead = ForwardCrumbs.aheadOnStreet(measured, { fromKm: originKm, ...window });
    const metersFromFurthest = turf.distance(
      turf.point([here.lng, here.lat]), task.getFurthestPointReached(), { units: 'meters' },
    );
    const walkNext = ForwardCrumbs.walkLandingStop(measured, furthestKm, metersFromFurthest, {
      ...window, searchRadiusM: svl.STREETVIEW_MAX_DISTANCE,
    });
    return { ahead, walkNextPanoId: walkNext ? walkNext.panoId : null };
  }

  /**
   * The stop the route walk lands on, mirroring NavigationService.#computeMoveTarget: near the furthest point the
   * walk searches one step beyond it, so the first stop ahead of it; farther away (off the street) it searches at
   * the furthest point itself, so the stop nearest that point.
   * @param {MeasuredCrumb[]} measured - Panos located by {@link measureAgainstStreet}.
   * @param {number} furthestKm - The furthest point reached, along the street.
   * @param {number} metersFromFurthest - How far the user stands from that point.
   * @param {object} options
   * @param {number} options.minAheadM - As for {@link aheadOnStreet}.
   * @param {number} options.maxOffsetM - As for {@link aheadOnStreet}.
   * @param {number} options.searchRadiusM - The walk's own search radius; beyond it the user counts as off the street.
   * @returns {?MeasuredCrumb}
   */
  static walkLandingStop(measured, furthestKm, metersFromFurthest, { minAheadM, maxOffsetM, searchRadiusM }) {
    if (metersFromFurthest <= searchRadiusM) {
      return ForwardCrumbs.aheadOnStreet(measured, { fromKm: furthestKm, minAheadM, maxOffsetM })[0] ?? null;
    }
    const onStreet = measured.filter((c) => c.offsetM <= maxOffsetM);
    if (onStreet.length === 0) return null;
    return onStreet.reduce((best, c) => (
      Math.abs(c.alongKm - furthestKm) < Math.abs(best.alongKm - furthestKm) ? c : best
    ));
  }

  /**
   * Runs a lookup with at most #IN_FLIGHT_LIMIT in flight, queueing the rest in order. A queued lookup for a street
   * the user has since left is skipped (resolving null) rather than run, so a long street's leftover samples never
   * delay the next street's, and their failures can't be blamed on it.
   * @param {string} key - The memo key of the street the lookup belongs to.
   * @param {() => Promise<*>} lookup - Must not reject (the caller catches before enqueueing).
   * @returns {Promise<*>}
   */
  #enqueue(key, lookup) {
    return new Promise((resolve) => {
      this.#queue.push({ key, run: () => lookup().then(resolve, () => resolve(null)), skip: () => resolve(null) });
      this.#drain();
    });
  }

  /** Starts queued lookups while there is room, dropping those whose street is no longer current. */
  #drain() {
    while (this.#inFlight < ForwardCrumbs.#IN_FLIGHT_LIMIT && this.#queue.length > 0) {
      const job = this.#queue.shift();
      if (job.key !== this.#memoKey) {
        job.skip();
        continue;
      }
      this.#inFlight++;
      job.run().finally(() => {
        this.#inFlight--;
        this.#drain();
      });
    }
  }

  /**
   * Syncs the markers to the wanted crumbs, keyed by pano. A crumb whose kind, clickability, visited state or rank
   * changed (a far route stop coming within reach, a stop renumbering as the user advances) is rebuilt, since all
   * four are baked into the marker at construction: its classes, its click handler and its tooltip.
   * @param {Crumb[]} crumbs
   */
  #render(crumbs) {
    const wanted = new Map(crumbs.map((crumb) => [crumb.panoId, crumb]));
    for (const [panoId, entry] of this.#markers) {
      const want = wanted.get(panoId);
      const changed = !want || want.kind !== entry.kind || want.clickable !== entry.clickable
        || want.visited !== entry.visited || want.rank !== entry.rank;
      if (changed) {
        entry.marker.remove();
        this.#markers.delete(panoId);
        if (this.#facedPanoId === panoId) this.#facedPanoId = null;
        if (this.#nextStepPanoId === panoId) this.#nextStepPanoId = null;
        if (this.#highlightedPanoId === panoId) this.#highlightedPanoId = null;
      }
    }
    for (const [panoId, crumb] of wanted) {
      if (!this.#markers.has(panoId)) {
        this.#markers.set(panoId, {
          marker: this.#createMarker(crumb),
          kind: crumb.kind,
          clickable: crumb.clickable,
          visited: crumb.visited,
          rank: crumb.rank,
        });
      }
    }
  }

  /**
   * One crumb marker. Map-positioned, like the visited breadcrumbs, so it tracks zoom without manual projection.
   * @param {Crumb} crumb
   * @returns {MinimapMarker}
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
    // A far crumb over a visited pano sits exactly on that pano's breadcrumb and takes its pointer, so it also takes
    // over the breadcrumb's job: a click peeks back there rather than doing nothing (#2561).
    const peeks = !crumb.clickable && crumb.visited;
    let title;
    if (peeks) {
      title = i18next.t('audit:right-ui.minimap.breadcrumb-title');
    } else if (crumb.kind === 'link') {
      title = i18next.t('audit:right-ui.minimap.link-crumb-title');
    } else if (crumb.clickable) {
      title = i18next.t('audit:right-ui.minimap.forward-crumb-title', { rank: crumb.rank });
    } else {
      title = i18next.t('audit:right-ui.minimap.route-stop-title', { rank: crumb.rank });
    }
    let onClick = null;
    if (peeks) {
      onClick = () => {
        this.#tracker.push('Click_MinimapBreadcrumb', { panoId: crumb.panoId });
        this.#navigationService.returnToPano(crumb.panoId);
      };
    } else if (crumb.clickable) {
      onClick = () => this.#moveTo(crumb);
    }
    const marker = svl.minimap.addMarker({ lat: crumb.lat, lng: crumb.lng }, content, {
      onClick,
      // Above the visited breadcrumbs and label icons, well below the peg (1000), which is click-through anyway.
      zIndex: crumb.clickable ? (crumb.kind === 'route' ? 30 : 25) : 20,
      title, // Hover tooltip and accessible name: every mark on the minimap says what it is.
    });
    if (crumb.clickable) {
      // Hovering or focusing a crumb lights the on-pano arrow that leads to it, the reverse of hovering the arrow
      // (#4682). Focus lands on the marker's wrapper element, which is what the keyboard reaches.
      const light = () => svl.panoManager && svl.panoManager.highlightArrowTo(crumb.panoId);
      const unlight = () => svl.panoManager && svl.panoManager.clearArrowHighlight();
      content.addEventListener('mouseenter', light);
      content.addEventListener('mouseleave', unlight);
      marker.element.addEventListener('focus', light);
      marker.element.addEventListener('blur', unlight);
    }
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
