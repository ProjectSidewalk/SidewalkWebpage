/**
 * Tests for util.labelIconRadius / util.labelHitMargin (public/js/common/utilities.js, issue #4838), and for the two
 * things in Explore that consume them: Label.isOn's click target and Label.renderLabelIcon's decorations.
 *
 * Explore draws into a fixed 720x480 logical frame that is displayed at var(--ui-scale) (0.65x-1.8x). A constant
 * icon radius therefore grew with the tool, reaching 56 on-screen px at the scale cap — well past the 38px labeling
 * cursor the user aims with. These helpers cap the drawn icon in *screen* px and size the click target to the icon
 * rather than deriving it from the radius.
 *
 * Everything below is asserted in on-screen CSS px (logical value x scale), because that is the thing being capped;
 * the logical values are an implementation detail that moves with the scale by design.
 */

const fs = require('fs');
const path = require('path');
const { makeRecordingCtx } = require('./canvasCtxStub');

const UTILITIES_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/common/utilities.js'), 'utf8'
);
const LABEL_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/explore/src/label/Label.js'), 'utf8'
);
const CANVAS_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/explore/src/canvas/Canvas.js'), 'utf8'
);

/** Loads utilities.js into jsdom, the same way sizeCanvasToDisplay.test.js and anchorPanelToLabel.test.js do. */
function loadUtil() {
    // utilities.js builds a Bowser parser at load time; none of the geometry under test consults it.
    window.bowser = { getParser: () => ({ getBrowserName: () => 'Chrome', getBrowserVersion: () => '1',
        getOSName: () => 'Linux', getPlatformType: () => 'desktop' }) };
    window.eval(UTILITIES_SRC);
    return window.util;
}

describe('label icon sizing across the UI scale', () => {
    let util;

    /** On-screen diameter in CSS px of the icon Label.renderLabelIcon draws at this scale. */
    const iconScreenDiameter = (scale) => 2 * util.labelIconHalfExtent(util.labelIconRadius(scale)) * scale;

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
            const baseDiameter = 2 * util.labelIconHalfExtent(util.LABEL_ICON_BASE_RADIUS);
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
        let Label;

        beforeEach(() => {
            window.util = util;
            util.misc = { getIconImagePaths: () => ({ iconImagePath: 'CurbRamp.svg' }),
                labelTypeHasSeverity: () => true };
            util.pano = { centeredPovToCanvasCoord: () => ({ x: 100, y: 100 }) };
            window.labelIconCache = { 'CurbRamp.svg': {} };
            window.svl = { LABEL_ICON_RADIUS: 17, minimap: { getMap: () => null } };
            window.eval(`${LABEL_SRC}\nwindow.Label = Label;`);
            Label = window.Label;
        });

        /** Renders the icon at `radius` and returns its recording context. */
        function renderIcon(radius) {
            window.svl.LABEL_ICON_RADIUS = radius;
            const ctx = makeRecordingCtx();
            Label.renderLabelIcon(ctx, 'CurbRamp', 100, 100);
            return ctx;
        }

        test('the rings still land exactly where they always did at the base radius', () => {
            const ctx = renderIcon(util.LABEL_ICON_BASE_RADIUS);

            expect(ctx.arcs.map((a) => a.r)).toEqual([15.3, 16.2]);   // The pre-#4838 literals.
            expect(ctx.arcs.map((a) => a.lineWidth)).toEqual([0.7, 0.7]);
        });

        test('the rings keep the same proportions against a capped icon as against a full-size one', () => {
            // Not the same *absolute* offsets: the ring geometry scales with the icon, so the outline reads at the
            // same weight relative to the mark at every size. Left absolute it was ~47% heavier once capped.
            const relative = (radius) => {
                const ctx = renderIcon(radius);
                const halfExtent = ctx.images[0].w / 2;
                return {
                    offsets: ctx.arcs.map((a) => (a.r - halfExtent) / halfExtent),
                    weights: ctx.arcs.map((a) => a.lineWidth / halfExtent),
                };
            };
            const atBase = relative(util.LABEL_ICON_BASE_RADIUS);
            const atCapped = relative(util.labelIconRadius(1.8));

            expect(atBase.offsets).toHaveLength(2);
            expect(atCapped.offsets[0]).toBeCloseTo(atBase.offsets[0], 10);
            expect(atCapped.offsets[1]).toBeCloseTo(atBase.offsets[1], 10);
            expect(atCapped.weights[0]).toBeCloseTo(atBase.weights[0], 10);
            expect(atBase.offsets[0]).toBeLessThan(0);    // Inner ring inside the icon edge…
            expect(atBase.offsets[1]).toBeGreaterThan(0); // …outer ring outside it.
        });

        test('the ring stays a hairline on screen once the icon is capped', () => {
            // Scaling the stroke down must not make it vanish: the logical width is multiplied by the UI scale, and
            // again by the device pixel ratio when the canvas is rasterized (util.sizeCanvasToDisplay).
            const capped = renderIcon(util.labelIconRadius(1.8));

            expect(capped.arcs[0].lineWidth * 1.8).toBeGreaterThan(0.5);
            expect(capped.arcs[0].lineWidth).toBeLessThan(0.7); // …but genuinely thinner than the uncapped rule.
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
            const k = util.labelIconScale(util.labelIconRadius(1.8));

            expect(base).toEqual({ cx: 100 - 15, cy: 100 - 10.5, rx: 8, ry: 8 }); // The pre-#4838 literals.
            // Offset from the icon centre and the badge's own size both shrink by the same factor as the icon.
            expect(100 - capped.cx).toBeCloseTo(15 * k, 10);
            expect(100 - capped.cy).toBeCloseTo(10.5 * k, 10);
            expect(capped.rx).toBeCloseTo(8 * k, 10);
        });
    });

    /**
     * The click target itself, as Explore actually consumes it: Label.isOn reads svl.LABEL_HIT_MARGIN (which Main.js
     * refreshes from util.labelHitMargin whenever the UI scale changes), and Canvas.onLabel decides which label a
     * click belongs to when more than one target covers the point.
     */
    describe('hit testing', () => {
        let Label;
        let Canvas;

        /** A label pinned to (100, 100) on the canvas. */
        function newLabel() {
            const label = new Label({
                labelType: 'CurbRamp',
                severity: 1,
                panoXY: { x: 1, y: 1 },
                povOfLabelIfCentered: { heading: 90, pitch: -20, zoom: 1 },
                labelLat: 47.6, labelLng: -122.3,
            });
            label.setHoverInfoVisibility('hidden');
            label.render(makeRecordingCtx(), { heading: 90, pitch: -20, zoom: 1 }); // Sets currCanvasXY.
            return label;
        }

        beforeEach(() => {
            window.util = util;
            util.misc = { getIconImagePaths: () => ({ iconImagePath: 'CurbRamp.svg' }),
                labelTypeHasSeverity: () => true };
            util.pano = { centeredPovToCanvasCoord: () => ({ x: 100, y: 100 }) };
            window.labelIconCache = { 'CurbRamp.svg': {} };
            window.svl = {
                LABEL_ICON_RADIUS: util.labelIconRadius(1),
                LABEL_HIT_MARGIN: util.labelHitMargin(1),
                minimap: { getMap: () => null },
            };
            window.eval(`${LABEL_SRC}\nwindow.Label = Label;`);
            window.eval(`${CANVAS_SRC}\nwindow.Canvas = Canvas;`);
            Label = window.Label;
            Canvas = window.Canvas;
            Label.createMinimapMarker = () => ({ addListener: () => {} });
        });

        test('Label.isOn covers the whole drawn icon', () => {
            const label = newLabel();
            const halfIcon = util.labelIconHalfExtent(util.labelIconRadius(1)); // 15.5 at scale 1.

            expect(label.isOn(100, 100)).toBe(true);
            expect(label.isOn(100 + halfIcon - 0.1, 100)).toBe(true);
            expect(label.isOn(100, 100 - halfIcon + 0.1)).toBe(true);
            // The old radius / 2 + 2 rule stopped at 10.5, well inside the icon; this is the point it used to miss.
            expect(label.isOn(100 + 12, 100 + 12)).toBe(true);
        });

        test('Label.isOn stops at the target edge', () => {
            const label = newLabel();
            const halfIcon = util.labelIconHalfExtent(util.labelIconRadius(1));

            expect(label.isOn(100 + halfIcon + 0.1, 100)).toBe(false);
            expect(label.isOn(100, 100 + halfIcon + 0.1)).toBe(false);
        });

        test('Label.isOn tracks svl.LABEL_HIT_MARGIN, so it follows the UI scale', () => {
            const label = newLabel();

            // Capped: the target shrinks in logical px so it holds still on screen.
            window.svl.LABEL_HIT_MARGIN = util.labelHitMargin(1.8);         // ~10.6 logical px.
            expect(label.isOn(100 + util.labelHitMargin(1.8) - 0.1, 100)).toBe(true);
            expect(label.isOn(100 + util.labelHitMargin(1.8) + 0.1, 100)).toBe(false);

            // Floored: at the small end the target grows in logical px to hold the WCAG minimum on screen, which is
            // well past where the icon ends — and past anything the old radius / 2 + 2 rule ever reached.
            window.svl.LABEL_HIT_MARGIN = util.labelHitMargin(0.65);        // ~18.5 logical px.
            expect(label.isOn(100 + util.labelHitMargin(0.65) - 0.1, 100)).toBe(true);
            expect(label.isOn(100 + util.labelHitMargin(0.65) + 0.1, 100)).toBe(false);
        });

        test('a deleted label is never under the cursor', () => {
            const label = newLabel();
            label.remove();

            expect(label.isOn(100, 100)).toBe(false);
        });

        test('Canvas.onLabel picks the label drawn on top when two targets overlap', () => {
            // Canvas.render() draws getCanvasLabels() in order, so the last one is the one the user can see. Before
            // #4838's larger target this rarely mattered; now two icons that visually touch overlap.
            const under = newLabel();
            const over = newLabel();
            window.svl.labelContainer = { getCanvasLabels: () => [under, over] };
            // No #label-canvas in the DOM, so Canvas#init returns before it binds any listeners.
            const canvas = new Canvas({});

            expect(canvas.onLabel(100, 100)).toBe(over);
            expect(canvas.getCurrentLabel()).toBe(over);
        });

        test('Canvas.onLabel still finds a lone label, and reports a miss', () => {
            const label = newLabel();
            window.svl.labelContainer = { getCanvasLabels: () => [label] };
            const canvas = new Canvas({});

            expect(canvas.onLabel(100, 100)).toBe(label);
            expect(canvas.onLabel(400, 400)).toBe(false);
        });
    });
});
