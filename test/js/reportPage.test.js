/**
 * Tests for frontend/js/pages/report.js, the neighborhood report's page script.
 *
 * The page works without this script, so what's pinned is what it adds: the two buttons only appear once they can
 * work, printing asks for every lazy photo first since a browser prints only what has loaded, and each use of the
 * report's links is logged against its region and preset.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { loadModules, mockModule } from './loader.js';

const copyToClipboard = vi.fn();
mockModule('i18next', () => ({ default: { t: (key) => key } }));
mockModule('frontend/js/common/copyToClipboard.js', () => ({ copyToClipboard }));

const PAGE = `
  <main id="report-page" data-region-id="10" data-preset="coordinator">
    <a id="gallery" href="#" data-report-event="Report_OpenGallery"><span id="gallery-inner">5</span></a>
    <a id="plain" href="#">unlogged</a>
    <img class="report-photo__image" id="photo-a" loading="lazy" alt="">
    <img class="report-photo__image" id="photo-b" loading="lazy" alt="">
    <div id="report-actions" hidden>
      <button id="report-print" type="button">Print</button>
      <button id="report-copy-link" type="button">Copy</button>
    </div>
  </main>`;

describe('report page', () => {
  beforeAll(async () => {
    document.body.innerHTML = PAGE;
    window.logWebpageActivity = vi.fn();
    window.print = vi.fn();
    window.appManager = { ready: (fn) => fn() };
    window.HTMLImageElement.prototype.decode = vi.fn(() => Promise.resolve());
    await loadModules('frontend/js/pages/report.js');
  });

  beforeEach(() => {
    window.logWebpageActivity.mockClear();
    copyToClipboard.mockClear();
    window.print.mockClear();
  });

  test('reveals the buttons once they can work', () => {
    expect(document.getElementById('report-actions').hidden).toBe(false);
  });

  test('logs a click anywhere inside a report link, with its region and preset', () => {
    document.getElementById('gallery-inner').click();
    expect(window.logWebpageActivity).toHaveBeenCalledWith('Report_OpenGallery_Region=10_Preset=coordinator');
  });

  test('logs nothing for an element that names no event', () => {
    document.getElementById('plain').click();
    expect(window.logWebpageActivity).not.toHaveBeenCalled();
  });

  test('copies the page URL and logs it', () => {
    document.getElementById('report-copy-link').click();
    expect(copyToClipboard).toHaveBeenCalledWith(document.getElementById('report-copy-link'), window.location.href);
    expect(window.logWebpageActivity).toHaveBeenCalledWith('Report_CopyLink_Region=10_Preset=coordinator');
  });

  test('the print button loads every photo before it prints', async () => {
    const photo = document.getElementById('photo-a');
    photo.loading = 'lazy';
    document.getElementById('report-print').click();
    expect(photo.loading).toBe('eager');
    expect(window.print).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve));
    expect(window.print).toHaveBeenCalledTimes(1);
  });

  test('printing any other way logs it and still asks for the photos', () => {
    const photo = document.getElementById('photo-b');
    photo.loading = 'lazy';
    window.dispatchEvent(new Event('beforeprint'));
    expect(photo.loading).toBe('eager');
    expect(window.logWebpageActivity).toHaveBeenCalledWith('Report_Print_Region=10_Preset=coordinator');
  });
});
