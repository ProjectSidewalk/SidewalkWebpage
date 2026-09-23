/**
 * The site's stat bands must never let one figure run into its neighbour (issues #5151, #5175).
 *
 * Two bands lay a handful of big numbers out across one row: `/about`'s "by the numbers" (#5151) and the community
 * band shared by `/leaderboard` and the dashboard's cross-city section (#5175). Each holds a different promise, and
 * both are pinned here. `/about` sizes every stat from its own content, so the guarantee is only that no two of them
 * ever touch. The community band goes further: five tiles stay on one line, dropping to 3 + 2 where they genuinely
 * cannot, so a lone stranded tile is a failure there and its figures swap to a short form under pressure rather than
 * shrinking the type to suit the longest number anyone might reach.
 *
 * Their real content is a moving target — the counts grow, some arrive from an API and differ per environment, and
 * each locale groups digits and translates the captions differently — so measuring the pages as served would only
 * pin whatever happens to be in the CI database. Each band is driven on its real page with its real stylesheet and
 * the widest content it is expected to survive swapped in. That makes the community band's type coefficient a
 * tested value rather than a guess: too large and a figure spills, too small and the numbers are needlessly meek.
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
    // This band promises five tiles on one line, and 3 + 2 where they genuinely cannot fit -- never a lone tile.
    noWidow: true,
    selectors: {
      band: '.ud-community-band',
      item: '.ud-community-stat',
      value: '.ud-community-value',
      label: '.ud-community-label',
    },
    scenarios: [
      {
        // [exact, caption, short] -- the band renders both forms and picks one by width.
        name: 'community totals at prod scale',
        stats: [
          ['19,343', 'Contributors', '19k'],
          ['1,662,874', 'Labels', '1.7M'],
          ['2,330,941', 'Validations', '2.3M'],
          ['30,822 km', 'Streets explored', '31k km'],
          ['57', 'Cities'],
        ],
      },
      {
        // Every figure an order of magnitude past today's, to keep the type coefficient honest as the counts grow.
        name: 'community totals an order of magnitude on',
        stats: [
          ['193,432', 'Contributors', '193k'],
          ['12,662,874', 'Labels', '12.7M'],
          ['22,330,941', 'Validations', '22.3M'],
          ['130,822 km', 'Streets explored', '131k km'],
          ['557', 'Cities'],
        ],
      },
      {
        // The shape the dashboard's cross-city copy of this band fills in, whose distance carries a decimal.
        name: 'cross-city totals',
        stats: [
          ['12', 'Cities'],
          ['1,234,567', 'Labels', '1.2M'],
          ['2,345,678', 'Validations', '2.3M'],
          ['12,345.6 km', 'Distance', '12k km'],
          ['57', 'Cities'],
        ],
      },
      {
        // The dashboard's cross-city band is this one with a tile removed. Hardcoding five columns strands that
        // fourth tile at the narrow step (#5186), which is the failure the band's whole rule exists to prevent.
        name: 'four tiles, as the dashboard renders them',
        drop: 1,
        bandClass: 'ud-cities-band',
        stats: [
          ['12', 'Cities'],
          ['1,234,567', 'Labels', '1.2M'],
          ['2,345,678', 'Validations', '2.3M'],
          ['12,345.6 km', 'Distance', '12k km'],
        ],
      },
      {
        name: 'longest German captions',
        stats: [
          ['19.343', 'Mitwirkende', '19k'],
          ['1.662.874', 'Beschriftungen', '1,7M'],
          ['2.330.941', 'Validierungen', '2,3M'],
          ['30.822 km', 'Erkundete Straßen', '31k km'],
          ['57', 'Städte'],
        ],
      },
    ],
  },
];

/**
 * Reshapes the band into a variant another page renders, so one page can stand in for both. Removing tiles and
 * adding the variant's own class is what exercises the real rule rather than a hand-set column count.
 *
 * @param {import('@playwright/test').Page} page - The loaded page.
 * @param {Object} selectors - The band's `band` and `item` selectors.
 * @param {Object} scenario - Its `drop` (tiles to remove from the end) and `bandClass` (class the variant carries).
 */
async function applyShape(page, selectors, scenario) {
  if (!scenario.drop) return;
  await page.evaluate(({sel, drop, cls}) => {
    const band = document.querySelector(sel.band);
    if (cls) band.classList.add(cls);
    [...band.querySelectorAll(sel.item)].slice(-drop).forEach((el) => el.remove());
  }, {sel: selectors, drop: scenario.drop, cls: scenario.bandClass});
}

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
      const [full, caption, short] = pairs[i];
      const value = el.querySelector(sel.value);
      // A third entry means the band renders the figure twice and picks one by width, so both have to be present
      // or the width sweep would only ever measure the long one.
      if (short === undefined) {
        value.textContent = full;
      } else {
        value.innerHTML
          = `<span class="ud-value-full">${full}</span><span class="ud-value-short" aria-hidden="true">${short}</span>`;
      }
      el.querySelector(sel.label).textContent = caption;
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
    // Where a figure is rendered in two forms, only the one actually on screen can collide with anything.
    const shown = (value) => {
      const short = value.querySelector('.ud-value-short');
      const full = value.querySelector('.ud-value-full');
      if (!short || !full) return value;
      return getComputedStyle(short).display === 'none' ? full : short;
    };
    const band = document.querySelector(sel.band);
    const items = [...band.querySelectorAll(sel.item)].map((el) => {
      const value = shown(el.querySelector(sel.value));
      return {
        value: value.textContent.trim(),
        number: inked(value),
        label: inked(el.querySelector(sel.label)),
      };
    });

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
    const style = getComputedStyle(band);
    const contentRight = box.right - parseFloat(style.paddingRight);
    const contentLeft = box.left + parseFloat(style.paddingLeft);
    // Both edges: these tiles are centred, so a value too wide for its share hangs off either side of the band.
    const overflow = Math.max(0, ...items.flatMap((it) => [
      it.number.right - contentRight, contentLeft - it.number.left,
      it.label.right - contentRight, contentLeft - it.label.left,
    ]));

    // How the tiles fall into rows, so a band that promises five-across can be held to it.
    const tops = [...band.querySelectorAll(sel.item)].map((el) => Math.round(el.getBoundingClientRect().top));
    const rows = [...new Set(tops)].map((top) => tops.filter((t) => t === top).length);

    return {values: items.map((it) => it.value), overlaps, rows, overflow: Number(overflow.toFixed(1))};
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
        await applyShape(page, band.selectors, scenario);
        await setStats(page, band.selectors, scenario.stats);

        // Either form of a figure is a legitimate thing to measure; anything else means the band stopped holding
        // what this test injected, and every assertion below would be about the deployment's own numbers instead.
        const allowedValues = scenario.stats.map(([full, , short]) => (short === undefined ? [full] : [full, short]));

        for (const width of WIDTHS) {
          await page.setViewportSize({width, height: 900});

          const {values, overlaps, rows, overflow} = await bandCollisions(page, band.selectors);
          values.forEach((value, i) => {
            expect(allowedValues[i], `at ${width}px stat ${i} reads "${value}"`).toContain(value);
          });
          expect(overlaps, `at ${width}px: ${overlaps.join('; ')}`).toEqual([]);
          expect(overflow, `at ${width}px a stat paints ${overflow}px past the band`).toBeLessThanOrEqual(0.5);
          if (band.noWidow) {
            // A last line holding one tile is only stranded if the lines above it hold more. Five tiles stacked one
            // per line is the other shape with no odd tile out, and it is what the narrowest phones get.
            const stranded = rows.length > 1 && rows[rows.length - 1] === 1 && Math.max(...rows) > 1;
            expect(stranded, `at ${width}px the band wraps ${rows.join('+')}, stranding one tile`).toBe(false);
          }
        }
      });
    }
  });
}
