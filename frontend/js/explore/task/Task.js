/**
 * One street to audit: its geometry (oriented the way it is walked), how far along it the labeler has been, and its
 * state. TaskContainer decides how it is drawn on the minimap; this only says what its lines are.
 */

import * as turf from '@turf/turf';
import { PanoViewer } from '../../common/pano-viewer/PanoViewer.js';
import { util } from '../../common/utilities.js';
import '../../common/utilitiesMath.js';
/** @typedef {import('../navigation/Minimap.js').MinimapStreetLine} MinimapStreetLine */

/**
 * Free exploration's street-credit rule (#5733), as the backend (StreetCoverage) states it.
 * @typedef {object} StreetCoverage
 * @property {number} pano_window_m - Meters either side of a pano that count as seen.
 * @property {number} max_hop_m - The longest hop between on-street panos that still counts as walked.
 * @property {number} max_uncovered_m - How much of a street may stay unseen for it to count as covered.
 * @property {number} min_covered_frac - How much of a street must be seen for it to count as covered.
 */

export class Task {
  // Ceiling on any "am I at the end of this street?" threshold, as a fraction of the street's length. Keeps a
  // fixed metre distance from swallowing most of a short street.
  static END_PROXIMITY_MAX_FRACTION = 0.4;
  // How far from the street's line a position may sit and still count as on the street: past it a pano can neither
  // advance the furthest point reached nor finish the street. GsvViewer holds Google's replies to the search radius
  // (#5114); Mapillary and Panoramax search a square box of that half-width, so it bounds their landings only roughly.
  static ON_STREET_MAX_DISTANCE_M = PanoViewer.SEARCH_RADIUS_M;
  // How far (km) from a street's line the labeler may stand and still count as on it: advancing along it, the
  // compass's on-route check, and picking up the next street all use it.
  static CLOSE_TO_ROUTE_KM = 0.05;

  #streetCoverage;
  #geojson;

  /* @type {GeoJSON.Point} */
  #furthestPoint;

  /** @type {Array<[number, number]>} Merged [start_m, end_m] pairs seen, in the server's frame (#5733). */
  #coveredRanges = [];
  // The previous on-street pano's position along the street, so the stretch to the next one can count as walked.
  #lastOnStreetM = null;

  #missionStarts = {};
  #status = {
    isComplete: false,
    // Set when an imagery sweep ran out here and moved the labeler on, either in this session or earlier in this
    // walk of the route (the server reports the latter as reported_no_imagery). Deliberately not isComplete: that
    // flag is submitted as audit_task.completed (Form.js), and a no-imagery verdict may not claim an audit (#4922).
    givenUpOnImagery: false,
    // Set when the server hands this street back as unfinished work rather than as a fresh street (#5370). Anything
    // that would restart the street — flipping its direction, restamping task_start, drawing it as untouched — has to
    // leave such a task alone, or the labeler re-walks and re-labels what they already did.
    resumed: false,
    // Whether this task came from the mid-session /tasks list rather than the page payload. What tells a genuine
    // pick-up of an abandoned street from an ordinary reload of the street in progress, which look identical on the
    // task itself — both carry an open audit_task row (#5370).
    fromTaskList: false,
    // Whether the distance walked before this session has been handed to the mission bar yet; see claimSavedProgress.
    progressClaimed: false,
  };

  #properties = {
    auditTaskId: null,
    streetEdgeId: null,
    completedByAnyUser: null,
    needsReaudit: false,
    mappedByThisUser: false,
    lastMappedAt: null,
    newImageryDate: null,
    priority: null,
    taskStart: null,
    currentMissionId: null,
    startPointReversed: false,
    tutorialTask: null,
    wayType: null,
    maxSpeed: null,
    routeStreetId: null,
    routeStreetPosition: null,
  };

  /**
   * @param {GeoJSON.Feature<GeoJSON.LineString>} geojson
   * @param {StreetCoverage} streetCoverage - Free exploration's credit rule, for recordVisit and isCoveredEnough.
   * @param {boolean} tutorialTask
   * @param {{lat: number, lng: number}} [currentLatLng] - The user's current lat/lng to use if resuming.
   */
  constructor(geojson, streetCoverage, tutorialTask, currentLatLng) {
    this.#streetCoverage = streetCoverage;
    this.#properties.tutorialTask = tutorialTask;
    this.initialize(geojson, currentLatLng);
  }

  /**
   * This method takes a task parameters and set up the current task.
   * @param {GeoJSON.Feature<GeoJSON.LineString>} geojson - The GeoJSON representation of the street
   * @param {{lat: number, lng: number}} [currentLatLng] - The user's current lat/lng to use if resuming
   */
  initialize(geojson, currentLatLng) {
    this.#geojson = geojson;
    const currMissionId = this.#geojson.properties.current_mission_id;
    // Where the current mission began on this street, as ExploreFormats.pointWrites serializes it: {lat, lng}.
    // Read back so a resumed mission keeps its start (the minimap's start flag, the mission-complete map).
    const currMissionStart = this.#geojson.properties.current_mission_start;

    this.setProperty('streetEdgeId', this.#geojson.properties.street_edge_id);
    this.setProperty('completedByAnyUser', this.#geojson.properties.completed_by_any_user);
    // Audited before, but every completed audit predates newer imagery (#4895). `lastMappedAt` follows
    // `mappedByThisUser`: their own last audit if they mapped it, the street's otherwise.
    this.setProperty('needsReaudit', Boolean(this.#geojson.properties.needs_reaudit));
    this.setProperty('mappedByThisUser', Boolean(this.#geojson.properties.mapped_by_this_user));
    this.setProperty('lastMappedAt', this.#geojson.properties.last_mapped_at ?? null);
    this.setProperty('newImageryDate', this.#geojson.properties.new_imagery_date ?? null);
    this.setProperty('priority', this.#geojson.properties.priority);
    this.setProperty('currentMissionId', currMissionId);
    this.setProperty('auditTaskId', this.#geojson.properties.audit_task_id);
    this.setProperty('wayType', this.#geojson.properties.way_type);
    this.setProperty('maxSpeed', this.#geojson.properties.max_speed);
    this.setProperty('routeStreetId', this.#geojson.properties.route_street_id);
    this.setProperty('routeStreetPosition', this.#geojson.properties.route_street_position);
    this.setProperty('taskStart', new Date(this.#geojson.properties.task_start));
    if (this.#geojson.properties.completed) {
      this.#status.isComplete = true;
    }
    if (this.#geojson.properties.reported_no_imagery) {
      this.#status.givenUpOnImagery = true;
    }
    // An audit_task row that isn't complete is work in progress: this street was left part-walked (#5370).
    if (this.#geojson.properties.audit_task_id && !this.#geojson.properties.completed) {
      this.#status.resumed = true;
    }
    if (this.#geojson.properties.start_point_reversed) {
      this.reverseStreetDirection();
    }
    if (currMissionId && currMissionStart) {
      this.setMissionStart(currMissionId, { lat: currMissionStart.lat, lng: currMissionStart.lng });
    }
    // Clipped to turf's length: the server's can run a few decimeters longer, which the minimap slicing can't take.
    this.#coveredRanges = Array.isArray(this.#geojson.properties.covered_ranges)
      ? Task.mergeRanges(this.#geojson.properties.covered_ranges, this.lineDistance({ units: 'meters' }))
      : [];
    // After the direction, never before it: reversing re-seeds the furthest point from the new first coordinate, so a
    // saved position applied first would be thrown away and the walked stretch measured from the wrong end.
    if (currentLatLng) {
      this.#furthestPoint = turf.point([currentLatLng.lng, currentLatLng.lat]);
    } else {
      this.#furthestPoint = turf.point(this.#geojson.geometry.coordinates[0]);
    }
  }

  reverseStreetDirection() {
    this.reverseCoordinates();
    this.#properties.startPointReversed = !this.#properties.startPointReversed;
    this.#furthestPoint = turf.point(this.#geojson.geometry.coordinates[0]);
  }

  /**
   * Choose whether to reverse street direction based on the current position (should be where prev task ends).
   * @param {{lat: number, lng: number}} currentLatLng - User's current position
   */
  setStreetEdgeDirection(currentLatLng) {
    const lat1 = this.#geojson.geometry.coordinates[0][1];
    const lng1 = this.#geojson.geometry.coordinates[0][0];
    const lat2 = this.#geojson.geometry.coordinates[this.#geojson.geometry.coordinates.length - 1][1];
    const lng2 = this.#geojson.geometry.coordinates[this.#geojson.geometry.coordinates.length - 1][0];
    const d1 = util.math.haversine({ lat: lat1, lng: lng1 }, currentLatLng);
    const d2 = util.math.haversine({ lat: lat2, lng: lng2 }, currentLatLng);

    // If current position is closer to the end point than the start point, reverse the street direction.
    if (d2 < d1) {
      this.reverseStreetDirection();
    }
  }

  /**
   * The current street as the minimap draws it: the audited half and the walk-this-way half (#4639).
   * @returns {MinimapStreetLine[]}
   */
  #currentStreetLines() {
    return [
      { kind: 'audited', coordinates: this.#getPointsOnAuditedSegments() },
      { kind: 'remaining', coordinates: this.#getPointsOnUnauditedSegments() },
    ];
  }

  #coordinatesToSegments(coordinates) {
    const returnSegments = [];
    for (let i = 1, len = coordinates.length; i < len; i++) {
      returnSegments.push(turf.lineString([
        [coordinates[i - 1][0], coordinates[i - 1][1]],
        [coordinates[i][0], coordinates[i][1]],
      ]));
    }
    return returnSegments;
  }

  #getPointsOnAuditedSegments() {
    const startCoord = this.getStartCoordinate();
    const endCoord = this.getFurthestPointReached().geometry.coordinates;
    return this.getSubsetOfCoordinates(startCoord, { lat: endCoord[1], lng: endCoord[0] });
  }

  #getPointsOnUnauditedSegments() {
    const startCoord = this.getFurthestPointReached().geometry.coordinates;
    const endCoord = this.getEndCoordinate();
    return this.getSubsetOfCoordinates({ lat: startCoord[1], lng: startCoord[0] }, endCoord);
  }

  getSubsetOfCoordinates(fromLatLng, toLatLng) {
    const startPoint = turf.point([fromLatLng.lng, fromLatLng.lat]);
    const endPoint = turf.point([toLatLng.lng, toLatLng.lat]);
    const slicedLine = turf.lineSlice(startPoint, endPoint, this.#geojson);
    return turf.cleanCoords(slicedLine).geometry.coordinates;
  }

  #getSegmentsToAPoint(latLng) {
    const startCoord = this.getStartCoordinate();
    const coordinates = this.getSubsetOfCoordinates(startCoord, latLng);
    return this.#coordinatesToSegments(coordinates);
  }

  #hasAdvanced(currentLatLng) {
    if (typeof this.#furthestPoint === 'undefined') return false;
    const latFurthest = this.#furthestPoint.geometry.coordinates[1];
    const lngFurthest = this.#furthestPoint.geometry.coordinates[0];
    const distanceAtTheFurthestPoint = this.getDistanceFromStart({ lat: latFurthest, lng: lngFurthest });
    const distanceAtCurrentPoint = this.getDistanceFromStart(currentLatLng);

    const streetEdge = this.#geojson;
    const currentPosition = turf.point([currentLatLng.lng, currentLatLng.lat]);
    const snappedPosition = turf.nearestPointOnLine(streetEdge, currentPosition);

    return (distanceAtTheFurthestPoint < distanceAtCurrentPoint)
      && turf.distance(currentPosition, snappedPosition, { units: 'meters' }) < Task.ON_STREET_MAX_DISTANCE_M;
  }

  /**
   * Set the isComplete status to true.
   */
  complete() {
    this.#status.isComplete = true;
    this.#properties.completedByAnyUser = true;
    this.#properties.needsReaudit = false;
    this.#properties.mappedByThisUser = true; // They have now mapped it, whoever did the earlier pass.
    this.#properties.priority = 1 / (1 + (1 / this.#properties.priority));
  }

  getAuditTaskId() {
    return this.#properties.auditTaskId;
  }

  /**
   * Get the GeoJSON representation of the street.
   * @returns {?GeoJSON.Feature<GeoJSON.LineString>}
   */
  getFeature() {
    return this.#geojson ? this.#geojson : null;
  }

  /**
   * Get the GeoJSON representation of the street.
   * TODO why do we have both this and getFeature()? Can the geojson be null ever? During initialization maybe..?
   * @returns {GeoJSON.Feature<GeoJSON.LineString>}
   */
  getGeoJSON() {
    return this.#geojson;
  }

  /**
   * Get the last coordinate in the geojson.
   * @returns {{lat: number, lng: number}}
   */
  getEndCoordinate() {
    const len = this.#geojson.geometry.coordinates.length - 1;
    return { lat: this.#geojson.geometry.coordinates[len][1], lng: this.#geojson.geometry.coordinates[len][0] };
  }

  /**
   * Return the property.
   * @param {string} key - Field name
   * @returns {null}
   */
  getProperty(key) {
    return key in this.#properties ? this.#properties[key] : null;
  }

  /**
   * Get the first coordinate in the geojson
   * @returns {{lat: number, lng: number}}
   */
  getStartCoordinate() {
    return { lat: this.#geojson.geometry.coordinates[0][1], lng: this.#geojson.geometry.coordinates[0][0] };
  }

  /**
   * Returns the street edge id of the current task.
   */
  getStreetEdgeId() {
    return this.#geojson.properties.street_edge_id;
  }

  getStreetPriority() {
    return this.#properties.priority;
  }

  /**
   * This task's place in a route's walking order, for sorting route tasks.
   *
   * Position is the real ordering — an editable route can insert a street mid-route, so the serial routeStreetId
   * only orders correctly for routes saved before editing existed.
   *
   * @returns {?number} null when the task isn't part of a route.
   */
  getWalkOrder() {
    return this.#properties.routeStreetPosition ?? this.#properties.routeStreetId;
  }

  /**
   * Returns an integer in the range 0 to n-1, where larger n means higher priority.
   *
   * Explanation:
   * We want to split the range [0,1] into n = 4 ranges, each sub-range has a length of 1 / n = 1 / 4 = 0.25.
   * To get the discretized order, we take the floor(priority / 0.25), which brings [0,0.25) -> 0, [0.25,0.5) -> 1,
   * [0.5,0.75) -> 2, [0.75,1) -> 3, and 1 -> 4. But we really want [0.75-1] -> 3, so instead of
   * floor(priority / (1 / n)), we have min(floor(priority / (1 / n)), n - 1).
   * @returns {number}
   */
  getStreetPriorityDiscretized() {
    const n = 4;
    return Math.min(Math.floor(this.#geojson.properties.priority / (1 / n)), n - 1);
  }

  /**
   * @param {{units: import('@turf/turf').Units}} [units={units: 'kilometers'}] - The distance unit
   * @returns {number}
   */
  getAuditedDistance(units = { units: 'kilometers' }) {
    if (typeof this.#furthestPoint === 'undefined') return 0;
    const latFurthest = this.#furthestPoint.geometry.coordinates[1];
    const lngFurthest = this.#furthestPoint.geometry.coordinates[0];
    return this.getDistanceFromStart({ lat: latFurthest, lng: lngFurthest }, units);
  }

  /**
   * Credits what a pano shows of this street (#5733): a window either side of it, plus the stretch back to the previous
   * on-street pano when the hop is short enough to have been walked. A pano off the street breaks that chain.
   *
   * @param {{lat: number, lng: number}} latLng - The pano the labeler is standing at.
   * @returns {boolean} Whether the pano counted as on this street.
   */
  recordVisit(latLng) {
    const point = turf.point([latLng.lng, latLng.lat]);
    const snapped = turf.nearestPointOnLine(this.#geojson, point, { units: 'meters' });
    if (snapped.properties.dist > Task.ON_STREET_MAX_DISTANCE_M) {
      this.#lastOnStreetM = null;
      return false;
    }
    const lengthM = this.lineDistance({ units: 'meters' });
    // Measured from the server's first coordinate, so a revisit from the other end lands in the same frame.
    const alongM = this.#properties.startPointReversed
      ? lengthM - snapped.properties.location
      : snapped.properties.location;
    const windowM = this.#streetCoverage.pano_window_m;
    /** @type {Array<[number, number]>} */
    const ranges = [...this.#coveredRanges, [alongM - windowM, alongM + windowM]];
    if (this.#lastOnStreetM !== null && Math.abs(alongM - this.#lastOnStreetM) <= this.#streetCoverage.max_hop_m) {
      ranges.push([Math.min(alongM, this.#lastOnStreetM), Math.max(alongM, this.#lastOnStreetM)]);
    }
    this.#coveredRanges = Task.mergeRanges(ranges, lengthM);
    this.#lastOnStreetM = alongM;
    return true;
  }

  /**
   * Ends the chain of consecutive on-street panos when the labeler leaves for another street: coming back within a
   * hop of where they left would otherwise credit the stretch between as walked.
   */
  resetVisitChain() {
    this.#lastOnStreetM = null;
  }

  /**
   * The same merge as the server's StreetCoverage.merge, so both sides agree on what a list means.
   *
   * @param {Array<[number, number]>} ranges - Any mix of ranges, in any order.
   * @param {number} lengthM - The street's length in meters.
   * @returns {Array<[number, number]>} Clipped to the street, sorted, disjoint, to a decimeter.
   */
  static mergeRanges(ranges, lengthM) {
    // Rounded first, then clipped: rounding after could push an end past the street, which turf can't slice.
    const roundDm = (m) => Math.round(m * 10) / 10;
    const clip = (m) => Math.min(Math.max(roundDm(m), 0), lengthM);
    const clipped = ranges
      .filter((range) => Array.isArray(range) && range.length === 2 && range.every(Number.isFinite))
      .map(([startM, endM]) => [clip(startM), clip(endM)])
      .filter(([startM, endM]) => endM > startM)
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const merged = [];
    for (const [startM, endM] of clipped) {
      const last = merged[merged.length - 1];
      if (last && startM <= last[1]) last[1] = Math.max(last[1], endM);
      else merged.push([startM, endM]);
    }
    return merged;
  }

  /** @returns {Array<[number, number]>} A copy of the covered ranges, in the server's frame. */
  getCoveredRanges() {
    return this.#coveredRanges.map(([startM, endM]) => [startM, endM]);
  }

  /** @param {Array<[number, number]>} ranges - The server's merged list, which can hold an earlier session's. */
  setCoveredRanges(ranges) {
    this.#coveredRanges = Task.mergeRanges(ranges, this.lineDistance({ units: 'meters' }));
  }

  /** @returns {number} Meters of this street the covered ranges add up to. */
  getCoveredDistanceM() {
    return this.#coveredRanges.reduce((sum, [startM, endM]) => sum + (endM - startM), 0);
  }

  /**
   * Mirrors the server's StreetCoverage.coveredEnough, so the minimap can show the street as done the moment it is.
   * @returns {boolean}
   */
  isCoveredEnough() {
    if (this.#coveredRanges.length === 0) return false;
    const lengthM = this.lineDistance({ units: 'meters' });
    const coveredM = this.getCoveredDistanceM();
    return Math.max(0, lengthM - coveredM) <= this.#streetCoverage.max_uncovered_m
      && coveredM >= this.#streetCoverage.min_covered_frac * lengthM;
  }

  /**
   * The covered ranges as pieces of the street's geometry, for the minimap.
   * @param {MinimapStreetLine['kind']} kind - The MinimapStyle line kind to draw them as.
   * @returns {MinimapStreetLine[]}
   */
  #coveredLines(kind) {
    const lengthM = this.lineDistance({ units: 'meters' });
    return this.#coveredRanges.map(([startM, endM]) => {
      // The ranges sit in the server's frame; the geometry may have been reversed to walk the other way.
      const [fromM, toM] = this.#properties.startPointReversed ? [lengthM - endM, lengthM - startM] : [startM, endM];
      const piece = turf.lineSliceAlong(this.#geojson, fromM, toM, { units: 'meters' });
      return { kind, coordinates: piece.geometry.coordinates };
    });
  }

  /**
   * Get the cumulative distance.
   *
   * @param {{lat: number, lng: number}} latLng - The point to measure the distance from the start
   * @param {{units: import('@turf/turf').Units}} [units] - The distance unit, default 'kilometers'
   * @returns {number} Distance in meters
   */
  getDistanceFromStart(latLng, units) {
    if (!units) units = { units: 'kilometers' };
    let distance = 0;
    const walkedSegments = this.#getSegmentsToAPoint(latLng);

    for (let i = 0, len = walkedSegments.length; i < len; i++) {
      distance += turf.length(walkedSegments[i], units);
    }
    return distance;
  }

  /**
   * Whether a position counts as the end of this street.
   *
   * Two ways to qualify. Within `threshold` of the endpoint, where the threshold is capped at a fraction of the
   * street's length: a distance that reads as "basically at the end" of a full block is most of a short one, and
   * every caller inherits that, so the cap lives here rather than at each call site (#4640). Or past or beside it:
   * the position projects onto the street within that capped distance of the endpoint, is within the uncapped
   * `threshold` of it, and is close enough to the street's line to count as on the street at all. Imagery is under
   * no obligation to put a pano near a street's endpoint — Mapillary spacing is 10–15 m, and a divided road chops
   * residential streets into stubs shorter than that — so on the capped test alone a short street can be
   * unfinishable from every pano that exists, and the labeler cycles the panos around its endpoint forever (#5350).
   * The uncapped bound is what keeps a pano well down the next street from counting as the end of this one, and the
   * on-street bound is the same one #hasAdvanced applies, so a pano that could never have advanced along the street
   * cannot finish it either.
   *
   * @param {{lat: number, lng: number}} latLng - The user's current location
   * @param {number} [threshold=10] - Distance threshold in meters
   * @returns {boolean} false if the task has no geometry yet.
   */
  isAtEnd(latLng, threshold = 10) {
    if (!this.#geojson) return false;
    const coords = this.#geojson.geometry.coordinates;
    const end = { lat: coords[coords.length - 1][1], lng: coords[coords.length - 1][0] };
    const streetLengthM = this.lineDistance({ units: 'meters' });
    const effectiveThreshold = streetLengthM > 0
      ? Math.min(threshold, streetLengthM * Task.END_PROXIMITY_MAX_FRACTION)
      : threshold;
    const distToEnd = util.math.haversine(latLng, end);
    if (distToEnd < effectiveThreshold) return true;
    if (distToEnd >= threshold) return false;
    const point = turf.point([latLng.lng, latLng.lat]);
    return turf.pointToLineDistance(point, this.#geojson, { units: 'meters' }) < Task.ON_STREET_MAX_DISTANCE_M
      && this.getDistanceFromStart(latLng, { units: 'meters' }) >= streetLengthM - effectiveThreshold;
  }

  /**
   * Returns if the task was completed or not.
   * @returns {boolean}
   */
  isComplete() {
    return this.#status.isComplete;
  }

  /**
   * Records that this session's imagery sweep ran out here and the labeler was moved on, so navigation stops
   * offering the street back and the minimap stops drawing it as unwalked. Nothing about this reaches the server.
   */
  giveUpOnImagery() {
    this.#status.givenUpOnImagery = true;
  }

  /**
   * @returns {boolean} Whether this session already gave up on the street for lack of imagery.
   */
  wasGivenUpOnImagery() {
    return this.#status.givenUpOnImagery;
  }

  /**
   * Whether this street came back as the labeler's own unfinished work rather than as a fresh street (#5370).
   *
   * True of any task backed by an open audit_task row, which includes the street already in progress on an ordinary
   * page load and a free-exploration drop-in (#4451) — those carry an id too. That breadth is right for the guards
   * (none of them should restart such a street) but wrong for counting resumes; see `cameFromTaskList`.
   *
   * @returns {boolean} True when an incomplete audit_task row backs this task.
   */
  isResumed() {
    return this.#status.resumed;
  }

  /**
   * Records that this task came from the mid-session `/tasks` list rather than from the page payload.
   *
   * @returns {void}
   */
  markFromTaskList() {
    this.#status.fromTaskList = true;
  }

  /**
   * Whether this task came from the mid-session `/tasks` list.
   *
   * With `isResumed()`, this is what identifies the case #5370 is about: the chooser landing on a street the labeler
   * abandoned earlier. The page payload's task never reaches here, so a reload of the street in progress and a
   * drop-in session are both excluded.
   *
   * @returns {boolean}
   */
  cameFromTaskList() {
    return this.#status.fromTaskList;
  }

  /**
   * The distance already walked on this street before this session, handed over exactly once.
   *
   * The mission bar counts the current street's audited distance, so switching onto a street with metres already on
   * it would jump the bar by that much — the server's mission progress already includes them. Single-shot as a
   * defence against `setCurrentTask` being called twice for the same task (a re-render, a jump that resolves to the
   * street already current), which would otherwise subtract those metres from the offset a second time.
   *
   * @returns {number} Kilometres walked before this session, or 0 if they have already been claimed.
   */
  claimSavedProgress() {
    if (this.#status.progressClaimed) return 0;
    this.#status.progressClaimed = true;
    return this.getAuditedDistance();
  }

  /**
   * Checks if the current task is connected to the given task.
   *
   * A part-walked target is measured from where the labeler will actually land on it — its furthest point reached —
   * not from its endpoints. Connectivity is what decides whether the switch shows the label-before-jump prompt, so a
   * street that starts at this junction but was already walked 70 m in would otherwise teleport the labeler into the
   * middle of it with no warning (#5370).
   *
   * @param {Task} task - The task to check if this task is close to
   * @param {number} threshold - Distance threshold in km, unless specified in unit parameter
   * @param {{units: import('@turf/turf').Units}} [units] - The distance unit, default 'kilometers'
   * @returns {boolean} true this task's endpoint is within threshold distance of either endpoint of given task
   */
  isConnectedTo(task, threshold, units) {
    if (!units) units = { units: 'kilometers' };

    const lastCoordinate = this.getEndCoordinate();
    const p = turf.point([lastCoordinate.lng, lastCoordinate.lat]);
    const targetStart = task.getStartCoordinate();
    const targetEnd = task.getEndCoordinate();
    const targets = task.isResumed()
      ? [task.getFurthestPointReached()]
      : [turf.point([targetStart.lng, targetStart.lat]), turf.point([targetEnd.lng, targetEnd.lat])];

    return targets.some((target) => turf.distance(p, target, units) < threshold);
  }

  /**
   * Get the line distance of the task street edge
   * @param {{units: import('@turf/turf').Units}} [units] - The distance unit, default 'kilometers'
   * @returns {number} The length of the street in the given units
   */
  lineDistance(units) {
    if (!units) units = { units: 'kilometers' };
    return turf.length(this.#geojson, units);
  }

  /**
   * The point halfway along the street.
   *
   * Preferred over either endpoint when asking a geocoder what this street is called: endpoints sit at
   * intersections, where the nearest named thing is as likely to be the cross street.
   *
   * @returns {{lat: number, lng: number}} The midpoint of the street geometry.
   */
  getMidpoint() {
    const midpoint = turf.along(this.#geojson, this.lineDistance() / 2);
    return { lat: midpoint.geometry.coordinates[1], lng: midpoint.geometry.coordinates[0] };
  }

  /**
   * What identifies this task's lines on the minimap. A route can walk a street twice (out and back), as two tasks
   * with one street id, so on a route it's the route_street row; a region has each street once.
   * @returns {string}
   */
  minimapKey() {
    const routeStreetId = this.getProperty('routeStreetId') ?? null;
    return routeStreetId !== null ? `route-street-${routeStreetId}` : `street-${this.getStreetEdgeId()}`;
  }

  /**
   * This street's lines on the minimap, in the encoding that fits its state (see MinimapStyle.streetLayers). A half
   * that turf slices down to a single point, when the furthest point sits on an endpoint, is dropped by the minimap.
   *
   * @param {object} context - What the task can't know on its own.
   * @param {boolean} context.exploreAddressMode - Free exploration draws only what the labeler has earned (#5733,
   *   #4451): with no route, unwalked streets and the walk-this-way half stay off the map.
   * @param {boolean} context.current - Whether this is the street being walked.
   * @param {boolean} context.route - Whether the streets form a designated route.
   * @returns {MinimapStreetLine[]} Nothing to draw is an empty list.
   */
  minimapLines({ exploreAddressMode, current, route }) {
    const wholeStreet = (kind) => [{ kind, coordinates: this.#geojson.geometry.coordinates }];

    if (exploreAddressMode) {
      if (this.isComplete() || this.isCoveredEnough()) return wholeStreet('completed');
      if (this.#coveredRanges.length > 0) return this.#coveredLines('completed');
      return [];
    }

    // A street this session gave up on for lack of imagery draws as walked: the labeler did everything the tool let
    // them, and a grey gap in an otherwise finished route reads as their omission.
    if (this.isComplete() || this.wasGivenUpOnImagery()) return wholeStreet('completed');
    if (current) return this.#currentStreetLines();
    if (this.isResumed() && this.getAuditedDistance() > 0) {
      // Part-walked and not the street being walked right now: show the split, so the labeler can see at a glance
      // which of the streets they left behind still have something on them (#5370). Once it becomes the current
      // street the branch above draws the same split with the route styling.
      return [
        { kind: 'completed', coordinates: this.#getPointsOnAuditedSegments() },
        { kind: 'other', coordinates: this.#getPointsOnUnauditedSegments() },
      ];
    }
    // On a route every street ahead is part of the planned path, so it is painted as route-to-walk (dashed, with
    // chevrons, over a white casing), the same as the current street's remaining half and RouteBuilder, so the whole
    // route reads as one arrowed path. A region audit has no planned path, so its other streets stay quiet context.
    return wholeStreet(route ? 'remaining' : 'other');
  }

  /**
   * The unwalked part of the street: from the furthest point the user has reached to the street's end. Shared by
   * the forward walk, the compass, and the minimap's forward crumbs so they agree on what "ahead" means.
   * @returns {GeoJSON.Feature<GeoJSON.LineString>}
   */
  unwalkedRemainder() {
    const from = turf.point(this.getFurthestPointReached().geometry.coordinates);
    const end = turf.point([this.getEndCoordinate().lng, this.getEndCoordinate().lat]);
    return turf.cleanCoords(turf.lineSlice(from, end, this.#geojson));
  }

  /**
   * The heading from a position toward the next goal along the street: 15 m further along the unwalked remainder,
   * or its end if less remains. On route this is the way forward; off route it points back toward the route.
   * @param {{lat: number, lng: number}} latLng - Where the labeler stands.
   * @returns {number} Degrees clockwise from true north, in [0, 360).
   */
  headingAlongRoute(latLng) {
    const remainder = this.unwalkedRemainder();
    const distIncrement = Math.min(0.015, turf.length(remainder));
    const goalLoc = turf.along(remainder, distIncrement).geometry.coordinates;
    return ((util.math.toDegrees(Math.atan2(goalLoc[0] - latLng.lng, goalLoc[1] - latLng.lat)) + 360) % 360);
  }

  /**
   * Whether a position is close enough to this street to count as on its route.
   * @param {{lat: number, lng: number}} latLng
   * @returns {boolean}
   */
  isNearRoute(latLng) {
    return turf.pointToLineDistance(turf.point([latLng.lng, latLng.lat]), this.#geojson) < Task.CLOSE_TO_ROUTE_KM;
  }

  /**
   * Flip the coordinates of the linestring if the last point is closer to the endpoint of the current street segment.
   */
  reverseCoordinates() {
    this.#geojson.geometry.coordinates.reverse();
  }

  setProperty(key, value) {
    this.#properties[key] = value;
  }

  getMissionStart(missionId) {
    return this.#missionStarts[missionId];
  }

  setMissionStart(missionId, missionStart) {
    this.#missionStarts[missionId] = missionStart;
  }

  getFurthestPointReached() {
    return this.#furthestPoint;
  }

  updateTheFurthestPointReached(currentLatLng) {
    if (this.isNearRoute(currentLatLng) && this.#hasAdvanced(currentLatLng)) {
      this.#furthestPoint = turf.point([currentLatLng.lng, currentLatLng.lat]);
    }
  }
}
