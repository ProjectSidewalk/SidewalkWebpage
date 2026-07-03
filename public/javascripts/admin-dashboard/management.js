/**
 * Renders the admin Management page (#4272): the operational console for deployment-wide, state-changing actions.
 *
 * Three sections, all driven from /adminapi/getUserStats (users + teams) plus the existing admin mutation endpoints:
 *   - Users: a searchable, sortable, paginated directory with inline role and team assignment.
 *   - Teams: open/closed and visible/hidden toggles.
 *   - Maintenance: recalc user stats, recalc street priority, clear cache (each confirmed before running).
 *
 * The full user list (~13k on a large deployment like Seattle, after anonymous-with-no-activity are filtered out) is
 * downloaded once and then filtered/sorted/paginated entirely client-side — small enough to keep every column sortable
 * without a per-page server round-trip, but paginated in the DOM so we never render thousands of rows at once.
 *
 * Built as an accessible HTML/CSS table (no DataTables/jQuery), consistent with the rest of the redesign. Mutations
 * update local state optimistically-then-confirm: the request fires, and the row reverts with a message if it fails.
 */
class ManagementPage {
    /** Roles an admin may assign from this page. Owner is intentionally excluded (the backend forbids it); the system
     *  roles (Anonymous, AI) aren't hand-assignable here either. A user already in an unassignable role is shown it as
     *  a disabled, locked select. */
    static #ASSIGNABLE_ROLES = ['Registered', 'Turker', 'Researcher', 'Administrator'];

    /** Page-size options for the directory; the first is the default. */
    static #PAGE_SIZES = [20, 50, 100, 250];

    /** The two pagination bars (above and below the table) are kept in sync. */
    static #PAGINATION_IDS = ['mgmt-pagination-top', 'mgmt-pagination-bottom'];

    #urls;
    #users = [];
    #teams = [];
    #teamsByName = new Map();
    #sort = { key: 'lastSignInTime', dir: 'desc' };
    #filter = '';
    #page = 1;
    #pageSize = ManagementPage.#PAGE_SIZES[0];
    #accuracyFactor = 1;

    /**
     * @param {{userStatsUrl: string, setRoleUrl: string, setTeamUrl: string, teamStatusUrl: string,
     *          teamVisibilityUrl: string, clearCacheUrl: string, recalcStatsUrl: string, recalcPriorityUrl: string}} urls
     */
    constructor(urls) {
        this.#urls = urls;
    }

    async init() {
        try {
            const data = await this.#fetchJson(this.#urls.userStatsUrl);
            this.#users = (data && data.user_stats) || [];
            this.#teams = (data && data.teams) || [];
            this.#teamsByName = new Map(this.#teams.map((t) => [t.name, t]));
            this.#accuracyFactor = ManagementPage.#pctFactor(this.#users, 'ownValidatedAgreedPct');

            this.#renderUsers();
            this.#renderTeams();
            this.#wireUsers();
            this.#wireTeams();
            this.#wireSearch();
            this.#wireMaintenance();

            this.#setStatus('', false, true);
        } catch (err) {
            console.error('Management page failed to load:', err);
            this.#setStatus('Could not load management data. Please try again.', true);
        }
    }

    // --- Users ------------------------------------------------------------------------------------------------------

    /**
     * Operational column set: enough to find a user and manage them, not the analytics leaderboard (that's the
     * Contributors page). "Labeling accuracy" is the agreement rate on this user's own validated labels — the single
     * quality signal that matters operationally. `sort` extracts the comparable value; `help` becomes a header tooltip.
     */
    #columns() {
        return [
            { key: 'username', label: 'Contributor', align: 'left', sort: (u) => (u.username || '').toLowerCase() },
            { key: 'email', label: 'Email', align: 'left', sort: (u) => (u.email || '').toLowerCase() },
            { key: 'role', label: 'Role', align: 'left', sort: (u) => u.role || '' },
            { key: 'team', label: 'Team', align: 'left', sort: (u) => u.team || '' },
            { key: 'highQuality', label: 'Quality', align: 'left', sort: (u) => (u.highQuality ? 1 : 0),
                help: 'Whether this contributor is flagged high-quality. "manual" means an admin set it by hand.' },
            { key: 'ownValidatedAgreedPct', label: 'Labeling accuracy', align: 'right',
                sort: (u) => u.ownValidatedAgreedPct || 0,
                help: 'Share of this user’s own labels that other people agreed with when validating them (with how many were validated).' },
            { key: 'signUpTime', label: 'Signed up', align: 'right', sort: (u) => ManagementPage.#ts(u.signUpTime) },
            { key: 'lastSignInTime', label: 'Last sign-in', align: 'right', sort: (u) => ManagementPage.#ts(u.lastSignInTime) },
            { key: 'signInCount', label: 'Sign-ins', align: 'right', sort: (u) => u.signInCount || 0 },
        ];
    }

    #filteredSortedUsers() {
        const cols = this.#columns();
        const col = cols.find((c) => c.key === this.#sort.key) || cols[0];
        const q = this.#filter.trim().toLowerCase();
        const rows = q
            ? this.#users.filter((u) => (u.username || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q))
            : this.#users.slice();
        const dir = this.#sort.dir === 'asc' ? 1 : -1;
        rows.sort((a, b) => {
            const av = col.sort(a); const bv = col.sort(b);
            if (av < bv) return -1 * dir;
            if (av > bv) return 1 * dir;
            return 0;
        });
        return rows;
    }

    #renderUsers() {
        const cols = this.#columns();
        const all = this.#filteredSortedUsers();
        const pageCount = Math.max(1, Math.ceil(all.length / this.#pageSize));
        if (this.#page > pageCount) this.#page = pageCount;
        const start = (this.#page - 1) * this.#pageSize;
        const rows = all.slice(start, start + this.#pageSize);

        const headCells = cols.map((c) => {
            const isSorted = c.key === this.#sort.key;
            const ariaSort = isSorted ? (this.#sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
            const arrow = isSorted ? (this.#sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
            const title = c.help ? ` title="${ManagementPage.#esc(c.help)}"` : '';
            return `<th scope="col" class="mgmt-th${c.align === 'right' ? ' num' : ''}" aria-sort="${ariaSort}"${title}>`
                + `<button type="button" class="mgmt-sort" data-key="${c.key}">${ManagementPage.#esc(c.label)}`
                + `<span class="mgmt-arrow">${arrow}</span></button></th>`;
        }).join('');
        const head = `<tr>${headCells}</tr>`;

        const body = rows.map((u) => {
            const cell = (html, align) => `<td${align === 'right' ? ' class="num"' : ''}>${html}</td>`;
            return [
                `<tr data-user-id="${ManagementPage.#esc(u.userId)}">`,
                cell(ManagementPage.#userLink(u), 'left'),
                cell(ManagementPage.#esc(u.email || ''), 'left'),
                cell(this.#roleSelect(u), 'left'),
                cell(this.#teamSelect(u), 'left'),
                cell(ManagementPage.#qualityBadge(u), 'left'),
                cell(ManagementPage.#pctCell(u.ownValidatedAgreedPct, u.ownValidated, this.#accuracyFactor), 'right'),
                cell(ManagementPage.#date(u.signUpTime), 'right'),
                cell(ManagementPage.#date(u.lastSignInTime), 'right'),
                cell((u.signInCount || 0).toLocaleString(), 'right'),
                '</tr>',
            ].join('');
        }).join('');

        document.getElementById('mgmt-users').innerHTML = rows.length
            ? `<table class="contrib-table mgmt-table"><thead>${head}</thead><tbody>${body}</tbody></table>`
            : '<p class="dq-empty">No users match your search.</p>';

        this.#renderCount(all.length);
        this.#renderPagination(all.length, pageCount);
    }

    #renderCount(matched) {
        const count = document.getElementById('mgmt-user-count');
        if (!count) return;
        count.textContent = matched === this.#users.length
            ? `${this.#users.length.toLocaleString()} users`
            : `${matched.toLocaleString()} of ${this.#users.length.toLocaleString()} users`;
    }

    /** Renders First/Prev/Next/Last controls, a "Page X of Y" readout, and a rows-per-page select into both bars. */
    #renderPagination(total, pageCount) {
        const from = (this.#page - 1) * this.#pageSize + 1;
        const to = Math.min(total, this.#page * this.#pageSize);
        const btn = (page, label, disabled) =>
            `<button type="button" class="mgmt-page-btn" data-page="${page}"${disabled ? ' disabled' : ''}>${label}</button>`;
        const atStart = this.#page <= 1;
        const atEnd = this.#page >= pageCount;
        const sizeOpts = ManagementPage.#PAGE_SIZES.map((s) =>
            `<option value="${s}"${s === this.#pageSize ? ' selected' : ''}>${s}</option>`).join('');
        const html = total === 0
            ? ''
            : [
                    '<div class="mgmt-page-controls">',
                    btn('first', '« First', atStart),
                    btn('prev', '‹ Prev', atStart),
                    `<span class="mgmt-page-info">${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()} · Page ${this.#page} of ${pageCount}</span>`,
                    btn('next', 'Next ›', atEnd),
                    btn('last', 'Last »', atEnd),
                    '</div>',
                    `<label class="mgmt-page-size-label">Rows per page <select class="mgmt-page-size">${sizeOpts}</select></label>`,
                ].join('');
        for (const id of ManagementPage.#PAGINATION_IDS) {
            const el = document.getElementById(id);
            if (el) el.innerHTML = html;
        }
    }

    /** A role <select>. Locked (disabled) for users whose current role isn't admin-assignable (Owner, AI, Anonymous). */
    #roleSelect(u) {
        const current = u.role || '';
        const assignable = ManagementPage.#ASSIGNABLE_ROLES.includes(current);
        const opts = ManagementPage.#ASSIGNABLE_ROLES.map((r) =>
            `<option value="${r}"${r === current ? ' selected' : ''}>${r}</option>`).join('');
        if (assignable) {
            return `<select class="mgmt-select" data-kind="role" data-user-id="${ManagementPage.#esc(u.userId)}" `
                + `aria-label="Role for ${ManagementPage.#esc(u.username)}">${opts}</select>`;
        }
        // Show the locked system role as a disabled, selected option so the column still reads clearly.
        return `<select class="mgmt-select" disabled aria-label="Role for ${ManagementPage.#esc(u.username)} (locked)">`
            + `<option selected>${ManagementPage.#esc(current)}</option></select>`;
    }

    /** A team <select>. Preselects the user's current team (matched by name); first option assigns/clears nothing. */
    #teamSelect(u) {
        const hasTeam = u.team && this.#teamsByName.has(u.team);
        const placeholder = `<option value=""${hasTeam ? '' : ' selected'} disabled>— none —</option>`;
        const opts = this.#teams.map((t) =>
            `<option value="${t.teamId}"${hasTeam && t.name === u.team ? ' selected' : ''}>${ManagementPage.#esc(t.name)}</option>`,
        ).join('');
        return `<select class="mgmt-select" data-kind="team" data-user-id="${ManagementPage.#esc(u.userId)}" `
            + `aria-label="Team for ${ManagementPage.#esc(u.username)}">${placeholder}${opts}</select>`;
    }

    #wireUsers() {
        const container = document.getElementById('mgmt-users');
        // Sort header clicks (delegated; survives table re-render). Sorting resets to the first page.
        container.addEventListener('click', (e) => {
            const btn = e.target.closest('.mgmt-sort');
            if (!btn) return;
            const key = btn.getAttribute('data-key');
            if (this.#sort.key === key) {
                this.#sort.dir = this.#sort.dir === 'asc' ? 'desc' : 'asc';
            } else {
                this.#sort = { key, dir: ManagementPage.#defaultDir(key) };
            }
            this.#page = 1;
            this.#renderUsers();
        });
        // Role / team changes.
        container.addEventListener('change', (e) => {
            const sel = e.target.closest('.mgmt-select');
            if (!sel || sel.disabled) return;
            const userId = sel.getAttribute('data-user-id');
            if (sel.getAttribute('data-kind') === 'role') this.#changeRole(userId, sel);
            else if (sel.getAttribute('data-kind') === 'team') this.#changeTeam(userId, sel);
        });
        // Pagination controls (delegated on each stable pagination bar — top and bottom stay in sync).
        for (const id of ManagementPage.#PAGINATION_IDS) {
            const bar = document.getElementById(id);
            if (!bar) continue;
            bar.addEventListener('click', (e) => {
                const btn = e.target.closest('.mgmt-page-btn');
                if (!btn || btn.disabled) return;
                this.#gotoPage(btn.getAttribute('data-page'));
            });
            bar.addEventListener('change', (e) => {
                const sel = e.target.closest('.mgmt-page-size');
                if (!sel) return;
                this.#pageSize = parseInt(sel.value, 10) || ManagementPage.#PAGE_SIZES[0];
                this.#page = 1;
                this.#renderUsers();
            });
        }
    }

    #gotoPage(token) {
        const pageCount = Math.max(1, Math.ceil(this.#filteredSortedUsers().length / this.#pageSize));
        if (token === 'first') this.#page = 1;
        else if (token === 'prev') this.#page = Math.max(1, this.#page - 1);
        else if (token === 'next') this.#page = Math.min(pageCount, this.#page + 1);
        else if (token === 'last') this.#page = pageCount;
        this.#renderUsers();
    }

    async #changeRole(userId, sel) {
        const user = this.#users.find((u) => u.userId === userId);
        const previous = user ? user.role : null;
        const newRole = sel.value;
        try {
            const res = await this.#mutate(this.#urls.setRoleUrl, 'PUT', { user_id: userId, role_id: newRole });
            if (user) user.role = res.role || newRole;
            this.#flash(`Set ${user ? user.username : userId} to ${newRole}.`);
        } catch (err) {
            if (previous != null) sel.value = previous; // Revert the control to the server's truth.
            this.#flash(`Could not change role: ${err.message}`, true);
        }
    }

    async #changeTeam(userId, sel) {
        const user = this.#users.find((u) => u.userId === userId);
        const previousName = user ? user.team : null;
        const teamId = parseInt(sel.value, 10);
        const team = this.#teams.find((t) => t.teamId === teamId);
        try {
            await this.#mutate(`${this.#urls.setTeamUrl}?userId=${encodeURIComponent(userId)}&teamId=${teamId}`, 'PUT');
            if (user) user.team = team ? team.name : user.team;
            this.#flash(`Assigned ${user ? user.username : userId} to ${team ? team.name : `team ${teamId}`}.`);
        } catch (err) {
            // Revert to the previously selected team (or the placeholder).
            sel.value = previousName && this.#teamsByName.has(previousName) ? String(this.#teamsByName.get(previousName).teamId) : '';
            this.#flash(`Could not change team: ${err.message}`, true);
        }
    }

    // --- Teams ------------------------------------------------------------------------------------------------------

    #renderTeams() {
        const el = document.getElementById('mgmt-teams');
        if (!this.#teams.length) {
            el.innerHTML = '<p class="dq-empty">No teams on this deployment.</p>';
            return;
        }
        const head = `<tr>
            <th scope="col">Team</th><th scope="col">Description</th>
            <th scope="col">Status</th><th scope="col">Visibility</th>
        </tr>`;
        const body = this.#teams.map((t) => `
            <tr data-team-id="${t.teamId}">
                <td>${ManagementPage.#esc(t.name)}</td>
                <td>${ManagementPage.#esc(t.description || '')}</td>
                <td>${ManagementPage.#toggle('status', t.teamId, t.open, 'Open', 'Closed')}</td>
                <td>${ManagementPage.#toggle('visibility', t.teamId, t.visible, 'Visible', 'Hidden')}</td>
            </tr>`).join('');
        el.innerHTML = `<table class="contrib-table mgmt-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
    }

    #wireTeams() {
        document.getElementById('mgmt-teams').addEventListener('click', (e) => {
            const btn = e.target.closest('.mgmt-toggle');
            if (!btn) return;
            const teamId = parseInt(btn.getAttribute('data-team-id'), 10);
            const kind = btn.getAttribute('data-kind');
            const next = btn.getAttribute('data-on') !== 'true';
            if (kind === 'status') this.#toggleTeam(btn, teamId, this.#urls.teamStatusUrl, 'open', next, 'Open', 'Closed');
            else this.#toggleTeam(btn, teamId, this.#urls.teamVisibilityUrl, 'visible', next, 'Visible', 'Hidden');
        });
    }

    async #toggleTeam(btn, teamId, baseUrl, field, next, onLabel, offLabel) {
        try {
            await this.#mutate(`${baseUrl}/${teamId}`, 'PUT', { [field]: next });
            const team = this.#teams.find((t) => t.teamId === teamId);
            if (team) team[field === 'open' ? 'open' : 'visible'] = next;
            ManagementPage.#setToggle(btn, next, onLabel, offLabel);
            this.#flash(`Team ${teamId}: ${field} → ${next ? onLabel : offLabel}.`);
        } catch (err) {
            this.#flash(`Could not update team: ${err.message}`, true);
        }
    }

    // --- Maintenance ------------------------------------------------------------------------------------------------

    #wireMaintenance() {
        const run = (id, url, method, label) => {
            const btn = document.getElementById(id);
            if (!btn) return;
            btn.addEventListener('click', async () => {
                if (!window.confirm(btn.getAttribute('data-confirm'))) return;
                btn.disabled = true;
                this.#maintResult(`Running: ${label}…`);
                try {
                    await this.#mutate(url, method);
                    this.#maintResult(`Done: ${label}.`);
                } catch (err) {
                    this.#maintResult(`Failed: ${label} — ${err.message}`, true);
                } finally {
                    btn.disabled = false;
                }
            });
        };
        run('mgmt-recalc-stats', this.#urls.recalcStatsUrl, 'GET', 'recalculate user stats');
        run('mgmt-recalc-priority', this.#urls.recalcPriorityUrl, 'GET', 'recalculate street priority');
        run('mgmt-clear-cache', this.#urls.clearCacheUrl, 'PUT', 'clear server cache');
    }

    // --- Search -----------------------------------------------------------------------------------------------------

    #wireSearch() {
        const input = document.getElementById('mgmt-user-search');
        if (!input) return;
        input.addEventListener('input', () => {
            this.#filter = input.value;
            this.#page = 1;
            this.#renderUsers();
        });
    }

    // --- Networking + helpers ---------------------------------------------------------------------------------------

    async #fetchJson(url) {
        const resp = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!resp.ok) throw new Error(`Request failed (${resp.status}): ${url}`);
        return resp.json();
    }

    /**
     * Fires a mutation request and resolves to the parsed JSON (or {} for empty bodies). Throws an Error carrying the
     * server's message on a non-2xx response so callers can revert the control and surface why.
     */
    async #mutate(url, method, body) {
        const opts = { method, headers: { Accept: 'application/json' } };
        if (body !== undefined) {
            opts.headers['Content-Type'] = 'application/json; charset=utf-8';
            opts.body = JSON.stringify(body);
        }
        const resp = await fetch(url, opts);
        const text = await resp.text();
        if (!resp.ok) throw new Error(text || `HTTP ${resp.status}`);
        try {
            return text ? JSON.parse(text) : {};
        } catch (e) {
            return {};
        }
    }

    #flash(message, isError = false) {
        this.#setStatus(message, isError, false);
    }

    #setStatus(message, isError, hide = false) {
        const status = document.getElementById('mgmt-status');
        if (!status) return;
        status.textContent = message;
        status.classList.toggle('error', !!isError);
        status.classList.toggle('hidden', hide);
    }

    #maintResult(message, isError = false) {
        const el = document.getElementById('mgmt-maint-result');
        if (!el) return;
        el.textContent = message;
        el.classList.toggle('error', !!isError);
    }

    /** Numeric/date columns default to descending (biggest/most-recent first); text columns to ascending. */
    static #defaultDir(key) {
        const textKeys = ['username', 'email', 'role', 'team'];
        return textKeys.includes(key) ? 'asc' : 'desc';
    }

    static #toggle(kind, teamId, on, onLabel, offLabel) {
        return `<button type="button" class="mgmt-toggle ${on ? 'is-on' : 'is-off'}" data-kind="${kind}" `
            + `data-team-id="${teamId}" data-on="${on}" aria-pressed="${on}">${on ? onLabel : offLabel}</button>`;
    }

    static #setToggle(btn, on, onLabel, offLabel) {
        btn.setAttribute('data-on', String(on));
        btn.setAttribute('aria-pressed', String(on));
        btn.classList.toggle('is-on', on);
        btn.classList.toggle('is-off', !on);
        btn.textContent = on ? onLabel : offLabel;
    }

    static #userLink(u) {
        const name = u.username || u.userId || 'Unknown';
        return `<a href="/admin/user/${encodeURIComponent(name)}">${ManagementPage.#esc(name)}</a>`;
    }

    /** A High/Low quality pill, tagged "manual" when an admin set the quality by hand (high_quality_manual is set). */
    static #qualityBadge(u) {
        const badge = u.highQuality
            ? '<span class="contrib-badge contrib-badge--high">High</span>'
            : '<span class="contrib-badge contrib-badge--low">Low</span>';
        const manual = u.highQualityManual !== null && u.highQualityManual !== undefined;
        return manual ? `${badge} <span class="mgmt-manual-tag" title="Quality set manually by an admin">manual</span>` : badge;
    }

    /** "92% of 120", or "—" when there's nothing validated to base the rate on. */
    static #pctCell(pct, n, factor) {
        if (!(n > 0)) return '<span class="dq-sub">—</span>';
        return `${Math.round((pct || 0) * factor)}% <span class="dq-sub">of ${n.toLocaleString()}</span>`;
    }

    static #pctFactor(rows, field) {
        const maxVal = rows.reduce((m, u) => Math.max(m, u[field] || 0), 0);
        return maxVal <= 1 ? 100 : 1;
    }

    static #ts(iso) {
        if (!iso) return 0;
        const t = Date.parse(iso);
        return isNaN(t) ? 0 : t;
    }

    static #date(iso) {
        if (!iso) return '<span class="dq-sub">—</span>';
        const t = Date.parse(iso);
        if (isNaN(t)) return '<span class="dq-sub">—</span>';
        return new Date(t).toLocaleDateString();
    }

    static #esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    }
}
