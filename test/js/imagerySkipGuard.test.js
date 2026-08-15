/**
 * Tests for ImagerySkipGuard, the cap on how many streets one browsing session may auto-skip for missing imagery
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
 * ImagerySkipGuard is a top-level `class` declaration for the Grunt-concatenation world, so we eval the source in the
 * jsdom global scope.
 */

const fs = require('fs');
const path = require('path');

const GUARD_SRC = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/explore/src/panorama/ImagerySkipGuard.js'), 'utf8'
);

/** Loads a fresh ImagerySkipGuard class into the jsdom global scope and returns it. */
function loadGuard() {
    window.eval(`${GUARD_SRC}; window.ImagerySkipGuard = ImagerySkipGuard;`);
    return window.ImagerySkipGuard;
}

describe('ImagerySkipGuard', () => {
    let ImagerySkipGuard;

    beforeEach(() => {
        window.sessionStorage.clear();
        ImagerySkipGuard = loadGuard();
    });

    test('starts with a full budget', () => {
        expect(ImagerySkipGuard.count()).toBe(0);
        expect(ImagerySkipGuard.canSkip()).toBe(true);
    });

    test('allows exactly MAX_CONSECUTIVE_SKIPS skips and then stops', () => {
        for (let i = 0; i < ImagerySkipGuard.MAX_CONSECUTIVE_SKIPS; i++) {
            expect(ImagerySkipGuard.canSkip()).toBe(true);
            ImagerySkipGuard.recordSkip();
        }
        expect(ImagerySkipGuard.canSkip()).toBe(false);
        expect(ImagerySkipGuard.count()).toBe(ImagerySkipGuard.MAX_CONSECUTIVE_SKIPS);
    });

    test('stays closed however long the failure lasts', () => {
        // The loop this guards is unbounded by nature: each skip hands the client another street to fail on. Once the
        // budget is spent, further attempts must not creep back under the limit or claw budget back.
        for (let i = 0; i < 50; i++) ImagerySkipGuard.recordSkip();
        expect(ImagerySkipGuard.canSkip()).toBe(false);
    });

    test('recordSkip reports the depth of the run', () => {
        expect(ImagerySkipGuard.recordSkip()).toBe(1);
        expect(ImagerySkipGuard.recordSkip()).toBe(2);
    });

    test('a pano that loads restores the full budget', () => {
        // "Consecutive" is the whole point: a labeler who meets one dead-end street, audits the next few normally, and
        // then meets another dead end must not accumulate toward the cap across a productive session.
        for (let i = 0; i < ImagerySkipGuard.MAX_CONSECUTIVE_SKIPS; i++) ImagerySkipGuard.recordSkip();
        expect(ImagerySkipGuard.canSkip()).toBe(false);

        ImagerySkipGuard.reset();
        expect(ImagerySkipGuard.count()).toBe(0);
        expect(ImagerySkipGuard.canSkip()).toBe(true);
    });

    test('the count survives a page reload, which is what the skip loop does between streets', () => {
        ImagerySkipGuard.recordSkip();
        ImagerySkipGuard.recordSkip();

        // A reload re-evaluates the script: fresh class, fresh in-memory state, same session storage.
        const reloaded = loadGuard();
        expect(reloaded.count()).toBe(2);
    });

    test('ignores a corrupted stored value rather than trusting it', () => {
        window.sessionStorage.setItem('sidewalk.consecutiveImagerySkips', 'not-a-number');
        expect(ImagerySkipGuard.count()).toBe(0);
        expect(ImagerySkipGuard.canSkip()).toBe(true);
    });

    test('treats a negative stored value as no skips, so it cannot buy extra budget', () => {
        window.sessionStorage.setItem('sidewalk.consecutiveImagerySkips', '-100');
        expect(ImagerySkipGuard.count()).toBe(0);
        expect(ImagerySkipGuard.canSkip()).toBe(true);
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

        test('degrades to permitting skips instead of breaking Explore', () => {
            // Some privacy modes throw on any storage access. A guard that cannot count is no worse than the behavior
            // before it existed; a guard that throws would take the whole page down on a path that is already failing.
            expect(() => ImagerySkipGuard.count()).not.toThrow();
            expect(() => ImagerySkipGuard.recordSkip()).not.toThrow();
            expect(() => ImagerySkipGuard.reset()).not.toThrow();
            expect(ImagerySkipGuard.canSkip()).toBe(true);
        });
    });
});
