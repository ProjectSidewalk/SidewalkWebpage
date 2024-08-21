/**
 * A Keyboard module.
 * @param {Modal} modal The object for the expanded view modal in the gallery
 * @constructor
 */
function Keyboard(modal) {
    // Initialization function.
    function _init() {
        // Add the keyboard event listeners. We need { capture: true } for keydown to disable StreetView's shortcuts.
        window.addEventListener('keydown', _documentKeyDown, { capture: true });
        window.addEventListener('keyup', _documentKeyUp);
    }

    /**
     * This is a callback for a key down event.
     * @param {object} e An event object
     * @private
     */
    function _documentKeyDown(e) {
        // Prevent Google's default panning and moving using arrow keys and WASD.
        // https://stackoverflow.com/a/66069717/9409728
        if (['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'W', 'A', 'S', 'D'].map((key) => key.toUpperCase()).indexOf(e.key.toUpperCase()) > -1) {
            e.stopPropagation();
        }
    }

    /**
     * This is a callback for a key down event.
     * @param {object} e An event object
     * @private
     */
    function _documentKeyUp(e) {
        switch (e.key.toUpperCase()) {
            case "ARROWLEFT":
                if (modal.open && !modal.leftArrowDisabled) {
                    modal.previousLabel(true)
                }
                break;
            case "ARROWRIGHT":
                if (modal.open && !modal.rightArrowDisabled) {
                    modal.nextLabel(true)
                }
                break;
            case "A":
            case "Y":
                modal.validationMenu.validateOnClickOrKeyPress("validate-agree", false, true)()
                break;
            case "D":
            case "N":
                modal.validationMenu.validateOnClickOrKeyPress("validate-disagree", false, true)()
                break;
            case "U":
                modal.validationMenu.validateOnClickOrKeyPress("validate-unsure", false, true)()
                break;
            default:
                break;
        }
    }

    _init();
}
