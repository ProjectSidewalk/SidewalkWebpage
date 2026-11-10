/**
 * Tests for util.isAdmin, which picks where a label link goes (admin view or public page) from the navbar's
 * data-viewer-admin. Anything but a navbar saying "true" reads as not an admin, the safe side for a link.
 */

import { loadModules } from './loader.js';

const { util } = await loadModules('frontend/js/common/utilities.js');

afterEach(() => {
  document.body.innerHTML = '';
});

/** Renders a navbar the way navbar.scala.html does, with data-viewer-admin set when `value` is given. */
const renderNavbar = (value) => {
  const attr = value === undefined ? '' : ` data-viewer-admin="${value}"`;
  document.body.innerHTML = `<nav id="header" aria-label="Main"${attr}></nav>`;
};

describe('util.isAdmin', () => {
  test('reports true when the navbar says the viewer is an admin', () => {
    renderNavbar('true');
    expect(util.isAdmin()).toBe(true);
  });

  test.each([['false'], ['True'], ['']])('reports false for data-viewer-admin="%s"', (value) => {
    renderNavbar(value);
    expect(util.isAdmin()).toBe(false);
  });

  test('reports false when the navbar carries no admin attribute', () => {
    renderNavbar(undefined);
    expect(util.isAdmin()).toBe(false);
  });

  test('reports false when the page has no navbar', () => {
    expect(util.isAdmin()).toBe(false);
  });
});
