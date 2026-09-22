/**
 * The glyph each place category (#5311) wears, shared by every map that draws places: the AccessScore map and the
 * Explore minimap's landmarks. The categories themselves come from the backend (`place_categories` on
 * `/v3/api/accessScoreConfig`); this is presentation only, so a category the backend adds before this file learns
 * it still draws, as a plain pin.
 */
class PlaceCategoryIcons {
  /** Per category: a white Lucide glyph under `images/icons/`, drawn over a colored disc. */
  static #FILES = Object.freeze({
    school: 'school-white-lucide.svg',
    health: 'hospital-white-lucide.svg',
    library: 'library-white-lucide.svg',
    grocery: 'shopping-basket-white-lucide.svg',
    transit: 'bus-white-lucide.svg',
    park: 'trees-white-lucide.svg',
    community: 'users-white-lucide.svg',
    government: 'landmark-white-lucide.svg',
  });

  /** The glyph of a category this file doesn't know yet. */
  static DEFAULT_FILE = 'map-pin-white-lucide.svg';

  /**
   * @param {string} category - A category id.
   * @returns {string} The glyph's file name under `images/icons/`.
   */
  static file(category) {
    return PlaceCategoryIcons.#FILES[category] ?? PlaceCategoryIcons.DEFAULT_FILE;
  }
}
