/**
 * Design-system colors for the API docs' canvas charts and Mapbox layers, which can't read CSS custom properties.
 *
 * Loaded by apiDocs/layout.scala.html ahead of the page content, so it exists before any preview script renders.
 */
window.ApiDocsTheme = {
  /**
   * Resolves a main.css color token to a CSS color string.
   *
   * @param {string} token - Custom property name, e.g. '--color-link-200'.
   * @param {number} [alpha] - Opacity 0–1. When given, the token's hex is rebuilt as rgba(), the one form Chart.js
   *                           and Mapbox both accept everywhere.
   * @returns {string} The color.
   */
  color(token, alpha) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
    if (alpha === undefined) return value;
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  },
};
