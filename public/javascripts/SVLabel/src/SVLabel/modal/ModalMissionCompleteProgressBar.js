function ModalMissionCompleteProgressBar (uiModalMissionComplete) {
    var $completeBar = uiModalMissionComplete.holder.find("#modal-mission-complete-complete-bar");
    var svgCoverageBarWidth = 370,
        svgCoverageBarHeight = 20;
    var svgCoverageBar = d3.select($completeBar.get(0))
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
        .attr('id', 'blue-bar')
        .attr("x", 0)
        .attr("y", 0)
        .attr("fill", "rgba(80,80,80,1)")
        .attr("height", svgCoverageBarHeight)
        .attr("width", 0);

    var gBarChart2 = svgCoverageBar.append("g").attr("class", "g-bar-chart");
    var horizontalBarMission = gBarChart2.selectAll("rect")
        .data([0])
        .enter().append("rect")
        .attr('id', 'green-bar')
        .attr("x", 0)
        .attr("y", 0)
        .attr("fill", "rgba(20,220,120,1)")
        .attr("height", svgCoverageBarHeight)
        .attr("width", 0);
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
     * @private
     */
    this.update = function (missionDistanceRate, auditedDistanceRate) {
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
        horizontalBarMissionLabel.text(parseInt((auditedDistanceRate + missionDistanceRate) * 100, 10) + "%");
    };
}