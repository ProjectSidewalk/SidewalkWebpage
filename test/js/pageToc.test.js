import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageToc } from '../../frontend/js/common/PageToc.js';

/** @returns {HTMLElement} A contents list over three sections, one link pointing at nothing. */
function buildPage() {
  document.body.innerHTML = `
    <nav id="toc">
      <a id="l-a" href="#a">A</a><a id="l-b" href="#b">B</a><a id="l-c" href="#c">C</a><a id="l-x" href="#missing">X</a>
    </nav>
    <section id="a"></section><section id="b"></section><section id="c"></section>`;
  return document.getElementById('toc');
}

describe('PageToc', () => {
  let observer;

  beforeEach(() => {
    observer = null;
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback, options) {
        this.callback = callback;
        this.options = options;
        this.observed = [];
        observer = this;
      }

      observe(el) { this.observed.push(el); }

      disconnect() { this.disconnected = true; }
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  const report = (id, isIntersecting) => observer.callback([{ target: document.getElementById(id), isIntersecting }]);

  it('watches only sections that exist, below the sticky navbar', () => {
    new PageToc(buildPage(), { topOffsetPx: 60 });
    expect(observer.observed.map((el) => el.id)).toEqual(['a', 'b', 'c']);
    expect(observer.options.rootMargin).toBe('-60px 0px -75% 0px');
  });

  it('marks the section in the band as current, for sight and for a screen reader', () => {
    const toc = new PageToc(buildPage());
    report('a', true);
    expect(toc.active.id).toBe('l-a');
    expect(toc.active.classList.contains('is-active')).toBe(true);
    expect(toc.active.getAttribute('aria-current')).toBe('location');
  });

  it('moves the mark rather than adding a second one', () => {
    new PageToc(buildPage());
    report('a', true);
    report('a', false);
    report('b', true);
    expect(document.querySelectorAll('.is-active')).toHaveLength(1);
    expect(document.getElementById('l-a').hasAttribute('aria-current')).toBe(false);
    expect(document.getElementById('l-b').classList.contains('is-active')).toBe(true);
  });

  it('prefers the later section when two share the band, whatever order they arrived in', () => {
    const toc = new PageToc(buildPage());
    report('c', true);
    report('b', true);
    expect(toc.active.id).toBe('l-c');
  });

  it('keeps the last mark while the reader is between sections', () => {
    const toc = new PageToc(buildPage());
    report('b', true);
    report('b', false);
    expect(toc.active.id).toBe('l-b');
  });

  it('leaves the links working where the browser has no IntersectionObserver', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const toc = new PageToc(buildPage());
    expect(toc.active).toBeNull();
    expect(() => toc.destroy()).not.toThrow();
  });

  it('scrolls only its own column to bring the current entry into view, up or down', () => {
    const nav = buildPage();
    const rect = (top, height) => () => ({ top, bottom: top + height, height });
    nav.getBoundingClientRect = rect(100, 200); // The column shows 100–300.
    document.getElementById('l-c').getBoundingClientRect = rect(320, 20); // Below the column's bottom.
    document.getElementById('l-a').getBoundingClientRect = rect(40, 20); // Above its top.
    document.getElementById('l-b').getBoundingClientRect = rect(150, 20); // Already in view.
    nav.scrollTop = 500;
    new PageToc(nav);

    report('c', true);
    expect(nav.scrollTop).toBe(500 + (340 - 300) + 20);
    report('c', false);
    report('b', true);
    expect(nav.scrollTop).toBe(560);
    report('b', false);
    report('a', true);
    expect(nav.scrollTop).toBe(560 - (100 - 40) - 20);
  });

  it('stops watching when destroyed', () => {
    const toc = new PageToc(buildPage());
    toc.destroy();
    expect(observer.disconnected).toBe(true);
  });
});
