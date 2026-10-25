/**
 * Tests for the reason pop-up on the label detail card (frontend/js/common/label-detail/LabelDetail.js, #5475).
 *
 * A Disagree or Unsure is followed by "why?", asked where the vote was cast: the pop-up (ReasonPopover.js) hangs
 * off the overlay button or the thumb that was clicked, or off the thumb for a shortcut vote, once the server has
 * the vote. A pick posts a canned reason as the reader's comment, by id and text, through the same path a typed
 * comment takes; "Other…" turns into a field in the pop-up for typed words. There is no button back to it: a vote
 * asks again, so a reader who dismissed it presses their vote twice (clear, then cast). The vote and its reason hold
 * each other: neither may move while the other is in flight, since the vote's write would otherwise race the pick.
 *
 * Fixture and stubs follow labelDetailComments.test.js, through labelDetailReasonFixture.js.
 */

import { loadModules, mockModule, useUtil } from './loader.js';
import { mockLabelDetailCollaborators } from './fakes.js';
import { buildCard, comment, deferred, meta } from './labelDetailReasonFixture.js';

mockModule('i18next', () => ({ default: { t: (key) => key } }));

let panoManager;
mockLabelDetailCollaborators(() => panoManager);
mockModule('frontend/js/common/ConfirmDialog.js', () => ({ ConfirmDialog: { confirm: vi.fn(async () => true) } }));

describe('the reason pop-up on the label card (#5475)', () => {
  let LabelDetail;
  let ReasonPopover;
  let reasonPopover;
  let card;
  let setPano;
  let post;

  const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });
  const q = (sel) => card.querySelector(sel);
  const popoverEl = () => document.querySelector('.reason-popover');
  const popoverShown = () => !!popoverEl() && !popoverEl().hidden;
  const chips = () => [...document.querySelectorAll('.reason-popover .reason-chips__group .reason-chips__chip')];
  const other = () => document.querySelector('.reason-popover .reason-chips__chip--other');
  const otherInput = () => document.querySelector('.reason-popover .reason-chips__other-input');
  const otherSave = () => document.querySelector('.reason-popover .reason-chips__other-save');
  const overlayButton = (vote) => q(`.label-detail__pano-overlay-button--${vote}`);
  const thumb = (vote) => q(`.label-detail__vote--${vote}`);
  const commentRow = () => q('.label-detail__comment-row');
  const status = () => q('.label-detail__comment-confirmation');
  const click = (el, detail = 1) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail }));
  const press = (code) => (document.activeElement || document.body).dispatchEvent(
    new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true }),
  );
  const logged = () => window.logWebpageActivity.mock.calls.map(([event]) => event);

  /** The bodies posted to a URL so far, oldest first. */
  const posted = (url) => post.mock.calls.filter(([u]) => u === url).map(([, opts]) => JSON.parse(opts.body));

  /** Shows a label and settles its imagery, which is what unlocks the card's controls. */
  async function showLabel(overrides) {
    setPano = deferred();
    panoManager.setPano.mockImplementation(() => setPano.promise);
    const payload = meta(overrides);
    await card.detail.showLabel(payload, 'TestSource');
    setPano.resolve(true);
    await setPano.promise;
    await flush();
    return payload;
  }

  /** A label with no vote yet; Obstacle offers three Disagree reasons and three Unsure ones. */
  const unvoted = (overrides = {}) => showLabel({ user_validation: null, num_disagree: 0, ...overrides });

  /**
   * Changes an Unsure vote to Disagree so the pop-up asks over the payload's comment (no `redone` in the stub reply,
   * so the card keeps that comment).
   * @param {object} [overrides] - Payload fields.
   * @param {number} [detail] - The click's `detail`; 0 is a keyboard press, which moves focus into the chips.
   */
  async function reask(overrides = {}, detail = 1) {
    await showLabel({ user_validation: 'Unsure', num_disagree: 0, num_unsure: 1, ...overrides });
    click(thumb('disagree'), detail);
    await flush();
  }

  beforeEach(async () => {
    card = buildCard();
    window.logWebpageActivity = vi.fn();
    post = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ username: 'tester', comment_id: 1 }) }));
    useUtil({ lazyIdentityFetch: post });
    window.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));

    setPano = deferred();
    panoManager = {
      clearLabels: vi.fn(),
      setLabel: vi.fn(),
      setLabelsHidden: vi.fn(),
      setPano: vi.fn(() => setPano.promise),
      activeViewerName: 'Default',
      panoViewer: {
        currPanoData: null,
        getViewerType: () => 'gsv',
        getPanoId: () => 'pano-1',
        getPosition: () => ({ lat: 47.61, lng: -122.33 }),
      },
      getPov: () => ({ heading: 250.5, pitch: -12, zoom: 2 }),
      getOriginalPosition: () => ({ heading: 250.5, pitch: -12 }),
      svHolder: Object.defineProperties(document.createElement('div'), {
        clientWidth: { value: 720 }, clientHeight: { value: 480 },
      }),
      label: { labelId: 42, label_type: 'Obstacle' },
    };

    ({ LabelDetail, ReasonPopover, reasonPopover } = await loadModules(
      'frontend/js/common/label-detail/LabelDetail.js',
      'frontend/js/common/ReasonPopover.js',
    ));
    card.detail = await LabelDetail.create(card, {
      admin: false, viewerType: 'Default', currUsername: 'tester', panoOverlaySource: 'overlay', voteColumnSource: 'thumbs',
    });
  });

  // Each test loads the module afresh; closed, the instance before it answers nothing.
  afterEach(() => reasonPopover().close());

  describe('opening', () => {
    test.each([
      ['the overlay button', () => overlayButton('disagree'), () => overlayButton('disagree')],
      ['the thumb', () => thumb('disagree'), () => thumb('disagree')],
    ])('a Disagree from %s opens the reasons hung off it, once the vote is on record', async (_where, control, anchor) => {
      await unvoted();
      expect(popoverShown()).toBe(false);

      click(control());
      // Nothing until the server has the vote: a pick must not race the vote's own write.
      expect(popoverShown()).toBe(false);
      await flush();

      expect(popoverShown()).toBe(true);
      expect(reasonPopover().anchor).toBe(anchor());
      expect(card.classList.contains('has-reason-popover')).toBe(true);
      expect(chips().map((c) => c.dataset.reasonId)).toEqual(['wrong-type', 'not-pedestrian-path', 'ample-space']);
      expect(commentRow().classList.contains('is-open')).toBe(false);
    });

    test('a shortcut vote hangs it off the thumb, since the overlay button is only there under hover', async () => {
      await unvoted();
      press('KeyU');
      await flush();
      expect(popoverShown()).toBe(true);
      expect(reasonPopover().anchor.className).toBe(thumb('unsure').className);
      expect(popoverEl().classList.contains('reason-popover--unsure')).toBe(true);
      // Opened from the keyboard, so focus is on the chips and the arrows move along them rather than paging.
      expect(document.activeElement).toBe(chips()[0]);
      const arrow = new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true, cancelable: true });
      document.activeElement.dispatchEvent(arrow);
      expect(document.activeElement).toBe(chips()[1]);
      expect(posted('/labelmap/validate')).toHaveLength(1);
    });

    test('an Agree, a cleared vote, a refused vote, and a type with no reasons open nothing', async () => {
      await unvoted();
      click(overlayButton('agree'));
      await flush();
      expect(popoverShown()).toBe(false);

      await showLabel({ user_validation: 'Disagree' });
      click(overlayButton('disagree')); // Clears it.
      await flush();
      expect(posted('/labelmap/validate').at(-1).undone).toBe(true);
      expect(popoverShown()).toBe(false);

      await unvoted({ label_type: 'Other' });
      click(overlayButton('disagree'));
      await flush();
      expect(popoverShown()).toBe(false);

      await unvoted();
      post.mockImplementationOnce(async () => ({ ok: false, status: 500, json: async () => ({}) }));
      vi.spyOn(console, 'error').mockImplementation(() => {});
      click(overlayButton('disagree'));
      await flush();
      expect(popoverShown()).toBe(false);
      console.error.mockRestore();
    });

    test('your own label offers no reasons, as it takes no vote', async () => {
      await unvoted({ from_current_user: true });
      click(thumb('disagree'));
      await flush();
      expect(posted('/labelmap/validate')).toHaveLength(0);
      expect(popoverShown()).toBe(false);
    });

    test('asking again marks the reason your comment already records', async () => {
      await reask({ comments: [comment('Not on a pedestrian path', true, { reason: 'not-pedestrian-path' })] });
      expect(chips().map((c) => c.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
      expect(other().getAttribute('aria-pressed')).toBe('false');

      await reask({ comments: [comment('my own words', true)] });
      expect(chips().map((c) => c.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'false']);
      expect(other().getAttribute('aria-pressed')).toBe('true');
    });
  });

  describe('a pick', () => {
    test('posts the reason as your comment, by id and text, and the pop-up says so and leaves', async () => {
      ReasonPopover.SAVED_HOLD_MS = 20; // Real timers, since the card's own promise chains flush through them.
      await unvoted();
      click(thumb('disagree'));
      await flush();

      click(chips()[1]);
      const [body] = posted('/labelmap/comment');
      expect(body).toMatchObject({
        label_id: 42, label_type: 'Obstacle', reason: 'not-pedestrian-path',
        comment: 'common:validation-reason.not-pedestrian-path.text', pano_id: 'pano-1',
      });
      expect(logged()).toContain('Click_module=LabelDetail_action=DisagreeReason_Option=not-pedestrian-path_labelId=42');
      // Locked while the pick is written: the vote may not move under it.
      expect(thumb('agree').disabled).toBe(true);
      expect(chips()[0].getAttribute('aria-disabled')).toBe('true');

      await flush();
      expect(thumb('agree').disabled).toBe(false);
      expect(popoverEl().querySelector('.reason-popover__saved').textContent).not.toBe('');
      expect(status().textContent).toBe('common:validation-reason.saved');
      // The comment is yours now, in your language, so the box closes as it does for a typed one.
      expect(q('.label-detail__validator-comments').textContent)
        .toContain('common:validation-reason.not-pedestrian-path.text');
      expect(commentRow().classList.contains('is-open')).toBe(false);

      expect(popoverShown()).toBe(true);
      await new Promise((resolve) => { setTimeout(resolve, 40); });
      expect(popoverShown()).toBe(false);
    });

    test('a number key picks, logged as the keyboard, and the EditComment log is not for a pick', async () => {
      await reask({ comments: [comment('my own words', true)] }, 0);
      press('Digit3');
      await flush();
      expect(posted('/labelmap/comment')[0].reason).toBe('ample-space');
      expect(logged()).toContain('KeyboardShortcut_module=LabelDetail_action=DisagreeReason_Option=ample-space_labelId=42');
      expect(logged().some((e) => e.includes('EditComment'))).toBe(false);
    });

    test('a failed save puts the chips back and says so under the box', async () => {
      await unvoted();
      click(thumb('disagree'));
      await flush();
      post.mockImplementationOnce(async () => ({ ok: false, status: 500, json: async () => ({}) }));
      vi.spyOn(console, 'error').mockImplementation(() => {});

      click(chips()[0]);
      await flush();

      expect(popoverShown()).toBe(true);
      expect(chips()[0].getAttribute('aria-disabled')).toBe('false');
      expect(status().textContent).toBe('labelmap:comment-save-failed');
      expect(thumb('agree').disabled).toBe(false);
      console.error.mockRestore();
    });

    test('a reply for a label already paged away from leaves the new label alone, locks included', async () => {
      await unvoted({ label_id: 100 });
      click(thumb('disagree'));
      await flush();
      let resolveComment;
      post.mockImplementationOnce(() => new Promise((resolve) => { resolveComment = resolve; }));
      click(chips()[0]);
      expect(thumb('agree').disabled).toBe(true);

      await unvoted({ label_id: 101 });
      expect(popoverShown()).toBe(false);
      expect(thumb('agree').disabled).toBe(false);

      resolveComment({ ok: true, status: 200, json: async () => ({ username: 'tester', comment_id: 9 }) });
      await flush();
      expect(q('.label-detail__validator-comments').textContent).not.toContain('wrong-type');
      expect(thumb('agree').disabled).toBe(false);
    });
  });

  describe('Other and the way back', () => {
    test('"Other…" becomes a field in the pop-up; Save stores the words as your typed comment', async () => {
      await unvoted();
      click(thumb('disagree'));
      await flush();
      click(other());
      expect(popoverShown()).toBe(true);
      expect(logged()).toContain('Click_module=LabelDetail_action=DisagreeReason_Other_labelId=42');
      const field = otherInput();
      expect(document.activeElement).toBe(field);
      expect(field.value).toBe('');
      expect(otherSave().disabled).toBe(true); // Nothing to save yet.

      field.value = 'blocked by a bin';
      field.dispatchEvent(new Event('input', { bubbles: true }));
      expect(otherSave().disabled).toBe(false);
      click(otherSave(), 0); // Enter in the field submits through a pointerless click on Save.
      expect(thumb('agree').disabled).toBe(true); // The vote holds while the words are written.
      await flush();
      expect(posted('/labelmap/comment').at(-1)).toMatchObject({ comment: 'blocked by a bin', reason: null });
      expect(logged()).toContain('KeyboardShortcut_module=LabelDetail_action=DisagreeReason_Other_Save_labelId=42');
      expect(q('.label-detail__validator-comments').textContent).toContain('blocked by a bin');
      expect(popoverEl().querySelector('.reason-popover__saved').textContent).not.toBe('');
      expect(thumb('agree').disabled).toBe(false);
    });

    test('"Other…" over a comment of yours opens holding typed words, and empty over a canned reason', async () => {
      await reask({ comments: [comment('my own words', true)] });
      click(other());
      expect(otherInput().value).toBe('my own words');

      await reask({ comments: [comment('Not on a path', true, { reason: 'not-pedestrian-path' })] });
      click(other());
      expect(otherInput().value).toBe('');
    });

    test('a save from the pop-up leaves the card\'s own edit box and its words alone, and logs no EditComment', async () => {
      await showLabel({
        user_validation: 'Unsure', num_disagree: 0, num_unsure: 1, comments: [comment('my own words', true)],
      });
      q('.label-detail__comment-edit').click();
      q('.label-detail__comment-input').value = 'half an edit';
      click(thumb('disagree'));
      await flush();
      click(other());
      otherInput().value = 'typed in the pop-up';
      otherInput().dispatchEvent(new Event('input', { bubbles: true }));
      click(otherSave());
      await flush();
      expect(posted('/labelmap/comment').at(-1)).toMatchObject({ comment: 'typed in the pop-up', reason: null });
      expect(q('.label-detail__comment-input').value).toBe('half an edit');
      expect(logged().some((e) => e.includes('_action=EditComment_'))).toBe(false);
    });

    test('unsaved words outlast a click outside; Escape still closes', async () => {
      await reask();
      click(other());
      otherInput().value = 'draft';
      otherInput().dispatchEvent(new Event('input', { bubbles: true }));
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      expect(popoverShown()).toBe(true);
      otherInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      expect(popoverShown()).toBe(false);
    });

    test('a dismissed pop-up comes back by pressing the vote twice: once to clear it, once to cast it', async () => {
      await unvoted();
      click(thumb('disagree'));
      await flush();
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      expect(popoverShown()).toBe(false);

      click(thumb('disagree'));
      await flush();
      expect(posted('/labelmap/validate').at(-1).undone).toBe(true);
      expect(popoverShown()).toBe(false);
      click(thumb('disagree'));
      await flush();
      expect(popoverShown()).toBe(true);
      expect(reasonPopover().anchor).toBe(thumb('disagree'));
    });
  });

  describe('the comment box around the pop-up', () => {
    const boxOpen = () => commentRow().classList.contains('is-open');
    const escape = () => document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );

    test('shut while the pop-up asks, then open with the vote\'s prompt once it is dismissed, as for an Agree', async () => {
      await unvoted();
      click(thumb('disagree'));
      await flush();
      expect(boxOpen()).toBe(false);
      expect(q('.label-detail__comments-section').hidden).toBe(true);

      escape();
      expect(boxOpen()).toBe(true);
      expect(q('.label-detail__comment-input').placeholder).toBe('labelmap:why-disagree');
      expect(q('.label-detail__comments-section').hidden).toBe(false);
    });

    test('a box an Agree opened stays open under the pop-up, asking the new vote\'s question', async () => {
      await unvoted();
      click(thumb('agree'));
      await flush();
      expect(boxOpen()).toBe(true);

      click(thumb('unsure'));
      await flush();
      expect(popoverShown()).toBe(true);
      expect(boxOpen()).toBe(true);
      expect(q('.label-detail__comment-input').placeholder).toBe('labelmap:why-unsure');
    });

    test('a saved reason leaves the box shut and the list showing it, once the pop-up has gone', async () => {
      ReasonPopover.SAVED_HOLD_MS = 20;
      await unvoted();
      click(thumb('disagree'));
      await flush();
      click(chips()[0]);
      await flush();
      await new Promise((resolve) => { setTimeout(resolve, 40); });
      expect(popoverShown()).toBe(false);
      expect(boxOpen()).toBe(false);
      expect(q('.label-detail__comments-section').hidden).toBe(false);
    });

    test('paging or a new vote closes the pop-up without opening the box', async () => {
      await unvoted();
      click(thumb('disagree'));
      await flush();
      click(thumb('unsure'));
      expect(popoverShown()).toBe(false);
      expect(boxOpen()).toBe(false); // Still in flight: nothing moves until the new vote asks.
      await flush();
      expect(popoverShown()).toBe(true);
      expect(boxOpen()).toBe(false);
    });
  });

  describe('leaving', () => {
    test('a dismissal is logged; paging and a new vote close it quietly', async () => {
      await unvoted();
      click(thumb('disagree'));
      await flush();
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      expect(popoverShown()).toBe(false);
      expect(logged()).toContain('KeyboardShortcut_module=LabelDetail_action=ReasonMenu_Dismiss_labelId=42');

      click(thumb('unsure')); // Changing the vote asks again.
      await flush();
      expect(popoverShown()).toBe(true);
      await unvoted({ label_id: 43 });
      expect(popoverShown()).toBe(false);

      click(thumb('unsure'));
      await flush();
      expect(popoverShown()).toBe(true);
      expect(logged().filter((e) => e.includes('ReasonMenu_Dismiss'))).toHaveLength(1);
      // Re-voting moves the question to the new vote; clearing takes it away.
      click(thumb('disagree'));
      await flush();
      expect(popoverEl().classList.contains('reason-popover--disagree')).toBe(true);
      click(thumb('disagree'));
      await flush();
      expect(popoverShown()).toBe(false);
      expect(logged().filter((e) => e.includes('ReasonMenu_Dismiss'))).toHaveLength(1);
    });

    test('A/D/U still vote with focus on a chip, and a vote waits for a pick in flight', async () => {
      await unvoted();
      press('KeyD');
      await flush();
      expect(document.activeElement).toBe(chips()[0]);
      let resolveComment;
      post.mockImplementationOnce(() => new Promise((resolve) => { resolveComment = resolve; }));
      press('Digit1');
      press('KeyU'); // Refused while the pick is written.
      await flush();
      expect(posted('/labelmap/validate')).toHaveLength(1);
      resolveComment({ ok: true, status: 200, json: async () => ({ username: 'tester', comment_id: 2 }) });
      await flush();
      press('KeyU');
      await flush();
      expect(posted('/labelmap/validate')).toHaveLength(2);
      expect(posted('/labelmap/validate')[1].validation_result).toBe('Unsure');
    });
  });

  describe('comments in the reader\'s language', () => {
    test('a canned reason renders from its id; typed words and unknown ids render as written', async () => {
      await showLabel({ comments: [
        comment('Esto es una entrada de coches', false, { reason: 'not-pedestrian-path', commenter: 1 }),
        comment('my own words', true),
      ] });
      const list = q('.label-detail__validator-comments').textContent;
      expect(list).toContain('common:validation-reason.not-pedestrian-path.text');
      expect(list).not.toContain('Esto es');
      expect(list).toContain('my own words');
      expect(LabelDetail.commentText({ comment: 'as written', reason: null })).toBe('as written');
      expect(LabelDetail.commentText('bare')).toBe('bare');
    });
  });

  describe('the shared pop-up', () => {
    test('a save landing after the pop-up moved to another card leaves that card\'s pop-up alone', async () => {
      await unvoted();
      click(thumb('disagree'));
      await flush();
      const save = deferred();
      post.mockImplementationOnce(() => save.promise);
      click(chips()[1]);

      // The shared pop-up now asks about some other card's vote.
      const otherHost = document.createElement('div');
      const otherAnchor = document.createElement('button');
      otherHost.appendChild(otherAnchor);
      document.body.appendChild(otherHost);
      reasonPopover().open({ anchor: otherAnchor, host: otherHost, labelType: 'Obstacle', vote: 'Unsure' });

      save.resolve({ ok: true, status: 200, json: async () => ({ username: 'tester', comment_id: 1 }) });
      await flush();

      expect(reasonPopover().isOpenFor(otherHost)).toBe(true);
      expect(popoverEl().classList.contains('reason-popover--saved')).toBe(false);
      expect(popoverEl().querySelector('.reason-popover__saved').textContent).toBe('');
      otherHost.remove();
    });
  });
});
