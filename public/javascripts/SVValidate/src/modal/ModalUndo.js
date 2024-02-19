/**
 * Handles undo button functionality. Allows users to go back to the previous
 * label they have validated and re-do the validation
 * @param uiModal   Undo button UI elements.
 * @returns {ModalUndo}
 * @constructor
 */
function ModalUndo (uiModal) {
    let status = {
        disableUndo: false
    };
    let self = this;

    /**
     * Enables the undo button (makes button clickable).
     */
    function enableUndo() {
        status.disableUndo = false;
        uiModal.undoButtonWeb.attr("disabled", false);
        uiModal.undoButtonWeb.removeClass("disabled");
        uiModal.undoButtonMobile.attr("disabled", false);
        uiModal.undoButtonMobile.removeClass("disabled");
    }

    /**
     * Disables the undo button (makes button unclickable).
     */
    function disableUndo() {
        status.disableUndo = true;
        uiModal.undoButtonWeb.attr("disabled", true);
        uiModal.undoButtonWeb.addClass("disabled");
        uiModal.undoButtonMobile.attr("disabled", true);
        uiModal.undoButtonMobile.addClass("disabled");
        svv.panorama.setLastLabel({});
    }

    /**
     * Goes back to the previous label (decrements user's progress).
     */
    function undo() {
        svv.tracker.push("ModalUndo_ClickOK");
        svv.missionContainer.updateAMissionUndo();
        svv.panorama.undoLabel();
        disableUndo();
    }

    uiModal.undoButtonWeb.on("click", undo);
    uiModal.undoButtonMobile.on("click", undo);

    self.enableUndo = enableUndo;
    self.disableUndo = disableUndo;

    return this;
}
