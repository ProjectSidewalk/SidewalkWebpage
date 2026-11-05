/**
 * Tests for how the Manage user page's Excluded box drives the quality dropdown (#3956), chiefly that a stray
 * check-and-uncheck restores the admin's earlier choice.
 */

import { loadModules, mockModule } from './loader.js';
import { drawManageUserPage } from './support/manageUserPage.js';

mockModule('i18next', () => ({ default: { language: 'en' } }));

const { AdminUser } = await loadModules('frontend/js/user-dashboard/AdminUser.js');

/**
 * Draws the page with the given quality and exclusion, then starts the page controller.
 * @param {string} quality - The dropdown's starting value: 'auto', 'true', or 'false'.
 * @param {boolean} excluded - Whether the box starts checked.
 */
function load(quality, excluded) {
  drawManageUserPage({ quality, excluded });
  window.fetch = vi.fn(() => new Promise(() => {}));
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
