/**
 * What PanoramaxViewer fetches on demand (#5734): Photo Sphere Viewer, the adapter that reads Panoramax's tiled
 * pictures, and the stylesheet, as one chunk only a Panoramax city's visitors download. See sdk/mapillary.js.
 */

import '@photo-sphere-viewer/core/index.css';

export { Viewer } from '@photo-sphere-viewer/core';
export { EquirectangularTilesAdapter } from '@photo-sphere-viewer/equirectangular-tiles-adapter';
