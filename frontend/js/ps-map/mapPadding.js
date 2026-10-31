/**
 * The map's padding, shared by the overlays that each own one edge of it: the controls drawer on the left
 * (`MapSidebarDrawer`), and on the AccessScore page the insights dock along the bottom and the street panel on the
 * right (#5748). Mapbox keeps one padding object and interpolates it through an ease, so an owner that built its
 * padding from `map.getPadding()` while another's ease was in flight would read a half-way value and ease the map
 * to it, and any camera call at all, `setPadding` included (it is a `jumpTo`), cancels a `flyTo` that is still on
 * its way. The target padding is kept here instead, per map, so every owner builds on where the others are going;
 * and while the camera is already moving, the new padding waits for that move to end rather than cutting it short.
 * A fly that wants to land already padded passes `paddingTarget(map)` as its own `padding`.
 */

/** @typedef {{top: number, right: number, bottom: number, left: number}} MapPadding */

/**
 * What the helper needs of a map: Mapbox's, or a test stand-in with these four.
 * @typedef {object} PaddableMap
 * @property {() => MapPadding} getPadding
 * @property {(padding: MapPadding) => any} setPadding
 * @property {(options: object) => any} easeTo
 * @property {() => boolean} [isMoving]
 * @property {(type: string, listener: () => void) => any} [once]
 */

/** @type {WeakMap<PaddableMap, MapPadding>} */
const targets = new WeakMap();
/** The maps with a padding change waiting for the current move to end. */
const deferred = new WeakSet();

/**
 * The padding the map is heading for: the last target set here, or the map's own padding before any was.
 * @param {PaddableMap} map - A Mapbox map.
 * @returns {MapPadding} A copy; edit it through `setPaddingEdges`.
 */
export function paddingTarget(map) {
  if (!targets.has(map)) targets.set(map, { ...map.getPadding() });
  return { ...targets.get(map) };
}

/**
 * Sets one or more edges of the map's padding, keeping the others at their target.
 * @param {PaddableMap} map - A Mapbox map.
 * @param {Partial<MapPadding>} edges - The edges to set, in pixels.
 * @param {object} [options] - How to get there.
 * @param {boolean} [options.animate=true] - Ease rather than jump. A camera move already in flight is never
 *   interrupted: the padding (whatever the target is by then) is eased once that move ends, and `camera` is
 *   dropped, since the move is going somewhere.
 * @param {number} [options.duration=300] - The ease's length in ms.
 * @param {object} [options.camera] - Other `easeTo` options to ride along, such as a `center` to bring into view.
 * @returns {MapPadding} The padding now targeted.
 */
export function setPaddingEdges(map, edges, { animate = true, duration = 300, camera = {} } = {}) {
  const padding = { ...paddingTarget(map), ...edges };
  targets.set(map, padding);
  const inFlight = typeof map.isMoving === 'function' && map.isMoving() && typeof map.once === 'function';
  if (inFlight) {
    if (deferred.has(map)) return padding;
    deferred.add(map);
    map.once('moveend', () => {
      deferred.delete(map);
      const target = targets.get(map);
      // A fly that carried the target itself has landed on it already.
      const landed = map.getPadding();
      if (['top', 'right', 'bottom', 'left'].every((edge) => landed[edge] === target[edge])) return;
      map.easeTo({ padding: target, duration });
    });
    return padding;
  }
  if (animate) map.easeTo({ padding, duration, ...camera });
  else map.setPadding(padding);
  return padding;
}
