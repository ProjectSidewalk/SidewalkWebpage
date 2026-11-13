/**
 * Tests for frontend/js/report/ReportMapPoints.js, the one Tab stop a report map's points share (#5937). What's pinned:
 * an arrow goes to the nearest point that way on screen and not to one behind or far to the side, only one point is
 * ever tabbable and it follows focus, hidden points are skipped, Home and End reach the ends, and a handled key never
 * reaches MapLibre to pan the map.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { loadModules } from './loader.js';

let ReportMapPoints;
let nextInDirection;

beforeEach(async () => {
  ({ ReportMapPoints, nextInDirection } = await loadModules('frontend/js/report/ReportMapPoints.js'));
  document.body.innerHTML = '';
});

describe('nextInDirection', () => {
  const RIGHT = [1, 0];
  const DOWN = [0, 1];

  test('picks the nearest point ahead, never one behind', () => {
    const points = [{ x: -10, y: 0 }, { x: 30, y: 0 }, { x: 10, y: 0 }];
    expect(nextInDirection({ x: 0, y: 0 }, points, RIGHT)).toBe(2);
    expect(nextInDirection({ x: 0, y: 0 }, points, [-1, 0])).toBe(0);
  });

  test('prefers a point straight ahead to a nearer one far to the side', () => {
    // 10 ahead and 20 aside costs 50; 40 straight ahead costs 40.
    const points = [{ x: 10, y: 20 }, { x: 40, y: 0 }];
    expect(nextInDirection({ x: 0, y: 0 }, points, RIGHT)).toBe(1);
  });

  test('works on the vertical axis, where down is +y as on screen', () => {
    const points = [{ x: 0, y: -10 }, { x: 2, y: 15 }];
    expect(nextInDirection({ x: 0, y: 0 }, points, DOWN)).toBe(1);
    expect(nextInDirection({ x: 0, y: 0 }, points, [0, -1])).toBe(0);
  });

  test('gives -1 when nothing is ahead, including a point level with the start', () => {
    expect(nextInDirection({ x: 0, y: 0 }, [{ x: 0, y: 10 }, { x: -5, y: 0 }], RIGHT)).toBe(-1);
    expect(nextInDirection({ x: 0, y: 0 }, [], RIGHT)).toBe(-1);
  });
});

describe('ReportMapPoints', () => {
  /**
   * A button drawn at (x, y), since jsdom lays nothing out.
   * @param {number} x
   * @param {number} y
   * @returns {HTMLButtonElement}
   */
  function point(x, y) {
    const button = document.createElement('button');
    button.getBoundingClientRect = () => /** @type {DOMRect} */ ({ left: x, top: y, width: 0, height: 0 });
    document.body.append(button);
    return button;
  }

  /**
   * @param {HTMLElement} element
   * @param {string} key
   * @param {KeyboardEventInit} [modifiers]
   * @returns {KeyboardEvent}
   */
  function press(element, key, modifiers = {}) {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers });
    element.dispatchEvent(event);
    return event;
  }

  const tabbable = () => [...document.querySelectorAll('button')].filter((b) => b.tabIndex === 0);

  test('only the first visible point is tabbable, and the Tab stop follows focus', () => {
    const points = new ReportMapPoints();
    const [a, b, c] = [point(0, 0), point(10, 0), point(20, 0)];
    a.hidden = true;
    [a, b, c].forEach((p) => points.add(p));
    expect(tabbable()).toEqual([b]);
    c.focus();
    expect(tabbable()).toEqual([c]);
    expect(points.current).toBe(c);
  });

  test('an arrow moves focus to the nearest point that way, and skips hidden ones', () => {
    const points = new ReportMapPoints();
    const [a, b, c, d] = [point(0, 0), point(10, 0), point(20, 0), point(0, 30)];
    [a, b, c, d].forEach((p) => points.add(p));
    a.focus();
    press(a, 'ArrowRight');
    expect(document.activeElement).toBe(b);
    b.hidden = true;
    a.focus();
    press(a, 'ArrowRight');
    expect(document.activeElement).toBe(c);
    press(c, 'ArrowDown');
    expect(document.activeElement).toBe(d);
    expect(tabbable()).toEqual([d]);
  });

  test('Home and End reach the first and last visible points', () => {
    const points = new ReportMapPoints();
    const [a, b, c] = [point(50, 50), point(0, 0), point(90, 90)];
    c.hidden = true;
    [a, b, c].forEach((p) => points.add(p));
    b.focus();
    press(b, 'Home');
    expect(document.activeElement).toBe(a);
    press(a, 'End');
    expect(document.activeElement).toBe(b);
  });

  test('a handled key stops at the point, even with nowhere to go, so MapLibre never pans the map under it', () => {
    const points = new ReportMapPoints();
    const only = point(0, 0);
    points.add(only);
    const map = vi.fn();
    document.body.addEventListener('keydown', map);
    only.focus();
    const event = press(only, 'ArrowLeft');
    expect(event.defaultPrevented).toBe(true);
    expect(map).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(only);
    // Keys it doesn't handle, and modified arrows, are left alone.
    press(only, 'Enter');
    press(only, 'Tab');
    expect(press(only, 'ArrowLeft', { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(map).toHaveBeenCalledTimes(3);
  });

  test('refresh moves the Tab stop off a point that was hidden', () => {
    const points = new ReportMapPoints();
    const [a, b] = [point(0, 0), point(10, 0)];
    [a, b].forEach((p) => points.add(p));
    expect(tabbable()).toEqual([a]);
    a.hidden = true;
    points.refresh();
    expect(tabbable()).toEqual([b]);
    b.hidden = true;
    points.refresh();
    expect(tabbable()).toEqual([]);
    expect(points.current).toBe(null);
  });

  test('tells the host about each focus, and about the first key move only', () => {
    const onFocus = vi.fn();
    const onFirstMove = vi.fn();
    const points = new ReportMapPoints({ onFocus, onFirstMove });
    const [a, b] = [point(0, 0), point(10, 0)];
    [a, b].forEach((p) => points.add(p));
    a.focus();
    expect(onFocus).toHaveBeenLastCalledWith(a);
    press(a, 'ArrowRight');
    press(b, 'ArrowLeft');
    expect(onFocus).toHaveBeenLastCalledWith(a);
    expect(onFirstMove).toHaveBeenCalledTimes(1);
  });
});
