/*
 * Creates the alerts you may see when clicking the Stuck button.
 */
function StuckAlert(alertHandler) {
    var that = this;

    function stuckClicked() {
        alertHandler.showAlert(i18next.t('popup.still-stuck'), 'stuck' , true);
    }

    function stuckSkippedStreet() {
        alertHandler.showAlert(i18next.t('popup.stuck-skipped-street'), 'stuckStreetSkipped' , true);
    }

    that.stuckClicked = stuckClicked;
    that.stuckSkippedStreet = stuckSkippedStreet;
    return that;
}
