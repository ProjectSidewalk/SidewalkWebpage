/**
 * Shell behaviors for the redesigned admin dashboard (#4272): builds the right-hand "On this page" table of
 * contents from the page's headings, highlights the active section on scroll (scroll-spy), smooth-scrolls anchor
 * clicks past the fixed navbar, and provides a hamburger toggle for the left nav on narrow screens.
 *
 * This is a clean ES6 reimplementation of the equivalent api-docs.js logic, operating on the same .api-* markup so
 * the look and behavior match. It self-initializes on DOMContentLoaded.
 */
class AdminShell {
  /** Height of the fixed top navbar, in px; headings are offset by this so they aren't hidden when scrolled to. */
  static #NAVBAR_OFFSET = 58;

  #content;
  #tocList;
  #headings = [];
  #tocLinks = [];

  init() {
    this.#content = document.querySelector('.api-content');
    this.#tocList = document.querySelector('.api-toc ul');
    if (!this.#content) return;

    this.#buildTableOfContents();
    this.#setupScrollSpy();
    this.#setupSmoothScrolling();
    this.#setupMobileNav();
  }

  /**
     * Builds the TOC from the section headings (h2/h3.api-heading with ids) inside the main content area. Scoped to
     * .api-heading so headings inside closed <dialog>s (e.g. the dashboard's create-team dialog) stay out — a hidden
     * heading has offsetTop 0, which would also wedge the scroll-spy on its TOC entry forever.
     */
  #buildTableOfContents() {
    if (!this.#tocList) return;
    this.#headings = Array.from(this.#content.querySelectorAll('h2.api-heading[id], h3.api-heading[id]'));

    if (this.#headings.length === 0) {
      const toc = document.querySelector('.api-toc');
      if (toc) toc.style.display = 'none';
      return;
    }

    const frag = document.createDocumentFragment();
    for (const heading of this.#headings) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = `#${heading.id}`;
      a.textContent = heading.textContent.replace(/#$/, '').trim();
      a.classList.add(`toc-level-${heading.tagName === 'H2' ? 1 : 2}`);
      li.appendChild(a);
      frag.appendChild(li);
      this.#tocLinks.push(a);
    }
    this.#tocList.appendChild(frag);
  }

  /** Highlights the TOC entry for whichever heading is currently at the top of the viewport. */
  #setupScrollSpy() {
    if (this.#headings.length === 0) return;

    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        const scrollPos = window.scrollY + AdminShell.#NAVBAR_OFFSET + 20;
        let activeIndex = 0;
        for (let i = 0; i < this.#headings.length; i++) {
          if (this.#headings[i].offsetTop <= scrollPos) activeIndex = i;
        }
        this.#tocLinks.forEach((link, i) => link.classList.toggle('active', i === activeIndex));
        ticking = false;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  /** Smooth-scrolls clicks on TOC / in-page anchors, accounting for the fixed navbar. */
  #setupSmoothScrolling() {
    const anchors = document.querySelectorAll('.api-toc a[href^="#"], .api-content a.permalink[href^="#"]');
    anchors.forEach((anchor) => {
      anchor.addEventListener('click', (e) => {
        const id = anchor.getAttribute('href').slice(1);
        const target = document.getElementById(id);
        if (!target) return;
        e.preventDefault();
        const top = target.offsetTop - AdminShell.#NAVBAR_OFFSET;
        // Jump instantly for users who prefer reduced motion (WCAG 2.3.3).
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        window.scrollTo({ top, behavior: reduceMotion ? 'auto' : 'smooth' });
        history.replaceState(null, '', `#${id}`);
      });
    });
  }

  /** Adds a hamburger button (shown via CSS on narrow screens) that toggles the left nav. */
  #setupMobileNav() {
    const sidebar = document.querySelector('.api-sidebar');
    if (!sidebar || document.querySelector('.api-sidebar-toggle')) return;

    const toggle = document.createElement('button');
    toggle.className = 'api-sidebar-toggle';
    toggle.setAttribute('aria-label', 'Toggle navigation');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.innerHTML = '☰';
    toggle.addEventListener('click', () => {
      const open = sidebar.classList.toggle('mobile-visible');
      toggle.setAttribute('aria-expanded', String(open));
    });
    document.body.appendChild(toggle);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new AdminShell().init();
});
