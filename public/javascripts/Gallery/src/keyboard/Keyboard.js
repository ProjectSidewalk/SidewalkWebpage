/**
 * A Keyboard module.
 * 
 * @returns {Keyboard} Keyboard object with bindCodeToAction function, codeToAction object.
 * @constructor
 */
function Keyboard() {
    let self = this;

    // Initialization function.
    function _init() {
        // Add the keyboard event listeners. We need { capture: true } for keydown to disable StreetView's shortcuts.
        window.addEventListener('keydown', _documentKeyDown, { capture: true });

        self.codeToAction = {}
    }

    /**
     * This is a callback for a key down event.
     * @param {object} e An event object
     * @private
     */
    function _documentKeyDown(e) {
        // Prevent Google's default panning and moving using arrow keys and WASD.
        // https://stackoverflow.com/a/66069717/9409728
        if (['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].indexOf(e.code) > -1) {
            e.stopPropagation();
        }

        // Check if the pressed key's code is bound to an action.
        if (self.codeToAction.hasOwnProperty(e.code)) {
            // Execute the bound action.
            self.codeToAction[e.code]();
        }
    };

    /**
     * Bind key to action.
     * @param code event.code to match for
     * @param action Function to execute when the event.code is matched
     */
    function bindCodeToAction(code, action) {
        self.codeToAction[code] = action
    };

    _init();

    self.bindCodeToAction = bindCodeToAction;

    return self;
}
