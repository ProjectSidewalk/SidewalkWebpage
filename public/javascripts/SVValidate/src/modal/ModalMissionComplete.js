function ModalMissionComplete (uiModalMissionComplete) {
    var self = this;
    var properties = {
        clickable: false
    };
    var watch;

    function _handleButtonClick() {
        svv.tracker.push("ClickOk_MissionComplete");
        self.hide();
    }

    function getProperty(key) {
        return key in properties ? properties[key] : null;
    }

    /**
     * Hides the mission complete menu. Waits until the next mission has been initialized and the
     * first label has been loaded onto the screen.
     */
    function hide () {
        clearInterval(watch);
        watch = window.setInterval(function () {
            if (getProperty('clickable')) {
                uiModalMissionComplete.background.css('visibility', 'hidden');
                uiModalMissionComplete.holder.css('visibility', 'hidden');
                uiModalMissionComplete.foreground.css('visibility', 'hidden');
                setProperty('clickable', false);
                clearInterval(watch);
            }
        }, 100);
    }

    function setProperty(key, value) {
        properties[key] = value;
        return this;
    }

    /**
     * Displays the mission complete screen.
     * @param mission   Object for the mission that was just completed.
     */
    function show (mission) {
        var message = "You just validated " + mission.getProperty("labelsValidated") + " " +
            svv.labelTypeNames[mission.getProperty("labelTypeId")] + " labels!";

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

    self.getProperty = getProperty;
    self.hide = hide;
    self.setProperty = setProperty;
    self.show = show;
}
