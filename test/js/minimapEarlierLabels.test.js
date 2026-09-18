/**
 * Earlier-era label markers on the Explore minimap (public/js/explore/src/label/Label.js, #4945).
 *
 * Every label the user placed in the region reaches the minimap, and during a re-audit most of them are from an
 * earlier pass. These tests pin the three rules that separate the passes: how a label is classified into an era
 * (current mission / earlier mission / placed on since-replaced imagery), how the marker is styled for that era, and
 * that the legend's "hide earlier labels" suppression survives a canvas render, since render() is also what puts a
 * non-deleted label's marker on the map.
 *
 * Label is a top-level `class` written for the Grunt-concatenation world, so the source is eval'd into the jsdom
 * global scope with the map, marker, and i18n collaborators stubbed.
 */

const fs = require('fs');
const path = require('path');
const { makeRecordingCtx } = require('./canvasCtxStub');

const LABEL_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/explore/src/label/Label.js'), 'utf8'
);

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

describe('Label minimap eras (#4945)', () => {
    let Label;
    const map = { id: 'the-minimap' };
    let currentMissionId;

    /** A resumed label as /label/resumeMission hands it over: panoXY present, so the pano store is never consulted. */
    function newLabel(overrides = {}) {
        return new Label({
            labelType: 'CurbRamp',
            temporaryLabelId: 1,
            missionId: 10,
            panoXY: { x: 10, y: 20 },
            povOfLabelIfCentered: { heading: 90, pitch: -10, zoom: 1 },
            panoLat: 47.6553,
            panoLng: -122.3035,
            labelLat: 47.6554,
            labelLng: -122.3036,
            ...overrides,
        });
    }

    beforeEach(() => {
        Label = loadLabel();
        currentMissionId = 10;
        window.svl = {
            minimap: { getMap: () => map },
            missionContainer: { getCurrentMission: () => ({ getProperty: () => currentMissionId }) },
            contextMenu: { isOpen: () => false },
            LABEL_ICON_RADIUS: 10,
            panoViewer: { getPov: () => ({ heading: 90, pitch: -10, zoom: 1 }) },
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
            pano: { centeredPovToCanvasCoord: () => ({ x: 100, y: 100 }) },
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

        it('treats labels placed on since-replaced imagery as outdated, whatever their mission', () => {
            expect(Label.minimapEra({ missionId: 10, fromOutdatedImagery: true }, 10)).toBe('outdated');
            expect(Label.minimapEra({ missionId: 9, fromOutdatedImagery: true }, 10)).toBe('outdated');
        });

        it('dims nothing when there is no mission to compare against or the label has none', () => {
            expect(Label.minimapEra({ missionId: 9 }, null)).toBe('current');
            expect(Label.minimapEra({ missionId: undefined }, 10)).toBe('current');
        });
    });

    describe('marker styling', () => {
        it('gives a current label a plain marker that stays on top and can be reviewed', () => {
            const label = newLabel();
            const marker = label.getMinimapMarker();
            expect(marker.content.className).toBe('minimap-label-icon');
            expect(marker.zIndex).toBe(2);
            expect(marker.title).toBe('audit:right-ui.minimap.label-marker-title|common:curb-ramp|');
            expect(marker.content.alt).toBe(marker.title);
        });

        it('dims an earlier-mission label, names it as such, and sends it behind current markers', () => {
            const marker = newLabel({ missionId: 9 }).getMinimapMarker();
            expect(marker.content.className).toBe('minimap-label-icon minimap-label-icon--prior');
            expect(marker.content.dataset.era).toBe('prior');
            expect(marker.zIndex).toBe(1);
            expect(marker.title).toBe('audit:right-ui.minimap.label-marker-title-prior|common:curb-ramp|');
        });

        it('marks a label from replaced imagery as outdated', () => {
            const marker = newLabel({ fromOutdatedImagery: true }).getMinimapMarker();
            expect(marker.content.className).toBe('minimap-label-icon minimap-label-icon--outdated');
            expect(marker.title).toBe('audit:right-ui.minimap.label-marker-title-outdated|common:curb-ramp|');
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

            currentMissionId = 10;
            label.refreshMinimapEra();
            expect(label.getMinimapEra()).toBe('current');
            expect(label.getMinimapMarker().content.className).toBe('minimap-label-icon');
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
