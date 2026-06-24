/**
 * Holds the user's global stats (label count, accuracy, distance) shown in the right sidebar. These match the values on
 * the user dashboard and are seeded from /userapi/basicStats, then kept live as the user labels and explores.
 */
class OverallStats {
    #labelsEl;
    #accuracyEl;
    #accuracyHolderEl;
    #distanceEl;
    #distanceUnitEl;

    #isMetric;
    #sessionStartTotalDist = null;
    #sessionStartNeighborhoodDist = null;
    #sessionStartMissionCount = null;
    #stats = { distance: 0, labelCount: 0, accuracy: null };

    // Becomes true once basicStats has seeded the totals, so the seed itself never triggers a badge-unlock toast.
    #seeded = false;

    constructor() {
        this.#labelsEl = document.getElementById('explore-sidebar__stat-labels');
        this.#accuracyEl = document.getElementById('explore-sidebar__stat-accuracy');
        this.#accuracyHolderEl = document.getElementById('explore-sidebar__stat-accuracy-holder');
        this.#distanceEl = document.getElementById('explore-sidebar__stat-distance');
        this.#distanceUnitEl = document.getElementById('explore-sidebar__stat-distance-unit');
        this.#isMetric = i18next.t('common:measurement-system') === 'metric';

        // The distance unit label ("miles" / "kilometers") is fixed for the session.
        this.#distanceUnitEl.textContent = i18next.t('common:unit-distance');

        this.#fetchBasicStats();
    }

    /** Formats a number using the locale-aware i18next number formatter. */
    #formatNumber(val) {
        return i18next.t('common:format-number', { val: val });
    }

    /** Renders the label-count stat and refreshes the labeling badge. */
    #renderLabelCount() {
        this.#labelsEl.textContent = this.#formatNumber(this.#stats.labelCount);
        this.#refreshBadges();
    }

    /** Renders the distance stat and refreshes the exploring badge. */
    #renderDistance() {
        this.#distanceEl.textContent = this.#formatNumber(this.#stats.distance.toFixed(1));
        this.#refreshBadges();
    }

    /** Pushes the current totals to the badge progress display, if it exists yet. */
    #refreshBadges() {
        if (svl.badgeProgress) {
            svl.badgeProgress.render(this.#stats.labelCount, this.#stats.distance, this.#isMetric);
        }
    }

    /** Increments the global label count when a label is added. Tutorial labels aren't saved, so they don't count. */
    incrementLabelCount() {
        if (svl.isOnboarding()) return;
        const prev = this.#stats.labelCount;
        this.#stats.labelCount += 1;
        this.#renderLabelCount();
        this.#checkBadgeUnlock('labels', prev, this.#stats.labelCount);
    }

    /** Decrements the global label count when a label is removed. Tutorial labels aren't saved, so they don't count. */
    decrementLabelCount() {
        if (svl.isOnboarding()) return;
        this.#stats.labelCount -= 1;
        this.#renderLabelCount();
    }

    /**
     * Updates the global distance as the user explores. The neighborhood distance is offset against the session's
     * starting totals so the global figure stays correct even when switching neighborhoods.
     * @param {number} neighborhoodDistance Distance audited in the current neighborhood (user's unit).
     */
    setNeighborhoodAuditedDistance(neighborhoodDistance) {
        // Tutorial exploration isn't saved, so it doesn't count toward the global distance or the exploring badge.
        if (svl.isOnboarding()) return;
        if (this.#sessionStartNeighborhoodDist === null) this.#sessionStartNeighborhoodDist = neighborhoodDistance;
        if (this.#sessionStartTotalDist === null) return; // basicStats not loaded yet.
        const prev = this.#stats.distance;
        this.#stats.distance = this.#sessionStartTotalDist - this.#sessionStartNeighborhoodDist + neighborhoodDistance;
        this.#renderDistance();
        this.#checkBadgeUnlock('distance', prev, this.#stats.distance, { isMetric: this.#isMetric });
    }

    /**
     * Shows a badge-unlock toast over the pano if the value just crossed into a new badge level.
     * @param {string} type Badge type ('labels' or 'distance').
     * @param {number} oldValue The value before this update, in the user's units.
     * @param {number} newValue The value after this update, in the user's units.
     * @param {Object} [opts] Passed through to BadgeAchievements (e.g. { isMetric }).
     */
    #checkBadgeUnlock(type, oldValue, newValue, opts = {}) {
        if (!this.#seeded) return;
        const badge = BadgeAchievements.detectUnlock(type, oldValue, newValue, opts);
        // The toast floats over the pano from <body>, so it just needs the pano's geometry as a positioning reference.
        if (badge) BadgeAchievements.showUnlockToast(badge, document.getElementById('pano'));
    }

    /**
     * The user's total completed-mission count at the moment they finished the just-completed mission.
     */
    getLiveMissionCount() {
        if (this.#sessionStartMissionCount === null) return null;
        return this.#sessionStartMissionCount + svl.missionsCompleted;
    }

    /** Fetches the user's basic stats and seeds the sidebar values. */
    #fetchBasicStats() {
        fetch('/userapi/basicStats', { headers: { Accept: 'application/json' } })
            .then(response => response.json())
            .then(result => {
                this.#sessionStartTotalDist = result.distance_audited;
                this.#sessionStartMissionCount = result.mission_count;
                this.#stats.distance = result.distance_audited;
                this.#stats.labelCount += result.label_count;

                this.#renderDistance();
                this.#renderLabelCount();
                this.#renderAccuracy(result.accuracy);
                this.#seeded = true;
            })
            .catch(e => console.error('Failed to load basic user stats.', e));
    }

    /**
     * Renders the accuracy stat. Accuracy is a fraction (0–1) or null when there isn't enough data yet.
     * @param {?number} accuracy
     */
    #renderAccuracy(accuracy) {
        if (accuracy !== null && accuracy !== undefined) {
            this.#stats.accuracy = 100 * accuracy;
            this.#accuracyEl.textContent = `${Math.round(this.#stats.accuracy)}%`;
            this.#accuracyHolderEl.title = i18next.t('right-ui.accuracy-tooltip').replace(/<[^>]*>/g, '');
        } else {
            this.#accuracyEl.textContent = 'N/A';
            this.#accuracyHolderEl.title = i18next.t('right-ui.no-accuracy-tooltip').replace(/<[^>]*>/g, '');
        }
    }
}
