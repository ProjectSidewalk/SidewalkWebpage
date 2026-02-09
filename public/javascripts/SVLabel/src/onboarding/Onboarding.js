/**
 * Onboarding module.
 * Todo. So many dependencies! If possible, break the module down into pieces.
 * @param svl
 * @param audioEffect
 * @param compass
 * @param form
 * @param handAnimation
 * @param navigationService
 * @param missionContainer
 * @param modalComment
 * @param leftMenu
 * @param onboardingStates
 * @param ribbon
 * @param statusField
 * @param tracker
 * @param canvas
 * @param uiCanvas
 * @param contextMenu
 * @param uiOnboarding
 * @param uiLeft
 * @param user
 * @param zoomControl
 * @returns {{className: string}}
 * @constructor
 */
function Onboarding(svl, audioEffect, compass, form, handAnimation, navigationService, missionContainer, modalComment,
                    leftMenu, onboardingStates, ribbon, statusField, tracker, canvas, uiCanvas, contextMenu,
                    uiOnboarding, uiLeft, user, zoomControl) {
    var self = this;
    var ctx;
    var blink_timer = 0;
    var blink_function_identifier = [];
    var states = onboardingStates.get();
    var statesWithProgress = states.filter(state => state.progression);
    var savedAnnotations = [];

    var _mouseDownCanvasDrawingHandler;
    var currentLabelState;
    var map = svl.minimap.getMap();
    var currentLabelId;

    this.start = function () {
        tracker.push('Onboarding_Start');

        adjustMap();

        $("#navbar-retake-tutorial-btn").css("display", "none");

        var canvasUI = uiOnboarding.canvas.get(0);
        if (canvasUI) ctx = canvasUI.getContext('2d');
        uiOnboarding.holder.css("visibility", "visible");

        svl.panoManager.lockShowingNavArrows();

        canvas.unlockDisableLabelDelete();
        canvas.disableLabelDelete();
        canvas.lockDisableLabelDelete();

        navigationService.unlockDisableWalking().disableWalking().lockDisableWalking();

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

        uiLeft.stuck.addClass('disabled');

        compass.hideMessage();
        compass.disableCompassClick();
        compass.lockDisableCompassClick();

        contextMenu.disableRatingSeverity();
        contextMenu.disableTagging();

        // Make sure that the context menu covers instructions when hovering over the context menu.
        svl.ui.contextMenu.holder.on('mouseover', function() {
            uiOnboarding.messageHolder.css('z-index', 2);
        });
        svl.ui.contextMenu.holder.on('mouseout', function() {
            uiOnboarding.messageHolder.css('z-index', 1100);
        });

        _visit(getState("initialize"));
        handAnimation.initializeHandAnimation();
    };

    /**
     * Sets the mini map to be transparent for everything except for yellow pin.
     */
    function adjustMap() {
        map.setOptions({styles: [{ featureType: "all", stylers: [{ visibility: "off" }] }]});
        svl.ui.minimap.holder.css('backgroundImage', `url('${svl.rootDirectory}img/onboarding/TutorialMiniMap.jpg')`);
    }

    /**
     * Clear the onboarding canvas.
     * @returns {clear}
     */
    function clear() {
        if (ctx) ctx.clearRect(0, 0, util.EXPLORE_CANVAS_WIDTH, util.EXPLORE_CANVAS_HEIGHT);
        return this;
    }

    /**
     * Draw a label on the onboarding canvas. Only used to draw static labels as examples in the tutorial.
     * @param labelType {string} Label type, used to show correct icon
     * @param x {number} canvas x-position of the center of the label
     * @param y {number} canvas y-position of the center of the label
     * @private
     */
    function _drawStaticLabel(labelType, x, y) {
        if (ctx) {
            ctx.save();
            Label.renderLabelIcon(ctx, labelType, x, y);
            ctx.restore();
        }
    }

    /**
     * Draw a box on the onboarding canvas.
     * @param x {number} top-left x coordinate
     * @param y {number} top-left y coordinate
     * @param width {number} pixel width
     * @param height {number} pixel height
     * @param parameters {object} parameters
     */
    function _drawBox(x, y, width, height, parameters) {
        if (ctx) {
            ctx.save();
            ctx.strokeStyle = parameters.strokeStyle;
            ctx.lineWidth = parameters.lineWidth;
            ctx.strokeRect(x, y, width, height);
            ctx.restore();
        }
        return this;
    }

    /**
     * Draw an arrow on the onboarding canvas.
     * @param x1 {number} Starting x coordinate
     * @param y1 {number} Starting y coordinate
     * @param x2 {number} Ending x coordinate
     * @param y2 {number} Ending y coordinate
     * @param parameters {object} parameters
     * @returns {_drawArrow}
     */
    function _drawArrow(x1, y1, x2, y2, parameters) {
        if (ctx) {
            var lineWidth = parameters.lineWidth,
                fill = parameters.fill,
                lineCap = parameters.lineCap,
                arrowWidth = parameters.arrowWidth,
                strokeStyle  = parameters.strokeStyle,
                dx, dy, theta;

            if (!parameters.fill) {
                fill = 'rgba(255,255,255,1)';
            }

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
            ctx.moveTo(arrowWidth * Math.sin(theta), -arrowWidth * Math.cos(theta));
            ctx.lineTo(dx + arrowWidth * Math.sin(theta), dy - arrowWidth * Math.cos(theta));

            // Draw an arrow head
            ctx.lineTo(dx + 3 * arrowWidth * Math.sin(theta), dy - 3 * arrowWidth * Math.cos(theta));
            ctx.lineTo(dx + 3 * arrowWidth * Math.cos(theta), dy + 3 * arrowWidth * Math.sin(theta));
            ctx.lineTo(dx - 3 * arrowWidth * Math.sin(theta), dy + 3 * arrowWidth * Math.cos(theta));

            ctx.lineTo(dx - arrowWidth * Math.sin(theta), dy + arrowWidth * Math.cos(theta));
            ctx.lineTo(-arrowWidth * Math.sin(theta), +arrowWidth * Math.cos(theta));

            ctx.fill();
            ctx.closePath();
            ctx.stroke();
            ctx.restore();
        }
        return this;
    }

    function _drawBlinkingArrow(x1, y1, x2, y2, parameters, blink_frequency_modifier) {
        var max_frequency = 60 * blink_frequency_modifier;
        var blink_period = 0.5;
        var originalFillColor = parameters.fill;

        function helperBlinkingArrow() {
            blink_timer = (blink_timer + 1) % max_frequency;
            var param;
            if (blink_timer < blink_period * max_frequency) {
                parameters["fill"] = originalFillColor;
            } else {
                parameters["fill"] = "white";
            }
            param = parameters;
            _drawArrow(x1, y1, x2, y2, param);

            //requestAnimationFrame usually calls the function argument at the refresh rate of the screen (max_frequency)
            //Assume this is 60fps. We want to have an arrow flashing period of 0.5s (blink period)
            var function_identifier = window.requestAnimationFrame(helperBlinkingArrow);
            blink_function_identifier.push(function_identifier);
        }
        helperBlinkingArrow();
    }

    function _removeFlashingFromArrow() {
        while (blink_function_identifier.length !== 0) {
            window.cancelAnimationFrame(blink_function_identifier.pop());
        }
    }

    function _stopAllBlinking() {
        svl.minimap.stopBlinkingMinimap();
        compass.stopBlinking();
        statusField.stopBlinking();
        zoomControl.stopBlinking();
        audioEffect.stopBlinking();
        leftMenu.stopBlinkingStuckButton();
        modalComment.stopBlinking();
    }

    function _drawAnnotations(state) {
        var imX,
            imY,
            lineLength,
            lineAngle,
            x1,
            x2,
            y1,
            y2,
            centeredPov,
            params,
            i,
            len;

        var currentPov = svl.panoViewer.getPov();

        clear();

        // Get the full list of annotations, including those from previous states that should remain.
        var currAnnotations = state.annotations ? savedAnnotations.concat(state.annotations) : savedAnnotations;

        var blink_frequency_modifier = 0;
        for (i = 0, len = currAnnotations.length; i < len; i++) {
            if (currAnnotations[i].type === "arrow") {
                blink_frequency_modifier = blink_frequency_modifier + 1;
            }
        }

        for (const annotation of currAnnotations) {
            imX = annotation.x;
            imY = annotation.y;
            centeredPov = null;

            // Setting the original POV and mapping an image coordinate to a canvas coordinate.
            if (currentPov.heading < 180) {
                if (imX > svl.TUTORIAL_PANO_WIDTH - 3328 && imX > 3328) {
                    imX -= svl.TUTORIAL_PANO_WIDTH;
                }
            } else {
                if (imX < 3328 && imX < svl.TUTORIAL_PANO_WIDTH - 3328) {
                    imX += svl.TUTORIAL_PANO_WIDTH;
                }
            }
            centeredPov = util.pano.panoCoordToPov(imX, imY, svl.TUTORIAL_PANO_WIDTH, svl.TUTORIAL_PANO_HEIGHT);
            const canvasCoord = util.pano.centeredPovToCanvasCoord(
                centeredPov, currentPov, util.EXPLORE_CANVAS_WIDTH, util.EXPLORE_CANVAS_HEIGHT, svl.LABEL_ICON_RADIUS
            ) || { x: null, y: null };

            if (annotation.type === "arrow") {
                lineLength = annotation.length;
                lineAngle = annotation.angle;
                x2 = canvasCoord.x;
                y2 = canvasCoord.y;
                x1 = x2 - lineLength * Math.sin(util.math.toRadians(lineAngle));
                y1 = y2 - lineLength * Math.cos(util.math.toRadians(lineAngle));

                // The color of the arrow will by default alternate between white and the fill specified in annotation.
                params = {
                    lineWidth: 1,
                    fill: annotation.fill,
                    lineCap: 'round',
                    arrowWidth: 6,
                    strokeStyle: 'rgba(0, 0, 0, 1)'
                };

                if (annotation.fill == null || annotation.fill === "white") {
                    _drawArrow(x1, y1, x2, y2, params);
                }
                else {
                    _drawBlinkingArrow(x1, y1, x2, y2, params, blink_frequency_modifier);
                }
            } else if (annotation.type === "box") {
                lineAngle = annotation.angle;
                params = {
                    lineWidth: 4,
                    strokeStyle: 'rgba(255, 255, 255, 1)'
                };
                _drawBox(canvasCoord.x, canvasCoord.y, annotation.width, annotation.height, params);
            } else if (annotation.type === "label") {
                _drawStaticLabel(annotation.labelType, canvasCoord.x, canvasCoord.y);
                // The first time we draw the label, create the marker on the minimap.
                if (!annotation.firstDraw) {
                    var googleMarker = Label.createMinimapMarker(annotation.labelType, { lat: annotation.lat, lng: annotation.lng });
                    googleMarker.setMap(svl.minimap.getMap());
                    annotation.firstDraw = true;
                }
            }
        }

        // Save any annotations that should be sticking around.
        savedAnnotations = currAnnotations.filter(a => a.keepUntil && a.keepUntil !== state.id);
    }

    function getState(stateId) {
        return states.find(state => state.id === stateId);
    }

    /**
     * Hide the message box.
     */
    function hideMessage() {
        if (uiOnboarding.messageHolder.is(":visible")) uiOnboarding.messageHolder.hide();
    }

    /**
     * Transition to the next state.
     * @param nextState
     * @param params Optional parameters that might be used by transition function.
     */
    function next(nextState, params) {
        if (typeof nextState === "function") {
            _visit(getState(nextState.call(this, params)));
        } else if (states.find(state => state.id === nextState)) {
            _visit(getState(nextState));
        } else {
            _visit(null);
        }
    }

    /**
     * Show a message box.
     * @param parameters
     */
    function showMessage(parameters) {
        var message = parameters.message;
        // Make the message flash yellow once to catch your attention.
        uiOnboarding.messageHolder.toggleClass("yellow-background");
        setTimeout(function () {
            uiOnboarding.messageHolder.toggleClass("yellow-background");
        }, 100);

        uiOnboarding.messageHolder.css({
            top: 0,
            left: 0,
            width: 300
        });

        uiOnboarding.messageHolder.removeClass("animated fadeIn fadeInLeft fadeInRight fadeInDown fadeInUp");
        uiOnboarding.messageHolder.removeClass("callout top bottom left right lower-right");

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

            if ("arrow" in parameters) {
                uiOnboarding.messageHolder.addClass("callout " + parameters.arrow);
            }

            if ("fade-direction" in parameters) {
                uiOnboarding.messageHolder.addClass("animated " + parameters["fade-direction"]);
            }

            if ("transform" in parameters) {
                uiOnboarding.messageHolder.css("transform", parameters.transform);
            } else {
                uiOnboarding.messageHolder.css("transform", "None");
            }
        }

        uiOnboarding.messageHolder.html((typeof message === "function" ? message() : message));
    }

    function _endTheOnboarding(skip) {
        var mapStyleOptions = [
            {
                featureType: "all",
                stylers: [
                    { visibility: "off" }
                ]
            },
            {
                featureType: "road",
                stylers: [
                    { visibility: "on" }
                ]
            },
            {
                "elementType": "labels",
                "stylers": [
                    { "visibility": "off" }
                ]
            }
        ];
        if (map) map.setOptions({styles: mapStyleOptions});
        map.setOptions({styles: mapStyleOptions});
        if (skip) {
            tracker.push("Onboarding_Skip");
            missionContainer.getCurrentMission().setProperty("skipped", true);
        }
        tracker.push('Onboarding_End');
        missionContainer.getCurrentMission().setProperty("isComplete", true);

        // Makes sure all data has been submitted to server, then refreshes the page.
        svl.form.submitData().then(function() {
            window.location.replace('/explore');
        });
    }

    function _onboardingStateAnnotationExists(state) {
        return "annotations" in state && state.annotations;
    }

    function _onboardingStateMessageExists(state) {
        return "message" in state && state.message;
    }

    function getCurrentLabelState() {
        return currentLabelState;
    }

    function blinkInterface(state) {
        // Blink parts of the interface.
        if ("blinks" in state.properties && state.properties.blinks) {
            var len = state.properties.blinks.length;
            for (var i = 0; i < len; i++) {
                switch (state.properties.blinks[i]) {
                    case "minimap":
                        svl.minimap.blinkMinimap();
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
                    case "sound":
                        audioEffect.blink();
                        break;
                    case "stuck":
                        leftMenu.blinkStuckButton();
                        break;
                    case "feedback":
                        modalComment.blink();
                        break;
                    case "movement-arrow":
                        svl.panoManager.blinkNavigationArrows();
                        break;
                }
            }
        }
    }

    /**
     * Execute an instruction based on the current state.
     * @param state
     */
    function _visit(state) {
        // Update the progress bar (if the state marks progress in the tutorial) & log the transition to the new state.
        var stepNum = statesWithProgress.findIndex(s => s.id === state.id);
        if (stepNum !== -1 && !state.visited) {
            var completionRate = stepNum / statesWithProgress.length;
            svl.statusModel.setMissionCompletionRate(completionRate);
            svl.statusModel.setProgressBar(completionRate);
            tracker.push('Onboarding_Transition', { onboardingTransition: state.id, step: stepNum });
        } else {
            tracker.push('Onboarding_Transition', { onboardingTransition: state.id });
        }
        state.visited = true;

        var annotationListener;

        clear(); // Clear whatever was rendered on the onboarding-canvas in the previous state.
        _removeFlashingFromArrow();

        // End the onboarding if there is no transition state is specified. Move to the actual task
        if ("end-onboarding" in state) {
            _endTheOnboarding(state["end-onboarding"]["skip"]);
            return;
        } else {
            hideMessage();
        }

        // Show user a message box.
        if (_onboardingStateMessageExists(state)) {
            showMessage(state.message);
        }

        // Draw arrows to annotate target accessibility attributes
        if (_onboardingStateAnnotationExists(state) || savedAnnotations.length > 0) {
            _drawAnnotations(state);
            annotationListener = google.maps.event.addListener(svl.panoViewer.gsvPano, "pov_changed", function () {
                // Stop the animation for the blinking arrows.
                _removeFlashingFromArrow();
                _drawAnnotations(state);
            });
        }

        // Change behavior based on the current state.
        if ("properties" in state) {
            // Remove blinking if necessary.
            if (state.properties.stopBlinking) {
                _stopAllBlinking();
            }

            if (state.properties.constructor === Array) {
                // Restrict panning.
                svl.panoManager.setHeadingRange({ min: state.properties[0].minHeading, max: state.properties[0].maxHeading });

                // Ideally we need a for loop that goes through every element of the property array and calls the
                // corresponding action's handler. Not just the label accessibility attribute's handler.
                if (state.properties[0].action === "LabelAccessibilityAttribute") {
                    _visitLabelAccessibilityAttributeState(state, annotationListener);
                }
            }
            else {
                // Restrict panning.
                svl.panoManager.setHeadingRange({ min: state.properties.minHeading, max: state.properties.maxHeading });
                if (state.properties.action === "Introduction") {
                    _visitIntroduction(state, annotationListener);
                } else if (state.properties.action === "SelectLabelType" || state.properties.action === "RedoSelectLabelType") {
                    _visitSelectLabelTypeState(state, annotationListener);
                } else if (state.properties.action === "DeleteAccessibilityAttribute") {
                    _visitDeleteAccessibilityAttributeState(state, annotationListener);
                    contextMenu.hide();
                } else if (state.properties.action === "Zoom") {
                    _visitZoomState(state, annotationListener);
                } else if (state.properties.action === "RateSeverity" || state.properties.action === "RedoRateSeverity") {
                    _visitRateSeverity(state, annotationListener);
                } else if (state.properties.action === "AddTag" || state.properties.action === "RedoAddTag") {
                    _visitAddTag(state, annotationListener);
                } else if (state.properties.action === "AdjustHeadingAngle") {
                    _visitAdjustHeadingAngle(state, annotationListener);
                } else if (state.properties.action === "WalkTowards") {
                    _visitWalkTowards(state, annotationListener);
                } else if (state.properties.action === "Instruction") {
                    _visitInstruction(state, annotationListener);
                }
            }
        }
    }

    function _visitIntroduction(state, listener) {
        // When user clicks "Let's get started!" to start the tutorial, we set the pano's POV and move to next state.
        const $target = $("#onboarding-message-holder").find(".onboarding-transition-trigger");
        $(".onboarding-transition-trigger").css({ 'cursor': 'pointer' });
        function callback () {
            if (listener) google.maps.event.removeListener(listener);
            $target.off("click", callback);
            svl.panoManager.setPov({
                heading: state.properties.heading,
                pitch: state.properties.pitch,
                zoom: state.properties.zoom
            });
            next.call(this, state.transition);
        }

        $target.on("click", callback);
    }

    /**
     * Called when the user is told to click on the compass or nav arrows to move to the next image.
     * @param state The current state defined in OnboardingStates.js
     * @param listener An optional listener on a Google Maps event, to be removed before moving to the next state
     * @private
     */
    function _visitWalkTowards(state, listener) {
        const nextPanoId = 'afterWalkTutorial';

        // Add a link to the second pano so that the user can click on it.
        svl.panoManager.unlockShowingNavArrows();
        svl.panoManager.showNavArrows();

        // A callback to disable walking after user has moved to 2nd pano, then moves to next state.
        const callback = function () {
            navigationService.unlockDisableWalking().disableWalking().lockDisableWalking();
            svl.ui.compass.messageHolder.off('click', clickToNextPano);
            svl.ui.compass.messageHolder.css('cursor', 'default');
            svl.panoManager.lockShowingNavArrows();
            svl.ui.streetview.navArrows.off('click', callback);
            if (listener) google.maps.event.removeListener(listener);
            next(state.transition);
        };

        // Replace default behavior when clicking on the navigation message/arrows to move to the next pano.
        const clickToNextPano = function() {
            navigationService.moveToPano(nextPanoId, true).then(callback);
        }

        navigationService.unlockDisableWalking().enableWalking().lockDisableWalking();
        svl.ui.streetview.navArrows.off('click').on('click', clickToNextPano);
        svl.ui.compass.messageHolder.on('click', clickToNextPano);
        svl.ui.compass.messageHolder.css('cursor', 'pointer');

        blinkInterface(state);
    }

    function _visitAdjustHeadingAngle(state, listener) {
        var $target;
        var interval;
        interval = handAnimation.showGrabAndDragAnimation({direction: "left-to-right"});

        var callback = function () {
            var pov = svl.panoViewer.getPov();
            // Note that the tolerance is only a tolerance to the left. Must hit at least the given heading to proceed.
            if ((360 + state.properties.heading - pov.heading) % 360 < state.properties.tolerance) {
                google.maps.event.removeListener($target);
                if (listener) google.maps.event.removeListener(listener);
                handAnimation.hideGrabAndDragAnimation(interval);
                next(state.transition);
            }
        };

        $target = google.maps.event.addListener(svl.panoViewer.gsvPano, "pov_changed", callback);
    }

    function _visitRateSeverity(state, listener) {
        contextMenu.enableRatingSeverityForTutorialLabel(state.properties.labelNumber);
        var $target = svl.ui.contextMenu.radioButtons;
        var callback = function () {
            if (listener) google.maps.event.removeListener(listener);
            $target.off("click", callback);
            contextMenu.disableRatingSeverity();
            next.call(this, state.transition);
        };
        $target.on("click", callback);
    }
    function _visitAddTag(state, listener) {
        contextMenu.enableTaggingForTutorialLabel(state.properties.labelNumber);
        var $target = svl.ui.contextMenu.tagHolder; // Grab tag holder so we can add an event listener.
        var callback = function () {
            if (listener) google.maps.event.removeListener(listener);
            $target.off("tagIds-updated", callback);
            contextMenu.disableTagging();
            next.call(contextMenu.getTargetLabel(), state.transition);
        };
        // We use a custom event here to ensure that this is triggered after the tags have been updated.
        $target.on("tagIds-updated", callback);
    }

    function _visitInstruction(state, listener) {
        if (state === getState("outro")) {
            $("#mini-footer-audit").css("visibility", "hidden");
            // Remove listeners that alter instruction z-index, and make sure z-index is higher than mini-map.
            svl.ui.contextMenu.holder.off('mouseover mouseout');
            uiOnboarding.messageHolder.css('z-index', 3);
        }
        blinkInterface(state);

        if (!("okButton" in state) || state.okButton) {
            // Insert an ok button.
            var okButtonText = 'OK';
            if (state.okButtonText) {
                okButtonText = state.okButtonText;
            }
            uiOnboarding.messageHolder.append("<br/><button id='onboarding-ok-button' class='button width-50'>" +
                okButtonText + "</button>");
        }

        var $target = $("#onboarding-ok-button");
        var callback = function () {
            if (listener) google.maps.event.removeListener(listener);
            $target.off("click", callback);
            if ("blinks" in state.properties && state.properties.blinks) {
                _stopAllBlinking();
            }
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

        if (state === getState("select-label-type-1")) {
            $("#mini-footer-audit").css("visibility", "visible");
        }
        ribbon.enableMode(labelType);
        ribbon.startBlinking(labelType);

        // To handle when user presses ESC - disable mode only when the user places the label.
        _mouseDownCanvasDrawingHandler = function () {
            ribbon.disableMode(labelType);
        };

        var callback = function () {
            ribbon.enableMode("Walk");

            // Disable only when the user places the label
            uiCanvas.drawingLayer.on("mousedown", _mouseDownCanvasDrawingHandler);

            ribbon.stopBlinking();
            $(document).off('ModeSwitch_' + labelType, callback);
            if (listener) google.maps.event.removeListener(listener);
            next(state.transition);
        };

        $(document).on('ModeSwitch_' + labelType, callback);
    }

    /**
     * Tell the user to zoom in/out.
     * @param state
     * @param listener
     * @private
     */
    function _visitZoomState(state, listener) {
        var zoomType = state.properties.type;
        var event;

        if (zoomType === "in") {
            event = 'ZoomIn';
            zoomControl.blinkZoomIn();
            zoomControl.unlockDisableZoomIn();
            zoomControl.enableZoomIn();
            zoomControl.lockDisableZoomIn();

        } else {
            event = 'ZoomOut';
            zoomControl.blinkZoomOut();

            // Enable zoom-out
            zoomControl.unlockDisableZoomOut();
            zoomControl.enableZoomOut();
            zoomControl.lockDisableZoomOut();
        }

        var callback = function () {
            zoomControl.stopBlinking();
            if (zoomType === "in") {
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
            $(document).off(event, callback);

            if (listener) google.maps.event.removeListener(listener);
            next(state.transition);
        };

        $(document).on(event, callback);
    }

    /**
     * Tell the user to label the multiple possible target attributes.
     * @param state
     * @param listener
     * @private
     */
    function _visitLabelAccessibilityAttributeState(state, listener) {
        const properties = state.properties[0];
        const transition = state.transition;

        // Add an event that fires when a label is added and checks if the label was placed in the right spot.
        function _tutorialLabelListener(event) {
            if (listener) google.maps.event.removeListener(listener);

            const label = event.detail.label;
            const panoX = label.getProperty('panoXY').x * svl.TUTORIAL_PANO_SCALE_FACTOR;
            const panoY = label.getProperty('panoXY').y * svl.TUTORIAL_PANO_SCALE_FACTOR;
            const imageX = properties.imageX;
            const imageY = properties.imageY;
            const tolerance = properties.tolerance;

            const distance = (imageX - panoX) * (imageX - panoX) + (imageY - panoY) * (imageY - panoY);
            currentLabelState = state;

            // If the label was placed close enough to the target, move on to the next state.
            if (distance < tolerance * tolerance) {
                label.setProperty('tutorialLabelNumber', properties.labelNumber);

                // Disable deleting of label.
                canvas.unlockDisableLabelDelete();
                canvas.disableLabelDelete();
                canvas.lockDisableLabelDelete();

                // Disable labeling mode.
                ribbon.disableMode(label.getLabelType());
                ribbon.enableMode("Walk");
                uiCanvas.drawingLayer.off("mousedown", _mouseDownCanvasDrawingHandler);

                next(transition[0], { accurate: true });
            } else {
                next(transition[0], { accurate: false });
            }
        }
        document.addEventListener('addTutorialLabel', _tutorialLabelListener, { once: true });
    }

    /**
     * Tell the user to delete the label they placed that is far away from where they were supposed to place it.
     *
     * @param state
     * @param listener
     * @private
     */
    function _visitDeleteAccessibilityAttributeState(state, listener) {
        ribbon.disableMode(state.properties.labelType);
        ribbon.enableMode("Walk");
        canvas.unlockDisableLabelDelete();
        canvas.enableLabelDelete();
        canvas.lockDisableLabelDelete();

        // Callback for deleted label.
        var deleteLabelCallback = function () {
            if (listener) google.maps.event.removeListener(listener);
            $(document).off('RemoveLabel', deleteLabelCallback);
            clear();
            _removeFlashingFromArrow(); // TODO remove this if it turns out that we don't need it.
            next(state.transition);
        };
        $(document).on('RemoveLabel', deleteLabelCallback);
    }

    /**
     * Reset the id of the label that the user most recently added.
     *
     * @param labelId
     * @public
     */
    function setCurrentLabelId(labelId) {
        currentLabelId = labelId;
    }

    /**
     * Return the id of the label that the user most recently added.
     *
     * @public
     */
    function getCurrentLabelId() {
        return currentLabelId;
    }

    self.clear = clear;
    self.next = next;
    self.setCurrentLabelId = setCurrentLabelId;
    self.getCurrentLabelId = getCurrentLabelId;
}
