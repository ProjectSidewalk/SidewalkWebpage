/**
 * The /about "by the numbers" band must never let one stat's value run into its neighbour (issue #5151).
 *
 * The band's real content is a moving target — the counts grow, the values arrive from /v3/api/aggregateStats and
 * differ per environment, and each locale groups digits and translates the captions differently — so measuring the
 * page as served would only ever pin whatever happens to be in the CI database. This drives the real page and its
 * real stylesheet with the widest content the band is expected to survive swapped in: the server-rendered no-JS
 * fallbacks that ship in about.scala.html, an eight-figure future, and the longest caption each column has across
 * the supported languages.
 *
 * Overlap is measured on Range rects — the inked text box — rather than the element box, because that is what a
 * reader actually sees collide, and a too-narrow box with room to spare around it is not a bug.
 */
const {test, expect, loadAndSettle} = require('./fixtures');

// Wide enough for the band on one line, down through both wrap points to the narrowest phone we support. 320px is
// also the WCAG 1.4.10 reflow benchmark, and 600px is inside the 640px that 200% zoom on a 1280px window produces.
const WIDTHS = [1600, 1440, 1216, 1024, 900, 768, 600, 480, 390, 320];

// What the page's own hydration is held to, so it can't race the values this spec injects. Only the fields
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

const SCENARIOS = [
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
    // The widest caption each column has across conf/messages/messages.*, so this is stricter than any one locale:
    // pt-BR's kilometers, German's labels and validations, Spanish's cities, English's countries. Digits are
    // period-grouped, as es/de/pt-BR format them.
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
];

/**
 * Replaces every stat's value and caption, so the band is measured against known worst-case content.
 *
 * @param {import('@playwright/test').Page} page - The loaded /about page.
 * @param {Array<Array<string>>} stats - One [value, caption] pair per stat, in document order.
 */
async function setStats(page, stats) {
  await page.evaluate((pairs) => {
    document.querySelectorAll('.about-stat').forEach((el, i) => {
      if (!pairs[i]) return;
      el.querySelector('.about-stat-number').textContent = pairs[i][0];
      el.querySelector('.about-stat-label').textContent = pairs[i][1];
    });
  }, stats);
  await page.evaluate(() => document.fonts.ready);
}

/**
 * Reports every pair of stats whose inked boxes intersect, plus anything painting past the band's content box.
 *
 * The values are reported back alongside the geometry so the caller can prove it measured the content it injected:
 * a band that quietly reverted to the deployment's own (short) counts would otherwise pass without testing anything.
 *
 * @param {import('@playwright/test').Page} page - The loaded /about page.
 * @returns {Promise<{values: string[], overlaps: string[], overflow: number}>} The values as measured, the
 *   human-readable collisions between them, and the worst overhang past the band's content box in px.
 */
function bandCollisions(page) {
  return page.evaluate(() => {
    const inked = (el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return range.getBoundingClientRect();
    };
    const band = document.querySelector('.about-stats-row');
    const items = [...band.querySelectorAll('.about-stat')].map((el) => ({
      value: el.querySelector('.about-stat-number').textContent,
      number: inked(el.querySelector('.about-stat-number')),
      label: inked(el.querySelector('.about-stat-label')),
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

    // getBoundingClientRect reports the border box whatever box-sizing says, and .about-container pads 20px a side
    // with no border-box reset in scope — so the padding has to come off, or 20px of encroachment goes unreported.
    const box = band.getBoundingClientRect();
    const contentRight = box.right - parseFloat(getComputedStyle(band).paddingRight);
    const overflow = Math.max(0, ...items.flatMap((it) => [it.number.right - contentRight,
      it.label.right - contentRight]));

    return {values: items.map((it) => it.value), overlaps, overflow: Number(overflow.toFixed(1))};
  });
}

test.describe('/about stats band', () => {
  for (const scenario of SCENARIOS) {
    test(`no stat collides with its neighbour — ${scenario.name}`, async ({page, context}) => {
      await context.route('**/v3/api/aggregateStats*', (route) => route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(STUB_AGGREGATE_STATS),
      }));
      await loadAndSettle(page, context, {path: '/about', makeabilityLab: true, mapbox: true});
      await setStats(page, scenario.stats);

      const expectedValues = scenario.stats.map(([value]) => value);
      for (const width of WIDTHS) {
        await page.setViewportSize({width, height: 900});

        const {values, overlaps, overflow} = await bandCollisions(page);
        expect(values, `at ${width}px the band no longer holds the injected values`).toEqual(expectedValues);
        expect(overlaps, `at ${width}px: ${overlaps.join('; ')}`).toEqual([]);
        expect(overflow, `at ${width}px a stat paints ${overflow}px past the band`).toBeLessThanOrEqual(0.5);
      }
    });
  }
});
