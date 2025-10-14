/*
 * An additional layer on top of the Google Street View object on validation interface. This layer handles panning.
 */
function GSVOverlay () {
    let self = this;
    let panningDisabled = false;
    let viewControlLayer = $("#view-control-layer");

    // Mouse status and mouse event callback functions.
    let mouseStatus = {
        currX: 0,
        currY: 0,
        prevX: 0,
        prevY: 0,
        leftDownX: 0,
        leftDownY: 0,
        leftUpX: 0,
        leftUpY: 0,
        isLeftDown: false
    };

    /**
     * Disables panning on the GSV window.
     */
    function disablePanning() {
        panningDisabled = true;
    }

    /**
     * Enables panning on the GSV window.
     */
    function enablePanning() {
        panningDisabled = false;
    }

    /**
     * This is a callback function that is fired with the mouse down event on the view
     * control layer (where you control street view angle.)
     * @param e
     */
    function handlerViewControlLayerMouseDown (e) {
        mouseStatus.isLeftDown = true;
        mouseStatus.leftDownX = mouseposition(e, this).x;
        mouseStatus.leftDownY = mouseposition(e, this).y;
        viewControlLayer.css("cursor", "url(/assets/javascripts/SVLabel/img/cursors/closedhand.cur) 4 4, move");

        // This is necessary for supporting touch devices, because there is no mouse hover.
        mouseStatus.prevX = mouseposition(e, this).x;
        mouseStatus.prevY = mouseposition(e, this).y;
    }

    /**
     * This is a callback function that is called with mouse up event on
     * the view control layer (where you change the Google Street view angle.
     * @param e
     */
    function handlerViewControlLayerMouseUp (e) {
        viewControlLayer.css("cursor", "url(/assets/javascripts/SVLabel/img/cursors/openhand.cur) 4 4, move");
        mouseStatus.isLeftDown = false;
        mouseStatus.leftUpX = mouseposition(e, this).x;
        mouseStatus.leftUpY = mouseposition(e, this).y;
    }

    /**
     * Handles mouse leaving control view.
     * @param e
     */
    function handlerViewControlLayerMouseLeave (e) {
        viewControlLayer.css("cursor", "url(/assets/javascripts/SVLabel/img/cursors/openhand.cur) 4 4, move");
        mouseStatus.isLeftDown = false;
    }

    /**
     * This is a callback function that is fired when a user moves a mouse on the
     * view control layer where you change the pov.
     */
    function handlerViewControlLayerMouseMove (e) {
        mouseStatus.currX = mouseposition(e, this).x;
        mouseStatus.currY = mouseposition(e, this).y;

        let timestamp = new Date();  // Waits till the pano is fully loaded.
        if ((timestamp - svv.panoContainer.getProperty("prevSetPanoTimestamp") > 500)
            && mouseStatus.isLeftDown && panningDisabled === false) {
            // If a mouse is being dragged on the control layer, move the pano.
            let dx = mouseStatus.currX - mouseStatus.prevX;
            let dy = mouseStatus.currY - mouseStatus.prevY;
            let pov = svv.panoViewer.getPov();
            let zoomLevel = pov.zoom;
            dx = dx / (2 * zoomLevel);
            dy = dy / (2 * zoomLevel);
            dx *= 0.375;
            dy *= 0.375;
            updatePov(dx, dy);
        }
        mouseStatus.prevX = mouseposition(e, this).x;
        mouseStatus.prevY = mouseposition(e, this).y;
    }

    /**
     * Update POV of Street View as a user drags their mouse cursor.
     * @param dx
     * @param dy
     */
    function updatePov (dx, dy) {
        let panoViewer = svv.panoViewer;
        if (panoViewer) {
            let pov = panoViewer.getPov();
            pov.heading -= dx;
            pov.pitch += dy;
            panoViewer.setPov(pov);
        } else {
            throw self.className + ' updatePov(): panorama not defined!';
        }
    }

    viewControlLayer.bind('mousemove', handlerViewControlLayerMouseMove);
    viewControlLayer.bind('mousedown', handlerViewControlLayerMouseDown);
    viewControlLayer.bind('mouseup', handlerViewControlLayerMouseUp);
    viewControlLayer.bind('mouseleave', handlerViewControlLayerMouseLeave);

    self.disablePanning = disablePanning;
    self.enablePanning = enablePanning;

    return self;
}

