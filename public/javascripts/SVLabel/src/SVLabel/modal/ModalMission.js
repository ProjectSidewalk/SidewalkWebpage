/**
 * ModalMission module
 * @param $ jQuery object
 * @param L Leaflet object
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

    // Mission titles. Keys are mission labels.
    var missionTitles = {
        "initial-mission": "Initial Mission",
        "distance-mission": "Mission: Make __PLACEHOLDER__ of this neighborhood accessible",
        "coverage-mission": "Mission: Make __PLACEHOLDER__ of this neighborhood accessible"
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
        svl.ui.modalMission.foreground.css('visibility', 'hidden');
        svl.ui.modalMission.background.css('visibility', 'hidden');
    }

    /** Show a mission */
    function showMissionModal () {
        svl.ui.modalMission.holder.css('visibility', 'visible');
        svl.ui.modalMission.foreground.css('visibility', 'visible');
        svl.ui.modalMission.background.css('visibility', 'visible');
    }

    /**
     * Set the mission message in the modal window, then show the modal window.
     * @param mission String The type of the mission. It could be one of "initial-mission" and "area-coverage".
     * @param parameters Object
     */
    function setMissionMessage (mission, parameters) {
        // Set the title and the instruction of this mission.
        var label = mission.getProperty("label"),
            templateHTML = $("template.missions[val='" + label + "']").html(),
            missionTitle = label in missionTitles ? missionTitles[label] : "Mission";


        if (label == "distance-mission") {
            // Set the title
            var distanceString;
            if (mission.getProperty("level") <= 2) {
                missionTitle = missionTitle.replace("__PLACEHOLDER__", mission.getProperty("distanceFt") + "ft");
                distanceString = mission.getProperty("distanceFt") + "ft";
            } else {
                missionTitle = missionTitle.replace("__PLACEHOLDER__", mission.getProperty("distanceMi") + "mi");
                distanceString = mission.getProperty("distanceMi") + "mi";
            }
            svl.ui.modalMission.missionTitle.html(missionTitle);

            // Set the instruction
            svl.ui.modalMission.instruction.html(templateHTML);
            $("#mission-target-distance").html(distanceString);
        } else if (label == "area-coverage-mission") {
            // Set the title
            var coverage = (mission.getProperty("coverage") * 100).toFixed(0) + "%";
            missionTitle = missionTitle.replace("__PLACEHOLDER__", coverage);
            svl.ui.modalMission.missionTitle.html(missionTitle);

            svl.ui.modalMission.instruction.html(templateHTML);
            $("#modal-mission-area-coverage-rate").html(coverage);
        } else {
            svl.ui.modalMission.instruction.html(templateHTML);
            svl.ui.modalMission.missionTitle.html(missionTitle);
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
