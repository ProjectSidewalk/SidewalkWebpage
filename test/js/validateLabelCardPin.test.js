/**
 * Tests for pinning Validate's label card from its marker (#4843), in
 * frontend/js/validate/label/LabelVisibilityControl.js and the press handling in
 * frontend/js/validate/panorama/PanoOverlay.js.
 *
 * Hover opens the card before a click can land, so a click pins it (it then outlasts the pointer leaving) and a second
 * click unpins and closes it. Enter/Space, and a click with no pointer behind it, stay a plain toggle: focus already
 * opens the card, so they need no pin. aria-expanded has to follow the card throughout, and a press on the marker must
 * not take the card down before its click arrives, nor leave focus on the marker, where keys would go to the card
 * instead of the shortcuts.
 */

import { loadModules, mockModule, useUtil } from './loader.js';
import { fakeTracker } from './fakes.js';

mockModule('i18next', () => ({ default: { t: (key) => key } }));
// The card's own contents are LabelCard's; here only its opening and closing are under test.
mockModule('frontend/js/validate/label/LabelCard.js', () => ({
  LabelCard: class { closePopovers() {} isPopoverOpen() { return false; } },
}));

describe('pinning the Validate label card', () => {
  let control;
  let tracker;
  const marker = () => document.getElementById('validate-pano-marker');
  const expanded = () => marker().getAttribute('aria-expanded');

  /** Hovers the marker, as a mouse does on its way to clicking it. */
  const hover = () => marker().dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

  /** A still click on the marker: press, release, click. */
  function click() {
    marker().dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
    marker().dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 10, clientY: 10 }));
    marker().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: 10, clientY: 10 }));
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <div id="view-control-layer"><div id="validate-pano-marker"></div></div>
      <button id="label-visibility-control-button"></button>
      <div id="label-card"><button type="button" id="label-visibility-button-on-label"></button></div>`;
    tracker = fakeTracker();
    useUtil({ isMobile: () => false, assetPath: (p) => p });
    const { LabelVisibilityControl, PanoOverlay } = await loadModules(
      'frontend/js/validate/label/LabelVisibilityControl.js', 'frontend/js/validate/panorama/PanoOverlay.js');
    let wireMarker;
    control = new LabelVisibilityControl(
      { controlLayer: document.getElementById('view-control-layer') }, { viewerType: class {} },
      { onLoadingChange: () => {}, onLabelReady: () => {}, onLabelShown: () => {} },
      { getPanoMarker: () => null, onMarkerCreated: (listener) => { wireMarker = listener; }, onMarkerDrawn: () => {} },
      tracker,
    );
    wireMarker({ marker_: marker() });
    // The real overlay, so a press on the marker bubbles into the pan handling the way it does on the page.
    new PanoOverlay(document.getElementById('view-control-layer'), control, { getProperty: () => false });
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('a click on a hover-opened card pins it, so it survives the pointer leaving', () => {
    hover();
    expect(expanded()).toBe('true');
    click();
    marker().dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    vi.runAllTimers();

    expect(control.isCardVisible()).toBe(true);
    expect(control.isCardHeldOpen()).toBe(true);
    expect(expanded()).toBe('true');
    expect(tracker.push).toHaveBeenCalledWith('Click_PinLabelCard');
  });

  it('a second click unpins and closes it', () => {
    hover();
    click();
    click();

    expect(control.isCardVisible()).toBe(false);
    expect(control.isCardHeldOpen()).toBe(false);
    expect(expanded()).toBe('false');
    expect(tracker.push).toHaveBeenLastCalledWith('Click_UnpinLabelCard');
  });

  it('after unpinning, the card is a hover card again', () => {
    hover();
    click();
    click();
    hover();
    marker().dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    vi.runAllTimers();

    expect(control.isCardVisible()).toBe(false);
  });

  it('a pointerless press (a screen reader’s, detail 0) toggles rather than pins, logging only the open', () => {
    marker().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));

    expect(control.isCardVisible()).toBe(true);
    expect(control.isCardHeldOpen()).toBe(false);
    expect(tracker.push.mock.calls.map((call) => call[0])).toEqual(['MouseOver_Label']);
  });

  it('a pointerless press closes a card that focus opened, on the first press, without pinning', () => {
    marker().focus();
    expect(control.isCardVisible()).toBe(true);
    tracker.push.mockClear();
    marker().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));

    expect(control.isCardVisible()).toBe(false);
    expect(expanded()).toBe('false');
    // The toggle's close logs nothing, as Enter/Space's always has; above all, no pin.
    expect(tracker.push).not.toHaveBeenCalled();
  });

  it('a pan that starts on the marker closes even a pinned card, and does not re-pin it', () => {
    hover();
    click();
    marker().dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
    expect(control.isCardVisible()).toBe(true); // A press alone could still be a click.
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 80, clientY: 10 }));
    expect(control.isCardVisible()).toBe(false);
    marker().dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 10, clientY: 10 }));
    marker().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: 10, clientY: 10 }));

    expect(control.isCardVisible()).toBe(false);
    expect(expanded()).toBe('false');
  });

  it('a pan from the marker released elsewhere does not swallow the next bare click', () => {
    marker().dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 30, clientY: 10 }));
    document.getElementById('view-control-layer')
      .dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 30, clientY: 10 }));
    marker().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })); // A screen reader's press.

    expect(control.isCardVisible()).toBe(true);
    expect(tracker.push).toHaveBeenLastCalledWith('MouseOver_Label');
  });

  it('a press elsewhere on the pano still closes a pinned card at once', () => {
    hover();
    click();
    document.getElementById('view-control-layer')
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));

    expect(control.isCardVisible()).toBe(false);
    expect(expanded()).toBe('false');
  });

  it('a click does not leave focus on the marker, so the shortcuts keep their keys', () => {
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: 10, clientY: 10 });
    marker().dispatchEvent(down);
    marker().dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 10, clientY: 10 }));
    marker().dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: 10, clientY: 10 }));

    // jsdom never focuses on mousedown, so activeElement can't show the fix; a cancelled mousedown is what keeps a
    // real browser from focusing the tabindex=0 marker.
    expect(down.defaultPrevented).toBe(true);
    expect(control.isCardHeldOpen()).toBe(true);
  });

  it('Enter/Space stay a plain toggle, which also closes a pinned card, logging no pin', () => {
    click();
    control.toggleLabelCard({ viaKeyboard: true }); // What KeyboardManager calls on Enter/Space.
    expect(control.isCardVisible()).toBe(false);

    control.toggleLabelCard({ viaKeyboard: true });
    expect(control.isCardVisible()).toBe(true);
    expect(control.isCardHeldOpen()).toBe(false);
    expect(tracker.push).toHaveBeenLastCalledWith('KeyboardShortcut_ShowLabelCard');
  });

  it('a pinned card is marked held for the immersive dock rule, like one opened on load', () => {
    click();
    expect(document.getElementById('label-card').classList.contains('label-card--held')).toBe(true);
  });

  it('logs no pin when there is no marker on screen to pin a card to', () => {
    marker().remove();
    control.toggleLabelCardPin();

    expect(control.isCardVisible()).toBe(false);
    expect(tracker.push).not.toHaveBeenCalled();
  });
});
