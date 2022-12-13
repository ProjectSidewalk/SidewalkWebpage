/**
 * LabelFactory module.
 * @param svl Todo. Try to get rid of svl dependency
 * @param nextTemporaryLabelId
 * @constructor
 */
function LabelFactory (svl, nextTemporaryLabelId) {
    var temporaryLabelId = nextTemporaryLabelId ? nextTemporaryLabelId : 1;

    this.create = function (path, param) {
        if (path) {
            var label = new Label(svl, path, param);
            if (label) {
                if (!('labelId' in param)) {
                    var currentTask = svl.taskContainer.getCurrentTask();
                    label.setProperty("audit_task_id", currentTask.getAuditTaskId());
                    label.setProperty("temporary_label_id", temporaryLabelId);
                    temporaryLabelId++;
                }
                return label;
            }
        } else {
            path = new Path(svl, [new Point(svl, 0, 0)]);
            return new Label(svl, path, param);
        }
    };
}