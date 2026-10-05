/** Entry point for the user settings page. */
import { Settings } from '../../user-dashboard/Settings.js';
import { AccountForm } from '../../user-dashboard/AccountForm.js';
import '../../user-dashboard/TeamActions.js';

const data = document.getElementById('page-entry').dataset;

// appManager.ready (not DOMContentLoaded) so i18next is initialized before Settings can show a status string.
window.appManager.ready(() => {
  new Settings({
    saveUrl: data.saveUrl,
    currentUsername: data.username,
    currentUnits: data.units,
  });
});
// Not appManager.ready, which waits on i18next: until this runs, a submit shows raw JSON. Not sooner either, since
// AuthModal.js (which it uses) is a deferred script.
document.addEventListener('DOMContentLoaded', () => {
  new AccountForm(/** @type {HTMLFormElement} */ (document.getElementById('set-password-form')));
  new AccountForm(/** @type {HTMLFormElement} */ (document.getElementById('set-devices-form')));
});
