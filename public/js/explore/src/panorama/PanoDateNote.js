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
    // Focusable so the psTooltip explaining the note is reachable by keyboard; it is the only way to that text.
    this.#noteEl.tabIndex = 0;
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
   * Redraws the corner for a pano and the street it belongs to.
   *
   * Both halves are required so that neither can be retained from an earlier call: `setCurrentTask` swaps to the
   * next street while the labeler still stands on the previous street's final pano, so a kept capture date would be
   * compared — and logged — against a street it was never on.
   *
   * @param {?string} captureDateIso - Capture date of the pano now showing.
   * @param {?Task} task - The task whose street that pano sits on.
   */
  update(captureDateIso, task) {
    this.#captureDateIso = captureDateIso;
    this.#task = task;

    const captureDate = util.monthYear(this.#captureDateIso, { short: true });
    const lastMappedAt = this.#task ? this.#task.getProperty('lastMappedAt') : null;
    const state = PanoDateNote.stateFor(this.#captureDateIso, lastMappedAt);

    const byThisUser = this.#task ? Boolean(this.#task.getProperty('mappedByThisUser')) : false;

    // Someone else's assessment is withheld: Project Sidewalk wants independent ones, and their labels are never
    // drawn here (`getLabelsToResumeMission` is scoped to the requester), so it would only imply redundancy.
    // An unreadable date lands here too rather than hiding the element, which is PanoInfoPopover's container: a pano
    // with broken metadata is when its id and position are most wanted.
    if (captureDate === null
      || state === PanoDateNote.STATE.UNAUDITED
      || (state === PanoDateNote.STATE.ALREADY_MAPPED && !byThisUser)) {
      // No "Image:" prefix and no chip: nothing sits beside the date to distinguish it from, and with no chip
      // surface an empty date leaves the bare info button the corner carried before #5413.
      this.#datePillEl.classList.remove('svl-pano-pill');
      this.#dateEl.textContent = captureDate ?? '';
      this.#noteEl.hidden = true;
      return;
    }

    const reaudit = state === PanoDateNote.STATE.REAUDIT;
    this.#datePillEl.classList.add('svl-pano-pill');
    this.#dateEl.textContent = i18next.t('right-ui.pano-date-note.image-date', { date: captureDate });
    // The state, not a date: the imagery chip beside it already carries one, and two dates left the eye to work out
    // which way round they ran.
    this.#noteEl.textContent = i18next.t(
      reaudit ? 'right-ui.pano-date-note.needs-reassessment' : 'right-ui.pano-date-note.already-assessed');
    this.#noteEl.classList.toggle('svl-pano-pill--action', reaudit);

    // Why the two dates matter does not fit a chip, and prose wants spelled-out months. Only the re-assessment half
    // splits on authorship; the other is only ever the labeler's own.
    const tipKey = reaudit
      ? `right-ui.pano-date-note.needs-reassessment-tip-${byThisUser ? 'you' : 'others'}`
      : 'right-ui.pano-date-note.already-assessed-tip';
    this.#noteEl.setAttribute('data-ps-tooltip', i18next.t(tipKey, {
      assessedDate: util.monthYear(lastMappedAt),
      captureDate: util.monthYear(this.#captureDateIso),
      // psTooltip renders this attribute through innerHTML. Two dates of ours need no escaping today; escaping
      // costs nothing on a date and covers whoever interpolates something a user wrote here later. One level, not
      // the two a markup-parsed attribute needs -- setAttribute does no parsing, so innerHTML is the only consumer.
      interpolation: { escapeValue: true },
    }));
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
