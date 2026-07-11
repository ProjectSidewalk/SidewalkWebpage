/**
 * Saves the User Dashboard Settings form (#4323) in one request: an optional username change plus the two privacy
 * flags and the user's team. Posts JSON to the settings save endpoint; CSRF is added by the global fetch wrapper.
 * A rejected username (taken, too short, disallowed characters, profanity) comes back as a 400 with a message that
 * is shown inline without applying the rest.
 */
class Settings {
  /**
     * @param {Object} opts - Configuration.
     * @param {string} opts.saveUrl - Endpoint the form POSTs to.
     * @param {string} opts.currentUsername - The user's existing username, so an edit to the same value is a no-op.
     */
  constructor(opts) {
    this.saveUrl = opts.saveUrl;
    this.currentUsername = opts.currentUsername;
    this.saveBtn = document.getElementById('set-save-btn');
    this.status = document.getElementById('set-save-status');
    if (this.saveBtn) this.saveBtn.addEventListener('click', () => this.#save());
  }

  /**
     * Reads the form, posts it, and reflects the outcome in the status line.
     * @returns {Promise<void>}
     */
  async #save() {
    const usernameEl = document.getElementById('set-username');
    const teamEl = document.getElementById('set-team');
    const username = (usernameEl?.value || '').trim();
    const teamVal = teamEl ? teamEl.value : '';
    const payload = {
      username,
      onLeaderboard: document.getElementById('set-on-leaderboard')?.checked ?? true,
      publicProfile: document.getElementById('set-public-profile')?.checked ?? true,
      // Empty string = "No team"; send null so the server leaves any current team.
      teamId: teamVal === '' ? null : parseInt(teamVal, 10),
    };

    this.saveBtn.setAttribute('disabled', 'disabled');
    this.#setStatus('Saving…', null);
    try {
      const res = await fetch(this.saveUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        this.currentUsername = username || this.currentUsername;
        this.#setStatus('Saved ✓', true);
      } else {
        this.#setStatus(data.error || 'Couldn\'t save your changes. Please try again.', false);
      }
    } catch (e) {
      console.error('Failed to save settings', e);
      this.#setStatus('Couldn\'t save your changes. Please try again.', false);
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
