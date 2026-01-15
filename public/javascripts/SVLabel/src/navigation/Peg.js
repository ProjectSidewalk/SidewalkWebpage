/**
 * Creates a rotating peg marker using AdvancedMarkerElement and local SVG files. Mimic's Google Map's peg man.
 */
class Peg {
    /** Number of directional sprites available. */
    static DIRECTIONS = 16;

    /** Degrees per sprite direction. */
    static DEGREES_PER_DIRECTION = 360 / 16; // 22.5

    static SPRITE_PATH = '/assets/images/icons/google-maps-peg';

    /**
     * @param {google.maps.Map} map - The Google Map instance.
     * @param {{lat: number, lng: number}} initialLocation - Initial lat/lng location.
     * @param {typeof google.maps.marker.AdvancedMarkerElement} AdvancedMarkerElement - The marker class.
     * @param {typeof google.maps.LatLng} LatLng - Google's LatLng class.
     */
    constructor(map, initialLocation, AdvancedMarkerElement, LatLng) {
        this.LatLng = LatLng;
        this.heading = 0;

        // Create the image element for the peg.
        this.imgElement = document.createElement('img');
        this.imgElement.style.width = '49px';
        this.imgElement.style.height = '52px';
        this._updateSprite();

        this.marker = new AdvancedMarkerElement({
            map,
            position: new this.LatLng(initialLocation.lat, initialLocation.lng),
            content: this.imgElement,
            zIndex: 1000,
            anchorTop: '-50%',
        });
    }

    /**
     * Updates the sprite image based on the current heading.
     * @private
     */
    _updateSprite() {
        const index = this._headingToIndex(this.heading);
        this.imgElement.src = `${Peg.SPRITE_PATH}/gm-peg-${index}.svg`;
    }

    /**
     * Converts a compass heading to a sprite index (0-15).
     * @param {number} heading - Compass heading in degrees (0-360).
     * @returns {number} The sprite index.
     * @private
     */
    _headingToIndex(heading) {
        // Normalize heading to 0-360 range.
        const normalized = ((heading % 360) + 360) % 360;
        return Math.round(normalized / Peg.DEGREES_PER_DIRECTION) % Peg.DIRECTIONS;
    }

    /**
     * Updates the peg's rotation to face the specified heading.
     * @param {number} heading - Compass heading in degrees (0-360).
     */
    setHeading(heading) {
        const oldIndex = this._headingToIndex(this.heading);
        const newIndex = this._headingToIndex(heading);

        this.heading = heading;

        // Only update the image if the sprite index changed.
        if (oldIndex !== newIndex) {
            this._updateSprite();
        }
    }

    /**
     * Moves the peg to a new location.
     * @param {{lat: number, lng: number}} location - New location.
     */
    setLocation(location) {
        this.marker.position = new this.LatLng(location.lat, location.lng);
        this.marker.position = this.marker.map.getCenter();
    }

    /**
     * Removes the peg from the map.
     */
    remove() {
        this.marker.map = null;
    }

    /**
     * Factory function that creates a rotating peg after loading required libraries.
     * @param {google.maps.Map} map - The Google Map instance.
     * @param {{lat: number, lng: number}} initialLocation - Initial lat/lng location.
     * @returns {Promise<Peg>} The peg instance.
     */
    static async create(map, initialLocation) {
        const { AdvancedMarkerElement } = await google.maps.importLibrary("marker");
        const { LatLng } = await google.maps.importLibrary('core');
        return new Peg(map, initialLocation, AdvancedMarkerElement, LatLng);
    }
}
