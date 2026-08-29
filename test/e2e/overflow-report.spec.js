/**
 * Unit checks for horizontalOverflowReport (fixtures.js), the helper phone-viewport.spec.js measures every page
 * with. Every case is synthetic markup via setContent, so no database, imagery key or seeded city is involved.
 * The chromium project still depends on `setup`, which registers a user against a running app; `--no-deps` runs
 * this file without one.
 *
 * Worth pinning because the rules are subtle and a wrong one is silent in both directions: an exemption that is
 * too broad hides a real #4883 overflow, and one that is too narrow reports noise nobody can act on. #5025 was
 * the second kind — the Google Maps SDK's hidden font probe surfaced as an unidentifiable `span right=1284px`.
 *
 * Every fixture page carries a viewport meta tag: without one, a mobile-UA Chromium lays out against a 980px
 * fallback viewport instead of the device width, and the elements below would not overflow at all.
 */
const {test, expect, horizontalOverflowReport, PHONE_DEVICE} = require('./fixtures');

const HEAD = '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>';

test.describe('horizontalOverflowReport', () => {
  test.use(PHONE_DEVICE);

  test('reports visible overflow and exempts hidden boxes', async ({page}) => {
    await page.setContent(`${HEAD}
      <body style="margin:0">
        <div id="visible-wide" style="width:1200px;height:20px">wide and visible</div>

        <!-- An in-flow hidden box: wide enough to report on its size alone, exempt on its visibility. -->
        <div id="hidden-wide" style="visibility:hidden;width:1200px;height:20px">parked off-screen</div>

        <!-- The Google Maps font probe's shape: a hidden wrapper whose overflow-x is 'hidden', which the
             scroller exemption deliberately does not cover, around a span far wider than the viewport. -->
        <div id="hidden-wrap" style="visibility:hidden;position:absolute;overflow-x:hidden;width:1px;height:1px">
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
    expect(offenders).not.toContain('hidden-wide');
    expect(offenders).not.toContain('hidden-child');
  });

  // Why the rule can't just be "skip anything hidden": a fixed box contributes nothing to scrollWidth either, so
  // skipping it here would leave it measured by nothing. Ours park hidden until they open (.gallery-expanded-view).
  test('still reports a hidden fixed box', async ({page}) => {
    await page.setContent(`${HEAD}
      <body style="margin:0">
        <div id="hidden-fixed" style="visibility:hidden;position:fixed;top:0;left:0;width:1200px;height:20px">
          the #4857 shape
        </div>
      </body></html>
    `);

    expect((await horizontalOverflowReport(page)).offenders.join('\n')).toContain('div#hidden-fixed');
  });

  // visibility is inherited, so the exemption covers a hidden box's subtree — but a descendant can take it back
  // and paint (label-detail.css warns about exactly that: "`inherit`, never `visible`").
  test('still reports a visible descendant of a hidden ancestor', async ({page}) => {
    await page.setContent(`${HEAD}
      <body style="margin:0">
        <div id="hidden-ancestor" style="visibility:hidden">
          <div id="visible-again" style="visibility:visible;width:1200px;height:20px">painted anyway</div>
        </div>
      </body></html>
    `);

    expect((await horizontalOverflowReport(page)).offenders.join('\n')).toContain('div#visible-again');
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
        <main class="page">
          <div><span style="display:inline-block;width:900px;height:10px">findable text</span></div>
        </main>
      </body></html>
    `);

    const [offender] = (await horizontalOverflowReport(page)).offenders;

    // Width and ancestry place it; the text sample names an element that carries no id or class of its own.
    expect(offender).toContain('width=900px');
    expect(offender).toContain('in div < main.page < body');
    expect(offender).toContain('text="findable text"');
  });
});
