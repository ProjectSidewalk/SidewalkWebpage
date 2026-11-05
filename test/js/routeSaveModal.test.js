/**
 * Tests for RouteBuilder's name-your-route dialog (frontend/js/route-builder/SaveModal.js, #5840): saving posts the
 * route once however eagerly it's clicked, a refused save says why and lets the user try again, and an anonymous user
 * who signs in to save gets their route back after the sign-in reload.
 */

import { loadModules, mockModule } from './loader.js';
import { routeFetch, sentRequests, flush } from './support/routeFetch.js';

mockModule('i18next', () => ({ default: { t: (key) => key } }));
const { SaveModal } = await loadModules('frontend/js/route-builder/SaveModal.js');

const STREETS = [{ street_edge_id: 11, reverse: false }, { street_edge_id: 12, reverse: true }];

/**
 * Builds the dialog's markup as routeBuilder.scala.html renders it.
 * @param {boolean} isAnon - Anonymous users also get the "sign in to save" button.
 */
function renderDialog(isAnon) {
  document.body.innerHTML = `
    <div id="save-route-modal-backdrop">
      <button type="button" id="close-save-modal-button"></button>
      <input type="text" id="route-name-input" maxlength="10">
      <textarea id="route-description-input"></textarea>
      <span id="route-name-error" hidden></span>
      ${isAnon ? '<button type="button" id="signin-save-button"></button>' : ''}
      <button type="button" id="confirm-save-button"></button>
      <button type="button" id="cancel-save-button"></button>
    </div>
    <button type="button" id="save-button"></button>`;
}

/**
 * Builds a SaveModal wired the way RouteBuilder wires it, with spies for its callbacks.
 * @param {object} [opts]
 * @param {boolean} [opts.isSignedIn=true]
 * @param {string} [opts.suggestedName='Main St to Oak Ave']
 * @returns {{modal: object, opts: object}} The dialog and the callbacks it was given.
 */
function makeModal({ isSignedIn = true, suggestedName = 'Main St to Oak Ave' } = {}) {
  renderDialog(!isSignedIn);
  const opts = {
    isSignedIn,
    getStreetsPayload: () => STREETS,
    getSuggestedName: () => suggestedName,
    getCamera: () => ({ center: [-122.3, 47.6], zoom: 16 }),
    onSaved: vi.fn(),
    onClose: vi.fn(),
    onSignIn: vi.fn(),
  };
  return { modal: new SaveModal(opts), opts };
}

const $ = (id) => document.getElementById(id);
const click = (id) => $(id).dispatchEvent(new MouseEvent('click', { bubbles: true }));
const key = (el, k, extra = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...extra }));

describe('SaveModal', () => {
  beforeEach(() => {
    window.logWebpageActivity = vi.fn();
    sessionStorage.clear();
    delete window.psAuthModal;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('opening and closing', () => {
    test('opens showing the suggested name, clipped to the field length, and a blank description', () => {
      const { modal } = makeModal({ suggestedName: 'A very long street name' });

      modal.open();

      expect(modal.isOpen()).toBe(true);
      expect($('route-name-input').value).toBe('A very lon');
      expect($('route-description-input').value).toBe('');
      expect(document.activeElement).toBe($('route-name-input'));
      expect(window.logWebpageActivity).toHaveBeenCalledWith('RouteBuilder_Click=OpenSaveModal');
    });

    test('a restored route reopens with the name and description the user typed before signing in', () => {
      const { modal } = makeModal();

      modal.open('My walk', 'Along the water');

      expect($('route-name-input').value).toBe('My walk');
      expect($('route-description-input').value).toBe('Along the water');
    });

    test.each([
      ['the Cancel button', () => click('cancel-save-button')],
      ['the X', () => click('close-save-modal-button')],
      ['Escape', () => key($('route-name-input'), 'Escape')],
    ])('%s closes it without saving and hands focus back', (_name, dismiss) => {
      const stub = routeFetch({});
      const { modal, opts } = makeModal();
      modal.open();

      dismiss();

      expect(modal.isOpen()).toBe(false);
      expect(opts.onClose).toHaveBeenCalledTimes(1);
      expect(stub).not.toHaveBeenCalled();
      expect(window.logWebpageActivity).toHaveBeenCalledWith('RouteBuilder_Click=CloseSaveModal');
    });

    test('other keys inside the dialog leave it open', () => {
      const { modal } = makeModal();
      modal.open();

      key($('route-description-input'), 'a');

      expect(modal.isOpen()).toBe(true);
    });

    test('a full reset hides it without the close callback', () => {
      const { modal, opts } = makeModal();
      modal.open();

      modal.hide();

      expect(modal.isOpen()).toBe(false);
      expect(opts.onClose).not.toHaveBeenCalled();
    });
  });

  describe('saving', () => {
    const SAVED = { route_id: 42, name: 'My walk', slug: 'my-walk', distance_meters: 812 };

    test('posts the streets, trimmed name and description, then hands the saved route on', async () => {
      const stub = routeFetch({ 'POST /saveRoute': SAVED });
      const { modal, opts } = makeModal();
      modal.open();
      $('route-name-input').value = '  My walk ';
      $('route-description-input').value = ' Along the water  ';

      click('confirm-save-button');
      await flush();

      expect(sentRequests(stub)).toEqual([{
        method: 'POST',
        url: '/saveRoute',
        body: { streets: STREETS, name: 'My walk', description: 'Along the water' },
      }]);
      expect(modal.isOpen()).toBe(false);
      expect(opts.onSaved).toHaveBeenCalledWith(SAVED);
      expect(opts.onClose).not.toHaveBeenCalled();
      expect(window.logWebpageActivity).toHaveBeenCalledWith('RouteBuilder_Click=SaveSuccess_RouteId=42');
      expect(window.logWebpageActivity).not.toHaveBeenCalledWith('RouteBuilder_Click=ContinueAsGuest');
    });

    test('Enter in the name field saves, but a held-down Enter does not save again', async () => {
      const stub = routeFetch({ 'POST /saveRoute': SAVED });
      const { modal } = makeModal();
      modal.open();

      key($('route-name-input'), 'Enter', { repeat: true });
      expect(stub).not.toHaveBeenCalled();
      key($('route-name-input'), 'Enter');
      await flush();

      expect(stub).toHaveBeenCalledTimes(1);
    });

    test('a double-click while the first save is in flight posts only once', async () => {
      const stub = routeFetch({ 'POST /saveRoute': SAVED });
      const { modal } = makeModal();
      modal.open();

      click('confirm-save-button');
      expect($('confirm-save-button').disabled).toBe(true);
      click('confirm-save-button');
      await flush();

      expect(stub).toHaveBeenCalledTimes(1);
    });

    test('a guest saving without an account is logged as continuing as a guest', async () => {
      routeFetch({ 'POST /saveRoute': SAVED });
      const { modal } = makeModal({ isSignedIn: false });
      modal.open();

      click('confirm-save-button');
      await flush();

      expect(window.logWebpageActivity).toHaveBeenCalledWith('RouteBuilder_Click=ContinueAsGuest');
    });

    test('a name the server refuses shows its message and lets the user try again', async () => {
      routeFetch({ 'POST /saveRoute': { status: 400, body: { message: 'Pick a different name.' } } });
      const { modal, opts } = makeModal();
      modal.open();

      click('confirm-save-button');
      await flush();

      expect(modal.isOpen()).toBe(true);
      expect($('route-name-error').hidden).toBe(false);
      expect($('route-name-error').textContent).toBe('Pick a different name.');
      expect($('confirm-save-button').disabled).toBe(false);
      expect(opts.onSaved).not.toHaveBeenCalled();
      expect(window.logWebpageActivity).toHaveBeenCalledWith('RouteBuilder_Click=SaveError');
    });

    test('a refusal without a message falls back to the generic error', async () => {
      routeFetch({ 'POST /saveRoute': { status: 500, body: {} } });
      const { modal } = makeModal();
      modal.open();

      click('confirm-save-button');
      await flush();

      expect($('route-name-error').textContent).toBe('save-error');
    });

    test('a network failure shows the generic error and re-enables saving', async () => {
      routeFetch({ 'POST /saveRoute': new TypeError('Failed to fetch') });
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { modal } = makeModal();
      modal.open();

      click('confirm-save-button');
      await flush();

      expect(error).toHaveBeenCalledWith('Error:', expect.any(TypeError));
      expect($('route-name-error').textContent).toBe('save-error');
      expect($('route-name-error').hidden).toBe(false);
      expect($('confirm-save-button').disabled).toBe(false);
      expect(window.logWebpageActivity).toHaveBeenCalledWith('RouteBuilder_Click=SaveError');
    });

    test('reopening after an error clears it', async () => {
      routeFetch({ 'POST /saveRoute': { status: 400, body: { message: 'No.' } } });
      const { modal } = makeModal();
      modal.open();
      click('confirm-save-button');
      await flush();

      modal.close();
      modal.open();

      expect($('route-name-error').hidden).toBe(true);
    });
  });

  describe('signing in to save', () => {
    test('stashes the route and opens the sign-in dialog', () => {
      window.psAuthModal = { open: vi.fn() };
      const { modal, opts } = makeModal({ isSignedIn: false });
      modal.open();
      $('route-name-input').value = ' My walk ';
      $('route-description-input').value = ' Along the water ';

      click('signin-save-button');

      expect(opts.onSignIn).toHaveBeenCalledTimes(1);
      expect(window.psAuthModal.open).toHaveBeenCalledWith('signIn');
      expect(JSON.parse(sessionStorage.getItem(SaveModal.PENDING_ROUTE_KEY))).toEqual({
        name: 'My walk',
        description: 'Along the water',
        streets: STREETS,
        camera: { center: [-122.3, 47.6], zoom: 16 },
      });
      expect(window.logWebpageActivity).toHaveBeenCalledWith('RouteBuilder_Click=SignInToSave');
    });

    test('still opens the sign-in dialog when storage is blocked', () => {
      window.psAuthModal = { open: vi.fn() };
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('blocked');
      });
      const { modal } = makeModal({ isSignedIn: false });
      modal.open();

      click('signin-save-button');

      expect(window.psAuthModal.open).toHaveBeenCalledWith('signIn');
    });

    test('a signed-in user has no sign-in button to wire', () => {
      makeModal({ isSignedIn: true });

      expect($('signin-save-button')).toBeNull();
    });
  });

  describe('consumePendingRoute', () => {
    test('hands back the stashed route once, then nothing', () => {
      const pending = { name: 'My walk', description: '', streets: STREETS, camera: null };
      sessionStorage.setItem(SaveModal.PENDING_ROUTE_KEY, JSON.stringify(pending));

      expect(SaveModal.consumePendingRoute()).toEqual(pending);
      expect(SaveModal.consumePendingRoute()).toBeNull();
    });

    test('ignores a stash with no streets', () => {
      sessionStorage.setItem(SaveModal.PENDING_ROUTE_KEY, JSON.stringify({ name: 'x', streets: [] }));

      expect(SaveModal.consumePendingRoute()).toBeNull();
    });

    test('ignores a corrupted stash', () => {
      sessionStorage.setItem(SaveModal.PENDING_ROUTE_KEY, '{not json');

      expect(SaveModal.consumePendingRoute()).toBeNull();
    });
  });
});
