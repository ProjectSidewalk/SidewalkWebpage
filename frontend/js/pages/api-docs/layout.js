/** Entry point for every API docs page's shared chrome. */
import Prism from 'prismjs';
// Only the languages the docs' code blocks use; a new `language-*` class on a page needs its component added here.
// No stock theme: the `.token.*` colors are ours, in api-docs.css.
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-csv';
import '../../api-docs/apiDocs.js';
import { setupBibtexDownload } from '../../api-docs/bibtexDownload.js';
import '../../../css/pages/api-docs/api-docs.css';

// Loaded this late, Prism would schedule its own pass for the next frame; one pass now, instead.
Prism.manual = true;
Prism.highlightAll();
setupBibtexDownload();
