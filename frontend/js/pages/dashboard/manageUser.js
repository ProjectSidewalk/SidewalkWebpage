/** Entry point for the admin's manage-user page. */
import { AdminUser } from '../../user-dashboard/AdminUser.js';

const data = document.getElementById('page-entry').dataset;

window.appManager.ready(() => {
  new AdminUser({
    userId: data.userId,
    username: data.username,
    saveUrl: data.saveUrl,
    flagsUrl: data.flagsUrl,
    hoursUrl: data.hoursUrl,
    pageUrlFor: (username) => `/admin/user/${encodeURIComponent(username)}/manage`,
  });
});
