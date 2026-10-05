/** Entry point for the Explore tool. */

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

// What the server knows about this session, written into the page as JSON by explore.scala.html.
const mainParam = JSON.parse(document.getElementById('page-data').textContent);
if (!mainParam.task) {
  // The user has finished their assigned region, so there is nothing to explore until they pick a new one.
  document.querySelectorAll('.tool-ui').forEach((el) => el.classList.remove('ps-invisible'));
  document.getElementById('already-completed-region-overlay').style.display = 'block';
}
// TODO I think that we can replace this with Json.toJson(data.region.geom).toString after back end upgrades.
mainParam.regionGeoJSON = /** @type {any} */ (window).betterknown.wktToGeoJSON(mainParam.regionWkt);
mainParam.viewerType = viewerClassFor(mainParam.imagerySource);

// Console and e2e handle; the app reaches the registry by import.
window.svl = svl;
window.appManager.ready(() => {
  new Main(mainParam);
});
