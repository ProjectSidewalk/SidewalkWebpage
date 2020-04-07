/**
 * This module controls the message shown at the top of the Street View pane.
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function OverlayMessageBox (modalModel, uiOverlayMessage) {
    var $helpLink = uiOverlayMessage.holder.find("#overlay-message-help-link");

    this._properties = { 'visibility' : 'visible' };

    this._handleHelpLinkClick = function (e) {
        var labelType = $helpLink.children(0).attr("val");
        var labelTypes = ["CurbRamp", "NoCurbRamp", "SurfaceProblem", "Obstacle"];
        if (labelType != undefined && labelTypes.indexOf(labelType) >= 0) {
            modalModel.showModalExample(labelType);
        }
        svl.tracker.push("ExplainThis_Click", {
            labelType: labelType
        });
    };

    this.setHelpLink = function (labelType) {
        var labelTypes = ["CurbRamp", "NoCurbRamp", "Obstacle", "SurfaceProblem"];

        if (labelTypes.indexOf(labelType) >= 0) {
            $helpLink.html("<span val='" + labelType + "'>" + i18next.t('top-ui.instruction.explain') + "</span>");
        } else {
            $helpLink.html("");
        }
    };

    /**
     * Set the message in the overlay box
     * @param mode
     * @param message
     * @returns {*}
     */
    this.setMessage =function (mode, message) {
        var instructions = util.misc.getLabelInstructions();
        var labelColors = util.misc.getLabelColors();

        // Set the box color.
        var modeColor = labelColors[mode];
        var backgroundColor = util.color.changeAlphaRGBA(modeColor.fillStyle, 0.85);
        backgroundColor = util.color.changeDarknessRGBA(backgroundColor, 0.35);

        uiOverlayMessage.box.css({
            'background' : backgroundColor
        });
        uiOverlayMessage.message.css({
            'color' : instructions[mode].textColor
        });

        // Set the instructional message.
        if (message) {
            uiOverlayMessage.message.html(message);
        } else {
            uiOverlayMessage.message.html('<strong>' + instructions[mode].instructionalText + '</strong>');
            uiOverlayMessage.message.find(".overlay-message-label-type").on('click', function () {
                var labelType = $(this).attr("val");
                modalModel.showModalExample(labelType);
            });
        }
    };

    this.setMessage('Walk');

    $helpLink.on('click', this._handleHelpLinkClick);
}

/**
 * Set the visibility to visible or hidden.
 * @param val
 * @returns {setVisibility}
 */
OverlayMessageBox.prototype.setVisibility = function (val) {
    if (val === 'visible' || val === 'hidden') {
        this._properties.visibility = val;
    }
    return this;
};