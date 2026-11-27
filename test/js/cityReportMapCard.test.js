/**
 * Tests for frontend/js/report/cityReportMapCard.js (#6041): a neighborhood's card on the city reports map. The hover
 * card hints at the click; the pinned one carries the links. A name or sentence must reach the page as text.
 */

import { describe, expect, test } from 'vitest';
import { loadModules, mockModule } from './loader.js';

const i18next = { isInitialized: true, t: (key) => `[${key}]` };
mockModule('i18next', () => ({ default: i18next }));

const { mapCard } = await loadModules('frontend/js/report/cityReportMapCard.js');

const ROW = {
  id: 7,
  name: '<img src=x onerror=alert(1)> North Side',
  report: '/report/neighborhood/north-side',
  explore: null,
  scored: true,
  hasStreets: true,
  text: { score: '43.5', why: 'Lowered most by <b>No Sidewalk</b>.', explored: '100%' },
};

const words = (card) => [...card.querySelectorAll('p')].map((p) => p.textContent.replace(/\s+/g, ' ').trim());

describe('mapCard', () => {
  test('a hover card says the name, score, sentence and share explored, as text, and hints at the click', () => {
    const card = mapCard(ROW, { scoresReady: true, pinned: false });
    expect(card.dataset.regionId).toBe('7');
    expect(card.querySelector('img, b')).toBeNull();
    expect(words(card)).toEqual([ROW.name, '43.5', ROW.text.why, '[report:city.explored] 100%',
      '[report:city.map-hint]']);
    expect(card.querySelector('a')).toBeNull();
  });

  test('a pinned card carries the report link, and Explore\'s when the neighborhood asks for help', () => {
    const card = mapCard({ ...ROW, explore: '/explore?regionId=7' }, { scoresReady: true, pinned: true });
    const links = [...card.querySelectorAll('a')].map((a) => [a.getAttribute('href'), a.dataset.cityEvent]);
    expect(links).toEqual([[ROW.report, 'OpenReport'], ['/explore?regionId=7', 'HelpExplore']]);
    expect(card.querySelector('.reports-map-card__hint')).toBeNull();
  });

  test('says "Not scored yet" only where the table does: scores in, and streets to score', () => {
    const unscored = { ...ROW, scored: false };
    const none = (row, scoresReady) => mapCard(row, { scoresReady, pinned: false })
      .querySelector('.reports-map-card__score--none');
    expect(none(unscored, true).textContent).toBe('[report:city.not-scored]');
    expect(none(unscored, false)).toBeNull();
    expect(none({ ...unscored, hasStreets: false }, true)).toBeNull();
  });

  test('leaves out the share explored where nothing is explored or the sentence already says it', () => {
    const explored = (row, scoresReady) => mapCard(row, { scoresReady, pinned: false })
      .querySelector('.reports-map-card__explored');
    expect(explored({ ...ROW, scored: false, hasStreets: false, text: { ...ROW.text, explored: null } }, true))
      .toBeNull();
    expect(explored({ ...ROW, scored: false }, true)).toBeNull();
    expect(explored({ ...ROW, scored: false }, false)).not.toBeNull();
  });
});
