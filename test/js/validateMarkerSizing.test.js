/**
 * Tests for util.cappedMarkerDiameter (public/js/common/utilities.js, issue #4838), the rule that sizes Validate's
 * pano label marker.
 *
 * Validate's marker is a DOM element (PanoMarker) sized directly in screen px as `(svv.labelRadius * 2 + 2) *
 * --ui-scale`, so at the 1.8x end of util.applyToolScale's range a 22px mark reached 40px — hiding more of the very
 * feature being judged the larger the validator's window, and drifting away from Explore's marker, which #4838
 * capped at 38px. This caps Validate's on the same ceiling.
 *
 * The rule is deliberately "never grow past the cap", not "never exceed the cap": mobile Validate uses a 52px
 * marker as a phone touch target and never runs applyToolScale, so a flat ceiling would shrink a touch target to
 * answer a desktop problem. That exemption is the reason for the Math.max, and it is pinned below.
 *
 * The 24px pointer-target floor that goes with this lives in CSS (#validate-pano-marker::after in
 * svv-panorama.css), because the mark must stay the size it was drawn while only the target grows.
 */

const fs = require('fs');
const path = require('path');

const UTILITIES_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/common/utilities.js'), 'utf8'
);

// public/js/validate/src/Main.js: svv.labelRadius = util.isMobile() ? 25 : 10, and the marker adds 2px of ring.
const DESKTOP_BASE = 10 * 2 + 2;   // 22
const MOBILE_BASE = 25 * 2 + 2;    // 52

/** Loads utilities.js into jsdom, the same way the other utilities suites do. */
function loadUtil() {
    // utilities.js builds a Bowser parser at load time; the sizing under test never consults it.
    window.bowser = { getParser: () => ({ getBrowserName: () => 'Chrome', getBrowserVersion: () => '1',
        getOSName: () => 'Linux', getPlatformType: () => 'desktop' }) };
    window.eval(UTILITIES_SRC);
    return window.util;
}

describe('util.cappedMarkerDiameter', () => {
    let util;

    /** Validate's desktop marker at the given UI scale, in on-screen CSS px. */
    const desktop = (scale) => util.cappedMarkerDiameter(DESKTOP_BASE, scale);

    beforeEach(() => {
        util = loadUtil();
    });

    describe("Validate's desktop marker", () => {
        test('is unchanged at scale 1', () => {
            expect(desktop(1)).toBe(22);
        });

        test('still grows with the tool below the cap', () => {
            expect(desktop(0.65)).toBeCloseTo(22 * 0.65, 5);
            expect(desktop(1.5)).toBeCloseTo(33, 5);
        });

        test('holds at the shared ceiling once the cap engages', () => {
            expect(desktop(1.8)).toBe(38);   // 1.8 is util.applyToolScale's MAX_SCALE; was 39.6.
        });

        test('the cap engages where the base size reaches the ceiling, and not before', () => {
            const crossover = util.LABEL_ICON_MAX_SCREEN_DIAMETER / DESKTOP_BASE; // ~1.7273
            expect(desktop(crossover - 0.01)).toBeLessThan(38);
            expect(desktop(crossover + 0.01)).toBe(38);
        });

        test('never exceeds the ceiling at any scale in range', () => {
            for (let scale = 0.65; scale <= 1.8001; scale += 0.05) {
                expect(desktop(scale)).toBeLessThanOrEqual(util.LABEL_ICON_MAX_SCREEN_DIAMETER + 1e-9);
            }
        });

        test('never shrinks below what it is today at any scale in range', () => {
            for (let scale = 0.65; scale <= 1.8001; scale += 0.05) {
                expect(desktop(scale)).toBeLessThanOrEqual(DESKTOP_BASE * scale + 1e-9);
                expect(desktop(scale)).toBeGreaterThanOrEqual(Math.min(DESKTOP_BASE * scale, 38) - 1e-9);
            }
        });
    });

    describe("mobile Validate's marker", () => {
        test('keeps its full touch-target size, which is larger than the desktop ceiling', () => {
            // Mobile never runs applyToolScale, so util.uiScale() is 1 there.
            expect(MOBILE_BASE).toBeGreaterThan(util.LABEL_ICON_MAX_SCREEN_DIAMETER);
            expect(util.cappedMarkerDiameter(MOBILE_BASE, 1)).toBe(MOBILE_BASE);
        });

        test('is not capped even if a scale ever reaches it', () => {
            // Belt and braces: the cap limits growth from --ui-scale, so it can never shrink a marker below the
            // base its tool chose, whatever scale it is handed.
            expect(util.cappedMarkerDiameter(MOBILE_BASE, 0.9)).toBeCloseTo(MOBILE_BASE * 0.9, 5);
            expect(util.cappedMarkerDiameter(MOBILE_BASE, 1.5)).toBe(MOBILE_BASE);
        });
    });

    describe('the two tools agree', () => {
        test('Explore and Validate reach the same marker size at the top of the scale range', () => {
            const exploreIcon = 2 * util.labelIconHalfExtent(util.labelIconRadius(1.8)) * 1.8;

            expect(exploreIcon).toBeCloseTo(desktop(1.8), 5);
            expect(exploreIcon).toBeCloseTo(util.LABEL_ICON_MAX_SCREEN_DIAMETER, 5);
        });

        test('but keep their own base sizes below the cap, which is deliberate', () => {
            // Explore's mark is larger by design; #4838 caps growth, it does not unify the two base sizes.
            const exploreIcon = 2 * util.labelIconHalfExtent(util.labelIconRadius(1)) * 1;

            expect(exploreIcon).toBe(31);
            expect(desktop(1)).toBe(22);
        });
    });
});
