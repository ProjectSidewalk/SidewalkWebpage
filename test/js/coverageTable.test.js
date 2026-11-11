/** Tests for the Coverage page's searchable, sortable region table (#5840). */

import { loadModules, mockModule, useUtil } from './loader.js';
import { metricDistanceUtil } from './fakes.js';
import { textOf } from './support/routeFetch.js';

useUtil(metricDistanceUtil);

// CoverageMap.js is imported for its formatter only; the real mapbox-gl can't load under jsdom.
mockModule('frontend/js/common/mapboxgl.js', () => ({ default: {} }));
const { CoverageTable } = await loadModules('frontend/js/admin-dashboard/CoverageTable.js');

const ROWS = [
  { region_id: 1, name: 'Downtown', completion_rate: 0.8, audited_distance_m: 800, total_distance_m: 1000,
    label_count: 1200, user_count: 9 },
  { region_id: 2, name: 'Ballard', completion_rate: 0.1, audited_distance_m: 300, total_distance_m: 3000,
    label_count: null, user_count: null },
  { region_id: 3, name: 'Capitol Hill <East>', completion_rate: 0.45, audited_distance_m: 900, total_distance_m: 2000,
    label_count: 40, user_count: 2 },
];

/** @returns {{table: CoverageTable, events: string[]}} A rendered table whose callbacks log into `events`. */
function render({ withSearch = true } = {}) {
  document.body.innerHTML = `${withSearch ? '<input type="search" id="coverage-table-search">' : ''}
    <table id="coverage-table"></table>`;
  const events = [];
  const table = new CoverageTable('coverage-table', 'coverage-table-search', {
    onRowClick: (id) => events.push(`click ${id}`),
    onRowHover: (id) => events.push(`hover ${id}`),
    onRowHoverEnd: () => events.push('hover end'),
  });
  table.render(ROWS.map((r) => ({ ...r })));
  return { table, events };
}

const names = () => [...document.querySelectorAll('#coverage-table tbody tr')].map((tr) => tr.cells[0].textContent);
const headers = () => [...document.querySelectorAll('#coverage-table th')].map(textOf);
const header = (key) => document.querySelector(`#coverage-table th[data-key="${key}"]`);
const row = (id) => document.querySelector(`#coverage-table tr[data-region-id="${id}"]`);

describe('CoverageTable', () => {
  test('lists every region least-covered first, with formatted cells', () => {
    render();
    expect(headers()).toEqual(['Region', 'Coverage ▲', 'Audited', 'Total', 'Labels', 'Contributors']);
    expect(names()).toEqual(['Ballard', 'Capitol Hill <East>', 'Downtown']);
    expect([...row(1).cells].map(textOf)).toEqual(['Downtown', '80%', '0.8 km', '1.0 km', '1,200', '9']);
    expect([...row(2).cells].slice(4).map(textOf)).toEqual(['0', '0']);
  });

  test('sorts again after a sort, and a key press keeps focus on its header', () => {
    render();
    header('name').click();
    header('name').click();
    expect(names()).toEqual(['Downtown', 'Capitol Hill <East>', 'Ballard']);
    header('completion_rate').focus();
    header('completion_rate').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(names()).toEqual(['Ballard', 'Capitol Hill <East>', 'Downtown']);
    expect(document.activeElement).toBe(header('completion_rate'));
  });

  test('clicking the sorted column flips it to most-covered first', () => {
    render();
    header('completion_rate').click();
    expect(names()).toEqual(['Downtown', 'Capitol Hill <East>', 'Ballard']);
    expect(textOf(header('completion_rate'))).toBe('Coverage ▼');
  });

  test('clicking another column sorts by it ascending, names A to Z', () => {
    render();
    header('name').click();
    expect(names()).toEqual(['Ballard', 'Capitol Hill <East>', 'Downtown']);
    expect(headers()).toEqual(['Region ▲', 'Coverage', 'Audited', 'Total', 'Labels', 'Contributors']);
  });

  test('a missing count sorts as zero', () => {
    render();
    header('label_count').click();
    expect(names()).toEqual(['Ballard', 'Capitol Hill <East>', 'Downtown']);
  });

  test('Enter or Space on a header sorts it; other keys do not', () => {
    render();
    header('total_distance_m').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(names()[0]).toBe('Ballard');
    header('total_distance_m').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(names()).toEqual(['Downtown', 'Capitol Hill <East>', 'Ballard']);

    render();
    header('user_count').dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(names()).toEqual(['Ballard', 'Capitol Hill <East>', 'Downtown']);
  });

  test('a click or key in the header row but off any column changes nothing', () => {
    render();
    const tr = document.querySelector('#coverage-table thead tr');
    tr.click();
    tr.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(headers()[1]).toBe('Coverage ▲');
  });

  test('the search box filters by name, ignoring case', () => {
    render();
    const search = document.getElementById('coverage-table-search');
    search.value = 'CAPITOL';
    search.dispatchEvent(new Event('input'));
    expect(names()).toEqual(['Capitol Hill <East>']);
    search.value = '';
    search.dispatchEvent(new Event('input'));
    expect(names()).toHaveLength(3);
  });

  test('renders without a search box', () => {
    render({ withSearch: false });
    expect(names()).toHaveLength(3);
  });

  test('hovering rows reports each region once, and leaving the table ends the hover', () => {
    const { events } = render();
    const tbody = document.querySelector('#coverage-table tbody');
    row(1).cells[0].dispatchEvent(new Event('pointerover', { bubbles: true }));
    row(1).cells[2].dispatchEvent(new Event('pointerover', { bubbles: true }));
    row(2).cells[0].dispatchEvent(new Event('pointerover', { bubbles: true }));
    tbody.dispatchEvent(new Event('pointerleave'));
    tbody.dispatchEvent(new Event('pointerleave'));
    expect(events).toEqual(['hover 1', 'hover 2', 'hover end']);
  });

  test('a pointer over the table body between rows ends the hover', () => {
    const { events } = render();
    const tbody = document.querySelector('#coverage-table tbody');
    row(3).cells[0].dispatchEvent(new Event('pointerover', { bubbles: true }));
    tbody.dispatchEvent(new Event('pointerover', { bubbles: true }));
    expect(events).toEqual(['hover 3', 'hover end']);
  });

  test('clicking a row pins its region; a click off the rows does nothing', () => {
    const { events } = render();
    row(3).cells[1].click();
    document.querySelector('#coverage-table tbody').click();
    expect(events).toEqual(['click 3']);
  });

  test('highlights exactly the given regions and can clear them', () => {
    const { table } = render();
    table.highlightRows([1, '3']);
    expect([...document.querySelectorAll('tr.is-highlighted')].map((tr) => tr.dataset.regionId)).toEqual(['3', '1']);
    table.highlightRows([2]);
    expect([...document.querySelectorAll('tr.is-highlighted')].map((tr) => tr.dataset.regionId)).toEqual(['2']);
    table.clearHighlight();
    expect(document.querySelectorAll('tr.is-highlighted')).toHaveLength(0);
  });

  test('keeps the highlight when a sort or search redraws the rows', () => {
    const { table } = render();
    table.highlightRows([1]);
    header('name').click();
    const search = document.getElementById('coverage-table-search');
    search.value = 'town';
    search.dispatchEvent(new Event('input'));
    expect([...document.querySelectorAll('tr.is-highlighted')].map((tr) => tr.dataset.regionId)).toEqual(['1']);
  });
});
