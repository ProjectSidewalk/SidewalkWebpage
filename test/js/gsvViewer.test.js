/**
 * GsvViewer (frontend/js/common/pano-viewer/GsvViewer.js) from start-up through moves: the Street View panorama it
 * builds, the tutorial panos it serves from our own tiles, the keys it keeps away from Google, what it records about
 * each pano, and the POV it reports. Google's service and panorama are fakes from the pano viewer harness, so no
 * billable pano is ever built; the search-radius and timeout rules have suites of their own (#5840).
 */

import { loadModules } from './loader.js';
import { flush } from './support/routeFetch.js';
import { gsvReply, installFakeGoogleMaps, metersFrom } from './support/panoViewerHarness.js';

const HERE = { lat: 47.61, lng: -122.33 };

let GsvViewer;
let NoImageryError;
let google;
let mount;

/**
 * Builds a viewer the way every page does, through create().
 * @param {object} options - The panoOptions to start it with.
 * @returns {Promise<object>} The viewer.
 */
const create = (options) => GsvViewer.create(mount, options);

/** @returns {object} The Street View panorama the last viewer built. */
const panorama = () => google.panoramas.at(-1);

beforeEach(async () => {
  google = installFakeGoogleMaps({
    P1: gsvReply('P1', HERE),
    P2: gsvReply('P2', metersFrom(HERE, 10)),
  });
  ({ GsvViewer, NoImageryError } = await loadModules('frontend/js/common/pano-viewer/GsvViewer.js',
    'frontend/js/common/pano-viewer/NoImageryError.js'));
  mount = document.createElement('div');
  document.body.append(mount);
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('starting up', () => {
  test('builds a panorama with Google\'s own controls off and opens on the requested pano', async () => {
    const viewer = await create({ startPanoId: 'P1', defaultNavigation: false });

    expect(panorama().el).toBe(mount);
    expect(panorama().opts).toMatchObject({
      disableDefaultUI: true, clickToGo: false, scrollwheel: false, zoomControl: false, showRoadLabels: false,
    });
    expect(viewer.getPanoId()).toBe('P1');
    expect(viewer.getPosition()).toEqual(HERE);
    expect(viewer.initialSeed).toBe('pano');
  });

  test('preloading fetches the Street View code without building a panorama', async () => {
    await GsvViewer.preloadLibrary();
    expect(window.google.maps.importLibrary.mock.calls.map(([name]) => name)).toEqual(['core', 'streetView']);
    expect(google.panoramas).toEqual([]);
  });

  test('before the first pano\'s metadata loads, the id and position read as null', () => {
    const viewer = new GsvViewer();
    expect(viewer.getPanoId()).toBeNull();
    expect(viewer.getPosition()).toBeNull();
  });
});

describe('Google\'s own navigation (the admin label popup)', () => {
  test('turns on click-to-go, and keeps the pano data current as the admin walks', async () => {
    const viewer = await create({ startPanoId: 'P1', defaultNavigation: true });
    expect(panorama().opts.clickToGo).toBe(true);

    panorama().setPano('P2'); // What a click on one of Google's arrows does.
    await flush();

    expect(viewer.getPanoId()).toBe('P2');
  });

  test('a metadata lookup that fails after a step is logged rather than thrown', async () => {
    await create({ startPanoId: 'P1', defaultNavigation: true });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    panorama().setPano('retired');
    await flush();

    expect(error).toHaveBeenCalledWith('Failed to refresh pano metadata after navigation:', expect.any(Error));
  });
});

describe('the tutorial panos', () => {
  test('are drawn from our own tiles, never asked of Google', async () => {
    const viewer = await create({ startPanoId: 'tutorial', defaultNavigation: false });

    expect(google.getPanorama).not.toHaveBeenCalled();
    expect(viewer.getPanoId()).toBe('tutorial');
    expect(viewer.getLinkedPanos()).toEqual([
      { panoId: 'afterWalkTutorial', heading: 340, description: 'afterWalkTutorial' },
    ]);
    const tutorial = panorama().panoProvider('tutorial');
    expect(tutorial.tiles.getTileUrl('tutorial', 2, 1, 0)).toMatch(/images\/pano-tutorial\/tutorial\/2-1-0\.jpg$/);
    expect(panorama().panoProvider('P1')).toBeNull();
  });

  test('the second tutorial pano is served the same way, with no links of its own', async () => {
    const viewer = await create({ startPanoId: 'tutorial', defaultNavigation: false });

    await viewer.setPano('afterWalkTutorial');

    expect(google.getPanorama).not.toHaveBeenCalled();
    expect(viewer.getPosition()).toEqual({ lat: 38.94061618, lng: -77.06768201 });
    expect(viewer.getLinkedPanos()).toEqual([]);
    expect(panorama().panoProvider('afterWalkTutorial').tiles.getTileUrl('afterWalkTutorial', 1, 0, 0))
      .toMatch(/images\/pano-tutorial\/afterwalktutorial\/1-0-0\.jpg$/);
  });
});

describe('keys', () => {
  /**
   * Presses a key on an element and says whether the page's own handlers heard it.
   * @param {Element} target - Where the key is pressed.
   * @param {string} code - The key's `code`.
   * @returns {boolean} Whether a document listener got the event.
   */
  function pageHears(target, code) {
    const heard = vi.fn();
    document.addEventListener('keydown', heard);
    target.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
    document.removeEventListener('keydown', heard);
    return heard.mock.calls.length > 0;
  }

  test('the arrows and WASD never reach Google, except in a text field', async () => {
    await create({ startPanoId: 'P1', defaultNavigation: false });
    const field = document.createElement('input');
    field.type = 'text';
    document.body.append(field);

    expect(pageHears(document.body, 'ArrowLeft')).toBe(false);
    expect(pageHears(document.body, 'KeyW')).toBe(false);
    expect(pageHears(document.body, 'KeyQ')).toBe(true);
    expect(pageHears(field, 'ArrowLeft')).toBe(true);
  });
});

describe('moving', () => {
  test('pano and POV changes reach the listeners in the order they were added', async () => {
    const viewer = await create({ startPanoId: 'P1', defaultNavigation: false });
    const heard = [];
    viewer.addListener('pano_changed', () => heard.push('pano 1'));
    viewer.addListener('pano_changed', () => heard.push('pano 2'));
    viewer.addListener('pov_changed', () => heard.push('pov'));

    await viewer.setPano('P2');
    viewer.setPov({ heading: 10, pitch: 0, zoom: 1 });
    await flush();

    expect(heard).toEqual(['pano 1', 'pano 2', 'pov']);
  });

  test('records the pano\'s links, its dated history, and skips a history entry Google gave no date', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const undated = { pano: 'H2', note: 'no date here' };
    google.getPanorama.mockResolvedValueOnce(gsvReply('P3', HERE, {
      links: [{ pano: 'P4', heading: 45, description: 'Main St' }],
      time: [{ pano: 'H1', Kf: new Date(2019, 4, 1) }, undated],
    }));
    const viewer = await create({ startPanoId: 'P3', defaultNavigation: false });

    expect(viewer.getLinkedPanos()).toEqual([{ panoId: 'P4', heading: 45, description: 'Main St' }]);
    expect(viewer.currPanoData.getProperty('history')).toEqual([{ panoId: 'H1', captureDate: new Date(2019, 4, 1) }]);
    expect(error).toHaveBeenCalledWith('Could not find date in pano history object:', undated);
    expect(viewer.currPanoData.getProperty('cameraHeading')).toBe(90);
    expect(viewer.currPanoData.getProperty('cameraPitch')).toBe(2);
    expect(viewer.currPanoData.getProperty('address')).toBe('1 Main St');
  });

  test('a location search that lands on an excluded pano is no imagery, and nothing loads', async () => {
    const viewer = await create({ startPanoId: 'P1', defaultNavigation: false });
    google.getPanorama.mockResolvedValueOnce(gsvReply('P2', metersFrom(HERE, 10)));

    const move = viewer.setLocation(HERE, new Set([{ getPanoId: () => 'P2' }]));

    await expect(move).rejects.toThrow('Excluded pano: P2');
    await expect(move).rejects.toBeInstanceOf(NoImageryError);
    expect(panorama().setPano).toHaveBeenCalledTimes(1);
  });

  test('a search that lands on the pano already shown resolves without reloading it', async () => {
    const viewer = await create({ startPanoId: 'P1', defaultNavigation: false });
    google.getPanorama.mockResolvedValueOnce(gsvReply('P1', HERE));

    const landed = await viewer.setLocation(metersFrom(HERE, 3));

    expect(landed.getPanoId()).toBe('P1');
    expect(panorama().setPano).toHaveBeenCalledTimes(1);
    expect(viewer.prevPanoData.getPanoId()).toBe('P1');
  });

  test('Google finding nothing is no imagery; any other failure passes through as itself', async () => {
    const viewer = await create({ startPanoId: 'P1', defaultNavigation: false });
    const zero = Object.assign(new Error('ZERO_RESULTS'), { code: 'ZERO_RESULTS' });
    const quota = Object.assign(new Error('OVER_QUERY_LIMIT'), { code: 'OVER_QUERY_LIMIT' });
    google.getPanorama.mockRejectedValueOnce(zero).mockRejectedValueOnce(quota);

    const empty = viewer.setLocation(HERE);
    await expect(empty).rejects.toBeInstanceOf(NoImageryError);
    await expect(empty).rejects.toMatchObject({ cause: zero });
    await expect(viewer.setLocation(HERE)).rejects.toBe(quota);
  });
});

describe('the point of view', () => {
  test('reports the heading folded into 0-360, whichever way Google wound it', async () => {
    const viewer = await create({ startPanoId: 'P1', defaultNavigation: false });

    panorama().pov = { heading: -30, pitch: 5, zoom: 2 };
    expect(viewer.getPov()).toEqual({ heading: 330, pitch: 5, zoom: 2 });
    panorama().pov = { heading: 400, pitch: 0, zoom: 1 };
    expect(viewer.getPov().heading).toBe(40);
  });

  test('reads as null until Google has a POV, so early input logging doesn\'t throw', async () => {
    const viewer = await create({ startPanoId: 'P1', defaultNavigation: false });
    panorama().pov = {};
    expect(viewer.getPov()).toBeNull();
  });

  test('passes a POV, the arrows switch and a resize straight to Google', async () => {
    const viewer = await create({ startPanoId: 'P1', defaultNavigation: false });
    const pov = { heading: 10, pitch: -5, zoom: 1 };

    viewer.setPov(pov);
    viewer.hideNavigationArrows();
    expect(panorama().values.linksControl).toBe(false);
    viewer.showNavigationArrows();
    viewer.resize();

    expect(panorama().setPov).toHaveBeenCalledWith(pov);
    expect(panorama().values.linksControl).toBe(true);
    expect(google.trigger).toHaveBeenCalledWith(panorama(), 'resize');
  });

  test('links out to the pano on Google Maps at the given view', () => {
    expect(new GsvViewer().publicViewerLink('P1', { heading: 90, pitch: -10 })).toEqual({
      url: 'https://www.google.com/maps/@?api=1&map_action=pano&pano=P1&heading=90&pitch=-10',
      i18nKey: 'common:pano-info.view-in-gsv',
    });
  });
});
