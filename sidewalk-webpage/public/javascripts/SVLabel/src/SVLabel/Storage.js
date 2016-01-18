var svl = svl || {};

/**
 * LocalStorage class constructor
 * @param JSON
 * @param params
 */
function Storage(JSON, params) {
    var self = {'className': 'Storage'};

    if (params && 'storage' in params && params.storage == 'session') {
        self.storage = window.sessionStorage;
    } else {
        self.storage = window.localStorage;
    }

    function _init () {
        // Create an array to store staged submission data (if there hasn't been one)
        if (!get("staged")) {
            set("staged", []);
        }

        // Create an object to store current status.
        if (!get("tracker")) {
            set("tracker", []);
        }

        if (!get("labels")) {
            set("labels", []);
        }
    }

    /**
     * Returns the item specified by the key
     * @param key
     */
    function get(key) {
        return JSON.parse(self.storage.getItem(key));
    }

    /**
     * Refresh
     */
    function refresh () {
        _init();
    }

    /**
     * Stores a key value pair
     * @param key
     * @param value
     */
    function set(key, value) {
        self.storage.setItem(key, JSON.stringify(value));
    }

    self.get = get;
    self.refresh = refresh;
    self.set = set;
    _init();
    return self;
}