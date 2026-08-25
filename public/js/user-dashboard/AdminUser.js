/**
 * Drives the Manage user page beside a user's dashboard (#4964): saves the admin-editable account settings in one PUT
 * to /adminapi/saveUserSettings, sets or clears the low-quality/incomplete flags on every task the user completed
 * before a chosen date, and localizes the Explore-comment timestamps. A rejected save (username taken, a permission
 * rule) comes back as a 400 whose message is shown inline without applying anything.
 */
class AdminUser {
  #userId;
  #username;
  #saveUrl;
  #flagsUrl;
  #pageUrlFor;
  #saveBtn;
  #saveStatus;

  /**
   * @param {Object} opts
   * @param {string} opts.userId - The user being administered.
   * @param {string} opts.username - Their current username.
   * @param {string} opts.saveUrl - Endpoint the settings form PUTs to.
   * @param {string} opts.flagsUrl - Endpoint the by-date task flags PUT to.
   * @param {(username: string) => string} opts.pageUrlFor - This page's URL for a given username; the page is
   *     keyed by username, so a rename navigates to the renamed address.
   */
  constructor(opts) {
    this.#userId = opts.userId;
    this.#username = opts.username;
    this.#saveUrl = opts.saveUrl;
    this.#flagsUrl = opts.flagsUrl;
    this.#pageUrlFor = opts.pageUrlFor;
    this.#saveBtn = document.getElementById('au-save-btn');
    this.#saveStatus = document.getElementById('au-save-status');
    this.#saveBtn?.addEventListener('click', () => this.#save());

    document.querySelectorAll('.ud-admin-flag').forEach((block) => {
      block.querySelector('.ud-admin-flag-set').addEventListener('click', () => this.#setFlags(block, true));
      block.querySelector('.ud-admin-flag-remove').addEventListener('click', () => this.#setFlags(block, false));
    });

    document.querySelectorAll('time.ud-admin-ts').forEach((el) => {
      const at = new Date(el.getAttribute('datetime'));
      if (!Number.isNaN(at.getTime())) el.textContent = moment(at).format('lll');
    });
  }

  /** Reads the form, PUTs it, and reflects the outcome (and any new computed quality) on the page. */
  async #save() {
    const quality = document.getElementById('au-quality').value;
    const infra3d = document.getElementById('au-infra3d-access');
    const payload = {
      userId: this.#userId,
      username: document.getElementById('au-username').value.trim(),
      role: document.getElementById('au-role').value,
      teamId: parseInt(document.getElementById('au-team').value, 10) || null,
      // 'auto' clears the manual flag so the server recomputes quality from the user's stats.
      highQualityManual: quality === 'auto' ? null : quality === 'true',
      communityService: document.getElementById('au-community-service').checked,
      onLeaderboard: document.getElementById('au-on-leaderboard').checked,
      publicProfile: document.getElementById('au-public-profile').checked,
    };
    // Absent on non-infra3D deployments and inert when the admin can't grant it; either way it's left alone.
    if (infra3d && !infra3d.disabled) payload.infra3dAccess = infra3d.checked;

    this.#saveBtn.setAttribute('disabled', 'disabled');
    AdminUser.#setStatus(this.#saveStatus, 'Saving…', null);
    try {
      const res = await fetch(this.#saveUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        if (data.username && data.username !== this.#username) {
          window.location.assign(this.#pageUrlFor(data.username));
          return;
        }
        AdminUser.#setStatus(this.#saveStatus, 'Saved ✓', true);
        const hq = document.getElementById('au-high-quality');
        if (hq && typeof data.high_quality === 'boolean') hq.textContent = data.high_quality ? 'High' : 'Low';
      } else {
        AdminUser.#setStatus(this.#saveStatus, data.error || 'Save failed.', false);
      }
    } catch (e) {
      console.error('Failed to save user settings', e);
      AdminUser.#setStatus(this.#saveStatus, 'Save failed.', false);
    } finally {
      this.#saveBtn.removeAttribute('disabled');
    }
  }

  /**
   * Sets or clears one flag on every task the user completed before the block's chosen date.
   * @param {HTMLElement} block - The `.ud-admin-flag` block (carries `data-flag` and its date input + status line).
   * @param {boolean} state - True to set the flag, false to clear it.
   */
  async #setFlags(block, state) {
    const status = block.querySelector('.ud-admin-flag-status');
    const dateInput = block.querySelector('.ud-admin-flag-date');
    if (!dateInput.value) {
      AdminUser.#setStatus(status, 'Choose a date first.', false);
      return;
    }
    // The input's value is a calendar date; the cutoff is local midnight on it, matching how the admin reads it.
    const [y, m, d] = dateInput.value.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const flag = block.dataset.flag;
    const buttons = block.querySelectorAll('button');
    buttons.forEach((b) => b.setAttribute('disabled', 'disabled'));
    AdminUser.#setStatus(status, 'Updating…', null);
    try {
      const res = await fetch(this.#flagsUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ userId: this.#userId, date: date.toISOString(), flag, state }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const n = data.tasks_updated ?? 0;
      const tasks = n === 1 ? '1 task' : `${n} tasks`;
      const when = date.toLocaleDateString();
      const message = state ? `Flagged ${tasks} before ${when}.` : `Cleared the flag on ${tasks} before ${when}.`;
      AdminUser.#setStatus(status, message, true);
    } catch (e) {
      console.error('Failed to update task flags', e);
      AdminUser.#setStatus(status, 'Flags failed to change.', false);
    } finally {
      buttons.forEach((b) => b.removeAttribute('disabled'));
    }
  }

  /**
   * @param {HTMLElement} el - A `.ud-save-status` line.
   * @param {string} text - Message to show.
   * @param {boolean|null} ok - true = success styling, false = error styling, null = neutral.
   */
  static #setStatus(el, text, ok) {
    if (!el) return;
    el.textContent = text;
    el.classList.remove('ud-save-ok', 'ud-save-err');
    if (ok === true) el.classList.add('ud-save-ok');
    else if (ok === false) el.classList.add('ud-save-err');
  }
}
