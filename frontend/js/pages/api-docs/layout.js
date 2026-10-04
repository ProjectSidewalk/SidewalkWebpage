/** Entry point for every API docs page's shared chrome (bundled by rolldown.config.mjs). */
import '../../api-docs/apiDocs.js';
import { setupBibtexDownload } from '../../api-docs/bibtexDownload.js';

setupBibtexDownload();
