/**
 * localizeSubtree (frontend/js/common/i18nDom.js), which translates markup marked with `data-i18n*` attributes:
 * every page's static text once i18next loads, and the lightbox and map download panel as they are built. A missed
 * attribute leaves English on a translated page, and an aria-label or alt missed is English read aloud. (#5840)
 */

import { loadModules, mockModule } from './loader.js';

const i18next = { isInitialized: true, t: (key) => `[${key}]` };
mockModule('i18next', () => ({ default: i18next }));

const { localizeSubtree } = await loadModules('frontend/js/common/i18nDom.js');

afterEach(() => {
  i18next.isInitialized = true;
});

describe('localizeSubtree', () => {
  test('translates text and each attribute a key is given for', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <h2 data-i18n="common:title">Title</h2>
      <input data-i18n-placeholder="common:search" placeholder="Search">
      <button data-i18n-aria-label="common:close" data-i18n-tooltip="common:close-tooltip">&times;</button>
      <img data-i18n-alt="common:map" alt="Map">`;
    localizeSubtree(root);
    expect(root.querySelector('h2').textContent).toBe('[common:title]');
    expect(root.querySelector('input').getAttribute('placeholder')).toBe('[common:search]');
    expect(root.querySelector('button').getAttribute('aria-label')).toBe('[common:close]');
    expect(root.querySelector('button').getAttribute('data-ps-tooltip')).toBe('[common:close-tooltip]');
    // A key for one attribute leaves the element's text and other attributes alone.
    expect(root.querySelector('button').textContent).toBe('×');
    expect(root.querySelector('img').getAttribute('alt')).toBe('[common:map]');
  });

  test('translates the element it is handed, not only what is inside it', () => {
    const dialog = document.createElement('dialog');
    dialog.setAttribute('data-i18n-aria-label', 'common:image');
    localizeSubtree(dialog);
    expect(dialog.getAttribute('aria-label')).toBe('[common:image]');
  });

  test('leaves the English fallback in place until translations have loaded', () => {
    i18next.isInitialized = false;
    const root = document.createElement('div');
    root.innerHTML = '<span data-i18n="common:title">Title</span>';
    localizeSubtree(root);
    expect(root.textContent).toBe('Title');
  });
});
