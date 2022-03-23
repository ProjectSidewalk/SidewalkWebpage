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
    // Properties
    var properties = {
        drawingMode: "point",
        radiusThresh: 7,
        showDeleteMenuTimeOutToken: undefined,
        tempPointRadius: 5
    };

    var pointParameters = {
        'fillStyleInnerCircle': 'rgba(0,0,0,1)', // labelColor.fillStyle,
        'iconImagePath': undefined, // iconImagePath,
        'radiusInnerCircle': 5, //13,
        'radiusOuterCircle': 6, //14
    };

    var status = {
        currentLabel: null,
        disableLabelDelete: false,
        disableLabelEdit: false,
        disableLabeling: false,
        disableWalking: false,
        drawing: false,

        lockCurrentLabel: false,
        lockDisableLabelDelete: false,
        lockDisableLabelEdit: false,
        lockDisableLabeling: false,
        svImageCoordinatesAdjusted: false,
        totalLabelCount: 0,
        'visibilityMenu': 'hidden'
    };

    var lock = {
        showLabelTag: false
    };

    // Canvas context
    var canvasProperties = {'height': 0, 'width': 0};
    var ctx;

    var tempPath = [];

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

        // Point radius
        if (properties.drawingMode == 'path') {
            properties.pointInnerCircleRadius = 5;
            properties.pointOuterCircleRadius = 6;
        } else {
            properties.pointInnerCircleRadius = 17;
            properties.pointOuterCircleRadius = 14;
        }
    }

    /**
     * Finish up labeling.
     * Clean this method when I get a chance.....
     */
    function closeLabelPath() {
        var labelType = ribbon.getStatus('selectedLabelType');
        var labelColor = util.misc.getLabelColors()[labelType],
            labelDescription = util.misc.getLabelDescriptions(labelType),
            iconImagePath = util.misc.getIconImagePaths(labelDescription.id).iconImagePath;

        pointParameters.fillStyleInnerCircle = labelColor.fillStyle;
        pointParameters.iconImagePath = iconImagePath;
        pointParameters.radiusInnerCircle = properties.pointInnerCircleRadius;
        pointParameters.radiusOuterCircle = properties.pointOuterCircleRadius;

        var points = [], pov = svl.map.getPov();

        for (var i = 0, pathLen = tempPath.length; i < pathLen; i++) {
            points.push(new Point(svl, tempPath[i].x, tempPath[i].y, pov, pointParameters));
        }

        var path = new Path(svl, points, {});
        var latlng = svl.map.getPosition();
        var param = {
            canvasWidth: svl.canvasWidth,
            canvasHeight: svl.canvasHeight,
            canvasDistortionAlphaX: svl.alpha_x,
            canvasDistortionAlphaY: svl.alpha_y,
            tutorial: svl.missionContainer.getCurrentMission().getProperty("missionType") === "auditOnboarding",
            labelType: labelDescription.id,
            labelDescription: labelDescription.text,
            labelFillStyle: labelColor.fillStyle,
            panoId: svl.map.getPanoId(),
            panoramaLat: latlng.lat,
            panoramaLng: latlng.lng,
            panoramaHeading: pov.heading,
            panoramaPitch: pov.pitch,
            panoramaZoom: parseInt(pov.zoom, 10),
            svImageWidth: svl.svImageWidth,
            svImageHeight: svl.svImageHeight,
            svMode: 'html4'
        };
        if (("panorama" in svl) && ("getPhotographerPov" in svl.panorama)) {
            var photographerPov = svl.panorama.getPhotographerPov();
            param.photographerHeading = photographerPov.heading;
            param.photographerPitch = photographerPov.pitch;
        }

        status.currentLabel = svl.labelFactory.create(path, param);
        svl.labelContainer.push(status.currentLabel);


        // TODO Instead of calling the contextMenu show, throw an Canvas:closeLabelPath event.
        if ('contextMenu' in svl) {
            svl.contextMenu.show(tempPath[0].x, tempPath[0].y, {
                targetLabel: status.currentLabel,
                targetLabelColor: labelColor.fillStyle
            });
        }

        svl.tracker.push('LabelingCanvas_FinishLabeling', {
            labelType: labelDescription.id,
            canvasX: tempPath[0].x,
            canvasY: tempPath[0].y
        }, {
            temporaryLabelId: status.currentLabel.getProperty('temporary_label_id')
        });

        // Sound effect.
        if ('audioEffect' in svl) {
            svl.audioEffect.play('drip');
        }

        // Initialize the tempPath.
        tempPath = [];
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
     * This function is fired when at the time of mouse-up
     */
    function handleDrawingLayerMouseUp(e) {
        var currTime;

        mouseStatus.isLeftDown = false;
        mouseStatus.leftUpX = util.mouseposition(e, this).x;
        mouseStatus.leftUpY = util.mouseposition(e, this).y;

        currTime = new Date().getTime();

        if (!status.disableLabeling && currTime - mouseStatus.prevMouseUpTime > 300) {
            if (properties.drawingMode == "point") {
                tempPath.push({x: mouseStatus.leftUpX, y: mouseStatus.leftUpY});
                closeLabelPath();
            }
            // NOT being used now in this tool
            else if (properties.drawingMode == "path") {
                // Path labeling.

                // Define point parameters to draw
                if (!status.drawing) {
                    // Start drawing a path if a user hasn't started to do so.
                    status.drawing = true;
                    if ('tracker' in svl && svl.tracker) {
                        svl.tracker.push('LabelingCanvas_StartLabeling');
                    }
                    tempPath.push({x: mouseStatus.leftUpX, y: mouseStatus.leftUpY});
                } else {
                    // Close the current path if there are more than 2 points in the tempPath and
                    // the user clicks on a point near the initial point.
                    var closed = false;
                    if (tempPath.length > 2) {
                        var r = Math.sqrt(Math.pow((tempPath[0].x - mouseStatus.leftUpX), 2) + Math.pow((tempPath[0].y - mouseStatus.leftUpY), 2));
                        if (r < properties.radiusThresh) {
                            closed = true;
                            status.drawing = false;
                            closeLabelPath();
                        }
                    }

                    // Otherwise add a new point
                    if (!closed) {
                        tempPath.push({x: mouseStatus.leftUpX, y: mouseStatus.leftUpY});
                    }
                }

            }

            clear();
            setVisibilityBasedOnLocation('visible', svl.map.getPanoId());
            render2();
        }
        // NOT being used now in this tool
        else if (currTime - mouseStatus.prevMouseUpTime < 400) {
            if (properties.drawingMode == "path") {
                // This part is executed for a double click event
                // If the current status.drawing = true, then close the current path.
                if (status.drawing && tempPath.length > 2) {
                    status.drawing = false;

                    closeLabelPath();
                    self.clear();
                    self.setVisibilityBasedOnLocation('visible', svl.map.getPanoId());
                    self.render2();
                }
            }
        }


        svl.tracker.push('LabelingCanvas_MouseUp', {x: mouseStatus.leftUpX, y: mouseStatus.leftUpY});
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


        if (!status.drawing) {
            var ret = isOn(mouseStatus.currX, mouseStatus.currY);
            if (ret && ret.className === 'Path') {
                showLabelTag(status.currentLabel);
                ret.renderBoundingBox(ctx);
            } else {
                showLabelTag(undefined);
            }
        }
        clear();
        render2();
        mouseStatus.prevX = mouseposition(e, this).x;
        mouseStatus.prevY = mouseposition(e, this).y;
    }

    /**
     */
    function imageCoordinates2String(coordinates) {
        if (!(coordinates instanceof Array)) {
            throw self.className + '.imageCoordinates2String() expects Array as an input';
        }
        if (coordinates.length === 0) {
            throw self.className + '.imageCoordinates2String(): Empty array';
        }
        var ret = '';
        var i;
        var len = coordinates.length;

        for (i = 0; i < len; i += 1) {
            ret += parseInt(coordinates[i].x) + ' ' + parseInt(coordinates[i].y) + ' ';
        }

        return ret;
    }

    /**
     * This is called when a user clicks a delete icon.
     */
    function labelDeleteIconClick() {
        if (!status.disableLabelDelete) {
            svl.tracker.push('Click_LabelDelete', {labelType: self.getCurrentLabel().getProperty('labelType')});
            var currLabel = self.getCurrentLabel();
            if (!currLabel) {
                //
                // Sometimes (especially during ground truth insertion if you force a delete icon to show up all the time),
                // currLabel would not be set properly. In such a case, find a label underneath the delete icon.
                var x = svl.ui.canvas.deleteIconHolder.css('left');
                var y = svl.ui.canvas.deleteIconHolder.css('top');
                x = x.replace("px", "");
                y = y.replace("px", "");
                x = parseInt(x, 10) + 5;
                y = parseInt(y, 10) + 5;
                var item = isOn(x, y);
                if (item && item.className === "Point") {
                    var path = item.belongsTo();
                    currLabel = path.belongsTo();
                } else if (item && item.className === "Label") {
                    currLabel = item;
                } else if (item && item.className === "Path") {
                    currLabel = item.belongsTo();
                }
            }

            if (currLabel) {
                svl.labelContainer.removeLabel(currLabel);
                svl.ui.canvas.deleteIconHolder.css('visibility', 'hidden');

                // If showLabelTag is blocked by GoldenInsertion (or by any other object), unlock it as soon as
                // a label is deleted.
                if (lock.showLabelTag) {
                    self.unlockShowLabelTag();
                }
            }
        }
    }

    /**
     * Render a temporary path while the user is drawing.
     */
    function renderTempPath() {
        var pathLen = tempPath.length,
            labelColor = util.misc.getLabelColors()[ribbon.getStatus('selectedLabelType')],
            pointFill = labelColor.fillStyle,
            curr, prev, r;
        pointFill = util.color.changeAlphaRGBA(pointFill, 0.5);


        // Draw the first line.
        ctx.strokeStyle = 'rgba(255,255,255,1)';
        ctx.lineWidth = 2;
        if (pathLen > 1) {
            curr = tempPath[1];
            prev = tempPath[0];
            r = Math.sqrt(Math.pow((tempPath[0].x - mouseStatus.currX), 2) + Math.pow((tempPath[0].y - mouseStatus.currY), 2));

            // Change the circle radius of the first point depending on the distance between a mouse cursor and the point coordinate.
            if (r < properties.radiusThresh && pathLen > 2) {
                util.shape.lineWithRoundHead(ctx, prev.x, prev.y, 2 * properties.tempPointRadius, curr.x, curr.y, properties.tempPointRadius, 'both', 'rgba(255,255,255,1)', pointFill, 'none', 'rgba(255,255,255,1)', pointFill);
            } else {
                util.shape.lineWithRoundHead(ctx, prev.x, prev.y, properties.tempPointRadius, curr.x, curr.y, properties.tempPointRadius, 'both', 'rgba(255,255,255,1)', pointFill, 'none', 'rgba(255,255,255,1)', pointFill);
            }
        }

        // Draw the lines in between
        for (var i = 2; i < pathLen; i++) {
            curr = tempPath[i];
            prev = tempPath[i - 1];
            util.shape.lineWithRoundHead(ctx, prev.x, prev.y, 5, curr.x, curr.y, 5, 'both', 'rgba(255,255,255,1)', pointFill, 'none', 'rgba(255,255,255,1)', pointFill);
        }

        if (r < properties.radiusThresh && pathLen > 2) {
            util.shape.lineWithRoundHead(ctx, tempPath[pathLen - 1].x, tempPath[pathLen - 1].y, properties.tempPointRadius, tempPath[0].x, tempPath[0].y, 2 * properties.tempPointRadius, 'both', 'rgba(255,255,255,1)', pointFill, 'none', 'rgba(255,255,255,1)', pointFill);
        } else {
            util.shape.lineWithRoundHead(ctx, tempPath[pathLen - 1].x, tempPath[pathLen - 1].y, properties.tempPointRadius, mouseStatus.currX, mouseStatus.currY, properties.tempPointRadius, 'both', 'rgba(255,255,255,1)', pointFill, 'stroke', 'rgba(255,255,255,1)', pointFill);
        }
    }

    /**
     * Cancel drawing while use is drawing a label
     * @method
     */
    function cancelDrawing() {
        // This method clears a tempPath and cancels drawing. This method is called by Keyboard when esc is pressed.
        if ('tracker' in svl && svl.tracker && status.drawing) {
            svl.tracker.push("LabelingCanvas_CancelLabeling");
        }

        tempPath = [];
        status.drawing = false;
        self.clear().render2();
        return this;
    }

    /**
     * Clear what's on the canvas.
     * @method
     */
    function clear() {
        // Clears the canvas
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
     * This method returns the current status drawing.
     * @method
     * @return {boolean}
     */
    function isDrawing() {
        return status.drawing;
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
     * This method locks showLabelTag
     * @method
     */
    function lockShowLabelTag() {
        lock.showLabelTag = true;
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
     * This method removes all the labels stored in the labels array.
     * @method
     */
    function removeAllLabels() {
        if ("labelContainer" in svl) {
            svl.labelContainer.removeAll();
        }
        return this;
    }


    /**
     * Renders labels
     * @method
     */
    function render2() {
        if (!ctx) {
            return this;
        }
        var i, j, label, lenLabels,
            labels = svl.labelContainer.getCanvasLabels();
        status.totalLabelCount = 0;
        var pov = svl.map.getPov();

        var povChange = svl.map.getPovChangeStatus();
        // For the condition, when the interface loads for the first time
        // The pov is changed. Prevents the conversion function to be called
        // for the initial rendering pipeline
        if (labels.length == 0 && povChange["status"]) {
            povChange["status"] = false;
        }

        var points, pointsLen, pointData, svImageCoordinate, deltaHeading, deltaPitch, x, y;
        // The image coordinates of the points in system labels shift as the projection parameters
        // (i.e., heading and pitch) that
        // you can get from Street View API change. So adjust the image coordinate
        // Note that this adjustment happens only once
        if (!status.svImageCoordinatesAdjusted) {
            var currentPhotographerPov = svl.panorama.getPhotographerPov();
            if (currentPhotographerPov && 'heading' in currentPhotographerPov && 'pitch' in currentPhotographerPov) {
                lenLabels = labels.length;
                for (i = 0; i < lenLabels; i += 1) {
                    // Check if the label comes from current SV panorama
                    label = labels[i];
                    points = label.getPoints(true);
                    pointsLen = points.length;

                    for (j = 0; j < pointsLen; j++) {
                        pointData = points[j].getProperties();
                        svImageCoordinate = points[j].getGSVImageCoordinate();
                        if ('photographerHeading' in pointData && pointData.photographerHeading) {
                            deltaHeading = currentPhotographerPov.heading - pointData.photographerHeading;
                            deltaPitch = currentPhotographerPov.pitch - pointData.photographerPitch;
                            x = (svImageCoordinate.x + (deltaHeading / 360) * svl.svImageWidth + svl.svImageWidth) % svl.svImageWidth;
                            y = svImageCoordinate.y + (deltaPitch / 90) * svl.svImageHeight;
                            points[j].resetSVImageCoordinate({x: x, y: y})
                        }
                    }
                }
                status.svImageCoordinatesAdjusted = true;
            }
        }

        // Render user labels. First check if the label comes from current SV panorama
        lenLabels = labels.length;
        for (i = 0; i < lenLabels; i += 1) {
            label = labels[i];
            label.render(ctx, pov);

            if (label.isVisible() && !label.isDeleted()) {
                status.totalLabelCount += 1;
            }
        }
        povChange["status"] = false;

        // Draw a temporary path from the last point to where a mouse cursor is.
        if (status.drawing) {
            renderTempPath();
        }

        // Update the opacity of Zoom In and Zoom Out buttons.
        if (svl.zoomControl) {
            svl.zoomControl.updateOpacity();
        }

        return this;
    }

    /**
     * @method
     */
    function renderBoundingBox(path) {
        path.renderBoundingBox(ctx);
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
     * @method
     */
    /**
     * This function sets the passed label's tagVisiblity to 'visible' and all the others to 'hidden'
     * @param label
     * @returns {showLabelTag}
     */
    function showLabelTag(label) {
        if (!lock.showLabelTag) {
            var i,
                labels = svl.labelContainer.getCanvasLabels(),
                labelLen = labels.length;
            var isAnyVisible = false;
            for (i = 0; i < labelLen; i += 1) {
                labels[i].setTagVisibility('hidden');
                labels[i].resetTagCoordinate();
            }
            if (label) {
                label.setTagVisibility('visible');
                isAnyVisible = true;
            } else {
                svl.ui.canvas.deleteIconHolder.css('visibility', 'hidden');
            }
            // If any of the tags is visible, show a deleting icon on it.
            if (!isAnyVisible) {
                svl.ui.canvas.deleteIconHolder.css('visibility', 'hidden');
            }

            self.clear();
            self.render2();
            return this;
        }
    }

    /**
     * @method
     */
    function setTagVisibility(labelIn) {
        return self.showLabelTag(labelIn);
    }

    /**
     * @method
     */
    function setVisibility(visibility) {
        var labels = svl.labelContainer.getCanvasLabels(),
            labelLen = labels.length;

        for (var i = 0; i < labelLen; i += 1) {
            labels[i].unlockVisibility();
            labels[i].setVisibility('visible');
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
     * Hide labels that are not in LabelerIds
     * @method
     */
    function setVisibilityBasedOnLabelerId(visibility, LabelerIds, included) {
        var labels = svl.labelContainer.getCanvasLabels(),
            labelLen = labels.length;

        for (var i = 0; i < labelLen; i += 1) {
            labels[i].setVisibilityBasedOnLabelerId(visibility, LabelerIds, included);
        }
        return this;
    }

    /**
     * @method
     */
    function setVisibilityBasedOnLabelerIdAndLabelTypes(visibility, table, included) {
        var labels = svl.labelContainer.getCanvasLabels(),
            labelLen = labels.length;
        for (var i = 0; i < labelLen; i += 1) {
            labels[i].setVisibilityBasedOnLabelerIdAndLabelTypes(visibility, table, included);
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

    /**
     * @method
     */
    function unlockShowLabelTag() {
        // This method locks showLabelTag
        lock.showLabelTag = false;
        return this;
    }

    // Initialization
    _init();

    // Put public methods to self and return them.
    self.cancelDrawing = cancelDrawing;
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
    self.isDrawing = isDrawing;
    self.isOn = isOn;
    self.lockCurrentLabel = lockCurrentLabel;
    self.lockDisableLabelDelete = lockDisableLabelDelete;
    self.lockDisableLabelEdit = lockDisableLabelEdit;
    self.lockDisableLabeling = lockDisableLabeling;
    self.lockShowLabelTag = lockShowLabelTag;
    self.pushLabel = pushLabel;
    self.removeAllLabels = removeAllLabels;
    self.render = render2;
    self.render2 = render2;
    self.renderBoundingBox = renderBoundingBox;
    self.setCurrentLabel = setCurrentLabel;
    self.setStatus = setStatus;
    self.showLabelTag = showLabelTag;
    self.setTagVisibility = setTagVisibility;
    self.setVisibility = setVisibility;
    self.setVisibilityBasedOnLocation = setVisibilityBasedOnLocation;
    self.setVisibilityBasedOnLabelerId = setVisibilityBasedOnLabelerId;
    self.setVisibilityBasedOnLabelerIdAndLabelTypes = setVisibilityBasedOnLabelerIdAndLabelTypes;
    self.unlockCurrentLabel = unlockCurrentLabel;
    self.unlockDisableLabelDelete = unlockDisableLabelDelete;
    self.unlockDisableLabelEdit = unlockDisableLabelEdit;
    self.unlockDisableLabeling = unlockDisableLabeling;
    self.unlockShowLabelTag = unlockShowLabelTag;

    return self;
}
