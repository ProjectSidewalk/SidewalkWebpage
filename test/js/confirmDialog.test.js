/**
 * Tests for the in-app replacement for window.confirm() (frontend/js/common/ConfirmDialog.js). Admin pages, the
 * dashboard, the label card and Route Builder all ask through it before something lossy, so what matters is that
 * every way out resolves the caller's promise exactly once, that a stray Enter lands on the button that changes
 * nothing, and that the dialog is named for screen readers by whatever heading it has (#5840).
 */

import { loadModules } from './loader.js';
import { installDialogs } from './support/pageChromeHarness.js';
import { flush, textOf } from './support/routeFetch.js';

installDialogs();

let ConfirmDialog;

beforeEach(async () => {
  document.body.innerHTML = '';
  // A fresh class per test: the shared dialog and the pending prompt are static.
  ({ ConfirmDialog } = await loadModules('frontend/js/common/ConfirmDialog.js'));
});

const dialog = () => document.querySelector('dialog.ps-confirm');
const buttons = () => [...dialog().querySelectorAll('.ps-confirm__actions button')];
/** @returns {HTMLButtonElement} The action button whose text is `text`. */
const button = (text) => buttons().find((b) => textOf(b) === text);

/** @returns {Promise<boolean>} A delete confirmation, as the admin pages ask it. */
const askDelete = (extra = {}) => ConfirmDialog.confirm({
  message: 'Delete this team?', confirmText: 'Delete', cancelText: 'Keep', ...extra,
});

describe('ConfirmDialog.confirm', () => {
  it('resolves true when the user confirms, and closes', async () => {
    const answer = askDelete();
    expect(dialog().open).toBe(true);
    expect(textOf(dialog().querySelector('.ps-confirm__message'))).toBe('Delete this team?');

    button('Delete').click();

    await expect(answer).resolves.toBe(true);
    expect(dialog().open).toBe(false);
  });

  it('resolves false when the user picks the cancel button', async () => {
    const answer = askDelete();

    button('Keep').click();

    await expect(answer).resolves.toBe(false);
  });

  it('resolves false on Esc or a backdrop click, which close the dialog without a button', async () => {
    const answer = askDelete();

    dialog().close();
    await flush();

    await expect(answer).resolves.toBe(false);
  });

  it('puts focus on the cancel button, so a stray Enter cannot delete anything', () => {
    askDelete({ danger: true });

    expect(document.activeElement).toBe(button('Keep'));
  });

  it('tints a destructive confirm button and a plain one differently', () => {
    askDelete({ danger: true });
    expect(button('Delete').classList.contains('ps-confirm__btn--danger')).toBe(true);

    askDelete();
    expect(button('Delete').classList.contains('ps-confirm__btn--danger')).toBe(false);
    expect(button('Delete').classList.contains('button--primary')).toBe(true);
    expect(button('Keep').classList.contains('button--secondary')).toBe(true);
  });

  it('shows a decorative icon before the confirm text when given one', () => {
    askDelete({ confirmIconSrc: '/assets/images/icons/trash.svg' });

    const icon = button('Delete').querySelector('img.ps-confirm__btn-icon');
    expect(icon.getAttribute('src')).toBe('/assets/images/icons/trash.svg');
    expect(icon.alt).toBe('');
    expect(button('Keep').querySelector('img')).toBeNull();
  });

  it('is named by its heading and described by the question when it has a title', () => {
    askDelete({ title: 'Delete team', warning: true });

    const header = dialog().querySelector('.ps-confirm__header');
    expect(header.hidden).toBe(false);
    expect(textOf(dialog().querySelector('.ps-confirm__title'))).toBe('Delete team');
    expect(dialog().querySelector('.ps-confirm__warning-icon').hidden).toBe(false);
    expect(dialog().getAttribute('aria-labelledby')).toBe('ps-confirm-title');
    expect(dialog().getAttribute('aria-describedby')).toBe('ps-confirm-message');
  });

  it('is named by the question alone when it has no title, even after one that had a title', async () => {
    const first = askDelete({ title: 'Delete team', warning: true });
    button('Keep').click();
    await first;

    askDelete();

    expect(dialog().querySelector('.ps-confirm__header').hidden).toBe(true);
    expect(dialog().querySelector('.ps-confirm__warning-icon').hidden).toBe(true);
    expect(textOf(dialog().querySelector('.ps-confirm__title'))).toBe('');
    expect(dialog().getAttribute('aria-labelledby')).toBe('ps-confirm-message');
    expect(dialog().hasAttribute('aria-describedby')).toBe(false);
  });

  it('builds one dialog and reuses it for every prompt', async () => {
    const first = askDelete();
    button('Keep').click();
    await first;
    askDelete();

    expect(document.querySelectorAll('dialog.ps-confirm')).toHaveLength(1);
  });
});

describe('ConfirmDialog.choose', () => {
  const SAVE_CHOICES = [
    { id: 'discard', text: 'Discard', style: 'danger' },
    { id: 'stay', text: 'Keep editing' },
    { id: 'save', text: 'Save', style: 'primary' },
  ];

  it('resolves with the id of the button picked', async () => {
    const answer = ConfirmDialog.choose({ message: 'Unsaved changes', buttons: SAVE_CHOICES });

    button('Save').click();

    await expect(answer).resolves.toBe('save');
  });

  it('resolves with null on a dismissal unless the caller names another value', async () => {
    const plain = ConfirmDialog.choose({ message: 'Unsaved changes', buttons: SAVE_CHOICES });
    dialog().close();
    await flush();
    await expect(plain).resolves.toBeNull();

    const named = ConfirmDialog.choose({ message: 'Unsaved changes', buttons: SAVE_CHOICES, dismissValue: 'stay' });
    dialog().close();
    await flush();
    await expect(named).resolves.toBe('stay');
  });

  it('focuses the first button that changes nothing, wherever it sits', () => {
    ConfirmDialog.choose({ message: 'Unsaved changes', buttons: SAVE_CHOICES });

    expect(document.activeElement).toBe(button('Keep editing'));
  });

  it('focuses the button the caller names', () => {
    ConfirmDialog.choose({ message: 'Unsaved changes', buttons: SAVE_CHOICES, focusId: 'save' });

    expect(document.activeElement).toBe(button('Save'));
  });

  it('focuses the first button when every choice does something', () => {
    ConfirmDialog.choose({
      message: 'Which way?',
      buttons: [{ id: 'left', text: 'Left', style: 'primary' }, { id: 'right', text: 'Right', style: 'primary' }],
    });

    expect(document.activeElement).toBe(button('Left'));
  });

  it('settles a prompt still open as a dismissal when another one replaces it, so its caller never hangs', async () => {
    const first = ConfirmDialog.choose({ message: 'First?', buttons: SAVE_CHOICES, dismissValue: 'stay' });
    const second = ConfirmDialog.choose({ message: 'Second?', buttons: SAVE_CHOICES });

    await expect(first).resolves.toBe('stay');
    expect(dialog().open).toBe(true);
    expect(textOf(dialog().querySelector('.ps-confirm__message'))).toBe('Second?');

    button('Save').click();
    await expect(second).resolves.toBe('save');
  });

  it('leaves a prompt opened right after an answer alone when the first close lands late', async () => {
    const first = ConfirmDialog.choose({ message: 'First?', buttons: SAVE_CHOICES });
    button('Save').click();
    await expect(first).resolves.toBe('save');
    // Opened in the same tick as the answer, before the browser's queued close event for the first prompt fires.
    const second = ConfirmDialog.choose({ message: 'Second?', buttons: SAVE_CHOICES, dismissValue: 'stay' });
    const settled = vi.fn();
    second.then(settled);

    await flush();

    expect(settled).not.toHaveBeenCalled();
    expect(dialog().open).toBe(true);
  });

  it('answers only once, however many times a button is clicked', async () => {
    const answer = ConfirmDialog.choose({ message: 'Unsaved changes', buttons: SAVE_CHOICES });
    const save = button('Save');

    save.click();
    save.click();
    button('Discard').click();

    await expect(answer).resolves.toBe('save');
  });
});
