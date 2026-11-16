/**
 * Tests for frontend/js/report/ReportMapToggle.js beyond what the "Places" suite pins: the caveat a switch can carry
 * (#5888), which a screen reader hears whether or not it shows and a sighted reader sees only while the switch is on.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { loadModules } from './loader.js';

describe('ReportMapToggle', () => {
  let ReportMapToggle;
  let onChange;

  beforeEach(async () => {
    ({ ReportMapToggle } = await loadModules('frontend/js/report/ReportMapToggle.js'));
    onChange = vi.fn();
  });

  test('wears the text it is given and no note unless given one', () => {
    const root = new ReportMapToggle({ text: 'Aligned', onChange }).onAdd();
    expect(root.querySelector('label').textContent).toBe('Aligned');
    expect(root.querySelector('.report-map-toggle__note')).toBeNull();
    expect(root.querySelector('input').hasAttribute('aria-describedby')).toBe(false);
  });

  test('shows its note only while on, and describes the switch by it throughout', () => {
    const toggle = new ReportMapToggle({ text: 'Aligned', note: 'Roughly where', checked: false, onChange });
    const root = toggle.onAdd();
    document.body.append(root);
    const input = root.querySelector('input');
    const note = root.querySelector('.report-map-toggle__note');
    expect(note.textContent).toBe('Roughly where');
    expect(note.hidden).toBe(true);
    expect(input.getAttribute('aria-describedby')).toBe(note.id);
    input.click();
    expect(note.hidden).toBe(false);
    expect(onChange).toHaveBeenCalledWith(true);
    toggle.setChecked(false);
    expect(note.hidden).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test('gives each note its own id, so two switches on one page describe their own inputs', () => {
    const a = new ReportMapToggle({ text: 'A', note: 'a', onChange }).onAdd();
    const b = new ReportMapToggle({ text: 'B', note: 'b', onChange }).onAdd();
    expect(a.querySelector('.report-map-toggle__note').id).not.toBe(b.querySelector('.report-map-toggle__note').id);
  });
});
