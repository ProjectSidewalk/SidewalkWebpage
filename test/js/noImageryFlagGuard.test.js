/**
 * Tests for NoImageryFlagGuard, the cap on how many streets one browsing session may auto-skip for missing imagery
 * (issue #4918).
 *
 * Skipping a street records it as imagery-less, which marks it audited and drops it out of the assignment rotation.
 * Both skip paths then immediately try the next street — one by reloading the page, one by recursing — so a failure
 * that repeats spends streets for as long as it lasts. Production saw 44 streets consumed in 33 seconds.
 *
 * The counter lives in sessionStorage specifically because one of those paths is a page reload, which is exactly what
 * made the loop invisible to in-memory state. These tests therefore drive the real sessionStorage jsdom provides, and
 * the storage-unavailable case (some privacy modes throw on access) is covered by replacing it with a thrower.
 *
 * NoImageryFlagGuard is a top-level `class` declaration for the Grunt-concatenation world, so we eval the source in the
 * jsdom global scope.
 */

const fs = require('fs');
const path = require('path');

const GUARD_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/explore/src/panorama/NoImageryFlagGuard.js'), 'utf8'
);

/** Loads a fresh NoImageryFlagGuard class into the jsdom global scope and returns it. */
function loadGuard() {
    window.eval(`${GUARD_SRC}; window.NoImageryFlagGuard = NoImageryFlagGuard;`);
    return window.NoImageryFlagGuard;
}

describe('NoImageryFlagGuard', () => {
    let NoImageryFlagGuard;

    beforeEach(() => {
        window.sessionStorage.clear();
        NoImageryFlagGuard = loadGuard();
    });

    test('starts with a full allowance', () => {
        expect(NoImageryFlagGuard.count()).toBe(0);
        expect(NoImageryFlagGuard.canFlag()).toBe(true);
    });

    test('allows exactly MAX_CONSECUTIVE_FLAGS flags and then stops', () => {
        for (let i = 0; i < NoImageryFlagGuard.MAX_CONSECUTIVE_FLAGS; i++) {
            expect(NoImageryFlagGuard.canFlag()).toBe(true);
            NoImageryFlagGuard.recordStreetGivenUp();
        }
        expect(NoImageryFlagGuard.canFlag()).toBe(false);
        expect(NoImageryFlagGuard.count()).toBe(NoImageryFlagGuard.MAX_CONSECUTIVE_FLAGS);
    });

    describe('the two limits it draws', () => {
        test('flagging stops at MAX_CONSECUTIVE_FLAGS but advancing continues', () => {
            // The distinction the guard exists to draw: past the flag limit we stop writing streets down, but the
            // labeler still gets somewhere to go. Conflating the two strands people working a patchy area.
            for (let i = 0; i < NoImageryFlagGuard.MAX_CONSECUTIVE_FLAGS; i++) NoImageryFlagGuard.recordStreetGivenUp();
            expect(NoImageryFlagGuard.canFlag()).toBe(false);
            expect(NoImageryFlagGuard.canAdvance()).toBe(true);
        });

        test('advancing stops too, once the run is long enough to be cycling', () => {
            // A street left unflagged stays incomplete, so nextTask() can hand it straight back; without this ceiling
            // the run could bounce between the same few streets indefinitely, re-sweeping each against the provider.
            const limit = NoImageryFlagGuard.MAX_CONSECUTIVE_STREETS_GIVEN_UP;
            for (let i = 0; i < limit; i++) NoImageryFlagGuard.recordStreetGivenUp();
            expect(NoImageryFlagGuard.canAdvance()).toBe(false);
            expect(NoImageryFlagGuard.canFlag()).toBe(false);
        });

        test('the advance limit leaves room past the flag limit, or it would have no effect', () => {
            expect(NoImageryFlagGuard.MAX_CONSECUTIVE_STREETS_GIVEN_UP)
                .toBeGreaterThan(NoImageryFlagGuard.MAX_CONSECUTIVE_FLAGS);
        });

        test('one pano that loads restores both', () => {
            const limit = NoImageryFlagGuard.MAX_CONSECUTIVE_STREETS_GIVEN_UP;
            for (let i = 0; i < limit; i++) NoImageryFlagGuard.recordStreetGivenUp();
            NoImageryFlagGuard.reset();
            expect(NoImageryFlagGuard.canFlag()).toBe(true);
            expect(NoImageryFlagGuard.canAdvance()).toBe(true);
        });
    });

    test('stays closed however long the failure lasts', () => {
        // The loop this guards is unbounded by nature: each flag hands the client another street to fail on. Once the
        // limit is reached, further attempts must not creep back under it or claw the allowance back.
        for (let i = 0; i < 50; i++) NoImageryFlagGuard.recordStreetGivenUp();
        expect(NoImageryFlagGuard.canFlag()).toBe(false);
    });

    test('recordStreetGivenUp reports the depth of the run', () => {
        expect(NoImageryFlagGuard.recordStreetGivenUp()).toBe(1);
        expect(NoImageryFlagGuard.recordStreetGivenUp()).toBe(2);
    });

    test('a pano that loads restores the full allowance', () => {
        // "Consecutive" is the whole point: a labeler who meets one dead-end street, audits the next few normally, and
        // then meets another dead end must not accumulate toward the cap across a productive session.
        for (let i = 0; i < NoImageryFlagGuard.MAX_CONSECUTIVE_FLAGS; i++) NoImageryFlagGuard.recordStreetGivenUp();
        expect(NoImageryFlagGuard.canFlag()).toBe(false);

        NoImageryFlagGuard.reset();
        expect(NoImageryFlagGuard.count()).toBe(0);
        expect(NoImageryFlagGuard.canFlag()).toBe(true);
    });

    test('the count survives a page reload, which is what the page-load path does between streets', () => {
        NoImageryFlagGuard.recordStreetGivenUp();
        NoImageryFlagGuard.recordStreetGivenUp();

        // A reload re-evaluates the script: fresh class, fresh in-memory state, same session storage.
        const reloaded = loadGuard();
        expect(reloaded.count()).toBe(2);
    });

    test('ignores a corrupted stored value rather than trusting it', () => {
        window.sessionStorage.setItem('sidewalk.consecutiveNoImageryFlags', 'not-a-number');
        expect(NoImageryFlagGuard.count()).toBe(0);
        expect(NoImageryFlagGuard.canFlag()).toBe(true);
    });

    test('treats a negative stored value as no flags, so it cannot buy extra allowance', () => {
        window.sessionStorage.setItem('sidewalk.consecutiveNoImageryFlags', '-100');
        expect(NoImageryFlagGuard.count()).toBe(0);
        expect(NoImageryFlagGuard.canFlag()).toBe(true);
    });

    describe('when sessionStorage is unavailable', () => {
        let descriptor;

        beforeEach(() => {
            descriptor = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
            Object.defineProperty(window, 'sessionStorage', {
                configurable: true,
                get() { throw new Error('SecurityError: storage is disabled'); },
            });
        });

        afterEach(() => { Object.defineProperty(window, 'sessionStorage', descriptor); });

        test('degrades to permitting flags instead of breaking Explore', () => {
            // Some privacy modes throw on any storage access. A guard that cannot count is no worse than the behavior
            // before it existed; a guard that throws would take the whole page down on a path that is already failing.
            expect(() => NoImageryFlagGuard.count()).not.toThrow();
            expect(() => NoImageryFlagGuard.recordStreetGivenUp()).not.toThrow();
            expect(() => NoImageryFlagGuard.reset()).not.toThrow();
            expect(NoImageryFlagGuard.canFlag()).toBe(true);
        });
    });
});
