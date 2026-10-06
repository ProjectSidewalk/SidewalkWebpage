/** Entry point for the Explore tool. */

import { loadPageSession } from '../common/pageSession.js';
import { viewerClassFor } from '../common/pano-viewer/viewerClassFor.js';
import { Main } from '../explore/Main.js';
import '../explore/detectUnsupportedBrowser.js';
import { svl } from '../explore/svl.js';
import { util } from '../common/utilities.js';

util.onDomReady(() => {
  // Prevents text selection with cursor. Fixes https://github.com/ProjectSidewalk/SidewalkWebpage/issues/121.
  // We also add the 'audit-selectable' class to a parent of any element that we want to have selectable.
  document.onselectstart = (e) => {
    // A selection can start on a text node, which has no closest().
    const el = e.target instanceof Element ? e.target : /** @type {Node} */ (e.target).parentElement;
    return Boolean(el?.closest('.audit-selectable'));
  };

  // Region Completion Overlay
  document.getElementById('continue-current').addEventListener('click', () => {
    document.getElementById('area-completion-overlay-wrapper').style.display = 'none';
  });
  document.getElementById('redirect-new').addEventListener('click', () => {
    window.location.href = '/explore?newRegion=true';
  });
  // Already Completed Region Overlay
  document.getElementById('accept-redirect').addEventListener('click', () => {
    window.location.href = '/explore';
  });
});

// The page's session scalars, written into the page as JSON by explore.scala.html.
const mainParam = JSON.parse(document.getElementById('page-data').textContent);
mainParam.viewerType = viewerClassFor(mainParam.imagerySource);

// The task, mission, region and route this visit opens on, resolved from the same query string the page was asked
// for (a route, a region, a street, an address, a live URL's pano seed). Started before the app's own setup so the
// two overlap (#5650).
const session = loadPageSession(`${mainParam.sessionUrl}${window.location.search}`);

// Console and e2e handle; the app reaches the registry by import.
window.svl = svl;
window.appManager.ready(async () => {
  const exploreSession = await session;
  if (!exploreSession.task) {
    // The user has finished their assigned region, so there is nothing to explore until they pick a new one.
    document.querySelectorAll('.tool-ui').forEach((el) => el.classList.remove('ps-invisible'));
    document.getElementById('already-completed-region-overlay').style.display = 'block';
    return;
  }
  new Main(mainParam, exploreSession);
});
