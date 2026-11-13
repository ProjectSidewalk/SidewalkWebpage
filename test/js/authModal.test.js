/**
 * Tests for the sign-in and sign-up forms (frontend/js/common/AuthModal.js) in the navbar's dialog, which the same
 * code runs on the full-page forms and the reset-password page too. Pinned: the dialog opening on the panel asked for
 * and logging that it did, the live checklist that says which password and username rules are met, and the submit
 * that posts in place and shows the server's errors beside the fields they belong to, each clearing once the user
 * starts to fix it. The breached-password lookup has a suite of its own (#5840).
 */

import { loadModules } from './loader.js';
import { navigationAttempts } from './fakes.js';
import { installDialogs } from './support/pageChromeHarness.js';
import { flush, routeFetch, textOf } from './support/routeFetch.js';

installDialogs();

const GENERIC_ERROR = 'Something went wrong. Please try again.';

/** The four PasswordPolicy rules and the UsernamePolicy pattern, as the templates inject them. */
const RULE_REGEXES = ['.{8,}', '[A-Z]', '[a-z]', '\\d'];
const USERNAME_REGEX = '^[A-Za-z0-9_.-]{3,}$';

/**
 * common/authEyeButton.scala.html.
 * @param {string} inputId - The password field the button shows and hides.
 * @returns {string} The button's markup.
 */
const eyeButton = (inputId) => `
  <button type="button" class="au-eye" data-eye="${inputId}" aria-pressed="false" aria-label="Show password"
          data-label-show="Show password" data-label-hide="Hide password">
    <svg class="au-eye-on"></svg><svg class="au-eye-off ps-hidden"></svg>
  </button>`;

/** common/authDialog.scala.html for a signed-out visitor, cut down to one of each kind of field. */
const AUTH_DIALOG = `
  <a id="navbar-sign-in-btn" href="/signIn" data-au-open="signIn">Sign in</a>
  <button id="join" data-au-open="signUp">Join</button>
  <dialog id="sign-in-modal-container" class="au-dialog" aria-labelledby="sign-in-label">
    <div class="au-body">
      <div class="au-panel" id="sign-in-modal">
        <h1 class="au-title" id="sign-in-label">Welcome back</h1>
        <button type="button" class="au-close" aria-label="Close">x</button>
        <form id="sign-in-form" class="au-form" action="/authenticate" method="post"
              data-error-generic="${GENERIC_ERROR}">
          <div class="au-field">
            <input class="au-input" id="sign-in-email" name="email" type="text">
          </div>
          <div class="au-field">
            <div class="au-input-wrap">
              <input class="au-input au-input--with-eye" id="sign-in-password" name="password" type="password">
              ${eyeButton('sign-in-password')}
            </div>
          </div>
          <button type="submit" class="au-submit">Sign in</button>
        </form>
        <div class="au-footer">New to Project Sidewalk? <a href="#" id="form-open-sign-up">Create an account</a></div>
      </div>
      <div class="au-panel ps-hidden" id="sign-up-modal">
        <h1 class="au-title" id="sign-up-label">Join</h1>
        <button type="button" class="au-close" aria-label="Close">x</button>
        <form id="sign-up-form" class="au-form" action="/signUp" method="post" data-error-generic="${GENERIC_ERROR}">
          <div class="au-field">
            <input class="au-input" id="sign-up-username" name="username" type="text"
                   data-rule-regex="${USERNAME_REGEX}">
            <div class="au-match" id="sign-up-username-rule"></div>
          </div>
          <div class="au-pw-group" data-breach-url="https://api.pwnedpasswords.com/range/"
               data-breach-warning="This password has shown up in a data breach.">
            <div class="au-field">
              <div class="au-input-wrap">
                <input class="au-input au-input--with-eye au-pw" id="sign-up-password" name="password"
                       type="password">
                ${eyeButton('sign-up-password')}
              </div>
              <ul class="au-checklist" id="sign-up-pw-rules">
                ${RULE_REGEXES.map((r) => `<li data-rule-regex="${r}"></li>`).join('')}
              </ul>
              <div class="au-strength">
                <div class="au-slabs au-pw-slabs"><span></span><span></span><span></span><span></span></div>
                <span class="au-strength-word au-pw-strength-word" data-word1="Weak" data-word2="Fair"
                      data-word3="Good" data-word4="Strong"></span>
              </div>
            </div>
            <div class="au-field">
              <div class="au-input-wrap">
                <input class="au-input au-pw-confirm" id="sign-up-password-confirm" name="passwordConfirm"
                       type="password">
              </div>
              <div class="au-match au-pw-match" data-label-match="Passwords match"
                   data-label-no-match="Passwords don't match">
                <span class="au-match-text">Passwords match</span>
              </div>
            </div>
          </div>
          <button type="submit" class="au-submit">Create account</button>
        </form>
        <div class="au-footer">Have an account? <a href="#" id="form-open-sign-in">Sign in</a></div>
      </div>
    </div>
  </dialog>`;

/**
 * Renders a page and loads AuthModal.js against it, running its start-up as the browser would once the page is parsed.
 * jsdom keeps one window for the whole file, so the DOMContentLoaded listener is taken rather than left to pile up.
 * @param {string} [markup] - The page's body.
 * @returns {Promise<object>} The module's exports.
 */
async function boot(markup = `<div class="au-page">${AUTH_DIALOG}</div>`) {
  let domReady;
  vi.spyOn(window, 'addEventListener').mockImplementation((type, handler) => {
    if (type === 'DOMContentLoaded') domReady = handler;
  });
  document.body.innerHTML = markup;
  delete window.psAuthModal;
  const exports = await loadModules('frontend/js/common/AuthModal.js');
  vi.mocked(window.addEventListener).mockRestore();
  domReady();
  return exports;
}

const el = (id) => document.getElementById(id);
const dialog = () => el('sign-in-modal-container');
/**
 * Types into a field, as the user would.
 * @param {string} id - The field.
 * @param {string} value - Its new value.
 */
const type = (id, value) => {
  el(id).value = value;
  el(id).dispatchEvent(new Event('input', { bubbles: true }));
};

beforeEach(() => {
  window.logWebpageActivity = vi.fn();
});

describe('the sign-in dialog', () => {
  beforeEach(() => boot());

  it('opens on the sign-in panel from the navbar link, without following it', () => {
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    el('navbar-sign-in-btn').dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    expect(dialog().open).toBe(true);
    expect(el('sign-in-modal').classList.contains('ps-hidden')).toBe(false);
    expect(el('sign-up-modal').classList.contains('ps-hidden')).toBe(true);
    expect(dialog().getAttribute('aria-labelledby')).toBe('sign-in-label');
    expect(document.activeElement).toBe(el('sign-in-email'));
    expect(window.logWebpageActivity).toHaveBeenCalledWith('ModalAuth_Show=SignIn');
  });

  it('opens on the sign-up panel from a join button', () => {
    el('join').click();

    expect(el('sign-up-modal').classList.contains('ps-hidden')).toBe(false);
    expect(el('sign-in-modal').classList.contains('ps-hidden')).toBe(true);
    expect(dialog().getAttribute('aria-labelledby')).toBe('sign-up-label');
    expect(document.activeElement).toBe(el('sign-up-username'));
    expect(window.logWebpageActivity).toHaveBeenCalledWith('ModalAuth_Show=SignUp');
  });

  it('opens on sign-in when a page asks without saying which', () => {
    window.psAuthModal.open();

    expect(el('sign-in-modal').classList.contains('ps-hidden')).toBe(false);
    expect(window.psAuthModal.element).toBe(dialog());
  });

  it('swaps panels in place from the links under each form', () => {
    window.psAuthModal.open('signIn');

    el('form-open-sign-up').click();
    expect(el('sign-up-modal').classList.contains('ps-hidden')).toBe(false);
    expect(document.activeElement).toBe(el('sign-up-username'));

    el('form-open-sign-in').click();
    expect(el('sign-in-modal').classList.contains('ps-hidden')).toBe(false);
    expect(document.activeElement).toBe(el('sign-in-email'));
    expect(dialog().open).toBe(true);
  });

  it('closes from either panel\'s close button, or when a page asks', () => {
    window.psAuthModal.open('signUp');
    el('sign-up-modal').querySelector('.au-close').click();
    expect(dialog().open).toBe(false);

    window.psAuthModal.open('signIn');
    window.psAuthModal.close();
    expect(dialog().open).toBe(false);
  });

  it('shows and hides a password from its eye button, saying which it will do next', () => {
    const eye = el('sign-in-password').nextElementSibling;

    eye.click();
    expect(el('sign-in-password').type).toBe('text');
    expect(eye.getAttribute('aria-pressed')).toBe('true');
    expect(eye.getAttribute('aria-label')).toBe('Hide password');
    expect(eye.querySelector('.au-eye-on').classList.contains('ps-hidden')).toBe(true);
    expect(eye.querySelector('.au-eye-off').classList.contains('ps-hidden')).toBe(false);

    eye.click();
    expect(el('sign-in-password').type).toBe('password');
    expect(eye.getAttribute('aria-label')).toBe('Show password');
    expect(eye.querySelector('.au-eye-on').classList.contains('ps-hidden')).toBe(false);
  });
});

describe('a page without the dialog', () => {
  it('still enhances its own forms, and leaves nothing for pages to open', async () => {
    await boot(`<form id="sign-in-form" action="/authenticate" data-error-generic="${GENERIC_ERROR}">
      <input class="au-input" name="email"><button type="submit">Sign in</button></form>`);
    routeFetch({ '/authenticate': { status: 500, body: {} } }, (url) => new URL(url).pathname);

    el('sign-in-form').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();

    expect(window.psAuthModal).toBeUndefined();
    expect(textOf(document.querySelector('.au-summary'))).toBe(GENERIC_ERROR);
  });
});

describe('live rule checks while signing up', () => {
  beforeEach(() => boot());

  const metRules = () => [...document.querySelectorAll('.au-checklist li')].map((li) => li.classList.contains('met'));
  const strength = () => textOf(document.querySelector('.au-pw-strength-word'));
  const paved = () => document.querySelectorAll('.au-pw-slabs span.paved').length;
  const match = () => document.querySelector('.au-pw-match');

  it('ticks off each password rule as it is met, and rates the password by how many are', () => {
    type('sign-up-password', 'abc');
    expect(metRules()).toEqual([false, false, true, false]);
    expect(strength()).toBe('Weak');
    expect(paved()).toBe(1);

    type('sign-up-password', 'Abcdefg1');
    expect(metRules()).toEqual([true, true, true, true]);
    expect(strength()).toBe('Strong');
    expect(paved()).toBe(4);
  });

  it('rates nothing for an empty password, or one that meets no rule yet', () => {
    type('sign-up-password', '!!');
    expect(strength()).toBe('');
    expect(paved()).toBe(0);

    type('sign-up-password', '');
    expect(strength()).toBe('');
  });

  it('says whether the confirmation matches, and says nothing before one is typed', () => {
    type('sign-up-password', 'Abcdefg1');
    expect(match().classList.contains('met')).toBe(false);
    expect(match().classList.contains('unmet')).toBe(false);
    expect(textOf(match())).toBe('Passwords match');

    type('sign-up-password-confirm', 'Abcdefg');
    expect(match().classList.contains('unmet')).toBe(true);
    expect(textOf(match())).toBe('Passwords don\'t match');

    type('sign-up-password-confirm', 'Abcdefg1');
    expect(match().classList.contains('met')).toBe(true);
    expect(match().classList.contains('unmet')).toBe(false);
    expect(textOf(match())).toBe('Passwords match');
  });

  it('checks the username rule as it is typed, flagging it only once something is there', () => {
    const rule = el('sign-up-username-rule');

    type('sign-up-username', 'ab');
    expect(rule.classList.contains('unmet')).toBe(true);
    type('sign-up-username', 'ab_cd');
    expect(rule.classList.contains('met')).toBe(true);
    expect(rule.classList.contains('unmet')).toBe(false);
    type('sign-up-username', '');
    expect(rule.classList.contains('met')).toBe(false);
    expect(rule.classList.contains('unmet')).toBe(false);
  });
});

describe('submitting in place', () => {
  let fetchStub;
  let reply;

  beforeEach(async () => {
    await boot();
    // A closed dialog's fields can't take focus, and these forms are submitted from the open one.
    window.psAuthModal.open();
    reply = {};
    fetchStub = routeFetch({ '/authenticate': () => reply, '/signUp': () => reply }, (url) => new URL(url).pathname);
  });

  /**
   * Submits a form and lets its reply land.
   * @param {string} [id] - The form.
   */
  async function submit(id = 'sign-in-form') {
    el(id).dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
  }
  const submitButton = (id = 'sign-in-form') => el(id).querySelector('button[type="submit"]');
  const summary = () => document.querySelector('.au-summary');

  it('posts the form as an XHR to its own action, holding the button until the reply', async () => {
    type('sign-in-email', 'pat@example.com');
    type('sign-in-password', 'Hunter22');
    let pending;
    reply = new Promise((resolve) => { pending = resolve; });

    el('sign-in-form').dispatchEvent(new Event('submit', { cancelable: true }));

    expect(submitButton().disabled).toBe(true);
    expect(submitButton().classList.contains('is-loading')).toBe(true);
    const [url, init] = fetchStub.mock.calls[0];
    expect(url).toBe('http://localhost/authenticate');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'X-Requested-With': 'XMLHttpRequest' });
    expect(Object.fromEntries(init.body)).toEqual({ email: 'pat@example.com', password: 'Hunter22' });

    pending({ status: 400, body: { errors: { _summary: 'No.' } } });
    await flush();
    expect(submitButton().disabled).toBe(false);
    expect(submitButton().classList.contains('is-loading')).toBe(false);
  });

  it('follows the redirect a successful sign-in answers with, keeping the button held meanwhile', async () => {
    const navigations = navigationAttempts();
    reply = { redirect: '/dashboard' };

    await submit();

    expect(navigations).toHaveBeenCalledOnce();
    expect(submitButton().disabled).toBe(true);
  });

  it('hands a successful reply to the caller that asked for it instead', async () => {
    const onSuccess = vi.fn();
    document.body.insertAdjacentHTML('beforeend', `
      <form id="set-devices-form" action="/dashboard/settings/signOutOtherDevices">
        <button type="submit">Sign out of other devices</button>
      </form>`);
    routeFetch({ '/dashboard/settings/signOutOtherDevices': { success: true, message: 'Signed out.' } },
      (url) => new URL(url).pathname);
    const { wireAsyncSubmit } = await loadModules('frontend/js/common/AuthModal.js');
    wireAsyncSubmit(el('set-devices-form'), { onSuccess });

    await submit('set-devices-form');

    expect(onSuccess).toHaveBeenCalledWith({ success: true, message: 'Signed out.' });
    expect(submitButton('set-devices-form').disabled).toBe(false);
  });

  it('does nothing for a form the page does not have', async () => {
    const { wireAsyncSubmit } = await loadModules('frontend/js/common/AuthModal.js');

    expect(() => wireAsyncSubmit(null)).not.toThrow();
  });

  it('shows a field\'s error beside it, focuses it, and clears it once the field is edited', async () => {
    reply = { status: 400, body: { errors: { username: 'That username is taken.', email: 'Not an email.' } } };
    type('sign-up-username', 'pat');

    await submit('sign-up-form');

    const username = el('sign-up-username');
    expect(username.classList.contains('au-input--error')).toBe(true);
    expect(username.getAttribute('aria-invalid')).toBe('true');
    expect(username.nextElementSibling.classList.contains('au-field-error')).toBe(true);
    expect(textOf(username.nextElementSibling)).toBe('That username is taken.');
    expect(username.nextElementSibling.getAttribute('role')).toBe('alert');
    expect(document.activeElement).toBe(username);
    // No such field on this form: nothing to attach it to.
    expect(document.querySelectorAll('.au-field-error')).toHaveLength(1);

    type('sign-up-username', 'pat2');
    expect(username.classList.contains('au-input--error')).toBe(false);
    expect(username.hasAttribute('aria-invalid')).toBe(false);
    expect(document.querySelector('.au-field-error')).toBeNull();
  });

  it('puts the error for a field with an eye button after the pair, not between them', async () => {
    reply = { status: 400, body: { errors: { password: 'Too short.' } } };

    await submit('sign-up-form');

    const wrap = el('sign-up-password').closest('.au-input-wrap');
    expect(wrap.nextElementSibling.classList.contains('au-field-error')).toBe(true);
  });

  it('shows a form-wide error above the form until the next edit to any field', async () => {
    reply = { status: 400, body: { errors: { _summary: 'Too many attempts.' } } };
    submitButton().focus();

    await submit();

    expect(summary().nextElementSibling).toBe(el('sign-in-form'));
    expect(textOf(summary())).toBe('Too many attempts.');
    expect(summary().getAttribute('role')).toBe('alert');
    // No field to send focus to, so it stays where the user left it.
    expect(document.activeElement).toBe(submitButton());

    type('sign-in-email', 'p');
    expect(summary()).toBeNull();
  });

  it('empties the password and starts over at the first field after a wrong sign-in', async () => {
    reply = { status: 401, body: { errors: { _summary: 'Wrong email or password.' } } };
    type('sign-in-email', 'pat@example.com');
    type('sign-in-password', 'nope');

    await submit();

    expect(el('sign-in-password').value).toBe('');
    expect(el('sign-in-email').value).toBe('pat@example.com');
    expect(document.activeElement).toBe(el('sign-in-email'));
  });

  it('copes with a 401 on a form with no fields, like an expired session signing out other devices', async () => {
    document.body.insertAdjacentHTML('beforeend', `
      <div><form id="set-devices-form" action="/dashboard/settings/signOutOtherDevices"
                 data-error-generic="${GENERIC_ERROR}">
        <button type="submit">Sign out of other devices</button>
      </form></div>`);
    routeFetch({ '/dashboard/settings/signOutOtherDevices': { status: 401, body: {} } },
      (url) => new URL(url).pathname);
    const { wireAsyncSubmit } = await loadModules('frontend/js/common/AuthModal.js');
    wireAsyncSubmit(el('set-devices-form'));

    await submit('set-devices-form');

    expect(textOf(document.querySelector('.au-summary'))).toBe(GENERIC_ERROR);
  });

  it.each([
    ['a reply with no JSON in it', () => ({ status: 502 })],
    ['a success with nowhere to go', () => ({})],
    ['a request that never reaches the server', () => new TypeError('Failed to fetch')],
  ])('shows the general error for %s', async (_what, answer) => {
    reply = answer();

    await submit();

    expect(textOf(summary())).toBe(GENERIC_ERROR);
    expect(submitButton().disabled).toBe(false);
  });

  it('clears the last submit\'s errors when the form is sent again, but keeps a page\'s own notice', async () => {
    el('sign-in-form').insertAdjacentHTML('beforebegin', '<div class="au-summary au-summary--info">Check email</div>');
    reply = { status: 400, body: { errors: { _summary: 'Too many attempts.', email: 'Required.' } } };
    await submit();
    expect(document.querySelectorAll('.au-summary')).toHaveLength(2);

    reply = new Promise(() => {});
    el('sign-in-form').dispatchEvent(new Event('submit', { cancelable: true }));

    expect(document.querySelectorAll('.au-summary')).toHaveLength(1);
    expect(document.querySelector('.au-summary--info')).not.toBeNull();
    expect(document.querySelector('.au-field-error')).toBeNull();
    expect(el('sign-in-email').classList.contains('au-input--error')).toBe(false);
    expect(el('sign-in-email').hasAttribute('aria-invalid')).toBe(false);
  });
});
