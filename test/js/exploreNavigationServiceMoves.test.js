/**
 * The moves NavigationService makes outside the street sweep (frontend/js/explore/navigation/NavigationService.js,
 * #5840): to a linked pano, to a named pano, to whatever is nearest a location, and back to a visited one; what each
 * announces and in what order; how the heading views wait for the heading to settle after a landing; and how a move
 * that fails hands the controls back. navigationServiceNoImagery.test.js covers the sweep and moves through it.
 */

import { loadModules, mockModule } from './loader.js';
import { fakeGate, fakePanoManager } from './fakes.js';

mockModule('i18next', () => ({ default: { t: (key) => key } }));

const resetFlagGuard = vi.fn();
mockModule('frontend/js/explore/panorama/NoImageryFlagGuard.js',
  () => ({ NoImageryFlagGuard: { reset: resetFlagGuard } }));

describe('NavigationService', () => {
  let nav;
  let viewer;
  let panoManager;
  let panoStore;
  let streetSweep;
  let navArrows;
  let keyboardLock;
  let alertController;
  let markerClick;
  let mode;

  beforeEach(async () => {
    vi.useFakeTimers();
    const { NavigationService } = await loadModules('frontend/js/explore/navigation/NavigationService.js');
    viewer = {
      panoId: 'pano-here',
      heading: 0,
      links: [],
      getPanoId() { return this.panoId; },
      getPosition: () => ({ lat: 47.6, lng: -122.3 }),
      getPov() { return { heading: this.heading, pitch: 0, zoom: 1 }; },
      getLinkedPanos() { return this.links; },
    };
    panoManager = fakePanoManager(viewer, {
      panning: fakeGate(),
      setPanorama: vi.fn(() => Promise.resolve()),
      setLocation: vi.fn(() => Promise.resolve()),
      setPov: vi.fn(),
    });
    panoStore = { getPanoData: (panoId) => ({ panoId }) };
    streetSweep = {
      sweep: vi.fn(() => Promise.resolve({ outcome: 'landed', panoId: 'pano-next' })),
      stepAlongStreet: vi.fn(() => Promise.resolve('pano-next')),
    };
    navArrows = { show: vi.fn(), hide: vi.fn(), reset: vi.fn(), streetWalkToward: vi.fn(() => null) };
    keyboardLock = fakeGate();
    alertController = { showAlert: vi.fn() };
    mode = 'Walk';
    const el = () => document.createElement('div');
    nav = new NavigationService({ modeSwitchWalk: el(), viewControlLayer: el(), drawingLayer: el() }, panoStore,
      panoManager, streetSweep, { onMarkerClick: (listener) => { markerClick = listener; } },
      { onModeChanged: vi.fn(), getMode: () => mode, isUsable: () => true, backToWalk: vi.fn() }, navArrows,
      keyboardLock, alertController);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  /** Lets the beat after a landing pass, so the next move is allowed. */
  const letCooldownPass = () => vi.advanceTimersByTime(800);

  describe('announcing a move', () => {
    test('a landing is announced as started, finished, landed and moved, in that order', async () => {
      const order = [];
      nav.onMoveStarted(() => order.push('started'));
      nav.onMoveFinished(() => order.push('finished'));
      nav.onLanded(() => order.push('landed'));
      nav.onMoved(() => order.push('moved'));

      await nav.moveToPano('pano-next');
      expect(order).toEqual(['started', 'finished', 'landed', 'moved']);
    });

    test('a listener taken off hears no more moves', async () => {
      const moved = vi.fn();
      nav.onMoved(moved);
      nav.offMoved(moved);
      await nav.moveToPano('pano-next');
      expect(moved).not.toHaveBeenCalled();
    });

    test('a label\'s minimap marker leads back to its pano, facing the label', async () => {
      const pov = { heading: 120, pitch: -5, zoom: 2 };
      markerClick({ getPanoId: () => 'pano-label', getProperty: () => pov });
      await vi.advanceTimersByTimeAsync(0);
      expect(panoManager.setPanorama).toHaveBeenCalledWith('pano-label');
      expect(panoManager.setPov).toHaveBeenCalledWith(pov);
    });
  });

  describe('after a landing, the heading views wait for the heading to stop moving', () => {
    let settled;

    beforeEach(async () => {
      settled = vi.fn();
      nav.onHeadingSettled(settled);
      await nav.moveToPano('pano-next');
    });

    test('while the viewer still animates the heading, nothing is settled', () => {
      expect(nav.isHeadingSettling()).toBe(true);
      expect(nav.isMoving()).toBe(false);
      for (const heading of [10, 20, 30]) {
        viewer.heading = heading;
        vi.advanceTimersByTime(80);
      }
      expect(settled).not.toHaveBeenCalled();
      expect(nav.isHeadingSettling()).toBe(true);
    });

    test('two quiet polls in a row settle it, with the state idle before the listeners read it', () => {
      let settlingWhenTold;
      settled.mockImplementation(() => { settlingWhenTold = nav.isHeadingSettling(); });
      viewer.heading = 10;
      vi.advanceTimersByTime(80);
      vi.advanceTimersByTime(80);
      expect(settled).not.toHaveBeenCalled();
      vi.advanceTimersByTime(80);
      expect(settled).toHaveBeenCalledTimes(1);
      expect(settlingWhenTold).toBe(false);
    });

    test('a heading that pauses mid-turn and then moves on is settled again where it stops', () => {
      const headings = [];
      settled.mockImplementation(() => headings.push(viewer.heading));
      viewer.heading = 150;
      vi.advanceTimersByTime(240);
      expect(headings).toEqual([150]);

      viewer.heading = 320;
      vi.advanceTimersByTime(240);
      expect(headings).toEqual([150, 320]);

      // Nothing more once it stays put, or after the time limit.
      vi.advanceTimersByTime(3000);
      expect(headings).toEqual([150, 320]);
    });

    test('a heading that only drifts a hair after settling is not settled again', () => {
      viewer.heading = 150;
      vi.advanceTimersByTime(240);
      for (let tick = 0; tick < 12; tick++) {
        viewer.heading += 0.03;
        vi.advanceTimersByTime(80);
      }
      expect(settled).toHaveBeenCalledTimes(1);
    });

    test('a heading that never settles is let go after a second and a half', () => {
      for (let tick = 0; tick < 20; tick++) {
        viewer.heading += 5;
        vi.advanceTimersByTime(80);
      }
      expect(settled).toHaveBeenCalledTimes(1);
      expect(nav.isHeadingSettling()).toBe(false);
    });

    test('a new move takes over the wait, and its own landing restarts it', async () => {
      // Only the tutorial's forced hop can start inside the beat after a landing.
      let land;
      panoManager.setPanorama.mockImplementationOnce(() => new Promise((resolve) => { land = resolve; }));
      const hop = nav.moveToPano('pano-after', true);
      vi.advanceTimersByTime(80);
      expect(settled).not.toHaveBeenCalled();

      land();
      await hop;
      vi.advanceTimersByTime(240);
      expect(settled).toHaveBeenCalledTimes(1);
    });

    test('a landing while the last one\'s heading is still settling restarts the wait once', async () => {
      await nav.moveToPano('pano-after', true);
      vi.advanceTimersByTime(240);
      expect(settled).toHaveBeenCalledTimes(1);
    });
  });

  describe('a step to a linked pano', () => {
    test('goes to the link nearest the heading when one lies within 60°, and nowhere otherwise', async () => {
      viewer.links = [{ panoId: 'pano-north', heading: 0 }, { panoId: 'pano-east', heading: 90 }];
      viewer.heading = 20;

      await expect(nav.moveToLinkedPano(50)).resolves.toBe(true);
      expect(panoManager.setPanorama).toHaveBeenCalledWith('pano-east');

      letCooldownPass();
      await expect(nav.moveToLinkedPano(160)).resolves.toBe(false);
      expect(panoManager.setPanorama).toHaveBeenCalledTimes(1);
    });

    test('is refused while walking is held, without looking at the links', async () => {
      viewer.links = [{ panoId: 'pano-north', heading: 0 }];
      nav.walking.hold('popup');
      await expect(nav.moveToLinkedPano(0)).resolves.toBe(false);
      expect(panoManager.setPanorama).not.toHaveBeenCalled();
    });
  });

  describe('a move to a named pano', () => {
    test('is refused while walking is held, unless forced', async () => {
      nav.walking.hold('popup');
      await expect(nav.moveToPano('pano-next')).resolves.toBe(false);
      await expect(nav.moveToPano('pano-next', true)).resolves.toBe(true);
      expect(panoManager.setPanorama).toHaveBeenCalledTimes(1);
    });
  });

  describe('a move to a location', () => {
    test('searches near it, leaving out the pano stood on, and lands as a real move', async () => {
      const landed = vi.fn();
      nav.onLanded(landed);

      await expect(nav.moveToLocation({ lat: 47.61, lng: -122.31 })).resolves.toBe(true);

      const [latLng, excluded] = panoManager.setLocation.mock.calls[0];
      expect(latLng).toEqual({ lat: 47.61, lng: -122.31 });
      expect([...excluded]).toEqual([{ panoId: 'pano-here' }]);
      expect(landed).toHaveBeenCalledTimes(1);
      expect(resetFlagGuard).toHaveBeenCalled();
      expect(nav.canWalk()).toBe(false);
    });

    test('excludes nothing when the pano stood on is not in the store', async () => {
      panoStore.getPanoData = () => null;
      await nav.moveToLocation({ lat: 47.61, lng: -122.31 });
      expect([...panoManager.setLocation.mock.calls[0][1]]).toEqual([]);
    });

    test('is refused while walking is held', async () => {
      nav.walking.hold('popup');
      await expect(nav.moveToLocation({ lat: 47.61, lng: -122.31 })).resolves.toBe(false);
      expect(panoManager.setLocation).not.toHaveBeenCalled();
    });

    test('when nothing loads there, the labeler is told and can try something else', async () => {
      panoManager.setLocation.mockRejectedValueOnce(new Error('nothing there'));
      const finished = vi.fn();
      nav.onMoveFinished(finished);

      await expect(nav.moveToLocation({ lat: 47.61, lng: -122.31 })).resolves.toBe(false);

      expect(alertController.showAlert).toHaveBeenCalledWith('popup.imagery-load-failed', 'imageryLoadFailed', false);
      expect(nav.canWalk()).toBe(true);
      expect(finished).toHaveBeenCalledTimes(1);
      expect(keyboardLock.release).toHaveBeenCalledWith('move');
      expect(navArrows.reset).toHaveBeenCalled();
    });

    test('keeps quiet about a failure when the caller has a fallback', async () => {
      panoManager.setLocation.mockRejectedValueOnce(new Error('nothing there'));
      await nav.moveToLocation({ lat: 47.61, lng: -122.31 }, { alertOnFailure: false });
      expect(alertController.showAlert).not.toHaveBeenCalled();
    });
  });

  describe('returning to a visited pano', () => {
    test('moves there and then faces the given view', async () => {
      const pov = { heading: 200, pitch: 0, zoom: 1 };
      await expect(nav.returnToPano('pano-earlier', pov)).resolves.toBe(true);
      expect(panoManager.setPanorama).toHaveBeenCalledWith('pano-earlier');
      expect(panoManager.setPov).toHaveBeenCalledWith(pov);
    });

    test('already standing there, only the view changes, and only if one was asked for', async () => {
      await expect(nav.returnToPano('pano-here')).resolves.toBe(true);
      expect(panoManager.setPanorama).not.toHaveBeenCalled();
      expect(panoManager.setPov).not.toHaveBeenCalled();

      const pov = { heading: 200, pitch: 0, zoom: 1 };
      await nav.returnToPano('pano-here', pov);
      expect(panoManager.setPov).toHaveBeenCalledWith(pov);
    });

    test('a move that fails leaves the view alone', async () => {
      panoManager.setPanorama.mockRejectedValueOnce(new Error('gone'));
      await expect(nav.returnToPano('pano-earlier', { heading: 1, pitch: 0, zoom: 1 })).resolves.toBe(false);
      expect(panoManager.setPov).not.toHaveBeenCalled();
    });

    test('is refused while walking is held', async () => {
      nav.walking.hold('popup');
      await expect(nav.returnToPano('pano-earlier')).resolves.toBe(false);
    });
  });

  describe('a move along the street', () => {
    test('a sweep that throws hands the controls back and rethrows', async () => {
      streetSweep.sweep.mockRejectedValueOnce(new Error('provider down'));
      const finished = vi.fn();
      nav.onMoveFinished(finished);

      await expect(nav.moveForward()).rejects.toThrow('provider down');

      expect(nav.canWalk()).toBe(true);
      expect(finished).toHaveBeenCalledTimes(1);
      expect(panoManager.panning.release).toHaveBeenCalledWith('move');
      expect(keyboardLock.release).toHaveBeenCalledWith('move');
    });

    test('a sweep that stopped runs its follow-up once the controls are back', async () => {
      const afterMove = vi.fn(() => expect(nav.canWalk()).toBe(true));
      streetSweep.sweep.mockResolvedValueOnce({ outcome: 'stopped', afterMove });
      await expect(nav.moveForward()).resolves.toBeNull();
      expect(afterMove).toHaveBeenCalledTimes(1);
    });

    test('a street walked out is a landing where the labeler stands, not a new pano', async () => {
      const landed = vi.fn();
      nav.onLanded(landed);
      streetSweep.sweep.mockResolvedValueOnce({ outcome: 'walkedOut' });
      await expect(nav.moveForward()).resolves.toBeNull();
      expect(landed).toHaveBeenCalledTimes(1);
    });

    test('free exploration\'s step either way lands as a move, and says which pano', async () => {
      const landed = vi.fn();
      nav.onLanded(landed);
      await expect(nav.moveAlongStreet(false)).resolves.toBe('pano-next');
      expect(streetSweep.stepAlongStreet).toHaveBeenCalledWith(false);
      expect(landed).toHaveBeenCalledTimes(1);
    });

    test('a step that finds nothing hands the controls back without a landing', async () => {
      const landed = vi.fn();
      nav.onLanded(landed);
      streetSweep.stepAlongStreet.mockResolvedValueOnce(null);
      await expect(nav.moveAlongStreet(true)).resolves.toBeNull();
      expect(landed).not.toHaveBeenCalled();
      expect(nav.canWalk()).toBe(true);
      expect(keyboardLock.release).toHaveBeenCalledWith('move');
    });

    test('a step that throws hands the controls back and rethrows', async () => {
      streetSweep.stepAlongStreet.mockRejectedValueOnce(new Error('provider down'));
      await expect(nav.moveAlongStreet(true)).rejects.toThrow('provider down');
      expect(nav.canWalk()).toBe(true);
    });

    test('an arrow key takes a link where one lies that way, and never asks about the street', async () => {
      viewer.links = [{ panoId: 'pano-north', heading: 0 }];
      viewer.heading = 0;
      await expect(nav.moveByArrowKey(0)).resolves.toEqual({ moved: true, streetWalkToward: null });
      expect(navArrows.streetWalkToward).not.toHaveBeenCalled();
      expect(streetSweep.stepAlongStreet).not.toHaveBeenCalled();
    });

    test('with no link that way an arrow key takes the street arrow nearest it', async () => {
      viewer.links = [];
      viewer.heading = 30;
      navArrows.streetWalkToward.mockReturnValue(false);
      await expect(nav.moveByArrowKey(180)).resolves.toEqual({ moved: true, streetWalkToward: false });
      expect(navArrows.streetWalkToward).toHaveBeenCalledWith(210);
      expect(streetSweep.stepAlongStreet).toHaveBeenCalledWith(false);
    });

    test('with neither a link nor a street arrow that way an arrow key goes nowhere', async () => {
      viewer.links = [];
      await expect(nav.moveByArrowKey(0)).resolves.toEqual({ moved: false, streetWalkToward: null });
      expect(streetSweep.stepAlongStreet).not.toHaveBeenCalled();
    });

    test('a step is refused while walking is held', async () => {
      nav.walking.hold('popup');
      await expect(nav.moveAlongStreet(true)).resolves.toBeUndefined();
      expect(streetSweep.stepAlongStreet).not.toHaveBeenCalled();
    });

    test('to the next street, a switch that throws unlocks everything and rethrows', async () => {
      await expect(nav.moveToNextStreet(() => { throw new Error('no next street'); }))
        .rejects.toThrow('no next street');
      expect(nav.canWalk()).toBe(true);
      expect(streetSweep.sweep).not.toHaveBeenCalled();
    });
  });
});
