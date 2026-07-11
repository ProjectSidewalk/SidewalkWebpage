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
const BadgeAchievements = new Function(`${SOURCE}; return BadgeAchievements;`)();

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
