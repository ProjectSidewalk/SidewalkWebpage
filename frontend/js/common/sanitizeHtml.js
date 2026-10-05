/**
 * Makes markup we didn't fully write safe to show. DOMParser is used because it never runs scripts or loads images.
 */

// Dropped with their contents: they run code, embed a page, restyle the whole page, ask for input, or (SVG animation)
// rewrite a link after cleaning. Lower case because SVG names keep their case and are compared lower-cased.
const DROPPED_TAGS = new Set([
  'script', 'noscript', 'template', 'style', 'link', 'meta', 'base', 'iframe', 'frame', 'frameset', 'object', 'embed',
  'form', 'input', 'textarea', 'select', 'math', 'animate', 'set', 'animatemotion', 'animatetransform',
]);

// Browsers ignore spaces and control characters inside a scheme, so those are dropped before this is tested.
const SCRIPT_URL = /^(javascript|vbscript|data):/i;

// Pictures are the one thing a data: address may carry.
const DATA_IMAGE_URL = /^data:image\/(png|gif|jpeg|webp);/i;

/**
 * @param {?string} html - Markup, e.g. a translation that carries inline formatting.
 * @returns {string} The text a reader would see, with entities like `&amp;` decoded.
 */
export function htmlToText(html) {
  return new DOMParser().parseFromString(String(html ?? ''), 'text/html').body.textContent;
}

/**
 * Cleans markup so it can be put on the page without running anyone's code. Returns nodes, not a string: parsing the
 * cleaned text a second time can change its meaning ("mutation XSS"), so callers append these directly.
 *
 * @param {?string} html - Markup to clean.
 * @param {object} [options]
 * @param {Set<string>} [options.tags] - Upper-case tag names to keep; every safe element is kept when omitted.
 * @param {Set<string>} [options.attributes] - Attribute names to keep; every safe attribute is kept when omitted.
 * @returns {DocumentFragment} The cleaned nodes.
 */
export function sanitizeHtml(html, { tags = null, attributes = null } = {}) {
  const body = new DOMParser().parseFromString(String(html ?? ''), 'text/html').body;
  const clean = (el) => {
    // Depth-first so an element's children are already clean by the time unwrapping hoists them into its place.
    for (const child of [...el.children]) clean(child);
    if (DROPPED_TAGS.has(el.localName.toLowerCase())) {
      el.remove();
      return;
    }
    if (tags && !tags.has(el.tagName)) {
      el.replaceWith(...el.childNodes);
      return;
    }
    for (const attr of [...el.attributes]) {
      const value = [...attr.value].filter((c) => c > ' ').join('');
      const isScriptUrl = SCRIPT_URL.test(value) && !(attr.name === 'src' && DATA_IMAGE_URL.test(value));
      const isAllowed = !attributes || attributes.has(attr.name);
      if (attr.name.toLowerCase().startsWith('on') || isScriptUrl || !isAllowed) el.removeAttribute(attr.name);
    }
  };
  for (const child of [...body.children]) clean(child);
  const fragment = document.createDocumentFragment();
  fragment.append(...body.childNodes);
  return fragment;
}
