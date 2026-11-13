/**
 * Tests for ProgressBar (frontend/js/common/ProgressBar.js), the shared bar behind the mission, badge and validation
 * progress bars: how far the fill reaches, and a label that never claims 100% before the bar is full (#5840).
 */

import { loadModules } from './loader.js';

const { ProgressBar } = await loadModules('frontend/js/common/ProgressBar.js');

/**
 * Builds the progressBar Twirl partial's markup, cut down to the fill and the label beside it.
 * @returns {{fill: HTMLElement, label: HTMLElement}} The two elements a bar drives.
 */
function buildBar() {
  document.body.innerHTML = `
    <div class="ps-progress-bar"><div id="bar-fill" class="ps-progress-bar__fill"></div></div>
    <span id="bar-label"></span>`;
  return { fill: document.getElementById('bar-fill'), label: document.getElementById('bar-label') };
}

describe('ProgressBar', () => {
  test('finds its elements by id, as Explore and Validate name them, and sizes the fill with a percentage', () => {
    const { fill, label } = buildBar();
    new ProgressBar('bar-fill', 'bar-label').update(0.426);

    expect(fill.style.width).toBe('43%');
    expect(label.textContent).toBe('43%');
  });

  test('takes the elements themselves, as the badge tracks pass them', () => {
    const { fill, label } = buildBar();
    const bar = new ProgressBar(fill, label);
    bar.setLabel('12 / 100');

    expect(label.textContent).toBe('12 / 100');
  });

  test('clamps the fill to the track', () => {
    const { fill } = buildBar();
    const bar = new ProgressBar(fill);
    bar.setFraction(1.4);
    expect(fill.style.width).toBe('100%');
    bar.setFraction(-0.2);
    expect(fill.style.width).toBe('0%');
  });

  test('a bar with no label just fills, ignoring any text it is given', () => {
    const { fill, label } = buildBar();
    const bar = new ProgressBar(fill);
    bar.update(0.5);

    expect(fill.style.width).toBe('50%');
    expect(label.textContent).toBe('');
  });

  test('the percentage never reads 100 until the bar is full, and never more than 100', () => {
    expect(ProgressBar.formatPercent(0.996)).toBe('99');
    expect(ProgressBar.formatPercent(0.995)).toBe('99');
    expect(ProgressBar.formatPercent(0.994)).toBe('99');
    expect(ProgressBar.formatPercent(1)).toBe('100');
    expect(ProgressBar.formatPercent(1.3)).toBe('100');
    expect(ProgressBar.formatPercent(0)).toBe('0');
  });
});
