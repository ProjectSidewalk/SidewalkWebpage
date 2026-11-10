/**
 * Tests for how the label card (frontend/js/common/label-detail/LabelDetail.js) draws a label and wires its controls
 * (#5840): the footer links, the share and story hand-offs, the info chip, the meta strip, the admin block, what the
 * imagery's outcome unlocks, the comment box's keys, what a vote records, and a payload missing its optional fields.
 * Deeper vote, edit, delete and comment flows each have their own suite.
 */

import { useUtil } from './loader.js';
import { collaborators, flush, labelMeta, logged, mountCard, pointerClick } from './support/labelDetailHarness.js';

describe('the label card', () => {
  describe('the ?labelId= deep link', () => {
    test('is set for an open label and removed when the card closes, without adding history', async () => {
      const { LabelDetail } = await mountCard();
      const path = window.location.pathname + window.location.search;
      window.history.replaceState(null, '', '/labelMap?city=seattle');
      onTestFinished(() => window.history.replaceState(null, '', path));
      const before = window.history.length;

      LabelDetail.syncUrlLabelId(42);
      expect(window.location.search).toBe('?city=seattle&labelId=42');
      expect(LabelDetail.urlLabelId()).toBe(42);

      LabelDetail.syncUrlLabelId(null);
      expect(window.location.search).toBe('?city=seattle');
      expect(LabelDetail.urlLabelId()).toBeNull();
      expect(window.history.length).toBe(before);
    });
  });

  describe('opening a label by ID', () => {
    test('an admin card reads the admin endpoint, and draws what it answers', async () => {
      const { detail, panoManager, q } = await mountCard({
        admin: true, routes: { 'GET /adminapi/label/id/42': labelMeta({ admin_data: { previous_validations: [] } }) },
      });
      const meta = await detail.showLabel(42, 'LabelMap');

      expect(meta.label_id).toBe(42);
      expect(panoManager.warmUp).toHaveBeenCalled();
      expect(q('.label-detail__admin-task').textContent).toBe('900');
    });

    test('a label the server can\'t find is reported and rejects', async () => {
      const { detail } = await mountCard({ routes: { 'GET /label/id/7': { status: 404, body: {} } } });
      const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});

      await expect(detail.showLabel(7, 'LabelMap')).rejects.toThrow('HTTP error 404');
      expect(alert).toHaveBeenCalledOnce();
    });
  });

  describe('the footer', () => {
    test('links to the label on the LabelMap when the host asks, and logs the hop', async () => {
      const { show, q } = await mountCard({ options: { showLabelMapLink: true } });
      await show();
      const link = q('.label-detail__labelmap-link');

      expect(link.hidden).toBe(false);
      expect(link.getAttribute('href')).toBe('/labelMap?labelId=42');
      link.addEventListener('click', (e) => e.preventDefault());
      pointerClick(link);
      expect(logged()).toContain('Click_module=LabelDetail_action=ViewOnLabelMap_labelId=42');
    });

    test('leaves the LabelMap link hidden on a host that is the LabelMap', async () => {
      const { show, q } = await mountCard();
      await show();
      expect(q('.label-detail__labelmap-link').hidden).toBe(true);
    });

    describe('Explore here (#4637)', () => {
      const exploreLink = async (overrides) => {
        const { show, q } = await mountCard({ options: { showExploreHereLink: true } });
        await show(overrides);
        return q('.label-detail__explore-link');
      };
      const params = (link) => Object.fromEntries(new URL(link.href, 'http://localhost').searchParams);

      test('drops in at the label\'s pano, facing it, with the address for a place name', async () => {
        const link = await exploreLink({ zoom: 1.6, pano_data: { address: '1 Main St' } });

        expect(link.hidden).toBe(false);
        expect(params(link)).toEqual({
          lat: '47.61', lng: '-122.33', heading: '250.5', pitch: '-12', zoom: '2', panoId: 'pano-1',
          placeName: '1 Main St',
        });
      });

      test('seeds from the coordinates alone when the pano is known to be gone', async () => {
        const link = await exploreLink({ expired: true });
        expect(params(link)).not.toHaveProperty('panoId');
        expect(params(link)).toMatchObject({ lat: '47.61', heading: '250.5' });
      });

      test('leaves the point of view out when part of it is missing', async () => {
        const link = await exploreLink({ zoom: null });
        expect(params(link)).toEqual({ lat: '47.61', lng: '-122.33', panoId: 'pano-1' });
      });

      test('is hidden for a label with no coordinates to seed from', async () => {
        expect((await exploreLink({ lat: null })).hidden).toBe(true);
      });

      test('is hidden on a phone, which /explore bounces', async () => {
        useUtil({ isMobile: () => true });
        expect((await exploreLink()).hidden).toBe(true);
      });

      test('logs the hop', async () => {
        const link = await exploreLink();
        link.addEventListener('click', (e) => e.preventDefault());
        pointerClick(link);
        expect(logged()).toContain('Click_module=LabelDetail_action=ExploreHere_labelId=42');
      });
    });

    test('points the share widget at the label\'s public page', async () => {
      const { show, q } = await mountCard();
      await show();

      expect(collaborators.share.trigger).toBe(q('.label-detail__share-trigger'));
      expect(collaborators.share.targets).toEqual([{
        url: `${window.location.origin}/label/42`, title: 'common:share.text', text: 'common:share.text',
      }]);
    });
  });

  describe('stories (#4054)', () => {
    test('get the label and its type\'s name, except for the types a story can\'t be "about"', async () => {
      const { show } = await mountCard({ options: { highlightStoryId: 5 } });
      expect(collaborators.story.opts).toEqual({ currUsername: 'tester', highlightStoryId: 5 });

      await show({ label_id: 1, label_type: 'Obstacle' });
      await show({ label_id: 2, label_type: 'Other' });
      await show({ label_id: 3, label_type: 'Occlusion' });
      expect(collaborators.story.labels).toEqual([[1, expect.any(String)], [2, null], [3, null]]);
      expect(collaborators.story.labels[0][1]).not.toBe('');
    });
  });

  describe('the Hide-label toggle (#2477)', () => {
    test('hides the marker, and logs only the changes a click made', async () => {
      const { show, panoManager } = await mountCard();
      await show();

      collaborators.toggle.onChange(false, { viaClick: true });
      expect(panoManager.setLabelsHidden).toHaveBeenLastCalledWith(true);
      collaborators.toggle.onChange(true, { viaClick: false });
      expect(panoManager.setLabelsHidden).toHaveBeenLastCalledWith(false);
      const clicks = logged().filter((e) => e.startsWith('Click_'));
      expect(clicks).toEqual(['Click_module=LabelDetail_action=HideLabel_labelId=42']);
    });

    test('logs a click that brings the marker back', async () => {
      const { show } = await mountCard();
      await show();
      collaborators.toggle.onChange(true, { viaClick: true });
      expect(logged()).toContain('Click_module=LabelDetail_action=ShowLabel_labelId=42');
    });
  });

  describe('the Details chip and its popover', () => {
    test('describes the label on screen, and nothing before one is', async () => {
      const { show, panoManager } = await mountCard();
      const [
        , viewer, latLng, panoId, streetId, regionId, captureDate, address, pov,, onOpen, onCopy, onView, label,
      ] = collaborators.infoPopover;
      const labelId = label.id;

      expect([latLng(), panoId(), streetId(), regionId(), captureDate(), pov(), labelId()]).toEqual(
        [null, null, null, null, null, null, null]);
      expect(address()).toBeNull();

      await show();
      expect(viewer()).toBe(panoManager.panoViewer);
      expect(latLng()).toEqual({ lat: 47.615, lng: -122.335 });
      expect([panoId(), streetId(), regionId(), labelId()]).toEqual(['pano-1', 7, 3, 42]);
      expect(captureDate()).toBeInstanceOf(Date);
      expect(pov()).toEqual({ heading: 250.5, pitch: -12, zoom: 2 });

      panoManager.panoViewer.currPanoData = { getProperty: (key) => (key === 'address' ? '9 Pine St' : null) };
      expect(address()).toBe('9 Pine St');

      onOpen();
      onCopy();
      onView();
      label.linkLogging(42);
      expect(logged().filter((e) => e.startsWith('Click_'))).toEqual([
        'Click_module=LabelDetail_action=PanoInfoButton_labelId=42',
        'Click_module=LabelDetail_action=PanoInfoCopyToClipboard_labelId=42',
        'Click_module=LabelDetail_action=PanoInfoViewInPano_labelId=42',
        'Click_module=LabelDetail_action=PanoInfoLabelLink_labelId=42',
      ]);
    });

    test('opens from anywhere on the chip, through the popover\'s own trigger', async () => {
      const { q } = await mountCard();
      const icon = q('.label-detail__info-button-host img');
      const iconClicks = vi.fn();
      icon.addEventListener('click', iconClicks);
      const outside = vi.fn();
      document.addEventListener('click', outside);
      onTestFinished(() => document.removeEventListener('click', outside));

      expect(icon.alt).toBe('');
      pointerClick(q('.label-detail__meta-cell--details > span'));
      expect(iconClicks).toHaveBeenCalledOnce();
      // The chip's own click stops short of the popover's light-dismiss, or it would close what it just opened.
      expect(outside).toHaveBeenCalledOnce();

      // A click on the icon itself is the popover's already, and isn't forwarded a second time.
      pointerClick(icon);
      expect(iconClicks).toHaveBeenCalledTimes(2);
    });
  });

  describe('the meta strip', () => {
    /** Mounts with a ResizeObserver whose callback the test runs, since jsdom has none and lays nothing out. */
    async function mountWithObserver() {
      let onResize;
      const observe = vi.fn();
      vi.stubGlobal('ResizeObserver', class {
        constructor(cb) { onResize = cb; }
        observe(el) { observe(el); }
      });
      const mounted = await mountCard();
      return { ...mounted, observe, resize: () => onResize() };
    }

    const widths = (el, scrollWidth, clientWidth) => Object.defineProperties(el, {
      scrollWidth: { configurable: true, get: scrollWidth }, clientWidth: { configurable: true, value: clientWidth },
    });

    test('re-fits when the card is resized, giving up the clock time and then the Details word', async () => {
      const { q, observe, resize, show } = await mountWithObserver();
      const row = q('.label-detail__meta-row');
      expect(observe).toHaveBeenCalledWith(row);
      await show({ pano_data: { address: '1 Main St' } });

      // The address clips until the time goes; then the row fits.
      const address = q('.label-detail__address');
      widths(address, () => (row.classList.contains('label-detail__meta-row--no-time') ? 100 : 180), 100);
      widths(row, () => 300, 300);
      resize();
      expect([...row.classList]).toEqual(['label-detail__meta-row', 'label-detail__meta-row--no-time']);

      // Still too wide with both gone: the row wraps.
      widths(address, () => 100, 100);
      widths(row, () => 400, 300);
      resize();
      expect(row.classList.contains('label-detail__meta-row--compact-details')).toBe(true);
      expect(row.classList.contains('label-detail__meta-row--wrap')).toBe(true);

      widths(row, () => 300, 300);
      resize();
      expect([...row.classList]).toEqual(['label-detail__meta-row']);
    });

    test('a label\'s stored address shows as plain text until live imagery confirms it', async () => {
      const { show, q } = await mountCard();
      await show({ pano_data: { address: '1 Main St' } }, null);
      const address = q('.label-detail__address');

      expect(q('.label-detail__meta-cell--address').hidden).toBe(false);
      expect(q('.label-detail__meta-divider--address').hidden).toBe(false);
      expect(address.textContent).toBe('1 Main St');
      expect(address.hasAttribute('href')).toBe(false);
      expect(address.title).toBe('1 Main St');
    });

    test('live imagery of this label upgrades the address and links it to the provider\'s viewer', async () => {
      const { show, q, panoManager } = await mountCard();
      panoManager.panoViewer.currPanoData = {
        getPanoId: () => 'pano-1', getProperty: (key) => (key === 'address' ? '3 Live Ave' : null),
      };
      await show({ pano_data: { address: '1 Main St' } });
      const address = q('.label-detail__address');

      expect(address.textContent).toBe('3 Live Ave common:opens-new-tab');
      expect(address.querySelector('.sr-only').textContent).toBe(' common:opens-new-tab');
      expect(address.getAttribute('href')).toBe('https://maps.example/pano-1');
      expect(address.target).toBe('_blank');
      expect(address.rel).toBe('noopener noreferrer');
      expect(address.title).toBe('3 Live Ave — common:view-in-gsv');
      expect(panoManager.panoViewer.publicViewerLink).toHaveBeenCalledWith('pano-1', { heading: 250.5, pitch: -12 });
    });

    test('a provider with no public viewer leaves the live address unlinked', async () => {
      const { show, q, panoManager } = await mountCard();
      panoManager.panoViewer.publicViewerLink.mockReturnValue(null);
      panoManager.panoViewer.currPanoData = { getPanoId: () => 'pano-1', getProperty: () => '3 Live Ave' };
      await show();

      expect(q('.label-detail__address').textContent).toBe('3 Live Ave');
      expect(q('.label-detail__address').hasAttribute('href')).toBe(false);
    });

    test('the static crop never borrows the address of the pano the viewer showed last', async () => {
      const { show, q, panoManager } = await mountCard();
      panoManager.activeViewerName = 'Fallback';
      panoManager.panoViewer.currPanoData = { getPanoId: () => 'pano-1', getProperty: () => '3 Live Ave' };
      await show({ backup_image: { address: '2 Crop Rd' } });

      expect(q('.label-detail__address').textContent).toBe('2 Crop Rd');
      expect(q('.label-detail__address').hasAttribute('href')).toBe(false);
    });

    test('a label with no address anywhere hides the cell', async () => {
      const { show, q } = await mountCard();
      await show({ pano_data: { address: '1 Main St' } });
      await show({ label_id: 43 });
      expect(q('.label-detail__meta-cell--address').hidden).toBe(true);
      expect(q('.label-detail__meta-divider--address').hidden).toBe(true);
    });
  });

  describe('when the imagery settles', () => {
    test('a pipeline that breaks outright lands on "no imagery" instead of staying locked', async () => {
      const { show, panoManager, card, q } = await mountCard();
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      await show({}, null);
      expect(q('.label-detail__comment-input').disabled).toBe(true);

      panoManager.rejectPano(new Error('viewer exploded'));
      await flush();
      expect(error).toHaveBeenCalledWith(expect.stringContaining('setPano failed'), expect.any(Error));
      expect(q('.label-detail__hide-label').hidden).toBe(true);
      expect(card.classList.contains('label-detail--readonly')).toBe(true);
      expect(q('.label-detail__vote-display').dataset.psTooltip).toBe('labelmap:no-imagery-disabled');
    });

    test('a label paged away from ignores its imagery settling, either way', async () => {
      const { detail, panoManager, q } = await mountCard();
      const firstTwo = [];
      panoManager.setPano.mockImplementation(
        () => new Promise((resolve, reject) => firstTwo.push({ resolve, reject })));
      await detail.showLabel(labelMeta({ label_id: 1 }), 'TestSource');
      await detail.showLabel(labelMeta({ label_id: 2 }), 'TestSource');
      await detail.showLabel(labelMeta({ label_id: 3 }), 'TestSource');
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});

      firstTwo[0].reject(new Error('late'));
      firstTwo[1].resolve(false);
      await flush();
      expect(error).not.toHaveBeenCalled();
      expect(q('.label-detail__hide-label').hidden).toBe(false);

      // Label 3's own outcome is still the one that counts.
      firstTwo[2].resolve(true);
      await flush();
      expect(q('.label-detail__comment-input').disabled).toBe(false);
    });

    describe('the "drag to look around" hint', () => {
      beforeEach(() => sessionStorage.clear());

      test('shows over the first imagery of the session, and only that once', async () => {
        const { show } = await mountCard();
        await show();
        await show({ label_id: 43 });

        expect(collaborators.toast).toHaveBeenCalledOnce();
        expect(collaborators.toast.mock.calls[0][0]).toMatchObject({ message: 'common:drag-to-look-around', top: 14 });
      });

      test('is skipped when there is no imagery, or the label is deleted', async () => {
        const { show } = await mountCard();
        await show({}, false);
        await show({ deleted: true });
        expect(collaborators.toast).not.toHaveBeenCalled();
      });

      test('is skipped, not thrown, when the browser blocks storage', async () => {
        const { show, q } = await mountCard();
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
        await show();
        expect(q('.label-detail__vote--agree').disabled).toBe(false);
        expect(collaborators.toast).not.toHaveBeenCalled();
      });
    });
  });

  describe('the title', () => {
    test('names the type in both trigger slots', async () => {
      const { show, q } = await mountCard();
      await show({ label_type: 'CurbRamp' });
      const names = [...q('.label-detail__title').querySelectorAll('.label-type-trigger__name')];
      expect(names).toHaveLength(2);
      expect(new Set(names.map((n) => n.textContent)).size).toBe(1);
      expect(names[0].textContent).not.toBe('');
    });
  });

  describe('the vote icons', () => {
    const icon = (q, vote) => q(`.label-detail__vote--${vote} .label-detail__vote-icon`).getAttribute('src');
    const hover = (el, type) => el.dispatchEvent(new MouseEvent(type));

    test('preview what a click would do, and go back when the pointer leaves', async () => {
      const { show, q } = await mountCard();
      await show({ user_validation: 'Agree', num_agree: 2 });
      const agree = q('.label-detail__vote--agree');
      const disagree = q('.label-detail__vote--disagree');

      expect(icon(q, 'agree')).toMatch(/agree-filled\.svg/);
      hover(agree, 'mouseenter'); // Previews clearing the vote.
      expect(icon(q, 'agree')).toMatch(/agree-outline\.svg/);
      hover(agree, 'mouseleave');
      expect(icon(q, 'agree')).toMatch(/agree-filled\.svg/);

      hover(disagree, 'mouseenter');
      expect(icon(q, 'disagree')).toMatch(/disagree-filled\.svg/);
      hover(disagree, 'mouseleave');
      expect(icon(q, 'disagree')).toMatch(/disagree-outline\.svg/);
    });

    test('hold still while the card is locked', async () => {
      const { show, q } = await mountCard();
      await show({}, null);
      hover(q('.label-detail__vote--unsure'), 'mouseenter');
      expect(icon(q, 'unsure')).toMatch(/unsure-outline\.svg/);
      q('.label-detail__vote--unsure').querySelector('img').src = 'changed.svg';
      hover(q('.label-detail__vote--unsure'), 'mouseleave');
      expect(icon(q, 'unsure')).toBe('changed.svg');
    });

    test('mark the option the AI voted for, and its tooltip says so', async () => {
      const { show, q } = await mountCard();
      await show({ ai_validation: 'Agree' });
      expect(icon(q, 'agree')).toMatch(/agree-outline-ai\.svg/);
      expect(q('.label-detail__vote--agree').dataset.psTooltip).toContain('labelmap:vote-tooltip-ai-included');
      expect(q('.label-detail__vote--disagree').dataset.psTooltip).not.toContain('ai-included');
    });

    test('an overlay button drops its just-voted look once the pointer leaves it', async () => {
      const { show, q } = await mountCard();
      await show();
      const overlay = q('.label-detail__pano-overlay-button--agree');
      overlay.classList.add('is-just-voted');
      hover(overlay, 'mouseleave');
      expect(overlay.classList.contains('is-just-voted')).toBe(false);
    });
  });

  describe('the comment box\'s keys', () => {
    const key = (el, type, init) => {
      const e = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
      el.dispatchEvent(e);
      return e;
    };

    /**
     * Shows a label the reader voted Disagree on, so the comment box is open.
     * @param {Record<string, any>} [routes] - Extra routes on top of a comment save that succeeds.
     * @returns {Promise<object>} The mounted card plus its comment `input`.
     */
    async function openBox(routes = {}) {
      const mounted = await mountCard({ routes: { 'POST /labelmap/comment': { username: 'tester' }, ...routes } });
      await mounted.show({ user_validation: 'Disagree', num_disagree: 1 });
      return { ...mounted, input: mounted.q('.label-detail__comment-input') };
    }

    test('the submit button lights up only once there is something to send', async () => {
      const { input, q } = await openBox();
      input.value = '   ';
      input.dispatchEvent(new Event('input'));
      expect(q('.label-detail__comment-submit').classList.contains('is-active')).toBe(false);
      input.value = 'a curb';
      input.dispatchEvent(new Event('input'));
      expect(q('.label-detail__comment-submit').classList.contains('is-active')).toBe(true);
    });

    test('Enter sends the comment, but not the Enter that confirms an IME composition', async () => {
      const { input, fetch } = await openBox();
      const posts = () => fetch.mock.calls.filter(([url]) => url === '/labelmap/comment');
      input.value = 'これは縁石';

      key(input, 'keydown', { key: 'Enter', isComposing: true });
      key(input, 'keydown', { key: 'Enter', keyCode: 229 });
      expect(posts()).toHaveLength(0);

      const enter = key(input, 'keydown', { key: 'Enter' });
      await flush();
      expect(enter.defaultPrevented).toBe(true);
      expect(posts()).toHaveLength(1);
      expect(JSON.parse(posts()[0][1].body).comment).toBe('これは縁石');
    });

    test('neither Enter nor the button sends a blank comment, or one while the card is locked', async () => {
      const { input, fetch, q, show } = await openBox();
      input.value = '   ';
      key(input, 'keydown', { key: 'Enter' });
      q('.label-detail__comment-submit').click();

      await show({ label_id: 43, user_validation: 'Disagree' }, null);
      input.value = 'too soon';
      key(input, 'keydown', { key: 'Enter' });
      q('.label-detail__comment-submit').click();
      await flush();
      expect(fetch.mock.calls.filter(([url]) => url === '/labelmap/comment')).toHaveLength(0);
    });

    test('Escape outside an edit only blurs the box, on keyup, and goes no further', async () => {
      const { input } = await openBox();
      input.focus();
      const onWindow = vi.fn();
      window.addEventListener('keyup', onWindow);
      onTestFinished(() => window.removeEventListener('keyup', onWindow));

      const down = key(input, 'keydown', { key: 'Escape' });
      expect(down.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(input);
      key(input, 'keyup', { key: 'Escape' });
      expect(document.activeElement).not.toBe(input);
      expect(onWindow).not.toHaveBeenCalled();
    });

    test('other keys type as usual', async () => {
      const { input } = await openBox();
      input.focus();
      expect(key(input, 'keydown', { key: 'a' }).defaultPrevented).toBe(false);
      key(input, 'keyup', { key: 'a' });
      expect(document.activeElement).toBe(input);
    });
  });

  describe('on an admin card', () => {
    const adminMeta = (overrides) => ({
      username: 'labeler one', admin_data: { previous_validations: [] }, ...overrides,
    });

    test('names the labeler and the task, with the validators so far', async () => {
      const { show, q } = await mountCard({ admin: true });
      await show(adminMeta({
        admin_data: {
          previous_validations: [
            { username: 'val a', validation: 'Agree' }, { username: 'val/b', validation: 'NotSure' },
          ],
        },
      }));

      const user = q('.label-detail__admin-username a');
      expect(user.textContent).toBe('labeler one');
      expect(user.getAttribute('href')).toBe('/admin/user/labeler%20one');
      expect(q('.label-detail__admin-task').textContent).toBe('900');
      const prev = q('.label-detail__admin-prev-validations');
      expect([...prev.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(
        ['/admin/user/val%20a', '/admin/user/val/b']);
      expect(prev.querySelectorAll('br')).toHaveLength(1);
      expect(prev.textContent).toBe('val a: common:agreeval/b: common:not-sure');
    });

    test('says "None" before anyone has validated', async () => {
      const { show, q } = await mountCard({ admin: true });
      await show(adminMeta());
      expect(q('.label-detail__admin-prev-validations').textContent).toBe('common:none');
    });

    test('the flag buttons show the task\'s flags and toggle them on the server', async () => {
      const put = vi.fn(() => ({}));
      const { show, q, routes } = await mountCard({ admin: true, routes: { 'PUT /adminapi/setTaskFlag': put } });
      await show(adminMeta({ low_quality: true, incomplete: false, stale: null }));
      const flag = (name) => q(`.label-detail__flag-button[data-flag="${name}"]`);
      expect([flag('low_quality'), flag('incomplete'), flag('stale')].map((b) => b.classList.contains('is-active')))
        .toEqual([true, false, false]);

      flag('stale').click();
      await flush();
      expect(JSON.parse(put.mock.calls[0][1].body)).toEqual({ audit_task_id: 900, flag: 'stale', state: true });
      expect(flag('stale').classList.contains('is-active')).toBe(true);

      flag('low_quality').click();
      await flush();
      expect(JSON.parse(put.mock.calls[1][1].body)).toMatchObject({ flag: 'low_quality', state: false });
      expect(flag('low_quality').classList.contains('is-active')).toBe(false);

      // A refused change leaves the button as it was.
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      routes['PUT /adminapi/setTaskFlag'] = { status: 500, body: {} };
      flag('incomplete').click();
      await flush();
      expect(flag('incomplete').classList.contains('is-active')).toBe(false);
      expect(error).toHaveBeenCalled();
    });

    test('a comment saved here is listed under the admin\'s username', async () => {
      const { show, q } = await mountCard({ admin: true, routes: { 'POST /labelmap/comment': { username: 'admin a' } } });
      await show(adminMeta({ user_validation: 'Disagree' }));
      q('.label-detail__comment-input').value = 'checked on site';
      q('.label-detail__comment-submit').click();
      await flush();

      const [own] = q('.label-detail__validator-comments').querySelectorAll('p');
      expect(own.querySelector('a').getAttribute('href')).toBe('/admin/user/admin%20a');
      expect(own.textContent).toContain('checked on site');
    });

    test('comments carry the commenter\'s username, linked, with the time and their vote', async () => {
      const { show, q } = await mountCard({ admin: true });
      await show(adminMeta({
        comments: [
          { username: 'val a', comment: 'old', time_created: '2026-08-20T10:00:00Z', validation: 'Disagree' },
          { username: 'val b', comment: 'no time', validation: 'Unsure' },
          { username: 'val c', comment: 'bare' },
        ],
      }));
      const [bare, noTime, timed] = [...q('.label-detail__validator-comments').querySelectorAll('p')];

      expect(timed.querySelector('a').getAttribute('href')).toBe('/admin/user/val%20a');
      expect(timed.querySelector('.label-detail__comment-when')).not.toBeNull();
      expect(timed.querySelector('.label-detail__comment-vote--disagree')).not.toBeNull();
      expect(timed.textContent.trim()).toMatch(/: old$/);

      expect(noTime.querySelector('.label-detail__comment-when')).toBeNull();
      expect(noTime.querySelector('.label-detail__comment-vote--unsure')).not.toBeNull();
      expect(noTime.textContent.trim()).toMatch(/^val b .*: no time$/);

      expect(bare.textContent.trim()).toBe('val c: bare');
    });
  });
  describe('a payload missing its optional fields', () => {
    test('draws no description, capture date or comments rather than "null"', async () => {
      const { show, q } = await mountCard();
      await show({ description: null, image_capture_date: null, comments: undefined });

      expect(q('.label-detail__description').textContent).toBe('');
      expect(q('.label-detail__image-capture-date').textContent).toBe('');
      expect(q('.label-detail__validator-comments').textContent).toBe('labelmap:no-comments-yet');
    });

    test('reads missing vote counts as none', async () => {
      const { show, q } = await mountCard();
      await show({ num_agree: undefined, num_disagree: undefined, num_unsure: undefined, user_validation: 'Agree' });

      const counts = [...q('.label-detail__vote-display').querySelectorAll('.label-detail__vote-count')];
      expect(counts.map((c) => c.textContent)).toEqual(['0', '0', '0']);
      expect(q('.label-detail__vote--agree').dataset.psTooltip).toMatch(/^labelmap:vote-tooltip-voted-agree/);
    });

    test('saves an edit to a label sent with no tags as one with none', async () => {
      const edits = [];
      const { show, q } = await mountCard({
        routes: {
          'POST /label/edit': (url, opts) => {
            edits.push(JSON.parse(opts.body));
            return { label_type: 'Obstacle', severity: 3 };
          },
        },
      });
      await show({ can_edit: true, from_current_user: true, tags: undefined, severity: null });
      q('.label-detail__tags-edit').click();
      await flush();
      q('.label-detail__tags-edit').click();
      q('.severity-button[data-severity="3"]').click();
      await flush();

      // The tag pick changed nothing, so only the rating went to the server; its reply named no tags at all.
      expect(edits).toEqual([expect.objectContaining({ severity: 3, tags: [] })]);
      expect(q('.label-detail__tags').textContent).toBe('common:none');
    });
  });

  describe('what a vote records', () => {
    /**
     * Mounts a card whose votes all land, and shows a label on it.
     * @param {object} [overrides] - Fields on the label.
     * @param {object} [options] - LabelDetail options.
     * @returns {Promise<object>} The mounted card, plus `votes()`: the validation bodies posted so far.
     */
    async function votable(overrides = {}, options = {}) {
      const mounted = await mountCard({ routes: { 'POST /labelmap/validate': {} }, options });
      mounted.meta = await mounted.show(overrides);
      mounted.votes = () => mounted.fetch.mock.calls.filter(([url]) => url === '/labelmap/validate')
        .map(([, opts]) => JSON.parse(opts.body));
      return mounted;
    }

    test('over the crop, the view recorded is the label\'s own, not whatever the idle viewer reports', async () => {
      const { q, panoManager, votes } = await votable();
      panoManager.activeViewerName = 'StaticCrop';
      panoManager.getPov = () => ({ heading: 10, pitch: 0, zoom: 1 });
      q('.label-detail__pano-overlay-button--agree').click();
      await flush();

      expect(votes()[0]).toMatchObject({
        heading: 250.5, pitch: -12, zoom: 2, viewer_type: 'StaticCrop',
      });
    });

    test('a reader turned away from the label records no spot on screen for it', async () => {
      const { q, panoManager, votes } = await votable();
      panoManager.getPov = () => ({ heading: 70.5, pitch: -12, zoom: 2 });
      q('.label-detail__pano-overlay-button--agree').click();
      await flush();

      expect(votes()[0]).toMatchObject({ canvas_x: null, canvas_y: null, heading: 70.5 });
    });

    test('a label with no rating or tags is voted on as one with none', async () => {
      const { q, votes } = await votable({ severity: null, tags: undefined });
      q('.label-detail__pano-overlay-button--agree').click();
      await flush();

      expect(votes()[0]).toMatchObject({ severity: null, tags: [] });
    });

    test('the host hears of each vote that lands, with the label it was on', async () => {
      const onVote = vi.fn();
      const { q } = await votable({}, { onVote });
      q('.label-detail__pano-overlay-button--agree').click();
      await flush();

      expect(onVote).toHaveBeenCalledWith('Agree', expect.objectContaining({ label_id: 42, user_validation: 'Agree' }));
    });
  });

  describe('the host\'s comment hook', () => {
    test('hears of a saved comment, with the label\'s list as it now stands', async () => {
      const onComments = vi.fn();
      const { show, q } = await mountCard({
        routes: { 'POST /labelmap/comment': { username: 'tester' } }, options: { onComments },
      });
      await show({ user_validation: 'Disagree' });
      q('.label-detail__comment-input').value = 'a pole';
      q('.label-detail__comment-submit').click();
      await flush();

      expect(onComments).toHaveBeenCalledWith(expect.objectContaining({
        label_id: 42, comments: [expect.objectContaining({ comment: 'a pole', mine: true })],
      }));
    });

    test('a comment of theirs with no recorded avatar keeps the first one when replaced', async () => {
      const { show, q } = await mountCard({ routes: { 'POST /labelmap/comment': { username: 'tester' } } });
      await show({ comments: [{ comment: 'old', mine: true }] });
      q('.label-detail__comment-edit').click();
      q('.label-detail__comment-input').value = 'new';
      q('.label-detail__comment-submit').click();
      await flush();

      const [own] = q('.label-detail__validator-comments').querySelectorAll('p');
      expect(own.querySelector('.label-detail__comment-avatar--0')).not.toBeNull();
      // No vote on record (the payload predates the column), so the comment carries no vote chip.
      expect(own.querySelector('[class*="label-detail__comment-vote--"]')).toBeNull();
    });
  });

  describe('a host closing the card', () => {
    test('with no tag pick open saves nothing', async () => {
      const { show, detail, fetch } = await mountCard();
      await show({ can_edit: true, from_current_user: true });
      detail.saveOpenEdits();
      await flush();
      expect(fetch.mock.calls.filter(([url]) => url === '/label/edit')).toEqual([]);
    });
  });

  describe('a redraw of the label on screen', () => {
    test('drops a tag pick in progress rather than saving it', async () => {
      const { show, q, fetch } = await mountCard({
        routes: { 'GET /label/tags': [{ label_type: 'Obstacle', tag: 'cone', tag_id: 2 }] },
      });
      const meta = await show({ can_edit: true, from_current_user: true });
      q('.label-detail__tags-edit').click();
      await flush();
      q('.label-detail__tags .tag-pill:not(.tag-pill--active)').click();

      await show({ ...meta });
      await flush();
      expect(q('.label-detail__tags-edit').getAttribute('aria-expanded')).toBe('false');
      expect(fetch.mock.calls.filter(([url]) => url === '/label/edit')).toEqual([]);
    });
  });
});
