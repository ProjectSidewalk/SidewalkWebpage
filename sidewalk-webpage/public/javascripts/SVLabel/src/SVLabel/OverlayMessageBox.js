var svl = svl || {};

/**
 *
 * @param $ {object} jQuery object
 * @param params {object} other parameters
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function OverlayMessageBox ($, params) {
    var self = { 'className' : 'OverlayMessageBox' },
        properties = { 'visibility' : 'visible' };

    function init() {
        if (svl.ui && svl.ui.overlayMessage) {
          setMessage('Walk');
        }

    }

    /**
     * Set the message in the overlay box
     * @param mode
     * @param message
     * @returns {*}
     */
    function setMessage (mode, message) {
        var instructions = svl.misc.getLabelInstructions(),
            labelColors = svl.misc.getLabelColors();

        if ((mode in instructions) && (mode in labelColors)) {
            // Set the box color.
            var modeColor = labelColors[mode];
            var backgroundColor = changeAlphaRGBA(modeColor.fillStyle, 0.85);
            backgroundColor = changeDarknessRGBA(backgroundColor, 0.35);
            svl.ui.overlayMessage.box.css({
                'background' : backgroundColor
            });
            svl.ui.overlayMessage.message.css({
                'color' : instructions[mode].textColor
            });

            // Set the instructional message.
            if (message) {
                // Manually set a message.
                svl.ui.overlayMessage.message.html(message);
            } else {
                // Otherwise use the pre set message
                svl.ui.overlayMessage.message.html('<strong>' + instructions[mode].instructionalText + '</strong>');
            }
            return this;
        } else {
            return false;
        }
    }


    /**
     * Set the visibility to visible or hidden.
     * @param val
     * @returns {setVisibility}
     */
    function setVisibility (val) {
        if (val === 'visible' || val === 'hidden') {
            properties.visibility = val;
        }
        return this;
    }

    self.setMessage = setMessage;
    self.setVisibility = setVisibility;

    init();

    return self;
}
