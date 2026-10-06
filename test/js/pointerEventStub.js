/**
 * Test helper: builds Pointer Events the way a finger, pen or mouse delivers them.
 *
 * jsdom has had a PointerEvent since 22.1; on an older one this falls back to a MouseEvent carrying the pointer fields,
 * which is all the code under test reads.
 *
 * @param {string} type - e.g. 'pointerdown'.
 * @param {object} [opts]
 * @param {number} [opts.id=1] - pointerId.
 * @param {string} [opts.pointerType='touch'] - 'touch', 'pen' or 'mouse'.
 * @param {number} [opts.x=0] - clientX.
 * @param {number} [opts.y=0] - clientY.
 * @param {boolean} [opts.isPrimary] - Defaults to true for pointer 1, the first finger of a gesture.
 * @returns {PointerEvent}
 */
function pointerEvent(type, { id = 1, pointerType = 'touch', x = 0, y = 0, isPrimary = id === 1 } = {}) {
    const init = {
        bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: id, pointerType, isPrimary, button: 0,
    };
    if (typeof window.PointerEvent === 'function') return new window.PointerEvent(type, init);
    const e = new MouseEvent(type, init);
    Object.defineProperties(e, {
        pointerId: { value: id }, pointerType: { value: pointerType }, isPrimary: { value: isPrimary },
    });
    return /** @type {PointerEvent} */ (e);
}

module.exports = { pointerEvent };
