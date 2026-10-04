/**
 * Tests for the date helpers in frontend/js/common/utilities.js that fill the gaps in the browser's `Intl` (#5549).
 *
 * jest.config.js pins the clock to Los Angeles, which is exactly where reading a bare month as UTC goes wrong.
 */

const { installDateHelpers } = require('./loadGlobalScript');

beforeAll(() => {
    window.i18next = { language: 'en' };
    installDateHelpers();
});

describe('util.parseDate', () => {
    test('reads a bare month or day as local midnight, not UTC', () => {
        expect(util.parseDate('2024-10')).toEqual(new Date(2024, 9, 1));
        expect(util.parseDate('2024-10-05')).toEqual(new Date(2024, 9, 5));
    });

    test('reads a bare year as local midnight on Jan 1', () => {
        expect(util.parseDate('2024')).toEqual(new Date(2024, 0, 1));
    });

    test('gives an invalid date for a month or day that does not exist', () => {
        expect(Number.isNaN(util.parseDate('2024-13').getTime())).toBe(true);
        expect(Number.isNaN(util.parseDate('2024-02-30').getTime())).toBe(true);
    });

    test('reads full timestamps and epoch milliseconds the way new Date does', () => {
        expect(util.parseDate('2024-11-01T03:00:00Z').getTime()).toBe(Date.UTC(2024, 10, 1, 3));
        expect(util.parseDate(1700000000000).getTime()).toBe(1700000000000);
    });

    test('gives an invalid date for text it cannot read', () => {
        expect(Number.isNaN(util.parseDate('Invalid date').getTime())).toBe(true);
    });
});

describe('util.localIsoDate', () => {
    test('names the day the reader sees, not the UTC day', () => {
        // 03:00 UTC on Nov 1 is still Oct 31 in Los Angeles.
        expect(util.localIsoDate(new Date('2024-11-01T03:00:00Z'))).toBe('2024-10-31');
    });

    test('gives an empty string for an invalid date', () => {
        expect(util.localIsoDate(new Date(NaN))).toBe('');
    });
});

describe('util.timeAgo', () => {
    const ago = (ms) => util.timeAgo(new Date(Date.now() - ms));
    const MINUTE = 60 * 1000;
    const DAY = 24 * 60 * MINUTE;

    test('uses the largest whole unit, rounded down', () => {
        expect(ago(5 * MINUTE)).toBe('5 minutes ago');
        expect(ago(59.9 * MINUTE)).toBe('59 minutes ago');
        expect(ago(33 * 60 * MINUTE)).toBe('1 day ago');
        expect(ago(3 * DAY)).toBe('3 days ago');
        expect(ago(90 * DAY)).toBe('2 months ago');
        expect(ago(364 * DAY)).toBe('11 months ago');
        expect(ago(800 * DAY)).toBe('2 years ago');
    });

    test('says "now" under a minute, including a slightly future time', () => {
        expect(ago(10 * 1000)).toBe('now');
        expect(util.timeAgo(new Date(Date.now() + 5000))).toBe('now');
    });

    test('follows the page language', () => {
        window.i18next.language = 'de';
        expect(ago(3 * DAY)).toBe('vor 3 Tagen');
        window.i18next.language = 'en';
    });
});
