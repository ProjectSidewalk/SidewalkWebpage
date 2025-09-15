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
    var status = {
        focusOnTextField: false,
        isOnboarding: false,
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
    this._movePano = function(angle) {
        if (googleMap.getStatus("disableWalking")) return;
        // take the cosine of the difference for each link to the current heading in radians and stores them to an array
        var cosines = svl.panorama.links.map(function(link) {
            var headingAngleOffset = util.math.toRadians(svl.panorama.pov.heading + angle) - util.math.toRadians(link.heading);
            return Math.cos(headingAngleOffset);
        });
        var maxVal = Math.max.apply(null, cosines);
        var maxIndex = cosines.indexOf(maxVal);
        if (cosines[maxIndex] > 0.5) {
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
     * Change the heading of the current panorama point of view by a particular degree value.
     *
     * @param degree
     */
    this._rotatePovByDegree = function(degree) {
        if (!svl.map.getStatus("disablePanning")) {
            svl.contextMenu.hide();
            // Panning hide label tag and delete icon.
            var labels = svl.labelContainer.getCanvasLabels(),
                labelLen = labels.length;
            for (var i=0; i<labelLen; i++){
                labels[i].setHoverInfoVisibility('hidden');
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
            svl.map.setPov({heading: pov.heading, pitch: pov.pitch, zoom: pov.zoom});
        }
    };

    /**
     * This is a callback for a key down event
     * @param {object} e An event object
     * @private
     */
    this._documentKeyDown = function (e) {
        // Prevent Google's default panning and moving using arrow keys and WASD.
        // https://stackoverflow.com/a/66069717/9409728
        if (['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].indexOf(e.code) > -1) {
            e.stopPropagation();
        }

        if (!status.disableKeyboard && !status.focusOnTextField) {
            // Shortcuts that only apply when the context menu is closed (moving/panning).
            if (!contextMenu.isOpen()) {
                switch (e.key) {
                    case "ArrowLeft":
                        self._rotatePovByDegree(-2);
                        break;
                    case "ArrowRight":
                        self._rotatePovByDegree(2);
                        break;
                    case "ArrowUp":
                        if (!status.disableMovement) { self._moveForward(); }
                        break;
                    case "ArrowDown":
                        if (!status.disableMovement) { self._moveBackward(); }
                        break;
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
        // Ways to close context menu. Separated from later code because we want these to work in description textbox.
        if (!status.disableKeyboard && contextMenu.isOpen()) {
            switch (e.key) {
                case "Enter":
                    svl.tracker.push("KeyboardShortcut_CloseContextMenu");
                    contextMenu.handleSeverityPopup();
                    svl.tracker.push("ContextMenu_ClosePressEnter");
                    contextMenu.hide();
                    break;
                case "Escape":
                    _closeContextMenu(e.keyCode);
                    ribbon.backToWalk();
                    break;
            }
        }

        if (!status.disableKeyboard && !status.focusOnTextField) {
            // Switch labeling mode. e: Walk, c: CurbRamp, m: NoCurbRamp, o: Obstacle, s: SurfaceProblem: n: NoSidewalk,
            // w: Crosswalk, p: Signal, b: Occlusion.
            for (const mode of ['Walk'].concat(util.misc.VALID_LABEL_TYPES_WITHOUT_OTHER)) {
                if (e.key.toUpperCase() === util.misc.getLabelDescriptions(mode)['keyChar']) {
                    if (mode !== 'Walk') _closeContextMenu(e.keyCode);
                    ribbon.modeSwitch(mode);
                    svl.tracker.push("KeyboardShortcut_ModeSwitch_" + mode, { keyCode: e.keyCode });
                }
            }

            // Zooming in/out.
            if (e.code === 'KeyZ') {
                // Close the context menu whenever we zoom.
                if (contextMenu.isOpen()) {
                    svl.tracker.push("KeyboardShortcut_CloseContextMenu");
                    contextMenu.hide();
                }

                // Zoom in or out depending on whether shift is down.
                if (e.shiftKey) {
                    zoomControl.zoomOut();
                    svl.tracker.push("KeyboardShortcut_ZoomOut", { keyCode: e.keyCode });
                } else {
                    zoomControl.zoomIn();
                    svl.tracker.push("KeyboardShortcut_ZoomIn", { keyCode: e.keyCode });
                }
            }

            // Shortcuts that only apply when the context menu is open (like rating severity and adding/removing tags).
            if (contextMenu.isOpen()) {
                let targetLabel = contextMenu.getTargetLabel();

                // Rating severity. Can use either number keys or numpad keys.
                if (["1", "2", "3"].includes(e.key) && targetLabel && !contextMenu.isRatingSeverityDisabled()) {
                    const severity = Number(e.key); // "1" - "3"
                    contextMenu.checkRadioButton(severity);
                    targetLabel.setProperty('severity', severity);
                    svl.tracker.push("KeyboardShortcut_Severity_" + severity, { keyCode: e.keyCode });
                    svl.canvas.clear().render();
                }

                // Adding/removing tags.
                if (targetLabel && !contextMenu.isTaggingDisabled()) {
                    var labelType = targetLabel.getProperty('labelType');
                    var tags = contextMenu.labelTags.filter(tag => tag.label_type === labelType);
                    for (const tag of tags) {
                        if (e.key.toUpperCase() === util.misc.getLabelDescriptions(labelType)['tagInfo'][tag.tag]['keyChar']) {
                            $('.tag-id-' + tag.tag_id).first().trigger("click", { lowLevelLogging: false });
                        }
                    }
                }
            }
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


    // Add the keyboard event listeners. We need { capture: true } for keydown to disable StreetView's shortcuts.
    window.addEventListener('keydown', this._documentKeyDown, { capture: true });
    window.addEventListener('keyup', this._documentKeyUp);
}
