/**
 * ESLint rule: every `${…}` in a template that ends up as HTML must be escaped, or be something that can't contain
 * markup (#5615).
 *
 * Safe means: wrapped in `util.escapeHTML`, a trusted helper (SAFE_CALLS), a number, or a variable, parameter or
 * helper of the same file whose every possible value is safe. Inside a `data-ps-tooltip="…"` attribute, plain text
 * needs escaping twice (`AdminShell.tooltipAttr`), since the tooltip renders the attribute as HTML.
 */

'use strict';

const { createMarkupFlow } = require('./markup-flow');

/** Calls whose result is safe to drop into HTML as-is, by their callee's source text. */
const SAFE_CALLS = new Set([
  'util.escapeHTML',
  'util.assetPath',
  'AdminShell.tooltipAttr',
  'encodeURIComponent',
  // Our own text; what a translation fills in is checked by i18n-escape-in-markup.
  'i18next.t',
  'Number', 'parseInt', 'parseFloat',
  // Shared number and date formatters from other files.
  'AdminShell.num', 'AdminShell.dur', 'AccessScoreGradeRamp.percent', 'util.monthYear',
]);

/** Callee prefixes whose results are safe: math, and label-type data from our backend. */
const SAFE_CALL_PREFIXES = ['Math.', 'util.misc.'];

/** Escapes once: not enough for plain text inside a tooltip attribute. */
const ESCAPE_CALLS = new Set(['util.escapeHTML']);

/** Escapes twice, for a tooltip attribute. */
const TOOLTIP_ESCAPE_CALLS = new Set(['AdminShell.tooltipAttr']);

/**
 * Number and date formatters. `toLocaleString` also works on strings, but here it's used on counts, and flagging
 * every count would bury the real findings.
 */
const FORMAT_METHODS = new Set([
  'toFixed', 'toPrecision', 'toLocaleString', 'toLocaleDateString', 'toLocaleTimeString', 'toISOString',
  'toDateString',
]);

/** Methods whose result is only as safe as the value they're called on. */
const PASS_THROUGH_METHODS = new Set([
  'slice', 'substring', 'substr', 'trim', 'trimStart', 'trimEnd', 'toLowerCase', 'toUpperCase', 'repeat', 'at',
  'charAt', 'toString', 'normalize', 'reverse', 'filter', 'sort', 'flat',
]);

/** Methods that also copy arguments into the result, from this argument index on. */
const ARG_CARRYING_METHODS = new Map([
  ['replace', 1], ['replaceAll', 1], ['padStart', 1], ['padEnd', 1], ['concat', 0], ['join', 0],
]);

/** Array methods whose callback gets (element, index). */
const ELEMENT_CALLBACK_METHODS = new Set(['map', 'flatMap', 'forEach', 'filter', 'find', 'some', 'every']);

/** Methods that change the array, Map or Set they're called on. */
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

/** Places an array can be read without being handed to other code. */
const PLAIN_READ_PARENTS = new Set([
  'TemplateLiteral', 'BinaryExpression', 'LogicalExpression', 'ConditionalExpression', 'UnaryExpression',
  'ChainExpression', 'IfStatement', 'ForOfStatement', 'ForInStatement', 'SwitchStatement', 'ExpressionStatement',
]);

/** Functions that don't change an array passed to them. */
const READ_ONLY_FUNCTIONS = new Set([
  'Object.keys', 'Object.values', 'Object.entries', 'Array.isArray', 'Array.from', 'JSON.stringify', 'Math.max',
  'Math.min',
]);

/** How many hops to follow before giving up and calling a value unsafe. */
const MAX_DEPTH = 12;

/** Matches text that ends inside a `data-ps-tooltip="…"` value. */
const IN_TOOLTIP_ATTRIBUTE = /data-ps-tooltip\s*=\s*(?:"[^"]*|'[^']*)$/;

/**
 * Visits every node under `node`, optionally skipping nested functions.
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
 * Whether a node is a function.
 *
 * @param {?object} node - Any node.
 * @returns {boolean} True for the three function node types.
 */
function isFunction(node) {
  return !!node && /^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(node.type);
}

/**
 * Whether a starting value is an array, object or `new` collection, i.e. something that can change later.
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
      tooltip: 'Text in a data-ps-tooltip attribute needs escaping twice: use AdminShell.tooltipAttr(…).',
    },
  },

  create(context) {
    const sourceCode = context.sourceCode;
    const reachesMarkup = createMarkupFlow(sourceCode);
    const reported = new Set();
    // Cached results per helper (one map per escaping level). `null` means "still working on it".
    const returnsCache = [new Map(), new Map()];
    // Set when a result depended on an unfinished helper (recursion); such results aren't cached.
    let leanedOnCycle = false;
    const classMemberCache = new Map();

    /**
     * The parts of an expression that aren't safe; empty means safe.
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
          // `a && b` only returns `a` when it's empty, null, 0 or false.
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
     * Puts each report where the escape should go: inside the HTML being built, not where a value is first
     * computed (other code may use it as plain text).
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
     * Whether a node is printed by a template that builds HTML (one with a tag in it, or one that reaches HTML).
     * A plain-text template like `${count} ${unit}` doesn't count, since its result may also be shown as text.
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
     * A property read: safe if it's a count, data from a trusted call, a lookup in a literal table of safe values,
     * or a private field that's only ever set to safe values.
     *
     * @param {object} node - The MemberExpression.
     * @param {number} depth - Hops spent so far.
     * @param {boolean} tip - Whether the value lands in a tooltip attribute.
     * @returns {object[]} The offending nodes.
     */
    function memberParts(node, depth, tip) {
      if (!node.computed && SAFE_PROPERTIES.has(node.property.name)) return [];
      // e.g. `util.misc.getLabelDescriptions(t).tagInfo[tag].text`.
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
     * The called function's name, seeing through aliases like `const esc = util.escapeHTML`.
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
     * The unsafe parts of a trusted call, or null if the call isn't trusted. Exceptions: a translation's
     * `defaultValue` (shown when the key is missing), and a single escape inside a tooltip attribute.
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
     * A call: safe if trusted, a number formatter, or a same-file function that only returns safe values.
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
      // e.g. `COLUMNS[i].format(v)`, a function stored in a literal table.
      const fns = callee.type === 'MemberExpression' ? literalValues(callee, depth + 1) : null;
      if (fns?.length && fns.every(isFunction)) return anchor(fns.flatMap((f) => returnParts(f, depth, tip)), node);
      return [node];
    }

    /**
     * The unsafe parts of everything a function can return.
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
     * The values a lookup in a literal table can give (`LABELS[key]` is any of its values), or null if it isn't one.
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
        // e.g. `[...].map((c) => c.label)`.
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
     * What one use of an array (or object, Map, Set) adds to it: nothing ([]), the added values (`xs.push(a)`),
     * or null if it's changed in a way we can't follow, or handed to other code that might change it.
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
     * Whether an array or object is changed, or handed to other code, after it's created.
     *
     * @param {object} variable - The Variable.
     * @returns {boolean} True when some reference changes it or lets it go.
     */
    function isMutated(variable) {
      return variable.references.some((ref) => !ref.init && collectionChange(ref.identifier)?.length !== 0);
    }

    /**
     * The function being called, if it's defined in this file (a local function or a private method).
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
     * A variable: as safe as every value it's given. A parameter: as safe as every argument passed to it.
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
          // Only `for (const x of [literal list])` is known.
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
     * Every value a variable is ever given, or null if it's changed in a way we can't follow.
     *
     * @param {object} variable - The Variable.
     * @param {object} def - Its one definition.
     * @returns {?object[]} The value nodes.
     */
    function writtenValues(variable, def) {
      const values = def.node.init ? [def.node.init] : [];
      // Passing a string to a function can't change it; passing an array can.
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
      // Built-ins like `String` resolve to a variable with no declaration; treat those as globals.
      if (ref?.resolved?.defs.length) return ref.resolved;
      // Top-level names in a script stay unresolved; use this file's own declaration.
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
     * If `fn` is the callback in `xs.map(fn)` (or similar), the `xs.map` part; otherwise null.
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
     * Whether a parameter is the index in `xs.map((x, i) => …)`, which is always a number.
     *
     * @param {object} fn - The function node.
     * @param {string} paramName - The parameter's name.
     * @returns {boolean} True for the index.
     */
    function isIndexParam(fn, paramName) {
      return fn.params[1]?.type === 'Identifier' && fn.params[1].name === paramName && !!elementCallback(fn);
    }

    /**
     * For a callback looping over a literal list (`[...].map((x) => …)`, also `({ x }) =>`), the values `x` can
     * take; otherwise null. Keys of a literal object (`Object.keys(LITERAL)`) are always safe, so: [].
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
     * Every argument this file passes for one parameter, or null if the function can be called from elsewhere.
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
     * Every call of a same-file function, or null if it's also used another way.
     *
     * @param {object} fn - The function node.
     * @returns {?object[]} The CallExpressions.
     */
    function callSitesOf(fn) {
      const parent = fn.parent;
      // Private methods can only be called from inside their class.
      if (parent.type === 'MethodDefinition' && parent.key.type === 'PrivateIdentifier') {
        return privateCallSites(parent, parent.key.name);
      }
      let variable = null;
      if (fn.type === 'FunctionDeclaration') {
        variable = sourceCode.getDeclaredVariables(fn)[0];
      } else if (parent.type === 'VariableDeclarator' && parent.init === fn && parent.id.type === 'Identifier') {
        variable = sourceCode.getDeclaredVariables(parent)[0];
      }
      // Other files in the bundle can call a top-level function.
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
     * Every call of a private method, or null if it's also used another way.
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
     * A private method or field of the class around `node`.
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
     * Lists a class's private members. For each field: every value it's given, or null writes if it's changed in a
     * way we can't follow (e.g. `Object.assign(this.#o, d)`).
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
          // `this.#n++` stays a number.
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
     * For each `${…}`, whether it's inside a `data-ps-tooltip="…"` value.
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
