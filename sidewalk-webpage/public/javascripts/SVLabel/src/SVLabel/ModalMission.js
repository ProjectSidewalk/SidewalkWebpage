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
     * Set the mission message in the modal window, then show the modal window.
     * @param mission String The type of the mission. It could be one of "initial-mission" and "area-coverage".
     * @param parameters Object
     */
    function setMission (mission, parameters) {
        var label = mission.getProperty("label"),
            templateHTML = $("template.missions[val='" + label + "']").html();
        svl.ui.modalMission.box.html(templateHTML);

        if (label == "distance-mission") {
            var distanceString = mission.getProperty("distance") + " meters";
            $("#mission-target-distance").html(distanceString);
        } else if (label == "area-coverage-mission") {
            var coverageString = mission.getProperty("coverage") + "%";
            $("#modal-mission-area-coverage-rate").html(coverageString);
        }

        var badge = "<img src='" + mission.getProperty("badgeURL") + "' class='img-responsive center-block' alt='badge'/>";
        $("#mission-badge-holder").html(badge);

        if (parameters && "callback" in parameters) {
            $("#modal-mission-holder").find(".ok-button").on("click", parameters.callback);
        } else {
            $("#modal-mission-holder").find(".ok-button").on("click", hideMission);
        }

        showMissionModal();
    }

    /**
     * Set the mission complete message in the modal window, then show the modal.
     * @param mission
     * @param parameters
     */
    function setMissionComplete (mission, parameters) {
        var templateHTML = $("template.missions[val='mission-complete']").html();
        svl.ui.modalMission.box.html(templateHTML);

        var message = "<h2>Mission Complete!!!</h2><p>" + mission.getProperty("completionMessage") + "</p>";
            var badge = "<img src='" + mission.getProperty("badgeURL") + "' class='img-responsive center-block' alt='badge'/>";
            $("#mission-completion-message").html(message);
            $("#mission-badge-holder").html(badge);

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
