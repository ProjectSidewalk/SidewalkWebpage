/**
 * Tests for public/js/user-dashboard/DashboardBadges.js — the dashboard's four badge tracks, rendered from the
 * server-stamped counts on `_badgeTracks.scala.html`'s skeleton.
 *
 * The track's numbers come from BadgeAchievements.getProgress, which Validate's mission-complete standing row reads
 * too. That is the point of these: the two screens draw the same badge from the same counts, so a fraction measured
 * one way here and another way there is a bug that only shows up as the two disagreeing. The tier pill, the locked
 * icons, and the units the "N more" line is written in are this file's own and are pinned alongside.
 */

const fs = require('fs');
const path = require('path');

const SRC = (relativePath) => fs.readFileSync(path.resolve(__dirname, '..', '..', relativePath), 'utf8');

/**
 * Load a bare `class` declaration out of a production file, as the Grunt bundle puts it in page scope.
 * @param {string} relativePath - Path to the file relative to the repo root.
 * @param {string} className - Name of the class the file declares.
 * @returns {Function} The class.
 */
function loadClass(relativePath, className) {
    return (0, eval)('(() => {\n' + SRC(relativePath) + '\nreturn ' + className + ';\n})()');
}

const DashboardBadges = loadClass('public/js/user-dashboard/DashboardBadges.js', 'DashboardBadges');
const BadgeAchievements = loadClass('public/js/common/BadgeAchievements.js', 'BadgeAchievements');

const TRACKS = ['labels', 'distance', 'missions', 'validations'];

describe('DashboardBadges', () => {
    /**
     * Renders the four tracks for the given values, on the markup the Twirl partial emits.
     * @param {Object} values - Value per badge type, e.g. {labels: 300}. Missing tracks render at 0.
     * @param {boolean} [isMetric] - Whether the viewer's units are metric.
     */
    function render(values, isMetric = false) {
        document.body.innerHTML = `
            <div class="ud-badge-tracks" id="ud-badges" data-metric="${isMetric}">
              ${TRACKS.map((type) => `
                <div class="ud-badge-track" data-badge-type="${type}" data-value="${values[type] ?? 0}">
                  <div class="ud-badge-track-head">
                    <span class="ud-badge-track-name">${type}</span>
                    <span class="ud-badge-track-current ud-tier-0" data-tier>—</span>
                  </div>
                  <div class="ud-badge-levels">
                    ${[1, 2, 3, 4, 5].map((lvl) => `<img class="ud-badge" data-level="${lvl}" alt="">`).join('')}
                  </div>
                  <div class="ud-progress"><div class="ud-progress-fill" data-fill></div></div>
                  <span class="ud-badge-track-next" data-next></span>
                </div>`).join('')}
            </div>`;
        new DashboardBadges(document.getElementById('ud-badges')).render();
    }

    /** @returns {HTMLElement} The rendered track for a badge type. */
    const track = (type) => document.querySelector(`[data-badge-type="${type}"]`);

    beforeEach(() => {
        global.BadgeAchievements = BadgeAchievements;
        global.i18next = {t: (key, opts) => (opts ? `${key}|${JSON.stringify(opts)}` : key)};
        global.util = {math: {milesToKms: (mi) => mi * 1.609344}};
    });

    afterEach(() => {
        document.body.innerHTML = '';
        delete global.BadgeAchievements;
        delete global.i18next;
        delete global.util;
    });

    test('every track fills to the same fraction the shared badge math reports', () => {
        const values = {labels: 300, distance: 3, missions: 40, validations: 175};

        render(values);

        for (const type of TRACKS) {
            const {fraction} = BadgeAchievements.getProgress(type, values[type]);
            expect(track(type).querySelector('[data-fill]').style.width)
                .toBe(`${(fraction * 100).toFixed(0)}%`);
        }
    });

    test('the fraction spans the current tier, so a bar fills once per badge', () => {
        render({validations: 175}); // Halfway from Validator I (100) to Validator II (250).

        expect(track('validations').querySelector('[data-fill]').style.width).toBe('50%');
    });

    test('the nudge counts down to the next tier, and names it', () => {
        render({labels: 300}); // Sidewalk Scout (200) earned; Access Ace at 500.

        const next = track('labels').querySelector('[data-next]');
        expect(next.textContent).toContain('"count":200');
        expect(next.querySelector('strong').textContent).toBe('labels III: Access Ace');
    });

    test('someone with nothing yet is not started, and counts toward their first badge', () => {
        render({missions: 0});

        expect(track('missions').querySelector('[data-tier]').textContent).toBe('dashboard:badges.not-started');
        expect(track('missions').querySelector('[data-fill]').style.width).toBe('0%');
        expect(track('missions').querySelector('[data-next]').textContent).toContain('"count":5');
    });

    test('the top tier fills the bar and stops counting down', () => {
        render({validations: 9999});

        expect(track('validations').querySelector('[data-tier]').textContent)
            .toBe('V: Validation Virtuoso');
        expect(track('validations').querySelector('[data-fill]').style.width).toBe('100%');
        expect(track('validations').querySelector('[data-next]').textContent).toBe('dashboard:badges.maxed-out');
    });

    test('the tier pill names the level earned and takes its ramp color', () => {
        render({labels: 300});

        const pill = track('labels').querySelector('[data-tier]');
        expect(pill.textContent).toBe('II: Sidewalk Scout');
        expect(pill.className).toBe('ud-badge-track-current ud-tier-2');
    });

    test('badge icons above the earned level are dimmed, and the earned ones are not', () => {
        render({labels: 300});

        const locked = Array.from(track('labels').querySelectorAll('.ud-badge'))
            .map((img) => img.classList.contains('ud-badge-locked'));
        expect(locked).toEqual([false, false, true, true, true]);
    });

    test('distance is measured in canonical miles but written in the viewer’s units', () => {
        render({distance: 3}, true); // District Rambler at 5 miles: 2 miles short, i.e. ~3.2 km.

        const next = track('distance').querySelector('[data-next]');
        expect(next.textContent).toContain('remaining-distance-km');
        expect(next.textContent).toContain('"dist":"3.2"');
        // The tier itself is still judged against the mile thresholds, not the converted number.
        expect(track('distance').querySelector('[data-tier]').textContent).toBe('II: Neighborhood Nomad');
    });

    test('a track for a type with no thresholds is left alone rather than throwing', () => {
        document.body.innerHTML = `
            <div class="ud-badge-tracks" id="ud-badges" data-metric="false">
              <div class="ud-badge-track" data-badge-type="nonsense" data-value="10">
                <div class="ud-progress"><div class="ud-progress-fill" data-fill></div></div>
                <span class="ud-badge-track-next" data-next></span>
              </div>
            </div>`;

        expect(() => new DashboardBadges(document.getElementById('ud-badges')).render()).not.toThrow();
        expect(document.querySelector('[data-fill]').style.width).toBe('');
    });
});
