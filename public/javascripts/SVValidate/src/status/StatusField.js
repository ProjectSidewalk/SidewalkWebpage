/**
 * Updates items that appear on the right side of the validation interface (i.e., label counts)
 * @returns {StatusField}
 * @constructor
 */
function StatusField() {
    var self = this;
    function updateLabelCounts(count) {
        svv.ui.status.labelCount.html(count);
    }

    // TODO: write resizeTextSize function, if necessary

    self.updateLabelCounts = updateLabelCounts;

    return this;
}