/**
 * Tests for the chevron toggle in Explore's PanoOverlayControls (public/js/explore/src/controls/
 * PanoOverlayControls.js), logged since #5501.
 *
 * The CSS shows the menu from the chevron's `aria-expanded`, and the toggle is logged as Click_PanoControlMenu_Toggle,
 * the same event Validate's PanoControlMenu writes, so one query covers both tools. These pin that a click flips the
 * attribute both ways and logs the resulting state each time. Loaded like the other class-based suites: eval'd with an
 * explicit export.
 */

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/explore/src/controls/PanoOverlayControls.js'), 'utf8'
);

beforeAll(() => {
    (0, eval)(`${SRC}\nwindow.PanoOverlayControls = PanoOverlayControls;`);
});

let toggle;
let tracker;

beforeEach(() => {
    document.body.innerHTML = `
      <button type="button" id="explore-control-stuck"></button>
      <button type="button" id="explore-control-buttons-toggle" aria-expanded="false"
        aria-controls="explore-control-menu"></button>
      <div id="explore-control-menu"></div>`;
    toggle = document.getElementById('explore-control-buttons-toggle');
    tracker = { push: jest.fn() };
    new window.PanoOverlayControls(tracker, {}, {}, {});
});

test('the chevron opens and closes the menu, logging the resulting state each time', () => {
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(tracker.push).toHaveBeenLastCalledWith('Click_PanoControlMenu_Toggle', { expanded: true });

    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(tracker.push).toHaveBeenLastCalledWith('Click_PanoControlMenu_Toggle', { expanded: false });
    expect(tracker.push).toHaveBeenCalledTimes(2);
});
