/**
 * Tests the Settings page's change-password form (public/js/user-dashboard/ChangePasswordForm.js, #2285).
 *
 * What matters is what the user is left looking at after each outcome: a success empties every password field and
 * says so, a wrong current password clears just that field and flags it, and a failed request still explains itself
 * instead of doing nothing. Submitting and error drawing are AuthModal.js's own `wireAsyncSubmit`, loaded for real
 * rather than stubbed, so these tests also catch the form drifting away from the markup that helper expects.
 */

const fs = require('fs');
const path = require('path');

const read = (relativePath) => fs.readFileSync(path.resolve(__dirname, '..', '..', relativePath), 'utf8');

const GENERIC_ERROR = 'Something went wrong on our end. Please try again.';

/**
 * The class under test, sharing a scope with AuthModal.js as it does a page's globals, and with `fetch` supplied per
 * test. AuthModal.js's DOMContentLoaded hook is inert here: the page has already loaded.
 */
const formFactory = (0, eval)(
  `(function (fetch) {
    ${read('public/js/common/AuthModal.js')}
    ${read('public/js/user-dashboard/ChangePasswordForm.js')}
    return ChangePasswordForm;
  })`
);

/**
 * A reduction of the password section in userDashboard/settings.scala.html: the fields and hooks the class and the
 * AuthModal.js helpers walk, not the full markup.
 */
const renderForm = () => {
  document.body.innerHTML = `
    <div class="page-section">
      <form id="set-password-form" method="post" action="/dashboard/settings/password"
            data-error-generic="${GENERIC_ERROR}">
        <div class="au-field">
          <div class="au-input-wrap">
            <input class="au-input" id="set-current-password" name="currentPassword" type="password">
          </div>
        </div>
        <div class="au-pw-group">
          <div class="au-input-wrap"><input class="au-input au-pw" name="newPassword" type="password"></div>
          <div class="au-input-wrap">
            <input class="au-input au-pw-confirm" name="newPasswordConfirm" type="password">
          </div>
        </div>
        <button type="submit">Change password</button>
        <span class="ud-save-status" role="status"></span>
      </form>
    </div>`;
  const form = document.getElementById('set-password-form');
  form.elements.currentPassword.value = 'OldPass1';
  form.elements.newPassword.value = 'NewPass22';
  form.elements.newPasswordConfirm.value = 'NewPass22';
  return form;
};

/**
 * Submits the form and waits for the handler to finish. The fetch, its .json(), and the handler's own awaits each
 * take a turn of the event loop.
 *
 * @param {HTMLFormElement} form - The form to submit.
 */
async function submit(form) {
  form.dispatchEvent(new window.Event('submit', { cancelable: true }));
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Builds the form against a fake server and submits it.
 *
 * @param {Function} fetchImpl - Stands in for `fetch`.
 * @param {Function} [beforeSubmit] - Called with the form before it's submitted, to attach listeners.
 * @returns {Promise<HTMLFormElement>} The form, once the submit has finished.
 */
async function submitWith(fetchImpl, beforeSubmit = () => {}) {
  const form = renderForm();
  const ChangePasswordForm = formFactory(fetchImpl);
  new ChangePasswordForm(form);
  beforeSubmit(form);
  await submit(form);
  return form;
}

/** @returns {Function} A fetch that answers with this status and JSON body. */
const respondWith = (status, body) => jest.fn(async () => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
}));

const status = () => document.querySelector('.ud-save-status');

test('a successful change empties every field, says so, and posts the form to its own action', async () => {
  const fetchImpl = respondWith(200, { success: true, message: 'Your password has been changed.' });
  const typed = [];
  const form = await submitWith(fetchImpl, (f) => {
    f.querySelectorAll('.au-pw, .au-pw-confirm').forEach((el) => el.addEventListener('input', () => typed.push(el)));
  });

  const [url, init] = fetchImpl.mock.calls[0];
  expect(url).toBe(form.action);
  expect(init.method).toBe('POST');
  expect(Object.fromEntries(init.body)).toEqual({
    currentPassword: 'OldPass1',
    newPassword: 'NewPass22',
    newPasswordConfirm: 'NewPass22',
  });

  ['currentPassword', 'newPassword', 'newPasswordConfirm']
    .forEach((name) => expect(form.elements[name].value).toBe(''));
  // The checklist and "passwords match" line only update on input, so emptying the fields has to announce itself.
  expect(typed).toHaveLength(2);
  expect(status().textContent).toBe('Your password has been changed.');
  expect(status().classList.contains('ud-save-ok')).toBe(true);
  expect(form.querySelector('button').disabled).toBe(false);
});

test('a wrong current password clears and flags only that field', async () => {
  const wrong = 'That isn\'t your current password.';
  const form = await submitWith(respondWith(401, { errors: { currentPassword: wrong } }));

  const current = form.elements.currentPassword;
  expect(current.value).toBe('');
  expect(current.classList.contains('au-input--error')).toBe(true);
  expect(form.querySelector('.au-field-error').textContent).toContain(wrong);
  expect(form.elements.newPassword.value).toBe('NewPass22');
  expect(status().textContent).toBe('');
});

test('a form-level error, like a mismatch, is a banner above the form and keeps the current password', async () => {
  const form = await submitWith(respondWith(400, { errors: { _summary: 'Passwords do not match' } }));

  expect(form.previousElementSibling.classList.contains('au-summary')).toBe(true);
  expect(form.previousElementSibling.textContent).toContain('Passwords do not match');
  expect(form.elements.currentPassword.value).toBe('OldPass1');
});

test('a request that never reaches the server still explains itself, and a retry clears the old error', async () => {
  const form = await submitWith(jest.fn(async () => { throw new TypeError('Failed to fetch'); }));

  expect(form.previousElementSibling.textContent).toContain(GENERIC_ERROR);
  expect(form.querySelector('button').disabled).toBe(false);

  await submit(form);
  expect(document.querySelectorAll('.au-summary')).toHaveLength(1);
});

test('the next submit clears an earlier "changed" message before its own reply arrives', async () => {
  const form = await submitWith(respondWith(200, { success: true, message: 'Your password has been changed.' }));
  expect(status().textContent).toBe('Your password has been changed.');

  form.dispatchEvent(new window.Event('submit', { cancelable: true }));
  expect(status().textContent).toBe('');
  expect(status().classList.contains('ud-save-ok')).toBe(false);
});
