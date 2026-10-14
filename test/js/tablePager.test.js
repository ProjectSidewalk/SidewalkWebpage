/**
 * Tests for frontend/js/common/TablePager.js, which pages a server-rendered table by hiding rows (#5762).
 */

import { loadModules } from './loader.js';

const { TablePager } = await loadModules('frontend/js/common/TablePager.js');

/**
 * Builds a 23-row table at 10 rows a page, opening on `page`, with buttons in the state the markup claims.
 * @param {number} page - The 0-based page the server opened on.
 * @param {{prevDisabled?: boolean, nextDisabled?: boolean}} [markup] - Disabled flags as rendered.
 * @returns {{tbody: HTMLTableSectionElement, nav: HTMLElement, prev: HTMLButtonElement, next: HTMLButtonElement}}
 */
function buildTable(page, markup = {}) {
  const rows = Array.from({ length: 23 }, (_, i) => `<tr><td>${i + 1}</td></tr>`).join('');
  document.body.innerHTML = `
        <table><tbody id="board" data-page-size="10" data-page="${page}">${rows}</tbody></table>
        <nav id="pager">
          <button type="button" data-step="-1" ${markup.prevDisabled ? 'disabled' : ''}>Prev</button>
          <span>Page <span class="ps-pager-page">${page + 1}</span> of 3</span>
          <button type="button" data-step="1" ${markup.nextDisabled ? 'disabled' : ''}>Next</button>
        </nav>`;
  return {
    tbody: /** @type {HTMLTableSectionElement} */ (document.getElementById('board')),
    nav: document.getElementById('pager'),
    prev: document.querySelector('[data-step="-1"]'),
    next: document.querySelector('[data-step="1"]'),
  };
}

/** @returns {string[]} The first cell of every visible row. */
function visibleRanks() {
  return [...document.querySelectorAll('#board tr')].filter((r) => !r.hidden).map((r) => r.cells[0].textContent);
}

describe('TablePager', () => {
  test('opens on the server page and corrects button states the markup got wrong', () => {
    const { tbody, nav, prev, next } = buildTable(1, { prevDisabled: true, nextDisabled: true });
    new TablePager(tbody, nav);
    expect(visibleRanks()).toEqual(['11', '12', '13', '14', '15', '16', '17', '18', '19', '20']);
    expect(prev.disabled).toBe(false);
    expect(next.disabled).toBe(false);
  });

  test('pages forward to a short last page, then disables Next and reports each page', () => {
    const { tbody, nav, next } = buildTable(0);
    const pages = [];
    new TablePager(tbody, nav, (p) => pages.push(p));
    next.click();
    next.click();
    expect(visibleRanks()).toEqual(['21', '22', '23']);
    expect(nav.querySelector('.ps-pager-page').textContent).toBe('3');
    expect(next.disabled).toBe(true);
    expect(pages).toEqual([2, 3]);
  });

  test('moves keyboard focus to Previous when Next runs out', () => {
    const { tbody, nav, prev, next } = buildTable(1);
    new TablePager(tbody, nav);
    next.focus();
    next.click();
    expect(document.activeElement).toBe(prev);
  });
});
