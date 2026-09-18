/**
 * The persistent imagery-era note in Explore's bottom-left corner, beside the capture date (#5413).
 *
 * Explore's re-audit signal is street-level — `audit_task.outdated_imagery` comes from
 * `street_imagery.median_newest_capture`, a median across sample points — but imagery refreshes per pano. A street
 * can span years of captures (Teaneck's street 1755 runs 2021-10 to 2024-10), so on its older panos the street-level
 * "this street has newer imagery" claim is false at the spot the labeler is standing. #4895's toast says it once per
 * street and fades after 12 s, which leaves nothing on screen at the moment the question actually comes up: why are
 * labels from an earlier pass drawn on this pano?
 *
 * The answer is per-pano, so this note is too: it compares *this* pano's capture date against the street's last
 * audit and says which side of it the labeler is on. On imagery older than their last pass it says so outright,
 * which is what explains the earlier labels on the canvas (`LabelContainer.getCanvasLabels` buckets by exact pano id,
 * so unchanged imagery keeps its labels). It reads only what is already on the task payload and in the pano
 * metadata, so it costs no request.
 */
class PanoDateNote {
  /**
   * What this pano is, relative to the street's last completed audit.
   * - `unaudited`: never audited, or no date to compare — show the bare capture date, as Explore always has.
   * - `reaudit`: this pano is newer than the last audit, so there is genuinely something new to map here.
   * - `already-mapped`: this pano is the imagery that was already mapped.
   */
  static STATE = { UNAUDITED: 'unaudited', REAUDIT: 'reaudit', ALREADY_MAPPED: 'already-mapped' };

  #tracker;
  #datePillEl;
  #dateEl;
  #noteEl;

  // Street ids already logged, keyed with the state, because a street's state legitimately changes as the labeler
  // walks it -- a partly-refreshed street is exactly what this note exists for. Keying on the street alone would
  // record whichever end they happened to start from and hide the mix.
  #loggedStates = new Set();

  #captureDateIso = null;
  #task = null;

  /**
   * @param {Tracker} tracker
   * @param {HTMLElement} holderEl - The bottom-left corner (#svl-panorama-date-holder).
   * @param {HTMLElement} datePillEl - The capture-date pill, which also holds PanoInfoPopover's button.
   * @param {HTMLElement} dateEl - The capture-date span inside that pill, which this class now owns.
   */
  constructor(tracker, holderEl, datePillEl, dateEl) {
    this.#tracker = tracker;
    this.#datePillEl = datePillEl;
    this.#dateEl = dateEl;

    // A second pill beside the date's, built here rather than in the Twirl view so the view does not carry markup
    // that is empty on most streets.
    this.#noteEl = document.createElement('span');
    this.#noteEl.id = 'svl-pano-date-note';
    this.#noteEl.className = 'svl-pano-pill';
    this.#noteEl.hidden = true;
    holderEl.appendChild(this.#noteEl);
  }

  /**
   * The year and month of an ISO date or timestamp, as a comparable integer.
   *
   * Read straight off the string rather than through Date: both inputs already carry the calendar month we want (the
   * capture date is month-granular to begin with, and a timestamp's offset is the one it was recorded in), so
   * parsing would only introduce the chance of a timezone shifting the answer by a month.
   *
   * @param {?string} iso - A date (`2024-10-01`) or timestamp (`2024-07-07T12:00:00-07:00`) string.
   * @returns {?number} e.g. 202410, or null if there is no usable year and month.
   */
  static monthKey(iso) {
    const match = /^(\d{4})-(\d{2})/.exec(iso ?? '');
    return match ? Number(match[1]) * 100 + Number(match[2]) : null;
  }

  /**
   * Classifies a pano against the street's last audit.
   *
   * An equal month counts as already-mapped: capture dates carry only a month, so a pano captured in the same month
   * the street was audited cannot be shown to be newer, and claiming a re-audit we can't prove is the worse error.
   *
   * @param {?string} captureDateIso - This pano's capture date.
   * @param {?string} lastMappedAt - The street's last completed audit (this user's if they have one).
   * @returns {string} One of PanoDateNote.STATE.
   */
  static stateFor(captureDateIso, lastMappedAt) {
    const captured = PanoDateNote.monthKey(captureDateIso);
    const mapped = PanoDateNote.monthKey(lastMappedAt);
    if (captured === null || mapped === null) return PanoDateNote.STATE.UNAUDITED;
    return captured > mapped ? PanoDateNote.STATE.REAUDIT : PanoDateNote.STATE.ALREADY_MAPPED;
  }

  /**
   * Redraws the corner for the pano and street now showing. Safe to call with either half unchanged: the pano moves
   * far more often than the street, but `lastMappedAt` changes with the street alone.
   *
   * @param {object} [update]
   * @param {?string} [update.captureDateIso] - This pano's capture date; omit to keep the last one.
   * @param {?Task} [update.task] - The current task; omit to keep the last one.
   */
  update({ captureDateIso, task } = {}) {
    if (captureDateIso !== undefined) this.#captureDateIso = captureDateIso;
    if (task !== undefined) this.#task = task;

    const captureDate = util.monthYear(this.#captureDateIso, { short: true });
    const lastMappedAt = this.#task ? this.#task.getProperty('lastMappedAt') : null;
    const state = PanoDateNote.stateFor(this.#captureDateIso, lastMappedAt);

    // The pill stays hidden until there is a date to put in it, or the corner shows an empty chip with the info
    // button floating inside it.
    this.#datePillEl.hidden = captureDate === null;

    // Nothing to compare against: the bare date Explore has always shown. Labelling it "Image:" would only add a
    // word to a line that has nothing to distinguish it from.
    if (state === PanoDateNote.STATE.UNAUDITED) {
      this.#dateEl.textContent = captureDate ?? '';
      this.#noteEl.hidden = true;
      return;
    }

    const mappedDate = util.monthYear(lastMappedAt, { short: true });
    const byThisUser = Boolean(this.#task.getProperty('mappedByThisUser'));
    this.#dateEl.textContent = i18next.t('right-ui.pano-date-note.image-date', { date: captureDate });
    this.#noteEl.textContent
      = state === PanoDateNote.STATE.REAUDIT
        ? i18next.t('right-ui.pano-date-note.last-audited', { date: mappedDate })
        : i18next.t(
            byThisUser
              ? 'right-ui.pano-date-note.mapped-this-view-you'
              : 'right-ui.pano-date-note.mapped-this-view-others',
            { date: mappedDate },
          );
    this.#noteEl.hidden = false;
    this.#log(state, lastMappedAt, byThisUser);
  }

  /**
   * Records each state a street is seen in, once. Per-pano would fire on every step down a street; per-street would
   * hide the partly-refreshed streets that motivate the note.
   *
   * @param {string} state
   * @param {?string} lastMappedAt
   * @param {boolean} byThisUser
   */
  #log(state, lastMappedAt, byThisUser) {
    const streetEdgeId = this.#task.getStreetEdgeId();
    const key = `${streetEdgeId}:${state}`;
    if (this.#loggedStates.has(key)) return;
    this.#loggedStates.add(key);
    this.#tracker.push('PanoDateNote_Shown', {
      streetEdgeId,
      state,
      captureDate: this.#captureDateIso ?? null,
      lastMappedAt: lastMappedAt ?? null,
      mappedByThisUser: byThisUser,
    });
  }
}
