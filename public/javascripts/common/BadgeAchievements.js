/**
 * Single source of truth for Project Sidewalk's achievement badges, shared across the user dashboard, Explore, and
 * Validate. Holds the level thresholds, level names, and badge icon paths, and provides helpers to figure out which
 * badge a value has earned and to detect (and celebrate) a freshly unlocked badge.
 *
 * There are five levels per badge type. Distance thresholds are canonical in miles; callers working in the user's unit
 * system pass `isMetric` so values are converted before comparison and the kilometer icon variant is chosen.
 */
class BadgeAchievements {
  // Level thresholds per badge type. Distance is in miles; the rest are plain counts.
  static THRESHOLDS = Object.freeze({
    missions: [5, 25, 75, 150, 250],
    distance: [0.5, 2, 5, 10, 20],
    labels: [50, 200, 500, 1000, 2000],
    validations: [100, 250, 500, 1000, 5000],
  });

  static ROMAN = Object.freeze(['I', 'II', 'III', 'IV', 'V']);

  // i18next key (in the shared `common` namespace) for each badge type's display name, e.g. "Explorer".
  static #NAME_KEYS = Object.freeze({
    missions: 'common:badges.adventurer-name',
    distance: 'common:badges.explorer-name',
    labels: 'common:badges.labeler-name',
    validations: 'common:badges.validator-name',
  });

  // Filename stem for each badge type's icon. Note the validation icons are singular ("validation").
  static #ICON_STEMS = Object.freeze({
    missions: 'missions',
    distance: 'distance',
    labels: 'labels',
    validations: 'validation',
  });

  /**
   * Converts a value in the caller's unit system into the canonical units used by the thresholds (miles for dist).
   * @param {string} type Badge type.
   * @param {number} value Value in the caller's units.
   * @param {boolean} isMetric Whether `value` is metric (only affects distance).
   * @returns {number} The value in canonical units.
   */
  static #toCanonical(type, value, isMetric) {
    return type === 'distance' && isMetric ? util.math.kmsToMiles(value) : value;
  }

  /**
   * The highest badge level a value has earned for the given type.
   * @param {string} type Badge type.
   * @param {number} value Value in canonical units (miles for distance).
   * @returns {number} The earned level (1–5), or 0 if no badge has been earned yet.
   */
  static getLevelForValue(type, value) {
    const thresholds = BadgeAchievements.THRESHOLDS[type];
    if (!thresholds) return 0;
    let level = 0;
    for (let i = 0; i < thresholds.length; i++) {
      if (value >= thresholds[i]) level = i + 1;
      else break;
    }
    return level;
  }

  /**
   * Builds the badge descriptor for a given type and level.
   * @param {string} type Badge type.
   * @param {number} level Badge level (1–5).
   * @param {Object} [opts]
   * @param {boolean} [opts.isMetric] Whether to use the kilometer distance icon variant.
   * @returns {?Object} { type, level, roman, name, iconSrc } or null for an out-of-range level.
   */
  static getBadge(type, level, opts = {}) {
    if (level < 1 || level > BadgeAchievements.ROMAN.length) return null;
    const stem = BadgeAchievements.#ICON_STEMS[type] + (type === 'distance' && opts.isMetric ? '_km' : '');
    return {
      type,
      level,
      roman: BadgeAchievements.ROMAN[level - 1],
      name: i18next.t(BadgeAchievements.#NAME_KEYS[type]),
      iconSrc: `/assets/images/badges/badge_${stem}_badge${level}.png`,
    };
  }

  /**
   * Detects whether moving from `oldValue` to `newValue` crossed into a higher badge level.
   * @param {string} type Badge type.
   * @param {number} oldValue Previous value, in the caller's units.
   * @param {number} newValue New value, in the caller's units.
   * @param {Object} [opts]
   * @param {boolean} [opts.isMetric] Whether the values are metric (only affects distance).
   * @returns {?Object} The newly earned badge descriptor (see getBadge), or null if no new level was reached.
   */
  static detectUnlock(type, oldValue, newValue, opts = {}) {
    const oldLevel = BadgeAchievements.getLevelForValue(type, BadgeAchievements.#toCanonical(type, oldValue, opts.isMetric));
    const newLevel = BadgeAchievements.getLevelForValue(type, BadgeAchievements.#toCanonical(type, newValue, opts.isMetric));
    return newLevel > oldLevel ? BadgeAchievements.getBadge(type, newLevel, opts) : null;
  }

  /**
   * Shows the celebratory "you unlocked a badge" toast — the badge-specific specialization of the generic Toast.
   * @param {Object} badge A badge descriptor from getBadge/detectUnlock.
   * @param {HTMLElement} referenceEl The element to float the toast over (the panorama or a modal).
   * @returns {Toast}
   */
  static showUnlockToast(badge, referenceEl) {
    const badgeLabel = `${badge.name} ${badge.roman}`;
    return Toast.show({
      icon: badge.iconSrc,
      title: i18next.t('common:badges.congratulations'),
      message: i18next.t('common:badges.you-earned', { badge: badgeLabel }),
      button: { label: i18next.t('common:badges.my-dashboard'), href: '/dashboard#achievements', newTab: true },
      reference: referenceEl,
    });
  }

  // The user's all-time validation and completed-mission counts, used to detect badge unlocks on pages that don't
  // already track them (Gallery, LabelMap, and — for missions — Validate). Null until seeded from basicStats.
  static #validationCount = null;
  static #missionCount = null;
  static #seeded = false;

  /**
   * Seeds the user's all-time validation & completed-mission counts (once) so new activity can detect a badge unlock.
   */
  static seedCounts() {
    if (BadgeAchievements.#seeded) return;
    BadgeAchievements.#seeded = true;
    fetch('/userapi/basicStats', { headers: { Accept: 'application/json' } })
      .then((response) => response.json())
      .then((result) => {
        BadgeAchievements.#validationCount = result.validation_count;
        BadgeAchievements.#missionCount = result.mission_count;
      })
      .catch((e) => console.error('Failed to seed counts for badge tracking.', e));
  }

  /**
   * Records a newly submitted validation and shows the unlock toast if it crossed into a new validation-badge level.
   * @param {HTMLElement} [referenceEl] The element to float the toast over (the label's panorama, if any).
   */
  static recordValidation(referenceEl) {
    if (BadgeAchievements.#validationCount === null) return;
    const prev = BadgeAchievements.#validationCount;
    BadgeAchievements.#validationCount = prev + 1;
    const badge = BadgeAchievements.detectUnlock('validations', prev, BadgeAchievements.#validationCount);
    if (badge) {
      console.log('showing toast!');
      console.log(referenceEl);
      BadgeAchievements.showUnlockToast(badge, referenceEl);
    }
  }

  /**
   * Records a freshly completed mission and shows the unlock toast if it crossed into a new mission-badge level.
   * @param {HTMLElement} [referenceEl] The element to float the toast over (the mission-complete modal).
   */
  static recordMissionComplete(referenceEl) {
    if (BadgeAchievements.#missionCount === null) return;
    const prev = BadgeAchievements.#missionCount;
    BadgeAchievements.#missionCount = prev + 1;
    const badge = BadgeAchievements.detectUnlock('missions', prev, BadgeAchievements.#missionCount);
    if (badge) BadgeAchievements.showUnlockToast(badge, referenceEl);
  }
}
