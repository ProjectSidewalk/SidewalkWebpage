/** Entry point for the API docs index (bundled by rolldown.config.mjs). */
import '../../common/aggregateStats.js';
import { LabelTypesPreview } from '../../api-docs/labelTypesPreview.js';
import { LabelTagsPreview } from '../../api-docs/labelTagsPreview.js';
import { generateTableOfContents } from '../../api-docs/apiDocs.js';

LabelTypesPreview.setup({ maxWidth: 1000 }).init();
LabelTagsPreview.setup({ maxWidth: 1000, displayMode: 'summary' }).init()
  .then(() => generateTableOfContents())
  .catch((error) => console.error('Error initializing label tags summary:', error));
