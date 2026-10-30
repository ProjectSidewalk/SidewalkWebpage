/**
 * The chrome every API docs page shares (#5840), from apiDocs.js: the "On This Page" contents and its scroll spy,
 * smooth scrolling to a heading, copying a heading's permalink, and the download buttons, which fetch the file
 * themselves to report progress and catch a download cut short.
 */

import { loadModules, mockModule } from './loader.js';
import { textOf } from './support/apiDocsHarness.js';

const copyToClipboard = vi.fn();
const initSidebarDisclosure = vi.fn();
mockModule('frontend/js/common/copyToClipboard.js', () => ({ copyToClipboard }));
mockModule('frontend/js/common/sidebarDisclosure.js', () => ({ initSidebarDisclosure }));
mockModule('i18next', () => ({ default: { t: (key) => key } }));

/** A docs page as layout.scala.html lays it out, with the given content and download buttons. */
function pageMarkup({ content = defaultContent(), buttons = defaultButtons() } = {}) {
  return `
    <div class="page-sidebar">
      <nav class="page-nav"><a class="page-nav-item" href="/v3/api-docs/streets">Streets</a></nav>
    </div>
    <div class="page-content">${content}${buttons}</div>
    <div class="page-toc"><ul></ul></div>`;
}

function defaultContent() {
  return `
    <h1 class="page-heading" id="streets-api">Streets API <a href="#streets-api" class="permalink">#</a></h1>
    <h2 class="page-heading" id="endpoint">Endpoint <a href="#endpoint" class="permalink">#</a></h2>
    <h3 class="page-heading" id="examples">Examples</h3>
    <p>No id here.</p>`;
}

function defaultButtons() {
  return `
    <div class="download-buttons">
      <button type="button" class="download-btn" data-format="geojson">
        <span class="format-icon">🗺</span> GeoJSON <span class="format-hint">For maps</span>
      </button>
      <button type="button" class="download-btn" data-format="csv">CSV</button>
      <button type="button" class="download-btn" data-format="shapefile"></button>
    </div>`;
}

/**
 * Loads apiDocs.js onto a fresh page and runs its DOMContentLoaded setup, caught rather than added so an earlier
 * test's copy of the module never sets this page up too.
 * @returns {Promise<object>} The module's exports.
 */
async function loadPage(markup = pageMarkup(), { endpoint = 'streets', baseUrl } = {}) {
  document.body.innerHTML = markup;
  delete document.documentElement.dataset.apiEndpoint;
  delete document.documentElement.dataset.apiBaseUrl;
  if (endpoint) document.documentElement.dataset.apiEndpoint = endpoint;
  if (baseUrl) document.documentElement.dataset.apiBaseUrl = baseUrl;

  let onReady;
  const add = document.addEventListener.bind(document);
  vi.spyOn(document, 'addEventListener').mockImplementation((type, handler, options) => {
    if (type === 'DOMContentLoaded') onReady = handler;
    else add(type, handler, options);
  });
  const exports = await loadModules('frontend/js/api-docs/apiDocs.js');
  document.addEventListener.mockRestore();
  onReady();
  return exports;
}

/** @returns {string[]} The contents list, as "<level class>: <text>". */
const tocEntries = () => [...document.querySelectorAll('.page-toc li')]
  .map((li) => `${li.className}: ${textOf(li)} -> ${li.querySelector('a').getAttribute('href')}`);

beforeEach(() => {
  window.appManager = { ready: (callback) => callback() };
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('the "On This Page" contents', () => {
  it('lists every heading with an id, at its level, without the permalink "#"', async () => {
    await loadPage();
    expect(tocEntries()).toEqual([
      'toc-level-1: Streets API -> #streets-api',
      'toc-level-2: Endpoint -> #endpoint',
      'toc-level-3: Examples -> #examples',
    ]);
  });

  it('rebuilds from scratch when a preview adds headings and asks again', async () => {
    const { generateTableOfContents } = await loadPage();
    document.querySelector('.page-content').insertAdjacentHTML('beforeend', '<h2 id="tags">Tags</h2>');
    generateTableOfContents();
    expect(tocEntries()).toHaveLength(4);
    expect(tocEntries().at(-1)).toBe('toc-level-2: Tags -> #tags');
  });

  it('stays empty, with a warning, on a page without a heading that has an id', async () => {
    await loadPage(pageMarkup({ content: '<h2>Untitled</h2>', buttons: '' }));
    expect(tocEntries()).toEqual([]);
    expect(console.warn).toHaveBeenCalledWith('No headings with IDs found in content for TOC');
  });

  it('reports a page missing its contents column rather than throwing', async () => {
    const { generateTableOfContents } = await loadPage();
    document.querySelector('.page-toc').remove();
    generateTableOfContents();
    expect(console.error).toHaveBeenCalledWith('Could not find content or TOC container elements');
  });
});

describe('the scroll spy', () => {
  /** jsdom does no layout, so each section's top is set by hand. */
  function placeSections(tops) {
    Object.entries(tops).forEach(([id, top]) => {
      Object.defineProperty(document.getElementById(id), 'offsetTop', { configurable: true, value: top });
    });
  }

  const highlighted = () => [...document.querySelectorAll('.page-toc a.is-active')].map((a) => a.getAttribute('href'));

  /** Scrolls the window to `y` and lets the debounced handler run. */
  function scrollTo(y) {
    window.scrollY = y;
    window.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(50);
  }

  it('highlights the last section whose top has scrolled past the navbar', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = pageMarkup();
    placeSections({ 'streets-api': 0, endpoint: 500, examples: 900 });
    const { generateTableOfContents, setupScrollSpy } = await loadModules('frontend/js/api-docs/apiDocs.js');
    generateTableOfContents();
    window.scrollY = 0;
    setupScrollSpy();
    vi.advanceTimersByTime(100);
    expect(highlighted()).toEqual(['#streets-api']);

    // Sections count as reached 70px early: the 50px navbar, plus 20px of breathing room.
    scrollTo(429);
    expect(highlighted()).toEqual(['#streets-api']);
    scrollTo(430);
    expect(highlighted()).toEqual(['#endpoint']);
    scrollTo(5000);
    expect(highlighted()).toEqual(['#examples']);
  });

  it('waits for scrolling to pause before it highlights', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = pageMarkup();
    placeSections({ 'streets-api': 0, endpoint: 500, examples: 900 });
    const { generateTableOfContents, setupScrollSpy } = await loadModules('frontend/js/api-docs/apiDocs.js');
    generateTableOfContents();
    window.scrollY = 0;
    setupScrollSpy();
    vi.advanceTimersByTime(100);

    window.scrollY = 1000;
    window.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(30);
    window.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(30);
    expect(highlighted()).toEqual(['#streets-api']);
    vi.advanceTimersByTime(20);
    expect(highlighted()).toEqual(['#examples']);
  });

  it('highlights nothing above the first section', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = pageMarkup();
    placeSections({ 'streets-api': 400, endpoint: 500, examples: 900 });
    const { generateTableOfContents, setupScrollSpy } = await loadModules('frontend/js/api-docs/apiDocs.js');
    generateTableOfContents();
    window.scrollY = 0;
    setupScrollSpy();
    vi.advanceTimersByTime(100);
    expect(highlighted()).toEqual([]);
  });

  it('does nothing on a page with no contents links or no content column', async () => {
    const { setupScrollSpy } = await loadModules('frontend/js/api-docs/apiDocs.js');
    document.body.innerHTML = pageMarkup();
    setupScrollSpy();
    expect(console.warn).toHaveBeenCalledWith(
      'No elements with IDs found in content or no TOC links found for scroll spy.');

    document.body.innerHTML = '';
    expect(() => setupScrollSpy()).not.toThrow();
  });
});

describe('clicking a link to a heading', () => {
  beforeEach(() => {
    window.scrollY = 300;
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  });

  it('glides there, stopping short of the navbar, instead of jumping', async () => {
    await loadPage();
    vi.spyOn(document.getElementById('endpoint'), 'getBoundingClientRect').mockReturnValue({ top: 200 });
    const link = document.querySelector('.page-toc a[href="#endpoint"]');
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    // 200 on screen + 300 scrolled, less the 50px navbar and 10px of padding.
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 440, behavior: 'smooth' });
  });

  it('leaves a link to a missing heading, or to another page, alone', async () => {
    await loadPage();
    const toc = document.querySelector('.page-toc ul');
    toc.insertAdjacentHTML('beforeend', '<li><a href="#gone">Gone</a></li><li><a href="/v3/api-docs">Index</a></li>');
    document.querySelector('a[href="#gone"]').click();
    expect(console.warn).toHaveBeenCalledWith('Smooth scroll target element not found for id: gone');

    const away = new MouseEvent('click', { bubbles: true, cancelable: true });
    document.querySelector('a[href="/v3/api-docs"]').dispatchEvent(away);
    expect(away.defaultPrevented).toBe(false);
    toc.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(window.scrollTo).not.toHaveBeenCalled();
  });
});

describe('a heading permalink', () => {
  it('is labeled as a copy button once translations load', async () => {
    await loadPage();
    const permalink = document.querySelector('a.permalink');
    expect(permalink.getAttribute('aria-label')).toBe('common:copy.section-link');
    expect(permalink.dataset.psTooltip).toBe('common:copy.section-link');
  });

  it("copies its section's full URL instead of jumping to it", async () => {
    await loadPage();
    const permalink = document.querySelector('a.permalink[href="#endpoint"]');
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    permalink.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(copyToClipboard).toHaveBeenCalledWith(permalink, 'http://localhost/#endpoint');
  });

  it('copies nothing on a click elsewhere in the content', async () => {
    await loadPage();
    document.querySelector('.page-content p').click();
    expect(copyToClipboard).not.toHaveBeenCalled();
  });

  it('sets up the sidebar disclosure too', async () => {
    await loadPage();
    expect(initSidebarDisclosure).toHaveBeenCalled();
  });
});

describe('the download buttons', () => {
  /** A fetch Response fed a chunk at a time: `push` sends one, `end` finishes the body, `fail` breaks it. */
  function streamedResponse({ status = 200, headers = {}, body } = {}) {
    const reads = [];
    const waiting = [];
    const settle = (result) => (waiting.length ? waiting.shift()(result) : reads.push(result));
    const response = {
      status,
      ok: status < 400,
      headers: new Headers(headers),
      json: async () => {
        if (body === undefined) throw new SyntaxError('not JSON');
        return body;
      },
      body: {
        getReader: () => ({
          read: () => (reads.length
            ? Promise.resolve(reads.shift()).then((r) => (r instanceof Error ? Promise.reject(r) : r))
            : new Promise((resolve, reject) => waiting.push((r) => (r instanceof Error ? reject(r) : resolve(r))))),
        }),
      },
    };
    return {
      response,
      push: (text) => settle({ done: false, value: typeof text === 'string' ? new TextEncoder().encode(text) : text }),
      end: () => settle({ done: true }),
      fail: () => settle(new Error('network changed')),
    };
  }

  const saved = [];

  beforeEach(() => {
    saved.length = 0;
    URL.createObjectURL = vi.fn(() => 'blob:download');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      if (this.download) saved.push({ name: this.download, href: this.href, inPage: document.body.contains(this) });
    });
  });

  /** Waits out the promise chain between a stream event and the page's reaction to it. */
  const settle = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  /** @returns {{state: string, message: string, detail: string, bar: ?string}} What the status line shows. */
  function status() {
    const box = document.querySelector('.download-status');
    const bar = box.querySelector('.download-status-bar');
    return {
      state: box.dataset.state,
      message: box.querySelector('.download-status-message').textContent,
      detail: box.querySelector('.download-status-detail').textContent,
      bar: bar.classList.contains('ps-hidden') ? null : bar.getAttribute('aria-valuenow'),
    };
  }

  const button = (format) => document.querySelector(`.download-btn[data-format="${format}"]`);

  it('asks for the file from this page\'s endpoint, and reports it being prepared', async () => {
    const stream = streamedResponse({ headers: { 'Content-Type': 'text/csv' } });
    window.fetch = vi.fn(async () => stream.response);
    await loadPage(undefined, { baseUrl: '/v3/api' });
    button('csv').click();
    expect(window.fetch).toHaveBeenCalledWith('/v3/api/streets?filetype=csv', { cache: 'no-store' });
    expect(status()).toEqual({ state: 'working', message: 'Preparing the CSV file', detail: '', bar: null });
    expect(document.querySelector('.download-status-icon').className).toContain('loading-spinner');
    stream.end();
    await settle();
  });

  it('shows progress against a declared size, and saves the file under the name the server gave it', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const stream = streamedResponse({
      headers: {
        'Content-Type': 'application/zip',
        'X-File-Size': String(4 * 1024 * 1024),
        'Content-Disposition': 'attachment; filename="streets_seattle.zip"',
      },
    });
    window.fetch = vi.fn(async () => stream.response);
    await loadPage();
    button('shapefile').click();
    await settle();

    stream.push(new Uint8Array(1024 * 1024));
    await settle();
    // A button with no text of its own goes by its format.
    expect(status()).toEqual(
      { state: 'working', message: 'Downloading the shapefile file', detail: '1.0 MB of 4.0 MB', bar: '25' });

    // Within a quarter second of the last repaint, a chunk changes nothing on screen.
    stream.push(new Uint8Array(1024 * 1024));
    await settle();
    expect(status().bar).toBe('25');

    Date.now.mockReturnValue(1300);
    stream.push(new Uint8Array(2 * 1024 * 1024));
    await settle();
    expect(status().bar).toBe('100');

    stream.end();
    await settle();
    expect(saved).toEqual([{ name: 'streets_seattle.zip', href: 'blob:download', inPage: true }]);
    expect(document.querySelector('a[download]')).toBeNull();
    expect(status()).toEqual(
      { state: 'done', message: 'Downloaded streets_seattle.zip', detail: '4.0 MB', bar: null });
    expect(document.querySelector('.download-status-icon').className).toContain('download-status-icon--done');
  });

  it('shows a running size, without a bar, for a file whose size isn\'t known up front', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const stream = streamedResponse({ headers: { 'Content-Type': 'application/geo+json' } });
    window.fetch = vi.fn(async () => stream.response);
    await loadPage();
    button('geojson').click();
    await settle();
    stream.push('{"type":"FeatureCollection","features":[]}');
    await settle();
    expect(status()).toEqual({ state: 'working', message: 'Downloading the GeoJSON file', detail: '1 KB', bar: null });
    stream.end();
    await settle();
    // Unnamed by the server, the file is named after the endpoint, with the format's extension.
    expect(saved.map((s) => s.name)).toEqual(['streets.geojson']);
  });

  it('ignores a compressed Content-Length, which would undercount what arrives', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const stream = streamedResponse({
      headers: { 'Content-Type': 'text/csv', 'Content-Encoding': 'gzip', 'Content-Length': '10' },
    });
    window.fetch = vi.fn(async () => stream.response);
    await loadPage();
    button('csv').click();
    await settle();
    stream.push('a,b\n1,2\n');
    await settle();
    expect(status().bar).toBeNull();
    stream.end();
    await settle();
    expect(status().state).toBe('done');
  });

  it('trusts an uncompressed Content-Length', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const stream = streamedResponse({ headers: { 'Content-Type': 'text/csv', 'Content-Length': '16' } });
    window.fetch = vi.fn(async () => stream.response);
    await loadPage();
    button('csv').click();
    await settle();
    stream.push('a,b\n');
    await settle();
    expect(status().bar).toBe('25');
    stream.end();
    await settle();
  });

  it.each([
    ["filename*=UTF-8''streets%20(1).csv", 'streets (1).csv'],
    ['filename=100%.csv', '100%.csv'],
  ])('reads a Content-Disposition of `%s` as the name "%s"', async (disposition, name) => {
    const stream = streamedResponse({ headers: { 'Content-Disposition': `attachment; ${disposition}` } });
    window.fetch = vi.fn(async () => stream.response);
    await loadPage();
    button('csv').click();
    await settle();
    stream.end();
    await settle();
    expect(saved.map((s) => s.name)).toEqual([name]);
  });

  it('holds a big download in a Blob rather than in loose chunks, and saves all of it', async () => {
    const stream = streamedResponse({ headers: { 'Content-Type': 'text/csv' } });
    window.fetch = vi.fn(async () => stream.response);
    const blobs = vi.spyOn(window, 'Blob');
    await loadPage();
    button('csv').click();
    await settle();
    stream.push(new Uint8Array(33 * 1024 * 1024));
    await settle();
    // The empty starting Blob, then one fold once more than 32 MB is waiting.
    expect(blobs).toHaveBeenCalledTimes(2);
    stream.push('tail');
    stream.end();
    await settle();
    const savedBlob = URL.createObjectURL.mock.calls[0][0];
    expect(savedBlob.size).toBe(33 * 1024 * 1024 + 4);
    expect(status().detail).toBe('33.0 MB');
  });

  it('frees the saved file a minute later, not at once', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const stream = streamedResponse();
    window.fetch = vi.fn(async () => stream.response);
    await loadPage();
    button('csv').click();
    await settle();
    stream.end();
    await settle();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:download');
  });

  describe('a download cut short', () => {
    it('fails a JSON file that ends before its closing bracket', async () => {
      const stream = streamedResponse({ headers: { 'Content-Type': 'application/json' } });
      window.fetch = vi.fn(async () => stream.response);
      await loadPage();
      button('geojson').click();
      await settle();
      stream.push('{"type":"FeatureCollection","features":[{"type":');
      stream.end();
      await settle();
      expect(status()).toMatchObject(
        { state: 'error', message: 'The download stopped before it finished. Please try again.' });
      expect(saved).toEqual([]);
    });

    it('accepts a JSON array that ends in its bracket', async () => {
      const stream = streamedResponse({ headers: { 'Content-Type': 'application/json' } });
      window.fetch = vi.fn(async () => stream.response);
      await loadPage();
      button('geojson').click();
      await settle();
      stream.push('[1, 2]\n');
      stream.end();
      await settle();
      expect(status().state).toBe('done');
    });

    it('fails a file shorter than its declared size', async () => {
      const stream = streamedResponse({ headers: { 'X-File-Size': '100' } });
      window.fetch = vi.fn(async () => stream.response);
      await loadPage();
      button('csv').click();
      await settle();
      stream.push('only part');
      stream.end();
      await settle();
      expect(status().state).toBe('error');
      expect(saved).toEqual([]);
    });

    it('fails a stream that breaks partway', async () => {
      const stream = streamedResponse();
      window.fetch = vi.fn(async () => stream.response);
      await loadPage();
      button('csv').click();
      await settle();
      stream.push('a,b\n');
      stream.fail();
      await settle();
      expect(status()).toMatchObject(
        { state: 'error', message: 'The download stopped before it finished. Please try again.' });
    });
  });

  describe('a download that never starts', () => {
    it('says the connection may have dropped when the request itself fails', async () => {
      window.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
      await loadPage();
      button('csv').click();
      await settle();
      expect(status()).toMatchObject({
        state: 'error',
        message: 'The download failed before it started. The connection may have dropped. Please try again.',
      });
    });

    it('warns, rather than errs, when the same file is already being built', async () => {
      window.fetch = vi.fn(async () => streamedResponse({ status: 429 }).response);
      await loadPage();
      button('csv').click();
      await settle();
      expect(status()).toMatchObject({ state: 'warning', message: 'common:download-already-preparing' });
    });

    it.each([
      [{ detail: 'regionId 99 does not exist.', title: 'Bad Request' }, 'regionId 99 does not exist.'],
      [{ title: 'Bad Request' }, 'Bad Request'],
      [{}, 'Please try again.'],
      [undefined, 'Please try again.'],
    ])('passes on what an error body (%j) says about the failure', async (problem, said) => {
      window.fetch = vi.fn(async () => streamedResponse({ status: 400, body: problem }).response);
      await loadPage();
      button('csv').click();
      await settle();
      expect(status()).toMatchObject({ state: 'error', message: `The download failed (error 400). ${said}` });
    });

    it('catches anything else that goes wrong, and frees the buttons', async () => {
      window.fetch = vi.fn(async () => ({ ok: true, status: 200, headers: null }));
      await loadPage();
      button('csv').click();
      await settle();
      expect(status()).toMatchObject(
        { state: 'error', message: 'Something went wrong with the download. Please try again.' });
      expect(button('csv').getAttribute('aria-disabled')).toBe('false');
    });
  });

  it('marks every button busy, ignores clicks, and guards against leaving until the download ends', async () => {
    const stream = streamedResponse();
    window.fetch = vi.fn(async () => stream.response);
    const listen = vi.spyOn(window, 'addEventListener');
    const unlisten = vi.spyOn(window, 'removeEventListener');
    await loadPage();
    button('csv').click();
    await settle();
    expect([...document.querySelectorAll('.download-btn')].map((b) => b.getAttribute('aria-disabled')))
      .toEqual(['true', 'true', 'true']);
    const guard = listen.mock.calls.find(([type]) => type === 'beforeunload')[1];
    const leaving = new Event('beforeunload', { cancelable: true });
    guard(leaving);
    expect(leaving.defaultPrevented).toBe(true);

    button('geojson').click();
    expect(window.fetch).toHaveBeenCalledTimes(1);

    stream.end();
    await settle();
    expect(unlisten).toHaveBeenCalledWith('beforeunload', guard);
    expect(button('geojson').getAttribute('aria-disabled')).toBe('false');
  });

  it('falls back to the default base URL, and a placeholder endpoint, on a page that sets neither', async () => {
    window.fetch = vi.fn(async () => streamedResponse({ status: 429 }).response);
    await loadPage(undefined, { endpoint: null });
    button('csv').click();
    expect(window.fetch.mock.calls[0][0]).toBe('/v3/api/NEEDS_TO_BE_SET_BY_API_DOC_PAGE?filetype=csv');
  });

  it('adds no status line to a page without download buttons', async () => {
    await loadPage(pageMarkup({ buttons: '' }));
    expect(document.querySelector('.download-status')).toBeNull();
  });
});

describe('the "Download BibTeX" button', () => {
  it('saves the citation as project_sidewalk.bib', async () => {
    document.body.innerHTML = '<button id="download-bibtex">BibTeX</button>';
    let blob;
    URL.createObjectURL = vi.fn((b) => { blob = b; return 'blob:bib'; });
    URL.revokeObjectURL = vi.fn();
    const clicked = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      clicked.push([this.download, this.href]);
    });
    const { setupBibtexDownload } = await loadModules('frontend/js/api-docs/bibtexDownload.js');
    setupBibtexDownload();
    document.getElementById('download-bibtex').click();

    expect(clicked).toEqual([['project_sidewalk.bib', 'blob:bib']]);
    expect(await blob.text()).toContain('@inproceedings{Saha_ProjectSidewalk_CHI2019');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:bib');
    expect(document.querySelector('a[download]')).toBeNull();
  });
});
