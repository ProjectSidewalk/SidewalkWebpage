/**
 * Canvas Module.
 * @param ribbon
 * @returns {{className: string}}
 * @constructor
 */
function Canvas(ribbon) {
    let self = { className: 'Canvas' };

    let status = {
        currentLabel: null,
        disableLabelDelete: false,
        disableLabeling: false,
        lockDisableLabelDelete: false,
    };

    // Mouse status and mouse event callback functions
    let mouseStatus = {
        prevX: 0,
        prevY: 0,
        isLeftDown: false
    };

    // Canvas context.
    let canvasProperties = { 'height': 0, 'width': 0 };
    let ctx;

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

        // Attach listeners to dom elements. view-control-layer handles panning, drawing-layer handles adding labels.
        svl.ui.canvas.drawingLayer.bind('mousedown', _handleDrawingLayerMouseDown);
        svl.ui.canvas.drawingLayer.bind('mouseup', _handleDrawingLayerMouseUp);
        svl.ui.canvas.drawingLayer.bind('mousemove', _handleDrawingLayerMouseMove);
        $("#interaction-area-holder").on('mouseleave', _handleDrawingLayerMouseOut);
        svl.ui.canvas.deleteIcon.bind("click", _labelDeleteIconClick);
        svl.ui.streetview.viewControlLayer.bind('mousedown', _handlerViewControlLayerMouseDown);
        svl.ui.streetview.viewControlLayer.bind('mouseup', _handlerViewControlLayerMouseUp);
        svl.ui.streetview.viewControlLayer.bind('mousemove', _handlerViewControlLayerMouseMove);
        svl.ui.streetview.viewControlLayer.bind('mouseleave', _handlerViewControlLayerMouseLeave);
        svl.ui.streetview.viewControlLayer[0].onselectstart = function () { return false; };
    }

    /**
     * Create a label at the given X/Y canvas coordinate.
     */
    function createLabel(canvasX, canvasY) {
        // Generate some metadata for the new label.
        const labelType = ribbon.getStatus('selectedLabelType');
        const pov = svl.panoViewer.getPov();
        const povOfLabel = util.pano.canvasCoordToCenteredPov(
            pov, canvasX, canvasY, util.EXPLORE_CANVAS_WIDTH, util.EXPLORE_CANVAS_HEIGHT
        );
        const rerenderCanvasCoord = util.pano.centeredPovToCanvasCoord(
            povOfLabel, pov, util.EXPLORE_CANVAS_WIDTH, util.EXPLORE_CANVAS_HEIGHT, svl.LABEL_ICON_RADIUS
        );
        const param = {
            tutorial: svl.missionContainer.getCurrentMission().getProperty("missionType") === "auditOnboarding",
            auditTaskId: svl.taskContainer.getCurrentTask().getAuditTaskId(),
            labelType: labelType,
            originalCanvasXY: { x: canvasX, y: canvasY },
            currCanvasXY: rerenderCanvasCoord,
            povOfLabelIfCentered: povOfLabel,
            panoId: svl.panoViewer.getPanoId(),
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

        // If in the tutorial, send an event to the onboarding module.
        if (svl.onboarding) {
            const customEvent = new CustomEvent('addTutorialLabel', {
                detail: { label: status.currentLabel }
            });
            document.dispatchEvent(customEvent);
        }

        // Wait for the crop to be saved before switching back to walk mode.
        // We are hiding the 'road labels' in the labeling mode as we don't want them to show in the crop.
        // So we need to ensure we don't switch back to explore mode until the crop is saved.
        // Trying to keep the timeout as low as possible to avoid any delay in switching back to walk mode for now.
        // Can try increasing it if we save crops with the road labels.
        setTimeout(function() {
            ribbon.backToWalk();
        }, 20);
    }

    function _setViewControlLayerCursor(type) {
        switch(type) {
            case 'OpenHand':
                svl.ui.streetview.viewControlLayer.css("cursor", "url(" + svl.rootDirectory + "img/cursors/openhand.cur) 4 4, move");
                break;
            case 'ClosedHand':
                svl.ui.streetview.viewControlLayer.css("cursor", "url(" + svl.rootDirectory + "img/cursors/closedhand.cur) 4 4, move");
                break;
            case 'Pointer':
                svl.ui.streetview.viewControlLayer.css("cursor", "pointer");
                break;
            default:
                svl.ui.streetview.viewControlLayer.css("cursor", "default");
        }
    }

    /**
     * Callback that is fired with the mousedown event on the view control layer (where you control street view angle).
     * @param e
     */
    function _handlerViewControlLayerMouseDown(e) {
        const currMousePosition = util.mouseposition(e, this);
        mouseStatus.isLeftDown = true;
        svl.tracker.push('ViewControl_MouseDown', currMousePosition);
        _setViewControlLayerCursor('ClosedHand');
    }

    /**
     * Callback on mouse up event on the view control layer (where you change the Google Street view angle).
     * @param e
     */
    function _handlerViewControlLayerMouseUp(e) {
        const currMousePosition = util.mouseposition(e, this);
        mouseStatus.isLeftDown = false;
        svl.tracker.push('ViewControl_MouseUp', currMousePosition);
        const currTime = new Date();

        const selectedLabel = onLabel(currMousePosition.x, currMousePosition.y);
        if (selectedLabel && selectedLabel.className === "Label") {
            setCurrentLabel(selectedLabel);
            _setViewControlLayerCursor('Pointer');

            if ('contextMenu' in svl) {
                if (status.contextMenuWasOpen) {
                    svl.contextMenu.hide();
                } else {
                    svl.contextMenu.show(selectedLabel);
                }
                status.contextMenuWasOpen = false;
            }
        } else {
            _setViewControlLayerCursor('OpenHand');
            if (currTime - mouseStatus.prevMouseUpTime < 300) {
                // Continue logging double click. We don't have any features for it now, but it's good to know how
                // frequently people are trying to double-click. They might be trying to zoom?
                svl.tracker.push('ViewControl_DoubleClick');
            }
        }
        mouseStatus.prevMouseUpTime = currTime;
    }

    function _handlerViewControlLayerMouseLeave(e) {
        _setViewControlLayerCursor('OpenHand');
        mouseStatus.isLeftDown = false;
    }

    /**
     * Callback that is fired when a user moves a mouse on the view control layer where you change the pov.
     */
    function _handlerViewControlLayerMouseMove(e) {
        const currMousePosition = util.mouseposition(e, this);

        var item = onLabel(currMousePosition.x, currMousePosition.y);
        if (mouseStatus.isLeftDown && svl.panoManager.getStatus('disablePanning') === false) {
            // If a mouse is being dragged on the control layer, move the pano.
            const pov = svl.panoViewer.getPov();
            const zoomScaling = Math.pow(2, pov.zoom);
            const dx = (currMousePosition.x - mouseStatus.prevX) / zoomScaling;
            const dy = (currMousePosition.y - mouseStatus.prevY) / zoomScaling;
            svl.panoManager.updatePov(dx, dy);
            _setViewControlLayerCursor('ClosedHand');
        } else if (item && item.className === "Label") {
            // Show label delete menu and update cursor when hovering over a label.
            _setViewControlLayerCursor('Pointer');
            var selectedLabel = item;
            setCurrentLabel(selectedLabel);
            showLabelHoverInfo(selectedLabel);
            self.clear().render();
        } else {
            _setViewControlLayerCursor('OpenHand');
            showLabelHoverInfo(undefined);
            setCurrentLabel(undefined);
        }

        mouseStatus.prevX = currMousePosition.x;
        mouseStatus.prevY = currMousePosition.y;
    }
    /**
     * When mousing out of the canvas, stop trying to add a label type, switching back to Explore mode.
     */
    function _handleDrawingLayerMouseOut(e) {
        svl.tracker.push('LabelingCanvas_MouseOut');
        if (!svl.isOnboarding())
            ribbon.backToWalk();
    }

    /**
     * Record locations of mouse-down event. Most functionality happens on mouse-up, but mouse-down context matters.
     */
    function _handleDrawingLayerMouseDown(e) {
        svl.tracker.push('LabelingCanvas_MouseDown', util.mouseposition(e, this));
    }

    /**
     * Create a new label on mouse-up if we are in a labeling mode.
     */
    function _handleDrawingLayerMouseUp(e) {
        const currMousePosition = util.mouseposition(e, this);

        if (!status.disableLabeling) {
            createLabel(currMousePosition.x, currMousePosition.y);
            clear();
            setOnlyLabelsOnPanoAsVisible(svl.panoViewer.getPanoId());
            render();
        }

        svl.tracker.push('LabelingCanvas_MouseUp', currMousePosition);
        svl.form.submitData();
    }

    /**
     * Update the canvas based on a mouse-mouse event: changing cursor, re-rendering, etc.
     */
    function _handleDrawingLayerMouseMove(e) {
        // Change the cursor according to the label type.
        const iconImagePaths = util.misc.getIconImagePaths();
        const labelType = ribbon.getStatus('mode');
        if (labelType) {
            // Need to reset the cursor first, otherwise Safari strangely doesn't update the cursor.
            $(this).css('cursor', '');
            $(this).css('cursor', `url(${iconImagePaths[labelType].iconImagePath}) 19 19, auto`);
        }
        clear();
        render();
    }

    /**
     * Delete a label. Called when a user clicks a label's delete icon.
     * @private
     */
    function _labelDeleteIconClick() {
        if (!status.disableLabelDelete) {
            var currLabel = self.getCurrentLabel();
            // If in tutorial, only delete if it's the last label that the user added to the canvas.
            if (currLabel && (!svl.onboarding || svl.onboarding.getCurrentLabelId() === currLabel.getProperty("temporaryLabelId"))) {
                svl.tracker.push('Click_LabelDelete', { labelType: currLabel.getProperty('labelType') });
                svl.labelContainer.removeLabel(currLabel);
                svl.ui.canvas.deleteIconHolder.css('visibility', 'hidden');
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
        var pov = svl.panoViewer.getPov();

        // Render labels.
        for (var i = 0; i < labels.length; i += 1) {
            labels[i].render(ctx, pov);
        }
        svl.panoManager.getPovChangeStatus()["status"] = false;

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

        // Show delete icon on label.
        if (label) {
            label.setHoverInfoVisibility('visible');
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
    function setOnlyLabelsOnPanoAsVisible(panoId) {
        var labels = svl.labelContainer.getCanvasLabels();
        for (var i = 0; i < labels.length; i += 1) {
            if (labels[i].getPanoId() === panoId && !labels[i].isDeleted()) {
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

    // Saves a screenshot of the canvas when the label was placed, to be uploaded to the server later.
    function saveCanvasScreenshot(label) {
        // If there is no label to associate this crop with, don't save the crop.
        if (!label) {
            console.log('No label found when making a crop.');
            return;
        }

        // Save a high-res version of the image to the label object. Uploaded after label is saved to the db.
        const newCrop = $(`.${svl.panoViewer.getCanvasClass()}`)[0].toDataURL('image/jpeg', 1);
        label.setProperty('crop', newCrop);
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
    self.saveCanvasScreenshot = saveCanvasScreenshot;

    return self;
}
