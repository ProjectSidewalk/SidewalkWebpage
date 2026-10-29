/**
 * Tests for the label card (frontend/js/common/label-detail/LabelDetail.js) when a request fails, or answers after
 * the reader has paged to another label (#5840). Paging is never blocked while a save is in flight, so every reply
 * has to check that its label is still the one on screen before it draws anything.
 */

import { deferred } from './labelDetailReasonFixture.js';
import { flush, labelMeta, logged, mountCard } from './support/labelDetailHarness.js';


describe('the label card, when a reply goes wrong or comes late', () => {
  let error;

  beforeEach(() => {
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  // The failures here are logged on purpose, but a crash in the card's own code must still fail the test.
  afterEach(() => {
    const crashes = error.mock.calls.flat().filter((arg) => arg instanceof TypeError || arg instanceof ReferenceError);
    expect(crashes).toEqual([]);
  });

  describe('a vote', () => {
    const count = (q, vote) => q(`.label-detail__vote--${vote} .label-detail__vote-count`).textContent;

    test('that fails gives the controls back and changes nothing', async () => {
      const { show, q } = await mountCard({ routes: { 'POST /labelmap/validate': { status: 500, body: {} } } });
      await show();
      q('.label-detail__pano-overlay-button--agree').click();
      expect(q('.label-detail__vote--agree').disabled).toBe(true);
      await flush();

      expect(error).toHaveBeenCalledWith(new Error('HTTP 500'));
      expect(q('.label-detail__vote--agree').disabled).toBe(false);
      expect(count(q, 'agree')).toBe('1');
      expect(q('.label-detail__vote--agree').getAttribute('aria-pressed')).toBe('false');
    });

    test('that lands after paging leaves the new label\'s counts and the host alone', async () => {
      const vote = deferred();
      const onVote = vi.fn();
      const { show, q } = await mountCard({
        routes: { 'POST /labelmap/validate': () => vote.promise }, options: { onVote },
      });
      await show();
      q('.label-detail__pano-overlay-button--agree').click();
      await show({ label_id: 43, num_agree: 5 });

      vote.resolve({ status: 200, body: {} });
      await flush();
      expect(count(q, 'agree')).toBe('5');
      expect(q('.label-detail__vote--agree').getAttribute('aria-pressed')).toBe('false');
      expect(onVote).not.toHaveBeenCalled();
      expect(q('.label-detail__vote--agree').disabled).toBe(false);
    });

    test('refused for a type change after paging doesn\'t redraw the new label', async () => {
      const vote = deferred();
      const { show, q } = await mountCard({ routes: { 'POST /labelmap/validate': () => vote.promise } });
      await show();
      q('.label-detail__pano-overlay-button--agree').click();
      await show({ label_id: 43 });

      // No route for GET /label/id/42: a redraw would fail the test.
      vote.resolve({ status: 409, body: {} });
      await flush();
      expect(error).not.toHaveBeenCalled();
    });
  });

  describe('a comment', () => {
    test('refused for a type change after paging doesn\'t redraw the new label', async () => {
      const save = deferred();
      const { show, q } = await mountCard({ routes: { 'POST /labelmap/comment': () => save.promise } });
      await show({ user_validation: 'Disagree' });
      q('.label-detail__comment-input').value = 'a pole';
      q('.label-detail__comment-submit').click();
      await show({ label_id: 43, user_validation: 'Disagree' });

      save.resolve({ status: 409, body: {} });
      await flush();
      expect(q('.label-detail__comment-input').value).toBe('');
      expect(q('.label-detail__comment-submit').disabled).toBe(false);
    });

    test('saved after paging is kept server-side, but the new label\'s list is left alone', async () => {
      const save = deferred();
      const onComments = vi.fn();
      const { show, q } = await mountCard({
        routes: { 'POST /labelmap/comment': () => save.promise }, options: { onComments },
      });
      await show({ user_validation: 'Disagree' });
      q('.label-detail__comment-input').value = 'a pole';
      q('.label-detail__comment-submit').click();
      await show({ label_id: 43, user_validation: 'Disagree' });

      save.resolve({ username: 'tester' });
      await flush();
      expect(q('.label-detail__validator-comments').textContent).toBe('labelmap:no-comments-yet');
      expect(onComments).not.toHaveBeenCalled();
      expect(q('.label-detail__comment-confirmation').hidden).toBe(true);
    });

    test('that fails after paging says nothing on the new label', async () => {
      const save = deferred();
      const { show, q } = await mountCard({ routes: { 'POST /labelmap/comment': () => save.promise } });
      await show({ user_validation: 'Disagree' });
      q('.label-detail__comment-input').value = 'a pole';
      q('.label-detail__comment-submit').click();
      await show({ label_id: 43, user_validation: 'Disagree' });

      save.resolve({ status: 500, body: {} });
      await flush();
      expect(q('.label-detail__comment-confirmation').hidden).toBe(true);
    });

    test('a bare-string comment from an older payload draws as text, and a new one takes the next avatar', async () => {
      const { show, q } = await mountCard({ routes: { 'POST /labelmap/comment': { username: 'tester' } } });
      await show({
        user_validation: 'Disagree',
        comments: ['an old note', { comment: 'theirs', mine: false, commenter: 3, validation: 'Agree' }],
      });
      const list = () => [...q('.label-detail__validator-comments').querySelectorAll('p')];
      expect(list().map((p) => p.textContent.trim())).toEqual([expect.stringMatching(/theirs$/), 'an old note']);
      expect(list()[1].querySelector('.label-detail__comment-avatar--0')).not.toBeNull();

      q('.label-detail__comment-input').value = 'mine';
      q('.label-detail__comment-submit').click();
      await flush();
      expect(list()[0].querySelector('.label-detail__comment-avatar--4')).not.toBeNull();
      expect(list()[0].querySelector('.label-detail__comment-you')).not.toBeNull();
    });

    test('Cancel with no edit open does nothing', async () => {
      const { show, q } = await mountCard();
      await show({ user_validation: 'Disagree' });
      q('.label-detail__comment-input').value = 'draft';
      q('.label-detail__comment-cancel').click();
      expect(q('.label-detail__comment-input').value).toBe('draft');
    });
  });

  describe('a delete or restore (#3591)', () => {
    const editable = { can_edit: true, from_current_user: true, tags: ['pole'] };

    test('a delete that fails after paging says nothing on the new label', async () => {
      const del = deferred();
      const { show, q } = await mountCard({ routes: { 'DELETE /label/42': () => del.promise } });
      await show(editable);
      q('.label-detail__delete').click();
      await flush();
      await show({ ...editable, label_id: 43 });

      del.resolve({ status: 500, body: {} });
      await flush();
      expect(q('.label-detail__edit-status--type').textContent).toBe('');
    });

    test('a delete closes a tag pick in progress and puts the label\'s tags back', async () => {
      const { show, q } = await mountCard({
        routes: {
          'GET /label/tags': [{ label_type: 'Obstacle', tag: 'pole', tag_id: 1 }],
          'DELETE /label/42': { deleted: true, can_restore: true },
        },
      });
      await show(editable);
      q('.label-detail__tags-edit').click();
      await flush();
      expect(q('.label-detail__tags-edit').getAttribute('aria-expanded')).toBe('true');

      q('.label-detail__delete').click();
      await flush();
      await flush();
      expect(q('.label-detail__tags-edit').getAttribute('aria-expanded')).toBe('false');
      expect(q('.label-detail__tags .tag-pill__label').textContent).toBe('common:tag.pole');
    });

    test('a restore that fails says so beside the title, with the reason', async () => {
      const { show, q } = await mountCard({ routes: { 'POST /label/42/restore': { status: 500, body: {} } } });
      await show({ ...editable, deleted: true, can_restore: true });
      q('.label-detail__restore').click();
      await flush();

      const status = q('.label-detail__edit-status--type');
      expect(status.classList.contains('label-detail__edit-status--error')).toBe(true);
      expect(status.dataset.psTooltip).toBe('labelmap:restore-label-failed');
      expect(q('.label-detail__restore').hidden).toBe(false);
    });

    test('a restore that lands after paging tells the host but leaves the new label as it is', async () => {
      const restore = deferred();
      const onDelete = vi.fn();
      const { show, q } = await mountCard({
        routes: { 'POST /label/42/restore': () => restore.promise }, options: { onDelete },
      });
      const first = await show({ ...editable, deleted: true, can_restore: true });
      q('.label-detail__restore').click();
      await show({ ...editable, label_id: 43, deleted: true, can_restore: true });

      restore.resolve({});
      await flush();
      expect(onDelete).toHaveBeenCalledWith(first);
      expect(first.deleted).toBe(false);
      expect(q('.label-detail__restore').hidden).toBe(false);
    });

    test('a restore that fails after paging says nothing on the new label', async () => {
      const restore = deferred();
      const { show, q } = await mountCard({ routes: { 'POST /label/42/restore': () => restore.promise } });
      await show({ ...editable, deleted: true, can_restore: true });
      q('.label-detail__restore').click();
      await show({ ...editable, label_id: 43 });

      restore.resolve({ status: 500, body: {} });
      await flush();
      expect(q('.label-detail__edit-status--type').textContent).toBe('');
    });
  });

  describe('an edit (#2575, #3671)', () => {
    const editable = { can_edit: true, from_current_user: true, tags: ['pole'] };
    const chip = (q, type) => q(`.label-type-popover__chips [data-label-type="${type}"]`);
    const typeButton = (q) => q('.label-type-trigger__button');

    test('the tag list failing to load abandons the pick and says the edit failed', async () => {
      const { show, q } = await mountCard({ routes: { 'GET /label/tags': { status: 500, body: [] } } });
      await show(editable);
      q('.label-detail__tags-edit').click();
      await flush();

      expect(error).toHaveBeenCalledWith(expect.stringContaining('tag list'), expect.any(Error));
      expect(q('.label-detail__tags-edit').getAttribute('aria-expanded')).toBe('false');
      expect(q('.label-detail__tags .tag-pill__label').textContent).toBe('common:tag.pole');
      const tagsStatus = q('.label-detail__col--tags .label-detail__edit-status');
      expect(tagsStatus.classList.contains('label-detail__edit-status--error')).toBe(true);
    });

    test('a failed save after paging rolls back its label quietly, for the saves queued behind it', async () => {
      const save = deferred();
      const { show, q } = await mountCard({ routes: { 'POST /label/edit': () => save.promise } });
      const first = await show(editable);
      q('.severity-button[data-severity="3"]').click();
      await flush();
      expect(first.severity).toBe(3);
      await show({ ...editable, label_id: 43 });

      save.resolve({ status: 500, body: {} });
      await flush();
      expect(first.severity).toBe(2);
      expect(q('.label-detail__col--severity .label-detail__edit-status').textContent).toBe('');
    });

    test('a save that lands after paging is logged and kept on its label, but not drawn or passed on', async () => {
      const save = deferred();
      const onEdit = vi.fn();
      const { show, q } = await mountCard({ routes: { 'POST /label/edit': () => save.promise }, options: { onEdit } });
      const first = await show(editable);
      q('.severity-button[data-severity="3"]').click();
      await flush();
      await show({ ...editable, label_id: 43, tags: [] });

      save.resolve({ label_type: 'Obstacle', severity: 3, tags: [] });
      await flush();
      expect(first).toMatchObject({ severity: 3, tags: [] });
      expect(logged()).toContain('Click_module=LabelDetail_action=EditSeverity_old=2_new=3_labelId=42');
      expect(onEdit).not.toHaveBeenCalled();
      expect(q('.label-detail__col--severity .label-detail__edit-status').textContent).toBe('');
    });

    test('a type change that lands after paging skips the vote re-read and leaves the new label alone', async () => {
      const save = deferred();
      const onEdit = vi.fn();
      const { show, q } = await mountCard({ routes: { 'POST /label/edit': () => save.promise }, options: { onEdit } });
      await show({ ...editable, from_current_user: false });
      typeButton(q).click();
      chip(q, 'Signal').click();
      await show({ ...editable, label_id: 43, from_current_user: false });

      save.resolve({ label_type: 'Signal', severity: null, tags: [] });
      await flush();
      expect(logged()).toContain('Click_module=LabelDetail_action=EditLabelType_old=Obstacle_new=Signal_labelId=42');
      expect(onEdit).not.toHaveBeenCalled();
      expect(q('.label-detail__title').textContent).not.toContain('Signal');
      expect(q('.label-detail__vote--agree').disabled).toBe(false);
    });

    test('a type change queued before paging leaves the new label\'s tag pick open', async () => {
      const first = deferred();
      let edits = 0;
      const { show, q } = await mountCard({
        routes: {
          'GET /label/tags': [{ label_type: 'Obstacle', tag: 'pole', tag_id: 1 }],
          'POST /label/edit': () => {
            edits += 1;
            return edits === 1 ? first.promise : { label_type: 'Signal', severity: null, tags: [] };
          },
        },
      });
      await show(editable);
      q('.severity-button[data-severity="3"]').click();
      typeButton(q).click();
      chip(q, 'Signal').click();
      await show({ ...editable, label_id: 43 });
      q('.label-detail__tags-edit').click();
      await flush();
      const picks = () => q('.label-detail__tags').querySelectorAll('.tag-pill--interactive').length;
      expect(picks()).toBe(1);

      first.resolve({ label_type: 'Obstacle', severity: 3, tags: ['pole'] });
      await flush();
      await flush();
      expect(edits).toBe(2);
      expect(picks()).toBe(1);
    });

    test('the type picker won\'t open while the label\'s imagery is still loading', async () => {
      const { show, q } = await mountCard();
      await show(editable, null);
      typeButton(q).click();
      expect(logged()).not.toContain('Click_module=LabelDetail_action=EditLabelTypeOpen_labelId=42');
    });

    test('a type change abandons a tag pick made for the old type', async () => {
      const { show, q } = await mountCard({
        routes: {
          'GET /label/tags': [{ label_type: 'Obstacle', tag: 'pole', tag_id: 1 }],
          'POST /label/edit': { label_type: 'Signal', severity: null, tags: [] },
          'GET /label/id/42': labelMeta({ label_type: 'Signal' }),
        },
      });
      await show(editable);
      q('.label-detail__tags-edit').click();
      await flush();
      typeButton(q).click();
      chip(q, 'Signal').click();
      await flush();
      await flush();

      expect(q('.label-detail__tags-edit').getAttribute('aria-expanded')).toBe('false');
      expect(q('.label-detail__tags').textContent).toBe('common:none');
    });

    describe('the vote re-read after a type change', () => {
      /**
       * Shows someone else's label 42 and changes its type to Signal.
       * @param {any} refresh - How the vote re-read answers.
       * @returns {Promise<object>} The mounted card and the label's metadata.
       */
      async function changeType(refresh) {
        const mounted = await mountCard({
          routes: {
            'POST /label/edit': { label_type: 'Signal', severity: null, tags: ['pole'] },
            'GET /label/id/42': refresh,
          },
          options: { onEdit: vi.fn() },
        });
        // An admin's edit of someone else's label, so the vote controls aren't off for an own label anyway.
        const meta = await mounted.show({ ...editable, from_current_user: false, num_agree: 4 });
        typeButton(mounted.q).click();
        chip(mounted.q, 'Signal').click();
        return { ...mounted, meta };
      }

      test('a refused re-read leaves the counts as they were', async () => {
        const { q, meta } = await changeType({ status: 500, body: {} });
        await flush();
        await flush();
        expect(meta.num_agree).toBe(4);
        expect(q('.label-detail__vote--agree .label-detail__vote-count').textContent).toBe('4');
      });

      test('a re-read that fails outright is logged, and the vote controls come back', async () => {
        const { q } = await changeType(new Error('offline'));
        await flush();
        await flush();
        expect(error).toHaveBeenCalledWith('Could not refresh the vote counts:', expect.any(Error));
        expect(q('.label-detail__vote--agree').disabled).toBe(false);
      });

      test('a re-read that lands after paging leaves the new label alone', async () => {
        const refresh = deferred();
        const { show, q, meta } = await changeType(() => refresh.promise);
        await flush();
        await show({ ...editable, label_id: 43, num_agree: 9 });

        refresh.resolve(labelMeta({ label_type: 'Signal', num_agree: 0 }));
        await flush();
        expect(meta.num_agree).toBe(4);
        expect(q('.label-detail__vote--agree .label-detail__vote-count').textContent).toBe('9');
      });
    });
  });
});
