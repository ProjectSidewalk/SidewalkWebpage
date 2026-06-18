/**
 * The "mission complete" modal: a centered card shown over the dimmed Explore tool after a mission finishes. It shows
 *  a map of the streets worked on and labels placed during the mission, a label-type and street-tier legend, the
 *  neighborhood's progress, and distance/label totals for the neighborhood.
 */
class ModalMissionComplete {
    // The mission-count thresholds for each badge level, mirroring the user dashboard (see AchievementTracker).
    static #MISSION_BADGE_THRESHOLDS = [5, 25, 75, 150, 250];

    #missionContainer;
    #taskContainer;
    #map;
    #progressBar;
    #els;

    #isOpen = false;
    #primaryAction = null;
    #showingScreen = false;
    #canContinue = false;
    #legendBuilt = false;

    /**
     * @param missionContainer The mission container.
     * @param missionModel The mission model (emits mission lifecycle events).
     * @param taskContainer The task container.
     * @param modalMissionCompleteMap The map component for the modal.
     */
    constructor(missionContainer, missionModel, taskContainer, modalMissionCompleteMap) {
        this.#missionContainer = missionContainer;
        this.#taskContainer = taskContainer;
        this.#map = modalMissionCompleteMap;

        this.#els = {
            holder: document.getElementById('modal-mission-complete-holder'),
            foreground: document.getElementById('modal-mission-complete-foreground'),
            background: document.getElementById('modal-mission-complete-background'),
            title: document.getElementById('modal-mission-complete-title'),
            subtitle: document.getElementById('modal-mission-complete-subtitle'),
            badge: document.getElementById('modal-mission-complete-badge'),
            labelLegend: document.getElementById('modal-mission-complete-label-legend'),
            communityLegendItem: document.getElementById('modal-mission-complete-legend-community'),
            distanceAll: document.getElementById('modal-mission-complete-distance-all'),
            distanceYou: document.getElementById('modal-mission-complete-distance-you'),
            labelsAll: document.getElementById('modal-mission-complete-labels-all'),
            labelsYou: document.getElementById('modal-mission-complete-labels-you'),
            primaryButton: document.getElementById('modal-mission-complete-close-button-primary'),
            secondaryButton: document.getElementById('modal-mission-complete-close-button-secondary')
        };

        this.#progressBar = new NeighborhoodProgressBar({
            fill: 'modal-neighborhood-progress-fill',
            you: 'modal-neighborhood-progress-you',
            community: 'modal-neighborhood-progress-community',
            rate: 'modal-neighborhood-progress-rate'
        });

        // The primary button starts the next explore mission (or loads a new area); secondary opens validation.
        this.#els.primaryButton.addEventListener('click', () => this.#closeModal('primary'));
        this.#els.secondaryButton.addEventListener('click', () => this.#closeModal('secondary'));

        // The next explore mission can't start until it has loaded, so gate the primary button on that.
        missionModel.on('MissionProgress:complete', () => { this.#canContinue = false; });
        missionContainer.on('MissionContainer:missionLoaded', () => {
            this.#canContinue = true;
            if (this.#showingScreen) this.#updateButtonsEnabled();
        });

        this.hide();
    }

    isOpen() {
        return this.#isOpen;
    }

    /**
     * Populates the modal for the just-completed mission: title, badge, map, legend, progress bar, and stats.
     * @param mission The completed mission.
     * @param neighborhood The neighborhood the mission was in.
     */
    update(mission, neighborhood) {
        const unit = { units: i18next.t('common:unit-distance') };
        const isRoute = svl.neighborhoodModel.isRoute;

        this.#buildLabelLegend();
        this.#updateTitle(mission, neighborhood);
        this.#updateBadge();

        // Render the map asynchronously. We deliberately don't await it: the modal appears right away, and the streets
        // and labels paint in once the map and its label layers are ready.
        const missionId = mission.getProperty('missionId');
        mission.pushATaskToTheRoute(this.#taskContainer.getCurrentTask());
        this.#map.update(this.#buildStreetTiers(mission, missionId), this.#buildLabelData(missionId))
            .catch(e => console.error('Failed to render the mission-complete map.', e));

        // The neighborhood progress bar reads live task data, the same as the sidebar's copy.
        this.#progressBar.update();

        // The community totals don't apply on a user-defined route, so hide them there.
        this.#els.distanceAll.style.display = isRoute ? 'none' : '';
        this.#els.labelsAll.style.display = isRoute ? 'none' : '';
        this.#els.communityLegendItem.style.display = isRoute ? 'none' : '';

        // Distance and the user's own label count come from data already on the client (the user's labels for this
        // neighborhood are loaded at page load; see /label/resumeMission), so they're filled in synchronously.
        this.#els.distanceAll.textContent = i18next.t('mission-complete.stat-distance-all', {
            distance: this.#formatDistance(neighborhood.completedLineDistanceAcrossAllUsersUsingPriority())
        });
        this.#els.distanceYou.textContent = i18next.t('mission-complete.stat-distance-you', {
            distance: this.#formatDistance(neighborhood.completedLineDistance(unit))
        });
        this.#els.labelsYou.textContent = i18next.t('mission-complete.stat-labels-you', {
            count: this.#formatNumber(svl.labelContainer.countLabels())
        });

        // The neighborhood-wide label total is the only stat that needs the server, so fetch it (skipped on routes).
        if (!isRoute) this.#fetchNeighborhoodLabelCount(neighborhood.getRegionId());
    }

    /** Sets the title and subtitle, accounting for finishing a route or a whole neighborhood. */
    #updateTitle(mission, neighborhood) {
        const neighborhoodName = neighborhood.getProperty('name');
        if (svl.neighborhoodModel.isRouteComplete) {
            this.#els.title.textContent = i18next.t('mission-complete.title-route-complete');
        } else if (svl.neighborhoodModel.isNeighborhoodComplete) {
            this.#els.title.textContent = i18next.t('mission-complete.title-neighborhood-complete', { neighborhoodName });
        } else {
            this.#els.title.textContent = i18next.t('mission-complete.title-generic');
        }
        this.#els.subtitle.textContent = i18next.t('mission-complete.subtitle', {
            distance: this.#formatMissionDistance(mission.getDistance('miles')),
            neighborhoodName
        });
    }

    /** Shows the mission badge for the user's total completed-mission count, matching the dashboard. */
    #updateBadge() {
        const liveCount = svl.overallStats.getLiveMissionCount();
        const missionCount = liveCount === null ? svl.missionsCompleted : liveCount;
        const earnedLevel = ModalMissionComplete.#MISSION_BADGE_THRESHOLDS.filter(t => missionCount >= t).length;

        // Show the highest earned badge; before the first is earned (or the first badge if none earned yet).
        const displayLevel = Math.max(1, earnedLevel);
        this.#els.badge.src = `/assets/images/badges/badge_missions_badge${displayLevel}.png`;
        this.#els.badge.alt = i18next.t('mission-complete.badge-alt');
    }

    /**
     * Fetches the neighborhood's total label count (across all users) and fills it in once it resolves.
     * @param {number} regionId The current neighborhood's region id.
     */
    #fetchNeighborhoodLabelCount(regionId) {
        fetch(`/label/countInRegion?regionId=${regionId}`, { headers: { Accept: 'application/json' } })
            .then(response => response.json())
            .then(result => {
                this.#els.labelsAll.textContent = i18next.t('mission-complete.stat-labels-all', {
                    count: this.#formatNumber(result.label_count)
                });
            })
            .catch(e => console.error('Failed to load the neighborhood label count.', e));
    }

    /** Builds the static label-type legend once, matching the label map's colors and names. */
    #buildLabelLegend() {
        if (this.#legendBuilt) return;
        const colors = util.misc.getLabelColors();
        for (const labelType of util.misc.VALID_LABEL_TYPES) {
            const item = document.createElement('li');
            item.className = 'mission-complete__legend-item';

            const dot = document.createElement('span');
            dot.className = 'mission-complete__legend-dot';
            dot.style.backgroundColor = colors[labelType].fillStyle;
            dot.style.borderColor = colors[labelType].strokeStyle;

            const name = document.createElement('span');
            name.textContent = i18next.t('common:' + util.camelToKebab(labelType));

            item.appendChild(dot);
            item.appendChild(name);
            this.#els.labelLegend.appendChild(item);
        }
        this.#legendBuilt = true;
    }

    /**
     * Builds the three street-tier FeatureCollections from the task data: the streets covered in the just-finished
     * mission, the streets the user covered in earlier missions, and the streets completed by the wider community.
     * @param mission The completed mission.
     * @param {number} missionId The completed mission's id.
     * @returns {object} { thisMission, previous, community } GeoJSON FeatureCollections.
     */
    #buildStreetTiers(mission, missionId) {
        const missionTasks = mission.getRoute();
        const missionStreetIds = missionTasks.map(task => task.getStreetEdgeId());

        // This-mission tier: the portion of each mission street that was covered during this mission.
        const thisMissionFeatures = missionTasks.map(task => {
            const missionStart = task.getMissionStart(missionId);
            let coordinates;
            if (missionStart || !task.isComplete()) {
                const start = missionStart ? missionStart : task.getStartCoordinate();
                let end;
                if (task.isComplete()) {
                    end = task.getEndCoordinate();
                } else {
                    const furthest = task.getFurthestPointReached().geometry.coordinates;
                    end = { lat: furthest[1], lng: furthest[0] };
                }
                coordinates = task.getSubsetOfCoordinates(start, end);
            } else {
                coordinates = task.getFeature().geometry.coordinates;
            }
            return { type: 'Feature', geometry: { type: 'LineString', coordinates } };
        });

        // Previous-missions tier: streets the user finished outside this mission, plus the earlier-completed portion of
        // any mission street the user had partly covered before.
        const userCompletedTasks = [...this.#taskContainer.getCompletedTasks()];
        const partialCurrentTask = missionTasks.find(task => !task.isComplete() && task.getMissionStart(missionId));
        if (partialCurrentTask) userCompletedTasks.push(partialCurrentTask);

        const previousFeatures = [];
        for (const task of userCompletedTasks) {
            const missionIndex = missionStreetIds.indexOf(task.getStreetEdgeId());
            if (missionIndex === -1) {
                previousFeatures.push(task.getFeature());
                continue;
            }
            const missionStreet = missionTasks[missionIndex];
            const missionStart = missionStreet.getMissionStart(missionId);
            const streetStart = missionStreet.getStartCoordinate();
            if (missionStart && streetStart) {
                const distFromStart = turf.distance(turf.point([streetStart.lng, streetStart.lat]),
                                                    turf.point([missionStart.lng, missionStart.lat]));
                // Only draw the earlier portion if it's more than a few meters (otherwise it's just the mission start).
                if (distFromStart > 0.003) {
                    const coordinates = missionStreet.getSubsetOfCoordinates(streetStart, missionStart);
                    previousFeatures.push({ type: 'Feature', geometry: { type: 'LineString', coordinates } });
                }
            }
        }

        // Community tier: on a route, the streets still left to do; otherwise, all streets completed by any user.
        const communityTasks = svl.neighborhoodModel.isRoute
            ? this.#taskContainer.getIncompleteTasks()
            : this.#taskContainer.getCompletedTasksAllUsersUsingPriority();

        return {
            thisMission: { type: 'FeatureCollection', features: thisMissionFeatures },
            previous: { type: 'FeatureCollection', features: previousFeatures },
            community: { type: 'FeatureCollection', features: communityTasks.map(task => task.getFeature()) }
        };
    }

    /**
     * Builds a GeoJSON FeatureCollection of the labels the user placed during the given mission.
     * @param {number} missionId The completed mission's id.
     * @returns {object} GeoJSON FeatureCollection of label points.
     */
    #buildLabelData(missionId) {
        const features = svl.labelContainer.getAllLabels()
            .filter(label => !label.isDeleted() && label.getProperty('missionId') === missionId)
            .map(label => {
                const latLng = label.toLatLng();
                return {
                    type: 'Feature',
                    geometry: { type: 'Point', coordinates: [latLng.lng, latLng.lat] },
                    // `has_validations: false` marks the labels as unvalidated so AddLabelsToMap's default filter shows them.
                    properties: {
                        label_id: label.getProperty('temporaryLabelId'),
                        label_type: label.getLabelType(),
                        correct: null,
                        has_validations: false
                    }
                };
            });
        return { type: 'FeatureCollection', features };
    }

    /** Shows the modal, locks walking, and decides which actions the buttons take. */
    show() {
        this.#isOpen = true;

        svl.audioEffect.load('success');
        svl.audioEffect.play('success');

        svl.navigationService.disableWalking();
        svl.navigationService.lockDisableWalking();

        this.#els.holder.style.visibility = 'visible';
        this.#els.foreground.style.visibility = 'visible';
        this.#els.background.style.visibility = 'visible';

        // The map was created while the modal was hidden, so make sure it fills its now-visible container.
        this.#map.resize();

        // The secondary button always opens validation. The primary button starts the next explore mission, or loads a
        // fresh area once the user has finished the whole route/neighborhood.
        this.#els.secondaryButton.textContent = i18next.t('mission-complete.button-try-validation');
        this.#els.primaryButton.textContent = i18next.t('mission-complete.button-next-mission');
        if (svl.neighborhoodModel.isRouteOrNeighborhoodComplete()) {
            this.#primaryAction = 'reloadExplore';
            this.#canContinue = true;
        } else {
            this.#primaryAction = 'explore';
        }

        this.#showingScreen = true;
        this.#updateButtonsEnabled();
    }

    /** Hides the modal and resets the sidebar mission progress bar. */
    hide() {
        this.#isOpen = false;
        this.#showingScreen = false;
        this.#els.holder.style.visibility = 'hidden';
        this.#els.foreground.style.visibility = 'hidden';
        this.#els.background.style.visibility = 'hidden';

        svl.missionProgressBar.setBar(0);
        svl.missionProgressBar.setCompletionRate(0);
    }

    /**
     * Handles a button click: opens validation, reloads explore, or starts the next mission.
     * @param {string} button Which button was clicked: 'primary' or 'secondary'.
     */
    #closeModal(button) {
        const action = button === 'secondary' ? 'validate' : this.#primaryAction;
        if (action === 'validate') {
            window.location.replace('/validate');
        } else if (action === 'reloadExplore') {
            window.location.replace('/explore');
        } else {
            svl.missionPanel.setMessage(this.#missionContainer.getCurrentMission());
            svl.navigationService.unlockDisableWalking();
            svl.navigationService.enableWalking();
            this.hide();
        }
    }

    /** Enables the buttons once the next mission can be started; the validation button is always available. */
    #updateButtonsEnabled() {
        this.#els.secondaryButton.disabled = false;
        this.#els.primaryButton.disabled = !this.#canContinue;
    }

    /** Formats a number using the locale-aware i18next number formatter. */
    #formatNumber(val) {
        return i18next.t('common:format-number', { val });
    }

    /** Formats a distance (already in the user's unit) to one decimal place with its unit abbreviation. */
    #formatDistance(distance) {
        const value = this.#formatNumber(distance.toFixed(1));
        return `${value} ${i18next.t('common:unit-distance-abbreviation')}`;
    }

    /**
     * Formats a mission distance for the subtitle, rounded to the nearest 25 m/ft like the sidebar mission message.
     * @param {number} distanceMiles The mission distance in miles.
     * @returns {string}
     */
    #formatMissionDistance(distanceMiles) {
        const meters = util.math.milesToMeters(distanceMiles);
        const unitAbbreviation = i18next.t('common:unit-abbreviation-mission-distance');
        if (i18next.t('common:measurement-system') === 'metric') {
            return `${util.math.roundToTwentyFive(meters)} ${unitAbbreviation}`;
        }
        return `${util.math.roundToTwentyFive(util.math.metersToFeet(meters))} ${unitAbbreviation}`;
    }
}
