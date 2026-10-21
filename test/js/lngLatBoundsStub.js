/**
 * A mapboxgl.LngLatBounds stand-in for the suites that fake mapbox-gl, which cannot run under jsdom: only what
 * common/geoBounds.js and the pages' fitBounds calls use.
 */
export class FakeLngLatBounds {
  #box = null;

  /**
   * @param {[number, number]|FakeLngLatBounds} input - A [lng, lat] point or another bounds.
   * @returns {FakeLngLatBounds} This, as the real one does.
   */
  extend(input) {
    const points = input instanceof FakeLngLatBounds ? input.toArray() ?? [] : [input];
    for (const [lng, lat] of points) {
      this.#box = this.#box
        ? [
            [Math.min(this.#box[0][0], lng), Math.min(this.#box[0][1], lat)],
            [Math.max(this.#box[1][0], lng), Math.max(this.#box[1][1], lat)],
          ]
        : [[lng, lat], [lng, lat]];
    }
    return this;
  }

  isEmpty() {
    return this.#box === null;
  }

  /** @returns {?[[number, number], [number, number]]} [[west, south], [east, north]], or null while empty. */
  toArray() {
    return this.#box;
  }
}
