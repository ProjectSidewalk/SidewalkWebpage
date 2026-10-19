/**
 * What Explore is allowed to conclude, and to write down, when the imagery search along a street comes up empty
 * (#4918), and that the labeler is actually taken somewhere afterwards (#4921).
 *
 * A report is evidence, not an audit (#4922): it records a street_edge_issue row and must not finish the task —
 * finishing submits completed=true, which the regular submission path credits as a full audit, and that inflation
 * is what cost production ~3,370 streets across 29 cities. The decisions under test are therefore about evidence —
 * whether the provider answered at all, whether every sampled point along the street answered the same way, and
 * whether a session's run of failures has gone on long enough to be better explained by one broken session than by
 * a run of genuinely empty streets — plus the one write-path rule above.
 *
 * The seam is `panoManager.setLocation`, the one call the sweep makes per sampled point: each test scripts what the
 * provider says at each point and asserts on what gets reported, what gets advanced, and what the labeler is left
 * able to do. Everything below it (viewer, network) is out of scope; `test/js/panoViewerSeedFallback.test.js`
 * covers the provider-side classification that decides which error type arrives here.
 *
 * The sweep, the mover and the street bookkeeping (StreetSweep, NavigationService, StreetProgress) are built
 * together against fakes of their collaborators, as Main builds them; what they announce to the mission controller
 * is recorded through StreetProgress's events, as Main subscribes them.
 */

import { loadModules, mockModule, useUtil } from './loader.js';
import { fakeGate, fakeTracker, fakePanoManager } from './fakes.js';

// The GsvViewer replies below carry only the fields the sweep reads, not the full set the real PanoData validates.
mockModule('frontend/js/common/pano-viewer/PanoData.js', () => ({
  PanoData: class {
    constructor(params) {
      this.params = params;
    }

    getPanoId() {
      return this.params.panoId;
    }

    getProperty(key) {
      return this.params[key];
    }
  },
}));

// Fixtures put every street on one latitude so a street is a straight west-to-east segment and "distance along the
// street" is unambiguous. Real turf isn't a dependency of the JS test layer, and the sweep only needs lengths and
// slices to be self-consistent, not geodesically exact.
const FIXTURE_LAT = 40.9;
const KM_PER_DEGREE = 111.32;

const DEG_PER_KM_LNG = 1 / (KM_PER_DEGREE * Math.cos((FIXTURE_LAT * Math.PI) / 180));

/** Equirectangular approximation, in km. Exact enough at street scale, and stable regardless of fixture size. */
function kmBetween([lng1, lat1], [lng2, lat2]) {
  const x = (lng2 - lng1) * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
  const y = lat2 - lat1;
  return Math.sqrt(x * x + y * y) * KM_PER_DEGREE;
}

/** google.maps.LatLng as GsvViewer reads it: accessor methods, not fields. */
class FakeLatLng {
  constructor(lat, lng) {
    this._lat = lat;
    this._lng = lng;
  }

  lat() {
    return this._lat;
  }

  lng() {
    return this._lng;
  }
}

const lineFeature = (coordinates) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates } });
const pointFeature = (coordinates) => ({ type: 'Feature', geometry: { type: 'Point', coordinates } });

/** The point `distKm` along a two-coordinate segment, clamped to its end. */
function interpolate(coordinates, distKm) {
  const [start, end] = [coordinates[0], coordinates[coordinates.length - 1]];
  const total = kmBetween(start, end);
  if (total === 0) return [...start];
  const fraction = Math.min(1, Math.max(0, distKm / total));
  return [start[0] + (end[0] - start[0]) * fraction, start[1] + (end[1] - start[1]) * fraction];
}

/**
 * The slice of turf that StreetSweep uses. `lineSliceAlong` mirrors the production call, which passes the
 * street endpoint as the third argument where turf documents a stop *distance* — an object never compares greater
 * than the distance travelled, so real turf slices to the end of the line, which is what the caller means.
 */
const turfStub = {
  point: pointFeature,
  length: (line) => kmBetween(line.geometry.coordinates[0], line.geometry.coordinates.at(-1)),
  along: (line, distKm) => pointFeature(interpolate(line.geometry.coordinates, distKm)),
  cleanCoords: (line) => line,
  distance: (from, to, options = {}) => {
    const km = kmBetween(from.geometry.coordinates, to.geometry.coordinates);
    return options.units === 'meters' ? km * 1000 : km;
  },
  lineSlice: (startPoint, _stopPoint, line) =>
    lineFeature([startPoint.geometry.coordinates, line.geometry.coordinates.at(-1)]),
  lineSliceAlong: (line, startKm) =>
    lineFeature([interpolate(line.geometry.coordinates, startKm), line.geometry.coordinates.at(-1)]),
};

/**
 * A street the sweep can walk down.
 * @param {number} streetEdgeId - Identity the reporting path keys off.
 * @param {object} [options] - `lengthKm` (default 100 m, so a sweep samples it in ~10 steps), `atEnd`, which
 *     stands in for the labeler having already walked to within reach of the street's endpoint, and `walkOrder`,
 *     the route position that identifies this traversal to the stuck-pano set.
 */
function makeTask(streetEdgeId, { lengthKm = 0.1, atEnd = false, walkOrder = null } = {}) {
  const start = [-74.0, FIXTURE_LAT];
  const end = [-74.0 + lengthKm * DEG_PER_KM_LNG, FIXTURE_LAT];
  return {
    streetEdgeId,
    getStreetEdgeId: () => streetEdgeId,
    getWalkOrder: () => walkOrder,
    getProperty: () => null,
    givenUp: false,
    giveUpOnImagery() {
      this.givenUp = true;
    },
    wasGivenUpOnImagery() {
      return this.givenUp;
    },
    getFeature: () => lineFeature([start, end]),
    getEndCoordinate: () => ({ lat: end[1], lng: end[0] }),
    getFurthestPointReached: () => pointFeature(start),
    unwalkedRemainder() {
      return lineFeature([this.getFurthestPointReached().geometry.coordinates, end]);
    },
    isAtEnd: vi.fn(() => atEnd),
    isConnectedTo: () => true,
    getMidpoint: () => ({ lat: FIXTURE_LAT, lng: (start[0] + end[0]) / 2 }),
    lineDistance: () => lengthKm * 1000,
    getDistanceFromStart: () => 0,
    headingAlongRoute: () => streetEdgeId,
  };
}

describe('Explore, when the imagery search runs out along a street', () => {
  let svl;
  let nav;
  let progress;
  let sweep;
  let ui;
  // Arms a label type ('Walk' disarms), telling whoever listens for mode changes as LabelModes does.
  let switchMode;
  let NoImageryError;
  let NoImageryFlagGuard;
  let GsvViewer;
  let config;
  let keyboardLock;
  let missionController;
  let reportNoImagery;
  // Set per test: given the sampled point, what the provider says. Returning a rejection stands for a failed
  // search, resolving for one that found a usable pano.
  let respondToSearch;
  // The same, for a move to one named pano rather than a search along the street.
  let respondToPanoHop;
  // Every (latLng, excludedPanos) the sweep asked about, in order.
  let searches;

  beforeEach(async () => {
    vi.useFakeTimers();
    window.sessionStorage.clear();
    searches = [];
    respondToPanoHop = () => Promise.resolve();
    reportNoImagery = vi.fn(() => Promise.resolve());

    const stub = () => vi.fn();
    let mode = 'Walk';
    const modeListeners = [];
    switchMode = (newMode) => {
      mode = newMode;
      modeListeners.forEach((listener) => listener(newMode));
    };
    config = {
      isOnboarding: false,
      isExploreAddressMode: false,
      streetCoverage: { max_uncovered_m: 50 },
      mapboxApiKey: 'mapbox-token',
    };
    keyboardLock = fakeGate();
    missionController = { wrapUpRouteOrRegion: stub(), onRouteReadyToFinish: stub() };
    const panoViewer = {
      getPanoId: () => 'pano-on-screen',
      getPosition: () => ({ lat: FIXTURE_LAT, lng: -74.0 }),
      getPov: () => ({ heading: 0, pitch: 0, zoom: 1 }),
      clearPrefetchCache: stub(),
      prefetchLocation: stub(),
      preloadPanoNear: stub(),
      getLinkedPanos: () => [],
    };
    svl = {
      alertController: { showAlert: stub() },
      form: { submitData: vi.fn(() => Promise.resolve()) },
      labelContainer: { onMarkerClick: stub() },
      labelModes: {
        onModeChanged: (listener) => modeListeners.push(listener),
        getMode: () => mode,
        isUsable: () => true,
      },
      missionContainer: { getCurrentMission: () => ({ getProperty: () => 7, pushATaskToTheRoute: vi.fn() }) },
      missionModel: { updateMissionProgress: stub() },
      regionModel: {
        currentRegion: () => ({}), isRoute: false, isRouteOrRegionComplete: () => false,
        setComplete: vi.fn(),
      },
      navArrows: { hide: stub(), show: stub(), reset: stub() },
      panoStore: { getPanoData: (panoId) => ({ panoId }) },
      stuckAlert: { announceSkippedStreetNear: vi.fn(() => Promise.resolve()) },
      jumpAlert: { onClickJumpMessage: stub() },
      tracker: fakeTracker(),
      panoViewer,
      panoManager: fakePanoManager(panoViewer, {
        turnTo: stub(),
        panning: fakeGate(),
        // The link-graph hop, as opposed to the street sweep below: one named pano, no searching.
        setPanorama: vi.fn(() => respondToPanoHop()),
        setLocation: vi.fn((latLng, excludedPanos) => {
          searches.push({
            latLng,
            streetEdgeId: svl.taskContainer.getCurrentTask().getStreetEdgeId(),
            excludedPanos: [...excludedPanos].map((pano) => pano.panoId),
          });
          return respondToSearch(latLng);
        }),
      }),
      taskContainer: {
        // Left false so a landing skips the end-of-street check: what a landing does to task state is its own
        // concern, and these tests are about the decision that precedes it.
        tasksLoaded: () => false,
        getCurrentTask: vi.fn(),
        setCurrentTask: vi.fn(),
        nextTask: vi.fn(() => null),
        endTask: vi.fn(),
        updateCurrentTask: stub(),
        getNextTaskAfterJump: () => null,
        setNextTaskAfterJump: vi.fn(),
        renderTask: vi.fn(),
      },
    };

    window.turf = turfStub;
    window.i18next = { t: (key) => key };
    useUtil({ misc: { reportNoImagery } });

    // GsvViewer rides along so the NoImageryError it throws is the one class StreetSweep checks for.
    let StreetSweep;
    let NavigationService;
    let StreetProgress;
    ({ NoImageryError, NoImageryFlagGuard, StreetSweep, NavigationService, StreetProgress, GsvViewer } =
      await loadModules(
        'frontend/js/common/pano-viewer/NoImageryError.js',
        'frontend/js/explore/panorama/NoImageryFlagGuard.js',
        'frontend/js/explore/navigation/StreetSweep.js', 'frontend/js/explore/navigation/NavigationService.js',
        'frontend/js/explore/task/StreetProgress.js', 'frontend/js/common/pano-viewer/GsvViewer.js',
      ));

    svl.labelModes.backToWalk = vi.fn(() => switchMode('Walk'));
    const el = () => document.createElement('div');
    ui = { modeSwitchWalk: el(), viewControlLayer: el(), drawingLayer: el() };
    sweep = new StreetSweep(config, svl.missionContainer, svl.taskContainer, svl.panoStore, svl.panoManager,
      svl.alertController, svl.stuckAlert, svl.form, svl.tracker);
    nav = new NavigationService(ui, svl.panoStore, svl.panoManager, sweep, svl.labelContainer, svl.labelModes,
      svl.navArrows, keyboardLock, svl.alertController);
    progress = new StreetProgress(config, svl.regionModel, svl.missionModel, svl.missionContainer,
      svl.taskContainer, svl.panoManager, nav, sweep, svl.jumpAlert, svl.tracker);
    progress.onRouteEndReached(() => missionController.onRouteReadyToFinish());
    progress.onRegionExhausted(() => missionController.wrapUpRouteOrRegion());
  });

  /** Queues the streets the labeler will be handed, in order, as `nextTask` hands them out. */
  const assignStreets = (...tasks) => {
    svl.taskContainer.getCurrentTask.mockReturnValue(tasks[0]);
    let handedOut = 0;
    svl.taskContainer.nextTask.mockImplementation(() => tasks[++handedOut] ?? null);
    svl.taskContainer.setCurrentTask.mockImplementation((task) => {
      svl.taskContainer.getCurrentTask.mockReturnValue(task);
    });
  };

  const emptyGround = () => Promise.reject(new NoImageryError('nothing usable here'));
  const providerFailure = () => Promise.reject(new Error('the maps library never loaded'));
  const foundImagery = () => Promise.resolve({ panoId: 'pano-found' });

  const pointsSearchedOn = (streetEdgeId) => new Set(
    searches.filter((search) => search.streetEdgeId === streetEdgeId).map(({ latLng }) => latLng.lng),
  ).size;

  describe('and every sampled point came back empty', () => {
    it('reports the street once and moves the labeler to the next one', async () => {
      const [dead, live] = [makeTask(101), makeTask(102)];
      assignStreets(dead, live);
      respondToSearch = () => (svl.taskContainer.getCurrentTask() === dead ? emptyGround() : foundImagery());

      await nav.moveForward();

      expect(reportNoImagery).toHaveBeenCalledTimes(1);
      expect(reportNoImagery).toHaveBeenCalledWith(dead, 7);
      expect(svl.taskContainer.setCurrentTask).toHaveBeenCalledWith(live);
    });

    it('leaves the reported street\'s task unfinished, since a report is evidence, not an audit (#4922)', async () => {
      const [dead, live] = [makeTask(101), makeTask(102)];
      assignStreets(dead, live);
      respondToSearch = () => (svl.taskContainer.getCurrentTask() === dead ? emptyGround() : foundImagery());

      await nav.moveForward();

      // endTask() submits the task with completed=true, and the regular submission path credits that as a
      // full audit — region coverage, priority drop, audited meters. A no-imagery verdict supports none of it.
      expect(svl.taskContainer.endTask).not.toHaveBeenCalled();
    });

    it('flushes the street being left before the task changes under the buffer', async () => {
      const [dead, live] = [makeTask(101), makeTask(102)];
      assignStreets(dead, live);
      respondToSearch = () => (svl.taskContainer.getCurrentTask() === dead ? emptyGround() : foundImagery());

      await nav.moveForward();

      // Interactions carry no task id of their own, so whatever is still queued lands on whichever task the
      // next submission names. Flushing against the street being left is what keeps it off the next one.
      expect(svl.form.submitData).toHaveBeenCalledWith(dead);
      expect(svl.form.submitData.mock.invocationCallOrder[0])
        .toBeLessThan(svl.taskContainer.setCurrentTask.mock.invocationCallOrder[0]);
    });

    it('searches the street it moved to, rather than stranding the labeler on the old one (#4921)', async () => {
      const [dead, live] = [makeTask(101), makeTask(102)];
      assignStreets(dead, live);
      respondToSearch = () => (svl.taskContainer.getCurrentTask() === dead ? emptyGround() : foundImagery());

      await nav.moveForward();

      // moveForward() refuses mid-move, so an advance routed through it would switch the task and stop there,
      // leaving the labeler on the old street's pano.
      expect(searches.map(({ streetEdgeId }) => streetEdgeId)).toContain(102);
    });

    it('announces the advance as a new move start, so what closes on a move closes for the new street', async () => {
      const [dead, live] = [makeTask(101), makeTask(102)];
      assignStreets(dead, live);
      respondToSearch = () => (svl.taskContainer.getCurrentTask() === dead ? emptyGround() : foundImagery());
      const starts = vi.fn();
      nav.onMoveStarted(starts);

      await nav.moveForward();

      expect(starts).toHaveBeenCalledTimes(2);
    });

    it('still advances when a pop-up took hold of walking during the move', async () => {
      const [dead, live] = [makeTask(101), makeTask(102)];
      assignStreets(dead, live);
      respondToSearch = () => {
        // A pop-up's hold, taken mid-move, so it never lifts on its own.
        nav.walking.hold('interaction');
        return svl.taskContainer.getCurrentTask() === dead ? emptyGround() : foundImagery();
      };

      await nav.moveForward();

      expect(searches.map(({ streetEdgeId }) => streetEdgeId)).toContain(102);
    });

    it('jumps on under the sign-in prompt that ending the street raised, facing the street it lands on', async () => {
      const [done, dead, live] = [makeTask(100), makeTask(101), makeTask(102)];
      assignStreets(done, dead, live);
      // The prompt opens from the task's end, before the jump's own move, and holds until answered.
      svl.taskContainer.endTask.mockImplementation(() => nav.walking.hold('interaction'));
      respondToSearch = () => (svl.taskContainer.getCurrentTask() === dead ? emptyGround() : foundImagery());

      await progress.jumpToANewTask();

      expect(searches.map(({ streetEdgeId }) => streetEdgeId)).toContain(102);
      // The target street had no imagery, so the camera follows the one reached.
      expect(svl.panoManager.turnTo).toHaveBeenCalledWith(102);
    });

    it('neither turns the camera nor shows the jump tip when the jump lands nowhere', async () => {
      assignStreets(makeTask(100), makeTask(101));
      respondToSearch = providerFailure;

      await progress.jumpToANewTask();

      expect(svl.panoManager.turnTo).not.toHaveBeenCalled();
      expect(svl.jumpAlert.onClickJumpMessage).not.toHaveBeenCalled();
    });

    it('counts a load that finished as a landing, even when the viewer has no id for the pano yet', async () => {
      assignStreets(makeTask(101), makeTask(102));
      respondToSearch = foundImagery;
      svl.panoViewer.getPanoId = () => null;

      await nav.moveForward();

      expect(svl.alertController.showAlert).not.toHaveBeenCalled();
      expect(svl.missionModel.updateMissionProgress).toHaveBeenCalled();
    });

    it('gives the session its flag allowance back once a street loads', async () => {
      const [dead, live] = [makeTask(101), makeTask(102)];
      assignStreets(dead, live);
      respondToSearch = () => (svl.taskContainer.getCurrentTask() === dead ? emptyGround() : foundImagery());

      await nav.moveForward();

      expect(NoImageryFlagGuard.count()).toBe(0);
    });

    it('does not carry a street\'s accumulated stuck panos into the search of the next (#4918)', async () => {
      const [dead, live] = [makeTask(101), makeTask(102)];
      assignStreets(dead, live);
      let standingOn = 'pano-street-start';
      svl.panoViewer.getPanoId = () => standingOn;
      let walkedOnce = false;
      respondToSearch = () => {
        if (svl.taskContainer.getCurrentTask() === live) return foundImagery();
        if (walkedOnce) return emptyGround();
        walkedOnce = true;
        standingOn = 'pano-mid-street';
        return foundImagery();
      };

      await nav.moveForward(); // Walks one step down the dead street, banking both of its panos as stuck.
      // A landing bars walking for MOVE_DELAY so a labeler can't spam through a mission; let it lapse, or the
      // next move is refused before it starts.
      vi.advanceTimersByTime(1000);
      await nav.moveForward(); // Finds nothing further, so reports the street and advances to the live one.

      // Only the pano the labeler is standing on may be excluded from the new street's search. Excluding the
      // rest of the session's visited panos is how a street with perfectly good imagery scans as having none:
      // setLocation() rejects an excluded pano exactly as it rejects empty ground, and the nearest pano to a
      // new street's start is routinely one visited on the street just finished.
      expect(searches.at(-1).excludedPanos).not.toContain('pano-street-start');
    });

    it('gives each pass of an out-and-back route its own stuck panos (#5008)', async () => {
      // The two passes share a street edge id, so keying the reset on the street hands the return leg every
      // pano the outbound leg banked — on a short street, all of them.
      svl.regionModel.isRoute = true;
      const [outbound, back] = [makeTask(101, { walkOrder: 1 }), makeTask(101, { walkOrder: 2 })];
      assignStreets(outbound, back);
      let standingOn = 'pano-street-start';
      svl.panoViewer.getPanoId = () => standingOn;
      let walkedOnce = false;
      respondToSearch = () => {
        if (svl.taskContainer.getCurrentTask() === back) return foundImagery();
        if (walkedOnce) return emptyGround();
        walkedOnce = true;
        standingOn = 'pano-mid-street';
        return foundImagery();
      };

      await nav.moveForward();
      vi.advanceTimersByTime(1000);
      await nav.moveForward();

      expect(searches.at(-1).excludedPanos).not.toContain('pano-street-start');
    });
  });

  describe('and the provider never answered', () => {
    it('writes nothing down and leaves the labeler where they were', async () => {
      const [street, next] = [makeTask(101), makeTask(102)];
      assignStreets(street, next);
      respondToSearch = providerFailure;

      await nav.moveForward();

      expect(reportNoImagery).not.toHaveBeenCalled();
      expect(svl.taskContainer.setCurrentTask).not.toHaveBeenCalled();
      expect(svl.tracker.push).toHaveBeenCalledWith('PanoSearchFailed');
    });

    it('tells the labeler and hands the controls back, rather than freezing the panorama', async () => {
      assignStreets(makeTask(101), makeTask(102));
      respondToSearch = providerFailure;

      await nav.moveForward();

      expect(svl.alertController.showAlert)
        .toHaveBeenCalledWith('popup.imagery-load-failed', 'imageryLoadFailed', false);
      expect(keyboardLock.release).toHaveBeenCalledWith('move');
      expect(nav.canWalk()).toBe(true);
    });

    it('still writes nothing when only one sampled point failed to get an answer', async () => {
      assignStreets(makeTask(101), makeTask(102));
      let searchCount = 0;
      // One unreachable point among clean "nothing here" answers leaves the street unknown, not empty: the
      // points that one would have covered were never actually asked about.
      respondToSearch = () => (++searchCount === 2 ? providerFailure() : emptyGround());

      await nav.moveForward();

      expect(reportNoImagery).not.toHaveBeenCalled();
      expect(svl.taskContainer.setCurrentTask).not.toHaveBeenCalled();
    });
  });

  describe('and the failures keep coming, street after street', () => {
    it('stops writing them down after three, but keeps the labeler moving', async () => {
      assignStreets(...Array.from({ length: 9 }, (_unused, i) => makeTask(200 + i)));
      respondToSearch = emptyGround;

      await nav.moveForward();

      expect(reportNoImagery).toHaveBeenCalledTimes(3);
      expect(svl.taskContainer.setCurrentTask).toHaveBeenCalledTimes(5);
      expect(svl.tracker.push).toHaveBeenCalledWith('NoImageryFlagLimitReached');
    });

    it('ends the run once it is long enough to be cycling, and says so', async () => {
      assignStreets(...Array.from({ length: 9 }, (_unused, i) => makeTask(200 + i)));
      respondToSearch = emptyGround;

      await nav.moveForward();

      expect(svl.taskContainer.setCurrentTask).toHaveBeenCalledTimes(5);
      // The budget goes back when the run ends: whatever happens next is the labeler deciding to try again,
      // which is a fresh decision rather than more of the automatic run this bounds.
      expect(NoImageryFlagGuard.count()).toBe(0);
      expect(svl.tracker.push).toHaveBeenCalledWith('NoImageryAdvanceLimitReached');
      expect(nav.canWalk()).toBe(true);
    });

    it('leaves the street they are left standing on unmarked, having never moved them off it (#5008)', async () => {
      const streets = Array.from({ length: 9 }, (_unused, i) => makeTask(200 + i));
      assignStreets(...streets);
      respondToSearch = emptyGround;

      await nav.moveForward();

      // The flag means "we moved them off this street" — it credits the street's full length toward progress,
      // draws it as walked, and takes it out of nextTask's rotation. The street the ceiling stops them on is
      // still theirs to walk if they click stuck and land somewhere.
      expect(streets[4].wasGivenUpOnImagery()).toBe(true);
      expect(streets[5].wasGivenUpOnImagery()).toBe(false);
    });

    it('says the run was stopped, not that imagery failed to load', async () => {
      assignStreets(...Array.from({ length: 9 }, (_unused, i) => makeTask(200 + i)));
      respondToSearch = emptyGround;

      await nav.moveForward();

      // The provider answered every time here, so "try again in a few minutes" would be wrong advice: the
      // streets will read as empty just the same in five minutes (#4918).
      expect(svl.alertController.showAlert)
        .toHaveBeenCalledWith('popup.imagery-skip-limit', 'imagerySkipLimit', false);
      expect(svl.alertController.showAlert).not.toHaveBeenCalledWith(
        'popup.imagery-load-failed', 'imageryLoadFailed', false,
      );
    });

    it('tells the labeler about every move, including the ones it stops recording', async () => {
      assignStreets(...Array.from({ length: 9 }, (_unused, i) => makeTask(200 + i)));
      respondToSearch = emptyGround;

      await nav.moveForward();

      // Five moves, only three of them written down: being moved is the labeler's business either way, and
      // silence is what made this whole failure mode invisible from the seat (#4918).
      expect(svl.stuckAlert.announceSkippedStreetNear).toHaveBeenCalledTimes(5);
    });

    it('completes the region instead, when there are no streets left to hand out', async () => {
      assignStreets(makeTask(101));
      respondToSearch = emptyGround;

      await nav.moveForward();

      expect(svl.regionModel.setComplete).toHaveBeenCalled();
      expect(missionController.wrapUpRouteOrRegion).toHaveBeenCalled();
    });

    it('ends a route through its normal finish flow, not by firing the modal mid-stride (#5008)', async () => {
      svl.regionModel.isRoute = true;
      assignStreets(makeTask(101, { walkOrder: 1 }));
      respondToSearch = emptyGround;

      await nav.moveForward();

      expect(svl.regionModel.setComplete).toHaveBeenCalled();
      // The finish toast and its look-around gate, the same ending a route gets when its last street is walked.
      expect(missionController.onRouteReadyToFinish).toHaveBeenCalled();
      expect(missionController.wrapUpRouteOrRegion).not.toHaveBeenCalled();
      // The labeler has to be able to look around for that gate to ever open.
      expect(nav.canWalk()).toBe(true);
    });

    it('announces the end only once the move is undone, so the finish never opens over its locks', async () => {
      svl.regionModel.isRoute = true;
      assignStreets(makeTask(101, { walkOrder: 1 }));
      respondToSearch = emptyGround;
      let movingAtAnnouncement;
      missionController.onRouteReadyToFinish.mockImplementation(() => {
        movingAtAnnouncement = nav.isMoving();
      });

      await nav.moveForward();

      expect(movingAtAnnouncement).toBe(false);
      expect(keyboardLock.release.mock.invocationCallOrder[0])
        .toBeLessThan(missionController.onRouteReadyToFinish.mock.invocationCallOrder[0]);
    });

    it('gives up on a street once, however many times the labeler tries to walk off it (#5008)', async () => {
      // The route's finish gate needs the labeler able to look around, so the terminal branch hands the controls
      // back — which also lets them press forward again on the street it just gave up on.
      svl.regionModel.isRoute = true;
      assignStreets(makeTask(101, { walkOrder: 1 }));
      respondToSearch = emptyGround;

      await nav.moveForward();
      vi.advanceTimersByTime(1000);
      await nav.moveForward();

      expect(reportNoImagery).toHaveBeenCalledTimes(1);
      expect(missionController.onRouteReadyToFinish).toHaveBeenCalledTimes(1);
      expect(svl.tracker.push.mock.calls.filter(([event]) => event === 'PanoSearchFailed')).toHaveLength(0);
    });

    it('remembers the street it gave up on, without claiming the labeler audited it (#5008)', async () => {
      const [dead, live] = [makeTask(101), makeTask(102)];
      assignStreets(dead, live);
      respondToSearch = () => (svl.taskContainer.getCurrentTask() === dead ? emptyGround() : foundImagery());

      await nav.moveForward();

      // The flag is what keeps nextTask from handing the street back and the minimap from drawing it as still
      // to walk; the street stays incomplete, so nothing here reaches audit_task.completed (#4922).
      expect(dead.wasGivenUpOnImagery()).toBe(true);
      expect(svl.taskContainer.renderTask).toHaveBeenCalledWith(dead);
      expect(svl.taskContainer.endTask).not.toHaveBeenCalled();
    });
  });

  describe('and the labeler had already walked most of the street', () => {
    it('ends the street rather than reporting it, since there was nothing further to walk anyway', async () => {
      const [nearlyDone, next] = [makeTask(101, { atEnd: true }), makeTask(102)];
      assignStreets(nearlyDone, next);
      respondToSearch = emptyGround;

      await nav.moveForward();

      expect(reportNoImagery).not.toHaveBeenCalled();
      expect(NoImageryFlagGuard.count()).toBe(0);
      // Unlike a report, this is a real completion: the labeler walked the street to within reach of its end,
      // so the task is finished through the same call the normal end-of-street flow uses.
      expect(svl.taskContainer.endTask).toHaveBeenCalled();
    });

    it('credits the street on where the labeler got to, not on where the sweep last put them', async () => {
      // The sweep's exclusions can land a move back near the start of a street already walked to its end —
      // on an 8.6 m stub every unvisited pano within reach is as likely behind the endpoint as past it (#5350).
      // The exhaustion that follows is then evidence of a street walked out, not of one without imagery.
      const walkedOut = makeTask(101);
      const endOfStreet = walkedOut.getEndCoordinate();
      walkedOut.getFurthestPointReached = () => pointFeature([endOfStreet.lng, endOfStreet.lat]);
      walkedOut.isAtEnd = vi.fn((latLng) => latLng.lng === endOfStreet.lng);
      assignStreets(walkedOut, makeTask(102));
      respondToSearch = emptyGround;

      await nav.moveForward();

      expect(walkedOut.isAtEnd).toHaveBeenCalledWith(svl.panoViewer.getPosition(), 50);
      expect(walkedOut.isAtEnd).toHaveBeenCalledWith({ lat: endOfStreet.lat, lng: endOfStreet.lng }, 50);
      expect(svl.taskContainer.endTask).toHaveBeenCalledWith(walkedOut);
      expect(reportNoImagery).not.toHaveBeenCalled();
    });

    it('still ends it when the provider stopped answering, since walking it is what earned the credit', async () => {
      // Finishing here rests on where the labeler actually got to, not on anything the provider said. Gating it
      // on a clean answer would mean a blip at the far end of a street withholds credit for work really done,
      // and there is no false-audit risk: reaching the end of a street is exactly what the #4918 loop never did.
      const [nearlyDone, next] = [makeTask(101, { atEnd: true }), makeTask(102)];
      assignStreets(nearlyDone, next);
      respondToSearch = providerFailure;

      await nav.moveForward();

      expect(svl.taskContainer.endTask).toHaveBeenCalledWith(nearlyDone);
      expect(reportNoImagery).not.toHaveBeenCalled();
    });
  });

  describe('and the user can see the whole street from where they stand (#5474)', () => {
    const standWestOfStreet = (metersAway) => {
      const lng = -74.0 - (metersAway / 1000) * DEG_PER_KM_LNG;
      svl.panoViewer.getPosition = () => ({ lat: FIXTURE_LAT, lng });
    };

    it('ends the street rather than reporting it', async () => {
      const [short, next] = [makeTask(101, { lengthKm: 0.012 }), makeTask(102)];
      assignStreets(short, next);
      standWestOfStreet(9);
      respondToSearch = emptyGround;

      await nav.moveForward();

      expect(svl.taskContainer.endTask).toHaveBeenCalledWith(short);
      expect(reportNoImagery).not.toHaveBeenCalled();
      expect(svl.tracker.push).toHaveBeenCalledWith('NoImagery_StreetInView');
    });

    it('still ends it when the provider stopped answering, since the user can see it', async () => {
      const [short, next] = [makeTask(101, { lengthKm: 0.001 }), makeTask(102)];
      assignStreets(short, next);
      standWestOfStreet(9);
      respondToSearch = providerFailure;

      await nav.moveForward();

      expect(svl.taskContainer.endTask).toHaveBeenCalledWith(short);
      expect(reportNoImagery).not.toHaveBeenCalled();
    });

    it('still reports a street whose far end is out of view', async () => {
      const [long, next] = [makeTask(101, { lengthKm: 0.02 }), makeTask(102)];
      assignStreets(long, next);
      standWestOfStreet(9);
      respondToSearch = () => (svl.taskContainer.getCurrentTask() === long ? emptyGround() : foundImagery());

      await nav.moveForward();

      expect(reportNoImagery).toHaveBeenCalledTimes(1);
      expect(svl.taskContainer.endTask).not.toHaveBeenCalled();
    });
  });

  describe('and the labeler steps to a linked pano instead of searching the street', () => {
    it('gives the session its flag allowance back when the step lands', async () => {
      // Walking on through the link graph is as much evidence that imagery is fine as a street sweep landing
      // is, so a run of failures ends here too — otherwise a session that gave up on a few streets and then
      // audited normally for an hour would still be refusing to report the next genuinely empty one.
      assignStreets(makeTask(101));
      NoImageryFlagGuard.recordStreetGivenUp();
      NoImageryFlagGuard.recordStreetGivenUp();
      svl.panoViewer.getLinkedPanos = () => [{ panoId: 'pano-next', heading: 0 }];

      await nav.moveToLinkedPano(0);

      expect(NoImageryFlagGuard.count()).toBe(0);
    });

    it('keeps quiet about a failed step when the caller has a fallback that may still move them', async () => {
      // The spacebar route-advance tries the link graph first and falls back to the street sweep. A banner here
      // would tell the labeler imagery couldn't be loaded on the very keypress that walked them down the street.
      assignStreets(makeTask(101));
      svl.panoViewer.getLinkedPanos = () => [{ panoId: 'pano-next', heading: 0 }];
      respondToPanoHop = () => Promise.reject(new Error('that pano never loads'));

      const moved = await nav.moveToLinkedPano(0, { alertOnFailure: false });

      expect(moved).toBe(false);
      expect(svl.alertController.showAlert).not.toHaveBeenCalled();
    });

    it('does tell them when nothing else is going to be tried', async () => {
      assignStreets(makeTask(101));
      svl.panoViewer.getLinkedPanos = () => [{ panoId: 'pano-next', heading: 0 }];
      respondToPanoHop = () => Promise.reject(new Error('that pano never loads'));

      await nav.moveToLinkedPano(0);

      expect(svl.alertController.showAlert)
        .toHaveBeenCalledWith('popup.imagery-load-failed', 'imageryLoadFailed', false);
    });
  });

  describe('and the labeler is dropped into free exploration', () => {
    it('reports nothing, because a drop-in is mid-street by design (#4451)', async () => {
      config.isExploreAddressMode = true;
      assignStreets(makeTask(101), makeTask(102));
      respondToSearch = emptyGround;

      await nav.moveForward();

      expect(reportNoImagery).not.toHaveBeenCalled();
      expect(svl.taskContainer.setCurrentTask).not.toHaveBeenCalled();
      expect(svl.alertController.showAlert)
        .toHaveBeenCalledWith('popup.free-explore-no-imagery', 'exploreAddressNoImagery', false);
    });

    it('says the imagery failed to load, not that the street ran out, when nothing answered', async () => {
      // "There's no more imagery this way" is a claim about the world that a failed lookup can't support.
      config.isExploreAddressMode = true;
      assignStreets(makeTask(101), makeTask(102));
      respondToSearch = providerFailure;

      await nav.moveForward();

      expect(svl.alertController.showAlert)
        .toHaveBeenCalledWith('popup.imagery-load-failed', 'imageryLoadFailed', false);
    });
  });

  describe('and the labeler tries to move again before the last move is done (#5765)', () => {
    it('refuses a second move without holding walking, and hides the arrows until the beat after landing', async () => {
      assignStreets(makeTask(101));
      let land;
      respondToSearch = () => new Promise((resolve) => { land = () => resolve({ panoId: 'pano-found' }); });

      const first = nav.moveForward();
      // A move in flight isn't a hold on walking, so a pop-up opening and closing under it can't strand anything.
      expect(nav.walking.isHeld()).toBe(false);
      expect(nav.canWalk()).toBe(false);
      expect(svl.navArrows.hide).toHaveBeenCalled();
      await nav.moveForward();
      expect(searches).toHaveLength(1);

      land();
      await first;
      expect(nav.canWalk()).toBe(false);
      svl.navArrows.show.mockClear();
      vi.advanceTimersByTime(800);
      expect(nav.canWalk()).toBe(true);
      expect(svl.navArrows.show).toHaveBeenCalled();
    });

    /** Holds the next pano hop in flight until the returned function lands it. */
    const holdNextHop = () => {
      let land;
      respondToPanoHop = () => new Promise((resolve) => { land = resolve; });
      return () => land();
    };

    it('does not let an earlier landing\'s timer reopen walking while a later move is in flight', async () => {
      assignStreets(makeTask(101));
      respondToSearch = foundImagery;
      await nav.moveForward();
      vi.advanceTimersByTime(600);

      // Only the tutorial's forced hop can start inside the beat.
      const land = holdNextHop();
      const hop = nav.moveToPano('pano-next', true);
      svl.navArrows.show.mockClear();
      vi.advanceTimersByTime(300); // Past the first landing's beat, with the hop still in flight.
      expect(nav.canWalk()).toBe(false);
      expect(svl.navArrows.show).not.toHaveBeenCalled();
      land();
      await hop;
    });

    it('does not let an earlier landing\'s timer cut short the beat after a later one', async () => {
      assignStreets(makeTask(101));
      respondToSearch = foundImagery;
      await nav.moveForward(); // Lands at 0 ms: its beat would end at 800.
      vi.advanceTimersByTime(600);

      const land = holdNextHop();
      const hop = nav.moveToPano('pano-next', true);
      vi.advanceTimersByTime(100);
      land();
      await hop; // Lands at 700 ms: its beat ends at 1500, with the first timer still pending.

      vi.advanceTimersByTime(150);
      expect(nav.canWalk()).toBe(false);
      vi.advanceTimersByTime(650);
      expect(nav.canWalk()).toBe(true);
    });

    it('keeps the jump prompt from firing inside the beat, so a double-click can\'t skip it', async () => {
      assignStreets(makeTask(100), makeTask(101));
      respondToSearch = foundImagery;
      await nav.moveForward();
      searches.length = 0;

      await progress.jumpToANewTask();
      expect(searches).toHaveLength(0);
      expect(svl.taskContainer.endTask).not.toHaveBeenCalled();

      vi.advanceTimersByTime(800);
      await progress.jumpToANewTask();
      expect(searches.length).toBeGreaterThan(0);
    });

    it('lets the labeler walk again when the bookkeeping after a landing throws', async () => {
      assignStreets(makeTask(101));
      respondToSearch = foundImagery;
      svl.missionModel.updateMissionProgress.mockImplementationOnce(() => { throw new Error('boom'); });

      await expect(nav.moveForward()).rejects.toThrow('boom');
      vi.advanceTimersByTime(800);

      expect(nav.canWalk()).toBe(true);
      expect(keyboardLock.release).toHaveBeenCalledWith('move');
    });

    it('unlocks everything when a jump fails before its move starts', async () => {
      assignStreets(makeTask(100), makeTask(101));
      svl.taskContainer.endTask.mockImplementationOnce(() => { throw new Error('boom'); });

      await expect(progress.jumpToANewTask()).rejects.toThrow('boom');

      expect(nav.canWalk()).toBe(true);
      expect(keyboardLock.release).toHaveBeenCalledWith('move');
      expect(svl.panoManager.panning.release).toHaveBeenCalledWith('move');
    });
  });

  describe('and the labeler has a label type armed (#5768)', () => {
    it('keeps the arrows hidden when a pop-up lets go of walking, until the type is disarmed', () => {
      switchMode('CurbRamp');
      svl.navArrows.show.mockClear();

      nav.walking.hold('interaction');
      nav.walking.release('interaction');
      expect(svl.navArrows.show).not.toHaveBeenCalled();

      switchMode('Walk');
      expect(svl.navArrows.show).toHaveBeenCalled();
    });

    it('lands a move in Walk mode, with the pano on top and the arrows back after the beat', async () => {
      assignStreets(makeTask(101));
      respondToSearch = foundImagery;
      switchMode('CurbRamp');
      expect(ui.drawingLayer.style.zIndex).toBe('1');

      await nav.moveForward();
      expect(svl.labelModes.backToWalk).toHaveBeenCalledTimes(1);
      expect(ui.drawingLayer.style.zIndex).toBe('0');
      expect(ui.viewControlLayer.style.zIndex).toBe('1');

      svl.navArrows.show.mockClear();
      vi.advanceTimersByTime(800);
      expect(svl.navArrows.show).toHaveBeenCalled();
    });

    it('keeps a type the labeler chose while the move was loading', async () => {
      assignStreets(makeTask(101));
      let land;
      respondToSearch = () => new Promise((resolve) => { land = () => resolve({ panoId: 'pano-found' }); });

      const move = nav.moveForward();
      switchMode('CurbRamp');
      land();
      await move;

      expect(svl.labelModes.backToWalk).not.toHaveBeenCalled();
      expect(ui.drawingLayer.style.zIndex).toBe('1');
    });

    it('leaves the type armed when switching is held, rather than log a switch that is refused', async () => {
      assignStreets(makeTask(101));
      respondToSearch = foundImagery;
      switchMode('CurbRamp');
      svl.labelModes.isUsable = () => false;

      await nav.moveForward();
      expect(svl.labelModes.backToWalk).not.toHaveBeenCalled();
    });

    it('does not switch modes on a move already in Walk mode, which would log a switch nobody made', async () => {
      assignStreets(makeTask(101));
      respondToSearch = foundImagery;

      await nav.moveForward();
      expect(svl.labelModes.backToWalk).not.toHaveBeenCalled();
    });
  });

  describe('and a move lands with the streets loaded (#5766)', () => {
    beforeEach(() => {
      svl.taskContainer.tasksLoaded = () => true;
      respondToSearch = foundImagery;
    });

    it('hands over the next street when the labeler reaches the end of one that joins it', async () => {
      const [ending, next] = [makeTask(101, { atEnd: true }), makeTask(102)];
      assignStreets(ending, next);

      await nav.moveForward();

      expect(svl.taskContainer.endTask).toHaveBeenCalledWith(ending);
      expect(svl.taskContainer.setCurrentTask).toHaveBeenCalledWith(next);
    });

    it('keeps a route\'s short last street open until most of it is walked (#4640)', async () => {
      svl.regionModel.isRoute = true;
      assignStreets(makeTask(101, { atEnd: true, walkOrder: 1 }));

      await nav.moveForward();

      expect(svl.regionModel.setComplete).not.toHaveBeenCalled();
      expect(missionController.onRouteReadyToFinish).not.toHaveBeenCalled();
    });

    it('preloads where the next step forward will land', async () => {
      assignStreets(makeTask(101));

      await nav.moveForward();

      expect(svl.panoViewer.preloadPanoNear).toHaveBeenCalled();
    });
  });

  describe('the sweep on its own, without a move around it (#5766)', () => {
    it('resolves with the pano it landed on', async () => {
      assignStreets(makeTask(101));
      respondToSearch = foundImagery;

      await expect(sweep.sweep(vi.fn())).resolves.toEqual({ outcome: 'landed', panoId: 'pano-on-screen' });
    });

    it('carries on to the next street past an empty one, saying so as it does', async () => {
      const [dead, live] = [makeTask(101), makeTask(102)];
      assignStreets(dead, live);
      respondToSearch = () => (svl.taskContainer.getCurrentTask() === dead ? emptyGround() : foundImagery());
      const onNextStreet = vi.fn();

      const result = await sweep.sweep(onNextStreet);
      expect(result.outcome).toBe('landed');
      expect(onNextStreet).toHaveBeenCalledTimes(1);
      expect(svl.taskContainer.getCurrentTask()).toBe(live);
    });

    it('stops, leaving the street where it was, when the provider never answered', async () => {
      assignStreets(makeTask(101), makeTask(102));
      respondToSearch = providerFailure;

      await expect(sweep.sweep(vi.fn())).resolves.toEqual({ outcome: 'stopped' });
      expect(svl.taskContainer.setCurrentTask).not.toHaveBeenCalled();
    });

    it('says a street that ran out near its end was walked, before it resolves', async () => {
      const nearlyDone = makeTask(101, { atEnd: true });
      assignStreets(nearlyDone);
      respondToSearch = emptyGround;
      const walkedOut = vi.fn();
      sweep.onStreetWalkedOut(walkedOut);

      await expect(sweep.sweep(vi.fn())).resolves.toEqual({ outcome: 'walkedOut' });
      expect(walkedOut).toHaveBeenCalledWith(nearlyDone);
    });
  });

  it('samples its way down the street rather than giving up at the first empty point', async () => {
    assignStreets(makeTask(101, { lengthKm: 0.1 }), makeTask(102));
    respondToSearch = emptyGround;

    await nav.moveForward();

    // A 100 m street sampled every 10 m: the exact count is geometry's business, but a single probe would mean
    // one dead pano could condemn a whole street.
    expect(pointsSearchedOn(101)).toBeGreaterThan(3);
  });

  describe('with the real GsvViewer answering the sweep (#5114)', () => {
    let viewer;
    let getPanorama;

    beforeEach(() => {
      window.google = {
        maps: {
          importLibrary: async () => ({ LatLng: FakeLatLng }),
          LatLng: FakeLatLng,
          StreetViewSource: { OUTDOOR: 'outdoor' },
        },
      };
      viewer = new GsvViewer();
      getPanorama = vi.fn();
      viewer.streetViewService = { getPanorama };
      viewer._loadPanoWithTimeout = vi.fn(async (_panoId, resolveValue) => resolveValue);
      vi.spyOn(console, 'warn').mockImplementation(() => {}); // The FarPanoRejected diagnostic warns.
      // The stuck set holds what panoStore returns, and the real viewer asks each of those for its id.
      svl.panoStore.getPanoData = (panoId) => ({ panoId, getPanoId: () => panoId });
      // The sweep's one seam, now backed by the real viewer rather than a scripted answer.
      svl.panoManager.setLocation.mockImplementation((latLng, excludedPanos) => {
        searches.push({ latLng, streetEdgeId: svl.taskContainer.getCurrentTask().getStreetEdgeId() });
        return viewer.setLocation(latLng, excludedPanos);
      });
    });

    /** A getPanorama() reply for a pano at `[lng, lat]`, with the fields the viewer reads. */
    const gsvReply = (pano, [lng, lat]) => ({
      data: {
        location: { pano, latLng: new FakeLatLng(lat, lng), shortDescription: '' },
        copyright: '© Google', imageDate: '2024-05', links: [], time: [],
        tiles: {
          worldSize: { width: 1, height: 1 }, tileSize: { width: 1, height: 1 },
          originHeading: 0, originPitch: 0,
        },
      },
    });

    it('a far answer at one step walks on to a near pano 10 m further, not to the end of the street', async () => {
      assignStreets(makeTask(101, { lengthKm: 0.1 }), makeTask(102));
      // The #5114 answer at the first point searched; a pano 3 m off the street at every later one.
      getPanorama.mockImplementation(async ({ location }) => (getPanorama.mock.calls.length === 1
        ? gsvReply('SYRACUSE', [-76.1720131, 43.0917906])
        : gsvReply(`near-${getPanorama.mock.calls.length}`, [location.lng(), location.lat() + 3 / 111320])));

      await nav.moveForward();

      expect(searches).toHaveLength(2);
      expect(kmBetween([searches[0].latLng.lng, searches[0].latLng.lat],
        [searches[1].latLng.lng, searches[1].latLng.lat]) * 1000).toBeCloseTo(10, 0);
      expect(viewer.getPanoId()).toBe('near-2');
      expect(viewer._loadPanoWithTimeout).toHaveBeenCalledTimes(1); // Syracuse was never loaded.
      expect(reportNoImagery).not.toHaveBeenCalled();
      expect(svl.taskContainer.setCurrentTask).not.toHaveBeenCalled();
    });
  });
});
