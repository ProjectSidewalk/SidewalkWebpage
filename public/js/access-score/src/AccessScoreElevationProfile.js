/**
 * A street's elevation profile as a small dependency-free SVG (#5223): distance along the street across, elevation
 * up, the ground filled beneath the line so a hill reads as a hill.
 *
 * The vertical scale is exaggerated to fit, as every elevation profile is, so the picture shows where the street
 * climbs and the numbers beside it say how steeply; the accessible name carries the same numbers, since the shape
 * itself says nothing to a screen reader.
 *
 * @typedef {object} AccessScoreProfile
 * @property {number} spacing_meters - Distance between consecutive samples.
 * @property {number[]} elevations_meters - Elevations from the street's first vertex to its last.
 */
class AccessScoreElevationProfile {
  static #WIDTH = 320;
  static #HEIGHT = 96;
  static #PAD = { top: 8, right: 6, bottom: 6, left: 6 };
  /** A level street would otherwise fill the chart with its own sample noise; a span this tall keeps it level. */
  static #MIN_SPAN_METERS = 2;

  /**
   * The chart's markup.
   * @param {AccessScoreProfile} profile - The street's profile, from `/v3/api/streetGradientProfile`.
   * @param {object} text - The words and formatted numbers around the chart, already escaped for markup.
   * @param {string} text.label - The accessible name: what the chart shows, in a sentence.
   * @param {string} text.low - The lowest elevation, formatted.
   * @param {string} text.high - The highest elevation, formatted.
   * @param {string} text.start - The label under the street's first vertex.
   * @param {string} text.end - The label under its last.
   * @returns {string} A `<figure>`; empty for a profile too short to draw.
   */
  static html(profile, text) {
    const elevations = profile?.elevations_meters ?? [];
    if (elevations.length < 2) return '';
    const { points, baseline } = AccessScoreElevationProfile.#layout(elevations);
    const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const first = points[0];
    const last = points[points.length - 1];
    const viewBox = `0 0 ${AccessScoreElevationProfile.#WIDTH} ${AccessScoreElevationProfile.#HEIGHT}`;
    const area = `${line} L${last[0].toFixed(1)},${baseline} L${first[0].toFixed(1)},${baseline} Z`;
    return `<figure class="acs-profile">
        <div class="acs-profile__scale" aria-hidden="true"><span>${text.high}</span><span>${text.low}</span></div>
        <svg class="acs-profile__chart" viewBox="${viewBox}" preserveAspectRatio="none" role="img"
             aria-label="${text.label}">
          <path class="acs-profile__area" d="${area}"></path>
          <path class="acs-profile__line" d="${line}"></path>
        </svg>
        <div class="acs-profile__ends" aria-hidden="true"><span>${text.start}</span><span>${text.end}</span></div>
      </figure>`;
  }

  /**
   * The lowest and highest elevation of a profile.
   * @param {AccessScoreProfile} profile - The street's profile.
   * @returns {{low: number, high: number}}
   */
  static range(profile) {
    const elevations = profile.elevations_meters;
    return { low: Math.min(...elevations), high: Math.max(...elevations) };
  }

  /**
   * Places each sample in the chart's box.
   * @param {number[]} elevations - The samples, evenly spaced along the street.
   * @returns {{points: Array<[number, number]>, baseline: number}} Each sample's x and y, and the y the fill closes on.
   */
  static #layout(elevations) {
    const { top, right, bottom, left } = AccessScoreElevationProfile.#PAD;
    const width = AccessScoreElevationProfile.#WIDTH - left - right;
    const height = AccessScoreElevationProfile.#HEIGHT - top - bottom;
    const low = Math.min(...elevations);
    const high = Math.max(...elevations);
    // Centered on the street's own range, so a near-level street draws as a flat line through the middle.
    const span = Math.max(high - low, AccessScoreElevationProfile.#MIN_SPAN_METERS);
    const floor = (low + high) / 2 - span / 2;
    const points = elevations.map((e, i) => /** @type {[number, number]} */ ([
      left + (width * i) / (elevations.length - 1),
      top + height * (1 - (e - floor) / span),
    ]));
    return { points, baseline: AccessScoreElevationProfile.#HEIGHT - bottom };
  }
}
