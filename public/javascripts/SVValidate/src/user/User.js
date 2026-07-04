/**
 * Holds the current user's properties.
 */
class User {
  #properties;

  /**
     * @param {object} param - Initial user properties.
     * @param {string} param.username
     * @param {string} param.role
     */
  constructor(param) {
    this.#properties = {
      username: param.username,
      role: param.role,
    };
  }

  /**
     * Get a property.
     * @param {string} key
     * @returns {*}
     */
  getProperty(key) {
    return this.#properties[key];
  }

  /**
     * Set a property.
     * @param {string} key
     * @param {*} value
     */
  setProperty(key, value) {
    this.#properties[key] = value;
  }
}
