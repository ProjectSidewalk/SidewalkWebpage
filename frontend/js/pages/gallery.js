/** Entry point for the Gallery (bundled by rolldown.config.mjs). */
import { Main } from '../gallery/Main.js';
import { sg } from '../gallery/sg.js';
import { viewerClassFor } from '../common/pano-viewer/viewerClassFor.js';

// What the server knows about this session, written into the page as JSON by gallery.scala.html.
const params = JSON.parse(document.getElementById('page-data').textContent);
params.viewerType = viewerClassFor(params.imagerySource);

// Console and e2e handle; the app reaches the registry by import.
window.sg = sg;
// Get translations and such set up, then begin initializing the Gallery app.
window.appManager.ready(() => {
  sg.main = Main.create(params);
});
