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
 * The seam is `svl.panoManager.setLocation`, the one call the sweep makes per sampled point: each test scripts what
 * the provider says at each point and asserts on what gets reported, what gets advanced, and what the labeler is
 * left able to do. Everything below it (viewer, network) is out of scope; `test/js/panoViewerSeedFallback.test.js`
 * covers the provider-side classification that decides which error type arrives here.
 *
 * NavigationService is a top-level `class` declaration for the Grunt-concatenation world, so the source is evaluated
 * into the jsdom global scope alongside the two collaborators it names as bare globals.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const readSrc = (relativePath) => fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');

const NO_IMAGERY_ERROR_SRC = readSrc('public/js/common/pano-viewer/src/NoImageryError.js');
const FLAG_GUARD_SRC = readSrc('public/js/explore/src/panorama/NoImageryFlagGuard.js');
const NAVIGATION_SERVICE_SRC = readSrc('public/js/explore/src/navigation/NavigationService.js');

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
 * The slice of turf that NavigationService uses. `lineSliceAlong` mirrors the production call, which passes the
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
 * @param {number} streetEdgeId - Identity the stuck-pano set and the reporting path key off.
 * @param {object} [options] - `lengthKm` (default 100 m, so a sweep samples it in ~10 steps) and `atEnd`, which
 *     stands in for the labeler having already walked to within reach of the street's endpoint.
 */
function makeTask(streetEdgeId, { lengthKm = 0.1, atEnd = false } = {}) {
    const start = [-74.0, FIXTURE_LAT];
    const end = [-74.0 + lengthKm * DEG_PER_KM_LNG, FIXTURE_LAT];
    return {
        streetEdgeId,
        getStreetEdgeId: () => streetEdgeId,
        getFeature: () => lineFeature([start, end]),
        getEndCoordinate: () => ({ lat: end[1], lng: end[0] }),
        getFurthestPointReached: () => pointFeature(start),
        isAtEnd: jest.fn(() => atEnd),
        isConnectedTo: () => true,
        getMidpoint: () => ({ lat: FIXTURE_LAT, lng: (start[0] + end[0]) / 2 }),
        lineDistance: () => lengthKm * 1000,
        getDistanceFromStart: () => 0,
    };
}

describe('Explore, when the imagery search runs out along a street', () => {
    let svl;
    let nav;
    let reportNoImagery;
    // Set per test: given the sampled point, what the provider says. Returning a rejection stands for a failed
    // search, resolving for one that found a usable pano.
    let respondToSearch;
    // Every (latLng, excludedPanos) the sweep asked about, in order.
    let searches;

    beforeEach(() => {
        jest.useFakeTimers();
        window.sessionStorage.clear();
        searches = [];
        reportNoImagery = jest.fn(() => Promise.resolve());

        const stub = () => jest.fn();
        svl = {
            STREETVIEW_MAX_DISTANCE: 25,
            CONNECTED_TASK_THRESHOLD: 0.01,
            isOnboarding: () => false,
            isExploreAddressMode: () => false,
            alertController: { showAlert: stub() },
            canvas: { disableLabeling: stub(), enableLabeling: stub(), hideHoverCard: stub() },
            compass: {
                disableCompassClick: stub(), enableCompassClick: stub(), showLabelBeforeJumpMessage: stub(),
                update: stub(),
            },
            contextMenu: { isOpen: () => false, hide: stub() },
            feedbackModal: { hide: stub() },
            keyboard: { setStatus: jest.fn() },
            minimap: { setMinimapLocation: stub() },
            missionContainer: { getCurrentMission: () => ({ getProperty: () => 7, pushATaskToTheRoute: jest.fn() }) },
            missionController: { wrapUpRouteOrNeighborhood: stub() },
            missionModel: { updateMissionProgress: stub() },
            neighborhoodModel: {
                currentNeighborhood: () => ({}), isRoute: false, isRouteOrNeighborhoodComplete: () => false,
                setComplete: jest.fn(),
            },
            observedArea: { panoChanged: stub(), update: stub() },
            panoOverlayControls: { disableStuckButton: stub(), enableStuckButton: stub() },
            panoStore: { getPanoData: (panoId) => ({ panoId }) },
            stuckAlert: { announceSkippedStreetNear: jest.fn(() => Promise.resolve()) },
            tracker: { push: jest.fn() },
            panoManager: {
                disablePanning: stub(), enablePanning: stub(), hideNavArrows: stub(), resetNavArrows: stub(),
                showNavArrows: stub(), updateCanvas: stub(),
                setLocation: jest.fn((latLng, excludedPanos) => {
                    searches.push({
                        latLng,
                        streetEdgeId: svl.taskContainer.getCurrentTask().getStreetEdgeId(),
                        excludedPanos: [...excludedPanos].map((pano) => pano.panoId),
                        walkingDisabled: nav.getStatus('disableWalking'),
                    });
                    return respondToSearch(latLng);
                }),
            },
            panoViewer: {
                getPanoId: () => 'pano-on-screen',
                getPosition: () => ({ lat: FIXTURE_LAT, lng: -74.0 }),
                getPov: () => ({ heading: 0, pitch: 0, zoom: 1 }),
                clearPrefetchCache: stub(),
                prefetchLocation: stub(),
                preloadPanoNear: stub(),
            },
            taskContainer: {
                // Left false so the post-move UI refresh skips the end-of-task branch: what a landing does to task
                // state is its own concern, and these tests are about the decision that precedes it.
                tasksLoaded: () => false,
                getCurrentTask: jest.fn(),
                setCurrentTask: jest.fn(),
                nextTask: jest.fn(() => null),
                endTask: jest.fn(),
                updateCurrentTask: stub(),
                getNextTaskAfterJump: () => null,
            },
        };

        window.svl = svl;
        window.turf = turfStub;
        window.i18next = { t: (key) => key };
        window.util = { getBrowser: () => 'chrome', misc: { reportNoImagery } };

        window.eval(`${NO_IMAGERY_ERROR_SRC}; window.NoImageryError = NoImageryError;`);
        window.eval(`${FLAG_GUARD_SRC}; window.NoImageryFlagGuard = NoImageryFlagGuard;`);
        window.eval(`${NAVIGATION_SERVICE_SRC}; window.NavigationService = NavigationService;`);

        const jqueryStub = () => ({ css: jest.fn() });
        nav = new window.NavigationService({}, {
            modeSwitchWalk: jqueryStub(), viewControlLayer: jqueryStub(), drawingLayer: jqueryStub(),
        });
    });

    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
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

    const emptyGround = () => Promise.reject(new window.NoImageryError('nothing usable here'));
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

        it('searches the street it moved to, rather than stranding the labeler on the old one (#4921)', async () => {
            const [dead, live] = [makeTask(101), makeTask(102)];
            assignStreets(dead, live);
            respondToSearch = () => (svl.taskContainer.getCurrentTask() === dead ? emptyGround() : foundImagery());

            await nav.moveForward();

            // The advance is a recursive moveForward(), and moveForward() returns immediately while walking is
            // disabled — which every move disables on its way in. So the new street being searched at all is the
            // assertion: without re-enabling walking first, the advance switches the task and nothing else happens,
            // leaving the labeler on the old street's pano with the whole panorama pane inert.
            expect(searches.map(({ streetEdgeId }) => streetEdgeId)).toContain(102);
        });

        it('gives the session its flag allowance back once a street loads', async () => {
            const [dead, live] = [makeTask(101), makeTask(102)];
            assignStreets(dead, live);
            respondToSearch = () => (svl.taskContainer.getCurrentTask() === dead ? emptyGround() : foundImagery());

            await nav.moveForward();

            expect(window.NoImageryFlagGuard.count()).toBe(0);
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
            jest.advanceTimersByTime(1000);
            await nav.moveForward(); // Finds nothing further, so reports the street and advances to the live one.

            // Only the pano the labeler is standing on may be excluded from the new street's search. Excluding the
            // rest of the session's visited panos is how a street with perfectly good imagery scans as having none:
            // setLocation() rejects an excluded pano exactly as it rejects empty ground, and the nearest pano to a
            // new street's start is routinely one visited on the street just finished.
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
            expect(svl.keyboard.setStatus).toHaveBeenCalledWith('disableKeyboard', false);
            expect(nav.getStatus('disableWalking')).toBe(false);
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

            expect(window.NoImageryFlagGuard.count()).toBe(6);
            expect(svl.tracker.push).toHaveBeenCalledWith('NoImageryAdvanceLimitReached');
            expect(nav.getStatus('disableWalking')).toBe(false);
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

        it('completes the neighborhood instead, when there are no streets left to hand out', async () => {
            assignStreets(makeTask(101));
            respondToSearch = emptyGround;

            await nav.moveForward();

            expect(svl.neighborhoodModel.setComplete).toHaveBeenCalled();
            expect(svl.missionController.wrapUpRouteOrNeighborhood).toHaveBeenCalled();
        });
    });

    describe('and the labeler had already walked most of the street', () => {
        it('ends the street rather than reporting it, since there was nothing further to walk anyway', async () => {
            const [nearlyDone, next] = [makeTask(101, { atEnd: true }), makeTask(102)];
            assignStreets(nearlyDone, next);
            respondToSearch = emptyGround;

            await nav.moveForward();

            expect(reportNoImagery).not.toHaveBeenCalled();
            expect(window.NoImageryFlagGuard.count()).toBe(0);
            // Unlike a report, this is a real completion: the labeler walked the street to within reach of its end,
            // so the task is finished through the same call the normal end-of-street flow uses.
            expect(svl.taskContainer.endTask).toHaveBeenCalled();
        });
    });

    describe('and the labeler is dropped into free exploration', () => {
        it('reports nothing, because a drop-in is mid-street by design (#4451)', async () => {
            svl.isExploreAddressMode = () => true;
            assignStreets(makeTask(101), makeTask(102));
            respondToSearch = emptyGround;

            await nav.moveForward();

            expect(reportNoImagery).not.toHaveBeenCalled();
            expect(svl.taskContainer.setCurrentTask).not.toHaveBeenCalled();
            expect(svl.alertController.showAlert)
                .toHaveBeenCalledWith('popup.free-explore-no-imagery', 'exploreAddressNoImagery', false);
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
});
