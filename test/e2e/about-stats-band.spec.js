/**
 * The /about "by the numbers" band must never let one stat's value run into its neighbour (issue #5151).
 *
 * The band's real content is a moving target — the counts grow, the values arrive from /v3/api/aggregateStats and
 * differ per environment, and each locale groups digits and translates the captions differently — so measuring the
 * page as served would only ever pin whatever happens to be in the CI database. This drives the real page and its
 * real stylesheet, then swaps in the widest values the band is expected to survive: the server-rendered no-JS
 * fallbacks that ship in about.scala.html, an eight-figure future, and the longest captions across the supported
 * languages. That is the layout contract the fixed-width tracks this replaced could not hold.
 *
 * Overlap is measured on Range rects — the inked text box — rather than the element box, because that is what a
 * reader actually sees collide, and a too-narrow box with room to spare around it is not a bug.
 */
const {test, expect, loadAndSettle} = require('./fixtures');

// Wide enough for the band on one line, down through both wrap points to the narrowest phone we support.
const WIDTHS = [1600, 1440, 1216, 1024, 900, 768, 600, 480, 390, 320];

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
    // Spanish and German carry the longest captions of the supported languages, and group digits with periods.
    name: 'longest localized captions',
    stats: [
      ['30.822', 'Kilómetros explorados'],
      ['1.662.874', 'Markierungen'],
      ['2.330.941', 'Validaciones'],
      ['57', 'Ciudades'],
      ['11', 'Länder'],
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
 * Reports every pair of stat values (or captions) whose inked boxes intersect, plus anything painting past the
 * band's own content box.
 *
 * @param {import('@playwright/test').Page} page - The loaded /about page.
 * @returns {Promise<{overlaps: string[], overflow: number}>} Human-readable collisions and the worst overhang in px.
 */
function bandCollisions(page) {
  return page.evaluate(() => {
    const inked = (el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return range.getBoundingClientRect();
    };
    const band = document.querySelector('.about-stats-grid');
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

    const right = band.getBoundingClientRect().right;
    const overflow = Math.max(0, ...items.flatMap((it) => [it.number.right - right, it.label.right - right]));
    return {overlaps, overflow: Number(overflow.toFixed(1))};
  });
}

test.describe('/about stats band', () => {
  for (const scenario of SCENARIOS) {
    test(`no stat collides with its neighbour — ${scenario.name}`, async ({page, context}) => {
      await loadAndSettle(page, context, {path: '/about', makeabilityLab: true, mapbox: true});

      for (const width of WIDTHS) {
        await page.setViewportSize({width, height: 900});
        // The values are re-applied per width: /about hydrates from the API, which can land mid-loop and
        // put the deployment's own counts back.
        await setStats(page, scenario.stats);

        const {overlaps, overflow} = await bandCollisions(page);
        expect(overlaps, `at ${width}px: ${overlaps.join('; ')}`).toEqual([]);
        expect(overflow, `at ${width}px a stat paints ${overflow}px past the band`).toBeLessThanOrEqual(0.5);
      }
    });
  }
});
