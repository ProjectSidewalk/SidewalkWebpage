/**
 * The minimap preview of a neighborhood mission's planned walk (#5526): which of the streets ahead are drawn as the
 * route ahead, the dashed connector drawn wherever Explore will jump, the legend's plan mode, and that a previewed
 * street is drawn exactly as a route's street ahead is.
 *
 * WalkPlanLayer, MinimapStyle and Task are top-level `class` declarations for the Grunt-concatenation world, so the
 * sources are eval'd into the jsdom global scope, with a Google Maps fake that records each polyline's options. Real
 * vendored turf: whether a gap is a jump is a distance question on real coordinates.
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

const ORIGIN = [-122.33, 47.6];

/** The point `eastM` east and `northM` north of ORIGIN, as {lat, lng}. */
function pt(eastM, northM = 0) {
    const north = turf.destination(turf.point(ORIGIN), northM / 1000, 0).geometry.coordinates;
    const [lng, lat] = turf.destination(turf.point(north), eastM / 1000, 90).geometry.coordinates;
    return { lat, lng };
}

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
const ends = (connector) => connector.options.path.map(({ lat, lng }) => ({ lat, lng }));

/**
 * A planned street, as WalkPlanLayer sees it: a length, its two ends, how far it has been walked, and the preview flag.
 * @param {number} id - Street id; by default also places the street, `id` km east, so every gap is a jump.
 * @param {object} [options] - `lengthM`, `start` and `end` ({lat, lng}), `walkedM`, and `resumedAt` ({lat, lng}) for
 *     a part-walked street.
 */
function makeTask(id, { lengthM = 100, start = pt(id * 1000), end = pt(id * 1000 + lengthM), walkedM = 0,
    resumedAt = null } = {}) {
    return {
        id,
        plannedAhead: false,
        lineDistance: () => lengthM,
        getAuditedDistance: () => walkedM,
        getStartCoordinate: () => start,
        getEndCoordinate: () => end,
        isResumed: () => resumedAt !== null,
        getFurthestPointReached: () => turf.point(resumedAt ? [resumedAt.lng, resumedAt.lat] : [start.lng, start.lat]),
        setPlannedAhead: jest.fn(function (value) {
            this.plannedAhead = value;
        }),
        render: jest.fn(),
    };
}

const step = (id, jump = false) => ({ id, reverse: false, jump, jumpM: jump ? 300 : 0 });

beforeEach(() => {
    FakePolyline.created = [];
    window.turf = turf;
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
    let holder;
    let taskContainer;

    beforeEach(() => {
        current = makeTask(0, { start: pt(-100), end: pt(0) });
        ahead = [];
        mission = { getDistance: () => 0, getProperty: () => 0 };
        holder = document.createElement('div');
        window.svl = {
            CONNECTED_TASK_THRESHOLD: 0.025,
            isExploreAddressMode: () => false,
            minimap: { getMap: () => 'the-minimap' },
            missionContainer: { getCurrentMission: () => mission },
            ui: { minimap: { holder } },
        };
        taskContainer = {
            getCurrentTask: () => current,
            getPlannedStepsAhead: (limit) => ahead.slice(0, limit),
            hasWalkPlan: () => ahead.length > 0,
            refreshWalkPlanPreview: jest.fn(() => layer.refresh()),
        };
        layer = new window.WalkPlanLayer(taskContainer);
    });

    it('previews the streets within the horizon as the route ahead, and leaves the rest alone', () => {
        const tasks = [1, 2, 3, 4].map((id) => makeTask(id));
        ahead = tasks.map((task) => ({ task, step: step(task.id) }));

        layer.refresh();

        expect(tasks.map((task) => task.plannedAhead)).toEqual([true, true, true, false]);
        expect(tasks.slice(0, 3).every((task) => task.render.mock.calls.length === 1)).toBe(true);
        expect(tasks[3].render).not.toHaveBeenCalled();
        expect(layer.getPreviewedTasks()).toEqual(tasks.slice(0, 3));
    });

    it('reaches as far as the mission goes past the current street', () => {
        // 550 m left in the mission, all 100 m of the current street still to walk: 450 m for the streets ahead.
        mission = { getDistance: () => 1000, getProperty: () => 450 };
        const tasks = [1, 2, 3, 4, 5, 6, 7].map((id) => makeTask(id));
        ahead = tasks.map((task) => ({ task, step: step(task.id) }));

        layer.refresh();

        expect(tasks.filter((task) => task.plannedAhead)).toHaveLength(5);
    });

    it('counts only the unwalked part of the current street against the mission', () => {
        mission = { getDistance: () => 1000, getProperty: () => 450 };
        current = makeTask(0, { lengthM: 300, start: pt(-300), end: pt(0), walkedM: 250 });
        const tasks = [1, 2, 3, 4, 5, 6, 7].map((id) => makeTask(id));
        ahead = tasks.map((task) => ({ task, step: step(task.id) }));

        layer.refresh();

        // 550 m left, 50 m of it on the current street.
        expect(tasks.filter((task) => task.plannedAhead)).toHaveLength(5);
        current = makeTask(0, { lengthM: 300, start: pt(-300), end: pt(0), walkedM: 0 });
        layer.refresh();
        expect(tasks.filter((task) => task.plannedAhead)).toHaveLength(3);
    });

    it('draws a connector wherever Explore will jump, from the street before to the jumped-to street', () => {
        const tasks = [
            makeTask(1, { lengthM: 50, start: pt(0, 300), end: pt(50, 300) }), // 300 m from the current street.
            makeTask(2, { lengthM: 50, start: pt(50, 300), end: pt(100, 300) }), // Continues street 1.
            makeTask(3, { lengthM: 50, start: pt(100, 315), end: pt(150, 315) }), // 15 m: switched seamlessly.
            makeTask(4, { lengthM: 50, start: pt(250, 315), end: pt(300, 315) }), // 100 m on.
        ];
        ahead = tasks.map((task) => ({ task, step: step(task.id, task.id !== 2) }));

        layer.refresh();

        const connectors = onMap();
        expect(connectors.map(ends)).toEqual([[pt(0), pt(0, 300)], [pt(150, 315), pt(250, 315)]]);
        expect(connectors.every((connector) => connector.map === 'the-minimap')).toBe(true);
        expect(connectors[0].options).toEqual(window.MinimapStyle.plannedJump(connectors[0].options.path));
    });

    it('lands a connector where a part-walked street was left, not at its start (#5370)', () => {
        const resumedAt = pt(30, 300);
        const task = makeTask(1, { start: pt(0, 300), end: pt(100, 300), resumedAt });
        ahead = [{ task, step: step(1, true) }];

        layer.refresh();

        expect(onMap().map(ends)).toEqual([[pt(0), resumedAt]]);
    });

    it('draws no connector for a jump beyond the horizon', () => {
        const tasks = [
            makeTask(1, { start: pt(0), end: pt(100) }),
            makeTask(2, { start: pt(100), end: pt(200) }),
            makeTask(3, { start: pt(200), end: pt(300) }),
            makeTask(4, { start: pt(0, 500), end: pt(100, 500) }),
        ];
        ahead = tasks.map((task) => ({ task, step: step(task.id, task.id === 4) }));

        layer.refresh();

        expect(tasks[3].plannedAhead).toBe(false);
        expect(onMap()).toHaveLength(0);
    });

    it('takes down what it drew once the plan moves on, and redraws what it un-previews', () => {
        const tasks = [
            makeTask(1, { lengthM: 200, start: pt(0, 300), end: pt(200, 300) }),
            makeTask(2, { lengthM: 200, start: pt(200, 300), end: pt(400, 300) }),
            makeTask(3, { lengthM: 200, start: pt(400, 300), end: pt(600, 300) }),
        ];
        ahead = [{ task: tasks[0], step: step(1, true) }, { task: tasks[1], step: step(2) }];
        layer.refresh();
        const [firstConnector] = onMap();

        [current] = tasks;
        ahead = [{ task: tasks[1], step: step(2) }, { task: tasks[2], step: step(3) }];
        layer.refresh();

        expect(firstConnector.map).toBeNull();
        expect(onMap()).toHaveLength(0);
        expect(tasks.map((task) => task.plannedAhead)).toEqual([false, true, true]);
        // Un-previewed, so drawn again as quiet context.
        expect(tasks[0].render).toHaveBeenCalledTimes(2);
    });

    it('shows the legend\'s jump row only while there is a plan', () => {
        const task = makeTask(1);
        ahead = [{ task, step: step(1, true) }];
        layer.refresh();

        expect(holder.classList.contains('minimap-plan-mode')).toBe(true);

        ahead = [];
        layer.refresh();

        expect(holder.classList.contains('minimap-plan-mode')).toBe(false);
    });

    it('clears everything when there is no plan', () => {
        const task = makeTask(1);
        ahead = [{ task, step: step(1, true) }];
        layer.refresh();

        ahead = [];
        layer.refresh();

        expect(task.plannedAhead).toBe(false);
        expect(onMap()).toHaveLength(0);
        expect(layer.getPreviewedTasks()).toEqual([]);
    });

    it('redraws when a new mission starts, since the horizon is measured against it', () => {
        const listeners = {};
        const missionContainer = { on: (name, callback) => { listeners[name] = callback; } };
        layer.watchMissions(missionContainer);
        const tasks = [1, 2, 3, 4, 5, 6, 7].map((id) => makeTask(id));
        ahead = tasks.map((task) => ({ task, step: step(task.id) }));
        layer.refresh();
        expect(tasks.filter((task) => task.plannedAhead)).toHaveLength(3);

        // The next mission is fresh: 600 m to go, of which the current street's 100 m come first.
        mission = { getDistance: () => 600, getProperty: () => 0 };
        listeners['MissionContainer:missionLoaded']();

        // Through the guarded refresh, so a render error cannot escape into mission loading.
        expect(taskContainer.refreshWalkPlanPreview).toHaveBeenCalled();
        expect(tasks.filter((task) => task.plannedAhead)).toHaveLength(5);
    });
});

describe('MinimapStyle.plannedJump', () => {
    const path = [new FakeLatLng(0, 0), new FakeLatLng(1, 1)];

    it('sits just under the route casing, so a street drawn over its end wins', () => {
        const casing = window.MinimapStyle.routeCasing(path);

        expect(window.MinimapStyle.plannedJump(path).zIndex).toBe(casing.zIndex - 1);
    });

    it('is a thin dashed hairline in the deep link blue, with no discs, and does nothing when clicked', () => {
        const jump = window.MinimapStyle.plannedJump(path);

        expect(jump.clickable).toBe(false);
        expect(jump.strokeOpacity).toBe(0);
        expect(jump.icons).toHaveLength(1);
        const { icon } = jump.icons[0];
        // A filled disc on this map means a pano to step to; the connector must not borrow it.
        expect(icon.fillOpacity ?? 0).toBe(0);
        expect(icon.path).toBe('M 0,-1 0,1');
        expect(icon.strokeColor).toBe(window.MinimapStyle.chevronOutlineColor());
        expect(icon.strokeWeight).toBeLessThan(window.MinimapStyle.remainingRoute(path).icons[0].icon.strokeWeight);
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
