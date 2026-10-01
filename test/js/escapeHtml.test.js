/**
 * Tests for util.escapeHTML, the one helper every page uses to put data into HTML as plain text.
 *
 * Runs under jsdom (jest.config.js).
 */

const { loadGlobalScript } = require('./loadGlobalScript');

loadGlobalScript('public/js/common/utilities.js');

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
