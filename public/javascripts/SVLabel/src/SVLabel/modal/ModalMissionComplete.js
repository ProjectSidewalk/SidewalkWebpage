/**
 *
 * @param svl. Todo. Get rid of this dependency eventually.
 * @param missionContainer
 * @param missionModel
 * @param taskContainer
 * @param modalMissionCompleteMap
 * @param modalMissionProgressBar
 * @param uiModalMissionComplete
 * @param modalModel
 * @param statusModel
 * @param onboardingModel
 * @param userModel
 * @returns {{className: string}}
 * @constructor
 */
function ModalMissionComplete (svl, missionContainer, missionModel, taskContainer, modalMissionCompleteMap,
                               modalMissionProgressBar, uiModalMissionComplete, modalModel, statusModel,
                               onboardingModel, userModel) {
    var self = this;
    var _missionModel = missionModel;
    var _missionContainer = missionContainer;
    var _modalModel = modalModel;
    this._userModel = userModel;

    this._status = {
        isOpen: false,
        primaryAction: null,
        secondaryAction: null
    };
    this.showingMissionCompleteScreen = false;
    this._canShowContinueButton = false;

    this._uiModalMissionComplete = uiModalMissionComplete;
    this._modalMissionCompleteMap = modalMissionCompleteMap;

    // Initialize the mission complete modal differently if it's a designated route vs free auditing of a neighborhood.
    if (svl.neighborhoodModel.isRoute) {
        this._uiModalMissionComplete.mapLegendLabel3.html(i18next.t('mission-complete.progress-route-remaining'));
        this._uiModalMissionComplete.progressTitle.html(i18next.t('mission-complete.progress-route-title'));
        this._uiModalMissionComplete.progressYou.html(i18next.t('mission-complete.progress-route-you'));
        this._uiModalMissionComplete.progressRemaining.html(i18next.t('mission-complete.progress-route-remaining'));

        // If this is a designated route, remove element(s) related to the entire neighborhood.
        this._uiModalMissionComplete.progressOthers.parent().remove();
    } else {
        this._uiModalMissionComplete.mapLegendLabel3.html(i18next.t('mission-complete.map-legend-label-other-users'));
        this._uiModalMissionComplete.progressTitle.html(i18next.t('mission-complete.progress-neighborhood-title'));
        this._uiModalMissionComplete.progressYou.html(i18next.t('mission-complete.progress-neighborhood-you'));
        this._uiModalMissionComplete.progressRemaining.html(i18next.t('mission-complete.progress-neighborhood-remaining'));
    }

    _modalModel.on("ModalMissionComplete:update", function (parameters) {
        self.update(parameters.mission, parameters.neighborhood);
    });

    _modalModel.on("ModalMissionComplete:show", function () {
        // Play mission complete sound effect.
        svl.gameEffectModel.loadAudio({ audioType: "success" });
        svl.gameEffectModel.playAudio({ audioType: "success" });

        self.show();
    });

    _modalModel.on("ModalMissionComplete:one", function (parameters) {
        self.one(parameters.uiComponent, parameters.eventType, parameters.callback);
    });

    onboardingModel.on("Onboarding:startOnboarding", function () {
        self.hide();
    });

    _missionModel.on("MissionProgress:complete", function (parameters) {
        self._canShowContinueButton = false;
    });

    _missionContainer.on("MissionContainer:missionLoaded", function(mission) {
        self._canShowContinueButton = true;
        if (self.showingMissionCompleteScreen) {
            self._enableContinueButton();
        }
    });

    // Enables clicking of continue button. Only enabled when next mission loaded mission complete modal shown.
    this._enableContinueButton = function() {
        uiModalMissionComplete.closeButtonPrimary.on("click", { button: 'primary' }, self._handleCloseButtonClick);
        uiModalMissionComplete.closeButtonSecondary.on("click", { button: 'secondary' }, self._handleCloseButtonClick);

        uiModalMissionComplete.closeButtonPrimary.removeClass('btn-loading');
        uiModalMissionComplete.closeButtonPrimary.addClass('btn-primary');

        uiModalMissionComplete.closeButtonSecondary.removeClass('btn-loading');
        uiModalMissionComplete.closeButtonSecondary.addClass('btn-secondary');
    };

    // Disables clicking of continue button. Only enabled when next mission loaded mission complete modal shown.
    this._disableContinueButton = function() {
        uiModalMissionComplete.closeButtonPrimary.off('click');
        uiModalMissionComplete.closeButtonSecondary.off('click');

        uiModalMissionComplete.closeButtonPrimary.removeClass('btn-primary');
        uiModalMissionComplete.closeButtonPrimary.addClass('btn-loading');

        uiModalMissionComplete.closeButtonSecondary.removeClass('btn-secondary');
        uiModalMissionComplete.closeButtonSecondary.addClass('btn-loading');
    };

    // TODO maybe deal with lost connection causing modal to not close
    this._handleCloseButtonClick = function (event) {
        self._closeModal(event);
    };

    /**
     * Closes mission complete modal. Either starts a new mission or loads the validation page.
     *
     * If the user clicks the 'Start validating' button send them to the validation page (only shows up if this was
     * their first audit mission in the neighborhood or their third audit mission in a row). If they just finished a
     * neighborhood, reload the explore page, otherwise start a new explore mission like normal.
     * @param event
     * @private
     */
    this._closeModal = function (event) {
        var action = event.data.button === 'primary' ? this._status.primaryAction : this._status.secondaryAction;
        if (action === 'validate') {
            window.location.replace('/validate');
        } else if (action === 'reloadExplore') {
            window.location.replace('/explore');
        } else {
            var nextMission = missionContainer.getCurrentMission();
            _modalModel.triggerMissionCompleteClosed( { nextMission: nextMission } );
            svl.map.unlockDisableWalking();
            svl.map.enableWalking();
            self.hide();
        }
    };

    // Hides all the pieces of the mission complete modal.
    this.hide = function () {
        this._status.isOpen = false;
        this._uiModalMissionComplete.holder.css('visibility', 'hidden');
        this._uiModalMissionComplete.foreground.css('visibility', "hidden");
        this._uiModalMissionComplete.background.css('visibility', "hidden");
        this._uiModalMissionComplete.closeButtonPrimary.css('visibility', "hidden");
        this._uiModalMissionComplete.closeButtonSecondary.css('visibility', "hidden");
        this._uiModalMissionComplete.closeButtonPrimary.off('click');
        this._uiModalMissionComplete.closeButtonSecondary.off('click');

        statusModel.setProgressBar(0);
        statusModel.setMissionCompletionRate(0);
        self.showingMissionCompleteScreen = false;
    };

    /**
     * Shows all components of mission complete modal. Decides which continue button(s) to show (audit or validation).
     */
    this.show = function () {
        this._status.isOpen = true;
        svl.map.disableWalking();
        svl.map.lockDisableWalking();
        uiModalMissionComplete.holder.css('visibility', 'visible');
        uiModalMissionComplete.foreground.css('visibility', "visible");
        uiModalMissionComplete.background.css('visibility', "visible");
        uiModalMissionComplete.background.off("click");
        uiModalMissionComplete.closeButtonPrimary.css('visibility', "visible");

        // Set mission complete title text differently if user finished their route or the whole neighborhood.
        if (svl.neighborhoodModel.isRouteComplete) {
            self.setMissionTitle(i18next.t('mission-complete.title-route-complete'));
            self._canShowContinueButton = true;
        } else if (svl.neighborhoodModel.isNeighborhoodComplete) {
            var neighborhood = svl.neighborhoodContainer.getCurrentNeighborhood();
            var neighborhoodName = neighborhood.getProperty("name");
            self.setMissionTitle(i18next.t('mission-complete.title-neighborhood-complete', { neighborhoodName: neighborhoodName }));
            self._canShowContinueButton = true;
        }

        // If the user just completed their first audit mission ever, or they finished their third in a row, make the
        // primary button send them to Validate and have the secondary button let them continue exploring. On any other
        // mission just show a 'Continue' button that has them explore more.
        var firstMission = !svl.userHasCompletedAMission && svl.missionsCompleted === 1;
        if ((firstMission || svl.missionsCompleted % 3 === 0 || svl.neighborhoodModel.isRouteOrNeighborhoodComplete())) {
            uiModalMissionComplete.closeButtonPrimary.html(i18next.t('mission-complete.button-start-validating'));
            this._status.primaryAction = 'validate';

            uiModalMissionComplete.closeButtonPrimary.css('width', "50%");
            uiModalMissionComplete.closeButtonSecondary.css('visibility', "visible");
            uiModalMissionComplete.closeButtonSecondary.css('width', "48%");
            uiModalMissionComplete.closeButtonSecondary.html(i18next.t('mission-complete.button-keep-exploring'));
            if (svl.neighborhoodModel.isRouteOrNeighborhoodComplete()) {
                this._status.secondaryAction = 'reloadExplore';
            } else {
                this._status.secondaryAction = 'explore';
            }
        } else {
            uiModalMissionComplete.closeButtonPrimary.css('width', "100%");
            uiModalMissionComplete.closeButtonPrimary.html(i18next.t('mission-complete.button-continue'));
            this._status.primaryAction = 'explore';
            uiModalMissionComplete.closeButtonSecondary.css('visibility', "hidden");
        }

        self.showingMissionCompleteScreen = true;
        if (self._canShowContinueButton) {
            self._enableContinueButton();
        } else {
            self._disableContinueButton();
        }
    };

    this.update = function (mission, neighborhood) {
        // Update the horizontal bar chart to show the distance the user has audited.
        var unit = {units: i18next.t('common:unit-distance')};

        var missionDistance = mission.getDistance(unit.units);
        var userAuditedDistance = neighborhood.completedLineDistance(unit);
        var allAuditedDistance = neighborhood.completedLineDistanceAcrossAllUsersUsingPriority();
        var otherAuditedDistance = allAuditedDistance - userAuditedDistance;
        if (svl.neighborhoodModel.isRoute) otherAuditedDistance = 0; // Only show this user's data if on a route.
        var remainingDistance = neighborhood.totalLineDistanceInNeighborhood(unit) - allAuditedDistance;

        var userCompletedTasks = taskContainer.getCompletedTasks();
        var allCompletedTasks = taskContainer.getCompletedTasksAllUsersUsingPriority();
        var incompleteTasks = taskContainer.getIncompleteTasks();
        mission.pushATaskToTheRoute(taskContainer.getCurrentTask());
        var missionTasks = mission.getRoute();
        var totalLineDistance = taskContainer.totalLineDistanceInNeighborhood(unit);
        var missionDistanceRate = missionDistance / totalLineDistance;
        var userAuditedDistanceRate = Math.max(0, userAuditedDistance / totalLineDistance - missionDistanceRate);
        var otherAuditedDistanceRate = Math.max(0, otherAuditedDistance / totalLineDistance);

        var labelCount = mission.getLabelCount(),
            curbRampCount = labelCount ? labelCount["CurbRamp"] : 0,
            noCurbRampCount = labelCount ? labelCount["NoCurbRamp"] : 0 ,
            obstacleCount = labelCount ? labelCount["Obstacle"] : 0,
            surfaceProblemCount = labelCount ? labelCount["SurfaceProblem"] : 0,
            noSidewalkCount = labelCount ? labelCount["NoSidewalk"] : 0,
            otherCount = labelCount ? labelCount["Other"] : 0;

        var neighborhoodName = neighborhood.getProperty("name");
        this.setMissionTitle(neighborhoodName + ": " + i18next.t('mission-complete.title-generic'));

        modalMissionCompleteMap.updateStreetSegments(missionTasks, userCompletedTasks, allCompletedTasks, mission.getProperty('missionId'), incompleteTasks);
        modalMissionProgressBar.update(missionDistanceRate, userAuditedDistanceRate, otherAuditedDistanceRate);

        this._updateMissionProgressStatistics(missionDistance, userAuditedDistance, otherAuditedDistance, remainingDistance);
        this._updateMissionLabelStatistics(curbRampCount, noCurbRampCount, obstacleCount, surfaceProblemCount, noSidewalkCount, otherCount);
    };

    uiModalMissionComplete.closeButtonPrimary.on("click", { button: 'primary' }, this._handleCloseButtonClick);
    this.hide();
}



ModalMissionComplete.prototype.isOpen = function () {
    return this._status.isOpen;
};

ModalMissionComplete.prototype.one = function (uiComponent, eventType, callback) {
    this._uiModalMissionComplete[uiComponent].one(eventType, callback);
};

ModalMissionComplete.prototype.setMissionTitle = function (missionTitle) {
    this._uiModalMissionComplete.missionTitle.html(missionTitle);
};

ModalMissionComplete.prototype._updateMissionProgressStatistics = function (missionDistance, userTotalDistance, othersAuditedDistance, remainingDistance) {
    var distanceType = i18next.t('mission-complete.distance-type-display-string');
    if(remainingDistance > 0.00 && remainingDistance <= 0.10){
        remainingDistance = 0.1;
    }
    var positiveRemainingDistance = Math.max(remainingDistance, 0);
    var positiveOthersAuditedDistance = Math.max(othersAuditedDistance, 0);
    this._uiModalMissionComplete.missionDistance.html(`${missionDistance.toFixed(1)} ${distanceType}`);
    this._uiModalMissionComplete.totalAuditedDistance.html(`${userTotalDistance.toFixed(1)} ${distanceType}`);
    this._uiModalMissionComplete.othersAuditedDistance.html(`${positiveOthersAuditedDistance.toFixed(1)} ${distanceType}`);
    this._uiModalMissionComplete.remainingDistance.html(`${positiveRemainingDistance.toFixed(1)} ${distanceType}`);
};

ModalMissionComplete.prototype._updateMissionLabelStatistics = function (curbRampCount, noCurbRampCount, obstacleCount, surfaceProblemCount, noSidewalkCount, otherCount) {
    this._uiModalMissionComplete.curbRampCount.html(curbRampCount);
    this._uiModalMissionComplete.noCurbRampCount.html(noCurbRampCount);
    this._uiModalMissionComplete.obstacleCount.html(obstacleCount);
    this._uiModalMissionComplete.surfaceProblemCount.html(surfaceProblemCount);
    this._uiModalMissionComplete.noSidewalk.html(noSidewalkCount);
    this._uiModalMissionComplete.otherCount.html(otherCount);
};
