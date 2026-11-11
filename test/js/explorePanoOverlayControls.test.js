/**
 * Tests for the chevron toggle and Stuck button in Explore's PanoOverlayControls (frontend/js/explore/controls/
 * PanoOverlayControls.js), logged since #5501.
 *
 * The CSS shows the menu from the chevron's `aria-expanded`, and the toggle is logged as Click_PanoControlMenu_Toggle,
 * the same event Validate's PanoControlMenu writes, so one query covers both tools. These pin that a click flips the
 * attribute both ways and logs the resulting state each time, and that the Stuck button moves the labeler on and
 * logs whether a pano was found (#5840).
 */

import { loadModules } from './loader.js';
import { fakeTracker } from './fakes.js';

const { PanoOverlayControls } = await loadModules('frontend/js/explore/controls/PanoOverlayControls.js');

let toggle;
let tracker;

beforeEach(() => {
  document.body.innerHTML = `
      <button type="button" id="explore-control-stuck"></button>
      <button type="button" id="explore-control-buttons-toggle" aria-expanded="false"
        aria-controls="explore-control-menu"></button>
      <div id="explore-control-menu"></div>`;
  toggle = document.getElementById('explore-control-buttons-toggle');
  tracker = fakeTracker();
  new PanoOverlayControls(tracker, { walking: { onChanged: () => {} } }, {}, {});
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

describe('the Stuck button', () => {
  let stuck;
  let nav;
  let stuckAlert;
  let shortcutAlert;

  /**
   * Rebuilds the controls with a navigation service whose forward move succeeds or fails as asked.
   * @param {{canWalk?: boolean, moveSucceeds?: boolean}} [opts]
   */
  function build({ canWalk = true, moveSucceeds = true } = {}) {
    document.body.innerHTML = `
      <button type="button" id="explore-control-stuck"></button>
      <button type="button" id="explore-control-buttons-toggle" aria-expanded="false"></button>`;
    stuck = document.getElementById('explore-control-stuck');
    tracker = fakeTracker();
    nav = {
      canWalk: vi.fn(() => canWalk),
      moveForward: vi.fn(() => (moveSucceeds ? Promise.resolve() : Promise.reject(new Error('no imagery')))),
    };
    stuckAlert = { compassOrStuckClicked: vi.fn(), stuckClicked: vi.fn() };
    shortcutAlert = { stuckButtonClicked: vi.fn() };
    return new PanoOverlayControls(tracker, nav, stuckAlert, shortcutAlert);
  }

  test('moves the labeler forward and logs that they got unstuck', async () => {
    build();
    stuck.click();
    await vi.waitFor(() => expect(tracker.push).toHaveBeenCalledWith('ModalStuck_Unstuck'));
    expect(tracker.push).toHaveBeenCalledWith('ModalStuck_ClickStuck');
    expect(stuckAlert.compassOrStuckClicked).toHaveBeenCalled();
    expect(shortcutAlert.stuckButtonClicked).toHaveBeenCalled();
    expect(stuckAlert.stuckClicked).toHaveBeenCalled();
  });

  test('logs that no pano was available when the forward move fails', async () => {
    build({ moveSucceeds: false });
    stuck.click();
    await vi.waitFor(() => expect(tracker.push).toHaveBeenCalledWith('ModalStuck_PanoNotAvailable'));
    expect(stuckAlert.stuckClicked).not.toHaveBeenCalled();
  });

  test('does nothing while walking is turned off', () => {
    build({ canWalk: false });
    stuck.click();
    expect(nav.moveForward).not.toHaveBeenCalled();
    expect(tracker.push).not.toHaveBeenCalled();
  });

  test('blinks until told to stop, and onboarding can disable both buttons', () => {
    vi.useFakeTimers();
    try {
      const controls = build();
      controls.blinkStuckButton();
      vi.advanceTimersByTime(500);
      expect(stuck.classList.contains('highlight-100')).toBe(true);
      controls.stopBlinkingStuckButton();
      vi.advanceTimersByTime(1500);
      expect(stuck.classList.contains('highlight-100')).toBe(false);

      controls.disableButtons();
      expect(stuck.disabled).toBe(true);
      expect(document.getElementById('explore-control-buttons-toggle').disabled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

test('the chevron is badged while a hidden control is off its default', () => {
  const controls = new PanoOverlayControls(tracker, { walking: { onChanged: () => {} } }, {}, {});
  controls.setCollapsedIndicator(true);
  expect(toggle.classList.contains('pano-overlay-button--active')).toBe(true);
  controls.setCollapsedIndicator(false);
  expect(toggle.classList.contains('pano-overlay-button--active')).toBe(false);
});
