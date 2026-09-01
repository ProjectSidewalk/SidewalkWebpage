/**
 * Tests for public/js/aboutPage.js — the About page's Makeability Lab API hydration.
 *
 * The value here is pinning the contract with an API this repo doesn't own: the team roster, publication list, and
 * grant list all render straight off the ML payload shape, so a field rename or a nesting change on their side would
 * otherwise blank a section of the page with no signal. These tests also cover the presentation rules that aren't
 * obvious from the payload — multi-stint dedup, the role line's lead-label dedup, and which publications start visible.
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
 * Stands in for the IntersectionObserver the section nav and the deferred map both use, which jsdom doesn't
 * implement. Instances register themselves so a test can drive the callback directly — jsdom has no layout, so
 * there's no scroll position for a faithful implementation to react to anyway.
 */
class FakeIntersectionObserver {
  static instances = [];

  constructor(callback, options) {
    this.callback = callback;
    this.options = options;
    this.targets = [];
    this.disconnected = false;
    FakeIntersectionObserver.instances.push(this);
  }

  observe(target) {
    this.targets.push(target);
  }

  disconnect() {
    this.disconnected = true;
  }

  /**
   * Reports the given targets as in view and every other observed target as out of it.
   *
   * @param {Element[]} intersecting - Targets to report as intersecting.
   */
  trigger(intersecting) {
    // A disconnected observer delivers nothing, which is the whole mechanism behind loading the map's libraries once.
    if (this.disconnected) return;
    this.callback(this.targets.map((target) => ({ target, isIntersecting: intersecting.includes(target) })), this);
  }
}
globalThis.IntersectionObserver = FakeIntersectionObserver;

/** Lets pending promise jobs and timers run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Fires `load` on every script the page has appended, repeatedly, so a sequential loader can advance.
 *
 * jsdom doesn't fetch external scripts, so neither `load` nor `error` would ever arrive on its own.
 *
 * @returns {Promise<string[]>} The `src` of each script, in the order it was appended.
 */
async function runInjectedScripts() {
  const loaded = [];
  for (let i = 0; i < 6; i++) {
    await settle();
    const pending = [...document.head.querySelectorAll('script[src]')].filter((s) => !loaded.includes(s));
    if (pending.length === 0) break;
    pending.forEach((script) => {
      loaded.push(script);
      script.dispatchEvent(new Event('load'));
    });
  }
  await settle();
  return loaded.map((script) => script.getAttribute('src'));
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
    position_title: '',
    position_school: '',
    position_school_abbreviated: '',
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
        <p id="about-team-contributors-intro" data-label-template="More than {0} people, including {1} students."
           >More than 140 people, including 128 students.</p>
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
    localStorage.clear();
    // The page renders asset URLs through util.assetPath, which the real page gets from the blocking utilities.js tag
    // in main.scala.html's <head>. Load it first here for the same reason.
    loadGlobalScript('public/js/common/utilities.js');
    FakeIntersectionObserver.instances = [];
    // aboutPage.js defers its work to appManager.ready(); capture the callback so each test can run it on demand.
    window.appManager = { ready: (cb) => { window.__aboutReady = cb; } };
    window.logWebpageActivity = jest.fn();
  });

  afterEach(() => {
    document.head.querySelectorAll('script[src], link[rel="stylesheet"]').forEach((el) => el.remove());
    delete global.fetch;
    delete window.appManager;
    delete window.__aboutReady;
    delete window.createPSMap;
    delete window.jQuery;
    jest.restoreAllMocks();
  });

  describe('current team', () => {
    test('titles each member from their roster position, dropping a title the lead label already states', async () => {
      stubFetch({
        '/people/?format=json': page([
          personRow({ urlName: 'jonfroehlich', name: 'Jon E. Froehlich', lead_project_role: 'PI',
            position_title: 'Professor' }),
          personRow({ urlName: 'mikeysaugstad', name: 'Mikey Saugstad', lead_project_role: 'Research Scientist Lead',
            position_title: 'Research Scientist' }),
          personRow({ urlName: 'chuli', name: 'Chu Li', start_date: '2022-09-01', position_title: 'PhD Student' }),
          personRow({ urlName: 'kianna', name: 'KiAnna Mckee-Steen', start_date: '2024-10-01',
            position_title: 'Project Coordinator' }),
        ]),
        ...EMPTY_SECTIONS,
      });
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      const lines = [...document.querySelectorAll('#about-team-current .about-team-member')]
        .map((card) => [...card.querySelectorAll('.about-team-role, .about-team-title')].map((el) => el.textContent));
      expect(lines).toEqual([
        ['Principal Investigator', 'Professor'],
        // "Research Scientist" is already inside "Research Scientist Lead", so it doesn't get a line of its own.
        ['Research Scientist Lead'],
        ['PhD Student'],
        ['Project Coordinator'],
      ]);
    });

    test('never runs a lead role and a position title together on one line', async () => {
      stubFetch({
        '/people/?format=json': page([
          personRow({ urlName: 'jonfroehlich', name: 'Jon E. Froehlich', lead_project_role: 'PI',
            position_title: 'Professor', position_school: 'University of Washington' }),
        ]),
        ...EMPTY_SECTIONS,
      });
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      const card = document.querySelector('#about-team-current .about-team-member');
      expect(card.textContent).not.toContain('·');
      expect([...card.querySelectorAll('span')].map((el) => el.textContent)).toEqual([
        'Jon E. Froehlich',
        'Principal Investigator',
        'Professor',
        'University of Washington',
      ]);
    });

    test('renders the whole roster from one request, without a per-member lookup', async () => {
      const fetchMock = stubFetch({
        '/people/?format=json': page([
          personRow({ urlName: 'jonfroehlich', name: 'Jon E. Froehlich', lead_project_role: 'PI',
            position_title: 'Professor', position_school: 'University of Washington' }),
          personRow({ urlName: 'chuli', name: 'Chu Li', position_title: 'PhD Student',
            position_school: 'University of Washington' }),
        ]),
        ...EMPTY_SECTIONS,
      });
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      expect(document.querySelector('#about-team-current .about-team-role').textContent)
        .toBe('Principal Investigator');
      expect(document.querySelector('#about-team-current .about-team-title').textContent).toBe('Professor');
      expect(document.querySelector('#about-team-current .about-team-affiliation').textContent)
        .toBe('University of Washington');
      const teamRequests = fetchMock.mock.calls.map(([url]) => url).filter((url) => url.includes('/people/'));
      expect(teamRequests).toEqual([`${ML_API}/projects/sidewalk/people/?format=json`]);
    });

    test('ignores the project row\'s internal role notes', async () => {
      stubFetch({
        '/people/?format=json': page([
          personRow({ urlName: 'yochai', name: 'Yochai Eisenberg', lead_project_role: 'Co-PI',
            position_title: 'Associate Professor',
            role: 'Co-PI on NSF SCC-IRG Track 1: Crowd+AI Tools to Map, Analyze, and Visualize Sidewalk '
              + 'Accessibility for Inclusive Cities' }),
        ]),
        ...EMPTY_SECTIONS,
      });
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      const card = document.querySelector('#about-team-current .about-team-member');
      expect(card.querySelector('.about-team-role').textContent).toBe('Co-Principal Investigator');
      expect(card.querySelector('.about-team-title').textContent).toBe('Associate Professor');
      expect(card.textContent).not.toContain('SCC-IRG');
    });

    test('renders each member\'s affiliation on its own line', async () => {
      stubFetch({
        '/people/?format=json': page([
          personRow({ urlName: 'chuli', name: 'Chu Li', position_title: 'PhD Student',
            position_school: 'University of Washington' }),
          personRow({ urlName: 'judyshanley', name: 'Judy L. Shanley', role: 'Community partnerships',
            start_date: '2023-01-01', position_title: 'Director', position_school: 'Easterseals' }),
        ]),
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
        '/people/?format=json': page([
          personRow({ urlName: 'chuli', name: 'Chu Li', position_title: 'PhD Student' }),
        ]),
        ...EMPTY_SECTIONS,
      });
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      expect(document.querySelector('#about-team-current .about-team-affiliation')).toBeNull();
      expect(document.querySelector('#about-team-current .about-team-title').textContent).toBe('PhD Student');
    });

    test('a member whose row carries no position still gets a card, minus the title and affiliation', async () => {
      stubFetch({
        '/people/?format=json': page([
          personRow({ urlName: 'ok', name: 'Ok Person', position_title: 'PhD Student',
            position_school: 'University of Washington' }),
          personRow({ urlName: 'bare', name: 'Bare Row', start_date: '2021-01-01' }),
        ]),
        ...EMPTY_SECTIONS,
      });
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      const cards = [...document.querySelectorAll('#about-team-current .about-team-member')];
      expect(cards.map((el) => el.querySelector('.about-team-name').textContent))
        .toEqual(['Ok Person', 'Bare Row']);
      expect(cards[0].querySelector('.about-team-affiliation').textContent).toBe('University of Washington');
      expect(cards[1].querySelector('.about-team-affiliation')).toBeNull();
      expect(cards[1].querySelector('.about-team-title')).toBeNull();
      expect(cards[1].querySelector('.about-team-role')).toBeNull();
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
        '/people/?format=json': page([
          personRow({ urlName: 'xss', name: '<img src=x onerror=alert(1)>', position_title: 'Researcher' }),
        ]),
        ...EMPTY_SECTIONS,
      });
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      expect(document.querySelector('#about-team-current img[onerror]')).toBeNull();
      expect(document.querySelector('#about-team-current .about-team-name').textContent)
        .toBe('<img src=x onerror=alert(1)>');
    });

    test('defers every headshot, in both grids, until it scrolls into view', async () => {
      stubFetch({
        '/people/?format=json': page([
          personRow({ urlName: 'active', name: 'Active Person', role: 'Lead dev' }),
          personRow({ urlName: 'kotarohara', name: 'Kotaro Hara', lead_project_role: 'Student Lead',
            is_active: false, start_date: '2012-03-01', end_date: '2016-12-21' }),
        ]),
        ...EMPTY_SECTIONS,
      });
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      const photos = [...document.querySelectorAll('#about-team-current, #about-team-past')]
        .flatMap((grid) => [...grid.querySelectorAll('.about-team-photo')]);
      expect(photos).toHaveLength(2);
      expect(photos.map((img) => img.getAttribute('loading'))).toEqual(['lazy', 'lazy']);
      expect(photos[0].getAttribute('src'))
        .toBe('https://makeabilitylab.cs.washington.edu/media/person/active.jpg');
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
            position_title: 'Undergrad', position_school: 'University of Maryland',
            position_school_abbreviated: 'UMD' }),
          personRow({ urlName: 'hs', name: 'High Schooler', is_active: false, end_date: '2019-01-01',
            position_title: 'High School' }),
          personRow({ urlName: 'bare', name: 'Bare Person', is_active: false, end_date: '2020-01-01' }),
        ]),
        ...EMPTY_SECTIONS,
      });
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      const rows = [...document.querySelectorAll('#about-team-all li')]
        .map((el) => el.textContent.replace(/\s+/g, ' ').trim());
      expect(rows).toEqual(['Bare Person', 'High Schooler, High School', 'Undergrad Person, Undergrad, UMD']);
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
            end_date: '2024-10-28', position_title: 'Undergrad', position_school_abbreviated: 'UW' }),
        ]),
        ...EMPTY_SECTIONS,
      });
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      expect(document.querySelector('#about-team-all .about-team-credential').textContent).toBe('Undergrad, UW');
    });

    test('credits a merged contributor with the position from their most recent stint', async () => {
      stubFetch({
        '/people/?format=json': page([
          personRow({ urlName: 'active', name: 'Active Person', role: 'Lead dev' }),
          personRow({ urlName: 'anthony', name: 'Anthony Li', is_active: false, start_date: '2015-06-01',
            end_date: '2015-08-01', position_title: 'High School Student',
            position_school_abbreviated: 'MBHS' }),
          personRow({ urlName: 'anthony', name: 'Anthony Li', is_active: false, start_date: '2016-10-01',
            end_date: '2017-05-01', position_title: 'Undergrad', position_school_abbreviated: 'UMD' }),
        ]),
        ...EMPTY_SECTIONS,
      });
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      expect(document.querySelector('#about-team-all .about-team-credential').textContent).toBe('Undergrad, UMD');
    });

    test('counts every level of contributor, rounded down to a true "more than"', async () => {
      const cohort = (prefix, count, position_title) => Array.from({ length: count }, (unused, i) => personRow({
        urlName: `${prefix}${i}`, name: `Person ${prefix}${i}`, is_active: false, end_date: '2020-06-01',
        position_title,
      }));
      stubFetch({
        '/people/?format=json': page([
          ...cohort('h', 4, 'High School Student'),
          ...cohort('u', 9, 'Undergrad'),
          ...cohort('m', 6, 'MS Student'),
          ...cohort('p', 4, 'PhD Student'),
          ...cohort('c', 2, 'Project Coordinator'),
          personRow({ urlName: 'prof', name: 'A Professor', position_title: 'Professor' }),
        ]),
        ...EMPTY_SECTIONS,
      });
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      // 26 people across six position levels; 23 of them are students at some level, the coordinators and the
      // professor are not.
      expect(document.getElementById('about-team-contributors-intro').textContent)
        .toBe('More than 20 people, including 23 students.');
    });

    test('counts a contributor with several stints once', async () => {
      stubFetch({
        '/people/?format=json': page([
          ...Array.from({ length: 12 }, (unused, i) => personRow({
            urlName: `s${i}`, name: `Person ${i}`, is_active: false, end_date: '2020-06-01',
            position_title: 'Undergrad',
          })),
          personRow({ urlName: 's0', name: 'Person 0', is_active: false, start_date: '2021-01-01',
            end_date: '2021-06-01', position_title: 'MS Student' }),
        ]),
        ...EMPTY_SECTIONS,
      });
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      // 13 rows but 12 people, so the ten below is 10 rather than the 13 rows' 10 — and never the 20 a row count
      // would round to.
      expect(document.getElementById('about-team-contributors-intro').textContent)
        .toBe('More than 10 people, including 12 students.');
    });

    test('keeps "more than N" strictly below a count that lands on a ten', async () => {
      stubFetch({
        '/people/?format=json': page(Array.from({ length: 20 }, (unused, i) => personRow({
          urlName: `s${i}`, name: `Person ${i}`, is_active: false, end_date: '2020-06-01',
          position_title: 'PhD Student',
        }))),
        ...EMPTY_SECTIONS,
      });
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      // Exactly 20 contributors is not "more than 20".
      expect(document.getElementById('about-team-contributors-intro').textContent)
        .toBe('More than 10 people, including 20 students.');
    });

    test('leaves the server-rendered count alone when the roster comes back near-empty', async () => {
      stubFetch({
        '/people/?format=json': page([
          personRow({ urlName: 'lonely', name: 'Lonely Row', is_active: false, end_date: '2020-06-01' }),
        ]),
        ...EMPTY_SECTIONS,
      });
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      expect(document.getElementById('about-team-contributors-intro').textContent)
        .toBe('More than 140 people, including 128 students.');
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

    test('shows a lone start year for a past lead whose stint was left open', async () => {
      stubFetch({
        '/people/?format=json': page([
          personRow({ urlName: 'active', name: 'Active Person' }),
          personRow({ urlName: 'openended', name: 'Open Ended', lead_project_role: 'Co-PI',
            is_active: false, start_date: '2012-08-01', end_date: null }),
        ]),
        ...EMPTY_SECTIONS,
      });
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      expect(document.querySelector('#about-team-past .about-team-role').textContent).toBe('Co-PI, 2012');
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

    test('omits the image entirely for a publication with no thumbnail', async () => {
      stubFetch({
        '/publications/': page([pub(0, { thumbnail: '' })]),
        '/people/?format=json': page([]),
        '/grants/': page([]),
      });
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      // An <img src=""> resolves against the page URL, so the browser would re-request the whole document.
      expect(document.querySelectorAll('.about-pub')).toHaveLength(1);
      expect(document.querySelector('.about-pub-thumb')).toBeNull();
      expect([...document.querySelectorAll('.about-pub img')].map((el) => el.getAttribute('src')))
        .not.toContain('');
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

    test('keeps the citation\'s emphasis and link, dropping every other attribute', async () => {
      stubFetch({
        '/projects/sidewalk/publications/': page([CITED]),
        '/publications/605/': { ...DETAIL,
          citation_html: 'Saha, M. (2019). <i>CHI 2019</i>. '
            + '<a href=https://doi.org/10.1145/3290605.3300292 onclick="steal()" target="_blank">doi</a>' },
        '/people/?format=json': page([]),
        '/grants/': page([]),
      });
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      const link = document.querySelector('#about-cite-plain a');
      expect(document.querySelector('#about-cite-plain i').textContent).toBe('CHI 2019');
      expect(link.getAttribute('href')).toBe('https://doi.org/10.1145/3290605.3300292');
      expect(link.getAttribute('onclick')).toBeNull();
      expect(link.getAttribute('target')).toBeNull();
    });

    test('strips markup that could run script, keeping the citation text readable', async () => {
      stubFetch({
        '/projects/sidewalk/publications/': page([CITED]),
        // A publication title edited on the ML side flows into citation_html verbatim, so this page treats that
        // string as untrusted even though the two sites are run by the same lab.
        '/publications/605/': { ...DETAIL,
          citation_html: 'Saha, M. <img src=x onerror="alert(1)"><svg onload="alert(2)"></svg>'
            + '<a href="javascript:alert(3)">CHI</a> <b>2019</b>.' },
        '/people/?format=json': page([]),
        '/grants/': page([]),
      });
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      const pane = document.getElementById('about-cite-plain');
      expect(pane.querySelector('img, svg')).toBeNull();
      expect(pane.innerHTML).not.toContain('onerror');
      expect(pane.innerHTML).not.toContain('onload');
      // The <a> is allowlisted but a javascript: href is not, so the anchor keeps its text and loses its target.
      expect(pane.querySelector('a').hasAttribute('href')).toBe(false);
      expect(pane.textContent).toBe('Saha, M. CHI 2019.');
      expect(pane.querySelector('b').textContent).toBe('2019');
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

  describe('section nav', () => {
    /** Replaces the fixture with a page of bands, since the nav is built from the sections it points at. */
    function renderSections() {
      document.body.innerHTML = `
        <main id="about-page">
          <section class="about-stats"><h2 class="sr-only">By the numbers</h2></section>
          <section id="about-how"><div><h2>How it works</h2></div></section>
          <section id="about-where"><div><h2>Where we are</h2></div></section>
          <section id="about-team"><div><h2>The team</h2></div></section>
          <nav id="about-toc" hidden><ol id="about-toc-list"></ol></nav>
        </main>`;
    }

    beforeEach(() => {
      renderSections();
      stubFetch({});
      jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    test('lists every section that has a visible heading, in page order, and reveals itself', async () => {
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      const links = [...document.querySelectorAll('#about-toc-list .about-toc-link')];
      expect(links.map((link) => link.textContent.trim())).toEqual(['How it works', 'Where we are', 'The team']);
      expect(links.map((link) => link.getAttribute('href')))
        .toEqual(['#about-how', '#about-where', '#about-team']);
      expect(document.getElementById('about-toc').hidden).toBe(false);
    });

    test('skips a section titled only for screen readers', async () => {
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      expect(document.getElementById('about-toc-list').textContent).not.toContain('By the numbers');
    });

    test('marks the section under the top of the viewport, resolving an overlap by page order', async () => {
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      const observer = FakeIntersectionObserver.instances.find((o) => o.targets.length === 3);
      const [how, where] = observer.targets;
      observer.trigger([where]);
      expect(document.querySelector('.about-toc-link--active').getAttribute('href')).toBe('#about-where');
      expect(document.querySelector('[aria-current]').getAttribute('href')).toBe('#about-where');

      // Both bands cross the band the observer watches; the earlier one is the section being read.
      observer.trigger([how, where]);
      expect(document.querySelectorAll('.about-toc-link--active')).toHaveLength(1);
      expect(document.querySelector('.about-toc-link--active').getAttribute('href')).toBe('#about-how');

      observer.trigger([]);
      expect(document.querySelector('.about-toc-link--active')).toBeNull();
      expect(document.querySelector('[aria-current]')).toBeNull();
    });

    test('withdraws the rail past the ends of the page, where it would float over the hero or the footer', async () => {
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      const nav = document.getElementById('about-toc');
      // Nothing has scrolled yet, so the rail must already be out of range rather than flashing over the hero.
      expect(nav.classList.contains('about-toc--out-of-range')).toBe(true);

      const observer = FakeIntersectionObserver.instances.find((o) => o.targets.length === 3);
      observer.trigger([document.getElementById('about-where')]);
      expect(nav.classList.contains('about-toc--out-of-range')).toBe(false);

      // Scrolled past the last section, into the closing band and the footer.
      observer.trigger([]);
      expect(nav.classList.contains('about-toc--out-of-range')).toBe(true);
    });

    test('logs which section a reader jumped to', async () => {
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      document.querySelector('[href="#about-team"]').click();
      expect(window.logWebpageActivity).toHaveBeenCalledWith('Click_module=AboutPage_target=toc_team');
    });
  });

  describe('deployment map', () => {
    const ASSETS = {
      'data-mapbox-css': '/assets/vendor/mapbox-gl/mapbox-gl.css',
      'data-mapbox-js': '/assets/vendor/mapbox-gl/mapbox-gl.js',
      'data-mapbox-language-js': '/assets/vendor/mapbox-gl/mapbox-gl-language.js',
      'data-ps-map-js': '/assets/js/ps-map/build/ps-map.js',
      'data-mapbox-api-key': 'pk.test',
    };

    beforeEach(() => {
      const attrs = Object.entries(ASSETS).map(([name, value]) => `${name}="${value}"`).join(' ');
      document.body.innerHTML = `<main id="about-page"><div id="about-deployment-map" ${attrs}></div></main>`;
      stubFetch({});
      window.createPSMap = jest.fn(() => Promise.resolve([{}]));
      window.jQuery = { getJSON: jest.fn() };
      jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    /** @returns {FakeIntersectionObserver} The observer watching the map container. */
    const mapObserver = () => FakeIntersectionObserver.instances
      .find((o) => o.targets.some((t) => t.id === 'about-deployment-map'));

    test('fetches nothing until the map nears the viewport', async () => {
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      expect(document.head.querySelectorAll('script[src]')).toHaveLength(0);
      expect(window.createPSMap).not.toHaveBeenCalled();
    });

    test('loads mapbox before the ps-map bundle that reads it, then builds the map', async () => {
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      const observer = mapObserver();
      observer.trigger(observer.targets);
      const srcs = await runInjectedScripts();

      expect(srcs).toEqual([ASSETS['data-mapbox-js'], ASSETS['data-mapbox-language-js'], ASSETS['data-ps-map-js']]);
      expect([...document.head.querySelectorAll('link[rel="stylesheet"]')].map((el) => el.getAttribute('href')))
        .toContain(ASSETS['data-mapbox-css']);
      expect(window.createPSMap).toHaveBeenCalledTimes(1);
      expect(window.createPSMap.mock.calls[0][1]).toMatchObject({
        mapName: 'about-deployment-map',
        mapboxApiKey: 'pk.test',
        loadCities: true,
        // Neither swallowing the scroll of a reader passing through nor performing a zoom-out on arrival.
        scrollWheelZoom: false,
        animateCityFit: false,
      });
    });

    test('loads the libraries once, however often the section crosses the viewport', async () => {
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      const observer = mapObserver();
      observer.trigger(observer.targets);
      observer.trigger(observer.targets);
      const srcs = await runInjectedScripts();

      expect(observer.disconnected).toBe(true);
      expect(srcs).toHaveLength(3);
      expect(window.createPSMap).toHaveBeenCalledTimes(1);
    });

    test('hides the empty frame rather than leaving it looking broken when a library fails', async () => {
      loadGlobalScript(MODULE_PATH);
      await hydrate();

      const observer = mapObserver();
      observer.trigger(observer.targets);
      await settle();
      document.head.querySelector('script[src]').dispatchEvent(new Event('error'));
      await settle();

      expect(document.getElementById('about-deployment-map').hidden).toBe(true);
      expect(window.createPSMap).not.toHaveBeenCalled();
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
