/**
 * A Keyboard module.
 * @param {Modal} modal The object for the expanded view modal in the gallery
 * @constructor
 * @param {RightMenu} rightMenu
 * @constructor
 */
// function Keyboard(modal) {
//     // Initialization function.
//     function _init() {
//         // Add the keyboard event listeners. We need { capture: true } for keydown to disable StreetView's shortcuts.
//         window.addEventListener('keydown', _documentKeyDown, { capture: true });
//         window.addEventListener('keyup', _documentKeyUp);
//     }

//     /**
//      * This is a callback for a key down event.
//      * @param {object} e An event object
//      * @private
//      */
//     function _documentKeyDown(e) {
//         // Prevent Google's default panning and moving using arrow keys and WASD.
//         // https://stackoverflow.com/a/66069717/9409728
//         if (e.key && ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'W', 'A', 'S', 'D'].map((key) => key.toUpperCase()).indexOf(e.key.toUpperCase()) > -1) {
//             e.stopPropagation();
//         }
//     }

//     /**
//      * This is a callback for a key down event.
//      * @param {object} e An event object
//      * @private
//      */
//     function _documentKeyUp(e) {
//         if (e.key) {
//             switch (e.key.toUpperCase()) {
//                 case "ARROWLEFT":
//                     if (modal.open && !modal.leftArrowDisabled) {
//                         modal.previousLabel(true)
//                     }
//                     break;
//                 case "ARROWRIGHT":
//                     if (modal.open && !modal.rightArrowDisabled) {
//                         modal.nextLabel(true)
//                     }
//                     break;
//                 case "A":
//                 case "Y":
//                     modal.validationMenu.validateOnClickOrKeyPress("validate-agree", false, true)()
//                     break;
//                 case "D":
//                 case "N":
//                     modal.validationMenu.validateOnClickOrKeyPress("validate-disagree", false, true)()
//                     break;
//                 case "U":
//                     modal.validationMenu.validateOnClickOrKeyPress("validate-unsure", false, true)()
//                     break;

//                 default:
//                     break;
//             }
//         }
//     }

//     _init();
// }

function Keyboard(modal, rightMenu) {
    let self = this;
  
    function _init() {
      // Set up event listeners for keydown and keyup events on the window object.
      window.addEventListener('keydown', _documentKeyDown);
      window.addEventListener('keyup', _documentKeyUp);
    }
  
    function _documentKeyDown(e) {
      // Prevent Google's default panning and moving using arrow keys and WASD.
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'w' || e.key === 'a' || e.key === 's' || e.key === 'd') {
        e.preventDefault();
      }
    }
  
    function _documentKeyUp(e) {
      // Check the pressed key and perform actions accordingly.
      if (modal.isOpen()) {
        // If the modal is open, call methods on the modal instance.
        if (e.key === 'ArrowLeft') {
          modal.previousLabel();
        } else if (e.key === 'ArrowRight') {
          modal.nextLabel();
        } else if (e.key === 'Enter') {
          modal.validationMenu.validateOnClickOrKeyPress();
        }
      } else if (rightMenu.isOpen()) {
        // If the right menu is open, call methods on the right menu instance.
        if (e.key === '1') {
          rightMenu._setYesView();
        } else if (e.key === '2') {
          rightMenu._setNoView();
        } else if (e.key === '3') {
          rightMenu._setUnsureView();
        } else if (e.key === '4') {
          rightMenu.menuUI.disagreeReasonTextBox.focus();
        } else if (e.key === 'Escape') {
          rightMenu.menuUI.disagreeReasonTextBox.blur();
        }
      }
    }
  
    _init();
    return self;
  }
