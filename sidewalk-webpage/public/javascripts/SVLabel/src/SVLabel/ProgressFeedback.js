var svl = svl || {};

/**
 *
 * @param $
 * @param params
 * @returns {{className: string}}
 * @constructor
 */
function ProgressFeedback ($, params) {
    var self = { className : 'ProgressFeedback' };
    var properties = {
        progressBarWidth : undefined
    };
    var status = {
        progress : undefined
    };

    // jQuery elements
    var $progressBarContainer;
    var $progressBarFilled;
    var $progressMessage;

    function init (params) {
        $progressBarContainer = $("#ProgressBarContainer");
        $progressBarFilled = $("#ProgressBarFilled");
        $progressMessage = $("#Progress_Message");

        properties.progressBarWidth = $progressBarContainer.width();

        if (params && params.message) {
            self.setMessage(params.message);
        } else {
            self.setMessage('');
        }

        self.setProgress(0);
    }


    self.setMessage = function (message) {
        // This function sets a message box in the feedback area.
        $progressMessage.html(message);
    };


    self.setProgress = function (progress) {
        // Check if the passed argument is a number. If not, try parsing it as a
        // float value. If it fails (if parseFloat returns NaN), then throw an error.
        if (typeof progress !== "number") {
            progress = parseFloat(progress);
        }

        if (progress === NaN) {
            throw new TypeError(self.className + ': The passed value cannot be parsed.');
        }

        if (progress > 1) {
            progress = 1.0;
            console.error(self.className + ': You can not pass a value larger than 1 to setProgress.');
        }

        status.progress = progress;

        if (properties.progressBarWidth) {
            var r;
            var g;
            var color;

            if (progress < 0.5) {
                r = 255;
                g = parseInt(255 * progress * 2);
            } else {
                r = parseInt(255 * (1 - progress) * 2);
                g = 255;
            }

            color = 'rgba(' + r + ',' + g + ',0,1)';
            $progressBarFilled.css({
                background: color,
                width: progress * properties.progressBarWidth
            });
        }

        return this;
    };

    init(params);
    return self;
}
