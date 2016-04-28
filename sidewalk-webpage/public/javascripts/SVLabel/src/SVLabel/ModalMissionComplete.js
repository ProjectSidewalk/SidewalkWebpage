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
        .attr("fill", "rgba(200, 200, 200, 1)")
        .attr("height", svgHeight)
        .attr("width", svgWidth);

    var gBarChart = svg.append("g").attr("class", "g-bar-chart");
    var previousContribution = [0];
    var horizontalBarPreviousContribution = gBarChart.selectAll("rect")
        .data(previousContribution)
        .enter().append("rect")
        .attr("x", 0)
        .attr("y", 0)
        .attr("fill", "steelblue")
        .attr("height", svgHeight)
        .attr("width", 0);

    var gBarChart2 = svg.append("g").attr("class", "g-bar-chart");
    var horizontalBarMission = gBarChart2.selectAll("rect")
        .data([0])
        .enter().append("rect")
        .attr("x", 0)
        .attr("y", 0)
        .attr("fill", "yellow")
        .attr("height", svgHeight)
        .attr("width", 0);


    function _init () {
        svl.ui.modalMission.background.on("click", handleBackgroundClick);
        svl.ui.modalMission.closeButton.on("click", handleCloseButtonClick);
    }

    function _updateNeighborhoodDistanceBarGraph(regionId, mission, unit) {
        if (!unit) unit = "kilometers";
        var completedTaskDistance = svl.taskContainer.getCompletedTaskDistance(regionId, unit),
            totalLineDistance = svl.taskContainer.totalLineDistanceInARegion(regionId, unit),
            missionDistance = mission.getProperty("distance") / 1000;  // meters to km

        if (completedTaskDistance != null && totalLineDistance != null && missionDistance != null) {
            var rateMission = 0.3; // missionDistance / totalLineDistance;
            var rateCompleted = 0.5; // Math.max(completedTaskDistance / missionDistance - rateMission, 0);

            horizontalBarPreviousContribution.attr("width", 0)
                .transition()
                .delay(200)
                .duration(300)
                .attr("width", rateCompleted * svgWidth);

            horizontalBarMission.attr("width", 0)
                .attr("x", rateCompleted * svgWidth)
                .transition()
                .delay(600)
                .duration(300)
                .attr("width", rateMission * svgWidth);

            console.debug("Update the visualization");
        }
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
                _updateNeighborhoodDistanceBarGraph(neighborhood.getProperty("regionId"), mission);
            }
        }
    }

    _init();

    self.show = show;
    return self;
}
