/**
 * util.misc.animateVoteChange (frontend/js/common/utilitiesSidewalk.js), which ties a vote to the tally it changed on
 * Gallery cards and the label detail card: the new vote's icon pops and its count rises, the old vote's count dips,
 * and under prefers-reduced-motion each of those only blinks. Decoration, so a browser without the Web Animations API
 * must just skip it. (#5840)
 */

import { loadModules } from './loader.js';

const { util } = await loadModules('frontend/js/common/utilitiesSidewalk.js', 'frontend/js/common/utilities.js');

/** @returns {Record<string, {icon: object, count: object}>} Each vote's icon and count, recording their animations. */
const tallies = () => Object.fromEntries(['Agree', 'Disagree', 'Unsure']
  .map((vote) => [vote, { icon: { animate: vi.fn() }, count: { animate: vi.fn() } }]));

/**
 * @param {import('vitest').Mock} animate - An element's `animate` spy.
 * @returns {Array<string>} The transforms of the one animation it ran.
 */
const transforms = (animate) => animate.mock.calls[0][0].map((frame) => frame.transform);

describe('util.misc.animateVoteChange', () => {
  afterEach(() => delete window.matchMedia);

  test('pops the new vote\'s icon and raises its count', () => {
    const els = tallies();
    util.misc.animateVoteChange(els, null, 'Agree');
    expect(transforms(els.Agree.icon.animate)[1]).toContain('scale(1.5)');
    expect(transforms(els.Agree.count.animate)[1]).toBe('translateY(-35%)');
    expect(els.Disagree.count.animate).not.toHaveBeenCalled();
  });

  test('dips the old vote\'s count when the vote changes', () => {
    const els = tallies();
    util.misc.animateVoteChange(els, 'Disagree', 'Agree');
    expect(transforms(els.Disagree.count.animate)[1]).toBe('translateY(30%)');
    expect(els.Disagree.icon.animate).not.toHaveBeenCalled();
  });

  test('only dips the old count when a vote is cleared', () => {
    const els = tallies();
    util.misc.animateVoteChange(els, 'Unsure', null);
    expect(els.Unsure.count.animate).toHaveBeenCalledTimes(1);
    expect(els.Agree.icon.animate).not.toHaveBeenCalled();
  });

  test('does nothing when the vote didn\'t change', () => {
    const els = tallies();
    util.misc.animateVoteChange(els, 'Agree', 'Agree');
    expect(Object.values(els).flatMap(({ icon, count }) => [...icon.animate.mock.calls, ...count.animate.mock.calls]))
      .toEqual([]);
  });

  test('blinks instead of moving for a reader who asked for less motion', () => {
    window.matchMedia = vi.fn((query) => ({ matches: query === '(prefers-reduced-motion: reduce)' }));
    const els = tallies();
    util.misc.animateVoteChange(els, 'Disagree', 'Agree');
    const blink = [{ opacity: 1 }, { opacity: 0.25 }, { opacity: 1 }];
    expect(els.Agree.icon.animate.mock.calls[0][0]).toEqual(blink);
    expect(els.Agree.count.animate.mock.calls[0][0]).toEqual(blink);
    expect(els.Disagree.count.animate.mock.calls[0][0]).toEqual(blink);
  });

  test('skips the animation in a browser without the Web Animations API', () => {
    expect(() => util.misc.animateVoteChange({ Agree: { icon: {}, count: null } }, null, 'Agree')).not.toThrow();
  });
});
