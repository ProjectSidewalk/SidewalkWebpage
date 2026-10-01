/**
 * ESLint rule: a value interpolated into a template literal that ends up as HTML must be escaped, or be something
 * that can't carry markup (#5615).
 *
 * "Ends up as HTML" is worked out by markup-flow.js: `innerHTML`, `insertAdjacentHTML()`, an HTML-rendering helper
 * and friends, directly or through a variable, a joined `map()`, a ternary and so on. Each `${…}` in such a template
 * has to be one of:
 * - wrapped in `util.escapeHTML(…)`, or another call SAFE_CALLS trusts (asset paths, label-type data, translations);
 * - a number, a boolean, or arithmetic;
 * - a template, ternary, `&&`/`||`/`??` or `map(…).join()` whose parts all pass;
 * - a `const`, or a parameter or private field of this file, whose every value passes;
 * - a call to a function or private method of this file whose every return value passes.
 *
 * Inside a `data-ps-tooltip="…"` attribute written in markup, text is unescaped twice (once when the attribute is
 * parsed, once when psTooltip puts it into the tooltip's innerHTML), so there `util.escapeHTML(x)` passes only when
 * x is itself safe markup; plain text needs `AdminShell.tooltipAttr(…)`.
 *
 * Anything else (a property read off API data, a call into another file) is reported. When the value really is safe,
 * say why with an `eslint-disable-next-line ps/escape-in-markup -- <why>` comment.
 */

'use strict';

const { createMarkupFlow } = require('./markup-flow');

/** Calls whose result is safe to drop into HTML as-is, by their callee's source text. */
const SAFE_CALLS = new Set([
  'util.escapeHTML',
  'util.assetPath',
  'AdminShell.tooltipAttr',
  'encodeURIComponent',
  // Translations are our own text; the values they interpolate are the i18n-escape-in-markup rule's job.
  'i18next.t',
  'Number', 'parseInt', 'parseFloat',
  // Shared number and date formatters from other files.
  'AdminShell.num', 'AdminShell.dur', 'AccessScoreGradeRamp.percent', 'util.monthYear',
]);

/** Callee prefixes whose results are safe: number math, and label-type data that comes from our own backend. */
const SAFE_CALL_PREFIXES = ['Math.', 'util.misc.'];

/** Calls that escape their argument once, which is one level short inside a tooltip attribute. */
const ESCAPE_CALLS = new Set(['util.escapeHTML']);

/** Calls that escape their argument for a tooltip attribute, both levels. */
const TOOLTIP_ESCAPE_CALLS = new Set(['AdminShell.tooltipAttr']);

/**
 * Methods that format a number or a date, which prints no markup. `toLocaleString` is here although a string has
 * one too (handing the string back unchanged): in this codebase it is called on counts, and treating every
 * `count.toLocaleString()` as suspect would bury the real findings.
 */
const FORMAT_METHODS = new Set([
  'toFixed', 'toPrecision', 'toLocaleString', 'toLocaleDateString', 'toLocaleTimeString', 'toISOString',
  'toDateString',
]);

/** String and array methods whose result is only as safe as the value they are called on. */
const PASS_THROUGH_METHODS = new Set([
  'slice', 'substring', 'substr', 'trim', 'trimStart', 'trimEnd', 'toLowerCase', 'toUpperCase', 'repeat', 'at',
  'charAt', 'toString', 'normalize', 'reverse', 'filter', 'sort', 'flat',
]);

/** Methods that also put (some of) their arguments into the result, by the index the arguments start at. */
const ARG_CARRYING_METHODS = new Map([
  ['replace', 1], ['replaceAll', 1], ['padStart', 1], ['padEnd', 1], ['concat', 0], ['join', 0],
]);

/** Array methods whose callback gets an element of the array they are called on, then its index. */
const ELEMENT_CALLBACK_METHODS = new Set(['map', 'flatMap', 'forEach', 'filter', 'find', 'some', 'every']);

/** Array and Map/Set methods that change the collection they are called on. */
const MUTATING_METHODS = new Set([
  'push', 'unshift', 'splice', 'fill', 'copyWithin', 'set', 'add', 'sort', 'reverse',
]);

/** Property reads that are always safe: counts, and markup already in the page. */
const SAFE_PROPERTIES = new Set(['length', 'size', 'innerHTML', 'outerHTML']);

/** Operators whose result is a number or a boolean, whatever the operands. */
const NON_STRING_OPERATORS = new Set([
  '-', '*', '/', '%', '**', '|', '&', '^', '<<', '>>', '>>>', '<', '>', '<=', '>=', '==', '!=', '===', '!==', 'in',
  'instanceof',
]);

/** Parents a read of a collection can sit in without the collection being handed to other code. */
const PLAIN_READ_PARENTS = new Set([
  'TemplateLiteral', 'BinaryExpression', 'LogicalExpression', 'ConditionalExpression', 'UnaryExpression',
  'ChainExpression', 'IfStatement', 'ForOfStatement', 'ForInStatement', 'SwitchStatement', 'ExpressionStatement',
]);

/** Functions that read a collection passed to them without changing it. */
const READ_ONLY_FUNCTIONS = new Set([
  'Object.keys', 'Object.values', 'Object.entries', 'Array.isArray', 'Array.from', 'JSON.stringify', 'Math.max',
  'Math.min',
]);

/** How deep to follow variables, parameters and calls before giving up and calling the value unsafe. */
const MAX_DEPTH = 12;

/** Text before a `${…}` that leaves it inside a `data-ps-tooltip` attribute's quoted value. */
const IN_TOOLTIP_ATTRIBUTE = /data-ps-tooltip\s*=\s*(?:"[^"]*|'[^']*)$/;

/**
 * Calls `visit` on every node under `node`, without crossing into nested functions when `stopAtFunctions` is set.
 *
 * @param {object} node - Where to start.
 * @param {function(object): void} visit - Called once per node.
 * @param {boolean} stopAtFunctions - Whether to skip the bodies of nested functions.
 */
function walk(node, visit, stopAtFunctions) {
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'parent') continue;
    const child = node[key];
    for (const c of Array.isArray(child) ? child : [child]) {
      if (!c || typeof c.type !== 'string') continue;
      if (stopAtFunctions && /Function/.test(c.type)) continue;
      walk(c, visit, stopAtFunctions);
    }
  }
}

/**
 * Whether a node is a function expression or declaration.
 *
 * @param {?object} node - Any node.
 * @returns {boolean} True for the three function node types.
 */
function isFunction(node) {
  return !!node && /^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(node.type);
}

/**
 * Whether a variable's initial value is an array, object or `new` collection, whose contents can change later.
 *
 * @param {?object} init - The declaration's initial value.
 * @returns {boolean} True for a collection.
 */
function isCollection(init) {
  return !!init && /^(ArrayExpression|ObjectExpression|NewExpression)$/.test(init.type);
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'require values interpolated into HTML-bound template literals to be escaped',
    },
    schema: [],
    messages: {
      unescaped: 'This value goes into HTML unescaped. Wrap it in util.escapeHTML(…), or if it is markup of ours '
        + 'or can never hold markup, add `// eslint-disable-next-line ps/escape-in-markup -- <why>`.',
      tooltip: 'This text goes into a data-ps-tooltip attribute, which is unescaped twice. Use '
        + 'AdminShell.tooltipAttr(…) (or util.escapeHTML twice), or util.escapeHTML(…) once around markup whose own '
        + 'values are escaped.',
    },
  },

  create(context) {
    const sourceCode = context.sourceCode;
    const reachesMarkup = createMarkupFlow(sourceCode);
    const reported = new Set();
    // Per-function results, so a helper called from twenty templates is analyzed once, kept apart for the two
    // escaping levels. `null` marks "in progress", which a recursive helper reads as safe for the moment.
    const returnsCache = [new Map(), new Map()];
    // Set when a result leaned on an in-progress helper; such a result isn't cached, so it can't depend on which
    // helper happened to be analyzed first.
    let leanedOnCycle = false;
    const classMemberCache = new Map();

    /**
     * The parts of an expression that could put markup into HTML: an empty list means it is safe.
     *
     * @param {object} node - The expression.
     * @param {number} depth - Hops spent so far.
     * @param {boolean} tip - Whether the value lands in a tooltip attribute, where it is unescaped twice.
     * @returns {object[]} The offending nodes, which is where the report goes.
     */
    function unsafeParts(node, depth, tip) {
      if (depth > MAX_DEPTH) return [node];
      switch (node.type) {
        case 'Literal':
        case 'UnaryExpression':
        case 'UpdateExpression':
          return [];
        case 'TemplateLiteral':
          return node.expressions.flatMap((e) => unsafeParts(e, depth, tip));
        case 'ConditionalExpression':
          return [...unsafeParts(node.consequent, depth, tip), ...unsafeParts(node.alternate, depth, tip)];
        case 'LogicalExpression':
          // `a && b` only ever yields `a` when it is falsy (empty, null, 0…), which can't hold markup.
          if (node.operator === '&&') return unsafeParts(node.right, depth, tip);
          return [...unsafeParts(node.left, depth, tip), ...unsafeParts(node.right, depth, tip)];
        case 'BinaryExpression':
          if (NON_STRING_OPERATORS.has(node.operator)) return [];
          return [...unsafeParts(node.left, depth, tip), ...unsafeParts(node.right, depth, tip)];
        case 'ChainExpression':
          return unsafeParts(node.expression, depth, tip);
        case 'ArrayExpression':
          return node.elements.flatMap((e) => {
            if (!e) return [];
            return unsafeParts(e.type === 'SpreadElement' ? e.argument : e, depth, tip);
          });
        case 'MemberExpression':
          return memberParts(node, depth, tip);
        case 'CallExpression':
          return callParts(node, depth, tip);
        case 'Identifier':
          return identifierParts(node, depth, tip);
        default:
          return [node];
      }
    }

    /**
     * Moves each report to where the fix belongs. A value found by following a variable, parameter, field or return
     * value back to its source is reported where it was read, so the fix is a wrap at the HTML rather than a change
     * to a value other code may use as plain text. A part that sits in a template building HTML stays put, since
     * escaping there is the fix.
     *
     * @param {object[]} parts - The offending nodes found at the source.
     * @param {object} read - The node that brought the value into this template.
     * @returns {object[]} The nodes to report.
     */
    function anchor(parts, read) {
      const out = new Set(parts.map((p) => (inHtmlTemplate(p) ? p : read)));
      return [...out];
    }

    /**
     * Whether a node's value is what a `${…}` prints (directly or through a ternary branch, `&&`/`||`, a `+`, or a
     * method called on it) in a template that builds HTML: one with a tag in its text, or one that is itself
     * checked because it reaches markup. A template of plain text, like `${count} ${unit}`, doesn't count: what it
     * builds may be shown as text too, so the escape belongs where it enters HTML.
     *
     * @param {object} node - Any expression.
     * @returns {boolean} True when the escape belongs on this node.
     */
    function inHtmlTemplate(node) {
      let n = node;
      for (;;) {
        const p = n.parent;
        const carried = p && (p.type === 'LogicalExpression' || p.type === 'ChainExpression'
          || (p.type === 'ConditionalExpression' && p.test !== n)
          || (p.type === 'BinaryExpression' && p.operator === '+')
          || (p.type === 'MemberExpression' && p.object === n)
          || (p.type === 'CallExpression' && p.callee === n));
        if (!carried) {
          if (p?.type !== 'TemplateLiteral') return false;
          return p.quasis.some((q) => q.value.cooked?.includes('<')) || reachesMarkup(p);
        }
        n = p;
      }
    }

    /**
     * A property read: safe when it is a count, a field of a trusted call's result, a lookup into an object or array
     * literal whose values are safe, or a private field this class only ever sets to safe values.
     *
     * @param {object} node - The MemberExpression.
     * @param {number} depth - Hops spent so far.
     * @param {boolean} tip - Whether the value lands in a tooltip attribute.
     * @returns {object[]} The offending nodes.
     */
    function memberParts(node, depth, tip) {
      if (!node.computed && SAFE_PROPERTIES.has(node.property.name)) return [];
      // `util.misc.getLabelDescriptions(t).tagInfo[tag].text`: data from a trusted call, however deep.
      let base = node.object;
      while (base.type === 'MemberExpression') base = base.object;
      if (base.type === 'CallExpression' && trustedCallParts(base, depth, tip)?.length === 0) return [];
      // `s[0]`: a character of a safe string.
      if (node.computed && node.property.type === 'Literal' && typeof node.property.value === 'number') {
        if (unsafeParts(node.object, depth, tip).length === 0) return [];
      }
      const values = literalValues(node, depth);
      if (values) return anchor(values.flatMap((v) => unsafeParts(v, depth + 1, tip)), node);
      if (node.property.type === 'PrivateIdentifier') {
        const member = classMember(node, node.property.name);
        if (member?.kind === 'field' && member.writes) {
          return anchor(member.writes.flatMap((v) => unsafeParts(v, depth + 1, tip)), node);
        }
      }
      return [node];
    }

    /**
     * The callee a call names, seen through a `const esc = util.escapeHTML;` alias.
     *
     * @param {object} node - The CallExpression.
     * @returns {?string} The callee's source text, or null when it isn't a plain dotted name like `util.misc.x`.
     */
    function calleeName(node) {
      let callee = node.callee;
      if (callee.type === 'Identifier') {
        const variable = resolveVariable(callee);
        const def = variable?.defs.length === 1 ? variable.defs[0] : null;
        if (def?.type === 'Variable' && def.node.init?.type === 'MemberExpression' && !isReassigned(variable, def)) {
          callee = def.node.init;
        }
      }
      const name = sourceCode.getText(callee);
      return /^[\w$]+(\.[\w$]+)*$/.test(name) ? name : null;
    }

    /**
     * The unsafe parts of a call SAFE_CALLS / SAFE_CALL_PREFIXES vouches for, or null when it isn't one. A trusted
     * call is mostly safe outright; the exceptions are a translation's `defaultValue`, which is printed when the
     * key is missing, and an escape that is one level short inside a tooltip attribute.
     *
     * @param {object} node - The CallExpression.
     * @param {number} depth - Hops spent so far.
     * @param {boolean} tip - Whether the value lands in a tooltip attribute.
     * @returns {?object[]} The offending nodes, or null for an untrusted call.
     */
    function trustedCallParts(node, depth, tip) {
      const name = calleeName(node);
      if (!name || !(SAFE_CALLS.has(name) || SAFE_CALL_PREFIXES.some((prefix) => name.startsWith(prefix)))) {
        return null;
      }
      if (tip && ESCAPE_CALLS.has(name)) {
        return anchor(node.arguments.flatMap((a) => unsafeParts(a, depth, false)), node);
      }
      if (name === 'i18next.t' && node.arguments[1]?.type === 'ObjectExpression') {
        const fallback = node.arguments[1].properties
          .find((p) => p.type === 'Property' && !p.computed && p.key.name === 'defaultValue');
        if (fallback) return anchor(unsafeParts(fallback.value, depth, tip), node);
      }
      return [];
    }

    /**
     * A call: safe when trusted, a number formatter, a `map(…).join()` of safe parts, or a function of this file
     * that only returns safe values.
     *
     * @param {object} node - The CallExpression.
     * @param {number} depth - Hops spent so far.
     * @param {boolean} tip - Whether the value lands in a tooltip attribute.
     * @returns {object[]} The offending nodes.
     */
    function callParts(node, depth, tip) {
      const trusted = trustedCallParts(node, depth, tip);
      if (trusted) return trusted;
      const callee = node.callee;
      if (callee.type === 'Identifier' && callee.name === 'String' && !resolveVariable(callee)) {
        return node.arguments.flatMap((a) => unsafeParts(a, depth, tip));
      }
      if (callee.type === 'MemberExpression' && !callee.computed) {
        const method = callee.property.name;
        if (FORMAT_METHODS.has(method)) return [];
        if (PASS_THROUGH_METHODS.has(method) || ARG_CARRYING_METHODS.has(method)) {
          const carried = ARG_CARRYING_METHODS.has(method) ? node.arguments.slice(ARG_CARRYING_METHODS.get(method)) : [];
          return [callee.object, ...carried].flatMap((a) => {
            if (isFunction(a)) return returnParts(a, depth, tip);
            return unsafeParts(a.type === 'SpreadElement' ? a.argument : a, depth, tip);
          });
        }
        if ((method === 'map' || method === 'flatMap') && isFunction(node.arguments[0])) {
          return anchor(returnParts(node.arguments[0], depth, tip), node);
        }
      }
      const fn = resolveFunction(callee);
      if (fn) return anchor(returnParts(fn, depth, tip), node);
      // `COLUMNS[i].format(v)`: a function stored in an object literal of this file.
      const fns = callee.type === 'MemberExpression' ? literalValues(callee, depth + 1) : null;
      if (fns?.length && fns.every(isFunction)) return anchor(fns.flatMap((f) => returnParts(f, depth, tip)), node);
      return [node];
    }

    /**
     * The unsafe parts across everything a function can return.
     *
     * @param {object} fn - The function node.
     * @param {number} depth - Hops spent so far.
     * @param {boolean} tip - Whether the value lands in a tooltip attribute.
     * @returns {object[]} The offending nodes.
     */
    function returnParts(fn, depth, tip) {
      const cache = returnsCache[tip ? 1 : 0];
      if (cache.has(fn)) {
        const cached = cache.get(fn);
        if (cached === null) leanedOnCycle = true;
        return cached || [];
      }
      const outerLeaned = leanedOnCycle;
      leanedOnCycle = false;
      cache.set(fn, null);
      let parts;
      if (fn.body.type !== 'BlockStatement') {
        parts = unsafeParts(fn.body, depth + 1, tip);
      } else {
        parts = [];
        walk(fn.body, (n) => {
          if (n.type === 'ReturnStatement' && n.argument) parts.push(...unsafeParts(n.argument, depth + 1, tip));
        }, true);
      }
      if (leanedOnCycle) cache.delete(fn);
      else cache.set(fn, parts);
      leanedOnCycle = outerLeaned || leanedOnCycle;
      return parts;
    }

    /**
     * The values a read out of an object or array literal can produce, following `const`s to the literal:
     * `LABELS[key]` is any of LABELS's values, `META.foo.label` is just that one. Null when the chain doesn't end
     * in a literal.
     *
     * @param {object} node - The expression being read.
     * @param {number} depth - Hops spent so far.
     * @returns {?object[]} The candidate value nodes.
     */
    function literalValues(node, depth) {
      if (depth > MAX_DEPTH) return null;
      if (node.type === 'ObjectExpression' || node.type === 'ArrayExpression') return [node];
      if (node.type === 'Identifier') {
        const variable = resolveVariable(node);
        const def = variable?.defs.length === 1 ? variable.defs[0] : null;
        if (!def || isReassigned(variable, def)) return null;
        // `[...].map((c) => c.label)`: c is one of the literal's elements.
        if (def.type === 'Parameter') return elementParam(def.node, node.name, depth);
        if (def.type !== 'Variable' || !def.node.init || isMutated(variable)) return null;
        return literalValues(def.node.init, depth + 1);
      }
      if (node.type !== 'MemberExpression') return null;
      if (node.property.type === 'PrivateIdentifier') {
        const member = classMember(node, node.property.name);
        if (member?.kind !== 'field' || member.writes?.length !== 1 || member.changed) return null;
        return literalValues(member.writes[0], depth + 1);
      }
      const containers = literalValues(node.object, depth + 1);
      if (!containers) return null;
      const out = [];
      for (const c of containers) {
        if (c.type === 'ArrayExpression') {
          if (!node.computed || c.elements.some((e) => !e || e.type === 'SpreadElement')) return null;
          out.push(...c.elements);
        } else if (c.type === 'ObjectExpression') {
          if (c.properties.some((p) => p.type !== 'Property')) return null;
          const key = node.computed ? null : node.property.name;
          for (const p of c.properties) {
            const name = p.computed ? null : (p.key.name ?? p.key.value);
            if (key === null || name === key) out.push(p.value);
          }
        } else {
          return null;
        }
      }
      return out;
    }

    /**
     * What one read of a collection does to it: nothing (an empty list), adds values to it (`xs.push(a)`,
     * `xs[i] = v`, `m.set(k, v)`: the added values), or something this rule can't follow (null): a nested change
     * like `META.a.label = v`, or handing the collection to other code, which could change it.
     *
     * @param {object} use - The read: an Identifier, or a `this.#field` MemberExpression.
     * @returns {?object[]} The added value nodes, or null.
     */
    function collectionChange(use) {
      const parent = use.parent;
      if (parent.type === 'MemberExpression' && parent.object === use) {
        let top = parent;
        while (top.parent.type === 'MemberExpression' && top.parent.object === top) top = top.parent;
        const direct = top === parent;
        const outer = top.parent;
        if (outer.type === 'AssignmentExpression' && outer.left === top) return direct ? [outer.right] : null;
        if (outer.type === 'UpdateExpression' || (outer.type === 'UnaryExpression' && outer.operator === 'delete')) {
          return null;
        }
        if (outer.type !== 'CallExpression' || outer.callee !== top || top.computed) return [];
        const method = top.property.name;
        if (!MUTATING_METHODS.has(method)) return [];
        if (!direct || outer.arguments.some((a) => a.type === 'SpreadElement')) return null;
        switch (method) {
          case 'push': case 'unshift': case 'add': return outer.arguments;
          case 'splice': return outer.arguments.slice(2);
          case 'fill': return outer.arguments.slice(0, 1);
          case 'set': return outer.arguments.slice(1, 2);
          default: return [];
        }
      }
      if (parent.type === 'CallExpression' && parent.callee === use) return [];
      const call = parent.type === 'SpreadElement' ? parent.parent : parent;
      if (call.type === 'CallExpression' && READ_ONLY_FUNCTIONS.has(sourceCode.getText(call.callee))) return [];
      return PLAIN_READ_PARENTS.has(parent.type) ? [] : null;
    }

    /**
     * Whether an object or array held in a variable is changed or handed to other code after it is made, so its
     * literal is not the whole list of values it holds.
     *
     * @param {object} variable - The Variable.
     * @returns {boolean} True when some reference changes it or lets it go.
     */
    function isMutated(variable) {
      return variable.references.some((ref) => !ref.init && collectionChange(ref.identifier)?.length !== 0);
    }

    /**
     * The function a callee names, when it is defined in this file: a local function or `const` arrow, or a private
     * method of the enclosing class.
     *
     * @param {object} callee - The call's callee.
     * @returns {?object} The function node, or null when it lives elsewhere.
     */
    function resolveFunction(callee) {
      if (callee.type === 'Identifier') {
        const variable = resolveVariable(callee);
        const def = variable?.defs.length === 1 ? variable.defs[0] : null;
        if (!def) return null;
        if (def.type === 'FunctionName') return def.node;
        if (def.type === 'Variable' && isFunction(def.node.init) && !isReassigned(variable, def)) return def.node.init;
        return null;
      }
      if (callee.type === 'MemberExpression' && callee.property.type === 'PrivateIdentifier') {
        const member = classMember(callee, callee.property.name);
        return member && member.kind === 'method' ? member.fn : null;
      }
      return null;
    }

    /**
     * A variable read: a `const` (or a `let` written only by `=`) is as safe as its values; a parameter is as safe
     * as every argument this file passes for it.
     *
     * @param {object} node - The Identifier.
     * @param {number} depth - Hops spent so far.
     * @param {boolean} tip - Whether the value lands in a tooltip attribute.
     * @returns {object[]} The offending nodes.
     */
    function identifierParts(node, depth, tip) {
      if (node.name === 'undefined') return [];
      const variable = resolveVariable(node);
      if (!variable || variable.defs.length !== 1) return [node];
      const def = variable.defs[0];
      if (def.type === 'Variable') {
        const loop = def.parent.parent;
        if (/^For(Of|In)Statement$/.test(loop?.type ?? '') && loop.left === def.parent) {
          // `for (const x of [...])`: x is one of the literal's elements. Anything else a loop hands out is unknown.
          if (loop.type !== 'ForOfStatement' || def.node.id.type !== 'Identifier') return [node];
          const arrays = literalValues(loop.right, depth + 1);
          if (!arrays || arrays.some((a) => a.type !== 'ArrayExpression')) return [node];
          return anchor(arrays.flatMap((a) => unsafeParts(a, depth + 1, tip)), node);
        }
        if (def.node.id.type !== 'Identifier') return [node];
        const values = writtenValues(variable, def);
        return values ? anchor(values.flatMap((v) => unsafeParts(v, depth + 1, tip)), node) : [node];
      }
      if (def.type === 'Parameter') {
        if (isReassigned(variable, def)) return [node];
        if (isIndexParam(def.node, node.name)) return [];
        const elements = elementParam(def.node, node.name, depth);
        if (elements) return anchor(elements.flatMap((e) => unsafeParts(e, depth + 1, tip)), node);
        const args = argumentsFor(def.node, node.name);
        return args ? anchor(args.flatMap((a) => unsafeParts(a, depth + 1, tip)), node) : [node];
      }
      return [node];
    }

    /**
     * Every value a variable is ever given: its initial value, each `=` or `+=` after it, and, for a collection,
     * whatever is added to it. Null when it is written some other way (destructuring, `++`), or is a collection
     * that is changed in a way this rule can't follow or handed to other code.
     *
     * @param {object} variable - The Variable.
     * @param {object} def - Its one definition.
     * @returns {?object[]} The value nodes.
     */
    function writtenValues(variable, def) {
      const values = def.node.init ? [def.node.init] : [];
      // A string can't be changed through another name or by a function it is passed to; a collection can.
      const collection = isCollection(def.node.init);
      for (const ref of variable.references) {
        if (ref.identifier === def.name) continue;
        const use = ref.identifier;
        if (ref.isWrite()) {
          const write = use.parent;
          if (write.type !== 'AssignmentExpression' || write.left !== use) return null;
          if (write.operator !== '=' && write.operator !== '+=') return null;
          values.push(write.right);
          continue;
        }
        const change = collectionChange(use);
        if (change === null) {
          if (collection) return null;
          continue;
        }
        values.push(...change);
      }
      return values;
    }

    /**
     * The variable an identifier refers to.
     *
     * @param {object} identifier - The Identifier.
     * @returns {?object} The scope manager's Variable, or null when it is a global.
     */
    function resolveVariable(identifier) {
      const ref = sourceCode.getScope(identifier).references.find((r) => r.identifier === identifier);
      // ESLint resolves built-ins like `String` to a variable with no declaration; those count as globals here.
      if (ref?.resolved?.defs.length) return ref.resolved;
      // A script's top-level names stay unresolved, since another script could redefine them; this file's own
      // declarations are still the best guess.
      const global = sourceCode.scopeManager.globalScope.set.get(identifier.name);
      return global?.defs.length ? global : null;
    }

    /**
     * Whether a variable is written anywhere besides its declaration.
     *
     * @param {object} variable - The Variable.
     * @param {object} def - Its one definition.
     * @returns {boolean} True when some other write exists.
     */
    function isReassigned(variable, def) {
      return variable.references.some((r) => r.isWrite() && r.identifier !== def.name);
    }

    /**
     * The array-method call `fn` is the callback of (`xs.map(fn)` and friends), or null.
     *
     * @param {object} fn - The function node.
     * @returns {?object} The MemberExpression callee, e.g. `xs.map`.
     */
    function elementCallback(fn) {
      const call = fn.parent;
      if (call?.type !== 'CallExpression' || call.arguments[0] !== fn) return null;
      const callee = call.callee;
      if (callee.type !== 'MemberExpression' || callee.computed) return null;
      return ELEMENT_CALLBACK_METHODS.has(callee.property.name) ? callee : null;
    }

    /**
     * Whether a parameter is the index an array method hands its callback (`xs.map((x, i) => …)`), a number.
     *
     * @param {object} fn - The function node.
     * @param {string} paramName - The parameter's name.
     * @returns {boolean} True for the index.
     */
    function isIndexParam(fn, paramName) {
      return fn.params[1]?.type === 'Identifier' && fn.params[1].name === paramName && !!elementCallback(fn);
    }

    /**
     * When `fn` is the callback of `[...].map(...)` (or forEach, filter, …) on an array literal and `paramName` is its
     * element (`(x) =>` or a destructured `({ x }) =>`), the values it can take; otherwise null. Keys of an object
     * literal (`Object.keys(LITERAL).map((k) => …)`) are names written in this file, so they come back as no values.
     *
     * @param {object} fn - The function node.
     * @param {string} paramName - The parameter's name.
     * @param {number} depth - Hops spent so far.
     * @returns {?object[]} The value nodes.
     */
    function elementParam(fn, paramName, depth) {
      const first = fn.params[0];
      const destructured = first?.type === 'ObjectPattern'
        ? first.properties.find((p) => p.type === 'Property' && !p.computed && p.value.type === 'Identifier'
          && p.value.name === paramName)
        : null;
      if (!destructured && (first?.type !== 'Identifier' || first.name !== paramName)) return null;
      const callee = elementCallback(fn);
      if (!callee) return null;
      const receiver = callee.object;
      if (!destructured && receiver.type === 'CallExpression' && sourceCode.getText(receiver.callee) === 'Object.keys') {
        const objects = receiver.arguments[0] ? literalValues(receiver.arguments[0], depth + 1) : null;
        const plainKeys = objects?.every((o) => o.type === 'ObjectExpression'
          && o.properties.every((p) => p.type === 'Property' && !p.computed));
        return plainKeys ? [] : null;
      }
      const arrays = literalValues(receiver, depth + 1);
      if (!arrays || arrays.some((a) => a.type !== 'ArrayExpression')) return null;
      const elements = arrays.flatMap((a) => a.elements);
      if (elements.some((e) => !e || e.type === 'SpreadElement')) return null;
      if (!destructured) return elements;
      const key = destructured.key.name ?? destructured.key.value;
      const values = [];
      for (const e of elements) {
        if (e.type !== 'ObjectExpression' || e.properties.some((p) => p.type !== 'Property')) return null;
        const prop = e.properties.find((p) => !p.computed && (p.key.name ?? p.key.value) === key);
        if (prop) values.push(prop.value);
      }
      return values;
    }

    /**
     * Every value this file passes for one plain (non-destructured) parameter of `fn`, or null when the function
     * escapes somewhere this file can't follow (passed as a callback, exported, a public method).
     *
     * @param {object} fn - The function node.
     * @param {string} paramName - The parameter's name.
     * @returns {?object[]} The argument nodes, plus the default value if it has one.
     */
    function argumentsFor(fn, paramName) {
      const index = fn.params.findIndex((p) => (p.type === 'AssignmentPattern' ? p.left : p).name === paramName);
      if (index < 0) return null;
      const param = fn.params[index];
      const calls = callSitesOf(fn);
      if (!calls) return null;
      const values = [];
      for (const call of calls) {
        const arg = call.arguments[index];
        if (arg?.type === 'SpreadElement' || call.arguments.slice(0, index).some((a) => a.type === 'SpreadElement')) {
          return null;
        }
        if (arg) values.push(arg);
        else if (param.type === 'AssignmentPattern') values.push(param.right);
      }
      return values;
    }

    /**
     * Every call of a function defined in this file, or null when it is used in any other way too.
     *
     * @param {object} fn - The function node.
     * @returns {?object[]} The CallExpressions.
     */
    function callSitesOf(fn) {
      const parent = fn.parent;
      // A private method: every use is inside its class, so the class body has them all.
      if (parent.type === 'MethodDefinition' && parent.key.type === 'PrivateIdentifier') {
        return privateCallSites(parent, parent.key.name);
      }
      let variable = null;
      if (fn.type === 'FunctionDeclaration') {
        variable = sourceCode.getDeclaredVariables(fn)[0];
      } else if (parent.type === 'VariableDeclarator' && parent.init === fn && parent.id.type === 'Identifier') {
        variable = sourceCode.getDeclaredVariables(parent)[0];
      }
      // A top-level function in this concatenated bundle can be called from any other file.
      if (!variable || variable.scope.type === 'global') return null;
      const calls = [];
      for (const ref of variable.references) {
        if (ref.init) continue;
        const use = ref.identifier;
        if (use.parent.type !== 'CallExpression' || use.parent.callee !== use) return null;
        calls.push(use.parent);
      }
      return calls;
    }

    /**
     * Every call of a private method, or null when the method is also read as a value.
     *
     * @param {object} definition - The MethodDefinition.
     * @param {string} name - The private name, without the `#`.
     * @returns {?object[]} The CallExpressions.
     */
    function privateCallSites(definition, name) {
      const calls = [];
      let escapes = false;
      walk(definition.parent, (n) => {
        if (n.type !== 'MemberExpression' || n.property.type !== 'PrivateIdentifier' || n.property.name !== name) {
          return;
        }
        if (n.parent.type === 'CallExpression' && n.parent.callee === n) calls.push(n.parent);
        else escapes = true;
      }, false);
      return escapes ? null : calls;
    }

    /**
     * A private member of the class enclosing `node`: a method (with its function), or a field (with every value it
     * is ever given, or null writes when it changes in a way this rule can't follow).
     *
     * @param {object} node - Any node inside the class.
     * @param {string} name - The private name, without the `#`.
     * @returns {?{kind: string, fn?: object, writes?: ?object[], changed?: boolean}} The member, or null.
     */
    function classMember(node, name) {
      let body = node.parent;
      while (body && body.type !== 'ClassBody') body = body.parent;
      if (!body) return null;
      if (!classMemberCache.has(body)) classMemberCache.set(body, collectPrivateMembers(body));
      return classMemberCache.get(body).get(name) ?? null;
    }

    /**
     * Indexes a class body's private members by name, with every value each field is given: assigned with `=`,
     * added to it as a collection (`this.#rows.push(v)`), or unknown (null) when it is changed some other way or,
     * holding a collection, handed to other code (`Object.assign(this.#o, d)`).
     *
     * @param {object} body - The ClassBody.
     * @returns {Map<string, object>} The members, as classMember describes them.
     */
    function collectPrivateMembers(body) {
      const members = new Map();
      for (const el of body.body) {
        if (el.key?.type !== 'PrivateIdentifier') continue;
        if (el.type === 'MethodDefinition' && el.kind === 'method') {
          members.set(el.key.name, { kind: 'method', fn: el.value });
        } else if (el.type === 'PropertyDefinition') {
          members.set(el.key.name, { kind: 'field', writes: el.value ? [el.value] : [], reads: [], changed: false });
        }
      }
      walk(body, (n) => {
        if (n.type !== 'MemberExpression' || n.property.type !== 'PrivateIdentifier') return;
        const member = members.get(n.property.name);
        if (member?.kind !== 'field' || !member.writes) return;
        const parent = n.parent;
        if (parent.type === 'AssignmentExpression' && parent.left === n) {
          if (parent.operator === '=' || parent.operator === '+=') member.writes.push(parent.right);
          else member.writes = null;
        } else if (parent.type === 'UpdateExpression' && parent.argument === n) {
          // `this.#n++` keeps a number a number.
        } else {
          member.reads.push(n);
        }
      }, false);
      for (const member of members.values()) {
        if (member.kind !== 'field' || !member.writes) continue;
        const collection = member.writes.some(isCollection);
        for (const read of member.reads) {
          const change = collectionChange(read);
          if (change === null && collection) {
            member.writes = null;
            break;
          }
          if (change?.length) {
            member.writes.push(...change);
            member.changed = true;
          }
        }
      }
      return members;
    }

    /**
     * For each `${…}` of a template, whether it sits inside a `data-ps-tooltip="…"` attribute value.
     *
     * @param {object} node - The TemplateLiteral.
     * @returns {boolean[]} One flag per expression.
     */
    function tooltipPositions(node) {
      let text = '';
      return node.expressions.map((_, i) => {
        text += node.quasis[i].value.cooked ?? '';
        const inside = IN_TOOLTIP_ATTRIBUTE.test(text);
        text += 'X';
        return inside;
      });
    }

    return {
      TemplateLiteral(node) {
        if (node.parent.type === 'TaggedTemplateExpression' || node.expressions.length === 0) return;
        const tips = tooltipPositions(node);
        const found = node.expressions.flatMap((e, i) => unsafeParts(e, 0, tips[i]).map((part) => [part, tips[i]]));
        if (found.length === 0 || !reachesMarkup(node)) return;
        for (const [part, tip] of found) {
          if (reported.has(part)) continue;
          reported.add(part);
          context.report({ node: part, messageId: tip ? 'tooltip' : 'unescaped' });
        }
      },
    };
  },
};
