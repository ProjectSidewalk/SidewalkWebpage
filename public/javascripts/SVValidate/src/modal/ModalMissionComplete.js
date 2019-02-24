function ModalMission (uiModalMission) {
    var self = this;

    function hide () {
        uiModalMission.background.css('visibility', 'hidden');
        uiModalMission.holder.css('visibility', 'hidden');
        uiModalMission.foreground.css('visibility', 'hidden');
    }

    function show (title, instruction) {
        uiModalMission.background.css('visibility', 'visible');
        uiModalMission.instruction.html(instruction);
        uiModalMission.missionTitle.html(title);
        uiModalMission.holder.css('visibility', 'visible');
        uiModalMission.foreground.css('visibility', 'visible');
        uiModalMission.closeButton.html('Ok');
        uiModalMission.closeButton.on('click', _handleButtonClick);
    }

    self.hide = hide;
    self.show = show;
}
