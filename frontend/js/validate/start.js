/**
 * Validate's start-up, shared by the desktop and mobile entries. Not an entry itself: an entry importing another is
 * fetched by its plain, hour-cached URL, and a copy cached before a deploy names chunks the next build deleted.
 */
import { Main } from './Main.js';
import { User } from './user/User.js';
import { svv } from './svv.js';
import { viewerClassFor } from '../common/pano-viewer/viewerClassFor.js';

const param = JSON.parse(document.getElementById('page-data').textContent);
param.viewerType = viewerClassFor(param.imagerySource);

// Console and e2e handle; the app reaches the registry by import.
window.svv = svv;
window.appManager.ready(() => {
  svv.user = new User(param.user);
  svv.main = new Main(param);
});
