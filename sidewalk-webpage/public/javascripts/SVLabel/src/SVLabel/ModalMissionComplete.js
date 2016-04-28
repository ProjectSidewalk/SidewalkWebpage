/**
 * ModalMission module
 * @param $
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function ModalMissionComplete ($, d3, L) {
    var self = { className : 'ModalMissionComplete'},
        properties = {
            boxTop: 180,
            boxLeft: 45,
            boxWidth: 640
        };

    // Map visualization
    L.mapbox.accessToken = 'pk.eyJ1Ijoia290YXJvaGFyYSIsImEiOiJDdmJnOW1FIn0.kJV65G6eNXs4ATjWCtkEmA';
    var southWest = L.latLng(38.761, -77.262),
        northEast = L.latLng(39.060, -76.830),
        bounds = L.latLngBounds(southWest, northEast),
        map = L.mapbox.map('modal-mission-map', "kotarohara.8e0c6890", {
                maxBounds: bounds,
                maxZoom: 19,
                minZoom: 9
            })
            .fitBounds(bounds);
    var overlayPolygon = {
        "type": "FeatureCollection",
        "features": [{"type": "Feature", "geometry": {
            "type": "Polygon", "coordinates": [
                [[-75, 36], [-75, 40], [-80, 40], [-80, 36],[-75, 36]]
            ]}}]};
    var overlayPolygonLayer = L.geoJson(overlayPolygon).addTo(map);
    overlayPolygonLayer.setStyle({ "fillColor": "rgb(80, 80, 80)"});

    var missionLayer = [],
        completeTaskLayer = [];

    // Bar chart visualization
    // Todo. This can be cleaned up!!!
    var svgWidth = 335,
        svgHeight = 20;
    var svg = d3.select("#modal-mission-complete-bar")
        .append("svg")
        .attr("width", svgWidth)
        .attr("height", svgHeight);

    var gBackground = svg.append("g").attr("class", "g-background");
    var horizontalBarBackground = gBackground.selectAll("rect")
        .data([1])
        .enter().append("rect")
        .attr("x", 0)
        .attr("y", 0)
        .attr("fill", "rgba(240, 240, 240, 1)")
        .attr("height", svgHeight)
        .attr("width", svgWidth);

    var gBarChart = svg.append("g").attr("class", "g-bar-chart");
    var horizontalBarPreviousContribution = gBarChart.selectAll("rect")
        .data([0])
        .enter().append("rect")
        .attr("x", 0)
        .attr("y", 0)
        .attr("fill", "rgba(23, 55, 94, 1)")
        .attr("height", svgHeight)
        .attr("width", 0);
    var horizontalBarPreviousContributionLabel = gBarChart.selectAll("text")
        .data([""])
        .enter().append("text")
        .attr("x", 3)
        .attr("y", 15)
        .attr("dx", 3)
        .attr("fill", "white")
        .attr("font-size", "10pt")
        .text(function (d) {
            return d;
        })
        .style("visibility", "visible");

    var gBarChart2 = svg.append("g").attr("class", "g-bar-chart");
    var horizontalBarMission = gBarChart2.selectAll("rect")
        .data([0])
        .enter().append("rect")
        .attr("x", 0)
        .attr("y", 0)
        .attr("fill", "rgba(0,112,192,1)")
        .attr("height", svgHeight)
        .attr("width", 0);
    var horizontalBarMissionLabel = gBarChart2.selectAll("text")
        .data([""])
        .enter().append("text")
        .attr("x", 3)
        .attr("y", 15)
        .attr("dx", 3)
        .attr("fill", "white")
        .attr("font-size", "10pt")
        .text(function (d) {
            return d;
        })
        .style("visibility", "visible");


    function _init () {
        svl.ui.modalMission.background.on("click", handleBackgroundClick);
        svl.ui.modalMission.closeButton.on("click", handleCloseButtonClick);
    }

    function _updateMissionProgressStatistics (auditedDistance, missionDistance, remainingDistance, unit) {
        if (!unit) unit = "kilometers";
        svl.ui.modalMission.totalAuditedDistance.html(auditedDistance.toFixed(2) + " " + unit);
        svl.ui.modalMission.missionDistance.html(missionDistance.toFixed(2) + " " + unit);
        svl.ui.modalMission.remainingDistance.html(remainingDistance.toFixed(2) + " " + unit);
    }

    function _updateNeighborhoodStreetSegmentVisualization(missionTasks, completedTasks) {
        // var completedTasks = svl.taskContainer.getCompletedTasks(regionId);
        // var missionTasks = mission.getRoute();

        if (completedTasks && missionTasks) {
            // Add layers http://leafletjs.com/reference.html#map-addlayer
            var i, len, geojsonFeature, layer,
                completedTaskLayerStyle = { color: "rgb(128, 128, 128)", opacity: 1, weight: 3 },
                missionTaskLayerStyle = { color: "rgb(49,130,189)", opacity: 1, weight: 3 };

            // Add the completed task layer
            len = completedTasks.length;
            for (i = 0; i < len; i++) {
                geojsonFeature = completedTasks[i].getFeature();
                layer = L.geoJson(geojsonFeature).addTo(map);
                layer.setStyle(completedTaskLayerStyle);
            }

            // Add the current mission layer
            len = missionTasks.length;
            for (i = 0; i < len; i++) {
                geojsonFeature = missionTasks[i].getFeature();
                layer = L.geoJson(geojsonFeature).addTo(map);
                layer.setStyle(missionTaskLayerStyle);
            }
        }
    }


    /**
     * Update the bar graph visualization
     * @param missionDistanceRate
     * @param auditedDistanceRate
     * @private
     */
    function _updateNeighborhoodDistanceBarGraph(missionDistanceRate, auditedDistanceRate) {
       horizontalBarPreviousContribution.attr("width", 0)
           .transition()
           .delay(200)
           .duration(800)
           .attr("width", auditedDistanceRate * svgWidth);
       horizontalBarPreviousContributionLabel.transition()
           .delay(200)
           .text(parseInt(auditedDistanceRate * 100, 10) + "%");

       horizontalBarMission.attr("width", 0)
           .attr("x", auditedDistanceRate * svgWidth)
           .transition()
           .delay(1000)
           .duration(500)
           .attr("width", missionDistanceRate * svgWidth);
       horizontalBarMissionLabel.attr("x", auditedDistanceRate * svgWidth + 3)
           .transition().delay(1000)
           .text(parseInt(missionDistanceRate * 100, 10) + "%");
    }

    /**
     * Get a property
     * @param key
     * @returns {null}
     */
    function getProperty (key) {
        return key in properties ? properties[key] : null;
    }

    /**
     * Callback function for background click
     * @param e
     */
    function handleBackgroundClick(e) {
        hideMission();
    }

    /**
     * Callback function for button click
     * @param e
     */
    function handleCloseButtonClick(e) {
        hideMission();
    }

    /**
     * Hide a mission
     */
    function hideMission () {
        svl.ui.modalMission.holder.css('visibility', 'hidden');
        svl.ui.modalMission.foreground.css('visibility', "hidden");
        $(".leaflet-control-attribution").remove();
    }

    /** 
     * Show a mission
     */
    function show () {
        svl.ui.modalMission.holder.css('visibility', 'visible');
        svl.ui.modalMission.foreground.css('visibility', "visible");

        if ("neighborhoodContainer" in svl && svl.neighborhoodContainer && "missionContainer" in svl && svl.missionContainer) {
            var neighborhood = svl.neighborhoodContainer.getCurrentNeighborhood(),
                mission = svl.missionContainer.getCurrentMission();
            if (neighborhood && mission) {
                // Focus on the current region on the map
                var center = neighborhood.center();
                neighborhood.addTo(map);
                if (center) {
                    map.setView([center.geometry.coordinates[1], center.geometry.coordinates[0]], 14);
                }

                // Update the horizontal bar chart to show how much distance the user has audited
                var unit = "miles";
                var regionId = neighborhood.getProperty("regionId");
                var auditedDistance = neighborhood.completedLineDistance(unit);
                var remainingDistance = neighborhood.totalLineDistance(unit) - auditedDistance;
                var missionDistance = mission.totalLineDistance(unit);

                var completedTasks = svl.taskContainer.getCompletedTasks(regionId);
                var missionTasks = mission.getRoute();

                var completedTaskDistance = svl.taskContainer.getCompletedTaskDistance(regionId, unit);
                var totalLineDistance = svl.taskContainer.totalLineDistanceInARegion(regionId, unit);

                var missionDistanceRate = missionDistance / totalLineDistance;
                var auditedDistanceRate = Math.max(0, auditedDistance / totalLineDistance - missionDistanceRate);
                _updateNeighborhoodDistanceBarGraph(missionDistanceRate, auditedDistanceRate);
                _updateNeighborhoodStreetSegmentVisualization(missionTasks, completedTasks);
                _updateMissionProgressStatistics(auditedDistance, missionDistance, remainingDistance, unit);
            }
        }
    }

    _init();

    self.show = show;
    return self;
}
