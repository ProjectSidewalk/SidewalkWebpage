/**
 * Tests for frontend/js/pages/report.js, the neighborhood report's page script.
 *
 * What's pinned: the two buttons only appear once they can work, printing draws every card first since a browser prints
 * only what it has, and each use of the report's links is logged against its region and preset. Maps and cards are
 * stubbed here; reportPageRun.test.js covers how the page brings them up.
 */

import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { loadModules, mockModule } from './loader.js';

const copyToClipboard = vi.fn();
const prepareForPrint = vi.fn(() => Promise.resolve());
mockModule('i18next', () => ({ default: { t: (key) => key } }));
mockModule('frontend/js/common/copyToClipboard.js', () => ({ copyToClipboard }));
mockModule('frontend/js/report/ReportMap.js', () => ({ ReportMap: class {} }));
mockModule('frontend/js/report/reportCards.js', () => ({ buildCard: vi.fn(), fetchCardData: vi.fn() }));
mockModule('frontend/js/report/ReportPage.js', () => ({
  ReportPage: class {
    start() {}

    prepareForPrint() { return prepareForPrint(); }
  },
}));

const PAGE = `
  <div id="report-shell" data-region-id="10" data-preset="coordinator"><main id="report-page">
    <a id="gallery" href="#" data-report-event="Report_OpenGallery"><span id="gallery-inner">5</span></a>
    <a id="plain" href="#">unlogged</a>
    <script type="application/json" id="report-data">{}</script>
    <div id="report-actions" hidden>
      <button id="report-print" type="button">Print</button>
      <button id="report-copy-link" type="button">Copy</button>
    </div>
  </main><aside id="report-sidebar"><button id="report-sidebar-toggle" hidden></button><div id="report-sidebar-body"></div></aside><nav id="report-toc"></nav></div>`;

describe('report page', () => {
  beforeAll(async () => {
    document.body.innerHTML = PAGE;
    window.logWebpageActivity = vi.fn();
    window.print = vi.fn();
    window.appManager = { ready: (fn) => fn() };
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

  test('the print button draws every card before it prints', async () => {
    let finish;
    prepareForPrint.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    document.getElementById('report-print').click();
    expect(prepareForPrint).toHaveBeenCalled();
    expect(window.print).not.toHaveBeenCalled();
    finish();
    await new Promise((resolve) => setTimeout(resolve));
    expect(window.print).toHaveBeenCalledTimes(1);
  });

  test('printing any other way logs it and still asks for the cards', () => {
    prepareForPrint.mockClear();
    window.dispatchEvent(new Event('beforeprint'));
    expect(prepareForPrint).toHaveBeenCalled();
    expect(window.logWebpageActivity).toHaveBeenCalledWith('Report_Print_Region=10_Preset=coordinator');
  });
});
