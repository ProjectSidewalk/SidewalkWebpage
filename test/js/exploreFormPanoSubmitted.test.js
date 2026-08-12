/**
 * Tests for Form's pano staging contract (public/js/explore/src/data/Form.js, issue #4587).
 *
 * A pano's metadata is submitted at most once per session: PanoStore hands Form only panos not yet marked
 * `submitted`. That mark must therefore mean "the server accepted this pano" — if it were set when the payload is
 * compiled, a failed POST would permanently drop the pano's metadata while later submissions keep referencing its
 * pano_id in labels, orphaning them. These tests pin the contract: panos are marked `submitted` only on a 2xx
 * response, and stay staged (to ride along with the next submission) on an HTTP error or a network failure.
 *
 * Form is a top-level `class` declaration, so the test evals the source into the jsdom global scope (the
 * ShareWidget/PanoInfoPopover pattern) rather than using loadGlobalScript.
 */

const fs = require('fs');
const path = require('path');

const FORM_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/explore/src/data/Form.js'), 'utf8'
);

/** Loads a fresh Form class into the jsdom global scope. */
function loadForm() {
    window.eval(`${FORM_SRC}\nwindow.Form = Form;`);
    return window.Form;
}

/** A stand-in for a PanoStore pano whose metadata hasn't been submitted yet. */
function panoStub(panoId) {
    const props = {
        panoId,
        source: 'gsv',
        captureDate: { format: () => '2024-06' },
        width: 8192,
        height: 4096,
        tileWidth: 512,
        tileHeight: 512,
        lat: 41.87,
        lng: -87.62,
        cameraHeading: 180,
        cameraPitch: 0,
        cameraRoll: 0,
        linkedPanos: [],
        history: [],
        copyright: null,
        address: null,
        submitted: false,
    };
    return {
        getProperties: () => props,
        getProperty: (k) => props[k],
        setProperty: jest.fn((k, v) => { props[k] = v; }),
    };
}

/** A stand-in for a label placed this session on the given pano. */
function labelStub(panoId, tempLabelId) {
    const props = {
        panoId,
        tutorial: false,
        panoXY: { x: 100, y: 100 },
        originalCanvasXY: { x: 200, y: 200 },
        originalPov: { heading: 90, pitch: 0, zoom: 1 },
        temporaryLabelId: tempLabelId,
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

describe('Form pano submission staging', () => {
    let panos;
    let labels;
    let form;

    /** Builds a Form wired to stub collaborators, staging the given panos and labels. */
    function buildForm() {
        const Form = loadForm();
        const missionProps = { missionId: 5, distanceProgress: 0, distance: 100, isComplete: false, skipped: false };
        const mission = { getProperty: (k) => missionProps[k], updateDistanceProgress: jest.fn() };
        const labelContainer = { getLabelsToLog: () => labels, clearLabelsToLog: jest.fn(), getAllLabels: () => [] };
        const panoStore = {
            getStagedPanoData: () => panos.filter((p) => !p.getProperty('submitted')),
            getPanoData: (id) => panos.find((p) => p.getProperty('panoId') === id) ?? null,
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

    beforeEach(() => {
        // Form's collaborators that live on globals rather than constructor args.
        window.AsyncLock = class { async acquire(key, fn) { return fn(); } };
        window.svl = {
            userRouteId: null,
            regionId: 1,
            isOnboarding: () => false,
            panoViewer: { getPosition: () => ({ lat: 41.85, lng: -87.65 }) },
            tracker: { setAuditTaskID: jest.fn() },
        };
        window.util = {
            getBrowser: () => 'chrome',
            getBrowserVersion: () => '1',
            getOperatingSystem: () => 'linux',
            math: { kmsToMeters: (km) => km * 1000 },
            pano: { TUTORIAL_PANO_IDS: new Set(['tutorial', 'afterWalkTutorial']) },
        };
        window.$ = jest.fn(() => ({ width: () => 1920, height: () => 1080 }));
        window.i18next = { language: 'en' };

        panos = [panoStub('pano-A'), panoStub('pano-B')];
        labels = [];
        form = buildForm();

        // The failure paths end in window.location.reload(), which jsdom reports as "Not implemented: navigation"
        // through console.error; swallow that expected noise without hiding real errors from the assertions.
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test('marks panos submitted only once the server has accepted them', async () => {
        window.fetch = jest.fn(() => {
            // At POST time the panos must still be staged: the mark means "accepted", not "sent".
            for (const pano of panos) expect(pano.getProperty('submitted')).toBe(false);
            return Promise.resolve({
                ok: true,
                json: async () => ({ audit_task_id: 12, label_ids: [], refresh_page: false }),
            });
        });

        await form.submitData(taskStub());

        expect(window.fetch).toHaveBeenCalledTimes(1);
        for (const pano of panos) expect(pano.getProperty('submitted')).toBe(true);
    });

    test('keeps panos staged for the next submission when the server rejects the POST', async () => {
        window.fetch = jest.fn(() => Promise.resolve({ ok: false, json: async () => ({}) }));

        await form.submitData(taskStub());

        // Still staged: the next submission's payload will carry their metadata again.
        for (const pano of panos) expect(pano.getProperty('submitted')).toBe(false);
    });

    test('keeps panos staged when the POST fails at the network level', async () => {
        window.fetch = jest.fn(() => Promise.reject(new Error('network down')));

        await form.submitData(taskStub());

        for (const pano of panos) expect(pano.getProperty('submitted')).toBe(false);
    });

    test('attaches the pano metadata block to each label so the server can commit them atomically', async () => {
        labels = [labelStub('pano-A', 7)];
        const bodies = acceptingFetch();

        await form.submitData(taskStub());

        const sent = bodies[0].labels[0];
        expect(sent.temporary_label_id).toBe(7);
        // The block carries the pano's full metadata, not just an id reference (#4587).
        expect(sent.pano).toMatchObject({ pano_id: 'pano-A', source: 'gsv', capture_date: '2024-06', width: 8192 });
        // The same pano still rides the viewed-panos batch; the server's writes are idempotent.
        expect(bodies[0].panos.map((p) => p.pano_id)).toContain('pano-A');
    });

    test('omits the pano block for labels on the locally-served tutorial panos', async () => {
        // Tutorial panos carry fabricated metadata that must never touch the seeded pano_data rows; PanoStore also
        // marks them submitted on arrival, so they are excluded from the viewed-panos batch.
        const tutorialPano = panoStub('tutorial');
        tutorialPano.setProperty('submitted', true);
        panos = [tutorialPano];
        labels = [labelStub('tutorial', 8)];
        const bodies = acceptingFetch();

        await form.submitData(taskStub());

        expect(bodies[0].labels[0].pano).toBeUndefined();
        expect(bodies[0].panos).toHaveLength(0);
    });
});
