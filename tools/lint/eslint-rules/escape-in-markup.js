/**
 * ESLint rule: a value interpolated into a template literal that ends up as HTML must be escaped, or be something
 * that can't carry markup (#5615).
 *
 * "Ends up as HTML" is worked out by markup-flow.js: `innerHTML`, `insertAdjacentHTML()` and friends, directly or
 * through a variable, a joined `map()`, a ternary and so on. Each `${…}` in such a template has to be one of:
 * - wrapped in `util.escapeHTML(…)`, or another call SAFE_CALLS trusts (asset paths, label-type data, translations);
 * - a number, a boolean, or arithmetic;
 * - a template, ternary, `&&`/`||`/`??` or `map(…).join()` whose parts all pass;
 * - a `const`, or a parameter or private field of this file, whose every value passes;
 * - a call to a function or private method of this file whose every return value passes.
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

/** Methods that format a number or a date, which can't contain markup. */
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
  ['replace', 1], ['replaceAll', 1], ['padStart', 1], ['padEnd', 1], ['concat', 0],
]);

/** Array methods whose callback's first parameter is an element of the array they are called on. */
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

/** How deep to follow variables, parameters and calls before giving up and calling the value unsafe. */
const MAX_DEPTH = 12;

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
    },
  },

  create(context) {
    const sourceCode = context.sourceCode;
    const reachesMarkup = createMarkupFlow(sourceCode);
    const reported = new Set();
    // Per-function results, so a helper called from twenty templates is analyzed once. `null` marks "in progress",
    // which a recursive helper reads as safe rather than looping.
    const returnsCache = new Map();
    const classMemberCache = new Map();

    /**
     * The parts of an expression that could put markup into HTML: an empty list means it is safe.
     *
     * @param {object} node - The expression.
     * @param {number} depth - Hops spent so far.
     * @returns {object[]} The offending nodes, which is where the report goes.
     */
    function unsafeParts(node, depth) {
      if (depth > MAX_DEPTH) return [node];
      switch (node.type) {
        case 'Literal':
        case 'UnaryExpression':
        case 'UpdateExpression':
          return [];
        case 'TemplateLiteral':
          return node.expressions.flatMap((e) => unsafeParts(e, depth));
        case 'ConditionalExpression':
          return [...unsafeParts(node.consequent, depth), ...unsafeParts(node.alternate, depth)];
        case 'LogicalExpression':
          // `a && b` only ever yields `a` when it is falsy (empty, null, 0…), which can't hold markup.
          if (node.operator === '&&') return unsafeParts(node.right, depth);
          return [...unsafeParts(node.left, depth), ...unsafeParts(node.right, depth)];
        case 'BinaryExpression':
          if (NON_STRING_OPERATORS.has(node.operator)) return [];
          return [...unsafeParts(node.left, depth), ...unsafeParts(node.right, depth)];
        case 'ChainExpression':
          return unsafeParts(node.expression, depth);
        case 'ArrayExpression':
          return node.elements.flatMap((e) => {
            if (!e) return [];
            return unsafeParts(e.type === 'SpreadElement' ? e.argument : e, depth);
          });
        case 'MemberExpression':
          return memberParts(node, depth);
        case 'CallExpression':
          return callParts(node, depth);
        case 'Identifier':
          return identifierParts(node, depth);
        default:
          return [node];
      }
    }

    /**
     * Moves each report to where the fix belongs. A value found by following a variable, parameter, field or return
     * value back to its source is reported where it was read, so the fix is a wrap at the HTML, not a change to
     * the variable that other code may use as plain text. A part that sits inside a template stays put: that
     * template is HTML being built, and escaping there is the fix.
     *
     * @param {object[]} parts - The offending nodes found at the source.
     * @param {object} read - The node that brought the value into this template.
     * @returns {object[]} The nodes to report.
     */
    function anchor(parts, read) {
      const out = new Set(parts.map((p) => (inTemplate(p) ? p : read)));
      return [...out];
    }

    /**
     * Whether a node's value is what a template literal's `${…}` prints, directly or through a ternary branch,
     * `&&`/`||`, a `+`, or a method called on it. An argument to a call doesn't count: the call's result is printed,
     * not the argument.
     *
     * @param {object} node - Any expression.
     * @returns {boolean} True when it is interpolated into a template.
     */
    function inTemplate(node) {
      let n = node;
      for (;;) {
        const p = n.parent;
        const carried = p && (p.type === 'LogicalExpression' || p.type === 'ChainExpression'
          || (p.type === 'ConditionalExpression' && p.test !== n)
          || (p.type === 'BinaryExpression' && p.operator === '+')
          || (p.type === 'MemberExpression' && p.object === n)
          || (p.type === 'CallExpression' && p.callee === n));
        if (!carried) return p?.type === 'TemplateLiteral';
        n = p;
      }
    }

    /**
     * A property read: safe when it is a count, a field of a trusted call's result, a lookup into an object or array
     * literal whose values are safe, or a private field this class only ever sets to safe values.
     *
     * @param {object} node - The MemberExpression.
     * @param {number} depth - Hops spent so far.
     * @returns {object[]} The offending nodes.
     */
    function memberParts(node, depth) {
      if (!node.computed && SAFE_PROPERTIES.has(node.property.name)) return [];
      // `util.misc.getLabelDescriptions(t).tagInfo[tag].text`: data from a trusted call, however deep.
      let base = node.object;
      while (base.type === 'MemberExpression') base = base.object;
      if (base.type === 'CallExpression' && isTrustedCall(base)) return [];
      // `s[0]`: a character of a safe string.
      if (node.computed && node.property.type === 'Literal' && typeof node.property.value === 'number') {
        const parts = unsafeParts(node.object, depth);
        if (parts.length === 0) return [];
      }
      const values = literalValues(node, depth);
      if (values) return anchor(values.flatMap((v) => unsafeParts(v, depth + 1)), node);
      if (node.property.type === 'PrivateIdentifier') {
        const member = classMember(node, node.property.name);
        if (member && member.kind === 'field') {
          const values = [...member.writes];
          return values.length === 0 ? [] : anchor(values.flatMap((v) => unsafeParts(v, depth + 1)), node);
        }
      }
      return [node];
    }

    /**
     * Whether a call is one SAFE_CALLS / SAFE_CALL_PREFIXES vouches for.
     *
     * @param {object} node - The CallExpression.
     * @returns {boolean} True for a trusted helper.
     */
    function isTrustedCall(node) {
      let callee = node.callee;
      // `const esc = util.escapeHTML;` then `esc(x)`: judge the alias by what it points at.
      if (callee.type === 'Identifier') {
        const variable = resolveVariable(callee);
        const def = variable?.defs.length === 1 ? variable.defs[0] : null;
        if (def?.type === 'Variable' && def.node.init?.type === 'MemberExpression' && !isReassigned(variable, def)) {
          callee = def.node.init;
        }
      }
      const name = sourceCode.getText(callee);
      return SAFE_CALLS.has(name) || SAFE_CALL_PREFIXES.some((prefix) => name.startsWith(prefix));
    }

    /**
     * A call: safe when trusted, a number formatter, a `map(…).join()` of safe parts, or a function of this file
     * that only returns safe values.
     *
     * @param {object} node - The CallExpression.
     * @param {number} depth - Hops spent so far.
     * @returns {object[]} The offending nodes.
     */
    function callParts(node, depth) {
      if (isTrustedCall(node)) return [];
      const callee = node.callee;
      if (callee.type === 'Identifier' && callee.name === 'String' && !resolveVariable(callee)) {
        return node.arguments.flatMap((a) => unsafeParts(a, depth));
      }
      if (callee.type === 'MemberExpression' && !callee.computed) {
        const method = callee.property.name;
        if (FORMAT_METHODS.has(method)) return [];
        if (method === 'join') return unsafeParts(callee.object, depth);
        if (PASS_THROUGH_METHODS.has(method) || ARG_CARRYING_METHODS.has(method)) {
          const carried = ARG_CARRYING_METHODS.has(method) ? node.arguments.slice(ARG_CARRYING_METHODS.get(method)) : [];
          return [callee.object, ...carried].flatMap((a) => {
            if (isFunction(a)) return returnParts(a, depth);
            return unsafeParts(a.type === 'SpreadElement' ? a.argument : a, depth);
          });
        }
        if ((method === 'map' || method === 'flatMap') && isFunction(node.arguments[0])) {
          return anchor(returnParts(node.arguments[0], depth), node);
        }
      }
      const fn = resolveFunction(callee);
      if (fn) return anchor(returnParts(fn, depth), node);
      // `COLUMNS[i].format(v)`: a function stored in an object literal of this file.
      const fns = callee.type === 'MemberExpression' ? literalValues(callee, depth + 1) : null;
      if (fns?.length && fns.every(isFunction)) return anchor(fns.flatMap((f) => returnParts(f, depth)), node);
      return [node];
    }

    /**
     * The unsafe parts across everything a function can return.
     *
     * @param {object} fn - The function node.
     * @param {number} depth - Hops spent so far.
     * @returns {object[]} The offending nodes.
     */
    function returnParts(fn, depth) {
      if (returnsCache.has(fn)) return returnsCache.get(fn) || [];
      returnsCache.set(fn, null);
      let parts;
      if (fn.body.type !== 'BlockStatement') {
        parts = unsafeParts(fn.body, depth + 1);
      } else {
        parts = [];
        walk(fn.body, (n) => {
          if (n.type === 'ReturnStatement' && n.argument) parts.push(...unsafeParts(n.argument, depth + 1));
        }, true);
      }
      returnsCache.set(fn, parts);
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
        if (member?.kind !== 'field' || member.writes.length !== 1) return null;
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
     * Whether an object or array held in a variable is changed after it is made (`xs.push(…)`, `o.k = …`), so its
     * literal no longer lists every value it holds.
     *
     * @param {object} variable - The Variable.
     * @returns {boolean} True when some reference changes its contents or hands it to other code.
     */
    function isMutated(variable) {
      return variable.references.some((ref) => {
        const use = ref.identifier;
        const parent = use.parent;
        if (ref.init) return false;
        if (parent.type === 'MemberExpression' && parent.object === use) {
          const outer = parent.parent;
          if (outer.type === 'AssignmentExpression' && outer.left === parent) return true;
          if (outer.type === 'UpdateExpression' || (outer.type === 'UnaryExpression' && outer.operator === 'delete')) {
            return true;
          }
          if (outer.type === 'CallExpression' && outer.callee === parent) {
            return !parent.computed && MUTATING_METHODS.has(parent.property.name);
          }
          return false;
        }
        // Passed to a function, which could change it.
        return parent.type === 'CallExpression' && parent.arguments.includes(use);
      });
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
     * A variable read: a `const` (or a never-reassigned `let`) is as safe as its value; a parameter is as safe as
     * every argument this file passes for it.
     *
     * @param {object} node - The Identifier.
     * @param {number} depth - Hops spent so far.
     * @returns {object[]} The offending nodes.
     */
    function identifierParts(node, depth) {
      if (node.name === 'undefined') return [];
      const variable = resolveVariable(node);
      if (!variable || variable.defs.length !== 1) return [node];
      const def = variable.defs[0];
      if (def.type === 'Variable') {
        // `for (const x of [...])`: x is one of the literal's elements.
        const loop = def.parent.parent;
        if (loop?.type === 'ForOfStatement' && loop.left === def.parent && def.node.id.type === 'Identifier') {
          const arrays = literalValues(loop.right, depth + 1);
          if (!arrays || arrays.some((a) => a.type !== 'ArrayExpression')) return [node];
          return anchor(arrays.flatMap((a) => unsafeParts(a, depth + 1)), node);
        }
        if (def.node.id.type !== 'Identifier') return [node];
        const values = writtenValues(variable, def);
        return values ? anchor(values.flatMap((v) => unsafeParts(v, depth + 1)), node) : [node];
      }
      if (def.type === 'Parameter') {
        if (isReassigned(variable, def)) return [node];
        const elements = elementParam(def.node, node.name, depth);
        if (elements) return anchor(elements.flatMap((e) => unsafeParts(e, depth + 1)), node);
        const args = argumentsFor(def.node, node.name);
        return args ? anchor(args.flatMap((a) => unsafeParts(a, depth + 1)), node) : [node];
      }
      return [node];
    }

    /**
     * Every value a variable is ever given: its initial value, each `=` or `+=` after it, and, for an array, Map or
     * Set, whatever is added to it (`push`, `xs[i] = …`, `set`). Null when it is written some other way
     * (destructuring, `++`, a loop), which this rule doesn't follow.
     *
     * @param {object} variable - The Variable.
     * @param {object} def - Its one definition.
     * @returns {?object[]} The value nodes.
     */
    function writtenValues(variable, def) {
      const values = def.node.init ? [def.node.init] : [];
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
        const added = addedValues(use);
        if (added === null) return null;
        values.push(...added);
      }
      return values;
    }

    /**
     * What one read of a collection adds to it: `xs.push(a, b)` adds a and b, `xs[i] = v` adds v, `m.set(k, v)`
     * adds v. A read that adds nothing gives an empty list.
     *
     * @param {object} use - The Identifier being read.
     * @returns {?object[]} The added value nodes, or null for a change this rule can't follow.
     */
    function addedValues(use) {
      const member = use.parent;
      if (member.type !== 'MemberExpression' || member.object !== use) return [];
      const outer = member.parent;
      if (outer.type === 'AssignmentExpression' && outer.left === member) return [outer.right];
      if (outer.type === 'UpdateExpression') return null;
      if (outer.type !== 'CallExpression' || outer.callee !== member || member.computed) return [];
      const args = outer.arguments;
      if (args.some((a) => a.type === 'SpreadElement')) {
        return MUTATING_METHODS.has(member.property.name) ? null : [];
      }
      switch (member.property.name) {
        case 'push': case 'unshift': case 'add': return args;
        case 'splice': return args.slice(2);
        case 'fill': return args.slice(0, 1);
        case 'set': return args.slice(1, 2);
        default: return [];
      }
    }

    /**
     * The variable an identifier refers to.
     *
     * @param {object} identifier - The Identifier.
     * @returns {?object} The scope manager's Variable, or null when it is a global.
     */
    function resolveVariable(identifier) {
      const ref = sourceCode.getScope(identifier).references.find((r) => r.identifier === identifier);
      if (ref?.resolved) return ref.resolved;
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
     * When `fn` is the callback of `[...].map(...)` (or forEach, filter, …) on an array literal and `paramName` is its
     * first parameter, the literal's elements; otherwise null.
     *
     * @param {object} fn - The function node.
     * @param {string} paramName - The parameter's name.
     * @param {number} depth - Hops spent so far.
     * @returns {?object[]} The element nodes.
     */
    function elementParam(fn, paramName, depth) {
      if (fn.params[0]?.type !== 'Identifier' || fn.params[0].name !== paramName) return null;
      const call = fn.parent;
      if (call?.type !== 'CallExpression' || call.arguments[0] !== fn) return null;
      const callee = call.callee;
      if (callee.type !== 'MemberExpression' || callee.computed) return null;
      if (!ELEMENT_CALLBACK_METHODS.has(callee.property.name)) return null;
      const arrays = literalValues(callee.object, depth + 1);
      if (!arrays || arrays.some((a) => a.type !== 'ArrayExpression')) return null;
      if (arrays.some((a) => a.elements.some((e) => !e || e.type === 'SpreadElement'))) return null;
      return arrays.flatMap((a) => a.elements);
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
     * is ever given).
     *
     * @param {object} node - Any node inside the class.
     * @param {string} name - The private name, without the `#`.
     * @returns {?{kind: string, fn?: object, writes?: object[]}} The member, or null when it can't be found.
     */
    function classMember(node, name) {
      let body = node.parent;
      while (body && body.type !== 'ClassBody') body = body.parent;
      if (!body) return null;
      if (!classMemberCache.has(body)) classMemberCache.set(body, collectPrivateMembers(body));
      return classMemberCache.get(body).get(name) ?? null;
    }

    /**
     * Indexes a class body's private members by name.
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
          members.set(el.key.name, { kind: 'field', writes: el.value ? [el.value] : [] });
        }
      }
      walk(body, (n) => {
        if (n.type !== 'AssignmentExpression' && n.type !== 'UpdateExpression') return;
        const target = n.type === 'AssignmentExpression' ? n.left : n.argument;
        if (target.type !== 'MemberExpression' || target.property.type !== 'PrivateIdentifier') return;
        const member = members.get(target.property.name);
        if (member?.kind !== 'field') return;
        // `+=` keeps the old value and adds the new one, so the new one is what has to be checked.
        if (n.type === 'AssignmentExpression') member.writes.push(n.right);
      }, false);
      return members;
    }

    return {
      TemplateLiteral(node) {
        if (node.parent.type === 'TaggedTemplateExpression' || node.expressions.length === 0) return;
        const parts = unsafeParts(node, 0).filter((p) => !reported.has(p));
        if (parts.length === 0 || !reachesMarkup(node)) return;
        for (const part of parts) {
          if (reported.has(part)) continue;
          reported.add(part);
          context.report({ node: part, messageId: 'unescaped' });
        }
      },
    };
  },
};
