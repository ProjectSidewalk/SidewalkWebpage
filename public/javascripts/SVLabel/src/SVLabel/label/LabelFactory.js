/**
 * LabelFactory module.
 * @param svl Todo. Try to get rid of svl dependency
 * @constructor
 */
function LabelFactory (svl) {
    var temporaryLabelId = 1;

    this.create = function (path, param) {
        if (path) {
            var label = new Label(svl, path, param);
            if (label) {
                if (!('labelId' in param)) {
                    label.setProperty("temporary_label_id", temporaryLabelId);
                    temporaryLabelId++;
                }
                return label;
            }
        } else {
            path = new Path(svl, [new Point(svl, 0, 0, {}, {})]);
            return new Label(svl, path, param);
        }
    };
}