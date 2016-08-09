/**
 * LabelFactory module.
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function LabelFactory () {
    var self = { className: "LabelFactory" },
        temporaryLabelId = 1;

    function create (path, param) {
        if (path) {
            var label = new Label(path, param);
            if (label) {
                if (!('labelId' in param)) {
                    label.setProperty("temporary_label_id", temporaryLabelId);
                    temporaryLabelId++;
                }
                return label;
            }
        } else {
            // Todo. Definitely need rewrite.
            path = new Path([new Point(svl, 0, 0, {}, {})]);
            return new Label(path, param);
        }
    }

    self.create = create;
    return self;
}