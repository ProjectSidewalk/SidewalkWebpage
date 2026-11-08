/**
 * One Tab stop for every point on a report map (#5937), WAI-ARIA's roving tabindex: a keyboard reader passes a map in
 * one Tab, and the arrows move by where points are on screen, as a sighted reader scans, not by a hidden list order.
 *
 * Each point is a button, so Enter and Space already do what a click does; this adds only the movement.
 *
 * @example
 *   const points = new ReportMapPoints({ onFocus: (el) => panIntoView(el), onFirstMove: () => log() });
 *   points.add(button);      // the first visible point becomes the one Tab stop
 *   points.refresh();        // after hiding some, so the Tab stop is never a hidden one
 */

const KEY_DIRECTIONS = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
};
// A point off to the side costs this much more per pixel than one straight ahead, so the arrow goes where it points
// rather than to whatever is nearest.
const SIDEWAYS_COST = 2;

/**
 * The point an arrow key moves to: the cheapest of those ahead of `from` in the arrow's direction, where a pixel
 * sideways costs `SIDEWAYS_COST` pixels ahead.
 * @param {{x: number, y: number}} from - The focused point's center, in screen pixels.
 * @param {{x: number, y: number}[]} points - Candidate centers.
 * @param {[number, number]} direction - A unit screen axis: `[1, 0]` is right, `[0, 1]` is down.
 * @returns {number} The index into `points`, or -1 if none is ahead.
 * @example nextInDirection({x: 0, y: 0}, [{x: 10, y: 1}, {x: -5, y: 0}], [1, 0]) // 0
 */
export function nextInDirection(from, points, [dx, dy]) {
  let best = -1;
  let bestCost = Infinity;
  points.forEach((p, i) => {
    const ahead = (p.x - from.x) * dx + (p.y - from.y) * dy;
    if (ahead <= 0) return;
    const sideways = Math.abs((p.x - from.x) * dy - (p.y - from.y) * dx);
    const cost = ahead + SIDEWAYS_COST * sideways;
    if (cost < bestCost) {
      best = i;
      bestCost = cost;
    }
  });
  return best;
}

function centerOf(element) {
  const box = element.getBoundingClientRect();
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

export class ReportMapPoints {
  /** @type {HTMLElement[]} In the order added, which Home and End follow. */ #points = [];
  /** @type {?HTMLElement} The one point Tab reaches. */ #current = null;
  /** @type {(element: HTMLElement) => void} */ #onFocus;
  /** @type {() => void} */ #onFirstMove;
  #moved = false;

  /**
   * @param {object} options
   * @param {(element: HTMLElement) => void} [options.onFocus] - When a point takes focus by any means, so the map can
   *   bring it into view.
   * @param {() => void} [options.onFirstMove] - The first time a key moves focus on this map, for logging.
   */
  constructor({ onFocus = () => {}, onFirstMove = () => {} } = {}) {
    this.#onFocus = onFocus;
    this.#onFirstMove = onFirstMove;
  }

  /**
   * Joins a point to the map's one Tab stop.
   * @param {HTMLElement} element - The point's button.
   */
  add(element) {
    this.#points.push(element);
    element.tabIndex = -1;
    // Focus by any means moves the Tab stop, so Tab back into the map returns to where the reader was.
    element.addEventListener('focus', () => {
      this.#setCurrent(element);
      this.#onFocus(element);
    });
    element.addEventListener('keydown', (e) => this.#onKey(e, element));
    this.refresh();
  }

  /** Keeps the Tab stop on a visible point, after the host shows or hides some. */
  refresh() {
    if (this.#current && this.#visible(this.#current)) return;
    this.#setCurrent(this.#points.find((p) => this.#visible(p)) ?? null);
  }

  /** @returns {?HTMLElement} The point Tab reaches now. */
  get current() {
    return this.#current;
  }

  /**
   * @param {?HTMLElement} element
   */
  #setCurrent(element) {
    if (this.#current === element) return;
    if (this.#current) this.#current.tabIndex = -1;
    this.#current = element;
    if (element) element.tabIndex = 0;
  }

  /**
   * @param {HTMLElement} element
   * @returns {boolean} Whether a reader can reach it: not a place the "Places" switch hid, nor a removed marker.
   */
  #visible(element) {
    return !element.hidden && element.isConnected;
  }

  /**
   * @param {KeyboardEvent} e
   * @param {HTMLElement} from
   */
  #onKey(e, from) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const visible = this.#points.filter((p) => p !== from && this.#visible(p));
    let target;
    if (e.key === 'Home' || e.key === 'End') {
      const all = this.#points.filter((p) => this.#visible(p));
      target = e.key === 'Home' ? all[0] : all[all.length - 1];
    } else if (KEY_DIRECTIONS[e.key]) {
      const index = nextInDirection(centerOf(from), visible.map(centerOf), KEY_DIRECTIONS[e.key]);
      target = index === -1 ? null : visible[index];
    } else {
      return;
    }
    // Handled even at an edge with nowhere to go, so the arrow doesn't fall through to MapLibre and pan the map
    // from under the reader's focus.
    e.preventDefault();
    e.stopPropagation();
    if (!target || target === from) return;
    target.focus({ preventScroll: true });
    if (!this.#moved) {
      this.#moved = true;
      this.#onFirstMove();
    }
  }
}
