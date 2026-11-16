/**
 * Tests Gallery's severity/quality row (gallery/displays/SeverityDisplay.js), the three circles on every card and
 * the expanded view (#5840). It reads the label type's rating scale from the stamped label-type table, so it pins that
 * a positive type reads as "quality" with good/okay/bad words, a negative one as "severity" with low/medium/high, and
 * that an unrated label grays the row out and says so to both sighted and screen-reader users.
 */

import { loadModules, mockModule } from './loader.js';

mockModule('i18next', () => ({ default: { t: (key) => key } }));

/**
 * Draws a severity row into a fresh container.
 * @param {?number|undefined} severity - The label's rating, as the server sends it.
 * @param {string} labelType - The label's type.
 * @returns {Promise<HTMLElement>} The container the row was drawn into.
 */
async function render(severity, labelType) {
  document.body.innerHTML = '<div class="card-severity"></div>';
  const container = document.querySelector('.card-severity');
  const { SeverityDisplay } = await loadModules('frontend/js/gallery/displays/SeverityDisplay.js');
  new SeverityDisplay(container, severity, labelType);
  return container;
}

/** @returns {boolean[]} Which of the three circles are filled in, left to right. */
const filled = (container) => [...container.querySelectorAll('.severity-circle')]
  .map((circle) => circle.classList.contains('current-severity'));

describe('Gallery SeverityDisplay', () => {
  test('a rated obstacle fills circles up to its severity and speaks the level as words', async () => {
    const container = await render(2, 'Obstacle');
    const header = container.querySelector('.label-severity-header');
    const holder = container.querySelector('.label-severity-content');

    expect(header.innerText).toBe('severity');
    expect(header.classList.contains('no-severity-header')).toBe(false);
    expect(header.getAttribute('aria-hidden')).toBe('true');
    expect(filled(container)).toEqual([true, true, false]);
    expect(container.querySelector('.no-severity-circle')).toBeNull();
    expect(holder.getAttribute('role')).toBe('img');
    expect(holder.getAttribute('aria-label')).toBe('severity: common:medium');
    expect(holder.hasAttribute('data-ps-tooltip')).toBe(false);
  });

  test('a curb ramp is rated on the quality scale, so its words are good/okay/bad', async () => {
    const container = await render(3, 'CurbRamp');

    expect(container.querySelector('.label-severity-header').innerText).toBe('quality');
    expect(filled(container)).toEqual([true, true, true]);
    expect(container.querySelector('.label-severity-content').getAttribute('aria-label')).toBe('quality: common:bad');
  });

  test.each([
    ['null', null],
    ['missing', undefined],
  ])('a %s severity grays the row out and says no rating was given', async (_name, severity) => {
    const container = await render(severity, 'SurfaceProblem');
    const header = container.querySelector('.label-severity-header');
    const holder = container.querySelector('.label-severity-content');

    expect(header.classList.contains('no-severity-header')).toBe(true);
    expect(header.hasAttribute('aria-hidden')).toBe(false);
    expect(container.querySelectorAll('.no-severity-circle')).toHaveLength(3);
    expect(filled(container)).toEqual([false, false, false]);
    expect(holder.getAttribute('data-ps-tooltip')).toBe('no-severity');
    expect(holder.getAttribute('aria-label')).toBe('no-severity');
  });

  test('an unrated curb ramp says "no quality" rather than "no severity"', async () => {
    const container = await render(null, 'CurbRamp');

    expect(container.querySelector('.label-severity-content').getAttribute('aria-label')).toBe('no-quality');
  });

  test('a 0 rating from the server fills no circles and reads as "no rating" to screen readers', async () => {
    const container = await render(0, 'Obstacle');

    expect(filled(container)).toEqual([false, false, false]);
    expect(container.querySelector('.no-severity-circle')).toBeNull();
    expect(container.querySelector('.label-severity-content').getAttribute('aria-label')).toBe('no-severity');
    expect(container.querySelector('.label-severity-header').hasAttribute('aria-hidden')).toBe(false);
  });
});
