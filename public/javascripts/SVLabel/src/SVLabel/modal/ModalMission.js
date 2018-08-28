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
    // TODO update to check for region completeness using tasks
    var missionTitles = {
        "initial-mission": "Initial Mission",
        "audit": "Audit __DISTANCE_PLACEHOLDER__ in __NEIGHBORHOOD_PLACEHOLDER__",
        "coverage-mission": "Audit __DISTANCE_PLACEHOLDER__ in __NEIGHBORHOOD_PLACEHOLDER__"
    };

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

        var missionType = mission.getProperty("missionType"),
            templateHTML,
            missionTitle = missionType in missionTitles ? missionTitles[missionType] : "Mission";

        svl.popUpMessage.disableInteractions();
        if (missionType === "audit") {
            var distanceString;
                templateHTML = distanceMissionHTML;

            if (missionContainer.onlyMissionOnboardingDone() || missionContainer.isTheFirstMission()) {
                missionTitle = "First Mission: " + missionTitle;
                templateHTML = initialMissionHTML;
            }

            distanceString = this._auditDistanceToString(mission.getProperty("auditDistanceMi"), "miles");

            missionTitle = missionTitle.replace("__DISTANCE_PLACEHOLDER__", distanceString);
            missionTitle = missionTitle.replace("__NEIGHBORHOOD_PLACEHOLDER__", neighborhood.getProperty("name"));

            templateHTML = templateHTML.replace("__DISTANCE_PLACEHOLDER__", distanceString);
            templateHTML = templateHTML.replace("__NEIGHBORHOOD_PLACEHOLDER__", neighborhood.getProperty("name"));

            uiModalMission.missionTitle.html(missionTitle);
            uiModalMission.instruction.html(templateHTML);
            $("#mission-target-distance").html(distanceString);
            // TODO check for this using tasks
        } else if (missionType === "area-coverage-mission") {
            // Set the title
            var coverage = (mission.getProperty("coverage") * 100).toFixed(0) + "%";
            templateHTML = areaCoverageMissionHTML;

            missionTitle = missionTitle.replace("__DISTANCE_PLACEHOLDER__", coverage);
            missionTitle = missionTitle.replace("__NEIGHBORHOOD_PLACEHOLDER__", neighborhood.getProperty("name"));

            uiModalMission.missionTitle.html(missionTitle);
            uiModalMission.instruction.html(templateHTML);
            $("#modal-mission-area-coverage-rate").html(coverage);
        } else {
            templateHTML = initialMissionHTML;
            uiModalMission.instruction.html(templateHTML);
            uiModalMission.missionTitle.html(missionTitle);
        }

        //Check if the user is associated with the "Turker" role and update the reward HTML
        var url = '/isTurker';
        $.ajax({
            async: true,
            url: url,//endpoint that checks above conditions
            type: 'get',
            success: function (data) {
                if (data.isTurker) {
                    var url = '/rewardPerMile';
                    $.ajax({
                        async: true,
                        url: url,//endpoint that checks above conditions
                        type: 'get',
                        success: function (data) {
                            var auditDistanceMi = mission.getProperty("auditDistanceMi");
                            var missionReward = auditDistanceMi * data.rewardPerMile;
                            // Mission Rewards.
                            var missionRewardText = 'Reward on satisfactory completion: <span class="bold" style="color: forestgreen;">$__REWARD_PLACEHOLDER__</span>';
                            missionRewardText = missionRewardText.replace("__REWARD_PLACEHOLDER__", missionReward.toFixed(2));
                            svl.ui.status.currentMissionReward.html("Current Mission Reward: <span style='color:forestgreen'>$" + missionReward.toFixed(2)) + "</span>";
                            uiModalMission.rewardText.html(missionRewardText);

                            //Calculate the total earned reward
                            var completedMissionJson = svl.missionContainer.getCompletedMissions()
                                .filter(function (el) {
                                    return el.isCompleted() && el.getProperty("regionId") != null
                                })
                                .reduce(function (region_groups, el) {
                                        region_groups[el.getProperty("regionId")] = region_groups[el.getProperty("regionId")] || 0.0;
                                        region_groups[el.getProperty("regionId")] += el.getProperty("auditDistanceMi");
                                        return region_groups;
                                    }
                                    , {});
                            var totalMissionCompleteDistance = Object.values(completedMissionJson).reduce(function (sum, el) {
                                return sum + el;
                            }, 0.0);

                            var missionReward = totalMissionCompleteDistance * data.rewardPerMile;
                            // Mission Rewards.
                            //document.getElementById("td-total-reward-earned").innerHTML = "$" + missionReward.toPrecision(2);
                            svl.ui.status.totalMissionReward.html("Total Earned Reward: <span style='color:forestgreen'>$" + missionReward.toFixed(2)) + "</span>";
                        },
                        error: function (xhr, ajaxOptions, thrownError) {
                            console.log(thrownError);
                        }
                    });
                    //console.log('Survey displayed');
                }
            },
            error: function (xhr, ajaxOptions, thrownError) {
                console.log(thrownError);
            }
        });

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

ModalMission.prototype._auditDistanceToString = function  (distance, unit) {
    if (!unit) unit = "kilometers";

    if (unit == "miles") {
        if (distance <= 0.12){
            return "500ft";
        }
        else if (distance <= 0.20) {
            return "1000ft";
        } else if (distance <= 0.25) {
            return "&frac14;mi";
        } else if (distance <= 0.39) {
            return "2000ft";
        } else if (distance <= 0.5) {
            return "&frac12;mi";
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
