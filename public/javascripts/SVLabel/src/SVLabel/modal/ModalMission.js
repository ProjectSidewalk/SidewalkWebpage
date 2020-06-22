/**
 * ModalMission module
 * @param missionContainer
 * @param neighborhoodContainer
 * @param uiModalMission
 * @param modalModel
 * @param onboardingModel
 * @param userModel
 * @returns {{className: string}}
 * @constructor
 */
function ModalMission (missionContainer, neighborhoodContainer, uiModalMission, modalModel, onboardingModel, userModel) {
    var self = this;
    var _missionContainer = missionContainer;
    var _neighborhoodContainer = neighborhoodContainer;
    var _modalModel = modalModel;
    var _userModel = userModel;

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


    var initialMissionHTML = '<figure> \
        <img src="/assets/javascripts/SVLabel/img/icons/AccessibilityFeatures.png" class="modal-mission-images center-block" alt="Street accessibility features" /> \
        </figure> \
        <div class="spacer10"></div>\
        <p>' + i18next.t('mission-start.body-first') + '</p>\
        <div class="spacer10"></div>';

    var distanceMissionHTML = ' <figure> \
        <img src="/assets/javascripts/SVLabel/img/icons/AccessibilityFeatures.png" class="modal-mission-images center-block" alt="Street accessibility features" /> \
        </figure> \
        <div class="spacer10"></div>\
        <p>' + i18next.t('mission-start.body') + '</p>\
        <div class="spacer10"></div>';

    var returningToMissionHTML = ' <figure> \
        <img src="/assets/javascripts/SVLabel/img/icons/AccessibilityFeatures.png" class="modal-mission-images center-block" alt="Street accessibility features" /> \
        </figure> \
        <div class="spacer10"></div>\
        <p>' + i18next.t('mission-start.title-continue') + '</p>\
        <div class="spacer10"></div>';

    this._handleBackgroundClick = function () {
        self.hide();
    };

    this._handleCloseButtonClick = function () {
        mission = _missionContainer.getCurrentMission();
        
        // Check added so that if a user begins a mission, leaves partway through, and then resumes the mission later, another 
        // MissionStart will not be triggered
        if(mission.getProperty("distanceProgress") < 0.0001) { 
            svl.tracker.push(
                "MissionStart",
                {
                    missionId: mission.getProperty("missionId"),
                    missionType: mission.getProperty("missionType"),
                    distanceMeters: Math.round(mission.getDistance("meters")),
                    regionId: mission.getProperty("regionId")
                }
            );
        }
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
        svl.popUpMessage.enableInteractions();
    };

    /** Show a mission */
    this.show = function () {
        self._status.isOpen = true;
        uiModalMission.holder.css('visibility', 'visible');
        uiModalMission.foreground.css('visibility', 'visible');
        uiModalMission.background.css('visibility', 'visible');
        //svl.popUpMessage.disableInteractions();
    };

    /**
     *  This method takes in an integer feet and converts it to meters, truncuating all decimals.
     *  @param feet to convert to meters
     *  @return
     */
    this.convertToMetric = function(feet) {
        return Math.trunc(feet * 0.3048) + " m";
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

        var missionType = mission.getProperty("missionType");
        var missionTitle = i18next.t('mission-start.title');
        var templateHTML;

        svl.popUpMessage.disableInteractions();
        if (missionType === "audit") {
            var distanceString;
            templateHTML = distanceMissionHTML;

            if (mission.getProperty("distanceProgress") > 0) { // In-progress mission
                missionTitle = i18next.t('mission-start.title-return');
                templateHTML = returningToMissionHTML;

                // Set returning-to-mission specific css
                uiModalMission.closeButton.html(i18next.t('mission-start.button-resume'));
                uiModalMission.instruction.css('text-align', 'center');
                uiModalMission.closeButton.css('font-size', '24px');
                uiModalMission.closeButton.css('width', '40%');
                uiModalMission.closeButton.css('margin-right', '30%');
                uiModalMission.closeButton.css('margin-left', '30%');
                uiModalMission.closeButton.css('margin-top', '30px');
            } else if (missionContainer.onlyMissionOnboardingDone() || missionContainer.isTheFirstMission()) { // First mission
                missionTitle = i18next.t('mission-start.title-first') + missionTitle;
                templateHTML = initialMissionHTML;
            } else {
                // We have to reset the css from the resuming screen, otherwise the button will remain as set
                uiModalMission.closeButton.html('OK');
                uiModalMission.instruction.css('text-align', 'left');
                uiModalMission.closeButton.css('font-size', '');
                uiModalMission.closeButton.css('width', '');
                uiModalMission.closeButton.css('margin-right', '');
                uiModalMission.closeButton.css('margin-left', '');
                uiModalMission.closeButton.css('margin-top', '');
            }

            distanceString = this._distanceToString(mission.getDistance("miles"), "miles");

            missionTitle = missionTitle.replace("__DISTANCE_PLACEHOLDER__", distanceString);
            missionTitle = missionTitle.replace("__NEIGHBORHOOD_PLACEHOLDER__", neighborhood.getProperty("name"));

            templateHTML = templateHTML.replace("__DISTANCE_PLACEHOLDER__", distanceString);
            templateHTML = templateHTML.replace("__NEIGHBORHOOD_PLACEHOLDER__", neighborhood.getProperty("name"));

            uiModalMission.missionTitle.html(missionTitle);
            uiModalMission.instruction.html(templateHTML);
            $("#mission-target-distance").html(distanceString);
            // TODO check for this using tasks
        } else {
            templateHTML = initialMissionHTML;
            uiModalMission.instruction.html(templateHTML);
            uiModalMission.missionTitle.html(missionTitle);
        }

        // Update the reward HTML if the user is a turker.
        if (_userModel.getUser().getProperty("role") === "Turker") {
            var missionReward = mission.getProperty("pay");
            var missionRewardText = i18next.t('common:mission-start-turk-reward') + '<span class="bold" style="color: forestgreen;">$__REWARD_PLACEHOLDER__</span>';
            missionRewardText = missionRewardText.replace("__REWARD_PLACEHOLDER__", missionReward.toFixed(2));
            svl.ui.status.currentMissionReward.html(i18next.t('common:right-ui-turk-current-reward') + "<span style='color:forestgreen'>$" + missionReward.toFixed(2)) + "</span>";
            uiModalMission.rewardText.html(missionRewardText);

            $.ajax({
                async: true,
                url: '/rewardEarned',
                type: 'get',
                success: function(rewardData) {
                    svl.ui.status.totalMissionReward.html(i18next.t('common:right-ui-turk-total-reward') + "<span style='color:forestgreen'>$" + rewardData.reward_earned.toFixed(2)) + "</span>";
                },
                error: function (xhr, ajaxOptions, thrownError) {
                    console.log(thrownError);
                }
            })
        }

        if (callback) {
            $("#modal-mission-close-button").one("click", function () {
                self.hide();
                callback();
            });
        } else {
            $("#modal-mission-close-button").one("click", self.hide);
            $("#modal-mission-holder").find(".ok-button").one("click", self.hide);
        }

        $(document).keyup(function (e){
            e = e || window.event;
            //enter key
            if (e.keyCode == 13 && self._status.isOpen){
                svl.tracker.push("KeyboardShortcut_ModalMissionOk");
                $("#modal-mission-close-button").trigger("click", {lowLevelLogging: false});
            }
        });
    };

    uiModalMission.background.on("click", this._handleBackgroundClick);
    uiModalMission.closeButton.on("click", this._handleCloseButtonClick);
}

ModalMission.prototype._distanceToString = function  (distance, unit) {
    if (!unit) unit = "kilometers";

    // Convert to miles and round to 4 decimal places.
    if (unit === "feet") distance = util.math.feetToMiles(distance);
    else if (unit === "meters") distance = util.math.metersToMiles(distance);
    else if (unit === "kilometers") distance = util.math.kilometersToMiles(distance);

    distance = distance.toPrecision(4);
    var distanceType = i18next.t('measurement-system');

    if (distance === "0.0947"){
        if (distanceType === "metric") return this.convertToMetric(500);
        return "500 ft";
    } else if (distance === "0.1420") {
        if (distanceType === "metric") return this.convertToMetric(750);
        return "750 ft";
    } else if (distance === "0.1894") {
        if (distanceType === "metric") return this.convertToMetric(1000);
        return "1000 ft";
    } else if (distance === "0.2500") {
        if (distanceType === "metric") return this.convertToMetric(distance * 5280);
        return "&frac14; mi";
    } else if (distance === "0.3788") {
        if (distanceType === "metric") return this.convertToMetric(2000);
        return "2000 ft";
    } else if (distance === "0.5000") {
        if (distanceType === "metric") return this.convertToMetric(distance * 5280);
        return "&frac12; mi";
    } else if (distance === "0.7500") {
        if (distanceType === "metric") return this.convertToMetric(distance * 5280);
        return "&frac34; mi";
    } else {
        if (distanceType === "metric") return this.convertToMetric(distance * 5280);
        return (util.math.milesToFeet(distance)).toFixed(0) + " ft";
    }
};

ModalMission.prototype.isOpen = function () {
    return this._status.isOpen;
};
