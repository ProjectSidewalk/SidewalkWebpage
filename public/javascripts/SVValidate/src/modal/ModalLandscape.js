/**
 * Displays modal popup if user is on mobile and in landscape mode.
 * @param uiModal
 * @returns {Modal Info}
 * @constructor
 */

function ModalLandscape (uiModal) {
    var self = this;

    function _handleButtonClick() {
        svv.tracker.push("ModalInfo_ClickOK");
        hide();
    }


    function hide () {
        uiModal.background.css('visibility', 'hidden');
        uiModal.holder.css('visibility', 'hidden');
        uiModal.foreground.css('visibility', 'hidden');
    }

    function show () {
        uiModal.background.css('visibility', 'visible');
        uiModal.holder.css('visibility', 'visible');
        uiModal.foreground.css('visibility', 'visible');
        uiModal.closeButton.html('x');
        uiModal.closeButton.on('click', _handleButtonClick);
    }

    uiModal.infoButton.on("click", show);

    self.hide = hide;
    self.show = show;

    return this;
}