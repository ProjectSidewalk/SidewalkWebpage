/**
 * The whole-route inset on the minimap (frontend/js/explore/navigation/RouteOverview.js, #5840): shown on designated
 * routes only, it fits every street of the route into its canvas, draws walked streets solid and the rest dashed,
 * marks the start and finish, outlines what the minimap shows, and puts a heading wedge where the labeler stands. The
 * canvas is a recorder, so each test reads the geometry and styles sent to it.
 */

import { loadModules } from './loader.js';
import { fakeCanvas, fakePanoManager, fakeTaskContainer, fakeTracker } from './fakes.js';

/** A street as the inset reads it: a LineString, and whether it has been walked (or given up on). */
const street = (coordinates, { complete = false, givenUp = false } = {}) => ({
  getGeoJSON: () => ({ geometry: { coordinates } }),
  isComplete: () => complete,
  wasGivenUpOnImagery: () => givenUp,
});

describe('RouteOverview', () => {
  let RouteOverview;
  let ui;
  let canvas;
  let tasks;
  let endpoints;
  let viewer;
  let minimap;
  let tracker;

  beforeEach(async () => {
    ({ RouteOverview } = await loadModules('frontend/js/explore/navigation/RouteOverview.js'));
    canvas = fakeCanvas(100, 100);
    ui = {
      holder: document.createElement('div'),
      routeOverview: document.createElement('div'),
      routeOverviewCanvas: canvas,
    };
    // A route two streets long: 0.02° east along one latitude, then 0.01° north. At latitude 0 a degree of
    // longitude is as long as one of latitude, so the fitted shape can be checked in plain numbers.
    tasks = [
      street([[0, 0], [0.02, 0]], { complete: true }),
      street([[0.02, 0], [0.02, 0.01]]),
    ];
    endpoints = { start: { lat: 0, lng: 0 }, finish: { lat: 0.01, lng: 0.02 } };
    viewer = {
      position: { lat: 0, lng: 0.01 },
      pov: { heading: 90, pitch: 0, zoom: 1 },
      getPanoId: () => 'pano-a',
      getPosition() { return this.position; },
      getPov() { return this.pov; },
    };
    minimap = {
      isAvailable: () => true,
      getBounds: () => ({ north: 0.005, south: -0.005, east: 0.015, west: 0.005 }),
      toggleOverview: vi.fn(),
    };
    tracker = fakeTracker();
  });

  const build = (isRoute = true) => new RouteOverview(ui, { isRoute }, fakeTaskContainer(() => tasks[0], {
    getTasks: () => tasks,
    getRouteEndpoints: () => endpoints,
  }), fakePanoManager(viewer), minimap, tracker);

  const ctx = () => canvas.ctx;
  const strokes = () => ctx().callsTo('stroke');
  const arcs = () => ctx().callsTo('arc');
  // The route spans 0.02 by 0.01 degrees in a 100 px canvas with 9 px of padding: 82 px across, so 4100 px/degree.
  const SCALE = 4100;
  const px = (lng, lat) => [9 + lng * SCALE, (100 - 0.01 * SCALE) / 2 + (0.01 - lat) * SCALE];
  // The route's shape is scaled by the cosine of its latitude, a hair under 1 even this close to the equator.
  const expectPoint = (actual, expected) => actual.forEach((value, i) => expect(value).toBeCloseTo(expected[i], 6));

  test('off a designated route there is no inset: nothing is revealed, drawn or clickable', () => {
    build(false).render();
    expect(ui.holder.classList.contains('minimap-route-mode')).toBe(false);
    expect(ctx().calls).toEqual([]);
    ui.routeOverview.click();
    expect(minimap.toggleOverview).not.toHaveBeenCalled();
  });

  test('on a route the inset is revealed, and a click fits the minimap to the route', () => {
    build();
    expect(ui.holder.classList.contains('minimap-route-mode')).toBe(true);
    ui.routeOverview.click();
    expect(minimap.toggleOverview).toHaveBeenCalledWith('route-inset');
    expect(tracker.push).toHaveBeenCalledWith('Click_MinimapRouteOverview');
  });

  test('fits the whole route, north up, with room for a dot on its edge', () => {
    build().render();

    const paths = ctx().callsTo('moveTo').map((call) => call.args);
    expectPoint(paths[0], px(0, 0));
    const lines = ctx().callsTo('lineTo').map((call) => call.args);
    expectPoint(lines[0], px(0.02, 0));
    expectPoint(lines[2], px(0.02, 0.01));
    // North is up: the second street's end is higher on the canvas than its start.
    expect(lines[2][1]).toBeLessThan(lines[0][1]);
  });

  test('walked streets are solid in the audited color over a wider casing; streets ahead are dashed', () => {
    tasks.push(street([[0.02, 0.01], [0.01, 0.01]], { givenUp: true }));
    build().render();

    // Per street: the white casing, then the colored line.
    const lineStrokes = strokes().slice(0, 6);
    expect(lineStrokes.map((call) => call.lineWidth)).toEqual([5, 3, 4.5, 2.5, 5, 3]);
    expect(lineStrokes[1].strokeStyle).toBe('#60A189');
    expect(lineStrokes[3].strokeStyle).toBe('#95BFEA');
    expect(lineStrokes[5].strokeStyle).toBe('#60A189');
    const dashes = ctx().callsTo('setLineDash').map((call) => call.args[0]);
    expect(dashes).toEqual([[], [], [], [3, 3], [], [], []]);
  });

  test('a street with a single point is skipped, since it has no line to draw', () => {
    const overview = build();
    overview.render();
    const traced = ctx().callsTo('moveTo').length;

    tasks.push(street([[0.02, 0.01]]));
    canvas.ctx.calls.length = 0;
    overview.render();
    expect(ctx().callsTo('moveTo')).toHaveLength(traced);
  });

  test('marks the finish and then the start, so the start wins where a loop\'s ends meet', () => {
    build().render();

    const dots = arcs().filter((call) => call.args[2] === 4);
    expect(dots).toHaveLength(2);
    expectPoint(dots[0].args.slice(0, 2), px(0.02, 0.01));
    expectPoint(dots[1].args.slice(0, 2), px(0, 0));
    const fills = ctx().callsTo('fill');
    expect(fills.map((call) => call.fillStyle)).toContain('#ED1C24');
    expect(fills.map((call) => call.fillStyle)).toContain('#11C961');
  });

  test('without known endpoints the dots are left off', () => {
    endpoints = null;
    build().render();
    expect(arcs().filter((call) => call.args[2] === 4)).toEqual([]);
  });

  test('outlines what the minimap shows, unless there is no map', () => {
    build().render();
    const [box] = ctx().callsTo('strokeRect');
    const [x1, y1] = px(0.005, 0.005);
    const [x2, y2] = px(0.015, -0.005);
    expectPoint(box.args, [x1, y1, x2 - x1, y2 - y1]);

    canvas.ctx.calls.length = 0;
    minimap.isAvailable = () => false;
    build().render();
    expect(ctx().callsTo('strokeRect')).toEqual([]);
  });

  test('puts a heading wedge and dot where the labeler stands, facing the way they look', () => {
    build().render();

    expectPoint(ctx().callsTo('translate')[0].args, px(0.01, 0));
    expect(ctx().callsTo('rotate')[0].args).toEqual([Math.PI / 2]);
    const dot = arcs().filter((call) => call.args[2] === 3);
    expectPoint(dot[0].args.slice(0, 2), px(0.01, 0));
    expect(ctx().callsTo('fill').at(-1).fillStyle).toBe('#3E8BD9');
  });

  test('before the view has a heading the wedge points north, and with no position there is no marker', () => {
    viewer.pov = null;
    build().render();
    expect(ctx().callsTo('rotate')[0].args).toEqual([0]);

    canvas.ctx.calls.length = 0;
    viewer.position = null;
    build().render();
    expect(ctx().callsTo('translate')).toEqual([]);
  });

  test('draws nothing while there are no streets, no size, or no geometry', () => {
    const overview = build();
    tasks = [];
    overview.render();
    tasks = null;
    overview.render();
    tasks = [street([[0, 0], [0.02, 0]])];
    canvas.clientWidth = 0;
    overview.render();
    expect(ctx().calls).toEqual([]);

    canvas.clientWidth = 100;
    tasks = [street([])];
    overview.render();
    expect(ctx().callsTo('clearRect')).toHaveLength(1);
    expect(ctx().callsTo('moveTo')).toEqual([]);
  });

  test('the bitmap is sized to the inset at the device pixel ratio, capped at 2, and only when it changes', () => {
    vi.stubGlobal('devicePixelRatio', 3);
    let width = 0;
    const widthWrites = vi.fn();
    Object.defineProperty(canvas, 'width', { get: () => width, set: (value) => { width = value; widthWrites(); } });
    const overview = build();
    overview.render();
    expect([canvas.width, canvas.height]).toEqual([200, 200]);
    expect(ctx().callsTo('setTransform')[0].args).toEqual([2, 0, 0, 2, 0, 0]);

    // Setting a canvas's size wipes it, so an unchanged size is not set again.
    overview.render();
    expect(widthWrites).toHaveBeenCalledTimes(1);
    canvas.clientWidth = 120;
    overview.render();
    expect(canvas.width).toBe(240);

    vi.stubGlobal('devicePixelRatio', 0);
    overview.render();
    expect(canvas.width).toBe(120);
  });

  test('a route along a single point still fits without dividing by zero', () => {
    tasks = [street([[0.01, 0.01], [0.01, 0.01]])];
    endpoints = null;
    build().render();
    expect(ctx().callsTo('moveTo')[0].args.every(Number.isFinite)).toBe(true);
  });
});
