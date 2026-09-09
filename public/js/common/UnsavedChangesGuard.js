/**
 * UnsavedChangesGuard — warns before a page with unsaved edits is left, and offers to save them first.
 *
 * There are two ways off a page and the browser only lets us style one of them:
 *   - A link click is caught in the capture phase, so the navigation can be held while the app's own ConfirmDialog
 *     asks what to do. The click's destination is honoured either way — the guard follows it once a save resolves.
 *   - A refresh, a tab close, or a Back are only reachable through `beforeunload`, where every browser shows its
 *     own generic text and ignores anything we pass. That's the backstop: it can warn, but it can't offer a save.
 *
 * `isDirty` is asked fresh each time, so a caller only has to keep its own baseline up to date after a save.
 */
class UnsavedChangesGuard {
  #isDirty;
  #save;
  #onChoice;
  #leaving = false; // Set while the guard navigates, so the beforeunload backstop doesn't prompt about its own trip.

  /**
   * Arms the guard for the life of the page.
   * @param {Object} opts
   * @param {function(): boolean} opts.isDirty - Whether there are unsaved edits right now.
   * @param {function(): Promise<boolean>} opts.save - Saves the edits, resolving true if the save succeeded.
   * @param {function(string): void} [opts.onChoice] - Called with the button the user picked ('save', 'discard',
   *     or 'stay'), to log it in the page's own activity naming.
   */
  constructor({ isDirty, save, onChoice = null }) {
    this.#isDirty = isDirty;
    this.#save = save;
    this.#onChoice = onChoice;
    window.addEventListener('beforeunload', (e) => {
      if (!this.#leaving && this.#isDirty()) e.preventDefault();
    });
    // Capture phase: the guard has to cancel the click before a page's own link handlers act on it.
    document.addEventListener('click', (e) => this.#onClick(e), true);
  }

  /**
   * Asks the user what to do about unsaved edits, saving them if that's what they choose. Public so a page that
   * navigates or reloads on its own (rather than through a link) can gate that on the same prompt.
   * @returns {Promise<boolean>} True if it's now fine to leave — nothing was unsaved, the save succeeded, or the
   *     user chose to discard. False if the user wants to stay, or a save they asked for failed.
   */
  async allowLeave() {
    if (!this.#isDirty()) return true;
    const choice = await ConfirmDialog.choose({
      message: i18next.t('common:unsaved-changes.message'),
      buttons: [
        { id: 'stay', text: i18next.t('common:cancel') },
        { id: 'discard', text: i18next.t('common:unsaved-changes.leave') },
        { id: 'save', text: i18next.t('common:unsaved-changes.save'), style: 'primary' },
      ],
      dismissValue: 'stay',
    });
    this.#onChoice?.(choice);
    // A failed save keeps the user on the page with their edits and the save's own error message in front of them.
    if (choice === 'save') return this.#save();
    return choice === 'discard';
  }

  /**
   * Holds a leaving click while the user is asked about their edits, then follows it if they're done here.
   * @param {MouseEvent} e - The captured click.
   */
  async #onClick(e) {
    const destination = this.#navigationTarget(e);
    if (!destination || !this.#isDirty()) return;
    e.preventDefault();
    if (!(await this.allowLeave())) return;
    this.#leaving = true;
    window.location.assign(destination);
  }

  /**
   * Where a click is about to take this tab, if it's leaving. A modified click (new tab/window/download), a link
   * with another target, a non-http scheme, and a jump to an anchor on this same page all leave the page in place,
   * so none of them can lose an edit.
   * @param {MouseEvent} e - The captured click.
   * @returns {string|null} The absolute URL being navigated to, or null if this click won't navigate away.
   */
  #navigationTarget(e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
    const link = e.target?.closest?.('a[href]');
    if (!link || link.hasAttribute('download')) return null;
    if (link.target && link.target !== '_self') return null;
    let url;
    try {
      url = new URL(link.getAttribute('href'), window.location.href);
    } catch {
      return null; // A href the URL parser rejects isn't one we can reason about; leave it to the browser.
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    // Compare everything but the hash: a link that only moves to an anchor doesn't reload the page.
    const samePage = (loc) => `${loc.origin}${loc.pathname}${loc.search}`;
    if (samePage(url) === samePage(window.location)) return null;
    return url.href;
  }
}
