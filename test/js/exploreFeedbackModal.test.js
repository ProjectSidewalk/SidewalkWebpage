/**
 * Explore's feedback dialog (frontend/js/explore/modal/FeedbackModal.js) (#5840): what opens and closes it, when its
 * OK button is live, what a sent comment carries about where the labeler is, and the thank-you that follows.
 */

import { loadModules, mockModule } from './loader.js';
import { fakeGate, fakePanoManager, fakeTaskContainer, fakeTracker } from './fakes.js';
import { routeFetch, flush, sentRequests } from './support/routeFetch.js';

mockModule('i18next', () => ({ default: { t: (key) => key } }));

const toastShow = vi.fn();
mockModule('frontend/js/common/Toast.js', () => ({ Toast: { show: toastShow } }));

const el = (id) => document.getElementById(id);

describe('FeedbackModal', () => {
  let modal;
  let lock;
  let tracker;
  let onMoveStarted;

  beforeEach(async () => {
    document.body.innerHTML = `
      <div id="pano"></div>
      <button type="button" id="explore-control-feedback"></button>
      <div id="modal-comment-holder" class="ps-hidden">
        <div id="modal-comment-background"></div>
        <div id="modal-comment-title"></div>
        <textarea id="modal-comment-textarea"></textarea>
        <button type="button" id="modal-comment-cancel-button"></button>
        <button type="button" id="modal-comment-ok-button"></button>
      </div>`;
    lock = fakeGate();
    tracker = fakeTracker();
    const viewer = {
      getPanoId: () => 'pano-9',
      getPosition: () => ({ lat: 47.6, lng: -122.3 }),
      getPov: () => ({ heading: 90, pitch: -5, zoom: 2 }),
    };
    const task = { getStreetEdgeId: () => 31, getAuditTaskId: () => 404 };
    const { FeedbackModal } = await loadModules('frontend/js/explore/modal/FeedbackModal.js');
    modal = new FeedbackModal(lock, { getCurrentMission: () => ({ getProperty: () => 10 }) },
      fakeTaskContainer(() => task), fakePanoManager(viewer),
      { onMoveStarted: (listener) => { onMoveStarted = listener; } }, tracker);
  });

  const open = () => el('explore-control-feedback').click();
  const type = (text) => {
    el('modal-comment-textarea').value = text;
    el('modal-comment-textarea').dispatchEvent(new Event('input'));
  };

  it('starts hidden with its title set and nothing to send', () => {
    expect(modal).toBeTruthy();
    expect(el('modal-comment-title').textContent).toBe('audit:controls.feedback-title');
    expect(el('modal-comment-holder').classList.contains('ps-hidden')).toBe(true);
    expect(el('modal-comment-ok-button').disabled).toBe(true);
  });

  it('opens empty from the feedback button and stops the tool behind it', () => {
    el('modal-comment-textarea').value = 'left over';
    open();

    expect(el('modal-comment-holder').classList.contains('ps-hidden')).toBe(false);
    expect(el('modal-comment-background').style.visibility).toBe('visible');
    expect(el('modal-comment-textarea').value).toBe('');
    expect(el('modal-comment-ok-button').disabled).toBe(true);
    expect(lock.hold).toHaveBeenCalledWith('feedback');
    expect(tracker.push).toHaveBeenCalledWith('ModalComment_ClickFeedback');
  });

  it('lets the comment go only once something is typed', () => {
    open();
    type('a');
    expect(el('modal-comment-ok-button').disabled).toBe(false);
    type('');
    expect(el('modal-comment-ok-button').disabled).toBe(true);
  });

  it('sends the comment with where the labeler is, closes, and thanks them', async () => {
    const fetchStub = routeFetch({ 'POST /explore/comment': {} });
    open();
    type('The curb ramp is hidden by a bus.');

    el('modal-comment-ok-button').click();
    await flush();

    expect(sentRequests(fetchStub)).toEqual([{
      method: 'POST',
      url: '/explore/comment',
      body: {
        comment: 'The curb ramp is hidden by a bus.',
        pano_id: 'pano-9', heading: 90, lat: 47.6, lng: -122.3, pitch: -5, zoom: 2,
        street_edge_id: 31, audit_task_id: 404, mission_id: 10,
      },
    }]);
    expect(el('modal-comment-holder').classList.contains('ps-hidden')).toBe(true);
    expect(lock.release).toHaveBeenCalledWith('feedback');
    expect(tracker.push).toHaveBeenCalledWith('ModalComment_ClickOK');
    expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({
      message: 'audit:controls.feedback-submitted', reference: el('pano'),
    }));
  });

  it('reports a refused comment instead of thanking the labeler', async () => {
    routeFetch({ 'POST /explore/comment': { status: 500 } });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    open();
    type('x');

    el('modal-comment-ok-button').click();
    await flush();

    expect(toastShow).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('500') }));
  });

  it('closes on cancel without sending', () => {
    const fetchStub = routeFetch({});
    open();
    type('never mind');

    el('modal-comment-cancel-button').click();

    expect(fetchStub).not.toHaveBeenCalled();
    expect(el('modal-comment-holder').classList.contains('ps-hidden')).toBe(true);
    expect(el('modal-comment-background').style.visibility).toBe('hidden');
    expect(lock.release).toHaveBeenCalledWith('feedback');
    expect(tracker.push).toHaveBeenCalledWith('ModalComment_ClickCancel');
  });

  it('closes when the labeler moves on', () => {
    open();
    onMoveStarted();
    expect(el('modal-comment-holder').classList.contains('ps-hidden')).toBe(true);
    expect(lock.release).toHaveBeenCalledWith('feedback');
  });
});
