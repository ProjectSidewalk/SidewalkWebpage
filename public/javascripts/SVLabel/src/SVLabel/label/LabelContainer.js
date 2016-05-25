/**
 * Label Container module. This is responsible of storing the label objects that were created in the current session.
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function LabelContainer() {
    var self = {className: 'LabelContainer'};
    var currentCanvasLabels = [],
        prevCanvasLabels = [];

    /** Returns canvas labels */
    function getCanvasLabels () { return prevCanvasLabels.concat(currentCanvasLabels); }

    /** Get current label */
    function getCurrentLabels () { return currentCanvasLabels; }

    /** Load labels */
    function load () { currentCanvasLabels = svl.storage.get("labels"); }

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
    }

    /** Refresh */
    function refresh () {
        prevCanvasLabels = prevCanvasLabels.concat(currentCanvasLabels);
        currentCanvasLabels = [];
    }

    /**  Flush the canvasLabels */
    function removeAll() { currentCanvasLabels = []; }

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


    self.getCanvasLabels = getCanvasLabels;
    self.getCurrentLabels = getCurrentLabels;
//    self.load = load;
    self.push = push;
    self.refresh = refresh;
    self.removeAll = removeAll;
    self.removeLabel = removeLabel;
//    self.save = save;
    return self;
}