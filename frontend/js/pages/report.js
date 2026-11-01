/**
 * Entry point for a neighborhood report (#5876). The page is complete without this: it adds the print and copy-link
 * buttons, which can't work without JavaScript, and logs which of the report's links get used.
 */

import { copyToClipboard } from '../common/copyToClipboard.js';
import '../../css/pages/report.css';

/**
 * Asks for every lazy photo now and waits until they have settled. A browser prints what it has, so without this a
 * photo below the fold would print as a blank box.
 * @returns {Promise<void>} Resolves once every photo has loaded or failed.
 */
async function loadAllPhotos() {
  const photos = /** @type {HTMLImageElement[]} */ ([...document.querySelectorAll('.report-photo__image')]);
  for (const photo of photos) photo.loading = 'eager';
  await Promise.allSettled(photos.map((photo) => photo.decode()));
}

window.appManager.ready(() => {
  const page = document.getElementById('report-page');
  const { regionId, preset } = page.dataset;
  const log = (event) => window.logWebpageActivity(`${event}_Region=${regionId}_Preset=${preset}`);

  page.addEventListener('click', (e) => {
    const link = /** @type {Element} */ (e.target).closest('[data-report-event]');
    if (link) log(/** @type {HTMLElement} */ (link).dataset.reportEvent);
  });

  // Started before the button opens the dialog too, so a Ctrl+P also gets its photos as far as there's time for.
  window.addEventListener('beforeprint', () => {
    log('Report_Print');
    for (const photo of document.querySelectorAll('.report-photo__image')) {
      /** @type {HTMLImageElement} */ (photo).loading = 'eager';
    }
  });

  document.getElementById('report-print').addEventListener('click', async () => {
    await loadAllPhotos();
    window.print();
  });

  const copyButton = document.getElementById('report-copy-link');
  copyButton.addEventListener('click', () => {
    log('Report_CopyLink');
    copyToClipboard(copyButton, window.location.href);
  });

  document.getElementById('report-actions').hidden = false;
});
