/**
 * Renders one team's admin page (#5381): who is on the team, what they've contributed, and the roster controls.
 *
 * Everything below the server-rendered header comes from `/adminapi/team/:teamId`. Roster changes go through the same
 * `/userapi/setUserTeam` and `/userapi/leaveTeam` endpoints the user dashboard uses (an admin may call them for other
 * users), and each one re-fetches the overview rather than patching the table, so the totals never drift from the rows.
 */
class TeamPage {
  /** How long to wait after the last keystroke before searching, so a typed name is one request rather than ten. */
  static #SEARCH_DEBOUNCE_MS = 250;

  #teamId;
  #urls;
  #members = [];
  #sort = { key: 'labels', dir: 'desc' };
  #searchTimer = null;
  /** Rising counter identifying the newest search, so a slow earlier response can't overwrite a later one. */
  #searchSeq = 0;

  /**
   * @param {number} teamId - The team being shown.
   * @param {{overviewUrl: string, userSearchUrl: string, setTeamUrl: string, leaveTeamUrl: string,
   *          teamStatusUrl: string, teamVisibilityUrl: string}} urls
   */
  constructor(teamId, urls) {
    this.#teamId = teamId;
    this.#urls = urls;
  }

  async init() {
    try {
      this.#wireMembers();
      this.#wireHeaderToggles();
      this.#wireSearch();
    } catch (err) {
      console.error('Team page failed to wire up:', err);
      this.#setStatus('This page did not load correctly. Please reload.', true);
      return;
    }
    await this.#load();
  }

  /**
   * @param {string} [message] - What to leave on the status line afterwards; hidden when absent. A roster change
   *                             passes its confirmation here, since clearing the line would erase it a moment later.
   */
  async #load(message) {
    try {
      const data = await util.fetchJson(`${this.#urls.overviewUrl}/${this.#teamId}`);
      this.#members = (data && data.members) || [];
      this.#renderStats((data && data.totals) || {});
      this.#renderMembers();
      if (message) this.#setStatus(message, false);
      else this.#setStatus('', false, true);
    } catch (err) {
      console.error('Team page failed to load:', err);
      this.#setStatus('Could not load this team. Please try again.', true);
    }
  }

  // --- Team stats ---------------------------------------------------------------------------------------------------

  /** @param {Record<string, number>} totals - The team's totals. */
  #renderStats(totals) {
    AdminShell.setText('kpi-team-members', AdminShell.num(totals.members || 0));
    AdminShell.setText('kpi-team-labels', AdminShell.num(totals.labels || 0));
    AdminShell.setText('kpi-team-validations', AdminShell.num(totals.validations || 0));
    AdminShell.setText('kpi-team-distance', TeamPage.#km(totals.distance_meters));
    AdminShell.setText('kpi-team-accuracy', TeamPage.#pct(totals.labels_agreed, totals.labels_validated));
    AdminShell.setText('kpi-team-accuracy-note', totals.labels_validated
      ? `of ${AdminShell.num(totals.labels_validated)} judged labels`
      : 'no labels judged yet');
  }

  // --- Members ------------------------------------------------------------------------------------------------------

  /**
   * A column with no `sort` isn't sortable; `help` becomes a header tooltip.
   *
   * @returns {Array<{key: string, label: string, align: string, sort?: Function, help?: string}>} The columns.
   */
  #columns() {
    return [
      { key: 'username', label: 'User', align: 'left', sort: (m) => (m.username || '').toLowerCase() },
      { key: 'role', label: 'Role', align: 'left', sort: (m) => m.role || '' },
      { key: 'labels', label: 'Labels', align: 'right', sort: (m) => m.labels || 0 },
      { key: 'validations', label: 'Validations given', align: 'right', sort: (m) => m.validations || 0 },
      { key: 'distance_meters', label: 'Distance explored', align: 'right', sort: (m) => m.distance_meters || 0 },
      { key: 'accuracy', label: 'Labeling accuracy', align: 'right',
        sort: (m) => (m.labels_validated ? m.labels_agreed / m.labels_validated : -1),
        help: 'Share of this member’s own labels that other people agreed with when validating them '
          + '(with how many were judged).' },
      { key: 'last_active', label: 'Last active', align: 'right', sort: (m) => AdminShell.ts(m.last_active),
        help: 'The later of their last label and their last validation.' },
      { key: 'high_quality', label: 'Quality', align: 'left', sort: (m) => (m.high_quality ? 1 : 0),
        help: 'The user’s quality flag. An excluded user’s work is left out of this city’s stats.' },
      // Unsortable: it holds buttons, and a header click would throw away the chosen order for no ordering.
      { key: 'actions', label: 'Remove', align: 'left' },
    ];
  }

  #sortedMembers() {
    const cols = this.#columns();
    const col = cols.find((c) => c.key === this.#sort.key && c.sort) || cols[0];
    const dir = this.#sort.dir === 'asc' ? 1 : -1;
    return this.#members.slice().sort((a, b) => {
      const av = col.sort(a);
      const bv = col.sort(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return (a.username || '').localeCompare(b.username || '');
    });
  }

  #renderMembers() {
    const container = document.getElementById('team-members');
    if (!this.#members.length) {
      container.innerHTML = '<p class="dq-empty">Nobody is on this team yet. Add members below.</p>';
      return;
    }
    const cols = this.#columns();
    const headCells = cols.map((c) => {
      const title = c.help ? ` title="${AdminShell.esc(c.help)}"` : '';
      if (!c.sort) return `<th scope="col"${title}>${AdminShell.esc(c.label)}</th>`;
      const isSorted = c.key === this.#sort.key;
      const ariaSort = isSorted ? (this.#sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
      const arrow = isSorted ? (this.#sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
      return `<th scope="col" class="mgmt-th${c.align === 'right' ? ' num' : ''}" aria-sort="${ariaSort}"${title}>`
        + `<button type="button" class="mgmt-sort" data-key="${c.key}">${AdminShell.esc(c.label)}`
        + `<span class="mgmt-arrow">${arrow}</span></button></th>`;
    }).join('');

    const body = this.#sortedMembers().map((m) => {
      const cell = (html, align) => `<td${align === 'right' ? ' class="num"' : ''}>${html}</td>`;
      const name = AdminShell.esc(m.username);
      return [
        `<tr data-user-id="${AdminShell.esc(m.user_id)}">`,
        cell(`<a href="/admin/user/${encodeURIComponent(m.username)}">${name}</a>`, 'left'),
        cell(AdminShell.esc(m.role), 'left'),
        cell(AdminShell.num(m.labels || 0), 'right'),
        cell(AdminShell.num(m.validations || 0), 'right'),
        cell(TeamPage.#km(m.distance_meters), 'right'),
        cell(TeamPage.#accuracyCell(m), 'right'),
        cell(m.last_active ? AdminShell.esc(AdminShell.relativeTime(m.last_active)) : '<span class="dq-sub">—</span>',
          'right'),
        cell(TeamPage.#qualityBadge(m), 'left'),
        cell(`<button type="button" class="mgmt-toggle is-off team-remove" data-user-id="`
          + `${AdminShell.esc(m.user_id)}" data-username="${name}">Remove</button>`, 'left'),
        '</tr>',
      ].join('');
    }).join('');

    container.innerHTML = `
      <table class="ps-table ps-table--compact contrib-table mgmt-table">
        <thead><tr>${headCells}</tr></thead>
        <tbody>${body}</tbody>
      </table>`;
  }

  /** Delegated on the stable container so sorting and removing survive each re-render of the table. */
  #wireMembers() {
    const container = document.getElementById('team-members');
    container.addEventListener('click', (e) => {
      const target = /** @type {Element} */ (e.target);
      const sortBtn = target.closest('.mgmt-sort');
      if (sortBtn) {
        const key = sortBtn.getAttribute('data-key');
        if (this.#sort.key === key) this.#sort.dir = this.#sort.dir === 'asc' ? 'desc' : 'asc';
        else this.#sort = { key, dir: TeamPage.#defaultDir(key) };
        this.#renderMembers();
        return;
      }
      const removeBtn = target.closest('.team-remove');
      if (removeBtn) {
        this.#removeMember(removeBtn.getAttribute('data-user-id'), removeBtn.getAttribute('data-username'));
      }
    });
  }

  /**
   * Takes a member off the team. They keep their account and their work; the team's totals stop counting them.
   *
   * @param {string} userId - The member to remove.
   * @param {string} username - Their name, for the confirmation and the status line.
   */
  async #removeMember(userId, username) {
    const confirmed = await ConfirmDialog.confirm({
      message: `Remove ${username} from this team? Their labels and validations are kept, but they stop counting `
        + 'toward the team.',
      confirmText: 'Remove',
      cancelText: 'Cancel',
    });
    if (!confirmed) return;
    try {
      await AdminShell.mutate(`${this.#urls.leaveTeamUrl}?userId=${encodeURIComponent(userId)}`, 'PUT');
      await this.#load(`Removed ${username} from this team.`);
    } catch (err) {
      this.#setStatus(`Could not remove ${username}: ${err.message}`, true);
    }
  }

  // --- Add members --------------------------------------------------------------------------------------------------

  #wireSearch() {
    const input = /** @type {HTMLInputElement} */ (document.getElementById('team-add-search'));
    input.addEventListener('input', () => {
      clearTimeout(this.#searchTimer);
      this.#searchTimer = setTimeout(() => this.#search(input.value), TeamPage.#SEARCH_DEBOUNCE_MS);
    });
    document.getElementById('team-add-results').addEventListener('click', (e) => {
      const btn = /** @type {Element} */ (e.target).closest('.team-add');
      if (btn) {
        this.#addMember(btn.getAttribute('data-user-id'), btn.getAttribute('data-username'),
          btn.getAttribute('data-current-team'));
      }
    });
  }

  /** @param {string} query - What the admin has typed; a blank box clears the results rather than listing everyone. */
  async #search(query) {
    const results = document.getElementById('team-add-results');
    // Bumped even for a cleared box, so a response already in flight can't repaint results the admin just dismissed.
    const seq = ++this.#searchSeq;
    if (!query.trim()) {
      results.innerHTML = '';
      return;
    }
    try {
      const url = `${this.#urls.userSearchUrl}?query=${encodeURIComponent(query)}`;
      const matches = await util.fetchJson(url);
      if (seq !== this.#searchSeq) return;
      this.#renderSearchResults(matches || []);
    } catch (err) {
      if (seq !== this.#searchSeq) return;
      results.innerHTML = `<p class="dq-empty">Search failed: ${AdminShell.esc(err.message)}</p>`;
    }
  }

  /** @param {Array<Record<string, any>>} matches - Accounts matching the query, as the search endpoint returns them. */
  #renderSearchResults(matches) {
    const results = document.getElementById('team-add-results');
    if (!matches.length) {
      results.innerHTML = '<p class="dq-empty">No users match your search.</p>';
      return;
    }
    const onTeam = new Set(this.#members.map((m) => m.user_id));
    const rows = matches.map((m) => {
      const name = AdminShell.esc(m.username);
      const already = onTeam.has(m.user_id);
      const note = already
        ? '<span class="dq-sub">already on this team</span>'
        : (m.team ? `<span class="team-current">on ${AdminShell.esc(m.team)}</span>` : '');
      const action = already
        ? ''
        : `<button type="button" class="mgmt-toggle is-on team-add" data-user-id="${AdminShell.esc(m.user_id)}" `
          + `data-username="${name}" data-current-team="${AdminShell.esc(m.team || '')}">Add</button>`;
      return `
        <tr>
          <td>${name}</td>
          <td>${AdminShell.esc(m.email || '')}</td>
          <td>${AdminShell.esc(m.role)}</td>
          <td>${note}</td>
          <td>${action}</td>
        </tr>`;
    }).join('');
    results.innerHTML = `
      <table class="ps-table ps-table--compact contrib-table mgmt-table">
        <thead>
          <tr>
            <th scope="col">User</th><th scope="col">Email</th><th scope="col">Role</th>
            <th scope="col">Current team</th><th scope="col">Add</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  /**
   * Puts a user on this team. A user belongs to one team at a time, so this moves anyone already on another —
   * which the confirmation says out loud, since it changes a team the admin isn't looking at.
   *
   * @param {string} userId - The account to add.
   * @param {string} username - Their name, for the confirmation and the status line.
   * @param {string} currentTeam - The team they're on now, or empty when they're on none.
   */
  async #addMember(userId, username, currentTeam) {
    if (currentTeam) {
      const confirmed = await ConfirmDialog.confirm({
        message: `${username} is on ${currentTeam}. Adding them here moves them off that team.`,
        confirmText: 'Move them',
        cancelText: 'Cancel',
      });
      if (!confirmed) return;
    }
    try {
      const url = `${this.#urls.setTeamUrl}?userId=${encodeURIComponent(userId)}&teamId=${this.#teamId}`;
      await AdminShell.mutate(url, 'PUT');
      await this.#load(`Added ${username} to this team.`);
      // Re-run the search so the row the admin just acted on shows as a member instead of offering Add again.
      const input = /** @type {HTMLInputElement} */ (document.getElementById('team-add-search'));
      await this.#search(input.value);
    } catch (err) {
      this.#setStatus(`Could not add ${username}: ${err.message}`, true);
    }
  }

  // --- Header toggles -----------------------------------------------------------------------------------------------

  /** The open/closed and visible/hidden toggles, which do the same thing they do on the Management page's table. */
  #wireHeaderToggles() {
    const toggles = [
      { id: 'team-status-toggle', url: this.#urls.teamStatusUrl, field: 'open', on: 'Open', off: 'Closed' },
      { id: 'team-visibility-toggle', url: this.#urls.teamVisibilityUrl, field: 'visible', on: 'Visible',
        off: 'Hidden' },
    ];
    for (const t of toggles) {
      const btn = /** @type {HTMLButtonElement} */ (document.getElementById(t.id));
      btn.addEventListener('click', async () => {
        const next = btn.getAttribute('data-on') !== 'true';
        try {
          await AdminShell.mutate(`${t.url}/${this.#teamId}`, 'PUT', { [t.field]: next });
          btn.setAttribute('data-on', String(next));
          btn.setAttribute('aria-pressed', String(next));
          btn.classList.toggle('is-on', next);
          btn.classList.toggle('is-off', !next);
          btn.textContent = next ? t.on : t.off;
          this.#setStatus(`Team ${t.field} → ${next ? t.on : t.off}.`, false);
        } catch (err) {
          this.#setStatus(`Could not update team: ${err.message}`, true);
        }
      });
    }
  }

  // --- Networking + helpers -----------------------------------------------------------------------------------------

  /**
   * @param {string} message - What to show; empty clears the line.
   * @param {boolean} isError - Whether to style it as a failure.
   * @param {boolean} [hide=false] - Hide the line entirely (nothing to report).
   */
  #setStatus(message, isError, hide = false) {
    const status = document.getElementById('team-status');
    status.textContent = message;
    status.classList.toggle('error', !!isError);
    status.classList.toggle('hidden', hide);
  }

  /**
   * @param {string} key - A column key.
   * @returns {string} 'asc' for text columns, 'desc' for numeric and date ones (biggest/most recent first).
   */
  static #defaultDir(key) {
    return ['username', 'role'].includes(key) ? 'asc' : 'desc';
  }

  /**
   * @param {number} meters - A distance.
   * @returns {string} The distance in km with one decimal, matching the rest of the admin dashboard.
   */
  static #km(meters) {
    return `${((meters || 0) / 1000).toFixed(1)} km`;
  }

  /**
   * @param {number} part - The agreeing share.
   * @param {number} whole - How many were judged.
   * @returns {string} A whole-number percentage, or an em dash when nothing has been judged.
   */
  static #pct(part, whole) {
    return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—';
  }

  /**
   * @param {Record<string, any>} member - One member row.
   * @returns {string} "92% of 120", or an em dash when none of their labels have been judged.
   */
  static #accuracyCell(member) {
    if (!(member.labels_validated > 0)) return '<span class="dq-sub">—</span>';
    return `${TeamPage.#pct(member.labels_agreed, member.labels_validated)} `
      + `<span class="dq-sub">of ${AdminShell.num(member.labels_validated)}</span>`;
  }

  /**
   * @param {Record<string, any>} member - One member row.
   * @returns {string} A High/Low quality pill, tagged "excluded" when their work is left out of the city's stats.
   */
  static #qualityBadge(member) {
    const badge = member.high_quality
      ? '<span class="contrib-badge contrib-badge--high">High</span>'
      : '<span class="contrib-badge contrib-badge--low">Low</span>';
    if (!member.excluded) return badge;
    return `${badge} <span class="mgmt-manual-tag" `
      + `title="This user's work is excluded from the city's stats">excluded</span>`;
  }
}
