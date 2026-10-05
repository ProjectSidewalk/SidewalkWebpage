/** Entry point for a shared label's page. */
import { SharedLabelPage } from '../shared-label/SharedLabel.js';

// What the server knows about the label, written into the page as JSON by sharedLabel.scala.html.
const config = JSON.parse(document.getElementById('page-data').textContent);
window.appManager.ready(() => {
  new SharedLabelPage(config);
});
