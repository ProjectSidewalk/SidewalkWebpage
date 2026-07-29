/**
 * Tests for LabelDetail.submissionContext (public/js/common/label-detail/LabelDetail.js, issues #4697 and #4711).
 *
 * The pano/POV recorded with a validation or a validator comment used to be read straight off the pano viewer. That
 * breaks on every label the viewer isn't actually rendering: on the static-crop fallback the primary viewer reports
 * the pano it last loaded, and reports null (or GSV's uninitialized `heading: 0, pitch: 0, zoom: 1`) before it has
 * ever loaded one. Commenting threw `Cannot read properties of null (reading 'lat')` (#4697); validating silently
 * stored the previously viewed label's point of view (#4711).
 *
 * submissionContext() resolves those fields against the label's own metadata instead, which is exactly what the crop
 * is a screenshot of. The columns it feeds are NOT NULL server-side (label_validation.heading/pitch/zoom,
 * validation_task_comment.lat/lng, with pano_id a foreign key into pano_data), so "fall back" has to mean real
 * values, not nulls, whenever the label carries them.
 *
 * LabelDetail is a top-level `class` declaration written for the Grunt-concatenation world, so (like
 * share-widget.test.js) the source is eval'd into the jsdom global scope with an epilogue that exposes the class.
 * Only the static method is exercised here — constructing a LabelDetail needs a live pano viewer.
 */

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/common/label-detail/LabelDetail.js'), 'utf8'
);

/** Loads a fresh LabelDetail class into the jsdom global scope. */
function loadLabelDetail() {
    window.eval(`${SRC}\nwindow.LabelDetail = LabelDetail;`);
    return window.LabelDetail;
}

/** A label whose metadata carries everything: its pano, that pano's camera location, and the stored POV. */
const META = {
    label_id: 42,
    pano_id: 'label-pano',
    lat: 47.61,
    lng: -122.33,
    camera_lat: 47.615,
    camera_lng: -122.335,
    heading: 250.5,
    pitch: -12,
    zoom: 2
};

describe('LabelDetail.submissionContext', () => {
    let LabelDetail;

    beforeEach(() => {
        LabelDetail = loadLabelDetail();
    });

    test('a viewer showing the label wins over the metadata', () => {
        // Admin surfaces let the user navigate away from the label's own pano, so what the viewer reports is the
        // truth about where the validation or comment was made.
        const viewer = {
            panoId: 'walked-to-pano',
            position: { lat: 47.7, lng: -122.4 },
            pov: { heading: 10, pitch: 5, zoom: 3 }
        };

        expect(LabelDetail.submissionContext(viewer, META)).toEqual({
            panoId: 'walked-to-pano', lat: 47.7, lng: -122.4, heading: 10, pitch: 5, zoom: 3
        });
    });

    test('no viewer (static-crop fallback) records the label pano, camera location, and stored POV', () => {
        // The crop is a screenshot of this label's pano at its stored POV, so the metadata describes it exactly.
        // Before #4711 this stored whatever POV the idle viewer reported — the previous label's, or GSV's default.
        expect(LabelDetail.submissionContext(null, META)).toEqual({
            panoId: 'label-pano', lat: 47.615, lng: -122.335, heading: 250.5, pitch: -12, zoom: 2
        });
    });

    test('a viewer that has not loaded a pano yet falls back instead of throwing', () => {
        // The crash reported on #4697: GsvViewer reports null for both until its first pano's metadata arrives.
        const viewer = { panoId: null, position: null, pov: { heading: 0, pitch: 0, zoom: 1 } };

        expect(LabelDetail.submissionContext(viewer, META)).toEqual({
            panoId: 'label-pano', lat: 47.615, lng: -122.335, heading: 0, pitch: 0, zoom: 1
        });
    });

    test('a viewer position missing its coordinates falls back to the camera location', () => {
        const viewer = { panoId: 'p1', position: { lat: undefined, lng: undefined }, pov: null };

        expect(LabelDetail.submissionContext(viewer, META)).toMatchObject({
            panoId: 'p1', lat: 47.615, lng: -122.335
        });
    });

    test('a viewer with no POV falls back to the stored POV', () => {
        // getPov() reports null when the viewer has nothing loaded, and heading/pitch/zoom are NOT NULL server-side.
        const viewer = { panoId: 'p1', position: { lat: 47.7, lng: -122.4 }, pov: null };

        expect(LabelDetail.submissionContext(viewer, META)).toMatchObject({
            heading: 250.5, pitch: -12, zoom: 2
        });
    });

    test('a label with no stored camera location falls back to its own coordinates', () => {
        // camera_lat/camera_lng come from pano_data and are optional in the payload; the label point is the next
        // best answer to "where was this written" and is always present.
        const noCamera = { ...META, camera_lat: undefined, camera_lng: undefined };

        expect(LabelDetail.submissionContext(null, noCamera)).toMatchObject({ lat: 47.61, lng: -122.33 });
    });

    test('a zero-valued POV survives the fallback rather than reading as missing', () => {
        // A label placed facing due north at full zoom-out is all zeroes, which a `||` chain would discard.
        const facingNorth = { ...META, heading: 0, pitch: 0, zoom: 0 };

        expect(LabelDetail.submissionContext(null, facingNorth)).toMatchObject({ heading: 0, pitch: 0, zoom: 0 });
    });

    test('a metadata-less card yields nulls rather than throwing', () => {
        // Nothing to record — the POST will be rejected, but the click must not blow up the card.
        expect(LabelDetail.submissionContext(null, {})).toEqual({
            panoId: null, lat: null, lng: null, heading: null, pitch: null, zoom: null
        });
    });
});
