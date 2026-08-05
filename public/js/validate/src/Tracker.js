/**
 * Logs information from the Validation interface.
 */
class Tracker {
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

  constructor() {
    this.#trackWindowEvents();
  }

  #trackWindowEvents() {
    const prefix = 'LowLevelEvent_';

    // track all mouse related events
    $(document).on('mousedown mouseup mouseover mouseout mousemove click contextmenu dblclick', (e) => {
      this.push(prefix + e.type, {
        cursorX: 'pageX' in e ? e.pageX : null,
        cursorY: 'pageY' in e ? e.pageY : null,
      });
    });

    // keyboard related events
    $(document).on('keydown keyup', (e) => {
      this.push(prefix + e.type, {
        keyCode: 'keyCode' in e ? e.keyCode : null,
      });
    });
  }

  /**
   * @param {string} action
   * @param {object} notes
   */
  #createAction(action, notes) {
    const panoViewer = svv.panoManager && svv.panoViewer ? svv.panoViewer : null;
    const position = panoViewer ? panoViewer.getPosition() : { lat: null, lng: null };
    const pov = panoViewer ? panoViewer.getPov() : { heading: null, pitch: null, zoom: null };

    const missionContainer = svv.missionContainer ? svv.missionContainer : null;
    const currentMission = missionContainer ? missionContainer.getCurrentMission() : null;

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

  getActions() {
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
   * @param {object} [notes] Notes to be logged into the notes field database.
   */
  push(action, notes) {
    const item = this.#createAction(action, notes);
    this.#actions.push(item);
    if (this.#actions.length > Tracker.#MAX_BUFFERED_ACTIONS) {
      const data = svv.form.compileSubmissionData(false);
      svv.form.submit(data, true); // Note that this happens async
    } else if (this.#flushTimeout === null) {
      // First push since the last flush: schedule the next timed flush. refresh() cancels this timer on every drain,
      // so an idle tab (whose buffer holds only the post-flush RefreshTracker marker) never schedules one.
      this.#flushTimeout = window.setTimeout(() => this.#flush(), Tracker.#FLUSH_INTERVAL_MS);
    }
    return this;
  }

  /**
   * Flushes buffered interactions mid-mission, off the timer armed by push().
   *
   * Every drain path funnels through refresh(), which cancels the pending timer, so this only fires when the buffer
   * holds unflushed interactions.
   */
  #flush() {
    this.#flushTimeout = null;
    if (!svv.form) return; // Init hasn't finished; the next push re-arms the timer.
    const data = svv.form.compileSubmissionData(false);
    svv.form.submit(data, true); // Note that this happens async
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
