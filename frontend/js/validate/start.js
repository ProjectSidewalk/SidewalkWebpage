/**
 * Validate's start-up, shared by the desktop and mobile entries. Not an entry itself: an entry importing another is
 * fetched by its plain, hour-cached URL, and a copy cached before a deploy names chunks the next build deleted.
 */
import { Main } from './Main.js';
import { User } from './user/User.js';
import { svv } from './svv.js';
import { loadPageSession } from '../common/pageSession.js';
import { viewerClassFor } from '../common/pano-viewer/viewerClassFor.js';

const param = JSON.parse(document.getElementById('page-data').textContent);
param.viewerType = viewerClassFor(param.imagerySource);

// Console and e2e handle; the app reaches the registry by import.
window.svv = svv;
window.appManager.ready(async () => {
  svv.user = new User(param.user);
  // The mission the user left unfinished, or a fresh one, in the shape the mission-complete response uses (#5650).
  // Asked for only now: a POST needs the CSRF header the app manager's setup adds to fetch.
  const firstMission = await loadPageSession(param.missionUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ validate_params: param.validateParams }),
  });
  svv.main = new Main(param, firstMission);
});
