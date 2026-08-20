/**
 * Tests for the attribution split and the hover breakdown cards on /admin/across-cities (#4931).
 *
 * Three contracts worth pinning. First, every volume in the "Today & this week" section is what people did, with AI
 * output reported on its own line — one pipeline account can out-produce the whole community, so a blended count would
 * describe the pipeline. Second, every headcount is registered people, with anonymous cookie identities and AI accounts
 * counted beside them rather than folded in. Third, the cards that explain those counts name the contributors behind
 * them, which means they carry user-supplied text into markup and must escape it twice (see psTooltip's header).
 *
 * Runs under jsdom (jest.config.js). AcrossCitiesPage is a bare top-level class in a concatenated bundle, so it is
 * eval'd into global scope rather than required; MiniLineChart has to be present first, since the page draws with it.
 */

const fs = require('fs');
const path = require('path');

const JS_DIR = path.resolve(__dirname, '..', '..', 'public/js');

/** Loads MiniLineChart into global scope and returns the AcrossCitiesPage class. */
function loadPage() {
  const chart = fs.readFileSync(path.join(JS_DIR, 'admin-dashboard/MiniLineChart.js'), 'utf8');
  const shell = fs.readFileSync(path.join(JS_DIR, 'admin-dashboard/AdminShell.js'), 'utf8');
  const page = fs.readFileSync(path.join(JS_DIR, 'admin-dashboard/AcrossCitiesPage.js'), 'utf8');
  return (0, eval)(`${chart}\nglobalThis.MiniLineChart = MiniLineChart;\n`
    + `${shell}\nglobalThis.AdminShell = AdminShell;\n${page}\nAcrossCitiesPage;`);
}

const MARKUP = `
  <span id="now-labels-today">—</span><span id="now-labels-today-ai"></span>
  <span id="now-validations-today">—</span><span id="now-validations-today-ai"></span>
  <span id="now-contributors-today">—</span><span id="now-contributors-today-anon"></span>
  <span id="now-contributors-today-ai"></span>
  <span id="now-labels-7d">—</span><span id="now-labels-7d-delta"></span><span id="now-labels-7d-ai"></span>
  <span id="now-validations-7d">—</span><span id="now-validations-7d-delta"></span>
  <span id="now-validations-7d-ai"></span>
  <span id="now-contributors-7d">—</span><span id="now-contributors-7d-delta"></span>
  <span id="now-contributors-7d-anon"></span><span id="now-contributors-7d-ai"></span>
  <span id="now-cities-active">—</span><span id="now-top-city">—</span><span id="now-top-city-count"></span>
  <div class="mini-chart" id="ac-chart-week-labels"></div>
  <div class="mini-chart" id="ac-chart-week-validations"></div>
  <div class="mini-chart" id="ac-chart-week-users"></div>
  <table id="ac-top-table">
    <thead>
      <tr>
        <th data-sort="city_name">City</th>
        <th data-sort="activity_7d">Activity</th>
        <th data-sort="activity_window.labels_7d">Labels</th>
        <th data-sort="activity_window.validations_7d">Validations</th>
        <th data-sort="activity_window.contributors_7d">Contributors</th>
        <th data-sort="audits_7d">Streets</th>
        <th>Trend</th>
      </tr>
    </thead>
    <tbody id="ac-top-tbody"></tbody>
  </table>
  <div id="ac-top-status"></div>`;

/** A day of the cross-city daily series, with only the fields the bars and their cards read. */
function makeDay(day, d = {}) {
  return {
    day,
    labels: 0,
    validations: 0,
    contributors: 0,
    anon_sessions: 0,
    ai_labels: 0,
    ai_validations: 0,
    ai_agents: 0,
    contributor_total: 0,
    top_cities: [],
    contributor_list: [],
    ...d,
  };
}

/** A scorecard row plus the `window_by_city` entry the "Most active cities" table reads for it. */
function makeCity(id, w) {
  return {
    city: { city_id: id, city_name: id, lifecycle: 'active', audits_7d: 3, weekly_trend: [] },
    window: {
      labels_7d: 0,
      labels_prior_7d: 0,
      validations_7d: 0,
      validations_prior_7d: 0,
      ai_labels_7d: 0,
      ai_labels_prior_7d: 0,
      ai_validations_7d: 0,
      ai_validations_prior_7d: 0,
      contributors_7d: 0,
      contributors_prior_7d: 0,
      anon_sessions_7d: 0,
      anon_sessions_prior_7d: 0,
      ai_agents_7d: 0,
      contributor_total: (w?.contributors || []).length,
      contributors: [],
      ...w,
    },
  };
}

/** One entry of a city window's contributor list. */
function contributor(username, labels, validations, kind = 'registered') {
  return {
    username,
    kind,
    labels_7d: labels,
    labels_prior_7d: 0,
    validations_7d: validations,
    validations_prior_7d: 0,
  };
}

/** One entry of a day's contributor list. */
function dayContributor(username, labels, validations, kind = 'registered') {
  return { username, kind, labels, validations };
}

describe('Across Cities — attribution split and hover breakdowns', () => {
  let AcrossCitiesPage;

  /**
   * Renders the page against a fixture and returns the initialized instance.
   *
   * @param {{cities?: Array, daily?: Array, summary?: ?object}} fixture - Any subset of the endpoint's payload.
   * @returns {Promise<object>} The initialized AcrossCitiesPage.
   */
  async function render({ cities = [], daily = [], summary = null } = {}) {
    document.body.innerHTML = MARKUP;
    const windowByCity = {};
    cities.forEach((c) => { windowByCity[c.city.city_id] = c.window; });
    global.fetch = jest.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        cities: cities.map((c) => c.city),
        summary: {},
        over_time_all_time: [],
        over_time_daily: daily,
        window_summary: summary,
        window_by_city: windowByCity,
      }),
    }));
    const page = new AcrossCitiesPage({ scorecardsUrl: '/adminapi/cityScorecards' });
    await page.init();
    return page;
  }

  /** The hover-card markup on the nth cell of the first table row (0 = city name). */
  function cellCard(index) {
    return document.querySelectorAll('#ac-top-tbody tr')[0].cells[index].getAttribute('data-ps-tooltip');
  }

  /** The hover/focus target for the bar at `index` of a per-day chart. */
  function barTarget(index, chart = 'labels') {
    return document.querySelectorAll(`#ac-chart-week-${chart} rect.mini-bar-hit`)[index];
  }

  /** The hover-card markup on the bar at `index` of the labels-per-day chart. */
  function barCard(index, chart = 'labels') {
    return barTarget(index, chart).getAttribute('data-ps-tooltip');
  }

  beforeEach(() => {
    AcrossCitiesPage = loadPage();
  });

  describe('tiles', () => {
    it('counts what people did and reports AI output on its own line', async () => {
      await render({
        summary: {
          labels_7d: 2626, labels_prior_7d: 2000, ai_labels_7d: 0, ai_labels_prior_7d: 0,
          validations_7d: 1628, validations_prior_7d: 1500, ai_validations_7d: 6420, ai_validations_prior_7d: 5000,
          contributors_7d: 64, contributors_prior_7d: 60, ai_agents_7d: 1,
        },
      });

      expect(document.getElementById('now-validations-7d').textContent).toBe('1,628');
      expect(document.getElementById('now-validations-7d-ai').textContent).toBe('+ 6,420 by AI');
      expect(document.getElementById('now-contributors-7d').textContent).toBe('64');
      expect(document.getElementById('now-contributors-7d-ai').textContent).toBe('+ 1 AI account');
    });

    it('reports anonymous sessions beside the contributor count, not inside it', async () => {
      await render({
        summary: {
          labels_7d: 100, validations_7d: 50, contributors_7d: 41, contributors_prior_7d: 40,
          anon_sessions_7d: 23, ai_agents_7d: 1,
        },
      });

      expect(document.getElementById('now-contributors-7d').textContent).toBe('41');
      expect(document.getElementById('now-contributors-7d-anon').textContent).toBe('+ 23 anonymous sessions');
      expect(document.getElementById('now-contributors-7d-anon').getAttribute('data-ps-tooltip'))
        .toContain('browser cookie');
    });

    it('leaves the anonymous line empty when no anonymous visitor contributed', async () => {
      await render({ summary: { labels_7d: 10, contributors_7d: 3, anon_sessions_7d: 0 } });

      expect(document.getElementById('now-contributors-7d-anon').textContent).toBe('');
      expect(document.getElementById('now-contributors-7d-anon').hasAttribute('data-ps-tooltip')).toBe(false);
    });

    it('measures the week-over-week delta on the human count, not the blended one', async () => {
      // AI output tripled while people did less; the tile must report the drop people saw.
      await render({
        summary: {
          labels_7d: 100, labels_prior_7d: 200, ai_labels_7d: 9000, ai_labels_prior_7d: 3000,
          validations_7d: 0, validations_prior_7d: 0, ai_validations_7d: 0, ai_validations_prior_7d: 0,
          contributors_7d: 2, contributors_prior_7d: 2, ai_agents_7d: 1,
        },
      });

      const delta = document.getElementById('now-labels-7d-delta');
      expect(delta.className).toContain('ac-hero-delta--down');
      expect(delta.textContent).toContain('50%');
    });

    it('leaves the AI line empty when no AI account contributed', async () => {
      await render({
        summary: {
          labels_7d: 10, labels_prior_7d: 5, ai_labels_7d: 0, ai_labels_prior_7d: 0,
          validations_7d: 4, validations_prior_7d: 4, ai_validations_7d: 0, ai_validations_prior_7d: 0,
          contributors_7d: 3, contributors_prior_7d: 3, ai_agents_7d: 0,
        },
      });

      expect(document.getElementById('now-labels-7d-ai').textContent).toBe('');
      expect(document.getElementById('now-labels-7d-ai').hasAttribute('data-ps-tooltip')).toBe(false);
    });

    it('reports today from the daily series on the same split', async () => {
      await render({
        daily: [makeDay('2026-08-12', { labels: 12, validations: 3, contributors: 2, anon_sessions: 5,
          ai_validations: 400, ai_agents: 1 })],
      });

      expect(document.getElementById('now-labels-today').textContent).toBe('12');
      expect(document.getElementById('now-contributors-today').textContent).toBe('2');
      expect(document.getElementById('now-validations-today-ai').textContent).toBe('+ 400 by AI');
      expect(document.getElementById('now-contributors-today-anon').textContent).toBe('+ 5 anonymous sessions');
      expect(document.getElementById('now-contributors-today-ai').textContent).toBe('+ 1 AI account');
    });
  });

  describe('day bars', () => {
    const DAILY = [
      makeDay('2026-08-11', { labels: 40, validations: 10, contributors: 3, contributor_total: 3 }),
      makeDay('2026-08-12', {
        labels: 120,
        validations: 30,
        contributors: 4,
        anon_sessions: 6,
        ai_validations: 6420,
        ai_agents: 1,
        contributor_total: 5,
        top_cities: [
          { city_id: 'chicago-il', city_name: 'Chicago', labels: 100, validations: 20, contributors: 3 },
          { city_id: 'seattle-wa', city_name: 'Seattle', labels: 20, validations: 10, contributors: 1 },
        ],
        contributor_list: [
          dayContributor('alice', 100, 20),
          dayContributor('sidewalk-ai', 0, 6420, 'ai'),
        ],
      }),
    ];

    it('answers a hover with the whole day, not just the bar being hovered', async () => {
      await render({ daily: DAILY });
      const card = barCard(1);

      expect(card).toContain('Labels');
      expect(card).toContain('120');
      expect(card).toContain('Validations');
      expect(card).toContain('30');
      expect(card).toContain('Contributors');
      expect(card).toContain('AI validations');
      expect(card).toContain('6,420');
    });

    it('reports the day\'s anonymous sessions as their own line', async () => {
      await render({ daily: DAILY });

      expect(barCard(1)).toContain('Anonymous sessions');
      expect(barCard(1)).toContain('<span>Anonymous sessions</span><span class="ac-tip-num">6</span>');
    });

    it('gives every chart the identical card, so one hover explains all three', async () => {
      await render({ daily: DAILY });
      const strip = (card) => card.replace(/ data-emph="[a-z]*"/, '');

      expect(strip(barCard(1, 'validations'))).toBe(strip(barCard(1)));
      expect(strip(barCard(1, 'users'))).toBe(strip(barCard(1)));
    });

    it('leans on the line the hovered chart draws, so a shared card still answers this bar', async () => {
      await render({ daily: DAILY });
      const emph = (card) => card.match(/data-emph="([a-z]*)"/)[1];

      expect(emph(barCard(1))).toBe('labels');
      expect(emph(barCard(1, 'validations'))).toBe('validations');
      expect(emph(barCard(1, 'users'))).toBe('contributors');
    });

    it('names the day\'s busiest cities and its contributors', async () => {
      await render({ daily: DAILY });
      const card = barCard(1);

      expect(card).toContain('Chicago');
      expect(card).toContain('Seattle');
      expect(card).toContain('alice');
      expect(card).toContain('sidewalk-ai');
    });

    it('splits a busiest city into labels and validations rather than one unlabeled total', async () => {
      await render({ daily: DAILY });
      const card = barCard(1);

      expect(card).toContain('Busiest cities (labels · validations)');
      expect(card).toContain('<span>Chicago</span><span class="ac-tip-num">100 · 20</span>');
      expect(card).toContain('<span>Seattle</span><span class="ac-tip-num">20 · 10</span>');
    });

    it('marks an AI account in the contributor list rather than passing it off as a person', async () => {
      await render({ daily: DAILY });

      expect(barCard(1)).toContain('ac-tip-tag');
    });

    it('counts "+N more" from the untruncated total the server sent, not from the capped list', async () => {
      // The server caps the list it ships, so a count derived from the list can never exceed (cap - shown) and would
      // silently understate a busy day. 40 contributors, 8 shipped, 5 shown → "+ 35 more", not "+ 3 more".
      const people = Array.from({ length: 8 }, (_, i) => dayContributor(`user${i}`, 10 - i, 0));
      await render({
        daily: [makeDay('2026-08-12', {
          labels: 100, contributors: 40, contributor_total: 40, contributor_list: people,
        })],
      });

      expect(barCard(0)).toContain('+ 35 more');
    });

    it('omits "+N more" when the list is complete', async () => {
      await render({
        daily: [makeDay('2026-08-12', {
          labels: 10, contributors: 2, contributor_total: 2,
          contributor_list: [dayContributor('a', 8, 0), dayContributor('b', 2, 0)],
        })],
      });

      expect(barCard(0)).not.toContain('more');
    });

    it('makes each bar focusable and named, so the card is reachable without a pointer', async () => {
      await render({ daily: DAILY });
      const bar = barTarget(1);

      expect(bar.getAttribute('tabindex')).toBe('0');
      expect(bar.getAttribute('aria-label')).toContain('Labels');
      // A native <title> would open its own tooltip on top of the card.
      expect(bar.querySelector('title')).toBeNull();
    });

    it('gives a zero-value day a hover target too, so no day is unreachable', async () => {
      // A bar of height zero draws no rect, so the interaction has to live on a full-height hit area instead.
      await render({ daily: [makeDay('2026-08-11'), makeDay('2026-08-12', { labels: 5, contributors: 1 })] });

      expect(document.querySelectorAll('#ac-chart-week-labels rect.mini-bar').length).toBe(1);
      expect(document.querySelectorAll('#ac-chart-week-labels rect.mini-bar-hit').length).toBe(2);
      expect(barTarget(0).getAttribute('tabindex')).toBe('0');
    });

    it('still reports an AI-only day, whose every bar reads zero', async () => {
      // The pipeline runs on its own schedule, so this is a real day in prod — and the card is the only place its work
      // can show up. Treating it as quiet would hide 6,420 validations behind an empty slot.
      await render({
        daily: [makeDay('2026-08-12', { ai_validations: 6420, ai_agents: 1, contributor_total: 1,
          contributor_list: [dayContributor('sidewalk-ai', 0, 6420, 'ai')] })],
      });
      const card = barCard(0);

      expect(card).not.toContain('No activity.');
      expect(card).toContain('AI validations');
      expect(card).toContain('6,420');
      expect(card).toContain('sidewalk-ai');
    });

    it('says so plainly when nothing happened that day', async () => {
      await render({ daily: [makeDay('2026-08-11'), makeDay('2026-08-12', { labels: 5, contributors: 1 })] });

      expect(barCard(0)).toContain('No activity.');
    });

    it('escapes usernames in a day card, which is markup carrying user-supplied text', async () => {
      await render({
        daily: [makeDay('2026-08-12', {
          labels: 2, contributors: 1, contributor_total: 1,
          contributor_list: [dayContributor('<img src=x onerror=alert(1)>', 2, 0)],
        })],
      });
      // Two levels of escaping: attribute parsing consumes one, psTooltip's innerHTML the other. Reading the attribute
      // back through the DOM has already consumed the first, so rendering it as HTML models exactly what psTooltip does.
      document.body.insertAdjacentHTML('beforeend', `<div id="probe">${barCard(0)}</div>`);

      expect(document.querySelectorAll('#probe img').length).toBe(0);
    });

    it('groups a chart whose bars are individually focusable, so their names survive in the a11y tree', async () => {
      // role="img" on the <svg> would make its subtree presentational and prune the per-bar roles and labels.
      await render({ daily: DAILY });

      expect(document.querySelector('#ac-chart-week-labels svg').getAttribute('role')).toBe('group');
    });
  });

  describe('most active cities', () => {
    const CITIES = [makeCity('chicago', {
      labels_7d: 120,
      labels_prior_7d: 80,
      validations_7d: 30,
      validations_prior_7d: 10,
      ai_validations_7d: 6420,
      contributors_7d: 3,
      contributors_prior_7d: 2,
      anon_sessions_7d: 4,
      ai_agents_7d: 1,
      contributor_total: 4,
      contributors: [
        contributor('carol', 5, 25),
        contributor('alice', 100, 2),
        contributor('bob', 15, 3),
        contributor('sidewalk-ai', 0, 6420, 'ai'),
      ],
    })];

    it('shows the human count with the AI output beside it', async () => {
      await render({ cities: CITIES });
      const validations = document.querySelectorAll('#ac-top-tbody tr')[0].cells[3];

      expect(validations.textContent).toContain('30');
      expect(validations.querySelector('.ac-cell-ai').textContent).toBe('+6,420 AI');
    });

    it('ranks the busiest cities on what people did there', async () => {
      // A city where only the AI pipeline ran is not the week's busiest community.
      const cities = [
        makeCity('ai-only', { validations_7d: 0, ai_validations_7d: 90000, ai_agents_7d: 1 }),
        makeCity('people', { labels_7d: 3, contributors_7d: 2 }),
      ];
      await render({ cities });

      expect([...document.querySelectorAll('#ac-top-tbody tr')].map((tr) => tr.cells[0].textContent.trim()))
        .toEqual(['people']);
    });

    it('puts both windows\' raw counts in the card behind the delta chip', async () => {
      await render({ cities: CITIES });
      const card = cellCard(2);

      expect(card).toContain('Last 7 days');
      expect(card).toContain('120');
      expect(card).toContain('7 days before');
      expect(card).toContain('80');
    });

    it('ranks the Labels card by labels and the Validations card by validations', async () => {
      await render({ cities: CITIES });

      // alice labels most; carol validates most among people — one "busiest overall" list would bury one of them.
      expect(cellCard(2).indexOf('alice')).toBeLessThan(cellCard(2).indexOf('carol'));
      expect(cellCard(3).indexOf('carol')).toBeLessThan(cellCard(3).indexOf('bob'));
    });

    it('lists AI after the people, since the count above it excludes AI', async () => {
      // Ranked together, the pipeline sorts first and reads as the top contributor to a number it is not part of: the
      // card's headline says 30 validations while the AI line says 6,420.
      await render({ cities: CITIES });

      expect(cellCard(3).indexOf('carol')).toBeLessThan(cellCard(3).indexOf('sidewalk-ai'));
    });

    it('keeps "+N more" about the people it ranks, discounting the AI lines it also shows', async () => {
      const people = Array.from({ length: 10 }, (_, i) => contributor(`user${i}`, 20 - i, 0));
      const cities = [makeCity('busy', {
        labels_7d: 500,
        contributors_7d: 30,
        ai_agents_7d: 1,
        contributor_total: 31,
        contributors: [...people, contributor('sidewalk-ai', 999, 0, 'ai')],
      })];
      await render({ cities });

      // 31 nameable contributors, one of which is the AI listed separately → 30 people, 5 shown.
      expect(cellCard(2)).toContain('+ 25 more');
    });

    it('reports a city\'s anonymous sessions in its contributors card', async () => {
      await render({ cities: CITIES });

      expect(cellCard(4)).toContain('Anonymous sessions');
      expect(cellCard(4)).toContain('<span>Anonymous sessions</span><span class="ac-tip-num">4</span>');
    });

    it('leaves out anyone with no activity in the window the column is about', async () => {
      const cities = [makeCity('quiet', {
        labels_7d: 4,
        contributors_7d: 2,
        contributor_total: 2,
        contributors: [contributor('labeler', 4, 0), contributor('validator-only', 0, 0)],
      })];
      await render({ cities });

      expect(cellCard(2)).toContain('labeler');
      expect(cellCard(2)).not.toContain('validator-only');
    });

    it('escapes usernames, which are user-supplied text going into card markup', async () => {
      const cities = [makeCity('city', {
        labels_7d: 2,
        contributors_7d: 1,
        contributor_total: 1,
        contributors: [contributor('<img src=x onerror=alert(1)>', 2, 0)],
      })];
      await render({ cities });
      document.body.insertAdjacentHTML('beforeend', `<div id="probe">${cellCard(2)}</div>`);

      expect(document.querySelectorAll('#probe img').length).toBe(0);
    });

    it('makes the cells focusable so their cards are reachable by keyboard', async () => {
      await render({ cities: CITIES });
      const cells = [...document.querySelectorAll('#ac-top-tbody tr')[0].cells];

      expect(cells.filter((td) => td.getAttribute('tabindex') === '0').length).toBe(4);
    });
  });
});
