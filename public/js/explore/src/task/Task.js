/**
 * Task module.
 *
 * @memberof svl
 */
class Task {
  // Ceiling on any "am I at the end of this street?" threshold, as a fraction of the street's length. Keeps a
  // fixed metre distance from swallowing most of a short street.
  static END_PROXIMITY_MAX_FRACTION = 0.4;
  // How far from the street's line a position may sit and still count as on the street: past it a pano can neither
  // advance the furthest point reached nor finish the street. Matches the pano search radius
  // (svl.STREETVIEW_MAX_DISTANCE), so anything a street sweep lands on is within it by construction.
  static ON_STREET_MAX_DISTANCE_M = 25;

  #geojson;

  /* @type {turf.Point} */
  #furthestPoint;

  #paths;
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
   * @param {boolean} tutorialTask
   * @param {{lat: number, lng: number}} [currentLatLng] - The user's current lat/lng to use if resuming.
   */
  constructor(geojson, tutorialTask, currentLatLng) {
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
    // After the direction, never before it: reversing re-seeds the furthest point from the new first coordinate, so a
    // saved position applied first would be thrown away and the walked stretch measured from the wrong end.
    if (currentLatLng) {
      this.#furthestPoint = turf.point([currentLatLng.lng, currentLatLng.lat]);
    } else {
      this.#furthestPoint = turf.point(this.#geojson.geometry.coordinates[0]);
    }

    this.#paths = null;
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
   * This method creates Google Maps Polyline objects to render on the Google Maps minimap.
   * @returns {Array|*[]}
   */
  getGooglePolylines() {
    const auditedCoordinates = this.#getPointsOnAuditedSegments();
    const unauditedCoordinates = this.#getPointsOnUnauditedSegments();
    const completedPath = [];
    const incompletePath = [];

    for (let i = 0, len = auditedCoordinates.length; i < len; i++) {
      completedPath.push(new google.maps.LatLng(auditedCoordinates[i][1], auditedCoordinates[i][0]));
    }

    for (let i = 0, len = unauditedCoordinates.length; i < len; i++) {
      incompletePath.push(new google.maps.LatLng(unauditedCoordinates[i][1], unauditedCoordinates[i][0]));
    }

    // Each half is a casing + line pair; see MinimapStyle for the encoding rationale (#4639).
    const polylines = [];
    if (completedPath.length > 1) {
      polylines.push(new google.maps.Polyline(MinimapStyle.routeCasing(completedPath)));
      polylines.push(new google.maps.Polyline(MinimapStyle.auditedRoute(completedPath)));
    }
    if (incompletePath.length > 1) {
      polylines.push(new google.maps.Polyline(MinimapStyle.routeCasing(incompletePath)));
      polylines.push(new google.maps.Polyline(MinimapStyle.remainingRoute(incompletePath)));
    }
    return polylines;
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
   * @param {{units: string}} [units={units: 'kilometers'}] - Can be degrees, radians, miles, or kilometers
   * @returns {number}
   */
  getAuditedDistance(units = { units: 'kilometers' }) {
    if (typeof this.#furthestPoint === 'undefined') return 0;
    const latFurthest = this.#furthestPoint.geometry.coordinates[1];
    const lngFurthest = this.#furthestPoint.geometry.coordinates[0];
    return this.getDistanceFromStart({ lat: latFurthest, lng: lngFurthest }, units);
  }

  /**
   * Get the cumulative distance.
   *
   * @param {{lat: number, lng: number}} latLng - The point to measure the distance from the start
   * @param {{units: string}} [units] - String can be degrees, radians, miles, or kilometers
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
   * @param {{units: string}} [units] - Object with field 'units' holding distance unit, default to 'kilometers'
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
   * @param {{units: string}} [units] - Object with field 'units' holding distance unit, default to 'kilometers'
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
   * TODO This should go to the Minimap.
   */
  eraseFromMinimap() {
    if (this.#paths) {
      for (let i = 0; i < this.#paths.length; i++) {
        this.#paths[i].setMap(null);
      }
    }
  }

  /**
   * Render the task path on the Google Maps pane.
   * TODO This should go to the Minimap.
   * Reference:
   * https://developers.google.com/maps/documentation/javascript/shapes#polyline_add
   * https://developers.google.com/maps/documentation/javascript/examples/polyline-remove
   */
  render() {
    this.eraseFromMinimap();

    // Free exploration draws no street lines at all (#4451). The red/green split reads as progress being scored, and
    // the surrounding green/gray coverage is noise for someone who dropped in at a single address — the minimap is
    // there to show where they are.
    if (svl.isExploreAddressMode()) return;

    // If the task has been completed already, or if it has not been completed and is not the current task,
    // render it as a whole street rather than the audited/remaining split used for the current street.
    // A street this session gave up on for lack of imagery draws as walked: the labeler did everything the tool let
    // them, and a grey gap in an otherwise finished route reads as their omission.
    const drawAsWalked = this.isComplete() || this.wasGivenUpOnImagery();
    if (drawAsWalked || this.getStreetEdgeId() !== svl.taskContainer.getCurrentTaskStreetEdgeId()) {
      const gCoordinates = this.#geojson.geometry.coordinates
        .map((coord) => new google.maps.LatLng(coord[1], coord[0]));
      if (drawAsWalked) {
        this.#paths = [new google.maps.Polyline(MinimapStyle.completedTask(gCoordinates))];
      } else if (this.isResumed() && this.getAuditedDistance() > 0) {
        // Part-walked and not the street being walked right now: show the split, so the labeler can see at a glance
        // which of the streets they left behind still have something on them (#5370). Once it becomes the current
        // street the getGooglePolylines() branch below draws the same split with the route styling.
        // Each half is drawn only if it is really a line: turf can slice a half down to a single point when the
        // furthest point sits on an endpoint, and a one-point Polyline renders as nothing (same guard as
        // getGooglePolylines).
        const toLatLngs = (coords) => coords.map((coord) => new google.maps.LatLng(coord[1], coord[0]));
        const walked = toLatLngs(this.#getPointsOnAuditedSegments());
        const remaining = toLatLngs(this.#getPointsOnUnauditedSegments());
        this.#paths = [];
        if (walked.length > 1) this.#paths.push(new google.maps.Polyline(MinimapStyle.completedTask(walked)));
        if (remaining.length > 1) this.#paths.push(new google.maps.Polyline(MinimapStyle.otherTask(remaining)));
      } else if (svl.regionModel.isRoute) {
        // On a designated route every street ahead is part of the planned path, so paint it as the route-to-walk: a
        // dashed line with direction chevrons over a white casing — the same encoding as the current street's
        // remaining half (and RouteBuilder's own rendering) — so the whole route reads as a dotted, arrowed path when
        // zoomed out. A free region audit has no planned path, so its non-current streets stay quiet context.
        this.#paths = [
          new google.maps.Polyline(MinimapStyle.routeCasing(gCoordinates)),
          new google.maps.Polyline(MinimapStyle.remainingRoute(gCoordinates)),
        ];
      } else {
        this.#paths = [new google.maps.Polyline(MinimapStyle.otherTask(gCoordinates))];
      }
      // If the task is incomplete and is the current task, render its audited and remaining halves separately.
    } else {
      this.#paths = this.getGooglePolylines();
    }

    for (let i = 0, len = this.#paths.length; i < len; i++) {
      this.#paths[i].setMap(svl.minimap.getMap());
    }
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
    const currentPoint = turf.point([currentLatLng.lng, currentLatLng.lat]);
    if (turf.pointToLineDistance(currentPoint, this.#geojson) < svl.CLOSE_TO_ROUTE_THRESHOLD
      && this.#hasAdvanced(currentLatLng)) {
      this.#furthestPoint = currentPoint;
    }
  }
}
