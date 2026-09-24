/**
 * Tests for the Gallery card's reason popover (public/js/gallery/src/validation/ValidationMenu.js, #5475).
 *
 * A Disagree or Unsure cast on a small card has nowhere to say why: the card has no comment box. So the vote
 * opens a popover over the card's image with the same one-tap reasons the label card offers. A pick posts the
 * reason through the card's comment endpoint with the card's own point of view, marks the chip, and closes; "Other…"
 * hands off to the expanded view with its comment box requested; Escape and an outside click dismiss with the vote
 * standing. An Agree, a cleared vote, and a vote relayed from the expanded view open nothing.
 *
 * ValidationMenu is a top-level `class` written for Grunt concatenation, so it is eval'd into the jsdom global scope
 * with its collaborators — jQuery, the Gallery's `sg` globals, the card it decorates — stubbed on `window` first.
 */

const fs = require('fs');
const path = require('path');

const { assetPathStub, loadGlobalScript, REPO_ROOT, stampValidationReasons } = require('./loadGlobalScript');

const readSrc = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const MENU_SRC = readSrc('public/js/gallery/src/validation/ValidationMenu.js');
const CHIPS_SRC = readSrc('public/js/common/ReasonChips.js');
const EN_COMMON = JSON.parse(readSrc('public/locales/en/common.json'));

/** An i18next over the real English common.json; other namespaces echo the key. */
function installI18next() {
  const lookup = (key) => {
    const [ns, rest] = key.split(':');
    if (ns !== 'common') return undefined;
    return rest.split('.').reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), EN_COMMON);
  };
  window.i18next = {
    t: (key) => (typeof lookup(key) === 'string' ? lookup(key) : key),
    exists: (key) => typeof lookup(key) === 'string',
  };
}

/** A Gallery Card reduced to what ValidationMenu reads and writes. */
function makeCard(overrides = {}) {
  const properties = {
    label_id: 42, label_type: 'CurbRamp', pano_id: 'pano-1', lat: 47.61, lng: -122.33, heading: 250.5,
    pitch: -12, zoom: 2, pov: { heading: 250.5, pitch: -12, zoom: 2 }, severity: 2, tags: [],
    user_validation: null, from_current_user: false, comments: [], ...overrides,
  };
  const card = {
    getProperty: (key) => (key in properties ? properties[key] : false),
    setProperty: (key, value) => { properties[key] = value; },
    getLabelType: () => properties.label_type,
    getImageSource: () => 'api',
    updateUserValidation: jest.fn((vote) => { properties.user_validation = vote; card.validationMenu.showValidationOnCard(vote); }),
    // Read for the vote's canvas_x/y; jsdom's offsets are read-only getters, so a plain object stands in.
    labelIcon: { offsetLeft: 0, offsetTop: 0, getBoundingClientRect: () => ({ width: 20, height: 20 }) },
    validationInfoDisplay: {
      agreeContainer: document.createElement('div'),
      disagreeContainer: document.createElement('div'),
      setVoteIconFilled: jest.fn(),
      setLockReason: jest.fn(),
    },
    properties,
  };
  return card;
}

describe('the Gallery card reason popover (#5475)', () => {
  let card;
  let cardEl;
  let menu;
  let posted;
  let responses;

  /** Drains the microtask queue the menu's promise chain runs on; the fake clock below covers its timers. */
  const flush = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };
  const popover = () => cardEl.querySelector('.gallery-card__reasons');
  const chips = () => [...cardEl.querySelectorAll('.gallery-card__reasons .reason-chips__group .reason-chips__chip')];
  const chipById = (id) => cardEl.querySelector(`.gallery-card__reasons [data-reason-id="${id}"]`);
  const other = () => cardEl.querySelector('.gallery-card__reasons .reason-chips__chip--other');
  const status = () => cardEl.querySelector('.gallery-card__reasons-status');
  const isOpen = () => !!popover() && !popover().hidden;
  const vote = async (option) => {
    cardEl.querySelector(`#gallery-card-${option}-button`).click();
    await flush();
    jest.advanceTimersByTime(0); // The popover registers its dismiss listeners once the opening click has finished.
  };

  beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = '<div class="gallery-card"><div class="image-holder"></div></div>';
    cardEl = document.querySelector('.gallery-card');
    posted = [];
    responses = [];

    window.eval(readSrc('public/vendor/jquery/jquery-1.12.2.min.js'));
    window.util = { assetPath: assetPathStub };
    loadGlobalScript('public/js/common/utilities.js');
    installI18next();
    stampValidationReasons();
    loadGlobalScript('public/js/common/validationReasons.js');
    window.util.lazyIdentityFetch = jest.fn(async (url, init) => {
      posted.push({ url, body: JSON.parse(init.body) });
      return responses.shift() ?? { ok: true, status: 200, json: async () => ({ username: 'tester', comment_id: 1 }) };
    });
    window.BadgeAchievements = { recordValidation: jest.fn() };
    window.sg = {
      tracker: { push: jest.fn() },
      cardContainer: { openCardForComment: jest.fn() },
    };
    window.eval(`${CHIPS_SRC}\n${MENU_SRC}\nwindow.ReasonChips = ReasonChips;\nwindow.ValidationMenu = ValidationMenu;`);

    card = makeCard();
    menu = new window.ValidationMenu(card, window.$('.image-holder'));
    card.validationMenu = menu;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('a Disagree that lands opens the popover over the image with that type\'s reasons, focused', async () => {
    await vote('disagree');
    expect(posted[0].url).toBe('/labelmap/validate');
    expect(isOpen()).toBe(true);
    expect(cardEl.classList.contains('gallery-card--reasons-open')).toBe(true);
    expect(chips().map((c) => c.dataset.reasonId)).toEqual(['wrong-type', 'driveway', 'driveway-transition']);
    expect(document.activeElement).toBe(chips()[0]);
    expect(popover().querySelector('.gallery-card__reasons-close').getAttribute('aria-label')).toBe('Dismiss');
    expect(popover().getAttribute('role')).toBe('group');
    expect(popover().getAttribute('aria-label')).toBe('Why do you disagree?');
  });

  test('an Agree, a refused vote, and a type with no reasons open nothing', async () => {
    await vote('agree');
    expect(isOpen()).toBe(false);

    responses.push({ ok: false, status: 500 });
    await vote('disagree');
    expect(isOpen()).toBe(false);

    card.properties.label_type = 'Other';
    await vote('disagree');
    expect(isOpen()).toBe(false);
  });

  test('a pick posts the reason with the card\'s point of view, records it on the card, and closes shortly after', async () => {
    await vote('disagree');
    chipById('driveway').dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }));
    await flush();

    expect(posted[1].url).toBe('/labelmap/comment');
    expect(posted[1].body).toEqual({
      label_id: 42, label_type: 'CurbRamp', comment: 'This is a driveway', reason: 'driveway', pano_id: 'pano-1',
      heading: 250.5, pitch: -12, zoom: 2, lat: 47.61, lng: -122.33,
    });
    expect(window.sg.tracker.push).toHaveBeenCalledWith(
      'Click_DisagreeReason_Option=driveway', { panoId: 'pano-1' }, { labelId: 42 },
    );
    expect(chipById('driveway').getAttribute('aria-pressed')).toBe('true');
    expect(status().textContent).toBe('Reason saved');
    // What the expanded view will read when it opens next: the comment, marked mine, with its reason.
    expect(card.properties.comments).toEqual([expect.objectContaining({ comment: 'This is a driveway', reason: 'driveway', mine: true, validation: 'Disagree' })]);

    expect(isOpen()).toBe(true);
    jest.advanceTimersByTime(window.ValidationMenu.REASON_CLOSE_DELAY_MS);
    expect(isOpen()).toBe(false);
    expect(cardEl.classList.contains('gallery-card--reasons-open')).toBe(false);
    // The chip that had focus is hidden now, so focus goes back to the control that voted.
    expect(document.activeElement).toBe(cardEl.querySelector('#gallery-card-disagree-button'));
  });

  test('a pick that lands after the popover was dismissed is still recorded on the card', async () => {
    await vote('disagree');
    let release;
    window.util.lazyIdentityFetch.mockImplementationOnce((url, init) => new Promise((resolve) => {
      posted.push({ url, body: JSON.parse(init.body) });
      release = () => resolve({ ok: true, status: 200, json: async () => ({ username: 'tester', comment_id: 1 }) });
    }));
    chipById('driveway').dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }));
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(isOpen()).toBe(false);
    release();
    await flush();
    // The server replaced the comment, so the expanded view opened next must see it.
    expect(card.properties.comments).toEqual([expect.objectContaining({ reason: 'driveway', mine: true })]);
    expect(isOpen()).toBe(false);
  });

  test('a vote on another card closes this card\'s question, so one digit answers one label', async () => {
    await vote('disagree');
    const otherEl = document.createElement('div');
    otherEl.className = 'gallery-card';
    otherEl.innerHTML = '<div class="image-holder"></div>';
    document.body.appendChild(otherEl);
    const otherCard = makeCard({ label_id: 99 });
    otherCard.validationMenu = new window.ValidationMenu(otherCard, window.$(otherEl).find('.image-holder'));
    otherEl.querySelector('#gallery-card-disagree-button').click();
    await flush();
    jest.advanceTimersByTime(0);
    expect(isOpen()).toBe(false);
    expect(otherEl.querySelector('.gallery-card__reasons').hidden).toBe(false);

    document.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'Digit2', bubbles: true, cancelable: true }));
    await flush();
    const picks = posted.filter((p) => p.url === '/labelmap/comment');
    expect(picks).toHaveLength(1);
    expect(picks[0].body.label_id).toBe(99);
  });

  test('reopening marks the reason on record, and a failed pick says so without marking', async () => {
    card.properties.comments = [{ comment: 'Dit is een oprit', mine: true, reason: 'driveway', commenter: 0 }];
    await vote('disagree');
    expect(chipById('driveway').getAttribute('aria-pressed')).toBe('true');

    responses.push({ ok: false, status: 500 });
    chipById('driveway-transition').dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }));
    await flush();
    expect(chipById('driveway-transition').getAttribute('aria-pressed')).toBe('false');
    expect(chipById('driveway').getAttribute('aria-pressed')).toBe('true');
    expect(status().textContent).toBe('labelmap:comment-save-failed');
    expect(isOpen()).toBe(true);
  });

  test('the number keys pick, and Escape dismisses with the vote standing', async () => {
    await vote('disagree');
    document.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'Digit3', bubbles: true, cancelable: true }));
    await flush();
    expect(posted[1].body.reason).toBe('driveway-transition');
    expect(window.sg.tracker.push).toHaveBeenCalledWith(
      'KeyboardShortcut_DisagreeReason_Option=driveway-transition', { panoId: 'pano-1' }, { labelId: 42 },
    );

    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(isOpen()).toBe(false);
    expect(window.sg.tracker.push).toHaveBeenCalledWith('KeyboardShortcut_ReasonMenu_Dismiss', { panoId: 'pano-1' }, { labelId: 42 });
    expect(card.properties.user_validation).toBe('Disagree');
    expect(document.activeElement).toBe(cardEl.querySelector('#gallery-card-disagree-button'));
  });

  test('an outside click dismisses; a click inside does not', async () => {
    await vote('disagree');
    popover().querySelector('.reason-chips__prompt').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(isOpen()).toBe(true);
    document.body.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    expect(isOpen()).toBe(false);
  });

  test('"Other…" closes and hands the card to the expanded view for its comment box', async () => {
    await vote('unsure');
    expect(chips().map((c) => c.dataset.reasonId)).toEqual(['better-image', 'placement-incorrect', 'ramp-required-unsure']);
    other().dispatchEvent(new window.MouseEvent('click', { bubbles: true, detail: 1 }));
    expect(isOpen()).toBe(false);
    expect(window.sg.cardContainer.openCardForComment).toHaveBeenCalledWith(card);
    expect(window.sg.tracker.push).toHaveBeenCalledWith('Click_UnsureReason_Other', { panoId: 'pano-1' }, { labelId: 42 });
  });

  test('a vote moved from the expanded view closes a stale question; clearing the vote closes it too', async () => {
    await vote('disagree');
    expect(isOpen()).toBe(true);
    card.updateUserValidation('Agree'); // Relayed by ExpandedView after a vote over there.
    expect(isOpen()).toBe(false);

    await vote('disagree'); // Agree -> Disagree: opens.
    expect(isOpen()).toBe(true);
    await vote('disagree'); // The same option again clears the vote (#4653).
    expect(posted.at(-1).body.undone).toBe(true);
    expect(isOpen()).toBe(false);
  });
});
