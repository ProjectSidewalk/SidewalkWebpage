/** Entry point for the admin dashboard's quality page. */
import { DataQualityPage } from '../../admin-dashboard/DataQualityPage.js';

new DataQualityPage({
  statsUrl: '/v3/api/overallStats',
  tagsUrl: '/adminapi/labelTags',
  labelTypesUrl: '/v3/api/labelTypes',
  byDayUrl: '/v3/api/overallStatsByDay',
  tagSeverityUrl: '/adminapi/tagSeverity',
}).init();
