/**
 * Tests for the badge math in public/js/common/BadgeAchievements.js — the single source of truth behind every badge
 * tier pill the dashboard and public profile render ("Labeler IV: Barrier Buster").
 *
 * Pins the two contracts DashboardBadges.js relies on: (1) the THRESHOLDS / LEVEL_NAMES / ROMAN tables stay parallel
 * (4 tracks x 5 ascending levels — a missing name or out-of-order threshold silently mislabels every user's badges),
 * and (2) getLevelForValue's boundary behavior (a value exactly at a threshold earns that level).
 *
 * BadgeAchievements.js declares a top-level class: on a page that makes it a global binding, but under require() it
 * stays module-scoped, so the test evaluates the source directly instead of using loadGlobalScript.
 */

const fs = require('fs');
const path = require('path');

const SOURCE = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/common/BadgeAchievements.js'),
    'utf8'
);
// eslint-disable-next-line no-new-func
const evalBadgeAchievements = () => new Function(`${SOURCE}; return BadgeAchievements;`)();
const BadgeAchievements = evalBadgeAchievements();

const TRACKS = ['missions', 'distance', 'labels', 'validations'];

describe('BadgeAchievements badge tables', () => {
    test('every track has exactly 5 thresholds, 5 level names, and a matching Roman numeral', () => {
        expect(Object.keys(BadgeAchievements.THRESHOLDS).sort()).toEqual([...TRACKS].sort());
        expect(Object.keys(BadgeAchievements.LEVEL_NAMES).sort()).toEqual([...TRACKS].sort());
        expect(BadgeAchievements.ROMAN).toEqual(['I', 'II', 'III', 'IV', 'V']);
        for (const track of TRACKS) {
            expect(BadgeAchievements.THRESHOLDS[track]).toHaveLength(5);
            expect(BadgeAchievements.LEVEL_NAMES[track]).toHaveLength(5);
            for (const name of BadgeAchievements.LEVEL_NAMES[track]) {
                expect(typeof name).toBe('string');
                expect(name.length).toBeGreaterThan(0);
            }
        }
    });

    test('thresholds are strictly ascending within every track', () => {
        for (const track of TRACKS) {
            const t = BadgeAchievements.THRESHOLDS[track];
            for (let i = 1; i < t.length; i++) {
                expect(t[i]).toBeGreaterThan(t[i - 1]);
            }
        }
    });
});

describe('BadgeAchievements.getLevelForValue', () => {
    test('0 progress means no badge yet (level 0)', () => {
        for (const track of TRACKS) {
            expect(BadgeAchievements.getLevelForValue(track, 0)).toBe(0);
        }
    });

    test('a value exactly at a threshold earns that level, one below it does not', () => {
        for (const track of TRACKS) {
            BadgeAchievements.THRESHOLDS[track].forEach((threshold, i) => {
                expect(BadgeAchievements.getLevelForValue(track, threshold)).toBe(i + 1);
                expect(BadgeAchievements.getLevelForValue(track, threshold - 0.001)).toBe(i);
            });
        }
    });

    test('values beyond the top threshold cap at level 5', () => {
        for (const track of TRACKS) {
            expect(BadgeAchievements.getLevelForValue(track, Number.MAX_SAFE_INTEGER)).toBe(5);
        }
    });

    test('an unknown track earns nothing rather than throwing', () => {
        expect(BadgeAchievements.getLevelForValue('nonsense', 10_000)).toBe(0);
    });
});

describe('BadgeAchievements.seedCounts', () => {
    // Each test re-evaluates the class so the once-only #seeded latch starts fresh.
    let Badges;
    let consoleError;

    // Drains the seed's promise chain: a macrotask runs only after every pending microtask has settled.
    const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });

    const respondWith = (status, body) => {
        global.fetch = jest.fn(() => Promise.resolve({
            ok: status >= 200 && status < 300,
            status,
            json: () => Promise.resolve(body),
        }));
    };

    // Drives `count` validations through the seeded counter, reporting how many unlock toasts fired.
    const validate = (count) => {
        const toasts = [];
        Badges.showUnlockToast = (badge) => toasts.push(badge);
        for (let i = 0; i < count; i++) Badges.recordValidation();
        return toasts;
    };

    beforeEach(() => {
        Badges = evalBadgeAchievements();
        consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
        global.i18next = {t: (key) => key}; // getBadge localizes the badge's display name.
        global.util = {hasSession: () => true};
    });

    afterEach(() => {
        consoleError.mockRestore();
        delete global.fetch;
        delete global.i18next;
        delete global.util;
    });

    test('seeds the counts from a signed-in response', async () => {
        respondWith(200, {validation_count: 99, mission_count: 4});
        Badges.seedCounts();
        await settle();

        expect(consoleError).not.toHaveBeenCalled();
        // 99 + 1 crosses the 100-validation threshold, so exactly one Validator I toast fires.
        expect(validate(1)).toHaveLength(1);
    });

    test('a page rendered without an identity seeds zero and never requests', async () => {
        global.util = {hasSession: () => false};
        respondWith(200, {validation_count: 4000, mission_count: 200});
        Badges.seedCounts();
        await settle();

        // The request is what has to not happen: the browser logs a 401 as a console error whatever we catch.
        expect(global.fetch).not.toHaveBeenCalled();
        expect(consoleError).not.toHaveBeenCalled();
        expect(validate(100)).toHaveLength(1); // Seeded at zero, so this session's own activity still counts.
    });

    test('a page with no navbar to report session state still requests', async () => {
        global.util = {hasSession: () => null};
        respondWith(200, {validation_count: 99, mission_count: 4});
        Badges.seedCounts();
        await settle();

        expect(global.fetch).toHaveBeenCalledTimes(1);
        expect(validate(1)).toHaveLength(1);
    });

    test('a 401 racing an expired session seeds zero without reporting an error', async () => {
        respondWith(401, undefined);
        Badges.seedCounts();
        await settle();

        expect(consoleError).not.toHaveBeenCalled();
        // Seeded at zero rather than left unknown, so the session's 100th validation still unlocks Validator I.
        const toasts = validate(100);
        expect(toasts).toHaveLength(1);
        expect(toasts[0].roman).toBe('I');
    });

    test('an unexpected failure is reported and leaves the counts unknown', async () => {
        respondWith(500, undefined);
        Badges.seedCounts();
        await settle();

        expect(consoleError).toHaveBeenCalledTimes(1);
        // With no counts to compare against, activity can't claim an unlock it hasn't verified.
        expect(validate(100)).toHaveLength(0);
    });

    test('only the first call fetches', async () => {
        respondWith(200, {validation_count: 1, mission_count: 1});
        Badges.seedCounts();
        Badges.seedCounts();
        await settle();

        expect(global.fetch).toHaveBeenCalledTimes(1);
    });
});
