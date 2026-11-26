/**
 * Tests for frontend/js/report/CityReportTable.js (#6041): the city reports page's table, which the server renders in
 * its default order and this module re-sorts, filters and keeps in step with the map through the shared state.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { loadModules } from './loader.js';

/** What the page's `#reports-data` carries for each row, in the server's order: scored lowest first, then the rest. */
const ROWS = [
  { id: 11, name: 'Delridge', scored: true, score: 0.41, completion: 0.82, reviewed: 41, latest: '2026-08-01',
    imagery: 2021, labelers: 18, density: 36 },
  { id: 12, name: 'Ballard', scored: true, score: 0.77, completion: 0.91, reviewed: 74, latest: '2026-11-02',
    imagery: 2024, labelers: 41, density: 63 },
  { id: 13, name: 'Columbia City', scored: false, score: null, completion: 0.61, reviewed: 44, latest: '2026-05-10',
    imagery: 2022, labelers: 14, density: 33 },
  { id: 14, name: 'Bitter Lake', scored: false, score: null, completion: 0.12, reviewed: null, latest: null,
    imagery: null, labelers: 0, density: null },
];

const COLUMNS = ['name', 'score', 'why', 'explored', 'reviewed', 'latest', 'imagery', 'labelers', 'density', 'links'];
const SORTABLE = new Set(['name', 'score', 'explored', 'reviewed', 'latest', 'imagery', 'labelers', 'density']);

/** The table as app/views/apps/report/cityTable.scala.html renders it, cut down to what the module reads. */
function renderTable() {
  const head = COLUMNS.map((c) => (SORTABLE.has(c)
    ? `<th scope="col" data-column="${c}"><button type="button" data-sort="${c}">${c}</button></th>`
    : `<th scope="col" data-column="${c}">${c}</th>`)).join('');
  const body = ROWS.map((r) => `
    <tr data-region-id="${r.id}">
      <th scope="row" data-column="name">
        <button type="button" class="reports-table__select" aria-pressed="false">${r.name}</button>
      </th>
      ${COLUMNS.slice(1).map((c) => `<td data-column="${c}"></td>`).join('')}
    </tr>`).join('');
  document.body.innerHTML = `<table id="reports-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

/** @returns {number[]} The ids of the rows shown, top to bottom. */
const shownIds = () => [...document.querySelectorAll('#reports-table tbody tr')]
  .filter((tr) => !tr.hidden)
  .map((tr) => Number(tr.dataset.regionId));

const rowOf = (id) => document.querySelector(`tr[data-region-id="${id}"]`);
const sortButton = (column) => document.querySelector(`button[data-sort="${column}"]`);

describe('CityReportTable', () => {
  let CityReportState;
  let CityReportTable;
  let state;

  beforeEach(async () => {
    ({ CityReportState, CityReportTable } = await loadModules(
      'frontend/js/report/CityReportState.js', 'frontend/js/report/CityReportTable.js'));
    renderTable();
    state = new CityReportState(ROWS, { selected: 11 });
    new CityReportTable(document.getElementById('reports-table'), ROWS, state);
  });

  test('keeps the server\'s order until a header is clicked, and marks the starting selection', () => {
    expect(shownIds()).toEqual([11, 12, 13, 14]);
    expect(rowOf(11).classList.contains('is-selected')).toBe(true);
    expect(rowOf(11).querySelector('button').getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('th[aria-sort]')).toBeNull();
  });

  test('keeps unscored rows last under the Score sort, in either direction', () => {
    sortButton('score').click();
    expect(shownIds()).toEqual([11, 12, 13, 14]);
    expect(document.querySelector('th[data-column="score"]').getAttribute('aria-sort')).toBe('ascending');
    sortButton('score').click();
    expect(shownIds()).toEqual([12, 11, 13, 14]);
    expect(document.querySelector('th[data-column="score"]').getAttribute('aria-sort')).toBe('descending');
  });

  test('puts missing values last on any other column, whichever way it sorts', () => {
    sortButton('reviewed').click();
    expect(shownIds()).toEqual([11, 13, 12, 14]);
    sortButton('reviewed').click();
    expect(shownIds()).toEqual([12, 13, 11, 14]);
    sortButton('latest').click();
    expect(shownIds()).toEqual([13, 11, 12, 14]);
    sortButton('name').click();
    expect(shownIds()).toEqual([12, 14, 13, 11]);
    // Only the column sorted on says so.
    expect([...document.querySelectorAll('th[aria-sort]')].map((th) => th.dataset.column)).toEqual(['name']);
  });

  test('hides the rows the filter leaves out, the same ones the state names as faded', () => {
    state.setFilter('scored');
    expect(shownIds()).toEqual([11, 12]);
    const hidden = [...document.querySelectorAll('#reports-table tbody tr')].filter((tr) => tr.hidden)
      .map((tr) => Number(tr.dataset.regionId));
    expect(hidden).toEqual(state.fadedIds());
    state.setFilter('unscored');
    expect(shownIds()).toEqual([13, 14]);
  });

  test('selects from a row\'s name, and follows a selection made on the map', () => {
    const heard = vi.fn();
    state.subscribe(heard);
    rowOf(13).querySelector('button').click();
    expect(state.selected).toBe(13);
    expect(heard).toHaveBeenLastCalledWith(state, { type: 'select', from: 'Table' });
    expect(rowOf(13).classList.contains('is-selected')).toBe(true);
    expect(rowOf(11).classList.contains('is-selected')).toBe(false);
    expect(rowOf(11).querySelector('button').getAttribute('aria-pressed')).toBe('false');

    state.select(12, 'Map');
    expect(rowOf(12).classList.contains('is-selected')).toBe(true);
    expect(rowOf(12).querySelector('button').getAttribute('aria-pressed')).toBe('true');
    expect(rowOf(13).classList.contains('is-selected')).toBe(false);
  });

  test('tints the row under the pointer, from its own row or from the map', () => {
    rowOf(12).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(state.hovered).toBe(12);
    expect(rowOf(12).classList.contains('is-hovered')).toBe(true);
    rowOf(12).dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
    expect(state.hovered).toBeNull();
    expect(rowOf(12).classList.contains('is-hovered')).toBe(false);
    state.hover(14);
    expect(rowOf(14).classList.contains('is-hovered')).toBe(true);
  });

  test('marks the column holding what the map is colored by', () => {
    const lit = () => [...document.querySelectorAll('th.is-lens')].map((th) => th.dataset.column);
    expect(lit()).toEqual(['score']);
    state.setLens('explored');
    expect(lit()).toEqual(['explored']);
    expect(rowOf(11).querySelector('td[data-column="explored"]').classList.contains('is-lens')).toBe(true);
    expect(rowOf(11).querySelector('td[data-column="score"]').classList.contains('is-lens')).toBe(false);
    state.setLens('problem');
    expect(lit()).toEqual(['why']);
  });
});
