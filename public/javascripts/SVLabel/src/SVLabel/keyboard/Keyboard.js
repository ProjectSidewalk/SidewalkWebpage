/**
 * A Keyboard module.
 *

 * @returns {{className: string}}
 * @constructor
 */
function Keyboard (svl, canvas, contextMenu, googleMap, ribbon, zoomControl) {
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
        if (googleMap.getStatus("disableWalking")) return;

        // take the cosine of the difference for each link to the current heading in radians and stores them to an array
        var cosines = svl.panorama.links.map(function(link) {
            var headingAngleOffset = util.math.toRadians(svl.panorama.pov.heading + angle) - util.math.toRadians(link.heading);
            return Math.cos(headingAngleOffset);
        });
        var maxVal = Math.max.apply(null, cosines);
        var maxIndex = cosines.indexOf(maxVal);
        if(cosines[maxIndex] > 0.5){
            var panoramaId = svl.panorama.links[maxIndex].pano;

            googleMap.setPano(panoramaId);
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
                            svl.tracker.push("KeyboardShortcut_Severity_1", {
                                keyCode: e.keyCode
                            });
                        }
                    }

                    break;
                case 50:  // "2"
                    if (contextMenu.isOpen()) {
                        contextMenu.checkRadioButton(2);
                        label = contextMenu.getTargetLabel();
                        if (label) {
                            label.setProperty('severity', 2);
                            svl.tracker.push("KeyboardShortcut_Severity_2", {
                                keyCode: e.keyCode
                            });
                        }
                    }
                    break;
                case 51:  // "3"
                    if (contextMenu.isOpen()) {
                        contextMenu.checkRadioButton(3);
                        label = contextMenu.getTargetLabel();
                        if (label) {
                            label.setProperty('severity', 3);
                            svl.tracker.push("KeyboardShortcut_Severity_3", {
                                keyCode: e.keyCode
                            });
                        }
                    }
                    break;
                case 52:  // "4"
                    if (contextMenu.isOpen()) {
                        contextMenu.checkRadioButton(4);
                        label = contextMenu.getTargetLabel();
                        if (label) {
                            label.setProperty('severity', 4);
                            svl.tracker.push("KeyboardShortcut_Severity_4", {
                                keyCode: e.keyCode
                            });
                        }
                    }
                    break;
                case 53:  // "5"
                    if (contextMenu.isOpen()) {
                        contextMenu.checkRadioButton(5);
                        label = contextMenu.getTargetLabel();
                        if (label) {
                            label.setProperty('severity', 5);
                            svl.tracker.push("KeyboardShortcut_Severity_5", {
                                keyCode: e.keyCode
                            });
                        }
                    }
                    break;
                case util.misc.getLabelDescriptions('Occlusion')['shortcut']['keyNumber']:
                    // "b" for a blocked view
                    ribbon.modeSwitch("Occlusion");
                    svl.tracker.push("KeyboardShortcut_ModeSwitch_Occlusion", {
                        keyCode: e.keyCode
                    });
                    break;
                case util.misc.getLabelDescriptions('CurbRamp')['shortcut']['keyNumber']:
                    // "c" for CurbRamp. Switch the mode to the CurbRamp labeling mode.
                    ribbon.modeSwitch("CurbRamp");
                    svl.tracker.push("KeyboardShortcut_ModeSwitch_CurbRamp", {
                        keyCode: e.keyCode
                    });
                    break;
                case util.misc.getLabelDescriptions('Walk')['shortcut']['keyNumber']:
                    // "e" for Explore. Switch the mode to Walk (camera) mode.
                    ribbon.modeSwitch("Walk");
                    svl.tracker.push("KeyboardShortcut_ModeSwitch_Walk", {
                        keyCode: e.keyCode
                    });
                    break;
                case util.misc.getLabelDescriptions('NoCurbRamp')['shortcut']['keyNumber']:
                    // "m" for MissingCurbRamp. Switch the mode to the MissingCurbRamp labeling mode.
                    ribbon.modeSwitch("NoCurbRamp");
                    svl.tracker.push("KeyboardShortcut_ModeSwitch_NoCurbRamp", {
                        keyCode: e.keyCode
                    });
                    break;
                case util.misc.getLabelDescriptions('NoSidewalk')['shortcut']['keyNumber']:
                    ribbon.modeSwitch("NoSidewalk");
                    svl.tracker.push("KeyboardShortcut_ModeSwitch_NoSidewalk", {
                        keyCode: e.keyCode
                    });
                    break;
                case util.misc.getLabelDescriptions('Obstacle')['shortcut']['keyNumber']:
                    // "o" for Obstacle
                    ribbon.modeSwitch("Obstacle");
                    svl.tracker.push("KeyboardShortcut_ModeSwitch_Obstacle", {
                        keyCode: e.keyCode
                    });
                    break;
                case util.misc.getLabelDescriptions('SurfaceProblem')['shortcut']['keyNumber']:
                    ribbon.modeSwitch("SurfaceProblem");
                    svl.tracker.push("KeyboardShortcut_ModeSwitch_SurfaceProblem", {
                        keyCode: e.keyCode
                    });
                    break;
                case 90:
                    // "z" for zoom. By default, it will zoom in. If "shift" is down, it will zoom out.
                    if (status.shiftDown) {
                        // Zoom out
                        zoomControl.zoomOut();
                        svl.tracker.push("KeyboardShortcut_ZoomOut", {
                            keyCode: e.keyCode
                        });
                    } else {
                        // Zoom in
                        zoomControl.zoomIn();
                        svl.tracker.push("KeyboardShortcut_ZoomIn", {
                            keyCode: e.keyCode
                        });
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
                    svl.tracker.push("KeyboardShortcut_CloseContextMenu");
                }
                break;
            case 27:
                // "Escape"
                if (canvas.getStatus('drawing')) {
                    canvas.cancelDrawing();
                    svl.tracker.push("KeyboardShortcut_CancelDrawing");
                } else {
                    ribbon.backToWalk();
                }
                svl.modalExample.hide();
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
