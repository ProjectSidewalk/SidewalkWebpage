/** Entry point for the admin dashboard's humansVsAi page (bundled by rolldown.config.mjs). */
import { HumanVsAiPage } from '../../admin-dashboard/HumanVsAiPage.js';

new HumanVsAiPage({
  statsUrl: '/adminapi/humanVsAi',
  labelTypesUrl: '/v3/api/labelTypes',
}).init();
