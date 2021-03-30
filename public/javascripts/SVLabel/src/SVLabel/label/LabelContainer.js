/**
 * Label Container module. This is responsible of storing the label objects that were created in the current session.
 * @param $ jQuery object
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function LabelContainer($) {
    var self = this;
    var currentCanvasLabels = {},
        prevCanvasLabels = {};

    var neighborhoodLabels = {};

    this.countLabels = function (regionId) {
        if (regionId) {
            if (regionId in neighborhoodLabels) {
                // return neighborhoodLabels[regionId].filter(function (l) { return l.getStatus("deleted"); }).length;
                return neighborhoodLabels[regionId].length;  // Todo. Filter out the deleted ones.
            } else {
                return 0;
            }
        }
    };

    this.fetchLabelsInANeighborhood = function (regionId, callback) {
        $.getJSON("/userapi/labels?regionId=" + regionId, function (data) {
            if ("features" in data) {
                var features = data.features,
                    label,
                    i = 0,
                    len = features.length;
                for (; i < len; i++) {
                    label = svl.labelFactory.create(null, {
                        labelId: features[i].properties.label_id
                    });
                    self.pushToNeighborhoodLabels(regionId, label);  // NOTE: I should actually convert each JSON object into a Label.
                }
                if (callback) callback();
            }
        });
    };

    this.fetchLabelsInTheCurrentMission = function (regionId, callback) {
        $.getJSON(
            '/label/currentMission',
            { regionId: regionId },
            function (result) {
                if (callback) callback(result);
            });
    };

    this.fetchLabelsToResumeMission = function (regionId, callback) {
        $.getJSON('/label/resumeMission', { regionId: regionId }, function (result) {
            let labelArr = result.labels;
            let len = labelArr.length;
            for (let i = 0; i < len; i++) {
                let povChange = svl.map.getPovChangeStatus();

                // Temporarily change pov change status to true so that we can use util function to calculate the canvas
                // coordinate to place label upon rerender. This is so the labels appear in the correct location
                // relative to the initial POV.
                povChange["status"] = true;

                let originalCanvasCoord = {
                    x: labelArr[i].canvasX,
                    y: labelArr[i].canvasY
                };

                let originalPov = {
                    heading: labelArr[i].panoramaHeading,
                    pitch: labelArr[i].panoramaPitch,
                    zoom: labelArr[i].panoramaZoom
                };

                let originalPointPov = {
                    originalPov: util.panomarker.calculatePointPov(labelArr[i].canvasX, labelArr[i].canvasY, originalPov)
                };

                let rerenderCanvasCoord = util.panomarker.getCanvasCoordinate(
                    originalCanvasCoord, originalPointPov.originalPov, svl.map.getPov()
                );

                // Return the status to original.
                povChange["status"] = false;

                let iconImagePath = util.misc.getIconImagePaths(labelArr[i].labelType).iconImagePath;
                let labelFillStyle = util.misc.getLabelColors()[labelArr[i].labelType].fillStyle;

                var pointParameters = {
                    'fillStyleInnerCircle': labelFillStyle,
                    'lineWidthOuterCircle': 2,
                    'iconImagePath': iconImagePath,
                    'radiusInnerCircle': 13,
                    'radiusOuterCircle': 14,
                    'strokeStyleOuterCircle': 'rgba(255,255,255,1)',
                    'storedInDatabase': true
                };

                let labelPoint = new Point(
                    svl, rerenderCanvasCoord.x, rerenderCanvasCoord.y, svl.map.getPov(), pointParameters
                );
                
                labelPoint.setProperties(originalPointPov);

                let path = new Path(svl, [labelPoint]);
                let label = svl.labelFactory.create(path, labelArr[i]);
                label.setProperty("audit_task_id", labelArr[i].audit_task_id);
                label.setProperty("labelLat", labelArr[i].labelLat);
                label.setProperty("labelLng", labelArr[i].labelLng);
                label.setProperty("labelFillStyle", labelFillStyle);

                // Prevent tag from being rendered initially
                label.setTagVisibility('hidden');
                
                if (!(label.getPanoId() in prevCanvasLabels)) {
                    prevCanvasLabels[label.getPanoId()] = [];
                }

                prevCanvasLabels[label.getPanoId()].push(label);

                if ("neighborhoodContainer" in svl && "neighborhoodContainer" in svl) {
                    var regionId = svl.neighborhoodContainer.getCurrentNeighborhood().getProperty("regionId");
                    svl.labelContainer.pushToNeighborhoodLabels(regionId, label);
                }
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
     * Get current labels. 
     * Note that this grabs labels from all panoIds in current session.
     */
    this.getCurrentLabels = function () {
        return Object.keys(currentCanvasLabels).reduce(function (r, k) {
            return r.concat(currentCanvasLabels[k]);     
        }, []);
    };

    /**
     * Get previous labels.
     * Note that this grabs labels from all panoIds in current session. 
     */
    this.getPreviousLabels = function () {
        return Object.keys(prevCanvasLabels).reduce(function (r, k) {
            return r.concat(prevCanvasLabels[k]);     
        }, []);
    };

    // Find most recent instance of label with matching temporary ID.
    this.findLabelByTempId = function (tempId) {
        var matchingLabels =  _.filter(svl.labelContainer.getCanvasLabels(),
            function(label) {
                return label.getProperty("temporary_label_id") === tempId;
            });

        if(matchingLabels.length === 0){
            return null;
        }

        // Returns most recent version of label.
        return matchingLabels[matchingLabels.length - 1];
    };

    // Remove old versions of this label, add updated label.
    this.addUpdatedLabel = function (tempId) {
        // All labels that don't have the specified tempId reduced to an array.
        var otherLabels = _.filter(this.getCurrentLabels(),
            function(label){
                return label.getProperty("temporary_label_id") !== tempId;
            });

        // If there are no temporary labels with this ID in currentCanvasLabels
        // then add it to that list.
        // Otherwise get rid of all old instances in currentCanvasLabels and add the updated label.

        var match = this.findLabelByTempId(tempId);

        // Label with this id doesn't exist in currentCanvasLabels as the
        // filtered vs unfiltered arrays are the same length.
        if(otherLabels.length === this.getCurrentLabels().length){
            if (!(match.getPanoId() in currentCanvasLabels)) {
                currentCanvasLabels[match.getPanoId()] = [];
            }
            
            // Add updated label
            currentCanvasLabels[match.getPanoId()].push(match);
        } else {
            for (let key in currentCanvasLabels) {
                currentCanvasLabels[key] = currentCanvasLabels[key].filter(label => label.getProperty("temporary_label_id") !== tempId);
            }

            if(match !== null) {
                if (!(match.getPanoId() in currentCanvasLabels)) {
                    currentCanvasLabels[match.getPanoId()] = [];
                }
            
                // Add updated label
                currentCanvasLabels[match.getPanoId()].push(match);
            }
        }
    };

    /** Load labels */
    function load () {
        currentCanvasLabels = svl.storage.get("labels");
    }

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

        // Keep panorama meta data, especially the date when the Street View picture was taken to keep track of when the problem existed
        var panoramaId = label.getProperty("panoId");
        if ("panoramaContainer" in svl && svl.panoramaContainer && panoramaId && !svl.panoramaContainer.getPanorama(panoramaId)) {
            svl.panoramaContainer.fetchPanoramaMetaData(panoramaId);
        }

        if ("neighborhoodContainer" in svl && "neighborhoodContainer" in svl) {
            var regionId = svl.neighborhoodContainer.getCurrentNeighborhood().getProperty("regionId");
            svl.labelContainer.pushToNeighborhoodLabels(regionId, label);
        }
    };

    /**
     * Push a label into neighborhoodLabels
     * @param neighborhoodId
     * @param label
     */
    this.pushToNeighborhoodLabels = function (neighborhoodId, label) {
        if (!(neighborhoodId in neighborhoodLabels)) {
            neighborhoodLabels[neighborhoodId] = [];
        }

        // Do not add if there are duplicates
        var i = 0,
            len = neighborhoodLabels[neighborhoodId].length,
            storedLabel;
        for (; i < len; i++) {
            storedLabel = neighborhoodLabels[neighborhoodId][i];

            if (storedLabel.getProperty("labelId") !== "DefaultValue" &&
                storedLabel.getProperty("labelId") === label.getProperty("labelId")) {
                return;
            }

            if (storedLabel.getProperty("temporary_label_id") &&
                storedLabel.getProperty("temporary_label_id") === label.getProperty("temporary_label_id")) {
                return
            }
        }
        neighborhoodLabels[neighborhoodId].push(label);
    };

    /** Refresh */
    this.refresh = function () {
        //prevCanvasLabels = prevCanvasLabels.concat(currentCanvasLabels);
        for (let key in currentCanvasLabels) {
            if (!(key in prevCanvasLabels)) {
                prevCanvasLabels[key] = currentCanvasLabels[key];
            } else {
                prevCanvasLabels[key] = prevCanvasLabels[key].concat(currentCanvasLabels[key]);
            }
        }

        currentCanvasLabels = {};
    };

    /**  Flush the canvasLabels */
    this.removeAll = function () {
        currentCanvasLabels = {};
    };

    /**
     * This function removes a passed label and its child path and points
     * @method
     */
    this.removeLabel = function (label) {
        if (!label) { return false; }
        svl.tracker.push('RemoveLabel', {labelType: label.getProperty('labelType')});
        svl.labelCounter.decrement(label.getProperty("labelType"));
        label.remove();

        var regionId = svl.neighborhoodContainer.getCurrentNeighborhood().getProperty("regionId");
        neighborhoodLabels[regionId].pop(label);

        svl.canvas.clear();
        svl.canvas.render();
        return this;
    };

    function save () {
        svl.storage.set("labels", currentCanvasLabels);
    }
}
