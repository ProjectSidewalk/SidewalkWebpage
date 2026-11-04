/**
 * The minimap's collapsible map key (frontend/js/explore/navigation/MinimapLegend.js, #5840): opened from its pill,
 * closed from its button or with Escape, each logged; and its earlier-labels checkbox, which shows the remembered
 * preference and keeps in step with it however it is set.
 */

import { loadModules } from './loader.js';
import { fakeTracker } from './fakes.js';

describe('MinimapLegend', () => {
  let ui;
  let tracker;
  let labelContainer;
  let shownListener;

  beforeEach(async () => {
    const { MinimapLegend } = await loadModules('frontend/js/explore/navigation/MinimapLegend.js');
    document.body.innerHTML = `
      <button id="toggle" aria-expanded="false"></button>
      <div id="card" class="minimap-legend-card-hidden"><button id="close"></button>
        <input id="earlier" type="checkbox"></div>`;
    ui = {
      legendToggle: document.getElementById('toggle'),
      legendClose: document.getElementById('close'),
      legendCard: document.getElementById('card'),
      legendEarlierLabels: document.getElementById('earlier'),
    };
    tracker = fakeTracker();
    labelContainer = {
      earlierLabelsShownPreference: () => false,
      setEarlierLabelsShown: vi.fn(),
      onEarlierLabelsShownChanged: (listener) => { shownListener = listener; },
    };
    new MinimapLegend(ui, labelContainer, tracker);
  });

  const isOpen = () => ui.legendToggle.getAttribute('aria-expanded') === 'true'
    && ui.legendToggle.classList.contains('minimap-legend-toggle-hidden')
    && !ui.legendCard.classList.contains('minimap-legend-card-hidden');
  const isClosed = () => ui.legendToggle.getAttribute('aria-expanded') === 'false'
    && !ui.legendToggle.classList.contains('minimap-legend-toggle-hidden')
    && ui.legendCard.classList.contains('minimap-legend-card-hidden');
  const press = (key) => document.dispatchEvent(new KeyboardEvent('keydown', { key }));

  test('starts collapsed, opens from the pill and closes from its button, logging each', () => {
    expect(isClosed()).toBe(true);
    ui.legendToggle.click();
    expect(isOpen()).toBe(true);
    ui.legendClose.click();
    expect(isClosed()).toBe(true);
    expect(tracker.push.mock.calls).toEqual([['Click_MinimapLegend_Open'], ['Click_MinimapLegend_Close']]);
  });

  test('Escape closes an open legend, and does nothing to a closed one', () => {
    press('Escape');
    expect(isClosed()).toBe(true);
    expect(tracker.push).not.toHaveBeenCalled();

    ui.legendToggle.click();
    press('Enter');
    expect(isOpen()).toBe(true);
    press('Escape');
    expect(isClosed()).toBe(true);
    expect(tracker.push).toHaveBeenLastCalledWith('MinimapLegend_EscapeClose');
  });

  test('the earlier-labels box shows the remembered preference and sets it when ticked', () => {
    expect(ui.legendEarlierLabels.checked).toBe(false);
    ui.legendEarlierLabels.checked = true;
    ui.legendEarlierLabels.dispatchEvent(new Event('change'));
    expect(labelContainer.setEarlierLabelsShown).toHaveBeenCalledWith(true);
  });

  test('the box follows the setting when it is applied from elsewhere', () => {
    shownListener(true);
    expect(ui.legendEarlierLabels.checked).toBe(true);
    shownListener(false);
    expect(ui.legendEarlierLabels.checked).toBe(false);
  });
});
