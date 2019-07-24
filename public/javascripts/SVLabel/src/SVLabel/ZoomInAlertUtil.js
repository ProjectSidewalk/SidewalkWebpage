/**
 * Utility class for setting zoom-in alert.
 */
class ZoomInAlertUtil {

    /**
     * Show zoom-in alert modal if user's screen is ((RATIO * 100) - 100) percent
     * larger than STANDARD_SCREEN, and the modal has not been shown before in
     * this session (browser tab).
     */
    static showZoomInAlert () {
        if (sessionStorage.getItem("zoomInAlertShown") != null) {
            return;
        }
        var STANDARD_SCREEN = 1280 * 800;
        var RATIO = 1.2;
        var browserWidth = window.innerWidth || document.body.clientWidth;
        var browserHeight = window.innerHeight || document.body.clientHeight;
        var clientScreen = browserWidth * browserHeight;
        if (clientScreen / STANDARD_SCREEN >= RATIO) {
            setTimeout(show, 1000);
        }

        function show () {
            $("#zoom-in-alert-modal").modal('show'); 
            sessionStorage.setItem("zoomInAlertShown", true);
        }
    }
}
