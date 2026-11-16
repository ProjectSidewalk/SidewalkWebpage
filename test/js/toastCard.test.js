/**
 * Tests for what a toast shows and how it goes away (frontend/js/common/Toast.js); its queueing and placement have
 * suites of their own. A toast is on a clock, so what is pinned here is who can stop that clock: focus always does,
 * so a keyboard user can reach the action button before it fades (WCAG 2.2.1), while a hover only does on a toast
 * with an action to reach for. Also pinned: the close button telling its caller the message was read, and a toast
 * over a modal dialog mounting inside it so it is not drawn behind the dialog (#5840).
 */

import { loadModules, mockModule } from './loader.js';
import { textOf } from './support/routeFetch.js';

mockModule('i18next', () => ({ default: { t: (key) => `t(${key})` } }));

let Toast;

beforeEach(async () => {
  vi.useFakeTimers();
  document.body.innerHTML = '<div id="pano"></div><div class="no-id"></div>';
  // A fresh class per test: the live toast for each anchor is static.
  ({ Toast } = await loadModules('frontend/js/common/Toast.js'));
});

const toastEl = () => document.querySelector('.ps-toast');
const pano = () => document.getElementById('pano');
/** @returns {boolean} Whether the toast is still in the page, having not yet faded and been removed. */
const onScreen = () => toastEl() !== null;
/** @param {number} ms - A toast's time on screen, run out along with the fade after it. */
const elapse = (ms) => vi.advanceTimersByTime(ms + Toast.FADE_MS);
/**
 * @param {string} type - A mouse or focus event to fire.
 * @param {Element} [el] - Where: the toast, or a control inside it.
 */
const fire = (type, el = toastEl()) => el.dispatchEvent(new Event(type, { bubbles: true }));

describe('what a toast shows', () => {
  it('shows its title and message as text, with a translated close button', () => {
    Toast.show({ title: 'Mission complete', message: '<b>Nice</b> work', reference: pano() });

    expect(textOf(toastEl().querySelector('.ps-toast__title'))).toBe('Mission complete');
    expect(toastEl().querySelector('.ps-toast__message').textContent).toBe('<b>Nice</b> work');
    expect(toastEl().querySelector('.ps-toast__close').getAttribute('aria-label')).toBe('t(common:close)');
    expect(toastEl().getAttribute('role')).toBe('status');
    expect(toastEl().querySelector('.ps-toast__icon')).toBeNull();
    expect(toastEl().querySelector('.ps-toast__button')).toBeNull();
  });

  it('renders a message given as markup, with anything unsafe stripped', () => {
    Toast.show({ messageHtml: 'Press <kbd>Z</kbd> to zoom<img src="x" onerror="alert(1)">' });

    const message = toastEl().querySelector('.ps-toast__message');
    expect(message.querySelector('kbd').textContent).toBe('Z');
    expect(message.innerHTML).not.toContain('onerror');
  });

  it('leaves out the lines it was not given', () => {
    Toast.show({ title: 'Saved' });

    expect(toastEl().querySelector('.ps-toast__message')).toBeNull();
    expect(toastEl().querySelector('.ps-toast__title')).not.toBeNull();
  });

  it('shows a decorative icon beside the text', () => {
    Toast.show({ title: 'Badge earned', icon: '/assets/images/badges/explore-1.png' });

    const icon = toastEl().querySelector('img.ps-toast__icon');
    expect(icon.getAttribute('src')).toBe('/assets/images/badges/explore-1.png');
    expect(icon.alt).toBe('');
  });

  it('takes the dark and compact looks only when asked', () => {
    Toast.show({ message: 'Over the pano', dark: true, compact: true, reference: pano() });
    Toast.show({ message: 'Plain' });

    expect([...document.querySelectorAll('.ps-toast')].map((el) => el.className)).toEqual([
      'ps-toast ps-toast--dark ps-toast--compact ps-toast--visible',
      'ps-toast ps-toast--visible',
    ]);
  });

  it('names the element it floats over, so a page can style its own anchors\' toasts', () => {
    Toast.show({ message: 'On the pano', reference: pano() });
    expect(toastEl().dataset.anchor).toBe('pano');
  });

  it('names no anchor for a reference without an id, or none at all', () => {
    Toast.show({ message: 'Somewhere', reference: document.querySelector('.no-id') });
    Toast.show({ message: 'Anywhere' });

    expect([...document.querySelectorAll('.ps-toast')].map((el) => el.dataset.anchor)).toEqual([undefined, undefined]);
  });
});

describe('a toast\'s action button', () => {
  it('opens a link in a new tab, and says so to a screen reader', () => {
    Toast.show({ title: 'Badge earned', button: { label: 'My dashboard', href: '/dashboard' } });

    const link = toastEl().querySelector('a.ps-toast__button');
    expect(textOf(link)).toBe('My dashboard t(common:opens-new-tab)');
    expect(link.getAttribute('href')).toBe('/dashboard');
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
    expect(link.classList.contains('button--primary')).toBe(true);
  });

  it('runs the caller\'s callback, styled as the quieter choice when it lets the reader opt out', () => {
    const onClick = vi.fn();
    Toast.show({ message: 'Zoom in to label', button: { label: 'Don\'t show again', onClick, secondary: true } });

    const button = toastEl().querySelector('button.ps-toast__button');
    button.click();

    expect(onClick).toHaveBeenCalledOnce();
    expect(button.classList.contains('button--secondary')).toBe(true);
  });
});

describe('how a toast goes away', () => {
  it('fades out on its own after five seconds by default', () => {
    Toast.show({ message: 'Hi' });

    vi.advanceTimersByTime(4999);
    expect(toastEl().classList.contains('ps-toast--visible')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(toastEl().classList.contains('ps-toast--visible')).toBe(false);
    vi.advanceTimersByTime(Toast.FADE_MS);
    expect(onScreen()).toBe(false);
  });

  it('closes from its close button and tells the caller the message was read', () => {
    const onClose = vi.fn();
    Toast.show({ message: 'Hi', onClose, duration: 0 });

    toastEl().querySelector('.ps-toast__close').click();
    vi.advanceTimersByTime(Toast.FADE_MS);

    expect(onClose).toHaveBeenCalledOnce();
    expect(onScreen()).toBe(false);
  });

  it('does not tell the caller the message was read when it fades on its own', () => {
    const onClose = vi.fn();
    Toast.show({ message: 'Hi', onClose, duration: 1000 });

    elapse(1000);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes from its close button when nobody asked to hear about it', () => {
    Toast.show({ message: 'Hi', duration: 0 });

    toastEl().querySelector('.ps-toast__close').click();
    vi.advanceTimersByTime(Toast.FADE_MS);

    expect(onScreen()).toBe(false);
  });

  it('stays until closed when given no time limit', () => {
    Toast.show({ message: 'Read me', duration: 0 });

    vi.advanceTimersByTime(60_000);

    expect(onScreen()).toBe(true);
  });

  it('can be dismissed more than once without harm', () => {
    const toast = Toast.show({ message: 'Hi', duration: 0 });

    toast.dismiss();
    toast.dismiss();
    vi.advanceTimersByTime(Toast.FADE_MS);

    expect(onScreen()).toBe(false);
  });

  it('stops following window resizes once it is gone', () => {
    const toast = Toast.show({ message: 'Hi', duration: 0 });
    const removeListener = vi.spyOn(window, 'removeEventListener');

    toast.dismiss();

    expect(removeListener).toHaveBeenCalledWith('resize', expect.any(Function));
  });
});

describe('who can stop a toast\'s clock', () => {
  it('pauses while focused, so a keyboard user can reach it, and starts over once focus leaves', () => {
    Toast.show({ message: 'Hi', duration: 1000 });
    const close = toastEl().querySelector('.ps-toast__close');

    fire('focusin', close);
    expect(toastEl().classList.contains('ps-toast--hover')).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(onScreen()).toBe(true);

    fire('focusout', close);
    expect(toastEl().classList.contains('ps-toast--hover')).toBe(false);
    elapse(1000);
    expect(onScreen()).toBe(false);
  });

  it('pauses on hover when it has an action button to reach for', () => {
    Toast.show({ message: 'Hi', duration: 1000, button: { label: 'Go', onClick: () => {} } });

    fire('mouseenter');
    vi.advanceTimersByTime(5000);
    expect(onScreen()).toBe(true);

    fire('mouseleave');
    elapse(1000);
    expect(onScreen()).toBe(false);
  });

  it('brightens on hover but keeps its clock running when it has nothing to click', () => {
    Toast.show({ message: 'Rename failed', duration: 1000 });

    vi.advanceTimersByTime(600);
    fire('mouseenter');
    expect(toastEl().classList.contains('ps-toast--hover')).toBe(true);
    // Passing the cursor over it does not buy it more time.
    fire('mouseleave');
    fire('mouseenter');
    elapse(400);

    expect(onScreen()).toBe(false);
  });

  it('ignores the cursor once it has started to fade', () => {
    const toast = Toast.show({ message: 'Hi', duration: 0, button: { label: 'Go', onClick: () => {} } });
    toast.dismiss();

    fire('mouseenter');

    expect(toastEl().classList.contains('ps-toast--hover')).toBe(false);
  });
});

describe('a toast over a dialog', () => {
  /**
   * Opens a dialog holding the reference. jsdom has no top layer, so `:modal` is answered for it.
   * @param {boolean} modal - Whether it was opened with showModal().
   * @returns {HTMLDialogElement} The dialog.
   */
  function dialogAround(modal) {
    const dialog = document.createElement('dialog');
    dialog.innerHTML = '<div id="label-card"></div>';
    document.body.append(dialog);
    const matches = dialog.matches.bind(dialog);
    dialog.matches = (selector) => (selector === ':modal' ? modal : matches(selector));
    return dialog;
  }

  it('mounts inside a modal dialog, so it is drawn above it rather than behind it', () => {
    const dialog = dialogAround(true);

    Toast.show({ message: 'Copied', reference: document.getElementById('label-card') });

    expect(toastEl().parentElement).toBe(dialog);
  });

  it('mounts on the page for a dialog that is not modal, which sits in the page anyway', () => {
    dialogAround(false);

    Toast.show({ message: 'Copied', reference: document.getElementById('label-card') });

    expect(toastEl().parentElement).toBe(document.body);
  });
});
