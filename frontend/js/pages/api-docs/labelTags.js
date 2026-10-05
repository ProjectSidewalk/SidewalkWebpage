/** Entry point for the /v3/api-docs/labelTags page. */
import { LabelTagsPreview } from '../../api-docs/labelTagsPreview.js';
import { generateTableOfContents, setupScrollSpy } from '../../api-docs/apiDocs.js';

// apiDocs.js reads these for the download buttons; a preview or two read the base URL as well.
Object.assign(document.documentElement.dataset, { apiBaseUrl: '/v3/api', apiEndpoint: 'labelTags' });
LabelTagsPreview.setup({ maxWidth: 1000 }).init()
  .then(() => {
    generateTableOfContents();
    setupScrollSpy();
  })
  .catch((error) => console.error('Error initializing label tags preview or refreshing TOC:', error));
