/** Logs clicks on the two footers' links to the webpage activity table. Pages with noFooter have neither footer. */

/** Wires the click logging once the app manager is ready (it supplies `logWebpageActivity`). */
export function initFooterLogging() {
  window.appManager.ready(() => {
    // Column 'Project Sidewalk' or 'Developer': "Click_module=Footer_section=<sidewalk|developer>_target=<link>";
    // column 'Connect': "Click_module=Footer_section=connect_platform=<github|twitter|email>".
    document.getElementById('footer-container')?.addEventListener('click', (e) => {
      const link = /** @type {Element} */ (e.target).closest('a');
      if (!link) return;
      const [column, target] = link.id.split('-');
      const detail = column === 'sidewalk' || column === 'developer' ? `target=${target}` : `platform=${target}`;
      window.logWebpageActivity(`Click_module=Footer_section=${column}_${detail}_route=${window.location.pathname}`);
    });

    // "Click_module=InfoFooter_target=<link>_route=</|/explore|/labelingGuide|...>"
    document.getElementById('info-footer')?.addEventListener('click', (e) => {
      const link = /** @type {Element} */ (e.target).closest('a');
      if (!link) return;
      const target = link.id.split('-')[0];
      window.logWebpageActivity(`Click_module=InfoFooter_target=${target}_route=${window.location.pathname}`);
    });
  });
}
