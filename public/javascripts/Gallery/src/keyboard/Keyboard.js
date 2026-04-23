/**
 * A Keyboard module for Gallery keyboard shortcuts.
 * @param {ExpandedView} expandedView The object for the expanded view in the gallery.
 * @constructor
 */
function Keyboard(expandedView) {
    /**
     * Initialization function.
     */
    function _init() {
        window.addEventListener('keyup', _documentKeyUp);
    }

    /**
     * Callback for key-up events. Routes keyboard shortcuts to the appropriate expanded-view actions.
     * @param {KeyboardEvent} e
     * @private
     */
    function _documentKeyUp(e) {
        // Prevent shortcuts in the comment box.
        const activeTag = document.activeElement && document.activeElement.tagName;
        if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;

        if (e.key && !e.ctrlKey) {
            switch (e.key.toUpperCase()) {
                case 'ARROWLEFT':
                    if (expandedView.open && !expandedView.leftArrowDisabled) {
                        expandedView.previousLabel(true);
                    }
                    break;
                case 'ARROWRIGHT':
                    if (expandedView.open && !expandedView.rightArrowDisabled) {
                        expandedView.nextLabel(true);
                    }
                    break;
                case 'A':
                case 'Y':
                    expandedView.validate('Agree');
                    break;
                case 'D':
                case 'N':
                    expandedView.validate('Disagree');
                    break;
                case 'U':
                    expandedView.validate('Unsure');
                    break;
                case 'Z':
                    if (expandedView.open) {
                        if (e.shiftKey) {
                            expandedView.panoManager.zoomOut();
                        } else {
                            expandedView.panoManager.zoomIn();
                        }
                    }
                    break;
                case 'ESCAPE':
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
