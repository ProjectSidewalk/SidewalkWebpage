function ModalMissionCompleteProgressBar (uiModalMissionComplete) {
    const $completeBar = uiModalMissionComplete.completeBar;

    // Reference (--ui-scale = 1) dimensions.
    const BASE_BAR_WIDTH = 370;
    const BASE_BAR_HEIGHT = 20;

    // Reads the current --ui-scale from the document root so the SVG matches the scaled modal around it.
    const getScale = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1;

    var svgCoverageBar = d3.select($completeBar.get(0))
        .append("svg")
        .attr("width", BASE_BAR_WIDTH)
        .attr("height", BASE_BAR_HEIGHT);

    var gBackground = svgCoverageBar.append("g").attr("class", "g-background");
    var horizontalBarBackground = gBackground.selectAll("rect")
        .data([1])
        .enter().append("rect")
        .attr("x", 0)
        .attr("y", 0)
        .attr("fill", "rgba(220, 220, 220, 1)")
        .attr("height", BASE_BAR_HEIGHT)
        .attr("width", BASE_BAR_WIDTH);

    var gBarChart = svgCoverageBar.append("g").attr("class", "g-bar-chart");
    var horizontalBarOtherContribution = gBarChart.selectAll("rect")
        .data([0])
        .enter().append("rect")
        .attr('id', 'gray-bar')
        .attr("x", 0)
        .attr("y", 0)
        .attr("fill", "rgba(80,80,80,1)")
        .attr("height", BASE_BAR_HEIGHT)
        .attr("width", 0);

    var gBarChart2 = svgCoverageBar.append("g").attr("class", "g-bar-chart");
    var horizontalBarPreviousContribution = gBarChart2.selectAll("rect")
        .data([0])
        .enter().append("rect")
        .attr('id', 'blue-bar')
        .attr("x", 0)
        .attr("y", 0)
        .attr("fill", "rgba(70,130,180,1)")
        .attr("height", BASE_BAR_HEIGHT)
        .attr("width", 0);

    var gBarChart3 = svgCoverageBar.append("g").attr("class", "g-bar-chart");
    var horizontalBarMission = gBarChart3.selectAll("rect")
        .data([0])
        .enter().append("rect")
        .attr('id', 'green-bar')
        .attr("x", 0)
        .attr("y", 0)
        .attr("fill", "rgba(20,220,120,1)")
        .attr("height", BASE_BAR_HEIGHT)
        .attr("width", 0);
    var horizontalBarMissionLabel = gBarChart3.selectAll("text")
        .data([""])
        .enter().append("text")
        .attr('id', 'bar-text')
        .attr("x", 3)
        .attr("y", 15)
        .attr("dx", 0)
        .attr("fill", "white")
        .style("font", "var(--text-small-regular)")
        .text(function (d) {
            return d;
        })
        .style("visibility", "hidden");

    /**
     * Update the bar graph visualization
     * @param missionDistanceRate
     * @param userAuditedDistanceRate
     * @param otherAuditedDistanceRate
     * @private
     */
    this.update = function (missionDistanceRate, userAuditedDistanceRate, otherAuditedDistanceRate) {

        // Size the bar to the current UI scale so it lines up with the rest of the (scaled) modal.
        const scale = getScale();
        const svgCoverageBarWidth = BASE_BAR_WIDTH * scale;
        const svgCoverageBarHeight = BASE_BAR_HEIGHT * scale;
        svgCoverageBar.attr("width", svgCoverageBarWidth).attr("height", svgCoverageBarHeight);
        horizontalBarBackground.attr("width", svgCoverageBarWidth).attr("height", svgCoverageBarHeight);
        horizontalBarOtherContribution.attr("height", svgCoverageBarHeight);
        horizontalBarPreviousContribution.attr("height", svgCoverageBarHeight);
        horizontalBarMission.attr("height", svgCoverageBarHeight);
        horizontalBarMissionLabel
            .attr("x", 3 * scale)
            .attr("y", 15 * scale);

        // Round the rates to 0.01 accuracy.
        var roundedMissionDistanceRate = parseFloat(missionDistanceRate.toFixed(3));
        var roundedUserAuditedDistanceRate = parseFloat(userAuditedDistanceRate.toFixed(3));
        var roundedOtherAuditedDistanceRate = parseFloat(otherAuditedDistanceRate.toFixed(3));

        horizontalBarOtherContribution.attr("width", 0)
            .transition()
            .delay(200)
            .duration(600)
            .attr("width", roundedOtherAuditedDistanceRate * svgCoverageBarWidth);

        horizontalBarPreviousContribution.attr("width", 0)
            .attr("x", roundedOtherAuditedDistanceRate * svgCoverageBarWidth)
            .transition()
            .delay(800)
            .duration(600)
            .attr("width", roundedUserAuditedDistanceRate * svgCoverageBarWidth);

        horizontalBarMission.attr("width", 0)
            .attr("x", (roundedOtherAuditedDistanceRate + roundedUserAuditedDistanceRate) * svgCoverageBarWidth)
            .transition()
            .delay(1400)
            .duration(600)
            .attr("width", Math.max(1, roundedMissionDistanceRate * svgCoverageBarWidth));
        horizontalBarMissionLabel.text(parseInt(((roundedUserAuditedDistanceRate + roundedMissionDistanceRate) * 100).toString(), 10) + "%");
    };
}
