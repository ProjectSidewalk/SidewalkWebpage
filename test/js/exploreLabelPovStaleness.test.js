/**
 * Regression tests for the #4842 "off-target markers" bug class: the label record submitted to the server must
 * describe the CLICK-time viewport, never the viewport at submission time.
 *
 * From 2023-03 to 2024-09 the Explore client staged label submissions in batch lists, and a staged record's POV
 * picked up viewport changes made between the click and the flush (issue #4842; window dated in
 * sidewalk-panorama-tools/reports/2026-08-09-era-replay-study.md). Validate, Gallery, and the label detail views
 * re-render markers from exactly those fields, so a stale POV draws the marker off-target even though the user
 * placed it correctly. The class died when PR #3662 rebuilt submission to per-label immediate, but nothing pinned
 * the invariant — these tests do, as the client-side complement to the server's log-only replay guard
 * (ExploreService.warnIfRecordStale).
 *
 * The projection math used here is the real production code (panoUtilities.js), so the self-consistency assertion
 * is the same replay the server guard runs: the record's POV + canvas_x/y must reproduce its pano_x/y.
 *
 * Form is a top-level `class` declaration, so the test evals the source into the jsdom global scope (the
 * exploreFormPanoSubmitted pattern) rather than using loadGlobalScript.
 */

const fs = require('fs');
const path = require('path');
const { loadGlobalScript } = require('./loadGlobalScript');

const FORM_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/explore/src/data/Form.js'), 'utf8'
);

// Explore's fixed labeling canvas size (util.EXPLORE_CANVAS_WIDTH/HEIGHT in public/js/common/utilities.js).
const CANVAS_WIDTH = 720;
const CANVAS_HEIGHT = 480;

// The pano the label is placed on. cameraHeading feeds povToPanoCoord exactly as Label's constructor does.
const PANO = {
    panoId: 'pano-A',
    source: 'gsv',
    captureDate: { format: () => '2024-06' },
    width: 8192,
    height: 4096,
    tileWidth: 512,
    tileHeight: 512,
    lat: 41.87,
    lng: -87.62,
    cameraHeading: 163.2,
    cameraPitch: 0,
    cameraRoll: 0,
    linkedPanos: [],
    history: [],
    copyright: null,
    address: null,
    submitted: false,
};

/** Loads a fresh Form class into the jsdom global scope. */
function loadForm() {
    window.eval(`${FORM_SRC}\nwindow.Form = Form;`);
    return window.Form;
}

/** A stand-in for the PanoStore pano the label sits on. */
function panoStub() {
    const props = { ...PANO };
    return {
        getProperties: () => props,
        getProperty: (k) => props[k],
        setProperty: jest.fn((k, v) => { props[k] = v; }),
    };
}

/**
 * Builds a label the way Canvas.#createLabel + Label's constructor do at click time: capture the live POV once,
 * derive povOfLabelIfCentered and pano_x/y from it through the real projection math, and store everything as plain
 * values on the label. Form must serialize from these stored values alone.
 *
 * @param {{heading: number, pitch: number, zoom: number}} clickPov - The live POV at the moment of the click.
 * @param {{x: number, y: number}} clickCanvasXY - The canvas point the user clicked.
 * @returns {Object} A label stub carrying the click-time record.
 */
function labelPlacedAt(clickPov, clickCanvasXY) {
    const povOfLabelIfCentered = util.pano.canvasCoordToCenteredPov(
        clickPov, clickCanvasXY.x, clickCanvasXY.y, CANVAS_WIDTH, CANVAS_HEIGHT,
    );
    const panoXY = util.pano.povToPanoCoord(povOfLabelIfCentered, PANO.cameraHeading, PANO.width, PANO.height);
    const props = {
        panoId: PANO.panoId,
        tutorial: false,
        panoXY,
        originalCanvasXY: { ...clickCanvasXY },
        originalPov: { ...clickPov },
        povOfLabelIfCentered,
        temporaryLabelId: 1,
        severity: null,
        tagIds: [],
        description: null,
    };
    return {
        getProperties: () => props,
        getProperty: (k) => props[k],
        toLatLng: () => null,
        isDeleted: () => false,
        getLabelType: () => 'CurbRamp',
    };
}

/** A stand-in for the current audit task. */
function taskStub() {
    return {
        getAuditTaskId: () => 12,
        getStreetEdgeId: () => 34,
        getProperty: () => null,
        isComplete: () => false,
        getMissionStart: () => null,
        getAuditedDistance: () => 0,
        lineDistance: () => 1,
        setProperty: jest.fn(),
    };
}

describe('Explore label POV staleness (#4842 regression)', () => {
    let labels;
    let form;
    let viewerPov;

    /** Builds a Form wired to stub collaborators around the staged `labels`. */
    function buildForm() {
        const Form = loadForm();
        const missionProps = { missionId: 5, distanceProgress: 0, distance: 100, isComplete: false, skipped: false };
        const mission = { getProperty: (k) => missionProps[k], updateDistanceProgress: jest.fn() };
        const labelContainer = { getLabelsToLog: () => labels, clearLabelsToLog: jest.fn(), getAllLabels: () => [] };
        const pano = panoStub();
        const panoStore = {
            getStagedPanoData: () => [pano].filter((p) => !p.getProperty('submitted')),
            getPanoData: () => pano,
        };
        const taskContainer = { getCurrentTask: taskStub, updateTaskPriorities: jest.fn() };
        return new Form(
            labelContainer,
            { on: jest.fn() }, // missionModel
            { getCurrentMission: () => mission }, // missionContainer
            panoStore,
            taskContainer,
            { getActions: () => [], refresh: jest.fn(), push: jest.fn() }, // tracker
            '/task'
        );
    }

    /** Stubs fetch to accept the POST, capturing each request body as parsed JSON. */
    function acceptingFetch() {
        const bodies = [];
        window.fetch = jest.fn((url, opts) => {
            bodies.push(JSON.parse(opts.body));
            return Promise.resolve({
                ok: true,
                json: async () => ({ audit_task_id: 12, label_ids: [], refresh_page: false }),
            });
        });
        return bodies;
    }

    /**
     * The server guard's replay (ExploreService.warnIfRecordStale), run client-side with the production projection:
     * re-derive pano_x/y from the submitted POV + canvas point and compare to the submitted pano_x/y.
     *
     * @param {Object} sent - The submitted label_point block.
     * @returns {{dx: number, dy: number}} Absolute pano-pixel error of the replay.
     */
    function replayError(sent) {
        const centered = util.pano.canvasCoordToCenteredPov(
            { heading: sent.heading, pitch: sent.pitch, zoom: sent.zoom },
            sent.canvas_x, sent.canvas_y, CANVAS_WIDTH, CANVAS_HEIGHT,
        );
        const panoXY = util.pano.povToPanoCoord(centered, PANO.cameraHeading, PANO.width, PANO.height);
        return { dx: Math.abs(panoXY.x - sent.pano_x), dy: Math.abs(panoXY.y - sent.pano_y) };
    }

    beforeEach(() => {
        // The real projection math the client places labels with; assigns window.util.pano.
        window.util = window.util || {};
        loadGlobalScript('public/js/common/pano-viewer/src/panoUtilities.js');
        // Form's other collaborators that live on globals rather than constructor args.
        Object.assign(window.util, {
            getBrowser: () => 'chrome',
            getBrowserVersion: () => '1',
            getOperatingSystem: () => 'linux',
            math: { kmsToMeters: (km) => km * 1000 },
        });
        window.AsyncLock = class { async acquire(key, fn) { return fn(); } };
        viewerPov = { heading: 128.7, pitch: -12.3, zoom: 2 };
        window.svl = {
            userRouteId: null,
            regionId: 1,
            isOnboarding: () => false,
            panoViewer: {
                getPov: jest.fn(() => ({ ...viewerPov })),
                getPosition: () => ({ lat: 41.85, lng: -87.65 }),
            },
            tracker: { setAuditTaskID: jest.fn() },
        };
        window.$ = jest.fn(() => ({ width: () => 1920, height: () => 1080 }));
        window.i18next = { language: 'en' };

        labels = [];
        form = buildForm();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('submits a self-consistent record when the viewport is unchanged', async () => {
        labels = [labelPlacedAt(viewerPov, { x: 431, y: 302 })];
        const bodies = acceptingFetch();

        await form.submitData(taskStub());

        const sent = bodies[0].labels[0].label_point;
        const { dx, dy } = replayError(sent);
        // pano_x/y are Math.round()ed in the payload, so allow a pixel.
        expect(dx).toBeLessThanOrEqual(1);
        expect(dy).toBeLessThanOrEqual(1);
    });

    test('submitted record still describes the click after panning and zooming before the flush', async () => {
        const clickPov = { ...viewerPov };
        labels = [labelPlacedAt(clickPov, { x: 431, y: 302 })];

        // Pan, tilt, and zoom the viewer between the click and the flush — the submitted record must be immune to
        // viewport changes in that window.
        viewerPov = { heading: 291.4, pitch: 8.9, zoom: 1 };
        window.svl.panoViewer.getPov.mockClear();

        const bodies = acceptingFetch();
        await form.submitData(taskStub());

        // The record must carry the click-time POV verbatim...
        const sent = bodies[0].labels[0].label_point;
        expect(sent.heading).toBe(clickPov.heading);
        expect(sent.pitch).toBe(clickPov.pitch);
        expect(sent.zoom).toBe(clickPov.zoom);
        expect(sent.canvas_x).toBe(431);
        expect(sent.canvas_y).toBe(302);

        // ...stay replay-consistent (the server guard's check)...
        const { dx, dy } = replayError(sent);
        expect(dx).toBeLessThanOrEqual(1);
        expect(dy).toBeLessThanOrEqual(1);

        // ...and the serialization path must never have consulted the live viewport's POV.
        expect(window.svl.panoViewer.getPov).not.toHaveBeenCalled();
    });
});
