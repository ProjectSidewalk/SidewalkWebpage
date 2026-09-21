/**
 * Centralized styling for everything Project Sidewalk draws on the Explore minimap: street lines, fog of war, FOV
 * cone, and the 360°-observed progress ring. (The basemap under them is MinimapBasemapStyle.)
 *
 * Colors are read from the design-token CSS custom properties defined in main.css :root rather than re-declared here,
 * so the minimap stays in sync with the design system. The route encoding is deliberately redundant (#4639): the
 * audited/remaining halves differ in hue AND lightness AND texture (solid vs. dashed-with-chevrons), so the map stays
 * readable under color-vision deficiency and in grayscale.
 */
class MinimapStyle {
  /** Cache of resolved design-token values; tokens are static for the life of the page. */
  static #tokens = {};

  /** Route line weight (px) for the current street; casing covers the dashed line's gaps. */
  static #ROUTE_WEIGHT = 6;
  static #CASING_WEIGHT = 9;

  /**
   * Reads a design-token CSS custom property from the document root.
   * @param {string} name - Custom property name, e.g. '--color-pine-600'.
   * @param {string} fallback - Value to use if the token is missing (e.g. in tests without main.css).
   * @returns {string}
   */
  static token(name, fallback) {
    if (!(name in MinimapStyle.#tokens)) {
      const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      MinimapStyle.#tokens[name] = value || fallback;
    }
    return MinimapStyle.#tokens[name];
  }

  /** @returns {string} Color of audited route segments (and the FOV cone, which shares the hue). */
  static auditedColor() {
    return MinimapStyle.token('--color-pine-600', '#60A189');
  }

  /**
   * Color of the not-yet-audited part of the current route: the forward arrow's blue lightened toward white, so the
   * line reads as the arrow's path without matching the peg. Deliberately light: its separation from the pine
   * audited half comes from texture (5 on / 7 off dashes and chevrons), not from contrast, and the legend swatches
   * read the same token.
   * @returns {string}
   */
  static remainingColor() {
    return MinimapStyle.token('--color-route-ahead', '#95BFEA');
  }

  /** @returns {string} Fill of the route-ahead chevrons: deep blue, so they read on the dashes and the casing alike. */
  static chevronColor() {
    return MinimapStyle.token('--color-link-200', '#0A58CA');
  }

  /** @returns {string} Stroke color of the 360°-observed progress ring while in progress (matches the progress bar). */
  static ringColor() {
    return MinimapStyle.token('--color-pine-600', '#60A189');
  }

  /** @returns {string} Stroke color of the progress ring once the full 360° has been observed. */
  static ringCompleteColor() {
    return MinimapStyle.token('--color-success-200', '#11C961');
  }

  /** @returns {string} Fill color of the fog of war over unobserved areas. */
  static fogColor() {
    return MinimapStyle.token('--color-neutral-700', '#6B6B6B');
  }

  /** @returns {string} Fill of the route's start marker; matches the green in RouteBuilder's flag-start.svg. */
  static routeStartColor() {
    return MinimapStyle.token('--color-success-200', '#11C961');
  }

  /** @returns {string} Fill of the route's finish marker; matches the red in RouteBuilder's flag-end.svg. */
  static routeFinishColor() {
    return MinimapStyle.token('--color-error-200', '#ED1C24');
  }

  /** @returns {string} The peg's blue (--color-link-100), also the on-pano forward arrow's and, lightened, the
   * route-ahead line's; the route-overview "you are here" dot reuses it so it can't drift from the peg. */
  static pegColor() {
    return MinimapStyle.token('--color-link-100', '#3E8BD9');
  }

  /**
   * The audited/cone hue as RGB channels, for building canvas gradients with varying alpha.
   * @returns {{r: number, g: number, b: number}}
   */
  static coneRgb() {
    // Tokens are 6-digit hex colors (see main.css :root).
    const hex = MinimapStyle.auditedColor().replace('#', '');
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }

  /** Id of the chevron image Minimap registers with the map (see chevronImage) for the route-ahead layer to draw. */
  static CHEVRON_IMAGE_ID = 'minimap-route-chevron';

  /**
   * How a street is drawn, by the `kind` a Task gives each of its lines (see Minimap.setStreetLines):
   *  - `audited`: the explored half of the current street, a solid line over a white casing.
   *  - `remaining`: the walk-this-way half (and, on a designated route, every street ahead): light-blue dashes with
   *    small deep-blue direction chevrons over the same casing. 5px dashes with 7px gaps: the rhythm, not the hue,
   *    separates this line from the pine one.
   *  - `completed`: a street, or part of one, already walked that isn't the current street.
   *  - `other`: a street in the region that isn't part of the current task: quiet context.
   *
   * The white casing is what keeps the route legible over parks and roads regardless of hue. Layers are listed bottom
   * to top, so context streets sit under the route and the chevrons sit over everything.
   * @param {string} source - Id of the GeoJSON source holding the street lines.
   * @returns {object[]} MapLibre layer specifications, in drawing order.
   */
  static streetLayers(source) {
    const kindIs = (...kinds) => ['match', ['get', 'kind'], kinds, true, false];
    const round = { 'line-cap': 'round', 'line-join': 'round' };
    return [
      {
        id: 'street-other',
        type: 'line',
        source,
        filter: kindIs('other'),
        layout: round,
        paint: {
          'line-color': MinimapStyle.token('--color-neutral-600', '#8F8F8F'),
          'line-opacity': 0.75,
          'line-width': 2.5,
        },
      },
      {
        id: 'street-completed',
        type: 'line',
        source,
        filter: kindIs('completed'),
        layout: round,
        paint: { 'line-color': MinimapStyle.auditedColor(), 'line-opacity': 0.95, 'line-width': 3 },
      },
      {
        id: 'street-casing',
        type: 'line',
        source,
        filter: kindIs('audited', 'remaining'),
        layout: round,
        paint: {
          'line-color': MinimapStyle.token('--color-neutral-white', '#FFFFFF'),
          'line-opacity': 0.9,
          'line-width': MinimapStyle.#CASING_WEIGHT,
        },
      },
      {
        id: 'street-audited',
        type: 'line',
        source,
        filter: kindIs('audited'),
        layout: round,
        paint: { 'line-color': MinimapStyle.auditedColor(), 'line-width': MinimapStyle.#ROUTE_WEIGHT },
      },
      {
        id: 'street-remaining',
        type: 'line',
        source,
        filter: kindIs('remaining'),
        // Butt caps: round ones would eat into the gaps and blur the dash rhythm.
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': MinimapStyle.remainingColor(),
          'line-width': MinimapStyle.#ROUTE_WEIGHT,
          // In units of the line width: 5px on, 7px off.
          'line-dasharray': [5 / MinimapStyle.#ROUTE_WEIGHT, 7 / MinimapStyle.#ROUTE_WEIGHT],
        },
      },
      {
        id: 'street-remaining-chevrons',
        type: 'symbol',
        source,
        filter: kindIs('remaining'),
        layout: {
          'symbol-placement': 'line',
          'symbol-spacing': 55,
          'icon-image': MinimapStyle.CHEVRON_IMAGE_ID,
          'icon-rotation-alignment': 'map',
          // A chevron is part of the line, not a label: it must never be dropped to make room for a road name.
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      },
    ];
  }

  /**
   * The direction chevron repeated along the route ahead: small and solid, because an outlined one reads as a button.
   * Drawn pointing right (+x), which a line-placed symbol aligns with the line's direction, so chevrons point the way
   * the street's coordinates run.
   * @param {number} pixelRatio - Device pixel ratio to rasterize at, so the chevron stays crisp on dense displays.
   * @returns {ImageData} The chevron bitmap, for map.addImage(..., { pixelRatio }).
   */
  static chevronImage(pixelRatio) {
    const length = 6;
    const halfWidth = 3.5;
    const pad = 1; // Keeps the antialiased edge inside the bitmap.
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil((length + 2 * pad) * pixelRatio);
    canvas.height = Math.ceil((2 * halfWidth + 2 * pad) * pixelRatio);
    const ctx = canvas.getContext('2d');
    ctx.scale(pixelRatio, pixelRatio);
    ctx.beginPath();
    ctx.moveTo(pad, pad);
    ctx.lineTo(pad + length, pad + halfWidth);
    ctx.lineTo(pad, pad + 2 * halfWidth);
    ctx.closePath();
    ctx.fillStyle = MinimapStyle.chevronColor();
    ctx.fill();
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  }
}
