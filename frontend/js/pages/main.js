/**
 * Entry point for what every page needs (bundled by rolldown.config.mjs): the shared helpers, the app manager that
 * sets up CSRF and translations, and the navbar, auth dialog and test-server banner, each of which no-ops on a page
 * without its markup. main.scala.html loads it ahead of the page's own entry.
 */
import { util } from '../common/utilities.js';
import '../common/utilitiesMath.js';
import '../common/utilitiesSidewalk.js';
import '../common/psTooltip.js';
import '../common/AppManager.js';
import '../common/AuthModal.js';
import '../common/Navbar.js';
import '../common/TestServerBanner.js';
import { initFooterLogging } from '../common/footerLogging.js';

// What the server knows about this request, written into the page as JSON by main.scala.html.
const config = JSON.parse(document.getElementById('page-config').textContent);
util.onDomReady(() => {
  window.appManager.init(config.csrfToken, config.i18next, config.globals);
});
initFooterLogging();
