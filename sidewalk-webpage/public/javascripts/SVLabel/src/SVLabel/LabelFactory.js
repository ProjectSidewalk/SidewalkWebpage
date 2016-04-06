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
        var label = new Label(path, param);
        if (label) {
            if (!('labelId' in param)) {
                label.setProperty("temporary_label_id", temporaryLabelId);
                temporaryLabelId++;
            }
            return label;
        }
    }

    self.create = create;
    return self;
}