/**
 * Tells the labeler when the street they were just handed is a re-audit: one audited before whose every completed
 * audit now predates newer street-view imagery (#4895).
 *
 * Without this, a labeler who remembers mapping a street reads its reappearance as the system having lost their
 * work, and one who doesn't can't tell a refresh from a first pass. Everything it says rides on the task payload
 * (`AuditTaskTable.streetAuditState`), so serving a re-audit street costs no request of its own.
 *
 * The wording splits on who did the earlier pass: "you last mapped this street" is the case #4895 is really about, while a
 * street somebody else mapped gets the same news without claiming the reader's memory of it. That split also keeps
 * this consistent with the minimap's earlier-label eras (#4945), which are the user's own work only -- on a street
 * mapped by others there are no dimmed markers, and the toast no longer implies there should be.
 *
 * Nothing here blocks the walk: the toast is informational, sits over the pano, and fades on its own.
 */
class ReauditNotice {
  /** How long the toast stays up. Longer than the 10 s resume toasts it shares the spot with: this one is news. */
  static DURATION_MS = 12000;

  #tracker;
  #shownStreetIds = new Set();

  /**
   * @param {Tracker} tracker
   */
  constructor(tracker) {
    this.#tracker = tracker;
  }

  /**
   * Shows the notice for a task if it is a re-audit and hasn't been announced yet this session.
   *
   * Keyed by street rather than by call, since `PanoManager` can reverse without a `setCurrentTask`: coming back to
   * a street already announced is silent. The street counts as announced only once the toast is raised, or a notice
   * still queued behind another would burn it for the session.
   *
   * @param {Task} task - The task that just became current.
   * @returns {boolean} Whether a toast was shown.
   */
  showForTask(task) {
    if (!task || !task.getProperty('needsReaudit')) return false;
    const streetEdgeId = task.getStreetEdgeId();
    if (this.#shownStreetIds.has(streetEdgeId)) return false;

    const lastMapped = this.#monthYear(task.getProperty('lastMappedAt'));
    const newImagery = this.#monthYear(task.getProperty('newImageryDate'));
    const byThisUser = Boolean(task.getProperty('mappedByThisUser'));
    // Both dates or neither: the sentence reads as a comparison, so half of one is worse than none.
    const haveDates = Boolean(lastMapped && newImagery);
    const key = `right-ui.reaudit.message-${byThisUser ? 'you' : 'others'}${haveDates ? '' : '-no-dates'}`;

    this.#shownStreetIds.add(streetEdgeId);
    this.#tracker.push('ReauditToast_Shown', {
      streetEdgeId,
      mappedByThisUser: byThisUser,
      lastMappedAt: task.getProperty('lastMappedAt') ?? null,
      newImageryDate: task.getProperty('newImageryDate') ?? null,
    });
    Toast.show({
      title: i18next.t('right-ui.reaudit.title'),
      message: haveDates ? i18next.t(key, { lastMapped, newImagery }) : i18next.t(key),
      reference: document.getElementById('pano'),
      dark: true,
      duration: ReauditNotice.DURATION_MS,
      onClose: () => this.#tracker.push('Click_ReauditToast_Close', { streetEdgeId }),
    });
    return true;
  }

  /**
   * Month precision, which is all GSV capture dates carry. Null for a missing or unparseable value, so the sentence
   * drops to the dateless wording rather than printing a raw timestamp at the labeler.
   *
   * @param {?string} iso - A date (`2019-03-01`) or timestamp string.
   * @returns {?string}
   */
  #monthYear(iso) {
    if (!iso) return null;
    // A bare date parses as UTC midnight, which west of Greenwich is the evening before -- and for a first-of-month
    // capture date that is the wrong month. Reading the calendar fields directly sidesteps the zone entirely.
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    const date = dateOnly
      ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
      : new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString(i18next.language, { month: 'long', year: 'numeric' });
  }
}
