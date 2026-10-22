/**
 * Tests for MapillaryViewer.extractPitchRoll in frontend/js/common/pano-viewer/MapillaryViewer.js (#5811).
 *
 * The server's copy, PanoDataService.mapillaryPitchRoll, fills the same columns for images no labeler opened, so these
 * cases are PanoDataServiceSpec's, with its expected values: the two must give one answer per image.
 */
import { loadModules } from './loader.js';

// A level camera facing north is a quarter turn about east; the cap cases pitch it down from there.
const LEVEL_NORTH = Math.PI / 2;
const toRadians = (degrees) => degrees * Math.PI / 180;

describe('MapillaryViewer.extractPitchRoll', () => {
  let MapillaryViewer;

  beforeAll(async () => {
    ({ MapillaryViewer } = await loadModules('frontend/js/common/pano-viewer/PanoViewer.js',
      'frontend/js/common/pano-viewer/MapillaryViewer.js'));
  });

  beforeEach(() => {
    window.mapillaryMaxPoseTiltDeg = 45;
  });

  afterEach(() => {
    delete window.mapillaryMaxPoseTiltDeg;
  });

  test('a real Richmond pano (2163793620710887) gives the pose the auto-labeler stored', () => {
    const { pitch, roll } = MapillaryViewer.extractPitchRoll([1.3857263583832, 0.71804330335161, -0.58250746512038]);
    expect(pitch).toBeCloseTo(2.231776541825151, 9);
    expect(roll).toBeCloseTo(-6.354952531976069, 9);
  });

  test('a level camera is pitch 0, roll 0', () => {
    const { pitch, roll } = MapillaryViewer.extractPitchRoll([LEVEL_NORTH, 0, 0]);
    expect(pitch).toBeCloseTo(0, 9);
    expect(roll).toBeCloseTo(0, 9);
  });

  test('a tilt up to the server\'s cap is a pose, past it is not', () => {
    expect(MapillaryViewer.extractPitchRoll([LEVEL_NORTH + toRadians(44), 0, 0]).pitch).toBeCloseTo(-44, 9);
    expect(MapillaryViewer.extractPitchRoll([LEVEL_NORTH + toRadians(46), 0, 0])).toBeNull();
    // Upside down, the failed-reconstruction case the cap exists for.
    expect(MapillaryViewer.extractPitchRoll([Math.PI, 0, 0])).toBeNull();
  });

  test('a malformed vector is no pose', () => {
    expect(MapillaryViewer.extractPitchRoll([])).toBeNull();
    expect(MapillaryViewer.extractPitchRoll([LEVEL_NORTH, 0])).toBeNull();
    expect(MapillaryViewer.extractPitchRoll([LEVEL_NORTH, NaN, 0])).toBeNull();
    expect(MapillaryViewer.extractPitchRoll([LEVEL_NORTH, 0, Infinity])).toBeNull();
    expect(MapillaryViewer.extractPitchRoll(undefined)).toBeNull();
  });

  describe('on a page that never stamps the cap', () => {
    beforeEach(() => {
      delete window.mapillaryMaxPoseTiltDeg;
    });

    test('any tilt is a pose', () => {
      expect(MapillaryViewer.extractPitchRoll([LEVEL_NORTH + toRadians(46), 0, 0]).pitch).toBeCloseTo(-46, 9);
    });

    test('a camera pointing straight down or up has roll 0, not ±180', () => {
      const down = MapillaryViewer.extractPitchRoll([Math.PI, 0, 0]);
      expect(down.pitch).toBeCloseTo(-90, 9);
      expect(down.roll).toBe(0);
      // No rotation at all leaves the camera's forward axis on world up.
      const up = MapillaryViewer.extractPitchRoll([0, 0, 0]);
      expect(up.pitch).toBeCloseTo(90, 9);
      expect(up.roll).toBe(0);
    });
  });
});
