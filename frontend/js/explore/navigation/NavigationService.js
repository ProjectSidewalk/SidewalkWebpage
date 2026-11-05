/**
 * Makes the moves: along a street, to a pano, and to the next street. The labeler may walk when canWalk() says so.
 * A move runs idle → moving → settling → idle, and is announced (onMoveStarted, onLanded, onMoved, …) so other
 * modules react to it; the street's bookkeeping is StreetProgress's, and the search for imagery StreetSweep's.
 */

import i18next from 'i18next';
import { Gate } from '../../common/Gate.js';
import { NoImageryFlagGuard } from '../panorama/NoImageryFlagGuard.js';
import { util } from '../../common/utilities.js';
import '../../common/utilitiesMath.js';
/** @typedef {import('../alert/AlertController.js').AlertController} AlertController */
/** @typedef {import('../Main.js').StreetviewUi} StreetviewUi */
/** @typedef {import('../label/LabelContainer.js').LabelContainer} LabelContainer */
/** @typedef {import('../menu/LabelModes.js').LabelModes} LabelModes */
/** @typedef {import('../panorama/NavArrows.js').NavArrows} NavArrows */
/** @typedef {import('../panorama/PanoManager.js').PanoManager} PanoManager */
/** @typedef {import('../../common/pano-viewer/PanoStore.js').PanoStore} PanoStore */
/** @typedef {import('./StreetSweep.js').StreetSweep} StreetSweep */

export class NavigationService {
  static #MOVE_DELAY = 800; // Move delay prevents users from spamming through a mission.

  #ui;
  #panoStore;
  #panoManager;
  #streetSweep;
  #labelModes;
  #navArrows;
  #keyboardLock;
  #alertController;

  /**
   * Policy holds only (a pop-up, the tutorial, mission complete); moves end on their own, so canWalk() adds them.
   * @type {Gate}
   */
  walking = new Gate();

  /**
   * Where a move is: 'moving' until getPosition() is final, then 'settling' until getPov() stops changing (Mapillary
   * keeps animating the heading briefly, #4174), then 'idle'.
   * @type {'idle'|'moving'|'settling'}
   */
  #moveState = 'idle';

  #cooldownTimer = null; // Set for a beat after a move lands, so a mission can't be spam-walked without labeling.

  #povSettlePoll = null; // Interval id; see #refreshHeadingViewsAfterPovSettles.

  /** @type {Array<() => void>} */
  #landedListeners = [];

  /** @type {Array<() => void>} */
  #movedListeners = [];

  /** @type {Array<() => void>} */
  #moveStartedListeners = [];

  /** @type {Array<() => void>} */
  #moveFinishedListeners = [];

  /** @type {Array<() => void>} */
  #headingSettledListeners = [];

  /**
   * @param {StreetviewUi} ui - The pano area's layers, whose stacking says whether a click labels or pans.
   * @param {PanoStore} panoStore - Names the pano stood on, which a move must leave.
   * @param {PanoManager} panoManager - Makes the moves; its panning is held while one is in flight.
   * @param {StreetSweep} streetSweep - Finds the next pano along the street for moveForward() and the jump.
   * @param {LabelContainer} labelContainer - Whose minimap markers lead back to a label's pano (#2561).
   * @param {LabelModes} labelModes - An armed type raises the drawing layer and hides the arrows; a move disarms it.
   * @param {NavArrows} navArrows - Shown only while the labeler can walk in Walk mode.
   * @param {Gate} keyboardLock - Held while a move is in flight.
   * @param {AlertController} alertController - Tells the labeler when imagery can't be loaded.
   */
  constructor(ui, panoStore, panoManager, streetSweep, labelContainer, labelModes, navArrows, keyboardLock,
    alertController) {
    this.#ui = ui;
    this.#panoStore = panoStore;
    this.#panoManager = panoManager;
    this.#streetSweep = streetSweep;
    this.#labelModes = labelModes;
    this.#navArrows = navArrows;
    this.#keyboardLock = keyboardLock;
    this.#alertController = alertController;

    this.walking.onChanged(() => this.#refreshWalkUi());
    labelContainer.onMarkerClick((label) => {
      this.returnToPano(label.getPanoId(), label.getProperty('povOfLabelIfCentered'));
    });
    labelModes.onModeChanged((mode) => {
      this.#raiseDrawingLayer(mode !== 'Walk');
      this.#refreshWalkUi();
    });
  }

  /**
   * Told as a move starts, before the viewer is asked to move: what must not be used mid-move locks here.
   * @param {() => void} listener
   */
  onMoveStarted(listener) {
    this.#moveStartedListeners.push(listener);
  }

  /**
   * Told once a move has either landed or failed, so what locked at its start can unlock.
   * @param {() => void} listener
   */
  onMoveFinished(listener) {
    this.#moveFinishedListeners.push(listener);
  }

  /**
   * Told once the heading has settled after a move (Mapillary animates it briefly), so views of it redraw then (#4174).
   * @param {() => void} listener
   */
  onHeadingSettled(listener) {
    this.#headingSettledListeners.push(listener);
  }

  /**
   * Told first when a move lands, for the street bookkeeping that onMoved's listeners then read.
   * @param {() => void} listener
   */
  onLanded(listener) {
    this.#landedListeners.push(listener);
  }

  /**
   * Told once a move has landed and the street state is up to date.
   * @param {() => void} listener
   */
  onMoved(listener) {
    this.#movedListeners.push(listener);
  }

  /**
   * Stops telling a listener of moves.
   * @param {() => void} listener - The same function that was given to onMoved.
   */
  offMoved(listener) {
    this.#movedListeners = this.#movedListeners.filter((l) => l !== listener);
  }

  /** @returns {boolean} Whether a move is in flight and the position not yet final. */
  isMoving() {
    return this.#moveState === 'moving';
  }

  /** @returns {boolean} Whether a move may start: nothing holds walking, and no move is in flight or just landed. */
  canWalk() {
    return !this.walking.isHeld() && !this.isMoving() && this.#cooldownTimer === null;
  }

  /**
   * Dims the Walk button unless canWalk(); shows the arrows only then and in Walk mode (#5768).
   */
  #refreshWalkUi() {
    const canWalk = this.canWalk();
    if (canWalk && this.#labelModes.getMode() === 'Walk') this.#navArrows.show();
    else this.#navArrows.hide();
    this.#ui.modeSwitchWalk.style.opacity = canWalk ? '1' : '0.5';
  }

  /**
   * @returns {boolean} Whether a move or the heading settle after it is still under way, so views of the heading
   *   should keep their pre-move orientation (#4174).
   */
  isHeadingSettling() {
    return this.#moveState !== 'idle';
  }

  /**
   * Bars walking for a beat after a landing. A new landing restarts the beat, so an earlier move's timer can't end
   * a later move's.
   */
  #startCooldown() {
    window.clearTimeout(this.#cooldownTimer);
    this.#cooldownTimer = window.setTimeout(() => {
      this.#cooldownTimer = null;
      this.#navArrows.reset();
      this.#refreshWalkUi();
    }, NavigationService.#MOVE_DELAY);
  }

  /**
   * Updates the UI before moving to a new location, hiding certain elements and preventing interaction.
   */
  #updateUiBeforeMove() {
    // A move returns to Walk mode, as placing a label does (#5768). Done first, so a type picked mid-move sticks.
    // Skipped while switching is held, where the switch would be refused but still logged.
    if (this.#labelModes.getMode() !== 'Walk' && this.#labelModes.isUsable('Walk')) this.#labelModes.backToWalk();
    this.#moveState = 'moving';
    this.#moveStartedListeners.forEach((listener) => listener());
    this.#keyboardLock.hold('move');
    this.#panoManager.panning.hold('move');
    this.#refreshWalkUi();
  }

  /**
   * Updates the UI after moving to a new location, re-enabling certain elements and interactions.
   */
  #updateUiAfterMove() {
    this.#startCooldown();
    this.#panoManager.panning.release('move');
    this.#moveFinishedListeners.forEach((listener) => listener());

    try {
      this.#landedListeners.forEach((listener) => listener());
    } finally {
      // Even if the bookkeeping throws, so the labeler can walk again.
      // Position is final, so position-dependent checks can run again; heading views wait for the pov to settle.
      this.#moveState = 'settling';
      this.#refreshHeadingViewsAfterPovSettles();
      this.#keyboardLock.release('move');
    }
    this.#movedListeners.forEach((listener) => listener());
  }

  /**
   * Once the heading stops changing after a move (Mapillary animates it briefly), tells the views of it (peg, fog
   * cone, compass) to redraw; until then they keep their pre-move orientation. Stops if a new move begins, which
   * runs its own; GSV's pov is final at once, so it settles after a couple of ticks.
   */
  #refreshHeadingViewsAfterPovSettles() {
    if (this.#povSettlePoll) window.clearInterval(this.#povSettlePoll); // Replace any in-flight poll from a prior move.

    let prevHeading = this.#panoManager.getPov().heading;
    let stableTicks = 0;
    const startTime = performance.now();
    const pollMs = 80;
    const maxSettleMs = 1500; // Stop polling even if the heading never fully stabilizes.

    this.#povSettlePoll = window.setInterval(() => {
      if (this.#moveState === 'moving') { // A new move took over.
        window.clearInterval(this.#povSettlePoll);
        this.#povSettlePoll = null;
        return;
      }

      const heading = this.#panoManager.getPov().heading;
      const headingDelta = Math.abs(((heading - prevHeading + 540) % 360) - 180); // Shortest angular distance.
      prevHeading = heading;
      stableTicks = headingDelta < 0.5 ? stableTicks + 1 : 0;

      if (stableTicks >= 2 || performance.now() - startTime > maxSettleMs) {
        window.clearInterval(this.#povSettlePoll);
        this.#povSettlePoll = null;
        this.#moveState = 'idle'; // Settled first, so the listeners recompute from the settled pov.
        this.#headingSettledListeners.forEach((listener) => listener());
      }
    }, pollMs);
  }

  /** @param {boolean} raise - Drawing layer over the pano (clicks label) or under it (clicks pan and walk). */
  #raiseDrawingLayer(raise) {
    this.#ui.drawingLayer.style.zIndex = raise ? '1' : '0';
    this.#ui.viewControlLayer.style.zIndex = raise ? '0' : '1';
  }

  /**
   * Moves the labeler forward along the street.
   * @returns {Promise<string|null|void>} The new pano id; null if nothing loaded; undefined if they can't walk now.
   */
  async moveForward() {
    if (!this.canWalk()) return undefined;
    this.#updateUiBeforeMove();
    const result = await this.#sweepForward();
    return result.outcome === 'landed' ? result.panoId : null;
  }

  /**
   * Starts a move, runs `switchStreet`, then searches the new street. Allowed under a walking hold (finishing a
   * street can open the sign-in prompt), but not mid-move or just after one, so a double-click can't skip the prompt.
   * @param {() => void} switchStreet - Finishes the street being left and makes the next one current.
   * @returns {Promise<boolean>} Whether the move landed on a new pano.
   */
  async moveToNextStreet(switchStreet) {
    if (this.isMoving() || this.#cooldownTimer !== null) return false;

    // Before switchStreet(), or the compass flashes the off-route warning at the old location (#4174).
    this.#updateUiBeforeMove();
    try {
      switchStreet();
    } catch (err) {
      // The move locked everything, and no landing is coming to unlock it.
      this.#restoreUiAfterFailedMove();
      throw err;
    }
    const result = await this.#sweepForward();
    return result.outcome === 'landed';
  }

  /**
   * Sweeps for the next pano inside a move that has already started, then ends the move.
   * @returns {Promise<import('./StreetSweep.js').SweepResult>}
   */
  async #sweepForward() {
    let result;
    try {
      result = await this.#streetSweep.sweep(() => this.#updateUiBeforeMove());
    } catch (err) {
      this.#restoreUiAfterFailedMove();
      throw err;
    }
    if (result.outcome === 'stopped') {
      this.#restoreUiAfterFailedMove();
      result.afterMove?.();
    } else {
      // 'walkedOut' lands where they stand too.
      this.#updateUiAfterMove();
    }
    return result;
  }

  /**
   * Move to the linked pano closest to the given heading angle.
   * @param {number} heading - The user's heading in degrees.
   * @param {{alertOnFailure?: boolean}} [options] - Passed through to moveToPano; see its `alertOnFailure`.
   * @returns {Promise<boolean>}
   */
  moveToLinkedPano(heading, options) {
    if (!this.canWalk()) return Promise.resolve(false);

    // Figure out if there's a link close to the given heading.
    const currHeading = this.#panoManager.getPov().heading;
    const linkedPanos = this.#panoManager.panoViewer.getLinkedPanos();
    const cosines = linkedPanos.map((link) => {
      const headingAngleOffset = util.math.toRadians(currHeading + heading) - util.math.toRadians(link.heading);
      return Math.cos(headingAngleOffset);
    });
    const maxIndex = cosines.indexOf(Math.max.apply(null, cosines));
    if (cosines[maxIndex] > 0.5) {
      return this.moveToPano(linkedPanos[maxIndex].panoId, false, options);
    } else {
      return Promise.resolve(false);
    }
  }

  /**
   * Move to a specific pano ID.
   * @param {string} panoId - The string ID of the pano that we want to move to.
   * @param {boolean} [force=false] - If true, force a move despite walking being disabled. Used in tutorial.
   * @param {{alertOnFailure?: boolean}} [options] - `alertOnFailure` (default true) shows the labeler a message when
   *     the pano won't load. Pass false when the caller has a fallback that may still move them: a failure the
   *     caller recovers from isn't one the labeler needs to hear about, and reporting it anyway means a banner
   *     saying imagery couldn't be loaded on a step that did in fact happen.
   * @returns {Promise<boolean>}
   */
  async moveToPano(panoId, force = false, { alertOnFailure = true } = {}) {
    if (!this.canWalk() && !force) return Promise.resolve(false);

    this.#updateUiBeforeMove();
    try {
      await this.#panoManager.setPanorama(panoId);
    } catch (err) {
      // The move failed, so we haven't actually moved: re-enable the UI so that the user can try something else.
      this.#restoreUiAfterFailedMove();
      console.error(err);
      // Tell the user, so a step that goes nowhere reads as a failure rather than as a dead page. This targets one
      // specific pano that wouldn't load, which says nothing about the street, so nothing is recorded (#4918).
      if (alertOnFailure) {
        this.#alertController.showAlert(i18next.t('popup.imagery-load-failed'), 'imageryLoadFailed', false);
      }
      return false;
    }
    // A pano that loads ends any run of imagery failures, wherever the move came from, so the session gets its full
    // flag allowance back (#4918). Walking on via the link graph is as much evidence that imagery is fine as the
    // street-sweeping move in moveForward() is.
    NoImageryFlagGuard.reset();
    this.#updateUiAfterMove();

    return true;
  }

  /**
   * Moves to whatever pano the provider serves nearest a location, as a real move (the task advances, walking is
   * timed out, the views update). The minimap's forward crumbs use it when a crumb's pano id won't load (GSV retires
   * panos): the crumb still marks where imagery was, so searching there as moveForward() does is the right retry.
   *
   * The current pano is excluded from the search because a location a few metres ahead is usually still nearest to
   * the pano being stood on, and "moving" there would go nowhere.
   *
   * @param {{lat: number, lng: number}} latLng - Where to look for a pano.
   * @param {{alertOnFailure?: boolean}} [options] - As for moveToPano.
   * @returns {Promise<boolean>} Whether the move succeeded (false if walking is disabled or nothing loads there).
   */
  async moveToLocation(latLng, { alertOnFailure = true } = {}) {
    if (!this.canWalk()) return false;

    this.#updateUiBeforeMove();
    try {
      const currentPano = this.#panoStore.getPanoData(this.#panoManager.getPanoId());
      await this.#panoManager.setLocation(latLng, new Set(currentPano ? [currentPano] : []));
    } catch (err) {
      this.#restoreUiAfterFailedMove();
      console.error(err);
      if (alertOnFailure) {
        this.#alertController.showAlert(i18next.t('popup.imagery-load-failed'), 'imageryLoadFailed', false);
      }
      return false;
    }
    NoImageryFlagGuard.reset();
    this.#updateUiAfterMove();
    return true;
  }

  /**
   * Move to an already-visited pano and optionally face a POV. Used by the minimap's clickable markers to let the user
   * revisit a label or an earlier location (#4639, #2561).
   *
   * A "peek": the active audit task is left unchanged. Re-entering an earlier, already-completed street as the current
   * task would push a spurious TaskStart and risk the end-of-task auto-advance jumping the user straight back off the
   * pano they returned to.
   *
   * @param {string} panoId - Target (already-visited) pano id.
   * @param {{heading: number, pitch: number, zoom: number}} [pov] - POV to face on arrival; omit to keep heading.
   * @returns {Promise<boolean>} Whether the move succeeded (false if walking is disabled or the move failed).
   */
  async returnToPano(panoId, pov) {
    if (!this.canWalk()) return false;
    const moved = this.#panoManager.getPanoId() === panoId ? true : await this.moveToPano(panoId);
    if (moved && pov) this.#panoManager.setPov(pov);
    return moved;
  }

  /**
   * Re-enables the UI elements that #updateUiBeforeMove() disabled, w/out the updates that assume the position changed.
   */
  #restoreUiAfterFailedMove() {
    this.#moveState = 'idle';
    this.#navArrows.reset();
    this.#refreshWalkUi();
    this.#panoManager.panning.release('move');
    this.#moveFinishedListeners.forEach((listener) => listener());
    this.#keyboardLock.release('move');
  }
}
