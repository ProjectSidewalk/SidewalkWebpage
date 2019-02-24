function ModalMissionComplete (uiModalMissionComplete) {
    var self = this;

    function _handleButtonClick() {
        svv.tracker.push("ClickOk_MissionComplete");
        self.hide();
    }

    function hide () {
        uiModalMissionComplete.background.css('visibility', 'hidden');
        uiModalMissionComplete.holder.css('visibility', 'hidden');
        uiModalMissionComplete.foreground.css('visibility', 'hidden');
    }

    function show (mission) {
        console.log("Agree count: " + mission.getProperty("agreeCount"));

        var message = "You just validated " + mission.getProperty("labelsValidated") + " " +
            svv.labelTypeNames[mission.getProperty("labelTypeId")] + " labels!";

        console.log("Showing complete mission screen");
        uiModalMissionComplete.background.css('visibility', 'visible');
        uiModalMissionComplete.missionTitle.html("Great Job!");
        uiModalMissionComplete.message.html(message);
        uiModalMissionComplete.agreeCount.html(mission.getProperty("agreeCount"));
        uiModalMissionComplete.disagreeCount.html(mission.getProperty("disagreeCount"));
        uiModalMissionComplete.notSureCount.html(mission.getProperty("notSureCount"));

        uiModalMissionComplete.holder.css('visibility', 'visible');
        uiModalMissionComplete.foreground.css('visibility', 'visible');
        uiModalMissionComplete.closeButton.html('Validate more labels');
        uiModalMissionComplete.closeButton.on('click', _handleButtonClick);
    }

    self.hide = hide;
    self.show = show;
}
