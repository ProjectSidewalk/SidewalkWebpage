/**
 * Tests for Label#updateLabelIdAndUploadCrop / #cropUploaded (public/js/explore/src/label/Label.js, issue #4726).
 *
 * Form.js calls updateLabelIdAndUploadCrop on every label a submit hands ids back for. Two things ride on it: the
 * label's own id — which the share permalink and every later lookup key off — and a promise the share flow waits on
 * so a link isn't handed out before its preview image exists.
 *
 * The two run on separate clocks, which is what most of these pin. The id is known the moment the server answers;
 * the crop is whatever the canvas has managed to produce by then, and may be nothing at all. So the id is recorded
 * up front and the upload proceeds on its own terms, failures included.
 *
 * Label's constructor reaches for the minimap and the pano store, so the fixtures below hand it enough state to skip
 * both (a cached labelLat/labelLng short-circuits toLatLng; panoXY skips the pano-data branch) and stub the one
 * static that builds a Google marker.
 */

const fs = require('fs');
const path = require('path');

const LABEL_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/explore/src/label/Label.js'), 'utf8'
);

const CROP_B64 = 'data:image/png;base64,iVBORw0KGgo=';

/** Loads a fresh Label class into the jsdom global scope (a class declaration is not a globalThis property). */
function loadLabel() {
    window.eval(`${LABEL_SRC}\nwindow.Label = Label;`);
    return window.Label;
}

describe('Label crop upload', () => {
    let Label;

    /** A label as Form.js would find it: placed this session, so still carrying the placeholder id. */
    function newLabel({ crop } = {}) {
        return new Label({
            labelType: 'CurbRamp',
            temporaryLabelId: 1,
            panoXY: { x: 10, y: 20 },   // Present, so the constructor skips the pano-store lookup.
            labelLat: 47.615,           // Present, so toLatLng returns the cached value instead of estimating.
            labelLng: -122.332,
            latLngComputationMethod: 'approximation2',
            crop,
        });
    }

    beforeEach(() => {
        Label = loadLabel();
        window.svl = { minimap: { getMap: () => null } };
        // The real one builds a google.maps AdvancedMarkerElement; all the constructor does with it is assign a map
        // and add a click listener.
        Label.createMinimapMarker = () => ({ addListener: () => {} });
        global.fetch = jest.fn().mockResolvedValue({ ok: true });
        jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
        jest.useRealTimers();
    });

    test('records the id and uploads the crop under crop_<labelId>', async () => {
        const label = newLabel({ crop: CROP_B64 });

        await label.updateLabelIdAndUploadCrop(99);

        expect(label.getProperty('labelId')).toBe(99);
        expect(global.fetch).toHaveBeenCalledTimes(1);
        const [url, opts] = global.fetch.mock.calls[0];
        expect(url).toBe('saveImage');
        expect(JSON.parse(opts.body)).toEqual({ label_id: 99, label_type: 'CurbRamp', b64: CROP_B64 });
        // Dropped once it's on the server; the base64 string is large and the label outlives the upload.
        expect(label.getProperty('crop')).toBeNull();
    });

    test('records the id even when no crop is ready, so the share permalink still resolves', async () => {
        // A label whose id never lands keeps 'DefaultValue', and nothing that addresses a label by id — the share
        // permalink most visibly — can work on it. The crop is on its own clock and must not gate that.
        jest.useFakeTimers();
        const label = newLabel(); // No crop.

        const upload = label.updateLabelIdAndUploadCrop(99);

        expect(label.getProperty('labelId')).toBe(99); // Set up front, before the upload is even attempted.

        await jest.advanceTimersByTimeAsync(3000); // The one retry the upload allows itself.
        await upload;
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('uploads on the retry when the canvas produces the crop late', async () => {
        jest.useFakeTimers();
        const label = newLabel();

        const upload = label.updateLabelIdAndUploadCrop(99);
        label.setProperty('crop', CROP_B64); // The canvas finishes while the upload is sleeping.

        await jest.advanceTimersByTimeAsync(3000);
        await upload;

        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('cropUploaded resolves immediately when no upload was ever started', async () => {
        // Every label Validate and the label-detail surfaces show is already on the server, and Explore's share flow
        // awaits this unconditionally — it must not hang on a label that has no upload in flight.
        const label = newLabel({ crop: CROP_B64 });

        await expect(label.cropUploaded()).resolves.toBeUndefined();
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('cropUploaded resolves only once the crop has actually reached the server', async () => {
        let release;
        global.fetch.mockReturnValue(new Promise((resolve) => { release = () => resolve({ ok: true }); }));
        const label = newLabel({ crop: CROP_B64 });

        label.updateLabelIdAndUploadCrop(99);

        let settled = false;
        label.cropUploaded().then(() => { settled = true; });
        await Promise.resolve();
        expect(settled).toBe(false);

        release();
        await label.cropUploaded();
        expect(settled).toBe(true);
    });

    test('a failed upload resolves rather than rejects, so it cannot break the share flow', async () => {
        // Canvas#ensureLabelSaved races this promise against a timeout; a rejection there would propagate out of the
        // widget's beforeOpen hook and suppress the popover entirely over a preview image that will heal itself.
        jest.spyOn(console, 'error').mockImplementation(() => {});
        global.fetch.mockRejectedValue(new Error('network down'));
        const label = newLabel({ crop: CROP_B64 });

        await expect(label.updateLabelIdAndUploadCrop(99)).resolves.toBeUndefined();
        await expect(label.cropUploaded()).resolves.toBeUndefined();
        expect(label.getProperty('labelId')).toBe(99);
    });
});
