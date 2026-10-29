/**
 * Entry point for what every page needs: the shared helpers, the app manager (CSRF, translations), and the navbar,
 * auth dialog and test-server banner, which each no-op on a page without their markup. main.scala.html loads it
 * ahead of the page's own entry.
 */
import '../../css/fonts.css';
import '../../css/main.css';
import { util } from '../common/utilities.js';
import '../common/utilitiesMath.js';
import '../common/psTooltip.js';
import '../common/AppManager.js';
import '../common/AuthModal.js';
import '../common/Navbar.js';
import '../common/TestServerBanner.js';
import { initFooterLogging } from '../common/footerLogging.js';
import '../../css/pages/homepage.css';
import '../../css/pages/auth.css';

// What the server knows about this request, written into the page as JSON by main.scala.html.
const config = JSON.parse(document.getElementById('page-config').textContent);
util.onDomReady(() => {
  window.appManager.init(config.csrfToken, config.i18next, config.globals);
});
initFooterLogging();
