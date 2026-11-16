/**
 * Tests for frontend/js/report/ReportPlacesToggle.js, the "Places" switch in a report map's corner (#5900). What's
 * pinned: it starts as told, reports only the reader's flips, and takes a state set from outside without echoing it.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { loadModules, mockModule } from './loader.js';

mockModule('i18next', () => ({ default: { t: (key) => key } }));

describe('ReportPlacesToggle', () => {
  let ReportPlacesToggle;
  let onChange;

  beforeEach(async () => {
    ({ ReportPlacesToggle } = await loadModules('frontend/js/report/ReportPlacesToggle.js'));
    onChange = vi.fn();
  });

  test('renders a labeled checkbox in the state it was given, in a MapLibre control', () => {
    const root = new ReportPlacesToggle({ checked: false, onChange }).onAdd();
    expect(root.className).toContain('maplibregl-ctrl');
    const input = root.querySelector('input[type="checkbox"]');
    expect(input.checked).toBe(false);
    expect(root.querySelector('label').textContent).toBe('accessscore:places');
    expect(new ReportPlacesToggle({ onChange }).onAdd().querySelector('input').checked).toBe(true);
    expect(new ReportPlacesToggle({ onChange }).getDefaultPosition()).toBe('top-left');
  });

  test('reports the reader\'s flips, and only those', () => {
    const toggle = new ReportPlacesToggle({ onChange });
    const root = toggle.onAdd();
    // On the page, as on a map: a detached checkbox doesn't fire change on click.
    document.body.append(root);
    const input = root.querySelector('input');
    input.click();
    expect(onChange).toHaveBeenCalledWith(false);
    input.click();
    expect(onChange).toHaveBeenCalledWith(true);
    toggle.setChecked(false);
    expect(input.checked).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  test('comes down with the map, and remembers a state set while it was down', () => {
    const toggle = new ReportPlacesToggle({ onChange });
    const root = toggle.onAdd();
    document.body.append(root);
    toggle.onRemove();
    expect(document.body.contains(root)).toBe(false);
    toggle.setChecked(false);
    expect(toggle.onAdd().querySelector('input').checked).toBe(false);
  });
});
