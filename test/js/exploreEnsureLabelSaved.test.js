/**
 * Tests for Canvas#ensureLabelSaved (public/js/explore/src/canvas/Canvas.js, issue #4726).
 *
 * This is the step the share button runs before it opens: a label placed this session has no server-side id until
 * the next form submit, so clicking share submits first and then shares. The method is small but every branch is a
 * user-visible outcome — a share that opens against the wrong URL, that opens against no URL, or that hangs.
 *
 * Canvas's constructor wires up the whole tool (60-odd `svl.*` collaborators), so these call the method off the
 * prototype with a bare `this`. That works because everything it touches is an argument or a global — the 800ms cap
 * it reads is a *static* private field, resolved through the class binding rather than the instance.
 */

const fs = require('fs');
const path = require('path');

const CANVAS_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/explore/src/canvas/Canvas.js'), 'utf8'
);

/** Loads a fresh Canvas class into the jsdom global scope (a class declaration is not a globalThis property). */
function loadCanvas() {
    window.eval(`${CANVAS_SRC}\nwindow.Canvas = Canvas;`);
    return window.Canvas;
}

/**
 * A stand-in for a label placed this session.
 * @param {object} [opts]
 * @param {number|string} [opts.labelId='DefaultValue'] - What the label reports before/after the submit.
 * @param {?Promise} [opts.cropUpload] - What cropUploaded() resolves with; omit for an already-settled upload.
 */
function labelStub({ labelId = 'DefaultValue', cropUpload = Promise.resolve() } = {}) {
    const props = { labelId };
    return {
        getProperty: (k) => props[k],
        setProperty: (k, v) => { props[k] = v; },
        cropUploaded: jest.fn(() => cropUpload),
    };
}

describe('Canvas#ensureLabelSaved', () => {
    let Canvas;
    let ensureLabelSaved;

    beforeEach(() => {
        Canvas = loadCanvas();
        // Bare `this`: the method reaches only its argument, svl.form, and the class's own static private field.
        ensureLabelSaved = (label) => Canvas.prototype.ensureLabelSaved.call({}, label);
        window.svl = { form: { submitData: jest.fn().mockResolvedValue(undefined) } };
    });

    test('does nothing for a label that already has a server-side id', async () => {
        const label = labelStub({ labelId: 42 });

        await ensureLabelSaved(label);

        expect(window.svl.form.submitData).not.toHaveBeenCalled();
        expect(label.cropUploaded).not.toHaveBeenCalled();
    });

    test('does nothing when there is no label at all', async () => {
        await expect(ensureLabelSaved(undefined)).resolves.toBeUndefined();
        expect(window.svl.form.submitData).not.toHaveBeenCalled();
    });

    test('submits the session, then waits on the crop the submit kicked off', async () => {
        const label = labelStub();
        // Form.js writes the id back onto the label out of the submit response.
        window.svl.form.submitData.mockImplementation(async () => label.setProperty('labelId', 7));

        await ensureLabelSaved(label);

        expect(window.svl.form.submitData).toHaveBeenCalledTimes(1);
        expect(label.getProperty('labelId')).toBe(7);
        // The crop matters as much as the id: /label/:id/image caches whatever base image it can find, so a share
        // handed out before the crop lands would bake in the Street View stand-in.
        expect(label.cropUploaded).toHaveBeenCalledTimes(1);
    });

    test('gives up quietly when the submit produces no id, rather than waiting on a crop that cannot come', async () => {
        // The submit failed, or the label was rejected. The caller then finds an empty share target and does nothing,
        // which is the right outcome for a share that can't be built.
        const label = labelStub();

        await ensureLabelSaved(label);

        expect(window.svl.form.submitData).toHaveBeenCalledTimes(1);
        expect(label.cropUploaded).not.toHaveBeenCalled();
    });

    test('opens anyway when the crop upload stalls, instead of leaving the button dead', async () => {
        // The upload sleeps a fixed 3s when the canvas hasn't produced a crop yet. A share button that does nothing
        // for three seconds reads as broken, so the wait is capped — the link works either way, and ImageController
        // drops the cached preview when the crop does land.
        const label = labelStub({ cropUpload: new Promise(() => { /* never settles */ }) });
        window.svl.form.submitData.mockImplementation(async () => label.setProperty('labelId', 7));

        const started = Date.now();
        await ensureLabelSaved(label);
        const waited = Date.now() - started;

        expect(label.cropUploaded).toHaveBeenCalledTimes(1);
        // Resolving at all is the assertion; the bound guards against the cap being raised to something unusable.
        expect(waited).toBeLessThan(2000);
    });
});
