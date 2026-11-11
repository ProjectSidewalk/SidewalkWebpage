/**
 * Tests the vote buttons on a Gallery card (frontend/js/gallery/validation/ValidationMenu.js, #5517, #5840).
 *
 * Each button keeps its own color class for its whole life, and a vote only adds or removes `is-selected` and flips
 * `aria-pressed`. Overwriting the class list instead would wipe the color class and turn the button white. A vote
 * restyles the card only once the server has it, is logged under the control that cast it, and a label of the
 * viewer's own can't be voted on at all. The reason pop-up that follows some votes is in galleryReasonPopover.test.js.
 */

import { loadModules, mockModule, useUtil } from './loader.js';
import { fakeTracker } from './fakes.js';

const recordValidation = vi.fn();
mockModule('i18next', () => ({ default: { t: (key) => key } }));
mockModule('frontend/js/common/BadgeAchievements.js', () => ({ BadgeAchievements: { recordValidation } }));

let ValidationMenu;
let reasonPopover;
let post;
let tracker;

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

/**
 * Builds a menu on a fresh card, with the pieces of a Gallery Card the menu touches.
 * @param {?string} [userValidation] - The vote the viewer already had on this label when the page loaded.
 * @param {object} [props] - Other card properties, over an Obstacle from someone else.
 * @param {object} [cardMembers] - Card methods to replace.
 * @returns {{menu: Object, card: HTMLElement, props: object, thumbs: object}} The menu, its card element, the
 *     card's live properties, and the thumbs display it drives.
 */
function makeMenu(userValidation = null, props = {}, cardMembers = {}) {
  const card = document.createElement('div');
  const image = document.createElement('div');
  card.append(image);
  document.body.replaceChildren(card);
  const state = {
    label_id: 11, label_type: 'Obstacle', pano_id: 'pano-11', heading: 90, pitch: -10, zoom: 2, severity: 3,
    tags: ['narrow'], user_validation: userValidation, from_current_user: false, ...props,
  };
  const thumbs = {
    agreeContainer: document.createElement('div'),
    disagreeContainer: document.createElement('div'),
    setVoteIconFilled: vi.fn(),
    setLockReason: vi.fn(),
    animateVoteChange: vi.fn(),
  };
  card.append(thumbs.agreeContainer, thumbs.disagreeContainer);
  const refCard = {
    getProperty: (key) => state[key],
    getLabelType: () => state.label_type,
    getImageSource: () => 'gsv',
    getVoteSource: () => null,
    labelIcon: document.createElement('div'),
    validationInfoDisplay: thumbs,
    updateUserValidation(vote) {
      state.user_validation = vote;
      this.validationMenu.showValidationOnCard(vote);
    },
    ...cardMembers,
  };
  const menu = new ValidationMenu(refCard, image, tracker);
  refCard.validationMenu = menu;
  return { menu, card, props: state, thumbs };
}

/**
 * @param {string} option - 'agree', 'disagree', or 'unsure'.
 * @returns {HTMLButtonElement} That option's button on the current card.
 */
const button = (option) => document.querySelector(`.gallery-card-${option}-button`);

/** @returns {object[]} The bodies of every vote posted so far. */
const posted = () => post.mock.calls.filter(([url]) => url === '/labelmap/validate')
  .map(([, opts]) => JSON.parse(opts.body));

/** @returns {string[]} The names of every event logged so far. */
const events = () => tracker.push.mock.calls.map(([name]) => name);

beforeEach(async () => {
  recordValidation.mockClear();
  tracker = fakeTracker();
  post = vi.fn(async () => ({ ok: true, status: 200 }));
  useUtil({ lazyIdentityFetch: post });
  ({ ValidationMenu, reasonPopover } = await loadModules(
    'frontend/js/gallery/validation/ValidationMenu.js',
    'frontend/js/common/ReasonPopover.js',
  ));
});

afterEach(() => reasonPopover().close());

describe('Gallery card vote buttons', () => {
  it('starts with nothing pressed', () => {
    makeMenu();

    for (const option of ['agree', 'disagree', 'unsure']) {
      expect(button(option).classList.contains('is-selected')).toBe(false);
      expect(button(option).getAttribute('aria-pressed')).toBe('false');
    }
  });

  it('marks an earlier vote as pressed on load', () => {
    makeMenu('Disagree');

    expect(button('disagree').classList.contains('is-selected')).toBe(true);
    expect(button('disagree').getAttribute('aria-pressed')).toBe('true');
  });

  it('moves the pressed state when the vote changes, keeping each button\'s own class', () => {
    const { menu, card } = makeMenu('Agree');

    menu.showValidationOnCard('Unsure');

    expect(button('agree').className).toBe('validation-button gallery-card-agree-button');
    expect(button('agree').getAttribute('aria-pressed')).toBe('false');
    expect(button('unsure').classList.contains('gallery-card-unsure-button')).toBe(true);
    expect(button('unsure').classList.contains('is-selected')).toBe(true);
    expect(button('unsure').getAttribute('aria-pressed')).toBe('true');
    expect(card.classList.contains('validate-unsure')).toBe(true);
    expect(card.classList.contains('validate-agree')).toBe(false);
  });

  it('clears the pressed state when the vote is taken back', () => {
    const { menu, card } = makeMenu('Agree');

    menu.showValidationOnCard(null);

    expect(button('agree').classList.contains('is-selected')).toBe(false);
    expect(button('agree').getAttribute('aria-pressed')).toBe('false');
    expect(card.classList.contains('validate-agree')).toBe(false);
  });

  it('puts the thumbs back to outline once a vote shows, so they don\'t blend into the band', () => {
    const { menu, thumbs } = makeMenu();
    thumbs.setVoteIconFilled.mockClear();

    menu.showValidationOnCard('Agree');

    expect(thumbs.setVoteIconFilled.mock.calls).toEqual([['Agree', false], ['Disagree', false]]);
  });
});

describe('a label of the viewer\'s own', () => {
  it('can\'t be voted on, and says why on the strip and the thumbs', async () => {
    const { card, thumbs } = makeMenu(null, { from_current_user: true });

    expect(card.classList.contains('gallery-card--readonly')).toBe(true);
    for (const option of ['agree', 'disagree', 'unsure']) expect(button(option).disabled).toBe(true);
    expect(card.querySelector('.gallery-validation-button-holder').getAttribute('data-ps-tooltip'))
      .toBe('labelmap:own-label-disabled');
    expect(thumbs.setLockReason).toHaveBeenCalledWith('labelmap:own-label-disabled');

    thumbs.agreeContainer.click();
    thumbs.agreeContainer.dispatchEvent(new MouseEvent('mouseenter'));
    await flush();
    expect(post).not.toHaveBeenCalled();
    expect(thumbs.setVoteIconFilled).not.toHaveBeenCalled();
  });
});

describe('the thumbs', () => {
  it('fill on hover to hint they can be clicked, and empty again on leaving', () => {
    const { thumbs } = makeMenu();

    thumbs.disagreeContainer.dispatchEvent(new MouseEvent('mouseenter'));
    expect(thumbs.setVoteIconFilled).toHaveBeenLastCalledWith('Disagree', true);

    thumbs.disagreeContainer.dispatchEvent(new MouseEvent('mouseleave'));
    expect(thumbs.setVoteIconFilled).toHaveBeenLastCalledWith('Disagree', false);
  });

  it('leave the thumb of the vote already cast in outline on hover', () => {
    const { thumbs } = makeMenu('Agree');
    thumbs.setVoteIconFilled.mockClear();

    thumbs.agreeContainer.dispatchEvent(new MouseEvent('mouseenter'));
    expect(thumbs.setVoteIconFilled).not.toHaveBeenCalled();

    thumbs.disagreeContainer.dispatchEvent(new MouseEvent('mouseenter'));
    expect(thumbs.setVoteIconFilled).toHaveBeenCalledWith('Disagree', true);
  });
});

describe('casting a vote', () => {
  it('posts it with the card\'s imagery fields, logs the strip click, and restyles the card once it lands', async () => {
    const { card, thumbs } = makeMenu();

    button('agree').click();
    expect(card.classList.contains('validate-agree')).toBe(false);
    await flush();

    expect(events()).toEqual(['Validate_MenuClickAgree']);
    expect(tracker.push).toHaveBeenCalledWith('Validate_MenuClickAgree', { panoId: 'pano-11' }, { labelId: 11 });
    expect(posted()[0]).toMatchObject({
      label_id: 11, label_type: 'Obstacle', validation_result: 'Agree', severity: 3, tags: ['narrow'],
      heading: 90, pitch: -10, zoom: 2, canvas_x: 0, canvas_y: 0, source: 'GalleryImage', undone: false,
      redone: false, viewer_type: 'StaticApi',
    });
    expect(card.classList.contains('validate-agree')).toBe(true);
    expect(thumbs.animateVoteChange).toHaveBeenCalledWith(null, 'Agree');
    expect(recordValidation).toHaveBeenCalledTimes(1);
  });

  it('logs a thumb click under its own name, and a re-vote as redone with no badge check', async () => {
    const { thumbs } = makeMenu('Agree');

    thumbs.disagreeContainer.click();
    await flush();

    expect(events()).toEqual(['Validate_ThumbsMenuClickDisagree']);
    expect(posted()[0]).toMatchObject({ validation_result: 'Disagree', source: 'GalleryThumbs', redone: true });
    expect(recordValidation).not.toHaveBeenCalled();
  });

  it('a second press on the vote already cast clears it, and says so in the event name', async () => {
    const { card } = makeMenu('Unsure');

    button('unsure').click();
    await flush();

    expect(events()).toEqual(['Validate_MenuClickClearUnsure']);
    expect(posted()[0]).toMatchObject({ validation_result: 'Unsure', undone: true, redone: false });
    expect(card.classList.contains('validate-unsure')).toBe(false);
  });

  it('records the page\'s own vote source and a crop\'s viewer type when the card has them', async () => {
    makeMenu(null, {}, { getVoteSource: () => 'GalleryReview', getImageSource: () => 'crop' });

    button('disagree').click();
    await flush();

    expect(posted()[0]).toMatchObject({ source: 'GalleryReview', viewer_type: 'StaticCrop' });
  });

  it('leaves the card as it was when the server refuses the vote', async () => {
    post.mockResolvedValueOnce({ ok: false, status: 500 });
    const { card, thumbs } = makeMenu();

    button('agree').click();
    await flush();

    expect(card.classList.contains('validate-agree')).toBe(false);
    expect(button('agree').getAttribute('aria-pressed')).toBe('false');
    expect(thumbs.animateVoteChange).not.toHaveBeenCalled();
    expect(recordValidation).not.toHaveBeenCalled();
  });

  it('leaves the card as it was, and reports the error, when the request never completes', async () => {
    const error = new Error('offline');
    post.mockRejectedValueOnce(error);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { menu, card } = makeMenu();

    const res = await menu.validateOnClick('validate-agree', false)();

    expect(res).toBeNull();
    expect(consoleError).toHaveBeenCalledWith(error);
    expect(card.classList.contains('validate-agree')).toBe(false);
    consoleError.mockRestore();
  });
});
