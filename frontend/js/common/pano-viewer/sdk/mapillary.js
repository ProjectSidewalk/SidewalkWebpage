/**
 * What MapillaryViewer fetches on demand (#5734): the Mapillary SDK and its stylesheet. One module, so Vite writes it
 * as one chunk that only a Mapillary city's visitors download; a plain import from the viewer would put all of it in
 * every page that can show a pano.
 */

import 'mapillary-js/dist/mapillary.css';

export * from 'mapillary-js';
