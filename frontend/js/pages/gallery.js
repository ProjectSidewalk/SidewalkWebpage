/** Entry point for the Gallery (bundled by rolldown.config.mjs). */
import { Main } from '../gallery/Main.js';
import { sg } from '../gallery/sg.js';
import { GsvViewer } from '../common/pano-viewer/GsvViewer.js';
import { Infra3dViewer } from '../common/pano-viewer/Infra3dViewer.js';
import { MapillaryViewer } from '../common/pano-viewer/MapillaryViewer.js';
import { PanoramaxViewer } from '../common/pano-viewer/PanoramaxViewer.js';

// What the server knows about this session, written into the page as JSON by gallery.scala.html.
const params = JSON.parse(document.getElementById('page-data').textContent);
params.viewerType = params.imagerySource === 'mapillary'
  ? MapillaryViewer
  : params.imagerySource === 'infra3d'
    ? Infra3dViewer
    : params.imagerySource === 'panoramax' ? PanoramaxViewer : GsvViewer;

// Console and e2e handle; the app reaches the registry by import.
window.sg = sg;
// Get translations and such set up, then begin initializing the Gallery app.
window.appManager.ready(() => {
  sg.main = Main.create(params);
});
