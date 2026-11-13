/**
 * A cut-down copy of userDashboard/manageUser.scala.html for the AdminUser suites: every element AdminUser wires on
 * start, since the page always renders them all (#5840).
 */

/**
 * Draws the Manage user page into the document.
 *
 * @param {object} [opts]
 * @param {string} [opts.quality] - The quality dropdown's starting value: 'auto', 'true', or 'false'.
 * @param {boolean} [opts.excluded] - Whether the user starts excluded.
 * @param {string} [opts.infra3d] - 'on', 'off' (shown but the admin can't grant it), or 'none' (not this deployment).
 */
export function drawManageUserPage({ quality = 'auto', excluded = false, infra3d = 'none' } = {}) {
  const infra = infra3d === 'none' ? ''
    : `<input type="checkbox" id="au-infra3d-access" checked ${infra3d === 'off' ? 'disabled' : ''}>`;
  document.body.innerHTML = `
    <input id="au-username" type="text" value="  mapper  ">
    <select id="au-role"><option value="Registered" selected>Registered</option><option value="Turker">Turker</option>
    </select>
    <select id="au-team"><option value="">No team</option><option value="12">Ms. Frizzle's class</option></select>
    <select id="au-quality" ${excluded ? 'disabled' : ''}>
      <option value="auto">Automatic</option><option value="true">High quality</option>
      <option value="false">Low quality</option>
    </select>
    <input type="checkbox" id="au-excluded" ${excluded ? 'checked' : ''}>
    <input type="checkbox" id="au-community-service">
    <input type="checkbox" id="au-on-leaderboard" checked>
    <input type="checkbox" id="au-public-profile">
    ${infra}
    <button type="button" id="au-save-btn">Save</button>
    <span class="ud-save-status" id="au-save-status"></span>
    <div class="ps-kpis">
      <div class="ps-kpi" id="au-hours-kpi" aria-busy="true">
        <span class="ps-kpi-value" id="au-hours-value">…</span>
        <span class="ps-kpi-label" id="au-hours-label">Exploring &amp; validating</span>
      </div>
      <span class="ps-kpi-value" id="au-high-quality">${excluded ? 'Excluded' : 'Low'}</span>
    </div>
    <span id="au-hours-status" class="sr-only" role="status" aria-live="polite"></span>
    <div id="au-hours-cities" hidden>
      <h3 class="page-subhead" id="au-hours-cities-title">Where their time came from</h3>
      <div class="ps-table-scroll ud-admin-hours-cities" id="au-hours-cities-table"></div>
    </div>
    <div class="ud-nudge" id="au-hours-note" hidden></div>
    ${['low_quality', 'incomplete'].map((flag) => `
      <div class="ud-form ud-admin-flag" data-flag="${flag}">
        <input class="ud-admin-flag-date" id="au-date-${flag}" type="date">
        <button type="button" class="ud-admin-flag-set">Set flags</button>
        <button type="button" class="ud-admin-flag-remove">Remove flags</button>
        <span class="ud-save-status ud-admin-flag-status"></span>
      </div>`).join('')}
    <time class="ud-admin-ts" id="ts-good" datetime="2026-08-20T03:00:00Z">2026-08-20 03:00</time>
    <time class="ud-admin-ts" id="ts-bad" datetime="">unknown</time>`;
  /** @type {HTMLSelectElement} */ (document.getElementById('au-quality')).value = quality;
}
