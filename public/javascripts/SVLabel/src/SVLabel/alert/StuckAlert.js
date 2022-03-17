/*
 * Creates the alerts you may see when clicking the Stuck button.
 */
function StuckAlert(alertHandler) {
    var that = this;
    var _recentPanos = [];

    function stuckClicked() {
        alertHandler.showAlert(i18next.t('popup.still-stuck'), 'stuck' , true);
    }

    function stuckSkippedStreet() {
        alertHandler.showAlert(i18next.t('popup.stuck-skipped-street'), 'stuckStreetSkipped' , true);
    }

    // Check if the user has visited the same pano multiple times recently. If so, show an alert bc they might be stuck.
    function panoVisited(panoId) {
        _recentPanos.push(panoId);

        // Only keep track of the 25 most recent panos visited.
        if (_recentPanos.length > 25) _recentPanos.shift();

        // If this is their 3rd time visiting the pano recently, show an alert.
        if (_recentPanos.filter(x => x === panoId).length > 2) {
            alertHandler.showAlert(i18next.t('popup.stuck-suggestion'), 'stuckSuggestion', true);
        }
    }

    // If the user clicks on the compass or stuck button, make sure that we don't try to teach them about it right now.
    function compassOrStuckClicked() {
        _recentPanos = [];
    }

    that.stuckClicked = stuckClicked;
    that.stuckSkippedStreet = stuckSkippedStreet;
    that.panoVisited = panoVisited;
    that.compassOrStuckClicked = compassOrStuckClicked;
    return that;
}
