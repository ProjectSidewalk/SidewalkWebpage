/**
 * Task module.
 *
 * @memberof svl
 */
class Task {
  #geojson;

  /* @type {turf.Point} */
  #furthestPoint;

  #paths;
  #missionStarts = {};
  #status = {
    isComplete: false,
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
    routeStreetId: null,
  };

  /**
   * @param geojson
   * @param tutorialTask
   * @param {{lat: number, lng: number}} [currentLatLng] The user's current lat/lng to use if resuming.
   */
  constructor(geojson, tutorialTask, currentLatLng) {
    this.#properties.tutorialTask = tutorialTask;
    this.initialize(geojson, currentLatLng);
  }

  /**
   * This method takes a task parameters and set up the current task.
   * @param {GeoJSON.LineString} geojson The GeoJSON representation of the street
   * @param {{lat: number, lng: number}} [currentLatLng] The user's current lat/lng to use if resuming
   */
  initialize(geojson, currentLatLng) {
    this.#geojson = geojson;
    const currMissionId = this.#geojson.properties.current_mission_id;
    const currMissionStart = this.#geojson.properties.currentMissionStart;

    this.setProperty('streetEdgeId', this.#geojson.properties.street_edge_id);
    this.setProperty('completedByAnyUser', this.#geojson.properties.completed_by_any_user);
    this.setProperty('priority', this.#geojson.properties.priority);
    this.setProperty('currentMissionId', currMissionId);
    this.setProperty('auditTaskId', this.#geojson.properties.audit_task_id);
    this.setProperty('wayType', this.#geojson.properties.way_type);
    this.setProperty('routeStreetId', this.#geojson.properties.route_street_id);
    this.setProperty('taskStart', new Date(this.#geojson.properties.task_start));
    if (this.#geojson.properties.completed) {
      this.#status.isComplete = true;
    }
    if (this.#geojson.properties.start_point_reversed) {
      this.reverseStreetDirection();
    }
    if (currMissionId && currMissionStart) {
      this.setMissionStart(currMissionId, { lat: currMissionStart[0], lng: currMissionStart[1] });
    }
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
   * @param {{lat: number, lng: number}} currentLatLng User's current position
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

    return [
      new google.maps.Polyline({
        path: completedPath,
        geodesic: true,
        strokeColor: '#00ff00',
        strokeOpacity: 1.0,
        strokeWeight: 2,
      }),
      new google.maps.Polyline({
        path: incompletePath,
        geodesic: true,
        strokeColor: '#ff0000',
        strokeOpacity: 1.0,
        strokeWeight: 2,
      }),
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
      && turf.distance(currentPosition, snappedPosition) < 0.025;
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
   * @returns {GeoJSON.LineString}
   */
  getFeature() {
    return this.#geojson ? this.#geojson : null;
  }

  /**
   * Get the GeoJSON representation of the street.
   * TODO why do we have both this and getFeature()? Can the geojson be null ever? During initialization maybe..?
   * @returns {GeoJSON.LineString}
   */
  getGeoJSON() {
    return this.#geojson;
  }

  /**
   * Get the last coordinate in the geojson.
   * @returns {{lat: number, lng: number}
   */
  getEndCoordinate() {
    const len = this.#geojson.geometry.coordinates.length - 1;
    return { lat: this.#geojson.geometry.coordinates[len][1], lng: this.#geojson.geometry.coordinates[len][0] };
  }

  /**
   * Return the property.
   * @param {string} key Field name
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
   * @param {{units: string}} [units={units: 'kilometers'}] Can be degrees, radians, miles, or kilometers
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
   * @param {{lat: number, lng: number}} latLng The point to measure the distance from the start
   * @param {{units: string}} [units] String can be degrees, radians, miles, or kilometers
   * @returns {number} distance in meters
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
   * This method checks if the task is completed by comparing the current position and the ending point.
   *
   * @param {{lat: number, lng: number}} latLng The user's current location
   * @param {number} threshold Distance threshold in meters
   * @returns {boolean}
   */
  isAtEnd(latLng, threshold) {
    if (this.#geojson) {
      const len = this.#geojson.geometry.coordinates.length - 1;
      const latEnd = this.#geojson.geometry.coordinates[len][1];
      const lngEnd = this.#geojson.geometry.coordinates[len][0];

      if (!threshold) threshold = 10; // 10 meters
      const d = util.math.haversine(latLng, { lat: latEnd, lng: lngEnd });
      return d < threshold;
    }
  }

  /**
   * Returns if the task was completed or not.
   * @returns {boolean}
   */
  isComplete() {
    return this.#status.isComplete;
  }

  /**
   * Checks if the current task is connected to the given task.
   *
   * @param {Task} task The task to check if this task is close to
   * @param {number} threshold Distance threshold in km, unless specified in unit parameter
   * @param {{units: string}} [units] Object with field 'units' holding distance unit, default to 'kilometers'
   * @returns {boolean} true this task's endpoint is within threshold distance of either endpoint of given task
   */
  isConnectedTo(task, threshold, units) {
    if (!units) units = { units: 'kilometers' };

    const lastCoordinate = this.getEndCoordinate();
    const targetCoordinate1 = task.getStartCoordinate();
    const targetCoordinate2 = task.getEndCoordinate();
    const p = turf.point([lastCoordinate.lng, lastCoordinate.lat]);
    const p1 = turf.point([targetCoordinate1.lng, targetCoordinate1.lat]);
    const p2 = turf.point([targetCoordinate2.lng, targetCoordinate2.lat]);

    return turf.distance(p, p1, units) < threshold || turf.distance(p, p2, units) < threshold;
  }

  /**
   * Get the line distance of the task street edge
   * @param {{units: string}} [units] Object with field 'units' holding distance unit, default to 'kilometers'
   * @returns {number} The length of the street in the given units
   */
  lineDistance(units) {
    if (!units) units = { units: 'kilometers' };
    return turf.length(this.#geojson, units);
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
    // render it using one green or gray Polyline, respectively.
    if (this.isComplete() || this.getStreetEdgeId() !== svl.taskContainer.getCurrentTaskStreetEdgeId()) {
      const gCoordinates = this.#geojson.geometry.coordinates
        .map((coord) => new google.maps.LatLng(coord[1], coord[0]));
      this.#paths = [
        new google.maps.Polyline({
          path: gCoordinates,
          geodesic: true,
          strokeColor: this.isComplete() ? '#00ff00' : '#808080',
          strokeOpacity: this.isComplete() ? 1.0 : 0.75,
          strokeWeight: 2,
        }),
      ];
      // If the task is incomplete and is the current task, render it using two Polylines (red and green).
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
