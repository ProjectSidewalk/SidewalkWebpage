/**
 * The two privacy toggles on the post-signup welcome page (#4375).
 *
 * Each toggle saves the moment it's flipped: there's no Save button, and someone who clicks a box and walks away
 * should get what they clicked. Both boxes are disabled while a save is in flight, so two saves can't land out of
 * order, and a failed save puts the box back rather than leaving a setting on screen that wasn't written.
 */
class WelcomePrivacy {
  /** @param {Object} opts - Configuration; `saveUrl` is the Settings save endpoint. */
  constructor(opts) {
    this.saveUrl = opts.saveUrl;
    this.leaderboard = document.getElementById('wl-on-leaderboard');
    this.profile = document.getElementById('wl-public-profile');
    this.status = document.getElementById('wl-privacy-status');
    if (!this.leaderboard || !this.profile) return;

    // Rendered disabled so that without JS they are visibly inert rather than silently dropping a privacy choice.
    this.#setEnabled(true);
    [[this.leaderboard, 'Leaderboard'], [this.profile, 'PublicProfile']].forEach(([box, name]) => {
      box.addEventListener('change', () => {
        window.logWebpageActivity?.(`Click_module=WelcomePrivacy_setting=${name}_value=${box.checked}`);
        this.#save(box);
      });
    });
  }

  /**
   * @param {HTMLInputElement} changed - The box that was flipped, so a failed save can put it back.
   * @returns {Promise<void>}
   */
  async #save(changed) {
    const wasChecked = changed.checked;
    this.#setEnabled(false);
    this.#setStatus(i18next.t('dashboard:settings-form.saving'), null);

    const { ok, error } = await saveUserSettings(this.saveUrl, {
      onLeaderboard: this.leaderboard.checked,
      publicProfile: this.profile.checked,
    });
    if (ok) {
      this.#setStatus(i18next.t('dashboard:settings-form.saved'), true);
    } else {
      changed.checked = !wasChecked;
      this.#setStatus(error || i18next.t('dashboard:settings-form.save-failed'), false);
    }
    this.#setEnabled(true);
  }

  /** @param {boolean} enabled - Whether the boxes accept clicks. */
  #setEnabled(enabled) {
    this.leaderboard.disabled = !enabled;
    this.profile.disabled = !enabled;
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
