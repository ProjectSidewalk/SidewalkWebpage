/**
 * Every tutorial transition in public/js/explore/src/onboarding/OnboardingStates.js must name a state that exists.
 *
 * Onboarding#getState throws on an unknown id, but only when a user reaches that step, so a typo'd id would otherwise
 * surface as a tutorial that dies partway through for everyone. Function transitions branch on the clicked element or
 * the label being tagged, so rather than fake every branch, their ids are read from the `return '<id>'` statements in
 * their source.
 */

const fs = require('fs');
const path = require('path');

const SOURCE = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'public/js/explore/src/onboarding/OnboardingStates.js'), 'utf8'
);

describe('OnboardingStates transitions', () => {
    let states;
    let ids;

    beforeAll(() => {
        // Only what building the state list touches; message text and icon paths don't matter here.
        window.i18next = { t: (key) => key };
        window.util = {
            assetPath: (p) => p,
            misc: {
                getLabelDescriptions: () => ({ tagInfo: new Proxy({}, { get: () => ({ text: '' }) }) }),
                getRatingLevelKeys: () => ({ 1: 'good', 2: 'okay', 3: 'bad' }),
                getSmileyIconPath: () => '',
            },
            pano: { horizonRelativeCoordToPov: () => ({ heading: 0, pitch: 0 }) },
        };
        window.eval(`${SOURCE}; window.OnboardingStates = OnboardingStates;`);
        const stub = new Proxy({}, { get: () => () => undefined });
        states = new window.OnboardingStates(stub, stub, stub).get();
        ids = new Set(states.map((state) => state.id));
    });

    /**
     * @param {string|Function|Function[]} transition A state's `transition` value.
     * @returns {string[]} Every state id the transition can lead to.
     */
    function targetsOf(transition) {
        const fn = Array.isArray(transition) ? transition[0] : transition;
        if (typeof fn !== 'function') return [fn];
        const returned = [...fn.toString().matchAll(/return '([^']+)'/g)].map((match) => match[1]);
        // A function with no literal return would slip past this test unchecked, so fail loudly instead.
        if (returned.length === 0) throw new Error(`Can't read the target ids of transition:\n${fn}`);
        return returned;
    }

    test('every transition names an existing state', () => {
        const broken = states
            .filter((state) => 'transition' in state)
            .flatMap((state) => targetsOf(state.transition).map((target) => ({ from: state.id, to: target })))
            .filter(({ to }) => !ids.has(to));
        expect(broken).toEqual([]);
    });

    test('the ids Onboarding looks up by name exist', () => {
        expect(ids.has('initialize')).toBe(true);
        expect(ids.has('outro')).toBe(true);
    });
});
