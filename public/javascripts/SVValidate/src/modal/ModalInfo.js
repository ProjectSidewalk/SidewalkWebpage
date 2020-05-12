/**
 * Handles info button functionality. Used for mobile. Pops up information about the current label.
 * @param uiModal
 * @param modalText
 * @returns {Modal Info}
 * @constructor
 */

function ModalInfo (uiModal, modalText) {
    let self = this;

    let infoHeaderHTML = '<p>What is a __LABELTYPE_PLACEHOLDER__?</p>';
    let descriptionHTML = '<p>__DESCRIPTION_PLACEHOLDER__</p>';

    function _handleButtonClick() {
        svv.tracker.push("ModalInfo_ClickOK");
        hide();
    }


    function hide () {
        uiModal.background.css('visibility', 'hidden');
        uiModal.holder.css('visibility', 'hidden');
        uiModal.foreground.css('visibility', 'hidden');
    }

    function setMissionInfo(mission) {
        infoHeaderHTML = i18next.t('mobile.info-title-' + svv.labelTypes[mission.getProperty("labelTypeId")]);
        descriptionHTML = modalText[mission.getProperty("labelTypeId")];
    }

    function show () {
        uiModal.background.css('visibility', 'visible');
        uiModal.holder.css('visibility', 'visible');
        uiModal.foreground.css('visibility', 'visible');
        uiModal.infoHeader.html(infoHeaderHTML);
        uiModal.description.html(descriptionHTML);
        uiModal.closeButton.html('x');
        uiModal.closeButton.on('click', _handleButtonClick);
    }

    uiModal.infoButton.on("click", show);

    self.hide = hide;
    self.setMissionInfo = setMissionInfo;
    self.show = show;

    return this;
}
