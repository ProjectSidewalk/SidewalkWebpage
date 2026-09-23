/**
 * ESLint rule: an `i18next.t()` call that interpolates values and lands in an HTML sink must say, at the call site,
 * whether i18next escapes those values (#5389).
 *
 * `AppManager._setupI18next` sets `interpolation.escapeValue: false`, because the overwhelming majority of these
 * strings reach a text node, an `aria-label` or a `confirm()`, where escaping prints `&#39;` at the reader. The price
 * of that default is that a value bound for `innerHTML` is not escaped for free, so a street name out of OSM or a
 * story a labeler typed would reach markup verbatim. This rule is what keeps that from happening silently: in a
 * markup-shaped position the choice has to be written down, either way.
 *
 * **It is a tripwire, not a proof.** Measured against #5389's own audit — strip each `escapeValue: true` this
 * codebase carries and re-lint — it reproduces **19 of 45** decisions. The audit is the guarantee; this catches the
 * shapes a new call is most likely to take, and the blind spots below are why it cannot catch the rest.
 *
 * What counts as markup-shaped, syntactically:
 *   - the right-hand side of an assignment to `.innerHTML` / `.outerHTML`;
 *   - an argument to `.insertAdjacentHTML()`, `.setHTML()` (MapLibre popups), `.html()`, `.appendTo()`,
 *     `.prependTo()`, `.insertAfter()`, `.insertBefore()`, `.wrap()`, `.wrapInner()`, or to `$()` / `jQuery()`;
 *   - an argument to `.append()`, `.prepend()`, `.before()`, `.after()`, `.replaceWith()` **on a jQuery-shaped
 *     receiver only** — the native DOM methods of those names insert text, and so do `URLSearchParams.append` and
 *     `FormData.append`;
 *   - `setAttribute('data-ps-tooltip', …)` / `.attr('data-ps-tooltip', …)`, since `psTooltip.js` writes that
 *     attribute into the tooltip card's `innerHTML`;
 *   - any of the above reached through a template literal, a `+` concatenation, a ternary, a pass-through string
 *     method (`replace`, `slice`, `toUpperCase`, …), an array literal or a `map`/`flatMap` callback that is
 *     joined, or a local variable whose reads all live in the same function.
 *
 * What it deliberately does NOT catch, because a syntactic rule cannot follow it without guessing:
 *   - a string returned from an ordinary function whose caller builds the markup (`streetTitle()` in AccessScore's
 *     map) — this is why `access-score/src/main.js` contributes 0 of its 15 decisions;
 *   - a string stored on an object property or `this`, and rendered by something else later;
 *   - a string handed to a helper that inserts HTML itself (`showAlert()`, `PopUpMessage.notify()`);
 *   - a jQuery object reached by a name that does not look like one (`menuUI.template.parent().append(…)`);
 *   - an attribute that is markup only because of how it is initialized elsewhere — a `title` on a Bootstrap
 *     tooltip built with `html: true` (`RibbonMenu.js`), which no attribute name can distinguish from a plain one;
 *   - `i18next.t` behind an alias or a wrapper, `i18next?.t(…)`, or `el['innerHTML'] = …`.
 * Those flows were audited by hand once, in #5389; `docs/internationalization.md` carries the rule a reviewer
 * applies to a new one. Widening this rule to chase them would mean either cross-file type inference or an
 * allowlist of "HTML-ish" helper names, and an allowlist that drifts is worse than a documented boundary.
 *
 * @see docs/internationalization.md ("Interpolated values and HTML")
 */

'use strict';

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

/** Methods whose string argument is parsed as HTML whatever the receiver is. */
const MARKUP_METHODS = new Set([
  'html', 'insertAdjacentHTML', 'setHTML', 'appendTo', 'prependTo', 'insertAfter', 'insertBefore', 'wrap',
  'wrapInner',
]);

/**
 * Methods that parse HTML on a jQuery object and insert *text* on a native one — `Element.append`, `before`,
 * `after`, `replaceWith`, and `URLSearchParams`/`FormData.append`, which are not markup at all. They only count
 * with a jQuery-shaped receiver: telling someone at a text sink to turn escaping on is the very bug #5389 fixed.
 */
const JQUERY_MARKUP_METHODS = new Set(['append', 'prepend', 'before', 'after', 'replaceWith']);

/** Element properties whose assigned value is parsed as HTML. */
const MARKUP_PROPERTIES = new Set(['innerHTML', 'outerHTML']);

/** Attributes this codebase renders as HTML rather than text. */
const MARKUP_ATTRIBUTES = new Set(['data-ps-tooltip']);

/** String methods that pass their receiver's or argument's text straight through to whatever consumes the result. */
const PASS_THROUGH_METHODS = new Set([
  'join', 'trim', 'trimStart', 'trimEnd', 'toString', 'concat', 'toUpperCase', 'toLowerCase', 'replace',
  'replaceAll', 'slice', 'substring', 'substr', 'padStart', 'padEnd', 'normalize', 'repeat',
]);

/** Array methods whose callback's return value ends up in the array the call produces. */
const CALLBACK_RESULT_METHODS = new Set(['map', 'flatMap']);

/** How many variable hops to follow before giving up; deep chains are rewritten, not linted around. */
const MAX_DEPTH = 6;

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

/**
 * Whether an expression looks like a jQuery object rather than a DOM node.
 *
 * `$(…)` / `jQuery(…)`, a `$`-prefixed name (`$tagDiv`, `this.#$holder`), or a chain off either — the conventions
 * this codebase actually writes. A jQuery object reached some other way (`menuUI.template.parent()`) reads as
 * native here, so the rule stays quiet rather than reporting a sink it cannot identify.
 *
 * @param {object} node - The receiver of the method call.
 * @param {number} depth - Chain links walked so far.
 * @returns {boolean} True when the receiver is jQuery-shaped.
 */
function isJQueryReceiver(node, depth = 0) {
  if (!node || depth > 6) return false;
  switch (node.type) {
    case 'Identifier': case 'PrivateIdentifier':
      return node.name.startsWith('$');
    case 'CallExpression':
      if (node.callee.type === 'Identifier') return node.callee.name === '$' || node.callee.name === 'jQuery';
      return node.callee.type === 'MemberExpression' && isJQueryReceiver(node.callee.object, depth + 1);
    case 'MemberExpression':
      if (!node.computed && isJQueryReceiver(node.property, depth + 1)) return true;
      return isJQueryReceiver(node.object, depth + 1);
    default:
      return false;
  }
}

/**
 * Whether a string literal names an attribute this codebase renders as HTML.
 *
 * @param {object} node - The argument holding the attribute name.
 * @returns {boolean} True for `data-ps-tooltip` and friends.
 */
function isMarkupAttributeName(node) {
  return node && node.type === 'Literal' && MARKUP_ATTRIBUTES.has(node.value);
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
    const sourceCode = context.sourceCode;

    /**
     * Whether the value produced at `node` reaches an HTML sink, following it up through the expressions that just
     * carry it along and through the local variables it is parked in.
     *
     * @param {object} node - The expression whose destination is in question.
     * @param {number} depth - Hops spent so far; the walk stops at MAX_DEPTH.
     * @param {Set<object>} seen - Variables already followed, so a self-referential `x = f(x)` terminates.
     * @returns {boolean} True when some path from here ends in markup.
     */
    function reachesMarkup(node, depth, seen) {
      if (depth > MAX_DEPTH) return false;
      const parent = node.parent;
      if (!parent) return false;

      switch (parent.type) {
        // Carriers: the value is still on its way somewhere.
        case 'TemplateLiteral':
        case 'BinaryExpression':
        case 'ConditionalExpression':
        case 'LogicalExpression':
        case 'SequenceExpression':
        case 'ArrayExpression':
          return reachesMarkup(parent, depth + 1, seen);

        case 'AssignmentExpression': {
          if (parent.right !== node) return false;
          const left = parent.left;
          if (left.type === 'MemberExpression' && !left.computed && left.property.type === 'Identifier') {
            if (MARKUP_PROPERTIES.has(left.property.name)) return true;
            return false;
          }
          if (left.type === 'Identifier') return variableReachesMarkup(left, depth, seen);
          return false;
        }

        case 'VariableDeclarator':
          return parent.init === node && parent.id.type === 'Identifier'
            ? variableReachesMarkup(parent.id, depth, seen)
            : false;

        // `[…].join('')` and `s.trim()`: the receiver's value carries on into whatever consumes the call.
        case 'MemberExpression': {
          if (parent.object !== node || parent.computed || parent.property.type !== 'Identifier') return false;
          const call = parent.parent;
          if (!call || call.type !== 'CallExpression' || call.callee !== parent) return false;
          return PASS_THROUGH_METHODS.has(parent.property.name) ? reachesMarkup(call, depth + 1, seen) : false;
        }

        // `xs.map((x) => `<li>${…}</li>`).join('')`: the callback's result becomes the array the chain consumes.
        case 'ArrowFunctionExpression':
          return parent.body === node ? callbackResultReachesMarkup(parent, depth, seen) : false;

        case 'ReturnStatement': {
          const fn = enclosingFunction(parent);
          return fn ? callbackResultReachesMarkup(fn, depth, seen) : false;
        }

        case 'CallExpression': {
          if (parent.callee === node) return false;
          const callee = parent.callee;
          if (callee.type === 'Identifier') return callee.name === '$' || callee.name === 'jQuery';
          if (callee.type !== 'MemberExpression' || callee.computed || callee.property.type !== 'Identifier') {
            return false;
          }
          const method = callee.property.name;
          if (MARKUP_METHODS.has(method)) return true;
          if (JQUERY_MARKUP_METHODS.has(method)) return isJQueryReceiver(callee.object);
          // `setAttribute('data-ps-tooltip', tip)` and jQuery's `.attr(…)` twin: markup only for those attributes.
          if ((method === 'setAttribute' || method === 'attr') && parent.arguments[1] === node) {
            return isMarkupAttributeName(parent.arguments[0]);
          }
          // `parts.push(html)` keeps the value alive in `parts`, which is usually joined into markup next.
          if (method === 'push' && callee.object.type === 'Identifier') {
            return variableReachesMarkup(callee.object, depth, seen);
          }
          if (PASS_THROUGH_METHODS.has(method)) return reachesMarkup(parent, depth + 1, seen);
          return false;
        }

        default:
          return false;
      }
    }

    /**
     * The function a statement belongs to, or null at the top level.
     *
     * @param {object} node - Any node inside the function.
     * @returns {?object} The nearest enclosing function node.
     */
    function enclosingFunction(node) {
      for (let n = node.parent; n; n = n.parent) {
        if (n.type === 'FunctionExpression' || n.type === 'ArrowFunctionExpression'
            || n.type === 'FunctionDeclaration') {
          return n;
        }
      }
      return null;
    }

    /**
     * Whether a callback's return value reaches markup through the `map`/`flatMap` call it was passed to.
     *
     * Only those two: a value returned from an ordinary function goes to a caller this rule cannot see, which stays
     * a documented blind spot. `xs.map(cb).join('')` into `innerHTML` is the codebase's idiom for building a list,
     * so it is worth following the one hop.
     *
     * @param {object} fn - The callback function node.
     * @param {number} depth - Hops spent so far.
     * @param {Set<object>} seen - Variables already followed.
     * @returns {boolean} True when the call's result ends in markup.
     */
    function callbackResultReachesMarkup(fn, depth, seen) {
      const call = fn.parent;
      if (!call || call.type !== 'CallExpression' || !call.arguments.includes(fn)) return false;
      const callee = call.callee;
      if (callee.type !== 'MemberExpression' || callee.computed || callee.property.type !== 'Identifier') return false;
      if (!CALLBACK_RESULT_METHODS.has(callee.property.name)) return false;
      return reachesMarkup(call, depth + 1, seen);
    }

    /**
     * Whether any read of the variable `identifier` names reaches an HTML sink. Uses real scope analysis, so this
     * stops at the function boundary rather than matching a same-named variable elsewhere in the file.
     *
     * @param {object} identifier - The Identifier node the value was assigned to.
     * @param {number} depth - Hops spent so far.
     * @param {Set<object>} seen - Variables already followed.
     * @returns {boolean} True when some read of it ends in markup.
     */
    function variableReachesMarkup(identifier, depth, seen) {
      const variable = sourceCode.getScope(identifier).references
        .find((ref) => ref.identifier === identifier)?.resolved
        ?? sourceCode.getScope(identifier).variables.find((v) => v.name === identifier.name);
      if (!variable || seen.has(variable)) return false;
      seen.add(variable);
      return variable.references.some((ref) => ref.isRead() && reachesMarkup(ref.identifier, depth + 1, seen));
    }

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression' || callee.computed) return;
        if (callee.object.type !== 'Identifier' || callee.object.name !== 'i18next') return;
        if (callee.property.type !== 'Identifier' || callee.property.name !== 't') return;
        const options = node.arguments[1];
        if (!interpolatesValues(options) || declaresEscapeValue(options)) return;
        if (reachesMarkup(node, 0, new Set())) context.report({ node, messageId: 'missing' });
      },
    };
  },
};
