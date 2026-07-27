/**
 * Tests for public/js/aboutPage.js — the About page's Makeability Lab API hydration.
 *
 * The value here is pinning the contract with an API this repo doesn't own: the team roster, publication list, and
 * grant list all render straight off the ML payload shape, so a field rename or a nesting change on their side would
 * otherwise blank a section of the page with no signal. These tests also cover the presentation rules that aren't
 * obvious from the payload — multi-stint dedup, the role line's fallback chain, and which publications start visible.
 *
 * Runs under jsdom (set in jest.config.js via testEnvironment).
 */

const { loadGlobalScript } = require('./loadGlobalScript');

const MODULE_PATH = 'public/js/aboutPage.js';
const ML_API = 'https://makeabilitylab.cs.washington.edu/api/v1';

// jsdom implements neither AbortSignal.timeout() nor CSS.escape(), both of which the module calls and both of which
// are Baseline widely available in browsers. Stand them in here rather than weakening production code for jsdom.
if (typeof AbortSignal.timeout !== 'function') {
  AbortSignal.timeout = () => new AbortController().signal;
}
if (typeof globalThis.CSS?.escape !== 'function') {
  globalThis.CSS = { ...globalThis.CSS, escape: (value) => String(value).replace(/["\\\]]/g, '\\$&') };
}

/**
 * Builds a project-people row in the ML API's shape.
 *
 * @param {object} overrides - Fields to override on the default row.
 * @returns {object} A project-people row.
 */
function personRow(overrides = {}) {
  const { name = 'Jane Doe', urlName = 'janedoe', ...rest } = overrides;
  return {
    person: {
      id: 1,
      url_name: urlName,
      name,
      url: `https://makeabilitylab.cs.washington.edu/member/${urlName}/`,
      thumbnail: `https://makeabilitylab.cs.washington.edu/media/person/${urlName}.jpg`,
    },
    role: '',
    lead_project_role: null,
    start_date: '2020-01-01',
    end_date: null,
    is_active: true,
    ...rest,
  };
}

/**
 * Wraps rows in the ML API's paginated envelope.
 *
 * @param {object[]} results - The page's rows.
 * @returns {object} A single-page paginated response.
 */
const page = (results) => ({ count: results.length, next: null, previous: null, results });

/**
 * Installs a `fetch` stub that dispatches by URL, so each hydrator gets its own fixture.
 *
 * @param {object} routes - Map of URL substring to response body. An unmatched URL rejects, mimicking a dead endpoint.
 * @returns {jest.Mock} The installed fetch mock, for call assertions.
 */
function stubFetch(routes) {
  global.fetch = jest.fn((url) => {
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return Promise.reject(new Error(`unstubbed URL: ${url}`));
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(routes[key]) });
  });
  return global.fetch;
}

/** Runs the page's ready callback and lets every hydrator's promise chain settle. */
async function hydrate() {
  await window.__aboutReady();
  // init() fires the hydrators without awaiting them, so let the event loop turn over until they've all settled.
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

const EMPTY_SECTIONS = { '/publications/': page([]), '/grants/': page([]) };

describe('AboutPage', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="about-team-live" hidden>
        <ul id="about-team-current"></ul>
        <ul id="about-team-past"></ul>
        <ul id="about-team-all"></ul>
      </div>
      <template id="about-team-past-blurbs">
        <span data-person="kotarohara">Built the <b>first</b> prototype.</span>
      </template>
      <div id="about-pubs-list"></div>
      <button id="about-pubs-show-all" hidden data-label-template="Show all {0} publications"></button>
      <div id="about-cite" hidden>
        <button class="about-cite-copy" data-copy-target="about-cite-plain" data-copied-label="Copied">Copy</button>
        <p id="about-cite-plain"></p>
        <button class="about-cite-copy" data-copy-target="about-cite-bibtex" data-copied-label="Copied">Copy</button>
        <pre id="about-cite-bibtex"></pre>
      </div>
      <ul id="about-funding-grants" hidden></ul>`;
    sessionStorage.clear();
    // aboutPage.js defers its work to appManager.ready(); capture the callback so each test can run it on demand.
    window.appManager = { ready: (cb) => { window.__aboutReady = cb; } };
    window.logWebpageActivity = jest.fn();
  });

  afterEach(() => {
    delete global.fetch;
    delete window.appManager;
    delete window.__aboutReady;
    jest.restoreAllMocks();
  });

  describe('current team', () => {
    test('prefers the project role over the profile title, and drops a title the lead label already states', async () => {
      stubFetch({
        '/people/?format=json': page([
          personRow({ urlName: 'jonfroehlich', name: 'Jon E. Froehlich', lead_project_role: 'PI' }),
          personRow({ urlName: 'mikeysaugstad', name: 'Mikey Saugstad', lead_project_role: 'Research Scientist Lead' }),
          personRow({ urlName: 'chuli', name: 'Chu Li', start_date: '2022-09-01' }),
          personRow({ urlName: 'judyshanley', name: 'Judy L. Shanley', role: 'Community partnerships',
            start_date: '2023-01-01' }),
        ]),
        '/people/jonfroehlich/': { current_title: 'Professor' },
        '/people/mikeysaugstad/': { current_title: 'Research Scientist' },
        '/people/chuli/': { current_title: 'PhD Student' },
        ...EMPTY_SECTIONS,
      });
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      const roles = [...document.querySelectorAll('#about-team-current .about-team-role')].map((el) => el.textContent);
      expect(roles).toEqual([
        'Principal Investigator · Professor',
        // Not "Research Scientist Lead · Research Scientist".
        'Research Scientist Lead',
        'PhD Student',
        // The project role wins over this person's profile title, which is never fetched.
        'Community partnerships',
      ]);
    });

    test('renders each member\'s affiliation on its own line', async () => {
      stubFetch({
        '/people/?format=json': page([
          personRow({ urlName: 'chuli', name: 'Chu Li' }),
          personRow({ urlName: 'judyshanley', name: 'Judy L. Shanley', role: 'Community partnerships',
            start_date: '2023-01-01' }),
        ]),
        '/people/chuli/': { current_title: 'PhD Student', current_school: 'University of Washington' },
        '/people/judyshanley/': { current_title: 'Director', current_school: 'Easterseals' },
        ...EMPTY_SECTIONS,
      });
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      const orgs = [...document.querySelectorAll('#about-team-current .about-team-affiliation')]
        .map((el) => el.textContent);
      expect(orgs).toEqual(['University of Washington', 'Easterseals']);
    });

    test('omits the affiliation line entirely when the API carries no institution', async () => {
      stubFetch({
        '/people/?format=json': page([personRow({ urlName: 'chuli', name: 'Chu Li' })]),
        '/people/chuli/': { current_title: 'PhD Student' },
        ...EMPTY_SECTIONS,
      });
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      expect(document.querySelector('#about-team-current .about-team-affiliation')).toBeNull();
      expect(document.querySelector('#about-team-current .about-team-role').textContent).toBe('PhD Student');
    });

    test('a failed profile request costs only that member their title and affiliation', async () => {
      stubFetch({
        '/people/?format=json': page([
          personRow({ urlName: 'ok', name: 'Ok Person' }),
          personRow({ urlName: 'broken', name: 'Broken Profile', start_date: '2021-01-01' }),
        ]),
        '/people/ok/': { current_title: 'PhD Student', current_school: 'University of Washington' },
        ...EMPTY_SECTIONS,
      }); // /people/broken/ rejects.
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      const cards = [...document.querySelectorAll('#about-team-current .about-team-member')];
      expect(cards.map((el) => el.querySelector('.about-team-name').textContent))
        .toEqual(['Ok Person', 'Broken Profile']);
      expect(cards[0].querySelector('.about-team-affiliation').textContent).toBe('University of Washington');
      expect(cards[1].querySelector('.about-team-affiliation')).toBeNull();
      expect(cards[1].querySelector('.about-team-role').textContent).toBe('');
    });

    test('leads are ordered PI, Co-PI, then the rest', async () => {
      stubFetch({
        '/people/?format=json': page([
          personRow({ urlName: 'chuli', name: 'Chu Li', role: 'Student' }),
          personRow({ urlName: 'yochai', name: 'Yochai Eisenberg', lead_project_role: 'Co-PI', role: 'Co-PI' }),
          personRow({ urlName: 'jon', name: 'Jon E. Froehlich', lead_project_role: 'PI', role: 'PI' }),
        ]),
        ...EMPTY_SECTIONS,
      });
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      const names = [...document.querySelectorAll('#about-team-current .about-team-name')].map((el) => el.textContent);
      expect(names).toEqual(['Jon E. Froehlich', 'Yochai Eisenberg', 'Chu Li']);
    });

    test('escapes API-sourced names rather than injecting them as markup', async () => {
      stubFetch({
        '/people/?format=json': page([personRow({ urlName: 'xss', name: '<img src=x onerror=alert(1)>' })]),
        '/people/xss/': { current_title: 'Researcher' },
        ...EMPTY_SECTIONS,
      });
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      expect(document.querySelector('#about-team-current img[onerror]')).toBeNull();
      expect(document.querySelector('#about-team-current .about-team-name').textContent)
        .toBe('<img src=x onerror=alert(1)>');
    });

    test('the roster stays hidden when the API returns nobody active', async () => {
      stubFetch({
        '/people/?format=json': page([personRow({ is_active: false, end_date: '2021-01-01' })]),
        ...EMPTY_SECTIONS,
      });
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      expect(document.getElementById('about-team-live').hidden).toBe(true);
    });
  });

  describe('past leads and contributors', () => {
    test('merges a contributor\'s multiple stints into one roll-call entry', async () => {
      stubFetch({
        '/people/?format=json': page([
          personRow({ urlName: 'active', name: 'Active Person', role: 'Lead dev' }),
          personRow({ urlName: 'neha', name: 'Neha A.', is_active: false, start_date: '2024-05-01',
            end_date: '2024-06-14' }),
          personRow({ urlName: 'neha', name: 'Neha A.', is_active: false, start_date: '2024-09-23',
            end_date: '2024-10-28' }),
        ]),
        ...EMPTY_SECTIONS,
      });
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      const contributors = [...document.querySelectorAll('#about-team-all li')].map((el) => el.textContent.trim());
      expect(contributors).toEqual(['Neha A.']);
    });

    test('annotates contributors with the title and school they held during the project', async () => {
      stubFetch({
        '/people/?format=json': page([
          personRow({ urlName: 'active', name: 'Active Person', role: 'Lead dev' }),
          personRow({ urlName: 'ugrad', name: 'Undergrad Person', is_active: false, end_date: '2016-01-01',
            title: 'Undergrad', school: 'University of Maryland', school_abbreviated: 'UMD' }),
          personRow({ urlName: 'hs', name: 'High Schooler', is_active: false, end_date: '2019-01-01',
            title: 'High School' }),
          personRow({ urlName: 'bare', name: 'Bare Person', is_active: false, end_date: '2020-01-01' }),
        ]),
        ...EMPTY_SECTIONS,
      });
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      const rows = [...document.querySelectorAll('#about-team-all li')]
        .map((el) => el.textContent.replace(/\s+/g, ' ').trim());
      expect(rows).toEqual(['Bare Person', 'High Schooler High School', 'Undergrad Person Undergrad, UMD']);
      // The credential is a separate span so it can be styled apart from the linked name.
      expect(document.querySelectorAll('#about-team-all .about-team-credential')).toHaveLength(2);
    });

    test('carries a credential across a contributor\'s merged stints', async () => {
      stubFetch({
        '/people/?format=json': page([
          personRow({ urlName: 'active', name: 'Active Person', role: 'Lead dev' }),
          personRow({ urlName: 'neha', name: 'Neha A.', is_active: false, start_date: '2024-05-01',
            end_date: '2024-06-14' }),
          personRow({ urlName: 'neha', name: 'Neha A.', is_active: false, start_date: '2024-09-23',
            end_date: '2024-10-28', title: 'Undergrad', school_abbreviated: 'UW' }),
        ]),
        ...EMPTY_SECTIONS,
      });
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      expect(document.querySelector('#about-team-all .about-team-credential').textContent).toBe('Undergrad, UW');
    });

    test('grafts the server-rendered localized blurb onto the matching past-lead card', async () => {
      stubFetch({
        '/people/?format=json': page([
          personRow({ urlName: 'active', name: 'Active Person', role: 'Lead dev' }),
          personRow({ urlName: 'kotarohara', name: 'Kotaro Hara', lead_project_role: 'Student Lead',
            is_active: false, start_date: '2012-03-01', end_date: '2016-12-21' }),
          personRow({ urlName: 'noblurb', name: 'No Blurb', lead_project_role: 'Co-PI',
            is_active: false, start_date: '2012-08-01', end_date: '2017-07-21' }),
        ]),
        ...EMPTY_SECTIONS,
      });
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      // Past leads sort by lead rank, so the Co-PI card precedes the Student Lead one.
      const cards = [...document.querySelectorAll('#about-team-past .about-team-member')];
      expect(cards.map((el) => el.querySelector('.about-team-name').textContent)).toEqual(['No Blurb', 'Kotaro Hara']);
      // The blurb is our own trusted markup, so its inline tags survive rather than being escaped.
      expect(cards[1].querySelector('.about-team-blurb').innerHTML).toContain('<b>first</b>');
      expect(cards[1].querySelector('.about-team-role').textContent).toBe('Student Lead, 2012–2016');
      expect(cards[0].querySelector('.about-team-blurb')).toBeNull();
    });

    test('a still-active lead is not also listed as a past lead or a contributor', async () => {
      stubFetch({
        '/people/?format=json': page([
          personRow({ urlName: 'jon', name: 'Jon E. Froehlich', lead_project_role: 'PI', role: 'PI' }),
        ]),
        ...EMPTY_SECTIONS,
      });
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      expect(document.querySelectorAll('#about-team-past li')).toHaveLength(0);
      expect(document.querySelectorAll('#about-team-all li')).toHaveLength(0);
    });
  });

  describe('publications', () => {
    /**
     * @param {number} i - Index that sets the date, descending, so higher i is older.
     * @param {object} overrides - Fields to override on the default publication.
     * @returns {object} A publication in the ML API's shape.
     */
    const pub = (i, overrides = {}) => ({
      title: `Paper ${i}`,
      date: `20${String(30 - i).padStart(2, '0')}-01-01`,
      year: 2030 - i,
      forum_name: 'CHI',
      authors: [{ name: 'Jon E. Froehlich' }],
      thumbnail: 'https://example.org/thumb.jpg',
      pdf_url: 'https://example.org/paper.pdf',
      official_url: '',
      arxiv_url: '',
      code_repo_url: '',
      forum_url: '',
      award: null,
      ...overrides,
    });

    test('shows the newest few plus every award winner, and hides the rest behind the show-all button', async () => {
      const pubs = [...Array(10)].map((_, i) => pub(i));
      pubs[9] = pub(9, { award: 'Best Paper' });
      stubFetch({ '/publications/': page(pubs), '/people/?format=json': page([]), '/grants/': page([]) });
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      const articles = [...document.querySelectorAll('.about-pub')];
      expect(articles).toHaveLength(10);
      // Eight most recent, plus the award winner that would otherwise have been cut.
      expect(articles.filter((el) => !el.hidden)).toHaveLength(9);
      expect(articles[9].hidden).toBe(false);
      expect(articles[8].hidden).toBe(true);

      const button = document.getElementById('about-pubs-show-all');
      expect(button.hidden).toBe(false);
      expect(button.textContent).toBe('Show all 10 publications');

      button.click();
      expect(document.querySelectorAll('.about-pub[hidden]')).toHaveLength(0);
      expect(button.hidden).toBe(true);
    });

    test('renders one icon pill per available link, and none for the absent ones', async () => {
      stubFetch({
        '/publications/': page([pub(0, { arxiv_url: 'https://arxiv.org/abs/1', official_url: 'https://doi.org/1' })]),
        '/people/?format=json': page([]),
        '/grants/': page([]),
      });
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      const pills = [...document.querySelectorAll('.about-pub-link')];
      expect(pills.map((el) => el.textContent.trim())).toEqual(['PDF', 'arXiv', 'DOI']);
      expect(pills.map((el) => el.querySelector('.about-pub-link-icon').getAttribute('src'))).toEqual([
        '/assets/images/icons/file-text-feather.svg',
        '/assets/images/icons/external-link-feather.svg',
        '/assets/images/icons/link-feather.svg',
      ]);
      // Decorative: the pill's own text already names the link.
      pills.forEach((el) => expect(el.querySelector('.about-pub-link-icon').getAttribute('alt')).toBe(''));
    });

    test('links the thumbnail to the paper, out of the tab order so it does not duplicate the title link', async () => {
      stubFetch({
        '/publications/': page([pub(0)]),
        '/people/?format=json': page([]),
        '/grants/': page([]),
      });
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      const link = document.querySelector('.about-pub-thumb').closest('a');
      expect(link.getAttribute('href')).toBe('https://example.org/paper.pdf');
      expect(link.getAttribute('tabindex')).toBe('-1');
      expect(link.getAttribute('aria-hidden')).toBe('true');
    });

    test('leaves the thumbnail unlinked when the publication has no URL at all', async () => {
      stubFetch({
        '/publications/': page([pub(0, { pdf_url: '', official_url: '', arxiv_url: '', forum_url: '' })]),
        '/people/?format=json': page([]),
        '/grants/': page([]),
      });
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      expect(document.querySelector('.about-pub-thumb').closest('a')).toBeNull();
    });

    test('stays quiet when nothing is hidden', async () => {
      stubFetch({
        '/publications/': page([pub(0), pub(1)]), '/people/?format=json': page([]), '/grants/': page([]),
      });
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      expect(document.getElementById('about-pubs-show-all').hidden).toBe(true);
    });

    test('does not repeat the year for a forum name that already carries it', async () => {
      stubFetch({
        '/publications/': page([pub(0, { forum_name: 'Proceedings of CHI 2030' })]),
        '/people/?format=json': page([]),
        '/grants/': page([]),
      });
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      expect(document.querySelector('.about-pub-venue').textContent.trim()).toBe('Proceedings of CHI 2030');
    });
  });

  describe('citation block', () => {
    const CITED = {
      id: 605,
      title: 'Project Sidewalk',
      date: '2019-05-01',
      year: 2019,
      forum_name: 'Proceedings of CHI 2019',
      authors: [{ name: 'Manaswi Saha' }],
      thumbnail: '',
      pdf_url: '',
      arxiv_url: '',
      code_repo_url: '',
      forum_url: '',
      award: null,
      official_url: 'https://doi.org/10.1145/3290605.3300292',
    };
    const DETAIL = {
      citation_html: 'Saha, M. (2019). Project Sidewalk. <i>Proceedings of CHI 2019</i>.',
      bibtex: '@inproceedings{SahaProjectCHI2019,\n  year={2019}\n}',
    };

    test('finds the cited paper by DOI and fills both panes', async () => {
      const other = { ...CITED, id: 700, title: 'Another Paper', date: '2024-01-01', year: 2024,
        official_url: 'https://doi.org/10.1145/other' };
      stubFetch({
        '/projects/sidewalk/publications/': page([other, CITED]),
        '/publications/605/': DETAIL,
        '/people/?format=json': page([]),
        '/grants/': page([]),
      });
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      expect(document.getElementById('about-cite').hidden).toBe(false);
      // citation_html is markup by contract, so its <i> survives as an element rather than as escaped text.
      expect(document.querySelector('#about-cite-plain i').textContent).toBe('Proceedings of CHI 2019');
      expect(document.getElementById('about-cite-bibtex').textContent).toBe(DETAIL.bibtex);
    });

    test('copies the pane\'s text and confirms on the button', async () => {
      const writeText = jest.fn(() => Promise.resolve());
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      stubFetch({
        '/projects/sidewalk/publications/': page([CITED]),
        '/publications/605/': DETAIL,
        '/people/?format=json': page([]),
        '/grants/': page([]),
      });
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      const bibtexButton = document.querySelector('[data-copy-target="about-cite-bibtex"]');
      bibtexButton.click();
      await Promise.resolve();
      expect(writeText).toHaveBeenCalledWith(DETAIL.bibtex);
      expect(bibtexButton.textContent).toBe('Copied');
    });

    test('stays hidden when the cited paper is not in the project list', async () => {
      stubFetch({
        '/projects/sidewalk/publications/': page([{ ...CITED, official_url: 'https://doi.org/10.1145/other' }]),
        '/people/?format=json': page([]),
        '/grants/': page([]),
      });
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      expect(document.getElementById('about-cite').hidden).toBe(true);
    });

    test('stays hidden, without taking the publication list down, when the detail request fails', async () => {
      stubFetch({
        '/projects/sidewalk/publications/': page([CITED]),
        '/people/?format=json': page([]),
        '/grants/': page([]),
      }); // /publications/605/ rejects.
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      expect(document.getElementById('about-cite').hidden).toBe(true);
      expect(document.querySelectorAll('.about-pub')).toHaveLength(1);
    });
  });

  describe('grants', () => {
    test('renders sponsor and id, treating the ML admin\'s literal "None" as absent', async () => {
      stubFetch({
        '/grants/': page([
          { title: 'Newer Grant', start_date: '2023-01-01', grant_id: 'None', grant_url: '',
            sponsor: { name: 'NSF' } },
          { title: 'Older Grant', start_date: '2019-01-01', grant_id: '1652339',
            grant_url: 'https://nsf.gov/award', sponsor: { name: 'NSF' } },
        ]),
        '/people/?format=json': page([]),
        '/publications/': page([]),
      });
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      const list = document.getElementById('about-funding-grants');
      expect(list.hidden).toBe(false);
      const items = [...list.querySelectorAll('li')].map((el) => el.textContent.replace(/\s+/g, ' ').trim());
      expect(items).toEqual(['Newer Grant — NSF', 'Older Grant — NSF (#1652339)']);
      expect(list.querySelector('a').getAttribute('href')).toBe('https://nsf.gov/award');
    });

    test('leaves the static funding paragraph as the fallback when the request fails', async () => {
      stubFetch({ '/people/?format=json': page([]), '/publications/': page([]) }); // /grants/ rejects.
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      expect(document.getElementById('about-funding-grants').hidden).toBe(true);
    });
  });

  describe('one failing section does not take out the others', () => {
    test('publications still render when the team request dies', async () => {
      stubFetch({ '/publications/': page([{ title: 'Paper', date: '2025-01-01', year: 2025, forum_name: 'CHI',
        authors: [{ name: 'Jon E. Froehlich' }], thumbnail: '', pdf_url: '', official_url: '', arxiv_url: '',
        code_repo_url: '', forum_url: '', award: null }]), '/grants/': page([]) }); // /people/ rejects.
      jest.spyOn(console, 'warn').mockImplementation(() => {});
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      expect(document.getElementById('about-team-live').hidden).toBe(true);
      expect(document.querySelectorAll('.about-pub')).toHaveLength(1);
    });
  });
});
