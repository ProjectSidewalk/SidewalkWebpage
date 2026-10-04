import { GsvViewer } from './GsvViewer.js';
import { Infra3dViewer } from './Infra3dViewer.js';
import { MapillaryViewer } from './MapillaryViewer.js';
import { PanoramaxViewer } from './PanoramaxViewer.js';
import { PanoViewer } from './PanoViewer.js';

/**
 * The viewer class for a city's imagery source, as the server names it. One table for every page, so a new source
 * can't be left out of one page's popup.
 * @param {string} imagerySource - 'gsv', 'mapillary', 'infra3d' or 'panoramax'.
 * @returns {typeof PanoViewer} The class to construct for that source; GSV for anything unknown.
 */
export function viewerClassFor(imagerySource) {
  switch (imagerySource) {
    case 'mapillary': return MapillaryViewer;
    case 'infra3d': return Infra3dViewer;
    case 'panoramax': return PanoramaxViewer;
    default: return GsvViewer;
  }
}
