/**
 * Runs before every suite (vitest.config.mjs `setupFiles`): the page stamps main.scala.html makes, and a jsdom fix-up.
 */

import fs from 'fs';
import path from 'path';

if (typeof document !== 'undefined') {
    // The label-type table every page is served, so `util.misc` builds from the real one. The fixture is a committed
    // copy of what LabelType serializes, and LabelTypeSpec fails if the two diverge.
    const fixture = path.resolve(import.meta.dirname, '..', 'resources', 'label-types-stamp.json');
    window.labelTypes = JSON.parse(fs.readFileSync(fixture, 'utf8'));

    // jsdom ships the Popover API's stylesheet (a closed `[popover]` is `display: none`) without the API, and refuses
    // to focus anything not displayed. The suites model a browser without the API, where no such rule exists.
    const style = document.createElement('style');
    style.textContent = '[popover] { display: block !important; }';
    document.head.appendChild(style);
}
