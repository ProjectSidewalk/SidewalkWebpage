function ModalMissionCompleteMap(uiModalMissionComplete) {
    // Map visualization
    L.mapbox.accessToken = 'pk.eyJ1IjoibWlzYXVnc3RhZCIsImEiOiJjajN2dTV2Mm0wMDFsMndvMXJiZWcydDRvIn0.IXE8rQNF--HikYDjccA7Ug';
    var self = this;

    // These two are defined globally so that they can be added in show and removed in hide.
    this._overlayPolygon = null;
    this._overlayPolygonLayer = null;
    this._ui = uiModalMissionComplete;
    this._completedTasksLayer = [];
    this.neighborhoodBounds = null;

    this._map = L.mapbox.map(uiModalMissionComplete.map.get(0), null, {
        maxZoom: 19,
        minZoom: 10,
        style: 'mapbox://styles/projectsidewalk/civfm8qwi000l2iqo9ru4uhhj',
        zoomSnap: 0.25
    }).addLayer(L.mapbox.styleLayer('mapbox://styles/mapbox/light-v10'));

    // Set the city-specific default zoom, location, and max bounding box to prevent the user from panning away.
    $.getJSON('/cityMapParams', function(data) {
        var southWest = L.latLng(data.southwest_boundary.lat, data.southwest_boundary.lng);
        var northEast = L.latLng(data.northeast_boundary.lat, data.northeast_boundary.lng);
        self._map.setMaxBounds(L.latLngBounds(southWest, northEast));

        // Gray out a large area around the city with the neighborhood cut out to highlight the neighborhood.
        var largeBoundary = [
            [data.southwest_boundary.lng + 5,data.southwest_boundary.lat - 5],
            [data.southwest_boundary.lng + 5,data.southwest_boundary.lat + 5],
            [data.southwest_boundary.lng - 5, data.southwest_boundary.lat + 5],
            [data.southwest_boundary.lng - 5,data.southwest_boundary.lat - 5]
        ];

        // Add a small buffer around the neighborhood because it looks prettier.
        var neighborhoodGeom = svl.neighborhoodContainer.getCurrentNeighborhood().getGeoJSON();
        var neighborhoodBuffer = turf.buffer(neighborhoodGeom, 0.04, { units: 'miles' });
        self._overlayPolygon = {
            'type': 'FeatureCollection',
            'features': [{
                'type': 'Feature',
                'geometry': {'type': 'Polygon', 'coordinates': [largeBoundary, neighborhoodBuffer.geometry.coordinates[0]]}
            }]};
        self._overlayPolygonLayer = L.geoJson(self._overlayPolygon);
        self._overlayPolygonLayer.setStyle({ 'opacity': 0, 'fillColor': 'rgb(110, 110, 110)', 'fillOpacity': 0.25});
        self._overlayPolygonLayer.addTo(self._map);

        // Zoom/pan the map to the neighborhood.
        self.neighborhoodBounds = L.geoJson(neighborhoodBuffer).getBounds();
        self._map.fitBounds(self.neighborhoodBounds);
    });

    this._addMissionTasksAndAnimate = function(completedTasks, missionId) {
        var route;
        var i, j;
        var path;
        var missionStart;
        var features = [];
        for (i = 0; i < completedTasks.length; i++) {
            var latlngs = [];
            missionStart = completedTasks[i].getMissionStart(missionId);
            if (missionStart || !completedTasks[i].isComplete()) {
                var startPoint = missionStart ? missionStart : completedTasks[i].getStartCoordinate();
                var endPoint;
                if (completedTasks[i].isComplete()) {
                    endPoint = completedTasks[i].getLastCoordinate();
                } else {
                    var farthestPoint = completedTasks[i].getFurthestPointReached().geometry.coordinates;
                    endPoint = { lat: farthestPoint[1], lng: farthestPoint[0] };
                }
                route = completedTasks[i].getSubsetOfCoordinates(startPoint.lat, startPoint.lng, endPoint.lat, endPoint.lng)
            } else {
                route = completedTasks[i].getGeometry().coordinates;
            }
            for (j = 0; j < route.length; j++) {
                latlngs.push(new L.LatLng(route[j][1], route[j][0]));
            }
            path = L.polyline(latlngs, { color: 'rgb(20,220,120)', opacity: 1, weight: 5, snakingSpeed: 20 });
            features.push(path);
        }
        var featureGroup = L.featureGroup(features);
        self._completedTasksLayer.push(featureGroup);
        self._map.addLayer(featureGroup);
        featureGroup.snakeIn();
    };

    /**
     * This method takes tasks that has been completed in the current mission and *all* the tasks completed in the
     * current neighborhood so far.
     * WARNING: `completedTasks` include tasks completed in the current mission too.
     *
     * @param missionTasks
     * @param completedTasks
     * @param allCompletedTasks
     * @param missionId
     * @private
     */
    this.updateStreetSegments = function (missionTasks, completedTasks, allCompletedTasks, missionId) {
        var i;
        var leafletLine;
        var layer;
        var completedTaskAllUsersLayerStyle = { color: 'rgb(100,100,100)', opacity: 1, weight: 3 };
        var completedTaskLayerStyle = { color: 'rgb(70,130,180)', opacity: 1, weight: 5 };
        var leafletMap = this._map;

        // Reset map zoom to show the whole neighborhood.
        self._map.fitBounds(self.neighborhoodBounds);

        // Remove previous tasks.
        _.each(this._completedTasksLayer, function(element) {
            leafletMap.removeLayer(element);
        });

        // If the current street is long enough that the user started their mission mid-street and finished their
        // mission before completing the street, then we add to `completedTasks` so that we can draw the old part.
        var currTask = missionTasks.filter(function (t) { return !t.isComplete() && t.getMissionStart(missionId); })[0];
        if (currTask) completedTasks.push(currTask);

        var newStreets = missionTasks.map( function (t) { return t.getStreetEdgeId(); });
        var userOldStreets = completedTasks.map( function(t) { return t.getStreetEdgeId(); });

        // Add the other users' tasks layer
        for (i = 0; i < allCompletedTasks.length; i++) {
            var otherUserStreet = allCompletedTasks[i].getStreetEdgeId();
            if(userOldStreets.indexOf(otherUserStreet) === -1 && newStreets.indexOf(otherUserStreet) === -1){
                leafletLine = L.geoJson(allCompletedTasks[i].getFeature());
                layer = leafletLine.addTo(this._map);
                layer.setStyle(completedTaskAllUsersLayerStyle);
                this._completedTasksLayer.push(layer);
            }
        }

        // Add the completed task layer.
        for (i = 0; i < completedTasks.length; i++) {
            leafletLine = null;
            // If the street was not part of this mission, draw the full street.
            var newStreetIdx = newStreets.indexOf(completedTasks[i].getStreetEdgeId());
            if (newStreetIdx === -1) {
                leafletLine = L.geoJson(completedTasks[i].getFeature());
            } else {
                // If a nontrivial part of a street in this mission was completed in a previous mission (say, 3 meters),
                // draw the part that was completed in previous missions.
                var theStreet = missionTasks[newStreetIdx];
                var missionStart = theStreet ? theStreet.getMissionStart(missionId) : null;
                var streetStart = theStreet ? theStreet.getStartCoordinate() : null;
                var distFromStart = null;
                if (missionStart && streetStart) {
                    distFromStart = turf.distance(turf.point([streetStart.lng, streetStart.lat]),
                                                  turf.point([missionStart.lng, missionStart.lat]));
                }
                if (missionStart && streetStart && distFromStart > 0.003) {
                    var route = theStreet.getSubsetOfCoordinates(streetStart.lat, streetStart.lng, missionStart.lat, missionStart.lng);
                    var reversedRoute = [];
                    route.forEach(coord => reversedRoute.push([coord[1], coord[0]]));
                    leafletLine = L.polyline(reversedRoute);
                }
            }

            // If we made a layer to draw, then draw it.
            if (leafletLine) {
                layer = leafletLine.addTo(this._map);
                layer.setStyle(completedTaskLayerStyle);
                this._completedTasksLayer.push(layer);
            }
        }

        // Add the current mission animation layer.
        self._addMissionTasksAndAnimate(missionTasks, missionId);
    };
}

/**
 * Hide the leaflet map
 */
ModalMissionCompleteMap.prototype.hide = function () {
    this._ui.map.css('top', 500);
    this._ui.map.css('left', -500);
    $('.leaflet-clickable').css('visibility', 'hidden');
    $('.leaflet-control-attribution').remove();
    $('.g-bar-chart').css('visibility', 'hidden');
    $('.leaflet-zoom-animated path').css('visibility', 'hidden');
};

/**
 * Show the leaflet map
 */
ModalMissionCompleteMap.prototype.show = function () {
    this._ui.map.css('top', 0);  // Leaflet map overlaps with the ViewControlLayer
    this._ui.map.css('left', 15);

    $('.leaflet-clickable').css('visibility', 'visible');
    $('.g-bar-chart').css('visibility', 'visible');
    $('.leaflet-zoom-animated path').css('visibility', 'visible');
};
