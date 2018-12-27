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
        <p>Your <span class="bold">first mission</span> is to audit __DISTANCE_PLACEHOLDER__ in __NEIGHBORHOOD_PLACEHOLDER__</span> and find all the accessibility features that affect mobility impaired travelers!</p>\
        <div class="spacer10"></div>';

    var distanceMissionHTML = ' <figure> \
        <img src="/assets/javascripts/SVLabel/img/icons/AccessibilityFeatures.png" class="modal-mission-images center-block" alt="Street accessibility features" /> \
        </figure> \
        <div class="spacer10"></div>\
        <p>Your mission is to audit __DISTANCE_PLACEHOLDER__ in __NEIGHBORHOOD_PLACEHOLDER__</span> and find all the accessibility features that affect mobility impaired travelers!</p>\
        <div class="spacer10"></div>';

    var returningToMissionHTML = ' <figure> \
        <img src="/assets/javascripts/SVLabel/img/icons/AccessibilityFeatures.png" class="modal-mission-images center-block" alt="Street accessibility features" /> \
        </figure> \
        <div class="spacer10"></div>\
        <p>Continue auditing __DISTANCE_PLACEHOLDER__ in __NEIGHBORHOOD_PLACEHOLDER__</span> for accessibility features!</p>\
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
     * Set the mission message in the modal window, then show the modal window.
     * @param mission
     * @param neighborhood
     * @param parameters
     * @param callback
     */
    this.setMissionMessage = function (mission, neighborhood, parameters, callback) {
        // Set the title and the instruction of this mission.

        var missionType = mission.getProperty("missionType");
        var missionTitle = "Audit __DISTANCE_PLACEHOLDER__ in __NEIGHBORHOOD_PLACEHOLDER__";
        var templateHTML;

        svl.popUpMessage.disableInteractions();
        if (missionType === "audit") {
            var distanceString;
            templateHTML = distanceMissionHTML;

            if (missionContainer.onlyMissionOnboardingDone() || missionContainer.isTheFirstMission()) {
                missionTitle = "First Mission: " + missionTitle;
                templateHTML = initialMissionHTML;
            } else if (mission.getProperty("distanceProgress") > 0) {
                missionTitle = "Returning to your mission";
                templateHTML = returningToMissionHTML;
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
            var missionRewardText = 'Reward on satisfactory completion: <span class="bold" style="color: forestgreen;">$__REWARD_PLACEHOLDER__</span>';
            missionRewardText = missionRewardText.replace("__REWARD_PLACEHOLDER__", missionReward.toFixed(2));
            svl.ui.status.currentMissionReward.html("Current Mission Reward: <span style='color:forestgreen'>$" + missionReward.toFixed(2)) + "</span>";
            uiModalMission.rewardText.html(missionRewardText);

            $.ajax({
                async: true,
                url: '/rewardEarned',
                type: 'get',
                success: function(rewardData) {
                    svl.ui.status.totalMissionReward.html("Total Earned Reward: <span style='color:forestgreen'>$" + rewardData.reward_earned.toFixed(2)) + "</span>";
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
                $("#modal-mission-close-button").click();
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

    if (distance === "0.0947"){
        return "500ft";
    } else if (distance === "0.1894") {
        return "1000ft";
    } else if (distance === "0.2500") {
        return "&frac14;mi";
    } else if (distance === "0.3788") {
        return "2000ft";
    } else if (distance === "0.5000") {
        return "&frac12;mi";
    } else if (distance === "0.7500") {
        return "&frac34;mi";
    } else {
        return (util.math.milesToFeet(distance)).toFixed(0) + "ft";
    }
};


ModalMission.prototype.isOpen = function () {
    return this._status.isOpen;
};
