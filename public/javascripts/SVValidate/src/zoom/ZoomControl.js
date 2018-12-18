/**
 * This function handles zooming for the Google StreetView panorama. This is also called by the
 * Keyboard class to deal with zooming via keyboard shortcuts.
 * @returns {ZoomControl}
 * @constructor
 */
function ZoomControl () {
    var self = this;
    var zoomInButton = $("#zoom-in-button");
    var zoomOutButton = $("#zoom-out-button");

    /**
     * Function that is triggered when the zoom in button is clicked.
     */
    function clickZoomIn () {
        svv.tracker.push("Click_ZoomIn");
        zoomIn();
    }

    /**
     * Function that is triggered when the zoom out button is clicked.
     */
    function clickZoomOut () {
        svv.tracker.push("Click_ZoomOut");
        zoomOut();
    }

    /**
     * Increases zoom for the Google StreetView Panorama.
     * Zoom levels: {1.1, 2.1, 3.1}
     */
    function zoomIn () {
        var zoomLevel = svv.panorama.getZoom();
        if (zoomLevel <= 2.1) {
            zoomLevel += 1;
            svv.panorama.setZoom(zoomLevel);
        }
    }

    /**
     * Decreases zoom for the Google StreetView Panorama.
     * Zoom levels: {1.1, 2.1, 3.1}
     */
    function zoomOut () {
        var zoomLevel = svv.panorama.getZoom();
        if (zoomLevel >= 2.1) {
            zoomLevel -= 1;
            svv.panorama.setZoom(zoomLevel);
        }
    }

    zoomInButton.on('click', clickZoomIn);
    zoomOutButton.on('click', clickZoomOut);

    self.zoomIn = zoomIn;
    self.zoomOut = zoomOut;

    return this;
}