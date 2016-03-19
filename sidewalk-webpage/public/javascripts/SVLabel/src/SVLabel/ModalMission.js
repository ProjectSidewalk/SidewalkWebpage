var svl = svl || {};

function ModalMission ($) {
    var self = { className : 'ModalMission'},
        properties = {
            boxTop: 180,
            boxLeft: 45,
            boxWidth: 640
        };

    function _init () {
    }

    function getProperty (key) {
        return key in properties ? properties[key] : null;
    }

    /**
     * Hide a mission
     */
    function hideMission () {
        svl.ui.modalMission.holder.addClass('hidden');
        svl.ui.modalMission.box.css({
            top: getProperty("boxTop"),
            left: getProperty("boxLeft"),
            width: getProperty("boxWidth")
        })
    }

    /** Show a mission */
    function showMissionModal () {
        svl.ui.modalMission.holder.removeClass('hidden');
    }

    /**
     *
     * @param mission String The type of the mission. It could be one of "initial-mission" and "area-coverage".
     * @param parameters Object
     */
    function setMission (mission, parameters) {
        var templateHTML = $("template.missions[val='" + mission + "']").html();
        svl.ui.modalMission.box.html(templateHTML);

        if (parameters) {
            if ("distance" in parameters) {
                var distanceString = parameters.distance + " meters";
                $("#mission-target-distance").html(distanceString);
            }

            if ("coverage" in parameters) {
                var coverageString = parameters.coverage + "%";
                $("#modal-mission-area-coverage-rate").html(coverageString);
            }

            // Mission complete
            if ("badgeURL" in parameters && parameters.badgeURL) {
                var badge = "<img src='" + parameters.badgeURL + "' class='img-responsive center-block' alt='badge'/>";
                $("#mission-badge-holder").html(badge);
            }
        }

        if (parameters && "callback" in parameters) {
            $("#modal-mission-holder").find(".ok-button").on("click", parameters.callback);
        } else {
            $("#modal-mission-holder").find(".ok-button").on("click", hideMission);
        }

        showMissionModal();
    }

    function setMissionComplete (mission, parameters) {
        var templateHTML = $("template.missions[val='" + mission + "']").html();
        svl.ui.modalMission.box.html(templateHTML);

        if (parameters) {
            if (mission == "mission-complete" && "missionCompletionMessage" in parameters && parameters.missionCompletionMessage &&
                "badgeURL" in parameters && parameters.badgeURL) {
                var message = "<h2>Mission Complete!!!</h2><p>" + parameters.missionCompletionMessage + "</p>";
                var badge = "<img src='" + parameters.badgeURL + "' class='img-responsive center-block' alt='badge'/>";
                $("#mission-completion-message").html(message);
                $("#mission-badge-holder").html(badge);
            }
        }

        if (parameters && "callback" in parameters) {
            $("#modal-mission-holder").find(".ok-button").on("click", parameters.callback);
        } else {
            $("#modal-mission-holder").find(".ok-button").on("click", hideMission);
        }
        
        showMissionModal();
    }

    _init();

    self.setMission = setMission;
    self.setMissionComplete = setMissionComplete;
    return self;
}
