function ModalMissionCompleteMap(uiModalMissionComplete) {
    // Map visualization
    L.mapbox.accessToken = 'pk.eyJ1IjoicHJvamVjdHNpZGV3YWxrIiwiYSI6ImNpdmZtODFobjAxcjEydHBkbmg0Y2F0MGgifQ.tDBFPXecLVjgJA0Z1LFhhw';
    var self = this;
    this._southWest = L.latLng(38.761, -77.262);
    this._northEast = L.latLng(39.060, -76.830);
    this._bound = L.latLngBounds(this._southWest, this._northEast);
    this._map = L.mapbox.map(uiModalMissionComplete.map.get(0), "kotarohara.8e0c6890", {
        maxBounds: this._bound,
        maxZoom: 19,
        minZoom: 10,
        style: 'mapbox://styles/projectsidewalk/civfm8qwi000l2iqo9ru4uhhj'
    }).fitBounds(this._bound);

    L.tileLayer('https://api.mapbox.com/styles/v1/projectsidewalk/civfm8qwi000l2iqo9ru4uhhj/tiles/256/{z}/{x}/{y}?access_token=pk.eyJ1IjoicHJvamVjdHNpZGV3YWxrIiwiYSI6ImNpdmZtODFobjAxcjEydHBkbmg0Y2F0MGgifQ.tDBFPXecLVjgJA0Z1LFhhw', {
        attribution: 'Map data &copy; <a href="http://openstreetmap.org">OpenStreetMap</a> contributors, <a href="http://creativecommons.org/licenses/by-sa/2.0/">CC-BY-SA</a>, Imagery © <a href="http://mapbox.com">Mapbox</a>',
        accessToken: L.mapbox.accessToken
    }).addTo(this._map);

    // these two are defined globaly so that they can be added in show and removed in hide
    this._overlayPolygon = null;
    this._overlayPolygonLayer = null;
    this._ui = uiModalMissionComplete;
    this._completedTasksLayer = [];

    this._animateMissionTasks = function (completedTasks, index, max){
        var collection = this._linestringToPoint(completedTasks[index].getGeoJSON());
        var featuresdata = collection.features;
        var leafletMap = this._map;
        var completedTasksLayer = this._completedTasksLayer;

        var svg = d3.select(leafletMap.getPanes().overlayPane).append("svg"),

            g = svg.append("g").attr("class", "leaflet-zoom-hide");

        var transform = d3.geo.transform({
            point: projectPoint
        });

        var d3path = d3.geo.path().projection(transform);

        var toLine = d3.svg.line()
            .interpolate("linear")
            .x(function(d) {
                return applyLatLngToLayer(d).x;
            })
            .y(function(d) {
                return applyLatLngToLayer(d).y;
            });

        var linePath = g.selectAll(".lineConnect")
            .data([featuresdata])
            .enter()
            .append("path")
            .attr("class", "lineConnect");

        // reset projection on zoom
        leafletMap.on("viewreset", reset);

        // this puts stuff on the map!
        reset();
        transition();

        // Reposition the SVG to cover the features.
        function reset() {
            var bounds = d3path.bounds(collection),
                topLeft = bounds[0],
                bottomRight = bounds[1];

            // Setting the size and location of the overall SVG container
            svg.attr("width", bottomRight[0] - topLeft[0] + 120)
                .attr("height", bottomRight[1] - topLeft[1] + 120)
                .style("left", topLeft[0] - 50 + "px")
                .style("top", topLeft[1] - 50 + "px");

            // set opacity to zero before it is rendered
            linePath.style("opacity", "0").attr("d", toLine);
            g.attr("transform", "translate(" + (-topLeft[0] + 50) + "," + (-topLeft[1] + 50) + ")");

        }


        function transition(transitionDuration) {
            if (!transitionDuration) transitionDuration = 600;
            linePath.transition()
                .duration(transitionDuration)
                .attrTween("stroke-dasharray", tweenDash)
                .each("end", function() {
                    if(index < max){
                        // recursively call the next animation render when this one is done
                        self._animateMissionTasks(completedTasks, index + 1, max);
                    }
                    else{
                        //render the complete path as plain svg to avoid scaling issues
                        renderPath(completedTasks);
                    }
                });
        } //end transition

        // this function feeds the attrTween operator above with the
        // stroke and dash lengths
        function tweenDash() {
            return function(t) {
                // reapply opacity to prevent phantom segment
                linePath.style("opacity", "1");
                //total length of path (single value)
                var l = linePath.node().getTotalLength();
                var interpolate = d3.interpolateString("0," + l, l + "," + l);
                var p = linePath.node().getPointAtLength(t * l);

                return interpolate(t);
            }
        } //end tweenDash

        function projectPoint(x, y) {
            var point = leafletMap.latLngToLayerPoint(new L.LatLng(y, x));
            this.stream.point(point.x, point.y);
        }

        function applyLatLngToLayer(d) {
            var y = d.geometry.coordinates[1];
            var x = d.geometry.coordinates[0];
            return leafletMap.latLngToLayerPoint(new L.LatLng(y, x));
        }

        // render svg segments
        function renderPath(missionTasks){
            var missionTaskLayerStyle = {color: "rgb(20,220,120)", opacity: 1, weight: 5 };

            var len = missionTasks.length;
            for (var i = 0; i < len; i++) {
                var  geojsonFeature = missionTasks[i].getFeature();
                var layer = L.geoJson(geojsonFeature).addTo(leafletMap);
                layer.setStyle(missionTaskLayerStyle);
                completedTasksLayer.push(layer);
            }
        }
    };

    /**
     * This method takes tasks that has been completed in the current mission and *all* the tasks completed in the
     * current neighborhood so far.
     * WARNING: `completedTasks` include tasks completed in the current mission too.
     * WARNING2: The current tasks are not included in neither of `missionTasks` and `completedTasks`
     *
     * @param missionTasks
     * @param completedTasks
     * @private
     */
    this.updateStreetSegments = function (missionTasks, completedTasks) {
        // Add layers http://leafletjs.com/reference.html#map-addlayer
        var i,
            len,
            geojsonFeature,
            layer,
            completedTaskLayerStyle = { color: "rgb(100,100,100)", opacity: 1, weight: 5 },
            leafletMap = this._map;

        // remove previous tasks
        _.each(this._completedTasksLayer, function(element) {
            leafletMap.removeLayer(element);
        });

        // remove after animation, otherwise segments remain green from previous tasks
        d3.select(this._map.getPanes().overlayPane)
            .selectAll("svg")
            .selectAll(".lineConnect")
            .remove();

        var newStreets = missionTasks.map( function (t) { return t.getStreetEdgeId(); });
        len = completedTasks.length;
        // Add the completed task layer
        for (i = 0; i < len; i++) {
            var streetEdgeId = completedTasks[i].getStreetEdgeId();
            if(newStreets.indexOf(streetEdgeId) == -1){
                geojsonFeature = completedTasks[i].getFeature();
                layer = L.geoJson(geojsonFeature).addTo(this._map);
                layer.setStyle(completedTaskLayerStyle);
                this._completedTasksLayer.push(layer);
            }
        }

        // Add the current mission animation layer
        len = missionTasks.length;
        if(len > 0){
            self._animateMissionTasks(missionTasks, 0, len - 1);
        }
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
    $(".leaflet-clickable").css('visibility', 'hidden');
    $(".leaflet-control-attribution").remove();
    $(".g-bar-chart").css('visibility', 'hidden');
    $(".leaflet-zoom-animated path").css('visibility', 'hidden');
};

ModalMissionCompleteMap.prototype.update = function (mission, neighborhood) {
    // Clear the previous highlighted region
    if(this._overlayPolygonLayer)
        this._map.removeLayer(this._overlayPolygonLayer);
    // Focus on the current region on the Leaflet map
    var center = neighborhood.center();
    var neighborhoodGeom = neighborhood.getGeoJSON();
    // overlay of entire map bounds
    this._overlayPolygon = {
        "type": "FeatureCollection",
        "features": [{"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [
            [[-75, 36], [-75, 40], [-80, 40], [-80, 36],[-75, 36]]]}}]};
    // expand the neighborhood border because sometimes streets slightly out of bounds are in the mission
    var bufferedGeom = turf.buffer(neighborhoodGeom, 0.04, "miles");
    var bufferedCoors = bufferedGeom.features[0].geometry.coordinates[0];
    // cut out neighborhood from overlay
    this._overlayPolygon.features[0].geometry.coordinates.push(bufferedCoors);
    this._overlayPolygonLayer = L.geoJson(this._overlayPolygon);
    // everything but current neighborhood grayed out
    this._overlayPolygonLayer.setStyle({ "opacity": 0, "fillColor": "rgb(110, 110, 110)", "fillOpacity": 0.25});
    this._overlayPolygonLayer.addTo(this._map);
    if (center) {
        this._map.setView([center.geometry.coordinates[1], center.geometry.coordinates[0]], 14);
    }
};

/**
 * Show the leaflet map
 */
ModalMissionCompleteMap.prototype.show = function () {
    this._ui.map.css('top', 0);  // Leaflet map overlaps with the ViewControlLayer
    this._ui.map.css('left', 15);

    $(".leaflet-clickable").css('visibility', 'visible');
    $(".g-bar-chart").css('visibility', 'visible');
    $(".leaflet-zoom-animated path").css('visibility', 'visible');
};

/**
 * converts GeoJSON from the LineString format that we use into a collection of Points for the d3 animation
 * @param featureCollection
 */
ModalMissionCompleteMap.prototype._linestringToPoint = function (featureCollection) {
    var coorList = featureCollection.features[0].geometry.coordinates;
    var featureList = [];
    for(var i = 0, len = coorList.length; i < len; i ++){
        // convert to point GeoJSON
        var feature = turf.point(coorList[i]);
        featureList.push(feature);
    }
    return {
        "type": "FeatureCollection",
        "features": featureList
    };
};