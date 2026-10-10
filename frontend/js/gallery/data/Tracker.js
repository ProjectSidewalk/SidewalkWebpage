/**
 * Logs information from the Gallery.
 */

/** @typedef {import('./Form.js').Form} Form */

export class Tracker {
  static #FLUSH_AT = 10;

  #form;
  #actions = [];

  /**
   * @param {Form} form - Where batches of actions are sent.
   */
  constructor(form) {
    this.#form = form;

    // `pagehide` is the reliable, bfcache-compatible unload signal.
    window.addEventListener('pagehide', () => {
      this.push('Unload');
      this.flush({ keepalive: true });
    });
  }

  /**
   * Creates action to be added to action buffer.
   *
   * @param {string} action - Action name.
   * @param {?{panoId: string}} suppData - Optional supplementary data about action.
   * @param {?object} notes - Optional notes about action.
   */
  #createAction(action, suppData, notes) {
    if (!notes) {
      notes = {};
    }

    const note = this.#notesToString(notes);
    const timestamp = new Date();

    const data = {
      action,
      pano_id: suppData && suppData.panoId ? suppData.panoId : null,
      note,
      timestamp,
    };

    return data;
  }

  /**
   * Return list of actions.
   */
  getActions() {
    return this.#actions;
  }

  /**
   * Convert notes object to string.
   *
   * @param {*} notes - Notes object.
   */
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
   *
   * @param {string} action - Action name.
   * @param {?{panoId: string}} [suppData] - Supplementary data to be logged about action.
   * @param {?object} [notes] - Notes to be logged into the notes field in database.
   */
  push(action, suppData, notes) {
    const item = this.#createAction(action, suppData, notes);
    this.#actions.push(item);

    if (this.#actions.length > Tracker.#FLUSH_AT) this.flush();
    return this;
  }

  /**
   * Sends everything buffered so far and starts a fresh buffer.
   * @param {{keepalive?: boolean}} [options] - Passed on to the form; see Form.submit().
   */
  flush(options = {}) {
    const data = this.#form.compileSubmissionData(this.#actions);
    this.refresh();
    this.#form.submit(data, options);
  }

  /**
   * Empties actions stored in the Tracker.
   */
  refresh() {
    this.#actions = [];
    this.push('RefreshTracker');
  }
}
