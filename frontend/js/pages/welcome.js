/** Entry point for the welcome page a new account lands on (bundled by rolldown.config.mjs). */
import { WelcomePrivacy } from '../common/WelcomePrivacy.js';

const data = document.getElementById('page-entry').dataset;
// appManager.ready (not DOMContentLoaded) so i18next is initialized before a save status string can be shown.
window.appManager.ready(() => {
  new WelcomePrivacy({ saveUrl: data.saveUrl });
});
