/**
 * ModalMission module
 * @param $ jquery library
 * @param d3 d3 library
 * @param L Leaflet library
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
                minZoom: 10
            })
            .fitBounds(bounds);
    // these two are defined globaly so that they can be added in show and removed in hide
    var overlayPolygon;
    var overlayPolygonLayer;

    // Bar chart visualization
    // Todo. This can be cleaned up!!!
    var svgCoverageBarWidth = 275,
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
        .attr("fill", "rgba(220, 220, 220, 1)")
        .attr("height", svgCoverageBarHeight)
        .attr("width", svgCoverageBarWidth);

    var gBarChart = svgCoverageBar.append("g").attr("class", "g-bar-chart");
    var horizontalBarPreviousContribution = gBarChart.selectAll("rect")
        .data([0])
        .enter().append("rect")
        .attr("x", 0)
        .attr("y", 0)
        .attr("fill", "rgba(49,130,189,1)")
        .attr("height", svgCoverageBarHeight)
        .attr("width", 0);
 
    var gBarChart2 = svgCoverageBar.append("g").attr("class", "g-bar-chart");
    var horizontalBarMission = gBarChart2.selectAll("rect")
        .data([0])
        .enter().append("rect")
        .attr("x", 0)
        .attr("y", 0)
        .attr("fill", "rgba(100,240,110,1)")
        .attr("height", svgCoverageBarHeight)
        .attr("width", 0);
    var horizontalBarMissionLabel = gBarChart2.selectAll("text")
        .data([""])
        .enter().append("text")
        .attr("x", 3)
        .attr("y", 15)
        .attr("dx", 0)
        .attr("fill", "white")
        .attr("font-size", "10pt")
        .text(function (d) {
            return d;
        })
        .style("visibility", "hidden");


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
        svl.ui.modalMissionComplete.totalAuditedDistance.html(auditedDistance.toFixed(1) + " " + unit);
        svl.ui.modalMissionComplete.missionDistance.html(missionDistance.toFixed(1) + " " + unit);
        svl.ui.modalMissionComplete.remainingDistance.html(remainingDistance.toFixed(1) + " " + unit);
    }
    
    // converts GeoJSON from the LineString format that we use into a collection of Points for the d3 animation
    function linestringToPoint(coll){
        // getting point data from list
        var coorList = coll.features[0].geometry.coordinates;
        var featureList = [];
        var len = coorList.length;

        for(i = 0; i < len; i ++){
            // convert to point GeoJSON
            var feature = turf.point(coorList[i]);
            featureList.push(feature);
        }
        var geoJSON = {
            "type": "FeatureCollection",
            "features": featureList
        };
        return geoJSON;
    }

    // animates each segment of the 
    function _animateMissionTasks(coll, index, max){
        var collection = linestringToPoint(coll[index].getGeoJSON());
        var featuresdata = collection.features;
    
        svg = d3.select(map.getPanes().overlayPane).append("svg"),

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

        var originANDdestination = [featuresdata[0], featuresdata[featuresdata.length-1]];

        // reset projection on zoom
        map.on("viewreset", reset);

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

        } // end reset

        
        function transition() {
            linePath.transition()
                .duration(3000)
                .attrTween("stroke-dasharray", tweenDash)
                .each("end", function() {
                    if(index < max){
                        // recursively call the next animation render when this one is done
                        _animateMissionTasks(coll, index+1, max);
                    }
                    else{
                        //render the complete path as plain svg to avoid scaling issues
                        renderPath(coll);
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
                interpolate = d3.interpolateString("0," + l, l + "," + l);
                var p = linePath.node().getPointAtLength(t * l);

                return interpolate(t);
            }
        } //end tweenDash

        function projectPoint(x, y) {
            var point = map.latLngToLayerPoint(new L.LatLng(y, x));
            this.stream.point(point.x, point.y);
        }

        function applyLatLngToLayer(d) {
            var y = d.geometry.coordinates[1];
            var x = d.geometry.coordinates[0];
            return map.latLngToLayerPoint(new L.LatLng(y, x));
        }
    }

    // render svg segments
    function renderPath(missionTasks){
        var missionTaskLayerStyle = { color: "rgb(100,240,110)", opacity: 1, weight: 3 };
        var len = missionTasks.length;
        for (var i = 0; i < len; i++) {
            var  geojsonFeature = missionTasks[i].getFeature();
            var layer = L.geoJson(geojsonFeature).addTo(map);
            layer.setStyle(missionTaskLayerStyle);
        }
    }
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
    function _updateNeighborhoodStreetSegmentVisualization(missionTasks, completedTasks) {
        // var completedTasks = svl.taskContainer.getCompletedTasks(regionId);
        // var missionTasks = mission.getRoute();

        if (completedTasks && missionTasks) {
            // Add layers http://leafletjs.com/reference.html#map-addlayer
            var i, len, geojsonFeature, featureCollection, layer,
                completedTaskLayerStyle = { color: "rgb(49,130,189)", opacity: 1, weight: 3 };

            // remove after animation, otherwise segments remain green from previous tasks
            d3.select(map.getPanes().overlayPane)
                .selectAll("svg")
                .selectAll(".lineConnect")
                .remove();

            var newStreets = missionTasks.map( function (t) { return t.getStreetEdgeId(); });
            len = completedTasks.length;
            // Add the completed task layer
            for (i = 0; i < len; i++) {
                var streetEdgeId = completedTasks[i].getStreetEdgeId();
                // do not render streets already in blue
                if(newStreets.indexOf(streetEdgeId) == -1){
                    geojsonFeature = completedTasks[i].getFeature();
                    layer = L.geoJson(geojsonFeature).addTo(map);
                    layer.setStyle(completedTaskLayerStyle);
                }
            }
            
            // Add the current mission animation layer
            len = missionTasks.length;
            if(len > 0){
                _animateMissionTasks(missionTasks, 0, len-1);    
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
       
       horizontalBarMission.attr("width", 0)
           .attr("x", auditedDistanceRate * svgCoverageBarWidth)
           .transition()
           .delay(1000)
           .duration(500)
           .attr("width", missionDistanceRate * svgCoverageBarWidth);
       horizontalBarMissionLabel.text(parseInt(auditedDistanceRate * 100, 10) + "%");
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
        if (overlayPolygonLayer) {
            map.removeLayer(overlayPolygonLayer);            
        }

        svl.ui.modalMissionComplete.holder.css('visibility', 'hidden');
        svl.ui.modalMissionComplete.foreground.css('visibility', "hidden");
        svl.ui.modalMissionComplete.map.css('top', 500);
        svl.ui.modalMissionComplete.map.css('left', -500);
        horizontalBarMissionLabel.style("visibility", "hidden");
        $(".leaflet-clickable").css('visibility', 'hidden');
        $(".leaflet-control-attribution").remove();
        $(".g-bar-chart").css('visibility', 'hidden');
        $(".leaflet-zoom-animated path").css('visibility', 'hidden');
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
        svl.ui.modalMissionComplete.map.css('left', 15);
        // svl.ui.modalMissionComplete.leafletClickable.css('visibility', 'visible');
        horizontalBarMissionLabel.style("visibility", "visible");
        $(".leaflet-clickable").css('visibility', 'visible');
        $(".g-bar-chart").css('visibility', 'visible');
        $(".leaflet-zoom-animated path").css('visibility', 'visible');


        if ("neighborhoodContainer" in svl && svl.neighborhoodContainer && "missionContainer" in svl && svl.missionContainer) {
            var neighborhood = svl.neighborhoodContainer.getCurrentNeighborhood(),
                mission = svl.missionContainer.getCurrentMission();
            if (neighborhood && mission) {
                // Focus on the current region on the Leaflet map
                var center = neighborhood.center();
                var neighborhoodGeom = neighborhood.getGeoJSON();
                // overlay of entire map bounds
                overlayPolygon = {
                    "type": "FeatureCollection",
                    "features": [{"type": "Feature", "geometry": {
                    "type": "Polygon", "coordinates": [
                        [[-75, 36], [-75, 40], [-80, 40], [-80, 36],[-75, 36]]
                ]}}]};
                // expand the neighborhood border because sometimes streets slightly out of bounds are in the mission
                var bufferedGeom = turf.buffer(neighborhoodGeom, 0.04, "miles");
                var bufferedCoors = bufferedGeom.features[0].geometry.coordinates[0];
                // cut out neighborhood from overlay
                overlayPolygon.features[0].geometry.coordinates.push(bufferedCoors);
                overlayPolygonLayer = L.geoJson(overlayPolygon);
                // everything but current neighborhood grayed out
                overlayPolygonLayer.setStyle({ "opacity": 0, "fillColor": "rgb(110, 110, 110)", "fillOpacity": 0.25});
                overlayPolygonLayer.addTo(map);
                if (center) {
                    map.setView([center.geometry.coordinates[1], center.geometry.coordinates[0]], 14);
                }

                // Update the horizontal bar chart to show how much distance the user has audited
                var unit = "miles";
                var regionId = neighborhood.getProperty("regionId");

                // doing this the basic long way
                var maxDist = 0;
                var completedMissions = svl.missionContainer.getCompletedMissions();
                // filter out missions not in this neighborhood
                var regionMissions = completedMissions.filter( function (m) { return m.getProperty("regionId") == regionId; });
                if(regionMissions.length > 1){
                    // map mission distances and sort them descending
                    var missionDistances =  regionMissions.map( function (d) { return d.getProperty("distanceMi"); }).sort().reverse();
                    // take second highest (highest is this mission)
                    maxDist = missionDistances[1];
                }
                var missionDistance = mission.getProperty("distanceMi") - maxDist;
                var auditedDistance = neighborhood.completedLineDistance(unit);
                var remainingDistance = neighborhood.totalLineDistance(unit) - auditedDistance;
                
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


                var missionLabel = mission.getProperty("label");
                if (missionLabel == "initial-mission") {
                    setMissionTitle("Initial Mission");
                } else {
                    var neighborhoodName = neighborhood.getProperty("name");
                    setMissionTitle(neighborhoodName);
                }

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
        // unused because they caused formatting, linebreak, or text overflow issues
        var unusedMessages = [
            'You\'re one lightning bolt away from being a greek diety. Keep on going!',
            'Gold star. You can wear it proudly on your forehead all day if you\'d like. </br>We won\'t judge.',
            '"Great job. Every accomplishment starts with the decision to try."</br> - That inspirational poster in your office',
            'Wow you did really well. You also did good! Kind of like superman.'
        ];
        var messages = [
                'Couldn’t have done it better myself.',
                'Aren’t you proud of yourself? We are!',
                'WOWZA. Even the sidewalks are impressed. Keep labeling!',
                'Your auditing is out of this world.',
                'Incredible. You\'re a machine! ...no wait, I am.',
                'Ooh la la! Those accessibility labels are to die for.',
                'We knew you had it in you all along. Great work!',
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
            emojis = [' :D', ' :)', ' ;-)'],
            message = messages[Math.floor(Math.random() * messages.length)] + emojis[Math.floor(Math.random() * emojis.length)];
        svl.ui.modalMissionComplete.message.html(message);
    }

    _init();

    self.hide = hideMissionComplete;
    self.show = show;
    return self;
}
