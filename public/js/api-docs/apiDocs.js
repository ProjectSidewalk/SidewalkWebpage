/**
 * Project Sidewalk API Documentation JavaScript.
 *
 * This script handles the interactive features of the API documentation page:
 * - Accordion navigation in the sidebar (static grouping and dynamic page sections)
 * - Scroll spy to highlight active sections
 * - Dynamic TOC generation for right sidebar
 * - Mobile responsiveness
 * - Permalink copying
 * - Smooth scrolling
 *
 * In July 16, 2025, we also added industry standard behavior where clicking on permalink anchors (#) copies the full
 * URL to the clipboard with visual feedback.
 *
 * Features:
 * - Uses modern Clipboard API with fallback
 * - Provides visual feedback (toast notification)
 * - Accessible with keyboard support
 * - Follows web standards and best practices
 */

// Chart.js paints its labels onto a canvas, so they can't inherit the page font. The pages that chart load Chart.js
// ahead of this script, and build their charts once their data arrives.
if (typeof Chart !== 'undefined') {
  Chart.defaults.font.family = getComputedStyle(document.documentElement).getPropertyValue('--font-primary');
}

document.addEventListener('DOMContentLoaded', () => {
  const enableLeftSidebarAccordions = false; // Flag to disable left sidebar accordions.

  if (enableLeftSidebarAccordions) {
    // 1. Set up the static structure enhancements (grouping related links).
    setupStaticNavAccordions();

    // 2. Generate dynamic submenu for the current active page's headings.
    generateDynamicSidebarSubmenu();

    // 3. Set up ONE listener for all accordion toggles using event delegation.
    setupAccordionListener();
  }

  // 4. Initialize other features.
  generateTableOfContents();
  setupScrollSpy();
  initSidebarDisclosure();
  setupPermalinkCopying();
  setupSmoothScrolling();

  // 5. Initialize download buttons functionality with feedback.
  setupDownloadButtons();

  // 6. Initialize permalink clipboard functionality.
  initPermalinkClipboard();
});

/**
 * Finds related static nav items (e.g., 'page' and 'page#section') and groups them into an accordion structure in HTML.
 * Does NOT add event listeners here.
 */
function setupStaticNavAccordions() {
  console.log('Setting up static navigation accordions structure');
  const navContainer = document.querySelector('.page-nav');
  if (!navContainer) return;

  const navHeaders = navContainer.querySelectorAll('.page-nav-header');
  let submenuIdCounter = 0; // Counter for unique IDs.

  navHeaders.forEach((header) => {
    let nextElement = header.nextElementSibling;
    const potentialGroup = [];
    while (nextElement && !nextElement.classList.contains('page-nav-header')) {
      if (nextElement.tagName === 'A' && nextElement.classList.contains('page-nav-item')) {
        potentialGroup.push(nextElement);
      }
      nextElement = nextElement.nextElementSibling;
    }

    // Group items by base URL (path before #).
    const itemsByBaseUrl = potentialGroup.reduce((acc, item) => {
      const href = item.getAttribute('href') || '';
      const baseUrl = href.split('#')[0];
      if (!acc[baseUrl]) acc[baseUrl] = [];
      acc[baseUrl].push(item);
      return acc;
    }, {});

    // Process groups that have a base item + hash items.
    for (const baseUrl in itemsByBaseUrl) {
      const groupItems = itemsByBaseUrl[baseUrl];
      // Need at least one base item and one hash item (e.g., /intro and /intro#auth).
      const baseItem = groupItems.find((item) => item.getAttribute('href') === baseUrl);
      const hashItems = groupItems.filter((item) => item !== baseItem);

      if (baseItem && hashItems.length > 0) {
        // Check if already processed (e.g., by dynamic generation).
        if (baseItem.classList.contains('page-nav-accordion')) {
          console.log(`Skipping setup for already existing accordion: ${baseUrl}`);
          continue;
        }

        console.log(`Grouping static links under: ${baseUrl}`);
        const submenuId = `static-submenu-${submenuIdCounter++}`;

        // 1. Convert baseItem to accordion trigger.
        baseItem.classList.add('page-nav-accordion');
        baseItem.setAttribute('aria-expanded', 'false');
        baseItem.setAttribute('aria-controls', submenuId);

        // Add arrow indicator.
        const arrow = document.createElement('span');
        arrow.className = 'accordion-arrow';
        arrow.innerHTML = '⌵'; // Downwards arrow
        baseItem.appendChild(arrow);

        // 2. Create submenu container.
        const submenu = document.createElement('div');
        submenu.className = 'page-nav-submenu';
        submenu.id = submenuId;
        submenu.setAttribute('role', 'region');
        submenu.style.maxHeight = '0px'; // Start collapsed
        submenu.style.overflow = 'hidden';

        // 3. Move hashItems into the submenu.
        hashItems.forEach((item) => {
          // Optional: Add subitem class for styling.
          item.classList.add('page-nav-subitem');
          // Remove item from original position and append to submenu.
          item.parentNode.removeChild(item);
          submenu.appendChild(item);
        });

        // 4. Insert submenu after the baseItem.
        baseItem.parentNode.insertBefore(submenu, baseItem.nextSibling);
      }
    }
  });
  console.log('Static navigation accordions structure setup complete.');
}

/**
 * Finds the primary active nav item, scans content for H1/H2, and generates an expanded submenu structure in the HTML.
 * Does NOT add event listeners here.
 */
function generateDynamicSidebarSubmenu() {
  console.log('Generating dynamic sidebar submenu for active page');
  const activeNavItem = document.querySelector('.page-sidebar .page-nav-item.active');

  // Ensure it's a top-level item (not already inside a submenu).
  if (!activeNavItem || activeNavItem.closest('.page-nav-submenu')) {
    console.log('No suitable top-level active nav item found for dynamic submenu.');
    return;
  }

  const content = document.querySelector('.page-content');
  if (!content) {
    console.error('Content area not found for dynamic submenu generation.');
    return;
  }

  // Find H1 and H2 headings with IDs within the main content.
  const headings = content.querySelectorAll('h1[id].page-heading, h2[id].page-heading');
  if (headings.length === 0) {
    console.log('No H1/H2 headings with IDs found in content for dynamic submenu.');
    return;
  }

  console.log(`Found ${headings.length} headings for dynamic submenu.`);
  const submenuId = 'dynamic-submenu-active'; // Use a predictable ID

  // 1. Create submenu container
  const submenu = document.createElement('div');
  submenu.className = 'page-nav-submenu'; // JS will set initial maxHeight
  submenu.id = submenuId;
  submenu.setAttribute('role', 'region');
  submenu.style.overflow = 'hidden'; // Keep hidden during setup

  // 2. Populate submenu with links to headings.
  headings.forEach((heading) => {
    const id = heading.getAttribute('id');
    const title = heading.textContent.replace(/#$/, '').trim();
    const level = heading.tagName.toLowerCase(); // h1, h2

    const subItem = document.createElement('a');
    subItem.className = `page-nav-subitem level-${level}`;
    subItem.href = `#${id}`; // Link to the heading ID
    subItem.textContent = title;
    submenu.appendChild(subItem);
  });

  // 3. Convert the activeNavItem to be an accordion trigger.
  activeNavItem.classList.add('page-nav-accordion');
  activeNavItem.setAttribute('aria-expanded', 'true'); // Start expanded
  activeNavItem.setAttribute('aria-controls', submenuId);

  // Add arrow indicator if it doesn't have one already.
  if (!activeNavItem.querySelector('.accordion-arrow')) {
    const arrow = document.createElement('span');
    arrow.className = 'accordion-arrow';
    arrow.innerHTML = '⌵'; // Downwards arrow
    activeNavItem.appendChild(arrow);
  }

  // 4. Insert submenu after the activeNavItem.
  activeNavItem.parentNode.insertBefore(submenu, activeNavItem.nextSibling);

  // 5. Set initial expanded height (after insertion).
  // Use setTimeout to allow rendering engine to calculate scrollHeight.
  setTimeout(() => {
    submenu.style.maxHeight = `${submenu.scrollHeight}px`;
    console.log(`Dynamic submenu for ${activeNavItem.textContent.trim()} generated and expanded.`);
  }, 0);
}

/**
 * Sets up a single event listener on the navigation container to handle clicks on all accordion triggers using event
 * delegation.
 */
function setupAccordionListener() {
  const navContainer = document.querySelector('.page-sidebar .page-nav');
  if (!navContainer) {
    console.error('Navigation container .page-nav not found for accordion listener.');
    return;
  }

  navContainer.addEventListener('click', (event) => {
    // Find the closest ancestor that is an accordion trigger.
    const target = /** @type {Element} */ (event.target);
    const accordionTrigger = target.closest('.page-nav-accordion');

    if (accordionTrigger) {
      // Prevent default link behavior only if it's an actual link being used as trigger.
      if (accordionTrigger.tagName === 'A' && accordionTrigger.getAttribute('href')) {
        // Check if the click was directly on the trigger or its arrow, not on a link *inside* a submenu that might
        // bubble up.
        if (target === accordionTrigger || target.classList.contains('accordion-arrow')) {
          event.preventDefault();
        } else {
          return; // Allow clicks on nested links within trigger text (if any)
        }
      }

      const submenuId = accordionTrigger.getAttribute('aria-controls');
      const submenu = document.getElementById(submenuId);

      if (!submenu) {
        console.error(`Submenu with ID ${submenuId} not found for accordion trigger.`);
        return;
      }

      // Get current state and toggle ARIA attribute.
      const isExpanded = accordionTrigger.getAttribute('aria-expanded') === 'true';
      accordionTrigger.setAttribute('aria-expanded', String(!isExpanded));

      // Optional: Toggle an 'expanded' class for CSS hooks if needed.
      // accordionTrigger.classList.toggle('expanded', !isExpanded);
      // submenu.classList.toggle('expanded', !isExpanded);

      // Toggle max-height for animation.
      if (isExpanded) {
        // Collapse
        submenu.style.maxHeight = '0px';
        console.log(`Accordion collapsed: ${submenuId}`);
      } else {
        // Expand.
        submenu.style.maxHeight = `${submenu.scrollHeight}px`;
        console.log(`Accordion expanded: ${submenuId}`);
        // Optional: Handle nested accordions - if one opens, maybe close siblings?
      }
    }
  });

  console.log('Centralized accordion click listener initialized.');
}

/**
 * Generates the table of contents in the right sidebar based on headings in content.
 * @returns {void}
 */
function generateTableOfContents() {
  const content = document.querySelector('.page-content');
  const tocContainer = document.querySelector('.page-toc ul');

  if (!content || !tocContainer) {
    console.error('Could not find content or TOC container elements');
    return;
  }

  tocContainer.innerHTML = '';
  // Ensure headings have IDs.
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
 * Sets up scroll spy to highlight active TOC items based on scroll position. Left sidebar H1/H2 links are NOT
 * dynamically highlighted by scroll spy.
 * @returns {void}
 */
function setupScrollSpy() {
  const contentArea = document.querySelector('.page-content');
  if (!contentArea) return;

  // Select only elements with IDs for section detection.
  const contentSections = contentArea.querySelectorAll('[id]');
  // Select only links in the right TOC.
  const tocLinks = document.querySelectorAll('.page-toc a');

  if (contentSections.length === 0 || tocLinks.length === 0) {
    console.warn('No elements with IDs found in content or no TOC links found for scroll spy.');
    return;
  }

  // Create an array of section objects with their elements and top offsets.
  const sections = Array.from(contentSections).map((section) => ({
    id: section.id,
    offsetTop: section.offsetTop,
  })).sort((a, b) => a.offsetTop - b.offsetTop); // Sort by position

  // Calculate offset based on fixed header height + breathing room.
  const scrollOffset = parseInt(
    getComputedStyle(document.documentElement).getPropertyValue('--navbar-height') || '50', 10,
  ) + 20;

  function highlightActiveTocItem() {
    const scrollPosition = window.scrollY + scrollOffset;
    let currentSectionId = null;

    // Find the current section (last one whose top is above the scroll position).
    for (let i = sections.length - 1; i >= 0; i--) {
      if (sections[i].offsetTop <= scrollPosition) {
        currentSectionId = sections[i].id;
        break;
      }
    }

    // --- Highlight TOC Links (Exact Match) ---
    tocLinks.forEach((link) => {
      const linkHref = link.getAttribute('href');
      // Check if href exists and matches currentSectionId after removing '#'.
      if (linkHref && linkHref.substring(1) === currentSectionId) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });
  }

  // Debounce scroll handler.
  let scrollTimeout;
  window.addEventListener('scroll', () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(highlightActiveTocItem, 50);
  });

  // Initial highlight on load.
  setTimeout(highlightActiveTocItem, 100);
}

/**
 * Sets up smooth scrolling for TOC and sidebar hash links. Does NOT update left sidebar highlighting on click.
 * @returns {void}
 */
function setupSmoothScrolling() {
  // Target both TOC and Sidebar nav container.
  const scrollContainers = document.querySelectorAll('.page-toc, .page-sidebar .page-nav');
  if (scrollContainers.length === 0) return;

  const headerHeight = parseInt(
    getComputedStyle(document.documentElement).getPropertyValue('--navbar-height') || '50', 10,
  );
  const scrollPadding = 10; // Extra space above the target.

  scrollContainers.forEach((container) => {
    container.addEventListener('click', (event) => {
      const link = /** @type {Element} */ (event.target).closest('a');

      // Check if it's an internal hash link.
      if (link && link.getAttribute('href') && link.getAttribute('href').startsWith('#')) {
        // Allow accordion toggle clicks to be handled separately by setupAccordionListener.
        if (link.classList.contains('page-nav-accordion')) {
          // Make sure default wasn't already prevented by accordion listener if it exists.
          if (!event.defaultPrevented) {
            event.preventDefault(); // Prevent scrolling if clicking accordion header directly.
          }
          return; // Let accordion listener handle toggle, don't scroll.
        }

        // Prevent default scroll jump for non-accordion hash links.
        event.preventDefault();
        const targetId = link.getAttribute('href').substring(1);
        const targetElement = document.getElementById(targetId);

        if (targetElement) {
          // Perform smooth scroll.
          const elementPosition = targetElement.getBoundingClientRect().top;
          const offsetPosition = elementPosition + window.scrollY - headerHeight - scrollPadding;
          window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
        } else {
          console.warn(`Smooth scroll target element not found for id: ${targetId}`);
        }
      }
    });
  });
}

/**
 * Sets up click functionality for permalink icons to copy the URL.
 * @returns {void}
 */
function setupPermalinkCopying() {
  // Use event delegation on the content area for potentially dynamic headings.
  const contentArea = document.querySelector('.page-content');
  if (!contentArea) return;

  contentArea.addEventListener('click', (event) => {
    const permalink = /** @type {HTMLAnchorElement} */ (/** @type {Element} */ (event.target).closest('a.permalink'));
    if (permalink) {
      event.preventDefault();
      const urlToCopy = permalink.href; // The browser resolves the full URL in href.

      navigator.clipboard.writeText(urlToCopy).then(() => {
        showPermalinkTooltip(permalink, 'URL copied!');
      }).catch((err) => {
        console.error('Failed to copy URL:', err);
        showPermalinkTooltip(permalink, 'Copy failed!');
      });
    }
  });

  // Function to show tooltip.
  function showPermalinkTooltip(anchorElement, message) {
    // Remove existing tooltips first.
    document.querySelectorAll('.permalink-tooltip').forEach((tip) => tip.remove());

    const tooltip = document.createElement('div');
    tooltip.className = 'permalink-tooltip';
    tooltip.textContent = message;
    document.body.appendChild(tooltip);

    // Position near the clicked link.
    const rect = anchorElement.getBoundingClientRect();
    tooltip.style.left = `${rect.left + window.scrollX}px`;
    tooltip.style.top = `${rect.top + window.scrollY - tooltip.offsetHeight - 5}px`; // Position above

    // Fade out and remove.
    tooltip.style.opacity = '1'; // Ensure visible
    setTimeout(() => {
      tooltip.style.transition = 'opacity 0.5s ease-out';
      tooltip.style.opacity = '0';
      setTimeout(() => tooltip.remove(), 500); // Remove after fade
    }, 1500); // Tooltip visible duration
  }
}

/**
 * Sets up the download buttons. Each one fetches the file itself instead of handing the URL to the browser, since
 * only then can the page see the server's answer, the download's progress, and when it finishes.
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

  /**
   * Marks every button busy during a download. `aria-disabled` rather than `disabled`, which would drop the keyboard
   * focus to the body mid-download.
   */
  function setButtonsBusy(busy) {
    downloadButtons.forEach((btn) => {
      btn.setAttribute('aria-disabled', String(busy));
      btn.classList.toggle('disabled', busy);
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
      // no-store: a download is never worth a cache entry, and Chrome can make a request wait behind an identical
      // one it is caching.
      response = await fetch(url, { cache: 'no-store' });
    } catch {
      showStatus('error', 'The download failed before it started. The connection may have dropped. Please try again.');
      return;
    }

    if (response.status === 429) {
      // Shared with the Label Map so the two can't drift apart.
      const refused = typeof i18next !== 'undefined'
        ? i18next.t('common:download-already-preparing')
        : 'This file is already being prepared for another request. Please try again shortly.';
      showStatus('warning', refused);
      return;
    }
    if (!response.ok) {
      // API errors carry an RFC 7807 body, whose `detail` says more than the status number does.
      const problem = await response.json().catch(() => null);
      const detail = problem?.detail || problem?.title || '';
      showStatus('error', `The download failed (error ${response.status}). ${detail || 'Please try again.'}`);
      return;
    }

    // Streamed CSV/GeoJSON can't know their size until the last row. A built file's is in X-File-Size, which survives
    // the gzip that drops Content-Length; a compressed Content-Length would undercount what arrives here.
    const encoded = !!response.headers.get('Content-Encoding');
    const declaredSize = response.headers.get('X-File-Size') || (encoded ? '' : response.headers.get('Content-Length'));
    const totalBytes = Number(declaredSize) || 0;

    // Whole chunks are folded into a Blob as they pile up, since the browser can page a Blob out to disk but not an
    // array of buffers, and a city-wide file runs to hundreds of MB.
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

    // A stream that ends early but tidily raises no error, so a short file is only caught by counting. JSON and
    // GeoJSON have a closing bracket to check instead; a truncated CSV is indistinguishable from a complete one.
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
 * A JSON or GeoJSON body that ends before its closing bracket was cut off mid-flight (#4161). Any other format is
 * taken at face value, since nothing in it says where the end should be.
 *
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

/**
 * Initialize permalink clipboard functionality. Call this function when the DOM is ready.
 */
function initPermalinkClipboard() {
  // Find all permalink anchors (# links).
  const permalinks = document.querySelectorAll('.permalink');

  permalinks.forEach((permalink) => {
    // Make permalinks focusable and accessible.
    permalink.setAttribute('tabindex', '0');
    permalink.setAttribute('role', 'button');
    permalink.setAttribute('aria-label', 'Copy link to this section');
    permalink.setAttribute('title', 'Click to copy link');

    // Add click event listener.
    permalink.addEventListener('click', function (e) {
      e.preventDefault(); // Prevent default anchor behavior
      copyPermalinkToClipboard(this);
    });

    // Add keyboard support (Enter and Space)
    permalink.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        copyPermalinkToClipboard(this);
      }
    });

    // Add hover effect.
    permalink.addEventListener('mouseenter', function () {
      this.style.cursor = 'pointer';
    });
  });
}

/**
 * Copy permalink URL to clipboard with modern API and fallback.
 * @param {HTMLElement} permalinkElement - The clicked permalink anchor
 */
function copyPermalinkToClipboard(permalinkElement) {
  // Get the full URL including the hash.
  const currentUrl = window.location.href.split('#')[0];
  const hash = permalinkElement.getAttribute('href');
  const fullUrl = currentUrl + hash;

  // Try modern Clipboard API first.
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(fullUrl)
      .then(() => {
        showCopyFeedback(permalinkElement, 'success');
      })
      .catch((err) => {
        console.warn('Clipboard API failed, trying fallback:', err);
        fallbackCopyToClipboard(fullUrl, permalinkElement);
      });
  } else {
    // Fallback for older browsers or non-HTTPS.
    fallbackCopyToClipboard(fullUrl, permalinkElement);
  }
}

/**
 * Fallback copy method for older browsers.
 * @param {string} text - Text to copy
 * @param {HTMLElement} permalinkElement - The permalink element for feedback
 */
function fallbackCopyToClipboard(text, permalinkElement) {
  // Create temporary textarea.
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.left = '-999999px';
  textArea.style.top = '-999999px';
  document.body.appendChild(textArea);

  try {
    textArea.focus();
    textArea.select();
    const successful = document.execCommand('copy');

    if (successful) {
      showCopyFeedback(permalinkElement, 'success');
    } else {
      showCopyFeedback(permalinkElement, 'error');
    }
  } catch (err) {
    console.error('Fallback copy failed:', err);
    showCopyFeedback(permalinkElement, 'error');
  } finally {
    document.body.removeChild(textArea);
  }
}

/**
 * Show visual feedback when copy succeeds or fails.
 * @param {HTMLElement} permalinkElement - The permalink element
 * @param {string} status - 'success' or 'error'
 */
function showCopyFeedback(permalinkElement, status) {
  // Create toast notification.
  const toast = document.createElement('div');
  toast.className = `copy-toast copy-toast-${status}`;

  if (status === 'success') {
    toast.textContent = 'Link copied to clipboard!';
    toast.setAttribute('aria-live', 'polite');
  } else {
    toast.textContent = 'Failed to copy link';
    toast.setAttribute('aria-live', 'assertive');
  }

  // Position toast near the permalink.
  const rect = permalinkElement.getBoundingClientRect();
  toast.style.position = 'fixed';
  toast.style.left = `${rect.right + 10}px`;
  toast.style.top = `${rect.top - 5}px`;
  toast.style.zIndex = '10000';

  document.body.appendChild(toast);

  // Animate in.
  requestAnimationFrame(() => {
    toast.classList.add('copy-toast-visible');
  });

  // Remove after 2 seconds.
  setTimeout(() => {
    toast.classList.remove('copy-toast-visible');
    setTimeout(() => {
      if (toast.parentNode) {
        document.body.removeChild(toast);
      }
    }, 300); // Wait for fade out animation
  }, 2000);

  // Add brief visual feedback to the permalink itself.
  const feedbackClass = status === 'success' ? 'permalink--copied' : 'permalink--failed';
  permalinkElement.classList.add(feedbackClass);
  setTimeout(() => permalinkElement.classList.remove(feedbackClass), 500);
}
