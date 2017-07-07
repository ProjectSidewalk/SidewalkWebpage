/**
 * Storage module. This is a wrapper around web browser's Local Storage. It allows you to store data on the user's
 * broser using a set method, and you can retrieve the data using the get method.
 *
 * Refrernces:
 * https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API
 *
 * @param JSON
 * @param params
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function TemporaryStorage(JSON, params) {
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

        if (!get("completedOnboarding")) {
            set("completedOnboarding", null);
        }

        if (!get("completedFirstMission")){
            set("completedFirstMission", null);
        }

        if (!get("muted")) {
            set("muted", false);
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
    function clear () {
        _init();
        set("staged", []);
        set("tracker", []);
        set("labels", []);
        set("completedOnboarding", null);
        set("completedFirstMission", null);
        set("muted", false);
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
    self.clear = clear;
    self.set = set;
    _init();
    return self;
}