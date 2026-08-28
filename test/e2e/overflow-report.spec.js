/**
 * Unit checks for horizontalOverflowReport (fixtures.js), the helper phone-viewport.spec.js measures every page
 * with. It runs against synthetic markup via setContent rather than the app, so it needs no database, no imagery
 * key, and no seeded city — the exemption rules are the subject, not any particular page.
 *
 * Worth pinning because the rules are subtle and a wrong one is silent in both directions: an exemption that is
 * too broad hides a real #4883 overflow, and one that is too narrow reports noise nobody can act on. #5025 was
 * the second kind — the Google Maps SDK's hidden font probe surfaced as an unidentifiable `span right=1284px`.
 *
 * Every fixture page carries a viewport meta tag: without one, a mobile-UA Chromium lays out against a 980px
 * fallback viewport instead of the device width, and the elements below would not overflow at all.
 */
const {devices} = require('@playwright/test');
const {test, expect, horizontalOverflowReport} = require('./fixtures');

const IPHONE = {...devices['iPhone 13'], viewport: {width: 390, height: 844}};
delete IPHONE.defaultBrowserType;

const HEAD = '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>';

test.describe('horizontalOverflowReport', () => {
  test.use(IPHONE);

  test('reports visible overflow and exempts hidden boxes', async ({page}) => {
    await page.setContent(`${HEAD}
      <body style="margin:0">
        <div id="visible-wide" style="width:1200px;height:20px">wide and visible</div>

        <!-- The Google Maps font probe's shape: a hidden wrapper whose overflow-x is 'hidden', which the
             scroller exemption deliberately does not cover, around a span far wider than the viewport. -->
        <div id="hidden-wrap" style="visibility:hidden;position:absolute;overflow-x:hidden;width:1px">
          <span style="position:absolute;font-size:300px">BESbswy</span>
        </div>

        <!-- A hidden child inside a visible parent: the parent is what a reader can actually see stretched,
             and it is what must still be reported. -->
        <div id="parent-stretched" style="width:max-content">
          <span id="hidden-child" style="visibility:hidden;display:inline-block;width:1100px;height:10px"></span>
        </div>
      </body></html>
    `);

    const offenders = (await horizontalOverflowReport(page)).offenders.join('\n');

    expect(offenders).toContain('div#visible-wide');
    expect(offenders).toContain('div#parent-stretched');
    expect(offenders).not.toContain('BESbswy');
    expect(offenders).not.toContain('hidden-wrap');
    expect(offenders).not.toContain('hidden-child');
  });

  test('exempts descendants of a horizontal scroller', async ({page}) => {
    await page.setContent(`${HEAD}
      <body style="margin:0">
        <div style="overflow-x:auto;width:100%">
          <table id="wide-table" style="width:1200px"><tr><td>sanctioned wide content</td></tr></table>
        </div>
      </body></html>
    `);

    const report = await horizontalOverflowReport(page);
    expect(report.offenders).toEqual([]);
  });

  test('describes an offender well enough to find it', async ({page}) => {
    await page.setContent(`${HEAD}
      <body style="margin:0">
        <main class="page"><div><span style="display:inline-block;width:900px;height:10px">findable text</span></div></main>
      </body></html>
    `);

    const [offender] = (await horizontalOverflowReport(page)).offenders;

    // Width and ancestry place it; the text sample names an element that carries no id or class of its own.
    expect(offender).toContain('width=900px');
    expect(offender).toContain('in div < main.page < body');
    expect(offender).toContain('text="findable text"');
  });
});
