/**
 * Entry point for a neighborhood report (#5876). The title, figures and street list are server-rendered; this adds what
 * can't be: the bars and dots through the score ramp, the contents' current section, the sidebar's controls, and the
 * log of which of the report's links get used.
 */

import { copyToClipboard } from '../common/copyToClipboard.js';
import { PageToc } from '../common/PageToc.js';
import { ScoreRamp } from '../common/scoreRamp.js';
import { wireSidebarDisclosure } from '../common/sidebarDisclosure.js';
import { ReportPage } from '../report/ReportPage.js';
import { ReportMap } from '../report/ReportMap.js';
import { buildCard, fetchCardData } from '../report/reportCards.js';
import '../../css/components/page-shell.css';
import '../../css/components/filter-sidebar.css';
import '../../css/components/info-button.css';
import '../../css/components/gallery-card.css';
import '../../css/components/gallery-tags.css';
import '../../css/pages/report.css';

/**
 * Paints each overview bar and contents dot from the score the server states, so they use the ramp's own colors.
 * @param {ParentNode} root - Where to look.
 */
function paintScores(root) {
  for (const bar of root.querySelectorAll('.report-rank__bar')) {
    const score = Number(/** @type {HTMLElement} */ (bar).dataset.score);
    /** @type {HTMLElement} */ (bar).style.width = `${Math.max(0, Math.min(1, score)) * 100}%`;
    /** @type {HTMLElement} */ (bar).style.background = ScoreRamp.at(score);
  }
  for (const element of root.querySelectorAll('.report-toc__dot')) {
    const dot = /** @type {HTMLElement} */ (element);
    dot.style.background = ScoreRamp.at(Number(dot.dataset.score));
  }
}

window.appManager.ready(() => {
  const shell = document.getElementById('report-shell');
  const { regionId } = shell.dataset;
  const log = (event) => window.logWebpageActivity(`${event}_Region=${regionId}`);

  paintScores(shell);

  const navbarHeight = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--navbar-height'), 10);
  new PageToc(document.getElementById('report-toc'), { topOffsetPx: navbarHeight || 0 });

  const sidebar = document.getElementById('report-sidebar');
  const toggle = /** @type {HTMLButtonElement} */ (document.getElementById('report-sidebar-toggle'));
  wireSidebarDisclosure(toggle, sidebar, {
    controlled: document.getElementById('report-sidebar-body'),
    onToggle: (open) => log(`Report_SidebarToggle_Open=${open}`),
  });
  toggle.hidden = false;

  shell.addEventListener('click', (e) => {
    const link = /** @type {Element} */ (e.target).closest('[data-report-event]');
    if (link) log(/** @type {HTMLElement} */ (link).dataset.reportEvent);
  });

  const data = JSON.parse(document.getElementById('report-data').textContent);
  const page = new ReportPage(data, {
    createMap: (container, options) => new ReportMap(container, options),
    fetchCards: fetchCardData,
    buildCard,
    log,
  });
  page.start();

  // Started before the button opens the dialog too, so a Ctrl+P also gets its cards as far as there's time for.
  window.addEventListener('beforeprint', () => {
    log('Report_Print');
    page.prepareForPrint();
  });

  document.getElementById('report-print').addEventListener('click', async () => {
    await page.prepareForPrint();
    window.print();
  });

  const copyButton = document.getElementById('report-copy-link');
  copyButton.addEventListener('click', () => {
    log('Report_CopyLink');
    copyToClipboard(copyButton, window.location.href);
  });

  document.getElementById('report-actions').hidden = false;
});
