/**
 * Runs before every suite (vitest.config.mjs `setupFiles`).
 *
 * jsdom ships the Popover API's stylesheet (a closed `[popover]` is `display: none`) without the API, and refuses to
 * focus anything not displayed. The suites model a browser without the API, where no such rule exists, so it is
 * overridden here; skipped under the node environment.
 */

if (typeof document !== 'undefined') {
    const style = document.createElement('style');
    style.textContent = '[popover] { display: block !important; }';
    document.head.appendChild(style);
}
