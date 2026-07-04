/**
 * Logs information from the Gallery.
 */
class Tracker {
  #actions = [];

  /**
     * Creates action to be added to action buffer.
     *
     * @param {string} action Action name.
     * @param suppData Optional supplementary data about action.
     * @param notes Optional notes about action.
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
     * @param {*} notes Notes object.
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
     * @param {string} action Action name.
     * @param [suppData] Supplementary data to be logged about action.
     * @param [notes] Notes to be logged into the notes field in database.
     */
  push(action, suppData, notes) {
    const item = this.#createAction(action, suppData, notes);
    this.#actions.push(item);

    // TODO: change action buffer size limit
    if (this.#actions.length > 10) {
      const data = sg.form.compileSubmissionData();
      sg.form.submit(data);
    }
    return this;
  }

  /**
     * Empties actions stored in the Tracker.
     */
  refresh() {
    this.#actions = [];
    this.push('RefreshTracker');
  }
}
