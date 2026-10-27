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
   * Told when imagery runs out near a street's end (or the whole street is in view), so it counts as walked.
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
    const excludedPanos = new Set(this.#stuckPanos);
    const currentPano = this.#panoStore.getPanoData(this.#panoManager.getPanoId());
    if (currentPano) excludedPanos.add(currentPano);

    const { currLoc } = this.#computeMoveTarget(task);
    this.#panoManager.panoViewer.preloadPanoNear(currLoc, excludedPanos);
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
   * Tries points ahead of the labeler, a DIST_INCREMENT apart, and lands on the first pano found.
   * @param {Task} task - The street being walked.
   * @returns {Promise<{found: boolean, panoId?: ?string, streetLooksEmpty?: boolean}>} When nothing is found,
   *   `streetLooksEmpty` says whether every point answered "no imagery" (vs. the provider not answering).
   */
  async #searchStreet(task) {
    // TODO show loading icon. Add when resolving issue #2403.

    // Start a fresh stuck set on each street. Carried over, it hides panos near the new street's start and the street
    // gets wrongly reported as having no imagery (#4918). A route that walks a street twice gets one set per pass,
    // or the return leg has nothing left to land on (#5008).
    const traversalKey = StreetSweep.#traversalKeyFor(task);
    if (traversalKey !== this.#stuckPanosTraversalKey) {
      this.#stuckPanos.clear();
      this.#stuckPanosTraversalKey = traversalKey;
    }

    // The full street, not the remainder, so the points match every time and repeats cost nothing.
    this.prefetchAlongStreet(task.getFeature());

    let { currLoc, remainder } = this.#computeMoveTarget(task);

    this.#stuckPanos.add(this.#panoStore.getPanoData(this.#panoManager.getPanoId()));

    // Kept to tell an empty street from a provider that stopped answering (#4918).
    const searchFailures = [];
    for (;;) {
      let found = false;
      try {
        await this.#panoManager.setLocation(currLoc, this.#stuckPanos);
        found = true;
      } catch (err) {
        searchFailures.push(err);
      }

      if (found) {
        const panoId = this.#panoManager.getPanoId();
        this.#stuckPanos.add(this.#panoStore.getPanoData(panoId));
        // A landing ends any run of imagery failures (#4918).
        NoImageryFlagGuard.reset();
        return { found: true, panoId };
      }

      if (turf.length(remainder) <= 0) {
        return { found: false, streetLooksEmpty: NoImageryError.allNoImagery(searchFailures) };
      }
      const distIncrement = Math.min(StreetSweep.DIST_INCREMENT, turf.length(remainder));
      remainder = turf.cleanCoords(turf.lineSliceAlong(remainder, distIncrement, Infinity));
      currLoc = { lat: remainder.geometry.coordinates[0][1], lng: remainder.geometry.coordinates[0][0] };
    }
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

    // The street is left unfinished: finishing it would credit a full audit nobody did (#4922).
    const newTask = this.#taskContainer.nextTask(task);

    // Only once they're really leaving: the flag reads as "done with this street" everywhere on the page (#4922).
    this.#markGivenUp(task);

    if (!newTask) return 'ranOut';

    await this.#submitGivenUp(task);
    this.#taskContainer.setCurrentTask(newTask);
    // Not awaited: naming the street takes a network call, and the move shouldn't wait on it.
    this.#stuckAlert.announceSkippedStreetNear(newTask.getMidpoint(), this.#config.mapboxApiKey);
    // Carries on inside this move: a fresh moveForward() would be refused, stranding the labeler (#4921).
    return 'nextStreet';
  }

  /**
   * Gives up a street reached without seeing enough of it (#5669), as one the search ran out on. The street is marked
   * given up before this returns, so the caller can hand over the next one without waiting for the network.
   * @param {Task} task - The street being left.
   * @returns {Promise<void>} Settles once the report and the submission are sent.
   */
  async giveUpOnStreet(task) {
    if (task.wasGivenUpOnImagery()) return;
    this.#tracker.push('NoImagery_StreetEndedShort', {
      coveredM: Math.round(task.getCoveredDistanceM()), lengthM: Math.round(task.lineDistance({ units: 'meters' })),
    });
    const reported = this.#reportStreet(task);
    this.#markGivenUp(task);
    // The report first: a route's completeness is judged on the submission, and counts a reported street only once
    // the report is on file.
    await reported;
    await this.#submitGivenUp(task);
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
   * @returns {{currLoc: {lat: number, lng: number}, remainder: GeoJSON.Feature<GeoJSON.LineString>}}
   */
  #computeMoveTarget(task) {
    const startLatLng = turf.point(task.getFurthestPointReached().geometry.coordinates);

    let remainder = task.unwalkedRemainder();
    let currLoc = { lat: remainder.geometry.coordinates[0][1], lng: remainder.geometry.coordinates[0][0] };

    const currPosition = this.#panoManager.getPosition();
    const distFromFurthest = turf.distance(
      turf.point([currPosition.lng, currPosition.lat]), startLatLng, { units: 'meters' },
    );
    if (distFromFurthest <= PanoViewer.SEARCH_RADIUS_M
      && turf.length(remainder, { units: 'kilometers' }) > StreetSweep.DIST_INCREMENT) {
      remainder = turf.cleanCoords(turf.lineSliceAlong(remainder, StreetSweep.DIST_INCREMENT, Infinity));
      currLoc = { lat: remainder.geometry.coordinates[0][1], lng: remainder.geometry.coordinates[0][0] };
    }
    return { currLoc, remainder };
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
