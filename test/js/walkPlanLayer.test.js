/**
 * The minimap preview of a neighborhood mission's planned walk (#5526): which of the streets ahead are drawn as the
 * route ahead, the dotted connector drawn for each upcoming jump, and that a previewed street is drawn exactly as a
 * route's street ahead is.
 *
 * WalkPlanLayer, MinimapStyle and Task are top-level `class` declarations for the Grunt-concatenation world, so the
 * sources are eval'd into the jsdom global scope, with a Google Maps fake that records each polyline's options.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const readSrc = (relativePath) => fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');

const WALK_PLAN_LAYER_SRC = readSrc('public/js/explore/src/navigation/WalkPlanLayer.js');
const MINIMAP_STYLE_SRC = readSrc('public/js/explore/src/navigation/MinimapStyle.js');
const TASK_SRC = readSrc('public/js/explore/src/task/Task.js');
const UTIL_MATH_SRC = readSrc('public/js/common/utilitiesMath.js');
const turf = require(path.join(REPO_ROOT, 'public/vendor/turf/turf-7.4.0.min.js'));

class FakeLatLng {
    constructor(lat, lng) {
        this.lat = lat;
        this.lng = lng;
    }
}

/** google.maps.Polyline: keeps its options and the map it was last put on. */
class FakePolyline {
    static created = [];

    constructor(options) {
        this.options = options;
        this.map = null;
        FakePolyline.created.push(this);
    }

    setMap(map) {
        this.map = map;
    }
}

const onMap = () => FakePolyline.created.filter((polyline) => polyline.map !== null);

/**
 * A planned street ahead, as WalkPlanLayer sees it: a length, its two ends, and the preview flag.
 * @param {number} id - Street id; also places the street, `id` km east, so every end is distinct.
 * @param {number} lengthM - Length in metres.
 */
function makeTask(id, lengthM = 100) {
    return {
        id,
        plannedAhead: false,
        lineDistance: () => lengthM,
        getStartCoordinate: () => ({ lat: 47.6, lng: id }),
        getEndCoordinate: () => ({ lat: 47.7, lng: id }),
        setPlannedAhead: jest.fn(function (value) {
            this.plannedAhead = value;
        }),
        render: jest.fn(),
    };
}

const step = (id, jump = false) => ({ id, reverse: false, jump, jumpM: jump ? 300 : 0 });

beforeEach(() => {
    FakePolyline.created = [];
    window.google = { maps: { LatLng: FakeLatLng, Polyline: FakePolyline } };
    window.eval(`${MINIMAP_STYLE_SRC}\nwindow.MinimapStyle = MinimapStyle;`);
    window.eval(`${WALK_PLAN_LAYER_SRC}\nwindow.WalkPlanLayer = WalkPlanLayer;`);
});

describe('WalkPlanLayer.horizonCount', () => {
    const horizon = (lengthsM, remainingM = 0) => window.WalkPlanLayer.horizonCount(lengthsM, remainingM);

    it('reaches at least 250 m past the current street', () => {
        expect(horizon([100, 100, 100, 100])).toBe(3);
    });

    it('reaches as far as the mission has left to go', () => {
        expect(horizon(Array(10).fill(100), 420)).toBe(5);
    });

    it('shows at least two streets, however long the first', () => {
        expect(horizon([400, 100, 100])).toBe(2);
    });

    it('stops at eight streets, however much mission is left', () => {
        expect(horizon(Array(20).fill(20), 5000)).toBe(8);
    });

    it('shows what there is when fewer streets remain', () => {
        expect(horizon([30])).toBe(1);
        expect(horizon([])).toBe(0);
    });
});

describe('WalkPlanLayer.refresh', () => {
    let ahead;
    let current;
    let layer;
    let mission;

    beforeEach(() => {
        current = makeTask(0);
        ahead = [];
        mission = { getDistance: () => 0, getProperty: () => 0 };
        window.svl = {
            isExploreAddressMode: () => false,
            minimap: { getMap: () => 'the-minimap' },
            missionContainer: { getCurrentMission: () => mission },
        };
        const taskContainer = {
            getCurrentTask: () => current,
            getPlannedStepsAhead: (limit) => ahead.slice(0, limit),
        };
        layer = new window.WalkPlanLayer(taskContainer);
    });

    it('previews the streets within the horizon as the route ahead, and leaves the rest alone', () => {
        const tasks = [1, 2, 3, 4].map((id) => makeTask(id, 100));
        ahead = tasks.map((task) => ({ task, step: step(task.id) }));

        layer.refresh();

        expect(tasks.map((task) => task.plannedAhead)).toEqual([true, true, true, false]);
        expect(tasks.slice(0, 3).every((task) => task.render.mock.calls.length === 1)).toBe(true);
        expect(tasks[3].render).not.toHaveBeenCalled();
    });

    it('reaches further when the mission has further to go', () => {
        mission = { getDistance: () => 1000, getProperty: () => 450 };
        const tasks = [1, 2, 3, 4, 5, 6, 7].map((id) => makeTask(id, 100));
        ahead = tasks.map((task) => ({ task, step: step(task.id) }));

        layer.refresh();

        expect(tasks.filter((task) => task.plannedAhead)).toHaveLength(6);
    });

    it('draws one connector per previewed jump, from the street before it to the jumped-to street', () => {
        const tasks = [1, 2, 3].map((id) => makeTask(id, 100));
        ahead = [
            { task: tasks[0], step: step(1, true) },
            { task: tasks[1], step: step(2) },
            { task: tasks[2], step: step(3, true) },
        ];

        layer.refresh();

        const connectors = onMap();
        expect(connectors).toHaveLength(2);
        expect(connectors.map(({ options }) => options.path)).toEqual([
            [new FakeLatLng(47.7, 0), new FakeLatLng(47.6, 1)], // The current street's end to the first jump.
            [new FakeLatLng(47.7, 2), new FakeLatLng(47.6, 3)],
        ]);
        expect(connectors.every((connector) => connector.map === 'the-minimap')).toBe(true);
        expect(connectors[0].options).toEqual(window.MinimapStyle.plannedJump(connectors[0].options.path));
    });

    it('draws no connector for a jump beyond the horizon', () => {
        const tasks = [1, 2, 3, 4].map((id) => makeTask(id, 100));
        ahead = tasks.map((task) => ({ task, step: step(task.id, task.id === 4) }));

        layer.refresh();

        expect(onMap()).toHaveLength(0);
    });

    it('takes down what it drew once the plan moves on, and redraws what it un-previews', () => {
        const tasks = [1, 2, 3].map((id) => makeTask(id, 200));
        ahead = [{ task: tasks[0], step: step(1, true) }, { task: tasks[1], step: step(2) }];
        layer.refresh();
        const [firstConnector] = onMap();

        ahead = [{ task: tasks[1], step: step(2) }, { task: tasks[2], step: step(3) }];
        layer.refresh();

        expect(firstConnector.map).toBeNull();
        expect(onMap()).toHaveLength(0);
        expect(tasks.map((task) => task.plannedAhead)).toEqual([false, true, true]);
        // Un-previewed, so drawn again as quiet context.
        expect(tasks[0].render).toHaveBeenCalledTimes(2);
    });

    it('clears everything when there is no plan', () => {
        const task = makeTask(1);
        ahead = [{ task, step: step(1, true) }];
        layer.refresh();

        ahead = [];
        layer.refresh();

        expect(task.plannedAhead).toBe(false);
        expect(onMap()).toHaveLength(0);
    });
});

describe('MinimapStyle.plannedJump', () => {
    const path = [new FakeLatLng(0, 0), new FakeLatLng(1, 1)];

    it('sits just under the route casing, so a street drawn over its end wins', () => {
        const casing = window.MinimapStyle.routeCasing(path);

        expect(window.MinimapStyle.plannedJump(path).zIndex).toBe(casing.zIndex - 1);
    });

    it('is dots in the route-ahead blue over a white casing, with no chevrons', () => {
        const jump = window.MinimapStyle.plannedJump(path);

        expect(jump.strokeColor).toBe('#ffffff');
        expect(jump.icons).toHaveLength(1);
        expect(jump.icons[0].icon.fillColor).toBe(window.MinimapStyle.remainingColor());
        expect(jump.icons[0].icon.path).not.toBe(window.MinimapStyle.remainingRoute(path).icons[1].icon.path);
    });
});

describe('Task.render for a street of the planned walk', () => {
    let task;

    beforeEach(() => {
        window.turf = turf;
        window.eval(UTIL_MATH_SRC);
        window.eval(`${TASK_SRC}\nwindow.Task = Task;`);
        window.svl = {
            isExploreAddressMode: () => false,
            regionModel: { isRoute: false },
            minimap: { getMap: () => 'the-minimap' },
            taskContainer: { getCurrentTaskStreetEdgeId: () => 99 },
        };
        task = new window.Task({
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: [[-122.33, 47.6], [-122.329, 47.6]] },
            properties: { street_edge_id: 7, priority: 1, task_start: '2026-09-27T12:00:00Z' },
        }, false);
    });

    const pathOf = () => [new FakeLatLng(47.6, -122.33), new FakeLatLng(47.6, -122.329)];

    it('draws a previewed street exactly as a route draws its streets ahead', () => {
        task.setPlannedAhead(true);

        task.render();

        expect(FakePolyline.created.map(({ options }) => options)).toEqual([
            window.MinimapStyle.routeCasing(pathOf()),
            window.MinimapStyle.remainingRoute(pathOf()),
        ]);
        expect(FakePolyline.created.every((polyline) => polyline.map === 'the-minimap')).toBe(true);
    });

    it('draws a street beyond the preview as quiet context', () => {
        task.render();

        expect(FakePolyline.created.map(({ options }) => options)).toEqual([window.MinimapStyle.otherTask(pathOf())]);
    });

    it('still draws a completed street as walked, previewed or not', () => {
        task.setPlannedAhead(true);
        task.complete();

        task.render();

        expect(FakePolyline.created.map(({ options }) => options)).toEqual([
            window.MinimapStyle.completedTask(pathOf()),
        ]);
    });
});
