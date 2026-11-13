/**
 * The Labeling Guide pages' script (frontend/js/common/labelingGuide.js): it lists the page's questions under the
 * current page in the sidebar so a reader can jump to one, folds the sidebar into a menu button on a phone, and lets
 * every example picture open full size. Markup cut down from labelingGuide/layout.scala.html and _question. (#5840)
 */

import { loadModules } from './loader.js';

/**
 * @param {string} id - The question's anchor.
 * @param {string} text - Its wording.
 * @returns {string} A question heading as _question.scala.html renders it, permalink and all.
 */
const question = (id, text) => `<h2 class="page-heading" id="${id}">${text}
  <a href="#${id}" class="permalink" title="Link to this section" aria-label="Link to this section">#</a></h2>`;

beforeEach(async () => {
  document.body.innerHTML = `
    <div class="page-container">
      <div class="page-sidebar">
        <nav class="page-nav" aria-label="How to">
          <div class="page-nav-header">How to</div>
          <a href="/labelingGuide" class="page-nav-item" aria-current="false">Introduction</a>
          <a href="/labelingGuide/curbRamps" class="page-nav-item is-active" aria-current="page">Curb Ramps</a>
          <a href="/labelingGuide/obstacles" class="page-nav-item" aria-current="false">Obstacles</a>
        </nav>
      </div>
      <main class="page-content">
        ${question('one-ramp', 'What if a corner has only one curb ramp?')}
        <figure><img src="/assets/images/curb_ramps/CornerOneRamp1.png" alt="A corner with one curb ramp">
          <figcaption>One ramp serves both crossings.</figcaption></figure>
        ${question('no-sidewalk', 'What if there is a curb ramp but no sidewalk?')}
      </main>
    </div>`;
  await loadModules('frontend/js/common/labelingGuide.js');
});

describe('the Labeling Guide', () => {
  test('lists the page\'s questions under the current page in the sidebar, in order', () => {
    const items = [...document.querySelectorAll('.page-nav a')].map((a) => [a.textContent, a.getAttribute('href')]);
    expect(items).toEqual([
      ['Introduction', '/labelingGuide'],
      ['Curb Ramps', '/labelingGuide/curbRamps'],
      ['What if a corner has only one curb ramp?', '#one-ramp'],
      ['What if there is a curb ramp but no sidewalk?', '#no-sidewalk'],
      ['Obstacles', '/labelingGuide/obstacles'],
    ]);
    expect(document.querySelector('a[href="#one-ramp"]').className).toBe('page-nav-subitem');
  });

  test('gives the sidebar a menu button named for the current page', () => {
    expect(document.querySelector('.page-sidebar-toggle').textContent.trim()).toBe('Curb Ramps');
  });

  test('lets an example picture open full size from the keyboard as well as the mouse', () => {
    const img = document.querySelector('figure img');
    expect(img.getAttribute('role')).toBe('button');
    expect(img.getAttribute('tabindex')).toBe('0');
  });
});
