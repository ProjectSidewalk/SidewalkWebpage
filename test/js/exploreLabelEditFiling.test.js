/**
 * A label edited after it was last saved has to ride along with the next submission (#5767). LabelContainer files
 * every label it creates or restores whenever Label#edit runs, so an editor can't forget to. Placing a label saves it
 * at once, so every later severity, tag and description depends on this.
 */

import { loadModules } from './loader.js';
import { fakeTracker } from './fakes.js';

describe('Label edits file the label for the next submission', () => {
    let Label;
    let container;

    /** Params as a resumed label or a fresh placement hands them over: panoXY present, so no pano store lookup. */
    function params(temporaryLabelId) {
        return {
            labelType: 'CurbRamp', temporaryLabelId, panoId: 'pano', panoXY: { x: 10, y: 20 },
            labelLat: 47.6554, labelLng: -122.3036,
        };
    }

    beforeEach(async () => {
        let LabelContainer;
        ({ Label, LabelContainer } = await loadModules('frontend/js/explore/label/Label.js',
            'frontend/js/explore/label/LabelContainer.js'));
        Label.createMinimapMarker = () => ({ setVisible: () => {} });
        const missionContainer = { getCurrentMission: () => null, on: vi.fn() };
        container = new LabelContainer(1, { isOnboarding: false }, {}, {}, {}, missionContainer, {}, {},
            { incrementLabelCount: vi.fn() }, fakeTracker());
    });

    test('a new label edited after a save is filed again', () => {
        const label = container.createLabel(params(), true);
        expect(container.getLabelsToLog()).toEqual([label]);

        container.clearLabelsToLog(); // A submission.
        label.edit({ severity: 2 });
        expect(container.getLabelsToLog()).toEqual([label]);
    });

    test('a label restored from an earlier session is filed once edited', () => {
        const label = container.createLabel(params(5), false);
        expect(container.getLabelsToLog()).toEqual([]);

        label.edit({ tagIds: [3], description: 'a bin' });
        expect(container.getLabelsToLog()).toEqual([label]);
        expect(label.getProperty('tagIds')).toEqual([3]);
        expect(label.getProperty('description')).toBe('a bin');
    });

    test('editable properties can only be written through edit()', () => {
        const label = container.createLabel(params(), true);
        expect(() => label.setProperty('severity', 1)).toThrow();
        expect(() => label.edit({ labelType: 'Obstacle' })).toThrow();
    });
});
