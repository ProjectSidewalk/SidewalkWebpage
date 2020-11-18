/**
 * Detect pinch zoom on mobile devices and push appropriate logs.
 * This is only used for mobile devices as they use GSV pinch zoom mechanism.
 * return {PinchZoomDetector}
 * @constructor
 */
function PinchZoomDetector () {
    let self = this;

    let ZOOM_UNKNOWN_CODE = 0;
    let ZOOM_IN_CODE = 1;
    let ZOOM_OUT_CODE = 2;

    let pinchZoomCode = 0;
    let prevZoomLevel = -1;
    let pinchZooming = false;

    /**
     * Adds listeners to the screen to log user interactions.
     * @private
     */
    function _init () {
        let panorama = svv.panorama.getPanorama();
        let screen = document.getElementById("svv-panorama");
        panorama.addListener('zoom_changed', processZoomChange);
        screen.addEventListener('touchstart', processTouchstart);
        screen.addEventListener('touchend', processTouchend);
        return this;
    }

    /**
     * User starts pinch zooming. Don't know yet whether they are zooming in or out.
     * @private
     */
    function processTouchstart (e) {
        if (e.touches.length >= 2) {
            prevZoomLevel = svv.panorama.getZoom();
            pinchZooming = true;
            pinchZoomCode = ZOOM_UNKNOWN_CODE;
        }
    }

    /**
     * Determine whether a user is zooming in or out and logs their actions accordingly.
     * @private
     */
    function processZoomChange () {
        let currentZoom = svv.panorama.getZoom();
        // Logs interaction only if a user is pinch zooming and current zoom is less than max zoom.
        if (pinchZooming && currentZoom <= 4) {
            let zoomChange = currentZoom - prevZoomLevel;
            if (zoomChange > 0) {
                if (pinchZoomCode !== ZOOM_IN_CODE) {
                    if (pinchZoomCode === ZOOM_OUT_CODE) {
                        svv.tracker.push('Pinch_ZoomOut_End');
                    }
                    svv.tracker.push('Pinch_ZoomIn_Start');
                    pinchZoomCode = ZOOM_IN_CODE;
                }
            }
            if (zoomChange < 0) {
                if (pinchZoomCode !== ZOOM_OUT_CODE) {
                    if (pinchZoomCode === ZOOM_IN_CODE) {
                        svv.tracker.push('Pinch_ZoomIn_End');
                    }
                    svv.tracker.push('Pinch_ZoomOut_Start');
                    pinchZoomCode = ZOOM_OUT_CODE;
                }
           }
           prevZoomLevel = currentZoom;
        }
    }

    /**
     * Logs zoom end interactions on mobile devices as users lift their hand off the screen.
     * @private
     */
    function processTouchend (e) {
        if (svv.tracker && svv.panorama && pinchZooming && e.touches.length <= 1) {
            if (pinchZoomCode === ZOOM_IN_CODE) {
                svv.tracker.push('Pinch_ZoomIn_End');
            }
            if (pinchZoomCode === ZOOM_OUT_CODE) {
                svv.tracker.push('Pinch_ZoomOut_End');
            }
            pinchZooming = false;
        }
    }

    _init();

    return self;
}

