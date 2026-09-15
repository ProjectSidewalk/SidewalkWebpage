/**
 * Minimal pub/sub base class for Explore's models.
 */
class EventEmitter {
  /** @type {Record<string, Function[]>} */
  #listeners = {};

  /**
   * Subscribe a callback to a named event.
   * @param {string} event - Event name.
   * @param {Function} callback - Invoked with the args passed to trigger().
   * @returns {this}
   */
  on(event, callback) {
    (this.#listeners[event] ||= []).push(callback);
    return this;
  }

  /**
   * Fire a named event, invoking all subscribed callbacks with the given args.
   * @param {string} event - Event name.
   * @param {...*} args - Forwarded to each callback.
   * @returns {this}
   */
  trigger(event, ...args) {
    this.#listeners[event]?.forEach((cb) => cb.apply(this, args));
    return this;
  }
}
