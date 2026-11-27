/**
 * Tests for frontend/js/report/CityReportState.js (#6041): the one selection, hover, lens, filter and sort that the
 * city reports page's map, table and panel all draw from, so that none of them can disagree about it.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { loadModules } from './loader.js';

/** Two scored neighborhoods and two not yet scored. */
const ROWS = [
  { id: 1, scored: true },
  { id: 2, scored: true },
  { id: 3, scored: false },
  { id: 4, scored: false },
];

describe('CityReportState', () => {
  let CityReportState;
  let state;
  let heard;

  beforeEach(async () => {
    ({ CityReportState } = await loadModules('frontend/js/report/CityReportState.js'));
    state = new CityReportState(ROWS, { selected: 1 });
    heard = vi.fn();
    state.subscribe(heard);
  });

  test('starts on the given neighborhood, coloring by score, showing all, in the server\'s order', () => {
    expect(state.selected).toBe(1);
    expect(state.hovered).toBeNull();
    expect(state.lens).toBe('score');
    expect(state.filter).toBe('all');
    expect(state.sort).toEqual({ column: null, dir: 'asc' });
  });

  test('tells every listener what changed and where a selection came from', () => {
    state.select(2, 'Map');
    expect(state.selected).toBe(2);
    expect(heard).toHaveBeenLastCalledWith(state, { type: 'select', from: 'Map' });
    state.hover(3, 'Map');
    expect(heard).toHaveBeenLastCalledWith(state, { type: 'hover', from: 'Map' });
    state.hover(null, 'Table');
    expect(heard).toHaveBeenLastCalledWith(state, { type: 'hover', from: 'Table' });
    expect(state.hovered).toBeNull();
  });

  test('says nothing when nothing changes', () => {
    state.select(1, 'Table');
    state.setLens('score');
    state.setFilter('all');
    state.hover(null, 'Map');
    expect(heard).not.toHaveBeenCalled();
  });

  test('filters to scored or unscored neighborhoods and names the rest as faded', () => {
    state.setFilter('scored');
    expect(heard).toHaveBeenLastCalledWith(state, { type: 'filter' });
    expect([1, 2, 3, 4].filter((id) => state.inFilter(id))).toEqual([1, 2]);
    expect(state.fadedIds()).toEqual([3, 4]);
    state.setFilter('unscored');
    expect(state.fadedIds()).toEqual([1, 2]);
    state.setFilter('all');
    expect(state.fadedIds()).toEqual([]);
  });

  test('shows everything again when a faded neighborhood is picked on the map', () => {
    state.setFilter('scored');
    state.select(3, 'Map');
    expect(state.selected).toBe(3);
    expect(state.filter).toBe('all');
    expect(state.fadedIds()).toEqual([]);
  });

  test('sorts ascending on a new column and flips direction on the same one', () => {
    state.setSort('explored');
    expect(state.sort).toEqual({ column: 'explored', dir: 'asc' });
    state.setSort('explored');
    expect(state.sort).toEqual({ column: 'explored', dir: 'desc' });
    state.setSort('score');
    expect(state.sort).toEqual({ column: 'score', dir: 'asc' });
    expect(heard).toHaveBeenLastCalledWith(state, { type: 'sort' });
  });

  test('starts on the sort the server\'s order already is, so a first click on that column turns it around', () => {
    const sorted = new CityReportState(ROWS, { selected: 1, sort: { column: 'score', dir: 'asc' } });
    expect(sorted.sort).toEqual({ column: 'score', dir: 'asc' });
    sorted.setSort('score');
    expect(sorted.sort).toEqual({ column: 'score', dir: 'desc' });
  });

  test('refuses a lens or filter it does not know, rather than drawing nothing', () => {
    expect(() => state.setLens('slope')).toThrow();
    expect(() => state.setFilter('some')).toThrow();
    expect(state.lens).toBe('score');
  });

  test('stops telling a listener once it unsubscribes', () => {
    const other = vi.fn();
    const stop = state.subscribe(other);
    stop();
    state.setLens('explored');
    expect(other).not.toHaveBeenCalled();
    expect(heard).toHaveBeenCalledOnce();
  });
});
