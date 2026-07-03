/**
 * Creates a rotating peg marker using AdvancedMarkerElement and local SVG files. Mimic's Google Map's peg man.
 */
class Peg {
    /** Number of directional sprites available. */
    static DIRECTIONS = 16;

    /** Degrees per sprite direction. */
    static DEGREES_PER_DIRECTION = 360 / 16; // 22.5

    static SPRITE_PATH = '/assets/images/icons/google-maps-peg';

    /** Minimap zoom at which the peg renders at its native size. Should match Minimap's default zoom. */
    static REFERENCE_ZOOM = 18;

    /** How strongly the peg scales with zoom: 0 = fixed size, 1 = scales with the map. Kept low for a subtle effect. */
    static ZOOM_SCALE_DAMPING = 0.2;

    /**
     * @param {google.maps.Map} map - The Google Map instance.
     * @param {{lat: number, lng: number}} initialLocation - Initial lat/lng location.
     * @param {typeof google.maps.marker.AdvancedMarkerElement} AdvancedMarkerElement - The marker class.
     * @param {typeof google.maps.LatLng} LatLng - Google's LatLng class.
     */
    constructor(map, initialLocation, AdvancedMarkerElement, LatLng) {
        this.map = map;
        this.LatLng = LatLng;
        this.heading = 0;

        // Create the image element for the peg. Scale from the base so the peg stays planted on its location as it zooms.
        this.imgElement = document.createElement('img');
        this.imgElement.style.width = '49px';
        this.imgElement.style.height = '52px';
        this.imgElement.style.transformOrigin = 'center bottom';
        this.imgElement.style.transition = 'transform 1s';
        this._updateSprite();

        this.marker = new AdvancedMarkerElement({
            map,
            position: new this.LatLng(initialLocation.lat, initialLocation.lng),
            content: this.imgElement,
            zIndex: 1000,
            anchorTop: '-60%',
        });

        // Gently scale the peg with the minimap zoom (dampened so it doesn't grow as fast as the map itself).
        this._updateScale();
        this.map.addListener('zoom_changed', () => this._updateScale());
    }

    /**
     * Scales the peg image to the minimap's current zoom, dampened by ZOOM_SCALE_DAMPING relative to REFERENCE_ZOOM.
     * @private
     */
    _updateScale() {
        const scale = Math.pow(2, (this.map.getZoom() - Peg.REFERENCE_ZOOM) * Peg.ZOOM_SCALE_DAMPING);
        this.imgElement.style.transform = `scale(${scale})`;
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
        const { AdvancedMarkerElement } = await google.maps.importLibrary('marker');
        const { LatLng } = await google.maps.importLibrary('core');
        return new Peg(map, initialLocation, AdvancedMarkerElement, LatLng);
    }
}
