/**
 * A data structure used to store metadata about a panorama.
 * @param params {object}
 * @param {string} params.panoId The unique ID for this panorama
 * @param {string} params.source The data source for the image, one of "gsv", "mapillary", or "infra3d"
 * @param {number} params.lat Latitude of the camera
 * @param {number} params.lng Longitude of the camera
 * @param {number} params.cameraHeading Heading of the camera in degrees, with respect to true north
 * @param {number} params.cameraPitch Pitch of the camera in degrees, with respect to the horizon
 * @param {number} params.width Width of the image in pixels
 * @param {number} params.height Height of the image in pixels
 * @param {number} [params.tileWidth] Width of the tiles that make up the image in pixels
 * @param {number} [params.tileHeight] Height of hte tiles that make up the image in pixels
 * @param {moment} params.captureDate Time when the picture was taken, only using up to month/year granularity
 * @param {string} [params.copyright] Optional associated copyright info for the image
 * @param {array<{panoId: string, heading: number}>} params.linkedPanos List of nearby panos linked to with nav arrows
 * @param {array<{panoId: string, captureDate: Date}>} params.history List of panos at this pano's location over time
 * @param {Boolean} [params.submitted=false] Whether we've sent this data to the server yet; false unless from tutorial
 * @returns {PanoData}
 * @constructor
 */
function PanoData(params) {
    let self = this;
    let properties = { };

    function _init() {
        // Validate required parameters.
        const requiredParams = ['panoId', 'source', 'lat', 'lng', 'cameraHeading', 'cameraPitch', 'width', 'height', 'captureDate', 'linkedPanos', 'history'];
        requiredParams.forEach(param => {
            if (params[param] === undefined || params[param] === null) {
                throw new Error(`Missing required parameter: ${param}`);
            }
        });

        // Validate parameter types and ranges
        const validSources = ['gsv', 'mapillary', 'infra3d'];
        if (!validSources.includes(params.source)) {
            throw new Error(`Invalid source. Must be one of: ${validSources.join(', ')}`);
        }

        // Validate numeric parameters.
        const numericParams = ['lat', 'lng', 'cameraHeading', 'cameraPitch', 'width', 'height'];
        numericParams.forEach(param => {
            if (typeof params[param] !== 'number' || isNaN(params[param])) {
                throw new Error(`${param} must be a valid number`);
            }
        });

        // Validate date.
        if (!(params.captureDate instanceof moment)) {
            throw new Error('captureDate must be a Date object');
        }

        // If all checks passed, initialize the properties object.
        properties = {
            panoId: params.panoId,
            source: params.source,
            lat: params.lat,
            lng: params.lng,
            cameraHeading: params.cameraHeading,
            cameraPitch: params.cameraPitch,
            width: params.width,
            height: params.height,
            // If tileWidth/tileHeight not provided, assume that there is no tiling and just use full width/height.
            tileWidth: params.tileWidth || params.width,
            tileHeight: params.tileHeight || params.height,
            copyright: params.copyright || null,
            captureDate: params.captureDate,
            linkedPanos: params.linkedPanos || [],
            history: params.history || [],
            submitted: params.submitted || false
        }
    }

    function getProperties() {
        return properties;
    }

    function getProperty(key) {
        return key in properties ? properties[key] : null;
    }

    function setProperty(key, value) {
        properties[key] = value;
    }

    _init()

    self.getProperties = getProperties;
    self.getProperty = getProperty;
    self.setProperty = setProperty;
    return self;
}
