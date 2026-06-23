/**
 * A single-fill progress bar: sizes a track fill from a fraction and, optionally, writes a label beside it.
 * Centralizes the fill sizing and completion-percentage formatting shared by the mission, badge, and validation
 * progress bars. The markup is the shared `ps-progress-bar` component (see stylesheets/progress-bar.css and the
 * progressBar Twirl partial). The two-segment neighborhood bar is driven by NeighborhoodProgressBar instead, which
 * reuses formatPercent here for its label.
 */
class ProgressBar {
    #fillEl;
    #labelEl;

    /**
     * @param {string|HTMLElement} fill The fill element, or its id.
     * @param {string|HTMLElement|null} [label] The label element, or its id; omit if the bar has no label.
     */
    constructor(fill, label = null) {
        this.#fillEl = typeof fill === 'string' ? document.getElementById(fill) : fill;
        this.#labelEl = typeof label === 'string' ? document.getElementById(label) : label;
    }

    /**
     * Sizes the fill to a fraction of the track, clamped to [0, 100]%.
     * @param {number} fraction Fraction complete (0–1).
     */
    setFraction(fraction) {
        const pct = Math.min(100, Math.max(0, fraction * 100));
        this.#fillEl.style.width = `${pct.toFixed(0)}%`;
    }

    /**
     * Sets arbitrary label text (e.g. a badge's "current / target" count). A no-op if the bar has no label.
     * @param {string} text The text to display.
     */
    setLabel(text) {
        if (this.#labelEl) this.#labelEl.textContent = text;
    }

    /**
     * Sets the label to a completion percentage. A no-op if the bar has no label.
     * @param {number} fraction Fraction complete (0–1).
     */
    setPercent(fraction) {
        this.setLabel(`${ProgressBar.formatPercent(fraction)}%`);
    }

    /**
     * Sizes the fill and sets a percentage label in one call, for bars whose label is just the percentage.
     * @param {number} fraction Fraction complete (0–1).
     */
    update(fraction) {
        this.setFraction(fraction);
        this.setPercent(fraction);
    }

    /**
     * Formats a fraction as an int percentage, clamped to 100 and rounded so it never reads 100% until actually full.
     * @param {number} fraction Fraction complete (0–1).
     * @returns {string} The integer percentage, without a "%" sign.
     */
    static formatPercent(fraction) {
        let pct = fraction * 100;
        if (pct > 100) pct = 100;
        else if (pct < 100 && pct >= 99.5) pct = 99;
        return pct.toFixed(0);
    }
}
