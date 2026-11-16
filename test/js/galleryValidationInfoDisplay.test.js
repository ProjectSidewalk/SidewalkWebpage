/**
 * Tests the words on a Gallery card's agree/disagree thumbs (gallery/displays/ValidationInfoDisplay.js, #5840): the
 * counts, and the tooltip each thumb carries, which has to read the same as the Label Detail card's for the same vote
 * (#4778). The icon artwork itself is pinned in galleryVoteIconSrc.test.js.
 */

import { loadModules, mockModule, useUtil } from './loader.js';

// Echoes the key and the count, so a tooltip shows which sentence was picked and whom it counted.
mockModule('i18next', () => ({
  default: { t: (key, opts) => (opts && 'count' in opts ? `${key}(${opts.count})` : key) },
}));

let ValidationInfoDisplay;

/**
 * Builds a display on a fresh container, the way a Gallery card does.
 * @param {object} [opts] - What the card's payload says.
 * @param {number} [opts.agree] - Agree votes on record.
 * @param {number} [opts.disagree] - Disagree votes on record.
 * @param {?string} [opts.ai] - The AI's vote, if any.
 * @param {?string} [opts.mine] - The viewer's own vote, if any.
 * @returns {object} The display.
 */
function makeDisplay({ agree = 3, disagree = 1, ai = null, mine = null } = {}) {
  const container = document.createElement('div');
  document.body.replaceChildren(container);
  return new ValidationInfoDisplay(container, agree, disagree, ai, mine);
}

/** @returns {{Agree: string, Disagree: string}} Each thumb's tooltip. */
const tips = (display) => ({
  Agree: display.agreeContainer.getAttribute('data-ps-tooltip'),
  Disagree: display.disagreeContainer.getAttribute('data-ps-tooltip'),
});

/** @returns {string[]} The two counts shown, agree first. */
const counts = () => [...document.querySelectorAll('.validation-info-count')].map((el) => el.innerText);

beforeEach(async () => {
  ({ ValidationInfoDisplay } = await loadModules('frontend/js/gallery/displays/ValidationInfoDisplay.js'));
});

describe('Gallery vote thumbs', () => {
  test('show each count and say what clicking that thumb would add to it', () => {
    const display = makeDisplay();

    expect(counts()).toEqual(['3', '1']);
    expect(tips(display)).toEqual({
      Agree: 'labelmap:vote-tooltip-agree(3)',
      Disagree: 'labelmap:vote-tooltip-disagree(1)',
    });
  });

  test('on the viewer\'s own vote, count only the others and offer to clear it', () => {
    const display = makeDisplay({ agree: 3, mine: 'Agree' });

    expect(tips(display).Agree).toBe('labelmap:vote-tooltip-voted-agree(2) labelmap:vote-tooltip-clear');
    expect(tips(display).Disagree).toBe('labelmap:vote-tooltip-disagree(1)');
  });

  test('never count a negative "others" when the viewer\'s vote is the only one the count missed', () => {
    const display = makeDisplay({ disagree: 0, mine: 'Disagree' });

    expect(tips(display).Disagree).toBe('labelmap:vote-tooltip-voted-disagree(0) labelmap:vote-tooltip-clear');
  });

  test('say when our AI is among the voters, and follow a type change that swaps its vote', () => {
    const display = makeDisplay({ ai: 'Disagree' });
    expect(tips(display).Disagree).toBe('labelmap:vote-tooltip-disagree(1) labelmap:vote-tooltip-ai-included');
    expect(tips(display).Agree).toBe('labelmap:vote-tooltip-agree(3)');

    display.setAiValidation('Agree');

    expect(tips(display).Agree).toBe('labelmap:vote-tooltip-agree(3) labelmap:vote-tooltip-ai-included');
    expect(tips(display).Disagree).toBe('labelmap:vote-tooltip-disagree(1)');
  });

  test('a locked card states its reason on both thumbs, and keeps it through a count change', () => {
    const display = makeDisplay({ mine: 'Agree' });

    display.setLockReason('labelmap:own-label-disabled');
    display.updateValCounts(5, 2);

    expect(counts()).toEqual(['5', '2']);
    expect(tips(display)).toEqual({ Agree: 'labelmap:own-label-disabled', Disagree: 'labelmap:own-label-disabled' });
  });

  test('a new count with the viewer\'s vote moves the "voted" wording to the thumb now picked', () => {
    const display = makeDisplay({ mine: 'Agree' });

    display.updateValCounts(2, 2, 'Disagree');

    expect(tips(display).Agree).toBe('labelmap:vote-tooltip-agree(2)');
    expect(tips(display).Disagree).toBe('labelmap:vote-tooltip-voted-disagree(1) labelmap:vote-tooltip-clear');
  });

  test('hands both tallies to the shared vote animation', () => {
    const animateVoteChange = vi.fn();
    useUtil({ misc: { animateVoteChange } });
    const display = makeDisplay();

    display.animateVoteChange(null, 'Agree');

    const [tallies, previous, current] = animateVoteChange.mock.calls[0];
    expect(Object.keys(tallies)).toEqual(['Agree', 'Disagree']);
    expect(tallies.Agree.count).toBe(display.agreeText);
    expect(tallies.Disagree.icon).toBe(display.disagreeContainer.querySelector('.validation-info-image'));
    expect([previous, current]).toEqual([null, 'Agree']);
    useUtil();
  });
});
