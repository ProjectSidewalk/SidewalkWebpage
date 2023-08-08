/**
 * Canvas Module.
 * @param ribbon
 * @returns {{className: string}}
 * @constructor
 */
function Canvas(ribbon) {
    var self = { className: 'Canvas' };

    // Mouse status and mouse event callback functions.
    var mouseStatus = {
        currX: 0,
        currY: 0,
        prevX: 0,
        prevY: 0,
        leftDownX: 0,
        leftDownY: 0,
        leftUpX: 0,
        leftUpY: 0,
        isLeftDown: false,
        prevMouseDownTime: 0,
        prevMouseUpTime: 0
    };

    var status = {
        currentLabel: null,
        disableLabelDelete: false,
        disableLabeling: false,
        lockDisableLabelDelete: false,
    };

    // Canvas context.
    var canvasProperties = { 'height': 0, 'width': 0 };
    var ctx;

    /**
     * Initialization: set up the canvas context and attach listeners to DOM elements.
     */
    function _init() {
        // Set up the canvas context.
        var el = document.getElementById("label-canvas");
        if (!el) {
            return false;
        }
        ctx = el.getContext('2d');
        canvasProperties.width = el.width;
        canvasProperties.height = el.height;

        // Attach listeners to dom elements.
        if (svl.ui.canvas.drawingLayer) {
            svl.ui.canvas.drawingLayer.bind('mousedown', handleDrawingLayerMouseDown);
            svl.ui.canvas.drawingLayer.bind('mouseup', handleDrawingLayerMouseUp);
            svl.ui.canvas.drawingLayer.bind('mousemove', handleDrawingLayerMouseMove);
            $("#interaction-area-holder").on('mouseleave', handleDrawingLayerMouseOut);
        }
        if (svl.ui.canvas.deleteIcon) {
            svl.ui.canvas.deleteIcon.bind("click", labelDeleteIconClick);
        }
    }

    /**
     * Create a label at the given X/Y canvas coordinate.
     */
    function createLabel(canvasX, canvasY) {
        // Generate some metadata for the new label.
        var labelType = ribbon.getStatus('selectedLabelType');
        var pov = svl.map.getPov();
        var povOfLabel = util.panomarker.calculatePovIfCentered(
            pov, canvasX, canvasY, util.EXPLORE_CANVAS_WIDTH, util.EXPLORE_CANVAS_HEIGHT
        );
        let rerenderCanvasCoord = util.panomarker.getCanvasCoordinate(
            povOfLabel, pov, util.EXPLORE_CANVAS_WIDTH, util.EXPLORE_CANVAS_HEIGHT, svl.LABEL_ICON_RADIUS
        );
        var param = {
            tutorial: svl.missionContainer.getCurrentMission().getProperty("missionType") === "auditOnboarding",
            auditTaskId: svl.taskContainer.getCurrentTask().getAuditTaskId(),
            labelType: labelType,
            originalCanvasXY: { x: canvasX, y: canvasY },
            currCanvasXY: rerenderCanvasCoord,
            povOfLabelIfCentered: povOfLabel,
            panoId: svl.map.getPanoId(),
            originalPov: pov
        };

        // Create the label and render the context menu.
        status.currentLabel = svl.labelContainer.createLabel(param, true);
        svl.contextMenu.show(status.currentLabel);

        // Log the labeling event.
        svl.tracker.push('LabelingCanvas_FinishLabeling', {
            labelType: labelType,
            canvasX: canvasX,
            canvasY: canvasY
        }, {
            temporaryLabelId: status.currentLabel.getProperty('temporaryLabelId')
        });

        // Play labeling sound effect.
        if ('audioEffect' in svl) {
            svl.audioEffect.play('drip');
        }

        ribbon.backToWalk();
    }

    /**
     * When mousing out of the canvas, stop trying to add a label type, switching back to Explore mode.
     */
    function handleDrawingLayerMouseOut(e) {
        svl.tracker.push('LabelingCanvas_MouseOut');
        if (!svl.isOnboarding())
            ribbon.backToWalk();
    }

    /**
     * Record locations of mouse-down event. Most functionality happens on mouse-up, but mouse-down context matters.
     */
    function handleDrawingLayerMouseDown(e) {
        mouseStatus.isLeftDown = true;
        mouseStatus.leftDownX = util.mouseposition(e, this).x;
        mouseStatus.leftDownY = util.mouseposition(e, this).y;
        mouseStatus.prevMouseDownTime = new Date().getTime();
        svl.tracker.push('LabelingCanvas_MouseDown', {x: mouseStatus.leftDownX, y: mouseStatus.leftDownY});
    }

    /**
     * Create a new label on mouse-up if we are in a labeling mode.
     */
    function handleDrawingLayerMouseUp(e) {
        var currTime = new Date().getTime();
        mouseStatus.isLeftDown = false;
        mouseStatus.leftUpX = util.mouseposition(e, this).x;
        mouseStatus.leftUpY = util.mouseposition(e, this).y;

        if (!status.disableLabeling && currTime - mouseStatus.prevMouseUpTime > 300) {
            createLabel(mouseStatus.leftUpX, mouseStatus.leftUpY);
            clear();
            setOnlyLabelsOnPanoAsVisible(svl.map.getPanoId());
            render();
        }

        svl.tracker.push('LabelingCanvas_MouseUp', { x: mouseStatus.leftUpX, y: mouseStatus.leftUpY });
        mouseStatus.prevMouseUpTime = new Date().getTime();
        mouseStatus.prevMouseDownTime = 0;
    }

    /**
     * Update the canvas based on a mouse-mouse event: changing cursor, re-rendering, etc.
     */
    function handleDrawingLayerMouseMove(e) {
        var mousePosition = mouseposition(e, this);
        mouseStatus.currX = mousePosition.x;
        mouseStatus.currY = mousePosition.y;

        // Change the cursor according to the label type.
        var iconImagePaths = util.misc.getIconImagePaths();
        var labelType = ribbon.getStatus('mode');
        if (labelType) {
            var iconImagePath = iconImagePaths[labelType].iconImagePath;
            var cursorUrl = "url(" + iconImagePath + ") 19 19, auto";
            // Need to reset the cursor first, otherwise Safari strangely doesn't update the cursor.
            $(this).css('cursor', '');
            $(this).css('cursor', cursorUrl);
        }
        clear();
        render();
        mouseStatus.prevX = mouseposition(e, this).x;
        mouseStatus.prevY = mouseposition(e, this).y;
    }

    /**
     * Delete a label. Called when a user clicks a label's delete icon.
     */
    function labelDeleteIconClick() {
        if (!status.disableLabelDelete) {
            var currLabel = self.getCurrentLabel();
            if (currLabel) {
                svl.tracker.push('Click_LabelDelete', { labelType: currLabel.getProperty('labelType') });
                svl.labelContainer.removeLabel(currLabel);
                svl.ui.canvas.deleteIconHolder.css('visibility', 'hidden');

                // On crowdstudy server, re-enable walking if the label is deleted.
                if (svl.cityId === 'seattle-wa' && PredictionModel.labelTypesToPredict.includes(currLabel.getLabelType())) {
                    svl.map.enableWalking();
                }
            }
        }
    }

    /**
     * Clear what's on the canvas.
     */
    function clear() {
        ctx.clearRect(0, 0, canvasProperties.width, canvasProperties.height);
        return this;
    }

    /**
     * Disables the use of delete buttons for labels. Used primarily in the tutorial.
     */
    function disableLabelDelete() {
        if (!status.lockDisableLabelDelete) {
            status.disableLabelDelete = true;
            return this;
        }
        return false;
    }

    function disableLabeling() {
        status.disableLabeling = true;
        return this;
    }

    function enableLabelDelete() {
        if (!status.lockDisableLabelDelete) {
            status.disableLabelDelete = false;
            return this;
        }
        return false;
    }

    function enableLabeling() {
        status.disableLabeling = false;
        return this;
    }

    /**
     * Returns the label that the mouse is over.
     */
    function getCurrentLabel() {
        return status.currentLabel;
    }

    function getStatus(key) {
        return status[key];
    }

    /**
     * This function takes cursor coordinates x and y on the canvas. Then returns an object right below the cursor.
     * If a cursor is not on anything, return false.
     */
    function onLabel(x, y) {
        var labels = svl.labelContainer.getCanvasLabels();
        var onLabel = false;

        // Check labels to see if they are under the mouse cursor.
        for (var i = 0; i < labels.length; i += 1) {
            onLabel = labels[i].isOn(x, y);
            if (onLabel) {
                status.currentLabel = labels[i];
                return labels[i];
            }
        }
        return false;
    }

    function lockDisableLabelDelete() {
        status.lockDisableLabelDelete = true;
        return this;
    }


    /**
     * Renders labels on the canvas.
     */
    function render() {
        if (!ctx) {
            return this;
        }
        var labels = svl.labelContainer.getCanvasLabels();
        var pov = svl.map.getPov();

        // Render labels.
        for (var i = 0; i < labels.length; i += 1) {
            labels[i].render(ctx, pov);
        }
        svl.map.getPovChangeStatus()["status"] = false;

        // Update the opacity of Zoom In and Zoom Out buttons.
        if (svl.zoomControl) svl.zoomControl.updateOpacity();
        return this;
    }

    function setCurrentLabel(label) {
        status.currentLabel = label;
    }

    function setStatus(key, value) {
        if (key in status) {
            status[key] = value;
        } else {
            throw self.className + ": Illegal status name.";
        }
    }

    /**
     * This function sets the passed label's hoverInfoVisibility to 'visible' and all the others to 'hidden'.
     * @param label
     */
    function showLabelHoverInfo(label) {
        var labels = svl.labelContainer.getCanvasLabels();
        for (var i = 0; i < labels.length; i += 1) {
            labels[i].setHoverInfoVisibility('hidden');
        }
        if (label) {
            // Show delete icon on label. If on the crowdstudy server, only do it for the label under context menu open.
            if (svl.cityId !== 'seattle-wa' && !svl.contextMenu.isOpen() || svl.contextMenu.getTargetLabel() === label) {
                label.setHoverInfoVisibility('visible');
            }
        } else {
            // All labels share one delete icon that gets moved around. So if not hovering over label, hide the button.
            svl.ui.canvas.deleteIconHolder.css('visibility', 'hidden');
        }

        self.clear();
        self.render();
    }

    function setVisibility(visibility) {
        var labels = svl.labelContainer.getCanvasLabels();
        for (var i = 0; i < labels.length; i += 1) {
            labels[i].setVisibility(visibility);
        }
        return this;
    }

    /**
     * Sets labels on the given pano as visible, all others as hidden.
     */
    function setOnlyLabelsOnPanoAsVisible(panoramaId) {
        var labels = svl.labelContainer.getCanvasLabels();
        for (var i = 0; i < labels.length; i += 1) {
            if (labels[i].getPanoId() === panoramaId && !labels[i].isDeleted()) {
                labels[i].setVisibility('visible');
            } else {
                labels[i].setVisibility('hidden');
            }
        }
    }

    function unlockDisableLabelDelete() {
        status.lockDisableLabelDelete = false;
        return this;
    }

    _init();

    // Put public methods to self and return them.
    self.clear = clear;
    self.disableLabelDelete = disableLabelDelete;
    self.disableLabeling = disableLabeling;
    self.enableLabelDelete = enableLabelDelete;
    self.enableLabeling = enableLabeling;
    self.getCurrentLabel = getCurrentLabel;
    self.getStatus = getStatus;
    self.onLabel = onLabel;
    self.lockDisableLabelDelete = lockDisableLabelDelete;
    self.render = render;
    self.setCurrentLabel = setCurrentLabel;
    self.setStatus = setStatus;
    self.showLabelHoverInfo = showLabelHoverInfo;
    self.setVisibility = setVisibility;
    self.setOnlyLabelsOnPanoAsVisible = setOnlyLabelsOnPanoAsVisible;
    self.unlockDisableLabelDelete = unlockDisableLabelDelete;

    return self;
}
