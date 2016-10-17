/**
 * ModalMission module
 * @param missionContainer
 * @param neighborhoodContainer
 * @param uiModalMission
 * @param modalModel
 * @param onboardingModel
 * @returns {{className: string}}
 * @constructor
 */
function ModalMission (missionContainer, neighborhoodContainer, uiModalMission, modalModel, onboardingModel) {
    var self = this;
    var _missionContainer = missionContainer;
    var _neighborhoodContainer = neighborhoodContainer;
    var _modalModel = modalModel;

    this._status = {
        isOpen: false
    };

    _modalModel.on("ModalMission:setMissionMessage", function (parameters) {
        self.setMissionMessage(parameters.mission, parameters.neighborhood, parameters.parameters, parameters.callback);
        self.show();
    });

    _modalModel.on("ModalMissionComplete:closed", function () {
        var mission = _missionContainer.getCurrentMission();
        var neighborhood = _neighborhoodContainer.getCurrentNeighborhood();
        self.setMissionMessage (mission, neighborhood);
        self.show();
    });

    onboardingModel.on("Onboarding:startOnboarding", function () {
        self.hide();
    });

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


    this._handleBackgroundClick = function () {
        self.hide();
    };

    this._handleCloseButtonClick = function () {
        self.hide();
    };

    /**
     * Hide a mission
     */
    this.hide = function () {
        self._status.isOpen = false;
        uiModalMission.holder.css('visibility', 'hidden');
        uiModalMission.foreground.css('visibility', 'hidden');
        uiModalMission.background.css('visibility', 'hidden');
    };

    /** Show a mission */
    this.show = function () {
        self._status.isOpen = true;
        uiModalMission.holder.css('visibility', 'visible');
        uiModalMission.foreground.css('visibility', 'visible');
        uiModalMission.background.css('visibility', 'visible');
    };

    /**
     * Set the mission message in the modal window, then show the modal window.
     * @param mission
     * @param neighborhood
     * @param parameters
     * @param callback
     */
    this.setMissionMessage = function (mission, neighborhood, parameters, callback) {
        // Set the title and the instruction of this mission.
        var label = mission.getProperty("label"),
            templateHTML,
            missionTitle = label in missionTitles ? missionTitles[label] : "Mission";


        if (label == "distance-mission") {
            var auditDistance,
                distanceString;
            templateHTML = distanceMissionHTML;

            distanceString = this._auidtDistanceToString(mission.getProperty("auditDistanceMi"), "miles");

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
                self.hide();
                callback();
            });
        } else {
            $("#modal-mission-close-button").one("click", self.hide);
            $("#modal-mission-holder").find(".ok-button").one("click", self.hide);
        }
    };

    uiModalMission.background.on("click", this._handleBackgroundClick);
    uiModalMission.closeButton.on("click", this._handleCloseButtonClick);
}

ModalMission.prototype._auidtDistanceToString = function  (distance, unit) {
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
        // Todo.
        return distance + "";
    } else {
        // Todo.
        return distance + "";
    }
};


ModalMission.prototype.isOpen = function () {
    return this._status.isOpen;
};
