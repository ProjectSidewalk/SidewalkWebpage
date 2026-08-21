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

  // Themed, progressively cooler level names per badge type — the single source of truth for the dashboard/profile
  // tier pills (e.g. "Labeler IV: Barrier Buster"). Index 0 = level I. Brand names kept in English for now (the badge
  // *type* names are i18n'd via #NAME_KEYS; these per-level names can move to i18n later if we localize them).
  static LEVEL_NAMES = Object.freeze({
    missions: ['First Steps', 'Trailblazer', 'Pathfinder', 'Quest Master', 'Grand Wayfarer'],
    distance: ['Block Walker', 'Neighborhood Nomad', 'District Rambler', 'City Trekker', 'Metro Voyager'],
    labels: ['Curb Spotter', 'Sidewalk Scout', 'Access Ace', 'Barrier Buster', 'Sidewalk Sage'],
    validations: ['Fact Checker', 'Peer Reviewer', 'Quality Guardian', 'Truth Keeper', 'Validation Virtuoso'],
  });

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
   * Where a value stands on its badge track: what it has earned, what it is climbing toward, and how far along it is.
   *
   * The fraction is measured across the current tier — from the threshold that earned the badge in hand to the one
   * that earns the next — so a bar drawn from it fills once per badge rather than creeping across the whole track.
   * Anyone with no badge yet is on the first tier, which starts at zero. This is the one place that arithmetic
   * lives: the dashboard's badge tracks and Validate's mission-complete screen both read it, and each having its own
   * copy is how the two would come to disagree about the same number.
   *
   * @param {string} type Badge type.
   * @param {number} value Value in canonical units (miles for distance).
   * @param {Object} [opts]
   * @param {boolean} [opts.isMetric] Whether to use the kilometer distance icon variant on the returned badges.
   * @returns {Object} `{ level, badge, next, earnedAt, nextAt, fraction, remaining }`. `badge` is null before the
   *      first level; at the top level `next` is null, `nextAt` and `remaining` are 0, and `fraction` is 1. A type
   *      with no track reports an empty progress rather than throwing.
   */
  static getProgress(type, value, opts = {}) {
    const thresholds = BadgeAchievements.THRESHOLDS[type];
    if (!thresholds) return { level: 0, badge: null, next: null, earnedAt: 0, nextAt: 0, fraction: 0, remaining: 0 };

    const level = BadgeAchievements.getLevelForValue(type, value);
    const badge = BadgeAchievements.getBadge(type, level, opts);
    const next = BadgeAchievements.getBadge(type, level + 1, opts);
    const earnedAt = level > 0 ? thresholds[level - 1] : 0;

    if (!next) return { level, badge, next: null, earnedAt, nextAt: 0, fraction: 1, remaining: 0 };

    const nextAt = thresholds[level];
    const span = nextAt - earnedAt;
    const fraction = span > 0 ? Math.min(1, Math.max(0, (value - earnedAt) / span)) : 0;
    return { level, badge, next, earnedAt, nextAt, fraction, remaining: Math.max(0, nextAt - value) };
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
    const oldLevel = BadgeAchievements.getLevelForValue(
      type, BadgeAchievements.#toCanonical(type, oldValue, opts.isMetric),
    );
    const newLevel = BadgeAchievements.getLevelForValue(
      type, BadgeAchievements.#toCanonical(type, newValue, opts.isMetric),
    );
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
   *
   * Gallery and LabelMap render without minting a session (#4643), and basicStats needs one. A visitor without an
   * identity has no contribution history, and the session a first contribution mints (#4442) starts empty, so zero
   * is the honest seed — it costs no request and keeps badge detection live for them. The 401 branch covers the
   * narrow race where the session lapses between render and fetch.
   */
  static seedCounts() {
    if (BadgeAchievements.#seeded) return;
    BadgeAchievements.#seeded = true;
    if (util.hasSession() === false) {
      BadgeAchievements.#validationCount = 0;
      BadgeAchievements.#missionCount = 0;
      return;
    }
    fetch('/userapi/basicStats', { headers: { Accept: 'application/json' } })
      .then((response) => {
        if (response.status === 401) return { validation_count: 0, mission_count: 0 };
        if (!response.ok) throw new Error(`/userapi/basicStats responded ${response.status}`);
        return response.json();
      })
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
    if (badge) BadgeAchievements.showUnlockToast(badge, referenceEl);
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
