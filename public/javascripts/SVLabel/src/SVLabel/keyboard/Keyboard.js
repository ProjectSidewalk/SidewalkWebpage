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
        moving: false,
        disableMovement: false
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
            return true;
        } else {
            return false;
        }
    };

    /*
       Move user in specific angle relative to current view for a specific moveTime.
     */
    function timedMove(angle, moveTime){
        if (status.moving || svl.popUpMessage.getStatus("isVisible")){
            svl.panorama.set("linksControl", false);
            return;
        }
        svl.contextMenu.hide();
        svl.ui.canvas.deleteIconHolder.css("visibility", "hidden");
        var moveSuccess = self._movePano(angle);
        if (moveSuccess) {
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
                if (e.keyCode >= 49 && e.keyCode <= 53) {
                    const severity = e.keyCode - 48; // "1" - "5"
                    contextMenu.checkRadioButton(severity);
                    label = contextMenu.getTargetLabel();
                    if (label) {
                        label.setProperty('severity', severity);
                        svl.tracker.push("KeyboardShortcut_Severity_" + severity, {
                            keyCode: e.keyCode
                        });
                        svl.canvas.clear().render2();
                    }
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
                }
                if (!status.disableMovement) {
                    switch (e.keyCode) {
                        case 38: // "up"
                            self._moveForward();
                            break;
                        case 40:  // "down"
                            self._moveBackward();
                            break;
                    }
                }
                if ([37, 38, 39, 40].indexOf(e.keyCode) > -1) {
                    e.preventDefault();
                }
            }
        }
    };

    /**
     * This is a callback for a key up event when focus is not on ContextMenu's textbox.
     * @param {object} e An event object
     * @private
     */
    this._documentKeyUp = function (e) {
        if (!status.disableKeyboard) {
            status.shiftDown = e.shiftKey;
            if (!status.focusOnTextField) {
                // e: Walk, c: CurbRamp, m: NoCurbRamp, o: Obstacle, s: SurfaceProblem: n: NoSidewalk, w: Crosswalk,
                // p: Signal, b: Occlusion
                for (const mode of ['Walk', 'CurbRamp', 'NoCurbRamp', 'Obstacle', 'SurfaceProblem', 'NoSidewalk', 'Crosswalk', 'Signal', 'Occlusion']) {
                    if (e.key.toUpperCase() === util.misc.getLabelDescriptions(mode)['keyChar']) {
                        if (mode !== 'Walk') _closeContextMenu(e.keyCode);
                        ribbon.modeSwitch(mode);
                        svl.tracker.push("KeyboardShortcut_ModeSwitch_" + mode, {
                            keyCode: e.keyCode
                        });
                    }
                }
                switch(e.keyCode) {
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
                    var tags = contextMenu.labelTags.filter(tag => tag.label_type === labelType);
                    for (const tag of tags) {
                        if (e.key.toUpperCase() === util.misc.getLabelDescriptions(labelType)['tagInfo'][tag.tag]['keyChar']) {
                            $('.tag-id-' + tag.tag_id).first().trigger("click", {lowLevelLogging: false});
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
