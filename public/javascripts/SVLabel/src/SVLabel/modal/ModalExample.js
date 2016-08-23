/**
 * Modal windows for the examples of accessibility attributes
 * @returns {{className: string}}
 * @constructor
 */
function ModalExample (modalModel, uiModalExample) {
    var self = this;

    this._handleBackgroundClick = function () {
        hide();
    };

    this._handleCloseButtonClick = function () {
        hide();
    };

    this.hide = function () {
        uiModalExample.curbRamp.addClass("hidden");
        uiModalExample.noCurbRamp.addClass("hidden");
        uiModalExample.obstacle.addClass("hidden");
        uiModalExample.surfaceProblem.addClass("hidden");
    };

    this.show = function (key) {
        this.hide();
        switch (key) {
            case "CurbRamp":
                uiModalExample.curbRamp.removeClass("hidden");
                break;
            case "NoCurbRamp":
                uiModalExample.noCurbRamp.removeClass("hidden");
                break;
            case "Obstacle":
                uiModalExample.obstacle.removeClass("hidden");
                break;
            case "SurfaceProblem":
                uiModalExample.surfaceProblem.removeClass("hidden");
                break;
        }
    };

    uiModalExample.close.on("click", this._handleCloseButtonClick);
    uiModalExample.background.on("click", this._handleBackgroundClick);
}