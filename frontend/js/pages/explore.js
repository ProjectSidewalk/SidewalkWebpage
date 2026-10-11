/** Entry point for the Explore tool. */

import { loadPageSession } from '../common/pageSession.js';
import { viewerClassFor } from '../common/pano-viewer/viewerClassFor.js';
import { Main } from '../explore/Main.js';
import '../explore/detectUnsupportedBrowser.js';
import { svl } from '../explore/svl.js';
import { util } from '../common/utilities.js';
import '../../css/components/pano-overlay-buttons.css';
import '../../css/pages/explore/svl-alert.css';
import '../../css/pages/explore/svl-canvas.css';
import '../../css/pages/explore/svl-compass.css';
import '../../css/pages/explore/svl-context-menu.css';
import '../../css/pages/explore/svl-immersive.css';
import '../../css/pages/explore/svl-minimap.css';
import '../../css/pages/explore/svl-modal.css';
import '../../css/pages/explore/svl-onboarding.css';
import '../../css/pages/explore/svl-pano-date-pills.css';
import '../../css/pages/explore/svl-pop-up-message.css';
import '../../css/pages/explore/svl-ribbon.css';
import '../../css/pages/explore/svl-sidebar.css';
import '../../css/pages/explore/svl.css';
import '../../css/pages/explore/tutorial-screens.css';

util.onDomReady(() => {
  // Prevents text selection with cursor. Fixes https://github.com/ProjectSidewalk/SidewalkWebpage/issues/121.
  // We also add the 'audit-selectable' class to a parent of any element that we want to have selectable.
  document.onselectstart = (e) => {
    // A selection can start on a text node, which has no closest().
    const el = e.target instanceof Element ? e.target : /** @type {Node} */ (e.target).parentElement;
    if (el?.closest('.audit-selectable')) return true;
    // A refused press would otherwise leave an earlier selection (a double-click in the sidebar) in place, where a
    // press normally clears it, and while one stands Chrome won't forward a <label>'s click to its input: a click on
    // a severity word or a survey option did nothing (#5749). Text fields keep their own selection.
    if (!el?.closest('input, textarea, [contenteditable]')) document.getSelection()?.removeAllRanges();
    return false;
  };
  enableTouchSupport();

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

/** Replays touches as mouse events, so the tool's mouse handlers work on a touch screen. */
function enableTouchSupport() {
  const mouseTypeForTouch = { touchstart: 'mousedown', touchmove: 'mousemove', touchend: 'mouseup' };
  for (const touchType of Object.keys(mouseTypeForTouch)) {
    document.addEventListener(touchType, (event) => {
      const first = /** @type {TouchEvent} */ (event).changedTouches[0];
      first.target.dispatchEvent(new MouseEvent(mouseTypeForTouch[touchType], {
        screenX: first.screenX,
        screenY: first.screenY,
        clientX: first.clientX,
        clientY: first.clientY,
      }));
    });
  }
  // Not passive: this is what stops a drag on the pano from scrolling the page.
  document.getElementById('interaction-area-holder').addEventListener('touchmove', (event) => {
    event.preventDefault();
  }, { passive: false });
}

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
