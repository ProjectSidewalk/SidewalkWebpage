/**
 * Tests for the hours AdminUser fills into the Manage user page (#4986).
 *
 * The number here has to match what the same user reads on /timeCheck, so the cases are the ones where a plausible
 * implementation quietly stops matching: a KPI re-derived by summing the rows instead of taking the total as sent, a
 * breakdown shown or withheld on the client's own reading of the city list, and an unreachable city that vanishes
 * instead of marking the total as a floor. The failure path matters for the same reason — a KPI left on its loading
 * placeholder reads as "zero hours" to an admin verifying a claim.
 *
 * Runs under jsdom (jest.config.js). AdminUser is a bare top-level class in a concatenated bundle, so it is eval'd
 * into global scope rather than required.
 */

const fs = require('fs');
const path = require('path');

const ADMIN_USER_SRC = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'public/js/user-dashboard/AdminUser.js'), 'utf8');

let AdminUser;

beforeAll(() => {
  AdminUser = (0, eval)(`${ADMIN_USER_SRC}\nAdminUser;`);
});

/** The stats section of adminUser.scala.html, trimmed to what the hours code touches. */
function buildDom() {
  document.body.innerHTML = `
    <div class="ps-kpis">
      <div class="ps-kpi" id="au-hours-kpi" aria-busy="true">
        <span class="ps-kpi-value" id="au-hours-value">…</span>
        <span class="ps-kpi-label" id="au-hours-label">Exploring &amp; validating</span>
      </div>
    </div>
    <span id="au-hours-status" class="ud-sr-only" role="status" aria-live="polite"></span>
    <div id="au-hours-cities" hidden>
      <h3 class="page-subhead" id="au-hours-cities-title">Where their time came from</h3>
      <div class="ps-table-scroll ud-admin-hours-cities" id="au-hours-cities-table"></div>
    </div>
    <div class="ud-nudge" id="au-hours-note" hidden></div>`;
}

/**
 * Builds the page's controller against a stubbed hours endpoint and waits for the fetch to settle.
 *
 * @param {Object|Error} response - Payload to serve, or an Error/HTTP status to fail with.
 * @returns {Promise<void>} Resolves once #loadHours has finished rendering.
 */
async function load(response) {
  buildDom();
  global.fetch = jest.fn(() => (response instanceof Error
    ? Promise.reject(response)
    : Promise.resolve({ ok: true, json: () => Promise.resolve(response) })));
  new AdminUser({
    userId: 'u1', username: 'mapper', saveUrl: '/save', flagsUrl: '/flags',
    hoursUrl: '/adminapi/users/u1/crossCityHours', pageUrlFor: (u) => `/admin/user/${u}/admin`,
  });
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

const TWO_CITIES = {
  total_hours: 10.8,
  cities: [
    { city_id: 'teaneck-nj', city_name: 'Teaneck', hours: 6.3, is_current_city: true },
    { city_id: 'seattle-wa', city_name: 'Seattle', hours: 4.5, is_current_city: false },
  ],
  show_breakdown: true,
  unreachable_cities: 0,
};

const hoursText = () => document.getElementById('au-hours-value').textContent;
const rowHours = () => Array.from(document.querySelectorAll('#au-hours-cities-table td'))
  .map((td) => Number(td.textContent));

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  delete global.fetch;
});

describe('AdminUser cross-city hours', () => {
  it('shows the total the endpoint sent, to the tenth', async () => {
    await load(TWO_CITIES);
    expect(hoursText()).toBe('10.8 h');
    expect(document.getElementById('au-hours-kpi').hasAttribute('aria-busy')).toBe(false);
  });

  it('takes the total as sent rather than re-adding the rows', async () => {
    // The rows are apportioned to the total server-side; a client that summed them would drift from the figure the
    // volunteer hands their supervisor the moment apportionment moves a tenth.
    await load({ ...TWO_CITIES, total_hours: 10.8, cities: [{ city_name: 'Teaneck', hours: 5, is_current_city: true }] });
    expect(hoursText()).toBe('10.8 h');
  });

  it('renders a breakdown that adds up to the KPI', async () => {
    await load(TWO_CITIES);
    expect(rowHours().reduce((a, b) => a + b, 0)).toBeCloseTo(10.8, 10);
  });

  it('marks the deployment being administered', async () => {
    await load(TWO_CITIES);
    const headers = Array.from(document.querySelectorAll('#au-hours-cities-table th[scope="row"]'))
      .map((th) => th.textContent);
    expect(headers).toEqual(['Teaneck (this deployment)', 'Seattle']);
  });

  it('right-aligns the hours column, like every other numeric column on these pages', async () => {
    await load(TWO_CITIES);
    expect(document.querySelectorAll('#au-hours-cities-table td.num').length).toBe(2);
    expect(document.querySelector('#au-hours-cities-table thead th.num').textContent).toBe('Hours');
  });

  it('names all cities in the KPI label once there is more than one', async () => {
    await load(TWO_CITIES);
    expect(document.getElementById('au-hours-label').textContent).toBe('Exploring & validating, all cities');
  });

  it('leaves the breakdown hidden when the server says not to show one', async () => {
    await load({
      total_hours: 3.5,
      cities: [{ city_id: 'teaneck-nj', city_name: 'Teaneck', hours: 3.5, is_current_city: true }],
      show_breakdown: false,
      unreachable_cities: 0,
    });
    expect(hoursText()).toBe('3.5 h');
    expect(document.getElementById('au-hours-cities').hidden).toBe(true);
    expect(document.getElementById('au-hours-label').textContent).toBe('Exploring & validating');
  });

  it('shows a lone city that is not this deployment, so the hours are never unattributed', async () => {
    await load({
      total_hours: 3.5,
      cities: [{ city_id: 'seattle-wa', city_name: 'Seattle', hours: 3.5, is_current_city: false }],
      show_breakdown: true,
      unreachable_cities: 0,
    });
    expect(document.getElementById('au-hours-cities').hidden).toBe(false);
    expect(document.querySelector('#au-hours-cities-table th[scope="row"]').textContent).toBe('Seattle');
  });

  it('shows zero rather than an error for a user who has done nothing anywhere', async () => {
    await load({ total_hours: 0, cities: [], show_breakdown: false, unreachable_cities: 0 });
    expect(hoursText()).toBe('0.0 h');
    expect(document.getElementById('au-hours-note').hidden).toBe(true);
  });

  it('says so when cities could not be totalled, rather than quietly showing less time', async () => {
    await load({ ...TWO_CITIES, unreachable_cities: 2 });
    const note = document.getElementById('au-hours-note');
    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain("Couldn't total 2 cities just now");
  });

  it('counts a single unreachable city in the singular', async () => {
    await load({ ...TWO_CITIES, unreachable_cities: 1 });
    expect(document.getElementById('au-hours-note').textContent).toContain("Couldn't total 1 city just now");
  });

  it('escapes city names rather than pasting them into markup', async () => {
    await load({
      total_hours: 1,
      cities: [{ city_id: 'x', city_name: '<img src=x onerror=alert(1)>', hours: 1, is_current_city: false }],
      show_breakdown: true,
      unreachable_cities: 0,
    });
    expect(document.querySelectorAll('#au-hours-cities-table img').length).toBe(0);
    expect(document.querySelector('#au-hours-cities-table th[scope="row"]').textContent)
      .toBe('<img src=x onerror=alert(1)>');
  });

  it('says the hours failed rather than leaving the KPI on its loading placeholder', async () => {
    // '…' would read as a page still working; a bare number the admin can't get is worse than an admitted gap.
    await load(new Error('network down'));
    expect(hoursText()).toBe('—');
    expect(document.getElementById('au-hours-kpi').hasAttribute('aria-busy')).toBe(false);
    expect(document.getElementById('au-hours-note').textContent).toContain("Couldn't total this user's hours");
  });

  it('announces the loaded total to screen readers', async () => {
    await load(TWO_CITIES);
    expect(document.getElementById('au-hours-status').textContent).toBe('Logged hours loaded: 10.8 hours.');
  });
});
