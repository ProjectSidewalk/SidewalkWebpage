/**
 * The two privacy toggles on the post-signup welcome page (#4375), offered here because a new account's username is
 * about to be public.
 *
 * Each toggle saves the moment it's flipped: there's no Save button, and someone who clicks a box and walks away
 * should get what they clicked. It posts to the Settings endpoint, so one place writes these flags.
 *
 * A save sends both flags, so two of them in flight at once could land out of order and leave the page showing a
 * state the server doesn't hold. Only one runs at a time, and a flip made during one is saved after it settles.
 */
class WelcomePrivacy {
  // The save in flight, or null. A flip while one is running waits for it rather than racing it.
  #saving = null;

  // Whether a flip arrived mid-save and still needs writing.
  #pending = false;

  // The last state the server confirmed, so a failed save rolls back to what is actually stored.
  #saved;

  /** @param {Object} opts - Configuration; `saveUrl` is the Settings save endpoint. */
  constructor(opts) {
    this.saveUrl = opts.saveUrl;
    this.leaderboard = document.getElementById('wl-on-leaderboard');
    this.profile = document.getElementById('wl-public-profile');
    this.status = document.getElementById('wl-privacy-status');
    if (!this.leaderboard || !this.profile) return;

    // The server rendered these boxes from its own flags, so that is the confirmed state to start from.
    this.#saved = { onLeaderboard: this.leaderboard.checked, publicProfile: this.profile.checked };

    // Rendered disabled so that without JS they are visibly inert rather than silently dropping a privacy choice.
    [[this.leaderboard, 'Leaderboard'], [this.profile, 'PublicProfile']].forEach(([box, name]) => {
      box.disabled = false;
      box.addEventListener('change', () => {
        window.logWebpageActivity?.(`Click_module=WelcomePrivacy_setting=${name}_value=${box.checked}`);
        this.#queueSave();
      });
    });
  }

  /**
   * Runs a save, or marks one as owed if a save is already in flight. Both flags are sent every time, so a single
   * later save covers any flips made while waiting.
   *
   * @returns {Promise<void>}
   */
  async #queueSave() {
    if (this.#saving) {
      this.#pending = true;
      return;
    }
    this.#saving = this.#save();
    await this.#saving;
    this.#saving = null;
    if (this.#pending) {
      this.#pending = false;
      await this.#queueSave();
    }
  }

  /**
   * Writes both flags and reflects the outcome. On failure the boxes go back to what the server still holds, so the
   * page never shows a setting we didn't write.
   *
   * @returns {Promise<void>}
   */
  async #save() {
    const sent = { onLeaderboard: this.leaderboard.checked, publicProfile: this.profile.checked };
    this.#setStatus(i18next.t('dashboard:settings-form.saving'), null);

    const { ok, error } = await saveUserSettings(this.saveUrl, sent);
    if (ok) {
      this.#saved = sent;
      this.#setStatus(i18next.t('dashboard:settings-form.saved'), true);
      return;
    }
    // Roll back to the last state the server confirmed, not to the pre-click state: an earlier save may have moved it.
    this.leaderboard.checked = this.#saved.onLeaderboard;
    this.profile.checked = this.#saved.publicProfile;
    this.#setStatus(error || i18next.t('dashboard:settings-form.save-failed'), false);
  }

  /**
   * @param {string} text - The message to show.
   * @param {?boolean} ok - true saved, false failed, null in progress.
   */
  #setStatus(text, ok) {
    if (!this.status) return;
    this.status.textContent = text;
    this.status.classList.remove('saved', 'failed');
    if (ok === true) this.status.classList.add('saved');
    else if (ok === false) this.status.classList.add('failed');
  }
}
