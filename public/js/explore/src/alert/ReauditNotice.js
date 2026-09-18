/**
 * Tells the labeler when the street they were just handed is a re-audit: one audited before whose every completed
 * audit now predates newer street-view imagery (#4895).
 *
 * Without this, a labeler who remembers mapping a street reads its reappearance as the system having lost their
 * work, and one who doesn't can't tell a refresh from a first pass. The server marks the street on the task payload
 * (`needs_reaudit`, from `AuditTaskTable.streetAuditState`); the dates the toast quotes come from the same summary
 * the dashboard's re-audit list reads, fetched only for streets that are actually re-audits, so a city with nothing
 * flagged never pays for a request. Nothing here blocks the walk: the toast is informational, sits over the pano, and
 * fades on its own.
 */
class ReauditNotice {
  /** How long the toast stays up, matching the resume toasts it shares the spot with. */
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
   * Every street switch and direction reversal passes through `TaskContainer.setCurrentTask`, so the notice is keyed
   * by street rather than by call: a reversal on a street already announced is silent, and so is coming back to it.
   *
   * @param {Task} task - The task that just became current.
   * @param {{afterMs?: number}} [opts] - Delay before showing, for when another toast has just taken the spot.
   * @returns {Promise<boolean>} Whether a toast was shown.
   */
  async showForTask(task, opts = {}) {
    if (!task || !task.getProperty('needsReaudit')) return false;
    const streetEdgeId = task.getStreetEdgeId();
    if (this.#shownStreetIds.has(streetEdgeId)) return false;
    this.#shownStreetIds.add(streetEdgeId);

    const summary = await this.#fetchSummary(streetEdgeId);
    if (opts.afterMs) await new Promise((resolve) => setTimeout(resolve, opts.afterMs));
    // The street may have been left behind while the fetch was in flight; a toast about a street the labeler is no
    // longer on would be exactly the confusion this notice exists to prevent.
    if (svl.taskContainer && svl.taskContainer.getCurrentTaskStreetEdgeId() !== streetEdgeId) return false;

    const lastMapped = summary && summary.last_audited_at ? this.#monthYear(summary.last_audited_at) : null;
    const newImagery = summary && summary.new_imagery_date ? this.#monthYear(summary.new_imagery_date) : null;
    const message = lastMapped && newImagery
      ? i18next.t('right-ui.reaudit.message', { lastMapped, newImagery })
      : i18next.t('right-ui.reaudit.message-no-dates');

    this.#tracker.push('ReauditToast_Shown', {
      streetEdgeId,
      lastAuditedAt: summary ? summary.last_audited_at ?? null : null,
      newImageryDate: summary ? summary.new_imagery_date ?? null : null,
    });
    Toast.show({
      title: i18next.t('right-ui.reaudit.title'),
      message,
      reference: document.getElementById('pano'),
      dark: true,
      duration: ReauditNotice.DURATION_MS,
      onClose: () => this.#tracker.push('Click_ReauditToast_Close', { streetEdgeId }),
    });
    return true;
  }

  /**
   * The street's last audit and newest imagery dates, or null when the request fails or the server answers 404
   * because a fresh audit by another labeler already covers the street. Either way the notice still shows, with the
   * dateless message: the payload flag is the fact, the dates are decoration.
   *
   * @param {number} streetEdgeId
   * @returns {Promise<?{last_audited_at: string, new_imagery_date: ?string}>}
   */
  async #fetchSummary(streetEdgeId) {
    try {
      const response = await fetch(`/contribution/street/${streetEdgeId}/reauditSummary`);
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }

  /**
   * "March 2019" in the page's language. Capture dates come at month precision from GSV, so anything finer would
   * claim more than the data knows.
   *
   * @param {string} iso - A date (`2019-03-01`) or timestamp string.
   * @returns {string}
   */
  #monthYear(iso) {
    // A bare date parses as UTC midnight, which west of Greenwich is the evening before -- and for a first-of-month
    // capture date that is the wrong month. Reading the calendar fields directly sidesteps the zone entirely.
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    const date = dateOnly
      ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
      : new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleDateString(i18next.language, { month: 'long', year: 'numeric' });
  }
}
