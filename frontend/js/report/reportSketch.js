/**
 * A street and its locations as a small inline SVG, with no basemap. It's what stands in the map's place until the map
 * loads, and what prints: a WebGL canvas comes out blank on paper in most browsers, and a report with fifty streets
 * can't have fifty live maps for a browser to capture.
 */

const WIDTH = 400;
const HEIGHT = 260;
const PADDING = 24;
const ICON = 18;

/**
 * Fits lng/lat into the frame, keeping the map's shape: a degree of longitude shrinks with latitude.
 * @param {number[][]} points - The `[lng, lat]`s that must fit.
 * @returns {(lngLat: number[]) => number[]} Projects to `[x, y]`.
 */
export function fitProjection(points) {
  const lngs = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  const [minLng, maxLng, minLat, maxLat] = [Math.min(...lngs), Math.max(...lngs), Math.min(...lats), Math.max(...lats)];
  const squeeze = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const spanX = Math.max((maxLng - minLng) * squeeze, 1e-6);
  const spanY = Math.max(maxLat - minLat, 1e-6);
  const scale = Math.min((WIDTH - 2 * PADDING) / spanX, (HEIGHT - 2 * PADDING) / spanY);
  const offsetX = (WIDTH - spanX * scale) / 2;
  const offsetY = (HEIGHT - spanY * scale) / 2;
  return ([lng, lat]) => [offsetX + (lng - minLng) * squeeze * scale, HEIGHT - offsetY - (lat - minLat) * scale];
}

/**
 * @param {number[][][]} lines - The street's lines, each a list of `[lng, lat]`.
 * @param {Array<{lng: number, lat: number, iconUrl: string}>} locations - What's on it.
 * @returns {string} The SVG's markup, or an empty string with nothing to draw.
 */
export function reportSketch(lines, locations) {
  const all = [...lines.flat(), ...locations.map((l) => [l.lng, l.lat])];
  if (all.length === 0) return '';
  const project = fitProjection(all);
  const paths = lines.map((line) => {
    const d = line.map((p, i) => `${i ? 'L' : 'M'}${project(p).map((n) => n.toFixed(1)).join(' ')}`).join('');
    return `<path d="${d}"/>`;
  }).join('');
  const icons = locations.map((l) => {
    const [x, y] = project([l.lng, l.lat]);
    return `<image href="${l.iconUrl}" x="${(x - ICON / 2).toFixed(1)}" y="${(y - ICON / 2).toFixed(1)}"`
      + ` width="${ICON}" height="${ICON}"/>`;
  }).join('');
  return `<svg class="report-map__sketch" viewBox="0 0 ${WIDTH} ${HEIGHT}" aria-hidden="true" focusable="false">
    <g class="report-map__sketch-street">${paths}</g>${icons}</svg>`;
}
