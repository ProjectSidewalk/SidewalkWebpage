/**
 * Centralized styling for everything drawn on the Explore minimap: route polylines, fog of war, FOV cone, and the
 * 360°-observed progress ring.
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

  /** @returns {string} Color of the not-yet-audited part of the current route. */
  static remainingColor() {
    return MinimapStyle.token('--color-asphalt-400', '#424055');
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

  /**
   * White casing drawn under both halves of the current street, separating the route from the basemap. This is what
   * lets the 4px lines stay legible over parks/roads regardless of hue (the old 2px lines had 1.07:1 contrast).
   * @param {google.maps.LatLng[]} path - The polyline path.
   * @returns {google.maps.PolylineOptions}
   */
  static routeCasing(path) {
    return {
      path,
      geodesic: true,
      strokeColor: '#ffffff',
      strokeOpacity: 0.9,
      strokeWeight: MinimapStyle.#CASING_WEIGHT,
      zIndex: 10,
    };
  }

  /**
   * The audited (already explored) half of the current street: a solid line.
   * @param {google.maps.LatLng[]} path - The polyline path.
   * @returns {google.maps.PolylineOptions}
   */
  static auditedRoute(path) {
    return {
      path,
      geodesic: true,
      strokeColor: MinimapStyle.auditedColor(),
      strokeOpacity: 1.0,
      strokeWeight: MinimapStyle.#ROUTE_WEIGHT,
      zIndex: 11,
    };
  }

  /**
   * The remaining (walk this way) half of the current street: a dark dashed line with direction chevrons. Dashes are
   * drawn via repeated symbols (the standard Google Maps dashed-polyline technique, since strokes can't dash). The
   * chevrons are white with a dark outline so they read on both the dark dashes and the white casing between them.
   * @param {google.maps.LatLng[]} path - The polyline path.
   * @returns {google.maps.PolylineOptions}
   */
  static remainingRoute(path) {
    const color = MinimapStyle.remainingColor();
    return {
      path,
      geodesic: true,
      strokeOpacity: 0,
      zIndex: 12,
      icons: [
        {
          icon: {
            path: 'M 0,-1 0,1',
            strokeColor: color,
            strokeOpacity: 1.0,
            strokeWeight: MinimapStyle.#ROUTE_WEIGHT,
            scale: 4,
          },
          offset: '0',
          repeat: '15px',
        },
        {
          icon: {
            path: 'M -2.2,2 L 0,-1.8 L 2.2,2 Z',
            fillColor: '#ffffff',
            fillOpacity: 1.0,
            strokeColor: color,
            strokeOpacity: 1.0,
            strokeWeight: 1.4,
            scale: 2.4,
          },
          offset: '28px',
          repeat: '55px',
        },
      ],
    };
  }

  /**
   * A street the user has already completed (not the current one).
   * @param {google.maps.LatLng[]} path - The polyline path.
   * @returns {google.maps.PolylineOptions}
   */
  static completedTask(path) {
    return {
      path,
      geodesic: true,
      strokeColor: MinimapStyle.auditedColor(),
      strokeOpacity: 0.95,
      strokeWeight: 3,
      zIndex: 6,
    };
  }

  /**
   * A street in the neighborhood that isn't part of the current task: quiet context.
   * @param {google.maps.LatLng[]} path - The polyline path.
   * @returns {google.maps.PolylineOptions}
   */
  static otherTask(path) {
    return {
      path,
      geodesic: true,
      strokeColor: MinimapStyle.token('--color-neutral-600', '#8F8F8F'),
      strokeOpacity: 0.75,
      strokeWeight: 2.5,
      zIndex: 5,
    };
  }
}
