/**
 * An additional layer on top of the Google StreetView object
 * on validation interface. This layer handles panning.
 *
 */
function GSVOverlay () {
    let self = this;
    var panningDisabled = false;
    var viewControlLayer = $("#viewControlLayer");

    // Mouse status and mouse event callback functions
    var mouseStatus = {
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
     * This is a callback function that is fired with the mouse down event
     * on the view control layer (where you control street view angle.)
     * @param e
     */
    function handlerViewControlLayerMouseDown (e) {
        mouseStatus.isLeftDown = true;
        mouseStatus.leftDownX = mouseposition(e, this).x;
        mouseStatus.leftDownY = mouseposition(e, this).y;
        viewControlLayer.css("cursor", "url(/assets/javascripts/SVLabel/img/cursors/closedhand.cur) 4 4, move");

        //This is necessary for supporting touch devices, because there is no mouse hover
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

        var timestamp = new Date().getTime();  // waits till the pano is fully loaded
        if ((timestamp - svv.panorama.getProperty("prevSetPanoTimestamp") > 800) && mouseStatus.isLeftDown && panningDisabled === false) {
            // If a mouse is being dragged on the control layer, move the sv image.
            var dx = mouseStatus.currX - mouseStatus.prevX;
            var dy = mouseStatus.currY - mouseStatus.prevY;
            var pov = svv.panorama.getPov();
            var zoomLevel = pov.zoom;
            dx = dx / (2 * zoomLevel);
            dy = dy / (2 * zoomLevel);
            dx *= 1.5;
            dy *= 1.5;
            updatePov(dx, dy);
        }
        mouseStatus.prevX = mouseposition(e, this).x;
        mouseStatus.prevY = mouseposition(e, this).y;
    }

    /**
     * Update POV of Street View as a user drag a mouse cursor.
     * @param dx
     * @param dy
     */
    function updatePov (dx, dy) {
        var pano = svv.panorama.getPanorama();
        if (pano) {
            var pov = pano.getPov(),
                alpha = 0.25;
            pov.heading -= alpha * dx;
            pov.pitch += alpha * dy;
            pano.setPov(pov);
        } else {
            throw self.className + ' updatePov(): panorama not defined!';
        }
    }

    // A cross-browser function to capture a mouse position
    function mouseposition (e, dom) {
        var mx, my;
        //if(e.offsetX) {
            // Chrome
        //    mx = e.offsetX;
        //    my = e.offsetY;
        //} else {
        // Firefox, Safari
            mx = e.pageX - $(dom).offset().left;
            my = e.pageY - $(dom).offset().top;
        //}
        return {'x': parseInt(mx, 10) , 'y': parseInt(my, 10) };
    }

    viewControlLayer.bind('mousemove', handlerViewControlLayerMouseMove);
    viewControlLayer.bind('mousedown', handlerViewControlLayerMouseDown);
    viewControlLayer.bind('mouseup', handlerViewControlLayerMouseUp);
    viewControlLayer.bind('mouseleave', handlerViewControlLayerMouseLeave);

    self.disablePanning = disablePanning;
    self.enablePanning = enablePanning;

    return self;
}

