/**
 * Drives the neighborhood progress bar in the right sidebar. A single rounded "fill" pill is sized to the total
 * audited fraction and clips two flush color segments inside it: the distance audited by everyone else (shown first,
 * in the shared sidebar progress-fill color) and the distance audited by the current user (shown after, in the link
 * color). Together they show how close the whole neighborhood is to being fully audited.
 */
class NeighborhoodProgressBar {
    #fillEl;
    #youEl;
    #communityEl;
    #rateEl;

    constructor() {
        this.#fillEl = document.getElementById('neighborhood-progress-fill');
        this.#youEl = document.getElementById('neighborhood-progress-you');
        this.#communityEl = document.getElementById('neighborhood-progress-community');
        this.#rateEl = document.getElementById('neighborhood-progress-rate');
    }

    /**
     * Recomputes the user's and the community's audited fractions of the neighborhood and resizes the two bar segments.
     * Uses the same priority-based distances as the mission-complete modal.
     */
    update() {
        if (!this.#fillEl || !this.#youEl || !this.#communityEl || !this.#rateEl || !('taskContainer' in svl) || !svl.taskContainer) return;

        const unit = { units: i18next.t('common:unit-distance') };
        const totalDistance = svl.taskContainer.totalLineDistanceInNeighborhood(unit);
        if (!totalDistance) return;

        // Your segment uses your *live* audited distance, which folds in progress on the street you're currently on.
        const userDistance = svl.taskContainer.getCompletedTaskDistance(unit);

        // The community segment is everyone's audited distance minus your *completed-street* distance, deliberately
        // excluding your live in-progress partial. Both of those only change when a whole street is finished (a
        // street's priority drops below 1 only on completion), so the community segment holds steady between street
        // completions instead of being dragged around — and ticking down — on every step as you audit.
        const allDistance = svl.taskContainer.getCompletedTaskDistanceAcrossAllUsersUsingPriority();
        const userCompletedDistance = (svl.taskContainer.getCompletedTasks() || [])
            .reduce((sum, task) => sum + turf.length(task.getGeoJSON(), unit), 0);

        // On a user-defined route we only track this user's own contributions, so don't show community progress.
        const otherDistance = svl.neighborhoodModel.isRoute ? 0 : Math.max(0, allDistance - userCompletedDistance);

        // Clamp each fraction to [0, 1] and keep their sum within 100% so the fill never overflows the track.
        const youFraction = Math.min(1, Math.max(0, userDistance / totalDistance));
        const communityFraction = Math.min(1 - youFraction, Math.max(0, otherDistance / totalDistance));
        const filledFraction = youFraction + communityFraction;

        // Size the rounded pill to the total audited fraction, then split it between the two segments. The segment
        // widths are expressed as shares of the pill (not the whole track), so together they always fill it exactly.
        this.#fillEl.style.width = `${(filledFraction * 100).toFixed(1)}%`;
        if (filledFraction > 0) {
            this.#communityEl.style.width = `${(communityFraction / filledFraction * 100).toFixed(1)}%`;
            this.#youEl.style.width = `${(youFraction / filledFraction * 100).toFixed(1)}%`;
        }

        // Show the combined neighborhood completion percentage next to the bar. Match the mission bar's rounding so we
        // never display 100% until the neighborhood is actually fully audited.
        let pct = filledFraction * 100;
        if (pct > 100) pct = 100;
        else if (pct < 100 && pct >= 99.5) pct = 99;
        this.#rateEl.textContent = `${pct.toFixed(0)}%`;
    }
}
