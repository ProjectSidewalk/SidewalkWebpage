/**
 * Tests for the reason pop-up on a Gallery grid card (frontend/js/gallery/validation/ValidationMenu.js, #5475).
 *
 * A Disagree or Unsure cast on the card is followed by "why?", hung off the strip button or thumb that cast it
 * once the server has the vote. A pick posts the reason as the viewer's comment with the card's own imagery fields
 * and records it on the card's payload, so the expanded view opened next shows it; "Other…" opens that expanded
 * view with its comment box, since the grid card has no box of its own. The vote holds while a pick is written.
 *
 * Setup follows galleryValidationMenu.test.js, with a fuller card stub and the fetch the votes and picks go through.
 */

import { loadModules, mockModule, useUtil } from './loader.js';
import { fakeTracker } from './fakes.js';

mockModule('i18next', () => ({ default: { t: (key) => key } }));
mockModule('frontend/js/common/BadgeAchievements.js', () => ({ BadgeAchievements: { recordValidation() {} } }));

let ValidationMenu;
let reasonPopover;
let post;
let tracker;

const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });
const popoverEl = () => document.querySelector('.reason-popover');
const popoverShown = () => !!popoverEl() && !popoverEl().hidden;
const chips = () => [...document.querySelectorAll('.reason-popover .reason-chips__group .reason-chips__chip')];
const other = () => document.querySelector('.reason-popover .reason-chips__chip--other');
const posted = (url) => post.mock.calls.filter(([u]) => u === url).map(([, opts]) => JSON.parse(opts.body));
const events = () => tracker.push.mock.calls.map(([name]) => name);

/**
 * Builds a menu on a card the way Card.js does, with the pieces the menu touches.
 * @param {object} [props] - The card's properties, over a CurbRamp with no vote and no comments.
 * @returns {{menu: ValidationMenu, card: HTMLElement, props: object, onOtherReason: Function, thumbs: object}}
 */
function makeMenu(props = {}) {
  const card = document.createElement('div');
  card.className = 'gallery-card';
  const image = document.createElement('div');
  image.className = 'image-holder';
  card.append(image);
  document.body.append(card);
  const state = {
    label_id: 7, label_type: 'CurbRamp', user_validation: null, from_current_user: false, comments: [],
    pano_id: 'pano-7', pov: { heading: 10, pitch: -5, zoom: 1 }, heading: 10, pitch: -5, zoom: 1,
    lat: 47.6, lng: -122.3, camera_lat: 47.61, camera_lng: -122.31, severity: 2, tags: [],
    ...props,
  };
  const thumbs = {
    agreeContainer: document.createElement('div'),
    disagreeContainer: document.createElement('div'),
    setVoteIconFilled: () => {},
    animateVoteChange: vi.fn(),
    updateValCounts: () => {},
  };
  card.append(thumbs.agreeContainer, thumbs.disagreeContainer);
  const onOtherReason = vi.fn();
  const refCard = {
    getProperty: (key) => state[key],
    setProperty: (key, value) => { state[key] = value; },
    getLabelType: () => state.label_type,
    getImageSource: () => 'crop',
    labelIcon: document.createElement('div'), // jsdom lays nothing out; the vote's canvas_x/y read as 0.
    validationInfoDisplay: thumbs,
    updateUserValidation(vote) {
      state.user_validation = vote;
      this.validationMenu.showValidationOnCard(vote);
    },
  };
  const menu = new ValidationMenu(refCard, image, tracker, { onOtherReason });
  refCard.validationMenu = menu;
  return { menu, card, props: state, onOtherReason, thumbs };
}

const button = (card, option) => card.querySelector(`.gallery-card-${option}-button`);
const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));

beforeEach(async () => {
  document.body.innerHTML = '';
  tracker = fakeTracker();
  post = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ username: 'tester', comment_id: 3 }) }));
  useUtil({ lazyIdentityFetch: post });
  ({ ValidationMenu, reasonPopover } = await loadModules(
    'frontend/js/gallery/validation/ValidationMenu.js',
    'frontend/js/common/ReasonPopover.js',
  ));
});

afterEach(() => reasonPopover().close());

describe('the reason pop-up on a Gallery card (#5475)', () => {
  test('a Disagree from the strip opens the reasons hung off that button, once the vote has landed', async () => {
    const { card, thumbs } = makeMenu();
    click(button(card, 'disagree'));
    expect(popoverShown()).toBe(false);
    await flush();

    expect(popoverShown()).toBe(true);
    expect(reasonPopover().anchor).toBe(button(card, 'disagree'));
    expect(reasonPopover().isOpenFor(card)).toBe(true);
    expect(chips().map((c) => c.dataset.reasonId)).toEqual(['wrong-type', 'driveway', 'driveway-transition']);
    expect(thumbs.animateVoteChange).toHaveBeenCalledWith(null, 'Disagree');
  });

  test('a Disagree from the thumb hangs off the thumb; an Agree, a clear, and a reasonless type open nothing', async () => {
    const { card, thumbs } = makeMenu();
    thumbs.disagreeContainer.onclick({ currentTarget: thumbs.disagreeContainer });
    await flush();
    expect(reasonPopover().anchor).toBe(thumbs.disagreeContainer);

    thumbs.agreeContainer.onclick({ currentTarget: thumbs.agreeContainer });
    await flush();
    expect(popoverShown()).toBe(false);

    click(button(card, 'agree')); // Clears the Agree.
    await flush();
    expect(posted('/labelmap/validate').at(-1).undone).toBe(true);
    expect(popoverShown()).toBe(false);

    const occlusion = makeMenu({ label_id: 8, label_type: 'Occlusion' });
    click(button(occlusion.card, 'disagree'));
    await flush();
    expect(popoverShown()).toBe(false);
  });

  test('a pick posts the reason with the card\'s imagery fields, records it on the card, and the pop-up leaves', async () => {
    const { card, props } = makeMenu({ comments: [{ comment: 'Fine', mine: false, commenter: 0 }] });
    const shared = props.comments;
    click(button(card, 'disagree'));
    await flush();

    click(chips()[1]);
    expect(events()).toContain('Click_DisagreeReason_Option=driveway');
    // The vote holds while the pick is written.
    expect(button(card, 'agree').disabled).toBe(true);
    expect(card.classList.contains('gallery-card--vote-locked')).toBe(true);
    await flush();

    expect(posted('/labelmap/comment')[0]).toEqual({
      label_id: 7, label_type: 'CurbRamp', comment: 'common:validation-reason.driveway.text', reason: 'driveway',
      pano_id: 'pano-7', heading: 10, pitch: -5, zoom: 1, lat: 47.61, lng: -122.31,
    });
    expect(button(card, 'agree').disabled).toBe(false);
    expect(props.comments).toBe(shared); // In place: the expanded view's card shares this array.
    expect(props.comments.map((c) => [c.comment, c.reason, c.mine, c.validation])).toEqual([
      ['Fine', undefined, false, undefined],
      ['common:validation-reason.driveway.text', 'driveway', true, 'Disagree'],
    ]);
    expect(popoverEl().querySelector('.reason-popover__saved').hidden).toBe(false);
  });

  test('a pick replaces the viewer\'s earlier comment and marks the one on record when it reopens', async () => {
    const { card, props } = makeMenu({
      user_validation: 'Unsure',
      comments: [{ comment: 'typed words', mine: true, commenter: 2, validation: 'Unsure' }],
    });
    click(button(card, 'disagree')); // Changes the vote: the server drops the old comment, and so does the card.
    await flush();
    expect(chips().every((c) => c.getAttribute('aria-pressed') === 'false')).toBe(true);
    click(chips()[0]);
    await flush();
    expect(props.comments.filter((c) => c.mine)).toHaveLength(1);
    expect(props.comments.find((c) => c.mine).commenter).toBe(2); // Keeps the avatar colour it had.

    reasonPopover().close();
    click(button(card, 'unsure'));
    await flush();
    expect(chips().every((c) => c.getAttribute('aria-pressed') === 'false')).toBe(true); // A new vote, no reason yet.
  });

  test('a reply that lands after the vote moved is not recorded, and a failed save is said', async () => {
    const { card, props, menu } = makeMenu();
    click(button(card, 'disagree'));
    await flush();
    let resolveComment;
    post.mockImplementationOnce(() => new Promise((resolve) => { resolveComment = resolve; }));
    click(chips()[0]);
    // The expanded view changed the vote meanwhile; its relay closes the question here.
    menu.showValidationOnCard('Agree');
    props.user_validation = 'Agree';
    expect(popoverShown()).toBe(false);
    resolveComment({ ok: true, status: 200, json: async () => ({ username: 'tester', comment_id: 4 }) });
    await flush();
    expect(props.comments).toEqual([]);

    click(button(card, 'disagree'));
    await flush();
    post.mockImplementationOnce(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    click(chips()[0]);
    await flush();
    expect(popoverShown()).toBe(true);
    expect(chips()[0].getAttribute('aria-disabled')).toBe('false');
    expect(popoverEl().querySelector('.reason-popover__hint').textContent).toBe('labelmap:comment-save-failed');
    console.error.mockRestore();
  });

  test('"Other…" is logged and handed to the host, which opens the expanded view', async () => {
    const { card, onOtherReason } = makeMenu();
    click(button(card, 'disagree'));
    await flush();
    click(other());
    expect(popoverShown()).toBe(false);
    expect(onOtherReason).toHaveBeenCalledTimes(1);
    expect(events()).toContain('Click_DisagreeReason_Other');
  });

  test('a dismissal is logged; one question at a time across cards', async () => {
    const first = makeMenu({ label_id: 1 });
    const second = makeMenu({ label_id: 2 });
    click(button(first.card, 'disagree'));
    await flush();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(events()).toContain('KeyboardShortcut_ReasonMenu_Dismiss');
    expect(popoverShown()).toBe(false);

    click(button(first.card, 'unsure'));
    await flush();
    click(button(second.card, 'disagree'));
    await flush();
    expect(reasonPopover().isOpenFor(first.card)).toBe(false);
    expect(reasonPopover().isOpenFor(second.card)).toBe(true);
    expect(first.card.classList.contains('has-reason-popover')).toBe(false);
    expect(events().filter((e) => e.includes('ReasonMenu_Dismiss'))).toHaveLength(1);
  });

  test('a vote is refused while a pick is in flight', async () => {
    const { card, menu } = makeMenu();
    click(button(card, 'disagree'));
    await flush();
    post.mockImplementationOnce(() => new Promise(() => {}));
    click(chips()[0]);
    const res = await menu.validateOnClickOrKeyPress('validate-agree', false, false)();
    expect(res).toBeNull();
    expect(posted('/labelmap/validate')).toHaveLength(1);
  });
});
