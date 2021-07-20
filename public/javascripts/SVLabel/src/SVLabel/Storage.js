/**
 * Storage module. This is a wrapper around web browser's Local Storage. It allows you to store data on the user's
 * browser using a set method, and you can retrieve the data using the get method.
 *
 * References:
 * https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API
 *
 * @param JSON
 * @returns {{className: string}}
 * @constructor
 * @memberof svl
 */
function TemporaryStorage(JSON) {
    var self = {'className': 'Storage'};
    self.storage = window.localStorage;

    function _init() {
        // Create an array to store staged submission data (if there hasn't been one)
        if (!get("staged")) {
            set("staged", []);
        }

        if (!get("completedFirstMission")){
            set("completedFirstMission", null);
        }

        if (!get("muted")) {
            set("muted", false);
        }
    }

    /**
     * Returns the item specified by the key.
     * @param key
     */
    function get(key) {
        return JSON.parse(self.storage.getItem(key));
    }

    /**
     * Stores a key value pair.
     * @param key
     * @param value
     */
    function set(key, value) {
        self.storage.setItem(key, JSON.stringify(value));
    }

    self.get = get;
    self.set = set;

    _init();
    return self;
}