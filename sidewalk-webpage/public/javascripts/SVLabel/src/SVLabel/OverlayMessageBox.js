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
    var self = {
            'className' : 'OverlayMessageBox'
        };
    var properties = {
            'visibility' : 'visible'
        };
    var status = {};

    var $divOverlayMessage;
    var $divOverlayMessageBox;

    ////////////////////////////////////////
    // Private functions
    ////////////////////////////////////////
    function init() {
        // Initialization function.
        if (svl.ui && svl.ui.overlayMessage) {
          $divOverlayMessage = svl.ui.overlayMessage.message;
          $divOverlayMessageBox = svl.ui.overlayMessage.box;

          self.setMessage('Walk');
        }

    }

    ////////////////////////////////////////
    // Public functions
    ////////////////////////////////////////
    self.setMessage = function (mode, message) {
        var instructions = svl.misc.getLabelInstructions(),
            labelColors = svl.misc.getLabelColors();

        if ((mode in instructions) &&
            (mode in labelColors)) {
            // Set the box color.
            var modeColor = labelColors[mode];
            var backgroundColor = changeAlphaRGBA(modeColor.fillStyle, 0.85);
            backgroundColor = changeDarknessRGBA(backgroundColor, 0.35);
            $divOverlayMessageBox.css({
                'background' : backgroundColor
            });
            $divOverlayMessage.css({
                'color' : instructions[mode].textColor
            });

            // Set the instructional message.
            if (message) {
                // Manually set a message.
                $divOverlayMessage.html(message);
            } else {
                // Otherwise use the pre set message
                $divOverlayMessage.html('<strong>' + instructions[mode].instructionalText + '</strong>');
            }
            return this;
        } else {
            return false;
        }
    };

    self.setVisibility = function (val) {
        // Set the visibility to visible or hidden.
        if (val === 'visible' || val === 'hidden') {
            properties.visibility = val;
        }
        return this;
    };

    ////////////////////////////////////////
    // Initialization
    ////////////////////////////////////////
    init();

    return self;
}
