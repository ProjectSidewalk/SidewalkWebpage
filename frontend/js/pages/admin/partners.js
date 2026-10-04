/** Entry point for the admin dashboard's partners page (bundled by rolldown.config.mjs). */
import { PartnersPage } from '../../admin-dashboard/PartnersPage.js';

const data = document.getElementById('page-entry').dataset;
new PartnersPage({ isOwner: data.isOwner === 'true' }).init();
