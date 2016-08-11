/**
 * LabelFactory module.
 * @returns {{className: string}}
 * @constructor
 */
function LabelFactory (svl) {
    var self = { className: "LabelFactory" },
        temporaryLabelId = 1;

    function create (path, param) {
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
            // Todo. Need to be rewritten.
            path = new Path(svl, [new Point(svl, 0, 0, {}, {})]);
            return new Label(svl, path, param);
        }
    }

    self.create = create;
    return self;
}