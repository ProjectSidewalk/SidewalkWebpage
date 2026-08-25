/**
 * Narrow-viewport sidebar disclosure, shared by the `.api-*` shells (API docs, admin dashboard, user dashboard) and
 * the Gallery's filter column.
 *
 * Under their breakpoints these sidebars stop being columns and become an in-flow strip between the navbar and the
 * content, with their contents collapsed. The button that reopens them belongs *inside* that strip, so what it
 * discloses opens directly beneath it and pushes the page down rather than covering the content it lands on (#4856).
 *
 * The two surfaces differ in where the button comes from: the shells have no server-side hook, so
 * `buildSidebarDisclosure` creates one labelled with the active nav item (the strip then also answers "which page am
 * I on?"); the Gallery renders its own in Twirl so the label goes through Play's i18n. Both share
 * `wireSidebarDisclosure` for the part that has to behave identically.
 */

/**
 * Wires a disclosure button to the sidebar it opens.
 *
 * @param {HTMLButtonElement} toggle - The button. Its `aria-expanded` tracks the open state.
 * @param {HTMLElement} root - Element carrying `mobile-visible` while open; the CSS keys the reveal off it.
 * @param {object} [options]
 * @param {?HTMLElement} [options.controlled] - What the button discloses. Given an id if it has none, so
 *     `aria-controls` can name it.
 * @param {string} [options.controlledId] - Id to assign when `controlled` has none.
 * @param {function(boolean): void} [options.onToggle] - Called with the new open state, for interaction logging.
 * @returns {HTMLButtonElement} The same button, for chaining.
 */
function wireSidebarDisclosure(toggle, root, options = {}) {
  const { controlled = null, controlledId = 'sidebar-disclosure-target', onToggle = null } = options;

  if (controlled) {
    if (!controlled.id) controlled.id = controlledId;
    toggle.setAttribute('aria-controls', controlled.id);
  }
  toggle.setAttribute('aria-expanded', String(root.classList.contains('mobile-visible')));

  toggle.addEventListener('click', () => {
    const open = root.classList.toggle('mobile-visible');
    toggle.setAttribute('aria-expanded', String(open));
    onToggle?.(open);
  });
  return toggle;
}

/**
 * Builds the disclosure button for an `.api-*` shell sidebar and wires it to that sidebar's nav.
 *
 * @param {HTMLElement} sidebar - The `.api-sidebar` whose `.api-nav` the button discloses.
 * @returns {HTMLButtonElement} The wired-up button, not yet inserted into the document.
 */
function buildSidebarDisclosure(sidebar) {
  // The active item names the current page; the first group header is the fallback on a page with no active item.
  const active = sidebar.querySelector('.api-nav-item.active');
  const heading = sidebar.querySelector('.api-nav-header');
  const label = (active || heading)?.textContent.trim() || 'Menu';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'api-sidebar-toggle';
  toggle.innerHTML = `
    <span class="api-sidebar-toggle-label"></span>
    <svg class="api-sidebar-toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>`;
  // Assigned as text rather than interpolated into the markup above so a page title can't inject HTML.
  toggle.querySelector('.api-sidebar-toggle-label').textContent = label;
  // The visible text is the page name, which says where you are but not what the control does. The accessible name
  // has to carry both, and has to start with the visible text so speech input still reaches it (WCAG 2.5.3).
  toggle.setAttribute('aria-label', `${label} — section navigation`);

  return wireSidebarDisclosure(toggle, sidebar, {
    controlled: sidebar.querySelector('.api-nav'), controlledId: 'api-sidebar-nav',
  });
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
