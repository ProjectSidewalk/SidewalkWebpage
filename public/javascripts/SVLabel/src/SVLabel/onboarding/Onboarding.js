/**
 * Onboarding module.
 * Todo. So many dependencies! If possible, break the module down into pieces.
 * @param svl
 * @param actionStack
 * @param audioEffect
 * @param compass
 * @param form
 * @param mapService
 * @param missionContainer
 * @param modalComment
 * @param modalMission
 * @param modalSkip
 * @param neighborhoodContainer
 * @param ribbon
 * @param statusField
 * @param statusModel
 * @param storage
 * @param taskContainer
 * @param tracker
 * @param uiCanvas
 * @param contextMenu
 * @param uiMap
 * @param uiOnboarding
 * @param uiRibbon
 * @param user
 * @param zoomControl
 * @returns {{className: string}}
 * @constructor
 */
function Onboarding (svl, actionStack, audioEffect, compass, form, handAnimation, mapService, missionContainer,
                     missionModel, modalComment, modalMission, modalSkip, neighborhoodContainer,
                     neighborhoodModel, onboardingModel, onboardingStates,
                     ribbon, statusField, statusModel, storage, taskContainer,
                     tracker, uiCanvas, contextMenu, uiMap, uiOnboarding, uiRibbon, user, zoomControl) {
    var self = this;
    var ctx;
    var canvasWidth = 720;
    var canvasHeight = 480;
    var blink_timer = 0;
    var blink_function_identifier=[];
    var properties = {};
    var status = {
        state: 0,
        isOnboarding: true
    };
    var states = onboardingStates.get();

    var _mouseDownCanvasDrawingHandler;

    this._onboardingLabels = [];

    this._removeOnboardingLabels = function () {
        for (var i = 0, len = this._onboardingLabels.length; i < len; i++) {
            this._onboardingLabels[i].remove();
        }
    };

    this.start = function () {
        status.isOnboarding = true;
        tracker.push('Onboarding_Start');

        this._removeOnboardingLabels();

        $("#toolbar-onboarding-link").css("visibility", "hidden");

        var canvas = uiOnboarding.canvas.get(0);
        if (canvas) ctx = canvas.getContext('2d');
        uiOnboarding.holder.css("visibility", "visible");

        mapService.unlockDisableWalking();
        mapService.disableWalking();
        mapService.lockDisableWalking();

        zoomControl.unlockDisableZoomIn();
        zoomControl.disableZoomIn();
        zoomControl.lockDisableZoomIn();

        zoomControl.unlockDisableZoomOut();
        zoomControl.disableZoomOut();
        zoomControl.lockDisableZoomOut();

        ribbon.unlockDisableModeSwitch();
        ribbon.disableModeSwitch();
        ribbon.lockDisableModeSwitch();

        ribbon.unlockDisableMode();

        compass.hideMessage();

        status.state = getState("initialize");
        _visit(status.state);
        handAnimation.initializeHandAnimation();

        onboardingModel.triggerStartOnboarding();
    };

    /**
     * Clear the onboarding canvas
     * @returns {clear}
     */
    function clear () {
        if (ctx) ctx.clearRect(0, 0, canvasWidth, canvasHeight);
        return this;
    }

    /**
     * Draw a double click icon on the onboarding canvas
     * @param x {number} X coordinate
     * @param y {number} Y coordiante
     * @returns {drawDoubleClickIcon}
     */
    function drawDoubleClickIcon (x, y) {
        // https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/drawImage
        var image = document.getElementById("double-click-icon");
        ctx.save();
        ctx.drawImage(image, x - 50, y - 50, 100, 100);
        ctx.restore();
        return this;
    }

    /**
     * Draw an arrow on the onboarding canvas
     * @param x1 {number} Starting x coordinate
     * @param y1 {number} Starting y coordinate
     * @param x2 {number} Ending x coordinate
     * @param y2 {number} Ending y coordinate
     * @param parameters {object} parameters
     * @returns {drawArrow}
     */
    function drawArrow (x1, y1, x2, y2, parameters) {
        if (ctx) {
            var lineWidth = 1,
                fill = 'rgba(255,255,255,1)',
                lineCap = 'round',
                arrowWidth = 6,
                strokeStyle  = 'rgba(96, 96, 96, 1)',
                dx, dy, theta;

            if ("fill" in parameters && parameters.fill) fill = parameters.fill;

            dx = x2 - x1;
            dy = y2 - y1;
            theta = Math.atan2(dy, dx);

            ctx.save();
            ctx.fillStyle = fill;
            ctx.strokeStyle = strokeStyle;
            ctx.lineWidth = lineWidth;
            ctx.lineCap = lineCap;

            ctx.translate(x1, y1);
            ctx.beginPath();
            ctx.moveTo(arrowWidth * Math.sin(theta), - arrowWidth * Math.cos(theta));
            ctx.lineTo(dx + arrowWidth * Math.sin(theta), dy - arrowWidth * Math.cos(theta));

            // Draw an arrow head
            ctx.lineTo(dx + 3 * arrowWidth * Math.sin(theta), dy - 3 * arrowWidth * Math.cos(theta));
            ctx.lineTo(dx + 3 * arrowWidth * Math.cos(theta), dy + 3 * arrowWidth * Math.sin(theta));
            ctx.lineTo(dx - 3 * arrowWidth * Math.sin(theta), dy + 3 * arrowWidth * Math.cos(theta));

            ctx.lineTo(dx - arrowWidth * Math.sin(theta), dy + arrowWidth * Math.cos(theta));
            ctx.lineTo(- arrowWidth * Math.sin(theta), + arrowWidth * Math.cos(theta));

            ctx.fill();
            ctx.stroke();
            ctx.closePath();
            ctx.restore();
        }
        return this;
    }

    function drawBlinkingArrow(x1, y1, x2, y2, parameters) {
        var max_frequency = 60;
        var blink_period = 0.5;

        function helperBlinkingArrow() {
            var par;
            blink_timer = (blink_timer + 1) % max_frequency;
            if (blink_timer < blink_period * max_frequency) {
                par = parameters
            }
            else {
                par = {"fill": null};
            }
            drawArrow(x1, y1, x2, y2, par);
            //requestAnimationFrame usually calls the function argument at the refresh rate of the screen (max_frequency)
            //Assume this is 60fps. We want to have an arrow flashing period of 0.5s (blink period)
            var function_identifier = window.requestAnimationFrame(helperBlinkingArrow);
            blink_function_identifier.push(function_identifier);
        }

        helperBlinkingArrow();
    }


    /**
     * Get a state
     * @param stateIndex
     * @returns {*}
     */
    function getState(stateIndex) {
        return states[stateIndex];
    }

    /**
     * Hide the message box.
     */
    function hideMessage () {
        if (uiOnboarding.messageHolder.is(":visible")) uiOnboarding.messageHolder.hide();
    }

    /**
     * Transition to the next state
     * @param nextState
     */
    function next (nextState) {
        if (typeof nextState == "function") {
            status.state = getState(nextState.call(this));
            _visit(status.state);
        } else if (nextState in states) {
            status.state = getState(nextState);
            _visit(status.state);
        } else {
            _visit(null);
        }
    }

    /**
     * Show a message box
     * @param parameters
     */
    function showMessage (parameters) {
        var message = parameters.message, position = parameters.position;
        if (!position) position = "top-right";

        uiOnboarding.messageHolder.toggleClass("yellow-background");
        setTimeout(function () { uiOnboarding.messageHolder.toggleClass("yellow-background"); }, 100);

        uiOnboarding.messageHolder.css({
            top: 0,
            left: 0,
            width: 300
        });


        if (!uiOnboarding.messageHolder.is(":visible")) uiOnboarding.messageHolder.show();


        uiOnboarding.background.css("visibility", "hidden");
        if (parameters) {
            if ("width" in parameters) {
                uiOnboarding.messageHolder.css("width", parameters.width);
            }

            if ("left" in parameters) {
                uiOnboarding.messageHolder.css("left", parameters.left);
            }

            if ("top" in parameters) {
                uiOnboarding.messageHolder.css("top", parameters.top);
            }

            if ("background" in parameters && parameters.background) {
                uiOnboarding.background.css("visibility", "visible");
            }
        }

        uiOnboarding.messageHolder.html((typeof message == "function" ? message() : message));
    }

    function _endTheOnboarding () {
        tracker.push('Onboarding_End');
        var task = taskContainer.getCurrentTask();
        var data = form.compileSubmissionData(task);
        form.submit(data, task);
        uiOnboarding.background.css("visibility", "hidden");

        //Reset the label counts to zero after onboarding
        svl.labelCounter.reset();

        $("#toolbar-onboarding-link").css("visibility", "visible");

        mapService.unlockDisableWalking();
        mapService.enableWalking();

        zoomControl.unlockDisableZoomIn();
        zoomControl.enableZoomIn();

        zoomControl.unlockDisableZoomOut();
        zoomControl.enableZoomOut();

        ribbon.unlockDisableModeSwitch();
        ribbon.enableModeSwitch();

        setStatus("isOnboarding", false);
        storage.set("completedOnboarding", true);

        if (user.getProperty("username") !== "anonymous") {
            var onboardingMission = missionContainer.getMission(null, "onboarding");
            onboardingMission.setProperty("isCompleted", true);
            // missionContainer.addToCompletedMissions(onboardingMission);
            missionModel.completeMission(onboardingMission, null);
        }

        // Set the next mission
        var neighborhood = neighborhoodContainer.getStatus("currentNeighborhood");
        var missions = missionContainer.getMissionsByRegionId(neighborhood.getProperty("regionId"));
        var mission = missions[0];

        missionContainer.setCurrentMission(mission);
        modalMission.setMissionMessage(mission, neighborhood);
        modalMission.show();

        taskContainer.getFinishedAndInitNextTask();
    }

    function _onboardingStateAnnotationExists (state) {
        return "annotations" in state && state.annotations;
    }

    function _onboardingStateMessageExists (state) {
        return "message" in state && state.message;
    }

    function _drawAnnotations (state) {
        var imX,
            imY,
            lineLength,
            lineAngle,
            x1,
            x2,
            y1,
            y2,
            origPointPov,
            canvasCoordinate;

        var currentPov = mapService.getPov();

        var povChange = svl.map.getPovChangeStatus();

        povChange["status"] = true;

        clear();

        for (var i = 0, len = state.annotations.length; i < len; i++) {
            imX = state.annotations[i].x;
            imY = state.annotations[i].y;
            origPointPov = state.annotations[i].originalPov;

            // 280 is the initial heading of the onoboarding. Refer to OnboardingStates
            // for the value
            // This avoids applying the first arrow if the heading is not set correctly
            // This will avoid incorrection POV calculation
            if (state.annotations[i].name == "arrow-1a" && currentPov.heading != 280 &&
                jQuery.isEmptyObject(origPointPov)) {
                povChange["status"] = false;
                return this;
            }
            // Setting the original Pov only once and
            // mapping an image coordinate to a canvas coordinate
            if (jQuery.isEmptyObject(origPointPov)){

                if (currentPov.heading < 180) {
                    if (imX > svl.svImageWidth - 3328 && imX > 3328) {
                        imX -= svl.svImageWidth;
                    }
                } else {
                    if (imX < 3328 && imX < svl.svImageWidth - 3328) {
                        imX += svl.svImageWidth;
                    }
                }

                origPointPov = util.panomarker.calculatePointPovFromImageCoordinate(imX, imY, currentPov);
                state.annotations[i].originalPov = origPointPov;

            }
            canvasCoordinate = util.panomarker.getCanvasCoordinate (canvasCoordinate, origPointPov, currentPov);

            if (state.annotations[i].type == "arrow") {
                lineLength = state.annotations[i].length;
                lineAngle = state.annotations[i].angle;
                x2 = canvasCoordinate.x;
                y2 = canvasCoordinate.y;
                x1 = x2 - lineLength * Math.sin(util.math.toRadians(lineAngle));
                y1 = y2 - lineLength * Math.cos(util.math.toRadians(lineAngle));
                //The color of the arrow will by default alternate between white and the fill specified in annotation
                if(state.annotations[i].fill==null || state.annotations[i].fill=="white"){
                    drawArrow(x1,y1,x2,y2,{"fill":state.annotations[i].fill});
                }
                else{
                    drawBlinkingArrow(x1, y1, x2, y2, {"fill": "yellow"});
                }

            } else if (state.annotations[i].type == "double-click") {
                drawDoubleClickIcon(canvasCoordinate.x, canvasCoordinate.y);
            }
        }
        povChange["status"] = false;
    }

    /**
     * Execute an instruction based on the current state.
     * @param state
     */
    function _visit(state) {
        var i,
            len,
            callback,
            annotationListener;

        clear(); // Clear what ever was rendered on the onboarding-canvas in the previous state.
        if(blink_function_identifier.length!=0){
            while(blink_function_identifier.length!=0) {
                window.cancelAnimationFrame(blink_function_identifier.pop());
            }
        }
        hideMessage();

        // End the onboarding if there is no transition state is specified. Move to the actual task
        if (!state) {
            _endTheOnboarding();
            return;
        }

        // Show user a message box.
        if (_onboardingStateMessageExists(state)) {
            showMessage(state.message);
        }

        // Draw arrows to annotate target accessibility attributes
        if (_onboardingStateAnnotationExists(state)) {
            _drawAnnotations(state);
            if (typeof google != "undefined")  {
                annotationListener = google.maps.event.addListener(svl.panorama, "pov_changed", function () {
                    //Stop the animation for the blinking arrows
                    if(blink_function_identifier.length!=0){
                        while(blink_function_identifier.length!=0) {
                            window.cancelAnimationFrame(blink_function_identifier.pop());
                        }
                    }
                    _drawAnnotations(state);
                });
            }
        }

        // Change behavior based on the current state.
        if ("properties" in state) {
            if (state.properties.action == "Introduction") {
                _visitIntroduction(state, annotationListener);
            } else if (state.properties.action == "SelectLabelType") {
                _visitSelectLabelTypeState(state, annotationListener);
            } else if (state.properties.action == "LabelAccessibilityAttribute") {
                _visitLabelAccessibilityAttributeState(state, annotationListener);
            } else if (state.properties.action == "Zoom") {
                _visitZoomState(state, annotationListener);
            } else if (state.properties.action == "RateSeverity" || state.properties.action == "RedoRateSeverity") {
                _visitRateSeverity(state, annotationListener);
            } else if (state.properties.action == "AdjustHeadingAngle") {
                _visitAdjustHeadingAngle(state, annotationListener);
            } else if (state.properties.action == "WalkTowards") {
                _visitWalkTowards(state, annotationListener);
            } else if (state.properties.action == "Instruction") {
                _visitInstruction(state, annotationListener);
            }
        }
    }

    function _visitWalkTowards (state, listener) {
        mapService.unlockDisableWalking();
        mapService.lockDisableWalking();

        var $target;
        var callback = function () {
            var panoId = mapService.getPanoId();
            if (state.properties.panoId == panoId) {
                window.setTimeout(function () { mapService.unlockDisableWalking().disableWalking().lockDisableWalking(); }, 1000);
                if (typeof google != "undefined") google.maps.event.removeListener($target);
                if (listener) google.maps.event.removeListener(listener);
                next(state.transition);
            } else {
                mapService.setPano(state.panoId, true); // Force the interface to go back to the previous position.
            }
        };
        // Add and remove a listener: http://stackoverflow.com/questions/1544151/google-maps-api-v3-how-to-remove-an-event-listener

        if (typeof google != "undefined") $target = google.maps.event.addListener(svl.panorama, "position_changed", callback);

        // Sometimes Google changes the topology of Street Views and so double clicking/clicking arrows do not
        // take the user to the right panorama. In that case, programmatically move the user.
        var currentClick, previousClick, canvasX, canvasY, pov, imageCoordinate;
        var mouseUpCallback = function (e) {
            currentClick = new Date().getTime();


            // Check if the user has double clicked
            if (previousClick && currentClick - previousClick < 300) {
                //Previously, we checked if the user double-clicked on the correct location,
                // it wasn't working correctly and we removed that. So it will jump them if they click anywhere
                uiMap.viewControlLayer.off("mouseup", mouseUpCallback);
                mapService.setPano(state.properties.panoId, true);
                mapService.disableWalking();
                callback();
            }
            previousClick = currentClick;
        };
        uiMap.viewControlLayer.on("mouseup", mouseUpCallback);
    }

    function _visitAdjustHeadingAngle (state, listener) {
        var $target;
        var interval;
        interval = handAnimation.showGrabAndDragAnimation({direction: "left-to-right"});
        var callback = function () {
            var pov = mapService.getPov();
            if ((360 + state.properties.heading - pov.heading) % 360 < state.properties.tolerance) {
                if (typeof google != "undefined") google.maps.event.removeListener($target);
                if (listener) google.maps.event.removeListener(listener);
                handAnimation.hideGrabAndDragAnimation(interval);
                next(state.transition);
            }
        };
        // Add and remove a listener: http://stackoverflow.com/questions/1544151/google-maps-api-v3-how-to-remove-an-event-listener
        if (typeof google != "undefined") $target = google.maps.event.addListener(svl.panorama, "pov_changed", callback);
    }

    function _visitIntroduction (state, listener) {
        var pov = {
                heading: state.properties.heading,
                pitch: state.properties.pitch,
                zoom: state.properties.zoom
            },
            googleTarget,
            googleCallback,
            $target;

        // I need to nest callbacks due to the bug in Street View; I have to first set panorama, and set POV
        // once the panorama is loaded. Here I let the panorama load while the user is reading the instruction.
        // When they click OK, then the POV changes.
        if (typeof google != "undefined") {
            googleCallback = function () {
                mapService.setPano(state.panoId, true);
                google.maps.event.removeListener(googleTarget);
            };

            googleTarget = google.maps.event.addListener(svl.panorama, "position_changed", googleCallback);

            $target = $("#onboarding-message-holder").find(".onboarding-transition-trigger");
            function callback () {
                if (listener) google.maps.event.removeListener(listener);
                $target.off("click", callback);
                next.call(this, state.transition);
                mapService.setPano(state.panoId, true);
                mapService.setPov(pov);
                mapService.setPosition(state.properties.lat, state.properties.lng);

                compass.hideMessage();
            }
            $target.on("click", callback);
        }
    }

    function _visitRateSeverity (state, listener) {

        if (state.properties.action == "RedoRateSeverity") contextMenu.unhide();
        var $target = contextMenu.getContextMenuUI().radioButtons;
        var callback = function () {
            if (listener) google.maps.event.removeListener(listener);
            $target.off("click", callback);
            contextMenu.hide();
            next.call(this, state.transition);
        };
        $target.on("click", callback);
    }

    function _visitInstruction (state, listener) {
        if (!("okButton" in state) || state.okButton) {
            // Insert an ok button.
            uiOnboarding.messageHolder.append("<br/><button id='onboarding-ok-button' class='button width-50'>OK</button>");
        }

        // Blink parts of the interface
        if ("blinks" in state.properties && state.properties.blinks) {
            len = state.properties.blinks.length;
            for (i = 0; i < len; i++) {
                switch (state.properties.blinks[i]) {
                    case "google-maps":
                        mapService.blinkGoogleMaps();
                        break;
                    case "compass":
                        compass.blink();
                        break;
                    case "status-field":
                        statusField.blink();
                        break;
                    case "zoom":
                        zoomControl.blink();
                        break;
                    case "action-stack":
                        actionStack.blink();
                        break;
                    case "sound":
                        audioEffect.blink();
                        break;
                    case "jump":
                        modalSkip.blink();
                        break;
                    case "feedback":
                        modalComment.blink();
                        break;
                }
            }
        }

        var $target = $("#onboarding-ok-button");
        var callback = function () {
            if (listener) google.maps.event.removeListener(listener);
            $target.off("click", callback);
            if ("blinks" in state.properties && state.properties.blinks) {
                mapService.stopBlinkingGoogleMaps();
                compass.stopBlinking();
                statusField.stopBlinking();
                zoomControl.stopBlinking();
                actionStack.stopBlinking();
                audioEffect.stopBlinking();
                modalSkip.stopBlinking();
                modalComment.stopBlinking();
            }
            // $target.off("click", callback);
            next.call(this, state.transition);
        };
        $target.on("click", callback);
    }

    /**
     * Blink the given label type and nudge them to click one of the buttons in the ribbon menu.
     * Move on to the next state if they click the button.
     * @param state
     * @param listener
     * @private
     */
    function _visitSelectLabelTypeState(state, listener) {
        var labelType = state.properties.labelType;
        var subcategory = "subcategory" in state.properties ? state.properties.subcategory : null;
        var event;

        ribbon.enableMode(labelType, subcategory);
        ribbon.startBlinking(labelType, subcategory);

        if (subcategory) {
            event = subcategory
        } else {
            event = labelType
        }

        // To handle when user presses ESC, the
        _mouseDownCanvasDrawingHandler = function () {
            console.log("Calling Onboarding Mouse down");
            ribbon.disableMode(labelType, subcategory);
        };

        var callback = function () {
            ribbon.enableMode("Walk");

            // Disable only when the user places the label
            uiCanvas.drawingLayer.on("mousedown", _mouseDownCanvasDrawingHandler);

            ribbon.stopBlinking();
            $(document).off('ModeSwitch_' + event, callback);
            if (listener) google.maps.event.removeListener(listener);
            next(state.transition);
        };

        $(document).on('ModeSwitch_' + event, callback);
    }

    /**
     * Tell the user to zoom in/out.
     * @param state
     * @param listener
     * @private
     */
    function _visitZoomState(state, listener) {
        var zoomType = state.properties.type;
        var $target;

        if (zoomType == "in") {
            $target = zoomControl.getZoomInUI();
            zoomControl.blinkZoomIn();
            zoomControl.unlockDisableZoomIn();
            zoomControl.enableZoomIn();
            zoomControl.lockDisableZoomIn();

        } else {
            $target = zoomControl.getZoomOutUI();
            zoomControl.blinkZoomOut();

            // Enable zoom-out
            zoomControl.unlockDisableZoomOut();
            zoomControl.enableZoomOut();
            zoomControl.lockDisableZoomOut();
        }

        var callback = function () {
            zoomControl.stopBlinking();
            if (zoomType == "in") {
                // Disable zoom-in
                zoomControl.unlockDisableZoomIn();
                zoomControl.disableZoomIn();
                zoomControl.lockDisableZoomIn();
            }
            else {
                // Disable zoom-out
                zoomControl.unlockDisableZoomOut();
                zoomControl.disableZoomOut();
                zoomControl.lockDisableZoomOut();
            }
            ribbon.enableMode("Walk");
            $target.off("click", callback);

            if (listener) google.maps.event.removeListener(listener);
            next(state.transition);
        };

        $target.on("click", callback);

    }

    function _incorrectLabelApplication(state) {

        hideMessage();

        // TODO: for future
        // Show animated arrow pointing down at the location to emphasise and complement the message

        // Show error message
        state.message.message = 'Oops! You labeled too far. <span class="bold">Click beneath ' +
            'the flashing yellow arrow</span> to label it.';
        showMessage(state.message);
    }

    /**
     * Tell the user to label the target attribute.
     * @param state
     * @param listener
     * @private
     */
    function _visitLabelAccessibilityAttributeState(state, listener) {
        var imageX = state.properties.imageX;
        var imageY = state.properties.imageY;
        var tolerance = state.properties.tolerance;
        var $target = uiCanvas.drawingLayer;

        var callback = function (e) {
            var clickCoordinate = mouseposition(e, this),
                pov = mapService.getPov(),
                canvasX = clickCoordinate.x,
                canvasY = clickCoordinate.y,
                imageCoordinate = util.panomarker.canvasCoordinateToImageCoordinate(canvasX, canvasY, pov),
                distance = (imageX - imageCoordinate.x) * (imageX - imageCoordinate.x) +
                    (imageY - imageCoordinate.y) * (imageY - imageCoordinate.y);

            if (distance < tolerance * tolerance) {
                ribbon.disableMode(state.properties.labelType, state.properties.subcategory);
                ribbon.enableMode("Walk");
                uiCanvas.drawingLayer.off("mousedown", _mouseDownCanvasDrawingHandler);
                $target.off("click", callback);
                if (listener) google.maps.event.removeListener(listener);
                next(state.transition);
            } else {
                // Incorrect label application
                _incorrectLabelApplication(state);
                ribbon.enableMode(state.properties.labelType, state.properties.subcategory);
            }
        };
        $target.on("click", callback);
    }



    /**
     * Check if the user is working on the onboarding right now
     * @returns {boolean}
     */
    function isOnboarding () {
        return status.isOnboarding;
    }

    this.pushOnboardingLabel = function (label) {
        this._onboardingLabels.push(label);
    };

    /**
     * Set status
     * @param key Status field name
     * @param value Status field value
     * @returns {setStatus}
     */
    function setStatus (key, value) {
        if (key in status) status[key] = value;
        return this;
    }

    self._visit = _visit;
    self.clear = clear;
    self.drawArrow = drawArrow;
    self.next = next;
    self.isOnboarding = isOnboarding;
    self.showMessage = showMessage;
    self.setStatus = setStatus;
    self.hideMessage = hideMessage;
}