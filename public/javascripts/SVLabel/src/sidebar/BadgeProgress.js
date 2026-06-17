/**
 * Renders the user's progress toward their next labeling and exploring badges in the right sidebar.
 *
 * Thresholds mirror those used on the user dashboard (see AchievementTracker). Distance thresholds are defined in miles
 * and converted to kilometers for metric users so the displayed values and badge level match the user's unit system.
 */
class BadgeProgress {
    // Label-count thresholds for each badge level.
    static #LABEL_THRESHOLDS = [50, 200, 500, 1000, 2000];
    // Distance thresholds (miles) for each badge level.
    static #DISTANCE_THRESHOLDS_MILES = [0.5, 2, 5, 10, 20];
    static #ROMAN = ['I', 'II', 'III', 'IV', 'V'];

    // Gap (px, before --ui-scale) between the cursor and the enlarged preview floating above it.
    static #PREVIEW_GAP = 16;
    // Minimum distance (px) the preview keeps from the viewport edges when clamped.
    static #PREVIEW_MARGIN = 8;

    #labelsRow;
    #distanceRow;
    #preview;

    constructor() {
        this.#labelsRow = this.#cacheRow('explore-sidebar__badge-labels');
        this.#distanceRow = this.#cacheRow('explore-sidebar__badge-distance');

        // The sidebar clips its overflow, so the enlarged preview lives on <body> and is positioned on hover.
        this.#preview = document.createElement('img');
        this.#preview.className = 'explore-sidebar__badge-preview';
        this.#preview.alt = '';
        this.#preview.setAttribute('aria-hidden', 'true');
        document.body.appendChild(this.#preview);

        this.#attachHover(this.#labelsRow);
        this.#attachHover(this.#distanceRow);
    }

    /** Caches the child elements of a badge row by its container id. */
    #cacheRow(containerId) {
        const container = document.getElementById(containerId);
        return {
            icon: container.querySelector('.explore-sidebar__badge-icon'),
            iconBase: container.querySelector('.explore-sidebar__badge-icon-base'),
            iconFill: container.querySelector('.explore-sidebar__badge-icon-fill'),
            name: container.querySelector('.explore-sidebar__badge-name'),
            barFill: container.querySelector('.explore-sidebar__progress-fill'),
            count: container.querySelector('.explore-sidebar__badge-count'),
            // The next-badge image source, set during render and shown enlarged on hover.
            iconSrc: null
        };
    }

    /** Wires a badge row's icon to show, follow, and hide the enlarged preview on hover. */
    #attachHover(row) {
        row.icon.addEventListener('mouseenter', (event) => this.#showPreview(row, event));
        row.icon.addEventListener('mousemove', (event) => this.#positionPreview(event));
        row.icon.addEventListener('mouseleave', () => this.#hidePreview());
    }

    /**
     * Shows the enlarged, full-color preview of a row's next-badge icon, floating above the cursor.
     * @param row Cached row elements.
     * @param {MouseEvent} event The triggering pointer event, used for initial placement.
     */
    #showPreview(row, event) {
        if (!row.iconSrc) return;
        if (this.#preview.getAttribute('src') !== row.iconSrc) this.#preview.src = row.iconSrc;
        this.#positionPreview(event);
        this.#preview.classList.add('explore-sidebar__badge-preview--visible');
    }

    /**
     * Positions the preview centered just above the cursor, clamped within the viewport.
     * @param {MouseEvent} event The pointer event providing the cursor position.
     */
    #positionPreview(event) {
        const previewRect = this.#preview.getBoundingClientRect();
        const gap = BadgeProgress.#PREVIEW_GAP * util.uiScale();
        const margin = BadgeProgress.#PREVIEW_MARGIN;

        let left = event.clientX - previewRect.width / 2;
        left = Math.max(margin, Math.min(left, window.innerWidth - previewRect.width - margin));
        let top = event.clientY - previewRect.height - gap;
        if (top < margin) top = event.clientY + gap;

        this.#preview.style.left = `${left}px`;
        this.#preview.style.top = `${top}px`;
    }

    /** Hides the enlarged badge preview. */
    #hidePreview() {
        this.#preview.classList.remove('explore-sidebar__badge-preview--visible');
    }

    /** Formats a number using the locale-aware i18next number formatter. */
    #formatNumber(val) {
        return i18next.t('common:format-number', { val: val });
    }

    /**
     * Renders both badge rows for the given global totals.
     * @param {number} labelCount The user's total label count.
     * @param {number} distance The user's total distance audited, in their unit system.
     * @param {boolean} isMetric Whether the user's unit system is metric.
     */
    render(labelCount, distance, isMetric) {
        this.#renderRow(this.#labelsRow, {
            value: labelCount,
            thresholds: BadgeProgress.#LABEL_THRESHOLDS,
            nameKey: 'right-ui.badges.labeler-name',
            iconFor: (level) => `/assets/images/badges/badge_labels_badge${level}.png`,
            unit: '',
            decimals: 0
        });

        const distanceThresholds = isMetric
            ? BadgeProgress.#DISTANCE_THRESHOLDS_MILES.map(util.math.milesToKms)
            : BadgeProgress.#DISTANCE_THRESHOLDS_MILES;
        this.#renderRow(this.#distanceRow, {
            value: distance,
            thresholds: distanceThresholds,
            nameKey: 'right-ui.badges.explorer-name',
            iconFor: (level) => isMetric
                ? `/assets/images/badges/badge_distance_km_badge${level}.png`
                : `/assets/images/badges/badge_distance_badge${level}.png`,
            unit: i18next.t('common:unit-distance-abbreviation'),
            decimals: 1
        });
    }

    /**
     * Renders a single badge row: next-badge icon + fill, tiered name, progress bar, and "current / target" text.
     * @param row Cached row elements.
     * @param config Row config: value, thresholds, nameKey, iconFor, unit, decimals.
     */
    #renderRow(row, config) {
        const { value, thresholds, nameKey, iconFor, unit, decimals } = config;

        // The next badge is the lowest level the user hasn't reached yet; if they've earned them all, show the top one.
        let nextIndex = thresholds.findIndex(threshold => value < threshold);
        const maxed = nextIndex === -1;
        if (maxed) nextIndex = thresholds.length - 1;

        const level = nextIndex + 1;
        const target = thresholds[nextIndex];
        const fraction = maxed ? 1 : Math.min(value / target, 1);

        // Badge icon: the next level's image, with a colored copy clipped to fill from the bottom by `fraction`.
        const iconSrc = iconFor(level);
        if (row.iconBase.getAttribute('src') !== iconSrc) {
            row.iconBase.src = iconSrc;
            row.iconFill.src = iconSrc;
        }
        row.iconSrc = iconSrc;
        row.iconFill.style.setProperty('--badge-fill', fraction);

        row.name.textContent = `${i18next.t(nameKey)} ${BadgeProgress.#ROMAN[nextIndex]}`;
        row.barFill.style.width = `${(fraction * 100).toFixed(0)}%`;

        // Floor (don't round) the displayed value so it never shows the target before the bar is actually full.
        const factor = 10 ** decimals;
        const flooredValue = (Math.floor(value * factor) / factor).toFixed(decimals);
        const valueText = this.#formatNumber(flooredValue);
        const targetText = this.#formatNumber(Number(target.toFixed(1)));
        row.count.textContent = unit ? `${valueText} / ${targetText} ${unit}` : `${valueText} / ${targetText}`;
    }
}
