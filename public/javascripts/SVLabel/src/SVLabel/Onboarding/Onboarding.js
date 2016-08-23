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
 * @param uiContextMenu
 * @param uiMap
 * @param uiOnboarding
 * @param uiRibbon
 * @param user
 * @param zoomControl
 * @returns {{className: string}}
 * @constructor
 */
function Onboarding (svl, actionStack, audioEffect, compass, form, handAnimation, mapService, missionContainer, modalComment, modalMission,
                     modalSkip, neighborhoodContainer, onboardingStates, ribbon, statusField, statusModel, storage, taskContainer,
                     tracker, uiCanvas, uiContextMenu, uiMap, uiOnboarding, uiRibbon, user, zoomControl) {
    var self = this;
    var ctx;
    var canvasWidth = 720;
    var canvasHeight = 480;
    var properties = {};
    var status = {
        state: 0,
        isOnboarding: true
    };
    var states = onboardingStates.get();

    function _init () {
        status.isOnboarding = true;
        tracker.push('Onboarding_Start');

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

        compass.hideMessage();

        status.state = getState("initialize");
        _visit(status.state);
        handAnimation.initializeHandAnimation();
    }

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

        mapService.unlockDisableWalking();
        mapService.enableWalking();

        zoomControl.unlockDisableZoomIn();
        zoomControl.enableZoomIn();

        zoomControl.unlockDisableZoomOut();
        zoomControl.enableZoomOut();

        setStatus("isOnboarding", false);
        storage.set("completedOnboarding", true);

        if (user.getProperty("username") !== "anonymous") {
            var onboardingMission = missionContainer.getMission(null, "onboarding");
            onboardingMission.setProperty("isCompleted", true);
            missionContainer.stage(onboardingMission).commit();
        }

        // Set the next mission
        var neighborhood = neighborhoodContainer.getStatus("currentNeighborhood");
        var missions = missionContainer.getMissionsByRegionId(neighborhood.getProperty("regionId"));
        var mission = missions[0];

        missionContainer.setCurrentMission(mission);
        modalMission.setMissionMessage(mission, neighborhood);
        modalMission.show();

        taskContainer.initNextTask();
    }

    function _onboardingStateAnnotationExists (state) {
        return "annotations" in state && state.annotations;
    }

    function _onboardingStateMessageExists (state) {
        return "message" in state && state.message;
    }

    function _drawAnnotations (state) {
        var coordinate,
            imX,
            imY,
            lineLength,
            lineAngle,
            x1,
            x2,
            y1,
            y2,
            currentPOV = mapService.getPov();

        clear();
        for (var i = 0, len = state.annotations.length; i < len; i++) {
            imX = state.annotations[i].x;
            imY = state.annotations[i].y;
            currentPOV = mapService.getPov();

            // Map an image coordinate to a canvas coordinate
            if (currentPOV.heading < 180) {
                if (imX > svl.svImageWidth - 3328 && imX > 3328) {
                    imX -= svl.svImageWidth;
                }
            } else {
                if (imX < 3328 && imX < svl.svImageWidth - 3328) {
                    imX += svl.svImageWidth;
                }
            }
            coordinate = util.misc.imageCoordinateToCanvasCoordinate(imX, imY, currentPOV);

            if (state.annotations[i].type == "arrow") {
                lineLength = state.annotations[i].length;
                lineAngle = state.annotations[i].angle;
                x2 = coordinate.x;
                y2 = coordinate.y;
                x1 = x2 - lineLength * Math.sin(util.math.toRadians(lineAngle));
                y1 = y2 - lineLength * Math.cos(util.math.toRadians(lineAngle));
                drawArrow(x1, y1, x2, y2, { "fill": state.annotations[i].fill });
            } else if (state.annotations[i].type == "double-click") {
                drawDoubleClickIcon(coordinate.x, coordinate.y);
            }
        }
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
        hideMessage();

        // End the onboaridng if there is no transition state is specified. Move to the actual task
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
        mapService.enableWalking();
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
                mapService.setPano(state.panoId); // Force the interface to go back to the previous position.
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
                canvasX = mouseposition(e, this).x;
                canvasY = mouseposition(e, this).y;
                pov = mapService.getPov();
                imageCoordinate = util.misc.canvasCoordinateToImageCoordinate(canvasX, canvasY, pov);

                // Check if where the user has clicked is in the right spot on the canvas
                var doubleClickAnnotationCoordinate = state.annotations.filter(function (x) { return x.type == "double-click"; })[0];
                if (Math.sqrt(Math.pow(imageCoordinate.y - doubleClickAnnotationCoordinate.y, 2) +
                        Math.pow(imageCoordinate.x - doubleClickAnnotationCoordinate.x, 2)) < 300) {
                    uiMap.viewControlLayer.off("mouseup", mouseUpCallback);
                    mapService.setPano(state.properties.panoId);
                    callback();
                }
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
                mapService.setPano(state.panoId);
                google.maps.event.removeListener(googleTarget);
            };

            googleTarget = google.maps.event.addListener(svl.panorama, "position_changed", googleCallback);

            $target = $("#onboarding-message-holder").find(".onboarding-transition-trigger");
            function callback () {
                if (listener) google.maps.event.removeListener(listener);
                next.call(this, state.transition);
                mapService.setPano(state.panoId);
                mapService.setPov(pov);
                mapService.setPosition(state.properties.lat, state.properties.lng);

                compass.hideMessage();
            }
            $target.one("click", callback);
        }
    }

    function _visitRateSeverity (state, listener) {
        var $target = uiContextMenu.radioButtons;
        var callback = function () {
            if (listener) google.maps.event.removeListener(listener);
            $target.off("click", callback);
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
        $target.one("click", callback);
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
        var $target;

        ribbon.startBlinking(labelType, subcategory);

        if (subcategory) {
            $target = $(uiRibbon.subcategoryHolder.find('[val="' + subcategory + '"]').get(0));
        } else {
            $target = $(uiRibbon.holder.find('[val="' + labelType + '"]').get(0));
        }

        var callback = function () {
            ribbon.stopBlinking();
            if (listener) google.maps.event.removeListener(listener);
            next(state.transition);
        };
        $target.one("click", callback);
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
                imageCoordinate = util.misc.canvasCoordinateToImageCoordinate(canvasX, canvasY, pov),
                distance = (imageX - imageCoordinate.x) * (imageX - imageCoordinate.x) + (imageY - imageCoordinate.y) * (imageY - imageCoordinate.y);

            if (distance < tolerance * tolerance) {
                if (listener) google.maps.event.removeListener(listener);
                next(state.transition);
            }
        };
        $target.one("click", callback);
    }



    /**
     * Check if the user is working on the onboarding right now
     * @returns {boolean}
     */
    function isOnboarding () {
        return status.isOnboarding;
    }

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

    _init();

    return self;
}