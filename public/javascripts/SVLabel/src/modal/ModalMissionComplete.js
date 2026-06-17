/**
 * Manages the "mission complete" modal: shows/hides it, populates its stats and map, and decides which continue
 * button(s) to show (keep exploring vs. start validating).
 */
class ModalMissionComplete {
    #missionContainer;
    #taskContainer;
    #modalMissionCompleteMap;
    #modalMissionProgressBar;
    #ui;

    #status = {
        isOpen: false,
        primaryAction: null,
        secondaryAction: null
    };
    #showingMissionCompleteScreen = false;
    #canShowContinueButton = false;

    // Closes the modal when a continue button is clicked. jQuery sets event.data.button to 'primary' / 'secondary'.
    #handleCloseButtonClick = (event) => this.#closeModal(event);

    /**
     * @param missionContainer
     * @param missionModel
     * @param taskContainer
     * @param modalMissionCompleteMap
     * @param modalMissionProgressBar
     * @param uiModalMissionComplete
     */
    constructor(missionContainer, missionModel, taskContainer, modalMissionCompleteMap, modalMissionProgressBar,
                uiModalMissionComplete) {
        this.#missionContainer = missionContainer;
        this.#taskContainer = taskContainer;
        this.#modalMissionCompleteMap = modalMissionCompleteMap;
        this.#modalMissionProgressBar = modalMissionProgressBar;
        this.#ui = uiModalMissionComplete;

        // Initialize the modal differently if it's a designated route vs free auditing of a neighborhood.
        if (svl.neighborhoodModel.isRoute) {
            this.#ui.mapLegendLabel3.html(i18next.t('mission-complete.progress-route-remaining'));
            this.#ui.progressTitle.html(i18next.t('mission-complete.progress-route-title'));
            this.#ui.progressYou.html(i18next.t('mission-complete.progress-route-you'));
            this.#ui.progressRemaining.html(i18next.t('mission-complete.progress-route-remaining'));

            // If this is a designated route, remove element(s) related to the entire neighborhood.
            this.#ui.progressOthers.parent().remove();
        } else {
            this.#ui.mapLegendLabel3.html(i18next.t('mission-complete.map-legend-label-other-users'));
            this.#ui.progressTitle.html(i18next.t('mission-complete.progress-neighborhood-title'));
            this.#ui.progressYou.html(i18next.t('mission-complete.progress-neighborhood-you'));
            this.#ui.progressRemaining.html(i18next.t('mission-complete.progress-neighborhood-remaining'));
        }

        missionModel.on("MissionProgress:complete", () => {
            this.#canShowContinueButton = false;
        });

        missionContainer.on("MissionContainer:missionLoaded", () => {
            this.#canShowContinueButton = true;
            if (this.#showingMissionCompleteScreen) {
                this.#enableContinueButton();
            }
        });

        this.#ui.closeButtonPrimary.on("click", { button: 'primary' }, this.#handleCloseButtonClick);
        this.hide();
    }

    // Enables clicking of the continue button(s). Only enabled once the next mission has loaded and the modal is shown.
    #enableContinueButton() {
        this.#ui.closeButtonPrimary.on("click", { button: 'primary' }, this.#handleCloseButtonClick);
        this.#ui.closeButtonSecondary.on("click", { button: 'secondary' }, this.#handleCloseButtonClick);

        this.#ui.closeButtonPrimary.removeClass('btn-loading');
        this.#ui.closeButtonPrimary.addClass('btn-primary');

        this.#ui.closeButtonSecondary.removeClass('btn-loading');
        this.#ui.closeButtonSecondary.addClass('btn-secondary');
    }

    // Disables clicking of the continue button(s) while the next mission is still loading.
    #disableContinueButton() {
        this.#ui.closeButtonPrimary.off('click');
        this.#ui.closeButtonSecondary.off('click');

        this.#ui.closeButtonPrimary.removeClass('btn-primary');
        this.#ui.closeButtonPrimary.addClass('btn-loading');

        this.#ui.closeButtonSecondary.removeClass('btn-secondary');
        this.#ui.closeButtonSecondary.addClass('btn-loading');
    }

    /**
     * Closes the mission complete modal: either starts a new mission or loads the validation page.
     *
     * If the user clicks the 'Start validating' button, send them to the validation page (only shown if this was their
     * first audit mission in the neighborhood or their third audit mission in a row). If they just finished a
     * neighborhood, reload the explore page; otherwise start a new explore mission like normal.
     * @param event The jQuery click event; event.data.button is 'primary' or 'secondary'.
     */
    // TODO maybe deal with lost connection causing modal to not close.
    #closeModal(event) {
        const action = event.data.button === 'primary' ? this.#status.primaryAction : this.#status.secondaryAction;
        if (action === 'validate') {
            window.location.replace('/validate');
        } else if (action === 'reloadExplore') {
            window.location.replace('/explore');
        } else {
            const nextMission = this.#missionContainer.getCurrentMission();
            svl.missionPanel.setMessage(nextMission);
            svl.navigationService.unlockDisableWalking();
            svl.navigationService.enableWalking();
            this.hide();
        }
    }

    // Hides all the pieces of the mission complete modal.
    hide() {
        this.#status.isOpen = false;
        this.#ui.holder.css('visibility', 'hidden');
        this.#ui.foreground.css('visibility', "hidden");
        this.#ui.background.css('visibility', "hidden");
        this.#ui.closeButtonPrimary.css('visibility', "hidden");
        this.#ui.closeButtonSecondary.css('visibility', "hidden");
        this.#ui.closeButtonPrimary.off('click');
        this.#ui.closeButtonSecondary.off('click');

        svl.missionProgressBar.setBar(0);
        svl.missionProgressBar.setCompletionRate(0);
        this.#showingMissionCompleteScreen = false;
    }

    /**
     * Shows all components of the mission complete modal. Decides which continue button(s) to show (audit or validation).
     */
    show() {
        this.#status.isOpen = true;

        // Play mission complete sound effect.
        svl.audioEffect.load('success');
        svl.audioEffect.play('success');

        svl.navigationService.disableWalking();
        svl.navigationService.lockDisableWalking();
        this.#ui.holder.css('visibility', 'visible');
        this.#ui.foreground.css('visibility', "visible");
        this.#ui.background.css('visibility', "visible");
        this.#ui.background.off("click");
        this.#ui.closeButtonPrimary.css('visibility', "visible");

        // Set the mission complete title differently if the user finished their route or the whole neighborhood.
        if (svl.neighborhoodModel.isRouteComplete) {
            this.#setMissionTitle(i18next.t('mission-complete.title-route-complete'));
            this.#canShowContinueButton = true;
        } else if (svl.neighborhoodModel.isNeighborhoodComplete) {
            const neighborhood = svl.neighborhoodModel.currentNeighborhood();
            const neighborhoodName = neighborhood.getProperty("name");
            this.#setMissionTitle(i18next.t('mission-complete.title-neighborhood-complete', { neighborhoodName: neighborhoodName }));
            this.#canShowContinueButton = true;
        }

        // If the user just completed their first audit mission ever, or they finished their third in a row, make the
        // primary button send them to Validate and have the secondary button let them continue exploring. On any other
        // mission just show a 'Continue' button that has them explore more.
        const firstMission = !svl.userHasCompletedAMission && svl.missionsCompleted === 1;
        if ((firstMission || svl.missionsCompleted % 3 === 0 || svl.neighborhoodModel.isRouteOrNeighborhoodComplete())) {
            this.#ui.closeButtonPrimary.html(i18next.t('mission-complete.button-start-validating'));
            this.#status.primaryAction = 'validate';

            this.#ui.closeButtonPrimary.css('width', "50%");
            this.#ui.closeButtonSecondary.css('visibility', "visible");
            this.#ui.closeButtonSecondary.css('width', "48%");
            this.#ui.closeButtonSecondary.html(i18next.t('mission-complete.button-keep-exploring'));
            if (svl.neighborhoodModel.isRouteOrNeighborhoodComplete()) {
                this.#status.secondaryAction = 'reloadExplore';
            } else {
                this.#status.secondaryAction = 'explore';
            }
        } else {
            this.#ui.closeButtonPrimary.css('width', "100%");
            this.#ui.closeButtonPrimary.html(i18next.t('mission-complete.button-continue'));
            this.#status.primaryAction = 'explore';
            this.#ui.closeButtonSecondary.css('visibility', "hidden");
        }

        this.#showingMissionCompleteScreen = true;
        if (this.#canShowContinueButton) {
            this.#enableContinueButton();
        } else {
            this.#disableContinueButton();
        }
    }

    /**
     * Populates the modal's stats, map, and progress bar for the just-completed mission.
     * @param mission The completed mission.
     * @param neighborhood The neighborhood the mission was in.
     */
    update(mission, neighborhood) {
        // Update the horizontal bar chart to show the distance the user has audited.
        const unit = { units: i18next.t('common:unit-distance') };

        const missionDistance = mission.getDistance(unit.units);
        const userAuditedDistance = neighborhood.completedLineDistance(unit);
        const allAuditedDistance = neighborhood.completedLineDistanceAcrossAllUsersUsingPriority();
        let otherAuditedDistance = allAuditedDistance - userAuditedDistance;
        if (svl.neighborhoodModel.isRoute) otherAuditedDistance = 0; // Only show this user's data if on a route.
        const remainingDistance = neighborhood.totalLineDistanceInNeighborhood(unit) - allAuditedDistance;

        const userCompletedTasks = this.#taskContainer.getCompletedTasks();
        const allCompletedTasks = this.#taskContainer.getCompletedTasksAllUsersUsingPriority();
        const incompleteTasks = this.#taskContainer.getIncompleteTasks();
        mission.pushATaskToTheRoute(this.#taskContainer.getCurrentTask());
        const missionTasks = mission.getRoute();
        const totalLineDistance = this.#taskContainer.totalLineDistanceInNeighborhood(unit);
        const missionDistanceRate = missionDistance / totalLineDistance;
        const userAuditedDistanceRate = Math.max(0, userAuditedDistance / totalLineDistance - missionDistanceRate);
        const otherAuditedDistanceRate = Math.max(0, otherAuditedDistance / totalLineDistance);

        const labelCount = mission.getLabelCount();
        const curbRampCount = labelCount ? labelCount["CurbRamp"] : 0;
        const noCurbRampCount = labelCount ? labelCount["NoCurbRamp"] : 0;
        const obstacleCount = labelCount ? labelCount["Obstacle"] : 0;
        const surfaceProblemCount = labelCount ? labelCount["SurfaceProblem"] : 0;
        const noSidewalkCount = labelCount ? labelCount["NoSidewalk"] : 0;
        const otherCount = labelCount ? labelCount["Other"] : 0;

        const neighborhoodName = neighborhood.getProperty("name");
        this.#setMissionTitle(neighborhoodName + ": " + i18next.t('mission-complete.title-generic'));

        this.#modalMissionCompleteMap.updateStreetSegments(missionTasks, userCompletedTasks, allCompletedTasks, mission.getProperty('missionId'), incompleteTasks);
        this.#modalMissionProgressBar.update(missionDistanceRate, userAuditedDistanceRate, otherAuditedDistanceRate);

        this.#updateMissionProgressStatistics(missionDistance, userAuditedDistance, otherAuditedDistance, remainingDistance);
        this.#updateMissionLabelStatistics(curbRampCount, noCurbRampCount, obstacleCount, surfaceProblemCount, noSidewalkCount, otherCount);
    }

    isOpen() {
        return this.#status.isOpen;
    }

    #setMissionTitle(missionTitle) {
        this.#ui.missionTitle.html(missionTitle);
    }

    #updateMissionProgressStatistics(missionDistance, userTotalDistance, othersAuditedDistance, remainingDistance) {
        const distanceType = i18next.t('mission-complete.distance-type-display-string');
        if (remainingDistance > 0.00 && remainingDistance <= 0.10) {
            remainingDistance = 0.1;
        }
        const positiveRemainingDistance = Math.max(remainingDistance, 0);
        const positiveOthersAuditedDistance = Math.max(othersAuditedDistance, 0);
        this.#ui.missionDistance.html(`${missionDistance.toFixed(1)} ${distanceType}`);
        this.#ui.totalAuditedDistance.html(`${userTotalDistance.toFixed(1)} ${distanceType}`);
        this.#ui.othersAuditedDistance.html(`${positiveOthersAuditedDistance.toFixed(1)} ${distanceType}`);
        this.#ui.remainingDistance.html(`${positiveRemainingDistance.toFixed(1)} ${distanceType}`);
    }

    #updateMissionLabelStatistics(curbRampCount, noCurbRampCount, obstacleCount, surfaceProblemCount, noSidewalkCount, otherCount) {
        this.#ui.curbRampCount.html(curbRampCount);
        this.#ui.noCurbRampCount.html(noCurbRampCount);
        this.#ui.obstacleCount.html(obstacleCount);
        this.#ui.surfaceProblemCount.html(surfaceProblemCount);
        this.#ui.noSidewalk.html(noSidewalkCount);
        this.#ui.otherCount.html(otherCount);
    }
}
