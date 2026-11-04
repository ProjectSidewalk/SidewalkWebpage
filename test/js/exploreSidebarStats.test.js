/**
 * The right sidebar's personal stats and badge rows (frontend/js/explore/sidebar/OverallStats.js and
 * BadgeProgress.js, #5840): the totals seeded from /userapi/basicStats and kept live as the labeler works, the badge
 * each row climbs toward, the badge-unlock toast, and the badge tooltip beside a hovered or focused icon.
 */

import { loadModules, mockModule, useUtil } from './loader.js';
import { routeFetch, flush } from './support/routeFetch.js';

/** The unit words the page is served; swapped to kilometers by the metric tests. */
const units = { unitAbbr: 'mi', unitName: 'miles' };

mockModule('i18next', () => ({ default: {
  language: 'en',
  options: { interpolation: { defaultVariables: units } },
  // A number is formatted as itself; a key with values reads `key[name=value,...]`, so a test can see both.
  t: (key, opts) => {
    if (opts?.val !== undefined) return String(opts.val);
    if (key === 'right-ui.accuracy-tooltip') return 'See your <a href="/dashboard">dashboard</a>.';
    const vars = Object.entries(opts ?? {}).filter(([name]) => name !== 'interpolation')
      .map(([name, value]) => `${name}=${value}`);
    return vars.length ? `${key}[${vars.join(',')}]` : key;
  },
} }));

/** One badge row as the Explore view lays it out. */
const badgeRow = (id) => `
  <div id="explore-sidebar__badge-${id}">
    <div class="explore-sidebar__badge-icon" tabindex="0" role="img">
      <img class="explore-sidebar__badge-icon-base" alt=""><img class="explore-sidebar__badge-icon-fill" alt="">
    </div>
    <span class="explore-sidebar__badge-name"></span>
    <div class="ps-progress-bar"><div class="ps-progress-bar__track"><div class="ps-progress-bar__fill"></div></div>
      <span id="explore-sidebar__badge-${id}-count"></span></div>
  </div>`;

const PAGE = `
  <div id="pano"></div>
  <span id="explore-sidebar__stat-labels">–</span>
  <div id="explore-sidebar__stat-accuracy-holder"><span id="explore-sidebar__stat-accuracy">–</span></div>
  <span id="explore-sidebar__stat-distance">–</span><span id="explore-sidebar__stat-distance-unit"></span>
  ${badgeRow('labels')}${badgeRow('distance')}`;

const BASIC_STATS = { distance_audited: 3.456, label_count: 120, accuracy: 0.8765, mission_count: 4 };

let OverallStats;
let BadgeProgress;

beforeEach(async () => {
  document.body.innerHTML = PAGE;
  document.documentElement.dataset.measurementSystem = 'imperial';
  Object.assign(units, { unitAbbr: 'mi', unitName: 'miles' });
  useUtil({ uiScale: () => 1 });
  ({ OverallStats, BadgeProgress } = await loadModules('frontend/js/explore/sidebar/OverallStats.js',
    'frontend/js/explore/sidebar/BadgeProgress.js'));
});

const text = (id) => document.getElementById(`explore-sidebar__${id}`).textContent;
const row = (id) => document.getElementById(`explore-sidebar__badge-${id}`);
const rowName = (id) => row(id).querySelector('.explore-sidebar__badge-name').textContent;
const rowCount = (id) => document.getElementById(`explore-sidebar__badge-${id}-count`).textContent;
const rowIcon = (id) => row(id).querySelector('.explore-sidebar__badge-icon-base').getAttribute('src');
const rowFill = (id) =>
  row(id).querySelector('.explore-sidebar__badge-icon-fill').style.getPropertyValue('--badge-fill');
const rowBar = (id) => row(id).querySelector('.ps-progress-bar__fill').style.width;
const toasts = () => [...document.querySelectorAll('.ps-toast__message')].map((el) => el.textContent);

describe('OverallStats', () => {
  /**
   * Builds the stats over a basicStats answer.
   * @param {object} [stats] - What /userapi/basicStats answers.
   * @param {object} [config] - Explore config members.
   * @returns {Promise<OverallStats>} The stats, once seeded.
   */
  async function seeded(stats = BASIC_STATS, config = {}) {
    routeFetch({ '/userapi/basicStats': stats });
    const overall = new OverallStats({ isOnboarding: false, ...config }, new BadgeProgress());
    await flush();
    return overall;
  }

  it('seeds the totals from basicStats: labels, distance to a tenth, accuracy as a whole percent', async () => {
    await seeded();

    expect(text('stat-labels')).toBe('120');
    expect(text('stat-distance')).toBe('3.4');
    expect(text('stat-distance-unit')).toBe('miles');
    expect(text('stat-accuracy')).toBe('88%');
    // The tooltip can't be clicked, so the dashboard link is flattened to words.
    expect(document.getElementById('explore-sidebar__stat-accuracy-holder').dataset.psTooltip)
      .toBe('See your dashboard.');
    expect(rowName('labels')).toBe('common:badges.labeler-name II');
    expect(rowCount('labels')).toBe('120 / 200');
    expect(rowCount('distance')).toBe('3.4 / 5 mi');
  });

  it('shows N/A, with its own explanation, until there is enough data for an accuracy', async () => {
    await seeded({ ...BASIC_STATS, accuracy: null });

    expect(text('stat-accuracy')).toBe('N/A');
    expect(document.getElementById('explore-sidebar__stat-accuracy-holder').dataset.psTooltip)
      .toBe('right-ui.no-accuracy-tooltip');
  });

  it('counts labels placed and removed, including one placed before the stats arrived', async () => {
    routeFetch({ '/userapi/basicStats': BASIC_STATS });
    const overall = new OverallStats({ isOnboarding: false }, new BadgeProgress());
    overall.incrementLabelCount();
    expect(text('stat-labels')).toBe('1');

    await flush();
    expect(text('stat-labels')).toBe('121');
    overall.decrementLabelCount();
    expect(text('stat-labels')).toBe('120');
    expect(rowCount('labels')).toBe('120 / 200');
  });

  it('folds the region distance into the session total, offset against where the session began', async () => {
    const overall = await seeded();

    overall.setRegionAuditedDistance(1);
    expect(text('stat-distance')).toBe('3.4');
    overall.setRegionAuditedDistance(1.5);
    expect(text('stat-distance')).toBe('3.9');
    expect(rowCount('distance')).toBe('3.9 / 5 mi');
  });

  it('remembers a region distance reported before the stats arrive, without showing it yet', async () => {
    routeFetch({ '/userapi/basicStats': BASIC_STATS });
    const overall = new OverallStats({ isOnboarding: false }, new BadgeProgress());
    overall.setRegionAuditedDistance(1);
    expect(text('stat-distance')).toBe('–');

    await flush();
    overall.setRegionAuditedDistance(1.25);
    expect(text('stat-distance')).toBe('3.7');
  });

  it('ignores tutorial labels and walking, which are never saved', async () => {
    const overall = await seeded(BASIC_STATS, { isOnboarding: true });

    overall.incrementLabelCount();
    overall.decrementLabelCount();
    overall.setRegionAuditedDistance(5);

    expect(text('stat-labels')).toBe('120');
    expect(text('stat-distance')).toBe('3.4');
  });

  it('celebrates a badge the moment a total crosses its threshold, but never for the seed itself', async () => {
    await seeded({ ...BASIC_STATS, label_count: 50 });
    expect(toasts()).toEqual([]);

    const overall = await seeded({ ...BASIC_STATS, label_count: 49, distance_audited: 0.4 });
    vi.useFakeTimers();
    overall.incrementLabelCount();
    expect(toasts()).toEqual(['common:badges.you-earned[badge=common:badges.labeler-name I]']);

    // Toasts show one at a time, so the first is waited out before the next unlock can be seen.
    vi.advanceTimersByTime(7000);
    expect(toasts()).toEqual([]);
    overall.setRegionAuditedDistance(0);
    overall.setRegionAuditedDistance(0.05);
    expect(toasts()).toEqual([]);
    overall.setRegionAuditedDistance(0.2);
    expect(toasts()).toEqual(['common:badges.you-earned[badge=common:badges.explorer-name I]']);
  });

  it('judges a metric reader\'s distance against the thresholds in kilometers', async () => {
    document.documentElement.dataset.measurementSystem = 'metric';
    Object.assign(units, { unitAbbr: 'km', unitName: 'kilometers' });
    // 0.7 km is short of the half-mile badge; 0.9 km is past it.
    const overall = await seeded({ ...BASIC_STATS, distance_audited: 0.7 });

    overall.setRegionAuditedDistance(0);
    overall.setRegionAuditedDistance(0.2);

    expect(text('stat-distance-unit')).toBe('kilometers');
    expect(toasts()).toEqual(['common:badges.you-earned[badge=common:badges.explorer-name I]']);
    expect(document.querySelector('.ps-toast img').getAttribute('src')).toContain('badge_distance_km_badge1.svg');
  });

  it('knows the live mission count only once the stats have loaded', async () => {
    routeFetch({ '/userapi/basicStats': BASIC_STATS });
    const overall = new OverallStats({ isOnboarding: false }, new BadgeProgress());
    expect(overall.getLiveMissionCount(2)).toBeNull();

    await flush();
    expect(overall.getLiveMissionCount(2)).toBe(6);
  });

  it('logs a failed stats load and leaves the placeholders in place', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await seeded(new Error('offline'));

    expect(error).toHaveBeenCalledWith('Failed to load basic user stats.', expect.any(Error));
    expect(text('stat-labels')).toBe('–');
  });
});

describe('BadgeProgress', () => {
  it('shows the next badge level, its icon filled to the fraction earned, and the count toward it', () => {
    const badges = new BadgeProgress();
    badges.render(120, 3.4, false);

    expect(rowName('labels')).toBe('common:badges.labeler-name II');
    expect(rowIcon('labels')).toBe('/assets/images/badges/badge_labels_badge2.svg');
    expect(rowFill('labels')).toBe('0.6');
    expect(rowBar('labels')).toBe('60%');
    expect(rowCount('labels')).toBe('120 / 200');
    expect(row('labels').querySelector('.explore-sidebar__badge-icon').getAttribute('aria-label'))
      .toBe('common:badges.labeler-name II. audit:right-ui.badges.labeler-goal '
        + 'audit:right-ui.badges.next-labels[count=200]');

    expect(rowName('distance')).toBe('common:badges.explorer-name III');
    expect(rowIcon('distance')).toBe('/assets/images/badges/badge_distance_badge3.svg');
    expect(Number(rowFill('distance'))).toBeCloseTo(0.68);
    expect(rowCount('distance')).toBe('3.4 / 5 mi');
  });

  it('converts the distance thresholds to kilometers for a metric reader, with the kilometer icon', () => {
    Object.assign(units, { unitAbbr: 'km', unitName: 'kilometers' });
    const badges = new BadgeProgress();
    badges.render(0, 7.5, true);

    // Five miles is 8.05 km, so 7.5 km is still short of the third badge.
    expect(rowName('distance')).toBe('common:badges.explorer-name III');
    expect(rowIcon('distance')).toBe('/assets/images/badges/badge_distance_km_badge3.svg');
    expect(rowCount('distance')).toBe('7.5 / 8 km');
    expect(row('distance').querySelector('.explore-sidebar__badge-icon').getAttribute('aria-label'))
      .toContain('audit:right-ui.badges.next-distance[distance=8 km]');
  });

  it('shows the top badge, full, with a congratulations line once every level is earned', () => {
    const badges = new BadgeProgress();
    badges.render(5000, 50, false);

    expect(rowName('labels')).toBe('common:badges.labeler-name V');
    expect(rowFill('labels')).toBe('1');
    expect(rowBar('labels')).toBe('100%');
    expect(rowCount('labels')).toBe('5000 / 2000');
    expect(row('labels').querySelector('.explore-sidebar__badge-icon').getAttribute('aria-label'))
      .toContain('audit:right-ui.badges.earned-all');
  });

  it('floors the shown total, so it never reads as the target before the bar is full', () => {
    const badges = new BadgeProgress();
    badges.render(0, 4.97, false);

    expect(rowCount('distance')).toBe('4.9 / 5 mi');
    expect(rowBar('distance')).toBe('99%');
  });

  it('leaves the icon alone when a re-render stays on the same level', () => {
    const badges = new BadgeProgress();
    badges.render(10, 0, false);
    const base = row('labels').querySelector('.explore-sidebar__badge-icon-base');
    const setter = vi.spyOn(HTMLImageElement.prototype, 'src', 'set');

    badges.render(20, 0, false);
    expect(setter).not.toHaveBeenCalled();
    badges.render(60, 0, false);
    expect(base.getAttribute('src')).toBe('/assets/images/badges/badge_labels_badge2.svg');
  });

  describe('the tooltip beside a badge icon', () => {
    const tooltip = () => document.querySelector('.explore-sidebar__badge-tooltip');
    const shown = () => tooltip().classList.contains('explore-sidebar__badge-tooltip--visible');
    const icon = (id) => row(id).querySelector('.explore-sidebar__badge-icon');

    /**
     * Gives the icon and the tooltip fixed on-screen boxes.
     * @param {{left: number, top: number}} iconAt - The icon's corner; it is 40px square.
     */
    function layOut(iconAt) {
      icon('labels').getBoundingClientRect = () => new DOMRect(iconAt.left, iconAt.top, 40, 40);
      tooltip().getBoundingClientRect = () => new DOMRect(0, 0, 200, 60);
      window.innerHeight = 768;
    }

    it('says nothing until the row has rendered', () => {
      new BadgeProgress();
      icon('labels').dispatchEvent(new Event('mouseenter'));
      expect(shown()).toBe(false);
    });

    it('shows the next badge\'s name, goal and icon to the left of the hovered icon, and hides on leave', () => {
      const badges = new BadgeProgress();
      badges.render(120, 3.4, false);
      layOut({ left: 500, top: 300 });

      icon('labels').dispatchEvent(new Event('mouseenter'));
      expect(shown()).toBe(true);
      expect(tooltip().querySelector('.explore-sidebar__badge-tooltip-name').textContent)
        .toBe('common:badges.labeler-name II');
      expect(tooltip().querySelector('.explore-sidebar__badge-tooltip-desc').textContent)
        .toBe('audit:right-ui.badges.labeler-goal audit:right-ui.badges.next-labels[count=200]');
      expect(tooltip().querySelector('img').getAttribute('src')).toBe('/assets/images/badges/badge_labels_badge2.svg');
      expect(tooltip().style.left).toBe('288px');
      expect(tooltip().style.top).toBe('290px');

      icon('labels').dispatchEvent(new Event('mouseleave'));
      expect(shown()).toBe(false);
    });

    it('opens on keyboard focus too, and closes when focus leaves', () => {
      const badges = new BadgeProgress();
      badges.render(120, 3.4, false);
      layOut({ left: 500, top: 300 });

      icon('distance').dispatchEvent(new Event('focusin'));
      expect(shown()).toBe(true);
      expect(tooltip().querySelector('.explore-sidebar__badge-tooltip-name').textContent)
        .toBe('common:badges.explorer-name III');
      icon('distance').dispatchEvent(new Event('focusout'));
      expect(shown()).toBe(false);
    });

    it('moves to the right of an icon near the left edge, and stays inside the window top and bottom', () => {
      const badges = new BadgeProgress();
      badges.render(120, 3.4, false);

      layOut({ left: 100, top: 5 });
      icon('labels').dispatchEvent(new Event('mouseenter'));
      expect(tooltip().style.left).toBe('152px');
      expect(tooltip().style.top).toBe('8px');

      layOut({ left: 500, top: 760 });
      icon('labels').dispatchEvent(new Event('mouseenter'));
      expect(tooltip().style.top).toBe('700px');
    });

    it('keeps the icon it already shows when the same row is hovered again', () => {
      const badges = new BadgeProgress();
      badges.render(120, 3.4, false);
      layOut({ left: 500, top: 300 });
      icon('labels').dispatchEvent(new Event('mouseenter'));
      const setter = vi.spyOn(HTMLImageElement.prototype, 'src', 'set');

      icon('labels').dispatchEvent(new Event('mouseenter'));
      expect(setter).not.toHaveBeenCalled();
    });
  });
});
