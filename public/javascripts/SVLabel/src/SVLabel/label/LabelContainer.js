/**
 * Label Container module. This is responsible for storing the label objects that were created in the current session.
 * @param $ jQuery object
 * @param nextTemporaryLabelId
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function LabelContainer($, nextTemporaryLabelId) {
    var self = this;
    var currentCanvasLabels = {};
    var prevCanvasLabels = {};
    var nextTempLabelId = nextTemporaryLabelId;

    this.countLabels = function() {
        var allLabels = self.getCurrentLabels().concat(self.getPreviousLabels());
        return allLabels.filter(l => { return !l.isDeleted(); }).length;
    };

    /**
     * Create a new Label object. If the label is new, it won't have a labelId yet, so we assign a temporary one.
     * @returns {Label}
     */
    this.createLabel = function(params) {
        if (!('labelId' in params)) {
            params.temporaryLabelId = nextTempLabelId;
            nextTempLabelId++;
        }
        return new Label(params);
    }

    this.fetchLabelsToResumeMission = function (regionId, callback) {
        $.getJSON('/label/resumeMission', { regionId: regionId }, function (result) {
            let labelArr = result.labels;
            let len = labelArr.length;
            for (let i = 0; i < len; i++) {
                let originalCanvasCoord = {
                    x: labelArr[i].canvasX,
                    y: labelArr[i].canvasY
                };
                let originalPov = {
                    heading: labelArr[i].panoramaHeading,
                    pitch: labelArr[i].panoramaPitch,
                    zoom: labelArr[i].panoramaZoom
                };

                let povChange = svl.map.getPovChangeStatus();

                // Temporarily change pov change status to true so that we can use util function to calculate the canvas
                // coordinate to place label upon rerender. This is so the labels appear in the correct location
                // relative to the initial POV.
                povChange["status"] = true;
                let originalPointPov = {
                    originalPov: util.panomarker.calculatePointPov(originalCanvasCoord.x, originalCanvasCoord.y, originalPov)
                };
                let rerenderCanvasCoord = util.panomarker.getCanvasCoordinate(
                    originalCanvasCoord, originalPointPov.originalPov, svl.map.getPov()
                );
                // Return the status to original.
                povChange["status"] = false;

                labelArr[i].canvasCoordinate = { x: rerenderCanvasCoord.x, y: rerenderCanvasCoord.y };
                labelArr[i].originalCanvasCoordinate = originalCanvasCoord;
                labelArr[i].pov = svl.map.getPov();
                labelArr[i].originalPov = originalPointPov.originalPov;
                labelArr[i].svImageCoordinate = { x: labelArr[i].svImageX, y: labelArr[i].svImageY };

                let label = self.createLabel(labelArr[i]);

                // Prevent tag from being rendered initially
                label.setTagVisibility('hidden');

                if (!(label.getPanoId() in prevCanvasLabels)) {
                    prevCanvasLabels[label.getPanoId()] = [];
                }

                prevCanvasLabels[label.getPanoId()].push(label);
            }

            if (callback) callback(result);
        });
    }

    /**
     * Returns canvas labels of the current pano ID.
     */
    this.getCanvasLabels = function () {
        let panoId = svl.map.getPanoId();
        let prev = prevCanvasLabels[panoId] ? prevCanvasLabels[panoId] : [];
        let curr = currentCanvasLabels[panoId] ? currentCanvasLabels[panoId] : [];
        return prev.concat(curr);
    };

    /**
     * Get current labels. Note that this grabs labels from all panoIds in current session.
     */
    this.getCurrentLabels = function () {
        return Object.keys(currentCanvasLabels).reduce(function (r, k) {
            return r.concat(currentCanvasLabels[k]);
        }, []);
    };

    /**
     * Get previous labels. Note that this grabs labels from all panoIds in current session.
     */
    this.getPreviousLabels = function () {
        return Object.keys(prevCanvasLabels).reduce(function (r, k) {
            return r.concat(prevCanvasLabels[k]);
        }, []);
    };

    // Find most recent instance of label with matching temporary ID.
    this.findLabelByTempId = function (tempId) {
        var matchingLabels =  _.filter(self.getCanvasLabels(),
            function(label) {
                return label.getProperty("temporaryLabelId") === tempId;
            });

        if (matchingLabels.length === 0) {
            return null;
        }

        // Returns most recent version of label.
        return matchingLabels[matchingLabels.length - 1];
    };

    // Remove old versions of this label, add updated label.
    this.addUpdatedLabel = function (tempId) {
        // All labels that don't have the specified tempId reduced to an array.
        var otherLabels = _.filter(this.getCurrentLabels(),
            function(label) {
                return label.getProperty("temporaryLabelId") !== tempId;
            });

        // If there are no temporary labels with this ID in currentCanvasLabels then add it to that list.
        // Otherwise get rid of all old instances in currentCanvasLabels and add the updated label.

        var match = this.findLabelByTempId(tempId);

        // Label with this id doesn't exist in currentCanvasLabels as the
        // filtered vs unfiltered arrays are the same length.
        if (otherLabels.length === this.getCurrentLabels().length) {
            if (!(match.getPanoId() in currentCanvasLabels)) {
                currentCanvasLabels[match.getPanoId()] = [];
            }
            // Add updated label.
            currentCanvasLabels[match.getPanoId()].push(match);
        } else {
            for (let key in currentCanvasLabels) {
                currentCanvasLabels[key] = currentCanvasLabels[key].filter(label => label.getProperty("temporaryLabelId") !== tempId);
            }
            if (match !== null) {
                if (!(match.getPanoId() in currentCanvasLabels)) {
                    currentCanvasLabels[match.getPanoId()] = [];
                }
                // Add updated label.
                currentCanvasLabels[match.getPanoId()].push(match);
            }
        }
    };

    /**
     * Push a label into canvasLabels
     * @param label
     */
    this.push = function (label) {
        if (!(label.getPanoId() in currentCanvasLabels)) {
            currentCanvasLabels[label.getPanoId()] = [];
        }

        currentCanvasLabels[label.getPanoId()].push(label);
        svl.labelCounter.increment(label.getProperty("labelType"));

        // Keep pano metadata, esp the date when the StreetView img was taken to keep track of when the problem existed.
        var panoramaId = label.getProperty("panoId");
        if ("panoramaContainer" in svl && svl.panoramaContainer && panoramaId && !svl.panoramaContainer.getPanorama(panoramaId)) {
            svl.panoramaContainer.fetchPanoramaMetaData(panoramaId);
        }
    };

    /** Refresh */
    this.refresh = function () {
        for (let key in currentCanvasLabels) {
            if (!(key in prevCanvasLabels)) {
                prevCanvasLabels[key] = currentCanvasLabels[key];
            } else {
                for (var i = 0; i < currentCanvasLabels[key].length; i++) {
                    // Remove any old versions of the label and add the new one.
                    var currLabel = currentCanvasLabels[key][i];
                    prevCanvasLabels[key] = prevCanvasLabels[key].filter(function (l) {
                        return l.getProperty("temporaryLabelId") !== currLabel.getProperty("temporaryLabelId");
                    });
                    prevCanvasLabels[key].push(currLabel);
                }
            }
        }
        currentCanvasLabels = {};
    };

    /**
     * This function removes a passed label, updates the canvas, and updates label counts.
     * @method
     */
    this.removeLabel = function (label) {
        if (!label) { return false; }
        svl.tracker.push('RemoveLabel', {labelType: label.getProperty('labelType')});
        svl.labelCounter.decrement(label.getProperty("labelType"));
        label.remove();
        svl.canvas.clear();
        svl.canvas.render();
        return this;
    };
}
