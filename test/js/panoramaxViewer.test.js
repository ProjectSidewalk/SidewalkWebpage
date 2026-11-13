/**
 * PanoramaxViewer (frontend/js/common/pano-viewer/PanoramaxViewer.js), the viewer for Panoramax cities (#5185): how it
 * loads a picture into Photo Sphere Viewer, what it records about it, which picture a location search lands on, which
 * arrows it offers, and how the POV it reports lines up with what PSV shows. Panoramax has no SDK, so the viewer talks
 * to its API itself; here that API is a fixed set of pictures behind a fake fetch, and PSV is a fake that holds the
 * view it was set to. Real turf and the real scoring weights pick the pictures (#5840).
 */

import { fakePanoOverlays } from './fakes.js';
import { loadModules } from './loader.js';
import { flush, routeFetch } from './support/routeFetch.js';
import {
  installFakePhotoSphereViewer, metersFrom, PANORAMAX_API, panoramaxRoutes, sequenceLink, stacItem, stampPanoScoring,
} from './support/panoViewerHarness.js';

stampPanoScoring();

// Bayonne, the city Panoramax was first switched on for.
const HERE = { lat: 43.4929, lng: -1.4748 };
const toRadians = (deg) => (deg * Math.PI) / 180;

let PanoramaxViewer;
let NoImageryError;
let psv;
let overlays;
let items;
let fetchStub;
let mount;

/**
 * Builds a viewer the way every page does, through create().
 * @param {object} [options] - The panoOptions to start it with.
 * @returns {Promise<object>} The viewer.
 */
const create = (options = {}) => PanoramaxViewer.create(mount, options);

/** @returns {object} The Photo Sphere Viewer the last viewer built. */
const psvViewer = () => psv.viewers.at(-1);

/** @returns {string[]} The picture ids fetched one by one, in order. */
const pictureFetches = () => fetchStub.mock.calls.map(([url]) => String(url))
  .filter((url) => url.includes('/pictures/')).map((url) => url.split('/').pop());

/** @returns {number} How many searches went to the API. */
const searchCount = () => fetchStub.mock.calls.filter(([url]) => String(url).includes('/search?')).length;

beforeEach(async () => {
  psv = installFakePhotoSphereViewer();
  overlays = fakePanoOverlays();
  items = [];
  fetchStub = routeFetch(panoramaxRoutes(() => items));
  ({ PanoramaxViewer, NoImageryError } = await loadModules('frontend/js/common/pano-viewer/PanoramaxViewer.js',
    'frontend/js/common/pano-viewer/NoImageryError.js'));
  mount = document.createElement('div');
  document.body.append(mount);
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('starting up', () => {
  test('builds PSV with keyboard and navbar off and wheel zoom on, and opens on the requested picture', async () => {
    items = [stacItem('A', HERE)];
    const viewer = await create({ startPanoId: 'A' });

    expect(psvViewer().config).toMatchObject({
      container: mount, navbar: false, keyboard: false, mousewheel: true, defaultZoomLvl: 0,
    });
    expect(psvViewer().config.minFov).toBeLessThan(psvViewer().config.maxFov);
    expect(psvViewer().config.maxFov).toBeLessThanOrEqual(90);
    expect(viewer.getPanoId()).toBe('A');
    expect(viewer.getPosition()).toEqual(HERE);
    expect(viewer.initialSeed).toBe('pano');
  });

  test('wheel zoom follows zoomControl, or the scrollwheel name Validate and the label popup use for it', async () => {
    await create({ zoomControl: false });
    expect(psvViewer().config.mousewheel).toBe(false);
    await create({ scrollwheel: false });
    expect(psvViewer().config.mousewheel).toBe(false);
    await create({ zoomControl: true, scrollwheel: false });
    expect(psvViewer().config.mousewheel).toBe(true);
  });

  test('a start location opens on the best picture near it', async () => {
    items = [stacItem('far', metersFrom(HERE, 20)), stacItem('near', metersFrom(HERE, 3))];
    const viewer = await create({ startLatLng: HERE });
    expect(viewer.getPanoId()).toBe('near');
    expect(viewer.initialSeed).toBe('latLng');
  });

  test('before any picture has loaded, the id and position read as null', () => {
    const viewer = new PanoramaxViewer();
    expect(viewer.getPanoId()).toBeNull();
    expect(viewer.getPosition()).toBeNull();
  });
});

describe('loading a picture', () => {
  test('hands PSV the picture\'s own tile template and pyramid, and its base image', async () => {
    items = [stacItem('A', HERE)];
    await create({ startPanoId: 'A' });

    const [config, options] = psvViewer().setPanorama.mock.calls[0];
    expect(config).toMatchObject({ baseUrl: 'https://pics.example/A/sd.jpg', width: 7680, cols: 8, rows: 4 });
    expect(config.tileUrl(3, 1)).toBe('https://pics.example/A/tiled/3_1.jpg');
    expect(options).toMatchObject({ transition: false, showLoader: true });
  });

  test('only the first picture gets PSV\'s spinner; a move keeps the old frame up and the old view direction',
    async () => {
      items = [stacItem('A', HERE), stacItem('B', metersFrom(HERE, 10), { properties: { 'view:azimuth': 90 } })];
      const viewer = await create({ startPanoId: 'A' });
      viewer.setPov({ heading: 200, pitch: 5, zoom: 1.5 });

      await viewer.setPano('B');

      expect(psvViewer().setPanorama.mock.calls[1][1].showLoader).toBe(false);
      expect(viewer.getPov().heading).toBeCloseTo(200, 6);
      expect(viewer.getPov().pitch).toBeCloseTo(5, 6);
      expect(viewer.getPov().zoom).toBeCloseTo(1.5, 6);
    });

  test('a camera tilt is corrected out of the sphere only when both pitch and roll are recorded', async () => {
    items = [
      stacItem('both', HERE, { properties: { 'pers:pitch': 2, 'pers:roll': 3 } }),
      stacItem('pitchOnly', HERE, { properties: { 'pers:pitch': 4 } }),
    ];
    const viewer = await create({ startPanoId: 'both' });
    expect(psvViewer().setPanorama.mock.calls[0][1].sphereCorrection)
      .toEqual({ pan: 0, tilt: expect.closeTo(-toRadians(2), 9), roll: expect.closeTo(-toRadians(3), 9) });
    // Corrected, so PSV's own pitch is the true pitch.
    expect(viewer.getPov().pitch).toBeCloseTo(0, 6);

    psvViewer().rotate({ yaw: 0, pitch: 0 });
    await viewer.setPano('pitchOnly');
    expect(psvViewer().setPanorama.mock.calls[1][1].sphereCorrection).toEqual({ pan: 0, tilt: 0, roll: 0 });
    // Uncorrected, so the camera's own pitch is added back, as PannellumViewer does.
    psvViewer().dispatch('position-updated', { position: { yaw: 0, pitch: 0 } });
    expect(viewer.getPov().pitch).toBeCloseTo(4, 6);
  });

  test('records the picture\'s size, capture day on its own calendar, heading, pose and credits', async () => {
    items = [stacItem('A', HERE, { datetime: '2025-06-30T21:30:00+00:00', properties: {
      datetimetz: '2025-06-30T23:30:00+02:00', 'view:azimuth': 123, 'pers:pitch': 1.5,
      'geovisio:producer': 'Ville de Bayonne', license: 'etalab-2.0',
    } })];
    const viewer = await create({ startPanoId: 'A' });

    const data = viewer.currPanoData;
    expect(data.getProperty('source')).toBe('panoramax');
    expect([data.getProperty('width'), data.getProperty('height')]).toEqual([7680, 3840]);
    expect([data.getProperty('tileWidth'), data.getProperty('tileHeight')]).toEqual([960, 960]);
    const day = data.getProperty('captureDate');
    expect([day.getFullYear(), day.getMonth(), day.getDate()]).toEqual([2025, 5, 30]);
    expect(data.getProperty('cameraHeading')).toBe(123);
    expect(data.getProperty('cameraPitch')).toBe(1.5);
    expect(data.getProperty('cameraRoll')).toBeUndefined();
    expect(data.getProperty('copyright')).toBe('Ville de Bayonne');
    expect(data.getProperty('license')).toBe('etalab-2.0');
  });

  test('a picture without sensor dimensions takes its size from the tile pyramid, and its day from UTC', async () => {
    items = [stacItem('A', HERE, { datetime: '2024-03-02T10:00:00+00:00', properties: {
      'pers:interior_orientation': undefined, 'view:azimuth': undefined, 'pers:roll': 0,
    } })];
    const viewer = await create({ startPanoId: 'A' });

    const data = viewer.currPanoData;
    expect([data.getProperty('width'), data.getProperty('height')]).toEqual([7680, 3840]);
    expect(data.getProperty('captureDate').getDate()).toBe(2);
    expect(data.getProperty('cameraHeading')).toBe(0);
    expect(data.getProperty('cameraRoll')).toBe(0);
  });

  test('a picture the API no longer has rejects as no imagery', async () => {
    const viewer = await create();
    await expect(viewer.setPano('gone')).rejects.toBeInstanceOf(NoImageryError);
  });

  test('any other API failure rejects untyped, since the picture may still exist', async () => {
    fetchStub = routeFetch({ ...panoramaxRoutes(() => items), [`${PANORAMAX_API}/pictures/`]: { status: 502 } });
    const viewer = await create();
    const move = viewer.setPano('A');
    await expect(move).rejects.toThrow('HTTP 502');
    await expect(move).rejects.not.toBeInstanceOf(NoImageryError);
  });

  test('a picture that publishes no 360° pyramid fails the way a missing one does', async () => {
    const flat = stacItem('flat', HERE);
    delete flat.asset_templates;
    const noMatrix = stacItem('noMatrix', HERE, { properties: { 'tiles:tile_matrix_sets': undefined } });
    const noBase = stacItem('noBase', HERE);
    noBase.assets = {};
    items = [flat, noMatrix, noBase];
    const viewer = await create();

    for (const id of ['flat', 'noMatrix', 'noBase']) {
      await expect(viewer.setPano(id)).rejects.toThrow(`Panoramax picture ${id} publishes no 360° tile pyramid.`);
    }
  });

  test('a load PSV fails is logged and rejected with the picture\'s id', async () => {
    items = [stacItem('A', HERE)];
    const viewer = await create();
    const failure = new Error('WebGL said no');
    psvViewer().setPanorama.mockRejectedValueOnce(failure);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(viewer.setPano('A')).rejects.toThrow('Failed to load pano: A');
    expect(error).toHaveBeenCalledWith('Failed to load pano: ', 'A', failure);
    expect(viewer.getPanoId()).toBeNull();
  });

  test('a load that never finishes is given up on after 12 seconds', async () => {
    items = [stacItem('A', HERE)];
    const viewer = await create();
    psvViewer().setPanorama.mockReturnValueOnce(new Promise(() => {}));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers();

    const move = viewer.setPano('A');
    const settled = expect(move).rejects.toThrow('Failed to load pano: A');
    await vi.advanceTimersByTimeAsync(13000);
    await settled;
  });

  test('a load a newer one superseded rejects and leaves the shown picture alone', async () => {
    items = [stacItem('A', HERE), stacItem('B', metersFrom(HERE, 10))];
    const viewer = await create({ startPanoId: 'A' });
    psvViewer().setPanorama.mockResolvedValueOnce(false);

    await expect(viewer.setPano('B')).rejects.toThrow('Load of pano B was superseded');
    expect(viewer.getPanoId()).toBe('A');
  });

  test('pano_changed listeners run once the move\'s arrows are in, in the order they were added', async () => {
    items = [stacItem('A', HERE, { links: [sequenceLink('next', 'B')] }), stacItem('B', metersFrom(HERE, 10, 0))];
    const viewer = await create();
    const heard = [];
    viewer.addListener('pano_changed', () => heard.push(['first', viewer.getLinkedPanos().map((l) => l.panoId)]));
    viewer.addListener('pano_changed', () => heard.push(['second']));

    await viewer.setPano('A');

    expect(heard).toEqual([['first', ['B']], ['second']]);
  });
});

describe('finding a picture near a location', () => {
  test('nothing usable nearby is no imagery', async () => {
    const viewer = await create();
    await expect(viewer.setLocation(HERE)).rejects.toBeInstanceOf(NoImageryError);
  });

  test('a search reply without a feature list reads as an empty box', async () => {
    fetchStub = routeFetch({ ...panoramaxRoutes(() => items), [`${PANORAMAX_API}/search`]: {} });
    const viewer = await create();
    await expect(viewer.setLocation(HERE)).rejects.toBeInstanceOf(NoImageryError);
  });

  test('when every picture a prefetch found is excluded, it searches again centred on the target itself', async () => {
    const used = stacItem('used', metersFrom(HERE, 2));
    items = [used];
    const viewer = await create();
    viewer.prefetchLocation(metersFrom(HERE, 3));
    await flush();
    items = [used, stacItem('fresh', metersFrom(HERE, 4, 180))];

    await viewer.setLocation(HERE, new Set([{ getPanoId: () => 'used' }]));

    expect(viewer.getPanoId()).toBe('fresh');
    expect(searchCount()).toBe(3); // The prefetch, the fresh search, and the new picture's link search.
  });

  test('a prefetch near one already made is not fetched again, however many others there are', async () => {
    const viewer = await create();
    viewer.prefetchLocation(HERE);
    viewer.prefetchLocation(metersFrom(HERE, 2));
    viewer.prefetchLocation(metersFrom(HERE, 100));
    viewer.prefetchLocation(metersFrom(HERE, 1));
    await flush();
    expect(searchCount()).toBe(2);
  });

  test('between equally placed pictures, staying in the current sequence wins', async () => {
    items = [
      stacItem('start', HERE, { collection: 'seq-1' }),
      stacItem('other', metersFrom(HERE, 5, 0), { collection: 'seq-2' }),
      stacItem('same', metersFrom(HERE, 5, 180), { collection: 'seq-1' }),
    ];
    const viewer = await create({ startPanoId: 'start' });
    await expect(viewer.findPanoNear(HERE, new Set([{ getPanoId: () => 'start' }])))
      .resolves.toMatchObject({ panoId: 'same' });
  });

  test('a picture with an unreadable date and no sensor size is still a candidate, not a gap', async () => {
    items = [stacItem('odd', metersFrom(HERE, 3), {
      datetime: 'sometime', properties: { 'pers:interior_orientation': undefined },
    })];
    const viewer = await create();
    await expect(viewer.findPanoNear(HERE)).resolves.toMatchObject({ panoId: 'odd' });
  });
});

describe('navigation arrows', () => {
  test('offer the road ahead and behind at any distance, plus one arrow per cross street', async () => {
    const ahead = metersFrom(HERE, 45, 0); // Past the link radius, so only the sequence link finds it.
    items = [
      stacItem('C', HERE, { links: [sequenceLink('next', 'N'), sequenceLink('prev', 'P')] }),
      stacItem('N', ahead),
      stacItem('P', metersFrom(HERE, 10, 180)),
      stacItem('dup', metersFrom(HERE, 1, 90), { collection: 'seq-2' }), // Same spot: not a move.
      stacItem('side', metersFrom(HERE, 5, 270), { collection: 'seq-3' }), // A sidestep, not a cross street.
      stacItem('parallel', metersFrom(HERE, 15, 20), { collection: 'seq-4' }), // The same road, another pass.
      stacItem('corner', metersFrom(HERE, 35, 45), { collection: 'seq-5' }), // In the box, past the radius.
      stacItem('cross', metersFrom(HERE, 15, 90), { collection: 'seq-6' }),
      stacItem('crossOld', metersFrom(HERE, 14, 100), {
        collection: 'seq-7', datetime: '2012-01-01T00:00:00+00:00',
      }),
    ];
    const viewer = await create({ startPanoId: 'C' });

    const links = viewer.getLinkedPanos();
    expect(links.map((l) => l.panoId).sort()).toEqual(['N', 'P', 'cross']);
    expect(pictureFetches()).toEqual(['C', 'N']);
    const north = links.find((l) => l.panoId === 'N');
    expect(north.heading).toBeCloseTo(0, 3);
    expect(north).toMatchObject(ahead);
    expect(links.find((l) => l.panoId === 'cross').heading).toBeCloseTo(90, 1);
  });

  test('a sequence neighbour the API has dropped is left out, without failing the move', async () => {
    items = [stacItem('C', HERE, { links: [sequenceLink('next', 'gone')] })];
    const viewer = await create({ startPanoId: 'C' });
    expect(viewer.getLinkedPanos()).toEqual([]);
  });

  test('a failed link search leaves the picture without arrows rather than failing the move', async () => {
    items = [stacItem('C', HERE)];
    fetchStub = routeFetch({ ...panoramaxRoutes(() => items), [`${PANORAMAX_API}/search`]: { status: 503 } });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const viewer = await create({ startPanoId: 'C' });

    expect(viewer.getPanoId()).toBe('C');
    expect(viewer.getLinkedPanos()).toEqual([]);
    expect(warn).toHaveBeenCalledWith('Panoramax link search failed:', expect.any(Error));
  });
});

describe('the point of view', () => {
  test('heading, pitch and zoom round-trip through PSV at the picture\'s own azimuth', async () => {
    items = [stacItem('A', HERE, { properties: { 'view:azimuth': 120, 'pers:pitch': 2, 'pers:roll': 1 } })];
    const viewer = await create({ startPanoId: 'A' });

    viewer.setPov({ heading: 30, pitch: -10, zoom: 1.5 });

    expect(psvViewer().position.yaw).toBeCloseTo(toRadians(-90), 6);
    const pov = viewer.getPov();
    expect(pov.heading).toBeCloseTo(30, 6);
    expect(pov.pitch).toBeCloseTo(-10, 6);
    expect(pov.zoom).toBeCloseTo(1.5, 6);
  });

  test('on an uncorrected picture the camera\'s pitch is taken out before PSV is turned', async () => {
    items = [stacItem('A', HERE, { properties: { 'pers:pitch': 4 } })];
    const viewer = await create({ startPanoId: 'A' });

    viewer.setPov({ heading: 0, pitch: -10, zoom: 1 });

    expect(psvViewer().position.pitch).toBeCloseTo(toRadians(-14), 6);
    expect(viewer.getPov().pitch).toBeCloseTo(-10, 6);
  });

  test('a POV without a zoom keeps the zoom already shown', async () => {
    items = [stacItem('A', HERE)];
    const viewer = await create({ startPanoId: 'A' });
    viewer.setPov({ heading: 0, pitch: 0, zoom: 1.5 });

    viewer.setPov({ heading: 45, pitch: 0 });

    expect(viewer.getPov().zoom).toBeCloseTo(1.5, 6);
  });

  test('a drag or a zoom in PSV reaches getPov() and the pov_changed listeners', async () => {
    items = [stacItem('A', HERE, { properties: { 'view:azimuth': 100 } })];
    const viewer = await create({ startPanoId: 'A' });
    const heard = vi.fn();
    viewer.addListener('pov_changed', heard);

    psvViewer().dispatch('position-updated', { position: { yaw: toRadians(10), pitch: toRadians(-5) } });
    expect(viewer.getPov().heading).toBeCloseTo(110, 6);
    expect(viewer.getPov().pitch).toBeCloseTo(-5, 6);

    const before = viewer.getPov().zoom;
    psvViewer().zoom(100);
    psvViewer().dispatch('zoom-updated', { zoomLevel: 100 });
    expect(viewer.getPov().zoom).toBeGreaterThan(before);
    expect(heard).toHaveBeenCalledTimes(2);
  });

  test('before any picture, the POV reads from PSV\'s own view, facing the image centre', async () => {
    const viewer = await create();
    const pov = viewer.getPov();
    expect(pov.heading).toBe(0);
    expect(pov.pitch).toBe(0);
    expect(Number.isFinite(pov.zoom)).toBe(true);
  });

  test('a resize re-measures PSV, re-fits the zoom range to the new shape, and reports the POV two frames on',
    async () => {
      items = [stacItem('A', HERE)];
      const viewer = await create({ startPanoId: 'A' });
      const heard = vi.fn();
      viewer.addListener('pov_changed', heard);
      const frames = [];
      vi.stubGlobal('requestAnimationFrame', (cb) => frames.push(cb));
      const widest = psvViewer().config.maxFov;
      psvViewer().state.aspect = 3;

      viewer.resize();

      expect(psvViewer().autoSize).toHaveBeenCalled();
      expect(psvViewer().setOptions).toHaveBeenCalledWith({ minFov: expect.any(Number), maxFov: expect.any(Number) });
      expect(psvViewer().config.maxFov).toBeLessThan(widest);
      frames.shift()();
      expect(heard).not.toHaveBeenCalled();
      frames.shift()();
      expect(heard).toHaveBeenCalledTimes(1);
    });
});

describe('caches and preloading', () => {
  test('clearing the prefetch cache drops searched pictures but keeps the one on screen', async () => {
    items = [stacItem('A', HERE), stacItem('B', metersFrom(HERE, 10))];
    const viewer = await create({ startLatLng: HERE });
    await expect(viewer.lookupPanoPosition('B')).resolves.not.toBeNull();

    viewer.clearPrefetchCache();

    await expect(viewer.lookupPanoPosition('B')).resolves.toBeNull();
    await expect(viewer.lookupPanoPosition('A')).resolves.toEqual(HERE);
    await viewer.setPano('A');
    expect(pictureFetches()).toEqual([]);
  });

  test('clearing the cache before any picture leaves nothing behind', async () => {
    items = [stacItem('A', HERE)];
    const viewer = await create();
    await viewer.findPanoNear(HERE);
    viewer.clearPrefetchCache();
    await expect(viewer.lookupPanoPosition('A')).resolves.toBeNull();
  });

  test('preloading warms the browser cache with the base image of the picture a move would land on', async () => {
    const requested = [];
    vi.stubGlobal('Image', class {
      set src(url) { requested.push(url); }
    });
    items = [stacItem('A', metersFrom(HERE, 3))];
    const viewer = await create();

    await viewer.preloadPanoNear(HERE);
    expect(requested).toEqual(['https://pics.example/A/sd.jpg']);

    items[0].assets = {};
    viewer.clearPrefetchCache();
    await viewer.preloadPanoNear(HERE);
    await viewer.preloadPanoNear(metersFrom(HERE, 500));
    expect(requested).toHaveLength(1);
  });

  test('a preload whose search fails costs nothing but a warning', async () => {
    fetchStub = routeFetch({ ...panoramaxRoutes(() => items), [`${PANORAMAX_API}/search`]: { status: 500 } });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const viewer = await create();

    await expect(viewer.preloadPanoNear(HERE)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('Failed to preload pano near', HERE, expect.any(Error));
  });

  test('links out to the picture on Panoramax\'s own site at the given view, facing ahead when none is given', () => {
    const viewer = new PanoramaxViewer();
    expect(viewer.publicViewerLink('A', { heading: 12.345, pitch: -3 })).toEqual({
      url: 'https://api.panoramax.xyz/#focus=pic&pic=A&xyz=12.35/-3.00/30',
      i18nKey: 'common:pano-info.view-in-panoramax',
    });
    expect(viewer.publicViewerLink('A', {}).url).toMatch(/xyz=0\.00\/0\.00\/30$/);
  });
});

describe('the attribution line the licence obliges', () => {
  const CC_BY_SA = { name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' };

  /**
   * Loads one picture and returns what the attribution overlay was told to show.
   * @param {object} properties - The picture's properties.
   * @param {Array<{rel: string, href: string}>} [links] - Its links.
   * @returns {Promise<object>} The attribution.
   */
  async function attributionFor(properties, links = []) {
    items = [stacItem('A', HERE, { properties, links })];
    await create({ startPanoId: 'A' });
    return overlays.attribution.show.mock.calls.at(-1)[0];
  }

  test('names the producer and the licence as the page\'s licence table words it', async () => {
    vi.stubGlobal('panoramaxLicenses', { 'CC-BY-SA-4.0': CC_BY_SA });
    await expect(attributionFor({ 'geovisio:producer': 'Jane', license: 'CC-BY-SA-4.0' })).resolves.toEqual({
      holder: 'Jane', provider: 'Panoramax', license: 'CC BY-SA 4.0', license_url: CC_BY_SA.url,
    });
  });

  test('the picture\'s own licence link wins over the table\'s', async () => {
    vi.stubGlobal('panoramaxLicenses', { 'CC-BY-SA-4.0': CC_BY_SA });
    const own = 'https://instance.example/licence';
    await expect(attributionFor({ license: 'CC-BY-SA-4.0' }, [{ rel: 'license', href: own }]))
      .resolves.toMatchObject({ license_url: own });
  });

  test('a licence the table doesn\'t know, or a page with no table, shows the raw identifier', async () => {
    await expect(attributionFor({ license: 'WTFPL' })).resolves.toMatchObject({ license: 'WTFPL', license_url: null });
  });

  test('a picture with neither producer nor licence still credits Panoramax', async () => {
    await expect(attributionFor({})).resolves.toEqual({
      holder: 'Panoramax contributor', provider: 'Panoramax', license: 'open licence', license_url: null,
    });
  });
});
