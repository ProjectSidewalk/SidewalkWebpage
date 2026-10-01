/**
 * ESLint rule: an `i18next.t()` call that interpolates values and lands in an HTML sink must say, at the call site,
 * whether i18next escapes those values (#5389).
 *
 * `AppManager._setupI18next` turns `interpolation.escapeValue` off site-wide, because nearly every translated string
 * reaches a text node, an `aria-label` or a `confirm()`, where escaping would print `&#39;` at the reader. The cost
 * is that a value bound for `innerHTML` (a street name from OSM, a story a labeler typed) is not escaped for free,
 * so in a markup-shaped position the choice has to be written down, either way.
 *
 * "Lands in an HTML sink" is worked out by markup-flow.js, shared with the escape-in-markup rule.
 *
 * It is a tripwire, not a proof. It follows syntax only, so a string returned from a function, parked on an object
 * property, handed to a helper that inserts HTML (`showAlert()`), or produced by an alias of `i18next.t` goes
 * unseen. Those flows are reviewed by hand (docs/internationalization.md, "Interpolated values and HTML"); widening
 * the rule to guess at them would need cross-file inference or an allowlist that drifts.
 */

'use strict';

const { createMarkupFlow } = require('./markup-flow');

/**
 * i18next's own option keys: anything else in the options object is an interpolation variable.
 *
 * `count` is deliberately absent — it selects the plural form *and* interpolates as `{{count}}` — and `replace` is
 * absent because it is the explicit bag of interpolation values.
 *
 * @see https://www.i18next.com/translation-function/essentials
 */
const I18NEXT_OPTION_KEYS = new Set([
  'ns', 'lng', 'lngs', 'fallbackLng', 'defaultValue', 'context', 'ordinal', 'returnObjects', 'returnDetails',
  'returnedObjectHandler', 'joinArrays', 'postProcess', 'interpolation', 'skipInterpolation', 'nsSeparator',
  'keySeparator', 'parseMissingKeyHandler',
]);

/**
 * Whether an options object argument carries at least one interpolation variable.
 *
 * A spread counts: `{ ...vars }` is how the wrappers pass a caller's values through, and its contents are unknowable
 * here, so it is treated as interpolating.
 *
 * @param {object} node - The second argument to `i18next.t`, whatever its type.
 * @returns {boolean} True when the call interpolates something.
 */
function interpolatesValues(node) {
  if (!node) return false;
  if (node.type !== 'ObjectExpression') return true; // A variable or call: assume it carries values.
  return node.properties.some((prop) => {
    if (prop.type === 'SpreadElement') return true;
    if (prop.computed) return true; // A computed key can be anything, including a variable name.
    const name = prop.key.type === 'Identifier' ? prop.key.name : prop.key.value;
    return !I18NEXT_OPTION_KEYS.has(name);
  });
}

/**
 * Whether the call already states `interpolation.escapeValue`, whichever way it states it.
 *
 * @param {object} node - The second argument to `i18next.t`, whatever its type.
 * @returns {boolean} True when the decision is written at the call site.
 */
function declaresEscapeValue(node) {
  if (!node || node.type !== 'ObjectExpression') return false;
  return node.properties.some((prop) => {
    if (prop.type === 'SpreadElement' || prop.computed) return false;
    const name = prop.key.type === 'Identifier' ? prop.key.name : prop.key.value;
    if (name !== 'interpolation') return false;
    if (prop.value.type !== 'ObjectExpression') return true; // Passed as a whole object; trust the caller.
    return prop.value.properties.some((inner) => {
      if (inner.type === 'SpreadElement') return true;
      const innerName = inner.key.type === 'Identifier' ? inner.key.name : inner.key.value;
      return innerName === 'escapeValue';
    });
  });
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'require an explicit interpolation.escapeValue on an i18next.t() call that builds HTML',
    },
    schema: [],
    messages: {
      missing: 'This i18next.t() interpolates values into HTML. Say so at the call site: add '
        + '`interpolation: { escapeValue: true }` to escape them, or `interpolation: { escapeValue: false }` with a '
        + 'comment saying why they are already safe (escaped at the sink, or trusted markup of ours). If the sink '
        + 'is really a text one, say `escapeValue: false` and why — turning escaping on there is what prints '
        + '"Al &#39;Ummah" at the reader.',
    },
  },

  create(context) {
    const reachesMarkup = createMarkupFlow(context.sourceCode);

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression' || callee.computed) return;
        if (callee.object.type !== 'Identifier' || callee.object.name !== 'i18next') return;
        if (callee.property.type !== 'Identifier' || callee.property.name !== 't') return;
        const options = node.arguments[1];
        if (!interpolatesValues(options) || declaresEscapeValue(options)) return;
        if (reachesMarkup(node)) context.report({ node, messageId: 'missing' });
      },
    };
  },
};
