/**
 * Tests for the validate marker's one-shot halo pulse (issue #4790), wired up in
 * frontend/js/validate/panorama/PanoManager.js `renderPanoMarker` / `#restartMarkerPulse`.
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

const path = require('path');
const { loadModules } = require('./loadGlobalScript');

const PANO_MANAGER_PATH = path.resolve(__dirname, '..', '..', 'frontend/js/validate/panorama/PanoManager.js');
const PANO_MARKER_PATH = path.resolve(__dirname, '..', '..', 'frontend/js/common/PanoMarker.js');
const THROTTLE_PATH = path.resolve(__dirname, '..', '..', 'frontend/js/validate/util/throttle.js');
const UTILITIES_PATH = path.resolve(__dirname, '..', '..', 'frontend/js/common/utilities.js');

/**
 * Load a bare `class` declaration out of a production file. The Grunt bundle concatenates these into page scope,
 * so wrap the source in an IIFE that returns the named class (same trick as validatePanoPovThrottle.test.js).
 * @param {string} filePath - Absolute path to the production file.
 * @param {string} className - Name of the class the file declares.
 * @returns {Function} The class.
 */
function loadClassFromFile(filePath, className) {
    return loadModules(filePath)[className];
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
        getProperty: (key) => (key === 'newLabelType' ? auditProps.labelType : undefined),
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

        global.ValidateLayout = {isNarrow: () => false}; // jsdom has no matchMedia; the wide layout.
        // utilities.js builds a Bowser parser at load time; the overrides below replace everything read from it.
        global.bowser = { getParser: () => ({ getBrowserName: () => 'Chrome', getBrowserVersion: () => '1',
            getOSName: () => 'Linux', getPlatformType: () => 'desktop' }) };
        // Real utilities, for util.cappedMarkerDiameter: these tests read the marker's rendered diameter back, so
        // the sizing rule needs to be production's rather than a formula copied into a stub (#4838).
        Object.assign(window, loadModules(UTILITIES_PATH));
        Object.assign(window, loadModules(THROTTLE_PATH));
        util.isMobile = () => false;
        util.uiScale = () => 1;
        util.camelToKebab = (str) => str.toLowerCase();
        util.misc = {
            ...util.misc,
            labelTypeName: (type) => window.i18next.t(`common:${window.util.camelToKebab(type)}`),
        };
        // jsdom has no WebGL, so PanoMarker falls back to the 2d projection; where the marker lands is irrelevant
        // here, only what classes/properties it carries. Returning null directly (jsdom's effective behavior)
        // keeps the fallback deterministic without jsdom's "not implemented" console noise.
        jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
        util.pano = {
            centeredPovToCanvasCoord2d: () => ({ x: 0, y: 0 }),
            centeredPovToCanvasCoord: () => ({ x: 0, y: 0 }),
            renderedHFov: () => 90,
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
            getProperty: () => new Date(2026, 5)
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
        panoManager = await PanoManager.create(FakeViewerType, 'token');
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

    // #5580: a new label shows as its dashed outline alone for a beat, then its icon fades in.
    test('a new label arrives as its outline, without the fade, and its icon comes back after the hold', () => {
        jest.useFakeTimers();
        panoManager.renderPanoMarker(makeLabel());

        expect(markerEl().classList.contains('label-marker--arriving')).toBe(true);
        // Entered at once: the class that turns the transition off is only on for the flush.
        expect(markerEl().classList.contains('label-marker--instant')).toBe(false);

        jest.advanceTimersByTime(599);
        expect(markerEl().classList.contains('label-marker--arriving')).toBe(true);
        jest.advanceTimersByTime(1);
        expect(markerEl().classList.contains('label-marker--arriving')).toBe(false);
        // The slower arrival fade runs, then hands the Hide toggle its own pace back.
        expect(markerEl().classList.contains('label-marker--arrival-fade')).toBe(true);
        jest.advanceTimersByTime(1200);
        expect(markerEl().classList.contains('label-marker--arrival-fade')).toBe(false);
        jest.useRealTimers();
    });

    test('a label answered mid-arrival restarts the hold for the next one rather than cutting it short', () => {
        jest.useFakeTimers();
        panoManager.renderPanoMarker(makeLabel());
        jest.advanceTimersByTime(400);
        panoManager.renderPanoMarker(makeLabel({ labelType: 'Obstacle' }));

        jest.advanceTimersByTime(400);
        expect(markerEl().classList.contains('label-marker--arriving')).toBe(true);
        jest.advanceTimersByTime(200);
        expect(markerEl().classList.contains('label-marker--arriving')).toBe(false);
        jest.useRealTimers();
    });

    test('the arrival leaves the Hide-label state alone', () => {
        jest.useFakeTimers();
        panoManager.renderPanoMarker(makeLabel());
        markerEl().classList.add('label-marker--hidden'); // The validator hid the label meanwhile.
        jest.advanceTimersByTime(600);
        expect(markerEl().classList.contains('label-marker--hidden')).toBe(true);
        jest.useRealTimers();
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
