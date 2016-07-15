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
        .attr("fill", "rgba(240, 240, 240, 1)")
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
        .style("visibility", "hidden");

    var gBarChart2 = svgCoverageBar.append("g").attr("class", "g-bar-chart");
    var horizontalBarMission = gBarChart2.selectAll("rect")
        .data([0])
        .enter().append("rect")
        .attr("x", 0)
        .attr("y", 0)
        .attr("fill", "rgba(49,189,100,1)")
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
        if (!unit) unit = "kilometers"; //why?
        svl.ui.modalMissionComplete.totalAuditedDistance.html(auditedDistance.toFixed(1) + " " + unit);
        svl.ui.modalMissionComplete.missionDistance.html(missionDistance.toFixed(1) + " " + unit);
        svl.ui.modalMissionComplete.remainingDistance.html(remainingDistance.toFixed(1) + " " + unit);
    }

    var coll = {"type":"FeatureCollection",
                        "features":[
                        {"type":"Feature","geometry":{"type":"LineString",
                        "coordinates":[
                        [-77.041402,38.8764389],
                        [-77.059005,38.8864323],
                        [-77.063005,38.8864250],
                        [-77.063005,38.8964180],
                        [-77.069005,38.8964180]
                        ]},"properties":{"name":"line0"}},
                        {"type":"Feature","geometry":{"type":"LineString",
                        "coordinates":[
                        [-77.069005,38.9164120],
                        [-77.075005,38.9164120],
                        [-77.075005,38.9364080],
                        [-77.092005,38.9564080]
                        ]}}]
                        
                    };

    function lsToPoint(coll){
        var coorList = coll.features[0].geometry.coordinates;
        var featureList = [];
        var len = coorList.length;

        for(i = 0; i < len; i ++){
            var feature = turf.point(coorList[i]);
            featureList.push(feature);
        }

        var geoJSON = {
            "type": "FeatureCollection",
            "features": featureList
        };

        return geoJSON;


    }

    function _animateMissionTasks(){
        // http://zevross.com/blog/2014/09/30/use-the-amazing-d3-library-to-animate-a-path-on-a-leaflet-map/
        // using d3 on leaflet

        var collection = lsToPoint(coll);
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

        var ptFeatures = g.selectAll("circle")
            .data(featuresdata)
            .enter()
            .append("circle")
            .attr("r", 3)
            .attr("class", "waypoints");

        var linePath = g.selectAll(".lineConnect")
            .data([featuresdata])
            .enter()
            .append("path")
            .attr("class", "lineConnect");

        var marker = g.append("circle")
            .attr("r", 10)
            .attr("id", "marker")
            .attr("class", "travelMarker");

        var originANDdestination = [featuresdata[0], featuresdata[featuresdata.length-1]];

        var begend = g.selectAll(".drinks")
            .data(originANDdestination)
            .enter()
            .append("circle", ".drinks")
            .attr("r", 5)
            .style("fill", "red")
            .style("opacity", "1");

        map.on("viewreset", reset);

        reset();
        transition();

        // Reposition the SVG to cover the features.
        function reset() {
            var bounds = d3path.bounds(collection),
                topLeft = bounds[0],
                bottomRight = bounds[1];

            // for the points we need to convert from latlong
            // to map units
            begend.attr("transform",
                function(d) {
                    return "translate(" +
                        applyLatLngToLayer(d).x + "," +
                        applyLatLngToLayer(d).y + ")";
                });

            ptFeatures.attr("transform",
                function(d) {
                    return "translate(" +
                        applyLatLngToLayer(d).x + "," +
                        applyLatLngToLayer(d).y + ")";
                });

            // again, not best practice, but I'm harding coding
            // the starting point

            marker.attr("transform",
                function() {
                    var y = featuresdata[0].geometry.coordinates[1];
                    var x = featuresdata[0].geometry.coordinates[0];
                    return "translate(" +
                        map.latLngToLayerPoint(new L.LatLng(y, x)).x + "," +
                        map.latLngToLayerPoint(new L.LatLng(y, x)).y + ")";
                });


            // Setting the size and location of the overall SVG container
            svg.attr("width", bottomRight[0] - topLeft[0] + 120)
                .attr("height", bottomRight[1] - topLeft[1] + 120)
                .style("left", topLeft[0] - 50 + "px")
                .style("top", topLeft[1] - 50 + "px");


            // linePath.attr("d", d3path);
            linePath.attr("d", toLine);
            // ptPath.attr("d", d3path);
            g.attr("transform", "translate(" + (-topLeft[0] + 50) + "," + (-topLeft[1] + 50) + ")");

        } // end reset

        function transition() {
            linePath.transition()
                .duration(7500)
                .attrTween("stroke-dasharray", tweenDash)
                .style("opacity", "1")
                .each("end", function() {
                    //d3.select(this).call(transition);// infinite loop
                }); 
        } //end transition

        // this function feeds the attrTween operator above with the 
        // stroke and dash lengths
        function tweenDash() {
            return function(t) {
                //total length of path (single value)
                var l = linePath.node().getTotalLength(); 
            
                interpolate = d3.interpolateString("0," + l, l + "," + l);
                //t is fraction of time 0-1 since transition began
                var marker = d3.select("#marker");
                
              
                var p = linePath.node().getPointAtLength(t * l);

                //Move the marker to that point
                marker.attr("transform", "translate(" + p.x + "," + p.y + ")"); //move marker
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


    function _updateNeighborhoodStreetSegmentVisualization(missionTasks, completedTasks) {
        // var completedTasks = svl.taskContainer.getCompletedTasks(regionId);
        // var missionTasks = mission.getRoute();

        if (completedTasks && missionTasks) {
            // Add layers http://leafletjs.com/reference.html#map-addlayer
            var i, len, geojsonFeature, featureCollection, layer,
                completedTaskLayerStyle = { color: "rgb(49,130,189)", opacity: 1, weight: 3 },
                missionTaskLayerStyle = { color: "rgb(49,189,100)", opacity: 1, weight: 3 };

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

        _animateMissionTasks();
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
        $(".leaflet-clickable").css('visibility', 'visible');
        $(".g-bar-chart").css('visibility', 'visible');
        $(".leaflet-zoom-animated path").css('visibility', 'visible');


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

                // doing this the basic long way
                var secondMax = 0;
                var maxDist = 0;
                var completedMissions = svl.missionContainer.getCompletedMissions();
                for(var i = 0;  i <  completedMissions.length; i++){
                    if(completedMissions[i].getProperty("regionId") == regionId){
                        var missionDist = completedMissions[i].getProperty("distanceMi");
                        if(missionDist > maxDist){
                            secondMax = maxDist;
                            maxDist = missionDist;
                        }
                    }
                }
                var missionDistance = mission.getProperty("distanceMi") - secondMax;
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
        var weirdLineBreakMessages = [
            'You\'re one lightning bolt away from being a greek diety. Keep on going!',
            'Gold star. You can wear it proudly on your forehead all day if you\'d like. </br>We won\'t judge.',
            '"Great job. Every accomplishment starts with the decision to try."</br> - That inspirational poster in your office',
            'Wow you did really well. You also did good! Kind of like superman.'
        ];
        var messages = [
                'Couldn’t have done it better myself.',
                'Aren’t you proud of yourself?We are.',
                'WOWZA. Even the sidewalks are impressed. Keep labeling!',
                'Your auditing is out of this world.',
                'Incredible. You\'re a machine! ...no wait, I am.',
                'Ooh la la! Those accessibility labels are to die for.',
                'We knew you had it in you all along. Great work!',
                'The [mass x acceleration] is strong with this one. </br>(Physics + Star Wars, get it?)',
                'Hey, check out the reflection in your computer screen. That\'s what awesome looks like.',
                'You. Are. Unstoppable. Keep it up!',
                'Today you are Harry Potter\'s golden snitch. Your wings are made of awesome.',
                'They say unicorns don\'t exist, but hey! We found you. Keep on keepin\' on.',
                '"Uhhhhhhrr Ahhhhrrrrrrrrgggg " Translation: Awesome job! Keep going. </br>- Chewbacca',
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
