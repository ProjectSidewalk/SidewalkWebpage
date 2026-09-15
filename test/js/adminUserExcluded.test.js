/**
 * Tests for how the Manage user page's Excluded box drives the quality dropdown (#3956), chiefly that a stray
 * check-and-uncheck restores the admin's earlier choice.
 *
 * Runs under jsdom (jest.config.js). AdminUser is a bare top-level class in a concatenated bundle, so it is eval'd
 * into global scope rather than required.
 */

const fs = require('fs');
const path = require('path');

const ADMIN_USER_SRC = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'public/js/user-dashboard/AdminUser.js'), 'utf8');

let AdminUser;

beforeAll(() => {
  AdminUser = (0, eval)(`${ADMIN_USER_SRC}\nAdminUser;`);
});

/**
 * Builds the account form's quality and exclusion controls, then the page controller.
 * @param {string} quality - The dropdown's starting value: 'auto', 'true', or 'false'.
 * @param {boolean} excluded - Whether the box starts checked.
 */
function load(quality, excluded) {
  document.body.innerHTML = `
    <select id="au-quality" ${excluded ? 'disabled' : ''}>
      <option value="auto">Automatic</option>
      <option value="true">High quality</option>
      <option value="false">Low quality</option>
    </select>
    <input type="checkbox" id="au-excluded" ${excluded ? 'checked' : ''}>`;
  document.getElementById('au-quality').value = quality;
  global.fetch = jest.fn(() => new Promise(() => {}));
  new AdminUser({
    userId: 'u1', username: 'mapper', saveUrl: '/save', flagsUrl: '/flags', hoursUrl: '/hours',
    pageUrlFor: (u) => `/admin/user/${u}/manage`,
  });
}

/** @param {boolean} checked - The state to click the Excluded box into. */
function setExcluded(checked) {
  const box = document.getElementById('au-excluded');
  box.checked = checked;
  box.dispatchEvent(new Event('change'));
}

const quality = () => document.getElementById('au-quality');

describe('the Excluded box', () => {
  test('locks quality on "Low quality" while checked', () => {
    load('true', false);
    setExcluded(true);
    expect(quality().value).toBe('false');
    expect(quality().disabled).toBe(true);
  });

  test('puts back the earlier quality when unchecked', () => {
    load('true', false);
    setExcluded(true);
    setExcluded(false);
    expect(quality().value).toBe('true');
    expect(quality().disabled).toBe(false);
  });

  test('leaves an already-excluded user on "Low quality" when unchecked', () => {
    load('false', true);
    setExcluded(false);
    expect(quality().value).toBe('false');
    expect(quality().disabled).toBe(false);
  });
});
