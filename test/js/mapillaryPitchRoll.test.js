/**
 * Tests for MapillaryViewer.extractPitchRoll in frontend/js/common/pano-viewer/MapillaryViewer.js (#5811).
 *
 * The expected angles were computed by the three.js version this replaced, on the same rotations, so a gl-matrix
 * call that turned the camera the wrong way, or about the wrong axis, shows up as a mismatch.
 */
import { loadModules } from './loader.js';

// Mapillary rotation vector (axis-angle, world-to-camera) → { pitch, roll } in degrees, from the three.js version.
const CASES = [
  // A level camera facing north, and one facing east: no pitch, no roll.
  { rotation: [1.2091995, -1.2091995, 1.2091995], pitch: 0.0000043634, roll: 0.0000043634 },
  { rotation: [1.5707963, 0, 0], pitch: 0.0000015352, roll: 0 },
  { rotation: [1.4, 0.1, -0.05], pitch: 9.591978679815277, roll: -2.360266784955564 },
  { rotation: [1.65, -0.2, 0.3], pitch: -4.737662759023937, roll: -4.396294992589684 },
  { rotation: [0.9, -1.1, 1.3], pitch: 15.432214549168513, roll: 6.572449388832217 },
  { rotation: [2.0, 0.5, -0.4], pitch: -26.75962943553258, roll: 4.333022375397404 },
];

describe('MapillaryViewer.extractPitchRoll', () => {
  let viewer;

  beforeEach(async () => {
    const { MapillaryViewer } = await loadModules('frontend/js/common/pano-viewer/PanoViewer.js',
      'frontend/js/common/pano-viewer/MapillaryViewer.js');
    viewer = new MapillaryViewer();
  });

  it.each(CASES)('matches the three.js angles for rotation $rotation', ({ rotation, pitch, roll }) => {
    const result = viewer.extractPitchRoll(rotation);
    expect(result.pitch).toBeCloseTo(pitch, 4);
    expect(result.roll).toBeCloseTo(roll, 4);
  });

  it('treats a zero rotation as a camera looking straight up', () => {
    // With no rotation, camera forward (+Z) is world up (+Z).
    expect(viewer.extractPitchRoll([0, 0, 0]).pitch).toBeCloseTo(90, 6);
  });
});
