/** Entry point for the Validate tool (bundled by rolldown.config.mjs). */
import { Main } from '../validate/Main.js';
import { User } from '../validate/user/User.js';
import { svv } from '../validate/svv.js';
import { GsvViewer } from '../common/pano-viewer/GsvViewer.js';
import { Infra3dViewer } from '../common/pano-viewer/Infra3dViewer.js';
import { MapillaryViewer } from '../common/pano-viewer/MapillaryViewer.js';
import { PanoramaxViewer } from '../common/pano-viewer/PanoramaxViewer.js';

// What the server knows about this session, written into the page as JSON by validate.scala.html (and the mobile
// page, which shares this entry).
const param = JSON.parse(document.getElementById('page-data').textContent);
param.viewerType = param.imagerySource === 'mapillary'
  ? MapillaryViewer
  : param.imagerySource === 'infra3d'
    ? Infra3dViewer
    : param.imagerySource === 'panoramax' ? PanoramaxViewer : GsvViewer;

// Console and e2e handle; the app reaches the registry by import.
window.svv = svv;
window.appManager.ready(() => {
  svv.user = new User(param.user);
  svv.main = new Main(param);
});
