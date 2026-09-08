/**
 * Base for the views in the AccessScore insights dock (#5217): a container, the callbacks a view reports through,
 * and the render/update split that keeps a slider drag cheap.
 *
 * `draw(data)` compares `data.shapeKey` with the last one drawn and calls `render` — a full DOM rebuild, for a new
 * unit, scope, or roster — only when it changed; otherwise `update`, which subclasses keep to writes of
 * `style.width`, `style.backgroundColor`, class toggles, and `textContent` on nodes cached at render. The dock is
 * the only caller and batches its calls into one animation frame; nothing here schedules anything.
 *
 * The views are hand-rolled HTML rather than a chart library: the page already carries Mapbox GL and a pano SDK,
 * and every datum here is a named, focusable element in its own right, which is also why there is no separate
 * table view — the chart *is* readable without color or a pointer.
 */
class AccessScoreChart {
  #container;
  #callbacks;
  #shapeKey = null;

  /**
   * @param {HTMLElement} container - The element the view renders into (its content is replaced on render).
   * @param {Object<string, function>} [callbacks] - Handlers the view reports through, by name (`onHover`,
   *                                                `onHoverEnd`, `onSelect`, `onBrush`, …); a missing one is a no-op.
   */
  constructor(container, callbacks = {}) {
    this.#container = container;
    this.#callbacks = callbacks;
  }

  /** The element the view renders into. */
  get container() {
    return this.#container;
  }

  /**
   * Draws the data, rebuilding the DOM only when its shape changed.
   * @param {object} data - View data; `data.shapeKey` names the shape (unit, scope, roster) it was computed for.
   */
  draw(data) {
    if (data.shapeKey !== this.#shapeKey) {
      this.#shapeKey = data.shapeKey;
      this.render(data);
    } else {
      this.update(data);
    }
  }

  /**
   * Full DOM rebuild. Subclasses cache the nodes `update` writes to here.
   * @param {object} data - View data.
   */
  render(data) { // eslint-disable-line no-unused-vars
    throw new Error('render() is abstract');
  }

  /**
   * A cheap redraw over the DOM `render` built: values, widths, colors, states — never structure.
   * @param {object} data - View data of the same shape as the last render.
   */
  update(data) { // eslint-disable-line no-unused-vars
    throw new Error('update() is abstract');
  }

  /**
   * Reports through a named callback, if the owner supplied one.
   * @param {string} name - The callback's name, e.g. `onHover`.
   * @param {...*} args - Its arguments.
   */
  emit(name, ...args) {
    this.#callbacks[name]?.(...args);
  }

  /**
   * A number in the reader's locale.
   * @param {number} value - The number.
   * @param {object} [options] - `Intl.NumberFormat` options.
   * @returns {string} The formatted number.
   */
  static number(value, options = {}) {
    return new Intl.NumberFormat(i18next.language, options).format(value);
  }

  /**
   * A score in [0, 1] as the whole number people see.
   * @param {number} score - The score.
   * @returns {string} "0" to "100".
   */
  static score(score) {
    return AccessScoreChart.number(Math.round(score * 100));
  }

  /**
   * The display name of a label type, from the common namespace ("NoCurbRamp" → common:no-curb-ramp).
   * @param {string} type - A label type.
   * @returns {string} Its translated name.
   */
  static typeName(type) {
    return i18next.t(`common:${type.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}`);
  }

  /**
   * Escapes text for an HTML attribute or element body. Region names come from the database, so they take this
   * path rather than being trusted into markup.
   * @param {*} value - The text.
   * @returns {string} The escaped text.
   */
  static esc(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;',
    }[c]));
  }
}
