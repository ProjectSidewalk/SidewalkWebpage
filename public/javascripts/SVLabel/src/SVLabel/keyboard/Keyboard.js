/**
 * A Keyboard module.
 *

 * @returns {{className: string}}
 * @constructor
 */
function Keyboard (svl, canvas, contextMenu, googleMap, ribbon, zoomControl) {
    var self = this;

    /**
     * fix for the shift-getting-stuck bug.
     * this is a documented issue, see here:
     * https://stackoverflow.com/questions/11225694/why-are-onkeyup-events-not-firing-in-javascript-game
     * essentially what's going on is that JS sometimes fires a final keydown after a keyup.
     * (usually happens when multiple events are fired)
     * so the log would look like keydown:shift, keydown: shift, keyup: shift, keydown: shift.
     * To fix this, we note the last time that shift was let go, then
     * ignore any keydown events that were made BEFORE shift was let go, but are executing AFTER.
     *
     * also, we added a buffer to the z key to fix inconsistent behavior when shift and z were pressed at the same time.
     * sometimes, the shift up was detected before the z up. Adding the 100ms buffer fixed this issue.
     */
    var lastShiftKeyUpTimestamp = new Date(0).getTime();
    var status = {
        focusOnTextField: false,
        isOnboarding: false,
        shiftDown: false,
        disableKeyboard: false,
        moving: false
    };

    this.disableKeyboard = function (){
        status.disableKeyboard = true;
    };
    this.enableKeyboard = function (){
        status.disableKeyboard = false;
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

    /*
       Move user in specific angle relative to current view for a specific moveTime.
     */
    function timedMove(angle, moveTime){
        if (status.moving || svl.isOnboarding() || svl.popUpMessage.getStatus("isVisible")){
            svl.panorama.set("linksControl", false);
            return;
        }
        svl.contextMenu.hide();
        svl.ui.canvas.deleteIconHolder.css("visibility", "hidden");
        self._movePano(angle);
        //prevent user input of walking commands
        svl.map.timeoutWalking();
        //restore user ability to walk after param moveTime
        setTimeout(svl.map.resetWalking, moveTime);
        //additional check to hide arrows after the fact
        //pop-up may become visible during timeout period
        if (svl.popUpMessage.getStatus('isVisible')){
            svl.panorama.set('linksControl', false);//disable arrows
        }
    }

    this._moveForward = function (){
        timedMove(0, svl.map.getMoveDelay());
    };

    this._moveBackward = function (){
        timedMove(180, svl.map.getMoveDelay());
    };



    /**
     * Change the heading of the current panorama point of view by a particular degree value
     * Todo. Change the method name so it is more descriptive.
     * @param degree
     */
    this._rotatePov = function (degree){
        if (!svl.map.getStatus("disablePanning")){
            svl.contextMenu.hide();
            //panning hide label tag and delete icon
            var labels = svl.labelContainer.getCanvasLabels(),
                labelLen = labels.length;
            for (var i=0; i<labelLen; i++){
                labels[i].setTagVisibility('hidden');
                labels[i].resetTagCoordinate();
            }
            svl.ui.canvas.deleteIconHolder.css('visibility', 'hidden');
            var heading =  svl.panorama.pov.heading;
            var pitch = svl.panorama.pov.pitch;
            var zoom = svl.panorama.pov.zoom;
            heading = (heading + degree + 360) % 360;
            var pov = svl.map.restrictViewPort({
                heading: heading,
                pitch: pitch,
                zoom: zoom
            });
            svl.panorama.setPov({heading: pov.heading, pitch: pov.pitch, zoom: pov.zoom});
        }
    };

    /**
     * This is a callback for a key down event
     * @param {object} e An event object
     * @private
     */
    this._documentKeyDown = function (e) {
        if (!status.focusOnTextField && !status.disableKeyboard) {
            //only set shift if the event was made after the keyup.
            if (e.timeStamp > lastShiftKeyUpTimestamp) {
                status.shiftDown = e.shiftKey;
            }
        }

        if (!status.disableKeyboard && !status.focusOnTextField) {
            if (contextMenu.isOpen()) {
                var label;
                switch (e.keyCode) {
                    case 49:  // "1"
                        contextMenu.checkRadioButton(1);
                        label = contextMenu.getTargetLabel();
                        if (label) {
                            label.setProperty('severity', 1);
                            svl.tracker.push("KeyboardShortcut_Severity_1", {
                                keyCode: e.keyCode
                            });
                            svl.canvas.clear().render2();
                        }
                        break;
                    case 50:  // "2"
                        contextMenu.checkRadioButton(2);
                        label = contextMenu.getTargetLabel();
                        if (label) {
                            label.setProperty('severity', 2);
                            svl.tracker.push("KeyboardShortcut_Severity_2", {
                                keyCode: e.keyCode
                            });
                            svl.canvas.clear().render2();
                        }
                        break;
                    case 51:  // "3"
                        contextMenu.checkRadioButton(3);
                        label = contextMenu.getTargetLabel();
                        if (label) {
                            label.setProperty('severity', 3);
                            svl.tracker.push("KeyboardShortcut_Severity_3", {
                                keyCode: e.keyCode
                            });
                            svl.canvas.clear().render2();
                        }
                        break;
                    case 52:  // "4"
                        contextMenu.checkRadioButton(4);
                        label = contextMenu.getTargetLabel();
                        if (label) {
                            label.setProperty('severity', 4);
                            svl.tracker.push("KeyboardShortcut_Severity_4", {
                                keyCode: e.keyCode
                            });
                            svl.canvas.clear().render2();
                        }
                        break;
                    case 53:  // "5"
                        contextMenu.checkRadioButton(5);
                        label = contextMenu.getTargetLabel();
                        if (label) {
                            label.setProperty('severity', 5);
                            svl.tracker.push("KeyboardShortcut_Severity_5", {
                                keyCode: e.keyCode
                            });
                            svl.canvas.clear().render2();
                        }
                        break;
                }
            } else {
                switch (e.keyCode) {
                    case 16:  // "Shift"
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
                if ([37, 38, 39, 40].indexOf(e.keyCode) > -1) {
                    e.preventDefault();
                }
            }
        }
    };

    /**
     * This is a callback for a key up event.
     * @param {object} e An event object
     * @private
     */
    this._documentKeyUp = function (e) {
        if (!status.disableKeyboard) {
            /*
             This is a callback method that is triggered when a keyUp
             event occurs and focus is not on ContextMenu's textbox.
             */
            status.shiftDown = e.shiftKey;
            if (!status.focusOnTextField) {
                switch (e.keyCode) {
                    // Label selection hotkeys
                    case util.misc.getLabelDescriptions('Occlusion')['shortcut']['keyNumber']:
                        // "b" for a blocked view.
                        // Context menu may be open for a different label.
                        _closeContextMenu(e.keyCode);
                        ribbon.modeSwitch("Occlusion");
                        svl.tracker.push("KeyboardShortcut_ModeSwitch_Occlusion", {
                            keyCode: e.keyCode
                        });
                        break;
                    case util.misc.getLabelDescriptions('CurbRamp')['shortcut']['keyNumber']:
                        // "c" for CurbRamp. Switch the mode to the CurbRamp labeling mode.
                        _closeContextMenu(e.keyCode);
                        if (!contextMenu.isOpen()) {
                            ribbon.modeSwitch("CurbRamp");
                            svl.tracker.push("KeyboardShortcut_ModeSwitch_CurbRamp", {
                                keyCode: e.keyCode
                            });
                        }
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
                        _closeContextMenu(e.keyCode);
                        if (!contextMenu.isOpen()) {
                            ribbon.modeSwitch("NoCurbRamp");
                            svl.tracker.push("KeyboardShortcut_ModeSwitch_NoCurbRamp", {
                                keyCode: e.keyCode
                            });
                        }
                        break;
                    case util.misc.getLabelDescriptions('NoSidewalk')['shortcut']['keyNumber']:
                        // "n" for NoSidewalk
                        _closeContextMenu(e.keyCode);
                        ribbon.modeSwitch("NoSidewalk");
                        svl.tracker.push("KeyboardShortcut_ModeSwitch_NoSidewalk", {
                            keyCode: e.keyCode
                        });
                        break;
                    case util.misc.getLabelDescriptions('Obstacle')['shortcut']['keyNumber']:
                        // "o" for Obstacle
                        _closeContextMenu(e.keyCode);
                        if (!contextMenu.isOpen()) {
                            ribbon.modeSwitch("Obstacle");
                            svl.tracker.push("KeyboardShortcut_ModeSwitch_Obstacle", {
                                keyCode: e.keyCode
                            });
                        }
                        break;
                    case util.misc.getLabelDescriptions('SurfaceProblem')['shortcut']['keyNumber']:
                        // "s" for surface problem
                        _closeContextMenu(e.keyCode);
                        if (!contextMenu.isOpen()) {
                            ribbon.modeSwitch("SurfaceProblem");
                            svl.tracker.push("KeyboardShortcut_ModeSwitch_SurfaceProblem", {
                                keyCode: e.keyCode
                            });
                        }
                        break;
                        
                    // Zoom Hotkeys
                    case 16: //shift
                        // store the timestamp here so that we can check if the z-up event is in the buffer range
                        lastShiftKeyUpTimestamp = e.timeStamp;
                        break;
                    case 90:
                        if (contextMenu.isOpen()) {
                            svl.tracker.push("KeyboardShortcut_CloseContextMenu");
                            contextMenu.hide();
                        }
                        // "z" for zoom. By default, it will zoom in. If "shift" is down, it will zoom out.
                        // if shift was down w/in 100 ms of the z up, then it will also zoom out. 
                        // This is to catch the scenarios where shift up is detected before the z up.
                        if (status.shiftDown || (e.timeStamp - lastShiftKeyUpTimestamp) < 100) {
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

                // Hotkeys for tag selection
                if (contextMenu.getTargetLabel() != null && contextMenu.isOpen() && !contextMenu.isTagDisabled()) {
                    var labelType = contextMenu.getTargetLabel().getProperty('labelType');
                    if (labelType === 'CurbRamp') { // Curb Ramp
                        switch (e.keyCode) {
                            case util.misc.getLabelDescriptions('CurbRamp')['tagInfo']['narrow']['keyNumber']: // 'a' for 'narrow'
                                $('.narrow-tag').first().trigger("click", {lowLevelLogging: false});
                                break;
                            case util.misc.getLabelDescriptions('CurbRamp')['tagInfo']['points into traffic']['keyNumber']: // 'p' for 'points into traffic'
                                $('.pointIntoTraffic-tag').first().trigger("click", {lowLevelLogging: false});
                                break;
                            case util.misc.getLabelDescriptions('CurbRamp')['tagInfo']['missing friction strip']['keyNumber']: // 'f' for 'missing friction strip'
                                $('.missingFrictionStrip-tag').first().trigger("click", {lowLevelLogging: false});
                                break;
                            case util.misc.getLabelDescriptions('CurbRamp')['tagInfo']['steep']['keyNumber']: // 't' for 'steep'
                                $('.steep-tag').first().trigger("click", {lowLevelLogging: false});
                                break;
                            case util.misc.getLabelDescriptions('CurbRamp')['tagInfo']['not enough landing space']['keyNumber']: // 'l' for 'not enough landing space'
                                $('.notEnoughLandingSpace-tag').first().trigger("click", {lowLevelLogging: false});
                                break;
                        }
                    } else if (labelType === 'NoCurbRamp') { // Missing Curb Ramp
                        switch (e.keyCode) {
                            case util.misc.getLabelDescriptions('NoCurbRamp')['tagInfo']['alternate route present']['keyNumber']: // 'a' for 'alternate route present'
                                $('.alternateRoutePresent-tag').first().trigger("click", {lowLevelLogging: false});
                                break;
                            case util.misc.getLabelDescriptions('NoCurbRamp')['tagInfo']['no alternate route']['keyNumber']: // 'l' for 'no alternate route'
                                $('.noAlternateRoute-tag').first().trigger("click", {lowLevelLogging: false});
                                break;
                            case util.misc.getLabelDescriptions('NoCurbRamp')['tagInfo']['unclear if needed']['keyNumber']: // 'u' for 'unclear if needed'
                                $('.unclearIfNeeded-tag').first().trigger("click", {lowLevelLogging: false});
                                break;
                        }
                    } else if (labelType === 'Obstacle') { // Obstacle in Path
                        switch (e.keyCode) {
                            case util.misc.getLabelDescriptions('Obstacle')['tagInfo']['trash/recycling can']['keyNumber']: // 'r' for 'trash can'
                                $('.trashCan-tag').first().trigger("click", {lowLevelLogging: false});
                                break;
                            case util.misc.getLabelDescriptions('Obstacle')['tagInfo']['fire hydrant']['keyNumber']: // 'f' for 'fire hydrant'
                                $('.fireHydrant-tag').first().trigger("click", {lowLevelLogging: false});
                                break;
                            case util.misc.getLabelDescriptions('Obstacle')['tagInfo']['pole']['keyNumber']: // 'p' for 'pole'
                                $('.pole-tag').first().trigger("click", {lowLevelLogging: false});
                                break;
                            case util.misc.getLabelDescriptions('Obstacle')['tagInfo']['tree']['keyNumber']: // 'e' for 'tree'
                                $('.tree-tag').first().trigger("click", {lowLevelLogging: false});
                                break;
                            case util.misc.getLabelDescriptions('Obstacle')['tagInfo']['vegetation']['keyNumber']: // 'v' for 'vegetation'
                                $('.vegetation-tag').first().trigger("click", {lowLevelLogging: false});
                                break;
                            case util.misc.getLabelDescriptions('Obstacle')['tagInfo']['parked car']['keyNumber']: // 'a' for 'parked car'
                                $('.parkedCar-tag').first().trigger("click", {lowLevelLogging: false});
                                break;
                            case util.misc.getLabelDescriptions('Obstacle')['tagInfo']['parked bike']['keyNumber']: // 'i' for 'parked bike'
                                $('.parkedBike-tag').first().trigger("click", {lowLevelLogging: false});
                                break;
                            case util.misc.getLabelDescriptions('Obstacle')['tagInfo']['construction']['keyNumber']: // 't' for 'construction'
                                $('.construction-obstacle-tag').first().trigger("click", {lowLevelLogging: false});
                                break;
                            case util.misc.getLabelDescriptions('Obstacle')['tagInfo']['sign']['keyNumber']: // 'g' for 'sign'
                                $('.sign-tag').first().trigger("click", {lowLevelLogging: false});
                                break;
                        }
                    } else if (labelType === 'SurfaceProblem') { // Surface Problem
                        switch (e.keyCode) {
                            case util.misc.getLabelDescriptions('SurfaceProblem')['tagInfo']['bumpy']['keyNumber']: // 'p' for 'bumpy'
                                $('.bumpy-tag').first().trigger("click", {lowLevelLogging: false});
                                break;
                            case util.misc.getLabelDescriptions('SurfaceProblem')['tagInfo']['uneven']['keyNumber']: // 'u' for 'uneven'
                                $('.uneven-tag').first().trigger("click", {lowLevelLogging: false});
                                break;
                            case util.misc.getLabelDescriptions('SurfaceProblem')['tagInfo']['cracks']['keyNumber']: // 'r' for 'cracks'
                                $('.cracks-tag').first().trigger("click", {lowLevelLogging: false});
                                break;
                            case util.misc.getLabelDescriptions('SurfaceProblem')['tagInfo']['grass']['keyNumber'][0]: // 'g' for 'grass'
                                $('.grass-tag').first().trigger("click", {lowLevelLogging: false});
                                break;
                            case util.misc.getLabelDescriptions('SurfaceProblem')['tagInfo']['grass']['keyNumber'][1]: // 'r' for 'grass'
                                $('.grass-tag').first().trigger("click", {lowLevelLogging: false});
                                break;
                            case util.misc.getLabelDescriptions('SurfaceProblem')['tagInfo']['narrow sidewalk']['keyNumber']  : // 'a' for 'narrow sidewalk'
                                $('.narrowSidewalk-tag').first().trigger("click", {lowLevelLogging: false});
                                break;
                            case util.misc.getLabelDescriptions('SurfaceProblem')['tagInfo']['brick']['keyNumber']  : // 'i' for 'brick'
                                $('.brick-tag').first().trigger("click", {lowLevelLogging: false});
                                break;
                            case util.misc.getLabelDescriptions('SurfaceProblem')['tagInfo']['construction']['keyNumber']  : // 't' for 'construction'
                                $('.construction-surface-problem-tag').first().trigger("click", {lowLevelLogging: false});
                                break;
                        }
                    } else if (labelType === 'Other') { // Other
                        switch (e.keyCode) {
                            case util.misc.getLabelDescriptions('Other')['tagInfo']['missing crosswalk']['keyNumber']: // 'i' for 'missing crosswalk'
                                $('.missingCrosswalk-tag').first().trigger("click", {lowLevelLogging: false});
                                break;
                            case util.misc.getLabelDescriptions('Other')['tagInfo']['no bus stop access']['keyNumber']: // 'a' for 'no bus stop access'
                                $('.noBusStopAccess-tag').first().trigger("click", {lowLevelLogging: false});
                                break;
                        }
                    } else if (labelType === 'NoSidewalk') { // No Sidewalk
                        switch (e.keyCode) {
                            case util.misc.getLabelDescriptions('NoSidewalk')['tagInfo']['ends abruptly']['keyNumber']: // 'a' for 'ends abruptly'
                                $('.endsAbruptly-tag').first().trigger("click", {lowLevelLogging: false});
                                break;
                            case util.misc.getLabelDescriptions('NoSidewalk')['tagInfo']['street has a sidewalk']['keyNumber']: // 'r' for 'street has a sidewalk'
                                $('.streetHasASidewalk-tag').first().trigger("click", {lowLevelLogging: false});
                                break;
                            case util.misc.getLabelDescriptions('NoSidewalk')['tagInfo']['street has no sidewalks']['keyNumber']: // 't' for 'street has no sidewalks'
                                $('.streetHasNoSidewalks-tag').first().trigger("click", {lowLevelLogging: false});
                                break;
                        }
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
                    if(contextMenu.isOpen()) {
                        svl.tracker.push("KeyboardShortcut_CloseContextMenu");
                        contextMenu.handleSeverityPopup();
                        svl.tracker.push("ContextMenu_ClosePressEnter");
                        contextMenu.hide();
                    }
                    break;
                case 27:
                    // "Escape"
                    if(contextMenu.isOpen()) {
                        svl.tracker.push("KeyboardShortcut_CloseContextMenu");
                        svl.tracker.push("ContextMenu_CloseKeyboardShortcut");
                        contextMenu.hide();
                    }

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
        }
    };

    function _closeContextMenu(key) {
        if (contextMenu.isOpen()) {
            svl.tracker.push("KeyboardShortcut_CloseContextMenu");
            svl.tracker.push("ContextMenu_CloseKeyboardShortcut", {
                keyCode: key
            });
            contextMenu.hide();
        }
    }

    
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
