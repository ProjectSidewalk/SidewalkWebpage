/**
 * Drives the Manage user page beside a user's dashboard (#4964): saves the admin-editable account settings in one PUT
 * to /adminapi/saveUserSettings, sets or clears the low-quality/incomplete flags on every task the user completed
 * before a chosen date, fills in the user's cross-city logged hours, and localizes the Explore-comment timestamps. A
 * rejected save (username taken, a permission rule) comes back as a 400 whose message is shown inline without
 * applying anything.
 */
class AdminUser {
  #userId;
  #username;
  #saveUrl;
  #flagsUrl;
  #hoursUrl;
  #pageUrlFor;
  #saveBtn;
  #saveStatus;

  /**
   * @param {Object} opts
   * @param {string} opts.userId - The user being administered.
   * @param {string} opts.username - Their current username.
   * @param {string} opts.saveUrl - Endpoint the settings form PUTs to.
   * @param {string} opts.flagsUrl - Endpoint the by-date task flags PUT to.
   * @param {string} opts.hoursUrl - Endpoint serving this user's cross-city logged hours.
   * @param {(username: string) => string} opts.pageUrlFor - This page's URL for a given username; the page is
   *     keyed by username, so a rename navigates to the renamed address.
   */
  constructor(opts) {
    this.#userId = opts.userId;
    this.#username = opts.username;
    this.#saveUrl = opts.saveUrl;
    this.#flagsUrl = opts.flagsUrl;
    this.#hoursUrl = opts.hoursUrl;
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

    this.#loadHours();
  }

  /**
   * Fills the hours KPI and its per-city breakdown from the endpoint (#4986).
   *
   * Every displayed number comes from the payload as-sent: `total_hours` is already the sum of the rows to the tenth,
   * and `show_breakdown` is already decided, so this renders the same figures the volunteer reads on /timeCheck rather
   * than a second opinion assembled here.
   */
  async #loadHours() {
    const kpi = document.getElementById('au-hours-kpi');
    const value = document.getElementById('au-hours-value');
    if (!kpi || !value) return;

    let data;
    try {
      const res = await fetch(this.#hoursUrl, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    } catch (e) {
      console.error('Cross-city hours failed to load', e);
      value.textContent = '—';
      kpi.removeAttribute('aria-busy');
      AdminUser.#showNote('Couldn\'t total this user\'s hours. Reload to try again.');
      return;
    }

    const cities = Array.isArray(data.cities) ? data.cities : [];
    const total = Number(data.total_hours) || 0;
    value.textContent = `${total.toFixed(1)} h`;
    kpi.removeAttribute('aria-busy');
    const label = document.getElementById('au-hours-label');
    if (cities.length > 1 && label) label.textContent = 'Exploring & validating, all cities';
    if (data.show_breakdown) AdminUser.#renderHoursCities(cities);

    // An unreached city may have held hours, so the total is a floor. An admin verifying a claim needs to know that
    // before deciding the user overstated it.
    const missed = data.unreachable_cities || 0;
    if (missed > 0) {
      const cityWord = missed === 1 ? '1 city' : `${missed} cities`;
      const retry = 'Reload in a few minutes; if it persists, those deployments aren\'t answering.';
      AdminUser.#showNote(`Couldn't total ${cityWord} just now, so these hours may read low. ${retry}`);
    }

    const status = document.getElementById('au-hours-status');
    if (status) status.textContent = `Logged hours loaded: ${total.toFixed(1)} hours.`;
  }

  /**
   * Builds the per-city hours table and reveals it.
   * @param {Array<Object>} cities - Per-city rows from the endpoint, most hours first.
   */
  static #renderHoursCities(cities) {
    const holder = document.getElementById('au-hours-cities-table');
    const section = document.getElementById('au-hours-cities');
    if (!holder || !section || !cities.length) return;

    const rows = cities.map((city) => `
      <tr>
        <th scope="row">${AdminUser.#esc(city.city_name)}${city.is_current_city ? ' (this deployment)' : ''}</th>
        <td class="num">${Number(city.hours).toFixed(1)}</td>
      </tr>`).join('');
    holder.innerHTML = `
      <table class="ps-table ps-table--compact ud-admin-table" aria-labelledby="au-hours-cities-title">
        <thead>
          <tr><th scope="col">City</th><th scope="col" class="num">Hours</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
    section.hidden = false;
  }

  /** @param {string} text - Message for the note beneath the hours KPIs. */
  static #showNote(text) {
    const note = document.getElementById('au-hours-note');
    if (!note) return;
    note.textContent = text;
    note.hidden = false;
  }

  /** @param {string} s - Text going into an HTML string. @returns {string} It, with HTML metacharacters escaped. */
  static #esc(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));
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
