/**
 * Renders the redesigned dashboard's badge tracks from a user's real contribution counts.
 *
 * Reads each track's type + value from data attributes on the server-rendered skeleton, then uses BadgeAchievements
 * (the single source of truth for thresholds and level names) to compute the earned level and fill in the tier pill,
 * the earned/locked badge icons, the progress bar, and the "N more → next tier" nudge. Distance is handled in the
 * user's unit system (thresholds are canonical miles; km is converted for display).
 */
class DashboardBadges {
    /**
     * @param {HTMLElement} rootEl - The `.ud-badge-tracks` container. Its `data-metric` flag selects km vs miles.
     */
    constructor(rootEl) {
        this.root = rootEl;
        this.isMetric = rootEl.dataset.metric === 'true';
    }

    /** Renders every track inside the root. */
    render() {
        this.root.querySelectorAll('.ud-badge-track').forEach(track => this.#renderTrack(track));
    }

    /**
     * Fills in one track from its `data-badge-type` and `data-value`.
     * @param {HTMLElement} track - A `.ud-badge-track` element.
     */
    #renderTrack(track) {
        const type = track.dataset.badgeType;
        const value = parseFloat(track.dataset.value) || 0;
        const thresholds = BadgeAchievements.THRESHOLDS[type];
        const names = BadgeAchievements.LEVEL_NAMES[type];
        const roman = BadgeAchievements.ROMAN;
        if (!thresholds || !names) return;

        const level = BadgeAchievements.getLevelForValue(type, value);
        const trackName = track.querySelector('.ud-badge-track-name')?.textContent.trim() ?? '';

        // Tier pill: "IV: Barrier Buster", colored by the level's ramp color (.ud-tier-N).
        const pill = track.querySelector('[data-tier]');
        if (pill) {
            pill.className = `ud-badge-track-current ud-tier-${level}`;
            pill.textContent = level >= 1 ? `${roman[level - 1]}: ${names[level - 1]}` : 'Not started';
        }

        // Dim the badge icons above the earned level.
        track.querySelectorAll('.ud-badge').forEach(img => {
            const lvl = parseInt(img.dataset.level, 10);
            img.classList.toggle('ud-badge-locked', lvl > level);
        });

        const fill = track.querySelector('[data-fill]');
        const next = track.querySelector('[data-next]');

        if (level >= 5) {
            if (fill) fill.style.width = '100%';
            if (next) next.textContent = "Maxed out — you're a legend! 🎉";
            return;
        }

        // Progress between the current and next thresholds.
        const prev = level >= 1 ? thresholds[level - 1] : 0;
        const target = thresholds[level];
        const pct = Math.max(0, Math.min(100, ((value - prev) / (target - prev)) * 100));
        if (fill) fill.style.width = `${pct.toFixed(0)}%`;

        if (next) {
            const remaining = this.#formatRemaining(type, target - value);
            next.innerHTML = `${remaining} → <strong>${trackName} ${roman[level]}: ${names[level]}</strong>`;
        }
    }

    /**
     * Formats the amount remaining to the next tier in the user's units.
     * @param {string} type - Badge type.
     * @param {number} remaining - Remaining amount in canonical units (miles for distance, plain counts otherwise).
     * @returns {string} e.g. "716 more labels" or "1.6 km more".
     */
    #formatRemaining(type, remaining) {
        if (type === 'distance') {
            if (this.isMetric) return `${util.math.milesToKms(remaining).toFixed(1)} km more`;
            return `${remaining.toFixed(1)} mi more`;
        }
        const unit = type === 'missions' ? 'missions' : type === 'validations' ? 'validations' : 'labels';
        return `${Math.ceil(remaining).toLocaleString()} more ${unit}`;
    }
}
