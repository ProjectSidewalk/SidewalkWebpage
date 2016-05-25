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
        map = L.mapbox.map('modal-mission-complete-map', "kotarohara.8e0c6890", {
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
    overlayPolygonLayer.setStyle({ "fillColor": "rgb(255, 255, 255)", "weight": 0 });

    // Bar chart visualization
    // Todo. This can be cleaned up!!!
    var svgCoverageBarWidth = 335,
        svgCoverageBarHeight = 20;
    var svgCoverageBar = d3.select("#modal-mission-complete-complete-bar")
        .append("svg")
        .attr("width", svgCoverageBarWidth)
        .attr("height", svgCoverageBarHeight);

    var gBackground = svgCoverageBar.append("g").attr("class", "g-background");
    var horizontalBarBackground = gBackground.selectAll("rect")
        .data([1])
        .enter().append("rect")
        .attr("x", 0)
        .attr("y", 0)
        .attr("fill", "rgba(240, 240, 240, 1)")
        .attr("height", svgCoverageBarHeight)
        .attr("width", svgCoverageBarWidth);

    var gBarChart = svgCoverageBar.append("g").attr("class", "g-bar-chart");
    var horizontalBarPreviousContribution = gBarChart.selectAll("rect")
        .data([0])
        .enter().append("rect")
        .attr("x", 0)
        .attr("y", 0)
        .attr("fill", "rgba(23, 55, 94, 1)")
        .attr("height", svgCoverageBarHeight)
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

    var gBarChart2 = svgCoverageBar.append("g").attr("class", "g-bar-chart");
    var horizontalBarMission = gBarChart2.selectAll("rect")
        .data([0])
        .enter().append("rect")
        .attr("x", 0)
        .attr("y", 0)
        .attr("fill", "rgba(0,112,192,1)")
        .attr("height", svgCoverageBarHeight)
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
        svl.ui.modalMissionComplete.background.on("click", handleBackgroundClick);
        svl.ui.modalMissionComplete.closeButton.on("click", handleCloseButtonClick);

        hideMissionComplete();
    }

    function _updateMissionLabelStatistics(curbRampCount, noCurbRampCount, obstacleCount, surfaceProblemCount, otherCount) {
        svl.ui.modalMissionComplete.curbRampCount.html(curbRampCount);
        svl.ui.modalMissionComplete.noCurbRampCount.html(noCurbRampCount);
        svl.ui.modalMissionComplete.obstacleCount.html(obstacleCount);
        svl.ui.modalMissionComplete.surfaceProblemCount.html(surfaceProblemCount);
        svl.ui.modalMissionComplete.otherCount.html(otherCount);
    }

    function _updateMissionProgressStatistics (auditedDistance, missionDistance, remainingDistance, unit) {
        if (!unit) unit = "kilometers";
        svl.ui.modalMissionComplete.totalAuditedDistance.html(auditedDistance.toFixed(2) + " " + unit);
        svl.ui.modalMissionComplete.missionDistance.html(missionDistance.toFixed(2) + " " + unit);
        svl.ui.modalMissionComplete.remainingDistance.html(remainingDistance.toFixed(2) + " " + unit);
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
           .attr("width", auditedDistanceRate * svgCoverageBarWidth);
       horizontalBarPreviousContributionLabel.transition()
           .delay(200)
           .text(parseInt(auditedDistanceRate * 100, 10) + "%");

       horizontalBarMission.attr("width", 0)
           .attr("x", auditedDistanceRate * svgCoverageBarWidth)
           .transition()
           .delay(1000)
           .duration(500)
           .attr("width", missionDistanceRate * svgCoverageBarWidth);
       horizontalBarMissionLabel.attr("x", auditedDistanceRate * svgCoverageBarWidth + 3)
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
        hideMissionComplete();
    }

    /**
     * Callback function for button click
     * @param e
     */
    function handleCloseButtonClick(e) {
        hideMissionComplete();
    }

    /**
     * Hide a mission
     */
    function hideMissionComplete () {
        svl.ui.modalMissionComplete.holder.css('visibility', 'hidden');
        svl.ui.modalMissionComplete.foreground.css('visibility', "hidden");
        svl.ui.modalMissionComplete.map.css('top', 500);
        svl.ui.modalMissionComplete.map.css('left', -500);
        $(".leaflet-clickable").css('visibility', 'hidden');
        $(".leaflet-control-attribution").remove();
    }

    function setMissionTitle (missionTitle) {
        svl.ui.modalMissionComplete.missionTitle.html(missionTitle);
    }

    /** 
     * Show the modal window that presents stats about the completed mission
     */
    function show () {
        svl.ui.modalMissionComplete.holder.css('visibility', 'visible');
        svl.ui.modalMissionComplete.foreground.css('visibility', "visible");
        svl.ui.modalMissionComplete.map.css('top', 0);  // Leaflet map overlaps with the ViewControlLayer
        svl.ui.modalMissionComplete.map.css('left', 0);
        // svl.ui.modalMissionComplete.leafletClickable.css('visibility', 'visible');
        $(".leaflet-clickable").css('visibility', 'visible');


        if ("neighborhoodContainer" in svl && svl.neighborhoodContainer && "missionContainer" in svl && svl.missionContainer) {
            var neighborhood = svl.neighborhoodContainer.getCurrentNeighborhood(),
                mission = svl.missionContainer.getCurrentMission();
            if (neighborhood && mission) {
                // Focus on the current region on the Leaflet map
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
                var missionDistance = mission.getProperty("distanceMi");

                var completedTasks = svl.taskContainer.getCompletedTasks(regionId);
                var missionTasks = mission.getRoute();
                var totalLineDistance = svl.taskContainer.totalLineDistanceInARegion(regionId, unit);

                var missionDistanceRate = missionDistance / totalLineDistance;
                var auditedDistanceRate = Math.max(0, auditedDistance / totalLineDistance - missionDistanceRate);

                // var curbRampCount = svl.labelCounter.countLabel("CurbRamp");
                // var noCurbRampCount = svl.labelCounter.countLabel("NoCurbRamp");
                // var obstacleCount = svl.labelCounter.countLabel("Obstacle");
                // var surfaceProblemCount = svl.labelCounter.countLabel("SurfaceProblem");
                // var otherCount = svl.labelCounter.countLabel("Other");
                var labelCount = mission.getLabelCount();
                if (labelCount) {
                    var curbRampCount = labelCount["CurbRamp"];
                    var noCurbRampCount = labelCount["NoCurbRamp"];
                    var obstacleCount = labelCount["Obstacle"];
                    var surfaceProblemCount = labelCount["SurfaceProblem"];
                    var otherCount = labelCount["Other"];
                } else {
                    var curbRampCount = 0;
                    var noCurbRampCount = 0;
                    var obstacleCount = 0;
                    var surfaceProblemCount = 0;
                    var otherCount = 0;
                }


                setMissionTitle(mission.getProperty("label"));
                _updateTheMissionCompleteMessage();
                _updateNeighborhoodDistanceBarGraph(missionDistanceRate, auditedDistanceRate);
                _updateNeighborhoodStreetSegmentVisualization(missionTasks, completedTasks);
                _updateMissionProgressStatistics(auditedDistance, missionDistance, remainingDistance, unit);
                _updateMissionLabelStatistics(curbRampCount, noCurbRampCount, obstacleCount, surfaceProblemCount, otherCount);
            }
        }
    }

    /**
     * This method randomly select a mission completion message from the list and present it to the user.
     * @private
     */
    function _updateTheMissionCompleteMessage() {
        var messages = [
                'Couldn’t have done it better myself.',
                'Aren’t you proud of yourself? We are.',
                'WOWZA. Even the sidewalks are impressed. Keep labeling!',
                'Your auditing is out of this world.',
                'Incredible. You\'re a machine! ...no wait, I am.',
                'Gold star. You can wear it proudly on your forehead all day if you\'d like, we won\'t judge.',
                'Ooh la la! Those accessibility labels are to die for.',
                'We knew you had it in you all along. Great work!',
                'Wow you did really well. You also did good! Kind of like superman.',
                'You\'re one lightning bolt away from being a greek diety. Keep on going!',
                '"Great job. Every accomplishment starts with the decision to try." - That inspirational poster in your office',
                'The [mass x acceleration] is strong with this one. (Physics + Star Wars, get it?)',
                'Hey, check out the reflection in your computer screen. That\'s what awesome looks like.',
                'You. Are. Unstoppable. Keep it up!',
                'Today you are Harry Potter\'s golden snitch. Your wings are made of awesome.',
                'They say unicorns don\'t exist, but hey! We found you. Keep on keepin\' on.',
                '"Uhhhhhhrr Ahhhhrrrrrrrrgggg " Translation: Awesome job! Keep going. - Chewbacca',
                'You\'re seriously talented. You could go pro at this.',
                'Forget Frodo, I would have picked you to take the one ring to Mordor. Great work!',
                'You might actually be a wizard. These sidewalks are better because of you.'
            ],
            message = messages[Math.floor(Math.random() * messages.length)];
        svl.ui.modalMissionComplete.message.html(message);
    }

    _init();

    self.hide = hideMissionComplete;
    self.show = show;
    return self;
}
