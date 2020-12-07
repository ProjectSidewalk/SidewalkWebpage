/*
 * Creates the alerts you may see when clicking the Skip button.
 */
function StuckAlert(alertHandler) {
    var that = this;

    function stuckClicked() {
        alertHandler.showAlert('If you\'re still stuck, click the Stuck button again.', 'stuck' , true);
    }

    function stuckSkippedStreet() {
        alertHandler.showAlert('We couldn\'t find a spot for you on that street, so we moved you to a new street.', 'stuckStreetSkipped' , true);
    }

    that.stuckClicked = stuckClicked;
    that.stuckSkippedStreet = stuckSkippedStreet;
    return that;
}
