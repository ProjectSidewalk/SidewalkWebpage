/**
 *
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function StatusField () {
    var self = { className: "StatusField" },
        blinkInterval;

    // Blink the status field
    function blink () {
        stopBlinking();
        blinkInterval = window.setInterval(function () {
            svl.ui.status.holder.toggleClass("highlight-50");
        }, 500);
    }

    // Stop blinking
    function stopBlinking () {
        window.clearInterval(blinkInterval);
        svl.ui.status.holder.removeClass("highlight-50");
    }

    self.blink = blink;
    self.stopBlinking = stopBlinking;

    return self;
}
