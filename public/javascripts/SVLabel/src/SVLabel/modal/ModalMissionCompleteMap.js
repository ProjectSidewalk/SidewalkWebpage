function ModalMissionCompleteMap(uiModalMissionComplete) {
    var self = this;

    // These two are defined globally so that they can be added in show and removed in hide.
    this._ui = uiModalMissionComplete;
    this._completedTasksLayer = [];
    this.neighborhoodBounds = null;

    $.getJSON('/cityMapParams', function(data) {
        mapboxgl.accessToken = data.mapbox_api_key;
        self._map = new mapboxgl.Map({
            container: uiModalMissionComplete.map.get(0),
            style: 'mapbox://styles/mapbox/light-v11?optimize=true',
            center: [data.city_center.lng, data.city_center.lat],
            zoom: data.default_zoom,
            minZoom: 10,
            maxZoom: 19,
            maxBounds: [
                [data.southwest_boundary.lng, data.southwest_boundary.lat],
                [data.northeast_boundary.lng, data.northeast_boundary.lat]
            ]
        }).addControl(new MapboxLanguage({ defaultLanguage: i18next.t('common:mapbox-language-code') }))
            .addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-left');

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
        var overlayPolygon = {
            'type': 'FeatureCollection',
            'features': [{
                'type': 'Feature',
                'geometry': {'type': 'Polygon', 'coordinates': [largeBoundary, neighborhoodBuffer.geometry.coordinates[0]]}
            }]};
        self._map.on('load', function() {
            self._map.addSource('overlay-polygon', {
                type: 'geojson',
                data: overlayPolygon
            });
            self._map.addLayer({
                id: 'overlay-polygon',
                type: 'fill',
                source: 'overlay-polygon',
                paint: {
                    'fill-color': 'rgb(110, 110, 110)',
                    'fill-opacity': 0.25
                }
            });

            // Zoom/pan the map to the neighborhood.
            self.neighborhoodBounds = turf.bbox(turf.buffer(neighborhoodBuffer, 0.05, { units: 'miles' }));
            self._map.fitBounds(self.neighborhoodBounds);

            // Add empty sources & layers for the completed tasks and the current mission tasks.
            self._completedTasksLayer = {type: 'FeatureCollection', features: []};
            self._userCompletedTasks = {type: 'FeatureCollection', features: []};
            self._missionTasks = { type: 'FeatureCollection', features: [] };
            self._map.addSource('completed-tasks', {type: 'geojson', data: self._completedTasksLayer});
            self._map.addSource('user-completed-tasks', {type: 'geojson', data: self._userCompletedTasks});
            self._map.addSource('mission-tasks', {type: 'geojson', data: self._missionTasks});
            self._map.addLayer({
                id: 'completed-tasks',
                type: 'line',
                source: 'completed-tasks',
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-color': 'rgb(100, 100, 100)',
                    'line-width': 3,
                    'line-opacity': 1
                }
            });
            self._map.addLayer({
                id: 'user-completed-tasks',
                type: 'line',
                source: 'user-completed-tasks',
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-color': 'rgb(70, 130, 180)',
                    'line-width': 4,
                    'line-opacity': 1
                }
            });
            self._map.addLayer({
                id: 'mission-tasks',
                type: 'line',
                source: 'mission-tasks',
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: {
                    'line-color': 'rgb(20, 220, 120)',
                    'line-width': 4,
                    'line-opacity': 1
                }
            });
        });
    });

    // TODO We removed the animation when switching to Mapbox GL JS bc we are redoing the Mission Complete modal soon.
    this._addMissionTasksAndAnimate = function(completedTasks, missionId) {
        var route;
        var missionStart;
        for (var i = 0; i < completedTasks.length; i++) {
            // If only part of this street was completed during the mission, get the corresponding subset of the
            // coordinates for the street, otherwise we can just use the full route.
            missionStart = completedTasks[i].getMissionStart(missionId);
            if (missionStart || !completedTasks[i].isComplete()) {
                var start = missionStart ? missionStart : completedTasks[i].getStartCoordinate();
                var end;
                if (completedTasks[i].isComplete()) {
                    end = completedTasks[i].getLastCoordinate();
                } else {
                    var farthestPoint = completedTasks[i].getFurthestPointReached().geometry.coordinates;
                    end = { lat: farthestPoint[1], lng: farthestPoint[0] };
                }
                route = completedTasks[i].getSubsetOfCoordinates(start.lat, start.lng, end.lat, end.lng)
            } else {
                route = completedTasks[i].getGeometry().coordinates;
            }
            this._missionTasks.features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: route } });
        }

        // Add the lines to the map.
        this._map.getSource('mission-tasks').setData(this._missionTasks);
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
     * @param incompleteTasks
     * @private
     */
    this.updateStreetSegments = function (missionTasks, completedTasks, allCompletedTasks, missionId, incompleteTasks) {
        // Reset map zoom to show the whole neighborhood.
        self._map.fitBounds(self.neighborhoodBounds);

        // Remove previous tasks.
        this._completedTasksLayer = { type: 'FeatureCollection', features: [] };
        this._userCompletedTasks = { type: 'FeatureCollection', features: [] };
        this._missionTasks = { type: 'FeatureCollection', features: [] };

        // If the current street is long enough that the user started their mission mid-street and finished their
        // mission before completing the street, then we add to `completedTasks` so that we can draw the old part.
        var currTask = missionTasks.filter(function (t) { return !t.isComplete() && t.getMissionStart(missionId); })[0];
        if (currTask) completedTasks.push(currTask);

        var newStreets = missionTasks.map( function (t) { return t.getStreetEdgeId(); });

        // If on a route, add all streets that haven't been finished yet. Otherwise, add all streets that have been
        // completed by other users. These lines are drawn in gray.
        if (svl.neighborhoodModel.isRoute) {
            this._completedTasksLayer.features = incompleteTasks.map(function (t) { return t.getFeature(); });
        } else {
            this._completedTasksLayer.features = allCompletedTasks.map(function (t) { return t.getFeature(); });
        }

        // Add the completed task layer.
        for (var i = 0; i < completedTasks.length; i++) {
            // If the street was not part of this mission, draw the full street.
            var newStreetIdx = newStreets.indexOf(completedTasks[i].getStreetEdgeId());
            if (newStreetIdx === -1) {
                this._userCompletedTasks.features.push(completedTasks[i].getFeature());
            } else {
                // If a nontrivial part of a street in this mission was completed in a previous mission (say, 3 meters),
                // draw the part that was completed in previous missions.
                var currStreet = missionTasks[newStreetIdx];
                var missionStart = currStreet ? currStreet.getMissionStart(missionId) : null;
                var streetStart = currStreet ? currStreet.getStartCoordinate() : null;
                var distFromStart = null;
                if (missionStart && streetStart) {
                    distFromStart = turf.distance(turf.point([streetStart.lng, streetStart.lat]),
                                                  turf.point([missionStart.lng, missionStart.lat]));
                }
                if (missionStart && streetStart && distFromStart > 0.003) {
                    var route = currStreet.getSubsetOfCoordinates(streetStart.lat, streetStart.lng, missionStart.lat, missionStart.lng);
                    var reversedRoute = [];
                    route.forEach(coord => reversedRoute.push([coord[1], coord[0]]));
                    this._userCompletedTasks.features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: reversedRoute } });
                }
            }

            // Update the source data and rerender.
            this._map.getSource('completed-tasks').setData(this._completedTasksLayer);
            this._map.getSource('user-completed-tasks').setData(this._userCompletedTasks);
            this._map.getSource('mission-tasks').setData(this._missionTasks);
        }

        // Add the current mission animation layer.
        self._addMissionTasksAndAnimate(missionTasks, missionId);
    };
}
