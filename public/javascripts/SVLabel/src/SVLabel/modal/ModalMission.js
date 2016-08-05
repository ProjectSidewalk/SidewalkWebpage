/**
 * ModalMission module
 * @param $ jQuery object
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function ModalMission ($, uiModalMission) {
    var self = { className : 'ModalMission'},
        properties = {
            boxTop: 180,
            boxLeft: 45,
            boxWidth: 640
        };

    // Mission titles. Keys are mission labels.
    var missionTitles = {
        "initial-mission": "Initial Mission",
        "distance-mission": "Audit __DISTANCE_PLACEHOLDER__ of __NEIGHBORHOOD_PLACEHOLDER__",
        "coverage-mission": "Audit __DISTANCE_PLACEHOLDER__ of __NEIGHBORHOOD_PLACEHOLDER__"
    };

    var initailMissionHTML = '<figure> \
        <img src="/assets/javascripts/SVLabel/img/icons/AccessibilityFeatures.png" class="modal-mission-images center-block" alt="Street accessibility features" /> \
        </figure> \
        <div class="spacer10"></div>\
        <p>The sidewalk accessibility affects how people with mobility impairments move about the city. Your first mission is to <span class="bold">find all the accessibility attributes that affect mobility impaired travelers.</span></p>\
        <div class="spacer10"></div>';

    var distanceMissionHTML = ' <figure> \
        <img src="/assets/javascripts/SVLabel/img/icons/AccessibilityFeatures.png" class="modal-mission-images center-block" alt="Street accessibility features" /> \
        </figure> \
        <div class="spacer10"></div>\
        <p>Your mission is to audit __DISTANCE_PLACEHOLDER__ of __NEIGHBORHOOD_PLACEHOLDER__</span> and find all the accessibility features that affect mobility impaired travelers!</p>\
        <div class="spacer10"></div>';

    var areaCoverageMissionHTML = '<figure> \
        <img src="/assets/javascripts/SVLabel/img/icons/AccessibilityFeatures.png" class="modal-mission-images center-block" alt="Street accessibility features" /> \
        </figure> \
        <div class="spacer10"></div>\
        <p>Your goal is to <span class="bold">audit <var id="modal-mission-area-coverage-rate">[x]</var> of the entire streets in this neighborhood</span> and find the accessibility attributes!</p>\
        <div class="spacer10"></div>';

    
    function _init () {
        uiModalMission.background.on("click", handleBackgroundClick);
        uiModalMission.closeButton.on("click", handleCloseButtonClick);
    }

    function _auidtDistanceToString (distance, unit) {
        if (!unit) unit = "kilometers";

        if (unit == "miles") {
            if (distance <= 0.20) {
                return "1000ft";
            } else if (distance <= 0.25) {
                return "&frac14;mi";
            } else if (distance <= 0.5) {
                return "&frac12;mi"
            } else if (distance <= 0.75) {
                return "&frac34;mi";
            } else {
                return distance.toFixed(0, 10) + "";
            }
        } else if (unit == "feet") {
            return distance + "";
        } else {
            return distance + "";
        }
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
        uiModalMission.holder.css('visibility', 'hidden');
        uiModalMission.foreground.css('visibility', 'hidden');
        uiModalMission.background.css('visibility', 'hidden');
    }

    /** Show a mission */
    function showMissionModal () {
        uiModalMission.holder.css('visibility', 'visible');
        uiModalMission.foreground.css('visibility', 'visible');
        uiModalMission.background.css('visibility', 'visible');
    }

    /**
     * Set the mission message in the modal window, then show the modal window.
     * @param mission String The type of the mission. It could be one of "initial-mission" and "area-coverage".
     * @param parameters Object
     */
    function setMissionMessage (mission, neighborhood, parameters, callback) {
        // Set the title and the instruction of this mission.
        var label = mission.getProperty("label"),
            templateHTML,
            missionTitle = label in missionTitles ? missionTitles[label] : "Mission";


        if (label == "distance-mission") {
            var auditDistance,
                distanceString;
            templateHTML = distanceMissionHTML;

            distanceString = _auidtDistanceToString(mission.getProperty("auditDistanceMi"), "miles");

            missionTitle = missionTitle.replace("__DISTANCE_PLACEHOLDER__", distanceString);
            missionTitle = missionTitle.replace("__NEIGHBORHOOD_PLACEHOLDER__", neighborhood.getProperty("name"));

            templateHTML = templateHTML.replace("__DISTANCE_PLACEHOLDER__", distanceString);
            templateHTML = templateHTML.replace("__NEIGHBORHOOD_PLACEHOLDER__", neighborhood.getProperty("name"));

            uiModalMission.missionTitle.html(missionTitle);
            uiModalMission.instruction.html(templateHTML);
            $("#mission-target-distance").html(distanceString);
        } else if (label == "area-coverage-mission") {
            // Set the title
            var coverage = (mission.getProperty("coverage") * 100).toFixed(0) + "%";
            templateHTML = areaCoverageMissionHTML;

            missionTitle = missionTitle.replace("__DISTANCE_PLACEHOLDER__", coverage);
            missionTitle = missionTitle.replace("__NEIGHBORHOOD_PLACEHOLDER__", neighborhood.getProperty("name"));

            uiModalMission.missionTitle.html(missionTitle);
            uiModalMission.instruction.html(templateHTML);
            $("#modal-mission-area-coverage-rate").html(coverage);
        } else {
            templateHTML = initailMissionHTML;
            uiModalMission.instruction.html(templateHTML);
            uiModalMission.missionTitle.html(missionTitle);
        }

        var badge = "<img src='" + mission.getProperty("badgeURL") + "' class='img-responsive center-block' alt='badge'/>";
        $("#mission-badge-holder").html(badge);

        if (callback) {
            $("#modal-mission-close-button").one("click", function () {
                hideMission();
                callback();
            });
        } else {
            $("#modal-mission-close-button").one("click", hideMission);
            $("#modal-mission-holder").find(".ok-button").one("click", hideMission);
        }

        showMissionModal();
    }
    

    _init();

    self.hide = hideMission;
    self.setMission = setMissionMessage;  // Todo. Deprecated
    self.setMissionMessage = setMissionMessage;
    self.show = showMissionModal;
    self.showMissionModal = showMissionModal;

    return self;
}
