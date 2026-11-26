/**
 * Tests for regionColor in frontend/js/report/CityReportMap.js (#6041): the color a neighborhood wears on the city
 * reports map under each lens. "Not scored" and "no streets" must never borrow a color that reads as a result.
 */

import { beforeAll, describe, expect, test } from 'vitest';
import { loadModules, mockModule } from './loader.js';

mockModule('maplibre-gl', () => ({ Map: class {}, addProtocol: () => {}, setWorkerUrl: () => {} }));
mockModule('pmtiles', () => ({ Protocol: class { tile() {} } }));
mockModule('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url', () => ({ default: 'maplibre-gl-worker.js' }));

const NONE = '#dddddd';
const LOW = '#000000';
const HIGH = '#ffffff';

let regionColor;
let ScoreRamp;
let util;

beforeAll(async () => {
  document.documentElement.style.setProperty('--color-neutral-200', NONE);
  document.documentElement.style.setProperty('--color-explored-ramp-low', LOW);
  document.documentElement.style.setProperty('--color-explored-ramp-high', HIGH);
  ({ regionColor, ScoreRamp, util } = await loadModules('frontend/js/report/CityReportMap.js',
    'frontend/js/common/scoreRamp.js', 'frontend/js/common/utilities.js'));
});

const row = (fields) => ({ id: 1, scored: false, hasStreets: true, score: null, completion: 0, topType: null,
  ...fields });

describe('regionColor', () => {
  test('colors a scored neighborhood from the score ramp, and an unscored one as none', () => {
    expect(regionColor(row({ scored: true, score: 0.42 }), 'score')).toBe(ScoreRamp.at(0.42));
    expect(regionColor(row({ scored: false, completion: 0.9 }), 'score')).toBe(NONE);
  });

  test('colors by explored share along the ramp, and a region with no streets as none', () => {
    expect(regionColor(row({ completion: 0 }), 'explored')).toBe(LOW);
    expect(regionColor(row({ completion: 1 }), 'explored')).toBe(HIGH);
    expect(regionColor(row({ completion: 0.5 }), 'explored')).toBe('#808080');
    expect(regionColor(row({ hasStreets: false, completion: null }), 'explored')).toBe(NONE);
  });

  test('colors by the type that lowers the score most, in its label color, and none without one', () => {
    expect(regionColor(row({ topType: 'Obstacle' }), 'problem')).toBe(util.misc.getLabelColors('Obstacle'));
    expect(regionColor(row({ topType: null }), 'problem')).toBe(NONE);
  });
});
