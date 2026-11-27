/**
 * Tests for frontend/js/report/cityReportPanel.js (#6041): the selected neighborhood's profile on the city reports page,
 * redrawn from the page's data on each selection. Names and sentences come from the server and from people (a
 * neighborhood's name), so every one of them must reach the page as text, never as markup.
 */

import { describe, expect, test } from 'vitest';
import { loadModules, mockModule } from './loader.js';

const i18next = { isInitialized: true, t: (key) => `[${key}]` };
mockModule('i18next', () => ({ default: i18next }));

const { renderPanel } = await loadModules('frontend/js/report/cityReportPanel.js');

const PAGE = { scoresReady: true, qualityReady: true, typeNames: { NoSidewalk: 'No Sidewalk', Obstacle: 'Obstacle in Path' } };

/** A scored neighborhood, every value present, its name and sentence carrying markup. */
const ROW = {
  id: 7,
  name: '<img src=x onerror=alert(1)> & "Beacon"',
  report: '/report/neighborhood/beacon?x="1"',
  explore: null,
  scored: true,
  provisional: false,
  hasStreets: true,
  score: 0.42,
  causes: [{ type: 'NoSidewalk', share: 1 }, { type: 'Obstacle', share: 0.25 }],
  text: {
    score: '42.0',
    why: 'Lowered most by <b>No Sidewalk</b>.',
    explored: '92%',
    toGo: null,
    reviewed: '19% of observations',
    latest: 'Oct 2026',
    imagery: '2025',
    labelers: '7',
    density: '68.0 per km explored',
    streets: '5.3 km',
  },
};

/** @returns {HTMLElement} A fresh, empty panel. */
function panel() {
  document.body.innerHTML = '<section id="reports-panel"></section>';
  return document.getElementById('reports-panel');
}

describe('renderPanel', () => {
  test('puts the name and sentence on the page as text, never as markup', () => {
    const root = panel();
    renderPanel(root, ROW, PAGE);
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('b')).toBeNull();
    expect(root.querySelector('#reports-panel-name').textContent).toBe(ROW.name);
    expect(root.querySelector('.reports-panel__why').textContent).toBe(ROW.text.why);
    expect(root.querySelector('a[data-city-event="OpenReport"]').getAttribute('href')).toBe(ROW.report);
    expect(root.dataset.regionId).toBe('7');
  });

  test('puts every fact and cause name on the page as text, never as markup', () => {
    const root = panel();
    const row = { ...ROW, text: { ...ROW.text, labelers: '<i>7</i>', latest: '<u>Oct</u> 2026' } };
    renderPanel(root, row, { ...PAGE, typeNames: { ...PAGE.typeNames, NoSidewalk: '<em>No Sidewalk</em>' } });
    expect(root.querySelector('i, u, em')).toBeNull();
    const values = [...root.querySelectorAll('dd')].map((dd) => dd.textContent);
    expect(values).toEqual(expect.arrayContaining(['<i>7</i>', '<u>Oct</u> 2026']));
    expect(root.querySelector('.reports-panel__cause-name').textContent).toBe('<em>No Sidewalk</em>');
  });

  test('draws a bar per cause at its share, and offers Explore only when the row asks for help', () => {
    const root = panel();
    renderPanel(root, ROW, PAGE);
    const segments = [...root.querySelectorAll('.reports-bar__seg')];
    expect(segments.map((s) => [s.dataset.labelType, Number(s.dataset.share)]))
      .toEqual([['NoSidewalk', 1], ['Obstacle', 0.25]]);
    expect(root.querySelector('.reports-panel__cause-name').textContent).toBe('No Sidewalk');
    expect(root.querySelector('a[data-city-event="HelpExplore"]')).toBeNull();

    renderPanel(root, { ...ROW, explore: '/explore?regionId=7' }, PAGE);
    expect(root.querySelector('a[data-city-event="HelpExplore"]').getAttribute('href')).toBe('/explore?regionId=7');
  });

  test('says a missing figure is still being counted, or that there is none once counting is done', () => {
    const root = panel();
    const row = { ...ROW, scored: false, score: null, text: { ...ROW.text, score: null, reviewed: null } };
    renderPanel(root, row, { ...PAGE, qualityReady: false });
    expect(root.querySelector('.reports-panel__score--none').textContent).toBe('[report:city.not-scored]');
    expect([...root.querySelectorAll('dd')].map((dd) => dd.textContent)).toContain('[report:city.counting]');
    renderPanel(root, row, PAGE);
    expect([...root.querySelectorAll('dd')].map((dd) => dd.textContent)).toContain('[report:city.no-data]');
    expect([...root.querySelectorAll('dd')].map((dd) => dd.textContent)).not.toContain('[report:city.counting]');
  });

  test('says nothing about a score while the city\'s are being computed, as the table doesn\'t', () => {
    const root = panel();
    const row = { ...ROW, scored: false, score: null, text: { ...ROW.text, score: null } };
    renderPanel(root, row, { ...PAGE, scoresReady: false });
    expect(root.querySelector('.reports-panel__score--none')).toBeNull();
    renderPanel(root, { ...row, hasStreets: false }, PAGE);
    expect(root.querySelector('.reports-panel__score--none')).toBeNull();
  });
});
