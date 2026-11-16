/** Entry point for the admin dashboard's health page. */
import { HealthPage } from '../../admin-dashboard/HealthPage.js';

new HealthPage({
  healthUrl: '/adminapi/dbHealth',
  fleetUrl: '/adminapi/fleetHealth',
  pollSeconds: 20,
}).init();
