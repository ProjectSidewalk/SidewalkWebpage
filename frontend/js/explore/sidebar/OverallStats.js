/**
 * Holds the user's global stats (label count, accuracy, distance) shown in the right sidebar. These match the values on
 * the user dashboard and are seeded from /userapi/basicStats, then kept live as the user labels and explores.
 */

import { BadgeAchievements } from '../../common/BadgeAchievements.js';
import { util } from '../../common/utilities.js';
import '../../common/utilitiesMath.js';
/** @typedef {import('./BadgeProgress.js').BadgeProgress} BadgeProgress */
/** @typedef {import('../Main.js').ExploreConfig} ExploreConfig */

export class OverallStats {
  #config;
  #badgeProgress;
  #labelsEl;
  #accuracyEl;
  #accuracyHolderEl;
  #distanceEl;
  #distanceUnitEl;

  #isMetric;
  #sessionStartTotalDist = null;
  #sessionStartRegionDist = null;
  #sessionStartMissionCount = null;
  #stats = { distance: 0, labelCount: 0, accuracy: null };

  // Becomes true once basicStats has seeded the totals, so the seed itself never triggers a badge-unlock toast.
  #seeded = false;

  /**
   * @param {ExploreConfig} config - The tutorial's labels and distance don't count.
   * @param {BadgeProgress} badgeProgress - Shown the totals as they change.
   */
  constructor(config, badgeProgress) {
    this.#config = config;
    this.#badgeProgress = badgeProgress;
    this.#labelsEl = document.getElementById('explore-sidebar__stat-labels');
    this.#accuracyEl = document.getElementById('explore-sidebar__stat-accuracy');
    this.#accuracyHolderEl = document.getElementById('explore-sidebar__stat-accuracy-holder');
    this.#distanceEl = document.getElementById('explore-sidebar__stat-distance');
    this.#distanceUnitEl = document.getElementById('explore-sidebar__stat-distance-unit');
    this.#isMetric = util.isMetric();

    // The distance unit label ("miles" / "kilometers") is fixed for the session.
    this.#distanceUnitEl.textContent = util.unitWords().unitName;

    this.#fetchBasicStats();
  }

  /** Formats a number using the locale-aware i18next number formatter. */
  #formatNumber(val) {
    return i18next.t('common:format-number', { val });
  }

  /** Renders the label-count stat and refreshes the labeling badge. */
  #renderLabelCount() {
    this.#labelsEl.textContent = this.#formatNumber(this.#stats.labelCount);
    this.#refreshBadges();
  }

  /** Renders the distance stat and refreshes the exploring badge. */
  #renderDistance() {
    this.#distanceEl.textContent = this.#formatNumber(util.math.floorTo(this.#stats.distance, 1).toFixed(1));
    this.#refreshBadges();
  }

  /** Pushes the current totals to the badge progress display. */
  #refreshBadges() {
    this.#badgeProgress.render(this.#stats.labelCount, this.#stats.distance, this.#isMetric);
  }

  /** Increments the global label count when a label is added. Tutorial labels aren't saved, so they don't count. */
  incrementLabelCount() {
    if (this.#config.isOnboarding) return;
    const prev = this.#stats.labelCount;
    this.#stats.labelCount += 1;
    this.#renderLabelCount();
    this.#checkBadgeUnlock('labels', prev, this.#stats.labelCount);
  }

  /** Decrements the global label count when a label is removed. Tutorial labels aren't saved, so they don't count. */
  decrementLabelCount() {
    if (this.#config.isOnboarding) return;
    this.#stats.labelCount -= 1;
    this.#renderLabelCount();
  }

  /**
   * Updates the global distance as the user explores. The region distance is offset against the session's
   * starting totals so the global figure stays correct even when switching regions.
   * @param {number} regionDistance - Distance audited in the current region (user's unit).
   */
  setRegionAuditedDistance(regionDistance) {
    // Tutorial exploration isn't saved, so it doesn't count toward the global distance or the exploring badge.
    if (this.#config.isOnboarding) return;
    if (this.#sessionStartRegionDist === null) this.#sessionStartRegionDist = regionDistance;
    if (this.#sessionStartTotalDist === null) return; // basicStats not loaded yet.
    const prev = this.#stats.distance;
    this.#stats.distance = this.#sessionStartTotalDist - this.#sessionStartRegionDist + regionDistance;
    this.#renderDistance();
    this.#checkBadgeUnlock('distance', prev, this.#stats.distance, { isMetric: this.#isMetric });
  }

  /**
   * Shows a badge-unlock toast over the pano if the value just crossed into a new badge level.
   * @param {string} type - Badge type ('labels' or 'distance').
   * @param {number} oldValue - The value before this update, in the user's units.
   * @param {number} newValue - The value after this update, in the user's units.
   * @param {object} [opts] - Passed through to BadgeAchievements (e.g. { isMetric }).
   */
  #checkBadgeUnlock(type, oldValue, newValue, opts = {}) {
    if (!this.#seeded) return;
    const badge = BadgeAchievements.detectUnlock(type, oldValue, newValue, opts);
    // The toast floats over the pano from <body>, so it just needs the pano's geometry as a positioning reference.
    if (badge) BadgeAchievements.showUnlockToast(badge, document.getElementById('pano'));
  }

  /**
   * The user's total completed-mission count at the moment they finished the just-completed mission.
   * @param {number} missionsCompletedThisSession - How many missions have been finished since the page loaded.
   * @returns {?number} Null until the stats have loaded.
   */
  getLiveMissionCount(missionsCompletedThisSession) {
    if (this.#sessionStartMissionCount === null) return null;
    return this.#sessionStartMissionCount + missionsCompletedThisSession;
  }

  /** Fetches the user's basic stats and seeds the sidebar values. */
  #fetchBasicStats() {
    fetch('/userapi/basicStats', { headers: { Accept: 'application/json' } })
      .then((response) => response.json())
      .then((result) => {
        this.#sessionStartTotalDist = result.distance_audited;
        this.#sessionStartMissionCount = result.mission_count;
        this.#stats.distance = result.distance_audited;
        this.#stats.labelCount += result.label_count;

        this.#renderDistance();
        this.#renderLabelCount();
        this.#renderAccuracy(result.accuracy);
        this.#seeded = true;
      })
      .catch((e) => console.error('Failed to load basic user stats.', e));
  }

  /**
   * Renders the accuracy stat. Accuracy is a fraction (0–1) or null when there isn't enough data yet.
   * @param {?number} accuracy
   */
  #renderAccuracy(accuracy) {
    const hasAccuracy = accuracy !== null && accuracy !== undefined;
    if (hasAccuracy) {
      this.#stats.accuracy = 100 * accuracy;
      this.#accuracyEl.textContent = `${Math.round(this.#stats.accuracy)}%`;
    } else {
      this.#accuracyEl.textContent = 'N/A';
    }
    // The tooltip can't be clicked, so the dashboard link in the text is flattened to plain words.
    const tip = i18next.t(hasAccuracy ? 'right-ui.accuracy-tooltip' : 'right-ui.no-accuracy-tooltip');
    this.#accuracyHolderEl.setAttribute('data-ps-tooltip', util.htmlToText(tip));
  }
}
