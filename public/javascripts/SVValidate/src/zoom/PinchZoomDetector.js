/**
 * Detect pinch zoom on mobile devices and push appropriate logs.
 * This is only used for mobile devices as they use GSV pinch zoom mechanism.
 * return {PinchZoomDetector}
 * @constructor
 */
function PinchZoomDetector () {
    let self = this;
    let pinchZoomCode = 0;
    let prevZoomLevel = -1;
    let pinchZooming = false;

    /**
     * Adds listeners to the screen to log user interactions.
     * @private
     */
    function _init () {
        let panorama = svv.panorama.getPanorama();
        let screen = document.getElementById("svv-panorama-0");
        panorama.addListener('zoom_changed', processZoomChange);
        screen.addEventListener('touchstart', processTouchstart);
        screen.addEventListener('touchend', processTouchend);
        return this;
    }

    /**
     * Uset starts pinch zooming.
     * @private
     */
    function processTouchstart (e) {
        if (e.touches.length >= 2) {
            prevZoomLevel = svv.panorama.getZoom();
            pinchZooming = true;
            // 1: zooming in, 2: zooming out, 0: unknown.
            pinchZoomCode = 0;
        }
    }

    /**
     * Determine whether a user is zooming in or out and logs
     * their actions accordingly.
     * @private
     */
    function processZoomChange () {
        let currentZoom = svv.panorama.getZoom();
        // Logs interaction only if a user is pinch zooming and
        // current zoom is less than max zoom.
        if (pinchZooming && currentZoom <= 4) {
            let zoomChange = currentZoom - prevZoomLevel;
            if (zoomChange > 0) {
                if (pinchZoomCode != 1) {
                    if (pinchZoomCode == 2) {
                        svv.tracker.push('Pinch_ZoomOut_End');
                    }
                    svv.tracker.push('Pinch_ZoomIn_Start');
                    pinchZoomCode = 1;
                }
            }
            if (zoomChange < 0) {
                if (pinchZoomCode != 2) {
                    if (pinchZoomCode == 1) {
                        svv.tracker.push('Pinch_ZoomIn_End');
                    }
                    svv.tracker.push('Pinch_ZoomOut_Start');
                    pinchZoomCode = 2;
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
            if (pinchZoomCode == 1) {
                svv.tracker.push('Pinch_ZoomIn_End');
            }
            if (pinchZoomCode == 2) {
                svv.tracker.push('Pinch_ZoomOut_End');
            }
            pinchZooming = false;
        } 
    }

    _init();

    return self;
}

