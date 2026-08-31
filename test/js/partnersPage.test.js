/**
 * Tests for the Partners admin page (#4516).
 *
 * The page draws two independently ordered lists and turns up/down clicks into a full-order PUT, so the properties
 * worth pinning are the ones a casual manual test misses: that the payload sent on reorder is the *whole* permuted
 * id list for the right scope's endpoint, that a non-Owner gets no edit controls on the global list while the city
 * list keeps them, and that a create with no file is refused client-side before any request is made.
 *
 * Runs under jsdom (jest.config.js). PartnersPage is a bare top-level class served file-by-file, so it is eval'd
 * into global scope rather than required.
 */

const fs = require('fs');
const path = require('path');

const PAGE_PATH = path.resolve(__dirname, '..', '..', 'public/js/admin-dashboard/PartnersPage.js');

const PartnersPage = (0, eval)(`${fs.readFileSync(PAGE_PATH, 'utf8')}\nPartnersPage;`);

/** The Twirl page's containers and per-scope add forms, reduced to what the class touches. */
function buildDom({ ownerForms }) {
  const form = (scope) => `
    <form class="partners-add-form" data-scope="${scope}">
      <h3 class="partners-form-heading">Add a partner</h3>
      <input type="text" name="name">
      <input type="url" name="url">
      <input type="text" name="alt_text">
      <input type="file" name="logo">
      <button type="submit">Add partner</button>
      <button type="button" class="partners-cancel-edit" hidden>Cancel</button>
      <p class="partners-form-error" hidden></p>
    </form>`;
  document.body.innerHTML = `
    <div id="partners-status"></div>
    <div id="partners-city-list"></div>
    <div id="partners-global-list"></div>
    ${form('city')}
    ${ownerForms ? form('global') : ''}`;
}

const cityPartner = (id, name) => ({
  partner_id: id, city_id: 'seattle', name, url: 'https://example.org', alt_text: null,
  display_order: 0, logo_width: 800, logo_height: 200, logo_url: `/partnerLogo/${id}?v=1`,
});
const globalPartner = (id, name) => ({ ...cityPartner(id, name), city_id: null });

/** Stubs fetch with a queue-less handler and records every call. */
function stubFetch(listPayload) {
  const calls = [];
  global.fetch = jest.fn(async (url, options = {}) => {
    calls.push({ url, options });
    if (url === '/adminapi/partners' && !options.method) {
      return { ok: true, json: async () => listPayload() };
    }
    return { ok: true, json: async () => ({ success: true }) };
  });
  return calls;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('PartnersPage', () => {
  test('renders both scopes and withholds edit controls a non-Owner does not have', async () => {
    buildDom({ ownerForms: false });
    stubFetch(() => ({
      city_id: 'seattle',
      is_owner: false,
      city_partners: [cityPartner(1, 'City One'), cityPartner(2, 'City Two')],
      global_partners: [globalPartner(9, 'Global Org')],
    }));
    new PartnersPage({ isOwner: false }).init();
    await flush();

    const cityRows = document.querySelectorAll('#partners-city-list .partners-row');
    expect(cityRows).toHaveLength(2);
    expect(cityRows[0].textContent).toContain('City One');
    expect(cityRows[0].querySelectorAll('button').length).toBeGreaterThan(0);

    const globalRows = document.querySelectorAll('#partners-global-list .partners-row');
    expect(globalRows).toHaveLength(1);
    // The server would 403 these anyway; the page must not offer buttons that can only fail.
    expect(globalRows[0].querySelectorAll('button')).toHaveLength(0);

    expect(document.getElementById('partners-status').textContent).toBe('1 global · 2 city');
  });

  test('a move-down click PUTs the whole permuted order to the scope-matched endpoint', async () => {
    buildDom({ ownerForms: true });
    const calls = stubFetch(() => ({
      city_id: 'seattle',
      is_owner: true,
      city_partners: [cityPartner(1, 'City One'), cityPartner(2, 'City Two')],
      global_partners: [globalPartner(9, 'Global A'), globalPartner(8, 'Global B')],
    }));
    new PartnersPage({ isOwner: true }).init();
    await flush();

    document.querySelector('#partners-global-list .partners-row button[aria-label="Move down"]').click();
    await flush();

    const put = calls.find((c) => c.options.method === 'PUT');
    expect(put.url).toBe('/adminapi/globalPartners/order');
    expect(JSON.parse(put.options.body)).toEqual({ partner_ids: [8, 9] });
    // The swap renders optimistically, before the server answers.
    const names = [...document.querySelectorAll('#partners-global-list .partners-row-name')]
      .map((el) => el.textContent);
    expect(names).toEqual(['Global B', 'Global A']);
  });

  test('a create with no logo file is refused inline, without a request', async () => {
    buildDom({ ownerForms: false });
    const calls = stubFetch(() => ({
      city_id: 'seattle', is_owner: false, city_partners: [], global_partners: [],
    }));
    new PartnersPage({ isOwner: false }).init();
    await flush();
    const requestsBefore = calls.length;

    const form = document.querySelector('.partners-add-form[data-scope="city"]');
    form.elements.name.value = 'New Partner';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();

    const error = form.querySelector('.partners-form-error');
    expect(error.hidden).toBe(false);
    expect(error.textContent).toContain('logo');
    expect(calls.length).toBe(requestsBefore);
  });
});
