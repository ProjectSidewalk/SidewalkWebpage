/**
 * The user's "you are here" marker on the minimap: a GSV-style blue dot with a triangle pointing in the direction the
 * user is currently facing. The triangle rotates to the pano heading, echoing the classic maps "location + heading"
 * puck (#4639).
 */
class Peg {
  /** @type {HTMLElement} The marker's DOM content; its --peg-heading custom property drives the triangle's rotation. */
  #content;

  /** @type {MinimapMarker} */
  #marker;

  /**
   * @param {Minimap} minimap - The minimap to put the peg on.
   * @param {{lat: number, lng: number}} initialLocation - Initial lat/lng location.
   */
  constructor(minimap, initialLocation) {
    // .minimap-peg rotates about its own center, which the marker keeps on the location, so the dot stays planted
    // while the triangle swings to the heading. The dot is drawn after the triangle so its white ring sits on top
    // where they meet.
    this.#content = document.createElement('div');
    this.#content.className = 'minimap-peg';
    this.#content.innerHTML = `
      <svg viewBox="0 0 28 28" aria-hidden="true">
        <circle class="minimap-peg-shadow" cx="14" cy="14.5" r="8"></circle>
        <path class="minimap-peg-heading" d="M14 0 18.5 8.5 9.5 8.5 Z"></path>
        <circle class="minimap-peg-dot" cx="14" cy="14" r="6.5"></circle>
      </svg>`;

    // No title and no click handler: the peg is decoration, so clicks pass through it to the crumbs beneath.
    this.#marker = minimap.addMarker(initialLocation, this.#content, { zIndex: 1000 });
  }

  /**
   * Moves the peg to a new location.
   * @param {{lat: number, lng: number}} location - New location.
   */
  setLocation(location) {
    this.#marker.setLatLng(location);
  }

  /**
   * Points the heading triangle in the given direction.
   * @param {number} heading - Compass heading in degrees (0 = north, clockwise). May be unwrapped (continuous) so the
   *                           CSS rotation transitions the short way across the 0/360 boundary.
   */
  setHeading(heading) {
    this.#content.style.setProperty('--peg-heading', `${heading}deg`);
  }

  /**
   * Removes the peg from the map.
   */
  remove() {
    this.#marker.remove();
  }
}
