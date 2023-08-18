/**
 * Label Container module. This is responsible for storing the label objects that were created in the current session.
 * @param $ jQuery object
 * @param nextTemporaryLabelId
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function LabelContainer ($, nextTemporaryLabelId) {
    var self = this;
    var labelsToLog = {};
    var allLabels = {};
    var nextTempLabelId = nextTemporaryLabelId;

    /**
     * Helper func to add a label to given list. Our labels are sorted in objects with panoId keys and lists as values.
     * @param labelListObj
     * @param label
     */
    function _addLabelToListObject(labelListObj, label) {
        var panoId = label.getPanoId();
        var tempId = label.getProperty('temporaryLabelId');

        // Make sure that there is a list available for the given pano ID.
        if (!(panoId in labelListObj)) labelListObj[panoId] = [];

        // If it's not already in the last, add it.
        var inList = labelListObj[panoId].filter(l => l.getProperty('temporaryLabelId') === tempId).length > 0;
        if (!inList) labelListObj[panoId].push(label);
    }

    /**
     * Create a Label object. If the label is new, it won't have a labelId yet, so we assign a temporary one.
     * @returns {Label}
     */
    this.createLabel = function(params, isNew) {
        if (isNew) {
            params.predictionMade = false;
            params.temporaryLabelId = nextTempLabelId;
            nextTempLabelId++;
        } else {
            params.predictionMade = true;
        }
        var label = new Label(params);

        // Add to list of labels. If new, also add to current canvas labels.
        if (isNew) {
            _addLabelToListObject(labelsToLog, label);
            svl.labelCounter.increment(label.getLabelType());
        }
        _addLabelToListObject(allLabels, label);

        return label
    }

    /**
     * Query server for previous labels placed by this user and create label objects for them.
     * @param regionId
     * @param callback
     */
    this.fetchLabelsToResumeMission = function (regionId, callback) {
        $.getJSON('/label/resumeMission', { regionId: regionId }, function (result) {
            let labelArr = result.labels;
            for (let i = 0; i < labelArr.length; i++) {
                let originalCanvasXY = {
                    x: labelArr[i].canvasX,
                    y: labelArr[i].canvasY
                };

                // Get the canvas coordinates for the label given the current POV.
                let povOfLabelIfCentered = util.panomarker.calculatePovIfCentered(
                    labelArr[i].originalPov, originalCanvasXY.x, originalCanvasXY.y, util.EXPLORE_CANVAS_WIDTH, util.EXPLORE_CANVAS_HEIGHT
                );
                let rerenderCanvasXY = util.panomarker.getCanvasCoordinate(
                    povOfLabelIfCentered, svl.map.getPov(), util.EXPLORE_CANVAS_WIDTH, util.EXPLORE_CANVAS_HEIGHT, svl.LABEL_ICON_RADIUS
                );

                labelArr[i].currCanvasXY = { x: rerenderCanvasXY.x, y: rerenderCanvasXY.y };
                labelArr[i].originalCanvasXY = originalCanvasXY;
                labelArr[i].povOfLabelIfCentered = povOfLabelIfCentered;
                labelArr[i].panoXY = { x: labelArr[i].panoX, y: labelArr[i].panoY };
                let label = self.createLabel(labelArr[i], false);

                // Prevent tag from being rendered initially.
                label.setHoverInfoVisibility('hidden');
            }

            if (callback) callback(result);
        });
    }

    /**
     * Returns labels for the current pano ID.
     */
    this.getCanvasLabels = function () {
        let panoId = svl.map.getPanoId();
        return allLabels[panoId] ? allLabels[panoId] : [];
    };

    /**
     * Get labels that need to be logged to the back-end because they are new or the user has interacted with them.
     */
    this.getLabelsToLog = function () {
        return Object.keys(labelsToLog).reduce(function (r, k) { return r.concat(labelsToLog[k]); }, []);
    };

    this.getAllLabels = function () {
        return Object.keys(allLabels).reduce(function (r, k) { return r.concat(allLabels[k]); }, []);
    };

    /**
     * Find a label with matching temporary ID.
     * @param tempId
     */
    this.findLabelByTempId = function (tempId) {
        var matchingLabels =  _.filter(self.getCanvasLabels(),
            function(label) { return label.getProperty("temporaryLabelId") === tempId; }
        );
        // Returns most recent version of label (though there shouldn't be multiple).
        if (matchingLabels.length > 1) {
            console.warn('Multiple labels with same temp ID!');
            console.log(self.getCanvasLabels());
        }
        return matchingLabels[matchingLabels.length - 1];
    };

    /**
     * Adds a label to the list of labels that should be logged; called when a user interacts with an existing label.
     * @param tempId
     */
    this.addToLabelsToLog = function (tempId) {
        var match = this.findLabelByTempId(tempId);
        if (match) _addLabelToListObject(labelsToLog, match);
    };

    this.clearLabelsToLog = function () {
        labelsToLog = {};
    };

    this.countLabels = function() {
        var allLabels = self.getAllLabels();
        return allLabels.filter(l => { return !l.isDeleted(); }).length;
    };

    /**
     * Removes a passed label, updates the canvas, and updates label counts.
     */
    this.removeLabel = function (label) {
        if (!label) { return false; }
        svl.tracker.push('RemoveLabel', {labelType: label.getProperty('labelType')});
        svl.labelCounter.decrement(label.getProperty("labelType"));
        label.remove();
        _addLabelToListObject(labelsToLog, label);
        svl.canvas.clear().render();
        return this;
    };
}
