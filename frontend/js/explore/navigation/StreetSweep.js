/**
 * Searches down a street for the next pano, and decides what it means when none turns up: the street is done anyway,
 * it has no imagery (report it, move to the next street), or the provider didn't answer (#4918, #4921, #4922). The move
 * around the search (locks, events) belongs to NavigationService.
 */

import * as turf from '@turf/turf';
import i18next from 'i18next';
import { NoImageryError } from '../../common/pano-viewer/NoImageryError.js';
import { PanoViewer } from '../../common/pano-viewer/PanoViewer.js';
import { util } from '../../common/utilities.js';
import { NoImageryFlagGuard } from '../panorama/NoImageryFlagGuard.js';
import '../../common/utilitiesSidewalk.js';
/** @typedef {import('../alert/AlertController.js').AlertController} AlertController */
/** @typedef {import('../Main.js').ExploreConfig} ExploreConfig */
/** @typedef {import('../data/Form.js').Form} Form */
/** @typedef {import('../mission/MissionContainer.js').MissionContainer} MissionContainer */
/** @typedef {import('../panorama/PanoManager.js').PanoManager} PanoManager */
/** @typedef {{panoId: string, lat: number, lng: number}} PanoHit */

/**
 * One searched point: the pano to land on there, or why there is none (`failure`: a NoImageryError when the point
 * is empty, the provider's error when it went unanswered). `nothingFound` says the lookup found no pano at all;
 * `excluded` is the panos it left out.
 * @typedef {{currLoc: {lat: number, lng: number}, hit: ?PanoHit, nothingFound: boolean, failure: ?Error,
 *   excluded: Set<import('../../common/pano-viewer/PanoData.js').PanoData>}} SearchedPoint
 */
/** @typedef {import('../../common/pano-viewer/PanoStore.js').PanoStore} PanoStore */
/** @typedef {import('../alert/StuckAlert.js').StuckAlert} StuckAlert */
/** @typedef {import('../task/Task.js').Task} Task */
/** @typedef {import('../task/TaskContainer.js').TaskContainer} TaskContainer */
/** @typedef {import('../data/Tracker.js').Tracker} Tracker */

/**
 * 'walkedOut': no pano ahead, but the street counts as walked. `afterMove` runs once the move is undone.
 * @typedef {{outcome: 'landed', panoId: ?string} | {outcome: 'walkedOut'}
 *   | {outcome: 'stopped', afterMove?: () => void}} SweepResult
 */

export class StreetSweep {
  // Spacing of the search points along a street (km). Shared so other samplers hit the same prefetch cache entries.
  static DIST_INCREMENT = 0.01;

  #config;
  #missionContainer;
  #taskContainer;
  #panoStore;
  #panoManager;
  #alertController;
  #stuckAlert;
  #form;
  #tracker;

  // Panos already stood at on this walk, which a search must not "move" back to.
  #stuckPanos = new Set();
  #stuckPanosTraversalKey = null;

  /** @type {Array<(task: Task) => void>} */
  #streetWalkedOutListeners = [];

  /** @type {Array<() => void>} */
  #streetsRanOutListeners = [];

  /**
   * @param {ExploreConfig} config
   * @param {MissionContainer} missionContainer - Whose current mission a no-imagery report is filed under.
   * @param {TaskContainer} taskContainer - The street being walked, and the next one after a street is given up.
   * @param {PanoStore} panoStore - Names the panos already stood at.
   * @param {PanoManager} panoManager - Searches each point and lands on what it finds.
   * @param {AlertController} alertController - Tells the labeler when the walk stops short.
   * @param {StuckAlert} stuckAlert - Names the street the labeler is moved to when one runs out of imagery.
   * @param {Form} form - Submits a street before the labeler is moved off it.
   * @param {Tracker} tracker
   */
  constructor(config, missionContainer, taskContainer, panoStore, panoManager, alertController, stuckAlert, form,
    tracker) {
    this.#config = config;
    this.#missionContainer = missionContainer;
    this.#taskContainer = taskContainer;
    this.#panoStore = panoStore;
    this.#panoManager = panoManager;
    this.#alertController = alertController;
    this.#stuckAlert = stuckAlert;
    this.#form = form;
    this.#tracker = tracker;
  }

  /**
   * Told when imagery runs out on a street the labeler has seen enough of, so it counts as walked (#5669).
   * @param {(task: Task) => void} listener
   */
  onStreetWalkedOut(listener) {
    this.#streetWalkedOutListeners.push(listener);
  }

  /**
   * Told when a street is given up and no other street is left, once the move is undone.
   * @param {() => void} listener
   */
  onStreetsRanOut(listener) {
    this.#streetsRanOutListeners.push(listener);
  }

  /**
   * Prefetches imagery at every search point on a street, so later moves skip the network. Safe to repeat: the
   * viewer skips points it already fetched.
   * @param {GeoJSON.Feature<GeoJSON.LineString>} streetGeometry - The full street.
   */
  prefetchAlongStreet(streetGeometry) {
    const totalLength = turf.length(streetGeometry); // km
    let dist = 0;
    while (dist <= totalLength) {
      const point = turf.along(streetGeometry, dist);
      this.#panoManager.panoViewer.prefetchLocation({
        lat: point.geometry.coordinates[1], lng: point.geometry.coordinates[0],
      });
      dist += StreetSweep.DIST_INCREMENT;
    }
  }

  /**
   * Pre-downloads the pano the next sweep would land on. A wrong guess costs one unused download.
   * @param {Task} task - The street the next sweep will walk.
   */
  preloadAhead(task) {
    const target = this.#computeMoveTarget(task);
    this.#panoManager.panoViewer.preloadPanoNear(target.currLoc, this.#panosLeftOut(target, this.#stoodAt(task)));
  }

  /**
   * The pano the next sweep would land on, found without moving: the blue arrow and its crumb point here (#5918).
   * @param {Task} task - The street the next sweep will walk.
   * @returns {Promise<?PanoHit>} Null when no pano is ahead; rejects when the provider didn't answer.
   */
  async findLanding(task) {
    const canMiss = this.#panoManager.panoViewer.findPanoNearCanMiss();
    for await (const { hit, nothingFound, failure } of this.#searchAhead(task, this.#stoodAt(task))) {
      if (hit) return hit;
      // The sweep tries a move at a point the lookup may have missed, so where it lands from here is unknown.
      if (nothingFound && canMiss) return null;
      if (!(failure instanceof NoImageryError)) throw failure;
    }
    return null;
  }

  /**
   * What the provider says at each point a sweep searches: the furthest point reached and on down the street, a
   * DIST_INCREMENT apart. The sweep and findLanding both walk these, so the sweep lands where findLanding said (#5918).
   * @param {Task} task - The street being walked.
   * @param {Set<import('../../common/pano-viewer/PanoData.js').PanoData>} stoodAt - Panos stood at on this walk.
   * @returns {AsyncGenerator<SearchedPoint, void, void>}
   */
  async* #searchAhead(task, stoodAt) {
    const viewer = this.#panoManager.panoViewer;
    const target = this.#computeMoveTarget(task);
    const excluded = this.#panosLeftOut(target, stoodAt);
    let { currLoc, remainder } = target;
    for (;;) {
      const at = `${currLoc.lat},${currLoc.lng}`;
      try {
        // A viewer that can't search has not said the street is empty.
        if (!viewer.supportsLocationSearch()) throw new Error('This viewer cannot search for a pano by location.');
        const hit = await viewer.findPanoNear(currLoc, excluded);
        if (!hit) {
          const failure = new NoImageryError(`No pano near ${at}.`);
          yield { currLoc, hit: null, nothingFound: true, failure, excluded };
        } else if (target.lookingAhead && !task.advancesWalk(hit)) {
          const failure = new NoImageryError(`The pano near ${at} leads no further down the street.`);
          yield { currLoc, hit: null, nothingFound: false, failure, excluded };
        } else {
          yield { currLoc, hit, nothingFound: false, failure: null, excluded };
        }
      } catch (err) {
        yield { currLoc, hit: null, nothingFound: false, failure: err, excluded };
      }
      if (turf.length(remainder) <= 0) return;
      ({ currLoc, remainder } = StreetSweep.#stepAlong(remainder));
    }
  }

  /**
   * Records the pano the labeler is leaving. A link-arrow click is a step of the walk too: forgotten, the next step
   * can lead straight back (#5918).
   */
  rememberStanding() {
    const task = this.#taskContainer.getCurrentTask();
    const standing = this.#panoStore.getPanoData(this.#panoManager.getPanoId());
    if (task && standing) this.#stuckPanosFor(task).add(standing);
  }

  /**
   * The stuck set for a walk, emptied first if it was another walk's: carried over, it hides panos near the new
   * street's start (#4918), or leaves a route's return leg nothing to land on (#5008).
   * @param {Task} task - The street being walked.
   * @returns {Set<import('../../common/pano-viewer/PanoData.js').PanoData>}
   */
  #stuckPanosFor(task) {
    const traversalKey = StreetSweep.#traversalKeyFor(task);
    if (traversalKey !== this.#stuckPanosTraversalKey) {
      this.#stuckPanos.clear();
      this.#stuckPanosTraversalKey = traversalKey;
    }
    return this.#stuckPanos;
  }

  /**
   * Where the labeler stands or already stood on this walk. Another street's stuck set doesn't count.
   * @param {Task} task - The street the next sweep will walk.
   * @returns {Set<import('../../common/pano-viewer/PanoData.js').PanoData>}
   */
  #stoodAt(task) {
    const sameWalk = StreetSweep.#traversalKeyFor(task) === this.#stuckPanosTraversalKey;
    const stoodAt = new Set(sameWalk ? this.#stuckPanos : []);
    stoodAt.add(this.#panoStore.getPanoData(this.#panoManager.getPanoId()));
    stoodAt.delete(undefined);
    return stoodAt;
  }

  /**
   * The panos a search won't land on: looking ahead, everywhere stood at on this walk; coming back to the street,
   * only where the labeler stands, since the pano they left is the one to return to (#5918).
   * @param {{lookingAhead: boolean}} target - The search's start, from #computeMoveTarget.
   * @param {Set<import('../../common/pano-viewer/PanoData.js').PanoData>} stoodAt - Panos stood at on this walk.
   * @returns {Set<import('../../common/pano-viewer/PanoData.js').PanoData>}
   */
  #panosLeftOut(target, stoodAt) {
    if (target.lookingAhead) return stoodAt;
    const standing = this.#panoStore.getPanoData(this.#panoManager.getPanoId());
    return new Set(standing ? [standing] : []);
  }

  /**
   * The next search point down a street: one DIST_INCREMENT on, or the street's end if less remains.
   * @param {GeoJSON.Feature<GeoJSON.LineString>} remainder - The street from the last search point on.
   * @returns {{currLoc: {lat: number, lng: number}, remainder: GeoJSON.Feature<GeoJSON.LineString>}}
   */
  static #stepAlong(remainder) {
    const distIncrement = Math.min(StreetSweep.DIST_INCREMENT, turf.length(remainder));
    const rest = turf.cleanCoords(turf.lineSliceAlong(remainder, distIncrement, Infinity));
    return { currLoc: { lat: rest.geometry.coordinates[0][1], lng: rest.geometry.coordinates[0][0] }, remainder: rest };
  }

  /**
   * Searches the current street until a pano loads, moving on to the next street past one with no imagery.
   * @param {() => void} onNextStreet - Called when the search moves on to another street, inside the same move.
   * @returns {Promise<SweepResult>}
   */
  async sweep(onNextStreet) {
    for (;;) {
      const task = this.#taskContainer.getCurrentTask();
      const { found, panoId, streetLooksEmpty } = await this.#searchStreet(task);
      if (found) return { outcome: 'landed', panoId };

      const verdict = await this.#concludeEmptySearch(task, streetLooksEmpty);
      if (verdict === 'ranOut') {
        return { outcome: 'stopped', afterMove: () => this.#streetsRanOutListeners.forEach((listener) => listener()) };
      }
      if (verdict !== 'nextStreet') return { outcome: verdict };
      // Announced as a new start, so what closes on a move (Feedback, the context menu) closes again.
      onNextStreet();
    }
  }

  /**
   * Lands on the first pano ahead that loads.
   * @param {Task} task - The street being walked.
   * @returns {Promise<{found: boolean, panoId?: ?string, streetLooksEmpty?: boolean}>} When nothing is found,
   *   `streetLooksEmpty` says whether every point answered "no imagery" (vs. the provider not answering).
   */
  async #searchStreet(task) {
    // TODO show loading icon. Add when resolving issue #2403.

    const stuckPanos = this.#stuckPanosFor(task);

    // The full street, not the remainder, so the points match every time and repeats cost nothing.
    this.prefetchAlongStreet(task.getGeoJSON());

    stuckPanos.add(this.#panoStore.getPanoData(this.#panoManager.getPanoId()));

    // Kept to tell an empty street from a provider that stopped answering (#4918).
    const searchFailures = [];
    // Points in a row can name the same pano, and each try at one that won't load waits out its time limit.
    const wontLoad = new Map();
    const viewer = this.#panoManager.panoViewer;
    for await (const { currLoc, hit, nothingFound, failure, excluded } of this.#searchAhead(task, stuckPanos)) {
      try {
        if (hit && wontLoad.has(hit.panoId)) {
          throw wontLoad.get(hit.panoId);
        } else if (hit) {
          await this.#panoManager.setPanorama(hit.panoId);
        } else if (nothingFound && viewer.findPanoNearCanMiss()) {
          // The lookup can't be trusted to rule a point out, so the provider's own move decides.
          await this.#panoManager.setLocation(currLoc, excluded);
        } else {
          throw failure;
        }
      } catch (err) {
        // A pano that won't load is passed over like a point that didn't answer.
        if (hit) wontLoad.set(hit.panoId, err);
        searchFailures.push(err);
        continue;
      }
      const panoId = this.#panoManager.getPanoId();
      stuckPanos.add(this.#panoStore.getPanoData(panoId));
      // A landing ends any run of imagery failures (#4918).
      NoImageryFlagGuard.reset();
      return { found: true, panoId };
    }
    return { found: false, streetLooksEmpty: NoImageryError.allNoImagery(searchFailures) };
  }

  /**
   * Decides what a search that found nothing means: finish the street, report and leave it, or stop.
   * @param {Task} task - The street the search ran out on.
   * @param {boolean} streetLooksEmpty - True only if every point answered "no imagery". A provider that didn't
   *   answer proves nothing, so the street is never reported or left on that basis.
   * @returns {Promise<'walkedOut'|'stopped'|'ranOut'|'nextStreet'>} 'ranOut' when no street is left.
   */
  async #concludeEmptySearch(task, streetLooksEmpty) {
    // Free exploration (#4451) has no street to finish or move on to, so just say why they can't go further.
    if (this.#config.isExploreAddressMode) {
      const key = streetLooksEmpty ? 'popup.free-explore-no-imagery' : 'popup.imagery-load-failed';
      const type = streetLooksEmpty ? 'exploreAddressNoImagery' : 'imageryLoadFailed';
      this.#alertController.showAlert(i18next.t(key), type, false);
      return 'stopped';
    }

    // Enough seen counts as walked, by the rule the server credits by and the imagery checker keeps streets open by
    // (#5669). Checked before the provider-failure case: a failed lookup at the far end shouldn't cost real credit.
    if (task.isCoveredEnough()) {
      this.#streetWalkedOutListeners.forEach((listener) => listener(task));
      return 'walkedOut';
    }

    // No answer means nothing is known: don't report or move on, so an outage can't skip through the region (#4918).
    if (!streetLooksEmpty) {
      this.#tracker.push('PanoSearchFailed');
      this.#alertController.showAlert(i18next.t('popup.imagery-load-failed'), 'imageryLoadFailed', false);
      return 'stopped';
    }

    // One give-up per street: a labeler left standing on one could otherwise report it again.
    if (task.wasGivenUpOnImagery()) return 'stopped';

    await this.#reportStreet(task);

    // A long run of empty streets more likely means a broken session than an empty region, so stop.
    if (!NoImageryFlagGuard.canAdvance()) {
      this.#tracker.push('NoImageryAdvanceLimitReached');
      // Trying again after this is the labeler's choice, so it starts a fresh run (#4918).
      NoImageryFlagGuard.reset();
      // Not "imagery failed to load": the provider did answer, so waiting a few minutes wouldn't help (#4918).
      this.#alertController.showAlert(i18next.t('popup.imagery-skip-limit'), 'imagerySkipLimit', false);
      return 'stopped';
    }

    // Only once they're really leaving: the flag reads as "done with this street" everywhere on the page (#4922).
    this.#markGivenUp(task);
    // A planned walk is rebuilt around the dead street first (#5526): the plan's next street assumed the labeler
    // would walk out of this one's far end, which they now never reach.
    if (this.#taskContainer.hasWalkPlan()) this.#taskContainer.planWalk('giveUp');
    // The street is left unfinished: finishing it would credit a full audit nobody did (#4922).
    const newTask = this.#taskContainer.nextTask(task);

    if (!newTask) return 'ranOut';

    // Held as an armed jump until setCurrentTask lands on it: the submission awaited below is the window in which a
    // priority refresh arrives, and a replan there could turn or reorder the street already chosen and prefetched.
    this.#taskContainer.setNextTaskAfterJump(newTask);
    await this.#submitGivenUp(task);
    this.#taskContainer.setCurrentTask(newTask);
    // Not awaited: naming the street takes a network call, and the move shouldn't wait on it.
    this.#stuckAlert.announceSkippedStreetNear(newTask.getMidpoint(), this.#config.mapboxApiKey);
    // Carries on inside this move: a fresh moveForward() would be refused, stranding the labeler (#4921).
    return 'nextStreet';
  }

  /**
   * Files the street as missing imagery: evidence for the offline checker (#4922). A long run of reports more likely
   * means a broken session, so reporting stops at MAX_CONSECUTIVE_FLAGS while moving on continues.
   * @param {Task} task
   * @returns {Promise<void>}
   */
  async #reportStreet(task) {
    const mayFlag = NoImageryFlagGuard.canFlag();
    NoImageryFlagGuard.recordStreetGivenUp();
    if (mayFlag) {
      await util.misc.reportNoImagery(task, this.#missionContainer.getCurrentMission().getProperty('missionId'));
    } else {
      this.#tracker.push('NoImageryFlagLimitReached');
    }
  }

  /**
   * Marks the street as given up on, which reads as "done with this street" everywhere on the page (#4922).
   * @param {Task} task
   */
  #markGivenUp(task) {
    task.giveUpOnImagery();
    this.#taskContainer.renderTask(task);
  }

  /**
   * Sends what was logged on the street before the next one starts, or the server would file it under that one. Not
   * endTask(), which would credit a full audit (#4922).
   * @param {Task} task
   * @returns {Promise<void>}
   */
  async #submitGivenUp(task) {
    await this.#form.submitData(task);
  }

  /**
   * Where a sweep searches first: the furthest point reached, one step further if the labeler is already there (so
   * the search looks ahead, not around them). Off route, it stays put to bring them back.
   * @param {Task} task - The task whose street is being walked.
   * @returns {{currLoc: {lat: number, lng: number}, remainder: GeoJSON.Feature<GeoJSON.LineString>,
   *   lookingAhead: boolean}} `lookingAhead`: the labeler stands at the furthest point, so a landing must get past it.
   */
  #computeMoveTarget(task) {
    const startLatLng = turf.point(task.getFurthestPointReached().geometry.coordinates);

    let remainder = task.unwalkedRemainder();
    let currLoc = { lat: remainder.geometry.coordinates[0][1], lng: remainder.geometry.coordinates[0][0] };

    const currPosition = this.#panoManager.getPosition();
    const distFromFurthest = turf.distance(
      turf.point([currPosition.lng, currPosition.lat]), startLatLng, { units: 'meters' },
    );
    const lookingAhead = distFromFurthest <= PanoViewer.SEARCH_RADIUS_M;
    if (lookingAhead && turf.length(remainder, { units: 'kilometers' }) > StreetSweep.DIST_INCREMENT) {
      remainder = turf.cleanCoords(turf.lineSliceAlong(remainder, StreetSweep.DIST_INCREMENT, Infinity));
      currLoc = { lat: remainder.geometry.coordinates[0][1], lng: remainder.geometry.coordinates[0][0] };
    }
    return { currLoc, remainder, lookingAhead };
  }

  /**
   * Names the walk a stuck set belongs to: a route pass by its walk order, otherwise the street.
   * @param {Task} task
   * @returns {string}
   */
  static #traversalKeyFor(task) {
    const walkOrder = task.getWalkOrder();
    return walkOrder !== null && walkOrder !== undefined ? `route:${walkOrder}` : `street:${task.getStreetEdgeId()}`;
  }
}
