/**
 * Mobile section-nav disclosure for the shared `.api-*` shell (API docs, admin dashboard, user dashboard).
 *
 * At mobile widths api-docs.css turns `.api-sidebar` from a column into an in-flow strip between the navbar and the
 * content, and collapses its `.api-nav`. This adds the button that opens it. The button belongs *inside* the sidebar,
 * sharing that in-flow strip, so the nav it discloses opens directly beneath it and pushes the page down rather than
 * covering the content it lands on (#4856).
 *
 * The button is labelled with the active nav item, so the strip also answers "which page am I on?" — the thing the
 * collapsed sidebar otherwise takes away.
 */

/**
 * Builds the disclosure button for a shell sidebar and wires it to that sidebar's nav.
 *
 * @param {HTMLElement} sidebar - The `.api-sidebar` whose `.api-nav` the button discloses.
 * @returns {HTMLButtonElement} The wired-up button, not yet inserted into the document.
 */
function buildSidebarDisclosure(sidebar) {
  const nav = sidebar.querySelector('.api-nav');
  if (nav && !nav.id) nav.id = 'api-sidebar-nav';

  // The active item names the current page; the first group header is the fallback on a page with no active item.
  const active = sidebar.querySelector('.api-nav-item.active');
  const heading = sidebar.querySelector('.api-nav-header');
  const label = (active || heading)?.textContent.trim() || 'Menu';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'api-sidebar-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  if (nav) toggle.setAttribute('aria-controls', nav.id);
  toggle.innerHTML = `
    <span class="api-sidebar-toggle-label"></span>
    <svg class="api-sidebar-toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>`;
  // Assigned as text rather than interpolated into the markup above so a page title can't inject HTML.
  toggle.querySelector('.api-sidebar-toggle-label').textContent = label;
  // The visible text is the page name, which says where you are but not what the control does. The accessible name
  // has to carry both, and has to start with the visible text so speech input still reaches it (WCAG 2.5.3).
  toggle.setAttribute('aria-label', `${label} — section navigation`);

  toggle.addEventListener('click', () => {
    const open = sidebar.classList.toggle('mobile-visible');
    toggle.setAttribute('aria-expanded', String(open));
  });
  return toggle;
}

/**
 * Adds the disclosure to the page's shell sidebar, if it has one and doesn't already have the button.
 *
 * @returns {void}
 */
function initSidebarDisclosure() {
  const sidebar = document.querySelector('.api-sidebar');
  if (!sidebar || sidebar.querySelector('.api-sidebar-toggle')) return;
  sidebar.prepend(buildSidebarDisclosure(sidebar));
}
