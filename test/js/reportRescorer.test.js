/**
 * Tests for frontend/js/report/ReportWeights.js and ReportRescorer.js. What's pinned is the honesty rule: custom weights
 * always say so and travel in the link, and Reset returns exactly what the server said, not a recomputation of it.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest';
import { loadModules, mockModule, useUtil } from './loader.js';

mockModule('i18next', () => ({ default: { language: 'en', t: (key) => key } }));
useUtil({ misc: { labelTypeName: (type) => type } });

const CONFIG = {
  scored_types: ['NoCurbRamp', 'CurbRamp'],
  presets: { default: { NoCurbRamp: 1, CurbRamp: 0.5 } },
  grade: { sources: [{}] },
  grade_scoring: { defaults: { weight: 0.5 }, weight_range: { max: 2 } },
};

describe('ReportWeights', () => {
  let ReportWeights;
  let onChange;
  let weights;
  const slider = (id) => document.getElementById(`report-weight-${id}`);
  const move = (input, value, event = 'input') => {
    input.value = String(value);
    input.dispatchEvent(new Event(event));
  };

  beforeEach(async () => {
    ({ ReportWeights } = await loadModules('frontend/js/report/ReportWeights.js'));
    document.body.innerHTML = `<div id="root"><div id="report-weights"></div>
      <button id="report-weights-reset" hidden></button></div>`;
    onChange = vi.fn();
    weights = new ReportWeights(document.getElementById('root'), CONFIG, onChange);
  });

  test('offers a slider per scored type and the grade, each named for a screen reader', () => {
    for (const id of ['NoCurbRamp', 'CurbRamp', 'grade']) {
      expect(document.querySelector(`label[for="report-weight-${id}"]`)).not.toBeNull();
    }
    expect(slider('NoCurbRamp').value).toBe('1');
    expect(weights.isDefault).toBe(true);
  });

  test('offers no grade slider where the city has no slope data', () => {
    document.getElementById('report-weights').innerHTML = '';
    const flat = { ...CONFIG, grade: { sources: [] } };
    new ReportWeights(document.getElementById('root'), flat, onChange);
    expect(document.querySelectorAll('#report-weights input')).toHaveLength(2);
  });

  test('a drag is not final; letting go is', () => {
    move(slider('NoCurbRamp'), 2);
    expect(onChange.mock.lastCall[1]).toMatchObject({ kind: 'Weight', value: 'Type=NoCurbRamp_Value=2', final: false });
    move(slider('NoCurbRamp'), 2, 'change');
    expect(onChange.mock.lastCall[1].final).toBe(true);
    expect(onChange.mock.lastCall[0].weights.NoCurbRamp).toBe(2);
  });

  test('Reset appears once a slider moves, and restores the engine\'s defaults', () => {
    const reset = document.getElementById('report-weights-reset');
    expect(reset.hidden).toBe(true);
    move(slider('grade'), 1);
    expect(reset.hidden).toBe(false);
    reset.click();
    expect(weights.isDefault).toBe(true);
    expect(reset.hidden).toBe(true);
    expect(onChange.mock.lastCall[1]).toMatchObject({ kind: 'WeightsReset', final: true });
  });

  test('shows a link\'s weights without announcing them', () => {
    weights.show({ weights: { CurbRamp: 2 }, slopeWeight: 0 });
    expect(slider('CurbRamp').value).toBe('2');
    expect(slider('grade').value).toBe('0');
    expect(weights.isDefault).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('crossingsBbox', () => {
  test('spans every street, with room for a crossing just past a street\'s end', async () => {
    const { crossingsBbox } = await loadModules('frontend/js/report/ReportRescorer.js');
    const bbox = crossingsBbox({ features: [
      { geometry: { coordinates: [[-74, 40], [-73.9, 40.2]] } },
      { geometry: { coordinates: [[-74.1, 40.1]] } },
    ] }).split(',').map(Number);
    expect(bbox[0]).toBeCloseTo(-74.1005);
    expect(bbox[1]).toBeCloseTo(39.9995);
    expect(bbox[2]).toBeCloseTo(-73.8995);
    expect(bbox[3]).toBeCloseTo(40.2005);
  });
});

describe('ReportRescorer', () => {
  let ReportRescorer;
  let model;
  let deps;
  let data;
  let sections;
  const CUSTOM = { weights: { NoCurbRamp: 2, CurbRamp: 0.5 }, slopeWeight: 0.5 };
  const text = (selector) => document.querySelector(selector).textContent;

  beforeEach(async () => {
    ({ ReportRescorer } = await loadModules('frontend/js/report/ReportRescorer.js'));
    window.history.replaceState(null, '', '/report/neighborhood/3?preset=advocate');
    document.body.innerHTML = `<div id="report-shell">
      <p id="report-custom-stamp" hidden></p><a class="report-score__value">41.6 of 100</a>
      <ol id="rank">
        <li class="report-rank__row" data-street="1"><span class="report-rank__position">1</span>
          <span class="report-rank__bar"></span><a class="report-rank__score">20.0</a></li>
        <li class="report-rank__row" data-street="2"><span class="report-rank__position">2</span>
          <span class="report-rank__bar"></span><a class="report-rank__score">60.0</a></li>
      </ol>
      <ol id="sections">
        <li class="report-street" data-street="1"><span class="report-street__rank">1</span>
          <a class="report-street__score">Score 20.0</a></li>
        <li class="report-street" data-street="2"><span class="report-street__rank">2</span>
          <a class="report-street__score">Score 60.0</a></li>
      </ol>
      <ul class="report-toc" id="toc">
        <li><a data-street="1"><span class="report-toc__dot"></span></a></li>
        <li><a data-street="2"><span class="report-toc__dot"></span></a></li>
        <li id="toc-about"><a href="#about">About</a></li>
      </ul></div>`;
    data = {
      edges: [{ id: 10, wayId: 1, score: 0.2 }, { id: 20, wayId: 2, score: 0.6 }],
      streets: [{ wayId: 1, score: 0.2, edgeIds: [10] }, { wayId: 2, score: 0.6, edgeIds: [20] }],
    };
    // Under these "custom" weights the two streets trade places.
    const scores = { 10: 0.9, 20: 0.3 };
    model = {
      setState: vi.fn(),
      explainStreet: vi.fn((id) => ({ score: scores[id], lengthM: 100, audited: true })),
      clusterTerm: vi.fn(() => ({ term: -1 })),
    };
    sections = [{ refreshStreets: vi.fn(), setCardWeigher: vi.fn() }];
    deps = {
      loadModel: vi.fn(async () => model),
      loadClusters: vi.fn(async () => [{ label_cluster_id: 5, street_edge_id: 10 }]),
      sections: () => sections,
      regionMap: () => null,
    };
  });

  const ways = (selector) => [...document.querySelectorAll(selector)].map((el) => Number(el.dataset.street));

  test('stamps the page, and hands the model what the sliders say', async () => {
    const rescorer = new ReportRescorer(data, deps);
    await rescorer.apply(CUSTOM, { isDefault: false, final: false });
    expect(model.setState).toHaveBeenCalledWith({ weights: CUSTOM.weights, slope: { weight: 0.5 } });
    expect(document.getElementById('report-custom-stamp').hidden).toBe(false);
    expect(document.getElementById('report-shell').classList.contains('is-custom-weights')).toBe(true);
    expect(rescorer.isCustom).toBe(true);
  });

  test('builds the model once, and not at all until it is needed', async () => {
    const rescorer = new ReportRescorer(data, deps);
    expect(deps.loadModel).not.toHaveBeenCalled();
    await Promise.all([
      rescorer.apply(CUSTOM, { isDefault: false, final: false }),
      rescorer.apply(CUSTOM, { isDefault: false, final: true }),
    ]);
    expect(deps.loadModel).toHaveBeenCalledTimes(1);
  });

  test('moves the numbers in their sentences during a drag, but holds the order until it ends', async () => {
    const rescorer = new ReportRescorer(data, deps);
    await rescorer.apply(CUSTOM, { isDefault: false, final: false });
    expect(text('[data-street="1"] .report-rank__score')).toBe('90.0');
    expect(text('.report-street[data-street="1"] .report-street__score')).toBe('Score 90.0');
    expect(text('.report-score__value')).toBe('60.0 of 100');
    expect(ways('#rank > li')).toEqual([1, 2]);

    await rescorer.apply(CUSTOM, { isDefault: false, final: true });
    expect(ways('#rank > li')).toEqual([2, 1]);
    expect(ways('#sections > li')).toEqual([2, 1]);
    expect(text('[data-street="2"] .report-rank__position')).toBe('1');
    expect(text('.report-street[data-street="1"] .report-street__rank')).toBe('2');
    expect(ways('#toc a[data-street]')).toEqual([2, 1]);
    expect(document.querySelector('#toc').lastElementChild.id).toBe('toc-about');
  });

  test('a Reset overtakes a move still waiting on the model', async () => {
    let finish;
    deps.loadModel.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const rescorer = new ReportRescorer(data, deps);
    const moving = rescorer.apply(CUSTOM, { isDefault: false, final: true });
    await rescorer.apply(CUSTOM, { isDefault: true, final: true });
    finish(model);
    await moving;
    expect(rescorer.isCustom).toBe(false);
    expect(model.setState).not.toHaveBeenCalled();
    expect(document.getElementById('report-custom-stamp').hidden).toBe(true);
  });

  test('leaves the server\'s own wording alone on Reset, rather than reformatting its number', async () => {
    document.querySelector('.report-street[data-street="1"] .report-street__score').textContent = 'Score 20,00';
    const rescorer = new ReportRescorer(data, deps);
    await rescorer.apply(CUSTOM, { isDefault: false, final: false });
    await rescorer.apply(CUSTOM, { isDefault: true, final: true });
    expect(text('.report-street[data-street="1"] .report-street__score')).toBe('Score 20,00');
  });

  test('updates edges in place, so a map built later draws what is in force', async () => {
    await new ReportRescorer(data, deps).apply(CUSTOM, { isDefault: false, final: false });
    expect(data.edges[0].score).toBe(0.9);
    expect(sections[0].refreshStreets).toHaveBeenCalled();
  });

  test('carries the weights in the link, in the tool\'s format, keeping the rest of the address', async () => {
    await new ReportRescorer(data, deps).apply(CUSTOM, { isDefault: false, final: true });
    const params = new URLSearchParams(window.location.search);
    expect(params.get('w')).toBe('NoCurbRamp:2,CurbRamp:0.5');
    expect(params.get('gs')).toBe('w:0.5');
    expect(params.get('preset')).toBe('advocate');
  });

  test('reorders cards by what they now matter, once the gesture ends', async () => {
    await new ReportRescorer(data, deps).apply(CUSTOM, { isDefault: false, final: true });
    await vi.waitFor(() => expect(sections[0].setCardWeigher).toHaveBeenCalled());
    const weigher = sections[0].setCardWeigher.mock.lastCall[0];
    expect(weigher({ clusterId: 5 })).toBe(1);
    expect(weigher({ clusterId: 404 })).toBe(0);
  });

  test('a failed cluster fetch leaves the cards as they were', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    deps.loadClusters.mockRejectedValue(new Error('offline'));
    await new ReportRescorer(data, deps).apply(CUSTOM, { isDefault: false, final: true });
    await new Promise((resolve) => { setTimeout(resolve); });
    expect(sections[0].setCardWeigher).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  test('a failed model leaves the page unstamped, and the next move retries', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    deps.loadModel.mockRejectedValueOnce(new Error('offline'));
    const rescorer = new ReportRescorer(data, deps);
    await rescorer.apply(CUSTOM, { isDefault: false, final: true });
    expect(document.getElementById('report-custom-stamp').hidden).toBe(true);
    await rescorer.apply(CUSTOM, { isDefault: false, final: true });
    expect(document.getElementById('report-custom-stamp').hidden).toBe(false);
    error.mockRestore();
  });

  test('Reset returns exactly what the server said: its words, numbers, order and scores', async () => {
    const rescorer = new ReportRescorer(data, deps);
    await rescorer.apply(CUSTOM, { isDefault: false, final: true });
    await vi.waitFor(() => expect(sections[0].setCardWeigher).toHaveBeenCalled());
    await rescorer.apply(CUSTOM, { isDefault: true, final: true });

    expect(text('.report-score__value')).toBe('41.6 of 100');
    expect(text('.report-street[data-street="1"] .report-street__score')).toBe('Score 20.0');
    expect(ways('#rank > li')).toEqual([1, 2]);
    expect(text('[data-street="1"] .report-rank__position')).toBe('1');
    expect(data.edges[0].score).toBe(0.2);
    expect(document.getElementById('report-custom-stamp').hidden).toBe(true);
    expect(sections[0].setCardWeigher).toHaveBeenLastCalledWith(null);
    expect(new URLSearchParams(window.location.search).has('w')).toBe(false);
  });
});
