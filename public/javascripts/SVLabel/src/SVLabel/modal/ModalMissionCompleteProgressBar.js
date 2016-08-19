function ModalMissionCompleteProgressBar (uiModalMissionComplete) {
    var $completeBar = uiModalMissionComplete.holder.find("#modal-mission-complete-complete-bar");
    var svgCoverageBarWidth = 275,
        svgCoverageBarHeight = 20;
    var svgCoverageBar = d3.select($completeBar.get(0))
        .append("svg")
        .attr("width", svgCoverageBarWidth)
        .attr("height", svgCoverageBarHeight);

    // gray background for the incomplete parts of the bar
    var gBackground = svgCoverageBar.append("g").attr("class", "g-background");
    var horizontalBarBackground = gBackground.selectAll("rect")
        .data([1])
        .enter().append("rect")
        .attr("x", 0)
        .attr("y", 0)
        .attr("fill", "rgba(220, 220, 220, 1)")
        .attr("height", svgCoverageBarHeight)
        .attr("width", svgCoverageBarWidth);

    // blue bar segment representing percent of neighborhood complete prior to current audit goal
    var gBarChart = svgCoverageBar.append("g").attr("class", "g-bar-chart");
    var horizontalBarPreviousContribution = gBarChart.selectAll("rect")
        .data([0])
        .enter().append("rect")
        .attr('id', 'blue-bar')
        .attr("x", 0)
        .attr("y", 0)
        .attr("fill", "rgba(49,130,189,1)")
        .attr("height", svgCoverageBarHeight)
        .attr("width", 0);

    // green bar segment representing percent of neighborhood completed in current audit
    var gBarChart2 = svgCoverageBar.append("g").attr("class", "g-bar-chart");
    var horizontalBarMission = gBarChart2.selectAll("rect")
        .data([0])
        .enter().append("rect")
        .attr('id', 'green-bar')
        .attr("x", 0)
        .attr("y", 0)
        .attr("fill", "rgba(100,240,110,1)")
        .attr("height", svgCoverageBarHeight)
        .attr("width", 0);

    // text over bar indicating total percentage of neighborhood that has been audited
    var horizontalBarMissionLabel = gBarChart2.selectAll("text")
        .data([""])
        .enter().append("text")
        .attr('id', 'bar-text')
        .attr("x", 3)
        .attr("y", 15)
        .attr("dx", 0)
        .attr("fill", "white")
        .attr("font-size", "10pt")
        .text(function (d) {
            return d;
        })
        .style("visibility", "hidden");

    /**
     * Update the bar graph visualization
     * @param missionDistanceRate
     * @param auditedDistanceRate
     */
    this.update = function (missionDistanceRate, auditedDistanceRate) {
        // bar starts empty for 0.2 seconds
        // then fills up with blue up to auditedDistanceRate over 0.8 seconds
        horizontalBarPreviousContribution.attr("width", 0)
            .transition()
            .delay(200)
            .duration(800)
            .attr("width", auditedDistanceRate * svgCoverageBarWidth);

        // green bar starts to animate immediately after the blue bar
        // fills up to auditedDistanceRate + missionDistanceRate
        horizontalBarMission.attr("width", 0)
            .attr("x", auditedDistanceRate * svgCoverageBarWidth)
            .transition()
            .delay(1000)
            .duration(500)
            .attr("width", missionDistanceRate * svgCoverageBarWidth);

        // text updates to match total audited in neighborhood so far    
        horizontalBarMissionLabel.text(parseInt((auditedDistanceRate + missionDistanceRate) * 100, 10) + "%");
    };
}