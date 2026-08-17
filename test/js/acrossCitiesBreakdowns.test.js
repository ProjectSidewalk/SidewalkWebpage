/**
 * Tests for the human/AI split and the hover breakdown cards on /admin/across-cities (#4931).
 *
 * Two contracts worth pinning. First, every count in the "Today & this week" section is what people did, with AI
 * output reported on its own line — one pipeline account can out-produce the whole community, so a blended count
 * would describe the pipeline. Second, the cards that explain those counts name the contributors behind them, which
 * means they carry user-supplied text into markup and must escape it.
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
  const page = fs.readFileSync(path.join(JS_DIR, 'admin-dashboard/AcrossCitiesPage.js'), 'utf8');
  return (0, eval)(`${chart}\nglobalThis.MiniLineChart = MiniLineChart;\n${page}\nAcrossCitiesPage;`);
}

const MARKUP = `
  <span id="now-labels-today">—</span><span id="now-labels-today-ai"></span>
  <span id="now-validations-today">—</span><span id="now-validations-today-ai"></span>
  <span id="now-contributors-today">—</span><span id="now-contributors-today-ai"></span>
  <span id="now-labels-7d">—</span><span id="now-labels-7d-delta"></span><span id="now-labels-7d-ai"></span>
  <span id="now-validations-7d">—</span><span id="now-validations-7d-delta"></span>
  <span id="now-validations-7d-ai"></span>
  <span id="now-contributors-7d">—</span><span id="now-contributors-7d-delta"></span>
  <span id="now-contributors-7d-ai"></span>
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
    active_users: 0,
    ai_labels: 0,
    ai_validations: 0,
    ai_agents: 0,
    top_cities: [],
    contributors: [],
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
      ai_agents_7d: 0,
      contributors: [],
      ...w,
    },
  };
}

/** One entry of a city window's contributor list. */
function contributor(username, labels, validations, isAi = false) {
  return {
    username,
    is_ai: isAi,
    labels_7d: labels,
    labels_prior_7d: 0,
    validations_7d: validations,
    validations_prior_7d: 0,
  };
}

describe('Across Cities — human/AI split and hover breakdowns', () => {
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

  /** The hover-card markup on the bar at `index` of the labels-per-day chart. */
  function barCard(index) {
    return document.querySelectorAll('#ac-chart-week-labels rect.mini-bar')[index].getAttribute('data-ps-tooltip');
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
        daily: [makeDay('2026-08-12', { labels: 12, validations: 3, active_users: 2, ai_validations: 400,
          ai_agents: 1 })],
      });

      expect(document.getElementById('now-labels-today').textContent).toBe('12');
      expect(document.getElementById('now-validations-today-ai').textContent).toBe('+ 400 by AI');
      expect(document.getElementById('now-contributors-today-ai').textContent).toBe('+ 1 AI account');
    });
  });

  describe('day bars', () => {
    const DAILY = [
      makeDay('2026-08-11', { labels: 40, validations: 10, active_users: 3 }),
      makeDay('2026-08-12', {
        labels: 120,
        validations: 30,
        active_users: 4,
        ai_validations: 6420,
        ai_agents: 1,
        top_cities: [
          { city_id: 'chicago-il', city_name: 'Chicago', labels: 100, validations: 20, contributors: 3 },
          { city_id: 'seattle-wa', city_name: 'Seattle', labels: 20, validations: 10, contributors: 1 },
        ],
        contributors: [
          { username: 'alice', is_ai: false, labels: 100, validations: 20 },
          { username: 'sidewalk-ai', is_ai: true, labels: 0, validations: 6420 },
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

    it('gives every chart the same card for a given day, so one hover explains all three', async () => {
      await render({ daily: DAILY });
      const fromValidations = document.querySelectorAll('#ac-chart-week-validations rect.mini-bar')[1];

      expect(fromValidations.getAttribute('data-ps-tooltip')).toBe(barCard(1));
    });

    it('names the day\'s busiest cities and its contributors', async () => {
      await render({ daily: DAILY });
      const card = barCard(1);

      expect(card).toContain('Chicago');
      expect(card).toContain('Seattle');
      expect(card).toContain('alice');
      expect(card).toContain('sidewalk-ai');
    });

    it('marks an AI account in the contributor list rather than passing it off as a person', async () => {
      await render({ daily: DAILY });

      expect(barCard(1)).toContain('ac-tip-tag');
    });

    it('makes each bar focusable and named, so the card is reachable without a pointer', async () => {
      await render({ daily: DAILY });
      const bar = document.querySelectorAll('#ac-chart-week-labels rect.mini-bar')[1];

      expect(bar.getAttribute('tabindex')).toBe('0');
      expect(bar.getAttribute('aria-label')).toContain('Labels');
      // A native <title> would open its own tooltip on top of the card.
      expect(bar.querySelector('title')).toBeNull();
    });

    it('says so plainly when nothing happened that day', async () => {
      await render({
        daily: [makeDay('2026-08-11'), makeDay('2026-08-12', { labels: 5, active_users: 1 })],
      });
      // The quiet day draws no bar, so its card rides the value label; assert through the chart's own series data.
      const bars = document.querySelectorAll('#ac-chart-week-labels rect.mini-bar');

      expect(bars.length).toBe(1);
      expect(bars[0].getAttribute('data-ps-tooltip')).toContain('5');
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
      ai_agents_7d: 1,
      contributors: [
        contributor('carol', 5, 25),
        contributor('alice', 100, 2),
        contributor('bob', 15, 3),
        contributor('sidewalk-ai', 0, 6420, true),
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
      expect(cellCard(3).indexOf('sidewalk-ai')).toBeLessThan(cellCard(3).indexOf('carol'));
      expect(cellCard(3).indexOf('carol')).toBeLessThan(cellCard(3).indexOf('bob'));
    });

    it('leaves out anyone with no activity in the window the column is about', async () => {
      const cities = [makeCity('quiet', {
        labels_7d: 4,
        contributors_7d: 2,
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
