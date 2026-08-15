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
    this.root.querySelectorAll('.ud-badge-track').forEach((track) => this.#renderTrack(track));
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

    const { level, next: nextBadge, fraction, remaining } = BadgeAchievements.getProgress(type, value);
    const trackName = track.querySelector('.ud-badge-track-name')?.textContent.trim() ?? '';

    // Tier pill: "IV: Barrier Buster", colored by the level's ramp color (.ud-tier-N). Per-level names are
    // deliberately untranslated brand names (#4475).
    const pill = track.querySelector('[data-tier]');
    if (pill) {
      pill.className = `ud-badge-track-current ud-tier-${level}`;
      pill.textContent = level >= 1
        ? `${roman[level - 1]}: ${names[level - 1]}`
        : i18next.t('dashboard:badges.not-started');
    }

    // Dim the badge icons above the earned level.
    track.querySelectorAll('.ud-badge').forEach((img) => {
      const lvl = parseInt(img.dataset.level, 10);
      img.classList.toggle('ud-badge-locked', lvl > level);
    });

    const fill = track.querySelector('[data-fill]');
    const next = track.querySelector('[data-next]');

    if (fill) fill.style.width = `${(fraction * 100).toFixed(0)}%`;
    if (!next) return;

    if (!nextBadge) {
      next.textContent = i18next.t('dashboard:badges.maxed-out');
      return;
    }
    const remainingText = this.#formatRemaining(type, remaining);
    next.innerHTML = `${remainingText} → <strong>${trackName} ${roman[level]}: ${names[level]}</strong>`;
  }

  /**
     * Formats the amount remaining to the next tier in the user's units.
     * @param {string} type - Badge type.
     * @param {number} remaining - Remaining amount in canonical units (miles for distance, plain counts otherwise).
     * @returns {string} e.g. "716 more labels" or "1.6 km more".
     */
  #formatRemaining(type, remaining) {
    if (type === 'distance') {
      if (this.isMetric) {
        const dist = util.math.milesToKms(remaining).toFixed(1);
        return i18next.t('dashboard:badges.remaining-distance-km', { dist });
      }
      return i18next.t('dashboard:badges.remaining-distance-mi', { dist: remaining.toFixed(1) });
    }
    const unit = type === 'missions' ? 'missions' : type === 'validations' ? 'validations' : 'labels';
    return i18next.t(`dashboard:badges.remaining-${unit}`, { count: Math.ceil(remaining) });
  }
}
