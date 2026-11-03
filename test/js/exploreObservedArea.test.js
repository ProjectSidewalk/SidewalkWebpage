/**
 * What the minimap shows of where the user has looked (frontend/js/explore/navigation/ObservedArea.js, #5840): the fog
 * that opens as the view sweeps a pano, the cone of the current view, the ring that fills toward a full turn, the
 * breadcrumb trail back to visited panos, and the first-run coach mark with its one-time celebration. The canvases
 * are recorders, since jsdom draws nothing; what each test reads is the geometry and styles sent to them.
 */

import { loadModules, mockModule } from './loader.js';
import { fakeCanvas, fakePanoManager, fakeStorage, fakeTracker } from './fakes.js';

mockModule('i18next', () => ({ default: { t: (key) => key } }));

const BASE_SIZE = 200;
const toRadians = (degrees) => degrees / 180 * Math.PI;
// MinimapStyle's fallbacks, since there is no main.css here: the fog's neutral, and the audited pine the cone shares.
const FOG_COLOR = '#6B6B6B';
const CONE_RGB = '96, 161, 137';

describe('ObservedArea', () => {
  let ObservedArea;
  let ui;
  let viewer;
  let fov;
  let settling;
  let available;
  let listeners;
  let storage;
  let tracker;
  let peg;
  let routeOverview;
  let navigationService;
  let markers;
  let config;

  /** The minimap's elements, with the canvases as recorders and the holder carrying the base size the CSS defines. */
  function buildUi() {
    const holder = document.createElement('div');
    holder.style.setProperty('--minimap-base-size', `${BASE_SIZE}px`);
    document.body.appendChild(holder);
    const coach = document.createElement('div');
    coach.className = 'minimap-coach-hidden';
    return {
      holder,
      fogOfWar: fakeCanvas(),
      fov: fakeCanvas(),
      progressCircle: fakeCanvas(),
      coach,
      coachDismiss: document.createElement('button'),
      percentObserved: document.createElement('span'),
    };
  }

  /**
   * @param {object} [options]
   * @param {boolean} [options.isRoute] - Whether a route inset takes the ring's usual corner.
   * @returns {object} An ObservedArea over the fakes.
   */
  function build({ isRoute = false } = {}) {
    const minimap = {
      onMove: (listener) => { listeners.move = listener; },
      isAvailable: () => available,
      getZoom: () => 17,
      // A fixed mapping, so a pano's position is readable straight off the drawing calls.
      project: ({ lat, lng }) => ({ x: lng, y: lat }),
      addMarker: vi.fn((latLng, content, options) => {
        const marker = { latLng, content, options, remove: vi.fn() };
        markers.push(marker);
        return marker;
      }),
    };
    const panoManager = fakePanoManager(viewer, {
      onPovChanged: (listener) => { listeners.povChanged = listener; },
    });
    navigationService = {
      isHeadingSettling: () => settling,
      onHeadingSettled: (listener) => { listeners.headingSettled = listener; },
      returnToPano: vi.fn(),
    };
    return new ObservedArea(ui, config, storage, { renderedHFov: () => fov }, panoManager, minimap, peg,
      routeOverview, navigationService, { isRoute }, tracker);
  }

  /** Stands the user on a pano and looks a given way, as a move and the first pov reading do. */
  const standAt = (area, panoId, position, heading = 0) => {
    viewer.panoId = panoId;
    viewer.position = position;
    viewer.heading = heading;
    area.panoChanged();
    area.update();
  };

  /** Turns the view, as panning the pano does. */
  const lookAt = (area, heading) => {
    viewer.heading = heading;
    listeners.povChanged();
  };

  const percent = () => ui.percentObserved.textContent;
  const tracked = (eventName) => tracker.push.mock.calls.filter(([name]) => name === eventName);
  const fogArcs = () => ui.fogOfWar.ctx.callsTo('arc');
  const ringArcs = () => ui.progressCircle.ctx.callsTo('arc');

  beforeEach(async () => {
    ({ ObservedArea } = await loadModules('frontend/js/explore/navigation/ObservedArea.js'));
    document.body.innerHTML = '';
    ui = buildUi();
    viewer = {
      panoId: 'pano-a',
      position: { lat: 100, lng: 100 },
      heading: 0,
      getPanoId() { return this.panoId; },
      getPosition() { return this.position; },
      getPov() { return { heading: this.heading, pitch: 0, zoom: 1 }; },
    };
    fov = 90;
    settling = false;
    available = true;
    listeners = {};
    markers = [];
    storage = fakeStorage();
    tracker = fakeTracker();
    peg = { setHeading: vi.fn() };
    routeOverview = { render: vi.fn() };
    config = { isOnboarding: false, userHasCompletedAMission: false };
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
  });

  describe('canvas sizing', () => {
    test('the bitmaps match the displayed size in device pixels, while drawing stays in CSS px', () => {
      vi.stubGlobal('devicePixelRatio', 2);
      build();

      for (const canvas of [ui.fogOfWar, ui.fov, ui.progressCircle]) {
        expect([canvas.width, canvas.height]).toEqual([400, 400]);
        expect(canvas.ctx.callsTo('setTransform').at(-1).args).toEqual([2, 0, 0, 2, 0, 0]);
      }
      expect(ui.fogOfWar.ctx.fillStyle).toBe(FOG_COLOR);
      expect(ui.fogOfWar.ctx.filter).toBe('blur(2px)');
      expect(ui.progressCircle.ctx.lineCap).toBe('round');
    });

    test('before the minimap is laid out the base size stands in for the displayed one, at 1x', () => {
      vi.stubGlobal('devicePixelRatio', 0);
      ui.fogOfWar = fakeCanvas(0, 0);
      build();
      expect([ui.fogOfWar.width, ui.fogOfWar.height]).toEqual([BASE_SIZE, BASE_SIZE]);
      expect(ui.fov.ctx.callsTo('setTransform').at(-1).args).toEqual([1, 0, 0, 1, 0, 0]);
    });

    test('a bigger UI scale resizes the bitmaps on the next redraw and scales the drawing with them', () => {
      const area = build();
      ui.fogOfWar.clientWidth = 300;
      ui.fogOfWar.clientHeight = 300;

      standAt(area, 'pano-a', { lat: 100, lng: 100 });

      expect([ui.fogOfWar.width, ui.fov.width, ui.progressCircle.width]).toEqual([300, 300, 300]);
      expect(ui.fogOfWar.ctx.filter).toBe('blur(3px)');
      // The hole kept clear around the peg grows with the scale, as the peg itself does.
      expect(fogArcs().at(-1).args[2]).toBe(12);
    });
  });

  describe('fog, cone and ring', () => {
    test('nothing is drawn before the first pano is known, but the route inset still redraws', () => {
      const area = build();
      area.update();
      expect(ui.fogOfWar.ctx.callsTo('fillRect')).toEqual([]);
      expect(ringArcs()).toEqual([]);
      expect(routeOverview.render).toHaveBeenCalledTimes(1);
    });

    test('the first look opens a wedge as wide as the rendered view, and the ring shows its share of a turn', () => {
      const area = build();
      standAt(area, 'pano-a', { lat: 100, lng: 100 }, 0);

      // The fog covers the map, then the wedge seen so far is cut out of it, and the peg is always kept clear.
      const fog = ui.fogOfWar.ctx;
      expect(fog.callsTo('fillRect')[0]).toMatchObject({ args: [0, 0, 200, 200], op: 'source-over' });
      const [wedge, pegHole] = fogArcs();
      expect(wedge).toMatchObject({
        args: [100, 100, 40, toRadians(-45 - 90), toRadians(45 - 90)],
        op: 'destination-out',
      });
      expect(fog.callsTo('moveTo')).toHaveLength(1);
      expect(pegHole).toMatchObject({ args: [100, 100, 8, 0, 2 * Math.PI], op: 'destination-out' });
      expect(fog.globalCompositeOperation).toBe('source-over');

      // The cone fades out from the peg to the fog's radius in the audited hue.
      const [gradient] = ui.fov.ctx.gradients;
      expect(gradient.args).toEqual([100, 100, 4, 100, 100, 40]);
      expect(gradient.stops).toEqual([[0, `rgba(${CONE_RGB}, 0.55)`], [1, `rgba(${CONE_RGB}, 0)`]]);
      expect(ui.fov.ctx.callsTo('arc')[0].args).toEqual([100, 100, 40, toRadians(-135), toRadians(-45)]);

      expect(area.getFractionObserved()).toBe(0.25);
      expect(percent()).toBe('25%');
      expect(ringArcs().at(-1)).toMatchObject({ args: [182, 18, 12, toRadians(-90), toRadians(90 - 90)] });
      expect(peg.setHeading).toHaveBeenCalledWith(0);
    });

    test('turning all the way round fills the ring, in the success color, and clears the fog in a full circle', () => {
      const area = build();
      standAt(area, 'pano-a', { lat: 100, lng: 100 }, 0);
      for (const heading of [90, 180]) lookAt(area, heading);
      expect(percent()).toBe('75%');
      expect(ui.percentObserved.classList.contains('minimap-percent-full')).toBe(false);

      ui.fogOfWar.ctx.calls.length = 0;
      lookAt(area, 270);

      expect(area.getFractionObserved()).toBe(1);
      expect(percent()).toBe('100%');
      expect(ui.percentObserved.classList.contains('minimap-percent-full')).toBe(true);
      expect(ringArcs().at(-1)).toMatchObject({
        strokeStyle: '#11C961',
        args: [182, 18, 12, toRadians(-90), toRadians(270)],
      });
      // A fully seen pano is a disc, not a pie wedge from its center.
      expect(ui.fogOfWar.ctx.callsTo('moveTo')).toEqual([]);
    });

    test('the peg turns the short way across north, whichever way it crosses', () => {
      const area = build();
      standAt(area, 'pano-a', { lat: 100, lng: 100 }, 350);
      lookAt(area, 10);
      expect(peg.setHeading).toHaveBeenLastCalledWith(370);

      standAt(area, 'pano-b', { lat: 120, lng: 100 }, 10);
      lookAt(area, 350);
      expect(peg.setHeading).toHaveBeenLastCalledWith(-10);
    });

    test('an edge of the view that lands exactly on north still counts as seen', () => {
      const area = build();
      // Facing 45° with a 90° view: the left edge is at 0 exactly.
      standAt(area, 'pano-a', { lat: 100, lng: 100 }, 45);
      lookAt(area, 90);
      expect(area.getFractionObserved()).toBe(135 / 360);
    });

    test('with nothing rendered across the frame the ring stays an empty track', () => {
      fov = 0;
      const area = build();
      standAt(area, 'pano-a', { lat: 100, lng: 100 });
      expect(percent()).toBe('0%');
      // The chip's disc and the faint track only; no progress arc.
      expect(ringArcs()).toHaveLength(2);
    });

    test('a new pano starts its own count, and coming back to one continues where it left off', () => {
      const area = build();
      standAt(area, 'pano-a', { lat: 100, lng: 100 }, 0);
      lookAt(area, 90);
      expect(percent()).toBe('50%');

      standAt(area, 'pano-b', { lat: 120, lng: 100 }, 0);
      expect(percent()).toBe('25%');
      expect(area.hasVisited('pano-a')).toBe(true);
      expect(area.hasVisited('pano-c')).toBe(false);

      ui.fogOfWar.ctx.calls.length = 0;
      standAt(area, 'pano-a', { lat: 100, lng: 100 }, 0);
      expect(percent()).toBe('50%');
      // Both panos' wedges are cut from the fog, each at its own position.
      expect(fogArcs().slice(0, 2).map((call) => call.args.slice(0, 2))).toEqual([[100, 100], [100, 120]]);
    });

    test('forgetting the current pano restarts the fog and ring from the current view', () => {
      const area = build();
      standAt(area, 'pano-a', { lat: 100, lng: 100 }, 0);
      lookAt(area, 200);
      expect(percent()).toBe('80%');

      area.resetCurrentPano();

      expect(area.getFractionObserved()).toBe(0.25);
      expect(percent()).toBe('25%');
    });

    test('while the heading settles after a move the cone holds its pre-move angles', () => {
      const area = build();
      standAt(area, 'pano-a', { lat: 100, lng: 100 }, 0);
      routeOverview.render.mockClear();

      settling = true;
      lookAt(area, 90);
      expect(routeOverview.render).not.toHaveBeenCalled();
      area.update();
      expect(area.getFractionObserved()).toBe(0.25);
      expect(peg.setHeading).toHaveBeenLastCalledWith(0);

      // Landed on a new pano with the heading still settling: nothing is known of the view there yet, so the peg
      // keeps its last heading rather than being turned to a null.
      viewer.panoId = 'pano-b';
      viewer.position = { lat: 120, lng: 100 };
      area.panoChanged();
      peg.setHeading.mockClear();
      area.update();
      expect(peg.setHeading).not.toHaveBeenCalled();

      // Settled: the new pano is recorded, and the view is read again.
      settling = false;
      listeners.headingSettled();
      expect(area.hasVisited('pano-b')).toBe(true);
      expect(peg.setHeading).toHaveBeenLastCalledWith(90);
    });

    test('a map move redraws the overlays where the map now puts the pano', () => {
      const area = build();
      standAt(area, 'pano-a', { lat: 100, lng: 100 });
      ui.fogOfWar.ctx.calls.length = 0;
      listeners.move();
      expect(ui.fogOfWar.ctx.callsTo('fillRect')).toHaveLength(1);
    });

    test('with no map to draw on, the ring and percentage still update', () => {
      available = false;
      const area = build();
      standAt(area, 'pano-a', { lat: 100, lng: 100 });
      expect(ui.fogOfWar.ctx.calls.filter((call) => call.method !== 'setTransform')).toEqual([]);
      expect(ui.fov.ctx.gradients).toEqual([]);
      expect(ringArcs()).toHaveLength(3);
      expect(percent()).toBe('25%');
    });

    test('on a route the ring tucks under the mission bar, leaving the corner to the route inset', () => {
      const area = build({ isRoute: true });
      standAt(area, 'pano-a', { lat: 100, lng: 100 });
      expect(ringArcs()[0].args.slice(0, 2)).toEqual([18, 42]);
    });
  });

  describe('breadcrumbs', () => {
    test('every pano stood on but the current one gets a crumb that leads back to it', () => {
      const area = build();
      standAt(area, 'pano-a', { lat: 100, lng: 100 });
      expect(markers).toHaveLength(0);

      standAt(area, 'pano-b', { lat: 120, lng: 100 });
      expect(markers).toHaveLength(1);
      const [crumb] = markers;
      expect(crumb.latLng).toEqual({ lat: 100, lng: 100 });
      expect(crumb.content.className).toBe('minimap-breadcrumb');
      expect(crumb.options.title).toBe('audit:right-ui.minimap.breadcrumb-title');

      crumb.options.onClick();
      expect(tracked('Click_MinimapBreadcrumb')).toEqual([['Click_MinimapBreadcrumb', { panoId: 'pano-a' }]]);
      expect(navigationService.returnToPano).toHaveBeenCalledWith('pano-a');
    });

    test('going back swaps which pano carries the crumb, leaving the others\' crumbs as they are', () => {
      const area = build();
      standAt(area, 'pano-a', { lat: 100, lng: 100 });
      standAt(area, 'pano-b', { lat: 120, lng: 100 });
      standAt(area, 'pano-c', { lat: 140, lng: 100 });
      expect(markers.map((marker) => marker.latLng.lat)).toEqual([100, 120]);

      standAt(area, 'pano-a', { lat: 100, lng: 100 });

      expect(markers[0].remove).toHaveBeenCalledTimes(1);
      expect(markers[1].remove).not.toHaveBeenCalled();
      expect(markers.map((marker) => marker.latLng.lat)).toEqual([100, 120, 140]);
    });
  });

  describe('coach mark', () => {
    const coachShown = () => !ui.coach.classList.contains('minimap-coach-hidden');

    test('shows once there is something to look at, and only once', () => {
      const area = build();
      expect(coachShown()).toBe(false);
      standAt(area, 'pano-a', { lat: 100, lng: 100 });
      expect(coachShown()).toBe(true);
      lookAt(area, 30);
      expect(tracked('MinimapCoach_Shown')).toHaveLength(1);
    });

    test('got it dismisses it for good', () => {
      const area = build();
      standAt(area, 'pano-a', { lat: 100, lng: 100 });

      ui.coachDismiss.click();
      expect(coachShown()).toBe(false);
      expect(storage.get('minimapCoachDismissed')).toBe(true);
      ui.coachDismiss.click();
      expect(tracked('Click_MinimapCoach_GotIt')).toHaveLength(1);

      lookAt(area, 30);
      expect(coachShown()).toBe(false);
      ui = buildUi();
      standAt(build(), 'pano-a', { lat: 100, lng: 100 });
      expect(coachShown()).toBe(false);
    });

    test('a user with a finished mission is not taught again, and is remembered as such', () => {
      config.userHasCompletedAMission = true;
      standAt(build(), 'pano-a', { lat: 100, lng: 100 });
      expect(coachShown()).toBe(false);
      expect(storage.get('minimapCoachDismissed')).toBe(true);
      expect(tracked('MinimapCoach_Shown')).toEqual([]);
    });

    test('the tutorial teaches the minimap itself', () => {
      config.isOnboarding = true;
      standAt(build(), 'pano-a', { lat: 100, lng: 100 });
      expect(coachShown()).toBe(false);
      expect(storage.get('minimapCoachDismissed')).toBeNull();
    });

    test('a full turn dismisses it by itself', () => {
      const area = build();
      standAt(area, 'pano-a', { lat: 100, lng: 100 }, 0);
      for (const heading of [90, 180, 270, 0]) lookAt(area, heading);
      expect(coachShown()).toBe(false);
      expect(tracked('MinimapCoach_AutoDismissed')).toHaveLength(1);
      expect(storage.get('minimapCoachDismissed')).toBe(true);
    });
  });

  describe('the first full turn', () => {
    let frames;

    beforeEach(() => {
      frames = [];
      vi.stubGlobal('requestAnimationFrame', (callback) => frames.push(callback));
      vi.spyOn(performance, 'now').mockReturnValue(0);
    });

    const fullTurn = (area) => {
      for (const heading of [90, 180, 270, 0]) lookAt(area, heading);
    };

    test('is celebrated once, with a pulse that fades out over the ring', () => {
      const area = build();
      standAt(area, 'pano-a', { lat: 100, lng: 100 }, 0);
      fullTurn(area);

      expect(storage.get('minimap360Celebrated')).toBe(true);
      expect(tracked('Minimap360Celebration_Shown')).toHaveLength(1);
      expect(frames).toHaveLength(1);

      ui.progressCircle.ctx.calls.length = 0;
      frames.shift()(400);
      // The ring is redrawn under the pulse, which is halfway out and half faded.
      expect(ringArcs()).toHaveLength(4);
      expect(ringArcs().at(-1)).toMatchObject({
        args: [182, 18, 22.5, 0, 2 * Math.PI],
        strokeStyle: `rgba(${CONE_RGB}, 0.4)`,
      });
      expect(frames).toHaveLength(1);

      ui.progressCircle.ctx.calls.length = 0;
      frames.shift()(800);
      expect(ringArcs()).toHaveLength(3);
      expect(frames).toHaveLength(0);

      // One celebration per user: a full turn at the next pano passes without one.
      standAt(area, 'pano-b', { lat: 120, lng: 100 }, 0);
      fullTurn(area);
      expect(tracked('Minimap360Celebration_Shown')).toHaveLength(1);
      expect(frames).toHaveLength(0);
    });

    test('is noted but not animated when the user prefers reduced motion', () => {
      vi.stubGlobal('matchMedia', () => ({ matches: true }));
      const area = build();
      standAt(area, 'pano-a', { lat: 100, lng: 100 }, 0);
      fullTurn(area);

      expect(storage.get('minimap360Celebrated')).toBe(true);
      expect(tracked('Minimap360Celebration_Shown')).toHaveLength(1);
      expect(frames).toHaveLength(0);
    });
  });
});
