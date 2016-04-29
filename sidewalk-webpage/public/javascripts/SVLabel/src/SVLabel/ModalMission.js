/**
 * ModalMission module
 * @param $
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function ModalMission ($, L) {
    var self = { className : 'ModalMission'},
        properties = {
            boxTop: 180,
            boxLeft: 45,
            boxWidth: 640
        };
    
    function _init () {
        svl.ui.modalMission.background.on("click", handleBackgroundClick);
        svl.ui.modalMission.closeButton.on("click", handleCloseButtonClick);
    }

    /**
     * Get a property
     * @param key
     * @returns {null}
     */
    function getProperty (key) {
        return key in properties ? properties[key] : null;
    }

    /**
     * Callback function for background click
     * @param e
     */
    function handleBackgroundClick(e) {
        hideMission();
    }

    /**
     * Callback function for button click
     * @param e
     */
    function handleCloseButtonClick(e) {
        hideMission();
    }

    /**
     * Hide a mission
     */
    function hideMission () {
        svl.ui.modalMission.holder.css('visibility', 'hidden');
        svl.ui.modalMission.foreground.css('visibility', "hidden");
    }

    /** Show a mission */
    function showMissionModal () {
        svl.ui.modalMission.holder.css('visibility', 'visible');
        svl.ui.modalMission.foreground.css('visibility', "visible");
    }

    /**
     * Set the mission message in the modal window, then show the modal window.
     * @param mission String The type of the mission. It could be one of "initial-mission" and "area-coverage".
     * @param parameters Object
     */
    function setMissionMessage (mission, parameters) {
        var label = mission.getProperty("label"),
            templateHTML = $("template.missions[val='" + label + "']").html();
        svl.ui.modalMission.foreground.html(templateHTML);

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
    

    _init();

    self.setMission = setMissionMessage;  // Todo. Deprecated
    self.setMissionMessage = setMissionMessage;
    self.show = showMissionModal;
    self.showMissionModal = showMissionModal;

    return self;
}
