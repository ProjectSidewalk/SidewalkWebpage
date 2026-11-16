/**
 * viewerClassFor (frontend/js/common/pano-viewer/viewerClassFor.js): the one table every page uses to turn a city's
 * imagery source, as the server names it, into the viewer to build, so no page can be left without one (#5840).
 */

import { loadModules } from './loader.js';

const { viewerClassFor } = await loadModules('frontend/js/common/pano-viewer/viewerClassFor.js');

describe('viewerClassFor', () => {
  test.each(['gsv', 'mapillary', 'infra3d', 'panoramax'])('a %s city gets the viewer for that source', (source) => {
    expect(viewerClassFor(source).SOURCE).toBe(source);
  });

  test('a source it doesn\'t know falls back to Street View', () => {
    expect(viewerClassFor('bing').SOURCE).toBe('gsv');
  });
});
