/**
 * Tests for the Partners admin page (#4516).
 *
 * The page draws two independently ordered lists and turns up/down clicks into a full-order PUT, so the properties
 * worth pinning are the ones a casual manual test misses: that the payload sent on reorder is the *whole* permuted
 * id list for the right scope's endpoint, that a non-Owner gets no edit controls on the global list while the city
 * list keeps them, and that a create with no file is refused client-side before any request is made.
 */

import { loadModules, mockModule } from './loader.js';
import { flush as settle, textOf } from './support/routeFetch.js';

// Deleting asks first; the dialog itself is not under test.
const ConfirmDialog = { confirm: vi.fn() };
mockModule('frontend/js/common/ConfirmDialog.js', () => ({ ConfirmDialog }));

const { PartnersPage } = await loadModules('frontend/js/admin-dashboard/PartnersPage.js');

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
  window.fetch = vi.fn(async (url, options = {}) => {
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
    window.fetch = vi.fn(async (url, options = {}) => {
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
    Element.prototype.scrollIntoView = vi.fn(); // Not implemented in jsdom; #startEdit scrolls to the form.
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

describe('PartnersPage official-contact form (#5462)', () => {
  // Escaped as Twirl escapes the data-template attribute, with the message's own anchors inside.
  const TEMPLATE = 'Project Sidewalk is a research tool. To report a problem or request a repair, contact {name} '
    + 'directly. Feel free to include links to Project Sidewalk &lt;a href=&quot;/labelMap&quot;&gt;labels&lt;/a&gt; '
    + 'or &lt;a href=&quot;/stories&quot;&gt;stories&lt;/a&gt; in your request.';

  /** The partner containers plus the official-contact form, reduced to what the class touches. */
  function buildContactDom() {
    buildDom({ ownerForms: false });
    document.body.insertAdjacentHTML('afterbegin', `
      <form id="official-contact-form">
        <input type="text" name="name">
        <input type="url" name="url">
        <p id="official-contact-preview" data-template="${TEMPLATE}"></p>
        <button type="submit">Save</button>
        <button type="button" id="official-contact-clear">Turn off</button>
        <p id="official-contact-status"></p>
        <p class="partners-form-error" hidden></p>
      </form>`);
    return /** @type {any} */ (document.getElementById('official-contact-form'));
  }

  /**
   * Stubs fetch: the partner list is empty, the contact GET answers `saved`, and a contact PUT answers `putReply`.
   * @returns {Array<{url: string, options: Record<string, any>}>} Every call made.
   */
  function stubContactFetch(saved, putReply) {
    const calls = [];
    window.fetch = vi.fn(async (url, options = {}) => {
      calls.push({ url, options });
      if (url === '/adminapi/officialContact' && options.method === 'PUT') return putReply;
      if (url === '/adminapi/officialContact') return { ok: true, json: async () => saved };
      return { ok: true, json: async () => ({ city_id: 'burnaby', city_partners: [], global_partners: [] }) };
    });
    return calls;
  }

  const burnaby = { name: 'the City of Burnaby', url: 'https://www.burnaby.ca/our-city/contact-us' };

  test('loads the saved contact and previews the landing-page sentence with it', async () => {
    const form = buildContactDom();
    stubContactFetch(burnaby, null);
    new PartnersPage({ isOwner: false }).init();
    await flush();

    expect(form.elements.name.value).toBe(burnaby.name);
    expect(form.elements.url.value).toBe(burnaby.url);
    const preview = document.getElementById('official-contact-preview').textContent;
    expect(preview).toContain('contact the City of Burnaby directly.');
    expect(preview).toContain('Project Sidewalk labels or stories in your request.');
    expect(preview).not.toContain('<a');
  });

  test('says the notice is off when no URL is saved', async () => {
    buildContactDom();
    stubContactFetch({ name: null, url: null }, null);
    new PartnersPage({ isOwner: false }).init();
    await flush();

    expect(document.getElementById('official-contact-preview').textContent).toContain('Off');
  });

  test('save PUTs the fields as typed and shows what the server stored', async () => {
    const form = buildContactDom();
    const calls = stubContactFetch({ name: null, url: null }, {
      ok: true, json: async () => ({ success: true, ...burnaby }),
    });
    new PartnersPage({ isOwner: false }).init();
    await flush();

    form.elements.name.value = ` ${burnaby.name} `;
    form.elements.url.value = burnaby.url;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();

    const put = calls.find((c) => c.options.method === 'PUT');
    expect(JSON.parse(put.options.body)).toEqual({ name: ` ${burnaby.name} `, url: burnaby.url });
    expect(form.elements.name.value).toBe(burnaby.name); // The server's trimmed value comes back into the field.
    expect(document.getElementById('official-contact-status').textContent).toContain('saved');
  });

  test('turn off PUTs blank fields and empties the form', async () => {
    const form = buildContactDom();
    const calls = stubContactFetch(burnaby, { ok: true, json: async () => ({ success: true, name: null, url: null }) });
    new PartnersPage({ isOwner: false }).init();
    await flush();

    document.getElementById('official-contact-clear').click();
    await flush();

    const put = calls.find((c) => c.options.method === 'PUT');
    expect(JSON.parse(put.options.body)).toEqual({ name: '', url: '' });
    expect(form.elements.url.value).toBe('');
    expect(document.getElementById('official-contact-status').textContent).toContain('turned off');
  });

  test('previews a name containing $ patterns literally', async () => {
    const form = buildContactDom();
    stubContactFetch({ name: "the $' & $& Office", url: burnaby.url }, null);
    new PartnersPage({ isOwner: false }).init();
    await flush();

    expect(form.elements.name.value).toBe("the $' & $& Office");
    expect(document.getElementById('official-contact-preview').textContent)
      .toContain("contact the $' & $& Office directly.");
  });

  test("shows the server's rejection inline and keeps what the admin typed", async () => {
    const form = buildContactDom();
    stubContactFetch({ name: null, url: null }, {
      ok: false, json: async () => ({ success: false, error: 'The URL must be a full https:// link.' }),
    });
    new PartnersPage({ isOwner: false }).init();
    await flush();

    form.elements.name.value = burnaby.name;
    form.elements.url.value = 'http://www.burnaby.ca';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();

    const error = form.querySelector('.partners-form-error');
    expect(error.hidden).toBe(false);
    expect(error.textContent).toBe('The URL must be a full https:// link.');
    expect(document.getElementById('official-contact-status').textContent).toBe('');
    expect(form.elements.url.value).toBe('http://www.burnaby.ca');
  });
});

/**
 * Stubs fetch for the partner endpoints. The list answers `list` (a function, so a test can change it between loads);
 * any other request answers `replies["METHOD url"]` when given, else success.
 * @returns {Array<{method: string, url: string, body: any}>} Every request made.
 */
function fakeServer(list, replies = {}) {
  const calls = [];
  window.fetch = vi.fn(async (url, options = {}) => {
    const method = options.method || 'GET';
    calls.push({ method, url, body: options.body });
    const reply = replies[`${method} ${url}`];
    if (reply instanceof Error) throw reply;
    if (reply) {
      return { ok: reply.ok ?? true, status: reply.status ?? 200, json: async () => {
        if (reply.body === undefined) throw new SyntaxError('Unexpected end of JSON input');
        return reply.body;
      } };
    }
    if (url === '/adminapi/partners' && method === 'GET') return { ok: true, json: async () => list() };
    return { ok: true, json: async () => ({ success: true }) };
  });
  return calls;
}

// A fresh copy per load, as a real response would be; the page reorders the rows it was handed in place.
const listOf = (city, global = []) => () => structuredClone({ city_id: 'seattle', is_owner: true,
  city_partners: city, global_partners: global });

/** Starts an Owner's page (both forms) on the given server. */
async function startOwner(list, replies) {
  buildDom({ ownerForms: true });
  const calls = fakeServer(list, replies);
  new PartnersPage({ isOwner: true }).init();
  await settle();
  return calls;
}

const formFor = (scope) => /** @type {any} */ (document.querySelector(`.partners-add-form[data-scope="${scope}"]`));
const errorOf = (scope) => formFor(scope).querySelector('.partners-form-error');
const button = (list, label, n = 0) => document
  .querySelectorAll(`#partners-${list}-list button[aria-label="${label}"]`)[n];

/** Fills a form and submits it, with `file` as the chosen logo when given. */
async function submit(scope, { name = 'Acme', file } = {}) {
  const form = formFor(scope);
  form.elements.name.value = name;
  if (file) Object.defineProperty(form.elements.logo, 'files', { value: [file], configurable: true });
  form.dispatchEvent(new Event('submit', { cancelable: true }));
  await settle();
  await settle();
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  Element.prototype.scrollIntoView = vi.fn();
  ConfirmDialog.confirm = vi.fn(() => Promise.resolve(true));
});

describe('PartnersPage lists', () => {
  test('say when a scope has no partners yet', async () => {
    await startOwner(listOf([]));
    expect(textOf(document.getElementById('partners-city-list'))).toBe('No city partners yet.');
    expect(textOf(document.getElementById('partners-global-list'))).toBe('No global partners yet.');
    expect(document.getElementById('partners-status').textContent).toBe('0 global · 0 city');
  });

  test('say the list failed to load', async () => {
    buildDom({ ownerForms: true });
    fakeServer(listOf([]), { 'GET /adminapi/partners': { ok: false, status: 500 } });
    new PartnersPage({ isOwner: true }).init();
    await settle();
    expect(document.getElementById('partners-status').textContent)
      .toBe('Could not load partners. Reload to try again.');
  });

  test('describe a logo by its alt text, or by the name, and link a partner only when it has a site', async () => {
    await startOwner(listOf([{ ...cityPartner(1, 'With alt'), alt_text: 'A green leaf' },
      { ...cityPartner(2, 'No site'), url: null }]));
    const [first, second] = document.querySelectorAll('#partners-city-list .partners-row');
    expect(first.querySelector('img').alt).toBe('A green leaf');
    expect(first.querySelector('a.partners-row-url').getAttribute('target')).toBe('_blank');
    expect(second.querySelector('img').alt).toBe('No site logo');
    expect(second.querySelector('a')).toBeNull();
  });
});

describe('PartnersPage reordering', () => {
  test('turns the arrows back on once the new order is saved', async () => {
    const calls = await startOwner(listOf([cityPartner(1, 'One'), cityPartner(2, 'Two')]));
    button('city', 'Move up', 1).click();
    await settle();
    expect(JSON.parse(calls.find((c) => c.method === 'PUT').body)).toEqual({ partner_ids: [2, 1] });
    expect(button('city', 'Move down').disabled).toBe(false);
    expect(button('city', 'Move up').disabled).toBe(true);
  });

  test('reloads the server\'s order when the save is refused', async () => {
    const calls = await startOwner(listOf([cityPartner(1, 'One'), cityPartner(2, 'Two')]),
      { 'PUT /adminapi/partners/order': { ok: false, status: 409 } });
    button('city', 'Move down').click();
    await settle();
    expect(calls.filter((c) => c.method === 'GET' && c.url === '/adminapi/partners')).toHaveLength(2);
    expect([...document.querySelectorAll('#partners-city-list .partners-row-name')].map((el) => el.textContent))
      .toEqual(['One', 'Two']);
  });
});

describe('PartnersPage editing', () => {
  test('fills the form from the row, and saving sends an update without a new logo', async () => {
    const calls = await startOwner(listOf([{ ...cityPartner(1, 'City One'), url: null }]));
    button('city', 'Edit').click();
    const form = formFor('city');
    expect(form.elements.name.value).toBe('City One');
    expect(form.elements.url.value).toBe('');
    expect(form.querySelector('.partners-form-heading').textContent).toBe('Editing "City One"');
    expect(form.querySelector('[type="submit"]').textContent).toBe('Save changes');
    expect(form.querySelector('.partners-cancel-edit').hidden).toBe(false);

    await submit('city', { name: 'City One renamed' });
    const put = calls.find((c) => c.method === 'PUT');
    expect(put.url).toBe('/adminapi/partners/1');
    expect(put.body.get('name')).toBe('City One renamed');
    expect(put.body.has('logo')).toBe(false);
    // Back in add mode once saved.
    expect(form.querySelector('.partners-form-heading').textContent).toBe('Add a partner');
  });

  test('cancel puts the form back in add mode', async () => {
    await startOwner(listOf([cityPartner(1, 'City One')]));
    button('city', 'Edit').click();
    formFor('city').querySelector('.partners-cancel-edit').click();
    const form = formFor('city');
    expect(form.elements.name.value).toBe('');
    expect(form.querySelector('[type="submit"]').textContent).toBe('Add partner');
    expect(form.querySelector('.partners-cancel-edit').hidden).toBe(true);
  });

  test('editing a second row drops the first edit', async () => {
    const calls = await startOwner(listOf([cityPartner(1, 'City One')], [globalPartner(9, 'Global X')]));
    button('city', 'Edit').click();
    button('global', 'Edit').click();
    expect(formFor('city').querySelector('.partners-form-heading').textContent).toBe('Add a partner');
    await submit('city', { file: new File(['x'], 'logo.png', { type: 'image/png' }) });
    expect(calls.find((c) => c.method !== 'GET')).toMatchObject({ method: 'POST', url: '/adminapi/partners' });
  });

  test('an Owner adds a global partner to the global list', async () => {
    const calls = await startOwner(listOf([]));
    await submit('global', { file: new File(['x'], 'logo.jpg', { type: 'image/jpeg' }) });
    const post = calls.find((c) => c.method === 'POST');
    expect(post.url).toBe('/adminapi/globalPartners');
    expect(post.body.get('logo').name).toBe('logo.jpg');
  });
});

describe('PartnersPage save errors', () => {
  const png = () => new File(['x'], 'logo.png', { type: 'image/png' });

  test.each([
    ['logo_too_large', 'That image is too large. Upload a file under 5 MB.'],
    ['logo_encoded_too_large', 'Even re-encoded, that image exceeds the 1 MB storage cap. Try a smaller or simpler '
      + 'image.'],
    ['logo_invalid', 'That file could not be read as a PNG or JPEG image.'],
    ['name_invalid', 'Enter a partner name (at most 100 characters).'],
    ['url_invalid', 'Enter a full http(s) address, e.g. https://example.org.'],
    ['alt_text_invalid', 'Alt text can be at most 300 characters.'],
    ['bad_order', 'Someone else changed the list. Reloading.'],
    ['not_found', 'That partner no longer exists. Reloading.'],
    ['something_new', 'Something went wrong. Please try again.'],
  ])('a %s rejection reads "%s"', async (code, message) => {
    await startOwner(listOf([]), { 'POST /adminapi/partners': { ok: false, status: 400, body: { error: code } } });
    await submit('city', { file: png() });
    expect(errorOf('city').textContent).toBe(message);
    expect(errorOf('city').hidden).toBe(false);
    expect(formFor('city').querySelector('[type="submit"]').disabled).toBe(false);
  });

  test('a rejection with no readable body still says something went wrong', async () => {
    await startOwner(listOf([]), { 'POST /adminapi/partners': { ok: false, status: 502 } });
    await submit('city', { file: png() });
    expect(errorOf('city').textContent).toBe('Something went wrong. Please try again.');
  });

  test('a request that never arrives says something went wrong', async () => {
    await startOwner(listOf([]), { 'POST /adminapi/partners': new TypeError('Failed to fetch') });
    await submit('city', { file: png() });
    expect(errorOf('city').textContent).toBe('Something went wrong. Please try again.');
  });
});

describe('PartnersPage deleting', () => {
  test('asks first, then deletes and reloads', async () => {
    const calls = await startOwner(listOf([cityPartner(4, 'Gone')]));
    button('city', 'Delete').click();
    await settle();
    expect(ConfirmDialog.confirm.mock.calls[0][0].message).toContain('"Gone"');
    expect(calls.filter((c) => c.method !== 'GET')).toEqual([{ method: 'DELETE', url: '/adminapi/partners/4',
      body: undefined }]);
    expect(calls.filter((c) => c.url === '/adminapi/partners')).toHaveLength(2);
  });

  test('does nothing when the admin cancels', async () => {
    ConfirmDialog.confirm = vi.fn(() => Promise.resolve(false));
    const calls = await startOwner(listOf([cityPartner(4, 'Kept')]));
    button('city', 'Delete').click();
    await settle();
    expect(calls.filter((c) => c.method !== 'GET')).toHaveLength(0);
  });

  test('keeps the list as it was when the delete fails', async () => {
    const calls = await startOwner(listOf([cityPartner(4, 'Kept')]),
      { 'DELETE /adminapi/partners/4': { ok: false, status: 500 } });
    button('city', 'Delete').click();
    await settle();
    expect(calls.filter((c) => c.url === '/adminapi/partners')).toHaveLength(1);
    expect(console.error).toHaveBeenCalled();
  });
});

describe('PartnersPage SVG logos', () => {
  let drawn;
  let blob;
  let imageFails;

  beforeEach(() => {
    drawn = null;
    blob = new Blob(['png'], { type: 'image/png' });
    imageFails = false;
    URL.createObjectURL = vi.fn(() => 'blob:svg');
    URL.revokeObjectURL = vi.fn();
    // jsdom never loads an image or draws a canvas, so both answer by hand.
    vi.stubGlobal('Image', class {
      set src(url) {
        this.url = url;
        setTimeout(() => (imageFails ? this.onerror() : this.onload()));
      }
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () {
      return { drawImage: (img, x, y, w, h) => { drawn = { w, h, canvas: [this.width, this.height] }; } };
    });
    HTMLCanvasElement.prototype.toBlob = function (callback) { callback(blob); };
  });

  const svgFile = (markup, name = 'logo.svg') => new File([markup], name, { type: 'image/svg+xml' });
  const posted = (calls) => calls.find((c) => c.method === 'POST')?.body.get('logo');

  test('turns an SVG into a PNG 1200px on its long edge', async () => {
    const calls = await startOwner(listOf([]));
    await submit('city', { file: svgFile('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"></svg>',
      'Brand.SVG') });
    expect(drawn).toEqual({ w: 1200, h: 400, canvas: [1200, 400] });
    const logo = posted(calls);
    expect(logo.name).toBe('Brand.png');
    expect(logo.type).toBe('image/png');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:svg');
  });

  test('reads the size from the viewBox when width and height are percentages', async () => {
    const calls = await startOwner(listOf([]));
    await submit('city', { file: new File(['<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" '
      + 'viewBox="0,0,50,200"></svg>'], 'tall.svg', { type: '' }) });
    expect(drawn.canvas).toEqual([300, 1200]);
    expect(posted(calls).name).toBe('tall.png');
  });

  test.each([
    ['is not XML', 'not <svg'],
    ['is not an SVG', '<html xmlns="http://www.w3.org/1999/xhtml"></html>'],
    ['has no size', '<svg xmlns="http://www.w3.org/2000/svg"></svg>'],
    ['has a broken viewBox', '<svg xmlns="http://www.w3.org/2000/svg" width="10" viewBox="0 0 -5 x"></svg>'],
  ])('refuses one that %s, without a request', async (_, markup) => {
    const calls = await startOwner(listOf([]));
    await submit('city', { file: svgFile(markup) });
    expect(errorOf('city').textContent).toBe('That SVG could not be read. Re-export it, or upload a PNG.');
    expect(posted(calls)).toBeUndefined();
  });

  test('refuses one with live text, which would draw in the wrong font', async () => {
    await startOwner(listOf([]));
    await submit('city', { file: svgFile('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">'
      + '<text>Acme</text></svg>') });
    expect(errorOf('city').textContent).toMatch(/^That SVG uses live text/);
  });

  test('refuses one the browser cannot draw, or cannot turn into a PNG', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>';
    const calls = await startOwner(listOf([]));
    imageFails = true;
    await submit('city', { file: svgFile(svg) });
    expect(errorOf('city').textContent).toBe('That SVG could not be read. Re-export it, or upload a PNG.');
    imageFails = false;
    blob = null;
    await submit('city', { file: svgFile(svg) });
    expect(errorOf('city').textContent).toBe('That SVG could not be read. Re-export it, or upload a PNG.');
    expect(posted(calls)).toBeUndefined();
  });
});

describe('PartnersPage official-contact errors', () => {
  /** The official-contact form beside the partner lists. */
  function buildContact() {
    buildDom({ ownerForms: false });
    document.body.insertAdjacentHTML('afterbegin', `
      <form id="official-contact-form">
        <input type="text" name="name"><input type="url" name="url">
        <p id="official-contact-preview" data-template="Contact {name} directly."></p>
        <button type="submit">Save</button>
        <button type="button" id="official-contact-clear">Turn off</button>
        <p id="official-contact-status"></p>
        <p class="partners-form-error" hidden></p>
      </form>`);
    return /** @type {any} */ (document.getElementById('official-contact-form'));
  }
  const contactError = () => document.querySelector('#official-contact-form .partners-form-error').textContent;

  test('says the saved contact could not be read', async () => {
    buildContact();
    fakeServer(listOf([]), { 'GET /adminapi/officialContact': { ok: false, status: 500 } });
    new PartnersPage({ isOwner: false }).init();
    await settle();
    expect(contactError()).toBe('Could not load the official contact. Reload to try again.');
  });

  test('previews a URL with no name yet using a placeholder, updating as the admin types', async () => {
    const form = buildContact();
    fakeServer(listOf([]), { 'GET /adminapi/officialContact': { body: { name: null, url: null } } });
    new PartnersPage({ isOwner: false }).init();
    await settle();
    form.elements.url.value = 'https://example.org';
    form.dispatchEvent(new Event('input'));
    expect(document.getElementById('official-contact-preview').textContent)
      .toBe('Landing page preview: Contact … directly.');
  });

  test('says something went wrong for a refusal with no reason, or a request that never arrives', async () => {
    const form = buildContact();
    const replies = { 'GET /adminapi/officialContact': { body: { name: null, url: null } },
      'PUT /adminapi/officialContact': { ok: false, status: 500, body: {} } };
    fakeServer(listOf([]), replies);
    new PartnersPage({ isOwner: false }).init();
    await settle();
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
    expect(contactError()).toBe('Something went wrong. Please try again.');

    replies['PUT /adminapi/officialContact'] = new TypeError('Failed to fetch');
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
    expect(contactError()).toBe('Something went wrong. Please try again.');
  });
});
