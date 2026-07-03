/**
 * Minimal event emitter mixin providing .on(), .trigger(). Mixed into model prototypes via Object.assign for pub/sub.
 */
const EventMixin = {
    /**
     * Subscribe a callback to a named event.
     * @param event {string} Event name.
     * @param callback {Function} Invoked with the args passed to trigger().
     */
    on(event, callback) {
        if (!this._listeners) this._listeners = {};
        (this._listeners[event] ||= []).push(callback);
        return this;
    },

    /**
     * Fire a named event, invoking all subscribed callbacks with the given args.
     * @param event {string} Event name.
     * @param args {...*} Forwarded to each callback.
     */
    trigger(event, ...args) {
        const callbacks = this._listeners && this._listeners[event];
        if (callbacks) callbacks.forEach((cb) => cb.apply(this, args));
        return this;
    },
};
