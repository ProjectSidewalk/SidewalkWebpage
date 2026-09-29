/**
 * Tests for PanoControlMenu (public/js/validate/src/panorama/PanoControlMenu.js), the chevron that opens the menu
 * holding the Image pill in desktop Validate's top-left corner (#5501).
 *
 * The CSS shows the menu from the chevron's `aria-expanded`, so the attribute is the contract: these pin that a click
 * flips it both ways, that each flip is logged with the resulting state, and that the collapsed indicator toggles the
 * shared active-dot class. Loaded like the other class-based suites: eval'd with an explicit export.
 */

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/validate/src/panorama/PanoControlMenu.js'), 'utf8'
);

beforeAll(() => {
    (0, eval)(`${SRC}\nwindow.PanoControlMenu = PanoControlMenu;`);
});

let toggle;
let tracker;
let menu;

beforeEach(() => {
    document.body.innerHTML = `
      <button type="button" id="validate-control-buttons-toggle" aria-expanded="false"
        aria-controls="validate-control-menu"></button>
      <div id="validate-control-menu"></div>`;
    toggle = document.getElementById('validate-control-buttons-toggle');
    tracker = { push: jest.fn() };
    menu = new window.PanoControlMenu(toggle, tracker);
});

test('a click opens the menu and a second closes it, logging each with the resulting state', () => {
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(menu.isExpanded()).toBe(true);
    expect(tracker.push).toHaveBeenLastCalledWith('Click_PanoControlMenu_Toggle', { expanded: true });

    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(tracker.push).toHaveBeenLastCalledWith('Click_PanoControlMenu_Toggle', { expanded: false });
    expect(tracker.push).toHaveBeenCalledTimes(2);
});

test('the collapsed indicator toggles the shared active-dot class on the chevron', () => {
    menu.setCollapsedIndicator(true);
    expect(toggle.classList.contains('pano-overlay-button--active')).toBe(true);
    menu.setCollapsedIndicator(false);
    expect(toggle.classList.contains('pano-overlay-button--active')).toBe(false);
});
