/**
 * Tests for util.labelIconRadius / util.labelHitMargin (public/js/common/utilities.js, issue #4838).
 *
 * Explore draws into a fixed 720x480 logical frame that is displayed at var(--ui-scale) (0.65x-1.8x). A constant
 * icon radius therefore grew with the tool, reaching 56 on-screen px at the scale cap — well past the 38px labeling
 * cursor the user aims with. These two helpers cap the drawn icon in *screen* px and size the click target to the
 * icon rather than deriving it from the radius.
 *
 * Everything below is asserted in on-screen CSS px (logical value x scale), because that is the thing being capped;
 * the logical values are an implementation detail that moves with the scale by design.
 */

const fs = require('fs');
const path = require('path');

const UTILITIES_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/common/utilities.js'), 'utf8'
);

/**
 * Loads utilities.js into jsdom. It is a plain global script, but its tail constructs a Bowser parser and reads
 * navigator/jQuery, so only the section up to that point is evaluated here.
 */
function loadUtil() {
    const src = UTILITIES_SRC.slice(0, UTILITIES_SRC.indexOf('// Browser detection helpers backed by Bowser'));
    window.util = {};
    window.eval(src);
    return window.util;
}

describe('label icon sizing across the UI scale', () => {
    let util;

    /** On-screen diameter in CSS px of the icon Label.renderLabelIcon draws (2 * radius - 3) at this scale. */
    const iconScreenDiameter = (scale) => (2 * util.labelIconRadius(scale) - 3) * scale;

    /** On-screen width in CSS px of the square click target Label.isOn tests (2 * margin) at this scale. */
    const targetScreenSize = (scale) => 2 * util.labelHitMargin(scale) * scale;

    beforeEach(() => {
        util = loadUtil();
    });

    describe('util.labelIconRadius', () => {
        test('is unchanged at scale 1', () => {
            expect(util.labelIconRadius(1)).toBe(17);            // The value Explore used before the cap.
            expect(iconScreenDiameter(1)).toBe(31);
        });

        test('still grows with the tool below the cap', () => {
            expect(iconScreenDiameter(0.65)).toBeCloseTo(31 * 0.65, 5);
            expect(iconScreenDiameter(1.2)).toBeCloseTo(31 * 1.2, 5);
        });

        test('holds at the labeling cursor size once the cap engages', () => {
            expect(iconScreenDiameter(1.4)).toBeCloseTo(38, 5);
            expect(iconScreenDiameter(1.8)).toBeCloseTo(38, 5);   // 1.8 is util.applyToolScale's MAX_SCALE.
        });

        test('never exceeds the cursor the user aims with, at any scale in range', () => {
            for (let scale = 0.65; scale <= 1.8001; scale += 0.05) {
                expect(iconScreenDiameter(scale)).toBeLessThanOrEqual(util.LABEL_ICON_MAX_SCREEN_DIAMETER + 1e-9);
            }
        });

        test('the cap engages where the base size reaches the cursor size, and not before', () => {
            const baseDiameter = 2 * util.LABEL_ICON_BASE_RADIUS - 3;
            const crossover = util.LABEL_ICON_MAX_SCREEN_DIAMETER / baseDiameter; // ~1.2258
            expect(iconScreenDiameter(crossover - 0.01)).toBeLessThan(38);
            expect(iconScreenDiameter(crossover + 0.01)).toBeCloseTo(38, 5);
        });

        test('reads the live scale off the page when called with no argument', () => {
            document.documentElement.style.setProperty('--ui-scale', '1.8');
            expect(util.labelIconRadius()).toBeCloseTo(util.labelIconRadius(1.8), 10);
        });
    });

    describe('util.labelHitMargin', () => {
        test('covers the whole visible icon, which the old radius/2 + 2 rule did not', () => {
            // The old rule gave a 21px target under a 31px icon at scale 1.
            expect(targetScreenSize(1)).toBeCloseTo(iconScreenDiameter(1), 5);
            expect(targetScreenSize(1)).toBeGreaterThan(2 * (17 / 2 + 2));
        });

        test('does not shrink when the icon cap engages', () => {
            // The whole point of decoupling: capping the icon must not cost the user click area at large scales.
            expect(targetScreenSize(1.8)).toBeCloseTo(38, 5);
            expect(targetScreenSize(1.8)).toBeGreaterThan(2 * (17 / 2 + 2) * 1.8 * 0.9);
        });

        test('floors at the WCAG minimum target size when the tool scales down', () => {
            // At 0.65x the icon is only ~20 screen px, so the floor is what keeps the label clickable.
            expect(iconScreenDiameter(0.65)).toBeLessThan(util.LABEL_MIN_SCREEN_TARGET);
            expect(targetScreenSize(0.65)).toBeCloseTo(util.LABEL_MIN_SCREEN_TARGET, 5);
        });

        test('is never below the WCAG minimum at any scale in range', () => {
            for (let scale = 0.65; scale <= 1.8001; scale += 0.05) {
                expect(targetScreenSize(scale)).toBeGreaterThanOrEqual(util.LABEL_MIN_SCREEN_TARGET - 1e-9);
            }
        });

        test('is never smaller than the icon it belongs to, at any scale in range', () => {
            for (let scale = 0.65; scale <= 1.8001; scale += 0.05) {
                expect(targetScreenSize(scale)).toBeGreaterThanOrEqual(iconScreenDiameter(scale) - 1e-9);
            }
        });
    });

    /**
     * The icon's decorations — its two outline rings and its unrated-severity badge — were authored as literals
     * against a radius of 17. A capped radius left them at their old sizes, so the rings floated well outside the
     * shrunken icon and the badge came unpinned from its corner. These pin them to the icon instead.
     */
    describe('icon decorations follow the radius', () => {
        const LABEL_SRC = fs.readFileSync(
            path.resolve(__dirname, '..', '..', 'public/js/explore/src/label/Label.js'), 'utf8'
        );

        /** Records the geometry of every drawing call so a test can compare it against the icon's own bounds. */
        function makeRecordingCtx() {
            return {
                arcs: [], ellipses: [], images: [], texts: [],
                globalAlpha: 1, lineWidth: 1, strokeStyle: '', fillStyle: '', font: '',
                save() {}, restore() {}, beginPath() {}, closePath() {}, fill() {}, stroke() {},
                drawImage(img, dx, dy, w, h) { this.images.push({ dx: dx, dy: dy, w: w, h: h }); },
                arc(cx, cy, r) { this.arcs.push({ cx: cx, cy: cy, r: r }); },
                ellipse(cx, cy, rx, ry) { this.ellipses.push({ cx: cx, cy: cy, rx: rx, ry: ry }); },
                fillText(t, tx, ty) { this.texts.push({ t: t, x: tx, y: ty }); },
                measureText: () => ({ width: 0 }),
            };
        }

        let Label;

        beforeEach(() => {
            window.util = util;
            util.misc = { getIconImagePaths: () => ({ iconImagePath: 'CurbRamp.svg' }), labelTypeHasSeverity: () => true };
            util.pano = { centeredPovToCanvasCoord: () => ({ x: 100, y: 100 }) };
            window.labelIconCache = { 'CurbRamp.svg': {} };
            window.svl = { LABEL_ICON_RADIUS: 17, minimap: { getMap: () => null } };
            window.eval(`${LABEL_SRC}\nwindow.Label = Label;`);
            Label = window.Label;
        });

        /** Renders the icon at `radius` and returns the ring radii relative to the drawn icon's own half-extent. */
        function ringOffsets(radius) {
            window.svl.LABEL_ICON_RADIUS = radius;
            const ctx = makeRecordingCtx();
            Label.renderLabelIcon(ctx, 'CurbRamp', 100, 100);
            const img = ctx.images[0];
            const halfExtent = img.w / 2;                       // Drawn icon spans 2 * radius - 3.
            return ctx.arcs.map((a) => a.r - halfExtent);
        }

        test('the rings hug the icon edge identically at the base radius and a capped one', () => {
            const atBase = ringOffsets(util.LABEL_ICON_BASE_RADIUS);
            const atCapped = ringOffsets(util.labelIconRadius(1.8));

            expect(atBase).toHaveLength(2);
            expect(atCapped[0]).toBeCloseTo(atBase[0], 10);
            expect(atCapped[1]).toBeCloseTo(atBase[1], 10);
            expect(atBase[0]).toBeLessThan(0);   // Inner ring inside the icon edge…
            expect(atBase[1]).toBeGreaterThan(0); // …outer ring outside it.
        });

        test('the rings still land where they always did at the base radius', () => {
            window.svl.LABEL_ICON_RADIUS = 17;
            const ctx = makeRecordingCtx();
            Label.renderLabelIcon(ctx, 'CurbRamp', 100, 100);
            expect(ctx.arcs.map((a) => a.r)).toEqual([15.3, 16.2]); // The pre-#4838 literals.
        });

        test('the unrated-severity badge scales and stays pinned to the icon corner', () => {
            const render = (radius) => {
                window.svl.LABEL_ICON_RADIUS = radius;
                const label = new Label({
                    labelType: 'CurbRamp',
                    severity: null,
                    panoXY: { x: 1, y: 1 },
                    povOfLabelIfCentered: { heading: 90, pitch: -20, zoom: 1 },
                    labelLat: 47.6, labelLng: -122.3,
                });
                label.setHoverInfoVisibility('hidden');
                const ctx = makeRecordingCtx();
                label.render(ctx, { heading: 90, pitch: -20, zoom: 1 });
                return ctx;
            };
            Label.createMinimapMarker = () => ({ addListener: () => {} });

            const base = render(util.LABEL_ICON_BASE_RADIUS).ellipses[0];
            const capped = render(util.labelIconRadius(1.8)).ellipses[0];
            const k = util.labelIconRadius(1.8) / util.LABEL_ICON_BASE_RADIUS;

            expect(base).toEqual({ cx: 100 - 15, cy: 100 - 10.5, rx: 8, ry: 8 }); // The pre-#4838 literals.
            // Offset from the icon centre and the badge's own size both shrink by the same factor as the icon.
            expect(100 - capped.cx).toBeCloseTo(15 * k, 10);
            expect(100 - capped.cy).toBeCloseTo(10.5 * k, 10);
            expect(capped.rx).toBeCloseTo(8 * k, 10);
        });
    });
});
