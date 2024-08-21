/**
 * A Keyboard module.
 * 
 * @returns {Keyboard} Keyboard object with bindKeyToAction function, keyToAction object.
 * @constructor
 */
function Keyboard() {
    let self = this;

    // Initialization function.
    function _init() {
        // Add the keyboard event listeners. We need { capture: true } for keydown to disable StreetView's shortcuts.
        window.addEventListener('keydown', _documentKeyDown, { capture: true });
        window.addEventListener('keyup', _documentKeyUp);

        self.keyToAction = {}
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
        // Check if the pressed key is bound to an action.
        if (self.keyToAction.hasOwnProperty(e.key.toUpperCase())) {
            // Execute the bound action.
            self.keyToAction[e.key.toUpperCase()]();
        }
    }

    /**
     * Bind key to action.
     * @param key event.key to match for
     * @param action Function to execute when the event.key is matched
     */
    function bindKeyToAction(key, action) {
        self.keyToAction[key.toUpperCase()] = action
    }

    _init();

    self.bindKeyToAction = bindKeyToAction;

    return self;
}
