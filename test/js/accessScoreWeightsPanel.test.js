/**
 * Tests for frontend/js/access-score/AccessScoreWeightsPanel.js, the "Adjust the weights" panel the AccessScore tool
 * and the neighborhood report share (#5876): rows come from the config, a drag and a release are told apart, and the
 * fold, the "Custom" hint and Reset all follow the sliders.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { loadModules, mockModule, useUtil } from './loader.js';

mockModule('i18next', () => ({ default: { language: 'en', t: (key) => key } }));
useUtil({ misc: { getIconImagePaths: () => ({ iconImagePath: '/icon.svg' }), labelTypeName: (type) => type } });

const CONFIG = {
  scored_types: ['CurbRamp', 'Obstacle'],
  presets: { default: { CurbRamp: 0.75, Obstacle: 1 } },
  type_weights: { CurbRamp: { base_weight: 0.75 }, Obstacle: { base_weight: -1 } },
  grade: { sources: [{ dem_source: 'usgs' }] },
  grade_scoring: { defaults: { weight: 1 }, weight_range: { max: 3 } },
};

const MARKUP = `
  <button id="acs-weights-toggle" aria-expanded="false"><img alt="" data-down-src="down" data-up-src="up"></button>
  <span id="acs-weights-summary"></span><button id="acs-reset" hidden></button>
  <div id="acs-weights" hidden></div><p id="acs-weights-flash"></p>`;

describe('AccessScoreWeightsPanel', () => {
  let AccessScoreWeightsPanel;
  const el = (id) => document.getElementById(id);
  const move = (id, value, final) => {
    const slider = /** @type {HTMLInputElement} */ (el(id));
    slider.value = String(value);
    slider.dispatchEvent(new Event(final ? 'change' : 'input'));
  };

  beforeEach(async () => {
    document.body.innerHTML = MARKUP;
    ({ AccessScoreWeightsPanel } = await loadModules('frontend/js/access-score/AccessScoreWeightsPanel.js'));
  });

  test('draws a row per scored type, tagged by which way it counts, above the engine\'s largest default', () => {
    new AccessScoreWeightsPanel(document, CONFIG);
    expect([...document.querySelectorAll('.ps-weight')].map((r) => r.dataset.type)).toEqual(['CurbRamp', 'Obstacle']);
    expect(document.querySelector('[data-type="CurbRamp"] .ps-weight__role--feature')).not.toBeNull();
    expect(document.querySelector('[data-type="Obstacle"] .ps-weight__role--problem')).not.toBeNull();
    expect(el('acs-weight-Obstacle').max).toBe(String(AccessScoreWeightsPanel.MAX_WEIGHT));
    expect(el('acs-weight-grade')).toBeNull();
  });

  test('a grade row only where the host asks for one and the city has a grade', () => {
    new AccessScoreWeightsPanel(document, { ...CONFIG, grade: { sources: [] } }, { gradeRow: true });
    expect(el('acs-weight-grade')).toBeNull();
    document.body.innerHTML = MARKUP;
    const panel = new AccessScoreWeightsPanel(document, CONFIG, { gradeRow: true });
    panel.setWeights(CONFIG.presets.default, 1);
    expect(el('acs-weight-grade').value).toBe('1');
    expect(panel.isDefault).toBe(true);
  });

  test('a drag reports as it goes and settles once on release, in the model\'s state shape', () => {
    const panel = new AccessScoreWeightsPanel(document, CONFIG, { gradeRow: true });
    panel.setWeights(CONFIG.presets.default, 1);
    const heard = vi.fn();
    panel.onChange(heard);
    move('acs-weight-Obstacle', 2, false);
    expect(heard).toHaveBeenLastCalledWith({ weights: { Obstacle: 2 } },
      { kind: 'Weight', value: 'Obstacle_value=2', final: false });
    move('acs-weight-Obstacle', 2, true);
    expect(heard).toHaveBeenLastCalledWith({ weights: { Obstacle: 2 } },
      { kind: 'Weight', value: 'Obstacle_value=2', final: true });
    move('acs-weight-grade', 0, true);
    expect(heard).toHaveBeenLastCalledWith({ slope: { weight: 0 } },
      { kind: 'GradeWeight', value: 'value=0', final: true });
    expect(panel.values).toEqual({ weights: { CurbRamp: 0.75, Obstacle: 2 }, gradeWeight: 0 });
  });

  test('off the defaults, the folded heading says Custom and Reset appears; a 0 reads Off', () => {
    const panel = new AccessScoreWeightsPanel(document, CONFIG);
    panel.setWeights(CONFIG.presets.default);
    expect(el('acs-reset').hidden).toBe(true);
    expect(el('acs-weights-summary').textContent).toBe('');
    move('acs-weight-CurbRamp', 0, false);
    expect(el('acs-reset').hidden).toBe(false);
    expect(el('acs-weights-summary').textContent).toBe('accessscore:weights-custom');
    expect(document.querySelector('[data-type="CurbRamp"]').classList.contains('ps-weight--off')).toBe(true);
    expect(document.querySelector('[data-type="CurbRamp"] output').textContent).toBe('accessscore:weight-off');
  });

  test('the heading folds the sliders and says so; Reset reports for the host to resolve', () => {
    const panel = new AccessScoreWeightsPanel(document, CONFIG);
    const heard = vi.fn();
    panel.onChange(heard);
    el('acs-weights-toggle').click();
    expect(panel.open).toBe(true);
    expect(el('acs-weights').hidden).toBe(false);
    expect(document.querySelector('#acs-weights-toggle img').src).toContain('up');
    expect(heard).toHaveBeenLastCalledWith(null, { kind: 'Section', value: 'weights_open=true', final: true });
    el('acs-reset').click();
    expect(heard).toHaveBeenLastCalledWith(null, { kind: 'Reset', final: true });
  });

  test('each type\'s bar is its share of the largest average effect, colored by its sign', () => {
    const panel = new AccessScoreWeightsPanel(document, CONFIG);
    panel.setContributions({ CurbRamp: 0.25, Obstacle: -0.5 });
    const bar = (type) => /** @type {HTMLElement} */ (document.querySelector(`[data-type="${type}"] .ps-weight__bar`));
    expect(bar('Obstacle').style.width).toBe('100%');
    expect(bar('CurbRamp').style.width).toBe('50%');
    expect(bar('CurbRamp').classList.contains('ps-weight__bar--feature')).toBe(true);
    expect(bar('Obstacle').classList.contains('ps-weight__bar--problem')).toBe(true);
  });
});
