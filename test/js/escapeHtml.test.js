/**
 * Tests for util.escapeHTML, util.htmlToText and util.sanitizeHtml.
 */

import { loadModules } from './loader.js';

const { util } = await loadModules('frontend/js/common/utilities.js');

describe('util.escapeHTML', () => {
  test('escapes every character that could break out of markup', () => {
    expect(util.escapeHTML(`<script>alert("x") & 'y'</script>`))
      .toBe('&lt;script&gt;alert(&quot;x&quot;) &amp; &#39;y&#39;&lt;/script&gt;');
  });

  test('renders an absent value as empty rather than as the string "null"', () => {
    expect(util.escapeHTML(null)).toBe('');
    expect(util.escapeHTML(undefined)).toBe('');
  });

  test('stringifies other values, so a number or an id can be passed straight in', () => {
    expect(util.escapeHTML(0)).toBe('0');
    expect(util.escapeHTML(false)).toBe('false');
  });

  test('escapes ampersands before the entities it introduces, so they are not double-escaped', () => {
    expect(util.escapeHTML('&lt;')).toBe('&amp;lt;');
  });
});

describe('util.htmlToText', () => {
  test('drops tags and decodes entities', () => {
    expect(util.htmlToText('<tag-underline>S</tag-underline>teep &amp; narrow')).toBe('Steep & narrow');
  });

  test('treats null as empty', () => {
    expect(util.htmlToText(null)).toBe('');
  });
});

describe('util.sanitizeHtml', () => {
  /**
   * @param {DocumentFragment} fragment - What sanitizeHtml returned.
   * @returns {string} The fragment's markup, to compare against.
   */
  const markup = (fragment) => {
    const holder = document.createElement('div');
    holder.append(fragment);
    return holder.innerHTML;
  };

  test('treats null as nothing to show', () => {
    expect(markup(util.sanitizeHtml(null))).toBe('');
  });

  test('keeps a new-tab link but cuts its handle back to this page, and drops a form', () => {
    const html = '<a href="https://example.org" target="_blank">read</a><form><input name="password"></form>';
    expect(markup(util.sanitizeHtml(html)))
      .toBe('<a href="https://example.org" target="_blank" rel="noopener">read</a>');
  });
});
