/**
 * The user's "you are here" marker on the minimap: a GSV-style blue dot with a triangle pointing in the direction the
 * user is currently facing. The triangle rotates to the pano heading, echoing the classic maps "location + heading"
 * puck (#4639).
 */
class Peg {
  /** @type {HTMLElement} The marker's DOM content; its --peg-heading custom property drives the triangle's rotation. */
  #content;

  /**
   * @param {google.maps.Map} map - The Google Map instance.
   * @param {{lat: number, lng: number}} initialLocation - Initial lat/lng location.
   * @param {typeof google.maps.marker.AdvancedMarkerElement} AdvancedMarkerElement - The marker class.
   * @param {typeof google.maps.LatLng} LatLng - Google's LatLng class.
   */
  constructor(map, initialLocation, AdvancedMarkerElement, LatLng) {
    this.LatLng = LatLng;

    // AdvancedMarkerElement anchors content at bottom-center; .minimap-peg centers itself on the location and rotates
    // about that center, so the dot stays planted while the triangle swings to the heading. The dot is drawn after
    // the triangle so its white ring sits on top where they meet.
    this.#content = document.createElement('div');
    this.#content.className = 'minimap-peg';
    this.#content.innerHTML = `
      <svg viewBox="0 0 28 28" aria-hidden="true">
        <path class="minimap-peg-heading" d="M14 0 18.5 8.5 9.5 8.5 Z"></path>
        <circle class="minimap-peg-dot" cx="14" cy="14" r="6.5"></circle>
      </svg>`;

    this.marker = new AdvancedMarkerElement({
      map,
      position: new this.LatLng(initialLocation.lat, initialLocation.lng),
      content: this.#content,
      zIndex: 1000,
    });
  }

  /**
   * Moves the peg to a new location.
   * @param {{lat: number, lng: number}} location - New location.
   */
  setLocation(location) {
    this.marker.position = new this.LatLng(location.lat, location.lng);
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
    this.marker.map = null;
  }

  /**
   * Factory function that creates the peg after loading required libraries.
   * @param {google.maps.Map} map - The Google Map instance.
   * @param {{lat: number, lng: number}} initialLocation - Initial lat/lng location.
   * @returns {Promise<Peg>} The peg instance.
   */
  static async create(map, initialLocation) {
    const { AdvancedMarkerElement } = await google.maps.importLibrary('marker');
    const { LatLng } = await google.maps.importLibrary('core');
    return new Peg(map, initialLocation, AdvancedMarkerElement, LatLng);
  }
}
