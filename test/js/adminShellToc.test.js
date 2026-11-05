/**
 * Tests for AdminShell's "On this page" list and its scroll-spy across an async section's arrival (#4496).
 *
 * A section that loads after the page (the dashboard's cross-city breakdown) starts hidden, so it is absent from the
 * TOC built at load and calls refreshTableOfContents() once it renders. The edge worth pinning is the page whose only
 * headings arrive that way: at load there was nothing to spy on, so the listener was never attached, and the rebuilt
 * TOC would look right while never highlighting anything.
 */

import { loadModules } from './loader.js';

const { AdminShell } = await loadModules('frontend/js/admin-dashboard/AdminShell.js');

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

    expect(tocLinks().filter((a) => a.classList.contains('is-active'))).toHaveLength(1);
  });

  test('does not stack a second scroll listener on every rebuild', () => {
    const section = buildDom();
    const added = vi.spyOn(window, 'addEventListener');
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

describe('building the contents list', () => {
  /** A page with a section, a subsection, and a dialog heading that must stay out of the list. */
  function buildPage() {
    document.body.innerHTML = `
      <nav class="page-toc"><ul></ul></nav>
      <div class="page-content">
        <h2 class="page-heading" id="streets">Streets <a href="#streets" class="permalink">#</a></h2>
        <h3 class="page-heading" id="by-region">By region <a href="#by-region" class="permalink">#</a></h3>
        <h2 class="page-heading" id="labels">Labels <a href="#labels" class="permalink">#</a></h2>
        <dialog hidden><h2 class="page-heading" id="create-team">Create a team</h2></dialog>
        <a class="permalink" id="dead-link" href="#nowhere">#</a>
      </div>`;
  }

  test('lists sections and subsections at their own levels, without the permalink mark', () => {
    buildPage();
    new AdminShell().init();
    expect(tocLinks().map((a) => [a.textContent, a.getAttribute('href'), a.classList[0]])).toEqual([
      ['Streets', '#streets', 'toc-level-1'],
      ['By region', '#by-region', 'toc-level-2'],
      ['Labels', '#labels', 'toc-level-1'],
    ]);
  });

  test('hides the contents box on a page with no sections, and brings it back when one appears', () => {
    const section = buildDom();
    const shell = new AdminShell();
    shell.init();
    const toc = document.querySelector('.page-toc');
    expect(toc.style.display).toBe('none');
    section.hidden = false;
    shell.refreshTableOfContents();
    expect(toc.style.display).toBe('');
  });

  test('does nothing on a page without the content column', () => {
    document.body.innerHTML = '<nav class="page-toc"><ul></ul></nav><main></main>';
    new AdminShell().init();
    expect(tocLinks()).toHaveLength(0);
  });

  test('still wires the page when it has no contents box', () => {
    document.body.innerHTML = `
      <div class="page-content"><h2 class="page-heading" id="streets">Streets</h2></div>`;
    expect(() => new AdminShell().init()).not.toThrow();
  });

  test('highlights the last section scrolled past', async () => {
    buildPage();
    const tops = { streets: 100, 'by-region': 400, labels: 900 };
    for (const [id, top] of Object.entries(tops)) {
      Object.defineProperty(document.getElementById(id), 'offsetTop', { value: top, configurable: true });
    }
    new AdminShell().init();
    Object.defineProperty(window, 'scrollY', { value: 400, configurable: true, writable: true });
    await scrollAndSettle();
    expect(tocLinks().map((a) => a.classList.contains('is-active'))).toEqual([false, true, false]);
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true, writable: true });
  });

  describe('jumping to a section', () => {
    let reduceMotion;

    beforeEach(() => {
      reduceMotion = false;
      vi.stubGlobal('matchMedia', () => ({ matches: reduceMotion }));
      vi.stubGlobal('scrollTo', vi.fn());
    });

    test('scrolls the heading clear of the navbar and puts it in the address', () => {
      buildPage();
      Object.defineProperty(document.getElementById('labels'), 'offsetTop', { value: 900, configurable: true });
      new AdminShell().init();
      const event = new MouseEvent('click', { bubbles: true, cancelable: true });
      tocLinks()[2].dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(window.scrollTo).toHaveBeenCalledWith({ top: 842, behavior: 'smooth' });
      expect(window.location.hash).toBe('#labels');
    });

    test('jumps without animating for a reader who prefers reduced motion', () => {
      reduceMotion = true;
      buildPage();
      new AdminShell().init();
      document.querySelector('.page-content a.permalink[href="#streets"]').click();
      expect(window.scrollTo).toHaveBeenCalledWith({ top: -58, behavior: 'auto' });
    });

    test('leaves a link to a missing section to the browser', () => {
      buildPage();
      new AdminShell().init();
      const event = new MouseEvent('click', { bubbles: true, cancelable: true });
      document.getElementById('dead-link').dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
      expect(window.scrollTo).not.toHaveBeenCalled();
    });
  });
});

describe('the deployment strip', () => {
  test('shows a release date in UTC and a deploy time in the reader\'s zone, leaving an unreadable one alone', () => {
    document.body.innerHTML = `
      <div class="page-content"></div>
      <div class="deploy-strip">
        <time id="release" datetime="2026-08-20T03:00:00Z" data-format="date">2026-08-20</time>
        <time id="deployed" datetime="2026-08-20T03:00:00Z">2026-08-20T03:00:00Z</time>
        <time id="broken" datetime="whenever">whenever</time>
      </div>`;
    new AdminShell().init();
    // Pacific time, where 03:00 UTC is still the evening before.
    expect(document.getElementById('release').textContent).toBe('Aug 20, 2026');
    expect(document.getElementById('deployed').textContent).toBe('Aug 19, 2026, 8:00 PM');
    expect(document.getElementById('broken').textContent).toBe('whenever');
  });
});

describe('page start-up', () => {
  test('builds the shell once the page has loaded and keeps it where async sections can reach it', () => {
    document.body.innerHTML = `
      <nav class="page-toc"><ul></ul></nav>
      <div class="page-content"><h2 class="page-heading" id="streets">Streets</h2></div>`;
    delete window.adminShell;
    document.dispatchEvent(new Event('DOMContentLoaded'));
    expect(window.adminShell).toBeInstanceOf(AdminShell);
    expect(tocLinks().map((a) => a.textContent)).toEqual(['Streets']);
  });
});
