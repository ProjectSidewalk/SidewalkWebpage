/**
 * Label Container module. This is responsible of storing the label objects that were created in the current session.
 * @param $ jQuery object
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function LabelContainer($) {
    var self = this;
    var currentCanvasLabels = [],
        prevCanvasLabels = [];

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

    /**
     * Fetches all the labels that the user has placed in given region
     * @param regionId - ID of region
     * @param callback - function to handle response
     */
    this.miniMapLabelsInRegion = function (regionId, callback) {
        $.getJSON(
            '/label/miniMapResume',
            { regionId: regionId },
            function (result) {
                if (callback) callback(result);
            });
    };

    // TODO: Right now the labels just have no audit_task_id,
    //  make sure to set that and retrieve from database.
    this.fetchLabelsToResumeMission = function (regionId, callback) {
        //TODO: This method is ugly af, clean it up
        $.getJSON(
            '/label/resumeMission',
            { regionId: regionId },
            function (result) {
                let labelArr = result.labels;
                let len = labelArr.length;
                console.log(labelArr.length)
                for (let i = 0; i < len; i++) {
                    let pov = {
                        heading: labelArr[i].panoramaHeading,
                        pitch: labelArr[i].panoramaPitch,
                        zoom: labelArr[i].panoramaZoom
                    };

                    let iconImagePath = util.misc.getIconImagePaths(labelArr[i].labelType).iconImagePath;

                    var pointParameters = {
                        'fillStyleInnerCircle': util.misc.getLabelColors()[labelArr[i].labelType].fillStyle,
                        'lineWidthOuterCircle': 2,
                        'iconImagePath': iconImagePath,
                        'radiusInnerCircle': 13,
                        'radiusOuterCircle': 14,
                        'strokeStyleOuterCircle': 'rgba(255,255,255,1)',
                        'storedInDatabase': true
                    };

                    let path = new Path(svl, [new Point(svl, labelArr[i].canvasX, labelArr[i].canvasY, pov, pointParameters)]);
                    let label = svl.labelFactory.create(path, labelArr[i]);
                    label.setProperty("audit_task_id", labelArr[i].audit_task_id);

                    //TODO: Can't push to current labels since it counts the labels too many times
                    self.push(label);
                }

                if (callback) callback(result);
            }
        )
    }

    /**
     * Returns canvas labels.
     */
    this.getCanvasLabels = function () {
        return prevCanvasLabels.concat(currentCanvasLabels);
    };

    /** Get current label */
    this.getCurrentLabels = function () {
        return currentCanvasLabels;
    };

    this.getPreviousLabels = function () {
        return prevCanvasLabels;
    };

    //find most recent instance of label with matching temporary ID
    this.findLabelByTempId = function (tempId) {
        var matchingLabels =  _.filter(svl.labelContainer.getCanvasLabels(),
            function(label) {
                return label.getProperty("temporary_label_id") === tempId;
            });

        if(matchingLabels.length === 0){
            return null;
        }

        //returns most recent version of label
        return matchingLabels[matchingLabels.length - 1];
    };

    //remove old versions of this label, add updated label
    this.addUpdatedLabel = function (tempId) {
        var otherLabels = _.filter(currentCanvasLabels,
            function(label){
                return label.getProperty("temporary_label_id") !== tempId;
            });

        //if there are no temporary labels with this ID in currentCanvasLabels
        //then add it to that list
        //otherwise get rid of all old instances in currentCanvasLabels and add the updated label

        var match = this.findLabelByTempId(tempId);

        // Label with this id doesn't exist in currentCanvasLabels
        if(otherLabels.length === currentCanvasLabels.length){
            currentCanvasLabels.push(match);
        } else {
            currentCanvasLabels = otherLabels;
            if(match !== null)
                currentCanvasLabels.push(match);
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
        currentCanvasLabels.push(label);
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
        prevCanvasLabels = prevCanvasLabels.concat(currentCanvasLabels);
        currentCanvasLabels = [];
    };

    /**  Flush the canvasLabels */
    this.removeAll = function () {
        currentCanvasLabels = [];
    };

    /**
     * This function removes a passed label and its child path and points
     * @method
     */
    this.removeLabel = function (label) {
        if (!label) { return false; }
        svl.tracker.push('RemoveLabel', {labelId: label.getProperty('labelId')});
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
