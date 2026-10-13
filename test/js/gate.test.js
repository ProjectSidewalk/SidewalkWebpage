/**
 * Tests the Gate (frontend/js/common/Gate.js): the named holds the tools' keyboard shortcuts, walking, panning,
 * labeling and pop-up stop are built on (#5648). What matters is that a gate held by two things opens only once both
 * let go, and that its listeners hear it shut and open, not each hold and release in between.
 */

const { loadModules } = require('./loadGlobalScript');

let Gate;

beforeAll(() => {
    ({ Gate } = loadModules('frontend/js/common/Gate.js'));
});

describe('Gate', () => {
    it('opens only once every holder has let go', () => {
        const gate = new Gate();
        gate.hold('modal');
        gate.hold('tutorial');
        gate.release('modal');
        expect(gate.isHeld()).toBe(true);
        gate.release('tutorial');
        expect(gate.isHeld()).toBe(false);
    });

    it('counts a hold taken twice as one, and ignores a release by something not holding it', () => {
        const gate = new Gate();
        gate.hold('modal');
        gate.hold('modal');
        gate.release('popup');
        expect(gate.isHeld()).toBe(true);
        gate.release('modal');
        expect(gate.isHeld()).toBe(false);
    });

    it('tells its listeners only when it shuts and when it opens', () => {
        const gate = new Gate();
        const changes = [];
        gate.onChanged((held) => changes.push(held));
        gate.hold('modal');
        gate.hold('popup');
        gate.hold('popup');
        gate.release('modal');
        gate.release('popup');
        expect(changes).toEqual([true, false]);
    });
});
