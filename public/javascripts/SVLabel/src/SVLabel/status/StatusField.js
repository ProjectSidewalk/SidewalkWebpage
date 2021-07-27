/**
 * StatusField constructor
 * @param uiStatusField
 * @constructor
 */
function StatusField (uiStatusField) {
    var self = this;
    var _blinkInterval;

    // Blink the status field
    this.blink = function  () {
        self.stopBlinking();
        _blinkInterval = window.setInterval(function () {
            uiStatusField.holder.toggleClass("highlight-50");
        }, 500);
    };

    // Stop blinking
    this.stopBlinking = function () {
        window.clearInterval(_blinkInterval);
        uiStatusField.holder.removeClass("highlight-50");
    };

    this.hide = function() {
        uiStatusField.holder.hide();
    };

    svl.neighborhoodModel.on("Neighborhood:completed", function() {
        svl.statusField.hide();
    });
}

