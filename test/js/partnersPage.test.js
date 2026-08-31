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
    <form class="partners-add-form" data-scope="${scope}" data-max-upload-bytes="5242880"
      data-max-stored-bytes="1048576">
      <h3 class="partners-form-heading">Add a partner</h3>
      <input type="text" name="name" maxlength="100">
      <input type="url" name="url" maxlength="500">
      <input type="text" name="alt_text" maxlength="300">
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

  test('a rapid second move click in the same scope is ignored while the first PUT is in flight', async () => {
    buildDom({ ownerForms: true });
    // Hold the reorder PUT open so the second click lands while the first is still in flight.
    let releasePut;
    const calls = [];
    global.fetch = jest.fn(async (url, options = {}) => {
      calls.push({ url, options });
      if (options.method === 'PUT') await new Promise((resolve) => { releasePut = resolve; });
      return {
        ok: true,
        json: async () => ({
          city_id: 'seattle',
          is_owner: true,
          city_partners: [cityPartner(1, 'City One'), cityPartner(2, 'City Two'), cityPartner(3, 'City Three')],
          global_partners: [],
        }),
      };
    });
    new PartnersPage({ isOwner: true }).init();
    await flush();

    document.querySelector('#partners-city-list .partners-row button[aria-label="Move down"]').click();
    await flush();
    // Concurrent full-order PUTs are last-writer-wins, so the arrows must be dead until the first one settles.
    for (const arrow of document.querySelectorAll(
      '#partners-city-list button[aria-label="Move up"], #partners-city-list button[aria-label="Move down"]')) {
      expect(arrow.disabled).toBe(true);
    }
    document.querySelectorAll('#partners-city-list .partners-row button[aria-label="Move down"]')[1].click();
    await flush();
    expect(calls.filter((c) => c.options.method === 'PUT')).toHaveLength(1);
    releasePut();
  });

  test("creating in one scope does not clear the other scope's in-progress edit", async () => {
    buildDom({ ownerForms: true });
    Element.prototype.scrollIntoView = jest.fn(); // Not implemented in jsdom; #startEdit scrolls to the form.
    const calls = stubFetch(() => ({
      city_id: 'seattle',
      is_owner: true,
      city_partners: [cityPartner(1, 'City One')],
      global_partners: [globalPartner(9, 'Global X')],
    }));
    new PartnersPage({ isOwner: true }).init();
    await flush();

    // Put the global form into edit mode for Global X, then create a city partner from the other form.
    document.querySelector('#partners-global-list .partners-row button[aria-label="Edit"]').click();
    const cityForm = document.querySelector('.partners-add-form[data-scope="city"]');
    cityForm.elements.name.value = 'New City Partner';
    Object.defineProperty(cityForm.elements.logo, 'files', {
      value: [new File(['x'], 'logo.png', { type: 'image/png' })],
    });
    cityForm.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();

    // Saving the global form must still be an update of Global X, never a duplicate global create.
    document.querySelector('.partners-add-form[data-scope="global"]')
      .dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();

    const saves = calls.filter((c) => c.options.method);
    expect(saves.map((c) => `${c.options.method} ${c.url}`)).toEqual([
      'POST /adminapi/partners',
      'PUT /adminapi/partners/9',
    ]);
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
