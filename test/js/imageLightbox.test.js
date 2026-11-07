/**
 * Tests for the labeling guide's full-size image viewer (frontend/js/common/ImageLightbox.js). The guide's figures
 * are small, so each opens large on a click or from the keyboard; what is worth pinning is that a keyboard user can
 * reach and open one at all, that the viewer shows the picture that was picked with its caption, and that it closes
 * from its button or the backdrop but not from a drag that starts on the picture (#5840).
 */

import { loadModules, mockModule } from './loader.js';
import { installDialogs, pointerAt } from './support/pageChromeHarness.js';
import { textOf } from './support/routeFetch.js';

mockModule('i18next', () => ({ default: { isInitialized: true, t: (key) => `t(${key})` } }));
installDialogs();

/** Two figures as labelingGuide/*.scala.html renders them, cut down. */
const GUIDE_PAGE = `
  <main class="page-content">
    <figure>
      <img id="cars" src="/assets/images/labeling_guide_misc/Occlusion.png" alt="Two cars blocking the sidewalk">
      <figcaption>
        Two cars blocking the view of the sidewalk
      </figcaption>
    </figure>
    <figure>
      <img id="truck" src="/assets/images/labeling_guide_misc/Occlusion2.png" alt="A truck blocking a curb ramp">
      <figcaption>This truck blocks the view of a possible curb ramp</figcaption>
    </figure>
  </main>
  <img id="logo" src="/assets/images/logo.png" alt="Project Sidewalk">`;

let ImageLightbox;

beforeEach(async () => {
  document.body.innerHTML = GUIDE_PAGE;
  ({ ImageLightbox } = await loadModules('frontend/js/common/ImageLightbox.js'));
  new ImageLightbox('.page-content figure img');
});

const lightbox = () => document.querySelector('dialog.ps-lightbox');
const image = (id) => document.getElementById(id);
/**
 * Presses a key on a figure, as a keyboard user who has tabbed to it would.
 * @param {string} id - The figure's image id.
 * @param {string} key - The key pressed.
 * @returns {KeyboardEvent} The event, to read whether it was consumed.
 */
const press = (id, key) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  image(id).dispatchEvent(event);
  return event;
};

describe('ImageLightbox', () => {
  it('lets a keyboard user reach each guide figure as a button that opens a dialog', () => {
    for (const id of ['cars', 'truck']) {
      expect(image(id).getAttribute('role')).toBe('button');
      expect(image(id).getAttribute('tabindex')).toBe('0');
      expect(image(id).getAttribute('aria-haspopup')).toBe('dialog');
    }
    // Only the images the page asked for.
    expect(image('logo').hasAttribute('role')).toBe(false);
  });

  it('builds nothing until a figure is opened', () => {
    expect(lightbox()).toBeNull();
  });

  it('opens the clicked figure large, named and captioned as the figure is', () => {
    image('cars').click();

    expect(lightbox().open).toBe(true);
    const big = lightbox().querySelector('.ps-lightbox__img');
    expect(big.src).toBe(image('cars').src);
    expect(big.alt).toBe('Two cars blocking the sidewalk');
    expect(lightbox().getAttribute('aria-label')).toBe('Two cars blocking the sidewalk');
    expect(lightbox().querySelector('.ps-lightbox__caption').textContent)
      .toBe('Two cars blocking the view of the sidewalk');
  });

  it('labels its close button in the page\'s language', () => {
    image('cars').click();

    expect(lightbox().querySelector('.ps-lightbox__close').getAttribute('aria-label')).toBe('t(common:close)');
  });

  it('reuses one viewer for every figure, showing whichever was opened last', () => {
    image('cars').click();
    lightbox().close();
    image('truck').click();

    expect(document.querySelectorAll('dialog.ps-lightbox')).toHaveLength(1);
    expect(textOf(lightbox().querySelector('.ps-lightbox__caption')))
      .toBe('This truck blocks the view of a possible curb ramp');
  });

  it.each(['Enter', ' '])('opens from the keyboard on %j, without the key also scrolling the page', (key) => {
    const event = press('truck', key);

    expect(lightbox().open).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves other keys alone', () => {
    const event = press('truck', 'Tab');

    expect(lightbox()).toBeNull();
    expect(event.defaultPrevented).toBe(false);
  });

  it('closes from its close button', () => {
    image('cars').click();

    lightbox().querySelector('.ps-lightbox__close').click();

    expect(lightbox().open).toBe(false);
  });

  it('closes on a press on the backdrop', () => {
    image('cars').click();

    pointerAt(lightbox(), 'pointerdown');

    expect(lightbox().open).toBe(false);
  });

  it('stays open for a press on the picture, so a drag that ends outside it does not close it', () => {
    image('cars').click();

    pointerAt(lightbox().querySelector('.ps-lightbox__img'), 'pointerdown');

    expect(lightbox().open).toBe(true);
  });
});
