/**
 * Tracks the per-label-type counts for the current mission and keeps the global stats in the right sidebar in sync.
 */
class LabelCounter {
    // Label types we track individually; anything else is bucketed into 'Other'.
    static #TYPES = ['CurbRamp', 'NoCurbRamp', 'Obstacle', 'SurfaceProblem', 'NoSidewalk', 'Other'];

    #counts;

    constructor() {
        this.#counts = {};
        for (const type of LabelCounter.#TYPES) this.#counts[type] = 0;
    }

    /**
     * Normalizes an arbitrary label type to one of the tracked keys, falling back to 'Other'.
     * @param {string} labelType
     * @returns {string}
     */
    #normalize(labelType) {
        return LabelCounter.#TYPES.includes(labelType) ? labelType : 'Other';
    }

    /**
     * Returns the current count for a label type, or null if the type isn't tracked.
     * @param {string} labelType
     * @returns {number|null}
     */
    countLabel(labelType) {
        return labelType in this.#counts ? this.#counts[labelType] : null;
    }

    /**
     * Resets all per-type counts to zero. Called when (re)initializing a mission's counts.
     */
    reset() {
        for (const type of LabelCounter.#TYPES) this.#counts[type] = 0;
    }

    /**
     * Increments the count for a label type and updates the global label-count stat.
     * @param {string} labelType
     */
    increment(labelType) {
        const key = this.#normalize(labelType);
        this.#counts[key] += 1;
        svl.overallStats.incrementLabelCount();
    }

    /**
     * Decrements the count for a label type and updates the global label-count stat.
     * @param {string} labelType
     */
    decrement(labelType) {
        if (svl.isOnboarding()) {
            $(document).trigger('RemoveLabel');
        }
        const key = this.#normalize(labelType);
        if (this.#counts[key] > 0) this.#counts[key] -= 1;
        svl.overallStats.decrementLabelCount();
    }

    /**
     * Sets the count for a label type directly (used to seed a mission's counts on load).
     * @param {string} labelType
     * @param {number} num
     */
    set(labelType, num) {
        if (labelType in this.#counts) this.#counts[labelType] = num;
    }
}
