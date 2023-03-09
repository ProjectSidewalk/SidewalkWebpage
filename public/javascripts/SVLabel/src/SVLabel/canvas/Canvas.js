/**
 * Canvas Module.
 * @param ribbon
 * @returns {{className: string}}
 * @constructor
 */
function Canvas(ribbon) {
    var self = {className: 'Canvas'};

    // Mouse status and mouse event callback functions
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
        disableLabelEdit: false,
        disableLabeling: false,
        disableWalking: false,

        lockCurrentLabel: false,
        lockDisableLabelDelete: false,
        lockDisableLabelEdit: false,
        lockDisableLabeling: false,
        'visibilityMenu': 'hidden'
    };

    // Canvas context
    var canvasProperties = {'height': 0, 'width': 0};
    var ctx;

    // Initialization
    function _init() {
        var el = document.getElementById("label-canvas");
        if (!el) {
            return false;
        }
        ctx = el.getContext('2d');
        canvasProperties.width = el.width;
        canvasProperties.height = el.height;

        // Attach listeners to dom elements
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
     * Finish up labeling.
     * Clean this method when I get a chance.....
     */
    function createLabel(canvasX, canvasY) {
        var labelType = ribbon.getStatus('selectedLabelType');
        var labelColor = util.misc.getLabelColors()[labelType];
        var labelDescription = util.misc.getLabelDescriptions(labelType);

        var pov = svl.map.getPov();
        var povOfLabel = util.panomarker.calculatePointPov(pov, canvasX, canvasY, svl.CANVAS_WIDTH, svl.CANVAS_HEIGHT);

        var latlng = svl.map.getPosition();
        var param = {
            tutorial: svl.missionContainer.getCurrentMission().getProperty("missionType") === "auditOnboarding",
            auditTaskId: svl.taskContainer.getCurrentTask().getAuditTaskId(),
            labelType: labelDescription.id,
            labelDescription: labelDescription.text,
            originalCanvasCoordinate: { x: canvasX, y: canvasY },
            canvasCoordinate: { x: canvasX, y: canvasY },
            originalPov: povOfLabel,
            panoId: svl.map.getPanoId(),
            panoramaLat: latlng.lat,
            panoramaLng: latlng.lng,
            panoramaHeading: pov.heading,
            panoramaPitch: pov.pitch,
            panoramaZoom: parseInt(pov.zoom, 10)
        };
        if (("panorama" in svl) && ("getPhotographerPov" in svl.panorama)) {
            var photographerPov = svl.panorama.getPhotographerPov();
            param.photographerHeading = photographerPov.heading;
            param.photographerPitch = photographerPov.pitch;
        }

        status.currentLabel = svl.labelContainer.createLabel(param);
        svl.labelContainer.push(status.currentLabel);


        if ('contextMenu' in svl) {
            svl.contextMenu.show(canvasX, canvasY, {
                targetLabel: status.currentLabel,
                targetLabelColor: labelColor.fillStyle
            });
        }

        svl.tracker.push('LabelingCanvas_FinishLabeling', {
            labelType: labelDescription.id,
            canvasX: canvasX,
            canvasY: canvasY
        }, {
            temporaryLabelId: status.currentLabel.getProperty('temporaryLabelId')
        });

        // Sound effect.
        if ('audioEffect' in svl) {
            svl.audioEffect.play('drip');
        }

        ribbon.backToWalk();
    }

    function handleDrawingLayerMouseOut(e) {
        svl.tracker.push('LabelingCanvas_MouseOut');
        if (!svl.isOnboarding() && !_mouseIsOverAnOverlayLink(e) && !_mouseIsOverAnOverlayMessageBox(e)) {
            ribbon.backToWalk();
        }
    }

    /**
     * Reference
     * http://stackoverflow.com/questions/8813051/determine-which-element-the-mouse-pointer-is-on-top-of-in-javascript
     * @param e
     * @private
     */
    function _mouseIsOverAnOverlayLink(e) {
        var x = e.clientX, y = e.clientY;
        var elementMouseIsOver = document.elementFromPoint(x, y);
        return $(elementMouseIsOver).text() == i18next.t('top-ui.instruction.explain');
    }

    function _mouseIsOverAnOverlayMessageBox(e) {
        var x = e.clientX, y = e.clientY;
        var elementMouseIsOver = document.elementFromPoint(x, y);
        return $(elementMouseIsOver).attr("id") == "overlay-message-box";
    }

    /**
     * This function is fired when at the time of mouse-down
     * @param e
     */
    function handleDrawingLayerMouseDown(e) {
        mouseStatus.isLeftDown = true;
        mouseStatus.leftDownX = util.mouseposition(e, this).x;
        mouseStatus.leftDownY = util.mouseposition(e, this).y;

        svl.tracker.push('LabelingCanvas_MouseDown', {x: mouseStatus.leftDownX, y: mouseStatus.leftDownY});

        mouseStatus.prevMouseDownTime = new Date().getTime();
    }

    /**
     * This function is fired at the time of mouse-up.
     */
    function handleDrawingLayerMouseUp(e) {
        var currTime;

        mouseStatus.isLeftDown = false;
        mouseStatus.leftUpX = util.mouseposition(e, this).x;
        mouseStatus.leftUpY = util.mouseposition(e, this).y;

        currTime = new Date().getTime();

        if (!status.disableLabeling && currTime - mouseStatus.prevMouseUpTime > 300) {
            createLabel(mouseStatus.leftUpX, mouseStatus.leftUpY);
            clear();
            setVisibilityBasedOnLocation('visible', svl.map.getPanoId());
            render();
        }

        svl.tracker.push('LabelingCanvas_MouseUp', { x: mouseStatus.leftUpX, y: mouseStatus.leftUpY });
        mouseStatus.prevMouseUpTime = new Date().getTime();
        mouseStatus.prevMouseDownTime = 0;
    }

    /**
     * This function is fired when mouse cursor moves over the drawing layer.
     */
    function handleDrawingLayerMouseMove(e) {
        var mousePosition = mouseposition(e, this);
        mouseStatus.currX = mousePosition.x;
        mouseStatus.currY = mousePosition.y;

        // Change a cursor according to the label type.
        var iconImagePaths = util.misc.getIconImagePaths();
        var labelType = ribbon.getStatus('mode');
        if (labelType) {
            var iconImagePath = iconImagePaths[labelType].iconImagePath;
            var cursorUrl = "url(" + iconImagePath + ") 19 19, auto";
            $(this).css('cursor', ''); //should first reset the cursor, otherwise safari strangely does not update the cursor
            $(this).css('cursor', cursorUrl);
        }
        clear();
        render();
        mouseStatus.prevX = mouseposition(e, this).x;
        mouseStatus.prevY = mouseposition(e, this).y;
    }

    /**
     * This is called when a user clicks a delete icon.
     */
    function labelDeleteIconClick() {
        if (!status.disableLabelDelete) {
            var currLabel = self.getCurrentLabel();
            if (currLabel) {
                svl.tracker.push('Click_LabelDelete', { labelType: currLabel.getProperty('labelType') });
                svl.labelContainer.removeLabel(currLabel);
                svl.ui.canvas.deleteIconHolder.css('visibility', 'hidden');
            }
        }
    }

    /**
     * Clear what's on the canvas.
     * @method
     */
    function clear() {
        // Clears the canvas.
        if (ctx) {
            ctx.clearRect(0, 0, canvasProperties.width, canvasProperties.height);
        } else {
            console.warn('The ctx is not set.')
        }
        return this;
    }

    /**
     *
     * @method
     */
    function disableLabelDelete() {
        if (!status.lockDisableLabelDelete) {
            status.disableLabelDelete = true;
            return this;
        }
        return false;
    }

    /**
     * @method
     * @return {boolean}
     */
    function disableLabelEdit() {
        if (!status.lockDisableLabelEdit) {
            status.disableLabelEdit = true;
            return this;
        }
        return false;
    }

    /**
     * Disable labeling
     * @method
     */
    function disableLabeling() {
        // Check right-click-menu visibility
        // If any of menu is visible, disable labeling
        if (!status.lockDisableLabeling) {
            status.disableLabeling = true;
            return this;
        }
        return false;
    }

    /**
     * Enable deleting labels
     * @method
     */
    function enableLabelDelete() {
        if (!status.lockDisableLabelDelete) {
            status.disableLabelDelete = false;
            return this;
        }
        return false;
    }

    /**
     * Enables editing labels
     * @method
     */
    function enableLabelEdit() {
        if (!status.lockDisableLabelEdit) {
            status.disableLabelEdit = false;
            return this;
        }
        return false;
    }

    /**
     * Enables labeling
     * @method
     */
    function enableLabeling() {
        if (!status.lockDisableLabeling) {
            status.disableLabeling = false;
            return this;
        }
        return false;
    }

    /**
     * Returns the label of the current focus
     * @method
     */
    function getCurrentLabel() {
        return status.currentLabel;
    }

    /**
     * Returns a lock that corresponds to the key.
     * TODO replace the various locking methods with just this one.
     * @method
     */
    function getLock(key) {
        return lock[key];
    }

    /**
     * Returns a status
     * @method
     */
    function getStatus(key) {
        if (!(key in status)) {
            console.warn("You have passed an invalid key for status.")
        }
        return status[key];
    }

    /**
     * This function takes cursor coordinates x and y on the canvas. Then returns an object right below the cursor.
     * If a cursor is not on anything, return false.
     * @method
     */
    function isOn(x, y) {
        var i, ret = false,
            labels = svl.labelContainer.getCanvasLabels(),
            lenLabels = labels.length;

        for (i = 0; i < lenLabels; i += 1) {
            // Check labels, paths, and points to see if they are under a mouse cursor
            ret = labels[i].isOn(x, y);
            if (ret) {
                status.currentLabel = labels[i];
                return ret;
            }
        }
        return false;
    }

    /**
     * @method
     */
    function lockCurrentLabel() {
        status.lockCurrentLabel = true;
        return this;
    }

    /**
     * Lock disable label delete
     * @method
     */
    function lockDisableLabelDelete() {
        status.lockDisableLabelDelete = true;
        return this;
    }

    /**
     * Lock disable label edit
     * @method
     */
    function lockDisableLabelEdit() {
        status.lockDisableLabelEdit = true;
        return this;
    }

    /**
     * Lock disable labeling
     * @method
     */
    function lockDisableLabeling() {
        status.lockDisableLabeling = true;
        return this;
    }

    /**
     * @method
     */
    function pushLabel(label) {
        status.currentLabel = label;
        svl.labelContainer.push(label);
        return this;
    }


    /**
     * Renders labels
     * @method
     */
    function render() {
        if (!ctx) {
            return this;
        }
        var i, label, lenLabels;
        var labels = svl.labelContainer.getCanvasLabels();
        var pov = svl.map.getPov();

        var povChange = svl.map.getPovChangeStatus();
        // For the condition, when the interface loads for the first time, the pov is changed. Prevents the conversion
        // function to be called for the initial rendering pipeline.
        if (labels.length === 0 && povChange["status"]) {
            povChange["status"] = false;
        }

        // Render user labels.
        lenLabels = labels.length;
        for (i = 0; i < lenLabels; i += 1) {
            label = labels[i];
            label.render(ctx, pov);
        }
        povChange["status"] = false;

        // Update the opacity of Zoom In and Zoom Out buttons.
        if (svl.zoomControl) {
            svl.zoomControl.updateOpacity();
        }

        return this;
    }

    /**
     * @method
     */
    function setCurrentLabel(label) {
        if (!status.lockCurrentLabel) {
            status.currentLabel = label;
            return this;
        }
        return false;
    }

    /**
     * This sets the status of the canvas object
     * @param key
     * @param value
     * @returns {*}
     */
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
     * @returns {showLabelHoverInfo}
     */
    function showLabelHoverInfo(label) {
        var i;
        var labels = svl.labelContainer.getCanvasLabels();
        var labelLen = labels.length;
        for (i = 0; i < labelLen; i += 1) {
            labels[i].setHoverInfoVisibility('hidden');
        }
        if (label) {
            label.setHoverInfoVisibility('visible');
        } else {
            // All labels share one delete icon that gets moved around. So if not hovering over label, hide the button.
            svl.ui.canvas.deleteIconHolder.css('visibility', 'hidden');
        }

        self.clear();
        self.render();
        return this;
    }

    function setHoverInfoVisibility(labelIn) {
        return self.showLabelHoverInfo(labelIn);
    }

    function setVisibility(visibility) {
        var labels = svl.labelContainer.getCanvasLabels(),
            labelLen = labels.length;

        for (var i = 0; i < labelLen; i += 1) {
            labels[i].setVisibility(visibility);
        }
        return this;
    }

    /**
     * Set the visibility of the labels based on pano id.
     */
    function setVisibilityBasedOnLocation(visibility, panoramaId) {
        var labels = svl.labelContainer.getCanvasLabels(),
            labelLen = labels.length;

        for (var i = 0; i < labelLen; i += 1) {
            labels[i].setVisibilityBasedOnLocation(visibility, panoramaId);
        }
        return this;
    }

    /**
     * @method
     */
    function unlockCurrentLabel() {
        status.lockCurrentLabel = false;
        return this;
    }

    /**
     * @method
     */
    function unlockDisableLabelDelete() {
        status.lockDisableLabelDelete = false;
        return this;
    }

    /**
     * @method
     */
    function unlockDisableLabelEdit() {
        status.lockDisableLabelEdit = false;
        return this;
    }

    /**
     * @method
     */
    function unlockDisableLabeling() {
        status.lockDisableLabeling = false;
        return this;
    }

    // Initialization
    _init();

    // Put public methods to self and return them.
    self.clear = clear;
    self.disableLabelDelete = disableLabelDelete;
    self.disableLabelEdit = disableLabelEdit;
    self.disableLabeling = disableLabeling;
    self.enableLabelDelete = enableLabelDelete;
    self.enableLabelEdit = enableLabelEdit;
    self.enableLabeling = enableLabeling;
    self.getCurrentLabel = getCurrentLabel;
    self.getLock = getLock;
    self.getStatus = getStatus;
    self.isOn = isOn;
    self.lockCurrentLabel = lockCurrentLabel;
    self.lockDisableLabelDelete = lockDisableLabelDelete;
    self.lockDisableLabelEdit = lockDisableLabelEdit;
    self.lockDisableLabeling = lockDisableLabeling;
    self.pushLabel = pushLabel;
    self.render = render;
    self.setCurrentLabel = setCurrentLabel;
    self.setStatus = setStatus;
    self.showLabelHoverInfo = showLabelHoverInfo;
    self.setHoverInfoVisibility = setHoverInfoVisibility;
    self.setVisibility = setVisibility;
    self.setVisibilityBasedOnLocation = setVisibilityBasedOnLocation;
    self.unlockCurrentLabel = unlockCurrentLabel;
    self.unlockDisableLabelDelete = unlockDisableLabelDelete;
    self.unlockDisableLabelEdit = unlockDisableLabelEdit;
    self.unlockDisableLabeling = unlockDisableLabeling;

    return self;
}
