/**
 * A Keyboard module.
 *

 * @returns {{className: string}}
 * @constructor
 */
function Keyboard (svl, canvas, contextMenu, ribbon, zoomControl) {
    var self = this;
    var status = {
        focusOnTextField: false,
        isOnboarding: false,
        shiftDown: false
    };

    // Move in the direction of a link closest to a given angle.
    // Todo: Get rid of dependency to svl.panorama. Inject a streetViewMap into this module and use its interface.
    // Todo. Make the method name more descriptive.
    this._movePano = function (angle) {
        // take the cosine of the difference for each link to the current heading in radians and stores them to an array
        var cosines = svl.panorama.links.map(function(link) {
            var headingAngleOffset = util.math.toRadians(svl.panorama.pov.heading + angle) - util.math.toRadians(link.heading);
            return Math.cos(headingAngleOffset);
        });
        var maxVal = Math.max.apply(null, cosines);
        var maxIndex = cosines.indexOf(maxVal);
        if(cosines[maxIndex] > 0.5){
            svl.panorama.setPano(svl.panorama.links[maxIndex].pano);
        }
    };

    this._moveForward = function (){
        this._movePano(0);
    };

    this._moveBackward = function (){
        this._movePano(180);
    };

    /**
     * Change the heading of the current panorama point of view by a particular degree value
     * Todo. Change the method name so it is more descriptive.
     * @param degree
     */
    this._rotatePov = function (degree){
        var heading =  svl.panorama.pov.heading;
        var pitch = svl.panorama.pov.pitch;
        var zoom = svl.panorama.pov.zoom;
        heading = (heading + degree + 360) % 360;
        svl.panorama.setPov({heading: heading, pitch: pitch, zoom: zoom});
    };

    /**
     * This is a callback for a key down event
     * @param {object} e An event object
     * @private
     */
    this._documentKeyDown = function (e) {
        // The callback method that is triggered with a keyUp event.
        if (contextMenu.isOpen()) {
            return;
        } else if (!status.focusOnTextField) {
            // lock scrolling in response to key pressing
            switch (e.keyCode) {
                case 16:  // "Shift"
                    status.shiftDown = true;
                    break;
                case 37:  // "Left"
                    self._rotatePov(-2);
                    break;
                case 39:  // "Right"
                    self._rotatePov(2);
                    break;
                case 38:
                    self._moveForward();
                    break;
                case 40:  // "down"
                    self._moveBackward();
                    break;
            }

            if([37, 38, 39, 40].indexOf(e.keyCode) > -1) {
                e.preventDefault();
            }
        }
    };

    /**
     * This is a callback for a key up event.
     * @param {object} e An event object
     * @private
     */
    this._documentKeyUp = function (e) {
        if (svl.isOnboarding()) {
            // Don't allow users to use keyboard shortcut during the onboarding.
            return;
        }

        /*
         This is a callback method that is triggered when a keyUp
         event occurs and focus is not on ContextMenu's textbox.
         */
        if (!status.focusOnTextField) {
            var label;
            switch (e.keyCode) {
                case 16:
                    // "Shift"
                    status.shiftDown = false;
                    break;
                case 49:  // "1"
                    if (contextMenu.isOpen()) {
                        contextMenu.checkRadioButton(1);
                        label = contextMenu.getTargetLabel();
                        if (label) {
                            label.setProperty('severity', 1);
                        }
                    }

                    break;
                case 50:  // "2"
                    if (contextMenu.isOpen()) {
                        contextMenu.checkRadioButton(2);
                        label = contextMenu.getTargetLabel();
                        if (label) {
                            label.setProperty('severity', 2);
                        }
                    }
                    break;
                case 51:  // "3"
                    if (contextMenu.isOpen()) {
                        contextMenu.checkRadioButton(3);
                        label = contextMenu.getTargetLabel();
                        if (label) {
                            label.setProperty('severity', 3);
                        }
                    }
                    break;
                case 52:  // "4"
                    if (contextMenu.isOpen()) {
                        contextMenu.checkRadioButton(4);
                        label = contextMenu.getTargetLabel();
                        if (label) {
                            label.setProperty('severity', 4);
                        }
                    }
                    break;
                case 53:  // "5"
                    if (contextMenu.isOpen()) {
                        contextMenu.checkRadioButton(5);
                        label = contextMenu.getTargetLabel();
                        if (label) {
                            label.setProperty('severity', 5);
                        }
                    }
                    break;
                case 66:
                    // "b" for a blocked view
                    ribbon.modeSwitch("Occlusion");
                    break;
                case 67:
                    // "c" for CurbRamp. Switch the mode to the CurbRamp labeling mode.
                    ribbon.modeSwitch("CurbRamp");
                    break;
                case 69:
                    // "e" for Explore. Switch the mode to Walk (camera) mode.
                    ribbon.modeSwitch("Walk");
                    break;
                case 77:
                    // "m" for MissingCurbRamp. Switch the mode to the MissingCurbRamp labeling mode.
                    ribbon.modeSwitch("NoCurbRamp");
                    break;
                case 78:
                    ribbon.modeSwitch("NoSidewalk");
                    break;
                case 79:
                    // "o" for Obstacle
                    ribbon.modeSwitch("Obstacle");
                    break;
                case 83:
                    ribbon.modeSwitch("SurfaceProblem");
                    break;
                case 90:
                    // "z" for zoom. By default, it will zoom in. If "shift" is down, it will zoom out.
                    if (status.shiftDown) {
                        // Zoom out
                        zoomControl.zoomOut();
                    } else {
                        // Zoom in
                        zoomControl.zoomIn();
                    }
            }
        }

        /*
         This is a callback method that is triggered when a keyUp
         event occurs. It is not relevant to ContextMenu's textbox focus.
         */
        switch (e.keyCode) {
            case 13:
                // "Enter"
                if (contextMenu.isOpen()) {
                    contextMenu.hide();
                }
                break;
            case 27:
                // "Escape"
                if (canvas.getStatus('drawing')) {
                    canvas.cancelDrawing();
                } else {
                    ribbon.backToWalk();
                }
                break;
        }

        contextMenu.updateRadioButtonImages();
    };


    /**
     * Get status
     * @param {string} key Field name
     * @returns {*}
     */
    this.getStatus = function  (key) {
        if (!(key in status)) {
            console.warn("You have passed an invalid key for status.")
        }
        return status[key];
    };

    /**
     * This method returns whether a shift key is currently pressed or not.
     * @returns {boolean}
     */
    this.isShiftDown = function () {
        return status.shiftDown;
    };

    /**
     * Set status
     * @param key Field name
     * @param value Field value
     * @returns {setStatus}
     */
    this.setStatus = function (key, value) {
        if (key in status) {
            status[key] = value;
        }
    };


    $(document).bind('keyup', this._documentKeyUp);
    $(document).bind('keydown', this._documentKeyDown);
}
