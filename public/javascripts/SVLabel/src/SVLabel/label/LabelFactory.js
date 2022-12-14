/**
 * LabelFactory module.
 * @param svl Todo. Try to get rid of svl dependency
 * @param nextTemporaryLabelId
 * @constructor
 */
function LabelFactory (svl, nextTemporaryLabelId) {
    var temporaryLabelId = nextTemporaryLabelId ? nextTemporaryLabelId : 1;

    this.create = function (param) {
        var label = new Label(svl, param);

        // If the label is new, it won't have a labelId yet, so assign a temporary one.
        if (label && !('labelId' in param)) {
            var currentTask = svl.taskContainer.getCurrentTask();
            label.setProperty("audit_task_id", currentTask.getAuditTaskId());
            label.setProperty("temporary_label_id", temporaryLabelId);
            temporaryLabelId++;
        }

        return label;
    };
}
