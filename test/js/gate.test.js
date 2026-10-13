/**
 * Tests the Gate (frontend/js/common/Gate.js): the named holds the tools' keyboard shortcuts, walking, panning,
 * labeling and pop-up stop are built on (#5648). What matters is that a gate held by two things opens only once both
 * let go, and that its listeners hear the first hold and the last release, not every one in between.
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
        gate.hold('move');
        gate.hold('move');
        gate.release('popup');
        expect(gate.isHeld()).toBe(true);
        gate.release('move');
        expect(gate.isHeld()).toBe(false);
    });

    it('tells its listeners of the first hold and the last release, naming the holder that tipped it', () => {
        const gate = new Gate();
        const changes = [];
        gate.onChanged((held, holder) => changes.push([held, holder]));
        gate.hold('move');
        gate.hold('popup');
        gate.release('move');
        gate.release('popup');
        expect(changes).toEqual([[true, 'move'], [false, 'popup']]);
    });

    it('can tell a hold that lifts on its own from any other', () => {
        const gate = new Gate();
        gate.hold('move');
        expect(gate.isHeldExcept('move')).toBe(false);
        gate.hold('mission-complete');
        expect(gate.isHeldExcept('move')).toBe(true);
        gate.release('move');
        expect(gate.isHeldExcept('move')).toBe(true);
    });
});
