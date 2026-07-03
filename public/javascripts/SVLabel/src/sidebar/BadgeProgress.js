/**
 * Renders the user's progress toward their next labeling and exploring badges in the right sidebar.
 *
 * Thresholds mirror those used on the user dashboard (see AchievementTracker). Distance thresholds are defined in miles
 * and converted to kilometers for metric users so the displayed values and badge level match the user's unit system.
 */
class BadgeProgress {
    // Gap (px, before --ui-scale) between the badge icon and the tooltip beside it.
    static #TOOLTIP_GAP = 12;
    // Minimum distance (px) the tooltip keeps from the viewport edges when clamped.
    static #TOOLTIP_MARGIN = 8;

    #labelsRow;
    #distanceRow;
    #tooltip;
    #tooltipIcon;
    #tooltipName;
    #tooltipDesc;

    constructor() {
        this.#labelsRow = this.#cacheRow('explore-sidebar__badge-labels', 'explore-sidebar__badge-labels-count');
        this.#distanceRow = this.#cacheRow('explore-sidebar__badge-distance', 'explore-sidebar__badge-distance-count');

        // The sidebar clips its overflow, so the tooltip lives on <body> and is positioned next to the hovered badge.
        this.#tooltip = document.createElement('div');
        this.#tooltip.className = 'explore-sidebar__badge-tooltip';
        this.#tooltip.setAttribute('role', 'presentation');
        this.#tooltip.setAttribute('aria-hidden', 'true');

        this.#tooltipIcon = document.createElement('img');
        this.#tooltipIcon.className = 'explore-sidebar__badge-tooltip-icon';
        this.#tooltipIcon.alt = '';

        const body = document.createElement('div');
        body.className = 'explore-sidebar__badge-tooltip-body';
        this.#tooltipName = document.createElement('span');
        this.#tooltipName.className = 'explore-sidebar__badge-tooltip-name';
        this.#tooltipDesc = document.createElement('p');
        this.#tooltipDesc.className = 'explore-sidebar__badge-tooltip-desc';
        body.appendChild(this.#tooltipName);
        body.appendChild(this.#tooltipDesc);

        this.#tooltip.appendChild(this.#tooltipIcon);
        this.#tooltip.appendChild(body);
        document.body.appendChild(this.#tooltip);

        this.#attachHover(this.#labelsRow);
        this.#attachHover(this.#distanceRow);
    }

    /**
     * Caches the child elements of a badge row.
     * @param {string} containerId Id of the row's container element.
     * @param {string} countId Id of the row's progress-bar label (the "current / target" count).
     */
    #cacheRow(containerId, countId) {
        const container = document.getElementById(containerId);
        return {
            icon: container.querySelector('.explore-sidebar__badge-icon'),
            iconBase: container.querySelector('.explore-sidebar__badge-icon-base'),
            iconFill: container.querySelector('.explore-sidebar__badge-icon-fill'),
            name: container.querySelector('.explore-sidebar__badge-name'),
            bar: new ProgressBar(container.querySelector('.ps-progress-bar__fill'), countId),
            // Tooltip content for this row, set during render and shown on hover/focus.
            iconSrc: null,
            tooltipName: '',
            tooltipDesc: '',
        };
    }

    /**
     * Wires a badge row's icon to show/hide its tooltip. The icon is focusable, so the tooltip is keyboard-reachable as
     * well as hoverable; the descriptive text is mirrored onto the icon's aria-label in #renderRow.
     */
    #attachHover(row) {
        row.icon.addEventListener('mouseenter', () => this.#showTooltip(row));
        row.icon.addEventListener('mouseleave', () => this.#hideTooltip());
        row.icon.addEventListener('focusin', () => this.#showTooltip(row));
        row.icon.addEventListener('focusout', () => this.#hideTooltip());
    }

    /**
     * Shows the tooltip for a row, populated with the next badge's enlarged icon, name, and how-to-earn text.
     * @param row Cached row elements.
     */
    #showTooltip(row) {
        if (!row.iconSrc) return;
        if (this.#tooltipIcon.getAttribute('src') !== row.iconSrc) this.#tooltipIcon.src = row.iconSrc;
        this.#tooltipName.textContent = row.tooltipName;
        this.#tooltipDesc.textContent = row.tooltipDesc;
        this.#tooltip.classList.add('explore-sidebar__badge-tooltip--visible');
        this.#positionTooltip(row);
    }

    /**
     * Positions the tooltip just to the left of the badge icon.
     * @param row Cached row elements.
     */
    #positionTooltip(row) {
        const iconRect = row.icon.getBoundingClientRect();
        const tipRect = this.#tooltip.getBoundingClientRect();
        const gap = BadgeProgress.#TOOLTIP_GAP * util.uiScale();
        const margin = BadgeProgress.#TOOLTIP_MARGIN;

        let left = iconRect.left - gap - tipRect.width;
        if (left < margin) left = iconRect.right + gap;

        let top = iconRect.top + iconRect.height / 2 - tipRect.height / 2;
        top = Math.max(margin, Math.min(top, window.innerHeight - tipRect.height - margin));

        this.#tooltip.style.left = `${left}px`;
        this.#tooltip.style.top = `${top}px`;
    }

    /** Hides the badge tooltip. */
    #hideTooltip() {
        this.#tooltip.classList.remove('explore-sidebar__badge-tooltip--visible');
    }

    /** Formats a number using the locale-aware i18next number formatter. */
    #formatNumber(val) {
        return i18next.t('common:format-number', { val });
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
            thresholds: BadgeAchievements.THRESHOLDS.labels,
            nameKey: 'common:badges.labeler-name',
            goalKey: 'audit:right-ui.badges.labeler-goal',
            iconFor: (level) => `/assets/images/badges/badge_labels_badge${level}.png`,
            nextText: (target) => i18next.t('audit:right-ui.badges.next-labels', { count: target }),
            unit: '',
            decimals: 0,
        });

        const distanceThresholds = isMetric
            ? BadgeAchievements.THRESHOLDS.distance.map(util.math.milesToKms)
            : BadgeAchievements.THRESHOLDS.distance;
        const distanceUnit = i18next.t('common:unit-distance-abbreviation');
        this.#renderRow(this.#distanceRow, {
            value: distance,
            thresholds: distanceThresholds,
            nameKey: 'common:badges.explorer-name',
            goalKey: 'audit:right-ui.badges.explorer-goal',
            iconFor: (level) => (isMetric
                ? `/assets/images/badges/badge_distance_km_badge${level}.png`
                : `/assets/images/badges/badge_distance_badge${level}.png`),
            // The badge's total distance goal, shown to one decimal place.
            nextText: (target) => i18next.t('audit:right-ui.badges.next-distance', {
                distance: `${this.#formatNumber(Number(target.toFixed(1)))} ${distanceUnit}`,
            }),
            unit: distanceUnit,
            decimals: 1,
        });
    }

    /**
     * Renders a single badge row: next-badge icon + fill, tiered name, progress bar, "current / target" text, and the
     * tooltip content (name + goal + how-to-earn) shown on hover/focus.
     * @param row Cached row elements.
     * @param config Row config: value, thresholds, nameKey, goalKey, iconFor, nextText, unit, decimals.
     */
    #renderRow(row, config) {
        const { value, thresholds, nameKey, goalKey, iconFor, nextText, unit, decimals } = config;

        // The next badge is the lowest level the user hasn't reached yet; if they've earned them all, show the top one.
        let nextIndex = thresholds.findIndex((threshold) => value < threshold);
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

        const badgeName = `${i18next.t(nameKey)} ${BadgeAchievements.ROMAN[nextIndex]}`;
        row.name.textContent = badgeName;
        row.bar.setFraction(fraction);

        // Tooltip: the badge's goal, plus the total it takes to earn it (or a congrats line once it's maxed out).
        const howTo = maxed ? i18next.t('audit:right-ui.badges.earned-all') : nextText(target);
        row.tooltipName = badgeName;
        row.tooltipDesc = `${i18next.t(goalKey)} ${howTo}`;
        row.icon.setAttribute('aria-label', `${badgeName}. ${row.tooltipDesc}`);

        // Floor (don't round) the displayed value so it never shows the target before the bar is actually full.
        const factor = 10 ** decimals;
        const flooredValue = (Math.floor(value * factor) / factor).toFixed(decimals);
        const valueText = this.#formatNumber(flooredValue);
        const targetText = this.#formatNumber(Number(target.toFixed(1)));
        row.bar.setLabel(unit ? `${valueText} / ${targetText} ${unit}` : `${valueText} / ${targetText}`);
    }
}
