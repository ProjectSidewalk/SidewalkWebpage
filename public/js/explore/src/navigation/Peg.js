/**
 * The user's "you are here" marker on the minimap: a GSV-style blue dot. Heading is shown by ObservedArea's FOV cone
 * rather than by the marker itself, so the dot needs no rotation sprites (#4639).
 */
class Peg {
  /**
   * @param {google.maps.Map} map - The Google Map instance.
   * @param {{lat: number, lng: number}} initialLocation - Initial lat/lng location.
   * @param {typeof google.maps.marker.AdvancedMarkerElement} AdvancedMarkerElement - The marker class.
   * @param {typeof google.maps.LatLng} LatLng - Google's LatLng class.
   */
  constructor(map, initialLocation, AdvancedMarkerElement, LatLng) {
    this.LatLng = LatLng;

    // AdvancedMarkerElement anchors its content at bottom-center; the dot's CSS shifts it down half its height so
    // it's centered on the location like GSV's blue dot.
    const dot = document.createElement('div');
    dot.className = 'minimap-peg-dot';

    this.marker = new AdvancedMarkerElement({
      map,
      position: new this.LatLng(initialLocation.lat, initialLocation.lng),
      content: dot,
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
