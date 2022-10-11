/**
 * StatusFieldOverall constructor. Holds overall stats for user in right sidebar.
 * @param uiStatus Holds jquery references to UI elements in right sidebar.
 * @constructor
 */
function StatusFieldOverall(uiStatus) {
    var self = this;
    var sessionStartTotalDist = null;
    var sessionStartNeighborhoodDist = null;
    var stats = {
        distance: 0.0,
        labelCount: 0,
        accuracy: null
    }

    this.incrementLabelCount = function () {
        stats.labelCount += 1;
        uiStatus.overallLabelCount.html(i18next.t('common:format-number', { val: stats.labelCount }));
    }

    this.decrementLabelCount = function () {
        stats.labelCount -= 1;
        uiStatus.overallLabelCount.html(i18next.t('common:format-number', { val: stats.labelCount }));
    }

    this.setNeighborhoodAuditedDistance = function (neighborhoodDistance) {
        if (!sessionStartNeighborhoodDist) sessionStartNeighborhoodDist = neighborhoodDistance;
        stats.distance = sessionStartTotalDist - sessionStartNeighborhoodDist + neighborhoodDistance;
        uiStatus.overallDistance.html(i18next.t('common:format-number', { val: stats.distance.toFixed(2) }));
    }

    // Query backend for user stats, store in HTML elements.
    $.getJSON('/userapi/basicStats', function (result) {
        sessionStartTotalDist = result.distance_audited;
        uiStatus.overallDistance.html(i18next.t('common:format-number', { val: sessionStartTotalDist.toFixed(2) }));
        stats.labelCount += result.label_count;
        uiStatus.overallLabelCount.html(i18next.t('common:format-number', { val: stats.labelCount }));

        var tooltipText;
        if (result.accuracy !== null) {
            stats.accuracy = 100 * result.accuracy;
            uiStatus.overallAccuracy.html(`${i18next.t('common:format-number', {val: stats.accuracy.toFixed(2)})}%`);
            tooltipText = i18next.t('right-ui.accuracy-tooltip');
        } else {
            uiStatus.overallAccuracy.html('N/A');
            tooltipText = i18next.t('right-ui.no-accuracy-tooltip');
        }

        // Initialize the tooltip popover on the accuracy rating. It should remain open when hovering over the tooltip.
        // https://stackoverflow.com/a/19684440/9409728
        uiStatus.overallAccuracyRow.popover({
            trigger: 'manual',
            html: true,
            placement: 'top',
            template: "<div class='popover' id='accuracy-rating-tooltip' role='tooltip'><div class='arrow'></div><div class='popover-content'></div></div>",
            content: tooltipText
        }).on('mouseenter', function() {
            var _this = this;
            $(this).popover('show');
            $('.popover').on('mouseleave', function() {
                $(_this).popover('hide');
            });
            // Log clicks to the link on to the User Dashboard.
            if (result.accuracy !== null) {
                $('#tooltip-dashboard-link').on('click', function() {
                    svl.tracker.push('Click_AccuracyTooltipToDashboard');
                });
            }
        }).on('mouseleave', function() {
            var _this = this;
            setTimeout(function() {
                if (!$(".popover:hover").length) {
                    $(_this).popover('hide');
                }
            }, 400);
        });
    });

}
