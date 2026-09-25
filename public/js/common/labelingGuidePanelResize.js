/**
 * Call this function when the user re-sizes the window. Then, the first time the window width becomes too small
 * to hold the main content (<1185px), re-size the help panel to 250px instead of 275px. The second time the
 * width becomes too small (<978px), change the panel to just be static, full-width, and get rid of the
 * scrolling for the panel if it's there. When the window again becomes >=978px, change the panel back.
 */
function updateSidebarForWindowSize() {
  const w = document.documentElement.clientWidth;
  const smallWindowWidth = 978;
  const mediumWindowWidth = 1186;
  const expandedPanelHeight = 500;
  const smallPanelWidth = 250;
  const mediumPanelWidth = 275;
  const scrollbarWidth = 15;
  const panel = document.getElementById('help-panel');
  if (w < smallWindowWidth) {
    panel.classList.add('not-sidebar', 'not-scrollable');
    panel.classList.remove('sidebar', 'stuck-sidebar', 'scrollable');
    panel.style.width = 'auto';
  } else {
    const changedToFixed = panel.classList.contains('not-sidebar');
    panel.classList.add('sidebar');
    panel.classList.remove('not-sidebar', 'stuck-sidebar');
    panel.style.width = w < mediumWindowWidth ? `${smallPanelWidth}px` : `${mediumPanelWidth}px`;
    updateSidebarForScrollState();
    if (changedToFixed) {
      if (panel.offsetHeight >= expandedPanelHeight) {
        panel.classList.add('scrollable');
        panel.classList.remove('not-scrollable');
        panel.style.width = `${panel.offsetWidth + scrollbarWidth}px`;
      } else {
        panel.classList.add('not-scrollable');
        panel.classList.remove('scrollable');
      }
    }
  }
}

/*
 * Call this function whenever the user scrolls. If the user scrolls so that the panel, remaining fixed (sidebar),
 * would go into the footer below, change the panel's position to absolute (stuck-sidebar).
 */
function updateSidebarForScrollState() {
  if (document.readyState === 'complete') {
    const panelDistanceFromTop = 95;
    const footerHeight = document.getElementById('footer-container').offsetHeight;
    const infoFooterHeight = document.getElementById('info-footer').offsetHeight;
    const panel = document.getElementById('help-panel');
    if (!panel.classList.contains('not-sidebar')) {
      const panelRect = panel.getBoundingClientRect();
      const yOffset = document.body.clientHeight - footerHeight - infoFooterHeight - panelRect.height
        - panelDistanceFromTop;
      if (window.pageYOffset > yOffset) {
        panel.classList.add('stuck-sidebar');
        panel.classList.remove('sidebar', 'not-sidebar');

        // yOffset is a document-space y, but `top` on the now-absolute panel resolves against its offset parent's
        // padding box (the Bootstrap column, which is position: relative), so it has to be rebased or the panel
        // lands the column's own distance from the top of the document too low and overlaps the footer. The class
        // has to go on first: offsetParent reads null while the panel is still position: fixed.
        const column = panel.offsetParent;
        const columnTop = column ? column.getBoundingClientRect().top + window.pageYOffset + column.clientTop : 0;
        panel.style.top = `${yOffset - columnTop}px`;
      } else if (window.pageYOffset < yOffset) {
        panel.style.top = `${panelDistanceFromTop}px`;
        panel.classList.add('sidebar');
        panel.classList.remove('stuck-sidebar', 'not-sidebar');
      }
    }
  }
}

window.addEventListener('resize', updateSidebarForWindowSize);
window.addEventListener('scroll', updateSidebarForScrollState);

util.onDomReady(updateSidebarForWindowSize);
