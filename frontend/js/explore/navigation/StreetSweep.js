/**
 * The walk down a street looking for the next pano, and what a walk that finds none may conclude: that the street is
 * done anyway, that it looks imagery-less (reported, given up and left for the next street), or only that the provider
 * didn't answer (#4918, #4921, #4922). It lands the viewer when it finds imagery; the move around it (the locks, the
 * events, the beat after landing) is NavigationService's.
 */

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
 * 'walkedOut': no pano ahead, but the street counts as walked, so the labeler lands where they stand. A stop's
 * `afterMove` is what to announce once the move is undone, so a finish screen never opens over a move's locks.
 * @typedef {{outcome: 'landed', panoId: ?string} | {outcome: 'walkedOut'}
 *   | {outcome: 'stopped', afterMove?: () => void}} SweepResult
 */

export class StreetSweep {
  // Distance between points on a street when searching it for imagery (km). Public so that PanoManager's backup
  // starting points and the forward crumbs sample the same points, which the prefetch cache is keyed on.
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
  // The walk the #stuckPanos set belongs to; see #searchStreet().
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
   * Told when imagery runs out on a street walked near its end or wholly in view, before the sweep resolves.
   * @param {(task: Task) => void} listener
   */
  onStreetWalkedOut(listener) {
    this.#streetWalkedOutListeners.push(listener);
  }

  /**
   * Told when a street is given up on and there is no other street left to hand out, once the move is undone.
   * @param {() => void} listener
   */
  onStreetsRanOut(listener) {
    this.#streetsRanOutListeners.push(listener);
  }

  /**
   * Prefetches Mapillary images for all potential goal points along a street. Fires off requests asynchronously so
   * that subsequent setLocation() calls can skip the API round-trip. Safe to call multiple times for the same street
   * — prefetchLocation() deduplicates requests, so only the first call actually fires API requests.
   * @param {turf.Feature<turf.LineString>} streetGeometry - A Turf LineString of the full street geometry.
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
   * Pre-downloads the pano the next sweep of a street would land on, so that move doesn't wait on the network. Runs
   * the same target computation and (in the viewer) the same search and scoring as the real sweep; a misprediction
   * just costs one unused download.
   * @param {Task} task - The street the next sweep will walk.
   */
  preloadAhead(task) {
    // The same exclusions the sweep will use: the stuck set plus the pano the labeler is on now.
    const excludedPanos = new Set(this.#stuckPanos);
    const currentPano = this.#panoStore.getPanoData(this.#panoManager.getPanoId());
    if (currentPano) excludedPanos.add(currentPano);

    const { currLoc } = this.#computeMoveTarget(task);
    this.#panoManager.panoViewer.preloadPanoNear(currLoc, excludedPanos);
  }

  /**
   * Walks the current street until a pano loads, carrying on to the next street past one it gives up on.
   * @param {() => void} onNextStreet - Called as the sweep carries on to another street, inside the same move.
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
      // Announced as a new start, so what closes on a move (Feedback, the context menu) closes for the new street.
      onNextStreet();
    }
  }

  /**
   * Searches a street for imagery ahead of the labeler, a DIST_INCREMENT at a time, and lands on the first pano found.
   * @param {Task} task - The street being walked.
   * @returns {Promise<{found: boolean, panoId?: ?string, streetLooksEmpty?: boolean}>} The pano landed on; or, when
   *   none was found, whether every sampled point got a clean "nothing usable here" rather than no answer at all.
   */
  async #searchStreet(task) {
    // TODO show loading icon. Add when resolving issue #2403.

    const streetEndpoint = turf.point([task.getEndCoordinate().lng, task.getEndCoordinate().lat]);

    // The stuck set exists to stop the user cycling among panos they have already stood at on *this* street.
    // Carrying it onto the next street poisons the search there: the nearest pano to a new street's start is
    // routinely one visited on the street just finished, and setLocation() rejects an excluded pano exactly as it
    // rejects empty ground — so a street with perfectly good imagery can scan as having none, and then be falsely
    // reported on that basis (#4918). Short streets are the worst case, since every sample point on them can fall
    // within range of the same already-visited pano.
    //
    // A route can walk the same street twice (out-and-back), and those passes are separate walks: keying on the
    // street would hand pass two every pano pass one banked, leaving the return leg nothing to land on. Walk order
    // names the traversal, matching TaskContainer.nextTask (#5008).
    const traversalKey = StreetSweep.#traversalKeyFor(task);
    if (traversalKey !== this.#stuckPanosTraversalKey) {
      this.#stuckPanos.clear();
      this.#stuckPanosTraversalKey = traversalKey;
    }

    // Prefetch images for the full street geometry. Using the full street (not just the remainder) ensures the
    // sampled points are identical on every sweep, so the dedup in prefetchLocation() makes this effectively a no-op
    // after the first call on a given street.
    this.prefetchAlongStreet(task.getFeature());

    // Find where to start searching for imagery, and the part of the street geometry that hasn't been walked yet.
    let { currLoc, remainder } = this.#computeMoveTarget(task);

    // Save the current pano as one that you're stuck at.
    this.#stuckPanos.add(this.#panoStore.getPanoData(this.#panoManager.getPanoId()));

    // Every rejection from the walk down the street, so the end of the search can tell an empty street from a
    // provider that stopped answering (#4918).
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
        // Save the new pano as one that doesn't work in case they try to move before clicking 'stuck' again.
        const panoId = this.#panoManager.getPanoId();
        this.#stuckPanos.add(this.#panoStore.getPanoData(panoId));
        // A move that lands ends any run of imagery failures, restoring the session's full flag allowance (#4918).
        NoImageryFlagGuard.reset();
        return { found: true, panoId };
      }

      if (turf.length(remainder) <= 0) {
        return { found: false, streetLooksEmpty: NoImageryError.allNoImagery(searchFailures) };
      }
      // Try `DIST_INCREMENT` further down the street.
      const distIncrement = Math.min(StreetSweep.DIST_INCREMENT, turf.length(remainder));
      remainder = turf.cleanCoords(turf.lineSliceAlong(remainder, distIncrement, streetEndpoint));
      currLoc = { lat: remainder.geometry.coordinates[0][1], lng: remainder.geometry.coordinates[0][0] };
    }
  }

  /**
   * Decides what a search that found nothing on a street means: finish it, report and leave it, or stop.
   *
   * @param {Task} task - The street the search ran out on.
   * @param {boolean} streetLooksEmpty - Whether the search that ran out actually established anything about the
   *     street: true when every sampled point along it got a clean "nothing usable here" from the provider, false
   *     when any of them failed to get an answer at all (a provider error, a blocked or unreachable API). Only the
   *     true case may report the street as imagery-less, or move the labeler off it — see the bail-out below.
   * @returns {Promise<'walkedOut'|'stopped'|'ranOut'|'nextStreet'>} 'nextStreet' once another street is current;
   *   'ranOut' when the street was given up and none is left.
   */
  async #concludeEmptySearch(task, streetLooksEmpty) {
    // In free exploration (#4451) there is no task to finish and no street to advance to: don't report the street as
    // imagery-less (the user is mid-street by design), just tell them why they can't go further. Which reason that is
    // depends on whether the provider actually answered — "there's nothing more this way" is a claim about the world
    // that a failed lookup can't support.
    if (this.#config.isExploreAddressMode) {
      const key = streetLooksEmpty ? 'popup.free-explore-no-imagery' : 'popup.imagery-load-failed';
      const type = streetLooksEmpty ? 'exploreAddressNoImagery' : 'imageryLoadFailed';
      this.#alertController.showAlert(i18next.t(key), type, false);
      return 'stopped';
    }

    // If the user is relatively close to the end of the street, tell them to finish labeling before jumping. This is
    // checked before the provider-failure bail-out below because it rests on where the labeler actually walked, not
    // on anything the provider said: they covered the street, so a lookup that failed at the far end is no reason to
    // withhold credit for work that was really done. It is also unreachable by the runaway loop #4918 is about,
    // which never moves off a street's start point.
    //
    // Judged at the furthest point reached as well as where the labeler stands: the sweep's exclusions can land a
    // move back near the start of a street already walked to its end, and the exhaustion that follows must not turn
    // that street into a no-imagery report (#5350).
    //
    // "Near" is the number free exploration may leave unseen (StreetCoverage.MaxUncoveredM), so the two modes agree
    // on what an imagery gap at the end of a street is worth. More generous than StreetProgress's end-of-street
    // threshold, since the imagery simply ends; Task.isAtEnd scales it down on short streets.
    const nearEndM = this.#config.streetCoverage.max_uncovered_m;
    const furthest = task.getFurthestPointReached().geometry.coordinates;
    const nearEnd = task.isAtEnd(this.#panoManager.getPosition(), nearEndM)
      || task.isAtEnd({ lat: furthest[1], lng: furthest[0] }, nearEndM);
    const inView = !nearEnd && this.#isWholeStreetInView(task);
    if (inView) this.#tracker.push('NoImagery_StreetInView');
    if (nearEnd || inView) {
      this.#streetWalkedOutListeners.forEach((listener) => listener(task));
      return 'walkedOut';
    }

    // The search never got an answer, so nothing is known about this street's imagery: don't report it and don't move
    // on to the next one. Just say so and let the user retry once the provider recovers. This is the same distinction
    // the page-load path draws, and it has to be drawn here too — otherwise a provider outage still walks the
    // region, just three streets at a time instead of unbounded (#4918).
    if (!streetLooksEmpty) {
      this.#tracker.push('PanoSearchFailed');
      this.#alertController.showAlert(i18next.t('popup.imagery-load-failed'), 'imageryLoadFailed', false);
      return 'stopped';
    }

    // One give-up per street. A stop below leaves the controls with the labeler — the route's finish gate needs them
    // able to look around — so they can walk into this path again on the street they are still standing on, filing a
    // duplicate report and re-firing the finish toast. No other give-up leaves them on a flagged street.
    if (task.wasGivenUpOnImagery()) return 'stopped';

    // Nowhere near the end, so the street really does look like it runs out of imagery ahead of the user. Two
    // separable decisions follow: whether to *write down* that the street looks imagery-less, and whether to move
    // the labeler somewhere they can keep working (#4918).
    //
    // Writing it down records evidence and nothing else: the task is not completed or submitted, and the street
    // keeps its priority and its place in the rotation until the offline imagery checker confirms the reports and
    // retires it (#4922) — one session's verdict is never enough to move coverage. Even as pure evidence, an
    // unbroken run of reports is far better explained by one broken session than by a run of empty streets, so
    // reporting stops at MAX_CONSECUTIVE_FLAGS. Moving on costs nothing, so it continues past that point: a labeler
    // working a patchy area shouldn't be stranded just because we stopped trusting what we're seeing.
    const mayFlag = NoImageryFlagGuard.canFlag();
    NoImageryFlagGuard.recordStreetGivenUp();
    if (mayFlag) {
      await util.misc.reportNoImagery(task, this.#missionContainer.getCurrentMission().getProperty('missionId'));
    } else {
      this.#tracker.push('NoImageryFlagLimitReached');
    }

    // The advance ceiling still bounds a run: give-ups leave a street eligible for assignment to everyone else, so a
    // session that keeps finding empty ones is better explained by a broken session than by an empty region.
    if (!NoImageryFlagGuard.canAdvance()) {
      this.#tracker.push('NoImageryAdvanceLimitReached');
      // The run is over, so the budget goes back: what follows can only be the labeler deciding to try again, which
      // is a fresh decision rather than a continuation of the automatic run this bounds (#4918).
      NoImageryFlagGuard.reset();
      // Its own message rather than the imagery-load-failed one: nothing failed to load here — the provider answered
      // every time, and we are the ones who stopped believing it. "Try again in a few minutes" would be wrong
      // advice, since waiting changes nothing about a run of streets that all read as empty (#4918).
      this.#alertController.showAlert(i18next.t('popup.imagery-skip-limit'), 'imagerySkipLimit', false);
      return 'stopped';
    }

    // Get a new task and jump to the new task location. The task being left is deliberately not finished — finishing
    // it submits completed=true, and the regular submission path credits that as a full audit, which is exactly the
    // claim a no-imagery verdict cannot support (#4922).
    const newTask = this.#taskContainer.nextTask(task);

    // Set once the labeler is actually being moved off, not when the street is reported: a run stopped by the advance
    // ceiling above leaves them standing here, and the flag reads as "done with this street" everywhere — full length
    // credited toward progress, drawn as walked, never handed back. Client-side only; nothing reaches the server's
    // notion of completion (#4922).
    task.giveUpOnImagery();
    this.#taskContainer.renderTask(task);

    if (!newTask) return 'ranOut';

    // Flush what the labeler did here before the current task changes under the buffer. Interactions carry no task id
    // of their own — the server files them against whichever audit_task the submission names — so anything still
    // queued would land on the street they are about to be moved to. This is a plain submission, not endTask(): the
    // task is left unfinished, since finishing it submits completed=true and credits a full audit (#4922).
    await this.#form.submitData(task);
    this.#taskContainer.setCurrentTask(newTask);
    // Not awaited: naming the destination takes a network round trip, and the move should not wait on decoration.
    this.#stuckAlert.announceSkippedStreetNear(newTask.getMidpoint(), this.#config.mapboxApiKey);
    // Carries on inside this move: a fresh moveForward() would be refused, stranding the labeler (#4921).
    return 'nextStreet';
  }

  /**
   * Whether the user can see the whole street from where they stand. Short streets often can't be walked, since the
   * search skips the pano the user is on, so seeing it counts (#5474).
   * @param {Task} task
   * @returns {boolean}
   */
  #isWholeStreetInView(task) {
    const position = this.#panoManager.getPosition();
    const here = turf.point([position.lng, position.lat]);
    return task.getFeature().geometry.coordinates.every((coord) =>
      turf.distance(here, turf.point(coord), { units: 'meters' }) <= PanoViewer.SEARCH_RADIUS_M);
  }

  /**
   * Computes the location a sweep will search first, along with the unwalked remainder of the street.
   *
   * The target is the start of the remainder (the user's furthest point reached), bumped one DIST_INCREMENT
   * forward when the user is already near that point — so we search for imagery that's actually ahead rather
   * than cycling through other panos clustered at the current location. If they've wandered away from the route,
   * the target stays at the furthest point to bring them back.
   *
   * @param {Task} task - The task whose street is being walked.
   * @returns {{currLoc: {lat: number, lng: number}, remainder: turf.Feature<turf.LineString>}}
   */
  #computeMoveTarget(task) {
    const startLatLng = turf.point(task.getFurthestPointReached().geometry.coordinates);
    const streetEndpoint = turf.point([task.getEndCoordinate().lng, task.getEndCoordinate().lat]);

    let remainder = task.unwalkedRemainder();
    let currLoc = { lat: remainder.geometry.coordinates[0][1], lng: remainder.geometry.coordinates[0][0] };

    const currPosition = this.#panoManager.getPosition();
    const distFromFurthest = turf.distance(
      turf.point([currPosition.lng, currPosition.lat]), startLatLng, { units: 'meters' },
    );
    if (distFromFurthest <= PanoViewer.SEARCH_RADIUS_M
      && turf.length(remainder, { units: 'kilometers' }) > StreetSweep.DIST_INCREMENT) {
      remainder = turf.cleanCoords(turf.lineSliceAlong(remainder, StreetSweep.DIST_INCREMENT, streetEndpoint));
      currLoc = { lat: remainder.geometry.coordinates[0][1], lng: remainder.geometry.coordinates[0][0] };
    }
    return { currLoc, remainder };
  }

  /**
   * Identity of the walk a #stuckPanos set belongs to. Namespaced because route walk orders and street edge ids are
   * both small integers from unrelated sequences.
   *
   * @param {Task} task - The task being walked.
   * @returns {string} The route traversal's key, or the street's when not on a route (no walk order).
   */
  static #traversalKeyFor(task) {
    const walkOrder = task.getWalkOrder();
    return walkOrder !== null && walkOrder !== undefined ? `route:${walkOrder}` : `street:${task.getStreetEdgeId()}`;
  }
}
