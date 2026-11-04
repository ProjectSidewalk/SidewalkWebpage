/**
 * What every API docs page shares: the "On This Page" list and its highlight, smooth scrolling, copyable heading
 * links, the phone sidebar, and the download buttons.
 */

import i18next from 'i18next';
import { copyToClipboard } from '../common/copyToClipboard.js';
import { initSidebarDisclosure } from '../common/sidebarDisclosure.js';
import '../../css/components/page-shell.css';
import '../../css/components/progress-bar.css';

document.addEventListener('DOMContentLoaded', () => {
  generateTableOfContents();
  setupScrollSpy();
  initSidebarDisclosure();
  setupPermalinkCopying();
  setupSmoothScrolling();
  setupDownloadButtons();
});

/**
 * Generates the table of contents in the right sidebar based on headings in content.
 * @returns {void}
 */
export function generateTableOfContents() {
  const content = document.querySelector('.page-content');
  const tocContainer = document.querySelector('.page-toc ul');

  if (!content || !tocContainer) {
    console.error('Could not find content or TOC container elements');
    return;
  }

  tocContainer.innerHTML = '';
  const headings = content.querySelectorAll('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]');

  if (headings.length === 0) {
    console.warn('No headings with IDs found in content for TOC');
    return;
  }

  headings.forEach((heading) => {
    const id = heading.getAttribute('id');
    const title = heading.textContent.replace(/#$/, '').trim();
    const level = parseInt(heading.tagName.substring(1), 10);

    const li = document.createElement('li');
    li.classList.add(`toc-level-${level}`);

    const a = document.createElement('a');
    a.href = `#${id}`;
    a.textContent = title;
    li.appendChild(a);
    tocContainer.appendChild(li);
  });
}

/**
 * Sets up scroll spy to highlight active TOC items based on scroll position.
 * @returns {void}
 */
export function setupScrollSpy() {
  const contentArea = document.querySelector('.page-content');
  if (!contentArea) return;

  const contentSections = contentArea.querySelectorAll('[id]');
  const tocLinks = document.querySelectorAll('.page-toc a');

  if (contentSections.length === 0 || tocLinks.length === 0) {
    console.warn('No elements with IDs found in content or no TOC links found for scroll spy.');
    return;
  }

  const sections = Array.from(contentSections).map((section) => ({
    id: section.id,
    offsetTop: section.offsetTop,
  })).sort((a, b) => a.offsetTop - b.offsetTop); // Sort by position

  const scrollOffset = parseInt(
    getComputedStyle(document.documentElement).getPropertyValue('--navbar-height') || '50', 10,
  ) + 20;

  function highlightActiveTocItem() {
    const scrollPosition = window.scrollY + scrollOffset;
    let currentSectionId = null;

    for (let i = sections.length - 1; i >= 0; i--) {
      if (sections[i].offsetTop <= scrollPosition) {
        currentSectionId = sections[i].id;
        break;
      }
    }

    tocLinks.forEach((link) => {
      const linkHref = link.getAttribute('href');
      if (linkHref && linkHref.substring(1) === currentSectionId) {
        link.classList.add('is-active');
      } else {
        link.classList.remove('is-active');
      }
    });
  }

  let scrollTimeout;
  window.addEventListener('scroll', () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(highlightActiveTocItem, 50);
  });

  setTimeout(highlightActiveTocItem, 100);
}

/**
 * Sets up smooth scrolling for the TOC's links to headings on this page.
 * @returns {void}
 */
function setupSmoothScrolling() {
  const toc = document.querySelector('.page-toc');
  if (!toc) return;

  const headerHeight = parseInt(
    getComputedStyle(document.documentElement).getPropertyValue('--navbar-height') || '50', 10,
  );
  const scrollPadding = 10; // Extra space above the target.

  toc.addEventListener('click', (event) => {
    const link = /** @type {Element} */ (event.target).closest('a');

    if (link && link.getAttribute('href') && link.getAttribute('href').startsWith('#')) {
      event.preventDefault();
      const targetId = link.getAttribute('href').substring(1);
      const targetElement = document.getElementById(targetId);

      if (targetElement) {
        const elementPosition = targetElement.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.scrollY - headerHeight - scrollPadding;
        window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
      } else {
        console.warn(`Smooth scroll target element not found for id: ${targetId}`);
      }
    }
  });
}

/**
 * Makes each heading's "#" link copy its URL instead of jumping. Listens on the page, so headings added later work too.
 * @returns {void}
 */
function setupPermalinkCopying() {
  const contentArea = document.querySelector('.page-content');
  if (!contentArea) return;

  // Translations load after DOMContentLoaded.
  window.appManager.ready(() => {
    contentArea.querySelectorAll('a.permalink').forEach((permalink) => {
      const label = i18next.t('common:copy.section-link');
      permalink.setAttribute('aria-label', label);
      permalink.setAttribute('data-ps-tooltip', label);
    });
  });

  contentArea.addEventListener('click', (event) => {
    const permalink = /** @type {HTMLAnchorElement} */ (/** @type {Element} */ (event.target).closest('a.permalink'));
    if (!permalink) return;
    event.preventDefault();
    copyToClipboard(permalink, permalink.href); // The browser resolves href to the full URL.
  });
}

/**
 * Sets up the download buttons. They fetch the file themselves, so the page can show the server's answer and progress.
 */
function setupDownloadButtons() {
  const downloadButtonsContainer = document.querySelector('.download-buttons');
  if (!downloadButtonsContainer) return;

  const downloadButtons = /** @type {NodeListOf<HTMLButtonElement>} */ (
    downloadButtonsContainer.querySelectorAll('.download-btn')
  );

  // The changing numbers sit outside the live region, so screen readers aren't interrupted on every update.
  const statusBox = document.createElement('div');
  statusBox.className = 'download-status';
  statusBox.innerHTML = `
    <span class="download-status-icon" aria-hidden="true"></span>
    <span class="download-status-message" role="status"></span>
    <span class="download-status-detail" aria-hidden="true"></span>
    <div class="ps-progress-bar download-status-bar ps-hidden" role="progressbar" aria-label="Download progress"
         aria-valuemin="0" aria-valuemax="100">
      <div class="ps-progress-bar__track"><div class="ps-progress-bar__fill"></div></div>
    </div>`;
  downloadButtonsContainer.after(statusBox);
  const statusIcon = statusBox.querySelector('.download-status-icon');
  const statusMessage = statusBox.querySelector('.download-status-message');
  const statusDetail = statusBox.querySelector('.download-status-detail');
  const statusBar = /** @type {HTMLElement} */ (statusBox.querySelector('.download-status-bar'));
  const statusBarFill = /** @type {HTMLElement} */ (statusBox.querySelector('.ps-progress-bar__fill'));

  /**
   * @param {'working'|'done'|'warning'|'error'} state - Picks the icon: a spinner while working, else a symbol.
   * @param {string} message - The stage, e.g. "Downloading the CSV file".
   * @param {string} [detail] - Progress numbers shown beside the message.
   * @param {?number} [percent] - Fills the progress bar; null hides it, for files whose size isn't known.
   */
  function showStatus(state, message, detail = '', percent = null) {
    statusBox.dataset.state = state;
    const iconClass = state === 'working' ? 'loading-spinner' : `ps-mask-icon download-status-icon--${state}`;
    statusIcon.className = `download-status-icon ${iconClass}`;
    if (statusMessage.textContent !== message) statusMessage.textContent = message;
    statusDetail.textContent = detail;
    statusBar.classList.toggle('ps-hidden', percent === null);
    // Reset rather than leave the last download's width, which the next one would animate backwards from.
    statusBarFill.style.width = `${percent ?? 0}%`;
    statusBar.setAttribute('aria-valuenow', String(percent ?? 0));
  }

  /** Marks every button busy. `aria-disabled`, since `disabled` would knock keyboard focus off the button. */
  function setButtonsBusy(busy) {
    downloadButtons.forEach((btn) => {
      btn.setAttribute('aria-disabled', String(busy));
    });
  }

  /** The file is lost if the page closes mid-download, which a plain browser download would have survived. */
  const warnBeforeLeaving = (event) => event.preventDefault();

  downloadButtons.forEach((button) => {
    const format = button.getAttribute('data-format');
    const formatName = [...button.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent.trim())
      .join('') || format;

    button.addEventListener('click', async (event) => {
      event.preventDefault();
      if (button.getAttribute('aria-disabled') === 'true') return;
      const apiBaseUrl = document.documentElement.getAttribute('data-api-base-url') || '/v3/api';
      const currentPage = document.documentElement.getAttribute('data-api-endpoint')
        || 'NEEDS_TO_BE_SET_BY_API_DOC_PAGE';
      const downloadUrl = `${apiBaseUrl}/${currentPage}?filetype=${format}`;

      setButtonsBusy(true);
      // Only while a download is running: a listener left in place would keep the page out of the back/forward cache.
      window.addEventListener('beforeunload', warnBeforeLeaving);
      try {
        await downloadFile(downloadUrl, format, formatName);
      } catch (error) {
        showStatus('error', 'Something went wrong with the download. Please try again.');
        console.error('Download failed', error);
      } finally {
        window.removeEventListener('beforeunload', warnBeforeLeaving);
        setButtonsBusy(false);
      }
    });
  });

  /**
   * Fetches a file, reporting each stage, and saves it once it has fully arrived.
   *
   * @param {string} url - The file's API URL.
   * @param {string} format - The `filetype` value, which names the saved file when the server doesn't.
   * @param {string} formatName - The format, as shown to the user.
   * @returns {Promise<void>}
   */
  async function downloadFile(url, format, formatName) {
    showStatus('working', `Preparing the ${formatName} file`);

    let response;
    try {
      // no-store: Chrome can hold a request back behind an identical one it's still caching.
      response = await fetch(url, { cache: 'no-store' });
    } catch {
      showStatus('error', 'The download failed before it started. The connection may have dropped. Please try again.');
      return;
    }

    if (response.status === 429) {
      // Shared with the Label Map so the two can't drift apart.
      showStatus('warning', i18next.t('common:download-already-preparing'));
      return;
    }
    if (!response.ok) {
      // API errors carry an RFC 7807 body, whose `detail` says more than the status number does.
      const problem = await response.json().catch(() => null);
      const detail = problem?.detail || problem?.title || '';
      showStatus('error', `The download failed (error ${response.status}). ${detail || 'Please try again.'}`);
      return;
    }

    // A streamed file has no size up front. A built one sends X-File-Size, since gzip drops or shrinks Content-Length.
    const encoded = !!response.headers.get('Content-Encoding');
    const declaredSize = response.headers.get('X-File-Size') || (encoded ? '' : response.headers.get('Content-Length'));
    const totalBytes = Number(declaredSize) || 0;

    // Chunks are folded into a Blob as they pile up: a city's file can be hundreds of MB, and a Blob can go to disk.
    let blob = new Blob([], { type: response.headers.get('Content-Type') || '' });
    let chunks = [];
    let pending = 0;
    let receivedBytes = 0;
    let lastPaint = 0;
    try {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        pending += value.length;
        receivedBytes += value.length;
        if (pending > BLOB_FOLD_BYTES) {
          blob = new Blob([blob, ...chunks], { type: blob.type });
          chunks = [];
          pending = 0;
        }
        // Chunks arrive thousands of times a second on a fast connection; repainting on each one stalls the page.
        if (Date.now() - lastPaint < 250) continue;
        lastPaint = Date.now();
        const message = `Downloading the ${formatName} file`;
        if (totalBytes) {
          const percent = Math.min(100, Math.floor((receivedBytes / totalBytes) * 100));
          showStatus('working', message, `${formatBytes(receivedBytes)} of ${formatBytes(totalBytes)}`, percent);
        } else {
          showStatus('working', message, formatBytes(receivedBytes));
        }
      }
      blob = new Blob([blob, ...chunks], { type: blob.type });
    } catch {
      showStatus('error', 'The download stopped before it finished. Please try again.');
      return;
    }

    // A stream can end early without an error, so check the size, or for JSON the closing bracket.
    const short = totalBytes ? receivedBytes < totalBytes : !(await endsCompletely(blob));
    if (short) {
      showStatus('error', 'The download stopped before it finished. Please try again.');
      return;
    }

    const filename = filenameFromDisposition(response.headers.get('Content-Disposition'))
      || `${document.documentElement.getAttribute('data-api-endpoint')}.${FILE_EXTENSIONS[format] || format}`;
    const blobUrl = URL.createObjectURL(blob);
    const saveLink = document.createElement('a');
    saveLink.href = blobUrl;
    saveLink.download = filename;
    document.body.appendChild(saveLink);
    saveLink.click();
    saveLink.remove();
    // Revoking right away can cancel the save in some browsers.
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    showStatus('done', `Downloaded ${filename}`, formatBytes(receivedBytes));
  }
}

/** How much is held as loose buffers before being folded into the Blob. */
const BLOB_FOLD_BYTES = 32 * 1024 * 1024;

/** Extensions for a file the server didn't name, keyed by the `filetype` the button asks for. */
const FILE_EXTENSIONS = {
  csv: 'csv',
  json: 'json',
  geojson: 'geojson',
  shapefile: 'zip',
  geopackage: 'gpkg',
};

/**
 * A JSON body without its closing bracket was cut off (#4161). Other formats are taken as they are.
 * @param {Blob} blob - The downloaded file.
 * @returns {Promise<boolean>} False only when the file is provably incomplete.
 */
async function endsCompletely(blob) {
  if (!blob.type.includes('json')) return true;
  const tail = (await blob.slice(-16).text()).trimEnd();
  return tail.endsWith('}') || tail.endsWith(']');
}

/**
 * @param {number} bytes - A size in bytes.
 * @returns {string} The size in KB or MB, like "12.3 MB".
 */
function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * @param {?string} disposition - A Content-Disposition header.
 * @returns {?string} The filename the server gave the file, if any.
 */
function filenameFromDisposition(disposition) {
  const match = disposition?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  if (!match) return null;
  // A stray % is not an escape, and decoding it throws.
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}
