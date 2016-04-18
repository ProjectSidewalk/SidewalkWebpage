/**
 * Modal windows for the examples of accessibility attributes
 * @returns {{className: string}}
 * @constructor
 */
function ModalExample () {
    var self = { className: "ModalExample" };

    function _init () {
        svl.ui.modalExample.close.on("click", handleCloseButtonClick);
        svl.ui.modalExample.background.on("click", handleBackgroundClick);
    }

    function handleBackgroundClick () {
        hide();
    }

    function handleCloseButtonClick () {
        hide();
    }

    function hide () {
        svl.ui.modalExample.curbRamp.addClass("hidden");
        svl.ui.modalExample.noCurbRamp.addClass("hidden");
        svl.ui.modalExample.obstacle.addClass("hidden");
        svl.ui.modalExample.surfaceProblem.addClass("hidden");
    }

    function show (key) {
        hide();
        switch (key) {
            case "CurbRamp":
                svl.ui.modalExample.curbRamp.removeClass("hidden");
                break;
            case "NoCurbRamp":
                svl.ui.modalExample.noCurbRamp.removeClass("hidden");
                break;
            case "Obstacle":
                svl.ui.modalExample.obstacle.removeClass("hidden");
                break;
            case "SurfaceProblem":
                svl.ui.modalExample.surfaceProblem.removeClass("hidden");
                break;
        }
    }

    self.hide = hide;
    self.show = show;

    _init();
    
    return self;
}