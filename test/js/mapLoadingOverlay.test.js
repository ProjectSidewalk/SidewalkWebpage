/**
 * Tests for the label maps' loading overlay, frontend/js/ps-map/MapLoadingOverlay.js (#5840).
 *
 * The overlay is the only cue that a feed of tens of megabytes is still arriving, and the only way back from one
 * that broke, so these pin what a person sees and can press: the ticking clock, the status line, the error card
 * that a late spinner must not cover, and the retry button.
 */

import { navigationAttempts } from './fakes.js';
import { loadModules, mockModule } from './loader.js';

mockModule('i18next', () => ({ default: { t: (key, opts) => `${key}|${opts?.seconds ?? ''}` } }));

const reloads = navigationAttempts();

// Mirrors app/views/common/mapLoadingOverlay.scala.html, only the ids the class reads.
const OVERLAY_HTML = `
  <div id="labelmap-loading" hidden aria-busy="true">
    <div id="labelmap-loading-card">
      <p id="labelmap-loading-elapsed"></p>
      <p id="labelmap-loading-status" hidden></p>
    </div>
    <div id="labelmap-error-card" hidden>
      <button type="button" id="labelmap-retry">Try again</button>
    </div>
  </div>`;

const { MapLoadingOverlay } = await loadModules('frontend/js/ps-map/MapLoadingOverlay.js');

const byId = (id) => document.getElementById(id);

describe('MapLoadingOverlay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = OVERLAY_HTML;
    reloads.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('shows the spinner with a clock that counts up while the feed loads', () => {
    const overlay = new MapLoadingOverlay();
    overlay.show();
    expect(overlay.isVisible()).toBe(true);
    expect(byId('labelmap-loading-card').hidden).toBe(false);
    expect(byId('labelmap-error-card').hidden).toBe(true);
    expect(byId('labelmap-loading').getAttribute('aria-busy')).toBe('true');
    expect(byId('labelmap-loading-elapsed').textContent).toBe('labelmap:loading-elapsed|0.0');

    vi.advanceTimersByTime(1500);
    expect(byId('labelmap-loading-elapsed').textContent).toBe('labelmap:loading-elapsed|1.5');
  });

  test('a second show restarts the clock instead of running two', () => {
    const overlay = new MapLoadingOverlay();
    overlay.show();
    vi.advanceTimersByTime(2000);
    overlay.show();
    expect(vi.getTimerCount()).toBe(1);
    expect(byId('labelmap-loading-elapsed').textContent).toBe('labelmap:loading-elapsed|0.0');
  });

  test('hiding takes the overlay down, stops the clock, and clears the status line', () => {
    const overlay = new MapLoadingOverlay();
    overlay.show();
    overlay.setStatus('Scores are not ready yet');
    overlay.hide();
    expect(overlay.isVisible()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(byId('labelmap-loading-status').hidden).toBe(true);
    expect(byId('labelmap-loading-status').textContent).toBe('');
  });

  test('a status line set before the spinner shows is still there once it does', () => {
    const overlay = new MapLoadingOverlay();
    overlay.setStatus('Retrying in 5 s');
    overlay.show();
    expect(byId('labelmap-loading-status').hidden).toBe(false);
    expect(byId('labelmap-loading-status').textContent).toBe('Retrying in 5 s');
  });

  test('a failure swaps in the error card, stops the clock, and moves focus to retry', () => {
    const overlay = new MapLoadingOverlay();
    overlay.show();
    overlay.setStatus('Retrying in 5 s');
    overlay.showError();
    expect(overlay.isVisible()).toBe(true);
    expect(byId('labelmap-loading-card').hidden).toBe(true);
    expect(byId('labelmap-error-card').hidden).toBe(false);
    expect(byId('labelmap-loading').getAttribute('aria-busy')).toBe('false');
    expect(byId('labelmap-loading-status').hidden).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(document.activeElement).toBe(byId('labelmap-retry'));
  });

  test('a spinner that arrives after a fast failure does not cover the error card', () => {
    const overlay = new MapLoadingOverlay();
    overlay.showError();
    overlay.show();
    expect(byId('labelmap-error-card').hidden).toBe(false);
    expect(byId('labelmap-loading-card').hidden).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('retry puts the spinner back up and hands the new attempt to the page', () => {
    const onRetry = vi.fn();
    const overlay = new MapLoadingOverlay({ onRetry });
    overlay.showError();
    byId('labelmap-retry').click();
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(byId('labelmap-loading-card').hidden).toBe(false);
    expect(byId('labelmap-error-card').hidden).toBe(true);
    expect(reloads).not.toHaveBeenCalled();
  });

  test('retry reloads the page when the page gave no retry of its own', () => {
    const overlay = new MapLoadingOverlay();
    overlay.showError();
    byId('labelmap-retry').click();
    expect(reloads).toHaveBeenCalledTimes(1);
  });

  test('on a page without the overlay partial, every call is a harmless no-op', () => {
    document.body.innerHTML = '';
    const overlay = new MapLoadingOverlay();
    expect(() => {
      overlay.show();
      overlay.setStatus('x');
      overlay.showError();
      overlay.hide();
    }).not.toThrow();
    expect(overlay.isVisible()).toBe(false);
  });
});
