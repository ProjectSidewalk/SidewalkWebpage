/**
 * Earlier-era label markers on the Explore minimap (public/js/explore/src/label/Label.js, #4945).
 *
 * Every label the user placed in the region reaches the minimap, and during a re-audit most of them are from an
 * earlier pass. These tests pin the rules that separate the passes: how a label is classified into an era (current
 * mission / earlier mission / placed on since-replaced imagery), how the marker is styled and whether it is clickable
 * for that era, that the legend's "hide earlier labels" suppression survives a canvas render (render() is also what
 * puts a non-deleted label's marker on the map), that a marker suppressed while earlier comes back once its mission is
 * current again, and that eras are re-derived only when the mission actually changes.
 *
 * Label, LabelContainer and MissionContainer are top-level `class`es written for the Grunt-concatenation world, so the
 * sources are eval'd into the jsdom global scope with the map, marker, storage, and i18n collaborators stubbed.
 */

const fs = require('fs');
const path = require('path');
const { makeRecordingCtx } = require('./canvasCtxStub');

const SRC_DIR = path.resolve(__dirname, '..', '..', 'public/js/explore/src');
const LABEL_SRC = fs.readFileSync(path.join(SRC_DIR, 'label/Label.js'), 'utf8');
const LABEL_CONTAINER_SRC = fs.readFileSync(path.join(SRC_DIR, 'label/LabelContainer.js'), 'utf8');
const EVENT_EMITTER_SRC = fs.readFileSync(path.join(SRC_DIR, 'EventEmitter.js'), 'utf8');
const MISSION_CONTAINER_SRC = fs.readFileSync(path.join(SRC_DIR, 'mission/MissionContainer.js'), 'utf8');

/** Stands in for google.maps.marker.AdvancedMarkerElement: keeps its options as plain fields. */
class FakeMarker {
    constructor(options) {
        Object.assign(this, options);
    }

    addListener() {}
}

/** Loads a fresh Label class into the jsdom global scope (a class declaration is not a globalThis property). */
function loadLabel() {
    window.eval(`${LABEL_SRC}\nwindow.Label = Label;`);
    return window.Label;
}

/** Loads LabelContainer beside the already-loaded Label, which it resolves through the global scope. */
function loadLabelContainer() {
    window.eval(`${LABEL_CONTAINER_SRC}\nwindow.LabelContainer = LabelContainer;`);
    return window.LabelContainer;
}

/** Loads MissionContainer with the EventEmitter it extends, in one eval so `extends` resolves. */
function loadMissionContainer() {
    window.eval(`${EVENT_EMITTER_SRC}\n${MISSION_CONTAINER_SRC}\nwindow.MissionContainer = MissionContainer;`);
    return window.MissionContainer;
}

/** In-memory stand-in for svl.storage (TemporaryStorage), with the same JSON round trip. */
function fakeStorage() {
    const store = new Map();
    return {
        get: (k) => (store.has(k) ? JSON.parse(store.get(k)) : null),
        set: (k, v) => store.set(k, JSON.stringify(v)),
    };
}

describe('Label minimap eras (#4945)', () => {
    let Label;
    const map = { id: 'the-minimap' };
    let currentMissionId;

    /** A resumed label's params as /label/resumeMission hands them over: panoXY present, so no pano store lookup. */
    function newLabelParams() {
        return {
            labelType: 'CurbRamp',
            temporaryLabelId: 1,
            missionId: 10,
            panoXY: { x: 10, y: 20 },
            povOfLabelIfCentered: { heading: 90, pitch: -10, zoom: 1 },
            panoLat: 47.6553,
            panoLng: -122.3035,
            labelLat: 47.6554,
            labelLng: -122.3036,
        };
    }

    function newLabel(overrides = {}) {
        return new Label({ ...newLabelParams(), ...overrides });
    }

    beforeEach(() => {
        Label = loadLabel();
        currentMissionId = 10;
        window.svl = {
            minimap: { getMap: () => map },
            missionContainer: { getCurrentMission: () => ({ getProperty: () => currentMissionId }) },
            contextMenu: { isOpen: () => false },
            LABEL_ICON_RADIUS: 10,
            CANVAS_FRAME: { width: 720, height: 480 },
            renderedHFov: () => 90,
            panoViewer: { getPov: () => ({ heading: 90, pitch: -10, zoom: 1 }) },
            tracker: { push: jest.fn() },
            storage: fakeStorage(),
        };
        window.google = {
            maps: {
                LatLng: class { constructor(lat, lng) { this.lat = lat; this.lng = lng; } },
                marker: { AdvancedMarkerElement: FakeMarker },
            },
        };
        window.util = {
            EXPLORE_CANVAS_WIDTH: 720,
            EXPLORE_CANVAS_HEIGHT: 480,
            camelToKebab: (s) => s.replace(/([A-Z])/g, (m, c, i) => (i ? '-' : '') + c.toLowerCase()),
            misc: {
                getIconImagePaths: (t) => ({ iconImagePath: `/icons/${t}_small.svg` }),
                labelTypeHasSeverity: () => false,
            },
            pano: { centeredPovToCanvasCoord: () => ({ x: 100, y: 100 }), renderedHFov: () => 90 },
        };
        window.i18next = { t: (key, opts) => `${key}|${opts?.labelType ?? ''}` };
        // The icon raster and hover card are DOM/canvas work outside what these tests exercise.
        Label.renderLabelIcon = () => {};
    });

    describe('minimapEra', () => {
        it('treats the current mission\'s labels as current', () => {
            expect(Label.minimapEra({ missionId: 10 }, 10)).toBe('current');
        });

        it('treats labels from another mission as an earlier pass', () => {
            expect(Label.minimapEra({ missionId: 9 }, 10)).toBe('prior');
        });

        it('treats an earlier mission\'s labels placed on since-replaced imagery as outdated', () => {
            expect(Label.minimapEra({ missionId: 9, fromOutdatedImagery: true }, 10)).toBe('outdated');
        });

        it('keeps the current mission\'s labels current even if their audit task has since been flagged outdated', () => {
            // A mission spans several audit tasks, so the nightly freshness sync can flag one mid-mission.
            expect(Label.minimapEra({ missionId: 10, fromOutdatedImagery: true }, 10)).toBe('current');
        });

        it('never calls a label prior when there is no mission to compare against or the label has none', () => {
            expect(Label.minimapEra({ missionId: 9 }, null)).toBe('current');
            expect(Label.minimapEra({ missionId: undefined }, 10)).toBe('current');
            // The imagery flag needs no mission comparison, so it still applies.
            expect(Label.minimapEra({ missionId: 9, fromOutdatedImagery: true }, null)).toBe('outdated');
        });
    });

    describe('marker styling', () => {
        it('gives a current label a plain marker that stays on top and can be reviewed', () => {
            const label = newLabel();
            const marker = label.getMinimapMarker();
            expect(marker.content.className).toBe('minimap-label-icon');
            expect(marker.gmpClickable).toBe(true);
            expect(marker.zIndex).toBe(2);
            expect(marker.title).toBe('audit:right-ui.minimap.label-marker-title|common:curb-ramp|');
            expect(marker.content.alt).toBe(marker.title);
        });

        it('dims an earlier-mission label, names it as such, and sends it behind current markers', () => {
            const marker = newLabel({ missionId: 9 }).getMinimapMarker();
            expect(marker.content.className).toBe('minimap-label-icon minimap-label-icon--prior');
            expect(marker.content.dataset.era).toBe('prior');
            // Not a focusable control: its click would do nothing, since only current-mission labels can be returned to.
            expect(marker.gmpClickable).toBe(false);
            expect(marker.zIndex).toBe(1);
            expect(marker.title).toBe('audit:right-ui.minimap.label-marker-title-prior|common:curb-ramp|');
        });

        it('marks an earlier label from replaced imagery as outdated', () => {
            const marker = newLabel({ missionId: 9, fromOutdatedImagery: true }).getMinimapMarker();
            expect(marker.content.className).toBe('minimap-label-icon minimap-label-icon--outdated');
            expect(marker.gmpClickable).toBe(false);
            expect(marker.title).toBe('audit:right-ui.minimap.label-marker-title-outdated|common:curb-ramp|');
        });

        it('leaves a flagged label from the current mission a plain, clickable marker', () => {
            const marker = newLabel({ fromOutdatedImagery: true }).getMinimapMarker();
            expect(marker.content.className).toBe('minimap-label-icon');
            expect(marker.gmpClickable).toBe(true);
        });

        it('always draws the icon the shared icon path resolves to', () => {
            const marker = newLabel({ labelType: 'Obstacle', missionId: 9 }).getMinimapMarker();
            expect(marker.content.src).toContain('/icons/Obstacle_small.svg');
        });
    });

    describe('refreshMinimapEra', () => {
        it('turns this pass into the previous one when the mission changes, and back on a resume', () => {
            const label = newLabel();
            expect(label.getMinimapEra()).toBe('current');

            currentMissionId = 11;
            label.refreshMinimapEra();
            expect(label.getMinimapEra()).toBe('prior');
            expect(label.getMinimapMarker().content.className).toBe('minimap-label-icon minimap-label-icon--prior');
            expect(label.getMinimapMarker().gmpClickable).toBe(false);

            currentMissionId = 10;
            label.refreshMinimapEra();
            expect(label.getMinimapEra()).toBe('current');
            expect(label.getMinimapMarker().content.className).toBe('minimap-label-icon');
            expect(label.getMinimapMarker().gmpClickable).toBe(true);
        });
    });

    describe('LabelContainer legend toggle', () => {
        let LabelContainer;
        let container;

        /** A resumed label added through the container, as fetchLabelsToResumeMission does. */
        function addLabel(tempId, overrides = {}) {
            return container.createLabel(
                { ...newLabelParams(), temporaryLabelId: tempId, panoId: `pano-${tempId}`, ...overrides }, false
            );
        }

        beforeEach(() => {
            LabelContainer = loadLabelContainer();
            container = new LabelContainer(1);
        });

        it('brings a hidden earlier marker back when its mission becomes current again', () => {
            const label = addLabel(1, { missionId: 9 });
            const marker = label.getMinimapMarker();
            container.setEarlierLabelsShown(false);
            expect(marker.map).toBeNull();

            // The user returns to mission 9 (a resume): its labels are this pass's work again, and must be visible
            // whatever the earlier-labels toggle says.
            currentMissionId = 9;
            container.refreshMinimapEras();
            expect(label.getMinimapEra()).toBe('current');
            expect(label.isMinimapMarkerSuppressed()).toBe(false);
            expect(marker.map).toBe(map);
        });

        it('hides a current marker that becomes earlier while the toggle is off', () => {
            const label = addLabel(1, { missionId: 10 });
            container.setEarlierLabelsShown(false);
            expect(label.getMinimapMarker().map).toBe(map);

            currentMissionId = 11;
            container.refreshMinimapEras();
            expect(label.getMinimapMarker().map).toBeNull();
        });

        it('moves the markers even when saving the preference throws, and logs the click', () => {
            const label = addLabel(1, { missionId: 9 });
            window.svl.storage.set = () => { throw new DOMException('full', 'QuotaExceededError'); };
            const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
            expect(() => container.setEarlierLabelsShown(false)).not.toThrow();
            expect(label.getMinimapMarker().map).toBeNull();
            expect(window.svl.tracker.push).toHaveBeenCalledWith(
                'Click_MinimapEarlierLabels_Hide', { prior: 1, outdated: 0 }
            );
            warn.mockRestore();
        });

        it('reads an unreadable preference as shown rather than throwing', () => {
            window.svl.storage.get = () => { throw new SyntaxError('bad JSON'); };
            const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
            expect(LabelContainer.earlierLabelsShownPreference()).toBe(true);
            warn.mockRestore();
        });

        it('re-derives eras without writing the preference or logging a click', () => {
            addLabel(1, { missionId: 9 });
            const set = jest.spyOn(window.svl.storage, 'set');
            container.refreshMinimapEras();
            expect(set).not.toHaveBeenCalled();
            expect(window.svl.tracker.push).not.toHaveBeenCalled();
        });

        it('keeps the legend checkbox in step with the applied preference', () => {
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = true;
            window.svl.ui = { minimap: { legendEarlierLabels: checkbox } };
            window.svl.storage.set(LabelContainer.EARLIER_LABELS_STORAGE_KEY, false);
            container.refreshMinimapEras();
            expect(checkbox.checked).toBe(false);
        });
    });

    describe('MissionContainer.setCurrentMission', () => {
        it('re-derives minimap eras only when the mission id changes, not on every submission', () => {
            const MissionContainer = loadMissionContainer();
            window.svl.labelContainer = { refreshMinimapEras: jest.fn() };
            window.svl.taskContainer = {
                getCurrentTask: () => ({ setProperty: () => {}, getProperty: () => false }),
            };
            const missionContainer = new MissionContainer({ setMessage: () => {} }, { on: () => {} });
            // distanceProgress 1 skips the mission-start bookkeeping, which needs a real street.
            const mission = (id) => ({ getProperty: (k) => ({ missionId: id, distanceProgress: 1 })[k] });

            missionContainer.setCurrentMission(mission(10));
            missionContainer.setCurrentMission(mission(10)); // Form.js re-sends the mission after every submit.
            missionContainer.setCurrentMission(mission(10));
            expect(window.svl.labelContainer.refreshMinimapEras).toHaveBeenCalledTimes(1);

            missionContainer.setCurrentMission(mission(11));
            expect(window.svl.labelContainer.refreshMinimapEras).toHaveBeenCalledTimes(2);
        });
    });

    describe('setMinimapMarkerSuppressed', () => {
        it('takes the marker off the map and keeps it off across a render', () => {
            const label = newLabel({ missionId: 9 });
            const marker = label.getMinimapMarker();
            expect(marker.map).toBe(map);

            label.setMinimapMarkerSuppressed(true);
            expect(marker.map).toBeNull();

            label.setHoverInfoVisibility('hidden');
            // render() also puts a non-deleted label's marker on the map; the suppression must win over that.
            label.render(makeRecordingCtx(), { heading: 90, pitch: -10, zoom: 1 });
            expect(marker.map).toBeNull();
            expect(label.isDeleted()).toBe(false);
        });

        it('puts the marker back when shown again, unless the label was deleted meanwhile', () => {
            const label = newLabel({ missionId: 9 });
            const marker = label.getMinimapMarker();
            label.setMinimapMarkerSuppressed(true);
            label.setMinimapMarkerSuppressed(false);
            expect(marker.map).toBe(map);

            label.setMinimapMarkerSuppressed(true);
            label.remove();
            label.setMinimapMarkerSuppressed(false);
            expect(marker.map).toBeNull();
        });
    });
});
