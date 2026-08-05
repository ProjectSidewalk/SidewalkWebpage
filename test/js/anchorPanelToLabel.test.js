/**
 * Tests for util.anchorPanelToLabel (public/js/common/utilities.js).
 *
 * This routine places every panel that hangs off a label icon in a pano: Explore's hover card and context menu
 * (#4719/#4724) and Validate's label card (#4726). It is pure geometry over measured rects, which makes it exactly
 * the kind of thing that is painful to verify by eye in a browser and cheap to pin here — the flip, the clamps, and
 * the tail offset only misbehave at the edges, which is where a manual pass is least likely to look.
 *
 * The panel is a jQuery object in production. jsdom has no layout engine, so a real jQuery panel would measure
 * 0x0 and every assertion below would be about the wrong numbers; the tests pass a stub whose dimensions are stated
 * outright, which is what a geometry test wants anyway. The bounding elements are stubbed the same way.
 */

const fs = require('fs');
const path = require('path');

const UTILITIES_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/common/utilities.js'), 'utf8'
);

// Explore's frame, as the defaults expect to find it. The pano is 720x480 at scale 1 and sits 100px from the
// viewport's left edge; the whole tool (pano + gap + sidebar) runs to x=1136.
const PANO_LEFT = 100;
const APP_RIGHT = 1136;

/** A stand-in for the jQuery panel, recording what the routine sets on it. */
function makePanel(width, height) {
    const el = document.createElement('div');
    const panel = {
        0: el,
        classes: {},
        placed: null,
        outerWidth: () => width,
        outerHeight: () => height,
        toggleClass: (name, on) => { panel.classes[name] = on; },
        css: (props) => { panel.placed = props; },
    };
    return panel;
}

/** An element whose getBoundingClientRect is fixed, since jsdom's real one is all zeroes. */
function makeRectEl(rect, id) {
    const el = document.createElement('div');
    if (id) el.id = id;
    el.getBoundingClientRect = () => ({ left: 0, right: 0, width: 0, height: 0, top: 0, bottom: 0, ...rect });
    document.body.appendChild(el);
    return el;
}

/** The tail offset the routine wrote, in px. */
const tailTop = (panel) => parseFloat(panel[0].style.getPropertyValue('--panel-tail-top'));
const flipped = (panel) => panel.classes['label-anchored-panel--flipped'];

describe('util.anchorPanelToLabel', () => {
    let util;

    beforeEach(() => {
        document.body.innerHTML = '';
        // utilities.js builds a Bowser parser at load time; the geometry under test never consults it.
        window.bowser = { getParser: () => ({ getBrowserName: () => 'Chrome', getBrowserVersion: () => '1',
            getOSName: () => 'Linux', getPlatformType: () => 'desktop' }) };
        window.eval(UTILITIES_SRC);
        util = window.util;

        // Explore's frame: the display-scale probe, the coordinate origin, and the horizontal bound.
        makeRectEl({ width: 720 }, 'label-drawing-layer');
        makeRectEl({ left: PANO_LEFT, right: PANO_LEFT + 720 }, 'street-view-holder');
        makeRectEl({ left: PANO_LEFT, right: APP_RIGHT }, 'svl-application-holder');
    });

    describe('Explore defaults (no options)', () => {
        it('places the panel to the right of the icon, vertically centered on it', () => {
            const panel = makePanel(240, 150);
            util.anchorPanelToLabel(panel, { x: 200, y: 240 }, 17);

            // left = centerX + radius + GAP; top centers the 150px panel on the icon.
            expect(panel.placed).toEqual({ left: 229, top: 165 });
            expect(flipped(panel)).toBe(false);
            // The tail points back at the icon: 240 - 165.
            expect(tailTop(panel)).toBe(75);
        });

        it('flips to the left of the icon when the panel would cross the tool\'s right edge', () => {
            const panel = makePanel(240, 150);
            util.anchorPanelToLabel(panel, { x: 800, y: 240 }, 17);

            // 800 + 17 + 12 + 240 = 1069, past the 1032 right bound, so it goes left instead.
            expect(panel.placed).toEqual({ left: 531, top: 165 });
            expect(flipped(panel)).toBe(true);
        });

        it('clamps to the top of the pano and pins the tail clear of the corner radius', () => {
            const panel = makePanel(240, 150);
            util.anchorPanelToLabel(panel, { x: 200, y: 20 }, 17);

            expect(panel.placed.top).toBe(4); // EDGE
            // Centering would put the tail at 16px, inside the 18px corner margin, so it pins at the margin.
            expect(tailTop(panel)).toBe(18);
        });

        it('clamps to the bottom of the pano and pins the tail at the far corner margin', () => {
            const panel = makePanel(240, 150);
            util.anchorPanelToLabel(panel, { x: 200, y: 460 }, 17);

            expect(panel.placed.top).toBe(326); // 480 - 150 - 4
            expect(tailTop(panel)).toBe(132);   // height - TAIL_MARGIN
        });

        it('lets a panel taller than the pano overhang the bottom rather than pushing it off the top', () => {
            const panel = makePanel(240, 600);
            util.anchorPanelToLabel(panel, { x: 200, y: 240 }, 17);

            expect(panel.placed.top).toBe(4);
        });

        it('lets a panel wider than the tool overhang the right rather than pushing it off the left', () => {
            const panel = makePanel(1200, 150);
            util.anchorPanelToLabel(panel, { x: 200, y: 240 }, 17);

            expect(panel.placed.left).toBe(4); // minLeft
        });

        it('scales the icon gap with the display, so the tail never overlaps the icon', () => {
            // Same 720-wide logical frame displayed at 1080px: everything, gap included, grows by 1.5.
            document.getElementById('label-drawing-layer').getBoundingClientRect = () => ({ width: 1080 });
            const panel = makePanel(240, 150);
            util.anchorPanelToLabel(panel, { x: 200, y: 240 }, 17);

            // (200 + 17 + 12) * 1.5
            expect(panel.placed.left).toBe(343.5);
        });
    });

    describe('caller-supplied frame (Validate)', () => {
        it('uses the given scale, origin, bounds, and frame height', () => {
            const layer = makeRectEl({ left: 50, right: 1130, height: 720 });
            const panel = makePanel(213, 140);

            // Validate's marker is already positioned in on-screen px, so it divides by the scale on the way in.
            util.anchorPanelToLabel(panel, { x: 100, y: 160 }, 11,
                { scale: 1.5, originEl: layer, boundsEl: layer, frameHeight: 720 });

            // centerX 150, radius 16.5, GAP 18 -> 184.5; centerY 240 centers the 140px panel at 170.
            expect(panel.placed).toEqual({ left: 184.5, top: 170 });
            expect(flipped(panel)).toBe(false);
            expect(tailTop(panel)).toBe(70);
        });

        it('bounds the panel by the given element, not by Explore\'s tool holder', () => {
            // A 400px-wide frame. At x=340 the panel still fits to the right inside Explore's 1036px-wide tool,
            // so if the defaults leaked through it would not flip; against this frame's 396px bound it must.
            const layer = makeRectEl({ left: 0, right: 400, height: 480 });
            const panel = makePanel(240, 150);

            util.anchorPanelToLabel(panel, { x: 340, y: 240 }, 11,
                { scale: 1, originEl: layer, boundsEl: layer, frameHeight: 480 });

            expect(flipped(panel)).toBe(true);
            expect(panel.placed.left).toBe(77); // 340 - 11 - 12 - 240
        });

        it('ignores Explore\'s ids entirely when a frame is supplied', () => {
            // Remove the Explore frame: a caller that supplies its own must not depend on it being present.
            document.getElementById('street-view-holder').remove();
            document.getElementById('svl-application-holder').remove();
            document.getElementById('label-drawing-layer').remove();

            const layer = makeRectEl({ left: 0, right: 720, height: 480 });
            const panel = makePanel(200, 100);
            util.anchorPanelToLabel(panel, { x: 100, y: 240 }, 11,
                { scale: 1, originEl: layer, boundsEl: layer, frameHeight: 480 });

            expect(panel.placed).toEqual({ left: 123, top: 190 });
        });
    });

    it('treats an omitted options object exactly like Explore\'s frame stated explicitly', () => {
        const implicit = makePanel(240, 150);
        util.anchorPanelToLabel(implicit, { x: 300, y: 200 }, 17);

        const explicit = makePanel(240, 150);
        util.anchorPanelToLabel(explicit, { x: 300, y: 200 }, 17, {
            scale: 1,
            originEl: document.getElementById('street-view-holder'),
            boundsEl: document.getElementById('svl-application-holder'),
            frameHeight: 480,
        });

        expect(explicit.placed).toEqual(implicit.placed);
        expect(flipped(explicit)).toBe(flipped(implicit));
        expect(tailTop(explicit)).toBe(tailTop(implicit));
    });
});
