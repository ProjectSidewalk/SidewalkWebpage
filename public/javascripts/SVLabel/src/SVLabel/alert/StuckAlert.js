/*
 * Creates the alerts you may see when clicking the Skip button.
 */
function StuckAlert(alertHandler) {
    var that = this;

    function showStuckAlert() {
        alertHandler.showAlert('If you\'re still stuck, click the Stuck button again.', 'skipMessage' , true);
    }

    that.showStuckAlert = showStuckAlert;
    return that;
}
