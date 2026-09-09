/**
 * The two privacy toggles on the post-signup welcome page (#4375), offered here because a new account's username is
 * about to be public.
 *
 * Each toggle saves the moment it's flipped: there's no Save button, and someone who clicks a box and walks away
 * should get what they clicked. It posts to the Settings endpoint, so one place writes these flags.
 */
class WelcomePrivacy {
  /** @param {Object} opts - Configuration; `saveUrl` is the Settings save endpoint. */
  constructor(opts) {
    this.saveUrl = opts.saveUrl;
    this.leaderboard = document.getElementById('wl-on-leaderboard');
    this.profile = document.getElementById('wl-public-profile');
    this.status = document.getElementById('wl-privacy-status');
    if (!this.leaderboard || !this.profile) return;

    [[this.leaderboard, 'Leaderboard'], [this.profile, 'PublicProfile']].forEach(([box, name]) => {
      box.addEventListener('change', () => {
        window.logWebpageActivity?.(`Click_module=WelcomePrivacy_setting=${name}_value=${box.checked}`);
        this.#save(box);
      });
    });
  }

  /**
   * Sends only the two privacy fields; every other settings field is optional, so omitting it leaves it untouched.
   *
   * @param {HTMLInputElement} changed - The checkbox that was flipped, so a failed save can be put back.
   * @returns {Promise<void>}
   */
  async #save(changed) {
    const wasChecked = changed.checked;
    this.#setStatus(i18next.t('dashboard:settings-form.saving'), null);
    try {
      const res = await fetch(this.saveUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          onLeaderboard: this.leaderboard.checked,
          publicProfile: this.profile.checked,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        this.#setStatus(i18next.t('dashboard:settings-form.saved'), true);
        return;
      }
      // Server errors arrive already localized (Play messages keyed off the request language).
      this.#revert(changed, wasChecked, data.error || i18next.t('dashboard:settings-form.save-failed'));
    } catch {
      this.#revert(changed, wasChecked, i18next.t('dashboard:settings-form.save-failed'));
    }
  }

  /**
   * Puts a checkbox back when its save didn't land, so the page never shows a setting we didn't write.
   *
   * @param {HTMLInputElement} box - The checkbox to restore.
   * @param {boolean} wasChecked - What it was set to when the save started.
   * @param {string} message - The failure to show.
   */
  #revert(box, wasChecked, message) {
    box.checked = !wasChecked;
    this.#setStatus(message, false);
  }

  /**
   * @param {string} text - The message to show.
   * @param {?boolean} ok - true saved, false failed, null in progress.
   */
  #setStatus(text, ok) {
    if (!this.status) return;
    this.status.textContent = text;
    this.status.classList.toggle('failed', ok === false);
  }
}
