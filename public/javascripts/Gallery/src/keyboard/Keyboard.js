/**
 * A Keyboard module.
 * @param {expandedView} expandedView The object for the expanded view modal in the gallery
 * @constructor
 */
function Keyboard(expandedView) {
    // Initialization function.
    function _init() {
        // Add the keyboard event listeners. We need { capture: true } for keydown to disable pano's shortcuts.
        // TODO is that true? Or are we successfully disabling everything in configuration?
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
                    if (expandedView.open && !expandedView.leftArrowDisabled) {
                        expandedView.previousLabel(true)
                    }
                    break;
                case "ARROWRIGHT":
                    if (expandedView.open && !expandedView.rightArrowDisabled) {
                        expandedView.nextLabel(true)
                    }
                    break;
                case "A":
                case "Y":
                    expandedView.validationMenu.validateOnClickOrKeyPress("validate-agree", false, true)()
                    break;
                case "D":
                case "N":
                    expandedView.validationMenu.validateOnClickOrKeyPress("validate-disagree", false, true)()
                    break;
                case "U":
                    expandedView.validationMenu.validateOnClickOrKeyPress("validate-unsure", false, true)()
                    break;
                case "Z":
                    if (expandedView.open) {
                        if (e.shiftKey) {
                            expandedView.zoomOut();
                        } else {
                            expandedView.zoomIn();
                        }
                    }
                    break;
                case "ESCAPE":
                    if (expandedView.open) {
                        expandedView.closeExpandedViewAndRemoveCardTransparency();
                    }
                    break;
                default:
                    break;
            }
        }
    }


    _init();
}
