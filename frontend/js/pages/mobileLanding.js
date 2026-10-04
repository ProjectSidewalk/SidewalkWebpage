/** Entry point for the mobile landing page (bundled by rolldown.config.mjs). */

window.appManager.ready(() => {
  document.getElementById('mobile-hero-cta-btn').addEventListener('click', () => {
    window.logWebpageActivity('Click_module=StartValidating_location=MobileLanding');
  });
  document.getElementById('mobile-bottom-cta-btn').addEventListener('click', () => {
    window.logWebpageActivity('Click_module=StartValidating_location=MobileLanding_bottom');
  });
  // The Community Partners partial is shared with the desktop landing page, where homepage.js binds this same
  // event — that bundle isn't loaded here, so the mobile page logs partner clicks itself (#4516).
  document.getElementById('partners-container').addEventListener('click', (e) => {
    const link = /** @type {Element} */ (e.target).closest('a[data-partner-source]');
    if (link) window.logWebpageActivity(`Click_module=Partner_source=${link.dataset.partnerSource || 'unknown'}`);
  });
});
