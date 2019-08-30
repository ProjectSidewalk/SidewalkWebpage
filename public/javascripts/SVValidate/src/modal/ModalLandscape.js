/**
 * Displays modal popup if user is on mobile and in landscape mode.
 * @param uiModal
 * @returns {Modal Info}
 * @constructor
 */

function ModalLandscape (uiModal) {
    let self = this;

    function hide () {
        uiModal.background.css('visibility', 'hidden');
        uiModal.holder.css('visibility', 'hidden');
        uiModal.foreground.css('visibility', 'hidden');
    }

    function show () {
        uiModal.background.css('visibility', 'visible');
        uiModal.holder.css('visibility', 'visible');
        uiModal.foreground.css('visibility', 'visible');
    }

    self.hide = hide;
    self.show = show;

    return this;
}
