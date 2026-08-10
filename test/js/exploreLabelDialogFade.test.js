/**
 * Tests for the dialog-open fade in Label#render (public/js/explore/src/label/Label.js, issue #4824).
 *
 * While a label's context menu is open, that label's icon draws at reduced opacity: the marker sits exactly on the
 * feature the user is rating, so fading it lets them see the feature while they rate it. The dialog's tail still
 * points at the spot.
 *
 * The behavior started life gated on `svl.isOnboarding()` (the tutorial, #4814/#4815). #4824 promoted it to regular
 * Explore labeling, so the gate is gone — the `isOnboarding` cases below are the pin that keeps it gone. What makes
 * the fade *visible* the instant the panel opens or closes is ContextMenu.show()/hide() re-rendering the canvas;
 * that wiring is jQuery-bound UI and is verified in the browser, not here.
 */

const fs = require('fs');
const path = require('path');

const LABEL_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/explore/src/label/Label.js'), 'utf8'
);

/** Loads a fresh Label class into the jsdom global scope (a class declaration is not a globalThis property). */
function loadLabel() {
    window.eval(`${LABEL_SRC}\nwindow.Label = Label;`);
    return window.Label;
}

/**
 * A canvas context stand-in that records the globalAlpha in effect for every drawing call, so a test can assert what
 * the icon was actually painted at rather than trusting that save/restore were called in the right order.
 */
function makeRecordingCtx() {
    const alphas = [];
    const savedAlphas = [];
    return {
        globalAlpha: 1,
        lineWidth: 1,
        strokeStyle: '',
        fillStyle: '',
        font: '',
        textAlign: '',
        alphas,
        saveCount: 0,
        save() { this.saveCount += 1; savedAlphas.push(this.globalAlpha); },
        restore() { this.globalAlpha = savedAlphas.pop(); },
        drawImage() { alphas.push(this.globalAlpha); },
        beginPath() {},
        closePath() {},
        moveTo() {},
        lineTo() {},
        arc() {},
        ellipse() {},
        stroke() { alphas.push(this.globalAlpha); },
        fill() { alphas.push(this.globalAlpha); },
        fillText() { alphas.push(this.globalAlpha); },
        measureText: () => ({ width: 0 }),
    };
}

describe('Label render fade while the context menu is open', () => {
    let Label;

    /** A placed label with a cached lat/lng, so the constructor's toLatLng() short-circuits past the estimator. */
    function newLabel({ labelType = 'CurbRamp', severity = 1 } = {}) {
        const label = new Label({
            labelType,
            severity,
            temporaryLabelId: 1,
            panoXY: { x: 10, y: 20 },   // Present, so the constructor skips the pano-store lookup.
            povOfLabelIfCentered: { heading: 90, pitch: -20, zoom: 1 },
            panoLat: 47.6553,
            panoLng: -122.3035,
            labelLat: 47.6554,
            labelLng: -122.3034,
        });
        // The hover card is a DOM concern and is suppressed anyway whenever the context menu is open; keep it out.
        label.setHoverInfoVisibility('hidden');
        return label;
    }

    /** Renders `label` with the context menu reporting `{ open, target }`, returning the alphas it painted at. */
    function renderWith(label, { open, target }) {
        window.svl.contextMenu = {
            isOpen: () => open,
            getTargetLabel: () => target,
        };
        const ctx = makeRecordingCtx();
        label.render(ctx, { heading: 90, pitch: -20, zoom: 1 });
        return ctx;
    }

    beforeEach(() => {
        Label = loadLabel();
        window.svl = {
            LABEL_ICON_RADIUS: 17,
            isOnboarding: () => false,
            minimap: { getMap: () => null },
        };
        window.util = {
            EXPLORE_CANVAS_WIDTH: 720,
            EXPLORE_CANVAS_HEIGHT: 480,
            pano: { centeredPovToCanvasCoord: () => ({ x: 360, y: 240 }) },
            misc: {
                labelTypeHasSeverity: (labelType) => labelType !== 'Occlusion',
                getIconImagePaths: () => ({ iconImagePath: 'CurbRamp.svg' }),
            },
        };
        window.labelIconCache = { 'CurbRamp.svg': {} }; // Truthy, so renderLabelIcon reaches its drawImage.
        Label.createMinimapMarker = () => ({ addListener: () => {} });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('draws at full opacity when no context menu is open', () => {
        const ctx = renderWith(newLabel(), { open: false, target: null });

        expect(ctx.alphas.length).toBeGreaterThan(0);
        expect(ctx.alphas.every((a) => a === 1)).toBe(true);
        expect(ctx.saveCount).toBe(0); // No save/restore pair at all when there's nothing to fade.
    });

    test('fades the label the open context menu points at', () => {
        const label = newLabel();
        const ctx = renderWith(label, { open: true, target: label });

        expect(ctx.alphas.length).toBeGreaterThan(0);
        expect(ctx.alphas.every((a) => a === 0.3)).toBe(true);
    });

    test('leaves the alpha it was handed once the label is drawn', () => {
        const label = newLabel();
        const ctx = renderWith(label, { open: true, target: label });

        expect(ctx.globalAlpha).toBe(1); // restore() ran, so the next label in the loop draws unfaded.
    });

    test('does not fade other labels while one label\'s menu is open', () => {
        const other = newLabel();
        const ctx = renderWith(newLabel(), { open: true, target: other });

        expect(ctx.alphas.every((a) => a === 1)).toBe(true);
    });

    test('fades outside the tutorial too (#4824 removed the isOnboarding gate)', () => {
        window.svl.isOnboarding = () => false;
        const label = newLabel();
        const ctx = renderWith(label, { open: true, target: label });

        expect(ctx.alphas.every((a) => a === 0.3)).toBe(true);
    });

    test('still fades inside the tutorial', () => {
        window.svl.isOnboarding = () => true;
        const label = newLabel();
        const ctx = renderWith(label, { open: true, target: label });

        expect(ctx.alphas.every((a) => a === 0.3)).toBe(true);
    });

    test('fades the unrated-severity alert along with the icon', () => {
        const label = newLabel({ severity: null }); // No severity yet, so render() also paints the "!" alert.
        const ctx = renderWith(label, { open: true, target: label });

        // More draw calls than the icon alone makes, and every one of them faded.
        expect(ctx.alphas.length).toBeGreaterThan(renderWith(newLabel(), { open: true, target: null }).alphas.length);
        expect(ctx.alphas.every((a) => a === 0.3)).toBe(true);
    });

    test('does not fade a hidden or deleted label (it is not drawn at all)', () => {
        const label = newLabel();
        label.remove();
        const ctx = renderWith(label, { open: true, target: label });

        expect(ctx.alphas).toEqual([]);
    });
});
