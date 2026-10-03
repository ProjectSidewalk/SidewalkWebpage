/** Entry point for the Explore tool (bundled by rolldown.config.mjs). */

import { GsvViewer } from '../common/pano-viewer/GsvViewer.js';
import { Infra3dViewer } from '../common/pano-viewer/Infra3dViewer.js';
import { MapillaryViewer } from '../common/pano-viewer/MapillaryViewer.js';
import { PanoramaxViewer } from '../common/pano-viewer/PanoramaxViewer.js';
import { Main } from '../explore/Main.js';
import { svl } from '../explore/svl.js';
import { util } from '../common/utilities.js';

// Setup necessary for saving crops of the pano. Done before anything creates a WebGL context; if it fails, nothing
// else should.
try {
  HTMLCanvasElement.prototype.getContext = (function (origFn) {
    return function (type, attributes) {
      if (type === 'webgl' || type === 'webgl2') {
        attributes = { ...attributes, preserveDrawingBuffer: true };
      }
      return origFn.call(this, type, attributes);
    };
  }(HTMLCanvasElement.prototype.getContext));
} catch (e) {
  console.log(e);
}

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
mainParam.viewerType = mainParam.imagerySource === 'mapillary'
  ? MapillaryViewer
  : mainParam.imagerySource === 'infra3d'
    ? Infra3dViewer
    : mainParam.imagerySource === 'panoramax' ? PanoramaxViewer : GsvViewer;

// Console and e2e handle; the app reaches the registry by import.
window.svl = svl;
window.appManager.ready(() => {
  new Main(mainParam);
});
