/**
 * Handles zooming for the pano. Also called by the Keyboard class to deal with zooming via keyboard shortcuts.
 * @returns {ZoomControl}
 * @constructor
 */
function ZoomControl () {
    const self = this;
    let zoomInButton = $("#zoom-in-button");
    let zoomOutButton = $("#zoom-out-button");

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
     * Changes the opacity and enables/disables the zoom buttons depending on the 'zoom level'. It
     * disables and 'greys-out' the zoom in button in the most zoomed in state and the zoom out
     * button in the most zoomed out state.
     * Zoom levels: { 1 (Zoom-out Disabled), 2 (Both buttons enabled), 3 (Zoom-In Disabled) }
     */
    function updateZoomAvailability() {
        const zoomLevel = svv.panoViewer.getPov().zoom;
        // The `disabled` class greys the button out (and blocks clicks); see pano-overlay-buttons.css.
        zoomInButton.toggleClass('disabled', zoomLevel >= 3);
        zoomOutButton.toggleClass('disabled', zoomLevel <= 1);
    }

    zoomInButton.on('click', clickZoomIn);
    zoomOutButton.on('click', clickZoomOut);

    self.zoomIn = zoomIn;
    self.zoomOut = zoomOut;
    self.updateZoomAvailability = updateZoomAvailability;

    return this;
}
