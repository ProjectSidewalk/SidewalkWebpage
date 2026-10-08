/**
 * Jest transform for frontend/js (jest.config.js `transform`): Babel turns each ES module into CommonJS so a suite can
 * `require` it, and every import the module makes defers to a same-named fake the suite has put on `window`, falling
 * back to the real export. That keeps the suites' faking style (`window.Toast = fake` before loading the subject);
 * `mockModule` covers a fake that has to be a whole module. What the suite itself loads is never redirected, so a
 * reloaded subject is always fresh.
 */
const babelJest = require('babel-jest').default;

const babel = babelJest.createTransformer({
  babelrc: false,
  configFile: false,
  sourceType: 'unambiguous',
  plugins: ['@babel/plugin-transform-dynamic-import', '@babel/plugin-transform-modules-commonjs'],
});

// Only a property the suite itself assigned counts: the window's own API lives on its prototype, so `hasOwn` tells
// `window.Toast = fake` apart from `window.name` or `window.open`.
// One line, and placed on the file's first line, so the stack traces' line numbers still match the source.
const HELPER = "const __withWindowFakes = (m) => new Proxy(m, { get(target, key) { "
  + "return typeof key === 'string' && Object.hasOwn(window, key) ? window[key] : target[key]; } });";

module.exports = {
  canInstrument: true,
  getCacheKey(sourceText, sourcePath, options) {
    // Bumped with any change to this file: the output is cached by this key.
    return babel.getCacheKey(sourceText, sourcePath, options) + ':window-fakes-v3';
  },
  process(sourceText, sourcePath, options) {
    const result = babel.process(sourceText, sourcePath, options);
    if (!/^\s*(import|export)\b/m.test(sourceText)) return result;
    const code = result.code.replace(/\brequire\((["'][^"']+["'])\)/g, '__withWindowFakes(require($1))');
    return { ...result, code: HELPER + ' ' + code };
  },
};
