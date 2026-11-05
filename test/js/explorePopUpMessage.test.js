/**
 * Explore's blocking pop-up (frontend/js/explore/alert/PopUpMessage.js, #5840) and the AI street guidance it shows
 * in the pilot city (alert/AiGuidance.js): what a notification puts on screen and holds, the two ways to dismiss it,
 * the picture variant's scaling, the sign-in prompt an anonymous labeler gets after walking far enough, and the log
 * row each button leaves behind.
 */

import { loadModules, mockModule } from './loader.js';
import { fakeGate, fakeTaskContainer, fakeTracker } from './fakes.js';
import { routeFetch, sentRequests, flush } from './support/routeFetch.js';

mockModule('i18next', () => ({ default: { t: (key) => key } }));

const PAGE = `
  <div id="pano"></div>
  <div id="pop-up-message-holder" class="ps-hidden">
    <div id="pop-up-message-foreground">
      <h2 id="pop-up-message-title">Title</h2>
      <p id="pop-up-message-content">Content</p>
      <div id="pop-up-message-img-holder"></div>
      <div id="pop-up-message-button-holder"></div>
    </div>
  </div>`;

const holder = () => document.getElementById('pop-up-message-holder');
const byId = (id) => document.getElementById(id);
const showing = () => holder().classList.contains('visible') && !holder().classList.contains('ps-hidden');
const pressEnter = () => document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter' }));

describe('PopUpMessage', () => {
  let PopUpMessage;
  let lock;
  let tracker;
  let taskEnded;
  let completedKm;
  let task;

  /**
   * @param {object} [config] - Explore config members; the labeler is registered unless said otherwise.
   * @returns {PopUpMessage} The pop-up, listening to a task container the test drives.
   */
  function popUp(config = {}) {
    task = { getAuditTaskId: () => 42, getStreetEdgeId: () => 7 };
    const taskContainer = fakeTaskContainer(() => task, {
      onTaskEnded: (fn) => { taskEnded = fn; },
      getCompletedTaskDistance: () => completedKm,
    });
    return new PopUpMessage({ userRole: 'Registered', ...config }, lock, taskContainer, tracker);
  }

  beforeEach(async () => {
    document.body.innerHTML = PAGE;
    lock = fakeGate();
    tracker = fakeTracker();
    completedKm = 0;
    ({ PopUpMessage } = await loadModules('frontend/js/explore/alert/PopUpMessage.js'));
  });

  it('shows a title and body over the whole page, holding the tool still until OK is clicked', () => {
    const popup = popUp();
    const done = vi.fn();

    expect(popup.notify('<b>Hello</b>', 'Look around.', done)).toBe(true);

    expect(showing()).toBe(true);
    expect(byId('pop-up-message-title').innerHTML).toBe('<b>Hello</b>');
    expect(byId('pop-up-message-content').textContent).toBe('Look around.');
    expect(holder().style.width).toBe('100%');
    expect(lock.hold).toHaveBeenCalledWith('popup');
    expect(done).not.toHaveBeenCalled();

    byId('pop-up-message-ok-button').click();

    expect(showing()).toBe(false);
    expect(holder().style.width).toBe('');
    expect(lock.release).toHaveBeenCalledWith('popup');
    expect(done).toHaveBeenCalledTimes(1);
    expect(tracker.push).toHaveBeenCalledWith('PopUpMessage_ClickOk');
    expect(byId('pop-up-message-ok-button')).toBeNull();
  });

  it('refuses a second notification while one is up, and takes it after the first is dismissed', () => {
    const popup = popUp();
    const trace = vi.spyOn(console, 'trace').mockImplementation(() => {});
    popup.notify('One', 'first');

    expect(popup.notify('Two', 'second')).toBe(false);
    expect(trace).toHaveBeenCalled();
    expect(byId('pop-up-message-title').textContent).toBe('One');

    byId('pop-up-message-ok-button').click();
    expect(popup.notify('Two', 'second')).toBe(true);
    expect(byId('pop-up-message-title').textContent).toBe('Two');
  });

  it('takes Enter as OK, logged as the shortcut, and only while an OK button is showing', () => {
    const popup = popUp();
    const done = vi.fn();
    pressEnter();
    expect(tracker.push).not.toHaveBeenCalled();

    popup.notify('Hi', 'there', done);
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'a' }));
    expect(showing()).toBe(true);

    pressEnter();
    expect(showing()).toBe(false);
    expect(done).toHaveBeenCalledTimes(1);
    expect(tracker.push.mock.calls.map(([name]) => name)).toEqual(['KeyboardShortcut_ClickOk', 'PopUpMessage_ClickOk']);

    pressEnter();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('works without a callback to run after OK', () => {
    const popup = popUp();
    popup.notify('Hi', 'there');
    pressEnter();
    expect(showing()).toBe(false);

    popup.notify('Hi', 'again');
    byId('pop-up-message-ok-button').click();
    expect(showing()).toBe(false);
  });

  it('sizes a picture to the displayed pano, and takes it down with the pop-up', () => {
    // The pano is shown at twice its logical 720px width, so the authored sizes double.
    const layer = document.createElement('div');
    layer.id = 'label-drawing-layer';
    layer.getBoundingClientRect = () => new DOMRect(0, 0, 1440, 960);
    document.body.appendChild(layer);
    const popup = popUp();
    const done = vi.fn();

    expect(popup.notifyWithImage('Both sides', 'Check both.', '/assets/look.gif', '450px', '291px', '50px', done))
      .toBe(true);
    expect(popup.notifyWithImage('Again', 'no', '/assets/look.gif', '1px', '1px', '1px')).toBe(false);

    const img = byId('pop-up-message-image');
    expect(img.getAttribute('src')).toBe('/assets/look.gif');
    expect(img.style.width).toBe('900px');
    expect(img.style.height).toBe('582px');
    expect(img.style.left).toBe('100px');
    expect(byId('pop-up-message-foreground').classList).toContain('has-image');

    byId('pop-up-message-ok-button').click();
    expect(byId('pop-up-message-image')).toBeNull();
    expect(byId('pop-up-message-foreground').classList).not.toContain('has-image');
    expect(done).toHaveBeenCalled();
  });

  describe('the sign-in prompt', () => {
    beforeEach(() => {
      window.psAuthModal = { open: vi.fn() };
    });

    afterEach(() => {
      delete window.psAuthModal;
    });

    it('asks an anonymous labeler once they have finished more than 150 m of street, and only once', () => {
      const popup = popUp({ userRole: 'Anonymous' });

      completedKm = 0.1;
      taskEnded();
      expect(showing()).toBe(false);

      completedKm = 0.2;
      taskEnded();
      expect(showing()).toBe(true);
      expect(popup.haveAskedToSignIn()).toBe(true);
      expect(byId('pop-up-message-title').textContent).toBe('popup.signup-title');
      expect([...byId('pop-up-message-button-holder').children].map((b) => b.id)).toEqual([
        'pop-up-message-sign-up-button', 'pop-up-message-sign-in-button', 'pop-up-message-cancel-button',
      ]);

      byId('pop-up-message-cancel-button').click();
      expect(showing()).toBe(false);
      expect(tracker.push).toHaveBeenCalledWith('PopUpMessage_SignUpClickNo', {
        auditTaskId: 42,
        auditStreetEdgeId: 7,
      });

      completedKm = 1;
      taskEnded();
      expect(showing()).toBe(false);
    });

    it('never asks a labeler who is signed in', () => {
      popUp({ userRole: 'Registered' });
      completedKm = 5;
      taskEnded();
      expect(showing()).toBe(false);
    });

    it('opens the sign-up or sign-in dialog from its buttons, logging which', () => {
      popUp().promptSignIn();
      byId('pop-up-message-sign-up-button').click();
      expect(window.psAuthModal.open).toHaveBeenCalledWith('signUp');
      expect(tracker.push).toHaveBeenCalledWith('PopUpMessage_SignUpClickYes', {
        auditTaskId: 42,
        auditStreetEdgeId: 7,
      });
      expect(showing()).toBe(false);

      popUp().promptSignIn();
      byId('pop-up-message-sign-in-button').click();
      expect(window.psAuthModal.open).toHaveBeenCalledWith('signIn');
      expect(tracker.push).toHaveBeenCalledWith('PopUpMessage_SignInClick', { auditTaskId: 42, auditStreetEdgeId: 7 });
    });

    it('still closes when the page has no auth dialog to open', () => {
      delete window.psAuthModal;
      popUp().promptSignIn();

      expect(() => byId('pop-up-message-sign-up-button').click()).not.toThrow();
      expect(showing()).toBe(false);
    });
  });
});

describe('AiGuidance', () => {
  let AiGuidance;
  let popUpMessage;
  let tracker;
  let taskChanged;

  /**
   * @param {object} [config] - Explore config members.
   * @returns {AiGuidance} Guidance over a task container the test drives.
   */
  function guidance(config = {}) {
    const task = { getProperty: (key) => ({ wayType: 'residential', streetEdgeId: 7 })[key] };
    const taskContainer = fakeTaskContainer(() => task, { onCurrentTaskChanged: (fn) => { taskChanged = fn; } });
    return new AiGuidance({ isExploreAddressMode: false, ...config }, taskContainer, popUpMessage, tracker);
  }

  beforeEach(async () => {
    document.body.innerHTML = '<span id="mission-guidance-status"></span>';
    popUpMessage = { notify: vi.fn() };
    tracker = fakeTracker();
    taskChanged = null;
    window.cityId = 'chandigarh-india';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    ({ AiGuidance } = await loadModules('frontend/js/explore/alert/AiGuidance.js'));
  });

  it('follows street changes, except in free exploration where streets change every move', () => {
    guidance();
    expect(taskChanged).toEqual(expect.any(Function));

    taskChanged = null;
    guidance({ isExploreAddressMode: true });
    expect(taskChanged).toBeNull();
  });

  it('asks the server about the street and shows its answer, escaped, with a copy under the minimap', async () => {
    const fetch = routeFetch({ 'POST /ai/analyzeScene': { success: true, response: 'Look <left> first' } });
    guidance();

    taskChanged();
    await flush();

    expect(sentRequests(fetch)).toEqual([
      { method: 'POST', url: '/ai/analyzeScene', body: { way_type: 'residential', street_edge_id: 7 } },
    ]);
    const [title, body, onOk] = popUpMessage.notify.mock.calls[0];
    expect(title).toBe('Mission Guidance');
    expect(body).toContain('Look &lt;left&gt; first');
    onOk();
    expect(tracker.push).toHaveBeenCalledWith('PopUpShow_AiGuidance', { message: 'Look <left> first' });
    const status = document.getElementById('mission-guidance-status');
    expect(status.textContent).toBe('Look <left> first');
    expect(status.title).toBe('Look <left> first');
  });

  it('still shows the pop-up on a page without the line under the minimap', async () => {
    routeFetch({ 'POST /ai/analyzeScene': { success: true, response: 'Look' } });
    document.getElementById('mission-guidance-status').remove();
    guidance().showAiGuidanceMessage();
    await flush();

    expect(popUpMessage.notify).toHaveBeenCalled();
  });

  it('logs a failed analysis instead of showing one', async () => {
    routeFetch({ 'POST /ai/analyzeScene': { success: false, error: 'quota' } });
    guidance().showAiGuidanceMessage();
    await flush();

    expect(popUpMessage.notify).not.toHaveBeenCalled();
    expect(tracker.push).toHaveBeenCalledWith('PopUpShow_AiGuidance_Error', { error: 'quota' });
  });

  it('logs a request that never got through', async () => {
    routeFetch({ 'POST /ai/analyzeScene': new Error('offline') });
    guidance().showAiGuidanceMessage();
    await flush();

    expect(tracker.push).toHaveBeenCalledWith('PopUpShow_AiGuidance_Error', { error: 'offline' });
  });

  it('does nothing outside the pilot city', async () => {
    window.cityId = 'seattle-wa';
    const fetch = routeFetch({});
    guidance().showAiGuidanceMessage();
    await flush();

    expect(fetch).not.toHaveBeenCalled();
    expect(popUpMessage.notify).not.toHaveBeenCalled();
  });
});
