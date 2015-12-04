var svl = svl || {};

/**
 * LabelContainer class constructor
 */
function LabelContainer() {
    var self = {className: 'LabelContainer'};
    var currentCanvasLabels = [],
        prevCanvasLabels = [];

    /**
     * Returns canvas labels
     */
    function getCanvasLabels () {
        return prevCanvasLabels.concat(currentCanvasLabels);
    }

    /**
     *
     */
    function getCurrentLabels () {
        return currentCanvasLabels;
    }

    /**
     * Load labels
     */
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

    }

    /**
     *
     */
    function refresh () {
        prevCanvasLabels = prevCanvasLabels.concat(currentCanvasLabels);
        currentCanvasLabels = [];
    }

    /**
     * Flush the canvasLabels
     */
    function removeAll() {
        currentCanvasLabels = [];
    }

    /**
     * This function removes a passed label and its child path and points
     * @method
     */
    function removeLabel (label) {
        if (!label) {
            return false;
        }
        svl.tracker.push('RemoveLabel', {labelId: label.getProperty('labelId')});

        svl.labelCounter.decrement(label.getProperty("labelType"));
        label.setStatus('deleted', true);
        label.setStatus('visibility', 'hidden');

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