/**
 * Tests for `backupImageDataIsComplete` / `buildBackupImageData` in public/js/common/utilitiesSidewalk.js, which keep
 * a pano_data row with null width/height from reaching PannellumViewer and throwing (#4804).
 *
 * The last block pins the guard's field list against PanoData, the authority it and two backend copies answer to.
 *
 * Runs under jsdom (jest.config.js).
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const UTILITIES_PATH = path.join(REPO_ROOT, 'public/js/common/utilitiesSidewalk.js');
const PANO_DATA_PATH = path.join(REPO_ROOT, 'public/js/common/pano-viewer/src/PanoData.js');

/**
 * Execute a production global script in the jsdom global scope, then hoist the named bindings onto `global`.
 *
 * Indirect eval puts top-level `function` declarations on globalThis, but not `const`/`class` — hence the epilogue.
 *
 * @param {string} filePath Absolute path to the script.
 * @param {string[]} names Bindings to expose on `global`.
 */
function loadScript(filePath, names) {
  const src = fs.readFileSync(filePath, 'utf8');
  const epilogue = names.map((n) => `global.${n} = ${n};`).join('\n');
  (0, eval)(`${src}\n${epilogue}`);
}

/** A backup pano whose metadata is complete — the shape buildBackupImageData produces. */
function completeBackupImageData() {
  return {
    panoId: 'abc123',
    imageUrl: '/backupImage/abc123?exp=1&sig=x',
    width: 13312,
    height: 6656,
    tileWidth: 512,
    tileHeight: 512,
    lat: 47.6,
    lng: -122.3,
    cameraHeading: 180.5,
    cameraPitch: 0,
    cameraRoll: 0,
    captureDate: '2011-05',
    copyright: '© 2011 Google',
    address: '123 Fake St',
  };
}

/** Label metadata as the server sends it, for the buildBackupImageData tests. */
function labelMetadata(panoDataOverrides = {}) {
  return {
    pano_id: 'abc123',
    backup_image_url: '/backupImage/abc123?exp=1&sig=x',
    camera_lat: 47.6,
    camera_lng: -122.3,
    image_capture_date: '2011-05',
    pano_data: {
      width: 13312,
      height: 6656,
      tile_width: 512,
      tile_height: 512,
      camera_heading: 180.5,
      camera_pitch: 0,
      camera_roll: 0,
      copyright: '© 2011 Google',
      address: '123 Fake St',
      ...panoDataOverrides,
    },
  };
}

beforeAll(() => {
  loadScript(UTILITIES_PATH, ['BACKUP_IMAGE_REQUIRED_FIELDS']);
  // PanoData checks `captureDate instanceof moment`; a bare constructor is enough to satisfy it here.
  global.moment = function Moment() {};
  loadScript(PANO_DATA_PATH, ['PanoData']);
});

describe('backupImageDataIsComplete', () => {
  test('accepts metadata with every required field', () => {
    expect(backupImageDataIsComplete(completeBackupImageData())).toBe(true);
  });

  test.each(['width', 'height', 'lat', 'lng', 'cameraHeading', 'cameraPitch'])('rejects null %s', (field) => {
    const data = completeBackupImageData();
    data[field] = null; // What the server sends for a NULL pano_data column.
    expect(backupImageDataIsComplete(data)).toBe(false);
  });

  test.each(['width', 'height', 'lat', 'lng', 'cameraHeading', 'cameraPitch'])('rejects missing %s', (field) => {
    const data = completeBackupImageData();
    delete data[field];
    expect(backupImageDataIsComplete(data)).toBe(false);
  });

  test('rejects a field that is present but not a usable number', () => {
    expect(backupImageDataIsComplete({ ...completeBackupImageData(), width: NaN })).toBe(false);
    expect(backupImageDataIsComplete({ ...completeBackupImageData(), width: '13312' })).toBe(false);
  });

  test('accepts zero values, which are legitimate for the camera angles', () => {
    const data = { ...completeBackupImageData(), cameraHeading: 0, cameraPitch: 0 };
    expect(backupImageDataIsComplete(data)).toBe(true);
  });

  test('rejects null and undefined', () => {
    expect(backupImageDataIsComplete(null)).toBe(false);
    expect(backupImageDataIsComplete(undefined)).toBe(false);
  });

  test('does not require the optional fields', () => {
    const data = completeBackupImageData();
    delete data.cameraRoll;
    delete data.tileWidth;
    delete data.tileHeight;
    delete data.address;
    delete data.copyright;
    expect(backupImageDataIsComplete(data)).toBe(true);
  });
});

describe('buildBackupImageData', () => {
  test('builds the viewer metadata when pano_data is complete', () => {
    const built = buildBackupImageData(labelMetadata());

    expect(built).not.toBeNull();
    expect(built.panoId).toBe('abc123');
    expect(built.width).toBe(13312);
    expect(built.cameraHeading).toBe(180.5);
    // Camera position comes off the label metadata, not the nested pano_data.
    expect(built.lat).toBe(47.6);
    expect(built.lng).toBe(-122.3);
  });

  test('returns null when pano_data is missing the dimensions (#4804)', () => {
    expect(buildBackupImageData(labelMetadata({ width: null, height: null }))).toBeNull();
  });

  test('returns null when pano_data is missing the camera angles', () => {
    expect(buildBackupImageData(labelMetadata({ camera_pitch: null }))).toBeNull();
  });

  test('returns null when there is no camera location', () => {
    const meta = labelMetadata();
    meta.camera_lat = null;
    meta.camera_lng = null;
    expect(buildBackupImageData(meta)).toBeNull();
  });

  test('returns null when there is no backup image or no pano_data at all', () => {
    expect(buildBackupImageData({ ...labelMetadata(), backup_image_url: null })).toBeNull();
    expect(buildBackupImageData({ ...labelMetadata(), pano_data: null })).toBeNull();
  });
});

describe('coupling to PanoData', () => {
  /** The params PannellumViewer hands PanoData for a complete backup pano. */
  function panoDataParams() {
    return {
      panoId: 'abc123',
      source: 'pannellum',
      lat: 47.6,
      lng: -122.3,
      cameraHeading: 180.5,
      cameraPitch: 0,
      width: 13312,
      height: 6656,
      captureDate: new global.moment(),
      linkedPanos: [],
      history: [],
    };
  }

  test('the params are otherwise valid, so the per-field assertions below mean what they say', () => {
    expect(() => new PanoData(panoDataParams())).not.toThrow();
  });

  // If a field is added to PanoData's requiredParams, this fails until the guard (and its two backend copies) catch
  // up, rather than #4804 recurring silently.
  test.each(['width', 'height', 'lat', 'lng', 'cameraHeading', 'cameraPitch'])(
    'PanoData rejects a pano missing %s, matching the guard',
    (field) => {
      const params = panoDataParams();
      delete params[field];

      expect(() => new PanoData(params)).toThrow(`Missing required parameter: ${field}`);
      expect(BACKUP_IMAGE_REQUIRED_FIELDS).toContain(field);
    },
  );

  test('the guard checks every field PanoData requires that a pano_data row can be missing', () => {
    // These are supplied unconditionally by PannellumViewer#buildPanoData, so they can't be missing at runtime.
    const suppliedByViewer = ['panoId', 'source', 'captureDate', 'linkedPanos', 'history'];
    for (const field of Object.keys(panoDataParams())) {
      if (!suppliedByViewer.includes(field)) {
        expect(BACKUP_IMAGE_REQUIRED_FIELDS).toContain(field);
      }
    }
  });
});
