/**
 * Where a photo was taken from and what it looks at, as a map shape. It's what ties a card to the map: the location's
 * icon says where the feature is, and this says how the picture relates to that spot.
 */

import { destination, distance, point } from '@turf/turf';

const ARC_STEPS = 12;
// A little past the label, so the shape visibly reaches it rather than stopping short.
const OVERSHOOT = 1.25;

/**
 * @param {number[]} camera - The camera's `[lng, lat]`.
 * @param {number} headingDegrees - The direction the picture faces, clockwise from north.
 * @param {number} fovDegrees - The picture's horizontal field of view.
 * @param {number} radiusMeters - How far the shape reaches.
 * @returns {GeoJSON.Feature<GeoJSON.Polygon>} The wedge.
 */
export function viewWedge(camera, headingDegrees, fovDegrees, radiusMeters) {
  const start = headingDegrees - fovDegrees / 2;
  const arc = Array.from({ length: ARC_STEPS + 1 }, (_, i) => destination(
    point(camera), radiusMeters, start + (fovDegrees * i) / ARC_STEPS, { units: 'meters' },
  ).geometry.coordinates);
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [[camera, ...arc, camera]] },
  };
}

/**
 * @param {Record<string, any>} label - A `/label/labels` label: `camera_lat`, `camera_lng`, `heading`, `lat`, `lng`.
 * @param {number} fovDegrees - The picture's horizontal field of view.
 * @param {number} minRadiusMeters - The least it may reach. A camera is usually a few meters from what it saw, which on
 *   a map framing a whole street is smaller than the icon on top of it, so the host says what will show at its zoom.
 * @returns {?{camera: number[], wedge: GeoJSON.Feature<GeoJSON.Polygon>}} The shape, or null when the label doesn't say
 *   where its camera stood: some imagery sources don't record it.
 */
export function viewpointOf(label, fovDegrees, minRadiusMeters) {
  const { camera_lat: cameraLat, camera_lng: cameraLng, heading, lat, lng } = label;
  if (![cameraLat, cameraLng, heading].every(Number.isFinite)) return null;
  const camera = [cameraLng, cameraLat];
  const reach = [lat, lng].every(Number.isFinite)
    ? distance(point(camera), point([lng, lat]), { units: 'meters' }) * OVERSHOOT
    : 0;
  return { camera, wedge: viewWedge(camera, heading, fovDegrees, Math.max(minRadiusMeters, reach)) };
}
