/**
 * Compiles and submits Validate interaction and validation data to the back end.
 */

import { util } from '../../common/utilities.js';
/** @typedef {import('../Main.js').ValidateConfig} ValidateConfig */
/** @typedef {import('../Tracker.js').Tracker} Tracker */

/**
 * What a page with a mission submits for, and what it moves on through once the mission is done.
 * @typedef {object} FormSession
 * @property {import('../mission/MissionContainer.js').MissionContainer} missionContainer
 * @property {import('../label/LabelContainer.js').LabelContainer} labelContainer
 * @property {import('../../common/pano-viewer/PanoStore.js').PanoStore} panoStore
 * @property {import('../modal/ModalMissionComplete.js').ModalMissionComplete} modalMissionComplete
 * @property {import('../modal/ModalNoNewMission.js').ModalNoNewMission} modalNoNewMission
 */

export class Form {
  #dataStoreUrl;
  /** @type {ValidateConfig} */
  #config;
  /** @type {Tracker} */
  #tracker;
  /**
   * @type {?FormSession} Null on the dead-end page (no mission to validate): it still logs the visit, but there is
   * nothing to compile a mission or its labels from and no next mission to move on to.
   */
  #session;

  // Resubmit a failed POST a bounded number of times before giving up, so a transient mobile-network blip doesn't
  // lose data — and, crucially, never reload the page (a reload mid-mission resets the user to the first label and,
  // when it loops, triggers the browser's "A problem repeatedly occurred" crash page — issue #2745).
  static #MAX_SUBMIT_RETRIES = 5;
  static #RETRY_BACKOFF_MS = 2000;

  // A browser refuses a keepalive request outright once the bodies of those in flight pass 64 KB, so a flush bigger
  // than this goes out as an ordinary request, which at least sends if the page lives.
  static #KEEPALIVE_MAX_BYTES = 60000;

  // Submits go out one at a time (#5561). Every POST carries the mission's absolute `labels_progress`, and verdicts
  // now flush within a second of each other, so two requests in flight at once could land in either order and the
  // older one would move progress backwards. A retry holds the queue too, for the same reason.
  #queue = Promise.resolve();

  /**
   * @type {Map<number, object>} The `mission_progress` most recently compiled for each mission. A retry carries the
   * progress its payload was compiled with, which is stale once a later payload for the mission has gone out; it is
   * replaced with this before the resend, so a retry that lands late can't undo a newer progress or an undo.
   */
  #latestProgress = new Map();

  /**
   * @param {string} url - URL to send validation/interaction data to.
   * @param {ValidateConfig} config - Names the Validate UI the data comes from and carries the validate params.
   * @param {Tracker} tracker - The interaction buffer every submit drains; its timed flushes send through here.
   * @param {?FormSession} session - The mission being validated, or null on the dead-end page.
   */
  constructor(url, config, tracker, session) {
    this.#dataStoreUrl = url;
    this.#config = config;
    this.#tracker = tracker;
    this.#session = session;

    // The tracker decides when a mid-mission flush is due; this is what sends it.
    tracker.onFlush(() => this.submit(this.compileSubmissionData(false), true));
    // A finished mission is submitted at once, with its completed flag, so the response can carry the next one.
    session?.missionContainer.onMissionComplete(() => this.submit(this.compileSubmissionData(true)));

    // Flush any remaining logs when the page is being dismissed. `pagehide` is the reliable, bfcache-compatible
    // unload signal (#3935).
    window.addEventListener('pagehide', () => this.#flushOnExit('Unload'));
    // And when it is merely hidden (#5561): the phone locked, another app in front, the tab switcher. On iOS that is
    // the state a tab is killed from when memory runs short, and a killed page fires no pagehide, so whatever is
    // buffered as it goes hidden is what a kill would lose. Nothing is sent twice: the buffer this drains is the one
    // the pagehide handler would otherwise have found.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.#flushOnExit('PageHidden');
    });
  }

  /**
   * Sends everything buffered in a POST that outlives the page.
   *
   * `keepalive` is what lets it, while still routing through AppManager's fetch wrapper, which attaches the
   * `Csrf-Token` header Play's CSRF filter requires (#3935).
   *
   * The two reasons get different treatment. On `pagehide` the page is going, so the request is fired and forgotten:
   * nothing is left to log to or retry from. Going hidden is routine and the page usually comes back, so that flush
   * is a real send: logged and retried on failure like any other, only sent ahead of the queue, because a retry
   * backoff waiting in it would hold the flush past the moment the page could be killed.
   *
   * @param {string} reason - The interaction recorded alongside, naming what prompted the flush.
   */
  #flushOnExit(reason) {
    this.#tracker.record(reason);
    const data = Form.#snapshot(this.compileSubmissionData(false));
    this.#noteProgress(data);
    const body = JSON.stringify(data);
    const keepalive = body.length <= Form.#KEEPALIVE_MAX_BYTES;
    if (reason === 'Unload') {
      fetch(this.#dataStoreUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body,
        keepalive,
      }).catch(() => {
        // The page is gone: nothing can retry this, and nowhere is left to log it.
      });
      return;
    }
    // Ahead of the queue by design: a retry backoff waiting in it would hold this flush past the moment the page can
    // be killed, and what this carries is newer than anything queued. The trade is that it can cross a send already
    // in flight, and the server then keeps whichever lands last; the buffers are disjoint, so nothing is duplicated.
    this.#send(data, true, keepalive);
  }

  /**
   * A copy of a payload that later edits to the buffered objects can't reach.
   *
   * An undo edits the verdict object it takes back in place (`undone`), and that object may be the very one a
   * failed POST is about to resend, so the resend would carry the retraction and delete the vote cast after it.
   *
   * @param {Record<string, any>} data - As compileSubmissionData built it.
   * @returns {Record<string, any>} The same payload with its own verdict objects.
   */
  static #snapshot(data) {
    return { ...data, validations: (data.validations ?? []).map((validation) => ({ ...validation })) };
  }

  /**
   * Records a freshly compiled payload's mission progress as the latest for its mission.
   * @param {Record<string, any>} data - The payload, as compiled, before any send.
   */
  #noteProgress(data) {
    const progress = data.mission_progress;
    if (progress) this.#latestProgress.set(progress.mission_id, { ...progress });
  }

  /**
   * Gives a payload about to be resent the latest progress compiled for its mission.
   *
   * Only a resend is ever behind: a fresh payload is compiled from the mission as it is now, which makes it the
   * latest by definition, undo and all. A resend still carries the verdicts it was compiled with, and its own
   * `completed` flag: that says which server path this request is (the mission-complete submit whose response
   * starts the next mission, or a flush that must not), and swapping it would leave the validator waiting on a
   * mission-complete modal that nothing answers.
   *
   * @param {Record<string, any>} data - The payload about to be resent.
   */
  #refreshProgress(data) {
    const progress = data.mission_progress;
    const latest = progress && this.#latestProgress.get(progress.mission_id);
    if (latest) data.mission_progress = { ...latest, completed: progress.completed };
  }

  /**
   * Compiles data into a format that can be parsed by our back end.
   *
   * @param {boolean} missionComplete - Whether the mission is complete. Ensures we only send once per mission.
   * @returns {object} The log data to submit.
   */
  compileSubmissionData(missionComplete) {
    const data = { timestamp: new Date(), source: this.#config.source };
    const session = this.#session;
    const mission = session ? session.missionContainer.getCurrentMission() : null;

    const labelList = session ? session.labelContainer.getLabelsToSubmit() : null;
    // Only submit mission progress if there is a mission when we're compiling submission data.
    if (mission) {
      // Add the current mission
      data.mission_progress = {
        mission_id: mission.getProperty('missionId'),
        mission_type: mission.getProperty('missionType'),
        labels_progress: mission.getProperty('labelsProgress'),
        labels_total: mission.getProperty('labelsValidated'),
        label_type: mission.getProperty('labelType'),
        completed: missionComplete ? missionComplete : false,
      };
    }

    // Only include labels if there is a label list when we're compiling submission data.
    if (labelList) {
      data.validations = labelList;
      session.labelContainer.refresh();
    } else {
      data.validations = [];
    }

    data.environment = {
      mission_id: mission ? mission.getProperty('missionId') : null,
      browser: util.getBrowser(),
      browser_version: util.getBrowserVersion(),
      browser_width: document.documentElement.clientWidth,
      browser_height: document.documentElement.clientHeight,
      screen_width: screen.width,
      screen_height: screen.height,
      avail_width: screen.availWidth,              // total width - interface (taskbar)
      avail_height: screen.availHeight,            // total height - interface ;
      operating_system: util.getOperatingSystem(),
      language: i18next.language,
      css_zoom: 100, // Sent for back-end compatibility; UI scaling is done via real layout sizes (--ui-scale).
    };

    data.validate_params = this.#config.validateParams;

    data.interactions = this.#tracker.getActions();

    data.pano_histories = [];
    if (session) {
      const panoramas = session.panoStore.getStagedPanoData();
      for (let i = 0; i < panoramas.length; i++) {
        const panoData = panoramas[i].getProperties();
        const panoHist = {
          curr_pano_id: panoData.panoId,
          pano_history_saved: new Date(),
          history: panoData.history.map((prevPano) => {
            return {
              pano_id: prevPano.panoId,
              date: util.localIsoDate(prevPano.captureDate).slice(0, 7),
            };
          }),
        };

        data.pano_histories.push(panoHist);
        panoramas[i].setProperty('submitted', true);
      }
    }

    this.#tracker.refresh();
    return data;
  }

  /**
   * Submits all front-end data to the back end.
   *
   * Network/parse failures and response-handling errors are handled separately and deliberately: a transiently
   * failed POST is retried (with the same snapshot, so nothing is lost) and never reloads the page, while an error
   * thrown while applying the response is logged but never retried (the data already reached the server, so
   * resubmitting would duplicate it). See #2745 — the previous blanket `catch -> location.reload()` reset users to
   * the first label and caused a reload/crash loop on mobile.
   *
   * Sends queue behind one another (see `#queue`); the returned promise settles once this payload's first attempt
   * has, with any retries following on the queue.
   *
   * @param {Record<string, any>} data   - Data object (containing interactions, missions, etc.).
   * @param {boolean} [isIntermediateSubmit=false] - True for the Tracker's mid-mission buffer flush, which only
   *                                       persists logs/validations and must NOT process a mission transition.
   * @returns {Promise<void>}
   */
  submit(data, isIntermediateSubmit = false) {
    const snapshot = Form.#snapshot(data);
    this.#noteProgress(snapshot);
    let firstAttemptSettled;
    const firstAttempt = new Promise((resolve) => {
      firstAttemptSettled = resolve;
    });
    // The queue turn lasts for the whole delivery, retries included, so nothing submitted meanwhile — an undo of a
    // verdict still in flight, say — can go out ahead of a resend and be overwritten by it.
    const turn = this.#queue.then(() => this.#send(snapshot, isIntermediateSubmit, false, firstAttemptSettled));
    this.#queue = turn.catch(() => {});
    return firstAttempt;
  }

  /**
   * Delivers a payload: attempt, back off and retry until it lands or the budget is spent, then act on the response.
   *
   * @param {Record<string, any>} data     - The payload, already snapshotted.
   * @param {boolean} isIntermediateSubmit - True when the response carries no mission transition to act on.
   * @param {boolean} keepalive            - Whether the request may outlive the page.
   * @param {Function} [onFirstAttempt]    - Called once the first attempt has settled: after a failure, or once a
   *                                         success's response has been applied.
   * @returns {Promise<void>}
   */
  async #send(data, isIntermediateSubmit, keepalive, onFirstAttempt = () => {}) {
    let result;
    for (let attempt = 0; ; attempt++) {
      if (attempt > 0) this.#refreshProgress(data);
      try {
        const response = await fetch(this.#dataStoreUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify(data),
          keepalive,
        });
        if (!response.ok) {
          throw Object.assign(new Error(`Validation submit failed with HTTP ${response.status}`), {
            status: response.status,
          });
        }
        result = await response.json();
        break;
      } catch (submitError) {
        if (attempt === 0) onFirstAttempt();
        // Do not reload — retry the same snapshot with backoff so the validations eventually reach the server when
        // connectivity returns. Network errors, timeouts and 5xx are worth retrying; a 4xx means the request itself
        // is the problem (malformed body, expired session) and would fail identically on a resend. 408 and 429 are
        // the server asking us to come back later (#4377).
        const status = submitError.status;
        const retryable = !(status >= 400 && status < 500) || status === 408 || status === 429;
        this.#tracker.push('SubmitFailed', { attempt, status, error: submitError.message });
        if (retryable && attempt < Form.#MAX_SUBMIT_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, Form.#RETRY_BACKOFF_MS * (attempt + 1)));
          continue;
        }
        if (!retryable) console.error('Validation submit rejected by the server:', submitError.message);
        this.#tracker.push('SubmitFailedGaveUp', { attempts: attempt, retryable });
        return;
      }
    }

    // An intermediate flush only persists data; it never expects (and must not act on) a mission transition.
    if (isIntermediateSubmit) {
      onFirstAttempt();
      return;
    }

    // The data is already saved server-side, so a failure here must not trigger a retry or reload — just log it.
    // Only a mission-complete submit reaches here, and only a page with a mission makes one.
    const { missionContainer, labelContainer, modalMissionComplete, modalNoNewMission }
      = /** @type {FormSession} */ (this.#session);
    try {
      // If a mission was returned after posting data, create a new mission.
      if (result.has_mission_available) {
        if (result.mission) {
          missionContainer.createAMission(result.mission, result.progress);
          labelContainer.resetLabelList(result.labels, result.mission.label_type);
          await labelContainer.renderCurrentLabel();
          modalMissionComplete.nextMissionLoaded(missionContainer.getCurrentMission());
        }
      } else {
        // Otherwise, display popup that says there are no more labels left.
        modalMissionComplete.hide();
        modalNoNewMission.show();
      }
    } catch (handlerError) {
      console.error('Error applying validation submit response:', handlerError);
    }
    // A delivery that landed settles the caller's promise only once its response has been applied, so a caller
    // that awaits a mission-complete submit sees the next mission in place.
    onFirstAttempt();
  }
}
