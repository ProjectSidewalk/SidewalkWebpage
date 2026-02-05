/*
 * An additional layer on top of the panorama object on validation interface. This layer handles panning.
 */
function PanoOverlay () {
    let self = this;
    let panningDisabled = false;
    let viewControlLayer = isMobile() ? $("#view-control-layer-mobile") : $("#view-control-layer");

    // Mouse status and mouse event callback functions.
    let mouseStatus = {
        currX: 0,
        currY: 0,
        prevX: 0,
        prevY: 0,
        isLeftDown: false
    };

    /**
     * Disables panning on the pano canvas.
     */
    function disablePanning() {
        panningDisabled = true;
    }

    /**
     * Enables panning on the pano canvas.
     */
    function enablePanning() {
        panningDisabled = false;
    }

    /**
     * A callback function that is fired with the mouse down event on the view control layer (when panning).
     * @param e
     */
    function handlerViewControlLayerMouseDown(e) {
        mouseStatus.isLeftDown = true;
        viewControlLayer.css("cursor", "url(/assets/javascripts/SVLabel/img/cursors/closedhand.cur) 4 4, move");

        // This is necessary for supporting touch devices, because there is no mouse hover.
        mouseStatus.prevX = mouseposition(e, this).x;
        mouseStatus.prevY = mouseposition(e, this).y;
    }

    /**
     * This is a callback function that is called with mouse up event on the view control layer (when panning).
     * @param e
     */
    function handlerViewControlLayerMouseUp(e) {
        viewControlLayer.css("cursor", "url(/assets/javascripts/SVLabel/img/cursors/openhand.cur) 4 4, move");
        mouseStatus.isLeftDown = false;
    }

    /**
     * Handles mouse leaving control view.
     * @param e
     */
    function handlerViewControlLayerMouseLeave(e) {
        viewControlLayer.css("cursor", "url(/assets/javascripts/SVLabel/img/cursors/openhand.cur) 4 4, move");
        mouseStatus.isLeftDown = false;
    }

    /**
     * Callback function that is fired when a user moves a mouse on the view control layer where you change the pov.
     */
    function handlerViewControlLayerMouseMove(e) {
        mouseStatus.currX = mouseposition(e, this).x;
        mouseStatus.currY = mouseposition(e, this).y;

        if ((svv.panoManager.getProperty('panoLoaded')) && mouseStatus.isLeftDown && panningDisabled === false) {
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
     * Update POV of the image as a user drags their mouse cursor.
     * @param dx
     * @param dy
     */
    function updatePov(dx, dy) {
        let pov = svv.panoViewer.getPov();
        const viewerScaling = 0.5;
        pov.heading -= dx * viewerScaling;
        pov.pitch += dy * viewerScaling;
        svv.panoViewer.setPov(pov);
    }

    viewControlLayer.bind('mousemove', handlerViewControlLayerMouseMove);
    viewControlLayer.bind('mousedown', handlerViewControlLayerMouseDown);
    viewControlLayer.bind('mouseup', handlerViewControlLayerMouseUp);
    viewControlLayer.bind('mouseleave', handlerViewControlLayerMouseLeave);

    self.disablePanning = disablePanning;
    self.enablePanning = enablePanning;

    return self;
}
