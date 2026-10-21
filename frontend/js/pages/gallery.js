/** Entry point for the Gallery. */
import { startGallery } from '../gallery/Main.js';
import { viewerClassFor } from '../common/pano-viewer/viewerClassFor.js';
import '../../css/pages/gallery/cards.css';
import '../../css/pages/gallery/filter.css';
import '../../css/pages/gallery/gallery.css';
import '../../css/pages/gallery/tags.css';

// What the server knows about this session, written into the page as JSON by gallery.scala.html.
const params = JSON.parse(document.getElementById('page-data').textContent);
params.viewerType = viewerClassFor(params.imagerySource);

// Get translations and such set up, then begin initializing the Gallery app.
window.appManager.ready(() => startGallery(params));
