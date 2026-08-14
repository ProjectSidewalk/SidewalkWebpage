/**
 * Tests for the tutorial-annotation helpers in public/js/common/utilitiesSidewalk.js:
 * util.misc.mergeOnboardingAnnotations, util.misc.carryOverOnboardingAnnotations, and util.misc.unwrapPanoX.
 *
 * These back Onboarding's #drawAnnotations, which is called far more often than once per step: once per pano move,
 * and — since the staggered example-label entrance (#4814/#4815) — once per animation frame while labels pop in.
 * Every one of those passes rebuilds the carry-over list from the merged list, so the merge has to be idempotent
 * under repetition or the list grows without bound (#4832). That failure is invisible in a screenshot: the icons
 * overdraw at the same coordinates and only the arrow-blink period drifts, which is why it is pinned here.
 *
 * These are pure functions over plain objects, so no DOM stubbing is needed beyond loading the source.
 */

const fs = require('fs');
const path = require('path');

const SOURCE = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/common/utilitiesSidewalk.js'), 'utf8'
);

// The tutorial pano's real dimensions (svl.TUTORIAL_PANO_WIDTH in Main.js), so the seam cases are the real ones.
const PANO_WIDTH = 13312;
const SEAM_ZONE = PANO_WIDTH / 4; // 3328

/** An annotation that outlives its own step, i.e. one that gets carried over. */
const sticky = (id, keepUntil) => ({ id, type: 'label', labelType: 'CurbRamp', keepUntil });

/** An annotation scoped to the step that declares it. */
const transient = (id, type = 'arrow') => ({ id, type });

describe('tutorial annotation helpers', () => {
    let misc;

    beforeEach(() => {
        // utilitiesSidewalk.js reads i18next at call time for label descriptions; the helpers here never do.
        window.i18next = { t: (k) => k };
        window.eval(SOURCE);
        misc = window.util.misc;
    });

    describe('mergeOnboardingAnnotations', () => {
        it('returns the carried-over annotations followed by the state\'s own', () => {
            const carried = sticky('carried', 'later-step');
            const own = transient('own');

            expect(misc.mergeOnboardingAnnotations([carried], [own])).toEqual([carried, own]);
        });

        it('treats a state with no annotations of its own as just the carry-over list', () => {
            const carried = sticky('carried', 'later-step');

            expect(misc.mergeOnboardingAnnotations([carried], null)).toEqual([carried]);
            expect(misc.mergeOnboardingAnnotations([carried], undefined)).toEqual([carried]);
        });

        it('includes an annotation once even when it is already in the carry-over list', () => {
            const shared = sticky('shared', 'later-step');

            // What a redraw looks like: the previous pass already carried `shared` forward.
            expect(misc.mergeOnboardingAnnotations([shared], [shared, transient('arrow')]))
                .toEqual([shared, transient('arrow')]);
        });

        it('stays flat across repeated redraws of one step, not growing per pass (#4832)', () => {
            const state = [sticky('label-a', 'later-step'), sticky('label-b', 'later-step'), transient('arrow')];
            let carried = [];

            // 100 passes ~= one second of the entrance animation's requestAnimationFrame loop.
            const sizes = [];
            for (let i = 0; i < 100; i++) {
                const merged = misc.mergeOnboardingAnnotations(carried, state);
                sizes.push(merged.length);
                carried = misc.carryOverOnboardingAnnotations(merged, 'this-step');
            }

            // Every pass sees exactly the three annotations, and carries the two sticky ones.
            expect(new Set(sizes)).toEqual(new Set([3]));
            expect(carried).toHaveLength(2);
        });

        it('does not mutate either input', () => {
            const carried = [sticky('carried', 'later-step')];
            const own = [transient('own')];

            misc.mergeOnboardingAnnotations(carried, own);

            expect(carried).toHaveLength(1);
            expect(own).toHaveLength(1);
        });
    });

    describe('carryOverOnboardingAnnotations', () => {
        it('keeps only annotations tagged to outlive the step being drawn', () => {
            const kept = sticky('kept', 'a-later-step');
            const untagged = transient('untagged');

            expect(misc.carryOverOnboardingAnnotations([kept, untagged], 'this-step')).toEqual([kept]);
        });

        it('drops an annotation once the step it was kept until is the one being drawn', () => {
            const expiring = sticky('expiring', 'this-step');

            expect(misc.carryOverOnboardingAnnotations([expiring], 'this-step')).toEqual([]);
        });
    });

    describe('unwrapPanoX', () => {
        it('leaves a coordinate in the middle of the image alone, whichever way the camera faces', () => {
            expect(misc.unwrapPanoX(6000, 90, PANO_WIDTH)).toBe(6000);
            expect(misc.unwrapPanoX(6000, 270, PANO_WIDTH)).toBe(6000);
        });

        it('pulls a far-edge coordinate back behind the origin when facing the first half', () => {
            // Past the last quarter, so it is really just left of a camera looking near heading 0.
            expect(misc.unwrapPanoX(13000, 90, PANO_WIDTH)).toBe(13000 - PANO_WIDTH);
        });

        it('pushes a near-origin coordinate past the far edge when facing the second half', () => {
            expect(misc.unwrapPanoX(300, 270, PANO_WIDTH)).toBe(300 + PANO_WIDTH);
        });

        it('does not wrap the half of the image the camera is already facing', () => {
            expect(misc.unwrapPanoX(300, 90, PANO_WIDTH)).toBe(300);
            expect(misc.unwrapPanoX(13000, 270, PANO_WIDTH)).toBe(13000);
        });

        it('treats the seam-zone boundaries as outside the ambiguous band', () => {
            expect(misc.unwrapPanoX(PANO_WIDTH - SEAM_ZONE, 90, PANO_WIDTH)).toBe(PANO_WIDTH - SEAM_ZONE);
            expect(misc.unwrapPanoX(SEAM_ZONE, 270, PANO_WIDTH)).toBe(SEAM_ZONE);
        });

        it('switches behavior at heading 180, the boundary between the two halves', () => {
            expect(misc.unwrapPanoX(13000, 179.9, PANO_WIDTH)).toBe(13000 - PANO_WIDTH);
            expect(misc.unwrapPanoX(13000, 180, PANO_WIDTH)).toBe(13000);
        });
    });
});
