/**
 * The minimap's mission flags across a mission boundary (#5378).
 *
 * A neighborhood mission's finish flag is planted where the remaining distance runs out on the current street, and
 * the next mission's start is recorded at the spot the user is standing when it loads — the same spot. So when the
 * mission-complete modal closes, the red finish flag the user just reached should read as the new mission's green
 * start flag straight away, not after their next step re-runs the per-move progress update.
 *
 * Minimap and NavigationService are top-level `class` declarations written for the Grunt-concatenation world, so the
 * sources are eval'd into the jsdom global scope with MapLibre's Map and Marker and the UI collaborators stubbed, so
 * the flags go through the real Minimap.addMarker. Real turf: the along-street math that places the finish flag is
 * part of what is being exercised.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const readSrc = (relativePath) => fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');

const NAVIGATION_SERVICE_SRC = readSrc('public/js/explore/src/navigation/NavigationService.js');
const MINIMAP_SOURCES = ['MinimapStyle', 'MinimapBasemapStyle', 'Minimap'];

window.turf = require(path.join(REPO_ROOT, 'public/vendor/turf/turf-7.4.0.min.js'));
const { turf } = window;

/**
 * Stands in for maplibregl.Map, just far enough for Minimap.create to finish: a minimap without a map keeps its
 * markers off it, and so would plant no flags here.
 */
class FakeMap {
    addImage() {}

    addSource() {}

    addLayer() {}

    on() {}

    getCanvas() {
        return document.createElement('canvas');
    }

    once(name, handler) {
        if (name === 'style.load') setTimeout(handler, 0);
    }
}

/** Stands in for maplibregl.Marker: records its element and where it was last put. */
class FakeMarker {
    static created = [];

    constructor({ element }) {
        this.element = element;
        FakeMarker.created.push(this);
    }

    setLngLat([lng, lat]) {
        this.position = { lat, lng };
        return this;
    }

    addTo() {
        return this;
    }

    get title() {
        return this.element.title;
    }

    get hidden() {
        return this.element.hidden;
    }
}

// A street running east along one latitude; positions are named by metres from its start.
const LAT = 47.6;
const START_LNG = -122.33;
const STREET_LENGTH_M = 500;
const M_PER_DEG_LNG = 111320 * Math.cos((LAT * Math.PI) / 180);
const lngAt = (meters) => START_LNG + meters / M_PER_DEG_LNG;
const metersAt = (lng) => (lng - START_LNG) * M_PER_DEG_LNG;

/** The one street both missions run along, with the user's furthest point and each mission's recorded start. */
function makeTask({ furthestM = 0, missionStarts = {} } = {}) {
    const feature = turf.lineString([[START_LNG, LAT], [lngAt(STREET_LENGTH_M), LAT]]);
    return {
        getFeature: () => feature,
        getFurthestPointReached: () => turf.point([lngAt(furthestM), LAT]),
        getEndCoordinate: () => ({ lat: LAT, lng: lngAt(STREET_LENGTH_M) }),
        getMissionStart: (missionId) => missionStarts[missionId],
    };
}

function makeMission(missionId, { distanceM, progressM = 0 }) {
    return {
        getProperty: (key) => ({ missionId, distanceProgress: progressM })[key],
        getDistance: () => distanceM,
        getMissionCompletionRate: () => progressM / distanceM,
    };
}

/** A jQuery-shaped stub for the progress-bar elements the reset touches; nothing here is under test. */
const uiStub = () => ({ css: jest.fn(), text: jest.fn(), attr: jest.fn(), hasClass: () => false });

describe('Minimap mission flags across a mission boundary', () => {
    let minimap;
    let task;

    const flagByTitle = (title) => FakeMarker.created.filter((marker) => marker.title === title).at(-1);

    beforeEach(async () => {
        FakeMarker.created = [];
        window.util = { assetPath: (logicalPath) => logicalPath };
        window.i18next = { t: (key) => key };
        window.maplibregl = { Map: FakeMap, Marker: FakeMarker };
        window.svl = {
            regionModel: { isRoute: false },
            isOnboarding: () => false,
            isExploreAddressMode: () => false,
            taskContainer: { getTasks: () => [task], getCurrentTask: () => task },
            ui: {
                minimap: {
                    holder: uiStub(),
                    missionProgress: uiStub(),
                    missionProgressFill: uiStub(),
                    missionProgressPercent: uiStub(),
                    missionProgressDistance: uiStub(),
                },
            },
        };

        window.eval(`${NAVIGATION_SERVICE_SRC}; window.NavigationService = NavigationService;`);
        for (const name of MINIMAP_SOURCES) {
            window.eval(`${readSrc(`public/js/explore/src/navigation/${name}.js`)}; window.${name} = ${name};`);
        }
        // jsdom has no 2D canvas; the chevron's pixels aren't under test.
        window.MinimapStyle.chevronImage = () => ({ width: 1, height: 1, data: new Uint8ClampedArray(4) });
        minimap = await window.Minimap.create({ lat: LAT, lng: START_LNG });
    });

    test('closing the modal turns the reached finish flag into the next mission\'s start flag', () => {
        // Mission 1 began at the street start and has 200 m to go from the user's furthest point at 100 m, so its
        // finish flag stands at 300 m along the street.
        task = makeTask({ furthestM: 100, missionStarts: { 1: { lat: LAT, lng: lngAt(0) } } });
        minimap.updateMissionProgress(makeMission(1, { distanceM: 300, progressM: 100 }));

        const start = flagByTitle('audit:right-ui.minimap.mission-start-flag');
        const finish = flagByTitle('audit:right-ui.minimap.mission-finish-flag');
        expect(metersAt(start.position.lng)).toBeCloseTo(0, 0);
        expect(metersAt(finish.position.lng)).toBeCloseTo(300, 0);

        // The user walks to the finish; mission 2 loads while the modal is up, recording its start where they stand.
        // Its 1 km target does not fit on the 200 m left of this street, so no finish is knowable yet.
        task = makeTask({
            furthestM: 300,
            missionStarts: { 1: { lat: LAT, lng: lngAt(0) }, 2: { lat: LAT, lng: lngAt(300) } },
        });
        minimap.resetMissionProgress(makeMission(2, { distanceM: 1000 }));

        expect(FakeMarker.created).toHaveLength(2); // Moved, not re-planted.
        expect(metersAt(start.position.lng)).toBeCloseTo(300, 0);
        expect(finish.hidden).toBe(true);
    });

    test('a short next mission gets its finish flag re-planted on the same street at once', () => {
        task = makeTask({ furthestM: 300, missionStarts: { 2: { lat: LAT, lng: lngAt(300) } } });
        minimap.resetMissionProgress(makeMission(2, { distanceM: 150 }));

        const start = flagByTitle('audit:right-ui.minimap.mission-start-flag');
        const finish = flagByTitle('audit:right-ui.minimap.mission-finish-flag');
        expect(metersAt(start.position.lng)).toBeCloseTo(300, 0);
        expect(metersAt(finish.position.lng)).toBeCloseTo(450, 0);
    });

    test('a reset with no mission leaves the flags alone', () => {
        task = makeTask({ furthestM: 100, missionStarts: { 1: { lat: LAT, lng: lngAt(0) } } });
        minimap.updateMissionProgress(makeMission(1, { distanceM: 300, progressM: 100 }));
        const finish = flagByTitle('audit:right-ui.minimap.mission-finish-flag');

        minimap.resetMissionProgress();

        expect(FakeMarker.created).toHaveLength(2);
        expect(finish.hidden).toBe(false);
    });
});
