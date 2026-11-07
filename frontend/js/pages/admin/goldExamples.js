/** Entry point for the admin dashboard's gold examples page (#1445). */
import { GoldExamplesPage } from '../../admin-dashboard/GoldExamplesPage.js';

// Waits on i18next: the reasons' texts come from the shared locale files, the same ones Validate's menus read.
window.appManager.ready(() => {
  new GoldExamplesPage().init();
});
