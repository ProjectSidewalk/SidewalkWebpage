/**
 * Tells the labeler when the street they were just handed is a re-audit: one audited before whose every completed
 * audit now predates newer street-view imagery (#4895).
 *
 * Without this, a labeler who remembers mapping a street reads its reappearance as the system having lost their
 * work, and one who doesn't can't tell a refresh from a first pass. Everything it says rides on the task payload
 * (`AuditTaskTable.streetAuditState`), so serving a re-audit street costs no request of its own.
 *
 * The wording splits on who did the earlier pass: "you last mapped this street" is the case #4895 is really about,
 * while a street somebody else mapped gets the same news without claiming the reader's memory of it. That split keeps
 * this consistent with the minimap's earlier-label eras (#4945), which are the user's own work only -- on a street
 * mapped by others there are no dimmed markers, and the toast no longer implies there should be.
 *
 * Nothing here blocks the walk: the toast is informational, sits over the pano, and fades on its own. A street switch
 * retires the notice, queued or on screen, because a toast about a street the labeler has been moved off is noise
 * (#5472).
 */

import { Toast } from '../../common/Toast.js';
import { util } from '../../common/utilities.js';
/** @typedef {import('../task/Task.js').Task} Task */
/** @typedef {import('../data/Tracker.js').Tracker} Tracker */

export class ReauditNotice {
  /** How long the toast stays up. Longer than the 10 s resume toasts it shares the spot with: this one is news. */
  static DURATION_MS = 12000;

  #tracker;
  /** Streets whose toast has been on screen this session. A notice that only queued and never showed is not here. */
  #shownStreetIds = new Set();
  /**
   * The notice raised for the street being walked, kept so the next street switch can retire it. Explore hands over
   * several streets in a row when it skips ones with no imagery, and each hand-over would otherwise leave a toast
   * queued over `#pano` that plays after the labeler has left the street it describes (#5472).
   * @type {?{streetEdgeId: number, toast: Toast}}
   */
  #pending = null;

  /**
   * @param {Tracker} tracker
   */
  constructor(tracker) {
    this.#tracker = tracker;
  }

  /**
   * Retires the previous street's notice and raises one for this task if it is a re-audit not yet announced.
   *
   * Called for every street hand-over, re-audit or not, since the retirement half applies to all of them. Keyed by
   * street rather than by call, since `PanoManager` can reverse without a `setCurrentTask`: coming back to a street
   * already announced is silent. The street counts as announced only once its toast is actually on screen
   * (`onShow`): a notice retired while still queued behind another toast leaves the street un-announced, so the
   * labeler still gets it if they land on the street again.
   *
   * @param {Task} task - The task that just became current.
   * @returns {boolean} Whether a notice was raised for this street, on screen or queued behind another toast.
   */
  showForTask(task) {
    if (!task) return false;
    const streetEdgeId = task.getStreetEdgeId();
    this.#retireUnlessFor(streetEdgeId);
    if (!task.getProperty('needsReaudit')) return false;
    if (this.#shownStreetIds.has(streetEdgeId)) return false;
    // `setCurrentTask` can run twice for one street (a re-render, a jump resolving to the street already current);
    // the notice already waiting for it stands.
    if (this.#pending?.streetEdgeId === streetEdgeId) return false;

    const lastMapped = util.monthYear(task.getProperty('lastMappedAt'));
    const newImagery = util.monthYear(task.getProperty('newImageryDate'));
    const byThisUser = Boolean(task.getProperty('mappedByThisUser'));
    // Both dates or neither: the sentence reads as a comparison, so half of one is worse than none.
    const haveDates = Boolean(lastMapped && newImagery);
    const key = `right-ui.reaudit.message-${byThisUser ? 'you' : 'others'}${haveDates ? '' : '-no-dates'}`;

    const toast = Toast.show({
      title: i18next.t('right-ui.reaudit.title'),
      message: haveDates ? i18next.t(key, { lastMapped, newImagery }) : i18next.t(key),
      reference: document.getElementById('pano'),
      dark: true,
      duration: ReauditNotice.DURATION_MS,
      // Can fire inside Toast.show(), before `#pending` is set below; it touches neither, so the order is harmless.
      onShow: () => {
        this.#shownStreetIds.add(streetEdgeId);
        this.#tracker.push('ReauditToast_Shown', {
          streetEdgeId,
          mappedByThisUser: byThisUser,
          lastMappedAt: task.getProperty('lastMappedAt') ?? null,
          newImageryDate: task.getProperty('newImageryDate') ?? null,
        });
      },
      onClose: () => this.#tracker.push('Click_ReauditToast_Close', { streetEdgeId }),
    });
    this.#pending = { streetEdgeId, toast };
    return true;
  }

  /**
   * Drops the pending notice unless it is for the street just handed over. A queued toast is removed from the
   * queue unseen; one on screen fades, since it now describes somewhere the labeler no longer is. `dismiss()` is
   * idempotent, so a handle whose toast already faded on its own is harmless to retire.
   *
   * @param {number} streetEdgeId - The street that just became current.
   * @returns {void}
   */
  #retireUnlessFor(streetEdgeId) {
    if (!this.#pending || this.#pending.streetEdgeId === streetEdgeId) return;
    this.#pending.toast.dismiss();
    this.#pending = null;
  }
}
