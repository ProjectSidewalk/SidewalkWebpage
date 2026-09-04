/**
 * The site's stat bands must never let one figure run into its neighbour (issues #5151, #5175).
 *
 * Two bands lay a handful of big numbers out across one row: `/about`'s "by the numbers" and the community band
 * shared by `/leaderboard` and the dashboard's cross-city section. Neither sizes a stat from what it holds, so a
 * value wider than its share has nothing to stop it running into the next one. On `/about` that already happened
 * (#5151). On the community band it has not: its tiles are centred and its gutter is wide, so today's values
 * overhang into the gutter instead of colliding — these cases pin the guarantee rather than reproduce a failure,
 * and they are what would catch a raised font cap, a sixth tile, or a total that outgrows its abbreviation (#5175).
 *
 * Their real content is a moving target — the counts grow, some arrive from an API and differ per environment, and
 * each locale groups digits and translates the captions differently — so measuring the pages as served would only
 * pin whatever happens to be in the CI database. Each band is driven on its real page with its real stylesheet and
 * the widest content it is expected to survive swapped in.
 *
 * Overlap is measured on Range rects — the inked text box — rather than the element box, because that is what a
 * reader actually sees collide, and a too-narrow box with room to spare around it is not a bug.
 */
const {test, expect, loadAndSettle} = require('./fixtures');

// Wide enough for each band on one line, down through its wrap points to the narrowest phone we support. 320px is
// also the WCAG 1.4.10 reflow benchmark, and 600px is inside the 640px that 200% zoom on a 1280px window produces.
const WIDTHS = [1600, 1440, 1216, 1024, 900, 768, 600, 480, 390, 320];

// What /about's hydration is held to, so it can't race the values this spec injects. Only the fields
// fetchAggregateStats validates matter; every one it lists must be a number or it falls back to an error state.
const STUB_AGGREGATE_STATS = {
  status: 'OK',
  km_explored: 30822,
  km_explored_no_overlap: 28000,
  total_labels: 1662874,
  total_validations: 2330941,
  num_cities: 57,
  num_countries: 11,
  num_languages: 8,
  by_label_type: {},
};

const BANDS = [
  {
    name: '/about stats band',
    page: {path: '/about', makeabilityLab: true, mapbox: true},
    stubJson: {url: '**/v3/api/aggregateStats*', body: STUB_AGGREGATE_STATS},
    selectors: {
      band: '.about-stats-row',
      item: '.about-stat',
      value: '.about-stat-number',
      label: '.about-stat-label',
    },
    scenarios: [
      {
        name: 'server-rendered no-JS fallbacks',
        stats: [
          ['30,000+', 'Kilometers explored'],
          ['1,500,000+', 'Labels'],
          ['2,000,000+', 'Validations'],
          ['57', 'Cities'],
          ['11', 'Countries'],
        ],
      },
      {
        // The widest caption each column has across conf/messages/messages.*, so this is stricter than any one
        // locale: pt-BR's kilometers, German's labels and validations, Spanish's cities, English's countries.
        // Digits are period-grouped, as es/de/pt-BR format them.
        name: 'widest caption per column',
        stats: [
          ['30.822', 'Quilômetros explorados'],
          ['1.662.874', 'Beschriftungen'],
          ['2.330.941', 'Validierungen'],
          ['57', 'Ciudades'],
          ['11', 'Countries'],
        ],
      },
      {
        name: 'eight-figure counts',
        stats: [
          ['9,999,999', 'Kilometers explored'],
          ['88,888,888', 'Labels'],
          ['77,777,777', 'Validations'],
          ['555', 'Cities'],
          ['111', 'Countries'],
        ],
      },
    ],
  },
  {
    name: '/leaderboard community band',
    page: {path: '/leaderboard'},
    selectors: {
      band: '.ud-community-band',
      item: '.ud-community-stat',
      value: '.ud-community-value',
      label: '.ud-community-label',
    },
    scenarios: [
      {
        // leaderboard.scala.html's bigCountMarkup abbreviates counts at a million, so this is today's shape.
        name: 'counts abbreviated at a million',
        stats: [
          ['19,343', 'Contributors'],
          ['1.6M', 'Labels'],
          ['2.3M', 'Validations'],
          ['30,822 km', 'Streets explored'],
          ['57', 'Cities'],
        ],
      },
      {
        // fmtBigDist has no abbreviation step, so the community distance grows without bound in its tile.
        name: 'community distance past 100,000 km',
        stats: [
          ['19,343', 'Contributors'],
          ['1.6M', 'Labels'],
          ['2.3M', 'Validations'],
          ['130,822 km', 'Streets explored'],
          ['57', 'Cities'],
        ],
      },
      {
        // The dashboard's cross-city copy of this band formats with a bare toLocaleString, so its totals reach the
        // tiles unabbreviated however large they get.
        name: 'unabbreviated cross-city totals',
        stats: [
          ['12', 'Cities'],
          ['1,234,567', 'Labels'],
          ['2,345,678', 'Validations'],
          ['12,345.6 km', 'Distance'],
          ['57', 'Cities'],
        ],
      },
      {
        name: 'longest German captions',
        stats: [
          ['19.343', 'Mitwirkende'],
          ['1,6M', 'Beschriftungen'],
          ['2,3M', 'Validierungen'],
          ['30.822 km', 'Erkundete Straßen'],
          ['57', 'Städte'],
        ],
      },
    ],
  },
];

/**
 * Replaces every stat's value and caption, so the band is measured against known worst-case content.
 *
 * @param {import('@playwright/test').Page} page - The loaded page.
 * @param {Object} selectors - The band's `item`, `value` and `label` selectors.
 * @param {Array<Array<string>>} stats - One [value, caption] pair per stat, in document order.
 */
async function setStats(page, selectors, stats) {
  await page.evaluate(({sel, pairs}) => {
    document.querySelectorAll(sel.item).forEach((el, i) => {
      if (!pairs[i]) return;
      el.querySelector(sel.value).textContent = pairs[i][0];
      el.querySelector(sel.label).textContent = pairs[i][1];
    });
  }, {sel: selectors, pairs: stats});
  await page.evaluate(() => document.fonts.ready);
}

/**
 * Reports every pair of stats whose inked boxes intersect, plus anything painting past the band's content box.
 *
 * The values are reported back alongside the geometry so the caller can prove it measured the content it injected:
 * a band that quietly reverted to the deployment's own (short) counts would otherwise pass without testing anything.
 *
 * @param {import('@playwright/test').Page} page - The loaded page.
 * @param {Object} selectors - The band's `band`, `item`, `value` and `label` selectors.
 * @returns {Promise<{values: string[], overlaps: string[], overflow: number}>} The values as measured, the
 *   human-readable collisions between them, and the worst overhang past the band's content box in px.
 */
function bandCollisions(page, selectors) {
  return page.evaluate((sel) => {
    const inked = (el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return range.getBoundingClientRect();
    };
    const band = document.querySelector(sel.band);
    const items = [...band.querySelectorAll(sel.item)].map((el) => ({
      value: el.querySelector(sel.value).textContent,
      number: inked(el.querySelector(sel.value)),
      label: inked(el.querySelector(sel.label)),
    }));

    const overlaps = [];
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        for (const part of ['number', 'label']) {
          const a = items[i][part];
          const b = items[j][part];
          // Sub-pixel touching is rounding, not a collision.
          const dx = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const dy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (dx > 0.5 && dy > 0.5) {
            overlaps.push(`${part}s of "${items[i].value}" and "${items[j].value}" overlap by ${dx.toFixed(1)}px`);
          }
        }
      }
    }

    // getBoundingClientRect reports the border box whatever box-sizing says, and both bands pad their sides with no
    // border-box reset in scope — so the padding has to come off, or that much encroachment goes unreported.
    const box = band.getBoundingClientRect();
    const contentRight = box.right - parseFloat(getComputedStyle(band).paddingRight);
    const overflow = Math.max(0, ...items.flatMap((it) => [it.number.right - contentRight,
      it.label.right - contentRight]));

    return {values: items.map((it) => it.value), overlaps, overflow: Number(overflow.toFixed(1))};
  }, selectors);
}

for (const band of BANDS) {
  test.describe(band.name, () => {
    for (const scenario of band.scenarios) {
      test(`no stat collides with its neighbour — ${scenario.name}`, async ({page, context}) => {
        if (band.stubJson) {
          await context.route(band.stubJson.url, (route) => route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify(band.stubJson.body),
          }));
        }
        await loadAndSettle(page, context, band.page);
        await setStats(page, band.selectors, scenario.stats);

        const expectedValues = scenario.stats.map(([value]) => value);
        for (const width of WIDTHS) {
          await page.setViewportSize({width, height: 900});

          const {values, overlaps, overflow} = await bandCollisions(page, band.selectors);
          expect(values, `at ${width}px the band no longer holds the injected values`).toEqual(expectedValues);
          expect(overlaps, `at ${width}px: ${overlaps.join('; ')}`).toEqual([]);
          expect(overflow, `at ${width}px a stat paints ${overflow}px past the band`).toBeLessThanOrEqual(0.5);
        }
      });
    }
  });
}
