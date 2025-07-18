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

document.addEventListener('DOMContentLoaded', function() {
    console.log('API Docs script initialized');

    let enableLeftSidebarAccordions = false; // Flag to disable left sidebar accordions.

    if(enableLeftSidebarAccordions){
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
    setupMobileNavigation();
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
    const navContainer = document.querySelector('.api-nav');
    if (!navContainer) return;

    const navHeaders = navContainer.querySelectorAll('.api-nav-header');
    let submenuIdCounter = 0; // Counter for unique IDs.

    navHeaders.forEach(header => {
        let nextElement = header.nextElementSibling;
        const potentialGroup = [];
        while (nextElement && !nextElement.classList.contains('api-nav-header')) {
            if (nextElement.tagName === 'A' && nextElement.classList.contains('api-nav-item')) {
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
            const baseItem = groupItems.find(item => item.getAttribute('href') === baseUrl);
            const hashItems = groupItems.filter(item => item !== baseItem);

            if (baseItem && hashItems.length > 0) {
                // Check if already processed (e.g., by dynamic generation).
                if (baseItem.classList.contains('api-nav-accordion')) {
                    console.log(`Skipping setup for already existing accordion: ${baseUrl}`);
                    continue;
                }

                console.log(`Grouping static links under: ${baseUrl}`);
                const submenuId = `static-submenu-${submenuIdCounter++}`;

                // 1. Convert baseItem to accordion trigger.
                baseItem.classList.add('api-nav-accordion');
                baseItem.setAttribute('aria-expanded', 'false');
                baseItem.setAttribute('aria-controls', submenuId);

                // Add arrow indicator.
                const arrow = document.createElement('span');
                arrow.className = 'accordion-arrow';
                arrow.innerHTML = '⌵'; // Downwards arrow
                baseItem.appendChild(arrow);

                // 2. Create submenu container.
                const submenu = document.createElement('div');
                submenu.className = 'api-nav-submenu';
                submenu.id = submenuId;
                submenu.setAttribute('role', 'region');
                submenu.style.maxHeight = '0px'; // Start collapsed
                submenu.style.overflow = 'hidden';

                // 3. Move hashItems into the submenu.
                hashItems.forEach(item => {
                    // Optional: Add subitem class for styling.
                    item.classList.add('api-nav-subitem');
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
    const activeNavItem = document.querySelector('.api-sidebar .api-nav-item.active');

    // Ensure it's a top-level item (not already inside a submenu).
    if (!activeNavItem || activeNavItem.closest('.api-nav-submenu')) {
        console.log('No suitable top-level active nav item found for dynamic submenu.');
        return;
    }

    const content = document.querySelector('.api-content');
    if (!content) {
        console.error('Content area not found for dynamic submenu generation.');
        return;
    }

    // Find H1 and H2 headings with IDs within the main content.
    const headings = content.querySelectorAll('h1[id].api-heading, h2[id].api-heading');
    if (headings.length === 0) {
        console.log('No H1/H2 headings with IDs found in content for dynamic submenu.');
        return;
    }

    console.log(`Found ${headings.length} headings for dynamic submenu.`);
    const submenuId = 'dynamic-submenu-active'; // Use a predictable ID

    // 1. Create submenu container
    const submenu = document.createElement('div');
    submenu.className = 'api-nav-submenu'; // JS will set initial maxHeight
    submenu.id = submenuId;
    submenu.setAttribute('role', 'region');
    submenu.style.overflow = 'hidden'; // Keep hidden during setup

    // 2. Populate submenu with links to headings.
    headings.forEach(heading => {
        const id = heading.getAttribute('id');
        const title = heading.textContent.replace(/#$/, '').trim();
        const level = heading.tagName.toLowerCase(); // h1, h2

        const subItem = document.createElement('a');
        subItem.className = `api-nav-subitem level-${level}`;
        subItem.href = `#${id}`; // Link to the heading ID
        subItem.textContent = title;
        submenu.appendChild(subItem);
    });

    // 3. Convert the activeNavItem to be an accordion trigger.
    activeNavItem.classList.add('api-nav-accordion');
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
        submenu.style.maxHeight = submenu.scrollHeight + 'px';
        console.log(`Dynamic submenu for ${activeNavItem.textContent.trim()} generated and expanded.`);
    }, 0);
}


/**
 * Sets up a single event listener on the navigation container to handle clicks on all accordion triggers using event
 * delegation.
 */
function setupAccordionListener() {
    const navContainer = document.querySelector('.api-sidebar .api-nav');
    if (!navContainer) {
        console.error('Navigation container .api-nav not found for accordion listener.');
        return;
    }

    navContainer.addEventListener('click', function(event) {
        // Find the closest ancestor that is an accordion trigger.
        const accordionTrigger = event.target.closest('.api-nav-accordion');

        if (accordionTrigger) {
            // Prevent default link behavior only if it's an actual link being used as trigger.
            if (accordionTrigger.tagName === 'A' && accordionTrigger.getAttribute('href')) {
                // Check if the click was directly on the trigger or its arrow, not on a link *inside* a submenu that might
                // bubble up.
                if (event.target === accordionTrigger || event.target.classList.contains('accordion-arrow')) {
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
            accordionTrigger.setAttribute('aria-expanded', !isExpanded);

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
                submenu.style.maxHeight = submenu.scrollHeight + 'px';
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
    const content = document.querySelector('.api-content');
    const tocContainer = document.querySelector('.api-toc ul');

    if (!content || !tocContainer) {
        console.error('Could not find content or TOC container elements');
        return;
    }

    tocContainer.innerHTML = '';
    const headings = content.querySelectorAll('h1[id], h2[id], h3[id], h4[id], h5[id], h6[id]'); // Ensure headings have IDs

    if (headings.length === 0) {
        console.warn('No headings with IDs found in content for TOC');
        return;
    }

    let headingsAdded = 0;
    headings.forEach(heading => {
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
        headingsAdded++;
    });

    console.log(`TOC generated: ${headingsAdded} items added from ${headings.length} headings found.`);
}


/**
 * Sets up scroll spy to highlight active TOC items based on scroll position. Left sidebar H1/H2 links are NOT
 * dynamically highlighted by scroll spy.
 * @returns {void}
 */
function setupScrollSpy() {
    const contentArea = document.querySelector('.api-content');
    if (!contentArea) return;

    // Select only elements with IDs for section detection.
    const contentSections = contentArea.querySelectorAll('[id]');
    // Select only links in the right TOC.
    const tocLinks = document.querySelectorAll('.api-toc a');

    if (contentSections.length === 0 || tocLinks.length === 0) {
        console.warn('No elements with IDs found in content or no TOC links found for scroll spy.');
        return;
    }

    // Create an array of section objects with their elements and top offsets.
    const sections = Array.from(contentSections).map(section => ({
        id: section.id,
        offsetTop: section.offsetTop
    })).sort((a, b) => a.offsetTop - b.offsetTop); // Sort by position

    // Calculate offset based on fixed header height + breathing room.
    const scrollOffset = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--header-height') || '50', 10) + 20;

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
        tocLinks.forEach(link => {
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

    console.log('Scroll spy initialized (TOC only).');
}


/**
 * Sets up smooth scrolling for TOC and sidebar hash links. Does NOT update left sidebar highlighting on click.
 * @returns {void}
 */
function setupSmoothScrolling() {
    // Target both TOC and Sidebar nav container.
    const scrollContainers = document.querySelectorAll('.api-toc, .api-sidebar .api-nav');
    if (scrollContainers.length === 0) return;

    const headerHeight = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--header-height') || '50', 10);
    const scrollPadding = 10; // Extra space above the target.

    scrollContainers.forEach(container => {
        container.addEventListener('click', function(event) {
            const link = event.target.closest('a');

            // Check if it's an internal hash link.
            if (link && link.getAttribute('href') && link.getAttribute('href').startsWith('#')) {
                // Allow accordion toggle clicks to be handled separately by setupAccordionListener.
                if (link.classList.contains('api-nav-accordion')) {
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
    console.log('Smooth scrolling initialized.');
}


/**
 * Sets up mobile-specific navigation behavior (toggle button).
 * @returns {void}
 */
function setupMobileNavigation() {
    const sidebar = document.querySelector('.api-sidebar');
    const toggleButton = document.querySelector('.api-sidebar-toggle');

    // Only create toggle if it doesn't exist and sidebar exists.
    if (sidebar && !toggleButton) {
        const button = document.createElement('button');
        button.className = 'api-sidebar-toggle';
        button.innerHTML = '☰ Menu';
        button.setAttribute('aria-label', 'Toggle Navigation Menu');
        button.setAttribute('aria-expanded', 'false'); // Initial state is closed
        button.setAttribute('aria-controls', 'api-sidebar-nav'); // Assuming sidebar nav has this ID

        // Add ID to nav container if it doesn't have one.
        const nav = sidebar.querySelector('.api-nav');
        if (nav && !nav.id) {
            nav.id = 'api-sidebar-nav';
        }

        button.addEventListener('click', function() {
            const isVisible = sidebar.classList.toggle('mobile-visible');
            this.setAttribute('aria-expanded', isVisible);
            this.innerHTML = isVisible ? '✕ Close' : '☰ Menu';
        });

        // Insert button at the beginning of the body or a designated header area.
        document.body.insertBefore(button, document.body.firstChild);
        console.log('Mobile navigation toggle initialized.');
    } else if (toggleButton) {
        console.log('Mobile navigation toggle already exists.');
    }
}


/**
 * Sets up click functionality for permalink icons to copy the URL.
 * @returns {void}
 */
function setupPermalinkCopying() {
    // Use event delegation on the content area for potentially dynamic headings.
    const contentArea = document.querySelector('.api-content');
    if (!contentArea) return;

    contentArea.addEventListener('click', function(event) {
        const permalink = event.target.closest('a.permalink');
        if (permalink) {
            event.preventDefault();
            const urlToCopy = permalink.href; // The browser resolves the full URL in href.

            navigator.clipboard.writeText(urlToCopy).then(() => {
                showPermalinkTooltip(permalink, 'URL copied!');
            }).catch(err => {
                console.error('Failed to copy URL:', err);
                showPermalinkTooltip(permalink, 'Copy failed!');
            });
        }
    });

    // Function to show tooltip.
    function showPermalinkTooltip(anchorElement, message) {
        // Remove existing tooltips first.
        document.querySelectorAll('.permalink-tooltip').forEach(tip => tip.remove());

        const tooltip = document.createElement('div');
        tooltip.className = 'permalink-tooltip';
        tooltip.textContent = message;
        document.body.appendChild(tooltip);

        // Position near the clicked link.
        const rect = anchorElement.getBoundingClientRect();
        tooltip.style.left = `${rect.left + window.scrollX}px`;
        tooltip.style.top = `${rect.top + window.scrollY - tooltip.offsetHeight - 5}px`; // Position above

        // Fade out and remove.
        tooltip.style.opacity = 1; // Ensure visible
        setTimeout(() => {
            tooltip.style.transition = 'opacity 0.5s ease-out';
            tooltip.style.opacity = 0;
            setTimeout(() => tooltip.remove(), 500); // Remove after fade
        }, 1500); // Tooltip visible duration
    }

    console.log('Permalink copying initialized using event delegation.');
}

/**
 * Sets up download buttons with reliable status messages that clear properly.
 */
function setupDownloadButtons() {
    console.log('Starting setupDownloadButtons function');
    const downloadButtonsContainer = document.querySelector('.download-buttons');
    if (!downloadButtonsContainer) return;

    const downloadButtons = downloadButtonsContainer.querySelectorAll('.download-btn');
    const downloadStatus = document.getElementById('download-status');
    if (!downloadStatus) return;

    downloadStatus.className = 'status-container status-loading';
    const statusMessage = downloadStatus.querySelector('.status-message');
    const statusProgress = downloadStatus.querySelector('.status-progress');

    downloadButtons.forEach((button) => {
        const format = button.getAttribute('data-format');

        button.addEventListener('click', function(event) {
            console.log(`${format.toUpperCase()} download button clicked`);
            event.preventDefault();

            // Get API URL information.
            const apiBaseUrl = document.documentElement.getAttribute('data-api-base-url') || '/v3/api';
            const currentPage = document.documentElement.getAttribute('data-api-endpoint') || 'NEEDS_TO_BE_SET_BY_API_DOC_PAGE';
            const downloadUrl = `${apiBaseUrl}/${currentPage}?filetype=${format}`;

            // CRITICAL: Track download state globally for this download. Ensures we can properly update status message.
            const downloadState = {
                initiated: false,
                started: false,
                completed: false,
                failed: false,
                timeouts: []
            };

            // Show loading status.
            downloadStatus.style.display = 'block';
            if (statusMessage) statusMessage.textContent = `Preparing ${format.toUpperCase()} file...`;
            if (statusProgress) statusProgress.textContent = `This process can take a few seconds to a minute, depending on the data size.`;

            // Disable all download buttons during processing.
            downloadButtons.forEach(btn => {
                btn.disabled = true;
                btn.classList.add('disabled');
            });

            // Function to clean up all resources.
            function cleanupDownload(hideStatus = true) {
                console.log('Cleaning up download resources');

                // Clear all timeouts.
                downloadState.timeouts.forEach(timeout => clearTimeout(timeout));
                downloadState.timeouts = [];

                // Re-enable buttons.
                downloadButtons.forEach(btn => {
                    btn.disabled = false;
                    btn.classList.remove('disabled');
                });

                // Hide status if requested.
                if (hideStatus) {
                    downloadStatus.style.display = 'none';
                    if (statusMessage) statusMessage.style.color = ''; // Reset color
                }
            }

            // Set up progressive status updates for longer downloads.
            downloadState.timeouts.push(setTimeout(() => {
                if (!downloadState.started && !downloadState.completed) {
                    if (statusMessage) statusMessage.textContent = 'Processing request...';
                    if (statusProgress) statusProgress.textContent = 'The server is generating your file.';
                }
            }, 5000));

            downloadState.timeouts.push(setTimeout(() => {
                if (!downloadState.started && !downloadState.completed) {
                    if (statusMessage) statusMessage.textContent = 'Still working...';
                    if (statusProgress) statusProgress.textContent = 'Larger datasets take more time to process.';
                }
            }, 15000));

            downloadState.timeouts.push(setTimeout(() => {
                if (!downloadState.started && !downloadState.completed) {
                    if (statusMessage) statusMessage.textContent = 'Almost there...';
                    if (statusProgress) statusProgress.textContent = 'Your download should begin soon.';
                }
            }, 30000));

            // After 60 seconds, if download hasn't started, show "taking longer" message
            // BUT, make this message automatically clear after 10 more seconds.
            downloadState.timeouts.push(setTimeout(() => {
                if (!downloadState.started && !downloadState.completed) {
                    if (statusMessage) {
                        statusMessage.textContent = 'Taking longer than expected.';
                        statusMessage.style.color = '#f39c12'; // Warning color
                    }
                    if (statusProgress) statusProgress.textContent = 'You can try again or try a different format.';

                    // Re-enable buttons after 60 seconds regardless.
                    downloadButtons.forEach(btn => {
                        btn.disabled = false;
                        btn.classList.remove('disabled');
                    });

                    // Hide the message after 10 more seconds.
                    downloadState.timeouts.push(setTimeout(() => {
                        if (!downloadState.started && !downloadState.completed) {
                            downloadStatus.style.display = 'none';
                            if (statusMessage) statusMessage.style.color = ''; // Reset color
                        }
                    }, 10000));
                }
            }, 60000));

            // Create download link and initiate download.
            console.log(`Starting download: ${downloadUrl}`);
            const downloadLink = document.createElement('a');
            downloadLink.href = downloadUrl;
            downloadLink.setAttribute('download', '');
            downloadLink.style.display = 'none';
            document.body.appendChild(downloadLink);

            // Create an XMLHttpRequest to monitor the download progress.
            const xhr = new XMLHttpRequest();
            xhr.open('GET', downloadUrl, true);

            // Track response timing.
            const startTime = Date.now();
            downloadState.initiated = true;

            // Handle successful response - this fires when headers are received.
            xhr.onreadystatechange = function() {
                if (xhr.readyState === 2) { // HEADERS_RECEIVED
                    const responseTime = Date.now() - startTime;
                    console.log(`Headers received after ${responseTime}ms`);

                    // Check if we got a success response.
                    if (xhr.status === 200) {
                        console.log('Download started successfully');
                        downloadState.started = true;

                        // Update status message.
                        if (statusMessage) statusMessage.textContent = 'Download started!';
                        if (statusProgress) statusProgress.textContent = 'Your file will appear in your downloads shortly.';

                        // Calculate appropriate display time for status message. Shorter for quick responses, longer
                        // for slower ones.
                        const displayDuration = Math.min(
                            Math.max(responseTime * 2, 5000), // At least 5 seconds, or 2x response time
                            15000 // Maximum 15 seconds
                        );

                        console.log(`Status will hide after ${displayDuration}ms`);

                        // Hide status and cleanup after appropriate delay.
                        downloadState.timeouts.push(setTimeout(() => {
                            downloadState.completed = true;
                            cleanupDownload(true); // Hide status and clean up
                        }, displayDuration));
                    }
                }
            };

            // Handle error.
            xhr.onerror = function() {
                console.error('XHR error');
                downloadState.failed = true;

                if (statusMessage) {
                    statusMessage.textContent = 'Error starting download.';
                    statusMessage.style.color = 'red';
                }
                if (statusProgress) statusProgress.textContent = 'Please try again or try a different format.';

                // Clean up but leave error message visible.
                downloadState.timeouts.forEach(timeout => clearTimeout(timeout));
                downloadState.timeouts = [];

                // Re-enable buttons.
                downloadButtons.forEach(btn => {
                    btn.disabled = false;
                    btn.classList.remove('disabled');
                });

                // Hide error message after 5 seconds.
                downloadState.timeouts.push(setTimeout(() => {
                    downloadStatus.style.display = 'none';
                    if (statusMessage) statusMessage.style.color = ''; // Reset color
                }, 5000));
            };

            // Start monitoring the download and trigger actual download.
            xhr.send();
            downloadLink.click();

            // Remove download link after click.
            setTimeout(() => {
                if (document.body.contains(downloadLink)) {
                    document.body.removeChild(downloadLink);
                }
            }, 1000);
        });
    });

    console.log('Download buttons initialization complete');
}

/**
 * Initialize permalink clipboard functionality. Call this function when the DOM is ready.
 */
function initPermalinkClipboard() {
    // Find all permalink anchors (# links).
    const permalinks = document.querySelectorAll('.permalink');

    permalinks.forEach(function(permalink) {
        // Make permalinks focusable and accessible.
        permalink.setAttribute('tabindex', '0');
        permalink.setAttribute('role', 'button');
        permalink.setAttribute('aria-label', 'Copy link to this section');
        permalink.setAttribute('title', 'Click to copy link');

        // Add click event listener.
        permalink.addEventListener('click', function(e) {
            e.preventDefault(); // Prevent default anchor behavior
            copyPermalinkToClipboard(this);
        });

        // Add keyboard support (Enter and Space)
        permalink.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                copyPermalinkToClipboard(this);
            }
        });

        // Add hover effect.
        permalink.addEventListener('mouseenter', function() {
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
            .then(function() {
                showCopyFeedback(permalinkElement, 'success');
            })
            .catch(function(err) {
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
    toast.className = 'copy-toast copy-toast-' + status;

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
    toast.style.left = (rect.right + 10) + 'px';
    toast.style.top = (rect.top - 5) + 'px';
    toast.style.zIndex = '10000';

    document.body.appendChild(toast);

    // Animate in.
    requestAnimationFrame(function() {
        toast.classList.add('copy-toast-visible');
    });

    // Remove after 2 seconds.
    setTimeout(function() {
        toast.classList.remove('copy-toast-visible');
        setTimeout(function() {
            if (toast.parentNode) {
                document.body.removeChild(toast);
            }
        }, 300); // Wait for fade out animation
    }, 2000);

    // Add brief visual feedback to the permalink itself.
    const originalColor = permalinkElement.style.color;
    permalinkElement.style.color = status === 'success' ? '#4caf50' : '#f44336';
    permalinkElement.style.transition = 'color 0.2s ease';

    setTimeout(function() {
        permalinkElement.style.color = originalColor;
    }, 500);
}
