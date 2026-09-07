/**
 * Tests the shared unsaved-changes guard (public/js/common/UnsavedChangesGuard.js) that the Settings form arms so
 * edits aren't dropped on the way out of the page (#5226).
 *
 * What matters is that the guard reads a click correctly before it cancels one: a middle-click, a Ctrl-click, a
 * download link, and a jump to an anchor on this same page all leave the page in place, so holding those up would
 * prompt a user who was never leaving. The other half is that the destination survives the prompt — a "save and
 * leave" has to end up where the user clicked.
 *
 * The subject is eval'd with `window` and `document` as parameters: jsdom's real `window.location` can be neither
 * replaced nor spied on, and where the guard navigates is most of what there is to assert, while `document` has to
 * be fresh per test because a guard's click listener lives for the life of the page and an earlier test's would
 * answer this one's clicks. ConfirmDialog is stubbed too — jsdom has no <dialog>, and the button the user picks is
 * what these tests vary anyway.
 */

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'public/js/common/UnsavedChangesGuard.js'), 'utf8'
);

const PAGE_URL = 'http://localhost/dashboard/settings';
const OTHER_PAGE = 'http://localhost/dashboard';

/** The guard class, with the globals it reads (window, document, i18next, ConfirmDialog) supplied per test. */
const guardFactory = (0, eval)(
  `(function (window, document, i18next, ConfirmDialog) {\n${SRC}\nreturn UnsavedChangesGuard;\n})`
);

/**
 * Stands up a page with one link and a guard watching a form.
 * @param {Object} opts
 * @param {string} opts.choice - The button the user picks in the prompt ('save', 'discard', or 'stay').
 * @param {string} [opts.href] - The link's href.
 * @param {string} [opts.attrs] - Extra attributes on the link (target, download, …).
 * @param {boolean} [opts.saveOk=true] - Whether the simulated save succeeds.
 * @param {boolean} [opts.dirty=true] - Whether the watched form has unsaved edits.
 * @returns {Object} The link, the recorded prompts/navigations/logs, and the beforeunload handler the guard added.
 */
function setUp({ choice = 'stay', href = OTHER_PAGE, attrs = '', saveOk = true, dirty = true } = {}) {
  const record = { prompts: [], navigations: [], logs: [], saves: 0 };
  let beforeUnload = null;
  const fakeWindow = {
    addEventListener: (type, handler) => {
      if (type === 'beforeunload') beforeUnload = handler;
    },
    location: {
      href: PAGE_URL,
      origin: 'http://localhost',
      pathname: '/dashboard/settings',
      search: '',
      assign: (url) => record.navigations.push(url),
    },
    logWebpageActivity: (activity) => record.logs.push(activity),
  };
  const confirmDialog = {
    choose: (opts) => {
      record.prompts.push(opts);
      return Promise.resolve(choice);
    },
  };
  const doc = document.implementation.createHTMLDocument();
  const UnsavedChangesGuard = guardFactory(fakeWindow, doc, { t: (key) => key }, confirmDialog);

  doc.body.innerHTML = `<a id="link" href="${href}" ${attrs}>go</a>`;
  new UnsavedChangesGuard({
    isDirty: () => dirty,
    save: () => {
      record.saves += 1;
      return Promise.resolve(saveOk);
    },
    logModule: 'UnsavedSettings',
  });
  return { link: doc.getElementById('link'), record, beforeUnload };
}

/**
 * Dispatches a click the guard will see, and lets its async handler run to completion.
 * @param {HTMLElement} el - What to click.
 * @param {Object} [init] - MouseEvent fields (button, ctrlKey, …).
 * @returns {Promise<boolean>} Whether the click's default action survived, i.e. the browser would have navigated.
 */
async function click(el, init = {}) {
  const event = new window.MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
  el.dispatchEvent(event);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return !event.defaultPrevented;
}

describe('UnsavedChangesGuard', () => {
  it('saves and then follows the link the user clicked', async () => {
    const { link, record } = setUp({ choice: 'save' });

    expect(await click(link)).toBe(false); // The click itself is cancelled...
    expect(record.saves).toBe(1);
    expect(record.navigations).toEqual([OTHER_PAGE]); // ...and replayed once the save lands.
  });

  it('follows the link without saving when the user discards', async () => {
    const { link, record } = setUp({ choice: 'discard' });

    await click(link);
    expect(record.saves).toBe(0);
    expect(record.navigations).toEqual([OTHER_PAGE]);
  });

  it('stays put when the user cancels', async () => {
    const { link, record } = setUp({ choice: 'stay' });

    await click(link);
    expect(record.navigations).toEqual([]);
  });

  it('stays put when a save the user asked for fails, so the error is in front of them', async () => {
    const { link, record } = setUp({ choice: 'save', saveOk: false });

    await click(link);
    expect(record.saves).toBe(1);
    expect(record.navigations).toEqual([]);
  });

  it('logs which way the user answered', async () => {
    const { link, record } = setUp({ choice: 'discard' });

    await click(link);
    expect(record.logs).toEqual(['Click_module=UnsavedSettings_choice=discard']);
  });

  it.each([
    ['a modified click that opens a new tab', {}, { ctrlKey: true }],
    ['a middle click', {}, { button: 1 }],
    ['a link that opens in a new tab', { attrs: 'target="_blank"' }, {}],
    ['a download link', { attrs: 'download' }, {}],
    ['a jump to an anchor on this page', { href: '/dashboard/settings#privacy' }, {}],
    ['a mailto: link', { href: 'mailto:someone@example.test' }, {}],
  ])('leaves %s alone', async (_label, linkOpts, clickOpts) => {
    const { link, record } = setUp(linkOpts);

    expect(await click(link, clickOpts)).toBe(true);
    expect(record.prompts).toHaveLength(0);
  });

  it('does not prompt when there is nothing unsaved', async () => {
    const { link, record } = setUp({ dirty: false });

    expect(await click(link)).toBe(true);
    expect(record.prompts).toHaveLength(0);
  });

  it('warns on a refresh or a tab close only while there are unsaved edits', async () => {
    const dirtyEvent = { preventDefault: jest.fn() };
    setUp().beforeUnload(dirtyEvent);
    expect(dirtyEvent.preventDefault).toHaveBeenCalled();

    const cleanEvent = { preventDefault: jest.fn() };
    setUp({ dirty: false }).beforeUnload(cleanEvent);
    expect(cleanEvent.preventDefault).not.toHaveBeenCalled();
  });

  it('does not warn again while it is doing the navigating itself', async () => {
    const { link, beforeUnload } = setUp({ choice: 'discard' });
    await click(link);

    const event = { preventDefault: jest.fn() };
    beforeUnload(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
