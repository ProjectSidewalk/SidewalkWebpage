/**
 * Logs information from the Validation interface.
 */

/** @typedef {import('./panorama/PanoManager.js').PanoManager} PanoManager */
/** @typedef {import('./mission/MissionContainer.js').MissionContainer} MissionContainer */

export class Tracker {
  #actions = [];
  #flushTimeout = null;

  // Flush buffered interactions roughly once a minute of activity (#4429) so that a page killed without firing
  // pagehide (crash, OOM kill — common on mobile) loses at most ~1 minute of logs. Time is the unit that actually
  // bounds that loss; an action count's meaning shifts whenever logging verbosity changes (see #2745). The count
  // threshold stays as a backstop so an unthrottled event storm can't grow an oversized payload within one interval.
  // Browsers throttle background-tab timers to >=1/min, which only delays a flush — a hidden tab generates no new
  // interactions, and the pagehide handler covers actual exits.
  static #FLUSH_INTERVAL_MS = 60000;
  static #MAX_BUFFERED_ACTIONS = 200;
  // How long after a verdict its flush waits for the next one (flushSoon). Long enough to fold a quick run of taps
  // into one POST, short enough that a page killed between labels has already sent the verdict before it.
  static #VERDICT_FLUSH_DELAY_MS = 1000;

  /**
   * @type {?PanoManager} Registered by PanoManager's constructor (trackPano): the tracker is built before it, since
   * the manager logs through the tracker, and each action is stamped with whatever pano its live viewer is showing.
   */
  #panoManager = null;

  /** @type {?MissionContainer} Registered by MissionContainer's constructor (trackMissions), for the same reason. */
  #missionContainer = null;

  /** @type {?(() => void)} Registered by the Form (onFlush), which owns compiling and sending a buffer. */
  #onFlush = null;

  /**
   * Built first, before anything that logs, so nothing has to cope with its absence. What it reports on arrives
   * later through trackPano(), trackMissions() and onFlush().
   */
  constructor() {
    this.#trackWindowEvents();
  }

  /**
   * Names the pano manager whose live viewer stamps each action with the pano on screen.
   * @param {PanoManager} panoManager
   */
  trackPano(panoManager) {
    this.#panoManager = panoManager;
  }

  /**
   * Names the mission container whose current mission each action is filed under.
   * @param {MissionContainer} missionContainer
   */
  trackMissions(missionContainer) {
    this.#missionContainer = missionContainer;
  }

  /**
   * Registers what sends the buffer when a flush is due: the Form, once it exists. A flush falling due before then
   * is dropped, and the next push arms the timer again.
   * @param {() => void} listener
   */
  onFlush(listener) {
    this.#onFlush = listener;
  }

  #trackWindowEvents() {
    const prefix = 'LowLevelEvent_';

    const mouseEvents = [
      'mousedown', 'mouseup', 'mouseover', 'mouseout', 'mousemove', 'click', 'contextmenu', 'dblclick',
    ];
    for (const type of mouseEvents) {
      document.addEventListener(type, (/** @type {MouseEvent} */ e) => {
        // A keyboard shortcut's scripted click has no cursor; logging 0/0 would look like a real click in the corner.
        this.push(prefix + e.type, { cursorX: e.isTrusted ? e.pageX : null, cursorY: e.isTrusted ? e.pageY : null });
      });
    }

    for (const type of ['keydown', 'keyup']) {
      document.addEventListener(type, (/** @type {KeyboardEvent} */ e) => {
        // Don't log which keys went into a password (e.g. the navbar's sign-in dialog).
        const isPassword = e.target instanceof HTMLInputElement && e.target.type === 'password';
        this.push(prefix + e.type, isPassword ? {} : { code: e.code });
      });
    }
  }

  /**
   * @param {string} action
   * @param {object} notes
   */
  #createAction(action, notes) {
    // The manager has a viewer from partway through its own create(), and a push from inside that (the first label's
    // pano going to Pannellum) has to be able to ask it about the pano; before then there is nothing to report.
    const panoViewer = this.#panoManager?.panoViewer ?? null;
    // Both are null until the viewer's first pano has loaded, and the first push can land before then: when the
    // first label's pano is expired, the primary viewer never loads one and Pannellum takes over mid-init.
    const position = (panoViewer && panoViewer.getPosition()) || { lat: null, lng: null };
    const pov = panoViewer ? panoViewer.getPov() : { heading: null, pitch: null, zoom: null };

    const currentMission = this.#missionContainer ? this.#missionContainer.getCurrentMission() : null;

    return {
      action,
      pano_id: panoViewer ? panoViewer.getPanoId() : null,
      lat: position.lat,
      lng: position.lng,
      heading: pov ? pov.heading : null,
      pitch: pov ? pov.pitch : null,
      zoom: pov ? pov.zoom : null,
      mission_id: currentMission ? currentMission.getProperty('missionId') : null,
      note: this.#notesToString(notes || {}),
      timestamp: new Date(),
    };
  }

  /**
   * The buffered actions, ready to submit.
   *
   * An action pushed during init lands before the mission container exists (the first pano loads first), so it was
   * created without a mission id. Every such action belongs to the mission the page then started, which is the
   * current one at the first drain, so it is filled in here rather than left as a row nothing can join to.
   *
   * @returns {Array<object>} The actions, oldest first.
   */
  getActions() {
    const currentMission = this.#missionContainer ? this.#missionContainer.getCurrentMission() : null;
    if (currentMission) {
      const missionId = currentMission.getProperty('missionId');
      for (const action of this.#actions) if (action.mission_id === null) action.mission_id = missionId;
    }
    return this.#actions;
  }

  #notesToString(notes) {
    if (!notes) {
      return '';
    }

    let noteString = '';
    for (const key in notes) {
      if (noteString.length > 0) {
        noteString += ',';
      }
      noteString += `${key}:${notes[key]}`;
    }

    return noteString;
  }

  /**
   * Pushes information to action list (to be submitted to the database).
   * @param {string} action
   * @param {object} [notes] - Notes to be logged into the notes field database.
   */
  push(action, notes) {
    const item = this.#createAction(action, notes);
    this.#actions.push(item);
    if (this.#actions.length > Tracker.#MAX_BUFFERED_ACTIONS) {
      this.#flush();
    } else if (this.#flushTimeout === null) {
      // First push since the last flush: schedule the next timed flush. refresh() cancels this timer on every drain,
      // so an idle tab (whose buffer holds only the post-flush RefreshTracker marker) never schedules one.
      this.#flushTimeout = window.setTimeout(() => this.#flush(), Tracker.#FLUSH_INTERVAL_MS);
    }
    return this;
  }

  /**
   * Pulls the pending flush forward so what is buffered now reaches the server within about a second (#5561).
   *
   * The 60 s deadline bounds what an unexpected end to the page loses, but on a phone the end iOS hands out is a
   * memory kill that fires no `pagehide`, and a minute of validating is most of a mission. A verdict is worth more
   * than the interactions around it, so LabelContainer calls this after recording one: the mission then loses at
   * most the label on screen. The delay coalesces a burst of taps into one POST rather than one each; a later call
   * resets it, so the flush lands `delayMs` after the last verdict of the burst. refresh() cancels it on any other
   * drain, the same as the deadline it replaces.
   *
   * @param {number} [delayMs] - How long to wait for more before flushing.
   */
  flushSoon(delayMs = Tracker.#VERDICT_FLUSH_DELAY_MS) {
    window.clearTimeout(this.#flushTimeout);
    this.#flushTimeout = window.setTimeout(() => this.#flush(), delayMs);
  }

  /**
   * Flushes buffered interactions mid-mission, off the timer armed by push() or flushSoon(), or the count backstop.
   *
   * Every drain path funnels through refresh(), which cancels the pending timer, so this only fires when the buffer
   * holds unflushed interactions. The send itself is the Form's (onFlush), and happens async.
   */
  #flush() {
    window.clearTimeout(this.#flushTimeout);
    this.#flushTimeout = null;
    this.#onFlush?.();
  }

  /**
   * Empties actions stored in the Tracker.
   */
  refresh() {
    this.#actions = [];
    this.push('RefreshTracker');
    // Every drain path (timed flush, count backstop, mission complete, pagehide) funnels through this method, so
    // clearing the timer here — after the RefreshTracker push above, which would otherwise re-arm it — both cancels
    // any pending flush and keeps an idle tab quiet: the lone marker never triggers a timed flush on its own.
    window.clearTimeout(this.#flushTimeout);
    this.#flushTimeout = null;
  }
}
