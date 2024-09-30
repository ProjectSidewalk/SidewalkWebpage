/**
 * A Keyboard module.
 * @param {ExpandedView} ExpandedView The object for the expanded view modal in the gallery
 * @constructor
 */
function Keyboard(ExpandedView) {
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
        if (e.key && ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'W', 'A', 'S', 'D'].map((key) => key.toUpperCase()).indexOf(e.key.toUpperCase()) > -1) {
            e.stopPropagation();
        }
    }

    /**
     * This is a callback for a key down event.
     * @param {object} e An event object
     * @private
     */
    function _documentKeyUp(e) {
        if (e.key) {
            switch (e.key.toUpperCase()) {
                case "ARROWLEFT":
                    if (ExpandedView.open && !ExpandedView.leftArrowDisabled) {
                        ExpandedView.previousLabel(true)
                    }
                    break;
                case "ARROWRIGHT":
                    if (ExpandedView.open && !ExpandedView.rightArrowDisabled) {
                        ExpandedView.nextLabel(true)
                    }
                    break;
                case "A":
                case "Y":
                    ExpandedView.validationMenu.validateOnClickOrKeyPress("validate-agree", false, true)()
                    break;
                case "D":
                case "N":
                    ExpandedView.validationMenu.validateOnClickOrKeyPress("validate-disagree", false, true)()
                    break;
                case "U":
                    ExpandedView.validationMenu.validateOnClickOrKeyPress("validate-unsure", false, true)()
                    break;
                default:
                    break;
            }
        }
    }

    _init();
}
