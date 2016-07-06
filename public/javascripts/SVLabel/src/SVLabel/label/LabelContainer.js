/**
 * Label Container module. This is responsible of storing the label objects that were created in the current session.
 * @param $ jQuery object
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function LabelContainer($) {
    var self = {className: 'LabelContainer'};
    var currentCanvasLabels = [],
        prevCanvasLabels = [];

    var neighborhoodLabels = {};

    function _init() {
    }

    function countLabels(regionId) {
        if (regionId) {
            if (regionId in neighborhoodLabels) {
                // return neighborhoodLabels[regionId].filter(function (l) { return l.getStatus("deleted"); }).length;
                return neighborhoodLabels[regionId].length;  // Todo. Filter out the deleted ones.
            } else {
                return 0;
            }
        }
    }

    function fetchLabelsInANeighborhood(regionId, callback) {
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
                    pushToNeighborhoodLabels(regionId, label);  // NOTE: I should actually convert each JSON object into a Label.
                }
                if (callback) callback();
            }
        });
    }

    /**
     * Returns canvas labels. NOTE: I don't think this is used anywhere anymore.
     */
    function getCanvasLabels () {
        return prevCanvasLabels.concat(currentCanvasLabels);
    }

    /** Get current label */
    function getCurrentLabels () {
        return currentCanvasLabels;
    }

    function getPreviousLabels () {
        return prevCanvasLabels;
    }

    /** Load labels */
    function load () {
        currentCanvasLabels = svl.storage.get("labels");
    }

    /**
     * Push a label into canvasLabels
     * @param label
     */
    function push(label) {
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
            
    }

    /**
     * Push a label into neighborhoodLabels
     * @param neighborhoodId
     * @param label
     */
    function pushToNeighborhoodLabels(neighborhoodId, label) {
        if (!(neighborhoodId in neighborhoodLabels)) {
            neighborhoodLabels[neighborhoodId] = [];
        }

        // Do not add if there are duplicates
        var i = 0,
            len = neighborhoodLabels[neighborhoodId].length,
            storedLabel;
        for (; i < len; i++) {
            storedLabel = neighborhoodLabels[neighborhoodId][i];

            if (storedLabel.getProperty("labelId") != "DefaultValue" &&
                storedLabel.getProperty("labelId") == label.getProperty("labelId")) {
                return;
            }

            if (storedLabel.getProperty("temporary_label_id") &&
                storedLabel.getProperty("temporary_label_id") == label.getProperty("temporary_label_id")) {
                return
            }
        }
        neighborhoodLabels[neighborhoodId].push(label);
    }

    /** Refresh */
    function refresh () {
        prevCanvasLabels = prevCanvasLabels.concat(currentCanvasLabels);
        currentCanvasLabels = [];
    }

    /**  Flush the canvasLabels */
    function removeAll() {
        currentCanvasLabels = [];
    }

    /**
     * This function removes a passed label and its child path and points
     * @method
     */
    function removeLabel (label) {
        if (!label) { return false; }
        svl.tracker.push('RemoveLabel', {labelId: label.getProperty('labelId')});
        svl.labelCounter.decrement(label.getProperty("labelType"));
        label.remove();

        // Review label correctness if this is a ground truth insertion task.
        if (("goldenInsertion" in svl) &&
            svl.goldenInsertion &&
            svl.goldenInsertion.isRevisingLabels()) {
            svl.goldenInsertion.reviewLabels();
        }

        svl.canvas.clear();
        svl.canvas.render();
        return this;
    }

    function save () {
        svl.storage.set("labels", currentCanvasLabels);
    }

    self.countLabels = countLabels;
    self.fetchLabelsInANeighborhood = fetchLabelsInANeighborhood;
    self.getCanvasLabels = getCanvasLabels;
    self.getCurrentLabels = getCurrentLabels;
    self.getPreviousLabels = getPreviousLabels;
//    self.load = load;
    self.push = push;
    self.pushToNeighborhoodLabels = pushToNeighborhoodLabels;
    self.refresh = refresh;
    self.removeAll = removeAll;
    self.removeLabel = removeLabel;
//    self.save = save;

    _init();
    return self;
}