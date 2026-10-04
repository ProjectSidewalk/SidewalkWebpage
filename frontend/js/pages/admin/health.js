/** Entry point for the admin dashboard's health page (bundled by rolldown.config.mjs). */
import { HealthPage } from '../../admin-dashboard/HealthPage.js';

new HealthPage({
  healthUrl: '/adminapi/dbHealth',
  pollSeconds: 20,
}).init();
