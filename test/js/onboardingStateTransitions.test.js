/**
 * Every tutorial transition in frontend/js/explore/onboarding/OnboardingStates.js must name a state that exists.
 *
 * Onboarding#getState throws on an unknown id, but only when a user reaches that step, so a typo'd id would otherwise
 * surface as a tutorial that dies partway through for everyone. Function transitions branch on the clicked element or
 * the label being tagged, so rather than fake every branch, their ids are read from the `return '<id>'` statements in
 * their source.
 */

import { loadModules, mockModule } from './loader.js';

// Message text doesn't matter here; only the state list is read.
mockModule('i18next', () => ({ default: { t: (key) => key } }));

describe('OnboardingStates transitions', () => {
  let states;
  let ids;

  beforeAll(async () => {
    const { OnboardingStates } = await loadModules('frontend/js/explore/onboarding/OnboardingStates.js');
    const stub = new Proxy({}, { get: () => () => undefined });
    states = new OnboardingStates(stub, stub, stub).get();
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
