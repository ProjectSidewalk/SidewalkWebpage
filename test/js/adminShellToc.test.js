/**
 * Tests for AdminShell's "On this page" list and its scroll-spy across an async section's arrival (#4496).
 *
 * A section that loads after the page (the dashboard's cross-city breakdown) starts hidden, so it is absent from the
 * TOC built at load and calls refreshTableOfContents() once it renders. The edge worth pinning is the page whose only
 * headings arrive that way: at load there was nothing to spy on, so the listener was never attached, and the rebuilt
 * TOC would look right while never highlighting anything.
 *
 * Runs under jsdom (jest.config.js). AdminShell is a bare top-level class in a concatenated bundle, so it is eval'd
 * into global scope rather than required.
 */

const fs = require('fs');
const path = require('path');

const SHELL_SRC = fs.readFileSync(
  path.resolve(__dirname, '..', '..', 'public/js/admin-dashboard/AdminShell.js'), 'utf8');

let AdminShell;

beforeAll(() => {
  // init() calls into sidebarDisclosure.js, which lives in a different file of the same bundle.
  global.initSidebarDisclosure = () => {};
  AdminShell = (0, eval)(`${SHELL_SRC}\nAdminShell;`);
});

/**
 * A page whose only section is hidden at load, as the dashboard's cross-city section is.
 *
 * @returns {HTMLElement} The hidden section, for the test to unhide.
 */
function buildDom() {
  document.body.innerHTML = `
    <nav class="page-toc"><ul></ul></nav>
    <div class="page-content">
      <div class="page-section" id="async-section" hidden>
        <h2 class="page-heading" id="cities">Cities you've mapped <a href="#cities" class="permalink">#</a></h2>
      </div>
    </div>`;
  return document.getElementById('async-section');
}

/** Fires a scroll event and lets the spy's requestAnimationFrame callback run. */
async function scrollAndSettle() {
  window.dispatchEvent(new Event('scroll'));
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const tocLinks = () => [...document.querySelectorAll('.page-toc ul a')];

describe('refreshTableOfContents', () => {
  test('lists a section that was hidden when the page loaded', () => {
    const section = buildDom();
    const shell = new AdminShell();
    shell.init();
    expect(tocLinks()).toHaveLength(0);

    section.hidden = false;
    shell.refreshTableOfContents();

    expect(tocLinks().map((a) => a.textContent)).toEqual(["Cities you've mapped"]);
  });

  test('starts the scroll-spy that had no headings to attach to at load', async () => {
    const section = buildDom();
    const shell = new AdminShell();
    shell.init();

    section.hidden = false;
    shell.refreshTableOfContents();
    await scrollAndSettle();

    expect(tocLinks().filter((a) => a.classList.contains('active'))).toHaveLength(1);
  });

  test('does not stack a second scroll listener on every rebuild', () => {
    const section = buildDom();
    const added = jest.spyOn(window, 'addEventListener');
    const shell = new AdminShell();
    shell.init();

    section.hidden = false;
    shell.refreshTableOfContents();
    shell.refreshTableOfContents();
    shell.refreshTableOfContents();

    expect(added.mock.calls.filter(([type]) => type === 'scroll')).toHaveLength(1);
    added.mockRestore();
  });

  test('drops the entry for a section that hides itself again', () => {
    const section = buildDom();
    const shell = new AdminShell();
    shell.init();
    section.hidden = false;
    shell.refreshTableOfContents();
    expect(tocLinks()).toHaveLength(1);

    section.hidden = true;
    shell.refreshTableOfContents();

    // A hidden heading reports offsetTop 0, which would wedge the spy on its own entry forever.
    expect(tocLinks()).toHaveLength(0);
  });
});
