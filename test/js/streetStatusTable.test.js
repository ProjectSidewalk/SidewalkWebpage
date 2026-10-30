/** Tests for the Street Status page's per-region table: its counts, stacked bars, sorting and search (#5840). */

import { loadModules, mockModule } from './loader.js';
import { textOf } from './support/routeFetch.js';

// StreetStatusMap.js is imported for its palette only; the real mapbox-gl can't load under jsdom.
mockModule('frontend/js/common/mapboxgl.js', () => ({ default: {} }));
const { StreetStatusTable } = await loadModules('frontend/js/admin-dashboard/StreetStatusTable.js');

const ROWS = [
  { region_id: 10, name: 'Downtown', open: 1, no_imagery: 2, closed: 0, disabled: 1, total: 4 },
  { region_id: 20, name: 'Ballard <West>', open: 1200, no_imagery: 0, closed: 0, disabled: 0, total: 1200 },
  { region_id: 30, name: 'Fremont', open: 0, no_imagery: 5, closed: 3, disabled: 0, total: 8 },
];

/** @returns {{table: StreetStatusTable, events: string[]}} A rendered table whose callbacks log into `events`. */
function render({ withSearch = true } = {}) {
  document.body.innerHTML = `${withSearch ? '<input type="search" id="street-status-table-search">' : ''}
    <table id="street-status-table"></table>`;
  const events = [];
  const table = new StreetStatusTable('street-status-table', 'street-status-table-search', {
    onRowClick: (id) => events.push(`click ${id}`),
    onRowHover: (id) => events.push(`hover ${id}`),
    onRowHoverEnd: () => events.push('hover end'),
  });
  table.render(ROWS.map((r) => ({ ...r })));
  return { table, events };
}

const names = () => [...document.querySelectorAll('#street-status-table tbody tr')].map((tr) => textOf(tr.cells[0]));
const headers = () => [...document.querySelectorAll('#street-status-table th')].map(textOf);
const header = (key) => document.querySelector(`#street-status-table th[data-key="${key}"]`);
const row = (id) => document.querySelector(`#street-status-table tr[data-region-id="${id}"]`);
const bar = (id) => [...row(id).querySelectorAll('.street-status-bar span')]
  .map((s) => [s.dataset.psTooltip, s.style.width]);

describe('StreetStatusTable', () => {
  test('lists regions most-missing-imagery first, with each status count and a total', () => {
    render();
    expect(headers()).toEqual(['Region', 'Open', 'No imagery ▼', 'Closed', 'Disabled', 'Total', 'Distribution']);
    expect(names()).toEqual(['Fremont', 'Downtown', 'Ballard <West>']);
    expect([...row(20).cells].slice(0, 6).map(textOf)).toEqual(['Ballard <West>', '1,200', '0', '0', '0', '1,200']);
  });

  test('the stacked bar sizes each present status by its share and leaves out the absent ones', () => {
    render();
    expect(bar(10)).toEqual([['Open: 1', '25%'], ['No imagery: 2', '50%'], ['Disabled: 1', '25%']]);
    expect(bar(30)).toEqual([['No imagery: 5', '62.5%'], ['Closed: 3', '37.5%']]);
  });

  test('sorts again after a sort, and a key press keeps focus on its header', () => {
    render();
    header('name').click();
    header('name').click();
    expect(names()).toEqual(['Fremont', 'Downtown', 'Ballard <West>']);
    header('total').focus();
    header('total').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(names()).toEqual(['Ballard <West>', 'Fremont', 'Downtown']);
    expect(document.activeElement).toBe(header('total'));
  });

  test('clicking the sorted column flips it to fewest-missing first', () => {
    render();
    header('no_imagery').click();
    expect(names()).toEqual(['Ballard <West>', 'Downtown', 'Fremont']);
    expect(textOf(header('no_imagery'))).toBe('No imagery ▲');
  });

  test('a new count column starts with the largest first', () => {
    render();
    header('total').click();
    expect(names()).toEqual(['Ballard <West>', 'Fremont', 'Downtown']);
    expect(textOf(header('total'))).toBe('Total ▼');
  });

  test('the region column starts A to Z', () => {
    render();
    header('name').click();
    expect(names()).toEqual(['Ballard <West>', 'Downtown', 'Fremont']);
    expect(textOf(header('name'))).toBe('Region ▲');
  });

  test('Enter or Space on a header sorts it; other keys and the bar column do not', () => {
    render();
    header('closed').dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    const distribution = document.querySelector('#street-status-table th:not([data-key])');
    distribution.click();
    distribution.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(names()[0]).toBe('Fremont');
    header('closed').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(names()[0]).toBe('Fremont');
    expect(textOf(header('closed'))).toBe('Closed ▼');

    render();
    header('open').dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(names()[0]).toBe('Ballard <West>');
  });

  test('the search box filters by name, ignoring case', () => {
    render();
    const search = document.getElementById('street-status-table-search');
    search.value = 'FREM';
    search.dispatchEvent(new Event('input'));
    expect(names()).toEqual(['Fremont']);
  });

  test('renders without a search box', () => {
    render({ withSearch: false });
    expect(names()).toHaveLength(3);
  });

  test('hovering rows reports each region once, and leaving or moving between rows ends the hover', () => {
    const { events } = render();
    const tbody = document.querySelector('#street-status-table tbody');
    row(10).cells[0].dispatchEvent(new Event('pointerover', { bubbles: true }));
    row(10).cells[3].dispatchEvent(new Event('pointerover', { bubbles: true }));
    tbody.dispatchEvent(new Event('pointerover', { bubbles: true }));
    row(30).cells[0].dispatchEvent(new Event('pointerover', { bubbles: true }));
    tbody.dispatchEvent(new Event('pointerleave'));
    tbody.dispatchEvent(new Event('pointerleave'));
    expect(events).toEqual(['hover 10', 'hover end', 'hover 30', 'hover end']);
  });

  test('clicking a row pins its region; a click off the rows does nothing', () => {
    const { events } = render();
    row(20).cells[2].click();
    document.querySelector('#street-status-table tbody').click();
    expect(events).toEqual(['click 20']);
  });

  test('highlights exactly the given regions and can clear them', () => {
    const { table } = render();
    table.highlightRows(['10', 30]);
    const highlighted = () => [...document.querySelectorAll('tr.is-highlighted')].map((tr) => tr.dataset.regionId);
    expect(highlighted()).toEqual(['30', '10']);
    table.highlightRows([20]);
    expect(highlighted()).toEqual(['20']);
    table.clearHighlight();
    expect(highlighted()).toEqual([]);
  });

  test('keeps the highlight when a sort or search redraws the rows', () => {
    const { table } = render();
    table.highlightRows([10]);
    header('name').click();
    const search = document.getElementById('street-status-table-search');
    search.value = 'town';
    search.dispatchEvent(new Event('input'));
    expect([...document.querySelectorAll('tr.is-highlighted')].map((tr) => tr.dataset.regionId)).toEqual(['10']);
  });
});
