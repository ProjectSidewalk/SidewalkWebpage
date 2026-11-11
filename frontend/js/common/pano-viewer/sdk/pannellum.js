/**
 * What PannellumViewer fetches on demand (#5734): Pannellum and its stylesheet, as one chunk only a page that shows
 * a self-hosted pano downloads. See sdk/mapillary.js. Pannellum is a classic script with no exports that puts itself
 * on `window`, so the import is for that side effect and the global it leaves is what this module hands back.
 */

import 'pannellum';
import 'pannellum/build/pannellum.css';

export const pannellum = window.pannellum;
