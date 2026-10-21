/** Entry point for the admin dashboard's partners page. */
import { PartnersPage } from '../../admin-dashboard/PartnersPage.js';

const data = document.getElementById('page-entry').dataset;
new PartnersPage({ isOwner: data.isOwner === 'true' }).init();
