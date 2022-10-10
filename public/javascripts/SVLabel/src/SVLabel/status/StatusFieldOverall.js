/**
 * StatusFieldOverall constructor. Holds overall stats for user in right sidebar.
 * @param uiStatus Holds jquery references to UI elements in right sidebar.
 * @constructor
 */
function StatusFieldOverall(uiStatus) {
    var self = this;
    var sessionStartTotalDistance = null;
    var sessionStartNeighborhoodDistance = null;
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
        if (!sessionStartNeighborhoodDistance) sessionStartNeighborhoodDistance = neighborhoodDistance;
        stats.distance = sessionStartTotalDistance - sessionStartNeighborhoodDistance + neighborhoodDistance;
        uiStatus.overallDistance.html(i18next.t('common:format-number', { val: stats.distance.toFixed(2) }));
    }

    // Query backend for user stats, store in HTML elements.
    $.getJSON('/userapi/basicStats', function (result) {
        sessionStartTotalDistance = result.distance_audited;
        stats.labelCount += result.label_count;
        uiStatus.overallLabelCount.html(i18next.t('common:format-number', { val: stats.labelCount }));
        stats.accuracy = 100 * result.accuracy;
        uiStatus.overallAccuracy.html(`${i18next.t('common:format-number', { val: stats.accuracy.toFixed(2) })}%`);
    });
}
