/**
 * Drives the current mission's completion progress bar and its percentage label in the right sidebar.
 */
class MissionProgressBar {
    #fillerEl;
    #pctEl;

    constructor() {
        this.#fillerEl = document.getElementById('status-current-mission-completion-bar-filler');
        this.#pctEl = document.getElementById('status-current-mission-completion-rate');

        this.setBar(0);
        this.setCompletionRate(0);
    }

    /**
     * Sets the width of the progress bar fill.
     * @param {number} completionRate Fraction complete (0–1).
     */
    setBar(completionRate) {
        const pct = Math.min(100, completionRate * 100);
        this.#fillerEl.style.width = `${pct.toFixed(0)}%`;
    }

    /**
     * Sets the percentage label next to the progress bar.
     * @param {number} completionRate Fraction complete (0–1).
     */
    setCompletionRate(completionRate) {
        let pct = completionRate * 100;
        // The user can exceed the mission target (e.g. audit 503 ft of a 500 ft mission), so clamp at 100%.
        if (pct > 100) pct = 100;
        else if (pct < 100 && pct >= 99.5) pct = 99;
        this.#pctEl.textContent = `${pct.toFixed(0)}%`;
    }
}
