/**
 * Marks where the reader is in a server-rendered table of contents. The links are already there and already work, so a
 * page keeps its contents without this.
 *
 * It watches a thin band near the top of the viewport rather than comparing `offsetTop`s on scroll, because a page's
 * offsets go stale as lazy photos and maps load above the section being read.
 */
export class PageToc {
  /** @type {?IntersectionObserver} */ #observer = null;
  /** @type {Set<Element>} The sections in the band now. */ #inBand = new Set();
  /** @type {?HTMLAnchorElement} */ #active = null;
  /** @type {HTMLElement} */ #nav;

  /**
   * @param {HTMLElement} nav - The contents; each `a[href^="#"]` inside names the section it stands for.
   * @param {object} [options]
   * @param {number} [options.topOffsetPx=0] - Height covered at the top of the viewport, such as a sticky navbar.
   * @param {number} [options.bandFraction=0.25] - How far down the rest of the viewport the band reaches.
   */
  constructor(nav, { topOffsetPx = 0, bandFraction = 0.25 } = {}) {
    this.#nav = nav;
    /** @type {Map<Element, HTMLAnchorElement>} */
    const targets = new Map();
    for (const link of nav.querySelectorAll('a[href^="#"]')) {
      const anchor = /** @type {HTMLAnchorElement} */ (link);
      const target = document.getElementById(decodeURIComponent(anchor.hash.slice(1)));
      if (target) targets.set(target, anchor);
    }
    if (typeof IntersectionObserver !== 'function') return;

    this.#observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) this.#inBand.add(entry.target);
        else this.#inBand.delete(entry.target);
      }
      this.#markLast(targets);
    }, { rootMargin: `-${topOffsetPx}px 0px -${Math.round((1 - bandFraction) * 100)}% 0px` });
    for (const target of targets.keys()) this.#observer.observe(target);
  }

  /**
   * Marks the last section in the band, in document order, since a parent and its first child can be there together
   * and the child is the more exact answer. With nothing in the band the last mark stands: a reader between two
   * sections hasn't left the one above.
   * @param {Map<Element, HTMLAnchorElement>} targets - Each section's link, in document order.
   */
  #markLast(targets) {
    let last = null;
    for (const [target, link] of targets) if (this.#inBand.has(target)) last = link;
    if (last) this.#setActive(last);
  }

  /** @param {HTMLAnchorElement} link - The contents entry to mark current. */
  #setActive(link) {
    if (link === this.#active) return;
    this.#active?.classList.remove('is-active');
    this.#active?.removeAttribute('aria-current');
    link.classList.add('is-active');
    link.setAttribute('aria-current', 'location');
    this.#active = link;
    this.#keepInView(link);
  }

  /**
   * Scrolls only the contents' own column. `scrollIntoView` would also move the page, fighting the reader's scroll.
   * @param {HTMLElement} link - The entry to keep visible.
   */
  #keepInView(link) {
    const nav = this.#nav.getBoundingClientRect();
    const entry = link.getBoundingClientRect();
    if (entry.top < nav.top) this.#nav.scrollTop -= nav.top - entry.top + entry.height;
    else if (entry.bottom > nav.bottom) this.#nav.scrollTop += entry.bottom - nav.bottom + entry.height;
  }

  /** @returns {?HTMLAnchorElement} The entry marked current. */
  get active() {
    return this.#active;
  }

  /** Stops watching. */
  destroy() {
    this.#observer?.disconnect();
  }
}
