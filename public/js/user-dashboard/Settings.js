/**
 * Saves the User Dashboard Settings form (#4323) in one request: an optional username change plus the two privacy
 * flags, the service-hours opt-in (#4375), the measurement-units choice (#4404), and the user's team. Posts JSON to
 * the settings save endpoint; CSRF is added by the global fetch wrapper.
 * A rejected username (taken, too short, disallowed characters, profanity) comes back as a 400 with a message that
 * is shown inline without applying the rest.
 * Nothing saves as you type, so an UnsavedChangesGuard offers to save pending edits on the way out (#5226).
 */
class Settings {
  // The form's values as of the last save (or the page load), as JSON. Anything else on screen is an unsaved edit.
  #baseline;

  /**
     * @param {Object} opts - Configuration.
     * @param {string} opts.saveUrl - Endpoint the form POSTs to.
     * @param {string} opts.currentUsername - The user's existing username, so an edit to the same value is a no-op.
     * @param {string} opts.currentUnits - The user's existing units choice ('auto', 'metric', or 'imperial'), so a
     *   save that changes it can reload the page onto the new units.
     */
  constructor(opts) {
    this.saveUrl = opts.saveUrl;
    this.currentUsername = opts.currentUsername;
    this.currentUnits = opts.currentUnits;
    this.saveBtn = document.getElementById('set-save-btn');
    this.status = document.getElementById('set-save-status');
    this.#baseline = this.#snapshot();
    if (this.saveBtn) this.saveBtn.addEventListener('click', () => this.#save());
    // The guard's save skips the units reload: the page they're headed to renders in the new units anyway, and
    // reloading this one would strand them here.
    new UnsavedChangesGuard({
      isDirty: () => this.#snapshot() !== this.#baseline,
      save: () => this.#save({ reloadOnUnitsChange: false }),
      onChoice: (choice) => window.logWebpageActivity?.(`Click_module=UnsavedSettings_choice=${choice}`),
    });
  }

  /** @returns {Object} The form's current values, in the shape the save endpoint takes. */
  #payload() {
    const teamEl = document.getElementById('set-team');
    const teamVal = teamEl?.value ?? '';
    return {
      username: (document.getElementById('set-username')?.value || '').trim(),
      onLeaderboard: document.getElementById('set-on-leaderboard')?.checked ?? true,
      publicProfile: document.getElementById('set-public-profile')?.checked ?? true,
      communityService: document.getElementById('set-community-service')?.checked ?? false,
      // 'auto' = follow the site language; the server clears the override cookie rather than setting one.
      measurementSystem: document.getElementById('set-units')?.value ?? 'auto',
      // null tells the server not to touch team membership: the "Choose a team…" placeholder, or the team they're
      // already on. Leaving is the Leave button (TeamActions.js), never a save (#5147).
      teamId: teamVal === '' || teamVal === teamEl.dataset.currentTeam ? null : parseInt(teamVal, 10),
    };
  }

  /** @returns {string} The form's current values, comparable against the baseline. */
  #snapshot() {
    return JSON.stringify(this.#payload());
  }

  /**
     * Reads the form, posts it, and reflects the outcome in the status line.
     *
     * @param {Object} [opts]
     * @param {boolean} [opts.reloadOnUnitsChange=true] - Whether a save that moves the units reloads the page so
     *   every distance on screen is redrawn in them.
     * @returns {Promise<boolean>} Whether the settings were saved.
     */
  async #save({ reloadOnUnitsChange = true } = {}) {
    const payload = this.#payload();

    this.saveBtn.setAttribute('disabled', 'disabled');
    this.#setStatus(i18next.t('dashboard:settings-form.saving'), null);
    try {
      const res = await fetch(this.saveUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        this.currentUsername = payload.username || this.currentUsername;
        // Hand the written team to the controls, so a second save skips it and Leave speaks for it, not the old one.
        if (payload.teamId !== null) TeamActions.settingsTeamSaved(payload.teamId);
        // What was just written is the baseline now, with teamId flattened to the null a team already joined sends,
        // so the save that moved onto it doesn't leave the form looking edited.
        this.#baseline = JSON.stringify({ ...payload, teamId: null });
        const unitsChanged = payload.measurementSystem !== this.currentUnits;
        this.currentUnits = payload.measurementSystem;
        // Units are read from a stamp the server writes into the page, so a change only takes effect on the next
        // render. Reload rather than leave every distance on screen in the units the user just moved away from.
        if (unitsChanged && reloadOnUnitsChange) {
          window.location.reload();
          return true;
        }
        this.#setStatus(i18next.t('dashboard:settings-form.saved'), true);
        return true;
      }
      // Server errors arrive already localized (Play messages keyed off the request language).
      this.#setStatus(data.error || i18next.t('dashboard:settings-form.save-failed'), false);
      return false;
    } catch (e) {
      console.error('Failed to save settings', e);
      this.#setStatus(i18next.t('dashboard:settings-form.save-failed'), false);
      return false;
    } finally {
      this.saveBtn.removeAttribute('disabled');
    }
  }

  /**
     * Updates the inline status message next to the Save button.
     * @param {string} text - Message to show.
     * @param {boolean|null} ok - true = success styling, false = error styling, null = neutral.
     */
  #setStatus(text, ok) {
    if (!this.status) return;
    this.status.textContent = text;
    this.status.classList.remove('ud-save-ok', 'ud-save-err');
    if (ok === true) this.status.classList.add('ud-save-ok');
    else if (ok === false) this.status.classList.add('ud-save-err');
  }
}
