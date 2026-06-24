/**
 * Handles zooming for the pano. Also called by the Keyboard class to deal with zooming via keyboard shortcuts.
 * @returns {ZoomControl}
 * @constructor
 */
function ZoomControl () {
    const self = this;
    let zoomInButton = $("#zoom-in-button");
    let zoomOutButton = $("#zoom-out-button");

    // Zoom limits for the pano, matching the {1, 2, 3} levels used by the zoom buttons.
    const MIN_ZOOM = 1;
    const MAX_ZOOM = 3;
    // Scroll wheel / trackpad zoom tuning.
    const ZOOM_WHEEL_SENSITIVITY = 0.0015;

    let wheelTrackTimeout;

    /**
     * Logs interaction when the zoom in button is clicked.
     */
    function clickZoomIn() {
        svv.tracker.push("Click_ZoomIn");
        zoomIn();
    }

    /**
     * Logs interaction when the zoom out button is clicked.
     */
    function clickZoomOut() {
        svv.tracker.push("Click_ZoomOut");
        zoomOut();
    }

    /**
     * Increases zoom for the panorama and checks if 'Zoom In' button needs to be disabled.
     * Zoom levels: {1, 2, 3}
     */
    function zoomIn() {
        const zoomLevel = Math.round(svv.panoViewer.getPov().zoom);
        if (zoomLevel <= 2) {
            svv.panoManager.setZoom(zoomLevel + 1);
        }
        updateZoomAvailability();
    }

    /**
     * Decreases zoom for the panorama and checks if 'Zoom Out' button needs to be disabled.
     * Zoom levels: {1, 2, 3}
     */
    function zoomOut() {
        const zoomLevel = Math.round(svv.panoViewer.getPov().zoom);
        if (zoomLevel >= 2) {
            svv.panoManager.setZoom(zoomLevel - 1);
        }
        updateZoomAvailability();
    }

    /**
     * Callback for the scroll wheel / trackpad over the pano.
     * @param e jQuery wheel event
     */
    function wheelZoom(e) {
        // Prevent the page from scrolling while zooming the pano.
        e.preventDefault();

        // Scrolling up (negative deltaY) zooms in; scrolling down zooms out.
        const zoomDelta = -e.originalEvent.deltaY * ZOOM_WHEEL_SENSITIVITY;

        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, svv.panoViewer.getPov().zoom + zoomDelta));
        svv.panoManager.setZoom(newZoom);
        updateZoomAvailability();

        // Log scroll zooming, but debounce so a single gesture doesn't flood the tracker.
        if (svv.tracker) {
            window.clearTimeout(wheelTrackTimeout);
            wheelTrackTimeout = window.setTimeout(() => {
                svv.tracker.push(zoomDelta > 0 ? 'Scroll_ZoomIn' : 'Scroll_ZoomOut');
            }, 250);
        }
    }

    /**
     * Changes the opacity and enables/disables the zoom buttons depending on the 'zoom level'. It
     * disables and 'greys-out' the zoom in button in the most zoomed in state and the zoom out
     * button in the most zoomed out state.
     * Zoom levels: { 1 (Zoom-out Disabled), 2 (Both buttons enabled), 3 (Zoom-In Disabled) }
     */
    function updateZoomAvailability() {
        const zoomLevel = svv.panoViewer.getPov().zoom;
        // The `disabled` class greys the button out; see pano-overlay-buttons.css.
        zoomInButton.toggleClass('disabled', zoomLevel >= 3);
        zoomOutButton.toggleClass('disabled', zoomLevel <= 1);
    }

    zoomInButton.on('click', clickZoomIn);
    zoomOutButton.on('click', clickZoomOut);
    svv.ui.viewer.controlLayer.on('wheel', wheelZoom);

    self.zoomIn = zoomIn;
    self.zoomOut = zoomOut;
    self.updateZoomAvailability = updateZoomAvailability;

    return this;
}
