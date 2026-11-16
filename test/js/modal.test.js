/**
 * Tests for the native-dialog wrapper behind the sign-in dialog (frontend/js/common/Modal.js). What it adds over a
 * bare <dialog> is a backdrop click that closes it without a text-selection drag ever counting as one, focus handed
 * back to whatever opened it, and the show/shown/hidden events its users listen for (#5840).
 */

import { loadModules } from './loader.js';
import { installDialogs, pointerAt, stubRect } from './support/pageChromeHarness.js';
import { flush } from './support/routeFetch.js';

installDialogs();
const { Modal } = await loadModules('frontend/js/common/Modal.js');

// The dialog's content box, in viewport px; anything outside it is backdrop.
const BOX = { left: 100, top: 100, width: 400, height: 300 };

let dialog;
let opener;
let modal;
let events;

beforeEach(() => {
  document.body.innerHTML = `
    <div id="page">
      <button id="opener">Sign in</button>
      <dialog id="dlg"><p id="inside">Welcome back</p><input id="field"></dialog>
    </div>`;
  dialog = document.getElementById('dlg');
  opener = document.getElementById('opener');
  stubRect(dialog, BOX);
  events = [];
  // On the page's own wrapper, not the document, so one test's listeners don't hear the next test's dialog.
  for (const type of ['ps:modal:show', 'ps:modal:shown', 'ps:modal:hidden']) {
    document.getElementById('page').addEventListener(type, () => events.push(type));
  }
  modal = new Modal(dialog);
  opener.focus();
});

/**
 * Presses and releases at two points on the dialog element itself, as a backdrop press reports it.
 * @param {number[]} down - Where the press starts, [x, y].
 * @param {number[]} up - Where it is released, [x, y].
 */
function pressAndRelease(down, up) {
  pointerAt(dialog, 'pointerdown', ...down);
  pointerAt(dialog, 'click', ...up);
}

describe('Modal', () => {
  it('opens modally and announces that it is opening and has opened', () => {
    modal.open();

    expect(dialog.open).toBe(true);
    expect(events).toEqual(['ps:modal:show', 'ps:modal:shown']);
    expect(modal.element).toBe(dialog);
  });

  it('does nothing when asked to open while it is already open', () => {
    modal.open();
    modal.open();

    expect(events).toEqual(['ps:modal:show', 'ps:modal:shown']);
  });

  it('hands focus back to what opened it once it has closed, and says it has closed', async () => {
    modal.open();
    document.getElementById('field').focus();

    modal.close();
    await flush();

    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(opener);
    expect(events).toEqual(['ps:modal:show', 'ps:modal:shown', 'ps:modal:hidden']);
  });

  it('copes with a close that lands after the dialog was reopened and closed again in the meantime', async () => {
    modal.open();
    modal.close();
    modal.open();
    modal.close();

    await flush();

    expect(events.filter((type) => type === 'ps:modal:hidden')).toHaveLength(2);
    expect(document.activeElement).toBe(opener);
  });

  it('ignores a close when it is not open', async () => {
    modal.close();
    await flush();

    expect(events).toEqual([]);
  });

  it.each([
    ['left of', [50, 200]],
    ['right of', [550, 200]],
    ['above', [300, 50]],
    ['below', [300, 450]],
  ])('closes on a press and release on the backdrop %s the dialog', (_where, point) => {
    modal.open();

    pressAndRelease(point, point);

    expect(dialog.open).toBe(false);
  });

  it('stays open for a click on the dialog\'s own padding, which is not backdrop', () => {
    modal.open();

    pressAndRelease([300, 200], [300, 200]);

    expect(dialog.open).toBe(true);
  });

  it('stays open when a text-selection drag starts inside and is released on the backdrop', () => {
    modal.open();

    pressAndRelease([300, 200], [50, 200]);

    expect(dialog.open).toBe(true);
  });

  it('stays open when a press on the backdrop is released on its content', () => {
    modal.open();

    pointerAt(dialog, 'pointerdown', 50, 200);
    pointerAt(document.getElementById('inside'), 'click', 300, 200);

    expect(dialog.open).toBe(true);
  });
});
