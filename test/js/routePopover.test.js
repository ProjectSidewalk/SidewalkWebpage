/**
 * Tests for RouteBuilder's on-route action menu (frontend/js/route-builder/RoutePopover.js, #5840): a menu opened by
 * hovering closes itself once the pointer has left both the route and the menu, while one opened by clicking stays
 * until a click elsewhere. The map popup is a double that records whether it's showing and what it holds.
 */

import { loadModules, mockModule } from './loader.js';

/** A mapbox-gl Popup double: the menu's DOM is held, and appended to the page while open so it can be hovered. */
class FakePopup {
  constructor() {
    this.open = false;
    this.content = null;
  }

  setLngLat() {
    return this;
  }

  setDOMContent(el) {
    this.content?.remove();
    this.content = el;
    return this;
  }

  addTo() {
    this.open = true;
    document.body.appendChild(this.content);
    return this;
  }

  remove() {
    this.open = false;
    this.content?.remove();
    return this;
  }

  isOpen() {
    return this.open;
  }
}

mockModule('frontend/js/common/mapboxgl.js', () => ({ default: { Popup: FakePopup } }));
mockModule('i18next', () => ({ default: { t: (key) => key } }));
const { RoutePopover } = await loadModules('frontend/js/route-builder/RoutePopover.js');

describe('RoutePopover', () => {
  let popover;
  let onReverse;
  let onDelete;
  const menu = () => document.querySelector('.route-popover');

  beforeEach(() => {
    document.body.innerHTML = '';
    window.logWebpageActivity = vi.fn();
    vi.useFakeTimers();
    onReverse = vi.fn();
    onDelete = vi.fn();
    popover = new RoutePopover({}, onReverse, onDelete);
  });

  test('a hover-opened menu closes once the pointer has been off the route for a beat', () => {
    popover.open({ lng: 0, lat: 0 });

    popover.scheduleHoverClose();
    vi.advanceTimersByTime(RoutePopover.HOVER_CLOSE_MS - 1);
    expect(popover.isOpen()).toBe(true);
    vi.advanceTimersByTime(1);

    expect(popover.isOpen()).toBe(false);
    expect(window.logWebpageActivity).toHaveBeenCalledWith('RouteBuilder_Hover=RouteMenu_Close');
  });

  test('moving from the route into the menu keeps it open, and leaving the menu closes it', () => {
    popover.open({ lng: 0, lat: 0 });

    popover.scheduleHoverClose();
    menu().dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(RoutePopover.HOVER_CLOSE_MS);
    expect(popover.isOpen()).toBe(true);

    menu().dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(RoutePopover.HOVER_CLOSE_MS);
    expect(popover.isOpen()).toBe(false);
  });

  test('coming back onto the route in time calls the close off', () => {
    popover.open({ lng: 0, lat: 0 });

    popover.scheduleHoverClose();
    popover.cancelHoverClose();
    vi.advanceTimersByTime(RoutePopover.HOVER_CLOSE_MS);

    expect(popover.isOpen()).toBe(true);
  });

  test('a click-opened menu stays open when the pointer leaves', () => {
    popover.open({ lng: 0, lat: 0 }, true);

    popover.scheduleHoverClose();
    menu().dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(RoutePopover.HOVER_CLOSE_MS);

    expect(popover.isOpen()).toBe(true);
  });

  test('clicking the route over a hover-opened menu makes it a click-opened one that stays', () => {
    popover.open({ lng: 0, lat: 0 });
    popover.open({ lng: 0, lat: 0 }, true);

    popover.scheduleHoverClose();
    vi.advanceTimersByTime(RoutePopover.HOVER_CLOSE_MS);

    expect(popover.isOpen()).toBe(true);
  });

  test.each([
    ['Reverse', '.route-popover-reverse', 'ReverseRoute_Popover', () => onReverse],
    ['Delete', '.route-popover-delete', 'DeleteRoute_Popover', () => onDelete],
  ])('%s closes the menu and acts on the route', (_name, selector, logged, action) => {
    popover.open({ lng: 0, lat: 0 }, true);

    document.querySelector(selector).click();

    expect(popover.isOpen()).toBe(false);
    expect(action()).toHaveBeenCalledTimes(1);
    expect(window.logWebpageActivity).toHaveBeenCalledWith(`RouteBuilder_Click=${logged}`);
  });

  test('a click-open puts focus on the first item, a hover-open leaves focus alone', () => {
    popover.open({ lng: 0, lat: 0 });
    expect(document.activeElement).toBe(document.body);

    popover.open({ lng: 0, lat: 0 }, true);
    expect(document.activeElement).toBe(document.querySelector('.route-popover-reverse'));
  });
});
