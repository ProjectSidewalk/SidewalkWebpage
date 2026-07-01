/**
 * Wrapper around the browser's Local Storage: store data with set(), retrieve it with get().
 *
 * References:
 * https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API
 *
 * @memberof svl
 */
class TemporaryStorage {
    #json;
    #storage;

    /**
     * @param {JSON} json - JSON object for (de)serializing stored values.
     */
    constructor(json) {
        this.#json = json;
        this.#storage = window.localStorage;

        // Seed the defaults the rest of the app assumes are always present.
        if (!this.get('completedFirstMission')) {
            this.set('completedFirstMission', null);
        }
        if (!this.get('muted')) {
            this.set('muted', false);
        }
    }

    /**
     * Returns the item specified by the key.
     * @param {string} key
     * @returns {*} The parsed value, or null if absent.
     */
    get(key) {
        return this.#json.parse(this.#storage.getItem(key));
    }

    /**
     * Stores a key/value pair.
     * @param {string} key
     * @param {*} value
     */
    set(key, value) {
        this.#storage.setItem(key, this.#json.stringify(value));
    }
}
