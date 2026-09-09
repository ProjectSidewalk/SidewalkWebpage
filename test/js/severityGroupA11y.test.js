/**
 * Tests for the keyboard and screen-reader contract of the severity/quality rating group, shared by Explore's
 * context menu and Expert Validate's menu (app/views/apps/explore.scala.html, app/views/apps/validate.scala.html,
 * public/css/main.css).
 *
 * The group is three `<label class="severity-button">`s, each wrapping a same-named `<input type="radio">` that CSS
 * hides visually — `opacity: 0; width: 0; height: 0`, deliberately not `display: none`, so it keeps its place in the
 * tab order and the accessibility tree. That makes the group fully keyboard-operable: Tab reaches it and arrow keys
 * rove the selection, which is the radio-group pattern working as intended.
 *
 * Three things have to hold for that to be usable, and each failed silently, because none leaves a trace in a
 * rendered page a reviewer looks at with a mouse:
 *
 *   - The focus ring has to be drawn on the wrapping label. The radio is what takes focus, but it paints nothing and
 *     has no size, so a ring on the radio is a ring around a 0x0 box. Explore's page stylesheet had a rule for this
 *     scoped to `.severity-segments`, a class Validate's holder does not carry, so Expert Validate was operable from
 *     the keyboard with no visible focus at all (WCAG 2.4.7). The rule now sits in main.css beside the primitive.
 *   - The group needs an accessible name, or it announces as "1, radio button, 1 of 3" with no indication of what is
 *     being rated.
 *   - Whichever radio is `checked` is what a screen reader reads back as the current rating, and the visible
 *     selection — a smiley `<img>` swap — announces nothing. Explore is safe by construction: its radios are the
 *     source of truth and the icons are derived from them. Expert Validate runs the other way round, off the label's
 *     `newSeverity`, so its renderer has to write `checked` too or a rating stays announced under the next label.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MAIN_CSS_PATH = path.join(REPO_ROOT, 'public/css/main.css');
const VALIDATE_VIEW_PATH = path.join(REPO_ROOT, 'app/views/apps/validate.scala.html');
const EXPLORE_VIEW_PATH = path.join(REPO_ROOT, 'app/views/apps/explore.scala.html');

describe('the severity rating group is operable and announced', () => {
  const mainCss = fs.readFileSync(MAIN_CSS_PATH, 'utf8');

  // The whole point of hiding the radio this way rather than with display:none. If it ever becomes display:none or
  // visibility:hidden the group leaves the tab order entirely and no focus ring can bring it back.
  test('the hidden radio keeps its place in the tab order', () => {
    const rule = mainCss.split('.severity-button__radio {')[1].split('}')[0];

    expect(rule).toContain('opacity: 0');
    expect(rule).not.toMatch(/display:\s*none/);
    expect(rule).not.toMatch(/visibility:\s*hidden/);
  });

  test('focus on the radio draws a ring on the label that wraps it', () => {
    expect(mainCss).toContain('.severity-button:has(.severity-button__radio:focus-visible) {');
    expect(mainCss.split('.severity-button:has(.severity-button__radio:focus-visible) {')[1].split('}')[0])
      .toContain('outline:');
  });

  // A page-scoped copy is how Validate came to have no focus ring: Explore's rule required `.severity-segments` on
  // the holder, and Validate's holder does not carry it. One definition beside the primitive, or the next page to
  // reuse these buttons inherits the same silence.
  test('no page stylesheet keeps its own copy of the rule', () => {
    const pageStylesheets = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.css')) pageStylesheets.push(full);
      }
    };
    walk(path.join(REPO_ROOT, 'public/css/pages'));

    const offenders = pageStylesheets.filter(
      (file) => fs.readFileSync(file, 'utf8').includes('.severity-button__radio:focus-visible'),
    );

    expect(offenders).toEqual([]);
  });

  // The radios share a `name`, so they are already a group; what an unnamed group lacks is any statement of what it
  // is rating. Both headers are filled in by JS — the wording swaps between severity and quality by label type — so
  // each case also checks the element it points at is still there, since a dangling idref names nothing at all and
  // no browser complains.
  test.each([
    ['Validate', VALIDATE_VIEW_PATH, 'validate-severity-header'],
    ['Explore', EXPLORE_VIEW_PATH, 'severity-header-text'],
  ])('%s names the group with its own header', (_page, viewPath, headerId) => {
    const view = fs.readFileSync(viewPath, 'utf8');
    const holder = view.split('<div id="severity-radio-holder"')[1].split('>')[0];

    expect(holder).toContain('role="radiogroup"');
    expect(holder).toContain(`aria-labelledby="${headerId}"`);
    expect(view).toContain(`id="${headerId}"`);
  });

  // Only Expert Validate: Explore reads `checked` to pick its icons, so the two cannot disagree there, while Validate
  // derives both from the label's newSeverity and so has to write each. The two writes are pinned to one loop body
  // rather than to the file, since a checked write somewhere else in the class is what a drift would look like.
  // Source-level because the renderer is a #private method on a class that needs jQuery, i18next and Bootstrap.
  test('Expert Validate writes the checked state alongside the smiley it swaps', () => {
    const lines = fs.readFileSync(
      path.join(REPO_ROOT, 'public/js/validate/src/menu/DesktopValidationMenu.js'), 'utf8',
    ).split('\n');
    const iconSwap = lines.findIndex((line) => line.includes('getSmileyIconPath('));

    expect(iconSwap).toBeGreaterThan(-1);
    expect(lines.slice(iconSwap, iconSwap + 10).join('\n')).toContain('radio.checked = ');
  });
});
