/**
 * Tests for the Stories section and its "Review stories" attention item on /admin/across-cities (#5543).
 *
 * The contract worth pinning is that a failure never reads as zero: a city whose count failed is reported as
 * unavailable, and when every count failed the summary says so instead of "no stories". Also pinned: rows are only the
 * cities with stories, newest first, each linked to that city's own Stories page (the only place Hide and Delete work),
 * and the attention item counts only visible stories, so hiding one there clears it.
 *
 * Runs under jsdom (jest.config.js). AcrossCitiesPage is a bare top-level class in a concatenated bundle, so it is
 * eval'd into global scope rather than required.
 */

const { loadModules, realUtil } = require('./loadGlobalScript');

// The page fetches through util.fetchJson.
window.util = realUtil();


/** Load AcrossCitiesPage.js, plus the AdminShell helpers every dashboard page reads, and return the class binding. */
function loadPage() {
  return loadModules('frontend/js/admin-dashboard/AcrossCitiesPage.js').AcrossCitiesPage;
}

const MARKUP = `
  <div id="ac-attention"></div>
  <p id="ac-stories-summary">Loading stories…</p>
  <div id="ac-stories-wrap" hidden>
    <table><tbody id="ac-stories-tbody"></tbody></table>
  </div>`;

/**
 * One entry of the payload's `stories` list.
 *
 * @param {string} id - City id, also the display name.
 * @param {?object} counts - The city's counts, or null when its count failed.
 * @param {?string} [url] - The city's site; null for a city with none.
 * @returns {object} The stories entry.
 */
function entry(id, counts, url = `https://${id}.example.org/`) {
  return { city_id: id, city_name: id, url, counts };
}

/** Counts for a city with `total` stories, the newest on `newest`. */
function counts(total, newest, { hidden = 0, withPhoto = 0, last7d = 0, visible7d = 0, last30d = 0 } = {}) {
  return { total, hidden, with_photo: withPhoto, last_7d: last7d, visible_7d: visible7d, last_30d: last30d, newest };
}

describe('Across Cities — stories', () => {
  let AcrossCitiesPage;

  /**
   * Renders the page against a stories list, with no scorecard rows, so only the Stories section and its attention
   * items can be at work.
   *
   * @param {Array} stories - The payload's `stories` list.
   * @returns {Promise<void>}
   */
  async function render(stories) {
    document.body.innerHTML = MARKUP;
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        cities: [], stories, summary: {}, over_time_all_time: [], over_time_daily: [], window_by_city: {},
      }),
    }));
    await new AcrossCitiesPage({ scorecardsUrl: '/adminapi/cityScorecards', storiesPath: '/admin/stories' }).init();
  }

  const summary = () => document.getElementById('ac-stories-summary').textContent;
  const rows = () => [...document.querySelectorAll('#ac-stories-tbody tr')];

  beforeEach(() => {
    AcrossCitiesPage = loadPage();
  });

  it('lists only cities with stories, newest first, linked to their own Stories page', async () => {
    await render([
      entry('alpha', counts(2, '2026-08-01T10:00:00Z')),
      entry('bravo', counts(0, null)),
      entry('charlie', counts(5, '2026-09-20T10:00:00Z', { hidden: 1, withPhoto: 2 })),
    ]);

    expect(rows().map((r) => r.cells[0].textContent.trim())).toEqual(['charlie', 'alpha']);
    expect(rows()[0].querySelector('a').getAttribute('href')).toBe('https://charlie.example.org/admin/stories');
    expect(rows()[0].cells[2].textContent.trim()).toBe('1');
    expect(document.getElementById('ac-stories-wrap').hidden).toBe(false);
    expect(summary()).toBe('7 stories in 2 cities; 1 city has none.');
  });

  it('joins the Stories path onto a city URL with or without a trailing slash, and skips the link without one', async () => {
    await render([
      entry('alpha', counts(1, '2026-09-01T00:00:00Z'), 'https://alpha.example.org'),
      entry('bravo', counts(1, '2026-08-01T00:00:00Z'), null),
    ]);

    expect(rows()[0].querySelector('a').getAttribute('href')).toBe('https://alpha.example.org/admin/stories');
    expect(rows()[1].querySelector('a')).toBeNull();
  });

  it('says there are no stories only about the cities it could count', async () => {
    await render([entry('alpha', counts(0, null)), entry('bravo', null)]);

    expect(summary()).toBe('The one city counted has no stories yet. Counts unavailable for 1 city.');
    expect(document.getElementById('ac-stories-wrap').hidden).toBe(true);
  });

  it('reports every count failing as unavailable, never as no stories', async () => {
    await render([entry('alpha', null), entry('bravo', null)]);

    expect(summary()).toBe('Story counts unavailable for 2 cities.');
  });

  it('flags only visible new stories for review, linking to the city\'s Stories page', async () => {
    await render([
      entry('alpha', counts(3, '2026-09-27T00:00:00Z', { last7d: 3, visible7d: 2 })),
      // New this week but already hidden: a moderator has dealt with it.
      entry('bravo', counts(1, '2026-09-27T00:00:00Z', { last7d: 1, visible7d: 0 })),
    ]);

    const items = [...document.querySelectorAll('#ac-attention .ov-attention-item')];
    expect(items).toHaveLength(1);
    expect(items[0].getAttribute('href')).toBe('https://alpha.example.org/admin/stories');
    expect(items[0].textContent).toContain('2 new stories in the last 7 days');
  });
});
