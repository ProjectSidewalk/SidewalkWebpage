/**
 * ModalMission module
 * @param $ jquery library
 * @param d3 d3 library
 * @param L Leaflet library
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function ModalMissionComplete ($, d3, L, missionContainer, taskContainer, modalMissionCompleteMap, uiModalMissionComplete, modalModel) {
    var self = { className : 'ModalMissionComplete'},
        properties = {
            boxTop: 180,
            boxLeft: 45,
            boxWidth: 640
        };

    var _modalModel = modalModel;

    _modalModel.on("ModalMissionComplete:update", function (parameters) {
        update(parameters.mission, parameters.neighborhood);
    });

    _modalModel.on("ModalMissionComplete:show", function () {
        show();
    });

    _modalModel.on("ModalMissionComplete:one", function (parameters) {
        one(parameters.uiComponent, parameters.eventType, parameters.callback);
    });

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
        .attr('id', 'barText')
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
        uiModalMissionComplete.background.on("click", handleBackgroundClick);
        uiModalMissionComplete.closeButton.on("click", handleCloseButtonClick);

        hideMissionComplete();
    }

    function _updateMissionLabelStatistics(curbRampCount, noCurbRampCount, obstacleCount, surfaceProblemCount, otherCount) {
        uiModalMissionComplete.curbRampCount.html(curbRampCount);
        uiModalMissionComplete.noCurbRampCount.html(noCurbRampCount);
        uiModalMissionComplete.obstacleCount.html(obstacleCount);
        uiModalMissionComplete.surfaceProblemCount.html(surfaceProblemCount);
        uiModalMissionComplete.otherCount.html(otherCount);
    }

    function _updateMissionProgressStatistics (missionDistance, cumulativeAuditedDistance, remainingDistance, unit) {
        if (!unit) unit = "kilometers";

        remainingDistance = Math.max(remainingDistance, 0);
        uiModalMissionComplete.missionDistance.html(missionDistance.toFixed(1) + " " + unit);
        uiModalMissionComplete.totalAuditedDistance.html(cumulativeAuditedDistance.toFixed(1) + " " + unit);
        uiModalMissionComplete.remainingDistance.html(remainingDistance.toFixed(1) + " " + unit);
    }

    /**
     * Update the bar graph visualization
     * @param missionDistanceRate
     * @param auditedDistanceRate
     * @private
     */
    function _updateNeighborhoodDistanceBarGraph(missionDistanceRate, auditedDistanceRate) {
       horizontalBarPreviousContribution.attr('id', 'missionDist')
           .attr("width", 0)
           .transition()
           .delay(200)
           .duration(800)
           .attr("width", auditedDistanceRate * svgCoverageBarWidth);
       
       horizontalBarMission.attr('id', 'auditedDist')
           .attr("width", 0)
           .attr("x", auditedDistanceRate * svgCoverageBarWidth)
           .transition()
           .delay(1000)
           .duration(500)
           .attr("width", missionDistanceRate * svgCoverageBarWidth);
       horizontalBarMissionLabel.text(parseInt((auditedDistanceRate + missionDistanceRate) * 100, 10) + "%");
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
        uiModalMissionComplete.holder.css('visibility', 'hidden');
        uiModalMissionComplete.foreground.css('visibility', "hidden");
        uiModalMissionComplete.background.css('visibility', "hidden");
        horizontalBarMissionLabel.style("visibility", "hidden");
        modalMissionCompleteMap.hide();
    }

    function setMissionTitle (missionTitle) {
        uiModalMissionComplete.missionTitle.html(missionTitle);
    }

    function update(mission, neighborhood) {
        // Update the horizontal bar chart to show how much distance the user has audited
        var unit = "miles";
        var regionId = neighborhood.getProperty("regionId");

        // Compute the distance traveled in this mission, distance traveled so far, and the remaining distance
        // in this neighborhood
        var maxDist = 0;
        var completedMissions = missionContainer.getCompletedMissions();
        var regionMissions = completedMissions.filter( function (m) { return m.getProperty("regionId") == regionId; });

        if(regionMissions.length > 1){
            // Map mission distances and sort them descending. Take second highest (highest is this mission)
            var missionDistances =  regionMissions.map( function (d) { return d.getProperty("distanceMi"); }).sort().reverse();
            maxDist = missionDistances[1];
        }

        var missionDistance = mission.getProperty("distanceMi") - maxDist;
        var auditedDistance = neighborhood.completedLineDistance(unit);
        var remainingDistance = neighborhood.totalLineDistance(unit) - auditedDistance;

        var completedTasks = taskContainer.getCompletedTasks(regionId);
        var missionTasks = mission.getRoute();
        var totalLineDistance = taskContainer.totalLineDistanceInARegion(regionId, unit);
        var missionDistanceRate = missionDistance / totalLineDistance;
        var auditedDistanceRate = Math.max(0, auditedDistance / totalLineDistance - missionDistanceRate);

        var labelCount = mission.getLabelCount(),
            curbRampCount = labelCount ? labelCount["CurbRamp"] : 0,
            noCurbRampCount = labelCount ? labelCount["NoCurbRamp"] : 0 ,
            obstacleCount = labelCount ? labelCount["Obstacle"] : 0,
            surfaceProblemCount = labelCount ? labelCount["SurfaceProblem"] : 0,
            otherCount = labelCount ? labelCount["Other"] : 0;

        var neighborhoodName = neighborhood.getProperty("name");
        setMissionTitle(neighborhoodName);

        modalMissionCompleteMap.update(neighborhood);
        modalMissionCompleteMap.updateStreetSegments(missionTasks, completedTasks);

        _updateTheMissionCompleteMessage();
        _updateNeighborhoodDistanceBarGraph(missionDistanceRate, auditedDistanceRate);

        _updateMissionProgressStatistics(auditedDistance, missionDistance, remainingDistance, unit);
        _updateMissionLabelStatistics(curbRampCount, noCurbRampCount, obstacleCount, surfaceProblemCount, otherCount);
    }

    /** 
     * Show the modal window that presents stats about the completed mission
     */
    function show () {
        uiModalMissionComplete.holder.css('visibility', 'visible');
        uiModalMissionComplete.foreground.css('visibility', "visible");
        uiModalMissionComplete.background.css('visibility', "visible");
        horizontalBarMissionLabel.style("visibility", "visible");
        modalMissionCompleteMap.show();
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
        uiModalMissionComplete.message.html(message);
    }

    function one (uiComponent, eventType, callback) {
        uiModalMissionComplete[uiComponent].one(eventType, callback);
    }

    _init();

    self.getProperty = getProperty;
    self.setMissionTitle = setMissionTitle;
    self._updateTheMissionCompleteMessage = _updateTheMissionCompleteMessage;
    self._updateNeighborhoodDistanceBarGraph = _updateNeighborhoodDistanceBarGraph;
    self._updateMissionProgressStatistics = _updateMissionProgressStatistics;
    self._updateMissionLabelStatistics = _updateMissionLabelStatistics;
    self.hide = hideMissionComplete ;
    self.show = show;
    self.one = one;
    self.update = update;
    return self;
}