/**
 * Shared by the ps/ escaping rules: works out whether a value ends up as HTML (`innerHTML`, `insertAdjacentHTML`,
 * a tooltip attribute, or a helper that renders HTML), following it through variables, templates, `map().join()`
 * and same-file function calls. It can't follow a value returned from a function or stored on an object.
 */

'use strict';

/** Methods that parse their argument as HTML. (`append`, `before` etc. insert text, so they're left out.) */
const MARKUP_METHODS = new Set(['insertAdjacentHTML', 'setHTML']);

/** Helpers in other files that render an argument as HTML, by name, with which arguments. */
const MARKUP_HELPERS = new Map([
  ['AdminShell.setHtml', [1]],
  ['ApiDocsMap.popup', [2]],
  ['showAlert', [0]],
  ['notify', [0, 1]],
]);

/** Element properties whose assigned value is parsed as HTML. */
const MARKUP_PROPERTIES = new Set(['innerHTML', 'outerHTML']);

/** Attributes this codebase renders as HTML rather than text. */
const MARKUP_ATTRIBUTES = new Set(['data-ps-tooltip']);

/** String methods whose result still contains the original text. */
const PASS_THROUGH_METHODS = new Set([
  'join', 'trim', 'trimStart', 'trimEnd', 'toString', 'concat', 'toUpperCase', 'toLowerCase', 'replace',
  'replaceAll', 'slice', 'substring', 'substr', 'padStart', 'padEnd', 'normalize', 'repeat',
]);

/** Array methods whose result is built from the callback's return values. */
const CALLBACK_RESULT_METHODS = new Set(['map', 'flatMap']);

/** How many hops to follow before giving up. */
const MAX_DEPTH = 6;

/**
 * Whether a string literal names an attribute this codebase renders as HTML.
 *
 * @param {object} node - The argument holding the attribute name.
 * @returns {boolean} True for `data-ps-tooltip` and friends.
 */
function isMarkupAttributeName(node) {
  return node && node.type === 'Literal' && MARKUP_ATTRIBUTES.has(node.value);
}

/**
 * Builds the flow check for one file.
 *
 * @param {object} sourceCode - The rule context's `sourceCode`, for scope lookups.
 * @returns {function(object): boolean} Whether the value produced at a node reaches an HTML sink.
 */
function createMarkupFlow(sourceCode) {
  /**
   * Whether the value at `node` ends up as HTML.
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
      // The value is passed along as-is.
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

      // e.g. `[…].join('')` and `s.trim()`.
      case 'MemberExpression': {
        if (parent.object !== node || parent.computed || parent.property.type !== 'Identifier') return false;
        const call = parent.parent;
        if (!call || call.type !== 'CallExpression' || call.callee !== parent) return false;
        return PASS_THROUGH_METHODS.has(parent.property.name) ? reachesMarkup(call, depth + 1, seen) : false;
      }

      // e.g. `xs.map((x) => `<li>${…}</li>`).join('')`.
      case 'ArrowFunctionExpression':
        return parent.body === node ? callbackResultReachesMarkup(parent, depth, seen) : false;

      case 'ReturnStatement': {
        const fn = enclosingFunction(parent);
        return fn ? callbackResultReachesMarkup(fn, depth, seen) : false;
      }

      case 'CallExpression': {
        if (parent.callee === node) return false;
        const callee = parent.callee;
        const index = parent.arguments.indexOf(node);
        if (isMarkupHelperArgument(callee, index)) return true;
        const param = localParameter(callee, index);
        if (param) return variableReachesMarkup(param, depth, seen);
        if (callee.type !== 'MemberExpression' || callee.computed || callee.property.type !== 'Identifier') {
          return false;
        }
        const method = callee.property.name;
        if (MARKUP_METHODS.has(method)) return true;
        // Only some attributes are rendered as HTML.
        if (method === 'setAttribute' && parent.arguments[1] === node) {
          return isMarkupAttributeName(parent.arguments[0]);
        }
        // `parts.push(html)`: follow `parts`.
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
   * Whether a `map`/`flatMap` callback's return value ends up as HTML. Other functions' returns aren't followed.
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
   * Whether any use of this variable ends up as HTML.
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

  /**
   * Whether this argument goes to a helper in MARKUP_HELPERS.
   *
   * @param {object} callee - The call's callee.
   * @param {number} index - Which argument.
   * @returns {boolean} True when that argument is rendered as HTML.
   */
  function isMarkupHelperArgument(callee, index) {
    const byName = MARKUP_HELPERS.get(sourceCode.getText(callee));
    const method = callee.type === 'MemberExpression' && !callee.computed ? callee.property.name : null;
    const byMethod = method ? MARKUP_HELPERS.get(method) : null;
    return !!(byName?.includes(index) || byMethod?.includes(index));
  }

  /**
   * The parameter an argument lands in, if the called function is defined in this file.
   *
   * @param {object} callee - The call's callee.
   * @param {number} index - Which argument.
   * @returns {?object} The parameter's Identifier node, or null when it can't be found.
   */
  function localParameter(callee, index) {
    let fn = null;
    if (callee.type === 'Identifier') {
      const scope = sourceCode.getScope(callee);
      const variable = scope.references.find((r) => r.identifier === callee)?.resolved
        ?? sourceCode.scopeManager.globalScope.set.get(callee.name);
      const def = variable?.defs.length === 1 ? variable.defs[0] : null;
      if (def?.type === 'FunctionName') fn = def.node;
      else if (def?.type === 'Variable' && /Function/.test(def.node.init?.type ?? '')) fn = def.node.init;
    } else if (callee.type === 'MemberExpression' && !callee.computed) {
      let body = callee.parent;
      while (body && body.type !== 'ClassBody') body = body.parent;
      if (!body) return null;
      const className = body.parent.id?.name;
      const onThisClass = callee.object.type === 'ThisExpression'
        || (callee.object.type === 'Identifier' && callee.object.name === className);
      const name = callee.property.name;
      const method = onThisClass
        ? body.body.find((el) => el.type === 'MethodDefinition' && el.key.name === name
          && (el.key.type === 'PrivateIdentifier') === (callee.property.type === 'PrivateIdentifier'))
        : null;
      fn = method?.value ?? null;
    }
    if (!fn || index < 0) return null;
    const param = fn.params[index];
    const id = param?.type === 'AssignmentPattern' ? param.left : param;
    return id?.type === 'Identifier' ? id : null;
  }

  return (node) => reachesMarkup(node, 0, new Set());
}

module.exports = { createMarkupFlow };
