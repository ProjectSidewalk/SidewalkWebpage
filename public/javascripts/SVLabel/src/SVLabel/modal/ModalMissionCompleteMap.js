function ModalMissionCompleteMap(uiModalMissionComplete) {
    // Map visualization
    L.mapbox.accessToken = 'pk.eyJ1IjoibWlzYXVnc3RhZCIsImEiOiJjajN2dTV2Mm0wMDFsMndvMXJiZWcydDRvIn0.IXE8rQNF--HikYDjccA7Ug';
    var self = this;

    // These two are defined globally so that they can be added in show and removed in hide.
    this._overlayPolygon = null;
    this._overlayPolygonLayer = null;
    this._ui = uiModalMissionComplete;
    this._completedTasksLayer = [];

    this._map = L.mapbox.map(uiModalMissionComplete.map.get(0), null, {
        maxZoom: 19,
        minZoom: 10,
        style: 'mapbox://styles/projectsidewalk/civfm8qwi000l2iqo9ru4uhhj',
        zoomSnap: 0.25
    }).addLayer(L.mapbox.styleLayer('mapbox://styles/mapbox/light-v10'));

    // Set the city-specific default zoom, location, and max bounding box to prevent the user from panning away.
    $.getJSON('/cityMapParams', function(data) {
        self._map.setZoom(data.default_zoom);
        var southWest = L.latLng(data.southwest_boundary.lat, data.southwest_boundary.lng);
        var northEast = L.latLng(data.northeast_boundary.lat, data.northeast_boundary.lng);
        self._map.setMaxBounds(L.latLngBounds(southWest, northEast));

        var neighborhood = svl.neighborhoodContainer.getCurrentNeighborhood();
        var center = neighborhood.center();
        self._map.setView([center.geometry.coordinates[1], center.geometry.coordinates[0]], 14);

        // Gray out a large area around the city with the neighborhood cut out to highlight the neighborhood.
        var largeBoundary = [
            [data.southwest_boundary.lng + 5,data.southwest_boundary.lat - 5],
            [data.southwest_boundary.lng + 5,data.southwest_boundary.lat + 5],
            [data.southwest_boundary.lng - 5, data.southwest_boundary.lat + 5],
            [data.southwest_boundary.lng - 5,data.southwest_boundary.lat - 5]
        ];

        // Add a small buffer around the neighborhood because it looks prettier.
        var neighborhoodGeom = neighborhood.getGeoJSON();
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
    });

    this._addMissionTasksAndAnimate = function(completedTasks) {
        var route;
        var i, j;
        var path;
        for (i = 0; i < completedTasks.length; i++) {
            var latlngs = [];
            route = completedTasks[i].getGeometry().coordinates;
            for (j = 0; j < route.length; j++) {
                latlngs.push(new L.LatLng(route[j][1], route[j][0]));
            }
            path = L.polyline(latlngs, { color: 'rgb(20,220,120)', snakingSpeed: 20 });
            path.addTo(self._map).snakeIn();
        }
    };

    /**
     * This method takes tasks that has been completed in the current mission and *all* the tasks completed in the
     * current neighborhood so far.
     * WARNING: `completedTasks` include tasks completed in the current mission too.
     * WARNING2: The current tasks are not included in either `missionTasks` or `completedTasks`
     *
     * @param missionTasks
     * @param completedTasks
     * @param allCompletedTasks
     * @private
     */
    this.updateStreetSegments = function (missionTasks, completedTasks, allCompletedTasks) {
        // Add layers http://leafletjs.com/reference.html#map-addlayer
        var i;
        var geojsonFeature;
        var layer;
        var completedTaskAllUsersLayerStyle = { color: 'rgb(100,100,100)', opacity: 1, weight: 5 };
        var completedTaskLayerStyle = { color: 'rgb(70,130,180)', opacity: 1, weight: 5 };
        var leafletMap = this._map;

        // remove previous tasks
        _.each(this._completedTasksLayer, function(element) {
            leafletMap.removeLayer(element);
        });

        var newStreets = missionTasks.map( function (t) { return t.getStreetEdgeId(); });
        var userOldStreets = completedTasks.map( function(t) { return t.getStreetEdgeId(); });

        // Add the other users' tasks layer
        for (i = 0; i < allCompletedTasks.length; i++) {
            var otherUserStreet = allCompletedTasks[i].getStreetEdgeId();
            if(userOldStreets.indexOf(otherUserStreet) === -1 && newStreets.indexOf(otherUserStreet) === -1){
                geojsonFeature = allCompletedTasks[i].getFeature();
                layer = L.geoJson(geojsonFeature).addTo(this._map);
                layer.setStyle(completedTaskAllUsersLayerStyle);
                this._completedTasksLayer.push(layer);
            }
        }

        // Add the completed task layer
        for (i = 0; i < completedTasks.length; i++) {
            var streetEdgeId = completedTasks[i].getStreetEdgeId();
            if (newStreets.indexOf(streetEdgeId) === -1) {
                geojsonFeature = completedTasks[i].getFeature();
                layer = L.geoJson(geojsonFeature).addTo(this._map);
                layer.setStyle(completedTaskLayerStyle);
                this._completedTasksLayer.push(layer);
            }
        }

        // Add the current mission animation layer.
        self._addMissionTasksAndAnimate(missionTasks);
    };
}

/**
 * Hide the leaflet map
 */
ModalMissionCompleteMap.prototype.hide = function () {
    if (this._overlayPolygonLayer) {
        this._map.removeLayer(this._overlayPolygonLayer);
    }

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
