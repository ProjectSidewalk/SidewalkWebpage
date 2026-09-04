/**
 * Tests for the validate marker's one-shot halo pulse (issue #4790), wired up in
 * public/js/validate/src/panorama/PanoManager.js `renderPanoMarker` / `#restartMarkerPulse`.
 *
 * Validate reuses one marker element across labels, so the pulse lifecycle has real edge cases: the
 * .label-marker-pulse class must be (re)applied on every label render, taken back off by an `animationend`
 * listener that ignores other animations ending on the marker, and re-applied even when the previous pulse is
 * still mid-flight (a label answered within 1.4s), which fires animationcancel rather than animationend. These
 * tests drive the REAL `PanoManager.create` factory and the REAL `PanoMarker` class (with a fake pano viewer),
 * dispatching synthetic animation events — jsdom runs no CSS animations, so `animationend` never fires on its own.
 *
 * Also pins PanoMarker publishing its rendered size as --marker-diameter, which main.css's .label-marker-pulse
 * uses to size the halo to the marker it decorates (22px on desktop Validate vs 52px on mobile).
 */

const fs = require('fs');
const path = require('path');

const PANO_MANAGER_PATH = path.resolve(__dirname, '..', '..', 'public/js/validate/src/panorama/PanoManager.js');
const PANO_MARKER_PATH = path.resolve(__dirname, '..', '..', 'public/js/common/PanoMarker.js');
const THROTTLE_PATH = path.resolve(__dirname, '..', '..', 'public/js/validate/src/util/throttle.js');
const UTILITIES_PATH = path.resolve(__dirname, '..', '..', 'public/js/common/utilities.js');

/**
 * Load a bare `class` declaration out of a production file. The Grunt bundle concatenates these into page scope,
 * so wrap the source in an IIFE that returns the named class (same trick as validatePanoPovThrottle.test.js).
 * @param {string} filePath - Absolute path to the production file.
 * @param {string} className - Name of the class the file declares.
 * @returns {Function} The class.
 */
function loadClassFromFile(filePath, className) {
    const src = fs.readFileSync(filePath, 'utf8');
    return (0, eval)('(() => {\n' + src + '\nreturn ' + className + ';\n})()');
}

/**
 * Dispatch a synthetic animationend on an element. A plain Event with an expando `animationName` — the only
 * field the handler reads — avoids depending on jsdom's AnimationEvent support.
 * @param {HTMLElement} el - The element the animation ended on.
 * @param {string} animationName - The keyframes name to report.
 */
function fireAnimationEnd(el, animationName) {
    const event = new Event('animationend', { bubbles: true });
    event.animationName = animationName;
    el.dispatchEvent(event);
}

/**
 * Build a minimal fake validate Label with just the surface renderPanoMarker reads.
 * @param {object} [auditPropOverrides] - Audit properties to override per label.
 * @returns {object} The fake label.
 */
function makeLabel(auditPropOverrides = {}) {
    const auditProps = {
        heading: 10, pitch: 5, zoom: 1, panoId: 'pano1', labelType: 'CurbRamp', aiGenerated: false,
        ...auditPropOverrides,
    };
    return {
        getOriginalPov: () => ({ heading: 10, pitch: 5, zoom: 1 }),
        getAuditProperty: (key) => auditProps[key],
        getIconUrl: () => '/assets/fake-icon.svg',
        getIconColor: () => '#abcdef', // arbitrary test value, not a real label-type color
    };
}

describe('Validate marker halo pulse (issue #4790)', () => {
    let panoManager;

    beforeEach(async () => {
        // The pano canvas #init looks up (with a parent for the fallback canvas + viewer logo to attach to),
        // plus the marker layer renderPanoMarker creates the PanoMarker in.
        document.body.innerHTML
            = '<div id="pano-holder"><div id="svv-panorama"></div></div><div id="view-control-layer"></div>';

        global.util = {};
        // utilities.js builds a Bowser parser at load time; the overrides below replace everything read from it.
        global.bowser = { getParser: () => ({ getBrowserName: () => 'Chrome', getBrowserVersion: () => '1',
            getOSName: () => 'Linux', getPlatformType: () => 'desktop' }) };
        // Real utilities, for util.cappedMarkerDiameter: these tests read the marker's rendered diameter back, so
        // the sizing rule needs to be production's rather than a formula copied into a stub (#4838).
        (0, eval)(fs.readFileSync(UTILITIES_PATH, 'utf8'));
        (0, eval)(fs.readFileSync(THROTTLE_PATH, 'utf8')); // real throttle; #init wires it to pov_changed
        util.isMobile = () => false;
        util.uiScale = () => 1;
        util.camelToKebab = (str) => str.toLowerCase();
        // jsdom has no WebGL, so PanoMarker falls back to the 2d projection; where the marker lands is irrelevant
        // here, only what classes/properties it carries. Returning null directly (jsdom's effective behavior)
        // keeps the fallback deterministic without jsdom's "not implemented" console noise.
        jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
        util.pano = {
            centeredPovToCanvasCoord2d: () => ({ x: 0, y: 0 }),
            centeredPovToCanvasCoord: () => ({ x: 0, y: 0 }),
        };

        global.PanoMarker = loadClassFromFile(PANO_MARKER_PATH, 'PanoMarker');
        global.i18next = { t: () => 'Curb ramp' };
        global.createPanoViewerLogo = jest.fn(() => ({ showPrimaryLogo: jest.fn(), showSourceLogo: jest.fn() }));
        global.createPanoAttribution = jest.fn(() => ({ show: jest.fn(), hide: jest.fn() }));
        global.GsvViewer = class GsvViewer {};             // distinct from FakeViewerType, so the GSV-only
        global.MapillaryViewer = class MapillaryViewer {}; // and Mapillary-only attribution paths are skipped
        global.svv = {
            tracker: { push: jest.fn() },
            panoStore: { addPanoMetadata: jest.fn() },
            ui: { viewer: { date: { text: jest.fn() } } },
            labelRadius: 10, // marker diameter = (10 * 2 + 2) * uiScale = 22px, desktop Validate's real size
        };

        const panoData = {
            getPanoId: () => 'pano1',
            getProperty: () => ({ format: () => 'Jun 2026' })
        };
        const fakeViewer = {
            setPano: jest.fn(() => Promise.resolve(panoData)),
            addListener: jest.fn(),
            resize: jest.fn(),
            setPov: jest.fn(),
            getPov: () => ({ heading: 0, pitch: 0, zoom: 1 })
        };
        const FakeViewerType = class FakeViewerType {
            static create() { return Promise.resolve(fakeViewer); }
        };

        const PanoManager = loadClassFromFile(PANO_MANAGER_PATH, 'PanoManager');
        panoManager = await PanoManager.create(FakeViewerType, 'token', 'pano1');
    });

    afterEach(() => {
        jest.restoreAllMocks();
        document.body.innerHTML = '';
        delete global.util;
        delete global.PanoMarker;
        delete global.i18next;
        delete global.createPanoViewerLogo;
        delete global.createPanoAttribution;
        delete global.GsvViewer;
        delete global.MapillaryViewer;
        delete global.svv;
    });

    /** @returns {HTMLElement} The marker element PanoMarker created. */
    function markerEl() {
        return document.getElementById('validate-pano-marker');
    }

    test('rendering a label applies the pulse class and publishes the marker diameter for the halo', () => {
        panoManager.renderPanoMarker(makeLabel());

        expect(markerEl().classList.contains('label-marker-pulse')).toBe(true);
        expect(markerEl().style.getPropertyValue('--marker-diameter')).toBe('22px');
    });

    test('animationend for the pulse takes the class off; other animations ending on the marker leave it alone', () => {
        panoManager.renderPanoMarker(makeLabel());

        fireAnimationEnd(markerEl(), 'some-other-animation');
        expect(markerEl().classList.contains('label-marker-pulse')).toBe(true);

        fireAnimationEnd(markerEl(), 'label-marker-pulse');
        expect(markerEl().classList.contains('label-marker-pulse')).toBe(false);
    });

    test('the pulse replays on the next label after the previous one finished', () => {
        panoManager.renderPanoMarker(makeLabel());
        fireAnimationEnd(markerEl(), 'label-marker-pulse');

        panoManager.renderPanoMarker(makeLabel({ labelType: 'Obstacle' }));
        expect(markerEl().classList.contains('label-marker-pulse')).toBe(true);
    });

    test('advancing mid-pulse still pulses the new label, and the cleanup listener stays wired', () => {
        panoManager.renderPanoMarker(makeLabel());

        // No animationend in between: the first pulse is interrupted (animationcancel in a real browser).
        panoManager.renderPanoMarker(makeLabel({ labelType: 'Obstacle' }));
        expect(markerEl().classList.contains('label-marker-pulse')).toBe(true);

        // The once-per-element listener still cleans up after re-renders reused the marker.
        fireAnimationEnd(markerEl(), 'label-marker-pulse');
        expect(markerEl().classList.contains('label-marker-pulse')).toBe(false);
    });

    test('setSize republishes --marker-diameter so the halo tracks setMarkerScale', () => {
        panoManager.renderPanoMarker(makeLabel());

        panoManager.labelMarker.setSize({ width: 52, height: 52 });
        expect(markerEl().style.getPropertyValue('--marker-diameter')).toBe('52px');
    });

    // A mission's first label renders behind page chrome (the loading overlay at boot, the mission-complete modal
    // on later missions), where its pulse plays unseen — visibility: hidden doesn't pause animations. The reveal
    // choreography calls replayMarkerPulse once the marker can be seen.

    test('replayMarkerPulse pulses immediately when no mission-start tutorial overlay is up', () => {
        panoManager.renderPanoMarker(makeLabel());
        fireAnimationEnd(markerEl(), 'label-marker-pulse'); // the unseen pulse, already spent

        panoManager.replayMarkerPulse();
        expect(markerEl().classList.contains('label-marker-pulse')).toBe(true);
    });

    test('replayMarkerPulse holds the pulse until a showing mission-start tutorial is dismissed', () => {
        const overlay = document.createElement('div');
        overlay.className = 'mission-start-tutorial-overlay';
        overlay.style.display = 'flex';
        document.body.appendChild(overlay);

        panoManager.renderPanoMarker(makeLabel());
        fireAnimationEnd(markerEl(), 'label-marker-pulse');

        panoManager.replayMarkerPulse();
        expect(markerEl().classList.contains('label-marker-pulse')).toBe(false); // held back, not spent under it

        document.dispatchEvent(new CustomEvent('ps:mission-start-tutorial:done'));
        expect(markerEl().classList.contains('label-marker-pulse')).toBe(true);
    });
});
