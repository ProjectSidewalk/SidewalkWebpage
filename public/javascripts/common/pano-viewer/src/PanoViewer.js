/**
 * Abstract base class defining the common panorama viewer interface.
 */
class PanoViewer {
    /**
     * The type of panorama viewer.
     * @type {string}
     */
    viewerType;

    /**
     * The class name for the canvas that shows the image. Used for taking screenshots.
     * @type {string}
     */
    canvasClass;

    /**
     * Private constructor to prevent direct instantiation.
     */
    constructor() {
        if (new.target === PanoViewer) throw new Error('Cannot instantiate abstract class directly');
        else if (new.target === GsvViewer) {
            this.viewerType = 'gsv';
            this.canvasClass = 'widget-scene-canvas';
        }
        else if (new.target === MapillaryViewer) {
            this.viewerType = 'mapillary';
            this.canvasClass = 'mapillary-canvas';
        }
        else if (new.target === Infra3dViewer) {
            this.viewerType = 'infra3d';
            this.canvasClass = 'infra3dsdk-canvas';
        }
        this.initialized = false;
    }

    /**
     * Initializes the panorama viewer with the given canvas element and options.
     * TODO note that either a startPanoId or startLatLng is required.
     * @param canvasElem
     * @param panoOptions
     * @returns {Promise<void>}
     */
    async initialize(canvasElem, panoOptions = {}) {
        throw new Error('Subclasses must implement initialize()');
    }

    /**
     * Factory method to create and initialize instances. Ex: `const viewer = await GsvViewer.create(canvasElem);`.
     * @static
     * @returns {Promise<PanoViewer>}
     */
    static async create(canvasElem, panoOptions = {}) {
        const newViewer = new this();
        await newViewer.initialize(canvasElem, panoOptions);
        newViewer.initialized = true;
        return newViewer;
    }

    /**
     * Gets the current viewer type.
     * @returns {string} The current viewer type.
     */
    getViewerType() {
        return this.viewerType;
    }

    /**
     * Gets the CSS class for the canvas that shows the image. Used for taking screenshots.
     * @returns {string} The CSS class for the canvas that shows the image.
     */
    getCanvasClass() {
        return this.canvasClass;
    }

    /**
     * Gets the unique identifier of the current panorama.
     * @returns {string} The current panorama ID.
     */
    getPanoId() {
        throw new Error('getPanoId() must be implemented by subclass');
    }

    /**
     * Gets the lat/lng location of the current panorama.
     * @returns {Object} The current location with lat and lng properties.
     */
    getPosition() {
        throw new Error('getPov() must be implemented by subclass');
    }

    /**
     * Sets the panorama to the location closest to the specified lat/lng.
     * @param latLng An object with properties lat and lng representing the desired location.
     * @param {Set<string>} [excludedPanos=new Set()] Set of pano IDs that are not valid images to move to.
     * @returns {Promise<Object>} The panorama data object. Rejects if closest image is in excludedPanos or none found.
     */
    async setLocation(latLng, excludedPanos = new Set()) {
        throw new Error('setLocation(latLng, excludedPanos) must be implemented by subclass');
    }

    /**
     * Moves the current panorama to the specified panorama ID.
     * @param panoId The panorama ID to set.
     * @returns {Promise<Object>} The panorama data object.
     */
    async setPano(panoId) {
        throw new Error('setPano(panoId) must be implemented by subclass');
    }

    /**
     * Gets the panos that are linked to the current one, to be used with navigation arrows.
     * @returns {Promise<Array<{panoId: string, heading: number}>>}
     */
    getLinkedPanos() {
        throw new Error('getLinkedPanos() must be implemented by subclass');
    }

    /**
     * Gets the current point of view (POV) of the panorama.
     * @returns {Object} The current POV with heading, pitch, and zoom properties.
     */
    getPov() {
        throw new Error('getPov() must be implemented by subclass');
    }

    /**
     * Sets the camera view to the specified heading, pitch, and zoom.
     *
     * @param {object} pov - Object containing the desired heading, pitch, and zoom
     * @param {number} pov.heading - Desired heading in degrees (0-360, where 0 is true north)
     * @param {number} pov.pitch - Desired pitch in degrees (-90 to 90, where 0 is horizontal)
     * @param {number} pov.zoom - Desired zoom (1, 2, or 3)
     */
    setPov(pov) {
        throw new Error('setPov() must be implemented by subclass');
    }

    /**
     * Hides the navigation arrows in the panorama viewer.
     */
    hideNavigationArrows() {
        throw new Error('hideNavigationArrows() must be implemented by subclass');
    }

    /**
     * Shows the navigation arrows in the panorama viewer.
     */
    showNavigationArrows() {
        throw new Error('showNavigationArrows() must be implemented by subclass');
    }

    /**
     * Adds an event listener for the specified event type.
     * @param event One of ['pano_changed', 'pov_changed']
     * @param handler The function to call when the event occurs.
     */
    addListener(event, handler) {
        throw new Error('addListener() must be implemented by subclass');
    }

    // TODO should add a removeListener function.
}
