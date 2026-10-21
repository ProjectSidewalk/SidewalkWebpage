/** Entry point for the API docs index. */
import '../../common/aggregateStats.js';
import { LabelTypesPreview } from '../../api-docs/labelTypesPreview.js';
import { LabelTagsPreview } from '../../api-docs/labelTagsPreview.js';
import { generateTableOfContents } from '../../api-docs/apiDocs.js';
import '../../../css/pages/api-docs/label-tags.css';
import '../../../css/pages/api-docs/label-types.css';

LabelTypesPreview.setup({ maxWidth: 1000 }).init();
LabelTagsPreview.setup({ maxWidth: 1000, displayMode: 'summary' }).init()
  .then(() => generateTableOfContents())
  .catch((error) => console.error('Error initializing label tags summary:', error));
