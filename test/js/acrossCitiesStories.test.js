/**
 * Tests for the Stories section and its "Review stories" attention item on /admin/across-cities (#5543).
 *
 * The contract worth pinning is that a failure never reads as zero: a city whose count failed is reported as
 * unavailable, and when every count failed the summary says so instead of "no stories". Also pinned: rows are only the
 * cities with stories, newest first, each linked to that city's own Stories page (the only place Hide and Delete work),
 * and the attention item counts only visible stories, so hiding one there clears it.
 */

import { useUtil } from './loader.js';
import { metricDistanceUtil } from './fakes.js';
import { renderAcrossCities } from './support/acrossCitiesHarness.js';

useUtil(metricDistanceUtil);

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
  /** Renders the page with this stories list and no scorecard rows, so only stories can be at work. */
  async function render(stories) {
    await renderAcrossCities({ markup: MARKUP, scorecards: { stories }, storiesPath: '/admin/stories' });
  }

  const summary = () => document.getElementById('ac-stories-summary').textContent;
  const rows = () => [...document.querySelectorAll('#ac-stories-tbody tr')];

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

  describe('wording', () => {
    it('says there is nothing to count when no city came back', async () => {
      await render([]);
      expect(summary()).toBe('No cities to count.');
    });

    it('counts several cities with no stories in the plural', async () => {
      await render([entry('a', counts(0, null)), entry('b', counts(0, null))]);
      expect(summary()).toBe('None of the 2 cities counted has stories yet.');
    });

    it('words a single story, several cities without one, and a city without a display name', async () => {
      const quito = {
        city_id: 'quito', url: 'https://quito.example.org/', counts: counts(1, '2026-09-01', { visible7d: 1 }),
      };
      await render([quito, entry('b', counts(0, null)), entry('c', counts(0, null))]);
      expect(summary()).toBe('1 story in 1 city; 2 cities have none.');
      expect(rows()[0].cells[0].textContent).toBe('quito');
      expect(document.querySelector('#ac-attention .ov-attention-text').textContent)
        .toBe('quito — 1 new story in the last 7 days');
    });
  });
});
