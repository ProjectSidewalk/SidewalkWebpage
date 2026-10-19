/**
 * Validate's start-up, shared by the desktop and mobile entries. Not an entry itself: an entry importing another is
 * fetched by its plain, hour-cached URL, and a copy cached before a deploy names chunks the next build deleted.
 */
import { Main } from './Main.js';
import { loadPageSession } from '../common/pageSession.js';
import { viewerClassFor } from '../common/pano-viewer/viewerClassFor.js';
import '../../css/components/pano-overlay-buttons.css';
import '../../css/pages/validate/svv-general.css';
import '../../css/pages/validate/svv-immersive.css';
import '../../css/pages/validate/svv-modal.css';
import '../../css/pages/validate/svv-panorama.css';
import '../../css/pages/validate/svv-upper-row.css';
import '../../css/pages/validate/svv-validation-menu.css';

const param = JSON.parse(document.getElementById('page-data').textContent);
param.viewerType = viewerClassFor(param.imagerySource);

window.appManager.ready(async () => {
  // The mission the user left unfinished, or a fresh one, in the shape the mission-complete response uses (#5650).
  // Asked for only now: a POST needs the CSRF header the app manager's setup adds to fetch.
  const firstMission = await loadPageSession(param.missionUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ validate_params: param.validateParams }),
  });
  // Console and e2e handle (test/e2e/explore-validate.spec.js, docs/validation-queue.md); nothing in the app reads it.
  window.svv = await new Main(param, firstMission).start();
});
